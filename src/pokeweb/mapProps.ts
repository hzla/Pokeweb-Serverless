import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { invalidateBuildingLibrary } from "./buildingLibraryModel";
import { getRomFileBytes } from "./fileSystemModel";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, invalidateMap3dAssets, mapBuildingMember, packGameFreakContainer, parseAreaHeader, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { areasFor, mapBrushContext } from "./mapGrass";
import type { MapStampCategory, StampRotation } from "./mapStampCatalog";
import { stampSize, stampBlocked } from "./mapStampCatalog";
import { addNativeTextures, brushDestinations, PALETTE_BYTES, permission, TREE_TILE, treeSite, writePermission, type MapTreeOriginalTile, type TreeSkipReason } from "./mapTrees";
import { ensure, materialRecords } from "./nitroResourceWriter";
import type { NarcName } from "./constants";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";
import type { MatrixSeason } from "./seasonalMatrixModel";

/**
 * Props: small building models (topiaries, a fountain, a gateway) placed like objects. The model, its metadata
 * (which carries its own texture animations) and its textures are copied from the donor area's building bundle
 * in the source ROM into each destination area's bundle, then a building placement is added to every seasonal
 * variant of the chunk and the footprint's blocked tiles are set. Placements the brush added are remembered by their
 * exact 16 bytes, so Erase removes only those.
 */
export type MapPropType = {
  id: string; label: string; category: MapStampCategory; rotatable: boolean;
  donor: { area: number; uid: number; name: string };
  /** The footprint (one string per row from the top, "#" blocks) and where the model's origin sits in it, in units from its top-left corner. */
  blocked: readonly string[]; origin: readonly [number, number];
};

/** Black 2 / White 2 props. Order matters: placed props store their catalog index. */
export const MAP_PROP_TYPES: readonly MapPropType[] = [
  { id: "topiary", label: "Topiary", category: "Vegetation", rotatable: true, donor: { area: 6, uid: 107, name: "c01thicket_02" }, blocked: ["#"], origin: [8, 8] },
  { id: "topiary-wide", label: "Wide topiary", category: "Vegetation", rotatable: true, donor: { area: 6, uid: 106, name: "c01thicket_01" }, blocked: ["#"], origin: [8, 8] },
  { id: "fountain", label: "Fountain", category: "Misc", rotatable: false, donor: { area: 26, uid: 24, name: "fountain_01" }, blocked: ["###", "###", "###"], origin: [24, 24] },
  { id: "arched-gateway", label: "Arched gateway", category: "Misc", rotatable: true, donor: { area: 26, uid: 147, name: "c4_gate_01" }, blocked: ["#.....#"], origin: [64, 8] },
];

export function mapPropTypes(game: string | undefined) {
  return game === "BW2" ? MAP_PROP_TYPES : [];
}

const BUNDLES_PATH = "a/2/2/5";
const TEXTURES_PATH = "a/1/7/4";
const AREA_PATH = "a/0/1/3";
const TILE = 16;

type Resource = { meta: Uint8Array; model: Uint8Array };

function bundleResources(bytes: Uint8Array) {
  const files = extractGameFreakContainer(bytes).files;
  ensure(files.length % 2 === 0, "A building bundle has unpaired metadata and models.");
  const count = files.length / 2;
  return Array.from({ length: count }, (_, i): Resource => ({ meta: files[i], model: files[count + i] }));
}

/** The bundle with one more resource, metadata and models each kept in order. */
function appendResource(bytes: Uint8Array, resource: Resource) {
  const signature = String.fromCharCode(bytes[0], bytes[1]);
  const resources = [...bundleResources(bytes), resource];
  return packGameFreakContainer(signature, [...resources.map(entry => entry.meta), ...resources.map(entry => entry.model)]);
}

/** The model's origin in a footprint turned `rotation` quarter turns clockwise, and the game's matching rotation. */
export function propPlacement(type: MapPropType, rotation: StampRotation) {
  let [width, depth] = stampSize(type);
  let [x, z] = type.origin;
  for (let turn = 0; turn < rotation; turn++) {
    [x, z] = [depth * TILE - z, x];
    [width, depth] = [depth, width];
  }
  // The game turns a model anticlockwise (seen from above) for a positive angle.
  return { origin: [x, z] as const, angle: rotation ? 65536 - rotation * 16384 : 0 };
}

function placementRecord(x: number, y: number, z: number, angle: number, uid: number) {
  const record = new Uint8Array(16);
  writeU32(record, 0, Math.round(x * 4096) >>> 0);
  writeU32(record, 4, Math.round(y * 4096) >>> 0);
  writeU32(record, 8, Math.round(z * 4096) >>> 0);
  writeU16(record, 12, angle & 0xffff);
  record[14] = uid >>> 8;
  record[15] = uid & 255;
  return record;
}

/** A chunk's building placements with a record added or removed. Members before the table keep their offsets. */
function editPlacements(files: Uint8Array[], change: { add?: Uint8Array; remove?: number }) {
  const member = mapBuildingMember(files), table = files[member];
  ensure(table && table.length >= 4, "This chunk has no building placement table.");
  const count = readU32(table, 0);
  ensure(4 + count * 16 <= table.length, "This chunk's building placement table is truncated.");
  const records = Array.from({ length: count }, (_, i) => table.subarray(4 + i * 16, 20 + i * 16));
  const next = change.add ? [...records, change.add] : records.filter((_, i) => i !== change.remove);
  const head = new Uint8Array(4);
  writeU32(head, 0, next.length);
  const out = files.slice();
  out[member] = concatBytes([head, ...next, table.subarray(4 + count * 16)]);
  return out;
}

export function placementRecords(files: Uint8Array[]) {
  const table = files[mapBuildingMember(files)];
  if (!table || table.length < 4) return [];
  const count = readU32(table, 0);
  return Array.from({ length: Math.min(count, Math.floor((table.length - 4) / 16)) }, (_, i) => table.slice(4 + i * 16, 20 + i * 16));
}

// ---------- Strokes ----------

export type MapPropOriginal = { type: string; rotation: StampRotation; record: string; tiles: MapTreeOriginalTile[] };
type ChunkPropOriginals = Record<number, MapPropOriginal>;
export type MapPropOriginals = Record<number, ChunkPropOriginals>;
export type PropSkipReason = TreeSkipReason | "changed-prop" | "interior";
type Change = { store: NarcName; id: number; before: Uint8Array; after: Uint8Array };
type MapChange = { id: number; before: Uint8Array; after: Uint8Array; originalsBefore?: ChunkPropOriginals; originalsAfter?: ChunkPropOriginals };
export type PropStroke = { action: "place" | "remove"; maps: MapChange[]; archives: Change[]; count: number; skipped: number; skipReasons: { reason: PropSkipReason; count: number; season?: MatrixSeason }[] };

function propStroke(action: PropStroke["action"]) {
  const result: PropStroke = { action, maps: [], archives: [], count: 0, skipped: 0, skipReasons: [] };
  return {
    result,
    skip(reason: PropSkipReason, season?: MatrixSeason) {
      result.skipped++;
      const group = result.skipReasons.find(entry => entry.reason === reason && entry.season === season);
      if (group) group.count++;
      else result.skipReasons.push({ reason, count: 1, ...(season ? { season } : {}) });
    },
  };
}

const propKey = (tileIndex: number, rotation: StampRotation, type: MapPropType) => tileIndex | (rotation << 10) | ((MAP_PROP_TYPES.indexOf(type) + 1) << 12);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

/** The donor's model, metadata and texture bank, from the source ROM. */
function donorProp(rom: NintendoDSRom, game: "BW" | "BW2", type: MapPropType) {
  const area = parseAreaHeader(rom.getFileByName(AREA_PATH), type.donor.area);
  const bundle = new NARC(rom.getFileByName(BUNDLES_PATH)).files[area.buildingsId];
  ensure(bundle?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s building bundle.`);
  const resource = bundleResources(bundle).find(entry => readU16(entry.meta, 0) === type.donor.uid);
  const changed = `The source ROM's ${type.label.toLowerCase()} is not the vanilla model.`;
  ensure(resource && String.fromCharCode(...resource.model.subarray(0, 4)) === "BMD0", changed);
  const records = materialRecords(resource!.model);
  ensure(records.length, changed);
  const textures = new NARC(rom.getFileByName(TEXTURES_PATH)).files[area.buildingsId];
  ensure(textures?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s textures.`);
  void game;
  return { resource: resource!, bindings: records.map(record => ({ textureName: record.textureName, paletteName: record.paletteName })), bank: readNitroResources(textures) };
}

/** Whether a pack already holds a texture or palette under these names with different art. */
function textureClash(pack: Uint8Array, donor: ReturnType<typeof readNitroResources>, bindings: readonly { textureName?: string; paletteName?: string }[]) {
  const bank = readNitroResources(pack);
  return bindings.find(({ textureName, paletteName }) => {
    const ours = textureName ? bank.textures.find(t => t.name === textureName) : undefined, theirs = textureName ? donor.textures.find(t => t.name === textureName) : undefined;
    if (ours && theirs && (ours.params.width() !== theirs.params.width() || ours.params.format() !== theirs.params.format() || !equalMapBytes(ours.data1, theirs.data1))) return true;
    const format = theirs?.params.format() ?? 0, length = PALETTE_BYTES[format];
    const mine = paletteName ? bank.palettes.find(p => p.name === paletteName) : undefined, source = paletteName ? donor.palettes.find(p => p.name === paletteName) : undefined;
    return Boolean(mine && source && length && !equalMapBytes(mine.block.slice(mine.offset, mine.offset + length), source.block.slice(source.offset, source.offset + length)));
  });
}

function archiveStore(project: ProjectState, rom: NintendoDSRom, name: NarcName, path: string) {
  const fileId = rom.fileId(path);
  const store = project.narcs[name] ?? createNarcStore(name, path, fileId, new NARC(getRomFileBytes(project, rom, fileId)));
  ensure(store.fileId === fileId && store.sourcePath === path, "Conflicting building archive store.");
  project.narcs[name] = store;
  return store;
}

/** Place a prop with its turned footprint's top-left tile at each anchor, in every seasonal variant of the chunk. */
export async function placeMapProps(project: ProjectState, scene: Map3dSceneData, anchors: readonly Map3dTile[], typeId: string, rotation: StampRotation, { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<PropStroke> {
  const type = MAP_PROP_TYPES.find(entry => entry.id === typeId);
  ensure(type && project.session.baseRom === "BW2", "Choose a model for this game.");
  const turn = (type!.rotatable ? rotation : 0) as StampRotation;
  const { result, skip } = propStroke("place");
  if (!anchors.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "model");
  ensure(isCurrent(), "The map changed while placing models. Try again.");
  const { game, rom, maps } = context;
  const donor = donorProp(rom, game, type!);
  const pending = new Map<number, { tileIndex: number; tiles: ReturnType<typeof footprint>; ground: number; mirrored: boolean }[]>();
  const contents = new Map<number, ReturnType<typeof readGen5MapBin>>();
  const footprint = (tileIndex: number) => {
    const [width, depth] = stampSize(type!, turn), x = tileIndex % 32, y = Math.floor(tileIndex / 32);
    if (x + width > 32 || y + depth > 32) return undefined;
    return Array.from({ length: width * depth }, (_, i) => ({ index: (y + Math.floor(i / width)) * 32 + x + i % width, blocked: stampBlocked(type!, turn, i % width, Math.floor(i / width)) }));
  };
  const occupied = new Map<number, Set<number>>();
  for (const { tileIndex, variants } of brushDestinations(scene, anchors, context, skip)) {
    const tiles = footprint(tileIndex);
    if (!tiles) { skip("outside-map"); continue; }
    const stroke: { id: number; ground: number; mirrored: boolean }[] = [];
    let failure: { reason: PropSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      const bytes = maps.rawFiles[id];
      if (!bytes?.length) { failure = { reason: "missing-map", season }; break; }
      let map = contents.get(id);
      if (!map) { map = readGen5MapBin(bytes); contents.set(id, map); }
      if (tiles.some(tile => occupied.get(id)?.has(tile.index))) { failure = { reason: "occupied", season }; break; }
      const site = treeSite(map, tiles.map(tile => tile.index), game);
      if (typeof site === "string") { failure = { reason: site, season }; break; }
      stroke.push({ id, ...site });
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    for (const { id, ground, mirrored } of stroke) {
      pending.set(id, [...(pending.get(id) ?? []), { tileIndex, tiles, ground, mirrored }]);
      const used = occupied.get(id) ?? new Set<number>();
      tiles.forEach(tile => used.add(tile.index));
      occupied.set(id, used);
    }
    result.count++;
  }
  if (!pending.size) return result;

  // Every bundle that can draw these chunks gets the model, under one UID that is free (or already this model) in all of them.
  const areas = areasFor(project, context, new Set(pending.keys())).map(({ area, season }) => context.areaHeader(area, season));
  if (areas.some(area => !area.isExterior)) { result.count = 0; skip("interior"); return result; }
  const bundleIds = [...new Set(areas.map(area => area.buildingsId))];
  const bundleStore = archiveStore(project, rom, "exterior_building_models", BUNDLES_PATH);
  const textureStore = archiveStore(project, rom, "exterior_building_textures", TEXTURES_PATH);
  const bundles = bundleIds.map(id => {
    const bytes = bundleStore.rawFiles[id];
    ensure(bytes?.length, `Building bundle ${id} is missing.`);
    return { id, bytes, resources: bundleResources(bytes) };
  });
  const same = (resource: Resource) => equalMapBytes(resource.model, donor.resource.model);
  const usable = (uid: number) => bundles.every(({ resources }) => resources.every(entry => readU16(entry.meta, 0) !== uid || same(entry)));
  const existing = bundles[0].resources.find(same);
  let uid = existing && usable(readU16(existing.meta, 0)) ? readU16(existing.meta, 0) : usable(type!.donor.uid) ? type!.donor.uid : -1;
  for (let candidate = 2000; uid < 0 && candidate < 65536; candidate++) if (usable(candidate)) uid = candidate;
  ensure(uid >= 0, "No free building UID is left in this area's bundle.");
  for (const bundle of bundles) {
    if (bundle.resources.some(entry => readU16(entry.meta, 0) === uid)) continue;
    const meta = donor.resource.meta.slice();
    writeU16(meta, 0, uid);
    result.archives.push({ store: "exterior_building_models", id: bundle.id, before: bundle.bytes.slice(), after: appendResource(bundle.bytes, { meta, model: donor.resource.model.slice() }) });
    const pack = textureStore.rawFiles[bundle.id];
    ensure(pack?.length, `Building texture pack ${bundle.id} is missing.`);
    ensure(!textureClash(pack, donor.bank, donor.bindings), "This area's building textures already use this model's texture names for other art.");
    const after = addNativeTextures(pack, donor.bank, donor.bindings);
    if (!equalMapBytes(after, pack)) result.archives.push({ store: "exterior_building_textures", id: bundle.id, before: pack.slice(), after });
  }

  const { origin, angle } = propPlacement(type!, turn);
  for (const [id, props] of pending) {
    const { signature } = contents.get(id)!;
    let files = contents.get(id)!.files.slice();
    files[1] = files[1].slice();
    if (props.some(prop => prop.mirrored)) files[2] = files[2].slice();
    const originalsBefore = project.mapPropOriginals?.[id];
    const originalsAfter: ChunkPropOriginals = { ...originalsBefore };
    for (const { tileIndex, tiles, ground, mirrored } of props) {
      const x = (tileIndex % 32 - 16) * TILE + origin[0], z = (Math.floor(tileIndex / 32) - 16) * TILE + origin[1];
      // Placements store z flipped: the game draws a building at the chunk's centre minus z.
      const record = placementRecord(x, ground, -z, angle, uid);
      const original: MapPropOriginal = { type: type!.id, rotation: turn, record: hex(record), tiles: [] };
      for (const { index, blocked } of tiles!) {
        if (!blocked) continue;
        const tile: MapTreeOriginalTile = { index, ...permission(files[1], index) };
        writePermission(files[1], index, TREE_TILE);
        if (mirrored) { tile.secondary = permission(files[2], index); writePermission(files[2], index, TREE_TILE); }
        original.tiles.push(tile);
      }
      files = editPlacements(files, { add: record });
      originalsAfter[propKey(tileIndex, turn, type!)] = original;
    }
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), originalsBefore, originalsAfter });
  }
  writePropStroke(project, result, false);
  return result;
}

/** Remove brush-placed props whose footprint covers any of the tiles, restoring the tiles they blocked. */
export async function removeMapProps(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: { isCurrent?: () => boolean } = {}): Promise<PropStroke> {
  const { result, skip } = propStroke("remove");
  if (!tiles.length || !project.mapPropOriginals) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "model");
  ensure(isCurrent(), "The map changed while removing models. Try again.");
  const { maps } = context;
  const pending = new Map<number, Set<number>>();
  const done = new Set<string>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    const saved: ChunkPropOriginals = project.mapPropOriginals?.[variants[0].id] ?? {};
    const found: [string, MapPropOriginal] | undefined = Object.entries(saved).find(([key, prop]) => {
      const type = MAP_PROP_TYPES.find(entry => entry.id === prop.type);
      const anchor = Number(key) & 1023;
      if (!type) return false;
      const [width, depth] = stampSize(type, prop.rotation);
      const x = tileIndex % 32 - anchor % 32, y = Math.floor(tileIndex / 32) - Math.floor(anchor / 32);
      return x >= 0 && y >= 0 && x < width && y < depth;
    });
    if (!found) continue;
    const key = Number(found[0]);
    const doneKey = `${variants.map(v => v.id).join(",")}:${key}`;
    if (done.has(doneKey)) continue;
    done.add(doneKey);
    let failure: { reason: PropSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      const prop = project.mapPropOriginals?.[id]?.[key];
      if (!prop) continue;
      if (!maps.rawFiles[id]?.length) { failure = { reason: "missing-map", season }; break; }
      if (!placementRecords(readGen5MapBin(maps.rawFiles[id]).files).some(record => hex(record) === prop.record)) { failure = { reason: "changed-prop", season }; break; }
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    for (const { id } of variants) if (project.mapPropOriginals?.[id]?.[key]) pending.set(id, (pending.get(id) ?? new Set()).add(key));
    result.count++;
  }
  for (const [id, keys] of pending) {
    const bin = readGen5MapBin(maps.rawFiles[id]);
    let files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapPropOriginals?.[id];
    const originals = { ...originalsBefore };
    for (const key of keys) {
      const prop = originals[key];
      for (const tile of prop.tiles) {
        writePermission(files[1], tile.index, tile);
        if (tile.secondary) writePermission(files[2], tile.index, tile.secondary);
      }
      const index = placementRecords(files).findIndex(record => hex(record) === prop.record);
      if (index >= 0) files = editPlacements(files, { remove: index });
      delete originals[key];
    }
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), originalsBefore, originalsAfter: Object.keys(originals).length ? originals : undefined });
  }
  if (result.count) writePropStroke(project, result, false);
  return result;
}

function writePropStroke(project: ProjectState, stroke: PropStroke, undo: boolean) {
  const changes: Change[] = [...stroke.maps.map(change => ({ ...change, store: "maps" as NarcName })), ...stroke.archives];
  for (const { store: name, id, before, after } of changes) {
    const store = project.narcs[name];
    ensure(store, "Reload the map before editing models.");
    store.rawFiles[id] = (undo ? before : after).slice();
    store.records.delete(id);
    markDirty(project, name, id);
  }
  const originals = { ...project.mapPropOriginals };
  for (const { id, originalsBefore, originalsAfter } of stroke.maps) {
    const next = undo ? originalsBefore : originalsAfter;
    if (next) originals[id] = next;
    else delete originals[id];
  }
  project.mapPropOriginals = Object.keys(originals).length ? originals : undefined;
  if (stroke.archives.length) invalidateBuildingLibrary(project);
  invalidateMap3dAssets();
  const noun = `${stroke.count} model${stroke.count === 1 ? "" : "s"}`;
  recordGenericChange(project, "maps3d", undo ? `Undid a model edit (${noun}).` : stroke.action === "remove" ? `Removed ${noun}.` : `Placed ${noun}.`,
    stroke.action === "remove" ? "Remove Models" : "Place Models");
}

function assertStoresMatch(project: ProjectState, stroke: PropStroke, side: "before" | "after", message: string) {
  const changes: Change[] = [...stroke.maps.map(change => ({ ...change, store: "maps" as NarcName })), ...stroke.archives];
  ensure(changes.every(change => { const bytes = project.narcs[change.store]?.rawFiles[change.id]; return bytes && equalMapBytes(bytes, change[side]); }), message);
}

export function undoMapProps(project: ProjectState, stroke: PropStroke) {
  if (!stroke.count) return;
  assertStoresMatch(project, stroke, "after", "Map resources changed after this model edit.");
  ensure(stroke.maps.every(change => project.mapPropOriginals?.[change.id] === change.originalsAfter), "The saved model tiles changed after this edit.");
  writePropStroke(project, stroke, true);
}

export function redoMapProps(project: ProjectState, stroke: PropStroke) {
  if (!stroke.count) return;
  assertStoresMatch(project, stroke, "before", "Map resources changed after this model edit was undone.");
  ensure(stroke.maps.every(change => project.mapPropOriginals?.[change.id] === change.originalsBefore), "The saved model tiles changed after this edit was undone.");
  writePropStroke(project, stroke, false);
}
