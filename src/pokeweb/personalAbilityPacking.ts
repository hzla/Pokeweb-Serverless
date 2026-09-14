import type { RawRecord } from "./projectStore";

const PERSONAL_ITEM_FIELDS = ["item_1", "item_2", "item_3"] as const;
const PERSONAL_ABILITY_FIELDS = ["ability_1", "ability_2", "ability_3"] as const;

const PERSONAL_ITEM_ID_MASK = 0x3fff;
const PERSONAL_ABILITY_LOW_MASK = 0x00ff;
const PERSONAL_ABILITY_HIGH_MASK = 0x0300;
const PERSONAL_ABILITY_ITEM_BITS_MASK = 0xc000;

export const PERSONAL_ABILITY_MAX_ID = PERSONAL_ABILITY_LOW_MASK | PERSONAL_ABILITY_HIGH_MASK;

export function unpackExpandedPersonalAbilities(raw: RawRecord): void {
  for (let index = 0; index < PERSONAL_ABILITY_FIELDS.length; index += 1) {
    const itemField = PERSONAL_ITEM_FIELDS[index];
    const abilityField = PERSONAL_ABILITY_FIELDS[index];
    const itemValue = raw[itemField];
    const abilityValue = raw[abilityField];
    if (itemValue === undefined || abilityValue === undefined) continue;

    raw[itemField] = itemValue & PERSONAL_ITEM_ID_MASK;
    raw[abilityField] = (abilityValue & PERSONAL_ABILITY_LOW_MASK) | ((itemValue & PERSONAL_ABILITY_ITEM_BITS_MASK) >>> 6);
  }
}

export function packedPersonalFieldValue(raw: RawRecord, field: string): number | undefined {
  // Cascade's extra fields alias unused bytes of the existing tutor words.
  // Preserve the other bits, including compatibility edits made after migration.
  if (field === "padding" && raw.ability_4 !== undefined) {
    return (raw.ability_4 & 255) | ((raw.ability_5 & 255) << 8) | ((raw.ability_6 & 255) << 16);
  }
  if (field === "driftveil_tutor" && raw.hidden_ability_chance !== undefined) {
    return (((raw[field] ?? 0) & 0xff00ffff) | ((raw.hidden_ability_chance & 255) << 16)) >>> 0;
  }
  const itemIndex = PERSONAL_ITEM_FIELDS.findIndex((candidate) => candidate === field);
  if (itemIndex >= 0) {
    const itemValue = raw[field];
    if (itemValue === undefined) return undefined;
    const abilityValue = raw[PERSONAL_ABILITY_FIELDS[itemIndex]] ?? 0;
    return (itemValue & PERSONAL_ITEM_ID_MASK) | ((abilityValue & PERSONAL_ABILITY_HIGH_MASK) << 6);
  }

  const abilityIndex = PERSONAL_ABILITY_FIELDS.findIndex((candidate) => candidate === field);
  if (abilityIndex >= 0) {
    const abilityValue = raw[field];
    return abilityValue === undefined ? undefined : abilityValue & PERSONAL_ABILITY_LOW_MASK;
  }

  return raw[field];
}
