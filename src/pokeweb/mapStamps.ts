import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { gen5HeightAt } from "./gen5MapHeightGeneration";
import { equalMapBytes, readGen5MapBin } from "./gen5MapImportFormats";
import { extractGameFreakContainer, packGameFreakContainer, parseAreaHeader, readNitroResources, type Map3dSceneData, type Map3dTile } from "./map3dModel";
import { appendBrushPieces, brushPieceKey, nativeFaces, readBrushPieces, rootIsIdentity, type BrushKind, type BrushMember, type BrushPart, type BrushVertex } from "./mapBrushGeometry";
import { areasFor, mapBrushContext, texturePacksFor } from "./mapGrass";
import { getRomFileBytes as romFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { appendSrtTracks, srtTrackNames } from "./mapTextureSrt";
import { MAP_STAMP_TYPES, mapStampType, stampBlocked, stampSize, type MapStampType, type StampRotation } from "./mapStampCatalog";
import { addNativeTextures, brushDestinations, PALETTE_BYTES, snapGround, TREE_TILE, treeSite, type MapTreeOriginalTile, type NativeTextureBinding, type TreeSkipReason } from "./mapTrees";
import { ensure, type NativeMaterialRecord } from "./nitroResourceWriter";
import { createNarcStore, type ProjectState } from "./projectStore";
import { MATRIX_SEASONS, seasonalAreaId, type MatrixSeason } from "./seasonalMatrixModel";
import { countedAs, emptyBrushStroke, permission, redoBrushStroke, startBrushStroke, undoBrushStroke, writeBrushStroke, writePermission, type BrushFileChange, type BrushStrokeKind, type BrushStroke } from "./mapBrushStroke";

/**
 * Stamps: single native objects (see mapStampCatalog) cut from the source ROM and placed on a footprint, turned in
 * quarter turns. They live in shapes "s1_<native material>" with one tagged run per stamp. The tiles the donor
 * blocks get the native blocked tile; the rest of the footprint keeps its tiles.
 */
export const STAMP_BRUSH: BrushKind = { prefixes: { 1: "s1_", 2: "s2_" }, magic: 0x7c, tool: "stamp brush" };
const MAPS_PATH = "a/0/0/8";
const MAP_TEXTURES_PATH = "a/0/1/4";
const AREA_PATH = "a/0/1/3";
const SRT_PATH = "a/0/6/8";
const TILE = 16;

type Bank = ReturnType<typeof readNitroResources>;
type MapBin = ReturnType<typeof readGen5MapBin>;

/** Positions are relative to the unturned footprint's top-left corner and the donor's ground. */
export type MapStampTemplate = { type: MapStampType; parts: BrushPart[] };
export type StampPlacement = { tileIndex: number; ground: number; rotation: StampRotation; template: MapStampTemplate };

/** Tag payload: footprint top-left tile, quarter turns, and the catalog entry (1-based). */
const stampPayload = (tileIndex: number, rotation: StampRotation, type: MapStampType) =>
  tileIndex | (rotation << 10) | ((MAP_STAMP_TYPES.indexOf(type) + 1) << 12);

export function cutMapStamp(donorModel: Uint8Array, type: MapStampType, ground: number): MapStampTemplate {
  const changed = `The source ROM's ${type.label.toLowerCase()} (map ${type.donor.map}) is not the vanilla object.`;
  ensure(rootIsIdentity(donorModel), changed);
  const [bx0, bx1, bz0, bz1] = type.donor.box, slack = 1.5;
  const x0 = (type.donor.tileX - 16) * TILE, z0 = (type.donor.tileY - 16) * TILE;
  const inside = ([x, , z]: readonly number[]) => x >= bx0 - slack && x <= bx1 + slack && z >= bz0 - slack && z <= bz1 + slack;
  const parts = nativeFaces(donorModel, type.materials, "stamp brush").map(part => ({
    ...part,
    faces: part.faces.filter(face => face.every(vertex => inside(vertex.position)))
      .map(face => face.map(vertex => ({ ...vertex, position: [vertex.position[0] - x0, vertex.position[1] - ground, vertex.position[2] - z0] as const }))),
  })).filter(part => part.faces.length);
  const count = parts.reduce((total, part) => total + part.faces.reduce((sum, face) => sum + face.length - 2, 0), 0);
  ensure(count === type.donor.faces, changed);
  return { type, parts };
}

const s10 = (value: number) => (value << 22) >> 22;
/** Turn a packed normal (x, y, z as signed 10-bit) a quarter turn clockwise about y: (x, z) → (−z, x). */
function turnNormal(normal: number) {
  const x = s10(normal), y = s10(normal >>> 10), z = s10(normal >>> 20);
  const nx = Math.min(511, -z);
  return ((nx & 1023) | ((y & 1023) << 10) | ((x & 1023) << 20)) >>> 0;
}

/** The template's faces turned `rotation` quarter turns clockwise inside its footprint, which stays at the origin. */
export function turnStampParts(template: MapStampTemplate, rotation: StampRotation): BrushPart[] {
  let [width, depth] = stampSize(template.type);
  let parts = template.parts;
  for (let turn = 0; turn < rotation; turn++) {
    const span = depth * TILE;
    parts = parts.map(part => ({
      ...part,
      faces: part.faces.map(face => face.map((vertex): BrushVertex => ({
        ...vertex,
        position: [span - vertex.position[2], vertex.position[1], vertex.position[0]],
        ...(vertex.normal !== undefined ? { normal: turnNormal(vertex.normal) } : {}),
      }))),
    }));
    [width, depth] = [depth, width];
  }
  return parts;
}

export function appendMapStamps(modelFile: Uint8Array, stamps: readonly StampPlacement[], member: BrushMember = 1) {
  return appendBrushPieces(modelFile, STAMP_BRUSH, stamps.map(({ tileIndex, ground, rotation, template }) => {
    const x0 = (tileIndex % 32 - 16) * TILE, z0 = (Math.floor(tileIndex / 32) - 16) * TILE;
    return {
      payload: stampPayload(tileIndex, rotation, template.type),
      parts: turnStampParts(template, rotation).map(part => ({
        ...part,
        faces: part.faces.map(face => face.map(vertex => ({ ...vertex, position: [x0 + vertex.position[0], ground + vertex.position[1], z0 + vertex.position[2]] as const }))),
      })),
    };
  }), member);
}

export type PlacedMapStamp = { type?: MapStampType; member: BrushMember; tileIndex: number; rotation: StampRotation };

/** The tiles a stamp's turned footprint covers, or undefined when it crosses the chunk edge. */
export function stampTiles(type: Pick<MapStampType, "blocked">, rotation: StampRotation, tileIndex: number) {
  const [width, depth] = stampSize(type, rotation), x = tileIndex % 32, y = Math.floor(tileIndex / 32);
  if (x + width > 32 || y + depth > 32) return undefined;
  return Array.from({ length: width * depth }, (_, i) => ({ index: (y + Math.floor(i / width)) * 32 + x + i % width, blocked: stampBlocked(type, rotation, i % width, Math.floor(i / width)) }));
}

/** Stamps placed by the brush, keyed by brushPieceKey. */
export function readPlacedMapStamps(file: Uint8Array) {
  const read = readBrushPieces(file, STAMP_BRUSH);
  const stamps = new Map<number, PlacedMapStamp>();
  for (const [key, { member, payload }] of read.pieces) {
    stamps.set(key, { type: MAP_STAMP_TYPES[((payload >>> 12) & 255) - 1], member, tileIndex: payload & 1023, rotation: ((payload >>> 10) & 3) as StampRotation });
  }
  return { stamps, remove: read.remove };
}

// ---------- Source assets ----------

/** `srt` is the donor area's texture animation when it animates some of the stamp's materials (`animated`). */
type StampAssets = { template: MapStampTemplate; ground: number; banks: Record<MatrixSeason, Bank>; srt?: Uint8Array; animated: Set<string> };
const stockStamps = new WeakMap<Uint8Array, Map<string, StampAssets>>();

/** The template and, per season, the donor area's texture pack (a season without the textures uses the nearest that has them). */
function stampAssets(source: Uint8Array, rom: NintendoDSRom, type: MapStampType, game: "BW" | "BW2"): StampAssets {
  let cache = stockStamps.get(source);
  if (!cache) { cache = new Map(); stockStamps.set(source, cache); }
  let assets = cache.get(type.id);
  if (!assets) {
    const donor = new NARC(rom.getFileByName(MAPS_PATH)).files[type.donor.map];
    ensure(donor?.length, `The source ROM is missing the ${type.label.toLowerCase()}'s donor map.`);
    const files = extractGameFreakContainer(donor).files;
    const ground = snapGround(gen5HeightAt(files[1], type.donor.tileY * 32 + type.donor.tileX, 0, 0, game) * 16);
    const template = cutMapStamp(files[0], type, ground);
    const areas = rom.getFileByName(AREA_PATH);
    const names = template.parts.map(part => part.record.textureName).filter((name): name is string => !!name);
    const banks = donorSeasonBanks(rom, game, type.donor.area, names, type.label);
    const srtIndex = parseAreaHeader(areas, seasonalAreaId(game, type.donor.area, "spring")).srtAnimeIdx;
    const srt = srtIndex === 255 ? undefined : new NARC(rom.getFileByName(SRT_PATH)).files[srtIndex];
    let tracks = new Set<string>();
    try { tracks = new Set(srt?.length ? srtTrackNames(srt) : []); } catch { /* An unreadable donor animation leaves the art still. */ }
    const animated = new Set(type.materials.filter(name => tracks.has(name)));
    assets = { template, ground, banks, srt: animated.size ? srt : undefined, animated };
    cache.set(type.id, assets);
  }
  return assets;
}

/** Per season, the donor area's texture pack; a season without the textures uses the nearest one that has them. */
export function donorSeasonBanks(rom: NintendoDSRom, game: "BW" | "BW2", area: number, names: readonly string[], label: string): Record<MatrixSeason, Bank> {
  const packs = new NARC(rom.getFileByName(MAP_TEXTURES_PATH)).files, areas = rom.getFileByName(AREA_PATH);
  const candidates = MATRIX_SEASONS.map(season => {
    const id = parseAreaHeader(areas, seasonalAreaId(game, area, season)).texturesId;
    const bank = packs[id]?.length ? readNitroResources(packs[id]) : undefined;
    return bank && names.every(name => bank.textures.some(texture => texture.name === name)) ? bank : undefined;
  });
  const fallback = candidates.find(Boolean);
  ensure(fallback, `The source ROM is missing the ${label.toLowerCase()}'s textures.`);
  return Object.fromEntries(MATRIX_SEASONS.map((season, i) => {
    const nearest = candidates[i] ?? [1, 2, 3].map(step => candidates[(i - step + 4) % 4]).find(Boolean) ?? fallback;
    return [season, nearest];
  })) as Record<MatrixSeason, Bank>;
}

const textureLike = (a: Bank["textures"][number], b: Bank["textures"][number]) =>
  a.params.width() === b.params.width() && a.params.height() === b.params.height() && a.params.format() === b.params.format() && equalMapBytes(a.data1, b.data1);

function paletteBytes(bank: Bank, name: string | undefined, format: number) {
  const palette = name ? bank.palettes.find(p => p.name === name) : undefined, length = PALETTE_BYTES[format];
  return palette && length ? palette.block.slice(palette.offset, palette.offset + length) : undefined;
}

/**
 * Bind each stamp material to texture names every destination pack can hold. A pack that already has a different
 * texture or palette under the donor's name (another area's "stake", say) gets the art under a new name instead.
 */
export function stampBindings(records: readonly NativeMaterialRecord[], packs: readonly { bank: Bank; donor: Bank }[]) {
  return records.map(record => {
    const texture = record.textureName, palette = record.paletteName;
    if (!texture) return { record, binding: {} as NativeTextureBinding };
    const fits = (textureName: string, paletteName: string | undefined) => packs.every(({ bank, donor }) => {
      const source = donor.textures.find(t => t.name === texture);
      if (!source) return false;
      const existing = bank.textures.find(t => t.name === textureName);
      if (existing && !textureLike(existing, source)) return false;
      const ours = paletteBytes(bank, paletteName, source.params.format()), theirs = paletteBytes(donor, palette, source.params.format());
      return !ours || !theirs || equalMapBytes(ours, theirs);
    });
    for (let k = 0; k < 10; k++) {
      const suffix = k ? `_s${k}` : "";
      const textureName = k ? `${texture.slice(0, 13)}${suffix}` : texture;
      const paletteName = palette && k ? `${palette.slice(0, 13)}${suffix}` : palette;
      if (!fits(textureName, paletteName)) continue;
      return {
        record: k ? { ...record, name: `${record.name.slice(0, 10)}${suffix}`, textureName, paletteName } : record,
        binding: { textureName, paletteName, sourceTextureName: texture, sourcePaletteName: palette },
      };
    }
    throw new Error(`Map texture packs already use the name ${texture} for other art.`);
  });
}

// ---------- Strokes ----------

export type MapStampOriginal = { type: string; rotation: StampRotation; tiles: MapTreeOriginalTile[] };
type ChunkStampOriginals = Record<number, MapStampOriginal>;
export type MapStampOriginalPermissions = Record<number, ChunkStampOriginals>;
export type StampSkipReason = TreeSkipReason | "no-placed-stamp" | "changed-stamp";
/**
 * `animations` replaces the whole texture animation archive when the stamp's native animation was added to the
 * destination areas; `stillAreas` counts destination areas with no animation file, where the art stays still.
 */
export type StampStroke = BrushStroke<"place" | "remove", StampSkipReason, ChunkStampOriginals> & { animations?: BrushFileChange; stillAreas?: number };
type StampStrokeOptions = { isCurrent?: () => boolean; allowBlocked?: boolean };

/** Tiles covered by stamps already in a chunk. */
function stampedTiles(model: Uint8Array) {
  const covered = new Set<number>();
  for (const stamp of readPlacedMapStamps(model).stamps.values()) {
    if (stamp.type) stampTiles(stamp.type, stamp.rotation, stamp.tileIndex)?.forEach(tile => covered.add(tile.index));
  }
  return covered;
}

/**
 * Place a stamp with its turned footprint's top-left tile at each anchor. Every seasonal variant of the chunk gets
 * it, and every texture pack that can draw the chunk gets its textures for that season.
 */
export async function placeMapStamps(project: ProjectState, scene: Map3dSceneData, anchors: readonly Map3dTile[], typeId: string, rotation: StampRotation, { isCurrent = () => true, allowBlocked = false }: StampStrokeOptions = {}): Promise<StampStroke> {
  const found = mapStampType(typeId);
  ensure(found && project.session.baseRom === "BW2", "Choose an object for this game.");
  const type: MapStampType = found!;
  const turn = (type.rotatable ? rotation : 0) as StampRotation;
  const { result, skip } = startBrushStroke<StampStroke>(emptyBrushStroke("place"));
  if (!anchors.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "stamp");
  ensure(isCurrent(), "The map changed while placing objects. Try again.");
  const { game, source, rom, maps, textureId } = context;
  const { template, banks, srt, animated } = stampAssets(source, rom, type, game);
  const contents = new Map<number, { map: MapBin; covered: Set<number> }>();
  const pending = new Map<number, { tileIndex: number; tiles: { index: number; blocked: boolean }[]; ground: number; mirrored: boolean }[]>();
  for (const { tileIndex, variants } of brushDestinations(scene, anchors, context, skip)) {
    const tiles = stampTiles(type, turn, tileIndex);
    if (!tiles) { skip("outside-map"); continue; }
    const stroke: { id: number; ground: number; mirrored: boolean }[] = [];
    let failure: { reason: StampSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      const bytes = maps.rawFiles[id];
      if (!bytes?.length) { failure = { reason: "missing-map", season }; break; }
      let content = contents.get(id);
      if (!content) { const map = readGen5MapBin(bytes); content = { map, covered: stampedTiles(map.files[0]) }; contents.set(id, content); }
      if (tiles.some(tile => content!.covered.has(tile.index))) { failure = { reason: "occupied", season }; break; }
      const site = treeSite(content.map, tiles.map(tile => tile.index), game, { allowBlocked });
      if (typeof site === "string") { failure = { reason: site, season }; break; }
      stroke.push({ id, ...site });
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    for (const { id, ground, mirrored } of stroke) {
      pending.set(id, [...(pending.get(id) ?? []), { tileIndex, tiles, ground, mirrored }]);
      tiles.forEach(tile => contents.get(id)!.covered.add(tile.index));
    }
    result.count++;
  }
  if (!pending.size) return result;

  const textureStore = project.narcs.map_textures
    ?? createNarcStore("map_textures", MAP_TEXTURES_PATH, textureId, new NARC(getRomFileBytes(project, rom, textureId)));
  const packs = [...texturePacksFor(project, context, new Set(pending.keys()))].map(([id, season]) => {
    const bytes = textureStore.rawFiles[id];
    ensure(bytes, `Map texture pack ${id} is missing.`);
    return { id, season, bytes, bank: readNitroResources(bytes), donor: banks[season] };
  });
  const bound = stampBindings(template.parts.map(part => part.record), packs);
  // Animated materials keep their native name (unless renamed) so the area's track for that name moves them.
  const placed: MapStampTemplate = { type, parts: template.parts.map((part, i) => ({ ...part, record: bound[i].record,
    nativeName: animated.has(part.record.name) && bound[i].record.name === part.record.name })) };

  for (const [id, stamps] of pending) {
    const { map: { signature, files } } = contents.get(id)!;
    files[1] = files[1].slice();
    if (stamps.some(stamp => stamp.mirrored)) files[2] = files[2].slice();
    const originalsBefore = project.mapStampOriginalPermissions?.[id];
    const originalsAfter: ChunkStampOriginals = { ...originalsBefore };
    const placements: StampPlacement[] = [];
    for (const { tileIndex, tiles, ground, mirrored } of stamps) {
      const original: MapStampOriginal = { type: type.id, rotation: turn, tiles: [] };
      for (const { index, blocked } of tiles) {
        if (!blocked) continue;
        const tile: MapTreeOriginalTile = { index, ...permission(files[1], index) };
        writePermission(files[1], index, TREE_TILE);
        if (mirrored) {
          tile.secondary = permission(files[2], index);
          writePermission(files[2], index, TREE_TILE);
        }
        original.tiles.push(tile);
      }
      originalsAfter[brushPieceKey(stampPayload(tileIndex, turn, type), 1)] = original;
      placements.push({ tileIndex, ground, rotation: turn, template: placed });
    }
    files[0] = appendMapStamps(files[0], placements, 1);
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(signature, files), originalsBefore, originalsAfter });
  }

  for (const { id, season, bytes } of packs) {
    const after = addNativeTextures(bytes, banks[season], bound.map(entry => entry.binding));
    if (!equalMapBytes(after, bytes)) result.textures.push({ id, before: bytes.slice(), after });
  }
  if (result.textures.length) {
    project.narcs.map_textures = textureStore;
    project.session.fileIds.map_textures = textureId;
  }
  if (srt && placed.parts.some(part => part.nativeName)) {
    const srtId = rom.fileId(SRT_PATH), before = romFileBytes(project, rom, srtId), archive = new NARC(before);
    const names = placed.parts.filter(part => part.nativeName).map(part => part.record.name);
    const indices = new Set(areasFor(project, context, new Set(pending.keys())).map(({ area, season }) => context.areaHeader(area, season).srtAnimeIdx));
    let changed = false;
    for (const index of indices) {
      if (index === 255 || !archive.files[index]?.length) { result.stillAreas = (result.stillAreas ?? 0) + 1; continue; }
      const next = appendSrtTracks(archive.files[index], srt, names);
      if (next !== archive.files[index]) { archive.files[index] = next; changed = true; }
    }
    if (changed) result.animations = { id: srtId, before: before.slice(), after: archive.save() };
  }
  writeBrushStroke(project, STAMPS, result, false);
  return result;
}

/** Remove brush-placed stamps whose footprint covers any of the given tiles, restoring the tiles they blocked. */
export async function removeMapStamps(project: ProjectState, scene: Map3dSceneData, tiles: readonly Map3dTile[], { isCurrent = () => true }: StampStrokeOptions = {}): Promise<StampStroke> {
  const { result, skip } = startBrushStroke<StampStroke>(emptyBrushStroke("remove"));
  if (!tiles.length) return result;
  const context = await mapBrushContext(project, scene, isCurrent, "stamp");
  ensure(isCurrent(), "The map changed while removing objects. Try again.");
  const { maps } = context;
  const chunks = new Map<number, { bin: MapBin; placed: ReturnType<typeof readPlacedMapStamps> }>();
  const read = (id: number) => {
    let chunk = chunks.get(id);
    if (!chunk) {
      const bin = readGen5MapBin(maps.rawFiles[id]);
      chunk = { bin, placed: readPlacedMapStamps(bin.files[0]) };
      chunks.set(id, chunk);
    }
    return chunk;
  };
  const pending = new Map<number, Map<number, MapStampOriginal>>();
  const done = new Set<string>();
  for (const { tileIndex, variants } of brushDestinations(scene, tiles, context, skip)) {
    if (!maps.rawFiles[variants[0].id]?.length) { skip("missing-map"); continue; }
    const found = [...read(variants[0].id).placed.stamps].find(([, stamp]) => stamp.type && stampTiles(stamp.type, stamp.rotation, stamp.tileIndex)?.some(tile => tile.index === tileIndex));
    if (!found) continue; // A drag crosses plenty of tiles with no stamp.
    const [key] = found;
    const doneKey = `${variants.map(v => v.id).join(",")}:${key}`;
    if (done.has(doneKey)) continue;
    done.add(doneKey);
    const stroke = new Map<number, MapStampOriginal>();
    let failure: { reason: StampSkipReason; season?: MatrixSeason } | undefined;
    for (const { id, season } of variants) {
      if (!maps.rawFiles[id]?.length) { failure = { reason: "missing-map", season }; break; }
      const placed = read(id).placed.stamps.get(key);
      if (!placed) continue;
      const saved = project.mapStampOriginalPermissions?.[id]?.[key];
      if (!saved) { failure = { reason: "missing-original-permissions", season }; break; }
      if (saved.type !== placed.type?.id || saved.rotation !== placed.rotation) { failure = { reason: "changed-stamp", season }; break; }
      stroke.set(id, saved);
    }
    if (failure) { skip(failure.reason, failure.season); continue; }
    if (!stroke.size) continue;
    for (const [id, original] of stroke) pending.set(id, (pending.get(id) ?? new Map()).set(key, original));
    result.count++;
  }
  for (const [id, stamps] of pending) {
    const { bin, placed } = chunks.get(id)!;
    const files = bin.files.slice();
    files[1] = files[1].slice();
    if (bin.placements === 3) files[2] = files[2].slice();
    const originalsBefore = project.mapStampOriginalPermissions?.[id];
    const originals = { ...originalsBefore };
    for (const [key, { tiles: saved }] of stamps) {
      for (const tile of saved) {
        writePermission(files[1], tile.index, tile);
        if (tile.secondary) writePermission(files[2], tile.index, tile.secondary);
      }
      delete originals[key];
    }
    files[0] = placed.remove(new Set(stamps.keys()));
    result.maps.push({ id, before: maps.rawFiles[id].slice(), after: packGameFreakContainer(bin.signature, files), originalsBefore, originalsAfter: Object.keys(originals).length ? originals : undefined });
  }
  if (result.count) writeBrushStroke(project, STAMPS, result, false);
  return result;
}

const STAMPS: BrushStrokeKind<StampStroke> = {
  originals: "mapStampOriginalPermissions",
  thing: "object",
  counted: countedAs("object"),
  actions: { place: { done: "Placed", label: "Place Objects" }, remove: { done: "Removed", label: "Remove Objects" } },
  changesAssets: stroke => !!(stroke.textures.length || stroke.animations),
  extra: {
    what: "Map texture animations",
    matches(project, stroke, side) {
      if (!stroke.animations) return true;
      const current = project.fileSystem?.replacements?.[stroke.animations.id];
      // Before the first edit the archive may still be the ROM's own file, which has no replacement entry.
      return current ? equalMapBytes(current, stroke.animations[side]) : side === "before";
    },
    write(project, stroke, undo) {
      if (stroke.animations) setRomFileReplacement(project, stroke.animations.id, (undo ? stroke.animations.before : stroke.animations.after).slice());
    },
  },
};

export const undoMapStamps = (project: ProjectState, stroke: StampStroke) => undoBrushStroke(project, STAMPS, stroke);
export const redoMapStamps = (project: ProjectState, stroke: StampStroke) => redoBrushStroke(project, STAMPS, stroke);

