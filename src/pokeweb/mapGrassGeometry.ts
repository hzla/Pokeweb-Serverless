import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { nitroRenderParamLength, readNitroResources } from "./map3dModel";
import { equalMapBytes } from "./gen5MapImportFormats";
import { align, ensure, materialRecords, nitroBlocks, readDictionary, replaceMaterialRecords, writeDictionary, writeNitroFile, type NativeMaterialRecord } from "./nitroResourceWriter";

export const GRASS_TILE_CLASSES = { regular: 4, dark: 6 } as const;
export const GRASS_Z_OFFSET = 2; // Native grass planes are shifted along +Z from the permission tile.
export const GRASS_LAYERS = {
  regular: [{ texture: "kusa_ec1", lift: 8 }, { texture: "kusa_ec2", lift: 6 }, { texture: "kusa_ec3", lift: 2 }],
  dark: [{ texture: "kusa_ec1s", lift: 9 }, { texture: "kusa_ec2s", lift: 6 }, { texture: "kusa_ec3", lift: 2 }],
} as const;
const grassLayers = new Set<string>(Object.values(GRASS_LAYERS).flatMap(layers => layers.map(layer => layer.texture)));
const BRUSH_PREFIXES = { 1: "pw_", 2: "pw2_" } as const;
export type GrassPermissionMember = keyof typeof BRUSH_PREFIXES;

export function grassTileKey(index: number, member: GrassPermissionMember) {
  return index + (member - 1) * 1024;
}

function brushLayer(name: string) {
  for (const member of [1, 2] as const) {
    const prefix = BRUSH_PREFIXES[member];
    if (!name.startsWith(prefix)) continue;
    const texture = name.slice(prefix.length);
    if (grassLayers.has(texture)) return { member, texture };
  }
}

export function isMapGrassSurface(material: string) {
  return grassLayers.has(material) || Boolean(brushLayer(material));
}
export type MapGrassKind = keyof typeof GRASS_LAYERS;
export type GrassQuad = {
  x: number;
  z: number;
  /** Local heights at (0,1), (1,1), (1,0), (0,0), in terrain model units. */
  heights: readonly number[];
  layerLifts?: readonly number[];
};
export type GpuCommand = { op: number; params: number[] };
type Layer = { record: NativeMaterialRecord; quads: GrassQuad[]; lift: number };

function grassDisplayList(quads: GrassQuad[], defaultLift: number, layer: number, scale: number) {
  const commands: GpuCommand[] = [];
  const emit = (op: number, ...params: number[]) => commands.push({ op, params });
  function coord(value: number) {
    const fixed = Math.round(value * 4096 / scale);
    ensure(fixed >= -32768 && fixed <= 32767, "Grass extends beyond this terrain model's coordinate range.");
    return fixed & 65535;
  }
  emit(0x40, 1); // GX_QUADS
  for (const { x, z, heights, layerLifts } of quads) {
    const lift = layerLifts?.[layer] ?? defaultLift;
    const dx = (heights[2] - heights[3]) / 16, dz = (heights[0] - heights[3]) / 16;
    const length = Math.hypot(dx, 1, dz);
    const normal = [-dx, 1, -dz].map(value => Math.max(-512, Math.min(511, Math.round(value / length * 512))) & 1023);
    emit(0x21, normal[0] | (normal[1] << 10) | (normal[2] << 20));
    for (const [i, [u, v]] of [[0, 1], [1, 1], [1, 0], [0, 0]].entries()) {
      emit(0x22, u * 256 | (v * 256 << 16));
      emit(0x23, coord(x + u * 16) | (coord(heights[i] + lift) << 16), coord(z + GRASS_Z_OFFSET + v * 16));
    }
  }
  emit(0x41);
  return packGrassCommands(commands);
}

export function packGrassCommands(commands: GpuCommand[]) {
  const words: number[] = [];
  for (let i = 0; i < commands.length; i += 4) {
    const packet = commands.slice(i, i + 4);
    words.push(packet.reduce((word, command, byte) => word | (command.op << (byte * 8)), 0));
    for (const { params } of packet) words.push(...params);
  }
  const out = new Uint8Array(words.length * 4);
  words.forEach((word, i) => writeU32(out, i * 4, word));
  return out;
}

/** Extend the scaled static draw sequence, or restore the root used by multi-node terrain. */
export function extendGrassDraws(sbc: Uint8Array, draws: number[], rootStored: boolean, tool = "grass brush") {
  if (!draws.length) return sbc;
  const storedRoot = [0x26, 0, 0, 0, 0];
  const root = sbc[0] === 0x26 ? storedRoot : [6, 0, 0, 0];
  const setup = sbc[0] === 2 ? [2, 0, 1, ...root, 11] : [...root, 2, 0, 1, 11];
  let i = setup.length;
  if (setup.every((byte, index) => sbc[index] === byte)) {
    while (sbc[i] === 0 || [4, 5].includes(sbc[i] & 31)) i += sbc[i] === 0 ? 1 : 2;
    if (sbc[i] === 0x2b && sbc[i + 1] === 1) return concatBytes([sbc.subarray(0, i), Uint8Array.from(draws), sbc.subarray(i)]);
  }
  const supported = `This chunk uses a terrain draw sequence the ${tool} cannot extend.`;
  ensure(rootStored && storedRoot.every((byte, index) => sbc[index] === byte), supported);
  for (i = 0; i < sbc.length && sbc[i] !== 1; ) {
    const opcode = sbc[i++];
    ensure((opcode & 31) <= 13, supported);
    i += nitroRenderParamLength(opcode, sbc, i);
  }
  ensure(sbc[i] === 1 && sbc[i - 1] === 0x2b, supported);
  // Restore model-space position from slot zero before the new draw calls.
  const extra = Uint8Array.from([3, 0, 2, 0, 1, 11, ...draws, 0x2b]);
  return concatBytes([sbc.subarray(0, i), extra, sbc.subarray(i), new Uint8Array(align(extra.length) - extra.length)]);
}

export type ModelBox = { min: readonly number[]; max: readonly number[] };

function grassBoxes(quads: GrassQuad[], kind: MapGrassKind): ModelBox[] {
  const defaultLifts = GRASS_LAYERS[kind].map(layer => layer.lift);
  return quads.map(({ x, z, heights, layerLifts = defaultLifts }) => ({
    min: [x, Math.min(...heights) + Math.min(...layerLifts), z + GRASS_Z_OFFSET],
    max: [x + 16, Math.max(...heights) + Math.max(...layerLifts), z + 16 + GRASS_Z_OFFSET],
  }));
}

function expandModelBounds(model: Uint8Array, boxes: readonly ModelBox[]) {
  const scale = readU32(model, 56) / 4096;
  if (!scale) return;
  const unit = scale / 4096;
  const signed = (at: number) => (readU16(model, at) << 16) >> 16;
  const low = [44, 46, 48].map(at => signed(at));
  const high = low.map((value, axis) => value + signed(50 + axis * 2));
  const start = low.slice(), end = high.slice();
  for (const { min, max } of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], Math.floor(min[axis] / unit));
      high[axis] = Math.max(high[axis], Math.ceil(max[axis] / unit));
    }
  }
  if (low.every((value, axis) => value === start[axis] && high[axis] === end[axis])) return;
  let boxScale = scale;
  while (low.some((value, axis) => value < -32768 || high[axis] - value > 32767)) {
    boxScale *= 2;
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.floor(low[axis] / 2);
      high[axis] = Math.ceil(high[axis] / 2);
    }
  }
  writeU32(model, 56, boxScale * 4096);
  writeU32(model, 60, Math.round(4096 / boxScale));
  low.forEach((value, axis) => {
    writeU16(model, 44 + axis * 2, value & 65535);
    writeU16(model, 50 + axis * 2, high[axis] - value);
  });
}

/** Keep the original node data, material records and GPU display lists. Add draw calls for the new layers. */
export function appendMapGrass(
  modelFile: Uint8Array, kind: MapGrassKind, quads: GrassQuad[], donor: NativeMaterialRecord[], member: GrassPermissionMember = 1,
) {
  if (!quads.length) return modelFile;
  const records = materialRecords(modelFile), originalMaterialCount = records.length;
  const native = readNitroResources(modelFile).models[0], root = native?.objects[0]?.matrix;
  ensure(root?.every((value, index) => value === (index % 5 === 0 ? 1 : 0)), "This chunk has a transformed root node the grass brush cannot extend.");
  const layers: Layer[] = GRASS_LAYERS[kind].map(({ texture, lift }) => {
    const name = `${BRUSH_PREFIXES[member]}${texture}`;
    const existing = records.find(record => record.name === name);
    if (existing) {
      ensure(existing.textureName === texture && existing.paletteName === `${texture}_pl`, "A custom material conflicts with the grass brush.");
      return { record: existing, quads, lift };
    }
    const source = donor.find(record => record.name === texture && record.textureName === texture && record.paletteName === `${texture}_pl`);
    ensure(source, `The source ROM is missing the native grass material ${texture}.`);
    const record = { ...source, name };
    records.push(record);
    return { record, quads, lift };
  });
  let file = modelFile;
  // Rebinding the dictionary leaves the original material records and their IDs intact.
  if (records.length !== originalMaterialCount) file = replaceMaterialRecords(modelFile, records);
  const layout = terrainModelLayout(file);
  const { original, scale, shapes, sbc } = layout;
  const vertices = readU16(original, 36) + quads.length * 12;
  const polygons = readU16(original, 38) + quads.length * 3;
  ensure(polygons <= 2048 && vertices <= 6144, "This chunk has reached the DS geometry limit. Try painting fewer tiles.");

  const draws: number[] = [];
  for (const [layer, { record, quads, lift }] of layers.entries()) {
    const name = record.name, list = grassDisplayList(quads, lift, layer, scale);
    const existing = shapes.find(shape => shape.name === name);
    if (existing) {
      existing.list = concatBytes([existing.list, list]);
    } else {
      draws.push(4, records.indexOf(record), 5, shapes.length);
      const header = new Uint8Array(16);
      writeU16(header, 2, 16);
      writeU32(header, 4, 5); // Normal and texture-coordinate attributes.
      shapes.push({ name, data: new Uint8Array(4), header, list });
    }
  }
  const rootStored = native.renderOps[1]?.kind === "store" && native.renderOps[1].stack === 0 &&
    !native.renderOps.slice(2).some(op => (op.kind === "store" || op.kind === "mix") && op.stack === 0);
  const updatedSbc = extendGrassDraws(sbc, draws, rootStored);
  const delta = quads.length * 3;
  return writeTerrainModel(file, layout, updatedSbc, { vertices: delta * 4, polygons: delta, quads: delta }, grassBoxes(quads, kind));
}

export function terrainModelLayout(file: Uint8Array, tool = "grass brush") {
  const blocks = nitroBlocks(file), mdlIndex = blocks.findIndex(block => readAscii(block, 0, 4) === "MDL0");
  const mdl = blocks[mdlIndex];
  ensure(mdl, "Missing terrain model block.");
  const models = readDictionary(mdl, 8);
  ensure(models.length === 1, `The ${tool} requires a single terrain model.`);
  const modelAt = readU32(models[0].data, 0), original = mdl.subarray(modelAt);
  const sbcAt = readU32(original, 4), materialAt = readU32(original, 8), shapeAt = readU32(original, 12), inverseAt = readU32(original, 16);
  ensure(sbcAt >= 64 && sbcAt < materialAt && materialAt < shapeAt && shapeAt <= inverseAt && inverseAt <= original.length, "Invalid native terrain layout.");
  const sbc = original.subarray(sbcAt, materialAt);
  const scale = readU32(original, 28) / 4096;
  ensure(scale > 0, "The terrain model has an invalid position scale.");
  const shapes = readDictionary(original, shapeAt).map(entry => {
    const at = shapeAt + readU32(entry.data, 0), size = readU16(original, at + 2);
    const start = at + readU32(original, at + 8), end = start + readU32(original, at + 12);
    ensure(at >= shapeAt && size >= 16 && at + size <= inverseAt && start >= at + size && end <= inverseAt, "Invalid native terrain shape.");
    return { ...entry, header: original.slice(at, at + size), list: original.subarray(start, end) };
  });
  return { blocks, mdlIndex, mdl, modelAt, original, sbcAt, materialAt, shapeAt, inverseAt, sbc, scale, shapes };
}

export type TerrainModelLayout = ReturnType<typeof terrainModelLayout>;
export type TerrainCountDelta = { vertices: number; polygons: number; quads: number };

export function writeTerrainModel(file: Uint8Array, layout: TerrainModelLayout, sbc: Uint8Array, delta: TerrainCountDelta, boxes?: readonly ModelBox[]) {
  const { mdlIndex, mdl, modelAt, original, sbcAt, materialAt, shapeAt, inverseAt } = layout;
  const blocks = layout.blocks.slice();
  const shapes = layout.shapes.map(shape => ({ ...shape, data: shape.data.slice(), header: shape.header.slice() }));
  const vertices = readU16(original, 36) + delta.vertices;
  const polygons = readU16(original, 38) + delta.polygons;
  const quads = readU16(original, 42) + delta.quads;
  ensure(vertices >= 0 && polygons >= 0 && quads >= 0, "Invalid terrain geometry counts.");
  ensure(shapes.length <= 255, "This terrain model already uses all 255 native shape slots.");
  const dictSize = writeDictionary(shapes, 4).length;
  let headerAt = dictSize, listAt = headerAt + shapes.reduce((size, shape) => size + align(shape.header.length), 0);
  for (const shape of shapes) {
    writeU32(shape.data, 0, headerAt);
    writeU32(shape.header, 8, listAt - headerAt);
    writeU32(shape.header, 12, shape.list.length);
    headerAt += align(shape.header.length);
    listAt += align(shape.list.length);
  }
  const shapeBlock = new Uint8Array(listAt);
  shapeBlock.set(writeDictionary(shapes, 4));
  for (const shape of shapes) {
    const at = readU32(shape.data, 0);
    shapeBlock.set(shape.header, at);
    shapeBlock.set(shape.list, at + readU32(shape.header, 8));
  }
  const nextMaterial = sbcAt + sbc.length, nextShape = nextMaterial + shapeAt - materialAt;
  const nextInverse = nextShape + shapeBlock.length;
  const output = concatBytes([original.subarray(0, sbcAt), sbc, original.subarray(materialAt, shapeAt), shapeBlock, original.subarray(inverseAt)]);
  writeU32(output, 0, readU32(original, 0) + nextInverse - inverseAt);
  writeU32(output, 8, nextMaterial);
  writeU32(output, 12, nextShape);
  writeU32(output, 16, nextInverse);
  output[25] = shapes.length;
  writeU16(output, 36, vertices);
  writeU16(output, 38, polygons);
  writeU16(output, 42, quads);
  if (boxes?.length) expandModelBounds(output, boxes);
  blocks[mdlIndex] = concatBytes([mdl.subarray(0, modelAt), output]);
  writeU32(blocks[mdlIndex], 4, blocks[mdlIndex].length);
  return writeNitroFile(file, blocks);
}

const GRASS_GPU_PARAMS: Record<number, number> = { 0: 0, 0x21: 1, 0x22: 1, 0x23: 2, 0x40: 1, 0x41: 0 };
const GRASS_UVS = [256 << 16, 256 | (256 << 16), 256, 0];
const GRASS_CORNERS = [[0, 16], [16, 16], [16, 0], [0, 0]];

type PaintedQuad = { tileIndex: number; commands: GpuCommand[] };

function readGrassQuads(list: Uint8Array, scale: number): PaintedQuad[] {
  const error = "A painted grass layer was modified and cannot be erased safely.";
  const commands: GpuCommand[] = [];
  let offset = 0;
  while (offset < list.length) {
    ensure(offset + 4 <= list.length, error);
    const packet = readU32(list, offset);
    offset += 4;
    for (let byte = 0; byte < 4; byte++) {
      const op = (packet >>> (byte * 8)) & 255, count = GRASS_GPU_PARAMS[op];
      ensure(count !== undefined && offset + count * 4 <= list.length, error);
      if (op) commands.push({ op, params: Array.from({ length: count }, (_, i) => readU32(list, offset + i * 4)) });
      offset += count * 4;
    }
  }
  const quads: PaintedQuad[] = [];
  let i = 0, drawing = false, normal: GpuCommand | undefined;
  const coordinate = (value: number) => ((value << 16) >> 16) * scale / 4096;
  while (i < commands.length) {
    const command = commands[i];
    if (command.op === 0x40) {
      ensure(!drawing && command.params[0] === 1, error);
      drawing = true;
      normal = undefined;
      i++;
    } else if (command.op === 0x41) {
      ensure(drawing, error);
      drawing = false;
      i++;
    } else {
      ensure(drawing, error);
      if (command.op === 0x21) normal = commands[i++];
      ensure(normal, error);
      const quad = commands.slice(i, i + 8);
      ensure(quad.length === 8 && GRASS_UVS.every((uv, v) => quad[v * 2].op === 0x22 && quad[v * 2].params[0] === uv && quad[v * 2 + 1].op === 0x23), error);
      const x = coordinate(quad[1].params[0]), z = coordinate(quad[1].params[1]) - 16;
      const tileX = x / 16 + 16, tileY = Math.floor(z / 16) + 16;
      // Older brush strokes were centered in the permission tile.
      const zOffset = z - (tileY - 16) * 16;
      ensure((zOffset === 0 || zOffset === GRASS_Z_OFFSET) && [tileX, tileY].every(tile => Number.isInteger(tile) && tile >= 0 && tile < 32) &&
        GRASS_CORNERS.every(([dx, dz], v) => coordinate(quad[v * 2 + 1].params[0]) === x + dx && coordinate(quad[v * 2 + 1].params[1]) === z + dz), error);
      quads.push({ tileIndex: tileY * 32 + tileX, commands: [normal, ...quad] });
      i += 8;
    }
  }
  ensure(!drawing, error);
  return quads;
}

/** Decode only the shape format emitted by Add Grass. The original terrain lists are kept byte-for-byte. */
export function readPaintedMapGrass(file: Uint8Array) {
  const layout = terrainModelLayout(file);
  const native = readNitroResources(file).models[0];
  const tileLayers = new Map<number, Set<string>>();
  const layers = layout.shapes.flatMap((shape, id) => {
    const brush = brushLayer(shape.name);
    if (!brush) return [];
    const { member, texture } = brush;
    let boundMaterial: (typeof native.materials)[number] | undefined;
    let draws = 0;
    for (const op of native.renderOps) {
      if (op.kind === "bindMaterial") boundMaterial = native.materials[op.material];
      if (op.kind !== "draw" || op.piece !== id) continue;
      ensure(boundMaterial?.name === shape.name && boundMaterial.textureName === texture && boundMaterial.paletteName === `${texture}_pl`,
        "A painted grass layer has a different material and cannot be erased safely.");
      draws++;
    }
    ensure(draws === 1, "A painted grass layer has a different draw sequence and cannot be erased safely.");
    const quads = readGrassQuads(shape.list, layout.scale);
    for (const { tileIndex } of quads) {
      const key = grassTileKey(tileIndex, member);
      const used = tileLayers.get(key) ?? new Set<string>();
      ensure(!used.has(texture), "Overlapping painted grass layers cannot be erased safely.");
      used.add(texture);
      tileLayers.set(key, used);
    }
    return [{ shape, quads, member }];
  });
  const tiles = new Map<number, MapGrassKind>();
  for (const [index, used] of tileLayers) {
    const kind = (Object.keys(GRASS_LAYERS) as MapGrassKind[]).find(kind => used.size === GRASS_LAYERS[kind].length &&
      GRASS_LAYERS[kind].every(({ texture }) => used.has(texture)));
    ensure(kind, "A painted tile has incomplete grass layers and cannot be erased safely.");
    tiles.set(index, kind);
  }
  return {
    tiles,
    matchesSourceTerrain(sourceFile: Uint8Array) {
      const source = terrainModelLayout(sourceFile);
      const originalShapes = layout.shapes.filter(shape => !brushLayer(shape.name) && !/^[tlskf][12]_/.test(shape.name));
      return source.scale === layout.scale &&
        equalMapBytes(source.original.subarray(64, source.sbcAt), layout.original.subarray(64, layout.sbcAt)) &&
        source.shapes.length === originalShapes.length && source.shapes.every((shape, i) =>
          shape.name === originalShapes[i].name && equalMapBytes(shape.list, originalShapes[i].list));
    },
    remove(indices: ReadonlySet<number>) {
      const selected = new Set([...indices].filter(index => tiles.has(index)));
      if (!selected.size) return file;
      const replacements = new Map<string, Uint8Array>();
      for (const { shape, quads, member } of layers) {
        const keep = quads.filter(quad => !selected.has(grassTileKey(quad.tileIndex, member)));
        if (keep.length === quads.length) continue;
        // Keep indices and bindings stable. A NOP list draws nothing and can be reused by the brush.
        const list = keep.length ? packGrassCommands([
          { op: 0x40, params: [1] }, ...keep.flatMap(quad => quad.commands), { op: 0x41, params: [] },
        ]) : new Uint8Array(4);
        replacements.set(shape.name, list);
      }
      const shapes = layout.shapes.map(shape => ({ ...shape, list: replacements.get(shape.name) ?? shape.list }));
      const delta = -selected.size * 3;
      return writeTerrainModel(file, { ...layout, shapes }, layout.sbc, { vertices: delta * 4, polygons: delta, quads: delta });
    },
  };
}
