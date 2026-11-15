import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { isGrassLikePermission, isWaterLikePermission, type Gen5PermissionTileLike } from "./gen5PermissionModel";
import { extractGameFreakContainer, invalidateMap3dAssets, packGameFreakContainer, parseAreaHeader, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { appendMapGrass, GRASS_LAYERS, GRASS_TILE_CLASSES, grassTileKey, readPaintedMapGrass, type GrassPermissionMember, type GrassQuad, type MapGrassKind } from "./mapGrassGeometry";
import { mapGrassPlacement } from "./mapGrassPlacement";
import { loadMatrixEditorData } from "./matrixModel";
import { ensure, materialRecords } from "./nitroResourceWriter";
import { appendNitroTextures, type EncodedPalette, type EncodedTexture } from "./nitroTextureWriter";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";
import { getMapReplacementBytes, MATRIX_SEASONS, replacementRules, resolveSeasonalMatrix, seasonalAreaId, type MatrixSeason } from "./seasonalMatrixModel";

export type MapGrassTile = Map3dTile;
export type MapGrassSurface = "auto" | "upper" | "lower";
type GrassStrokeOptions = { surface?: MapGrassSurface; isCurrent?: () => boolean };
type GrassMapBin = ReturnType<typeof readGen5MapBin>;
const GRASS_FLAGS = 0x0004 | 0x0020; // Encounter and grass behavior.
const MAP_TEXTURES_PATH = "a/0/1/4";
const AREA_PATH = "a/0/1/3";
const MAPS_PATH = "a/0/0/8";

type Bank = ReturnType<typeof readNitroResources>;
const stockGrass = new WeakMap<Uint8Array, { materials: ReturnType<typeof materialRecords>; banks: Uint8Array[] }>();

function stockGrassAssets(source: Uint8Array, rom: NintendoDSRom) {
  let assets = stockGrass.get(source);
  if (!assets) {
    const donor = new NARC(rom.getFileByName(MAPS_PATH)).files[16];
    ensure(donor, "The source ROM is missing the native grass donor map.");
    const materials = materialRecords(extractGameFreakContainer(donor).files[0]);
    // The original spring through winter Route 1 packs contain all five layers.
    const banks = new NARC(rom.getFileByName(MAP_TEXTURES_PATH)).files.slice(2, 6);
    ensure(banks.length === 4, "The source ROM is missing the native seasonal grass textures.");
    assets = { materials, banks };
    stockGrass.set(source, assets);
  }
  return assets;
}

function addGrassTextures(bytes: Uint8Array, donor: Bank, names: Set<string>) {
  const bank = readNitroResources(bytes), images: EncodedTexture[] = [], palettes: EncodedPalette[] = [];
  for (const name of names) {
    const paletteName = `${name}_pl`;
    const source = donor.textures.find(t => t.name === name);
    const sourcePalette = donor.palettes.find(p => p.name === paletteName);
    ensure(source && sourcePalette, `The source ROM is missing the native texture ${name}.`);
    const texture = bank.textures.find(t => t.name === name), palette = bank.palettes.find(p => p.name === paletteName);
    const { params } = source, width = params.width(), height = params.height(), format = params.format();
    ensure(width === 16 && height === 16 && [3, 6].includes(format) && source.data1.length === params.byteLength(), `Invalid native grass texture ${name}.`);
    if (texture) {
      ensure(texture.params.width() === width && texture.params.height() === height && texture.params.format() === format, `Existing texture ${name} is incompatible with the grass brush.`);
    }
    const paletteBytes = sourcePalette.block.slice(sourcePalette.offset, sourcePalette.offset + (format === 3 ? 32 : 16));
    ensure(paletteBytes.length === (format === 3 ? 32 : 16), `Truncated native palette ${paletteName}.`);
    if (!texture) {
      // A palette already present in the destination must match the imported texture.
      images.push({ name, paletteName, width, height, params: (1 << 20) | (1 << 23) | (format << 26) | (Number(params.color0Transparent()) << 29),
        pixels: source.data1, palette: paletteBytes, quantized: false });
    } else if (!palette) {
      // An unpaired texture may have custom color indices. Only pair it with
      // the stock palette if the indices match the stock image.
      ensure(equalMapBytes(texture.data1, source.data1), `Existing texture ${name} has no compatible palette.`);
      palettes.push({ name: paletteName, bytes: paletteBytes });
    }
  }
  return appendNitroTextures(bytes, images, palettes);
}

export type MapGrassOriginalPermission = Gen5PermissionTileLike & {
  kind: MapGrassKind;
  // Saved alongside the primary record when both members share the painted plane.
  secondary?: Gen5PermissionTileLike;
};
type ChunkOriginalPermissions = Record<number, MapGrassOriginalPermission>;
export type MapGrassOriginalPermissions = Record<number, ChunkOriginalPermissions>;
type MapChange = { id: number; before: Uint8Array; after: Uint8Array };
type GrassMapChange = MapChange & { permissionsBefore?: ChunkOriginalPermissions; permissionsAfter?: ChunkOriginalPermissions };
export type GrassSkipReason = "already-matching" | "existing-grass" | "blocked" | "water" | "special-terrain" | "split-height" | "multiple-surfaces" | "no-stacked-surface" | "crossing-surfaces" | "missing-map" | "outside-map" | "no-painted-grass" | "missing-original-permissions" | "changed-grass";
type GrassSkip = { reason: GrassSkipReason; count: number; season?: MatrixSeason };
export type GrassStroke = {
  action: "paint" | "remove";
  maps: GrassMapChange[];
  textures: MapChange[];
  count: number;
  skipped: number;
  skipReasons: GrassSkip[];
  sourceFallbackCount: number;
};

function grassStroke(action: GrassStroke["action"]) {
  const result: GrassStroke = { action, maps: [], textures: [], count: 0, skipped: 0, skipReasons: [], sourceFallbackCount: 0 };
  return {
    result,
    skip(reason: GrassSkipReason, season?: MatrixSeason) {
      result.skipped++;
      const group = result.skipReasons.find(entry => entry.reason === reason && entry.season === season);
      if (group) group.count++;
      else result.skipReasons.push({ reason, count: 1, ...(season ? { season } : {}) });
    },
  };
}

function permission(bytes: Uint8Array, index: number): Gen5PermissionTileLike {
  const at = 8 + index * 8;
  return { tileClass: readU16(bytes, at), flags: readU16(bytes, at + 2) };
}

function writePermission(bytes: Uint8Array, index: number, tileClass: number, flags: number) {
  const at = 8 + index * 8;
  writeU16(bytes, at, tileClass);
  writeU16(bytes, at + 2, flags);
}

const paintedFlags = (flags: number) => (flags & ~0x0088) | GRASS_FLAGS;
const blocked = (tile: Gen5PermissionTileLike) => Boolean(tile.flags & 1) || [1, 18].includes(tile.tileClass);
const splitWalkingPlane = (per: Uint8Array, index: number) =>
  (per[4 + index * 8] & 3) === 2 || Boolean(permission(per, index).flags & 0x8000);
const grassCorners = [[0, 1], [1, 1], [1, 0], [0, 0]] as const;
const heightEpsilon = 1e-6;

function sameWalkingPlane(primary: Uint8Array, secondary: Uint8Array, index: number, game: "BW" | "BW2") {
  const at = 4 + index * 8;
  if ([primary, secondary].some(per => splitWalkingPlane(per, index))) return false;
  if (equalMapBytes(primary.subarray(at, at + 4), secondary.subarray(at, at + 4))) return true;
  // A continuous plane is defined by three points. Different native table entries
  // can encode the same plane, so compare decoded heights when the IDs differ.
  try {
    return [[0, 0], [1, 0], [0, 1]].every(([x, y]) =>
      Math.abs(gen5HeightAt(primary, index, x, y, game) - gen5HeightAt(secondary, index, x, y, game)) < heightEpsilon);
  } catch {
    return false;
  }
}

type GrassSurfaceSelection = { member: GrassPermissionMember; mirrored?: boolean };

function selectGrassSurface(map: GrassMapBin, index: number, surface: MapGrassSurface, game: "BW" | "BW2"): GrassSurfaceSelection | GrassSkipReason {
  const [primary, secondary] = map.files.slice(1, 3);
  if (map.placements !== 3) return surface === "auto" ? { member: 1 } : "no-stacked-surface";
  if (surface === "auto" && [primary, secondary].some(per => blocked(permission(per, index)))) return { member: 1 };
  if (sameWalkingPlane(primary, secondary, index, game)) {
    return surface === "auto" ? { member: 1, mirrored: true } : "no-stacked-surface";
  }
  if (surface === "auto") return "multiple-surfaces";
  if (splitWalkingPlane(primary, index) || splitWalkingPlane(secondary, index)) return "split-height";

  // Resolve layer order from each tile's corner heights.
  const delta = grassCorners.map(([x, z]) =>
    gen5HeightAt(secondary, index, x, z, game) - gen5HeightAt(primary, index, x, z, game));
  const primaryAbove = Math.min(...delta) < -heightEpsilon;
  const secondaryAbove = Math.max(...delta) > heightEpsilon;
  if (primaryAbove && secondaryAbove) return "crossing-surfaces";
  if (!primaryAbove && !secondaryAbove) return "no-stacked-surface";
  const upper = primaryAbove ? 1 : 2;
  const lower = primaryAbove ? 2 : 1;
  return { member: surface === "upper" ? upper : lower };
}

function groundStatus(tile: Gen5PermissionTileLike, kind: MapGrassKind): "ground" | "matching" | GrassSkipReason {
  const { tileClass, flags } = tile;
  if (tileClass === GRASS_TILE_CLASSES[kind] && (flags & (GRASS_FLAGS | 1)) === GRASS_FLAGS) return "matching";
  // Ordinary dry floors, roads, sand and short grass. Keep ledges, water, barriers,
  // special terrain behavior and existing vegetation intact.
  if ([0, 2, 3, 11, 31].includes(tileClass) && !(flags & 0x8037)) return "ground";
  if (blocked(tile)) return "blocked";
  if (isWaterLikePermission(tile)) return "water";
  if (isGrassLikePermission(tile)) return "existing-grass";
  if (flags & 0x8000) return "split-height";
  return "special-terrain";
}

export type MapBrushContext = Awaited<ReturnType<typeof grassContext>>;
export { grassContext as mapBrushContext };

async function grassContext(project: ProjectState, scene: Map3dSceneData, isCurrent: () => boolean, tool = "grass") {
  const game = project.session.baseRom;
  ensure(game === "BW" || game === "BW2", `The ${tool} brush supports Black, White, Black 2 and White 2.`);
  await loadMatrixEditorData(project, { seasons: true });
  ensure(project.originalRomBytes || await activeRomMatchesProject(project), "Reconnect this project's source ROM.");
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  ensure(source && isCurrent(), `The map changed during the ${tool} stroke. Try the stroke again.`);
  const rom = new NintendoDSRom(source, { fileData: "view" });
  ensure(rom.idCode === project.romInfo.idCode && source.length === project.romInfo.size, "Reconnect this project's source ROM.");
  const maps = project.narcs.maps!;
  const rules = replacementRules(getMapReplacementBytes(project));
  const matrices = new Map<number, ReturnType<typeof resolveSeasonalMatrix>[]>();
  function variants(matrixId: number) {
    let result = matrices.get(matrixId);
    if (!result) {
      result = MATRIX_SEASONS.map(season => resolveSeasonalMatrix(project, matrixId, season, undefined, rules));
      matrices.set(matrixId, result);
    }
    return result;
  }
  const activeMatrices = variants(scene.sourceMatrixId);
  const activeSeasonIndex = MATRIX_SEASONS.indexOf(scene.season);
  const textureId = rom.fileId(MAP_TEXTURES_PATH), areaFile = rom.fileId(AREA_PATH);
  const areaBytes = getRomFileBytes(project, rom, areaFile);
  function areaHeader(area: number, season: MatrixSeason) {
    const id = seasonalAreaId(game, area, season);
    return project.map3dAreaEdits?.[String(id)] ?? parseAreaHeader(areaBytes, id);
  }
  function packFor(area: number, season: MatrixSeason) {
    return areaHeader(area, season).texturesId;
  }
  const header = Object.values(project.headers?.rows ?? {}).find(row => row.index === scene.zoneId);
  const sourceArea = Number(header?.texture_id);
  ensure(sourceArea === scene.sourceAreaId && (scene.matrixCell || Number(header?.matrix_id) === scene.sourceMatrixId)
    && activeMatrices[activeSeasonIndex].id === scene.matrixId && packFor(sourceArea, scene.season) === scene.textureId,
  `Map assignments changed. Reload the map before editing ${tool}.`);
  return { game, source, rom, maps, variants, activeMatrices, activeSeasonIndex, textureId, areaBytes, packFor, areaHeader, sourceArea };
}

function* grassDestinations(scene: Map3dSceneData, tiles: readonly MapGrassTile[], context: Awaited<ReturnType<typeof grassContext>>, skip: (reason: GrassSkipReason) => void) {
  const { activeMatrices, activeSeasonIndex } = context;
  const seen = new Set<string>();
  for (const { matrixX, matrixY, tileX, tileY } of tiles) {
    const key = `${matrixX},${matrixY},${tileX},${tileY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = scene.chunks.find(c => c.matrixX === matrixX && c.matrixY === matrixY);
    if (!chunk || ![tileX, tileY].every(n => Number.isInteger(n) && n >= 0 && n < 32)) {
      skip("outside-map");
      continue;
    }
    const index = tileY * 32 + tileX;
    const ids = activeMatrices.map(matrix => matrixX < matrix.width && matrixY < matrix.height ? matrix.cells[matrixY * matrix.width + matrixX].mapId : -1);
    ensure(ids[activeSeasonIndex] === chunk.chunkId, "Map assignments changed. Reload the map before editing grass.");
    yield {
      index, tileX, tileY,
      variants: [...new Set([chunk.chunkId, ...ids])].map(id => ({
        id, season: id === chunk.chunkId ? undefined : MATRIX_SEASONS[ids.indexOf(id)],
      })),
    };
  }
}

/**
 * Texture packs that must hold newly bound textures: every season of the edited zone's area, and every area whose
 * zones can load one of the edited chunks, since a native chunk can appear in several matrices.
 */
export function texturePacksFor(project: ProjectState, context: MapBrushContext, chunkIds: ReadonlySet<number>) {
  const packs = new Map<number, MatrixSeason>();
  for (const { area, season } of areasFor(project, context, chunkIds)) {
    const id = context.packFor(area, season);
    if (!packs.has(id)) packs.set(id, season);
  }
  return packs;
}

/** Every (area, season) that can draw the chunks: the edited map's area and any other header showing them. */
export function areasFor(project: ProjectState, context: MapBrushContext, chunkIds: ReadonlySet<number>) {
  const { variants, areaBytes, sourceArea } = context;
  const seen = new Set<string>(), areas: { area: number; season: MatrixSeason }[] = [];
  const add = (area: number, season: MatrixSeason) => {
    const key = `${area}:${season}`;
    if (!seen.has(key)) { seen.add(key); areas.push({ area, season }); }
  };
  for (const season of MATRIX_SEASONS) add(sourceArea, season);
  for (const row of Object.values(project.headers?.rows ?? {})) {
    const matrixId = Number(row.matrix_id), area = Number(row.texture_id);
    if (!project.narcs.matrix?.rawFiles[matrixId]?.length || !Number.isInteger(area) || area < 0 || area * 10 + 10 > areaBytes.length) continue;
    for (const [slot, snapshot] of variants(matrixId).entries()) {
      if (!snapshot.cells.some(cell => chunkIds.has(cell.mapId) && (!snapshot.hasHeaders || cell.headerId === row.index || cell.headerId === Number(row.parent_map_id)))) continue;
      add(area, MATRIX_SEASONS[slot]);
    }
  }
  return areas;
}

type GrassPaintTile = GrassSurfaceSelection & { index: number; quad: GrassQuad };

/** Commit native model, permission and texture changes together after all seasonal variants validate. */
export async function paintMapGrass(
  project: ProjectState, scene: Map3dSceneData, tiles: readonly MapGrassTile[], kind: MapGrassKind,
  { surface = "auto", isCurrent = () => true }: GrassStrokeOptions = {},
): Promise<GrassStroke> {
  ensure(kind === "regular" || kind === "dark", "Choose a grass type.");
  const { result, skip } = grassStroke("paint");
  if (!tiles.length) return result;
  const context = await grassContext(project, scene, isCurrent);
  ensure(isCurrent(), "The map changed during the grass stroke. Try the stroke again.");
  const { game, source, rom, maps, textureId } = context;
  const packs = new Map<number, MatrixSeason>();
  const contents = new Map<number, GrassMapBin>();
  const pending = new Map<number, Map<number, GrassPaintTile>>();
  const placements = new Map<number, ReturnType<typeof mapGrassPlacement>>();
  for (const { index, tileX, tileY, variants: targets } of grassDestinations(scene, tiles, context, skip)) {
    const stroke = new Map<number, GrassPaintTile>();
    let failure: { reason: GrassSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of targets) {
      const bytes = maps.rawFiles[id];
      if (!bytes?.length) { failure = { reason: "missing-map", season }; break; }
      let map = contents.get(id);
      if (!map) { map = readGen5MapBin(bytes); contents.set(id, map); }
      const selected = selectGrassSurface(map, index, surface, game);
      if (typeof selected === "string") { failure = { reason: selected, season }; break; }
      const collision = map.files[selected.member], ground = groundStatus(permission(collision, index), kind);
      if (ground === "matching") continue;
      if (ground !== "ground") { failure = { reason: ground, season }; break; }
      if (splitWalkingPlane(collision, index)) { failure = { reason: "split-height", season }; break; }
      if (selected.mirrored) {
        const secondGround = groundStatus(permission(map.files[2], index), kind);
        if (secondGround !== "ground") {
          failure = { reason: secondGround === "matching" ? "existing-grass" : secondGround, season };
          break;
        }
      }
      const heights = grassCorners.map(([u, v]) => gen5HeightAt(collision, index, u, v, game) * 16);
      const placementKey = id * 2 + selected.member;
      let placement = placements.get(placementKey);
      if (!placement) {
        placement = mapGrassPlacement(map.files[0], collision, kind, game);
        placements.set(placementKey, placement);
      }
      const layerLifts = placement(index, gen5HeightAt(collision, index, .5, .5, game) * 16);
      stroke.set(id, { ...selected, index, quad: { x: (tileX - 16) * 16, z: (tileY - 16) * 16, heights, layerLifts } });
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) { skip("already-matching"); continue; }
    for (const [id, edit] of stroke) {
      let edits = pending.get(id);
      if (!edits) { edits = new Map(); pending.set(id, edits); }
      edits.set(grassTileKey(index, edit.member), edit);
    }
    result.count++;
  }
  if (!pending.size) return result;

  for (const [id, season] of texturePacksFor(project, context, new Set(pending.keys()))) packs.set(id, season);
  const stock = stockGrassAssets(source, rom);
  for (const [id, tiles] of pending) {
    const { signature, files, placements } = contents.get(id)!;
    files[1] = files[1].slice();
    if (placements === 3) files[2] = files[2].slice();
    const permissionsBefore = project.mapGrassOriginalPermissions?.[id];
    const permissionsAfter = { ...permissionsBefore };
    const quads: Record<GrassPermissionMember, GrassQuad[]> = { 1: [], 2: [] };
    for (const [key, { index, member, mirrored, quad }] of tiles) {
      const collision = files[member];
      const first = permission(collision, index);
      const original: MapGrassOriginalPermission = { kind, ...first };
      writePermission(collision, index, GRASS_TILE_CLASSES[kind], paintedFlags(first.flags));
      if (mirrored) {
        const second = permission(files[2], index);
        original.secondary = second;
        writePermission(files[2], index, GRASS_TILE_CLASSES[kind], paintedFlags(second.flags));
      }
      permissionsAfter[key] = original;
      quads[member].push(quad);
    }
    for (const member of [1, 2] as const) files[0] = appendMapGrass(files[0], kind, quads[member], stock.materials, member);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), permissionsBefore, permissionsAfter });
  }
  const textureStore = project.narcs.map_textures
    ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
  const names = new Set<string>(GRASS_LAYERS[kind].map(layer => layer.texture));
  const donors = new Map<MatrixSeason, Bank>();
  for (const [id, season] of packs) {
    const before = textureStore.rawFiles[id];
    ensure(before, `Map texture pack ${id} is missing.`);
    let donor = donors.get(season);
    if (!donor) {
      donor = readNitroResources(stock.banks[MATRIX_SEASONS.indexOf(season)]);
      donors.set(season, donor);
    }
    const after = addGrassTextures(before, donor, names);
    if (!equalMapBytes(after, before)) result.textures.push({ id, before: before.slice(), after });
  }
  if (result.textures.length) {
    project.narcs.map_textures = textureStore;
    project.session.fileIds.map_textures = textureId;
  }
  writeGrassStroke(project, result, false);
  return result;
}

function recoverPaintedPermission(source: Uint8Array, current: Uint8Array, index: number, kind: MapGrassKind): Gen5PermissionTileLike | undefined {
  const at = 4 + index * 8;
  const { tileClass, flags } = permission(source, index);
  const after = permission(current, index);
  if (equalMapBytes(source.subarray(at, at + 4), current.subarray(at, at + 4)) &&
      groundStatus({ tileClass, flags }, kind) === "ground" &&
      after.tileClass === GRASS_TILE_CLASSES[kind] && after.flags === paintedFlags(flags)) {
    return { tileClass, flags };
  }
}

function recoverOriginalGrassTile(
  source: GrassMapBin, current: GrassMapBin,
  index: number, member: GrassPermissionMember, kind: MapGrassKind, game: "BW" | "BW2",
): MapGrassOriginalPermission | undefined {
  if (source.placements !== current.placements) return;
  const selected = recoverPaintedPermission(source.files[member], current.files[member], index, kind);
  if (!selected) return;
  const original: MapGrassOriginalPermission = { kind, ...selected };
  if (member === 2 || source.placements === 2 || !sameWalkingPlane(source.files[1], source.files[2], index, game)) return original;

  const at = 4 + index * 8;
  if (equalMapBytes(source.files[2].subarray(at, at + 8), current.files[2].subarray(at, at + 8))) return original;
  const secondary = recoverPaintedPermission(source.files[2], current.files[2], index, kind);
  if (secondary) return { ...original, secondary };
}

type GrassEraseTile = { index: number; member: GrassPermissionMember; original: MapGrassOriginalPermission };

/** Remove the brush-authored layers and restore each affected permission record. */
export async function removeMapGrass(
  project: ProjectState, scene: Map3dSceneData, tiles: readonly MapGrassTile[],
  { surface = "auto", isCurrent = () => true }: GrassStrokeOptions = {},
): Promise<GrassStroke> {
  const { result, skip } = grassStroke("remove");
  if (!tiles.length) return result;
  const context = await grassContext(project, scene, isCurrent);
  ensure(isCurrent(), "The map changed during the grass stroke. Try the stroke again.");
  const { game, maps, rom } = context;
  const pending = new Map<number, Map<number, GrassEraseTile>>();
  const chunks = new Map<number, { bin: GrassMapBin; grass: ReturnType<typeof readPaintedMapGrass> }>();
  const baselines = new Map<number, GrassMapBin | undefined>();
  let sourceMaps: Uint8Array[] | undefined;
  function sourcePermissions(id: number, chunk: NonNullable<ReturnType<typeof chunks.get>>) {
    if (!baselines.has(id)) {
      sourceMaps ??= new NARC(rom.getFileByName(MAPS_PATH)).files;
      let baseline: GrassMapBin | undefined;
      if (sourceMaps[id]?.length) {
        try {
          const original = readGen5MapBin(sourceMaps[id]);
          if (chunk.grass.matchesSourceTerrain(original.files[0])) baseline = original;
        } catch {
          // Legacy recovery requires a readable, matching source chunk.
        }
      }
      baselines.set(id, baseline);
    }
    return baselines.get(id);
  }

  for (const { index, variants } of grassDestinations(scene, tiles, context, skip)) {
    const stroke = new Map<number, GrassEraseTile>();
    let failure: { reason: GrassSkipReason; season?: MatrixSeason } | undefined;
    let usedSource = false;
    for (const { id, season } of variants) {
      const bytes = maps.rawFiles[id];
      if (!bytes?.length) { failure = { reason: "missing-map", season }; break; }
      let chunk = chunks.get(id);
      if (!chunk) {
        const bin = readGen5MapBin(bytes);
        chunk = { bin, grass: readPaintedMapGrass(bin.files[0]) };
        chunks.set(id, chunk);
      }
      const selected = selectGrassSurface(chunk.bin, index, surface, game);
      if (typeof selected === "string") { failure = { reason: selected, season }; break; }
      const { member } = selected;
      const key = grassTileKey(index, member);
      const painted = chunk.grass.tiles.get(key);
      const saved = project.mapGrassOriginalPermissions?.[id]?.[key];
      if (saved && (saved.kind !== painted || (saved.secondary && !selected.mirrored))) {
        failure = { reason: "changed-grass", season };
        break;
      }
      if (!painted) continue;
      if (saved) {
        stroke.set(id, { index, member, original: saved });
        continue;
      }
      const source = sourcePermissions(id, chunk);
      const original = source && recoverOriginalGrassTile(source, chunk.bin, index, member, painted, game);
      if (original) {
        stroke.set(id, { index, member, original });
        usedSource = true;
        continue;
      }
      failure = { reason: "missing-original-permissions", season };
      break;
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) { skip("no-painted-grass"); continue; }
    for (const [id, edit] of stroke) {
      const changes = pending.get(id) ?? new Map<number, GrassEraseTile>();
      changes.set(grassTileKey(index, edit.member), edit);
      pending.set(id, changes);
    }
    result.count++;
    if (usedSource) result.sourceFallbackCount++;
  }

  for (const [id, tiles] of pending) {
    const { bin, grass } = chunks.get(id)!;
    const files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const permissionsBefore = project.mapGrassOriginalPermissions?.[id];
    const permissions = { ...permissionsBefore };
    for (const [key, { index, member, original }] of tiles) {
      writePermission(files[member], index, original.tileClass, original.flags);
      if (original.secondary) writePermission(files[2], index, original.secondary.tileClass, original.secondary.flags);
      delete permissions[key];
    }
    files[0] = grass.remove(new Set(tiles.keys()));
    const permissionsAfter = Object.keys(permissions).length ? permissions : undefined;
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), permissionsBefore, permissionsAfter });
  }
  if (result.count) writeGrassStroke(project, result, false);
  return result;
}

function writeGrassStroke(project: ProjectState, stroke: GrassStroke, undo: boolean) {
  for (const [name, changes] of [["maps", stroke.maps], ["map_textures", stroke.textures]] as const) {
    for (const { id, before, after } of changes) {
      const store = project.narcs[name]!;
      store.rawFiles[id] = (undo ? before : after).slice();
      store.records.delete(id);
      markDirty(project, name, id);
    }
  }
  const originals = { ...project.mapGrassOriginalPermissions };
  for (const { id, permissionsBefore, permissionsAfter } of stroke.maps) {
    const permissions = undo ? permissionsBefore : permissionsAfter;
    if (permissions) originals[id] = permissions;
    else delete originals[id];
  }
  project.mapGrassOriginalPermissions = Object.keys(originals).length ? originals : undefined;
  if (stroke.textures.length) invalidateMap3dAssets();
  const action = stroke.action === "remove" ? "Removed grass from" : "Painted grass on";
  recordGenericChange(project, "maps3d", `${undo ? "Undid a grass edit on" : action} ${stroke.count} tile${stroke.count === 1 ? "" : "s"}.`,
    stroke.action === "remove" ? "Remove Grass" : "Add Grass");
}

export function undoMapGrass(project: ProjectState, stroke: GrassStroke) {
  if (!stroke.count) return;
  for (const [name, changes] of [["maps", stroke.maps], ["map_textures", stroke.textures]] as const) {
    const store = project.narcs[name];
    ensure(!changes.length || (store && changes.every(({ id, after }) => store.rawFiles[id] && equalMapBytes(store.rawFiles[id], after))), "Map resources changed after this grass stroke.");
  }
  ensure(stroke.maps.every(change => project.mapGrassOriginalPermissions?.[change.id] === change.permissionsAfter),
    "The saved original permissions changed after this grass stroke.");
  writeGrassStroke(project, stroke, true);
}

/** Re-apply a stroke that undoMapGrass took back, as long as nothing changed those maps since. */
export function redoMapGrass(project: ProjectState, stroke: GrassStroke) {
  if (!stroke.count) return;
  for (const [name, changes] of [["maps", stroke.maps], ["map_textures", stroke.textures]] as const) {
    const store = project.narcs[name];
    ensure(!changes.length || (store && changes.every(({ id, before }) => store.rawFiles[id] && equalMapBytes(store.rawFiles[id], before))), "Map resources changed after this grass stroke was undone.");
  }
  ensure(stroke.maps.every(change => project.mapGrassOriginalPermissions?.[change.id] === change.permissionsBefore),
    "The saved original permissions changed after this grass stroke was undone.");
  writeGrassStroke(project, stroke, false);
}
