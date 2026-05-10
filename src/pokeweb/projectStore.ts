import { readU32 } from "../nds/binary";
import type { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import type { BaseRom, BaseVersion, NarcName } from "./constants";
import {
  BATTLE_TYPES,
  CATEGORIES,
  EGG_GROUPS,
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  GROWTHS,
  PROPERTIES,
  TRAINER_AIS,
  TRAINER_GENDERS,
  TRAINER_TEMPLATE_FLAGS,
  TYPES,
} from "./constants";
import type { FieldSpec, NarcFormatMap } from "./formats";
import type { HeaderCollection } from "./headerModel";
import type { GrottoOddsState } from "./martGrottoModel";
import type { Gen5TextEntry } from "./text";
import type { TmState } from "./tmModel";

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
  fileCount: number;
  rawFiles: Uint8Array[];
  filenames?: Folder;
  records: Map<number, NarcRecord>;
  dirty: Set<number>;
  parseError?: string;
};

export type SessionSettings = {
  romName: string;
  baseVersion: BaseVersion;
  baseRom: BaseRom;
  fairy: boolean;
  fileIds: Partial<Record<NarcName, number>>;
  blacklist: NarcName[];
};

export type TextState = {
  banks: Partial<Record<string, string[]>>;
  messageTexts?: Gen5TextEntry[][];
  storyTexts?: Gen5TextEntry[][];
};

export type DocGeneratorState = {
  romTitle: string;
  trainerLocations: Record<string, string[]>;
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
  arm9Dirty?: boolean;
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
};

export function createNarcStore(name: NarcName, sourcePath: string, fileId: number, narc: NARC): NarcStore {
  return {
    name,
    sourcePath,
    fileId,
    fileCount: narc.files.length,
    rawFiles: narc.files,
    filenames: narc.filenames,
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
}

export function getCachedRecordCount(project: ProjectState): number {
  return Object.values(project.narcs).reduce((sum, store) => sum + (store?.records.size ?? 0), 0);
}

function parseRawRecord(name: NarcName, bytes: Uint8Array, project: ProjectState, id: number): RawRecord {
  if (name === "trpok") return parseTrpok(bytes, project.trpokInfo[id]);
  if (name === "maps") return parseMap(bytes);
  if (name === "matrix") return parseMatrix(bytes);
  if (name === "overworlds") return parseOverworlds(bytes);
  if (name === "trtext_table") return parseSingleFileTable(bytes, 4, ["trainer_id", "text_type"]);
  if (name === "trtext_offsets") return parseOffsetFile(bytes);

  const format = project.formats[name];
  if (!format) return { byteLength: bytes.length };
  return readFormat(bytes, format, name);
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

function parseTrpok(bytes: Uint8Array, info?: { template: number; numPokemon: number }): RawRecord {
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
    readable.type_1 = TYPES[raw.type_1] ?? raw.type_1;
    readable.type_2 = TYPES[raw.type_2] ?? raw.type_2;
    readable.item_1 = pick("items", raw.item_1, String(raw.item_1));
    readable.item_2 = pick("items", raw.item_2, String(raw.item_2));
    readable.item_3 = pick("items", raw.item_3, String(raw.item_3));
    readable.ability_1 = pick("abilities", raw.ability_1, String(raw.ability_1));
    readable.ability_2 = pick("abilities", raw.ability_2, String(raw.ability_2));
    readable.ability_3 = pick("abilities", raw.ability_3, String(raw.ability_3));
    readable.exp_rate = GROWTHS[raw.exp_rate] ?? raw.exp_rate;
    readable.egg_group_1 = EGG_GROUPS[raw.egg_group_1] ?? raw.egg_group_1;
    readable.egg_group_2 = EGG_GROUPS[raw.egg_group_2] ?? raw.egg_group_2;
  }

  if (name === "moves") {
    readable.name = pick("moves", id, `Move ${id}`);
    readable.type = TYPES[raw.type] ?? raw.type;
    readable.category = CATEGORIES[raw.category] ?? raw.category;
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
