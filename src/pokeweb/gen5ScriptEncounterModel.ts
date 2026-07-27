import { readU16, readU32, writeU16 } from "../nds/binary";
import type { BaseRom } from "./constants";

export type Gen5ScriptEncounterKind = "gift" | "static";
export type Gen5ScriptEncounterRefKind = Gen5ScriptEncounterKind | "egg";

export type Gen5ScriptEncounter = {
  kind: Gen5ScriptEncounterKind;
  speciesId: number;
  level: number;
  form?: number;
};

export type Gen5ScriptValueRef = {
  value: number;
  valueOffset: number;
  variableId?: number;
};

export type Gen5ScriptEncounterRef = {
  kind: Gen5ScriptEncounterRefKind;
  speciesId: number;
  level: number;
  form?: number;
  commandOffset: number;
  scriptStart: number;
  scriptEnd: number;
  speciesRef: Gen5ScriptValueRef;
  levelRef?: Gen5ScriptValueRef;
  formRef?: Gen5ScriptValueRef;
};

export type Gen5ScriptEncounterPatch = {
  encounter: Gen5ScriptEncounterRef;
  speciesId: number;
  form?: number;
};

const WORK_SET_CONST = 0x28;
const SCRIPT_VARIABLE_MIN = 0x4000;

const POKE_PARTY_ADD = 0x10c;
const POKE_PARTY_ADD_EX = 0x10e;
const POKE_PARTY_ADD_EGG = 0x10f;
const POKE_PARTY_ADD_N = 0x2ea;
const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;

const BW2_CALL_WILD_BATTLE = 0x174;
const BW_CALL_WILD_BATTLE = 0x178;
const CALL_WILD_BATTLE_EX = 0x297;

type ScriptRange = {
  start: number;
  end: number;
};

export function parseGen5ScriptEncounters(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptEncounter[] {
  return scanGen5ScriptEncounterRefs(bytes, baseRom).map(({ kind, speciesId, level, form }) => ({
    kind: kind === "egg" ? "gift" : kind,
    speciesId,
    level,
    form,
  }));
}

export function scanGen5ScriptEncounterRefs(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptEncounterRef[] {
  const encounters: Gen5ScriptEncounterRef[] = [];
  for (const range of scriptRanges(bytes)) {
    const constants = new Map<number, Gen5ScriptValueRef>();
    for (let offset = range.start; offset + 2 <= range.end; offset += 1) {
      const opcode = readU16(bytes, offset);
      if (opcode === WORK_SET_CONST && offset + 6 <= range.end) {
        const variableId = readU16(bytes, offset + 2);
        constants.set(variableId, { value: readU16(bytes, offset + 4), valueOffset: offset + 4, variableId });
        continue;
      }

      const gift = readGiftEncounter(bytes, offset, range, opcode, constants);
      if (gift) {
        encounters.push(gift);
        continue;
      }

      const statik = readStaticEncounter(bytes, offset, range, opcode, constants, baseRom);
      if (statik) encounters.push(statik);
    }
  }
  return encounters;
}

export function patchGen5ScriptEncounters(bytes: Uint8Array, patches: Gen5ScriptEncounterPatch[]): Uint8Array {
  const out = new Uint8Array(bytes);
  for (const patch of patches) {
    writeU16(out, patch.encounter.speciesRef.valueOffset, patch.speciesId);
    if (patch.encounter.formRef) writeU16(out, patch.encounter.formRef.valueOffset, patch.form ?? 0);

    // Gift scripts commonly print the species through WordSetPokeSpecies using a
    // second literal. Keep those semantic display operands synchronized without
    // relying on a ROM-specific byte offset.
    for (let offset = patch.encounter.scriptStart; offset + 5 <= patch.encounter.scriptEnd; offset += 1) {
      const opcode = readU16(bytes, offset);
      if (opcode !== WORD_SET_POKE_SPECIES && opcode !== WORD_SET_POKE_SPECIES_WITH_ARTICLE) continue;
      const valueOffset = offset + 3;
      if (readU16(bytes, valueOffset) === patch.encounter.speciesId) writeU16(out, valueOffset, patch.speciesId);
    }
  }
  return out;
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
  range: ScriptRange,
  opcode: number,
  constants: Map<number, Gen5ScriptValueRef>,
): Gen5ScriptEncounterRef | undefined {
  if (!isScriptResultVariable(readU16(bytes, offset + 2))) return undefined;
  if (opcode === POKE_PARTY_ADD_EGG) {
    if (offset + 8 > range.end) return undefined;
    const speciesRef = resolveScriptValue(readU16(bytes, offset + 4), offset + 4, constants);
    const formRef = resolveScriptValue(readU16(bytes, offset + 6), offset + 6, constants);
    if (!speciesRef || !isSpeciesId(speciesRef.value) || !formRef) return undefined;
    return makeEncounterRef("egg", speciesRef, 1, formRef.value, offset, range, undefined, formRef);
  }

  const isExtendedGift = opcode === POKE_PARTY_ADD_EX;
  const isNGift = opcode === POKE_PARTY_ADD_N;
  if (opcode !== POKE_PARTY_ADD && !isExtendedGift && !isNGift) return undefined;

  const length = isNGift ? 14 : isExtendedGift ? 20 : 10;
  if (offset + length > range.end) return undefined;

  const speciesRef = resolveScriptValue(readU16(bytes, offset + 4), offset + 4, constants);
  const levelOffset = isNGift ? offset + 6 : offset + 8;
  const levelRef = resolveScriptValue(readU16(bytes, levelOffset), levelOffset, constants);
  const formRef = isNGift ? undefined : resolveScriptValue(readU16(bytes, offset + 6), offset + 6, constants);
  const form = isNGift ? 0 : formRef?.value;
  if (!speciesRef || !isSpeciesId(speciesRef.value) || !levelRef || !isLevel(levelRef.value) || form === undefined) return undefined;
  return makeEncounterRef("gift", speciesRef, levelRef.value, form, offset, range, levelRef, formRef);
}

function readStaticEncounter(
  bytes: Uint8Array,
  offset: number,
  range: ScriptRange,
  opcode: number,
  constants: Map<number, Gen5ScriptValueRef>,
  baseRom: BaseRom,
): Gen5ScriptEncounterRef | undefined {
  const simpleOpcode = baseRom === "BW2" ? BW2_CALL_WILD_BATTLE : BW_CALL_WILD_BATTLE;
  const isSimpleWildBattle = opcode === simpleOpcode;
  const isExtendedWildBattle = baseRom === "BW2" && opcode === CALL_WILD_BATTLE_EX;
  if (!isSimpleWildBattle && !isExtendedWildBattle) return undefined;

  const length = isExtendedWildBattle ? 10 : 8;
  if (offset + length > range.end) return undefined;

  const speciesRef = resolveScriptValue(readU16(bytes, offset + 2), offset + 2, constants);
  const levelRef = resolveScriptValue(readU16(bytes, offset + 4), offset + 4, constants);
  const formRef = isExtendedWildBattle ? resolveScriptValue(readU16(bytes, offset + 6), offset + 6, constants) : undefined;
  const form = isExtendedWildBattle ? formRef?.value : 0;
  if (!speciesRef || !isSpeciesId(speciesRef.value) || !levelRef || !isLevel(levelRef.value) || form === undefined) return undefined;
  return makeEncounterRef("static", speciesRef, levelRef.value, form, offset, range, levelRef, formRef);
}

function resolveScriptValue(value: number, valueOffset: number, constants: Map<number, Gen5ScriptValueRef>): Gen5ScriptValueRef | undefined {
  return value >= SCRIPT_VARIABLE_MIN ? constants.get(value) : { value, valueOffset };
}

function makeEncounterRef(
  kind: Gen5ScriptEncounterRefKind,
  speciesRef: Gen5ScriptValueRef,
  level: number,
  form: number,
  commandOffset: number,
  range: ScriptRange,
  levelRef?: Gen5ScriptValueRef,
  formRef?: Gen5ScriptValueRef,
): Gen5ScriptEncounterRef {
  return {
    kind,
    speciesId: speciesRef.value,
    level,
    form,
    commandOffset,
    scriptStart: range.start,
    scriptEnd: range.end,
    speciesRef,
    levelRef,
    formRef,
  };
}

function isSpeciesId(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < SCRIPT_VARIABLE_MIN;
}

function isLevel(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}

function isScriptResultVariable(value: number): boolean {
  return value >= SCRIPT_VARIABLE_MIN && value < 0xff00;
}
