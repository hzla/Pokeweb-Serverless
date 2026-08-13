import { readU16, readU32 } from "../nds/binary";
import type { BaseRom } from "./constants";

const POINTER_TABLE_END = 0xfd13;
const WORK_SET_CONST = 0x28;
const SCRIPT_VARIABLE_MIN = 0x4000;
const SCRIPT_VARIABLE_MAX = 0xff00;

const POKE_PARTY_ADD = 0x10c;
const POKE_PARTY_ADD_EX = 0x10e;
const POKE_PARTY_ADD_EGG = 0x10f;
const BOX_ADD = 0x122;
const BOX_ADD_EX = 0x123;
const POKE_PARTY_ADD_N = 0x2ea;
const BW2_CALL_WILD_BATTLE = 0x174;
const BW_CALL_WILD_BATTLE = 0x178;
const CALL_WILD_BATTLE_EX = 0x297;
const BW2_TRADE_START = 0x1b4;
const BW2_TRADE_CHECK = 0x1b5;
const BW_TRADE_START = 0x1be;
const BW_TRADE_CHECK = 0x1bf;

export type ScriptPokemonCommandType =
  | "party_gift"
  | "party_gift_ex"
  | "egg"
  | "n_gift"
  | "box_gift"
  | "box_gift_ex"
  | "wild_battle"
  | "wild_battle_ex"
  | "trade_start"
  | "trade_check";

export type ScriptPokemonFieldName =
  | "species"
  | "form"
  | "level"
  | "ability"
  | "gender"
  | "shiny"
  | "item"
  | "ball"
  | "nature"
  | "battleFlags"
  | "tradeId"
  | "partyIndex";

/** A script operand plus the exact byte source that may safely be rewritten. */
export type ScriptValueRef = {
  rawValue: number;
  value?: number;
  operandOffset: number;
  sourceOffset?: number;
  variableId?: number;
  writable: boolean;
  reason?: string;
};

export type ScriptPokemonCommand = {
  type: ScriptPokemonCommandType;
  label: string;
  entryIndex: number;
  commandOffset: number;
  scriptStart: number;
  scriptEnd: number;
  byteLength: number;
  fields: Partial<Record<ScriptPokemonFieldName, ScriptValueRef>>;
};

export type ScriptPokemonScanDiagnostic = {
  severity: "warning" | "error";
  code: "malformed_pointer_table" | "invalid_script_pointer" | "dynamic_value" | "ambiguous_value" | "unsupported_command";
  message: string;
  entryIndex?: number;
  offset?: number;
};

export type Gen5ScriptPokemonByteScan = {
  commands: ScriptPokemonCommand[];
  diagnostics: ScriptPokemonScanDiagnostic[];
  entryStarts: number[];
};

type ScriptRange = { entryIndex: number; start: number; end: number };
type ConstantAssignment = { variableId: number; value: number; valueOffset: number; commandOffset: number };

type CommandShape = {
  type: ScriptPokemonCommandType;
  label: string;
  byteLength: number;
  fields: Array<[ScriptPokemonFieldName, number]>;
  resultVariableOffset?: number;
};

export function scanGen5ScriptPokemonCommands(bytes: Uint8Array, baseRom: BaseRom): Gen5ScriptPokemonByteScan {
  const diagnostics: ScriptPokemonScanDiagnostic[] = [];
  const ranges = parseScriptRanges(bytes, diagnostics);
  const commands: ScriptPokemonCommand[] = [];

  for (const range of ranges) {
    const constants = collectConstants(bytes, range);
    for (let offset = range.start; offset + 2 <= range.end; offset += 1) {
      const shape = commandShape(readU16(bytes, offset), baseRom);
      if (!shape) continue;
      if (offset + shape.byteLength > range.end) continue;
      if (shape.resultVariableOffset !== undefined && !isScriptVariable(readU16(bytes, offset + shape.resultVariableOffset))) continue;

      const candidateDiagnostics: ScriptPokemonScanDiagnostic[] = [];
      const fields = Object.fromEntries(shape.fields.map(([field, relativeOffset]) => {
        const operandOffset = offset + relativeOffset;
        return [
          field,
          field === "battleFlags"
            ? { rawValue: readU16(bytes, operandOffset), value: readU16(bytes, operandOffset), operandOffset, sourceOffset: operandOffset, writable: true }
            : resolveScriptValue(bytes, operandOffset, offset, constants, range, candidateDiagnostics),
        ];
      })) as Partial<Record<ScriptPokemonFieldName, ScriptValueRef>>;
      // Arbitrary-alignment scanning inevitably sees opcode-shaped byte pairs
      // inside unrelated command operands. Reject malformed shapes silently;
      // they are not evidence of a real unsupported command.
      if (!validCommandFields(shape.type, fields)) continue;
      diagnostics.push(...candidateDiagnostics);

      commands.push({
        type: shape.type,
        label: shape.label,
        entryIndex: range.entryIndex,
        commandOffset: offset,
        scriptStart: range.start,
        scriptEnd: range.end,
        byteLength: shape.byteLength,
        fields,
      });
    }
  }

  return { commands, diagnostics: dedupeDiagnostics(diagnostics), entryStarts: ranges.map((range) => range.start) };
}

function parseScriptRanges(bytes: Uint8Array, diagnostics: ScriptPokemonScanDiagnostic[]): ScriptRange[] {
  if (bytes.length < 4) return [];
  if (readU16(bytes, 0) !== POINTER_TABLE_END) {
    const firstStart = readU32(bytes, 0) + 4;
    // The Gen 5 script NARC mixes command files with auxiliary records. A
    // command file must begin with a relative pointer into itself; records that
    // fail this first structural check are not malformed command tables.
    if (firstStart < 4 || firstStart >= bytes.length) return [];
  }

  const starts: Array<{ entryIndex: number; start: number }> = [];
  const invalidPointers: Array<{ entryIndex: number; pointerOffset: number }> = [];
  let pointerOffset = 0;
  let foundTerminator = false;
  const maximumPointers = Math.min(Math.floor(bytes.length / 4), 0x4000);
  for (let entryIndex = 0; entryIndex < maximumPointers && pointerOffset + 4 <= bytes.length; entryIndex += 1, pointerOffset += 4) {
    if (readU16(bytes, pointerOffset) === POINTER_TABLE_END) {
      foundTerminator = true;
      break;
    }
    const start = pointerOffset + readU32(bytes, pointerOffset) + 4;
    if (start < 0 || start >= bytes.length) {
      invalidPointers.push({ entryIndex, pointerOffset });
      continue;
    }
    starts.push({ entryIndex, start });
  }
  if (!foundTerminator) {
    diagnostics.push({
      severity: "error",
      code: "malformed_pointer_table",
      message: "The script pointer table has no 0xFD13 terminator; no commands were scanned.",
    });
    return [];
  }

  const tableEnd = pointerOffset + 2;
  const insideTable: Array<{ entryIndex: number; pointerOffset: number }> = [];
  const validStarts = starts.filter(({ entryIndex, start }) => {
    if (start >= tableEnd) return true;
    insideTable.push({ entryIndex, pointerOffset: entryIndex * 4 });
    return false;
  });
  const invalid = [...invalidPointers, ...insideTable];
  if (invalid.length > 0) {
    const first = invalid[0]!;
    diagnostics.push({
      severity: "error",
      code: "invalid_script_pointer",
      entryIndex: first.entryIndex,
      offset: first.pointerOffset,
      message: `${invalid.length} pointer-table entr${invalid.length === 1 ? "y is" : "ies are"} outside the valid command area (first at 0x${first.pointerOffset.toString(16)}).`,
    });
  }
  const sortedStarts = [...new Set(validStarts.map((entry) => entry.start))].sort((left, right) => left - right);
  return validStarts.map(({ entryIndex, start }) => ({
    entryIndex,
    start,
    end: sortedStarts.find((candidate) => candidate > start) ?? bytes.length,
  }));
}

function collectConstants(bytes: Uint8Array, range: ScriptRange): Map<number, ConstantAssignment[]> {
  const constants = new Map<number, ConstantAssignment[]>();
  for (let offset = range.start; offset + 6 <= range.end; offset += 1) {
    if (readU16(bytes, offset) !== WORK_SET_CONST) continue;
    const variableId = readU16(bytes, offset + 2);
    if (!isScriptVariable(variableId)) continue;
    const assignment = { variableId, value: readU16(bytes, offset + 4), valueOffset: offset + 4, commandOffset: offset };
    constants.set(variableId, [...(constants.get(variableId) ?? []), assignment]);
  }
  return constants;
}

function resolveScriptValue(
  bytes: Uint8Array,
  operandOffset: number,
  commandOffset: number,
  constants: Map<number, ConstantAssignment[]>,
  range: ScriptRange,
  diagnostics: ScriptPokemonScanDiagnostic[],
): ScriptValueRef {
  const rawValue = readU16(bytes, operandOffset);
  if (!isScriptVariable(rawValue)) return { rawValue, value: rawValue, operandOffset, sourceOffset: operandOffset, writable: true };

  const assignments = constants.get(rawValue) ?? [];
  const priorAssignments = assignments.filter((assignment) => assignment.commandOffset < commandOffset);
  if (assignments.length === 1 && priorAssignments.length === 1) {
    const assignment = priorAssignments[0]!;
    return {
      rawValue,
      value: assignment.value,
      operandOffset,
      sourceOffset: assignment.valueOffset,
      variableId: rawValue,
      writable: true,
    };
  }

  const reason = assignments.length > 1
    ? `Variable 0x${rawValue.toString(16)} is assigned ${assignments.length} times in this script entry.`
    : `Variable 0x${rawValue.toString(16)} has no unique WorkSetConst assignment before this command.`;
  diagnostics.push({
    severity: "warning",
    code: assignments.length > 1 ? "ambiguous_value" : "dynamic_value",
    entryIndex: range.entryIndex,
    offset: operandOffset,
    message: reason,
  });
  return { rawValue, operandOffset, variableId: rawValue, writable: false, reason };
}

function commandShape(opcode: number, baseRom: BaseRom): CommandShape | undefined {
  if (opcode === POKE_PARTY_ADD) return giftShape("party_gift", "PokePartyAdd", false, false);
  if (opcode === POKE_PARTY_ADD_EX) return giftShape("party_gift_ex", "PokePartyAddEx", true, false);
  if (opcode === POKE_PARTY_ADD_EGG) return {
    type: "egg", label: "PokePartyAddEgg", byteLength: 8, resultVariableOffset: 2,
    fields: [["species", 4], ["form", 6]],
  };
  if (opcode === BOX_ADD) return giftShape("box_gift", "BoxAdd", false, false);
  if (opcode === BOX_ADD_EX) return giftShape("box_gift_ex", "BoxAddEx", true, false);
  if (opcode === POKE_PARTY_ADD_N && baseRom === "BW2") return giftShape("n_gift", "PokePartyAdd (N gift)", false, true);

  const simpleWild = baseRom === "BW2" ? BW2_CALL_WILD_BATTLE : BW_CALL_WILD_BATTLE;
  if (opcode === simpleWild) return {
    type: "wild_battle", label: "CallWildBattle", byteLength: 8,
    fields: [["species", 2], ["level", 4], ["battleFlags", 6]],
  };
  if (opcode === CALL_WILD_BATTLE_EX && baseRom === "BW2") return {
    type: "wild_battle_ex", label: "CallWildBattleEx", byteLength: 10,
    fields: [["species", 2], ["level", 4], ["form", 6], ["battleFlags", 8]],
  };

  const tradeStart = baseRom === "BW2" ? BW2_TRADE_START : BW_TRADE_START;
  const tradeCheck = baseRom === "BW2" ? BW2_TRADE_CHECK : BW_TRADE_CHECK;
  if (opcode === tradeStart) return {
    type: "trade_start", label: "FieldTradeStart", byteLength: 6,
    fields: [["tradeId", 2], ["partyIndex", 4]],
  };
  if (opcode === tradeCheck) return {
    type: "trade_check", label: "FieldTradeCheck", byteLength: 8, resultVariableOffset: 2,
    fields: [["tradeId", 4], ["partyIndex", 6]],
  };
  return undefined;
}

function giftShape(type: ScriptPokemonCommandType, label: string, extended: boolean, nGift: boolean): CommandShape {
  if (nGift) return {
    type, label, byteLength: 14, resultVariableOffset: 2,
    fields: [["species", 4], ["level", 6], ["nature", 8], ["ability", 10], ["gender", 12]],
  };
  return {
    type,
    label,
    byteLength: extended ? 20 : 10,
    resultVariableOffset: 2,
    fields: extended
      ? [["species", 4], ["form", 6], ["level", 8], ["ability", 10], ["gender", 12], ["shiny", 14], ["item", 16], ["ball", 18]]
      : [["species", 4], ["form", 6], ["level", 8]],
  };
}

function validCommandFields(type: ScriptPokemonCommandType, fields: Partial<Record<ScriptPokemonFieldName, ScriptValueRef>>): boolean {
  const species = fields.species?.value;
  if (species !== undefined && (!Number.isInteger(species) || species <= 0 || species >= SCRIPT_VARIABLE_MIN)) return false;
  const level = fields.level?.value;
  if (level !== undefined && (!Number.isInteger(level) || level <= 0 || level > 100)) return false;
  for (const name of ["ability", "gender", "shiny"] as const) {
    const value = fields[name]?.value;
    if (value !== undefined && (value < 0 || value > 2)) return false;
  }
  const nature = fields.nature?.value;
  if (nature !== undefined && (nature < 0 || nature > 24)) return false;
  if (type === "trade_start" || type === "trade_check") {
    const tradeId = fields.tradeId?.value;
    const partyIndex = fields.partyIndex?.value;
    if (tradeId !== undefined && (tradeId < 0 || tradeId > 0xffff)) return false;
    if (partyIndex !== undefined && (partyIndex < 0 || partyIndex > 5)) return false;
  }
  return true;
}

function isScriptVariable(value: number): boolean {
  return value >= SCRIPT_VARIABLE_MIN && value < SCRIPT_VARIABLE_MAX;
}

function dedupeDiagnostics(diagnostics: ScriptPokemonScanDiagnostic[]): ScriptPokemonScanDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.entryIndex ?? ""}:${diagnostic.offset ?? ""}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
