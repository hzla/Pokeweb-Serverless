import { readU16, readU32 } from "../nds/binary";
import type { BaseRom } from "./constants";

export type Gen5ScriptEncounterKind = "gift" | "static";

export type Gen5ScriptEncounter = {
  kind: Gen5ScriptEncounterKind;
  speciesId: number;
  level: number;
  form?: number;
};

const WORK_SET_CONST = 0x28;
const SCRIPT_VARIABLE_MIN = 0x4000;

const POKE_PARTY_ADD = 0x10c;
const POKE_PARTY_ADD_EX = 0x10e;
const POKE_PARTY_ADD_EGG = 0x10f;
const POKE_PARTY_ADD_N = 0x2ea;

const BW2_CALL_WILD_BATTLE = 0x174;
const BW_CALL_WILD_BATTLE = 0x178;
const CALL_WILD_BATTLE_EX = 0x297;

type ScriptRange = {
  start: number;
  end: number;
};

export function parseGen5ScriptEncounters(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptEncounter[] {
  const encounters: Gen5ScriptEncounter[] = [];
  for (const range of scriptRanges(bytes)) {
    const constants = new Map<number, number>();
    for (let offset = range.start; offset + 2 <= range.end; offset += 1) {
      const opcode = readU16(bytes, offset);
      if (opcode === WORK_SET_CONST && offset + 6 <= range.end) {
        constants.set(readU16(bytes, offset + 2), readU16(bytes, offset + 4));
        continue;
      }

      const gift = readGiftEncounter(bytes, offset, range.end, opcode, constants);
      if (gift) {
        encounters.push(gift);
        continue;
      }

      const statik = readStaticEncounter(bytes, offset, range.end, opcode, constants, baseRom);
      if (statik) encounters.push(statik);
    }
  }
  return encounters;
}

export function gen5ScriptStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  let pointerOffset = 0;
  while (pointerOffset + 4 <= bytes.length && readU16(bytes, pointerOffset) !== 0xfd13) {
    const start = pointerOffset + readU32(bytes, pointerOffset) + 4;
    if (start >= 0 && start < bytes.length) starts.push(start);
    pointerOffset += 4;
  }
  return starts;
}

function scriptRanges(bytes: Uint8Array): ScriptRange[] {
  const starts = gen5ScriptStarts(bytes);
  const sorted = [...starts].sort((a, b) => a - b);
  return starts.map((start) => ({ start, end: sorted.find((candidate) => candidate > start) ?? bytes.length }));
}

function readGiftEncounter(
  bytes: Uint8Array,
  offset: number,
  end: number,
  opcode: number,
  constants: Map<number, number>,
): Gen5ScriptEncounter | undefined {
  if (opcode === POKE_PARTY_ADD_EGG) {
    if (offset + 8 > end) return undefined;
    const speciesId = resolveScriptValue(readU16(bytes, offset + 4), constants);
    const form = resolveScriptValue(readU16(bytes, offset + 6), constants);
    if (!isSpeciesId(speciesId) || form === undefined) return undefined;
    return { kind: "gift", speciesId, level: 1, form };
  }

  const isExtendedGift = opcode === POKE_PARTY_ADD_EX;
  const isNGift = opcode === POKE_PARTY_ADD_N;
  if (opcode !== POKE_PARTY_ADD && !isExtendedGift && !isNGift) return undefined;

  const length = isNGift ? 14 : isExtendedGift ? 20 : 10;
  if (offset + length > end) return undefined;

  const speciesId = resolveScriptValue(readU16(bytes, offset + 4), constants);
  const level = resolveScriptValue(readU16(bytes, isNGift ? offset + 6 : offset + 8), constants);
  const form = isNGift ? 0 : resolveScriptValue(readU16(bytes, offset + 6), constants);
  if (!isSpeciesId(speciesId) || !isLevel(level) || form === undefined) return undefined;
  return { kind: "gift", speciesId, level, form };
}

function readStaticEncounter(
  bytes: Uint8Array,
  offset: number,
  end: number,
  opcode: number,
  constants: Map<number, number>,
  baseRom: BaseRom,
): Gen5ScriptEncounter | undefined {
  const simpleOpcode = baseRom === "BW2" ? BW2_CALL_WILD_BATTLE : BW_CALL_WILD_BATTLE;
  const isSimpleWildBattle = opcode === simpleOpcode;
  const isExtendedWildBattle = baseRom === "BW2" && opcode === CALL_WILD_BATTLE_EX;
  if (!isSimpleWildBattle && !isExtendedWildBattle) return undefined;

  const length = isExtendedWildBattle ? 10 : 8;
  if (offset + length > end) return undefined;

  const speciesId = resolveScriptValue(readU16(bytes, offset + 2), constants);
  const level = resolveScriptValue(readU16(bytes, offset + 4), constants);
  const form = isExtendedWildBattle ? resolveScriptValue(readU16(bytes, offset + 6), constants) : 0;
  if (!isSpeciesId(speciesId) || !isLevel(level) || form === undefined) return undefined;
  return { kind: "static", speciesId, level, form };
}

function resolveScriptValue(value: number, constants: Map<number, number>): number | undefined {
  return value >= SCRIPT_VARIABLE_MIN ? constants.get(value) : value;
}

function isSpeciesId(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < SCRIPT_VARIABLE_MIN;
}

function isLevel(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}
