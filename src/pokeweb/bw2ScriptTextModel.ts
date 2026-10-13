import { bw2CommandByName } from "./bw2ScriptCompiler/commands";
import { bw2ScriptMacroByName } from "./bw2ScriptCompiler/macros";
import type { Statement } from "./bw2ScriptCompiler/types";
import { parseHeaders } from "./headerModel";
import type { ProjectState } from "./projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "./text";
import { applyTextReplacement, getTextBank, parseTextEntryId } from "./textModel";

export type Bw2ScriptTextBank = { bankId: number; maps: { zoneId: number; name: string }[] };
export type Bw2ScriptMessageReference = { entryId?: number; bankId?: number; defaultBank: boolean; reason?: string; variables?: Record<number, { length: number; label: string }> };
export type Bw2ScriptCall = Extract<Statement, { kind: "call" }>;

/** Headers are the current project headers, including edits made in the map editor. */
export function bw2ScriptTextBanks(project: ProjectState, fileId: number): Bw2ScriptTextBank[] {
  if (!project.headers && project.narcs.headers && project.formats.headers) project.headers = parseHeaders(project);
  const banks = new Map<number, Bw2ScriptTextBank>();
  for (const header of Object.values(project.headers?.rows ?? {})) {
    if (Number(header.script_id) !== fileId && Number(header.level_script_id) !== fileId) continue;
    const bankId = Number(header.text_bank_id);
    if (!Number.isInteger(bankId) || bankId < 0 || bankId === 0xffff) continue;
    const bank = banks.get(bankId) ?? { bankId, maps: [] };
    bank.maps.push({ zoneId: header.index, name: header.location_name });
    banks.set(bankId, bank);
  }
  return [...banks.values()].sort((a, b) => a.bankId - b.bankId);
}

/** Resolve documented actor/sign messages, including their verified macro
 * expansions. Runtime work values are never guessed as static text IDs. */
export function bw2ScriptMessageReference(call: Bw2ScriptCall | undefined, constants: ReadonlyMap<string, number>, overlayId?: number): Bw2ScriptMessageReference | undefined {
  if (!call || call.helperOnly) return;
  let opcode = bw2CommandByName(call.name, true, overlayId)?.opcode;
  let args = call.args;
  const macro = bw2ScriptMacroByName(call.name);
  if (macro) {
    const message = macro.sequence.find((command) => [0x3c, 0x3d, 0x43].includes(command.opcode));
    if (!message) return;
    if (args.length !== macro.parameters.length) return { defaultBank: false, reason: "Complete the macro's arguments to resolve its text." };
    const parameters = new Map(macro.parameters.map((parameter, index) => [parameter.name, args[index]]));
    opcode = message.opcode;
    args = message.args.map((arg) => typeof arg === "number" ? { kind: "number", value: arg, line: call.line, column: call.column } : parameters.get(arg)!);
  }
  if (opcode !== 0x3c && opcode !== 0x3d && opcode !== 0x43) return;
  const value = (index: number): number | undefined => {
    const arg = args[index];
    const number = arg?.kind === "number" ? arg.value : arg?.kind === "name" ? constants.get(arg.name) : undefined;
    return number !== undefined && Number.isInteger(number) && number >= 0 && number < 0x4000 ? number : undefined;
  };
  if (args.length !== (opcode === 0x3c ? 5 : opcode === 0x43 ? 2 : 4)) return { defaultBank: false, reason: "Complete the message command's arguments to resolve its text." };
  const bankId = opcode === 0x43 ? 0x400 : value(0), entryId = value(opcode === 0x43 ? 0 : 1);
  if (bankId === undefined || entryId === undefined) return { defaultBank: false, reason: "The bank or message ID reads a runtime work variable or an unresolved value." };
  return { entryId, defaultBank: bankId === 0x400, bankId: bankId === 0x400 ? undefined : bankId };
}

export function bw2ScriptTextEntries(project: ProjectState, bankId: number): { flatIndex: number; block: number; entry: number; value: Gen5TextEntry }[] {
  if (!project.narcs.story_texts?.rawFiles[bankId]) throw new Error(`Story text bank ${bankId} is not loaded.`);
  return getTextBank(project, "story_texts", bankId).map((value, flatIndex) => ({ flatIndex, ...parseTextEntryId(value[0]), value }));
}

/** Encode and verify the staged bank before the shared text model commits it.
 * Match entry identity and baseline text to prevent stale sidebar edits. */
export function updateBw2ScriptText(project: ProjectState, bankId: number, entryId: string, before: string, after: string): void {
  const entries = bw2ScriptTextEntries(project, bankId);
  const selected = entries.find((entry) => entry.value[0] === entryId);
  if (!selected || selected.value[1] !== before) throw new Error("Text changed since this entry was opened. Reopen it before saving.");
  if (before === after) return;
  const staged = entries.map(({ value }) => [...value] as Gen5TextEntry);
  staged[selected.flatIndex][1] = after;
  const decoded = decodeGen5TextBank(encodeGen5TextBank(staged));
  if (decoded.length !== staged.length || decoded.some((value, index) => value[0] !== staged[index][0] || value[1] !== staged[index][1])) {
    throw new Error("Text cannot be encoded without changing its contents. Check control codes and character support.");
  }
  applyTextReplacement(project, {
    narcName: "story_texts", matches: [], replacementCount: 1, bankCount: 1,
    changes: [{ bankId, entryIndex: selected.flatIndex, entryId, before, after }],
  });
}

export function bw2ScriptDisplayText(value: string): string {
  return value.replace(/\\r\\n|\\r|\\f/g, "\n\n").replace(/\\n/g, "\n");
}

/** Static maximums for the word-buffer writers preceding the selected message.
 * Branches/calls are not executed; conflicting writes use the largest limit.
 * Unidentified slots retain the field script's 64-character buffer bound. */
export function bw2ScriptWordLimits(project: ProjectState, calls: readonly Bw2ScriptCall[], constants: ReadonlyMap<string, number>): Record<number, { length: number; label: string }> {
  const result: Record<number, { length: number; label: string }> = {};
  const value = (call: Bw2ScriptCall, index: number) => { const arg = call.args[index]; return arg?.kind === "number" ? arg.value : arg?.kind === "name" ? constants.get(arg.name) : undefined; };
  const longest = (bank: string, fallback: number) => Math.min(64, Math.max(fallback, ...(project.texts.banks[bank] ?? []).map((name) => name.length)));
  for (const call of calls) {
    const opcode = bw2CommandByName(call.name, true)?.opcode;
    if (call.helperOnly || opcode === undefined) continue;
    const slot = value(call, 0);
    if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= 32) continue;
    let limit: { length: number; label: string } | undefined;
    if (opcode === 0x4c || opcode === 0x290) limit = { length: 7, label: opcode === 0x4c ? "player name" : "rival name" };
    else if ([0x54, 0x5b].includes(opcode)) limit = { length: 10, label: "Pokémon nickname" };
    else if ([0x53, 0x55, 0x57].includes(opcode)) limit = { length: longest("pokemon", 10), label: "Pokémon species" };
    else if ([0x50, 0x51].includes(opcode)) limit = { length: longest("moves", 13), label: "move name" };
    else if (opcode === 0x4d) limit = { length: longest("items", 20), label: "item name" };
    else if (opcode === 0x5c) limit = { length: Math.min(10, Math.max(1, value(call, 2) ?? 10)), label: "number" };
    else if (call.name.startsWith("word_set_")) limit = { length: 64, label: "unknown word buffer (conservative bound)" };
    if (limit && (!result[slot] || result[slot].length < limit.length)) result[slot] = limit;
  }
  return result;
}
