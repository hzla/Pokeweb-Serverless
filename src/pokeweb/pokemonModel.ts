import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { cascadeWhitePersonalName } from "./cascadeWhiteModel";
import { EGG_GROUPS, EVO_METHODS, GROWTHS, typeNamesForProject, type NarcName } from "./constants";
import { detectWhite2UpgradeDlls } from "./pmcModel";
import { PERSONAL_ABILITY_MAX_ID } from "./personalAbilityPacking";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { getTmNames, machineCountsForProject } from "./tmModel";
import { getTutorMoveCompatibilityGroups } from "./tutorMoveModel";

export const BASE_STAT_FIELDS = [
  ["HP", "base_hp"],
  ["Att", "base_atk"],
  ["Def", "base_def"],
  ["Sp Att", "base_spatk"],
  ["Sp Def", "base_spdef"],
  ["Speed", "base_speed"],
] as const;

export const MISC_INTEGER_FIELDS = [
  ["Catch Rate", "catchrate", 255],
  ["Exp Yield", "base_exp", 65535],
  ["Gender", "gender", 255],
  ["Hatch Rate", "hatch_cycle", 255],
  ["Happiness", "base_happy", 255],
  ["Form Data Offset", "form_id", 65535],
  ["Form Sprite Offset", "form", 65535],
  ["# of Forms", "num_forms", 255],
  ["Height", "height", 65535],
  ["Weight", "weight", 65535],
] as const;

export const PERSONAL_TEXT_FIELDS = [
  ["50% Held Item", "item_1", "items"],
  ["5% Held Item", "item_2", "items"],
  ["1% Held Item", "item_3", "items"],
  ["Egg Group 1", "egg_group_1", "egg_groups"],
  ["Egg Group 2", "egg_group_2", "egg_groups"],
  ["Growth Rate", "exp_rate", "growth_rates"],
] as const;

export const EV_YIELD_FIELDS = [
  ["HP", "hp_yield"],
  ["Attack", "atk_yield"],
  ["Defense", "def_yield"],
  ["Sp Attack", "spatk_yield"],
  ["Sp Defense", "spdef_yield"],
  ["Speed", "speed_yield"],
] as const;

export const RETAIL_LEARNSET_MAX_MOVES = 25;
export const WHITE2UPGRADE_LEARNSET_MAX_MOVES = 32;
export const RETAIL_EVOLUTION_SLOT_COUNT = 7;
export const WHITE2UPGRADE_EVOLUTION_SLOT_COUNT = 8;

const WHITE2UPGRADE_MIN_PERSONAL_FILES = 1000;
const WHITE2UPGRADE_EVOLUTION_RECORD_LENGTH = WHITE2UPGRADE_EVOLUTION_SLOT_COUNT * 6;

export type LearnsetMove = {
  index: number;
  moveId: number;
  moveName: string;
  level: number;
  type: string;
  category: string;
  power: number | string;
  accuracy: number | string;
};

export type EvolutionSlot = {
  index: number;
  method: string | number;
  param: string | number;
  paramRaw: number;
  paramAutofill?: string;
  target: string | number;
};

export type TmCompatibilitySlot = {
  kind: "tm" | "hm";
  index: number;
  label: string;
  moveName: string;
  enabled: boolean;
};

export type TutorCompatibilitySlot = {
  group: string;
  field: string;
  index: number;
  label: string;
  moveName: string;
  enabled: boolean;
};

export type TutorCompatibilityGroup = {
  group: string;
  label: string;
  slots: TutorCompatibilitySlot[];
};

export type EggMoveSlot = {
  index: number;
  moveId: number;
  moveName: string;
  type: string;
  category: string;
  power: number | string;
  accuracy: number | string;
};

export type PokemonEditorRecord = {
  id: number;
  gen: number;
  personal: ReadableRecord;
  rawPersonal: RawRecord;
  learnset: LearnsetMove[];
  evolutions: EvolutionSlot[];
  tmCompatibility: TmCompatibilitySlot[];
  tutorCompatibility: TutorCompatibilityGroup[];
  eggMoves: EggMoveSlot[];
  eggMovesLoaded: boolean;
};

export type PokemonSummaryRecord = Omit<PokemonEditorRecord, "learnset" | "evolutions" | "tmCompatibility" | "tutorCompatibility" | "eggMoves" | "eggMovesLoaded">;

export type PokemonUpdateResult = {
  value: string | number;
  rawValue: number;
  movePreview?: Pick<LearnsetMove, "type" | "category" | "power" | "accuracy">;
};

type EvolutionParamKind = "none" | "level" | "integer" | "item" | "move" | "pokemon" | "ability";

const EVOLUTION_PARAM_KINDS: Partial<Record<number, EvolutionParamKind>> = {
  0: "none",
  1: "none",
  2: "level",
  3: "level",
  4: "level",
  5: "none",
  6: "item",
  7: "pokemon",
  8: "item",
  9: "level",
  10: "level",
  11: "level",
  12: "level",
  13: "level",
  14: "level",
  15: "level",
  16: "integer",
  17: "item",
  18: "item",
  19: "item",
  20: "item",
  21: "move",
  22: "pokemon",
  23: "level",
  24: "level",
  25: "none",
  26: "none",
  27: "none",
  28: "none",
};

export function getPokemonCount(project: ProjectState): number {
  return project.narcs.personal?.fileCount ?? 0;
}

export function usesWhite2UpgradePokemonData(project: ProjectState): boolean {
  if (project.session.baseRom !== "BW2") return false;
  if ((project.narcs.personal?.fileCount ?? 0) >= WHITE2UPGRADE_MIN_PERSONAL_FILES) return true;
  if (project.narcs.evolutions?.rawFiles.some((file) => file.length >= WHITE2UPGRADE_EVOLUTION_RECORD_LENGTH)) return true;
  return detectWhite2UpgradeDlls(project);
}

export function learnsetMoveLimit(project: ProjectState): number {
  return usesWhite2UpgradePokemonData(project) ? WHITE2UPGRADE_LEARNSET_MAX_MOVES : RETAIL_LEARNSET_MAX_MOVES;
}

export function evolutionSlotCount(project: ProjectState): number {
  return usesWhite2UpgradePokemonData(project) ? WHITE2UPGRADE_EVOLUTION_SLOT_COUNT : RETAIL_EVOLUTION_SLOT_COUNT;
}

export function getPokemonRecord(project: ProjectState, id: number): PokemonEditorRecord {
  const summary = getPokemonSummaryRecord(project, id);
  return {
    ...summary,
    learnset: getLearnset(project, id),
    evolutions: getEvolutions(project, id),
    tmCompatibility: getPokemonTmCompatibility(project, id),
    tutorCompatibility: getPokemonTutorCompatibility(project, id),
    eggMoves: getPokemonEggMoves(project, id),
    eggMovesLoaded: Boolean(project.narcs.egg_moves),
  };
}

export function getPokemonSummaryRecord(project: ProjectState, id: number): PokemonSummaryRecord {
  const personalRecord = decodeRecord(project, "personal", id);
  if (!personalRecord.raw || !personalRecord.readable) throw new Error(`Unable to decode Pokemon ${id}`);
  enrichPersonalReadable(personalRecord.raw, personalRecord.readable);
  titleizeAbilityFields(personalRecord.readable);
  const cascadeName = cascadeWhitePersonalName(project, id);
  if (cascadeName) personalRecord.readable.name = cascadeName;

  return {
    id,
    gen: pokemonGeneration(id),
    personal: personalRecord.readable,
    rawPersonal: personalRecord.raw,
  };
}

export function getPokemonTmCompatibility(project: ProjectState, speciesId: number): TmCompatibilitySlot[] {
  const record = decodeRecord(project, "personal", speciesId);
  if (!record.raw) throw new Error(`Unable to decode Pokemon ${speciesId}`);
  const raw = record.raw;
  const names = getTmNames(project);
  const counts = machineCountsForProject(project);
  return [
    ...Array.from({ length: counts.tm }, (_, index) => {
      const number = index + 1;
      const location = tmBitLocation(project, "tm", number);
      return {
        kind: "tm" as const,
        index: number,
        label: `TM${number}`,
        moveName: names.tmNames[index] ?? "",
        enabled: bitEnabled(raw, location.field, location.bit),
      };
    }),
    ...Array.from({ length: counts.hm }, (_, index) => {
      const number = index + 1;
      const location = tmBitLocation(project, "hm", number);
      return {
        kind: "hm" as const,
        index: number,
        label: `HM${number}`,
        moveName: names.hmNames[index] ?? "",
        enabled: bitEnabled(raw, location.field, location.bit),
      };
    }),
  ];
}

export function updatePokemonTmCompatibility(project: ProjectState, speciesId: number, kind: "tm" | "hm", index: number, enabled: boolean): void {
  const record = decodeRecord(project, "personal", speciesId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update Pokemon ${speciesId}`);
  const location = tmBitLocation(project, kind, index);
  const mask = 2 ** location.bit;
  const current = record.raw[location.field] ?? 0;
  const isEnabled = bitEnabled(record.raw, location.field, location.bit);
  record.raw[location.field] = enabled === isEnabled ? current : enabled ? current + mask : current - mask;
  record.readable[location.field] = record.raw[location.field];
  recordFieldChange(project, "personal", pokemonChangelogSubject(project, speciesId), `${kind.toUpperCase()}${String(index).padStart(2, "0")} compatibility`, isEnabled ? "Yes" : "No", enabled ? "Yes" : "No", {
    key: `pokemon:${speciesId}:compat:${kind}:${index}`,
  });
  markDirty(project, "personal", speciesId);
}

export function getPokemonTutorCompatibility(project: ProjectState, speciesId: number): TutorCompatibilityGroup[] {
  if (project.session.baseRom !== "BW2") return [];
  const record = decodeRecord(project, "personal", speciesId);
  if (!record.raw) throw new Error(`Unable to decode Pokemon ${speciesId}`);
  return getTutorMoveCompatibilityGroups(project).map((group) => ({
    group: group.key,
    label: group.label,
    slots: group.moves.map((move) => ({
      group: group.key,
      field: group.field,
      index: move.compatibilityIndex,
      label: `${group.shortLabel}${move.compatibilityIndex + 1}`,
      moveName: move.moveName,
      enabled: bitEnabled(record.raw as RawRecord, group.field, move.compatibilityIndex),
    })),
  }));
}

export function updatePokemonTutorCompatibility(project: ProjectState, speciesId: number, field: string, index: number, enabled: boolean): void {
  const group = getTutorMoveCompatibilityGroups(project).find((candidate) => candidate.field === field);
  if (!group) throw new Error(`Unsupported tutor group: ${field}`);
  if (!Number.isInteger(index) || !group.moves.some((move) => move.compatibilityIndex === index)) throw new Error(`Tutor index out of range: ${index}`);
  const record = decodeRecord(project, "personal", speciesId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update Pokemon ${speciesId}`);
  const mask = 2 ** index;
  const current = record.raw[field] ?? 0;
  const isEnabled = bitEnabled(record.raw, field, index);
  record.raw[field] = enabled === isEnabled ? current : enabled ? current + mask : current - mask;
  record.readable[field] = record.raw[field];
  recordFieldChange(project, "personal", pokemonChangelogSubject(project, speciesId), `${group.label} tutor ${index + 1} compatibility`, isEnabled ? "Yes" : "No", enabled ? "Yes" : "No", {
    key: `pokemon:${speciesId}:tutor:${field}:${index}`,
  });
  markDirty(project, "personal", speciesId);
}

export function getPokemonEggMoves(project: ProjectState, speciesId: number): EggMoveSlot[] {
  const store = project.narcs.egg_moves;
  if (!store || speciesId < 0 || speciesId >= store.fileCount || !store.rawFiles[speciesId]) return [];
  return eggMoveIds(store.rawFiles[speciesId] ?? new Uint8Array()).map((moveId, index) => {
    const preview = getMovePreview(project, moveId);
    return {
      index,
      moveId,
      moveName: project.texts.banks.moves?.[moveId] ?? `Move ${moveId}`,
      ...preview,
    };
  });
}

export function updatePokemonEggMove(project: ProjectState, speciesId: number, index: number, inputValue: string): EggMoveSlot[] {
  const store = project.narcs.egg_moves;
  if (!store) throw new Error("Egg move NARC is not loaded");
  const moves = eggMoveIds(store.rawFiles[speciesId] ?? new Uint8Array());
  if (index < 0 || index >= moves.length) throw new Error(`Egg move row ${index} does not exist`);
  const before = project.texts.banks.moves?.[moves[index]] ?? moves[index];
  moves[index] = findValueIndex(project.texts.banks.moves ?? [], inputValue, "move");
  const after = project.texts.banks.moves?.[moves[index]] ?? moves[index];
  writeEggMoveIds(project, speciesId, moves);
  recordFieldChange(project, "egg_moves", pokemonChangelogSubject(project, speciesId), `egg move ${index + 1}`, before, after, {
    key: `pokemon:${speciesId}:egg:${index}`,
  });
  return getPokemonEggMoves(project, speciesId);
}

export function insertPokemonEggMove(project: ProjectState, speciesId: number, index: number): EggMoveSlot[] {
  const store = project.narcs.egg_moves;
  if (!store) throw new Error("Egg move NARC is not loaded");
  const moves = eggMoveIds(store.rawFiles[speciesId] ?? new Uint8Array());
  const insertAt = Math.max(0, Math.min(index, moves.length));
  const template = moves[Math.max(0, insertAt - 1)] ?? moves[insertAt] ?? firstUsableMoveId(project);
  moves.splice(insertAt, 0, template);
  writeEggMoveIds(project, speciesId, moves);
  recordGenericChange(project, "egg_moves", `${pokemonChangelogSubject(project, speciesId)} egg move ${insertAt + 1} was added.`, pokemonChangelogSubject(project, speciesId), {
    key: `pokemon:${speciesId}:egg-insert:${insertAt}`,
  });
  return getPokemonEggMoves(project, speciesId);
}

export function appendPokemonEggMove(project: ProjectState, speciesId: number): EggMoveSlot[] {
  const store = project.narcs.egg_moves;
  if (!store) throw new Error("Egg move NARC is not loaded");
  return insertPokemonEggMove(project, speciesId, eggMoveIds(store.rawFiles[speciesId] ?? new Uint8Array()).length);
}

export function deletePokemonEggMove(project: ProjectState, speciesId: number, index: number): EggMoveSlot[] {
  const store = project.narcs.egg_moves;
  if (!store) throw new Error("Egg move NARC is not loaded");
  const moves = eggMoveIds(store.rawFiles[speciesId] ?? new Uint8Array());
  if (index < 0 || index >= moves.length) throw new Error(`Egg move row ${index} does not exist`);
  const before = project.texts.banks.moves?.[moves[index]] ?? moves[index];
  moves.splice(index, 1);
  writeEggMoveIds(project, speciesId, moves);
  recordGenericChange(project, "egg_moves", `${pokemonChangelogSubject(project, speciesId)} egg move ${index + 1} (${before}) was removed.`, pokemonChangelogSubject(project, speciesId), {
    key: `pokemon:${speciesId}:egg-delete:${index}`,
  });
  return getPokemonEggMoves(project, speciesId);
}

export function insertPokemonLearnsetMove(project: ProjectState, speciesId: number, index: number): LearnsetMove[] {
  const record = decodeRecord(project, "learnsets", speciesId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update learnsets ${speciesId}`);
  const limit = learnsetMoveLimit(project);
  const entries = learnsetEntries(record.raw, limit);
  if (entries.length >= limit) throw new Error(`Learnset cannot exceed ${limit} moves`);

  const insertAt = Math.max(0, Math.min(index, entries.length));
  const template = entries[Math.max(0, insertAt - 1)] ?? entries[insertAt] ?? { moveId: firstUsableMoveId(project), level: 1 };
  entries.splice(insertAt, 0, { moveId: template.moveId, level: template.level });
  applyLearnsetEntries(project, record.raw, record.readable, entries, limit);
  recordGenericChange(project, "learnsets", `${pokemonChangelogSubject(project, speciesId)} learnset slot ${insertAt + 1} was added.`, pokemonChangelogSubject(project, speciesId), {
    key: `pokemon:${speciesId}:learnset-insert:${insertAt}`,
  });
  markDirty(project, "learnsets", speciesId);
  return getLearnset(project, speciesId);
}

export function appendPokemonLearnsetMove(project: ProjectState, speciesId: number): LearnsetMove[] {
  const record = decodeRecord(project, "learnsets", speciesId);
  if (!record.raw) throw new Error(`Unable to update learnsets ${speciesId}`);
  return insertPokemonLearnsetMove(project, speciesId, learnsetEntries(record.raw, learnsetMoveLimit(project)).length);
}

export function deletePokemonLearnsetMove(project: ProjectState, speciesId: number, index: number): LearnsetMove[] {
  const record = decodeRecord(project, "learnsets", speciesId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update learnsets ${speciesId}`);
  const entries = learnsetEntries(record.raw, learnsetMoveLimit(project));
  if (index < 0 || index >= entries.length) throw new Error(`Learnset row ${index} does not exist`);
  const before = `${project.texts.banks.moves?.[entries[index].moveId] ?? entries[index].moveId} at level ${entries[index].level}`;
  entries.splice(index, 1);
  applyLearnsetEntries(project, record.raw, record.readable, entries, learnsetMoveLimit(project));
  recordGenericChange(project, "learnsets", `${pokemonChangelogSubject(project, speciesId)} learnset slot ${index + 1} (${before}) was removed.`, pokemonChangelogSubject(project, speciesId), {
    key: `pokemon:${speciesId}:learnset-delete:${index}`,
  });
  markDirty(project, "learnsets", speciesId);
  return getLearnset(project, speciesId);
}

export function getMovePreview(project: ProjectState, moveId: number): Pick<LearnsetMove, "type" | "category" | "power" | "accuracy"> {
  if (!project.narcs.moves || moveId < 0 || moveId >= project.narcs.moves.fileCount) {
    return { type: "", category: "", power: "", accuracy: "" };
  }
  const move = decodeRecord(project, "moves", moveId);
  return {
    type: String(move.readable?.type ?? ""),
    category: String(move.readable?.category ?? ""),
    power: move.readable?.power ?? "",
    accuracy: move.readable?.accuracy ?? "",
  };
}

export function updatePokemonField(
  project: ProjectState,
  speciesId: number,
  narc: "personal" | "learnset" | "evolution" | "evolutions",
  field: string,
  inputValue: string,
): PokemonUpdateResult {
  const storeName: NarcName = narc === "evolution" ? "evolutions" : narc === "learnset" ? "learnsets" : narc;
  const record = decodeRecord(project, storeName, speciesId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update ${storeName} ${speciesId}`);

  if (storeName === "personal") {
    const before = record.readable[field];
    const result = updatePersonalField(project, record.raw, record.readable, field, inputValue);
    recordFieldChange(project, "personal", pokemonChangelogSubject(project, speciesId), pokemonFieldLabel(field), before, result.value, {
      key: `pokemon:${speciesId}:personal:${field}`,
    });
    markDirty(project, "personal", speciesId);
    return result;
  }

  if (storeName === "learnsets") {
    const before = record.readable[field];
    const result = updateLearnsetField(project, record.raw, record.readable, field, inputValue);
    recordFieldChange(project, "learnsets", pokemonChangelogSubject(project, speciesId), pokemonFieldLabel(field), before, result.value, {
      key: `pokemon:${speciesId}:learnsets:${field}`,
    });
    markDirty(project, "learnsets", speciesId);
    return result;
  }

  const before = record.readable[field];
  const result = updateEvolutionField(project, record.raw, record.readable, field, inputValue);
  recordFieldChange(project, "evolutions", pokemonChangelogSubject(project, speciesId), pokemonFieldLabel(field), before, result.value, {
    key: `pokemon:${speciesId}:evolutions:${field}`,
  });
  markDirty(project, "evolutions", speciesId);
  return result;
}

export function pokemonMatchesSearch(record: PokemonSummaryRecord, searchText: string, generations: Set<number>, types: Set<string>): boolean {
  if (generations.size > 0 && !generations.has(record.gen)) return false;
  if (types.size > 0) {
    const type1 = String(record.personal.type_1 ?? "").toLowerCase();
    const type2 = String(record.personal.type_2 ?? "").toLowerCase();
    if (!types.has(type1) && !types.has(type2)) return false;
  }

  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = JSON.stringify(record).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function getPokemonAutofills(project: ProjectState): Record<string, string[]> {
  return {
    types: typeNamesForProject(project),
    abilities: project.texts.banks.abilities ?? [],
    items: project.texts.banks.items ?? [],
    egg_groups: EGG_GROUPS,
    growth_rates: GROWTHS.slice(0, 6),
    evo_methods: EVO_METHODS,
    pokemon_names: pokemonNameAutofills(project),
    move_names: project.texts.banks.moves ?? [],
  };
}

export function evolutionParamAutofillKey(method: string | number): string | undefined {
  switch (evolutionParamKind(method)) {
    case "item":
      return "items";
    case "move":
      return "move_names";
    case "pokemon":
      return "pokemon_names";
    case "ability":
      return "abilities";
    default:
      return undefined;
  }
}

function getLearnset(project: ProjectState, id: number): LearnsetMove[] {
  if (!project.narcs.learnsets) return [];
  if (id < 0 || id >= project.narcs.learnsets.fileCount || !project.narcs.learnsets.rawFiles[id]) return [];
  const record = decodeRecord(project, "learnsets", id);
  if (!record.raw || !record.readable) return [];
  const moves: LearnsetMove[] = [];
  const limit = learnsetMoveLimit(project);
  for (let index = 0; index < limit; index += 1) {
    const moveId = record.raw[`move_id_${index}`];
    const level = record.raw[`lvl_learned_${index}`];
    if (moveId === undefined || level === undefined || moveId === 65535 || (moveId === 0 && level === 0)) break;
    const preview = getMovePreview(project, moveId);
    moves.push({
      index,
      moveId,
      moveName: String(record.readable[`move_id_${index}`] ?? moveId),
      level,
      ...preview,
    });
  }
  return moves;
}

export function learnsetEntries(raw: RawRecord, limit = WHITE2UPGRADE_LEARNSET_MAX_MOVES): Array<{ moveId: number; level: number }> {
  const entries: Array<{ moveId: number; level: number }> = [];
  for (let index = 0; index < limit; index += 1) {
    const moveId = raw[`move_id_${index}`];
    const level = raw[`lvl_learned_${index}`];
    if (moveId === undefined || level === undefined || moveId === 65535 || (moveId === 0 && level === 0)) break;
    entries.push({ moveId, level });
  }
  return entries;
}

function getEvolutions(project: ProjectState, id: number): EvolutionSlot[] {
  if (!project.narcs.evolutions) return [];
  if (id < 0 || id >= project.narcs.evolutions.fileCount || !project.narcs.evolutions.rawFiles[id]) return [];
  const record = decodeRecord(project, "evolutions", id);
  if (!record.raw || !record.readable) return [];
  return Array.from({ length: evolutionSlotCount(project) }, (_, index) => {
    const methodId = record.raw?.[`method_${index}`] ?? 0;
    const paramRaw = record.raw?.[`param_${index}`] ?? 0;
    const targetId = record.raw?.[`target_${index}`] ?? 0;
    return {
      index,
      method: EVO_METHODS[methodId] ?? methodId,
      param: formatEvolutionParam(project, methodId, paramRaw),
      paramRaw,
      paramAutofill: evolutionParamAutofillKey(methodId),
      target: pokemonDisplayName(project, targetId),
    };
  });
}

function tmBitLocation(project: ProjectState, kind: "tm" | "hm", index: number): { field: string; bit: number } {
  const counts = machineCountsForProject(project);
  if (kind === "tm") {
    if (index < 1 || index > counts.tm) throw new Error(`TM index out of range: ${index}`);
    if (index <= 32) return { field: "tm_1-32", bit: index - 1 };
    if (index <= 64) return { field: "tm_33-64", bit: index - 33 };
    return { field: "tm_65-95+hm_1", bit: index - 65 };
  }

  if (index < 1 || index > counts.hm) throw new Error(`HM index out of range: ${index}`);
  if (counts.hm === 8) {
    if (index <= 4) return { field: "tm_65-95+hm_1", bit: 27 + index };
    return { field: "hm_2-6", bit: index - 5 };
  }
  if (index === 1) return { field: "tm_65-95+hm_1", bit: 31 };
  return { field: "hm_2-6", bit: index - 2 };
}

function bitEnabled(raw: RawRecord, field: string, bit: number): boolean {
  return Math.floor((raw[field] ?? 0) / 2 ** bit) % 2 === 1;
}

function updatePersonalField(project: ProjectState, raw: RawRecord, readable: ReadableRecord, field: string, inputValue: string): PokemonUpdateResult {
  enrichPersonalReadable(raw, readable);

  if (isEvYieldField(field)) {
    const value = parseInteger(inputValue, 0, 3);
    raw[field] = value;
    readable[field] = value;
    raw.evs = packEvYields(readable);
    return { value, rawValue: value };
  }

  if (field === "type_1" || field === "type_2") {
    const types = typeNamesForProject(project);
    const rawValue = findValueIndex(types, inputValue, "type");
    raw[field] = rawValue;
    readable[field] = types[rawValue];
    return { value: readable[field], rawValue };
  }

  if (field.startsWith("ability_")) {
    const rawValue = findAbilityIndex(project, inputValue, PERSONAL_ABILITY_MAX_ID);
    raw[field] = rawValue;
    readable[field] = titleize(project.texts.banks.abilities?.[rawValue] ?? rawValue);
    return { value: readable[field], rawValue };
  }

  if (field.startsWith("item_")) {
    const rawValue = findValueIndex(project.texts.banks.items ?? [], inputValue, "item");
    raw[field] = rawValue;
    readable[field] = project.texts.banks.items?.[rawValue] ?? rawValue;
    return { value: readable[field], rawValue };
  }

  if (field.startsWith("egg_group_")) {
    const rawValue = findValueIndex(EGG_GROUPS, inputValue, "egg group");
    raw[field] = rawValue;
    readable[field] = EGG_GROUPS[rawValue];
    return { value: readable[field], rawValue };
  }

  if (field === "exp_rate") {
    const rawValue = findValueIndex(GROWTHS.slice(0, 6), inputValue, "growth rate");
    raw[field] = rawValue;
    readable[field] = GROWTHS[rawValue];
    return { value: readable[field], rawValue };
  }

  const max = personalIntegerMax(field);
  if (max === undefined) throw new Error(`Unsupported personal field: ${field}`);
  const value = parseInteger(inputValue, 0, max);
  raw[field] = value;
  readable[field] = value;
  return { value, rawValue: value };
}

function updateLearnsetField(project: ProjectState, raw: RawRecord, readable: ReadableRecord, field: string, inputValue: string): PokemonUpdateResult {
  if (field.startsWith("lvl_learned_")) {
    const value = parseInteger(inputValue, 0, 100);
    raw[field] = value;
    readable[field] = value;
    return { value, rawValue: value };
  }

  if (!field.startsWith("move_id_")) throw new Error(`Unsupported learnset field: ${field}`);
  const rawValue = findValueIndex(project.texts.banks.moves ?? [], inputValue, "move");
  const value = project.texts.banks.moves?.[rawValue] ?? rawValue;
  raw[field] = rawValue;
  readable[field] = value;
  return { value, rawValue, movePreview: getMovePreview(project, rawValue) };
}

function applyLearnsetEntries(project: ProjectState, raw: RawRecord, readable: ReadableRecord, entries: Array<{ moveId: number; level: number }>, limit = learnsetMoveLimit(project)): void {
  for (let index = 0; index < WHITE2UPGRADE_LEARNSET_MAX_MOVES; index += 1) {
    delete raw[`move_id_${index}`];
    delete raw[`lvl_learned_${index}`];
    delete readable[`move_id_${index}`];
    delete readable[`lvl_learned_${index}`];
  }

  entries.slice(0, limit).forEach((entry, index) => {
    raw[`move_id_${index}`] = entry.moveId;
    raw[`lvl_learned_${index}`] = entry.level;
    readable[`move_id_${index}`] = project.texts.banks.moves?.[entry.moveId] ?? entry.moveId;
    readable[`lvl_learned_${index}`] = entry.level;
  });
}

function firstUsableMoveId(project: ProjectState): number {
  const moves = project.texts.banks.moves ?? [];
  return moves.length > 1 ? 1 : 0;
}

function pokemonNameAutofills(project: ProjectState): string[] {
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  return Array.from({ length: count }, (_unused, speciesId) => String(pokemonDisplayName(project, speciesId)));
}

function pokemonDisplayName(project: ProjectState, speciesId: number): string | number {
  return cascadeWhitePersonalName(project, speciesId) ?? project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}

function findPokemonValueIndex(project: ProjectState, inputValue: string): number {
  const count = Math.max(project.texts.banks.pokedex?.length ?? 0, project.narcs.personal?.fileCount ?? 0);
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < count) return numeric;
  const normalizedInput = normalizeName(inputValue);
  for (let speciesId = 0; speciesId < count; speciesId += 1) {
    if (normalizeName(String(pokemonDisplayName(project, speciesId))) === normalizedInput) return speciesId;
  }
  throw new Error(`Unknown Pokemon: ${inputValue}`);
}

function pokemonChangelogSubject(project: ProjectState, speciesId: number): string {
  return String(pokemonDisplayName(project, speciesId));
}

function pokemonFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function eggMoveIds(bytes: Uint8Array): number[] {
  if (bytes.length < 2) return [];
  const count = readU16(bytes, 0);
  const moves: number[] = [];
  for (let index = 0; index < count && 2 + index * 2 + 1 < bytes.length; index += 1) {
    moves.push(readU16(bytes, 2 + index * 2));
  }
  return moves;
}

function writeEggMoveIds(project: ProjectState, speciesId: number, moves: number[]): void {
  const store = project.narcs.egg_moves;
  if (!store) throw new Error("Egg move NARC is not loaded");
  const out = new Uint8Array(2 + moves.length * 2);
  writeU16(out, 0, moves.length);
  moves.forEach((moveId, index) => writeU16(out, 2 + index * 2, moveId));
  store.rawFiles[speciesId] = out;
  store.fileCount = Math.max(store.fileCount, speciesId + 1);
  store.records.delete(speciesId);
  markDirty(project, "egg_moves", speciesId);
}

function updateEvolutionField(project: ProjectState, raw: RawRecord, readable: ReadableRecord, field: string, inputValue: string): PokemonUpdateResult {
  if (field.startsWith("method_")) {
    const rawValue = findValueIndex(EVO_METHODS, inputValue, "evolution method");
    raw[field] = rawValue;
    readable[field] = EVO_METHODS[rawValue];
    return { value: readable[field], rawValue };
  }

  if (field.startsWith("target_")) {
    const rawValue = findPokemonValueIndex(project, inputValue);
    raw[field] = rawValue;
    readable[field] = pokemonDisplayName(project, rawValue);
    return { value: readable[field], rawValue };
  }

  if (field.startsWith("param_")) {
    const slot = /^param_(\d+)$/u.exec(field)?.[1];
    const method = slot === undefined ? 0 : (raw[`method_${slot}`] ?? 0);
    const rawValue = parseEvolutionParam(project, method, inputValue);
    const value = formatEvolutionParam(project, method, rawValue);
    raw[field] = rawValue;
    readable[field] = value;
    return { value, rawValue };
  }

  throw new Error(`Unsupported evolution field: ${field}`);
}

function evolutionParamKind(method: string | number): EvolutionParamKind {
  const methodId = typeof method === "number" ? method : EVO_METHODS.findIndex((value) => normalizeName(value) === normalizeName(String(method)));
  const mapped = EVOLUTION_PARAM_KINDS[methodId];
  if (mapped) return mapped;

  const label = String(method).toLowerCase();
  if (label.includes("ability")) return "ability";
  if (label.includes("move")) return "move";
  if (label.includes("item") || label.includes("stone")) return "item";
  if (label.includes("party member") || label.includes("pokemon") || label.includes("pokémon")) return "pokemon";
  if (label.includes("level")) return "level";
  if (label.includes("none") || label.includes("trading") || label.includes("happiness")) return "none";
  return "integer";
}

function formatEvolutionParam(project: ProjectState, method: string | number, rawValue: number): string | number {
  switch (evolutionParamKind(method)) {
    case "item":
      return project.texts.banks.items?.[rawValue] ?? rawValue;
    case "move":
      return project.texts.banks.moves?.[rawValue] ?? rawValue;
    case "pokemon":
      return pokemonDisplayName(project, rawValue);
    case "ability":
      return titleize(project.texts.banks.abilities?.[rawValue] ?? rawValue);
    default:
      return rawValue;
  }
}

function parseEvolutionParam(project: ProjectState, method: string | number, inputValue: string): number {
  switch (evolutionParamKind(method)) {
    case "item":
      return findValueIndex(project.texts.banks.items ?? [], inputValue, "item");
    case "move":
      return findValueIndex(project.texts.banks.moves ?? [], inputValue, "move");
    case "pokemon":
      return findPokemonValueIndex(project, inputValue);
    case "ability":
      return findAbilityIndex(project, inputValue, 65535);
    case "level":
      return parseInteger(inputValue, 0, 100);
    default:
      return parseInteger(inputValue, 0, 65535);
  }
}

function enrichPersonalReadable(raw: RawRecord, readable: ReadableRecord): void {
  if (readable.hp_yield !== undefined) return;
  let index = 0;
  const fields = ["hp_yield", "atk_yield", "def_yield", "speed_yield", "spatk_yield", "spdef_yield"];
  for (const field of fields) {
    const value = (raw.evs >> index) & 0b11;
    raw[field] = value;
    readable[field] = value;
    index += 2;
  }
}

function titleizeAbilityFields(readable: ReadableRecord): void {
  for (const field of ["ability_1", "ability_2", "ability_3"]) {
    if (readable[field] !== undefined) readable[field] = titleize(readable[field]);
  }
}

function packEvYields(readable: ReadableRecord): number {
  const fields = ["hp_yield", "atk_yield", "def_yield", "speed_yield", "spatk_yield", "spdef_yield"];
  return fields.reduce((packed, field, index) => packed | ((Number(readable[field]) & 0b11) << (index * 2)), 0);
}

function isEvYieldField(field: string): boolean {
  return EV_YIELD_FIELDS.some(([, name]) => name === field);
}

function personalIntegerMax(field: string): number | undefined {
  const stat = BASE_STAT_FIELDS.find(([, name]) => name === field);
  if (stat) return 255;
  const misc = MISC_INTEGER_FIELDS.find(([, name]) => name === field);
  return misc?.[2];
}

function parseInteger(inputValue: string, min: number, max: number): number {
  const value = Number(inputValue.trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Value must be an integer between ${min} and ${max}`);
  return value;
}

function findValueIndex(values: string[], inputValue: string, label: string): number {
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < values.length) return numeric;
  const normalizedInput = normalizeName(inputValue);
  const index = values.findIndex((value) => normalizeName(value) === normalizedInput);
  if (index < 0) throw new Error(`Unknown ${label}: ${inputValue}`);
  return index;
}

function findAbilityIndex(project: ProjectState, inputValue: string, max: number): number {
  const numeric = Number(inputValue.trim());
  if (Number.isInteger(numeric)) return parseInteger(inputValue, 0, max);
  const values = project.texts.banks.abilities ?? [];
  const normalizedInput = normalizeName(inputValue);
  const index = values.findIndex((value) => normalizeName(value) === normalizedInput);
  if (index < 0) throw new Error(`Unknown ability: ${inputValue}`);
  if (index > max) throw new Error(`Ability ID must be between 0 and ${max}`);
  return index;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function titleize(value: string | number): string | number {
  if (typeof value === "number") return value;
  return value
    .split(/([\s-]+)/u)
    .map((part) => (/^[a-z]/iu.test(part) ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("");
}

function pokemonGeneration(id: number): number {
  if (id <= 151) return 1;
  if (id <= 251) return 2;
  if (id <= 386) return 3;
  if (id <= 493) return 4;
  return 5;
}
