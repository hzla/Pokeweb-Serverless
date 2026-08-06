import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange } from "./actionChangelog";
import { NATURES, type NarcName } from "./constants";
import { findPokemonSpeciesId, pokemonSpeciesLabel, pokemonSpeciesNameOptions } from "./pokemonLabels";
import { markDirty, type ProjectState } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";

export type BattleFacilityGroup = "subwayPwt" | "wbt";
export type FacilitySetNarcName = "subway_sets" | "pwt_sets_0" | "pwt_sets_3" | "pwt_sets_6" | "pwt_sets_7" | "wbt_sets";
export type FacilityChoiceNarcName = "subway_trainers" | "pwt_map_1" | "pwt_map_2" | "pwt_tr1" | "pwt_tr6" | "wbt_trainers";
export type FacilityAreaPoolNarcName = "wbt_area_pools";

export type BattleFacilitySet = {
  id: number;
  narc: FacilitySetNarcName;
  speciesId: number;
  speciesName: string;
  spriteSlug: string;
  moves: Array<{ id: number; name: string }>;
  evSpread: number;
  evStats: boolean[];
  natureId: number;
  natureName: string;
  itemId: number;
  itemName: string;
  form: number;
  rawHex: string;
};

export type BattleFacilityChoiceRecord = {
  id: number;
  narc: FacilityChoiceNarcName;
  label: string;
  trainerType: number;
  trainerTypeName: string;
  count: number;
  setIds: number[];
  extraValues: number[];
  byteLength: number;
  rawHex: string;
  setLibrary?: FacilitySetNarcName;
  invalidSetIds: number[];
};

export type BattleFacilityRegulationRecord = {
  id: number;
  label: string;
  cupNo: number;
  ruleNo: number;
  numLo: number;
  numHi: number;
  level: number;
  levelRange: number;
  levelRangeName: string;
  levelTotal: number;
  battleType: number;
  battleTypeName: string;
  battleCount: number;
  byteLength: number;
  rawHex: string;
  note?: string;
};

export type BattleFacilityAreaPoolValue = {
  offset: number;
  value: number;
  isTrainerRef: boolean;
  trainerTypeName?: string;
  setCount?: number;
  byteLength?: number;
};

export type BattleFacilityAreaPool = {
  index: number;
  startOffset: number;
  endOffset: number;
  values: BattleFacilityAreaPoolValue[];
  trainerRefCount: number;
};

export type BattleFacilityAreaPoolRecord = {
  id: number;
  narc: FacilityAreaPoolNarcName;
  recordId: number;
  headerValues: number[];
  pools: BattleFacilityAreaPool[];
  byteLength: number;
  rawHex: string;
};

export type BattleFacilityAutofills = {
  pokemon_names: string[];
  move_names: string[];
  items: string[];
  natures: string[];
  set_libraries: string[];
  trainer_types: string[];
};

export const SUBWAY_PWT_SET_NARCS: FacilitySetNarcName[] = ["subway_sets", "pwt_sets_0", "pwt_sets_3", "pwt_sets_6", "pwt_sets_7"];
export const SUBWAY_PWT_CHOICE_NARCS: FacilityChoiceNarcName[] = ["subway_trainers", "pwt_map_1", "pwt_map_2", "pwt_tr1", "pwt_tr6"];
export const WBT_SET_NARCS: FacilitySetNarcName[] = ["wbt_sets"];
export const WBT_CHOICE_NARCS: FacilityChoiceNarcName[] = ["wbt_trainers"];
export const FACILITY_SET_NARCS: FacilitySetNarcName[] = [...SUBWAY_PWT_SET_NARCS, ...WBT_SET_NARCS];
export const FACILITY_CHOICE_NARCS: FacilityChoiceNarcName[] = [...SUBWAY_PWT_CHOICE_NARCS, ...WBT_CHOICE_NARCS];

export const FACILITY_SET_LABELS: Record<FacilitySetNarcName, string> = {
  subway_sets: "Battle Subway Sets",
  pwt_sets_0: "PWT Sets 0",
  pwt_sets_3: "PWT Sets 3",
  pwt_sets_6: "PWT Sets 6",
  pwt_sets_7: "PWT Sets 7",
  wbt_sets: "Black Tower / White Treehollow Sets",
};

export const FACILITY_CHOICE_LABELS: Record<FacilityChoiceNarcName, string> = {
  subway_trainers: "Battle Subway Trainers",
  pwt_map_1: "PWT Map 1",
  pwt_map_2: "PWT Map 2",
  pwt_tr1: "PWT 1v1 Choices",
  pwt_tr6: "PWT 6v6 Choices",
  wbt_trainers: "Black Tower / White Treehollow Trainers",
};

export function facilityChoiceUsesTrainerClass(narc: FacilityChoiceNarcName): boolean {
  return narc === "subway_trainers" || narc === "wbt_trainers";
}

const EV_STAT_LABELS = ["HP", "Attack", "Defense", "Speed", "Sp. Attack", "Sp. Defense"];
const SET_RECORD_LENGTH = 0x10;
const REGULATION_RECORD_LENGTH = 0xbc;
const WBT_AREA_POOL_RECORD_LENGTH = 0x698;
const WBT_AREA_POOL_DATA_OFFSET = 0x60;
const PWT_LEVEL_REGULATION_ID = 37;
const REGULATION_LEVEL_RANGE_LABELS = ["Normal", "Minimum", "Maximum", "Scale Down", "Set Level", "Scale Up"];
const REGULATION_BATTLE_TYPE_LABELS = ["Single", "Double", "Triple", "Rotation", "Multi", "Shooter"];
const REGULATION_LABELS = [
  "Lv.50 Single",
  "Lv.50 Double",
  "Lv.50 Triple",
  "Lv.50 Rotation",
  "Lv.50 Multi",
  "Free Single",
  "Free Double",
  "Free Triple",
  "Free Rotation",
  "Free Multi",
  "Standard Single",
  "Standard Double",
  "Standard Triple",
  "Standard Rotation",
  "Standard Multi",
  "Random Single",
  "Random Double",
  "Random Triple",
  "Random Rotation",
  "Random Triple Shooter",
  "Subway Single",
  "Subway Double",
  "Subway Multi",
  "Debug Battle",
  "Flat Single",
  "Flat Double",
  "Flat Triple",
  "Flat Rotation",
  "Flat Multi",
];
const ENGLISH_TRAINER_TYPE_NAMES = [
  "Pokemon Trainer (Male)",
  "Pokemon Trainer (Female)",
  "Youngster",
  "Lass",
  "School Kid (Male)",
  "School Kid (Female)",
  "Tennis Player",
  "Footballer",
  "Waiter",
  "Waitress",
  "Gym Leader",
  "Gym Leader",
  "Gym Leader",
  "Nursery Aide",
  "Preschooler (Female)",
  "Preschooler (Male)",
  "Twins",
  "Pokemon Breeder (Male)",
  "Pokemon Breeder (Female)",
  "Gym Leader",
  "Gym Leader",
  "Gym Leader",
  "Gym Leader",
  "Gym Leader",
  "Pokemon Ranger (Male)",
  "Pokemon Ranger (Female)",
  "Worker",
  "Backpacker (Male)",
  "Backpacker (Female)",
  "Fisherman",
  "Musician",
  "Dancer",
  "Harlequin",
  "Artist",
  "Baker",
  "Psychic (Male)",
  "Psychic (Female)",
  "Pokemon Trainer",
  "Pokemon Trainer",
  "Team Plasma Grunt (Male)",
  "Pokemon Trainer",
  "Rich Boy",
  "Lady",
  "Pilot",
  "Worker",
  "Hoopster",
  "Scientist (Female)",
  "Team Plasma Boss",
  "Office Worker (Female)",
  "Ace Trainer (Female)",
  "Ace Trainer (Male)",
  "Black Belt",
  "Scientist (Male)",
  "Striker",
  "Gym Leader",
  "Gym Leader",
  "Gym Leader",
  "Roughneck",
  "Janitor",
  "Pokemon Fan (Male)",
  "Pokemon Fan (Female)",
  "Doctor",
  "Nurse",
  "Baseball Player",
  "Battle Girl",
  "Parasol Lady",
  "Businessman",
  "Businessman",
  "Pokemon Fan (Male)",
  "Pokemon Fan (Female)",
  "Veteran (Male)",
  "Veteran (Female)",
  "Biker",
  "Baseball Player",
  "Hiker",
  "Madame",
  "Gentleman",
  "Team Plasma Grunt (Female)",
  "Elite Four",
  "Elite Four",
  "Elite Four",
  "Elite Four",
  "Team Plasma Sage",
  "Depot Agent",
  "Swimmer (Male)",
  "Swimmer (Female)",
  "Police Officer",
  "Maid",
  "Subway Boss",
  "Champion",
  "Cyclist (Male)",
  "Cyclist (Female)",
  "Biker",
  "School Kid",
  "Veteran",
  "Madame",
  "Gentleman",
  "Game Freak",
  "Lady",
  "Rich Boy",
  "Pokemon Trainer",
  "Team Plasma Boss",
  "Subway Boss",
  "Pokemon Trainer (Male)",
  "Pokemon Trainer (Female)",
];

export function getFacilitySetNarcOptions(project: ProjectState, group?: BattleFacilityGroup): FacilitySetNarcName[] {
  return setNarcsForGroup(group).filter((name) => Boolean(project.narcs[name]));
}

export function getFacilityChoiceNarcOptions(project: ProjectState, group?: BattleFacilityGroup): FacilityChoiceNarcName[] {
  return choiceNarcsForGroup(group).filter((name) => Boolean(project.narcs[name]));
}

export function getFacilityAutofills(project: ProjectState): BattleFacilityAutofills {
  return {
    pokemon_names: pokemonSpeciesNameOptions(project),
    move_names: project.texts.banks.moves ?? [],
    items: project.texts.banks.items ?? [],
    natures: NATURES,
    set_libraries: FACILITY_SET_NARCS.map((name) => `${FACILITY_SET_LABELS[name]} (${name})`),
    trainer_types: getFacilityTrainerTypeOptions(project).map((option) => `${option.label} (${option.id})`),
  };
}

export function getFacilityTrainerTypeOptions(project: ProjectState): Array<{ id: number; label: string }> {
  const romClassCount = project.texts.banks.tr_classes?.length ?? 0;
  const optionCount = Math.max(romClassCount, ENGLISH_TRAINER_TYPE_NAMES.length);
  return Array.from({ length: optionCount }, (_unused, id) => ({ id, label: trainerTypeName(project, id) }));
}

export function trainerTypeName(project: ProjectState, id: number): string {
  return ENGLISH_TRAINER_TYPE_NAMES[id] ?? project.texts.banks.tr_classes?.[id] ?? `Trainer Type ${id}`;
}

export function getFacilitySetCount(project: ProjectState, narc: FacilitySetNarcName): number {
  return project.narcs[narc]?.fileCount ?? 0;
}

export function getFacilityChoiceCount(project: ProjectState, narc: FacilityChoiceNarcName): number {
  return project.narcs[narc]?.fileCount ?? 0;
}

export function getFacilityAreaPoolCount(project: ProjectState): number {
  const store = project.narcs.wbt_area_pools;
  if (!store) return 0;
  return store.rawFiles.filter((file) => file.length === WBT_AREA_POOL_RECORD_LENGTH).length;
}

export function getFacilitySetRecord(project: ProjectState, narc: FacilitySetNarcName, id: number): BattleFacilitySet {
  const bytes = getRawFile(project, narc, id);
  if (bytes.length !== SET_RECORD_LENGTH) throw new Error(`${FACILITY_SET_LABELS[narc]} record ${id} is ${bytes.length} bytes, expected 16`);
  const speciesId = readU16(bytes, 0);
  const moves = [0, 1, 2, 3].map((index) => {
    const moveId = readU16(bytes, 2 + index * 2);
    return { id: moveId, name: labelFromBank(project, "moves", moveId, `Move ${moveId}`) };
  });
  const evSpread = bytes[10] ?? 0;
  const natureId = bytes[11] ?? 0;
  const itemId = readU16(bytes, 12);
  const form = readU16(bytes, 14);
  const speciesName = pokemonSpeciesLabel(project, speciesId);
  return {
    id,
    narc,
    speciesId,
    speciesName,
    spriteSlug: pokemonSpriteSlug(speciesName),
    moves,
    evSpread,
    evStats: EV_STAT_LABELS.map((_label, index) => Boolean(evSpread & (1 << index))),
    natureId,
    natureName: NATURES[natureId] ?? `Nature ${natureId}`,
    itemId,
    itemName: labelFromBank(project, "items", itemId, `Item ${itemId}`),
    form,
    rawHex: bytesToHex(bytes),
  };
}

export function getFacilityChoiceRecord(project: ProjectState, narc: FacilityChoiceNarcName, id: number): BattleFacilityChoiceRecord {
  const bytes = getRawFile(project, narc, id);
  const values = readU16Values(bytes);
  const trainerType = values[0] ?? 0;
  const count = values[1] ?? 0;
  const declaredSetIds = values.slice(2, 2 + Math.min(count, Math.max(0, values.length - 2)));
  const extraValues = values.slice(2 + declaredSetIds.length);
  const setLibrary = defaultSetLibraryForChoice(project, narc);
  const maxSetId = setLibrary ? getFacilitySetCount(project, setLibrary) - 1 : -1;
  const invalidSetIds = maxSetId >= 0 ? declaredSetIds.filter((setId) => setId < 0 || setId > maxSetId) : [];
  return {
    id,
    narc,
    label: `${FACILITY_CHOICE_LABELS[narc]} ${id}`,
    trainerType,
    trainerTypeName: facilityChoiceUsesTrainerClass(narc) ? trainerTypeName(project, trainerType) : `Header ${trainerType}`,
    count,
    setIds: declaredSetIds,
    extraValues,
    byteLength: bytes.length,
    rawHex: bytesToHex(bytes),
    setLibrary,
    invalidSetIds,
  };
}

export function getFacilityRegulationCount(project: ProjectState): number {
  return project.narcs.regulations?.fileCount ?? 0;
}

export function getFacilityRegulationRecord(project: ProjectState, id: number): BattleFacilityRegulationRecord {
  const bytes = getRawFile(project, "regulations", id);
  if (bytes.length !== REGULATION_RECORD_LENGTH) throw new Error(`Regulation record ${id} is ${bytes.length} bytes, expected ${REGULATION_RECORD_LENGTH}`);
  const levelRange = bytes[5] ?? 0;
  const battleType = bytes[0xba] ?? 0;
  return {
    id,
    label: regulationLabel(id),
    cupNo: bytes[0] ?? 0,
    ruleNo: bytes[1] ?? 0,
    numLo: bytes[2] ?? 0,
    numHi: bytes[3] ?? 0,
    level: bytes[4] ?? 0,
    levelRange,
    levelRangeName: REGULATION_LEVEL_RANGE_LABELS[levelRange] ?? `Mode ${levelRange}`,
    levelTotal: readU16(bytes, 6),
    battleType,
    battleTypeName: REGULATION_BATTLE_TYPE_LABELS[battleType] ?? `Type ${battleType}`,
    battleCount: bytes[0xbb] ?? 0,
    byteLength: bytes.length,
    rawHex: bytesToHex(bytes),
    note: id === PWT_LEVEL_REGULATION_ID ? "PWT built-in Lv.25 regulation" : undefined,
  };
}

export function getFacilityAreaPoolRecord(project: ProjectState, id: number): BattleFacilityAreaPoolRecord {
  const bytes = getRawFile(project, "wbt_area_pools", id);
  if (bytes.length !== WBT_AREA_POOL_RECORD_LENGTH) {
    throw new Error(`Black Tower / White Treehollow area pool record ${id} is ${bytes.length} bytes, expected ${WBT_AREA_POOL_RECORD_LENGTH}`);
  }
  return {
    id,
    narc: "wbt_area_pools",
    recordId: readU16(bytes, 0),
    headerValues: readU16Values(bytes.subarray(0, Math.min(bytes.length, WBT_AREA_POOL_DATA_OFFSET))),
    pools: parseWbtAreaPools(project, bytes),
    byteLength: bytes.length,
    rawHex: bytesToHex(bytes),
  };
}

export function updateFacilitySetField(
  project: ProjectState,
  narc: FacilitySetNarcName,
  id: number,
  field: string,
  inputValue: string | number | boolean,
): BattleFacilitySet {
  const beforeRecord = getFacilitySetRecord(project, narc, id);
  const bytes = getRawFile(project, narc, id).slice();
  if (bytes.length !== SET_RECORD_LENGTH) throw new Error(`${FACILITY_SET_LABELS[narc]} record ${id} is ${bytes.length} bytes, expected 16`);

  if (field === "species") {
    writeU16(bytes, 0, findPokemonSpeciesId(project, String(inputValue), 65535));
  } else if (/^move_[0-3]$/u.test(field)) {
    const moveIndex = Number(field.slice("move_".length));
    writeU16(bytes, 2 + moveIndex * 2, findValueIndex(project.texts.banks.moves ?? [], String(inputValue), "move"));
  } else if (field === "evSpread") {
    bytes[10] = parseInteger(String(inputValue), 0, 255);
  } else if (/^ev_[0-5]$/u.test(field)) {
    const statIndex = Number(field.slice("ev_".length));
    const mask = 1 << statIndex;
    bytes[10] = truthyValue(inputValue) ? (bytes[10] ?? 0) | mask : (bytes[10] ?? 0) & ~mask;
  } else if (field === "nature") {
    bytes[11] = parseNatureId(String(inputValue));
  } else if (field === "item") {
    writeU16(bytes, 12, findValueIndex(project.texts.banks.items ?? [], String(inputValue), "item"));
  } else if (field === "form") {
    writeU16(bytes, 14, parseInteger(String(inputValue), 0, 65535));
  } else if (field === "rawHex") {
    const next = hexToBytes(String(inputValue), SET_RECORD_LENGTH);
    bytes.set(next);
  } else {
    throw new Error(`Unsupported facility set field: ${field}`);
  }

  setRawFile(project, narc, id, bytes);
  const afterRecord = getFacilitySetRecord(project, narc, id);
  recordFieldChange(project, narc, `${FACILITY_SET_LABELS[narc]} ${id}`, facilityFieldLabel(field), facilitySetFieldValue(beforeRecord, field), facilitySetFieldValue(afterRecord, field), {
    key: `facility-set:${narc}:${id}:${field}`,
  });
  return afterRecord;
}

export function updateFacilityChoiceField(
  project: ProjectState,
  narc: FacilityChoiceNarcName,
  id: number,
  field: string,
  inputValue: string | number,
): BattleFacilityChoiceRecord {
  const beforeRecord = getFacilityChoiceRecord(project, narc, id);
  const bytes = getRawFile(project, narc, id).slice();
  const values = readU16Values(bytes);
  if (field === "trainerType") {
    writeU16(bytes, 0, parseTrainerTypeId(project, String(inputValue)));
  } else if (field === "count") {
    writeU16(bytes, 2, parseInteger(String(inputValue), 0, 65535));
  } else if (/^set_\d+$/u.test(field)) {
    const index = Number(field.slice("set_".length));
    const offset = 4 + index * 2;
    if (offset + 2 > bytes.length) throw new Error(`Choice record ${id} has no set slot ${index}`);
    writeU16(bytes, offset, parseInteger(String(inputValue), 0, 65535));
  } else if (/^extra_\d+$/u.test(field)) {
    const index = Number(field.slice("extra_".length));
    const setCount = values[1] ?? 0;
    const offset = 4 + setCount * 2 + index * 2;
    if (offset + 2 > bytes.length) throw new Error(`Choice record ${id} has no extra slot ${index}`);
    writeU16(bytes, offset, parseInteger(String(inputValue), 0, 65535));
  } else if (field === "rawHex") {
    const next = hexToBytes(String(inputValue), bytes.length);
    bytes.set(next);
  } else {
    throw new Error(`Unsupported facility choice field: ${field}`);
  }

  setRawFile(project, narc, id, bytes);
  const afterRecord = getFacilityChoiceRecord(project, narc, id);
  recordFieldChange(project, narc, `${FACILITY_CHOICE_LABELS[narc]} ${id}`, facilityFieldLabel(field), facilityChoiceFieldValue(beforeRecord, field), facilityChoiceFieldValue(afterRecord, field), {
    key: `facility-choice:${narc}:${id}:${field}`,
  });
  return afterRecord;
}

export function updateFacilityRegulationField(project: ProjectState, id: number, field: string, inputValue: string | number): BattleFacilityRegulationRecord {
  const beforeRecord = getFacilityRegulationRecord(project, id);
  const bytes = getRawFile(project, "regulations", id).slice();
  if (bytes.length !== REGULATION_RECORD_LENGTH) throw new Error(`Regulation record ${id} is ${bytes.length} bytes, expected ${REGULATION_RECORD_LENGTH}`);

  if (field === "level") {
    bytes[4] = parseInteger(String(inputValue), 0, 100);
  } else if (field === "levelRange") {
    bytes[5] = parseInteger(String(inputValue), 0, 255);
  } else if (field === "levelTotal") {
    writeU16(bytes, 6, parseInteger(String(inputValue), 0, 65535));
  } else if (field === "numLo") {
    bytes[2] = parseInteger(String(inputValue), 0, 6);
  } else if (field === "numHi") {
    bytes[3] = parseInteger(String(inputValue), 0, 6);
  } else if (field === "battleType") {
    bytes[0xba] = parseInteger(String(inputValue), 0, 255);
  } else if (field === "battleCount") {
    bytes[0xbb] = parseInteger(String(inputValue), 0, 255);
  } else if (field === "rawHex") {
    const next = hexToBytes(String(inputValue), REGULATION_RECORD_LENGTH);
    bytes.set(next);
  } else {
    throw new Error(`Unsupported regulation field: ${field}`);
  }

  setRawFile(project, "regulations", id, bytes);
  const afterRecord = getFacilityRegulationRecord(project, id);
  recordFieldChange(
    project,
    "regulations",
    `Regulation ${id}${afterRecord.note ? ` (${afterRecord.note})` : ""}`,
    facilityFieldLabel(field),
    regulationFieldValue(beforeRecord, field),
    regulationFieldValue(afterRecord, field),
    { key: `facility-regulation:${id}:${field}` },
  );
  return afterRecord;
}

export function updateFacilityAreaPoolValue(project: ProjectState, id: number, offset: number, inputValue: string | number): BattleFacilityAreaPoolRecord {
  const beforeRecord = getFacilityAreaPoolRecord(project, id);
  const bytes = getRawFile(project, "wbt_area_pools", id).slice();
  if (offset < WBT_AREA_POOL_DATA_OFFSET || offset + 2 > bytes.length || offset % 2 !== 0) throw new Error(`Invalid area-pool value offset: 0x${offset.toString(16)}`);
  const beforeValue = readU16(bytes, offset);
  writeU16(bytes, offset, parseInteger(String(inputValue), 0, 65535));
  setRawFile(project, "wbt_area_pools", id, bytes);
  const afterRecord = getFacilityAreaPoolRecord(project, id);
  const afterValue = readU16(bytes, offset);
  recordFieldChange(project, "wbt_area_pools", `Area pool record ${beforeRecord.recordId}`, `Value @ 0x${offset.toString(16).padStart(4, "0")}`, beforeValue, afterValue, {
    key: `facility-area-pool:${id}:${offset}`,
  });
  return afterRecord;
}

export function facilitySetMatchesSearch(set: BattleFacilitySet, searchText: string): boolean {
  const haystack = [
    set.id,
    FACILITY_SET_LABELS[set.narc],
    set.speciesId,
    set.speciesName,
    set.itemId,
    set.itemName,
    set.natureName,
    set.form,
    ...set.moves.flatMap((move) => [move.id, move.name]),
  ]
    .join(" ")
    .toLowerCase();
  return matchesTerms(haystack, searchText);
}

export function facilityRegulationMatchesSearch(record: BattleFacilityRegulationRecord, searchText: string): boolean {
  const haystack = [
    record.id,
    record.label,
    record.note,
    record.cupNo,
    record.ruleNo,
    record.numLo,
    record.numHi,
    record.level,
    record.levelRange,
    record.levelRangeName,
    record.levelTotal,
    record.battleType,
    record.battleTypeName,
    record.battleCount,
  ]
    .join(" ")
    .toLowerCase();
  return matchesTerms(haystack, searchText);
}

export function facilityChoiceMatchesSearch(choice: BattleFacilityChoiceRecord, searchText: string): boolean {
  const haystack = [
    choice.id,
    FACILITY_CHOICE_LABELS[choice.narc],
    choice.trainerType,
    choice.trainerTypeName,
    choice.count,
    choice.byteLength,
    ...choice.setIds,
    ...choice.extraValues,
  ]
    .join(" ")
    .toLowerCase();
  return matchesTerms(haystack, searchText);
}

export function facilityAreaPoolMatchesSearch(record: BattleFacilityAreaPoolRecord, searchText: string): boolean {
  const haystack = [
    record.id,
    record.recordId,
    ...record.headerValues,
    ...record.pools.flatMap((pool) => [pool.index, pool.startOffset, ...pool.values.flatMap((value) => [value.value, value.trainerTypeName ?? ""])]),
  ]
    .join(" ")
    .toLowerCase();
  return matchesTerms(haystack, searchText);
}

export function evStatLabels(): string[] {
  return EV_STAT_LABELS;
}

export function isBossFacilityChoice(choice: BattleFacilityChoiceRecord): boolean {
  return choice.narc === "wbt_trainers" && choice.count === 3 && choice.byteLength === 10;
}

export function defaultSetLibraryForChoice(project: ProjectState, narc: FacilityChoiceNarcName): FacilitySetNarcName | undefined {
  const candidates: FacilitySetNarcName[] =
    narc === "subway_trainers"
      ? ["subway_sets"]
      : narc === "wbt_trainers"
        ? ["wbt_sets"]
      : narc === "pwt_tr1"
        ? ["pwt_sets_3", "pwt_sets_0", "pwt_sets_6", "pwt_sets_7"]
      : narc === "pwt_tr6"
        ? ["pwt_sets_6", "pwt_sets_3", "pwt_sets_0", "pwt_sets_7"]
      : ["pwt_sets_0", "pwt_sets_3", "pwt_sets_6", "pwt_sets_7"];
  return candidates.find((name) => Boolean(project.narcs[name]));
}

function setNarcsForGroup(group?: BattleFacilityGroup): FacilitySetNarcName[] {
  if (group === "subwayPwt") return SUBWAY_PWT_SET_NARCS;
  if (group === "wbt") return WBT_SET_NARCS;
  return FACILITY_SET_NARCS;
}

function choiceNarcsForGroup(group?: BattleFacilityGroup): FacilityChoiceNarcName[] {
  if (group === "subwayPwt") return SUBWAY_PWT_CHOICE_NARCS;
  if (group === "wbt") return WBT_CHOICE_NARCS;
  return FACILITY_CHOICE_NARCS;
}

function parseWbtAreaPools(project: ProjectState, bytes: Uint8Array): BattleFacilityAreaPool[] {
  const pools: BattleFacilityAreaPool[] = [];
  let offset = WBT_AREA_POOL_DATA_OFFSET;
  while (offset + 2 <= bytes.length) {
    while (offset + 2 <= bytes.length && readU16(bytes, offset) === 0xffff) offset += 2;
    const startOffset = offset;
    const values: BattleFacilityAreaPoolValue[] = [];
    while (offset + 2 <= bytes.length) {
      const value = readU16(bytes, offset);
      if (value === 0xffff) break;
      values.push(areaPoolValue(project, offset, value));
      offset += 2;
    }
    const trainerRefCount = values.filter((value) => value.isTrainerRef).length;
    if (values.length >= 3 && trainerRefCount >= 2) {
      pools.push({
        index: pools.length,
        startOffset,
        endOffset: offset,
        values,
        trainerRefCount,
      });
    }
  }
  return pools;
}

function areaPoolValue(project: ProjectState, offset: number, value: number): BattleFacilityAreaPoolValue {
  const choiceStore = project.narcs.wbt_trainers;
  if (!choiceStore || value >= choiceStore.fileCount) return { offset, value, isTrainerRef: false };
  try {
    const choice = getFacilityChoiceRecord(project, "wbt_trainers", value);
    const isTrainerRef = choice.byteLength === 44 && choice.count === 20;
    return {
      offset,
      value,
      isTrainerRef,
      trainerTypeName: choice.trainerTypeName,
      setCount: choice.count,
      byteLength: choice.byteLength,
    };
  } catch {
    return { offset, value, isTrainerRef: false };
  }
}

function getRawFile(project: ProjectState, narc: NarcName, id: number): Uint8Array {
  const store = project.narcs[narc];
  if (!store) throw new Error(`NARC is not loaded: ${narc}`);
  const bytes = store.rawFiles[id];
  if (!bytes) throw new Error(`Record ${id} does not exist in ${narc}`);
  return bytes;
}

function setRawFile(project: ProjectState, narc: NarcName, id: number, bytes: Uint8Array): void {
  const store = project.narcs[narc];
  if (!store) throw new Error(`NARC is not loaded: ${narc}`);
  store.rawFiles[id] = bytes;
  store.records.delete(id);
  markDirty(project, narc, id);
}

function facilitySetFieldValue(record: BattleFacilitySet, field: string): string | number | boolean {
  if (field === "species") return record.speciesName;
  if (/^move_[0-3]$/u.test(field)) return record.moves[Number(field.slice("move_".length))]?.name ?? "";
  if (field === "evSpread") return record.evSpread;
  if (/^ev_[0-5]$/u.test(field)) return record.evStats[Number(field.slice("ev_".length))] ?? false;
  if (field === "nature") return record.natureName;
  if (field === "item") return record.itemName;
  if (field === "form") return record.form;
  if (field === "rawHex") return record.rawHex;
  return "";
}

function facilityChoiceFieldValue(record: BattleFacilityChoiceRecord, field: string): string | number {
  if (field === "trainerType") return record.trainerTypeName;
  if (field === "count") return record.count;
  if (/^set_\d+$/u.test(field)) return record.setIds[Number(field.slice("set_".length))] ?? "";
  if (/^extra_\d+$/u.test(field)) return record.extraValues[Number(field.slice("extra_".length))] ?? "";
  if (field === "rawHex") return record.rawHex;
  return "";
}

function regulationFieldValue(record: BattleFacilityRegulationRecord, field: string): string | number {
  if (field === "level") return record.level;
  if (field === "levelRange") return record.levelRangeName;
  if (field === "levelTotal") return record.levelTotal;
  if (field === "numLo") return record.numLo;
  if (field === "numHi") return record.numHi;
  if (field === "battleType") return record.battleTypeName;
  if (field === "battleCount") return record.battleCount;
  if (field === "rawHex") return record.rawHex;
  return "";
}

function facilityFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function regulationLabel(id: number): string {
  if (id === PWT_LEVEL_REGULATION_ID) return "PWT Built-In Lv.25";
  return REGULATION_LABELS[id] ?? `Regulation ${id}`;
}

function labelFromBank(project: ProjectState, bank: string, id: number, fallback: string): string {
  return project.texts.banks[bank]?.[id] ?? fallback;
}

function findValueIndex(values: string[], input: string, label: string): number {
  const trimmed = input.trim();
  const parenthetical = /\((\d+)\)\s*$/u.exec(trimmed);
  if (parenthetical) return parseInteger(parenthetical[1], 0, 65535);
  if (/^\d+$/u.test(trimmed)) return parseInteger(trimmed, 0, 65535);
  const index = values.findIndex((value) => value.toLowerCase() === trimmed.toLowerCase());
  if (index === -1) throw new Error(`Unknown ${label}: ${input}`);
  return index;
}

function parseNatureId(input: string): number {
  const parenthetical = /\((\d+)\)\s*$/u.exec(input.trim());
  if (parenthetical) return parseInteger(parenthetical[1], 0, 255);
  if (/^\d+$/u.test(input.trim())) return parseInteger(input.trim(), 0, 255);
  const index = NATURES.findIndex((nature) => nature.toLowerCase() === input.trim().toLowerCase());
  if (index === -1) throw new Error(`Unknown nature: ${input}`);
  return index;
}

function parseTrainerTypeId(project: ProjectState, input: string): number {
  const trimmed = input.trim();
  const parenthetical = /\((\d+)\)\s*$/u.exec(trimmed);
  if (parenthetical) return parseInteger(parenthetical[1], 0, 65535);
  if (/^\d+$/u.test(trimmed)) return parseInteger(trimmed, 0, 65535);
  const options = getFacilityTrainerTypeOptions(project);
  const match = options.find((option) => option.label.toLowerCase() === trimmed.toLowerCase());
  if (!match) throw new Error(`Unknown trainer type: ${input}`);
  return match.id;
}

function parseInteger(input: string, min: number, max: number): number {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}`);
  return value;
}

function truthyValue(value: string | number | boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readU16Values(bytes: Uint8Array): number[] {
  const values: number[] = [];
  for (let offset = 0; offset + 2 <= bytes.length; offset += 2) values.push(readU16(bytes, offset));
  return values;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function hexToBytes(input: string, expectedLength: number): Uint8Array {
  const compact = input.replace(/[^0-9a-f]/giu, "");
  if (compact.length !== expectedLength * 2) throw new Error(`Expected ${expectedLength} bytes of hex`);
  const out = new Uint8Array(expectedLength);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function matchesTerms(haystack: string, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return terms.length === 0 || terms.some((term) => haystack.includes(term));
}
