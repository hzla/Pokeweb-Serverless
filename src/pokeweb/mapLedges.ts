import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, packGameFreakContainer, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { appendBrushPieces, brushPieceKey, nativeFaces, readBrushPieces, rootIsIdentity, type BrushKind, type BrushPart, type BrushVertex } from "./mapBrushGeometry";
import { mapBrushContext, texturePacksFor } from "./mapGrass";
import { addNativeTextures, brushDestinations, snapGround, treeSite, type MapTreeOriginalTile, type TreeSkipReason } from "./mapTrees";
import { ensure } from "./nitroResourceWriter";
import { createNarcStore, type ProjectState } from "./projectStore";
import { type MatrixSeason } from "./seasonalMatrixModel";
import { countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission, type BrushStrokeKind, type BrushStroke } from "./mapBrushStroke";

/**
 * One-way ledges. Each direction is cut from one vanilla ledge (the user's own source ROM): its first tile, one
 * middle tile and its last tile. A drawn ledge of any length is the first tile, the middle repeated, and the last.
 * The art is the single non-seasonal dansa01a texture, and the tiles get the native jump class with the blocked flag.
 */
export type LedgeDirection = "left" | "right" | "up" | "down";
export const LEDGE_DIRECTIONS: readonly LedgeDirection[] = ["left", "right", "up", "down"];
/** Native jump classes: the player hops in this direction over the ledge. */
export const LEDGE_CLASSES: Readonly<Record<LedgeDirection, number>> = { right: 114, left: 115, up: 116, down: 117 };
const LEDGE_FLAGS = 0x1;
const MATERIAL = "dansa01a";
const TEXTURE_PACK = 2;
const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";
const TILE = 16;
export const LEDGE_BRUSH: BrushKind = { prefixes: { 1: "l1_", 2: "l2_" }, magic: 0x7d, tool: "ledge brush" };
export const MIN_LEDGE_LENGTH = 2;
export const MAX_LEDGE_LENGTH = 32;

export type LedgeDonor = { map: number; tileX: number; tileY: number; length: number; faces: number };
/** Vanilla ledges, by game. Left in BW2 is Route 19's (zone 437); BW has no Route 19. */
export const LEDGE_DONORS: Record<"BW" | "BW2", Record<LedgeDirection, LedgeDonor>> = {
  BW2: {
    left: { map: 282, tileX: 16, tileY: 16, length: 4, faces: 18 },
    right: { map: 98, tileX: 1, tileY: 10, length: 4, faces: 14 },
    up: { map: 65, tileX: 11, tileY: 21, length: 5, faces: 14 },
    down: { map: 8, tileX: 6, tileY: 16, length: 5, faces: 14 },
  },
  BW: {
    left: { map: 21, tileX: 26, tileY: 6, length: 4, faces: 14 },
    right: { map: 98, tileX: 1, tileY: 10, length: 4, faces: 14 },
    up: { map: 65, tileX: 11, tileY: 21, length: 5, faces: 14 },
    down: { map: 8, tileX: 6, tileY: 16, length: 5, faces: 14 },
  },
};

/** A ledge runs along z (a column) when the player hops left or right, along x (a row) when hopping up or down. */
const alongZ = (direction: LedgeDirection) => direction === "left" || direction === "right";

/** Positions in a ledge template: [along the ledge within its tile, height above ground, across from the ledge tile's edge]. */
type LedgePieces = { start: BrushPart; middle: BrushPart; end: BrushPart };
export type LedgeTemplate = { direction: LedgeDirection; pieces: LedgePieces };

function toLocal(vertex: BrushVertex, along: number, across: number, ground: number, z: boolean): BrushVertex {
  const [x, y, w] = vertex.position;
  return { ...vertex, position: z ? [w - along, y - ground, x - across] : [x - along, y - ground, w - across] };
}

/** Cut the first, a middle and the last tile of a vanilla ledge. */
export function cutLedge(donorModel: Uint8Array, direction: LedgeDirection, donor: LedgeDonor, ground: number): LedgeTemplate {
  const changed = `The source ROM's ${direction} ledge (map ${donor.map}) is not the vanilla ledge.`;
  ensure(rootIsIdentity(donorModel), changed);
  const z = alongZ(direction);
  const [part] = nativeFaces(donorModel, [MATERIAL], "ledge brush");
  ensure(part, changed);
  const along0 = ((z ? donor.tileY : donor.tileX) - 16) * TILE, across0 = ((z ? donor.tileX : donor.tileY) - 16) * TILE;
  const n = donor.length;
  const faces = part.faces.map(face => face.map(vertex => toLocal(vertex, along0, across0, ground, z)))
    .filter(face => face.every(({ position: [a, , c] }) => a >= -0.01 && a <= n * TILE + 0.01 && c >= -TILE && c <= 2 * TILE));
  ensure(faces.reduce((total, face) => total + face.length - 2, 0) === donor.faces, changed);
  const tileOf = (face: BrushVertex[]) => [Math.min(...face.map(v => v.position[0])) / TILE, Math.max(...face.map(v => v.position[0])) / TILE];
  const eps = 1e-3;
  const start = faces.filter(face => tileOf(face)[1] <= 1 + eps);
  const end = faces.filter(face => tileOf(face)[0] >= n - 1 - eps)
    .map(face => face.map(v => ({ ...v, position: [v.position[0] - (n - 1) * TILE, v.position[1], v.position[2]] as const })));
  const middleFaces = faces.filter(face => { const [lo, hi] = tileOf(face); return lo >= 1 - eps && hi <= n - 1 + eps && hi > 1 + eps; });
  ensure(start.length && end.length && middleFaces.length && start.length + end.length + middleFaces.length === faces.length, changed);
  // One middle tile. A middle drawn per tile gives it directly; a middle drawn as one long strip is cut back to its
  // first tile, moving each far vertex to the tile's edge with its texture coordinate interpolated.
  const middle = middleFaces.every(face => tileOf(face)[1] - tileOf(face)[0] <= 1 + eps)
    ? middleFaces.filter(face => tileOf(face)[0] <= 1 + eps)
    : middleFaces.map(face => face.map(vertex => {
      if (vertex.position[0] <= TILE + eps) return vertex;
      const partner = face.find(other => other.position[0] <= TILE + eps && Math.abs(other.position[1] - vertex.position[1]) < eps && Math.abs(other.position[2] - vertex.position[2]) < eps);
      ensure(partner && vertex.texcoord !== undefined && partner.texcoord !== undefined, changed);
      const span = (vertex.position[0] - partner.position[0]) / TILE;
      const s = (value: number) => (value << 16) >> 16;
      const u = s(partner.texcoord) + Math.round((s(vertex.texcoord) - s(partner.texcoord)) / span);
      return { ...vertex, position: [2 * TILE, vertex.position[1], vertex.position[2]] as const, texcoord: ((vertex.texcoord & 0xffff0000) | (u & 0xffff)) >>> 0 };
    }));
  const shift = (list: BrushVertex[][], by: number) => list.map(face => face.map(v => ({ ...v, position: [v.position[0] - by, v.position[1], v.position[2]] as const })));
  const piece = (list: BrushVertex[][]) => ({ ...part, faces: list });
  return { direction, pieces: { start: piece(start), middle: piece(shift(middle, TILE)), end: piece(end) } };
}

export type LedgePlacement = { startIndex: number; length: number; ground: number; template: LedgeTemplate };

const ledgePayload = (startIndex: number, length: number, direction: LedgeDirection) =>
  startIndex | ((length - 1) << 10) | (LEDGE_DIRECTIONS.indexOf(direction) << 15);

/** The tiles a ledge covers, first to last. */
export function ledgeTiles(startIndex: number, length: number, direction: LedgeDirection) {
  const step = alongZ(direction) ? 32 : 1;
  return Array.from({ length }, (_, i) => startIndex + i * step);
}

export function appendMapLedges(modelFile: Uint8Array, ledges: readonly LedgePlacement[], member: 1 | 2 = 1) {
  return appendBrushPieces(modelFile, LEDGE_BRUSH, ledges.map(({ startIndex, length, ground, template }) => {
    const { direction, pieces } = template, z = alongZ(direction);
    const tileX = startIndex % 32, tileY = Math.floor(startIndex / 32);
    const along0 = ((z ? tileY : tileX) - 16) * TILE, across0 = ((z ? tileX : tileY) - 16) * TILE;
    const faces = (piece: BrushPart, tile: number) => piece.faces.map(face => face.map(vertex => {
      const [a, y, c] = vertex.position, along = along0 + tile * TILE + a, across = across0 + c;
      return { ...vertex, position: (z ? [across, ground + y, along] : [along, ground + y, across]) as [number, number, number] };
    }));
    const byTile = Array.from({ length }, (_, tile) => faces(tile === 0 ? pieces.start : tile === length - 1 ? pieces.end : pieces.middle, tile));
    return { payload: ledgePayload(startIndex, length, direction), parts: [{ ...pieces.start, faces: byTile.flat() }] };
  }), member);
}

export type PlacedLedge = { member: 1 | 2; startIndex: number; length: number; direction: LedgeDirection };

export function readPlacedLedges(file: Uint8Array) {
  const read = readBrushPieces(file, LEDGE_BRUSH);
  const ledges = new Map<number, PlacedLedge>();
  for (const [key, { member, payload }] of read.pieces) {
    ledges.set(key, { member, startIndex: payload & 1023, length: ((payload >>> 10) & 31) + 1, direction: LEDGE_DIRECTIONS[(payload >>> 15) & 3] });
  }
  return { ledges, remove: read.remove };
}

// ---------- Strokes ----------

export type MapLedgeOriginal = { direction: LedgeDirection; tiles: MapTreeOriginalTile[] };
type ChunkLedgeOriginals = Record<number, MapLedgeOriginal>;
export type MapLedgeOriginalPermissions = Record<number, ChunkLedgeOriginals>;
export type LedgeSkipReason = TreeSkipReason | "too-short" | "no-placed-ledge" | "changed-ledge";
export type LedgeStroke = BrushStroke<"place" | "remove", LedgeSkipReason, ChunkLedgeOriginals>;

const stockLedges = new WeakMap<Uint8Array, { templates: Map<LedgeDirection, LedgeTemplate>; bank?: ReturnType<typeof readNitroResources> }>();

function ledgeTemplate(source: Uint8Array, rom: NintendoDSRom, direction: LedgeDirection, game: "BW" | "BW2") {
  let cache = stockLedges.get(source);
  if (!cache) { cache = { templates: new Map() }; stockLedges.set(source, cache); }
  let template = cache.templates.get(direction);
  if (!template) {
    const donor = LEDGE_DONORS[game][direction];
    const bytes = new NARC(rom.getFileByName(MAPS_PATH)).files[donor.map];
    ensure(bytes?.length, `The source ROM is missing the ${direction} ledge's donor map.`);
    const files = extractGameFreakContainer(bytes).files;
    const ground = snapGround(gen5HeightAt(files[1], donor.tileY * 32 + donor.tileX, 0, 0, game) * 16);
    template = cutLedge(files[0], direction, donor, ground);
    cache.templates.set(direction, template);
  }
  if (!cache.bank) {
    const pack = new NARC(rom.getFileByName(MAP_TEXTURES_PATH)).files[TEXTURE_PACK];
    ensure(pack?.length, "The source ROM is missing the ledge texture.");
    cache.bank = readNitroResources(pack);
  }
  return { template, bank: cache.bank };
}

/**
 * Draw a ledge over a straight run of tiles (a column for left/right, a row for up/down). Every seasonal variant of
 * the chunk gets it, and each texture pack that can draw the chunk gets the ledge texture if it lacks it.
 */
export async function placeMapLedge(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], direction: LedgeDirection, { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<LedgeStroke> {
  ensure(LEDGE_DIRECTIONS.includes(direction), "Choose a ledge direction.");
  const { result, skip } = startBrushStroke<LedgeStroke>(emptyBrushStroke("place"));
  if (!tiles.length) return result;
  const first = tiles[0], z = alongZ(direction);
  const run = tiles.filter(tile => tile.matrixX === first.matrixX && tile.matrixY === first.matrixY && (z ? tile.tileX === first.tileX : tile.tileY === first.tileY));
  const along = run.map(tile => z ? tile.tileY : tile.tileX);
  const lo = Math.min(...along), length = Math.max(...along) - lo + 1;
  if (length < MIN_LEDGE_LENGTH) { skip("too-short"); return result; }
  const anchor = z ? { ...first, tileY: lo } : { ...first, tileX: lo };
  const context = await mapBrushContext(project, scene, isCurrent, "ledge");
  ensure(isCurrent(), "The map changed while drawing the ledge. Try again.");
  const { game, source, rom, maps, textureId } = context;
  const { template, bank } = ledgeTemplate(source, rom, direction, game);
  const [destination] = brushDestinations(scene, [anchor], context, skip);
  if (!destination) return result;
  const covered = ledgeTiles(destination.tileIndex, length, direction);
  const sites: { id: number; ground: number; mirrored: boolean; map: ReturnType<typeof readGen5MapBin> }[] = [];
  for (const { id, season } of destination.variants) {
    const bytes = maps.rawFiles[id];
    if (!bytes?.length) { skip("missing-map", season); return result; }
    const map = readGen5MapBin(bytes);
    const site = treeSite(map, covered, game);
    if (typeof site === "string") { skip(site, season); return result; }
    sites.push({ id, map, ...site });
  }
  for (const { id, ground, mirrored, map } of sites) {
    const { signature, files } = map;
    files[1] = files[1].slice();
    if (mirrored) files[2] = files[2].slice();
    const original: MapLedgeOriginal = { direction, tiles: [] };
    const tile = { tileClass: LEDGE_CLASSES[direction], flags: LEDGE_FLAGS };
    for (const index of covered) {
      const saved: MapTreeOriginalTile = { index, ...permission(files[1], index) };
      writePermission(files[1], index, tile);
      if (mirrored) { saved.secondary = permission(files[2], index); writePermission(files[2], index, tile); }
      original.tiles.push(saved);
    }
    files[0] = appendMapLedges(files[0], [{ startIndex: destination.tileIndex, length, ground, template }], 1);
    const originalsBefore = project.mapLedgeOriginalPermissions?.[id];
    const key = brushPieceKey(ledgePayload(destination.tileIndex, length, direction), 1);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), originalsBefore, originalsAfter: { ...originalsBefore, [key]: original } });
  }
  result.count = 1;
  const textureStore = project.narcs.map_textures
    ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
  for (const [id] of texturePacksFor(project, context, new Set(sites.map(site => site.id)))) {
    const before = textureStore.rawFiles[id];
    ensure(before, `Map texture pack ${id} is missing.`);
    const after = addNativeTextures(before, bank, [template.pieces.start.record]);
    if (!equalMapBytes(after, before)) result.textures.push({ id, before: before.slice(), after });
  }
  if (result.textures.length) {
    project.narcs.map_textures = textureStore;
    project.session.fileIds.map_textures = textureId;
  }
  writeBrushStroke(project, LEDGES, result, false);
  return result;
}

/** Remove brush-drawn ledges that cover any of the given tiles, restoring the tiles they replaced. */
export async function removeMapLedges(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<LedgeStroke> {
  const { result, skip } = startBrushStroke<LedgeStroke>(emptyBrushStroke("remove"));
  if (!tiles.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "ledge");
  ensure(isCurrent(), "The map changed while removing ledges. Try again.");
  const { maps } = context;
  const chunks = new Map<number, { bin: ReturnType<typeof readGen5MapBin>; placed: ReturnType<typeof readPlacedLedges> }>();
  const read = (id: number) => {
    let chunk = chunks.get(id);
    if (!chunk) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      chunk = { bin, placed: readPlacedLedges(bin.files[0]) };
      chunks.set(id, chunk);
    }
    return chunk;
  };
  const pending = new Map<number, Map<number, MapLedgeOriginal>>();
  const done = new Set<string>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    if (!maps.rawFiles[variants[0].id]?.length) { skip("missing-map"); continue; }
    const found = [...read(variants[0].id).placed.ledges].find(([, ledge]) => ledgeTiles(ledge.startIndex, ledge.length, ledge.direction).includes(tileIndex));
    if (!found) continue;
    const [key] = found;
    const doneKey = `${variants.map(v => v.id).join(",")}:${key}`;
    if (done.has(doneKey)) continue;
    done.add(doneKey);
    const stroke = new Map<number, MapLedgeOriginal>();
    let failure: { reason: LedgeSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      if (!maps.rawFiles[id]?.length) { failure = { reason: "missing-map", season }; break; }
      const placed = read(id).placed.ledges.get(key);
      if (!placed) continue;
      const saved = project.mapLedgeOriginalPermissions?.[id]?.[key];
      if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
      if (saved.direction !== placed.direction) { failure = { reason: "changed-ledge", season }; break; }
      stroke.set(id, saved);
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) continue;
    for (const [id, original] of stroke) pending.set(id, (pending.get(id) ?? new Map()).set(key, original));
    result.count++;
  }
  for (const [id, ledges] of pending) {
    const { bin, placed } = chunks.get(id)!;
    const files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapLedgeOriginalPermissions?.[id];
    const originals = { ...originalsBefore };
    for (const [key, { tiles: saved }] of ledges) {
      for (const tile of saved) {
        writePermission(files[1], tile.index, tile);
        if (tile.secondary) writePermission(files[2], tile.index, tile.secondary);
      }
      delete originals[key];
    }
    files[0] = placed.remove(new Set(ledges.keys()));
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), originalsBefore, originalsAfter: Object.keys(originals).length ? originals : undefined });
  }
  if (result.count) writeBrushStroke(project, LEDGES, result, false);
  return result;
}

const LEDGES: BrushStrokeKind<LedgeStroke> = {
  originals: "mapLedgeOriginalPermissions",
  thing: "ledge",
  counted: countedAs("ledge"),
  actions: { place: { done: "Drew", label: "Draw Ledge" }, remove: { done: "Removed", label: "Remove Ledges" } },
};

export const undoMapLedges = (project: ProjectState, stroke: LedgeStroke) => undoBrushStroke(project, LEDGES, stroke);
export const redoMapLedges = (project: ProjectState, stroke: LedgeStroke) => redoBrushStroke(project, LEDGES, stroke);

