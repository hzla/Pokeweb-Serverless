import { readU16, readU32, writeU16 } from "../nds/binary";
import type { BaseRom } from "./constants";
import { scanGen5ScriptPokemonCommands, type ScriptValueRef } from "./gen5ScriptPokemonScanner";

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

const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;

export function parseGen5ScriptEncounters(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptEncounter[] {
  return scanGen5ScriptEncounterRefs(bytes, baseRom).map(({ kind, speciesId, level, form }) => ({
    kind: kind === "egg" ? "gift" : kind,
    speciesId,
    level,
    form,
  }));
}

export function scanGen5ScriptEncounterRefs(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptEncounterRef[] {
  return scanGen5ScriptPokemonCommands(bytes, baseRom).commands.flatMap((command) => {
    const kind = legacyKind(command.type);
    const speciesRef = legacyValueRef(command.fields.species);
    const level = command.type === "egg" ? 1 : command.fields.level?.value;
    if (!kind || !speciesRef || level === undefined) return [];
    const form = command.fields.form?.value ?? 0;
    const levelRef = legacyValueRef(command.fields.level);
    const formRef = legacyValueRef(command.fields.form);
    return [{
      kind,
      speciesId: speciesRef.value,
      level,
      form,
      commandOffset: command.commandOffset,
      scriptStart: command.scriptStart,
      scriptEnd: command.scriptEnd,
      speciesRef,
      levelRef,
      formRef,
    }];
  });
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

function legacyKind(type: string): Gen5ScriptEncounterRefKind | undefined {
  if (type === "party_gift" || type === "party_gift_ex" || type === "n_gift") return "gift";
  if (type === "egg") return "egg";
  if (type === "wild_battle" || type === "wild_battle_ex") return "static";
  return undefined;
}

function legacyValueRef(ref: ScriptValueRef | undefined): Gen5ScriptValueRef | undefined {
  if (ref?.value === undefined || ref.sourceOffset === undefined || !ref.writable) return undefined;
  return { value: ref.value, valueOffset: ref.sourceOffset, variableId: ref.variableId };
}
