import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import type { Gen5PermissionTileLike } from "./gen5PermissionModel";
import { extractGameFreakContainer, packGameFreakContainer, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission, type BrushStrokeKind, type BrushStroke } from "./mapBrushStroke";
import { mapBrushContext, texturePacksFor, type MapBrushContext } from "./mapGrass";
import { mapTreeType, type MapTreeType } from "./mapTreeCatalog";
import { appendMapTrees, cutMapTree, readPlacedMapTrees, treeTileKey, type MapTreeTemplate, type TreePlacement } from "./mapTreeGeometry";
import { ensure } from "./nitroResourceWriter";
import { appendNitroTextures, type EncodedPalette, type EncodedTexture } from "./nitroTextureWriter";
import { createNarcStore, type ProjectState } from "./projectStore";
import { MATRIX_SEASONS, type MatrixSeason } from "./seasonalMatrixModel";

const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";
/** Every native tree tile in the overworld uses this class and these flags. */
export const TREE_TILE = { tileClass: 1, flags: 0x81 } as const;

type MapBin = ReturnType<typeof readGen5MapBin>;
type Bank = ReturnType<typeof readNitroResources>;

/** The tile records a placed tree replaced, so removing it restores them exactly. */
export type MapTreeOriginalTile = Gen5PermissionTileLike & { index: number; secondary?: Gen5PermissionTileLike };
export type MapTreeOriginal = { type: string; tiles: MapTreeOriginalTile[] };
type ChunkTreeOriginals = Record<number, MapTreeOriginal>;
export type MapTreeOriginalPermissions = Record<number, ChunkTreeOriginals>;

export type TreeSkipReason = "occupied" | "blocked" | "water" | "existing-grass" | "special-terrain" | "split-height" | "uneven-ground" | "multiple-surfaces" | "missing-map" | "outside-map" | "no-placed-tree" | "missing-original-permissions" | "changed-tree";
export type TreeStroke = BrushStroke<"place" | "remove", TreeSkipReason, ChunkTreeOriginals>;
/** `allowBlocked` also paints over tiles that already block movement (scenery the player never reaches); they stay blocked. */
type TreeStrokeOptions = { isCurrent?: () => boolean; allowBlocked?: boolean };

const flat = 1e-3;
/**
 * Decoded walking heights carry table rounding (32.0076 for a native height of 32). Model vertices are fixed point,
 * so snap to 1/16 unit: a planted tree then sits at exactly the height a native tree on that ground has.
 */
export const snapGround = (height: number) => Math.round(height * 16) / 16;
export function cornerHeights(per: Uint8Array, index: number, game: "BW" | "BW2") {
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => gen5HeightAt(per, index, u, v, game) * 16);
}

/** A tile a tree can stand on: an ordinary dry floor, path, sand or short-grass tile on one level plane. */
export function treeGround(tile: Gen5PermissionTileLike): true | TreeSkipReason {
  const { tileClass, flags } = tile;
  if ([0, 2, 3, 11, 31].includes(tileClass) && !(flags & 0x8037)) return true;
  if (flags & 1 || [1, 18].includes(tileClass)) return "blocked";
  if ([4, 5, 6, 7, 31].includes(tileClass) || flags & 0x0024) return "existing-grass";
  if (flags & 0x8000) return "split-height";
  if ([16, 17, 19, 20, 21, 22, 23].includes(tileClass) || flags & 0x0010) return "water";
  return "special-terrain";
}

function footprint(tileIndex: number, size: number) {
  const x = tileIndex % 32, y = Math.floor(tileIndex / 32);
  if (x + size > 32 || y + size > 32) return undefined;
  return Array.from({ length: size * size }, (_, i) => (y + Math.floor(i / size)) * 32 + x + i % size);
}

export function samePlane(primary: Uint8Array, secondary: Uint8Array, index: number, game: "BW" | "BW2") {
  try {
    return cornerHeights(primary, index, game).every((height, i) => Math.abs(height - cornerHeights(secondary, index, game)[i]) < flat);
  } catch {
    return false;
  }
}

/** Check every footprint tile in one map; return the ground height and whether the second collision layer mirrors the first. */
export function treeSite(map: MapBin, tiles: readonly number[], game: "BW" | "BW2", { allowBlocked = false } = {}): { ground: number; mirrored: boolean } | TreeSkipReason {
  const usable = (status: true | TreeSkipReason) => status === true || (allowBlocked && status === "blocked");
  const [primary, secondary] = map.files.slice(1, 3);
  const mirrored = map.placements === 3;
  let ground: number | undefined;
  for (const index of tiles) {
    const status = treeGround(permission(primary, index));
    if (!usable(status)) return status as TreeSkipReason;
    if ((primary[4 + index * 8] & 3) === 2) return "split-height";
    let heights: number[];
    try { heights = cornerHeights(primary, index, game); } catch { return "special-terrain"; }
    ground ??= heights[0];
    if (heights.some(height => Math.abs(height - ground!) > flat)) return "uneven-ground";
    if (mirrored) {
      if (!samePlane(primary, secondary, index, game)) return "multiple-surfaces";
      const second = treeGround(permission(secondary, index));
      if (!usable(second)) return second as TreeSkipReason;
    }
  }
  return { ground: snapGround(ground!), mirrored };
}

const stockTrees = new WeakMap<Uint8Array, Map<string, { template: MapTreeTemplate; banks: Map<number, Bank> }>>();

function treeAssets(source: Uint8Array, rom: NintendoDSRom, type: MapTreeType, game: "BW" | "BW2") {
  let cache = stockTrees.get(source);
  if (!cache) { cache = new Map(); stockTrees.set(source, cache); }
  let assets = cache.get(type.id);
  if (!assets) {
    const donor = new NARC(rom.getFileByName(MAPS_PATH)).files[type.donor.map];
    ensure(donor?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s donor map.`);
    const files = extractGameFreakContainer(donor).files;
    const anchor = type.donor.tileY * 32 + type.donor.tileX;
    const template = cutMapTree(files[0], type, snapGround(gen5HeightAt(files[1], anchor, 0, 0, game) * 16));
    const archive = new NARC(rom.getFileByName(MAP_TEXTURES_PATH));
    const banks = new Map<number, Bank>();
    for (const id of new Set(Object.values(type.texturePacks))) {
      ensure(archive.files[id]?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s textures.`);
      banks.set(id, readNitroResources(archive.files[id]));
    }
    assets = { template, banks };
    cache.set(type.id, assets);
  }
  return assets;
}

export const PALETTE_BYTES: Record<number, number> = { 1: 64, 2: 8, 3: 32, 4: 512, 6: 16 };

/** A texture binding to copy; `source…` names the donor's texture and palette when the copy is renamed. */
export type NativeTextureBinding = { textureName?: string; paletteName?: string; sourceTextureName?: string; sourcePaletteName?: string };

/** Copy native textures and palettes into a map texture pack, leaving any it already has. */
export function addNativeTextures(bytes: Uint8Array, donor: Bank, bindings: readonly NativeTextureBinding[]) {
  const bank = readNitroResources(bytes), images: EncodedTexture[] = [], palettes: EncodedPalette[] = [];
  const seen = new Set<string>();
  for (const { textureName: name, paletteName, sourceTextureName, sourcePaletteName } of bindings) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const source = donor.textures.find(t => t.name === (sourceTextureName ?? name));
    ensure(source, `The source ROM is missing the native texture ${name}.`);
    const { params } = source, width = params.width(), height = params.height(), format = params.format();
    ensure(source.data1.length === params.byteLength() && format !== 5, `Native texture ${name} has a format the map brush cannot copy.`);
    const sourcePalette = paletteName ? donor.palettes.find(p => p.name === (sourcePaletteName ?? paletteName)) : undefined;
    const length = PALETTE_BYTES[format];
    ensure(!length || sourcePalette, `The source ROM is missing the native palette ${paletteName}.`);
    const paletteBytes = sourcePalette && length ? sourcePalette.block.slice(sourcePalette.offset, sourcePalette.offset + length) : new Uint8Array();
    // A 256-colour palette can end before 256 colours when the texture uses fewer.
    ensure(!length || paletteBytes.length === length || (format === 4 && paletteBytes.length >= 2 && paletteBytes.length % 2 === 0), `Truncated native palette ${paletteName}.`);
    const texture = bank.textures.find(t => t.name === name), palette = paletteName ? bank.palettes.find(p => p.name === paletteName) : undefined;
    if (texture) {
      ensure(texture.params.width() === width && texture.params.height() === height && texture.params.format() === format, `Existing texture ${name} is incompatible with the native art.`);
      if (!palette && paletteName && length) {
        ensure(equalMapBytes(texture.data1, source.data1), `Existing texture ${name} has no compatible palette.`);
        palettes.push({ name: paletteName, bytes: paletteBytes });
      }
      continue;
    }
    const code = (size: number) => Math.log2(size / 8);
    images.push({ name, paletteName, width, height, params: ((code(width) << 20) | (code(height) << 23) | (format << 26) | (Number(params.color0Transparent()) << 29)) >>> 0,
      pixels: source.data1, palette: paletteBytes, quantized: false });
  }
  return appendNitroTextures(bytes, images, palettes);
}

type Destination = { tileIndex: number; variants: { id: number; season?: MatrixSeason }[] };

/** The same footprint in every seasonal variant of the edited chunk. */
export function* brushDestinations(scene: Map3dSceneData, anchors: readonly Map3dTile[], context: MapBrushContext, skip: (reason: TreeSkipReason) => void): Generator<Destination> {
  const { activeMatrices, activeSeasonIndex } = context;
  const seen = new Set<string>();
  for (const { matrixX, matrixY, tileX, tileY } of anchors) {
    const key = `${matrixX},${matrixY},${tileX},${tileY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = scene.chunks.find(c => c.matrixX === matrixX && c.matrixY === matrixY);
    if (!chunk || ![tileX, tileY].every(n => Number.isInteger(n) && n >= 0 && n < 32)) { skip("outside-map"); continue; }
    const ids = activeMatrices.map(matrix => matrixX < matrix.width && matrixY < matrix.height ? matrix.cells[matrixY * matrix.width + matrixX].mapId : -1);
    ensure(ids[activeSeasonIndex] === chunk.chunkId, "Map assignments changed. Reload the map and try again.");
    yield {
      tileIndex: tileY * 32 + tileX,
      variants: [...new Set([chunk.chunkId, ...ids])].map(id => ({ id, season: id === chunk.chunkId ? undefined : MATRIX_SEASONS[ids.indexOf(id)] })),
    };
  }
}

/**
 * Plant a native tree with its top-left footprint tile at each anchor. Every seasonal variant of the chunk gets the
 * tree and blocked tiles, and every texture pack that can draw the chunk gets the tree's textures for its season.
 */
export async function placeMapTrees(project: ProjectState, scene: Map3dSceneData, anchors: readonly Map3dTile[], typeId: string, { isCurrent = () => true, allowBlocked = false }: TreeStrokeOptions = {}): Promise<TreeStroke> {
  const found = mapTreeType(typeId);
  ensure(found?.games.includes(project.session.baseRom as "BW" | "BW2"), "Choose a tree type for this game.");
  const type: MapTreeType = found!;
  const { result, skip } = startBrushStroke<TreeStroke>(emptyBrushStroke("place"));
  if (!anchors.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "tree");
  ensure(isCurrent(), "The map changed while placing trees. Try again.");
  const { game, source, rom, maps, textureId } = context;
  const { template, banks } = treeAssets(source, rom, type, game);
  const contents = new Map<number, MapBin>();
  const pending = new Map<number, { tileIndex: number; tiles: number[]; ground: number; mirrored: boolean }[]>();
  const occupied = new Map<number, Set<number>>();
  for (const { tileIndex, variants } of brushDestinations(scene, anchors, context, skip)) {
    const tiles = footprint(tileIndex, type.size);
    if (!tiles) { skip("outside-map"); continue; }
    const stroke: { id: number; ground: number; mirrored: boolean }[] = [];
    let failure: { reason: TreeSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      const bytes = maps.rawFiles[id];
      if (!bytes?.length) { failure = { reason: "missing-map", season }; break; }
      if (tiles.some(tile => occupied.get(id)?.has(tile))) { failure = { reason: "occupied", season }; break; }
      let map = contents.get(id);
      if (!map) { map = readGen5MapBin(bytes); contents.set(id, map); }
      const site = treeSite(map, tiles, game, { allowBlocked });
      if (typeof site === "string") { failure = { reason: site, season }; break; }
      stroke.push({ id, ...site });
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    for (const { id, ground, mirrored } of stroke) {
      pending.set(id, [...(pending.get(id) ?? []), { tileIndex, tiles, ground, mirrored }]);
      const used = occupied.get(id) ?? new Set<number>();
      tiles.forEach(tile => used.add(tile));
      occupied.set(id, used);
    }
    result.count++;
  }
  if (!pending.size) return result;

  for (const [id, trees] of pending) {
    const { signature, files } = contents.get(id)!;
    files[1] = files[1].slice();
    if (trees.some(tree => tree.mirrored)) files[2] = files[2].slice();
    const originalsBefore = project.mapTreeOriginalPermissions?.[id];
    const originalsAfter: ChunkTreeOriginals = { ...originalsBefore };
    const placements: TreePlacement[] = [];
    for (const { tileIndex, tiles, ground, mirrored } of trees) {
      const original: MapTreeOriginal = { type: type.id, tiles: [] };
      for (const index of tiles) {
        const tile: MapTreeOriginalTile = { index, ...permission(files[1], index) };
        writePermission(files[1], index, TREE_TILE);
        if (mirrored) {
          tile.secondary = permission(files[2], index);
          writePermission(files[2], index, TREE_TILE);
        }
        original.tiles.push(tile);
      }
      originalsAfter[treeTileKey(tileIndex, 1)] = original;
      placements.push({ tileIndex, ground, template });
    }
    files[0] = appendMapTrees(files[0], placements, 1);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), originalsBefore, originalsAfter });
  }

  const textureStore = project.narcs.map_textures
    ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
  const bindings = template.parts.map(part => part.record);
  for (const [id, season] of texturePacksFor(project, context, new Set(pending.keys()))) {
    const before = textureStore.rawFiles[id];
    ensure(before, `Map texture pack ${id} is missing.`);
    const after = addNativeTextures(before, banks.get(type.texturePacks[season])!, bindings);
    if (!equalMapBytes(after, before)) result.textures.push({ id, before: before.slice(), after });
  }
  if (result.textures.length) {
    project.narcs.map_textures = textureStore;
    project.session.fileIds.map_textures = textureId;
  }
  writeBrushStroke(project, TREES, result, false);
  return result;
}

/** Remove brush-placed trees that cover any of the given tiles, restoring the tiles they replaced. */
export async function removeMapTrees(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: TreeStrokeOptions = {}): Promise<TreeStroke> {
  const { result, skip } = startBrushStroke<TreeStroke>(emptyBrushStroke("remove"));
  if (!tiles.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "tree");
  ensure(isCurrent(), "The map changed while removing trees. Try again.");
  const { maps } = context;
  const chunks = new Map<number, { bin: MapBin; placed: ReturnType<typeof readPlacedMapTrees> }>();
  const read = (id: number) => {
    let chunk = chunks.get(id);
    if (!chunk) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      chunk = { bin, placed: readPlacedMapTrees(bin.files[0]) };
      chunks.set(id, chunk);
    }
    return chunk;
  };
  const pending = new Map<number, Map<number, MapTreeOriginal>>();
  const done = new Set<string>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    // Find the tree whose footprint covers the clicked tile in the edited chunk.
    const active = variants[0];
    if (!maps.rawFiles[active.id]?.length) { skip("missing-map"); continue; }
    const tree = [...read(active.id).placed.trees].find(([, tree]) => footprint(tree.tileIndex, tree.size)?.includes(tileIndex));
    if (!tree) continue; // A drag crosses plenty of tiles with no planted tree.
    const [key] = tree;
    const doneKey = `${variants.map(v => v.id).join(",")}:${key}`;
    if (done.has(doneKey)) continue;
    done.add(doneKey);
    const stroke = new Map<number, MapTreeOriginal>();
    let failure: { reason: TreeSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      if (!maps.rawFiles[id]?.length) { failure = { reason: "missing-map", season }; break; }
      const placed = read(id).placed.trees.get(key);
      if (!placed) continue;
      const saved = project.mapTreeOriginalPermissions?.[id]?.[key];
      if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
      if (saved.type !== placed.type?.id) { failure = { reason: "changed-tree", season }; break; }
      stroke.set(id, saved);
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) { skip("no-placed-tree"); continue; }
    for (const [id, original] of stroke) {
      const changes = pending.get(id) ?? new Map<number, MapTreeOriginal>();
      changes.set(key, original);
      pending.set(id, changes);
    }
    result.count++;
  }
  for (const [id, trees] of pending) {
    const { bin, placed } = chunks.get(id)!;
    const files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapTreeOriginalPermissions?.[id];
    const originals = { ...originalsBefore };
    for (const [key, { tiles }] of trees) {
      for (const tile of tiles) {
        writePermission(files[1], tile.index, tile);
        if (tile.secondary) writePermission(files[2], tile.index, tile.secondary);
      }
      delete originals[key];
    }
    files[0] = placed.remove(new Set(trees.keys()));
    const originalsAfter = Object.keys(originals).length ? originals : undefined;
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), originalsBefore, originalsAfter });
  }
  if (result.count) writeBrushStroke(project, TREES, result, false);
  return result;
}

const TREES: BrushStrokeKind<TreeStroke> = {
  originals: "mapTreeOriginalPermissions",
  thing: "tree",
  counted: countedAs("tree"),
  actions: { place: { done: "Placed", label: "Place Trees" }, remove: { done: "Removed", label: "Remove Trees" } },
};

export const undoMapTrees = (project: ProjectState, stroke: TreeStroke) => undoBrushStroke(project, TREES, stroke);
export const redoMapTrees = (project: ProjectState, stroke: TreeStroke) => redoBrushStroke(project, TREES, stroke);

/** Describe skipped footprints for the status line. */
export function describeTreeSkips(stroke: TreeStroke) {
  const words: Record<TreeSkipReason, string> = {
    "occupied": "overlap another tree", "blocked": "are blocked", "water": "are water", "existing-grass": "have grass",
    "special-terrain": "have special terrain", "split-height": "have split heights", "uneven-ground": "are not level",
    "multiple-surfaces": "have two walking levels", "missing-map": "have a missing seasonal map", "outside-map": "cross the map edge",
    "no-placed-tree": "have no placed tree", "missing-original-permissions": "have no saved tiles", "changed-tree": "were changed by hand",
  };
  return stroke.skipReasons.map(({ reason, count, season }) => `${count} ${words[reason]}${season ? ` in ${season}` : ""}`).join(", ");
}
