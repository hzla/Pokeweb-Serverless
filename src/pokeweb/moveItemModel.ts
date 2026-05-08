import effectsText from "../assets/data/effects.txt?raw";
import resultEffectsText from "../assets/data/result_effects.txt?raw";
import { CATEGORIES, EFFECT_CATEGORIES, PROPERTIES, STATS, STATUSES, TARGETS, TYPES } from "./constants";
import { copyMoveAnimationScript } from "./moveAnimationModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";

export const EFFECTS = effectsText.split(/\r?\n/u).filter((line) => line.length > 0);
export const RESULT_EFFECTS = resultEffectsText.split(/\r?\n/u).filter((line) => line.length > 0);

export const MOVE_EFFECT_FIELDS = [
  ["Effect Category", "effect_category", "effect_cats"],
  ["Add. Effects", "result_effect", "result_effects"],
  ["Add. Effect Proc %", "effect_chance", "int-100"],
  ["Status Type", "status", "status_types"],
  ["Target", "target", "targets"],
  ["Min Effect Turns", "min_turns", "int-255"],
  ["Max Effect Turns", "max_turns", "int-255"],
  ["Min Hits", "min_hits", "int-255"],
  ["Max Hits", "max_hits", "int-255"],
] as const;

export const MOVE_STAT_FIELDS = [1, 2, 3].flatMap((n) => [
  [`Stat Mod`, `stat_${n}`, "stats"],
  [`Amount`, `magnitude_${n}`, "int-6-signed"],
  [`Proc %`, `stat_chance_${n}`, "int-100"],
]) as Array<readonly [string, string, string]>;

export const MOVE_MISC_FIELDS = [
  ["PP", "pp", "int-255"],
  ["Priority", "priority", "int-255"],
  ["+Crit", "crit", "int-15"],
  ["Flinch %", "flinch", "int-100"],
  ["Recoil %", "recoil", "int-255"],
  ["Heal %", "healing", "int-100"],
  ["Animation ID", "animation", "int-65535"],
] as const;

export const ITEM_EXPANDED_FIELDS = [
  [
    [255, "item_type"],
    [255, "gain_values"],
    [255, "item_group"],
    [255, "battle_item_group"],
    [65535, "type_attribute"],
    [255, "name_order_id"],
    [1, "nature_gift_power"],
    [1, "battle_happiness"],
    [1, "ow_happiness"],
    [1, "hold_happiness"],
  ],
  [
    [255, "hp_atk_boost"],
    [255, "def_spatk_boost"],
    [255, "spd_spdef_boost"],
    [255, "acc_crit_pp_boost"],
    [255, "hp_ev_gain"],
    [255, "atk_ev_gain"],
    [255, "def_ev_gain"],
    [255, "spd_ev_gain"],
    [255, "spatk_ev_gain"],
    [255, "spdef_ev_gain"],
    [255, "hp_gain"],
    [255, "pp_gain"],
  ],
  [
    [255, "battle_flags"],
    [255, "berry_flags"],
    [255, "held_flags"],
    [255, "usability_flag"],
    [255, "consumable_flag"],
    [255, "status_removal_flag"],
    [255, "unknown_flag_1"],
  ],
] as const;

export type MoveRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
};

export type ItemRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
};

export type FieldUpdateResult = {
  value: string | number;
  rawValue: number;
};

const TRI_ATTACK_RESULT = "Chance of either Paralyzing; Burning; or Freezing target";

export function getMoveCount(project: ProjectState): number {
  return project.narcs.moves?.fileCount ?? 0;
}

export function getItemCount(project: ProjectState): number {
  return project.narcs.items?.fileCount ?? 0;
}

export function getMoveRecord(project: ProjectState, id: number): MoveRecord {
  const record = decodeRecord(project, "moves", id);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode move ${id}`);
  syncMoveReadable(project, record.raw, record.readable, id);
  return { id, raw: record.raw, readable: record.readable };
}

export function getItemRecord(project: ProjectState, id: number): ItemRecord {
  const record = decodeRecord(project, "items", id);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode item ${id}`);
  record.readable.name = project.texts.banks.items?.[id] ?? `Item ${id}`;
  return { id, raw: record.raw, readable: record.readable };
}

export function getMoveAutofills(): Record<string, string[]> {
  return {
    types: TYPES,
    categories: CATEGORIES,
    effect_cats: EFFECT_CATEGORIES,
    effects: EFFECTS,
    result_effects: RESULT_EFFECTS,
    status_types: STATUSES,
    targets: TARGETS,
    stats: STATS,
  };
}

export function updateMoveField(project: ProjectState, moveId: number, field: string, inputValue: string | boolean): FieldUpdateResult {
  const record = getMoveRecord(project, moveId);
  const value = typeof inputValue === "boolean" ? inputValue : inputValue.trim();
  let rawValue: number;
  let displayValue: string | number;

  if (field === "type") {
    rawValue = findValueIndex(TYPES, String(value), "type");
    displayValue = TYPES[rawValue];
  } else if (field === "category") {
    rawValue = findValueIndex(CATEGORIES, String(value), "category");
    displayValue = CATEGORIES[rawValue];
  } else if (field === "effect_category") {
    rawValue = findValueIndex(EFFECT_CATEGORIES, String(value), "effect category");
    displayValue = EFFECT_CATEGORIES[rawValue];
  } else if (field === "result_effect") {
    rawValue = String(value) === TRI_ATTACK_RESULT ? 65535 : findValueIndex(RESULT_EFFECTS, String(value), "result effect");
    displayValue = rawValue === 65535 ? TRI_ATTACK_RESULT : RESULT_EFFECTS[rawValue];
  } else if (field === "effect") {
    rawValue = findValueIndex(EFFECTS, String(value), "effect");
    displayValue = EFFECTS[rawValue];
  } else if (field === "status") {
    rawValue = findValueIndex(STATUSES, String(value), "status");
    displayValue = STATUSES[rawValue];
  } else if (field === "target") {
    rawValue = findValueIndex(TARGETS, String(value), "target");
    displayValue = TARGETS[rawValue];
  } else if (/^stat_[1-3]$/u.test(field)) {
    rawValue = findValueIndex(STATS, String(value), "stat");
    displayValue = STATS[rawValue];
  } else if (/^magnitude_[1-3]$/u.test(field)) {
    const signed = parseInteger(String(value), -6, 6, field);
    rawValue = signed < 0 ? signed + 256 : signed;
    displayValue = signed;
  } else if (field === "min_hits" || field === "max_hits") {
    const currentMin = Number(record.readable.min_hits ?? 0);
    const currentMax = Number(record.readable.max_hits ?? 0);
    const next = parseInteger(String(value), 0, 15, field);
    const minHits = field === "min_hits" ? next : currentMin;
    const maxHits = field === "max_hits" ? next : currentMax;
    rawValue = (maxHits << 4) | minHits;
    record.raw.hits = rawValue;
    record.readable.min_hits = minHits;
    record.readable.max_hits = maxHits;
    markDirty(project, "moves", moveId);
    return { value: next, rawValue };
  } else if ((PROPERTIES as readonly string[]).includes(field)) {
    record.readable[field] = value ? 1 : 0;
    rawValue = packProperties(record.readable);
    displayValue = Number(record.readable[field]);
    field = "properties";
  } else if (field === "recoil") {
    const readableValue = parseInteger(String(value), 0, 255, field);
    rawValue = readableValue > 0 ? 256 - readableValue : 0;
    displayValue = readableValue;
  } else if (field === "animation") {
    rawValue = parseInteger(String(value), 0, 65535, field);
    copyMoveAnimationScript(project, moveId, rawValue);
    record.readable.animation = rawValue;
    return { value: rawValue, rawValue };
  } else {
    const max = moveIntegerMax(field);
    if (max === undefined) throw new Error(`Unsupported move field: ${field}`);
    rawValue = parseInteger(String(value), 0, max, field);
    displayValue = rawValue;
  }

  record.raw[field] = rawValue;
  syncMoveReadable(project, record.raw, record.readable, moveId);
  markDirty(project, "moves", moveId);
  return { value: displayValue, rawValue };
}

export function updateItemField(project: ProjectState, itemId: number, field: string, inputValue: string): FieldUpdateResult {
  const record = getItemRecord(project, itemId);
  const max = itemIntegerMax(field);
  if (max === undefined) throw new Error(`Unsupported item field: ${field}`);
  const value = parseInteger(inputValue.trim(), 0, max, field);
  record.raw[field] = value;
  record.readable[field] = value;
  markDirty(project, "items", itemId);
  return { value, rawValue: value };
}

export function moveMatchesSearch(record: MoveRecord, searchText: string, categories: Set<string>, types: Set<string>): boolean {
  if (categories.size > 0 && !categories.has(String(record.readable.category ?? "").toLowerCase())) return false;
  if (types.size > 0 && !types.has(String(record.readable.type ?? "").toLowerCase())) return false;
  return commaSearch(record, searchText);
}

export function itemMatchesSearch(record: ItemRecord, searchText: string): boolean {
  return commaSearch(record, searchText);
}

export function syncMoveReadable(project: ProjectState, raw: RawRecord, readable: ReadableRecord, id: number): void {
  readable.index = id;
  readable.animation = id >= 673 ? 0 : id;
  readable.name = project.texts.banks.moves?.[id] ?? (id <= 559 ? `Move ${id}` : `EXPANDED MOVE ${id}`);
  readable.type = TYPES[raw.type] ?? raw.type;
  readable.effect_category = EFFECT_CATEGORIES[raw.effect_category] ?? raw.effect_category;
  readable.category = CATEGORIES[raw.category] ?? raw.category;
  readable.result_effect = raw.result_effect === 65535 ? TRI_ATTACK_RESULT : (RESULT_EFFECTS[raw.result_effect] ?? raw.result_effect);
  readable.effect = EFFECTS[raw.effect] ?? raw.effect;
  readable.status = STATUSES[raw.status] ?? raw.status;
  readable.recoil = raw.recoil > 0 ? 256 - raw.recoil : raw.recoil;
  readable.target = TARGETS[raw.target] ?? raw.target;
  for (let n = 1; n <= 3; n += 1) {
    readable[`stat_${n}`] = STATS[raw[`stat_${n}`]] ?? raw[`stat_${n}`];
    const magnitude = raw[`magnitude_${n}`] ?? 0;
    readable[`magnitude_${n}`] = magnitude > 6 ? magnitude - 256 : magnitude;
  }
  readable.min_hits = raw.hits & 0x0f;
  readable.max_hits = (raw.hits >> 4) & 0x0f;
  PROPERTIES.forEach((prop, bit) => {
    readable[prop] = (raw.properties >> bit) & 1;
  });
}

function packProperties(readable: ReadableRecord): number {
  return PROPERTIES.reduce((value, prop, bit) => value | ((Number(readable[prop]) > 0 ? 1 : 0) << bit), 0);
}

function moveIntegerMax(field: string): number | undefined {
  const maxes: Record<string, number> = {
    power: 255,
    accuracy: 101,
    pp: 255,
    priority: 255,
    effect_chance: 100,
    min_turns: 255,
    max_turns: 255,
    crit: 15,
    flinch: 100,
    healing: 100,
    animation: 65535,
    stat_chance_1: 100,
    stat_chance_2: 100,
    stat_chance_3: 100,
  };
  return maxes[field];
}

function itemIntegerMax(field: string): number | undefined {
  if (field === "market_value" || field === "type_attribute" || field === "pp_flags" || field === "padding") return 65535;
  return ITEM_EXPANDED_FIELDS.flat().some(([, itemField]) => itemField === field) ? 255 : undefined;
}

function parseInteger(value: string, min: number, max: number, field: string): number {
  if (!/^-?\d+$/u.test(value)) throw new Error(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return parsed;
}

function findValueIndex(values: readonly string[], input: string, label: string): number {
  const index = values.findIndex((value) => value.toLowerCase() === input.toLowerCase());
  if (index < 0) throw new Error(`Unknown ${label}: ${input}`);
  return index;
}

function commaSearch(record: unknown, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = JSON.stringify(record).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function titleize(value: string): string {
  return value
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}
