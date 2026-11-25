import { readU16, readU32 } from "../nds/binary";

export const BW2_TRAINER_CLASS_COUNT = 236;
const ARM9_LOAD_ADDRESS = 0x02004000;
const genderColumnCache = new WeakMap<Uint8Array, number | null>();

/** The literal in TrainerClass_GetSex points to byte 1 of the four-byte class records. */
export function bw2TrainerClassGenderColumnAt(arm9: Uint8Array, getter: number): number | undefined {
  // lsls r1,r0,#2; ldr r0,[pc,#4]; ldrb r0,[r0,r1]; bx lr
  if (readU32(arm9, getter) !== 0x48010081 || readU32(arm9, getter + 4) !== 0x47705c40) return undefined;
  const column = readU32(arm9, getter + 8) - ARM9_LOAD_ADDRESS;
  return column > 0 && column % 4 === 1 && column - 1 + BW2_TRAINER_CLASS_COUNT * 4 <= arm9.length ? column : undefined;
}

function findGenderColumn(arm9: Uint8Array): number | null {
  let found: number | null = null;
  for (let getter = 0; getter + 18 <= arm9.length; getter += 4) {
    // The following function, GetTrSpriteBaseDatID, distinguishes the sex getter from other byte-table readers.
    if (readU32(arm9, getter) !== 0x48010081 || readU32(arm9, getter + 12) !== 0x2201b510
      || readU16(arm9, getter + 16) !== 0x4211) continue;
    const column = bw2TrainerClassGenderColumnAt(arm9, getter);
    if (column === undefined) continue;
    if (found !== null && found !== column) return null;
    found = column;
  }
  return found;
}

export function bw2TrainerClassIsFemale(arm9: Uint8Array, trainerClass: number): boolean {
  if (!Number.isInteger(trainerClass) || trainerClass < 0 || trainerClass >= BW2_TRAINER_CLASS_COUNT) return false;
  let column = genderColumnCache.get(arm9);
  if (column === undefined) {
    column = findGenderColumn(arm9);
    genderColumnCache.set(arm9, column);
  }
  return column !== null && arm9[column + 4 * trainerClass] === 1;
}
