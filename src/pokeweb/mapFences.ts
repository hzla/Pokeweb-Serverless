import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, invalidateMap3dAssets, packGameFreakContainer, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { appendBrushPieces, brushPieceKey, nativeFaces, readBrushPieces, rootIsIdentity, type BrushKind, type BrushPart, type BrushVertex } from "./mapBrushGeometry";
import { mapBrushContext, texturePacksFor } from "./mapGrass";
import { clipBetween } from "./mapNativeErase";
import { donorSeasonBanks, stampBindings } from "./mapStamps";
import { addNativeTextures, brushDestinations, permission, snapGround, TREE_TILE, treeSite, writePermission, type MapTreeOriginalTile, type TreeSkipReason } from "./mapTrees";
import { ensure } from "./nitroResourceWriter";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";
import type { MatrixSeason } from "./seasonalMatrixModel";

/**
 * Fences and railings, drawn as a straight line like ledges. Each fence is cut from a vanilla run in the user's own
 * source ROM: its first tile, one middle tile and its last tile. A drawn fence is the first tile, the middle
 * repeated, and the last; texture coordinates continue along the run the way the donor's long faces do, so a
 * texture stretched over several tiles keeps flowing. A fence the game only draws in one direction is turned a
 * quarter turn for the other. Every tile of the line blocks movement.
 */
export type FenceAxis = "x" | "z";
/** `box` is [x0, x1, z0, z1] around the run's faces; `start` and `length` are its tiles along the axis, `across` the tile it stands in. An open end runs into the next chunk, so the middle tile stands in for it. */
export type FenceDonor = { axis: FenceAxis; map: number; area: number; box: readonly [number, number, number, number]; faces: number; start: number; length: number; across: number; openStart?: boolean; openEnd?: boolean };
export type MapFenceType = { id: string; label: string; materials: readonly string[]; donors: readonly FenceDonor[] };

/** Black 2 / White 2 fences. Order matters: placed fences store their catalog index. */
export const MAP_FENCE_TYPES: readonly MapFenceType[] = [
  { id: "striaton-fence", label: "Striaton fence", materials: ["c01saku", "saku01a"],
    donors: [
      { axis: "x", map: 10, area: 6, box: [-160, 16, 165, 175], faces: 6, start: 6, length: 11, across: 26 } ] },
  { id: "pointy-white-fence", label: "Pointy white fence", materials: ["saku01a"],
    donors: [
      { axis: "x", map: 64, area: 42, box: [-112, -16, -216, -206], faces: 6, start: 9, length: 6, across: 2 },
      { axis: "z", map: 66, area: 42, box: [192, 205, 19, 80], faces: 18, start: 17, length: 4, across: 28 } ] },
  { id: "orange-fence", label: "Orange fence", materials: ["out07saku"],
    donors: [
      { axis: "x", map: 41, area: 26, box: [-208, -112, 115, 125], faces: 6, start: 3, length: 6, across: 23 },
      { axis: "z", map: 41, area: 26, box: [64, 77, 40, 125], faces: 12, start: 18, length: 6, across: 20 } ] },
  { id: "metal-railing", label: "Metal railing", materials: ["out09_tesuri"],
    donors: [
      { axis: "x", map: 49, area: 34, box: [64, 191.922, 182.625, 186], faces: 4, start: 20, length: 8, across: 27 } ] },
  { id: "airport-fence", label: "Airport fence", materials: ["fence_01"],
    donors: [
      { axis: "x", map: 57, area: 38, box: [144, 256, -73, -71], faces: 8, start: 25, length: 7, across: 11, openEnd: true },
      { axis: "z", map: 57, area: 38, box: [-185, -183, -256, 256], faces: 28, start: 0, length: 32, across: 4, openStart: true, openEnd: true } ] },
  { id: "silver-fence", label: "Silver fence", materials: ["c8_fence_b"],
    donors: [
      { axis: "x", map: 75, area: 50, box: [-256, -144, -57, -55], faces: 4, start: 0, length: 7, across: 12, openStart: true },
      { axis: "z", map: 76, area: 50, box: [39, 41, -128, 256], faces: 4, start: 8, length: 24, across: 18, openEnd: true } ] },
  { id: "dark-fence", label: "Dark fence", materials: ["t2_saku01"],
    donors: [
      { axis: "z", map: 5, area: 2, box: [51, 61, 160, 256], faces: 6, start: 26, length: 6, across: 19, openEnd: true } ] },
  { id: "blue-railing", label: "Blue railing", materials: ["c12_tesuri"],
    donors: [
      { axis: "x", map: 279, area: 210, box: [-32, 128, 54.625, 58], faces: 4, start: 14, length: 10, across: 19 } ] },
  { id: "white-railing", label: "White railing", materials: ["c12_tesuri02"],
    donors: [
      { axis: "z", map: 280, area: 210, box: [-204, -200, -3, 50], faces: 10, start: 15, length: 4, across: 3 } ] },
  { id: "wooden-fence", label: "Wooden fence", materials: ["saku"],
    donors: [
      { axis: "z", map: 284, area: 214, box: [-13, -3, 0, 192], faces: 12, start: 16, length: 12, across: 15 } ] },
  { id: "brown-fence", label: "Brown and grey fence", materials: ["c13_saku01"],
    donors: [
      { axis: "x", map: 296, area: 218, box: [-192, 16, -253, -243], faces: 6, start: 4, length: 13, across: 0 },
      { axis: "z", map: 296, area: 218, box: [243, 253, -104, 208], faces: 6, start: 9, length: 20, across: 31 } ] },
];

export function mapFenceTypes(game: string | undefined) {
  return game === "BW2" ? MAP_FENCE_TYPES : [];
}

export const FENCE_BRUSH: BrushKind = { prefixes: { 1: "f1_", 2: "f2_" }, magic: 0x7a, tool: "fence brush" };
export const MIN_FENCE_LENGTH = 2;
const TILE = 16;
const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";

type Face = BrushVertex[];
/** One tile of fence, in the drawn axis's frame: positions relative to the tile's top-left corner and the ground. */
type FencePiece = Face[];
/** Per material: the start, middle and end tiles, and how far its texture coordinates move per tile along the run. */
type FencePart = { part: BrushPart; start: FencePiece; middle: FencePiece; end: FencePiece; slope: [number, number]; period: [number, number]; donorStart: number; donorEnd: number };
export type FenceTemplate = { type: MapFenceType; axis: FenceAxis; parts: FencePart[] };

const s16 = (value: number) => (value << 16) >> 16;
const texcoordParts = (texcoord: number) => [s16(texcoord), s16(texcoord >>> 16)] as const;
const packTexcoord = (s: number, t: number) => (((Math.round(s) & 0xffff) | ((Math.round(t) & 0xffff) << 16)) >>> 0);
const s10 = (value: number) => (value << 22) >> 22;

/** A quarter turn about y of a piece in its tile: x→z turns clockwise ((x, z) → (16 − z, x)), z→x anticlockwise. */
function turnPiece(faces: FencePiece, to: FenceAxis): FencePiece {
  return faces.map(face => face.map(vertex => {
    const [x, y, z] = vertex.position;
    const position = (to === "z" ? [TILE - z, y, x] : [z, y, TILE - x]) as [number, number, number];
    if (vertex.normal === undefined) return { ...vertex, position };
    const nx = s10(vertex.normal), ny = s10(vertex.normal >>> 10), nz = s10(vertex.normal >>> 20);
    const [mx, mz] = to === "z" ? [-nz, nx] : [nz, -nx];
    const clamp = (n: number) => Math.max(-512, Math.min(511, n)) & 1023;
    return { ...vertex, position, normal: (clamp(mx) | (clamp(ny) << 10) | (clamp(mz) << 20)) >>> 0 };
  }));
}

/** Cut the first, a middle and the last tile of a vanilla run, and measure how its textures run along it. */
export function cutFence(donorModel: Uint8Array, type: MapFenceType, donor: FenceDonor, ground: number, textureSize: (name: string | undefined) => [number, number]): FenceTemplate {
  const changed = `The source ROM's ${type.label.toLowerCase()} (map ${donor.map}) is not the vanilla fence.`;
  ensure(rootIsIdentity(donorModel), changed);
  const [bx0, bx1, bz0, bz1] = donor.box, slack = 1.5, axis = donor.axis === "x" ? 0 : 2;
  const inside = (face: Face) => face.every(({ position: [x, , z] }) => x >= bx0 - slack && x <= bx1 + slack && z >= bz0 - slack && z <= bz1 + slack);
  const native = nativeFaces(donorModel, type.materials, "fence brush").map(part => ({ ...part, faces: part.faces.filter(inside) })).filter(part => part.faces.length);
  ensure(native.reduce((total, part) => total + part.faces.reduce((sum, face) => sum + face.length - 2, 0), 0) === donor.faces, changed);
  const acrossOrigin = (donor.across - 16) * TILE;
  // Positions relative to tile `t` of the run (its index along the axis) and the ground.
  const local = (faces: readonly Face[], t: number) => faces.map(face => face.map(vertex => {
    const along0 = (donor.start + t - 16) * TILE, [x, y, z] = vertex.position;
    return { ...vertex, position: (donor.axis === "x" ? [x - along0, y - ground, z - acrossOrigin] : [x - acrossOrigin, y - ground, z - along0]) as [number, number, number] };
  }));
  const tileRange = (t: number, open: "before" | "after" | "none") => {
    const lo = (donor.start + t - 16) * TILE;
    return [open === "before" ? -1e6 : lo, open === "after" ? 1e6 : lo + TILE] as const;
  };
  const cut = (faces: readonly Face[], t: number, open: "before" | "after" | "none") => {
    const [lo, hi] = tileRange(t, open);
    return local(faces.flatMap(face => clipBetween(face, axis, lo, hi)), t);
  };
  const last = donor.length - 1, middle = Math.min(1, last);
  const parts = native.map((source): FencePart => {
    const mid = cut(source.faces, middle, "none");
    const start = donor.openStart ? mid : cut(source.faces, 0, "before");
    const end = donor.openEnd ? mid : cut(source.faces, last, "after");
    // Texture slope per tile: the same vertex one tile further along, where the run is long enough to show it.
    let slope: [number, number] = [0, 0];
    if (donor.length >= 4) {
      const next = cut(source.faces, middle + 1, "none");
      const key = (v: BrushVertex) => v.position.map(n => n.toFixed(2)).join(",");
      const later = new Map(next.flat().map(v => [key(v), v.texcoord]));
      const deltas = mid.flat().flatMap(v => {
        const other = later.get(key(v));
        if (v.texcoord === undefined || other === undefined) return [];
        const [a, b] = texcoordParts(v.texcoord), [c, d] = texcoordParts(other);
        return [[c - a, d - b]];
      });
      if (deltas.length && deltas.every(([s, t]) => Math.abs(s - deltas[0][0]) <= 2 && Math.abs(t - deltas[0][1]) <= 2)) slope = [deltas[0][0], deltas[0][1]];
    }
    const [w, h] = textureSize(source.record.textureName);
    return { part: { ...source, faces: [] }, start, middle: mid, end, slope, period: [w * 16, h * 16], donorStart: donor.openStart ? middle : 0, donorEnd: donor.openEnd ? middle : last };
  });
  return { type, axis: donor.axis, parts };
}

/** The template for drawing along `axis`: the donor that runs that way, or the other one turned. */
export function fenceForAxis(template: FenceTemplate, axis: FenceAxis): FenceTemplate {
  if (template.axis === axis) return template;
  return { ...template, axis, parts: template.parts.map(part => ({ ...part, start: turnPiece(part.start, axis), middle: turnPiece(part.middle, axis), end: turnPiece(part.end, axis) })) };
}

export type FencePlacement = { startIndex: number; length: number; ground: number; template: FenceTemplate };

const fencePayload = (startIndex: number, length: number, axis: FenceAxis, type: MapFenceType) =>
  startIndex | ((length - 1) << 10) | ((axis === "z" ? 1 : 0) << 15) | ((MAP_FENCE_TYPES.indexOf(type) + 1) << 16);

/** The tiles a fence covers, first to last. */
export function fenceTiles(startIndex: number, length: number, axis: FenceAxis) {
  const step = axis === "z" ? 32 : 1;
  return Array.from({ length }, (_, i) => startIndex + i * step);
}

export function appendMapFences(modelFile: Uint8Array, fences: readonly FencePlacement[], member: 1 | 2 = 1) {
  return appendBrushPieces(modelFile, FENCE_BRUSH, fences.map(({ startIndex, length, ground, template }) => {
    const { axis } = template, tileX = startIndex % 32, tileY = Math.floor(startIndex / 32);
    return {
      payload: fencePayload(startIndex, length, axis, template.type),
      parts: template.parts.map(({ part, start, middle, end, slope, period, donorStart, donorEnd }) => ({
        ...part,
        faces: Array.from({ length }, (_, k) => {
          const [piece, donorIndex] = k === 0 ? [start, donorStart] : k === length - 1 ? [end, donorEnd] : [middle, Math.min(1, donorEnd)];
          // Continue the texture along the run, moved by whole repeats so the numbers stay small.
          const shift = [0, 1].map(i => { const raw = (k - donorIndex) * slope[i]; return period[i] ? raw - Math.round(raw / period[i]) * period[i] : raw; });
          const ox = (tileX - 16) * TILE + (axis === "x" ? k * TILE : 0), oz = (tileY - 16) * TILE + (axis === "z" ? k * TILE : 0);
          return piece.map(face => face.map(vertex => {
            const moved: BrushVertex = { ...vertex, position: [ox + vertex.position[0], ground + vertex.position[1], oz + vertex.position[2]] };
            if (vertex.texcoord !== undefined && (shift[0] || shift[1])) {
              const [s, t] = texcoordParts(vertex.texcoord);
              moved.texcoord = packTexcoord(s + shift[0], t + shift[1]);
            }
            return moved;
          }));
        }).flat(),
      })),
    };
  }), member);
}

export type PlacedFence = { type?: MapFenceType; member: 1 | 2; startIndex: number; length: number; axis: FenceAxis };

export function readPlacedFences(file: Uint8Array) {
  const read = readBrushPieces(file, FENCE_BRUSH);
  const fences = new Map<number, PlacedFence>();
  for (const [key, { member, payload }] of read.pieces) {
    fences.set(key, { type: MAP_FENCE_TYPES[((payload >>> 16) & 255) - 1], member, startIndex: payload & 1023, length: ((payload >>> 10) & 31) + 1, axis: (payload >>> 15) & 1 ? "z" : "x" });
  }
  return { fences, remove: read.remove };
}

// ---------- Strokes ----------

export type MapFenceOriginal = { type: string; tiles: MapTreeOriginalTile[] };
type ChunkFenceOriginals = Record<number, MapFenceOriginal>;
export type MapFenceOriginalPermissions = Record<number, ChunkFenceOriginals>;
export type FenceSkipReason = TreeSkipReason | "too-short" | "changed-fence";
type MapChange = { id: number; before: Uint8Array; after: Uint8Array };
type FenceMapChange = MapChange & { originalsBefore?: ChunkFenceOriginals; originalsAfter?: ChunkFenceOriginals };
export type FenceStroke = { action: "place" | "remove"; maps: FenceMapChange[]; textures: MapChange[]; count: number; skipped: number; skipReasons: { reason: FenceSkipReason; count: number; season?: MatrixSeason }[] };

function fenceStroke(action: FenceStroke["action"]) {
  const result: FenceStroke = { action, maps: [], textures: [], count: 0, skipped: 0, skipReasons: [] };
  return {
    result,
    skip(reason: FenceSkipReason, season?: MatrixSeason) {
      result.skipped++;
      const group = result.skipReasons.find(entry => entry.reason === reason && entry.season === season);
      if (group) group.count++;
      else result.skipReasons.push({ reason, count: 1, ...(season ? { season } : {}) });
    },
  };
}

type FenceAssets = { template: FenceTemplate; banks: ReturnType<typeof donorSeasonBanks> };
const stockFences = new WeakMap<Uint8Array, Map<string, FenceAssets>>();

/** The template for drawing along `axis`, cut from the donor that runs that way when there is one. */
function fenceAssets(source: Uint8Array, rom: NintendoDSRom, type: MapFenceType, axis: FenceAxis, game: "BW" | "BW2"): FenceAssets {
  let cache = stockFences.get(source);
  if (!cache) { cache = new Map(); stockFences.set(source, cache); }
  const donor = type.donors.find(entry => entry.axis === axis) ?? type.donors[0];
  const key = `${type.id}:${donor.axis}`;
  let assets = cache.get(key);
  if (!assets) {
    const bytes = new NARC(rom.getFileByName(MAPS_PATH)).files[donor.map];
    ensure(bytes?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s donor map.`);
    const files = extractGameFreakContainer(bytes).files;
    const ground = snapGround(gen5HeightAt(files[1], (donor.axis === "x" ? donor.across * 32 + donor.start : donor.start * 32 + donor.across), 0, 0, game) * 16);
    const names = nativeFaces(files[0], type.materials, "fence brush").map(part => part.record.textureName).filter((name): name is string => !!name);
    const banks = donorSeasonBanks(rom, game, donor.area, names, type.label);
    const size = (name: string | undefined): [number, number] => {
      const texture = name ? banks.spring.textures.find(t => t.name === name) : undefined;
      return texture ? [texture.params.width(), texture.params.height()] : [0, 0];
    };
    assets = { template: cutFence(files[0], type, donor, ground, size), banks };
    cache.set(key, assets);
  }
  return { ...assets, template: fenceForAxis(assets.template, axis) };
}

/** Draw a fence over a straight run of tiles along the drag's main direction. */
export async function placeMapFence(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], typeId: string, { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<FenceStroke> {
  const type = MAP_FENCE_TYPES.find(entry => entry.id === typeId);
  ensure(type && project.session.baseRom === "BW2", "Choose a fence for this game.");
  const { result, skip } = fenceStroke("place");
  if (!tiles.length) return result;
  const first = tiles[0];
  const run = tiles.filter(tile => tile.matrixX === first.matrixX && tile.matrixY === first.matrixY);
  const sameRow = run.every(tile => tile.tileY === first.tileY), sameColumn = run.every(tile => tile.tileX === first.tileX);
  const axis: FenceAxis = sameRow && !sameColumn ? "x" : sameColumn && !sameRow ? "z" : "x";
  const along = run.map(tile => axis === "x" ? tile.tileX : tile.tileY);
  const lo = Math.min(...along), length = Math.max(...along) - lo + 1;
  if (length < MIN_FENCE_LENGTH) { skip("too-short"); return result; }
  const anchor = axis === "x" ? { ...first, tileX: lo } : { ...first, tileY: lo };
  const context = await mapBrushContext(project, scene, isCurrent, "fence");
  ensure(isCurrent(), "The map changed while drawing the fence. Try again.");
  const { game, source, rom, maps, textureId } = context;
  const { template, banks } = fenceAssets(source, rom, type!, axis, game);
  const [destination] = brushDestinations(scene, [anchor], context, skip);
  if (!destination) return result;
  const covered = fenceTiles(destination.tileIndex, length, axis);
  const sites: { id: number; ground: number; mirrored: boolean; map: ReturnType<typeof readGen5MapBin> }[] = [];
  for (const { id, season } of destination.variants) {
    const bytes = maps.rawFiles[id];
    if (!bytes?.length) { skip("missing-map", season); return result; }
    const map = readGen5MapBin(bytes);
    const site = treeSite(map, covered, game);
    if (typeof site === "string") { skip(site, season); return result; }
    sites.push({ id, map, ...site });
  }

  const textureStore = project.narcs.map_textures
    ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
  const packs = [...texturePacksFor(project, context, new Set(sites.map(site => site.id)))].map(([id, season]) => {
    const bytes = textureStore.rawFiles[id];
    ensure(bytes, `Map texture pack ${id} is missing.`);
    return { id, season, bytes, bank: readNitroResources(bytes), donor: banks[season] };
  });
  const bound = stampBindings(template.parts.map(entry => entry.part.record), packs);
  const placed: FenceTemplate = { ...template, parts: template.parts.map((entry, i) => ({ ...entry, part: { ...entry.part, record: bound[i].record } })) };

  for (const { id, ground, mirrored, map } of sites) {
    const { signature, files } = map;
    files[1] = files[1].slice();
    if (mirrored) files[2] = files[2].slice();
    const original: MapFenceOriginal = { type: type!.id, tiles: [] };
    for (const index of covered) {
      const saved: MapTreeOriginalTile = { index, ...permission(files[1], index) };
      writePermission(files[1], index, TREE_TILE);
      if (mirrored) { saved.secondary = permission(files[2], index); writePermission(files[2], index, TREE_TILE); }
      original.tiles.push(saved);
    }
    files[0] = appendMapFences(files[0], [{ startIndex: destination.tileIndex, length, ground, template: placed }], 1);
    const originalsBefore = project.mapFenceOriginalPermissions?.[id];
    const key = brushPieceKey(fencePayload(destination.tileIndex, length, axis, type!), 1);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), originalsBefore, originalsAfter: { ...originalsBefore, [key]: original } });
  }
  result.count = 1;
  for (const { id, season, bytes } of packs) {
    const after = addNativeTextures(bytes, banks[season], bound.map(entry => entry.binding));
    if (!equalMapBytes(after, bytes)) result.textures.push({ id, before: bytes.slice(), after });
  }
  if (result.textures.length) {
    project.narcs.map_textures = textureStore;
    project.session.fileIds.map_textures = textureId;
  }
  writeFenceStroke(project, result, false);
  return result;
}

/** Remove brush-drawn fences that cover any of the given tiles, restoring the tiles they replaced. */
export async function removeMapFences(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<FenceStroke> {
  const { result, skip } = fenceStroke("remove");
  if (!tiles.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "fence");
  ensure(isCurrent(), "The map changed while removing fences. Try again.");
  const { maps } = context;
  const chunks = new Map<number, { bin: ReturnType<typeof readGen5MapBin>; placed: ReturnType<typeof readPlacedFences> }>();
  const read = (id: number) => {
    let chunk = chunks.get(id);
    if (!chunk) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      chunk = { bin, placed: readPlacedFences(bin.files[0]) };
      chunks.set(id, chunk);
    }
    return chunk;
  };
  const pending = new Map<number, Map<number, MapFenceOriginal>>();
  const done = new Set<string>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    if (!maps.rawFiles[variants[0].id]?.length) { skip("missing-map"); continue; }
    const found = [...read(variants[0].id).placed.fences].find(([, fence]) => fenceTiles(fence.startIndex, fence.length, fence.axis).includes(tileIndex));
    if (!found) continue;
    const [key] = found;
    const doneKey = `${variants.map(v => v.id).join(",")}:${key}`;
    if (done.has(doneKey)) continue;
    done.add(doneKey);
    const stroke = new Map<number, MapFenceOriginal>();
    let failure: { reason: FenceSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      if (!maps.rawFiles[id]?.length) { failure = { reason: "missing-map", season }; break; }
      const placed = read(id).placed.fences.get(key);
      if (!placed) continue;
      const saved = project.mapFenceOriginalPermissions?.[id]?.[key];
      if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
      if (saved.type !== placed.type?.id) { failure = { reason: "changed-fence", season }; break; }
      stroke.set(id, saved);
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) continue;
    for (const [id, original] of stroke) pending.set(id, (pending.get(id) ?? new Map()).set(key, original));
    result.count++;
  }
  for (const [id, fences] of pending) {
    const { bin, placed } = chunks.get(id)!;
    const files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapFenceOriginalPermissions?.[id];
    const originals = { ...originalsBefore };
    for (const [key, { tiles: saved }] of fences) {
      for (const tile of saved) {
        writePermission(files[1], tile.index, tile);
        if (tile.secondary) writePermission(files[2], tile.index, tile.secondary);
      }
      delete originals[key];
    }
    files[0] = placed.remove(new Set(fences.keys()));
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), originalsBefore, originalsAfter: Object.keys(originals).length ? originals : undefined });
  }
  if (result.count) writeFenceStroke(project, result, false);
  return result;
}

function writeFenceStroke(project: ProjectState, stroke: FenceStroke, undo: boolean) {
  for (const [name, changes] of [["maps", stroke.maps], ["map_textures", stroke.textures]] as const) {
    for (const { id, before, after } of changes) {
      const store = project.narcs[name]!;
      store.rawFiles[id] = (undo ? before : after).slice();
      store.records.delete(id);
      markDirty(project, name, id);
    }
  }
  const originals = { ...project.mapFenceOriginalPermissions };
  for (const { id, originalsBefore, originalsAfter } of stroke.maps) {
    const next = undo ? originalsBefore : originalsAfter;
    if (next) originals[id] = next;
    else delete originals[id];
  }
  project.mapFenceOriginalPermissions = Object.keys(originals).length ? originals : undefined;
  if (stroke.textures.length) invalidateMap3dAssets();
  const noun = `${stroke.count} fence${stroke.count === 1 ? "" : "s"}`;
  recordGenericChange(project, "maps3d", undo ? `Undid a fence edit (${noun}).` : stroke.action === "remove" ? `Removed ${noun}.` : `Drew ${noun}.`,
    stroke.action === "remove" ? "Remove Fences" : "Draw Fence");
}

function assertStoresMatch(project: ProjectState, stroke: FenceStroke, side: "before" | "after", message: string) {
  for (const [name, changes] of [["maps", stroke.maps], ["map_textures", stroke.textures]] as const) {
    const store = project.narcs[name];
    ensure(!changes.length || (store && changes.every(change => store.rawFiles[change.id] && equalMapBytes(store.rawFiles[change.id], change[side]))), message);
  }
}

export function undoMapFences(project: ProjectState, stroke: FenceStroke) {
  if (!stroke.count) return;
  assertStoresMatch(project, stroke, "after", "Map resources changed after this fence edit.");
  ensure(stroke.maps.every(change => project.mapFenceOriginalPermissions?.[change.id] === change.originalsAfter), "The saved fence tiles changed after this fence edit.");
  writeFenceStroke(project, stroke, true);
}

export function redoMapFences(project: ProjectState, stroke: FenceStroke) {
  if (!stroke.count) return;
  assertStoresMatch(project, stroke, "before", "Map resources changed after this fence edit was undone.");
  ensure(stroke.maps.every(change => project.mapFenceOriginalPermissions?.[change.id] === change.originalsBefore), "The saved fence tiles changed after this fence edit was undone.");
  writeFenceStroke(project, stroke, false);
}
