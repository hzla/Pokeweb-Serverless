import { PERSONAL_ABILITY_MAX_ID } from "./personalAbilityPacking";

/** White2Upgrade stores ability bits 8-9 in PK5 byte 0x42 bits 6-7. */
export function readPk5Ability(data: Uint8Array): number {
  if (data.length <= 0x42) throw new Error("Truncated PK5 ability record");
  return data[0x15] | ((data[0x42] & 0xc0) << 2);
}

/** Preserve hidden-ability, N's Pokemon, and all other unrelated flags. */
export function writePk5Ability(data: Uint8Array, abilityId: number): void {
  if (data.length <= 0x42) throw new Error("Truncated PK5 ability record");
  if (!Number.isInteger(abilityId) || abilityId < 1 || abilityId > PERSONAL_ABILITY_MAX_ID) {
    throw new Error(`abilityId must be an integer in 1..${PERSONAL_ABILITY_MAX_ID}`);
  }
  data[0x15] = abilityId & 0xff;
  data[0x42] = (data[0x42] & 0x3f) | ((abilityId >>> 2) & 0xc0);
}
