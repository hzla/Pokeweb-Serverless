import { concatBytes, readU16, readU32 } from "../nds/binary";
import { readNitroResources } from "./map3dModel";
import { extendGrassDraws, packGrassCommands, terrainModelLayout, writeTerrainModel, type GpuCommand, type ModelBox, type TerrainModelLayout } from "./mapGrassGeometry";
import { ensure, materialRecords, replaceMaterialRecords, type NativeMaterialRecord } from "./nitroResourceWriter";

/**
 * Pieces of native terrain art (trees, ledges) added by a map brush. They live in their own terrain shapes, one per
 * native material, named with the brush's prefix ("t1_ki02ax" for a tree on the primary collision layer, "t2_" for
 * the second). Each piece's run of faces starts with a tag: a texture coordinate that the next command always
 * overrides, holding a magic byte and a 24-bit payload (where the piece is), so pieces can be found and removed later
 * without the source ROM. The original terrain lists stay byte-for-byte.
 */
export type BrushMember = 1 | 2;
export type BrushKind = { prefixes: Readonly<Record<BrushMember, string>>; magic: number; tool: string };

/** One vertex with the attributes the GPU had latched when it was submitted. */
export type BrushVertex = { position: readonly [number, number, number]; color?: number; normal?: number; texcoord?: number; normalLast?: boolean };
/**
 * `nativeName` draws the part with a material under its own native name rather than the brush's prefixed copy, so
 * an area texture animation keyed by that name (Floccesy's swaying flowers) also moves it. The shape keeps the prefix.
 */
export type BrushPart = { record: NativeMaterialRecord; shapeHeader: Uint8Array; faces: BrushVertex[][]; nativeName?: boolean };
/** A piece to add: model-space faces per native material, and its 24-bit tag payload. */
export type BrushPiece = { payload: number; parts: readonly BrushPart[] };

const GPU_PARAMS: Record<number, number> = { 0: 0, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 2, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x40: 1, 0x41: 0 };

function readCommands(list: Uint8Array, error: string): GpuCommand[] {
  const commands: GpuCommand[] = [];
  let offset = 0;
  while (offset < list.length) {
    ensure(offset + 4 <= list.length, error);
    const packet = readU32(list, offset);
    offset += 4;
    for (let byte = 0; byte < 4; byte++) {
      const op = (packet >>> (byte * 8)) & 255, count = GPU_PARAMS[op];
      ensure(count !== undefined && offset + count * 4 <= list.length, error);
      if (op) commands.push({ op, params: Array.from({ length: count }, (_, i) => readU32(list, offset + i * 4)) });
      offset += count * 4;
    }
  }
  return commands;
}

const s16 = (value: number) => (value << 16) >> 16;
const s10 = (value: number) => (value << 22) >> 22;

function position(op: number, params: number[], last: readonly number[]): [number, number, number] {
  const [a, b] = params;
  if (op === 0x23) return [s16(a) / 4096, s16(a >>> 16) / 4096, s16(b) / 4096];
  if (op === 0x24) return [s10(a) / 64, s10(a >>> 10) / 64, s10(a >>> 20) / 64];
  if (op === 0x25) return [s16(a) / 4096, s16(a >>> 16) / 4096, last[2]];
  if (op === 0x26) return [s16(a) / 4096, last[1], s16(a >>> 16) / 4096];
  if (op === 0x27) return [last[0], s16(a) / 4096, s16(a >>> 16) / 4096];
  return [last[0] + s10(a) / 4096, last[1] + s10(a >>> 10) / 4096, last[2] + s10(a >>> 20) / 4096];
}

/** Decode a native display list into faces (3 or 4 vertices each) in model units times `scale`. */
export function decodeFaces(list: Uint8Array, scale: number): BrushVertex[][] {
  const error = "A native shape uses a display list the map brush cannot read.";
  const faces: BrushVertex[][] = [];
  let state: Omit<BrushVertex, "position"> = {};
  let last = [0, 0, 0], prim = -1, run: BrushVertex[] = [];
  const flush = () => {
    if (prim === 0) for (let i = 0; i + 2 < run.length; i += 3) faces.push(run.slice(i, i + 3));
    else if (prim === 1) for (let i = 0; i + 3 < run.length; i += 4) faces.push(run.slice(i, i + 4));
    else if (prim === 2) for (let i = 0, odd = false; i + 2 < run.length; i++, odd = !odd) faces.push(odd ? [run[i], run[i + 2], run[i + 1]] : [run[i], run[i + 1], run[i + 2]]);
    else if (prim === 3) for (let i = 0; i + 3 < run.length; i += 2) faces.push([run[i], run[i + 1], run[i + 3], run[i + 2]]);
    run = [];
  };
  for (const { op, params } of readCommands(list, error)) {
    if (op === 0x40) { flush(); prim = params[0] & 3; }
    else if (op === 0x41) { flush(); prim = -1; }
    else if (op === 0x20) state = { ...state, color: params[0], normalLast: false };
    else if (op === 0x21) state = { ...state, normal: params[0], normalLast: true };
    else if (op === 0x22) state = { ...state, texcoord: params[0] };
    else {
      ensure(prim >= 0, error);
      last = position(op, params, last);
      run.push({ ...state, position: [last[0] * scale, last[1] * scale, last[2] * scale] });
    }
  }
  flush();
  return faces;
}

/** Which material each terrain shape is drawn with, in draw order. */
export function shapeMaterials(file: Uint8Array) {
  const native = readNitroResources(file).models[0];
  ensure(native, "Missing terrain model.");
  const draws: { shape: number; material: number }[] = [];
  let bound = -1;
  for (const op of native.renderOps) {
    if (op.kind === "bindMaterial") bound = op.material;
    if (op.kind === "draw") draws.push({ shape: op.piece, material: bound });
  }
  return { native, draws };
}

export function rootIsIdentity(file: Uint8Array) {
  const root = readNitroResources(file).models[0]?.objects[0]?.matrix;
  return Boolean(root?.every((value, index) => value === (index % 5 === 0 ? 1 : 0)));
}

/** Every native face drawn with one of `materials`, with its material record and shape header. */
export function nativeFaces(file: Uint8Array, materials: readonly string[], tool: string) {
  const layout = terrainModelLayout(file, tool);
  const records = materialRecords(file);
  const parts: BrushPart[] = [];
  for (const { shape, material } of shapeMaterials(file).draws) {
    const record = records[material];
    if (!record || !materials.includes(record.name)) continue;
    const source = layout.shapes[shape];
    ensure(source, `Missing native terrain shape ${shape}.`);
    const faces = decodeFaces(source.list, layout.scale);
    const existing = parts.find(part => part.record.name === record.name);
    if (existing) existing.faces.push(...faces);
    else parts.push({ record, shapeHeader: source.header.slice(), faces });
  }
  return parts;
}

/** GPU commands drawing faces as independent triangles and quads, every vertex with its own latched attributes. */
export function encodeFaceCommands(faces: readonly (readonly BrushVertex[])[], scale: number, tool: string): GpuCommand[] {
  const coord = (value: number) => {
    const fixed = Math.round(value * 4096 / scale);
    ensure(fixed >= -32768 && fixed <= 32767, `The ${tool} reaches beyond this terrain model's coordinate range.`);
    return fixed & 65535;
  };
  const commands: GpuCommand[] = [];
  for (const corners of [3, 4]) {
    const group = faces.filter(face => face.length === corners);
    if (!group.length) continue;
    commands.push({ op: 0x40, params: [corners === 3 ? 0 : 1] });
    for (const face of group) for (const vertex of face) {
      const lighting: GpuCommand[] = [];
      if (vertex.color !== undefined) lighting.push({ op: 0x20, params: [vertex.color] });
      if (vertex.normal !== undefined) lighting[vertex.normalLast ? "push" : "unshift"]({ op: 0x21, params: [vertex.normal] });
      commands.push(...lighting);
      if (vertex.texcoord !== undefined) commands.push({ op: 0x22, params: [vertex.texcoord] });
      const [x, y, z] = vertex.position;
      commands.push({ op: 0x23, params: [coord(x) | (coord(y) << 16), coord(z)] });
    }
    commands.push({ op: 0x41, params: [] });
  }
  return commands;
}

function pieceCommands(magic: number, payload: number, part: BrushPart, scale: number, tool: string): GpuCommand[] {
  return [{ op: 0x22, params: [((magic << 24) | (payload & 0xffffff)) >>> 0] }, ...encodeFaceCommands(part.faces, scale, tool)];
}

/** Vertices, polygons and quads a native display list submits, as the model header counts them. */
export function countDisplayList(list: Uint8Array) {
  let vertices = 0, polygons = 0, quads = 0, prim = -1, run = 0;
  const close = () => {
    if (prim === 0) polygons += Math.floor(run / 3);
    else if (prim === 1) { polygons += Math.floor(run / 4); quads += Math.floor(run / 4); }
    else if (prim === 2) polygons += Math.max(0, run - 2);
    else if (prim === 3) { const n = Math.max(0, Math.floor((run - 2) / 2)); polygons += n; quads += n; }
    run = 0;
  };
  for (const { op, params } of readCommands(list, "A native shape uses a display list the map brush cannot read.")) {
    if (op === 0x40) { close(); prim = params[0] & 3; }
    else if (op === 0x41) { close(); prim = -1; }
    else if (op >= 0x23 && op <= 0x28) { vertices++; run++; }
  }
  close();
  return { vertices, polygons, quads };
}

function faceCounts(parts: readonly { faces: readonly (readonly unknown[])[] }[]) {
  let vertices = 0, polygons = 0, quads = 0;
  for (const part of parts) for (const face of part.faces) {
    vertices += face.length;
    polygons++;
    if (face.length === 4) quads++;
  }
  return { vertices, polygons, quads };
}

function pieceBox(piece: BrushPiece): ModelBox {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of piece.parts) for (const face of part.faces) for (const { position } of face) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  return { min, max };
}

function rootStored(file: Uint8Array) {
  const native = readNitroResources(file).models[0];
  return native.renderOps[1]?.kind === "store" && native.renderOps[1].stack === 0 &&
    !native.renderOps.slice(2).some(op => (op.kind === "store" || op.kind === "mix") && op.stack === 0);
}

/** Add brush pieces to a terrain model. The native node data, material records and display lists are kept. */
export function appendBrushPieces(modelFile: Uint8Array, kind: BrushKind, pieces: readonly BrushPiece[], member: BrushMember = 1) {
  if (!pieces.length) return modelFile;
  ensure(rootIsIdentity(modelFile), `This chunk has a transformed root node the ${kind.tool} cannot extend.`);
  const records = materialRecords(modelFile), originalMaterialCount = records.length;
  const prefix = kind.prefixes[member];
  const bound = new Map<string, { record: NativeMaterialRecord; header: Uint8Array }>();
  const same = (record: NativeMaterialRecord, source: NativeMaterialRecord) => record.textureName === source.textureName && record.paletteName === source.paletteName;
  for (const piece of pieces) for (const { record: source, shapeHeader, nativeName } of piece.parts) {
    const name = `${prefix}${source.name}`;
    if (bound.has(name)) continue;
    ensure(name.length <= 16, `The native material ${source.name} has too long a name for the ${kind.tool}.`);
    // A native-named part shares the chunk's own material of that name when it draws the same texture.
    const native = nativeName ? records.find(record => record.name === source.name) : undefined;
    let record = nativeName && (!native || same(native, source)) ? native : records.find(record => record.name === name);
    const materialName = nativeName && (!native || same(native, source)) ? source.name : name;
    if (record) {
      ensure(same(record, source), `A custom material conflicts with the ${kind.tool}.`);
    } else {
      record = { ...source, name: materialName };
      records.push(record);
    }
    bound.set(name, { record, header: shapeHeader });
  }
  const file = records.length === originalMaterialCount ? modelFile : replaceMaterialRecords(modelFile, records);
  const layout: TerrainModelLayout = terrainModelLayout(file, kind.tool);
  const { scale, shapes, original } = layout;
  const added = faceCounts(pieces.flatMap(piece => piece.parts));
  ensure(readU16(original, 38) + added.polygons <= 2048 && readU16(original, 36) + added.vertices <= 6144,
    `This chunk has reached the DS geometry limit. Try a smaller ${kind.tool} edit.`);
  const draws: number[] = [];
  for (const [name, { record, header }] of bound) {
    const commands = pieces.flatMap(piece => piece.parts.filter(part => `${prefix}${part.record.name}` === name)
      .flatMap(part => pieceCommands(kind.magic, piece.payload, part, scale, kind.tool)));
    const list = packGrassCommands(commands);
    const existing = shapes.find(shape => shape.name === name);
    if (existing) {
      existing.list = concatBytes([existing.list, list]);
    } else {
      draws.push(4, records.indexOf(record), 5, shapes.length);
      shapes.push({ name, data: new Uint8Array(4), header: header.slice(), list });
    }
  }
  const sbc = extendGrassDraws(layout.sbc, draws, rootStored(file), kind.tool);
  return writeTerrainModel(file, layout, sbc, added, pieces.map(pieceBox));
}

type PlacedRun = { key: number; commands: GpuCommand[]; vertices: number; polygons: number; quads: number };
/** The key of a placed piece: its tag payload, offset per collision layer. */
export const brushPieceKey = (payload: number, member: BrushMember) => payload + (member - 1) * 0x1000000;

function readRuns(list: Uint8Array, member: BrushMember, kind: BrushKind): PlacedRun[] {
  const error = `A piece placed with the ${kind.tool} was modified and cannot be removed safely.`;
  const commands = readCommands(list, error);
  const runs: PlacedRun[] = [];
  let run: PlacedRun | undefined, prim = -1, verticesInPrim = 0;
  for (const [i, command] of commands.entries()) {
    if (command.op === 0x22 && command.params[0] >>> 24 === kind.magic && commands[i + 1]?.op === 0x40) {
      ensure(prim < 0, error);
      run = { key: brushPieceKey(command.params[0] & 0xffffff, member), commands: [command], vertices: 0, polygons: 0, quads: 0 };
      runs.push(run);
      continue;
    }
    ensure(run, error);
    run.commands.push(command);
    if (command.op === 0x40) {
      ensure(prim < 0 && [0, 1].includes(command.params[0]), error);
      prim = command.params[0];
      verticesInPrim = 0;
    } else if (command.op === 0x41) {
      ensure(prim >= 0, error);
      const corners = prim === 0 ? 3 : 4;
      ensure(verticesInPrim % corners === 0, error);
      run.polygons += verticesInPrim / corners;
      if (corners === 4) run.quads += verticesInPrim / 4;
      prim = -1;
    } else if (command.op >= 0x23 && command.op <= 0x28) {
      ensure(prim >= 0, error);
      run.vertices++;
      verticesInPrim++;
    }
  }
  ensure(prim < 0, error);
  return runs;
}

export type PlacedBrushPiece = { member: BrushMember; payload: number; materials: Set<string> };

/** Find the pieces a brush placed, keyed by brushPieceKey. */
export function readBrushPieces(file: Uint8Array, kind: BrushKind) {
  const layout = terrainModelLayout(file, kind.tool);
  const { native, draws } = shapeMaterials(file);
  const prefixes = Object.entries(kind.prefixes).map(([member, prefix]) => ({ member: Number(member) as BrushMember, prefix }));
  const pieces = new Map<number, PlacedBrushPiece>();
  const shapes = layout.shapes.flatMap((shape, id) => {
    const owner = prefixes.find(({ prefix }) => shape.name.startsWith(prefix));
    if (!owner) return [];
    const material = draws.filter(draw => draw.shape === id).map(draw => native.materials[draw.material]?.name);
    ensure(material.length === 1 && (material[0] === shape.name || material[0] === shape.name.slice(owner.prefix.length)),
      `A piece placed with the ${kind.tool} has a different draw sequence and cannot be removed safely.`);
    const runs = readRuns(shape.list, owner.member, kind);
    for (const run of runs) {
      const entry = pieces.get(run.key) ?? { member: owner.member, payload: run.commands[0].params[0] & 0xffffff, materials: new Set<string>() };
      entry.materials.add(shape.name.slice(owner.prefix.length));
      pieces.set(run.key, entry);
    }
    return [{ shape, runs }];
  });
  return {
    pieces,
    remove(keys: ReadonlySet<number>) {
      const selected = new Set([...keys].filter(key => pieces.has(key)));
      if (!selected.size) return file;
      const removed = { vertices: 0, polygons: 0, quads: 0 };
      const lists = new Map<string, Uint8Array>();
      for (const { shape, runs } of shapes) {
        const keep = runs.filter(run => !selected.has(run.key));
        if (keep.length === runs.length) continue;
        for (const run of runs) if (selected.has(run.key)) {
          removed.vertices += run.vertices;
          removed.polygons += run.polygons;
          removed.quads += run.quads;
        }
        // Keep shape indices and bindings stable. A NOP list draws nothing and is reused by the brush.
        lists.set(shape.name, keep.length ? packGrassCommands(keep.flatMap(run => run.commands)) : new Uint8Array(4));
      }
      const next = { ...layout, shapes: layout.shapes.map(shape => ({ ...shape, list: lists.get(shape.name) ?? shape.list })) };
      return writeTerrainModel(file, next, layout.sbc, { vertices: -removed.vertices, polygons: -removed.polygons, quads: -removed.quads });
    },
  };
}

/** Shapes added by any map brush, which grass's source-terrain check must ignore. */
export function isBrushShape(name: string) {
  return /^[tls][12]_/.test(name);
}
