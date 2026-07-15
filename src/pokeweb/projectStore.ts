import { readU32 } from "../nds/binary";
import type { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { domainTitle, recordGenericChange } from "./actionChangelog";
import type { BaseRom, BaseVersion, NarcName } from "./constants";
import {
  BATTLE_TYPES,
  EGG_GROUPS,
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  GROWTHS,
  PROPERTIES,
  TRAINER_AIS,
  TRAINER_GENDERS,
  TRAINER_TEMPLATE_FLAGS,
  isGen4Project,
  moveCategoryNamesForProject,
  typeNamesForProject,
} from "./constants";
import type { FieldSpec, NarcFormatMap } from "./formats";
import type { HeaderCollection } from "./headerModel";
import type { GrottoOddsState } from "./martGrottoModel";
import type { ActionChangelogState } from "./actionChangelog";
import type { TextEntry } from "./text";
import type { TmState } from "./tmModel";
import { parseGen4EventFile } from "./gen4EventModel";
import { parseGen4MapFile } from "./gen4MapModel";
import { parseGen4MatrixFile } from "./gen4MatrixModel";
import { unpackExpandedPersonalAbilities } from "./personalAbilityPacking";

export type RawRecord = Record<string, number>;
export type ReadableRecord = Record<string, number | string>;

export type NarcRecord = {
  id: number;
  bytes: Uint8Array;
  raw?: RawRecord;
  readable?: ReadableRecord;
};

export type NarcStore = {
  name: NarcName;
  fileId: number;
  sourcePath: string;
  container?: "narc" | "file";
  fileCount: number;
  rawFiles: Uint8Array[];
  filenames?: Folder;
  records: Map<number, NarcRecord>;
  dirty: Set<number>;
  parseError?: string;
};

export type SessionSettings = {
  romName: string;
  generation?: "gen4" | "gen5";
  baseVersion: BaseVersion;
  baseRom: BaseRom;
  fairy: boolean;
  fileIds: Partial<Record<NarcName, number>>;
  blacklist: NarcName[];
};

export type TextState = {
  banks: Partial<Record<string, string[]>>;
  messageTexts?: TextEntry[][];
  storyTexts?: TextEntry[][];
};

export type DocGeneratorState = {
  romTitle: string;
  mastersheetMarkdown?: string;
  trainerLocations: Record<string, string[]>;
  trainerDiffs: Record<string, number>;
  itemLocations: Record<string, string[]>;
  groundItemScriptMap: Record<string, number>;
};

export type Map3dAreaEditState = Record<
  string,
  {
    buildingsId: number;
    texturesId: number;
    srtAnimeIdx: number;
    patAnimeIdx: number;
    isExterior: boolean;
  }
>;

export type FileSystemEditState = {
  replacements: Record<number, Uint8Array>;
  additions?: Record<string, Uint8Array>;
};

export type CodeInjectionState = {
  pmc?: {
    overlayId: number;
    overlayBaseAddress?: number;
    overlayPath: string;
    version?: string;
    gameId?: string;
    symbolPath?: string;
  };
  modules?: Array<{
    path: string;
    target: "patches" | "lib";
    fileName: string;
    version?: string;
    gameId?: string;
  }>;
};

export type PwanPaletteSource = "front" | "back";

export type PwanOverrideSide = {
  sourceFileName: string;
  sourceGifBytes: Uint8Array;
  pwanBytes: Uint8Array;
  scaleBasePwanBytes?: Uint8Array;
  offsetBasePwanBytes?: Uint8Array;
  visibleHeight: number;
  frameCount: number;
  uniqueFrameCount: number;
  timelineCount: number;
  totalTicks: number;
  paletteBgr555: Uint16Array;
  speedScale?: number;
  framesPerSecond?: number;
  scale?: number;
  scaleMode?: "nearest" | "outlineFill";
  outlineThreshold?: number;
  offsetX?: number;
  offsetY?: number;
  notes?: string[];
};

export type PwanAnimationOverride = {
  speciesId: number;
  formIndex?: number;
  assetIndex?: number;
  front?: PwanOverrideSide;
  back?: PwanOverrideSide;
  nativePaletteSource: PwanPaletteSource;
  carrierTemplate: "w2u-gen6-placeholder";
  backNcecY?: 43 | 48;
  notes?: string[];
};

export type PwanAnimationState = {
  dirty?: boolean;
  runtimeInstalled?: boolean;
  detectedArchive?: {
    path: string;
    version: number;
    count: number;
  };
  loadError?: string;
  overrides: PwanAnimationOverride[];
  nativeCarrierBackups?: Record<string, Uint8Array[]>;
};

export type StarterState = {
  speciesIds: number[];
  dirtyOverlayIds: number[];
};

export type PatchState = {
  dirtyOverlayIds: number[];
  arm9OverlayTable?: Uint8Array;
  applied?: {
    removeDustCloudGems?: boolean;
    removeDustCloudItems?: boolean;
    forgettableHms?: boolean;
    fairyType?: boolean;
    fairyModernTypings?: boolean;
    specifyTrainerNatures?: boolean;
    itemStandardization?: boolean;
  };
};

export type ProjectState = {
  originalRomBytes?: Uint8Array;
  session: SessionSettings;
  romInfo: {
    title: string;
    idCode: string;
    fileName: string;
    size: number;
  };
  arm9: Uint8Array;
  arm9Compressed?: boolean;
  arm9Dirty?: boolean;
  rigAtlas?: {
    width: number;
    height: number;
    expanded: boolean;
  };
  overlays: Partial<Record<number, Uint8Array>>;
  narcs: Partial<Record<NarcName, NarcStore>>;
  texts: TextState;
  formats: NarcFormatMap;
  trpokInfo: Array<{ template: number; numPokemon: number }>;
  headers?: HeaderCollection;
  grottoOdds?: GrottoOddsState;
  tms?: TmState;
  docs?: DocGeneratorState;
  map3dAreaEdits?: Map3dAreaEditState;
  fileSystem?: FileSystemEditState;
  codeInjection?: CodeInjectionState;
  pwanAnimations?: PwanAnimationState;
  starters?: StarterState;
  patches?: PatchState;
  actionChangelog?: ActionChangelogState;
};

export function createNarcStore(name: NarcName, sourcePath: string, fileId: number, narc: NARC): NarcStore {
  return {
    name,
    sourcePath,
    container: "narc",
    fileId,
    fileCount: narc.files.length,
    rawFiles: narc.files,
    filenames: narc.filenames,
    records: new Map(),
    dirty: new Set(),
  };
}

export function createFileStore(name: NarcName, sourcePath: string, fileId: number, bytes: Uint8Array): NarcStore {
  return {
    name,
    sourcePath,
    container: "file",
    fileId,
    fileCount: 1,
    rawFiles: [bytes],
    records: new Map(),
    dirty: new Set(),
  };
}

export function decodeRecord(project: ProjectState, name: NarcName, id: number): NarcRecord {
  const store = project.narcs[name];
  if (!store) throw new Error(`NARC is not loaded: ${name}`);
  const bytes = store.rawFiles[id];
  if (!bytes) throw new Error(`Record ${id} does not exist in ${name}`);

  const cached = store.records.get(id);
  if (cached?.raw && !(name === "trpok" && "difficulty_0" in cached.raw)) return cached;

  const record = cached ?? { id, bytes };
  record.raw = parseRawRecord(name, bytes, project, id);
  record.readable = toReadable(name, record.raw, project, id);
  store.records.set(id, record);
  return record;
}

export function markDirty(project: ProjectState, name: NarcName, id: number): void {
  project.narcs[name]?.dirty.add(id);
  if (GENERIC_DIRTY_DOMAINS.has(name)) {
    const title = domainTitle(name);
    recordGenericChange(project, name, `${title} file ${id} changed.`, undefined, { key: `generic-dirty:${name}:${id}` });
  }
}

const GENERIC_DIRTY_DOMAINS = new Set<NarcName>([
  "matrix",
  "move_spas",
  "habitats",
  "starter_sprites",
  "move_effects_table",
]);

export function getCachedRecordCount(project: ProjectState): number {
  return Object.values(project.narcs).reduce((sum, store) => sum + (store?.records.size ?? 0), 0);
}

function parseRawRecord(name: NarcName, bytes: Uint8Array, project: ProjectState, id: number): RawRecord {
  if (name === "trpok") return parseTrpok(bytes, project, id);
  if (name === "learnsets" && isGen4Project(project)) return parseGen4Learnset(bytes);
  if (name === "encounters" && isGen4Project(project)) return parseGen4Encounter(bytes, project);
  if (name === "maps" && isGen4Project(project)) return parseGen4MapFile(bytes, project.session.baseRom);
  if (name === "maps") return parseMap(bytes);
  if (name === "matrix" && isGen4Project(project)) return parseGen4MatrixFile(bytes);
  if (name === "matrix") return parseMatrix(bytes);
  if (name === "overworlds" && isGen4Project(project)) return parseGen4EventFile(bytes);
  if (name === "overworlds") return parseOverworlds(bytes);
  if (name === "trtext_table") return parseSingleFileTable(bytes, 4, ["trainer_id", "text_type"]);
  if (name === "trtext_offsets") return parseOffsetFile(bytes);

  const format = project.formats[name];
  if (!format) return { byteLength: bytes.length };
  const raw = readFormat(bytes, format, name);
  if (name === "personal" && isGen4Project(project)) enrichGen4PersonalRaw(raw);
  if (name === "personal" && !isGen4Project(project)) unpackExpandedPersonalAbilities(raw);
  return raw;
}

function readFormat(bytes: Uint8Array, format: FieldSpec[], name: NarcName): RawRecord {
  let offset = 0;
  const raw: RawRecord = {};
  for (const [size, field] of format) {
    if (offset + size > bytes.length) break;
    const value = readInt(bytes, offset, size);
    offset += size;
    if (name === "learnsets" && value === 65535) break;
    raw[field] = value;
    if (name === "encounters" && value === 0 && !field.startsWith("spring_")) {
      const springField = `spring_${field.split("_").slice(1).join("_")}`;
      raw[field] = raw[springField] ?? value;
    }
  }
  return raw;
}

function parseGen4Learnset(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = {};
  let offset = 0;
  let index = 0;
  while (offset + 2 <= bytes.length) {
    const packed = readInt(bytes, offset, 2);
    offset += 2;
    if (packed === 0xffff) break;
    raw[`move_id_${index}`] = packed & 0x01ff;
    raw[`lvl_learned_${index}`] = (packed >>> 9) & 0x7f;
    index += 1;
  }
  raw.entry_count = index;
  if (index > 20) raw.vanilla_limit_exceeded = 1;
  return raw;
}

function parseGen4Encounter(bytes: Uint8Array, project: ProjectState): RawRecord {
  return project.session.baseRom === "HGSS" ? parseHgssEncounter(bytes) : parseDpptEncounter(bytes);
}

function parseDpptEncounter(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = { byteLength: bytes.length };
  setAllSeason(raw, "grass_rate", readInt(bytes, 0, 4) & 0xff);
  for (let slot = 0; slot < 12; slot += 1) {
    const offset = 4 + slot * 8;
    setGen4SlotAllSeasons(raw, "grass", slot, readInt(bytes, offset + 4, 4), readInt(bytes, offset, 4) & 0xff, readInt(bytes, offset, 4) & 0xff);
  }

  parseGen4SpeciesOnlyGroup(raw, bytes, "swarm", 0x64, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "day", 0x6c, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "night", 0x74, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "poke_radar", 0x7c, 4, 4);
  for (let slot = 0; slot < 5; slot += 1) raw[`regional_form_${slot}`] = readInt(bytes, 0x8c + slot * 4, 4);
  raw.unknown_table = readInt(bytes, 0xa0, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "ruby", 0xa4, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "sapphire", 0xac, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "emerald", 0xb4, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "fire_red", 0xbc, 2, 4);
  parseGen4SpeciesOnlyGroup(raw, bytes, "leaf_green", 0xc4, 2, 4);
  parseDpptFishingGroup(raw, bytes, "surf", 0xcc, 0xd0);
  parseDpptFishingGroup(raw, bytes, "old_rod", 0x124, 0x128);
  parseDpptFishingGroup(raw, bytes, "good_rod", 0x150, 0x154);
  parseDpptFishingGroup(raw, bytes, "super_rod", 0x17c, 0x180);
  return raw;
}

function parseDpptFishingGroup(raw: RawRecord, bytes: Uint8Array, kind: string, rateOffset: number, slotsOffset: number): void {
  setAllSeason(raw, `${kind}_rate`, readInt(bytes, rateOffset, 4) & 0xff);
  for (let slot = 0; slot < 5; slot += 1) {
    const offset = slotsOffset + slot * 8;
    setGen4SlotAllSeasons(raw, kind, slot, readInt(bytes, offset + 4, 4), readInt(bytes, offset + 1, 1), readInt(bytes, offset, 1));
  }
}

function parseHgssEncounter(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = { byteLength: bytes.length };
  const walkingRate = readInt(bytes, 0, 1);
  setAllSeason(raw, "grass_rate", walkingRate);
  setAllSeason(raw, "grass_doubles_rate", walkingRate);
  setAllSeason(raw, "grass_special_rate", walkingRate);

  for (let slot = 0; slot < 12; slot += 1) {
    const level = readInt(bytes, 8 + slot, 1);
    setGen4SlotAllSeasons(raw, "grass", slot, readInt(bytes, 20 + slot * 2, 2), level, level);
    setGen4SlotAllSeasons(raw, "grass_doubles", slot, readInt(bytes, 44 + slot * 2, 2), level, level);
    setGen4SlotAllSeasons(raw, "grass_special", slot, readInt(bytes, 68 + slot * 2, 2), level, level);
  }

  parseGen4SpeciesOnlyGroup(raw, bytes, "hoenn_radio", 92, 2, 2);
  parseGen4SpeciesOnlyGroup(raw, bytes, "sinnoh_radio", 96, 2, 2);
  parseHgssWaterGroup(raw, bytes, "surf", 1, 100, 5);
  parseHgssWaterGroup(raw, bytes, "rock_smash", 2, 120, 2);
  parseHgssWaterGroup(raw, bytes, "old_rod", 3, 128, 5);
  parseHgssWaterGroup(raw, bytes, "good_rod", 4, 148, 5);
  parseHgssWaterGroup(raw, bytes, "super_rod", 5, 168, 5);
  parseGen4SpeciesOnlyGroup(raw, bytes, "swarm", 188, 4, 2);
  return raw;
}

function parseHgssWaterGroup(raw: RawRecord, bytes: Uint8Array, kind: string, rateOffset: number, slotsOffset: number, slotCount: number): void {
  setAllSeason(raw, `${kind}_rate`, readInt(bytes, rateOffset, 1));
  for (let slot = 0; slot < slotCount; slot += 1) {
    const offset = slotsOffset + slot * 4;
    setGen4SlotAllSeasons(raw, kind, slot, readInt(bytes, offset + 2, 2), readInt(bytes, offset, 1), readInt(bytes, offset + 1, 1));
  }
}

function setAllSeason(raw: RawRecord, suffix: string, value: number): void {
  for (const season of ENCOUNTER_SEASONS) raw[`${season}_${suffix}`] = value;
}

function setGen4SlotAllSeasons(raw: RawRecord, kind: string, slot: number, species: number, minLevel: number, maxLevel: number): void {
  setAllSeason(raw, `${kind}_slot_${slot}`, species);
  setAllSeason(raw, `${kind}_slot_${slot}_min_level`, minLevel);
  setAllSeason(raw, `${kind}_slot_${slot}_max_level`, maxLevel);
}

function parseGen4SpeciesOnlyGroup(raw: RawRecord, bytes: Uint8Array, kind: string, offset: number, slotCount: number, size: 2 | 4): void {
  for (let slot = 0; slot < slotCount; slot += 1) setAllSeason(raw, `${kind}_slot_${slot}`, readInt(bytes, offset + slot * size, size));
}

function enrichGen4PersonalRaw(raw: RawRecord): void {
  raw.item_3 ??= 0;
  raw.ability_3 ??= 0;
  raw.num_forms ??= 1;
  raw.height ??= 0;
  raw.weight ??= 0;
  raw.tutors ??= 0;
  raw.color = raw.color_flip & 0x7f;
  raw.flip = (raw.color_flip >>> 7) & 1;
}

function parseTrpok(bytes: Uint8Array, project: ProjectState, id: number): RawRecord {
  if (isGen4Project(project)) return parseGen4Trpok(bytes, project, id);
  const info = project.trpokInfo[id];
  const template = info?.template ?? 0;
  const numPokemon = info?.numPokemon ?? 0;
  const formats: FieldSpec[][] = [
    [
      [1, "ivs"],
      [1, "ability"],
      [1, "level"],
      [1, "padding"],
      [2, "species_id"],
      [2, "form"],
    ],
    [
      [1, "ivs"],
      [1, "ability"],
      [1, "level"],
      [1, "padding"],
      [2, "species_id"],
      [2, "form"],
      [2, "move_1"],
      [2, "move_2"],
      [2, "move_3"],
      [2, "move_4"],
    ],
    [
      [1, "ivs"],
      [1, "ability"],
      [1, "level"],
      [1, "padding"],
      [2, "species_id"],
      [2, "form"],
      [2, "item_id"],
    ],
    [
      [1, "ivs"],
      [1, "ability"],
      [1, "level"],
      [1, "padding"],
      [2, "species_id"],
      [2, "form"],
      [2, "item_id"],
      [2, "move_1"],
      [2, "move_2"],
      [2, "move_3"],
      [2, "move_4"],
    ],
  ];
  const format = formats[template] ?? formats[0];
  const raw: RawRecord = {};
  let offset = 0;
  for (let n = 0; n < numPokemon; n += 1) {
    for (const [size, field] of format) {
      raw[`${field}_${n}`] = readInt(bytes, offset, size);
      offset += size;
    }
  }
  return raw;
}

function parseGen4Trpok(bytes: Uint8Array, project: ProjectState, id: number): RawRecord {
  const info = project.trpokInfo[id];
  const template = info?.template ?? 0;
  const count = info?.numPokemon ?? 0;
  const hasMoves = (template & 1) !== 0;
  const hasItems = (template & 2) !== 0;
  const hasBallSeals = project.session.baseRom !== "DP";
  const raw: RawRecord = {};
  let offset = 0;

  for (let slot = 0; slot < count && offset + 6 <= bytes.length; slot += 1) {
    raw[`ivs_${slot}`] = readInt(bytes, offset, 1);
    raw[`ability_${slot}`] = readInt(bytes, offset + 1, 1);
    raw[`level_${slot}`] = readInt(bytes, offset + 2, 2);
    const mon = readInt(bytes, offset + 4, 2);
    raw[`species_id_${slot}`] = mon & 0x03ff;
    raw[`form_${slot}`] = mon >>> 10;
    offset += 6;

    if (hasItems && offset + 2 <= bytes.length) {
      raw[`item_id_${slot}`] = readInt(bytes, offset, 2);
      offset += 2;
    }
    if (hasMoves) {
      for (let move = 1; move <= 4 && offset + 2 <= bytes.length; move += 1) {
        raw[`move_${move}_${slot}`] = readInt(bytes, offset, 2);
        offset += 2;
      }
    }
    if (hasBallSeals && offset + 2 <= bytes.length) {
      raw[`ball_seals_${slot}`] = readInt(bytes, offset, 2);
      offset += 2;
    }
  }
  return raw;
}

function parseMap(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = {};
  const perOffset = readInt(bytes, 8, 4);
  raw.per_offset = perOffset;
  raw.width = readInt(bytes, perOffset, 2);
  raw.height = readInt(bytes, perOffset + 2, 2);

  let offset = perOffset + 4;
  const tileCount = raw.width * raw.height;
  for (let n = 0; n < tileCount; n += 1) {
    for (let layer = 0; layer < 4; layer += 1) {
      const tile = readInt(bytes, offset, 2);
      offset += 2;
      if (layer === 2 || layer === 3) raw[`layer_${layer}_${n}`] = tile;
    }
  }
  return raw;
}

function parseMatrix(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = {};
  raw.width = readInt(bytes, 4, 2);
  raw.height = readInt(bytes, 6, 2);
  let offset = 8;
  const count = raw.width * raw.height;
  for (let n = 0; n < count; n += 1) {
    raw[`map_${n}`] = readInt(bytes, offset, 4);
    offset += 4;
  }
  for (let n = 0; offset + 4 <= bytes.length && n < count; n += 1) {
    raw[`header_${n}`] = readInt(bytes, offset, 4);
    offset += 4;
  }
  return raw;
}

function parseOverworlds(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = {};
  const header: FieldSpec[] = [
    [4, "file_length"],
    [1, "furniture_count"],
    [1, "npc_count"],
    [1, "warp_count"],
    [1, "trigger_count"],
  ];
  const formats: Record<string, FieldSpec[]> = {
    furniture: [
      [2, "script_id"],
      [2, "unknown_1"],
      [2, "unknown_2"],
      [2, "unknown_3"],
      [2, "x_cord"],
      [2, "x_cord_padding"],
      [2, "y_cord"],
      [2, "y_cord_padding"],
      [4, "z_cord"],
    ],
    npc: [
      [2, "overworld_id"],
      [2, "overworld_sprite"],
      [2, "movement_permissions"],
      [2, "movement_permissions_2"],
      [2, "overworld_flag"],
      [2, "script_id"],
      [2, "direction"],
      [2, "sight"],
      [2, "unknown_1"],
      [2, "unknown_2"],
      [2, "horizontal_leash"],
      [2, "vertical_leash"],
      [2, "unknown_3"],
      [2, "unknown_4"],
      [2, "x_cord"],
      [2, "y_cord"],
      [2, "unknown_5"],
      [2, "z_cord"],
    ],
    warp: [
      [2, "map_id"],
      [2, "use_warp_cords"],
      [1, "contact_direction"],
      [1, "transition_type"],
      [4, "exit_x"],
      [4, "exit_y"],
      [2, "x_extension"],
      [2, "y_extension"],
      [2, "directionality"],
    ],
    trigger: [
      [2, "entity_id"],
      [2, "to_trigger_value"],
      [2, "to_check_value"],
      [2, "unknown_1"],
      [2, "unknown_2"],
      [2, "x_cord"],
      [2, "y_cord"],
      [2, "z_cord"],
      [2, "unknown_3"],
      [2, "unknown_4"],
      [2, "unknown_5"],
    ],
  };

  let offset = 0;
  for (const [size, field] of header) {
    raw[field] = readInt(bytes, offset, size);
    offset += size;
  }
  for (const group of ["furniture", "npc", "warp", "trigger"]) {
    const count = raw[`${group}_count`] ?? 0;
    for (let n = 0; n < count; n += 1) {
      for (const [size, field] of formats[group]) {
        raw[`${group}_${n}_${field}`] = readInt(bytes, offset, size);
        offset += size;
      }
    }
  }
  raw.footer_length = Math.max(0, bytes.length - offset);
  return raw;
}

function parseSingleFileTable(bytes: Uint8Array, stride: number, names: string[]): RawRecord {
  const raw: RawRecord = { count: Math.floor(bytes.length / stride) };
  for (let offset = 0, index = 0; offset + stride <= bytes.length; offset += stride, index += 1) {
    for (let field = 0; field < names.length; field += 1) {
      raw[`${names[field]}_${index}`] = readInt(bytes, offset + field * 2, 2);
    }
  }
  return raw;
}

function parseOffsetFile(bytes: Uint8Array): RawRecord {
  const raw: RawRecord = { count: Math.floor(bytes.length / 2) };
  for (let offset = 0, index = 0; offset + 2 <= bytes.length; offset += 2, index += 1) {
    raw[`offset_${index}`] = readInt(bytes, offset, 2);
  }
  return raw;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  if (size === 1) return bytes[offset] ?? 0;
  if (size === 2) return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
  if (size === 4) return readU32(bytes, offset);
  let value = 0;
  for (let i = 0; i < size; i += 1) value |= (bytes[offset + i] ?? 0) << (8 * i);
  return value >>> 0;
}

function toReadable(name: NarcName, raw: RawRecord, project: ProjectState, id: number): ReadableRecord {
  const readable: ReadableRecord = { ...raw, index: id };
  const texts = project.texts.banks;
  const pick = (bank: string, index: number, fallback = "") => texts[bank]?.[index] ?? fallback;

  if (name === "personal") {
    readable.name = pick("pokedex", id, id <= 649 ? `Pokemon ${id}` : "Alt Form");
    const typeNames = typeNamesForProject(project);
    readable.type_1 = typeNames[raw.type_1] ?? raw.type_1;
    readable.type_2 = typeNames[raw.type_2] ?? raw.type_2;
    readable.item_1 = pick("items", raw.item_1, String(raw.item_1 ?? 0));
    readable.item_2 = pick("items", raw.item_2, String(raw.item_2 ?? 0));
    readable.item_3 = pick("items", raw.item_3 ?? 0, String(raw.item_3 ?? 0));
    readable.ability_1 = pick("abilities", raw.ability_1, String(raw.ability_1 ?? 0));
    readable.ability_2 = pick("abilities", raw.ability_2, String(raw.ability_2 ?? 0));
    readable.ability_3 = pick("abilities", raw.ability_3 ?? 0, String(raw.ability_3 ?? 0));
    readable.exp_rate = GROWTHS[raw.exp_rate] ?? raw.exp_rate;
    readable.egg_group_1 = EGG_GROUPS[raw.egg_group_1] ?? raw.egg_group_1;
    readable.egg_group_2 = EGG_GROUPS[raw.egg_group_2] ?? raw.egg_group_2;
  }

  if (name === "moves") {
    readable.name = pick("moves", id, `Move ${id}`);
    readable.type = typeNamesForProject(project)[raw.type] ?? raw.type;
    readable.category = moveCategoryNamesForProject(project)[raw.category] ?? raw.category;
    let index = 14;
    const flags = raw.properties?.toString(2).padStart(index, "0") ?? "";
    for (const prop of PROPERTIES) {
      readable[prop] = Number(flags[index - 1] ?? 0);
      index -= 1;
    }
  }

  if (name === "items") readable.name = pick("items", id, `Item ${id}`);
  if (name === "headers") readable.location_name = pick("locations", raw.location_name_id, "Unknown Location");
  if (name === "learnsets") {
    for (const key of Object.keys(raw)) {
      if (key.startsWith("move_id_")) readable[key] = pick("moves", raw[key], String(raw[key]));
    }
  }
  if (name === "move_effects_table") {
    for (const key of Object.keys(raw)) {
      if (key.startsWith("move_id_")) readable[key] = pick("moves", raw[key], String(raw[key]));
    }
  }
  if (name === "trdata") {
    readable.name = pick("tr_names", id, `Trainer ${id}`);
    readable.class = pick("tr_classes", raw.class, String(raw.class));
    readable.class_id = raw.class;
    readable.battle_type_1 = BATTLE_TYPES[raw.battle_type_1] ?? raw.battle_type_1;
    for (let n = 1; n <= 4; n += 1) readable[`item_${n}`] = pick("items", raw[`item_${n}`], String(raw[`item_${n}`]));
    readable.reward_item = pick("items", raw.reward_item, String(raw.reward_item));
    let templateBit = 2;
    const templateFlags = raw.template?.toString(2).padStart(templateBit, "0") ?? "";
    for (const flag of TRAINER_TEMPLATE_FLAGS) {
      readable[flag] = Number(templateFlags[templateBit - 1] ?? 0);
      templateBit -= 1;
    }
    let aiBit = 14;
    const aiFlags = raw.ai?.toString(2).padStart(aiBit, "0") ?? "";
    for (const ai of TRAINER_AIS) {
      readable[ai] = Number(aiFlags[aiBit - 1] ?? 0);
      aiBit -= 1;
    }
  }
  if (name === "trpok") {
    for (const key of Object.keys(raw)) {
      if (key.startsWith("species_id_")) readable[key] = pick("pokedex", raw[key] % 1024, String(raw[key]));
      if (key.startsWith("item_id_")) readable[key] = pick("items", raw[key], String(raw[key]));
      if (key.startsWith("move_")) readable[key] = pick("moves", raw[key], String(raw[key]));
      if (key.startsWith("ability_")) {
        const value = raw[key] === 255 ? 0 : raw[key];
        raw[key] = value;
        readable[key] = Math.floor(value / 16);
        readable[`gender_${key.split("_")[1]}`] = TRAINER_GENDERS[Math.min(value % 16, 2)] ?? "Default";
      }
    }
    readable.count = project.trpokInfo[id]?.numPokemon ?? 0;
    readable.template = project.trpokInfo[id]?.template ?? 0;
  }
  if (name === "encounters") {
    const pokedex = texts.pokedex ?? [];
    for (const season of ENCOUNTER_SEASONS) {
      for (const kind of ENCOUNTER_GRASS_FIELDS) {
        for (let n = 0; n < 12; n += 1) decodeEncounterSpecies(readable, raw, pokedex, `${season}_${kind}_slot_${n}`);
      }
      for (const kind of ENCOUNTER_WATER_FIELDS) {
        for (let n = 0; n < 5; n += 1) decodeEncounterSpecies(readable, raw, pokedex, `${season}_${kind}_slot_${n}`);
      }
    }
  }

  return readable;
}

function decodeEncounterSpecies(readable: ReadableRecord, raw: RawRecord, pokedex: string[], field: string): void {
  const value = raw[field] ?? 0;
  const speciesId = value % 2048;
  readable[field] = speciesId === 0 ? "" : (pokedex[speciesId] ?? String(speciesId));
  readable[`${field}_form`] = Math.floor(value / 2048);
}
