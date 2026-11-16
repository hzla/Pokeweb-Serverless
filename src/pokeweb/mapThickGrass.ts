import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import type { Gen5PermissionTileLike } from "./gen5PermissionModel";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, packGameFreakContainer, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { MERGED_PIECE_PAYLOAD, nativeFaces, readBrushPieces, rootIsIdentity, stepTextures, textureSteps, writeTileBrush, type BrushKind, type BrushPart, type BrushPiece, type BrushVertex, type TextureStep } from "./mapBrushGeometry";
import { mapBrushContext, texturePacksFor } from "./mapGrass";
import { clipBetween } from "./mapNativeErase";
import { donorSeasonBanks, stampBindings } from "./mapStamps";
import { addNativeTextures, brushDestinations, cornerHeights, snapGround, treeSite, type TreeSkipReason } from "./mapTrees";
import { ensure } from "./nitroResourceWriter";
import { createNarcStore, type ProjectState } from "./projectStore";
import { type MatrixSeason } from "./seasonalMatrixModel";
import { countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission, type BrushStrokeKind, type BrushStroke } from "./mapBrushStroke";

/**
 * Thick grass (the tall "nagakusa" patches). Natively a patch is a raised mat of grass: a flat top a little above the
 * ground and a skirt of blades around its outline. The brush rebuilds that per tile: the top is a flat quad with
 * the game's world-aligned texture coordinates, and each open side gets the skirt cut from one vanilla patch (a
 * straight middle piece, or a corner piece where the outline turns). Painting or erasing a tile rebuilds its four
 * neighbours too, so the outline always wraps the painted area.
 */
export const THICK_GRASS_BRUSH: BrushKind = { prefixes: { 1: "k1_", 2: "k2_" }, magic: 0x7b, tool: "thick grass brush" };
export type ThickGrassKind = "green" | "teal";
export const THICK_GRASS_KINDS: readonly ThickGrassKind[] = ["green", "teal"];
export const THICK_GRASS: Readonly<Record<ThickGrassKind, { label: string; top: string; side: string; tile: Gen5PermissionTileLike }>> = {
  green: { label: "Thick grass", top: "nagakusa01a", side: "nagakusa01b", tile: { tileClass: 8, flags: 0x24 } },
  teal: { label: "Teal thick grass", top: "nagakusa02a", side: "nagakusa02b", tile: { tileClass: 9, flags: 0x24 } },
};
/** Black 2 / White 2: the teal patch on map 62 (area 38) is a clean 10×8 rectangle; both kinds share its shape. */
const DONOR = { map: 62, area: 38, tileX: 14, tileY: 18, width: 10, depth: 8, sideFaces: 24 } as const;
const TILE = 16;
const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";

type Face = BrushVertex[];
type Side = "north" | "south" | "west" | "east";
const SIDES: readonly Side[] = ["north", "south", "west", "east"];
/**
 * Skirt faces for one tile of one side, relative to that tile's top-left corner and the ground. `steps` (per face)
 * and `origin` (the donor tile each was cut from, along the side) continue the native skirt's texture to any tile.
 */
type Role = "start" | "middle" | "end";
type Segment = { start: Face[]; middle: Face[]; end: Face[]; steps?: Record<Role, TextureStep[]>; origin?: Record<Role, number> };
export type ThickGrassTemplate = {
  kind: ThickGrassKind;
  top: BrushPart; side: BrushPart;
  /** Height of the flat top above the ground, its inset from each open side, and its vertex attributes. */
  height: number; inset: Record<Side, number>; topVertex: Omit<BrushVertex, "position" | "texcoord">;
  edges: Record<Side, Segment>;
};

const boundsOf = (faces: readonly Face[]) => {
  const p = faces.flat().map(v => v.position);
  return { x0: Math.min(...p.map(v => v[0])), x1: Math.max(...p.map(v => v[0])), z0: Math.min(...p.map(v => v[2])), z1: Math.max(...p.map(v => v[2])) };
};
const shift = (faces: readonly Face[], dx: number, dy: number, dz: number) =>
  faces.map(face => face.map(v => ({ ...v, position: [v.position[0] + dx, v.position[1] + dy, v.position[2] + dz] as const })));

/** Cut the skirt pieces and read the top's height and insets from the vanilla patch. */
export function cutThickGrass(donorModel: Uint8Array, kind: ThickGrassKind, ground: number): ThickGrassTemplate {
  const changed = `The source ROM's thick grass patch (map ${DONOR.map}) is not the vanilla patch.`;
  ensure(rootIsIdentity(donorModel), changed);
  const x0 = (DONOR.tileX - 16) * TILE, z0 = (DONOR.tileY - 16) * TILE, x1 = x0 + DONOR.width * TILE, z1 = z0 + DONOR.depth * TILE;
  const inPatch = (face: Face) => face.every(({ position: [x, , z] }) => x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1);
  const shape = nativeFaces(donorModel, ["nagakusa02a", "nagakusa02b"], "thick grass brush");
  const tops = shape.find(part => part.record.name === "nagakusa02a")?.faces.filter(inPatch) ?? [];
  const sides = shape.find(part => part.record.name === "nagakusa02b")?.faces.filter(inPatch) ?? [];
  ensure(tops.length && sides.length === DONOR.sideFaces, changed);
  const records = nativeFaces(donorModel, [THICK_GRASS[kind].top, THICK_GRASS[kind].side], "thick grass brush");
  const top = records.find(part => part.record.name === THICK_GRASS[kind].top), side = records.find(part => part.record.name === THICK_GRASS[kind].side);
  ensure(top && side, changed);
  const topBox = boundsOf(tops), height = tops[0][0].position[1] - ground;
  const inset = { north: topBox.z0 - z0, south: z1 - topBox.z1, west: topBox.x0 - x0, east: x1 - topBox.x1 };
  // Each skirt face runs along one side: longer in x on the north and south sides, in z on the west and east. The
  // game draws long runs as single faces, so each role is cut at its tile: the first, the second (a straight middle)
  // and the last along the side.
  const bySide = new Map<Side, Face[]>();
  for (const face of sides) {
    const box = boundsOf([face]), alongX = box.x1 - box.x0 >= box.z1 - box.z0;
    const sideOf: Side = alongX ? ((box.z0 + box.z1) / 2 < (z0 + z1) / 2 ? "north" : "south") : ((box.x0 + box.x1) / 2 < (x0 + x1) / 2 ? "west" : "east");
    bySide.set(sideOf, [...(bySide.get(sideOf) ?? []), face]);
  }
  const pieces = new Map<string, Face[]>();
  const steps = new Map<string, TextureStep[]>(), origins = new Map<string, number>();
  for (const [sideOf, faces] of bySide) {
    const alongX = sideOf === "north" || sideOf === "south", axis = alongX ? 0 : 2, count = alongX ? DONOR.width : DONOR.depth;
    // One tile of the side, relative to the tile, with the index of the native face each piece came from.
    const cutAt = (t: number) => {
      const ox = alongX ? x0 + t * TILE : sideOf === "west" ? x0 : x1 - TILE;
      const oz = alongX ? (sideOf === "north" ? z0 : z1 - TILE) : z0 + t * TILE;
      const lo = alongX ? ox : oz;
      const out: Face[] = [], sources: number[] = [];
      faces.forEach((face, source) => { for (const piece of clipBetween(face, axis, lo, lo + TILE)) { out.push(piece); sources.push(source); } });
      return { faces: shift(out, -ox, -ground, -oz), sources };
    };
    const middle = cutAt(1), middleSteps = textureSteps(middle.faces, cutAt(2).faces);
    const bySource = new Map<number, TextureStep>();
    middle.sources.forEach((source, i) => { if (!bySource.has(source)) bySource.set(source, middleSteps[i]); });
    for (const [role, t] of [["start", 0], ["middle", 1], ["end", count - 1]] as const) {
      const cut = role === "middle" ? middle : cutAt(t);
      pieces.set(`${sideOf}:${role}`, cut.faces);
      steps.set(`${sideOf}:${role}`, role === "middle" ? middleSteps : cut.sources.map(source => bySource.get(source) ?? [0, 0]));
      origins.set(`${sideOf}:${role}`, (alongX ? DONOR.tileX : DONOR.tileY) + t);
    }
  }
  const edges = Object.fromEntries(SIDES.map(sideName => {
    const roles = ["start", "middle", "end"] as const;
    const segment: Segment = {
      ...Object.fromEntries(roles.map(role => [role, pieces.get(`${sideName}:${role}`) ?? []])) as Pick<Segment, Role>,
      steps: Object.fromEntries(roles.map(role => [role, steps.get(`${sideName}:${role}`) ?? []])) as Record<Role, TextureStep[]>,
      origin: Object.fromEntries(roles.map(role => [role, origins.get(`${sideName}:${role}`) ?? 0])) as Record<Role, number>,
    };
    ensure(segment.start.length && segment.middle.length && segment.end.length, changed);
    return [sideName, segment];
  })) as Record<Side, Segment>;
  const { normal, normalLast, color } = tops[0][0];
  return {
    kind, height, inset, edges,
    topVertex: { ...(normal !== undefined ? { normal, normalLast } : {}), ...(color !== undefined ? { color } : {}) },
    top: { ...top, faces: [] }, side: { ...side, faces: [] },
  };
}

type Open = Record<Side, boolean>;

/** One tile's top and skirt, in chunk units. `open` marks the sides with no thick grass of the same kind next to them. */
export function thickGrassTile(template: ThickGrassTemplate, tileIndex: number, ground: number, open: Open): BrushPiece {
  const ox = (tileIndex % 32 - 16) * TILE, oz = (Math.floor(tileIndex / 32) - 16) * TILE;
  const { inset } = template;
  const rx0 = open.west ? inset.west : 0, rx1 = TILE - (open.east ? inset.east : 0);
  const rz0 = open.north ? inset.north : 0, rz1 = TILE - (open.south ? inset.south : 0);
  // World-aligned texture coordinates, as the game draws a patch's top (offset by a whole number of repeats).
  const corner = (x: number, z: number): BrushVertex => ({
    ...template.topVertex,
    position: [ox + x, ground + template.height, oz + z],
    texcoord: ((Math.round((ox + x + 256) * 16) & 0xffff) | ((Math.round((oz + z + 272) * 16) & 0xffff) << 16)) >>> 0,
  });
  const top: Face[] = [[corner(rx0, rz1), corner(rx1, rz1), corner(rx1, rz0), corner(rx0, rz0)]];
  const skirt: Face[] = [];
  for (const sideName of SIDES) {
    if (!open[sideName]) continue;
    const alongX = sideName === "north" || sideName === "south", axis = alongX ? 0 : 2;
    const startTurns = alongX ? open.west : open.north, endTurns = alongX ? open.east : open.south;
    const segment = template.edges[sideName];
    // Each piece continues the native skirt's texture to this tile, so a straight side can draw as one long face.
    const along = alongX ? tileIndex % 32 : Math.floor(tileIndex / 32);
    const piece = (role: Role) => stepTextures(segment[role], segment.steps?.[role], along - (segment.origin?.[role] ?? along));
    skirt.push(...piece(startTurns ? "start" : "middle").flatMap(face => clipBetween(face, axis, 0, TILE / 2)));
    skirt.push(...piece(endTurns ? "end" : "middle").flatMap(face => clipBetween(face, axis, TILE / 2, TILE)));
  }
  return {
    payload: thickPayload(tileIndex, template.kind),
    parts: [{ ...template.top, faces: top }, { ...template.side, faces: shift(skirt, ox, ground, oz) }],
  };
}

const thickPayload = (tileIndex: number, kind: ThickGrassKind) => tileIndex | (THICK_GRASS_KINDS.indexOf(kind) << 10);

export function readPlacedThickGrass(file: Uint8Array) {
  const read = readBrushPieces(file, THICK_GRASS_BRUSH);
  const tiles = new Map<number, { kind: ThickGrassKind; key: number }>();
  for (const [key, { payload, member }] of read.pieces) {
    if (member !== 1 || payload === MERGED_PIECE_PAYLOAD) continue;
    tiles.set(payload & 1023, { kind: THICK_GRASS_KINDS[(payload >>> 10) & 3] ?? "green", key });
  }
  return { tiles, remove: read.remove };
}

const neighbours = (index: number) => ({
  north: index >= 32 ? index - 32 : undefined, south: index < 992 ? index + 32 : undefined,
  west: index % 32 ? index - 1 : undefined, east: index % 32 < 31 ? index + 1 : undefined,
});

/**
 * Redraw a chunk's thick grass after `changed` tiles change, so every outline follows the painted area. The whole
 * chunk is written again with its faces merged across tiles (`writeTileBrush`): a patch's top becomes a few large
 * faces and each skirt a long one, as the game draws its own patches.
 */
export function rebuildThickGrass(model: Uint8Array, collision: Uint8Array, after: ReadonlyMap<number, ThickGrassKind>, changed: ReadonlySet<number>,
  templates: Readonly<Partial<Record<ThickGrassKind, ThickGrassTemplate>>>, game: "BW" | "BW2") {
  void changed;
  const pieces: BrushPiece[] = [];
  for (const index of [...after.keys()].sort((a, b) => a - b)) {
    const kind = after.get(index);
    if (!kind) continue;
    const template = templates[kind];
    ensure(template, "Missing thick grass template.");
    const near = neighbours(index);
    const open = Object.fromEntries(SIDES.map(sideName => [sideName, near[sideName] === undefined || after.get(near[sideName]!) !== kind])) as Open;
    pieces.push(thickGrassTile(template, index, snapGround(cornerHeights(collision, index, game)[0]), open));
  }
  return writeTileBrush(model, THICK_GRASS_BRUSH, pieces);
}

// ---------- Strokes ----------

type OriginalTile = Gen5PermissionTileLike & { kind: ThickGrassKind; secondary?: Gen5PermissionTileLike };
type ChunkOriginals = Record<number, OriginalTile>;
export type MapThickGrassOriginalPermissions = Record<number, ChunkOriginals>;
export type ThickGrassSkipReason = TreeSkipReason | "missing-original-permissions" | "changed-grass";
export type ThickGrassStroke = BrushStroke<"paint" | "erase", ThickGrassSkipReason, ChunkOriginals>;

type Assets = { templates: Record<ThickGrassKind, ThickGrassTemplate>; banks: ReturnType<typeof donorSeasonBanks> };
const stock = new WeakMap<Uint8Array, Assets>();

function thickAssets(source: Uint8Array, rom: NintendoDSRom, game: "BW" | "BW2"): Assets {
  let assets = stock.get(source);
  if (!assets) {
    const donor = new NARC(rom.getFileByName(MAPS_PATH)).files[DONOR.map];
    ensure(donor?.length, "The source ROM is missing the thick grass donor map.");
    const files = extractGameFreakContainer(donor).files;
    const ground = snapGround(gen5HeightAt(files[1], DONOR.tileY * 32 + DONOR.tileX, 0, 0, game) * 16);
    const templates = Object.fromEntries(THICK_GRASS_KINDS.map(kind => [kind, cutThickGrass(files[0], kind, ground)])) as Record<ThickGrassKind, ThickGrassTemplate>;
    const names = THICK_GRASS_KINDS.flatMap(kind => [templates[kind].top.record.textureName, templates[kind].side.record.textureName]).filter((name): name is string => !!name);
    assets = { templates, banks: donorSeasonBanks(rom, game, DONOR.area, names, "thick grass") };
    stock.set(source, assets);
  }
  return assets;
}

/** Paint (`kind`) or erase (no kind) thick grass on the tiles, in every seasonal variant of their chunks. */
export async function strokeThickGrass(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], kind: ThickGrassKind | undefined, { isCurrent = () => true, allowBlocked = false }: { isCurrent?: () => boolean; allowBlocked?: boolean } = {}): Promise<ThickGrassStroke> {
  const { result, skip } = startBrushStroke<ThickGrassStroke>(emptyBrushStroke(kind ? "paint" : "erase"));
  if (!tiles.length) return result;
  ensure(project.session.baseRom === "BW2", "Thick grass is available in Black 2 and White 2.");
  const context = await mapBrushContext(project, scene, isCurrent, "thick grass");
  ensure(isCurrent(), "The map changed during the thick grass stroke. Try again.");
  const { game, source, rom, maps, textureId } = context;
  const { templates, banks } = thickAssets(source, rom, game);
  type Chunk = { bin: ReturnType<typeof readGen5MapBin>; painted: Map<number, ThickGrassKind>; changed: Set<number>; originals: ChunkOriginals };
  const chunks = new Map<number, Chunk>();
  const chunk = (id: number) => {
    let entry = chunks.get(id);
    if (!entry) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      const placed = readPlacedThickGrass(bin.files[0]);
      entry = { bin, painted: new Map([...placed.tiles].map(([index, tile]) => [index, tile.kind])), changed: new Set(), originals: { ...project.mapThickGrassOriginalPermissions?.[id] } };
      chunks.set(id, entry);
    }
    return entry;
  };
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    if (variants.some(({ id }) => !maps.rawFiles[id]?.length)) { skip("missing-map"); continue; }
    const current = chunk(variants[0].id);
    if (kind) {
      if (current.painted.get(tileIndex) === kind) continue;
      let failure: { reason: ThickGrassSkipReason; season?: MatrixSeason } | undefined;
      for (const { id, season } of variants) {
        const { bin, painted } = chunk(id);
        if (painted.has(tileIndex)) { failure = { reason: "existing-grass", season }; break; }
        const site = treeSite(bin, [tileIndex], game, { allowBlocked });
        if (typeof site === "string") { failure = { reason: site, season }; break; }
      }
      if (failure) { skip(failure.reason, failure.season); continue; }
      for (const { id } of variants) {
        const entry = chunk(id), files = entry.bin.files;
        const original: OriginalTile = { kind, ...permission(files[1], tileIndex) };
        if (entry.bin.placements === 3) original.secondary = permission(files[2], tileIndex);
        entry.originals[tileIndex] = original;
        entry.painted.set(tileIndex, kind);
        entry.changed.add(tileIndex);
      }
      result.count++;
    } else {
      if (!current.painted.has(tileIndex)) continue; // A drag crosses plenty of tiles with no thick grass.
      let failure: { reason: ThickGrassSkipReason; season?: MatrixSeason } | undefined;
      for (const { id, season } of variants) {
        const entry = chunk(id);
        if (!entry.painted.has(tileIndex)) continue;
        const saved = entry.originals[tileIndex];
        if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
        if (saved.kind !== entry.painted.get(tileIndex)) { failure = { reason: "changed-grass", season }; break; }
      }
      if (failure) { skip(failure.reason, failure.season); continue; }
      for (const { id } of variants) {
        const entry = chunk(id);
        if (!entry.painted.has(tileIndex)) continue;
        entry.painted.delete(tileIndex);
        entry.changed.add(tileIndex);
      }
      result.count++;
    }
  }
  const touched = [...chunks].filter(([, entry]) => entry.changed.size);
  if (!touched.length) return result;

  for (const [id, entry] of touched) {
    const files = entry.bin.files.slice();
    files[1] = files[1].slice();
    if (entry.bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapThickGrassOriginalPermissions?.[id];
    for (const index of entry.changed) {
      const saved = entry.originals[index];
      if (entry.painted.has(index)) {
        // Scenery that already blocks movement keeps its tile: the grass there is only art.
        if (saved && saved.flags & 1) continue;
        const tile = THICK_GRASS[entry.painted.get(index)!].tile;
        writePermission(files[1], index, tile);
        if (entry.bin.placements === 3) writePermission(files[2], index, tile);
      } else if (saved) {
        writePermission(files[1], index, saved);
        if (saved.secondary) writePermission(files[2], index, saved.secondary);
        delete entry.originals[index];
      }
    }
    files[0] = rebuildThickGrass(files[0], files[1], entry.painted, entry.changed, templates, game);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(entry.bin.signature, files), originalsBefore,
      originalsAfter: Object.keys(entry.originals).length ? entry.originals : undefined });
  }

  if (kind) {
    const textureStore = project.narcs.map_textures
      ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
    const packs = [...texturePacksFor(project, context, new Set(touched.map(([id]) => id)))].map(([id, season]) => {
      const bytes = textureStore.rawFiles[id];
      ensure(bytes, `Map texture pack ${id} is missing.`);
      return { id, season, bytes, bank: readNitroResources(bytes), donor: banks[season] };
    });
    // Thick grass keeps the game's own material names; a pack holding other art under those names cannot take it.
    const template = templates[kind], bound = stampBindings([template.top.record, template.side.record], packs);
    ensure(bound.every((entry, i) => entry.record.name === [template.top.record, template.side.record][i].name),
      "This map's textures already use the thick grass texture names for other art.");
    for (const { id, season, bytes } of packs) {
      const after = addNativeTextures(bytes, banks[season], bound.map(entry => entry.binding));
      if (!equalMapBytes(after, bytes)) result.textures.push({ id, before: bytes.slice(), after });
    }
    if (result.textures.length) {
      project.narcs.map_textures = textureStore;
      project.session.fileIds.map_textures = textureId;
    }
  }
  writeBrushStroke(project, THICK_GRASS_STROKES, result, false);
  return result;
}

const THICK_GRASS_STROKES: BrushStrokeKind<ThickGrassStroke> = {
  originals: "mapThickGrassOriginalPermissions",
  thing: "thick grass",
  counted: countedAs("thick grass tile"),
  actions: { paint: { done: "Painted", label: "Paint Thick Grass" }, erase: { done: "Erased", label: "Erase Thick Grass" } },
};

export const undoThickGrass = (project: ProjectState, stroke: ThickGrassStroke) => undoBrushStroke(project, THICK_GRASS_STROKES, stroke);
export const redoThickGrass = (project: ProjectState, stroke: ThickGrassStroke) => redoBrushStroke(project, THICK_GRASS_STROKES, stroke);

