import { toS16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, packGameFreakContainer, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { appendBrushPieces, brushPieceKey, MERGED_PIECE_PAYLOAD, nativeFaces, readBrushPieces, rootIsIdentity, writeTileBrush, type BrushKind, type BrushPart, type BrushPiece, type BrushVertex } from "./mapBrushGeometry";
import { mapBrushContext, texturePacksFor } from "./mapGrass";
import { clipBetween } from "./mapNativeErase";
import { donorSeasonBanks, stampBindings } from "./mapStamps";
import { addNativeTextures, brushDestinations, cornerHeights, snapGround, TREE_TILE, treeSite, type MapTreeOriginalTile, type TreeSkipReason } from "./mapTrees";
import type { Gen5PermissionTileLike } from "./gen5PermissionModel";
import { ensure } from "./nitroResourceWriter";
import { createNarcStore, type ProjectState } from "./projectStore";
import type { MatrixSeason } from "./seasonalMatrixModel";
import { countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission, type BrushStrokeKind, type BrushStroke } from "./mapBrushStroke";

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
/** `turnedEnds`: the game's end piece carries the start of a turn, so connected fences offer straight ends. */
export type MapFenceType = { id: string; label: string; materials: readonly string[]; donors: readonly FenceDonor[]; turnedEnds?: true };

/** Black 2 / White 2 fences. Order matters: placed fences store their catalog index. */
export const MAP_FENCE_TYPES: readonly MapFenceType[] = [
  { id: "striaton-fence", label: "Striaton fence", materials: ["c01saku", "saku01a"],
    donors: [
      { axis: "x", map: 10, area: 6, box: [-160, 16, 165, 175], faces: 6, start: 6, length: 11, across: 26 } ] },
  { id: "pointy-white-fence", label: "Pointy white fence", materials: ["saku01a"], turnedEnds: true,
    donors: [
      { axis: "x", map: 64, area: 42, box: [-112, -16, -216, -206], faces: 6, start: 9, length: 6, across: 2 },
      { axis: "z", map: 66, area: 42, box: [192, 205, 19, 80], faces: 18, start: 17, length: 4, across: 28 } ] },
  { id: "orange-fence", label: "Orange fence", materials: ["out07saku"], turnedEnds: true,
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
type Slope = [number, number];
/**
 * `faceSlopes`, per face of each piece, overrides the part's `slope`: a rail clipped from one long face continues its
 * own texture, while a post the game repeats on every tile keeps the same coordinates.
 */
type FencePart = { part: BrushPart; start: FencePiece; middle: FencePiece; end: FencePiece; slope: Slope; period: [number, number]; donorStart: number; donorEnd: number;
  faceSlopes?: Record<"start" | "middle" | "end", Slope[]> };

/** A piece's faces with their texture moved `steps` tiles along the run. */
function continuePiece(faces: FencePiece, steps: number, part: FencePart, role: "start" | "middle" | "end"): FencePiece {
  return faces.map((face, i) => {
    const slope = part.faceSlopes?.[role][i] ?? part.slope;
    const shift = [0, 1].map(axis => continueTexture(steps * slope[axis], part.period[axis]));
    if (!shift[0] && !shift[1]) return face;
    return face.map(vertex => {
      if (vertex.texcoord === undefined) return vertex;
      const [s, t] = texcoordParts(vertex.texcoord);
      return { ...vertex, texcoord: packTexcoord(s + shift[0], t + shift[1]) };
    });
  });
}
export type FenceTemplate = { type: MapFenceType; axis: FenceAxis; parts: FencePart[] };

const texcoordParts = (texcoord: number) => [toS16(texcoord), toS16(texcoord >>> 16)] as const;
const packTexcoord = (s: number, t: number) => (((Math.round(s) & 0xffff) | ((Math.round(t) & 0xffff) << 16)) >>> 0);
const s10 = (value: number) => (value << 22) >> 22;

/**
 * How far a tile's texture coordinates move to continue the run's texture. They keep running along the run, as the
 * game's long fence faces do, so neighbouring tiles can be drawn as one face; only a shift that nears the edge of the
 * coordinate range is brought back by whole texture repeats.
 */
export function continueTexture(raw: number, period: number) {
  return period && Math.abs(raw) > 12288 ? raw - Math.round(raw / period) * period : raw;
}

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
  // Clipped faces with the index of the native face each came from.
  const cutTagged = (faces: readonly Face[], t: number, open: "before" | "after" | "none") => {
    const out: Face[] = [], sources: number[] = [];
    faces.forEach((face, source) => { for (const piece of cut([face], t, open)) { out.push(piece); sources.push(source); } });
    return { faces: out, sources };
  };
  const positionKey = (v: BrushVertex) => v.position.map(n => n.toFixed(2)).join(",");
  const parts = native.map((source): FencePart => {
    const midTagged = cutTagged(source.faces, middle, "none");
    const startTagged = donor.openStart ? midTagged : cutTagged(source.faces, 0, "before");
    const endTagged = donor.openEnd ? midTagged : cutTagged(source.faces, last, "after");
    const mid = midTagged.faces, start = startTagged.faces, end = endTagged.faces;
    // Each middle face's texture step per tile: compare it with the same face cut from the next tile. Start and end
    // faces cut from the same native face take its step; faces of their own (an end post) keep their coordinates.
    const midSlopes: Slope[] = mid.map(() => [0, 0]);
    if (donor.length >= 4) {
      const next = cut(source.faces, middle + 1, "none");
      mid.forEach((face, i) => {
        const shape = face.map(positionKey).sort().join("|");
        const match = next.find(other => other.length === face.length && other.map(positionKey).sort().join("|") === shape);
        if (!match) return;
        const later = new Map(match.map(v => [positionKey(v), v.texcoord]));
        const deltas = face.flatMap(v => {
          const other = later.get(positionKey(v));
          if (v.texcoord === undefined || other === undefined) return [];
          const [a, b] = texcoordParts(v.texcoord), [c, d] = texcoordParts(other);
          return [[c - a, d - b]];
        });
        if (deltas.length === face.length && deltas.every(([s, t]) => Math.abs(s - deltas[0][0]) <= 2 && Math.abs(t - deltas[0][1]) <= 2)) midSlopes[i] = [deltas[0][0], deltas[0][1]];
      });
    }
    const bySource = new Map<number, Slope>();
    midTagged.sources.forEach((source, i) => { if (!bySource.has(source)) bySource.set(source, midSlopes[i]); });
    const slopesOf = (tagged: { sources: number[] }): Slope[] => tagged.sources.map(source => bySource.get(source) ?? [0, 0]);
    const faceSlopes = { start: donor.openStart ? midSlopes : slopesOf(startTagged), middle: midSlopes, end: donor.openEnd ? midSlopes : slopesOf(endTagged) };
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
    return { part: { ...source, faces: [] }, start, middle: mid, end, slope, period: [w * 16, h * 16], donorStart: donor.openStart ? middle : 0, donorEnd: donor.openEnd ? middle : last, faceSlopes };
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
      parts: template.parts.map((fencePart) => ({
        ...fencePart.part,
        faces: Array.from({ length }, (_, k) => {
          const { start, middle, end, donorStart, donorEnd } = fencePart;
          const [piece, donorIndex, role] = k === 0 ? [start, donorStart, "start" as const] : k === length - 1 ? [end, donorEnd, "end" as const] : [middle, Math.min(1, donorEnd), "middle" as const];
          // Continue the texture along the run.
          const ox = (tileX - 16) * TILE + (axis === "x" ? k * TILE : 0), oz = (tileY - 16) * TILE + (axis === "z" ? k * TILE : 0);
          return continuePiece(piece, k - donorIndex, fencePart, role).map(face => face.map(vertex =>
            ({ ...vertex, position: [ox + vertex.position[0], ground + vertex.position[1], oz + vertex.position[2]] as const })));
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
export type FenceStroke = BrushStroke<"place" | "remove", FenceSkipReason, ChunkFenceOriginals>;

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
export async function placeMapFence(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], typeId: string, { isCurrent = () => true, allowBlocked = false }: { isCurrent?: () => boolean; allowBlocked?: boolean } = {}): Promise<FenceStroke> {
  const type = MAP_FENCE_TYPES.find(entry => entry.id === typeId);
  ensure(type && project.session.baseRom === "BW2", "Choose a fence for this game.");
  const { result, skip } = startBrushStroke<FenceStroke>(emptyBrushStroke("place"));
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
    const site = treeSite(map, covered, game, { allowBlocked });
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
  writeBrushStroke(project, FENCES, result, false);
  return result;
}

/** Remove brush-drawn fences that cover any of the given tiles, restoring the tiles they replaced. */
export async function removeMapFences(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<FenceStroke> {
  const { result, skip } = startBrushStroke<FenceStroke>(emptyBrushStroke("remove"));
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
  if (result.count) writeBrushStroke(project, FENCES, result, false);
  return result;
}

const FENCES: BrushStrokeKind<FenceStroke> = {
  originals: "mapFenceOriginalPermissions",
  thing: "fence",
  counted: countedAs("fence"),
  actions: { place: { done: "Drew", label: "Draw Fence" }, remove: { done: "Removed", label: "Remove Fences" } },
};

export const undoMapFences = (project: ProjectState, stroke: FenceStroke) => undoBrushStroke(project, FENCES, stroke);
export const redoMapFences = (project: ProjectState, stroke: FenceStroke) => redoBrushStroke(project, FENCES, stroke);

// ---------- Connected fences ----------

/**
 * Fences drawn tile by tile that join up: each fenced tile looks at its four neighbours (same fence, same chunk) and
 * draws a straight run, an end with its end post, a corner, a T or a cross. Drawing an L, U or closed square makes
 * the turns corners, and a new stretch drawn next to an old one connects to it. Painting or erasing a tile rebuilds
 * its neighbours. Texture coordinates follow the tile's position, so runs stay continuous whatever their shape.
 */
export const FENCE_TILE_BRUSH: BrushKind = { prefixes: { 1: "w1_", 2: "w2_" }, magic: 0x79, tool: "fence brush" };

/** Both directions' templates and where each run's line sits inside its tile (z for east–west runs, x for north–south ones). */
export type FenceKit = { type: MapFenceType; x: FenceTemplate; z: FenceTemplate; lineX: number; lineZ: number };
type Neighbours = { north: boolean; south: boolean; west: boolean; east: boolean };

function lineOf(template: FenceTemplate, axis: 0 | 2) {
  const values = template.parts.flatMap(part => part.middle.flat().map(vertex => vertex.position[axis]));
  return values.length ? (Math.min(...values) + Math.max(...values)) / 2 : TILE / 2;
}

export function fenceKit(type: MapFenceType, x: FenceTemplate, z: FenceTemplate): FenceKit {
  return { type, x, z, lineX: lineOf(x, 2), lineZ: lineOf(z, 0) };
}

/**
 * How a fence ends where it stops: "corner" keeps the game's own end piece, which for several fences carries the stub
 * of a turn; "straight" keeps only what lies in line with the run (its rails and posts), so the fence just stops.
 */
export type FenceEnds = "corner" | "straight";
const STRAIGHT_ENDS = 1 << 18;
const fenceTilePayload = (tileIndex: number, type: MapFenceType, ends: FenceEnds) =>
  tileIndex | ((MAP_FENCE_TYPES.indexOf(type) + 1) << 10) | (ends === "straight" ? STRAIGHT_ENDS : 0);

/** Drop the faces of an end piece that leave the band the run's middle tiles occupy across it. */
function inLine(faces: FencePiece, template: FenceTemplate): FencePiece {
  const across = template.axis === "x" ? 2 : 0;
  const values = template.parts.flatMap(part => part.middle.flat().map(vertex => vertex.position[across]));
  if (!values.length) return faces;
  const lo = Math.min(...values) - 0.5, hi = Math.max(...values) + 0.5;
  return faces.filter(face => face.every(vertex => vertex.position[across] >= lo && vertex.position[across] <= hi));
}

/** One fenced tile, in chunk units. */
export function fenceTilePiece(kit: FenceKit, tileIndex: number, ground: number, near: Neighbours, ends: FenceEnds = "corner"): BrushPiece {
  const tileX = tileIndex % 32, tileY = Math.floor(tileIndex / 32);
  const ox = (tileX - 16) * TILE, oz = (tileY - 16) * TILE;
  const alongX = near.west || near.east, alongZ = near.north || near.south;
  // Which pieces each part draws: [template, piece, donor tile index, clip range along the run].
  // Which faces each part draws, with its texture continued to this tile along the run.
  type Pick = { template: FenceTemplate; take: (part: FencePart) => Face[] };
  const picks: Pick[] = [];
  const run = (template: FenceTemplate, before: boolean, after: boolean, range?: [number, number]) => {
    const axis = template.axis === "x" ? 0 : 2, along = template.axis === "x" ? tileX : tileY;
    picks.push({ template, take: part => {
      const start = () => continuePiece(part.start, along - part.donorStart, part, "start");
      const end = () => continuePiece(part.end, along - part.donorEnd, part, "end");
      const native = before && after ? continuePiece(part.middle, along - Math.min(1, part.donorEnd), part, "middle") : after ? start() : before ? end()
        : [...start().flatMap(face => clipBetween(face, axis, -1e6, TILE / 2)), ...end().flatMap(face => clipBetween(face, axis, TILE / 2, 1e6))];
      const piece = ends === "straight" && !(before && after) ? inLine(native, template) : native;
      return range ? piece.flatMap(face => clipBetween(face, axis, range[0], range[1])) : piece;
    } });
  };
  if (alongX && alongZ) {
    // A corner, T or cross: each connected side's half of the straight run, meeting where the two lines cross.
    if (near.west) run(kit.x, true, true, [-1e6, kit.lineZ]);
    if (near.east) run(kit.x, true, true, [kit.lineZ, 1e6]);
    if (near.north) run(kit.z, true, true, [-1e6, kit.lineX]);
    if (near.south) run(kit.z, true, true, [kit.lineX, 1e6]);
  } else if (alongZ) run(kit.z, near.north, near.south);
  else run(kit.x, near.west, near.east);
  const parts = new Map<string, BrushPart>();
  for (const { template, take } of picks) {
    for (const part of template.parts) {
      const placed = take(part).map(face => face.map((vertex): BrushVertex =>
        ({ ...vertex, position: [ox + vertex.position[0], ground + vertex.position[1], oz + vertex.position[2]] })));
      const existing = parts.get(part.part.record.name);
      if (existing) existing.faces.push(...placed);
      else parts.set(part.part.record.name, { ...part.part, faces: placed });
    }
  }
  return { payload: fenceTilePayload(tileIndex, kit.type, ends), parts: [...parts.values()].filter(part => part.faces.length) };
}

export function readPlacedFenceTiles(file: Uint8Array) {
  const read = readBrushPieces(file, FENCE_TILE_BRUSH);
  const tiles = new Map<number, { type?: MapFenceType; key: number; ends: FenceEnds }>();
  for (const [key, { payload, member }] of read.pieces) {
    if (member === 1 && payload !== MERGED_PIECE_PAYLOAD) tiles.set(payload & 1023, { type: MAP_FENCE_TYPES[((payload >>> 10) & 255) - 1], key, ends: payload & STRAIGHT_ENDS ? "straight" : "corner" });
  }
  return { tiles, remove: read.remove };
}

const neighbourTiles = (index: number) => ({
  north: index >= 32 ? index - 32 : undefined, south: index < 992 ? index + 32 : undefined,
  west: index % 32 ? index - 1 : undefined, east: index % 32 < 31 ? index + 1 : undefined,
});

/**
 * Redraw a chunk's fence tiles after `changed` tiles change, so every tile joins the fence around it. The whole
 * chunk's fence is written again with its faces merged across tiles (`writeTileBrush`).
 */
export function rebuildFenceTiles(model: Uint8Array, collision: Uint8Array, after: ReadonlyMap<number, string>, changed: ReadonlySet<number>,
  kits: ReadonlyMap<string, FenceKit>, game: "BW" | "BW2", straight: ReadonlySet<number> = new Set()) {
  void changed;
  const pieces: BrushPiece[] = [];
  for (const index of [...after.keys()].sort((a, b) => a - b)) {
    const typeId = after.get(index);
    if (!typeId) continue;
    const kit = kits.get(typeId);
    ensure(kit, "Missing fence template.");
    const near = neighbourTiles(index);
    const joined = Object.fromEntries((["north", "south", "west", "east"] as const).map(side => [side, near[side] !== undefined && after.get(near[side]!) === typeId])) as Neighbours;
    pieces.push(fenceTilePiece(kit!, index, snapGround(cornerHeights(collision, index, game)[0]), joined, straight.has(index) ? "straight" : "corner"));
  }
  return writeTileBrush(model, FENCE_TILE_BRUSH, pieces);
}

type FenceTileOriginal = Gen5PermissionTileLike & { type: string; secondary?: Gen5PermissionTileLike };
type ChunkFenceTileOriginals = Record<number, FenceTileOriginal>;
export type MapFenceTileOriginals = Record<number, ChunkFenceTileOriginals>;
export type FenceTileStroke = BrushStroke<"paint" | "erase", FenceSkipReason, ChunkFenceTileOriginals>;

/** Draw or erase fence tiles. Drawing over the same fence with the other end style restyles those tiles. */
export async function strokeFenceTiles(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], typeId: string | undefined, { isCurrent = () => true, allowBlocked = false, ends = "corner" }: { isCurrent?: () => boolean; allowBlocked?: boolean; ends?: FenceEnds } = {}): Promise<FenceTileStroke> {
  const { result, skip } = startBrushStroke<FenceTileStroke>(emptyBrushStroke(typeId ? "paint" : "erase"));
  if (!tiles.length) return result;
  const type = typeId ? MAP_FENCE_TYPES.find(entry => entry.id === typeId) : undefined;
  ensure(project.session.baseRom === "BW2" && (!typeId || type), "Choose a fence for this game.");
  const context = await mapBrushContext(project, scene, isCurrent, "fence");
  ensure(isCurrent(), "The map changed while drawing the fence. Try again.");
  const { game, source, rom, maps, textureId } = context;
  type Chunk = { bin: ReturnType<typeof readGen5MapBin>; fenced: Map<number, string>; straight: Set<number>; changed: Set<number>; originals: ChunkFenceTileOriginals };
  const chunks = new Map<number, Chunk>();
  const chunk = (id: number) => {
    let entry = chunks.get(id);
    if (!entry) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      const placed = readPlacedFenceTiles(bin.files[0]);
      entry = { bin, fenced: new Map([...placed.tiles].flatMap(([index, tile]) => tile.type ? [[index, tile.type.id] as const] : [])),
        straight: new Set([...placed.tiles].flatMap(([index, tile]) => tile.ends === "straight" ? [index] : [])), changed: new Set(), originals: { ...project.mapFenceTileOriginals?.[id] } };
      chunks.set(id, entry);
    }
    return entry;
  };
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    if (variants.some(({ id }) => !maps.rawFiles[id]?.length)) { skip("missing-map"); continue; }
    const current = chunk(variants[0].id);
    if (type) {
      if (current.fenced.get(tileIndex) === type.id) {
        // The same fence: only its end style can change.
        if (current.straight.has(tileIndex) === (ends === "straight")) continue;
        for (const { id } of variants) {
          const entry = chunk(id);
          if (entry.fenced.get(tileIndex) !== type.id) continue;
          if (ends === "straight") entry.straight.add(tileIndex);
          else entry.straight.delete(tileIndex);
          entry.changed.add(tileIndex);
        }
        result.count++;
        continue;
      }
      let failure: { reason: FenceSkipReason; season?: MatrixSeason } | undefined;
      for (const { id, season } of variants) {
        const { bin, fenced } = chunk(id);
        if (fenced.has(tileIndex)) { failure = { reason: "occupied", season }; break; }
        const site = treeSite(bin, [tileIndex], game, { allowBlocked });
        if (typeof site === "string") { failure = { reason: site, season }; break; }
      }
      if (failure) { skip(failure.reason, failure.season); continue; }
      for (const { id } of variants) {
        const entry = chunk(id), files = entry.bin.files;
        const original: FenceTileOriginal = { type: type.id, ...permission(files[1], tileIndex) };
        if (entry.bin.placements === 3) original.secondary = permission(files[2], tileIndex);
        entry.originals[tileIndex] = original;
        entry.fenced.set(tileIndex, type.id);
        if (ends === "straight") entry.straight.add(tileIndex);
        else entry.straight.delete(tileIndex);
        entry.changed.add(tileIndex);
      }
      result.count++;
    } else {
      if (!current.fenced.has(tileIndex)) continue;
      let failure: { reason: FenceSkipReason; season?: MatrixSeason } | undefined;
      for (const { id, season } of variants) {
        const entry = chunk(id);
        if (!entry.fenced.has(tileIndex)) continue;
        const saved = entry.originals[tileIndex];
        if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
        if (saved.type !== entry.fenced.get(tileIndex)) { failure = { reason: "changed-fence", season }; break; }
      }
      if (failure) { skip(failure.reason, failure.season); continue; }
      for (const { id } of variants) {
        const entry = chunk(id);
        if (!entry.fenced.has(tileIndex)) continue;
        entry.fenced.delete(tileIndex);
        entry.straight.delete(tileIndex);
        entry.changed.add(tileIndex);
      }
      result.count++;
    }
  }
  const touched = [...chunks].filter(([, entry]) => entry.changed.size);
  if (!touched.length) return result;

  // Templates for every fence in the rebuilt chunks, both directions each: a chunk's fence is written whole.
  const kits = new Map<string, FenceKit>();
  const banksById = new Map<string, ReturnType<typeof donorSeasonBanks>[]>();
  const needed = new Set<string>();
  for (const [, entry] of touched) for (const id of entry.fenced.values()) needed.add(id);
  for (const id of needed) {
    const fence = MAP_FENCE_TYPES.find(entry => entry.id === id);
    ensure(fence, `Unknown fence ${id}.`);
    const x = fenceAssets(source, rom, fence!, "x", game), z = fenceAssets(source, rom, fence!, "z", game);
    kits.set(id, fenceKit(fence!, x.template, z.template));
    banksById.set(id, [x.banks, z.banks]);
  }
  if (type) {
    // Textures are copied before the pieces so a renamed copy is what the pieces bind to.
    const textureStore = project.narcs.map_textures
      ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
    const kit = kits.get(type.id)!, [xBanks, zBanks] = banksById.get(type.id)!;
    const records = [...new Map([...kit.x.parts, ...kit.z.parts].map(part => [part.part.record.name, part.part.record])).values()];
    const packs = [...texturePacksFor(project, context, new Set(touched.map(([id]) => id)))].map(([id, season]) => {
      const bytes = textureStore.rawFiles[id];
      ensure(bytes, `Map texture pack ${id} is missing.`);
      return { id, season, bytes, bank: readNitroResources(bytes), donor: xBanks[season] };
    });
    const bound = stampBindings(records, packs);
    const renamed = new Map(records.map((record, i) => [record.name, bound[i].record]));
    const rebind = (template: FenceTemplate): FenceTemplate => ({ ...template, parts: template.parts.map(part => ({ ...part, part: { ...part.part, record: renamed.get(part.part.record.name) ?? part.part.record } })) });
    kits.set(type.id, { ...kit, x: rebind(kit.x), z: rebind(kit.z) });
    for (const { id, season, bytes } of packs) {
      let after = addNativeTextures(bytes, xBanks[season], bound.map(entry => entry.binding));
      if (zBanks !== xBanks) after = addNativeTextures(after, zBanks[season], bound.map(entry => entry.binding));
      if (!equalMapBytes(after, bytes)) result.textures.push({ id, before: bytes.slice(), after });
    }
    if (result.textures.length) {
      project.narcs.map_textures = textureStore;
      project.session.fileIds.map_textures = textureId;
    }
  }

  for (const [id, entry] of touched) {
    const files = entry.bin.files.slice();
    files[1] = files[1].slice();
    if (entry.bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapFenceTileOriginals?.[id];
    for (const index of entry.changed) {
      const saved = entry.originals[index];
      if (entry.fenced.has(index)) {
        writePermission(files[1], index, TREE_TILE);
        if (entry.bin.placements === 3) writePermission(files[2], index, TREE_TILE);
      } else if (saved) {
        writePermission(files[1], index, saved);
        if (saved.secondary) writePermission(files[2], index, saved.secondary);
        delete entry.originals[index];
      }
    }
    files[0] = rebuildFenceTiles(files[0], files[1], entry.fenced, entry.changed, kits, game, entry.straight);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(entry.bin.signature, files), originalsBefore,
      originalsAfter: Object.keys(entry.originals).length ? entry.originals : undefined });
  }
  writeBrushStroke(project, FENCE_TILES, result, false);
  return result;
}

const FENCE_TILES: BrushStrokeKind<FenceTileStroke> = {
  originals: "mapFenceTileOriginals",
  thing: "fence",
  counted: countedAs("fence tile"),
  actions: { paint: { done: "Drew", label: "Draw Fence" }, erase: { done: "Erased", label: "Erase Fence" } },
};

export const undoFenceTiles = (project: ProjectState, stroke: FenceTileStroke) => undoBrushStroke(project, FENCE_TILES, stroke);
export const redoFenceTiles = (project: ProjectState, stroke: FenceTileStroke) => redoBrushStroke(project, FENCE_TILES, stroke);
