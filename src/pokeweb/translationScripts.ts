import { readU16, readU32, writeU16 } from "../nds/binary";
import { gen5ScriptCommandSize, gen5ScriptEntries } from "./gen5ScriptCommands";
import contracts from "../assets/translation/white2-script-contracts.json";
import type { TranslationLocaleId } from "./translationProfile";

export type ScriptDiagnostic = {
  code: string; severity: "blocked" | "warning"; reason: string;
  offset?: number; opcode?: number; bank?: number; messageId?: number; variable?: number; dependency?: string;
};
export type ScriptTextReference = {
  offset: number; opcode: number; bank?: number; messageId?: number;
  status: "resolved" | "remapped" | "inherited" | "unresolved";
  sourceText?: string; donorText?: string; outputText?: string; wordSlots?: number[];
  messageVariable?: number; assignedMessageIds?: number[];
};
export type TranslationScriptAudit = {
  member: number; status: "imported" | "adapted" | "retained" | "unchanged"; entries: number; commands: number;
  contexts: ScriptContext[]; references: ScriptTextReference[]; diagnostics: ScriptDiagnostic[];
  rewrites: { offset: number; before: number; after: number; reason: string }[];
  nativeDependencies: { opcode: number; segment: string; resolution: "US contract" | "unresolved" }[];
};
export type ScriptContext = { bank?: number; sourceBank?: number; overlay?: number; map?: number };
export type ScriptTextLookup = (bank: number, id: number) => string | undefined;
type Command = { offset: number; opcode: number; size: number; target?: number };
type Program = { entries: number[]; commands: Command[]; byOffset: Map<number, Command>; diagnostics: ScriptDiagnostic[]; uncovered: Uint8Array };
const flow = new Set([4, 0x1e, 0x1f, 0x20]);
const terminal = new Set([2, 5, 0x1d]);
const word = (opcode: number) => opcode >= 0x4c && opcode <= 0x63;
const messageOperands: Readonly<Record<number, { bank?: number; ids: number[] }>> = {
  0x34: { ids: [2] }, 0x35: { ids: [2] }, 0x38: { ids: [2] }, 0x3a: { ids: [2] },
  0x3c: { bank: 2, ids: [4] }, 0x3d: { bank: 2, ids: [4] }, 0x43: { ids: [2] },
  0x45: { ids: [2] }, 0x48: { bank: 2, ids: [4, 6] }, 0x49: { bank: 2, ids: [4, 6] },
  0x4a: { ids: [2] }, 0x230: { ids: [2] },
};
const globalCalls = new Set([0x1b, 0x1c, 0x21]);
const opcodeIsClearReservation = (opcode: number, id: number) => opcode === 0x21 && id === 0;
const writesWork = (opcode: number) => opcode === 0xa || opcode === 0x12 || opcode === 0x13 || opcode >= 0x26 && opcode <= 0x2d;
const pure = new Set([0, 1, 2, 3, 4, 5, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11,
  0x12, 0x13, 0x19, 0x1a, 0x1d, 0x1e, 0x1f, 0x20, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d]);
const editable = (opcode: number) => pure.has(opcode) || word(opcode) || Boolean(messageOperands[opcode])
  || globalCalls.has(opcode) || opcode === 0x64 || opcode === 0x65;
const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const textSlots = (text: string | undefined) => [...new Set(Array.from((text ?? "").matchAll(/VAR\((\d+),\s*(\d+)(?:,|\))/gu))
  .filter(match => Number(match[1]) >= 256 && Number(match[1]) < 768).map(match => Number(match[2])))];
const sample = (text: string | undefined) => text === undefined ? undefined : Array.from(text).slice(0, 200).join("");

/** Reject unknown instructions and invalid branch/movement targets; never scan operand bytes as opcodes. */
function program(bytes: Uint8Array, overlay?: number): Program {
  const entries = gen5ScriptEntries(bytes), commands: Command[] = [], byOffset = new Map<number, Command>();
  const diagnostics: ScriptDiagnostic[] = [], covered = new Int32Array(bytes.length).fill(-1);
  const tableEnd = entries.length * 4 + 2;
  if (!entries.length) {
    diagnostics.push({ code: "script-entry-table", severity: "blocked", reason: "A complete script entry table could not be decoded." });
    return { entries, commands, byOffset, diagnostics, uncovered: bytes };
  }
  const pending = [...entries];
  let steps = 0;
  while (pending.length && steps++ < 100000) {
    let at = pending.pop()!;
    while (!byOffset.has(at)) {
      if (at < tableEnd || at + 2 > bytes.length || covered[at] !== -1) {
        diagnostics.push({ code: "script-target", severity: "blocked", offset: at, reason: "A branch or entry points outside the script or into an operand." }); break;
      }
      const opcode = readU16(bytes, at), size = gen5ScriptCommandSize(opcode, "BW2", overlay);
      if (!size || at + size > bytes.length) {
        diagnostics.push({ code: opcode >= 1000 ? "overlay-command-layout" : "script-command-layout", severity: "blocked", offset: at, opcode,
          reason: opcode >= 1000 ? "The active US overlay command layout could not be resolved." : "The US command layout is unknown or truncated." }); break;
      }
      if (Array.from(covered.subarray(at, at + size)).some(value => value !== -1)) {
        diagnostics.push({ code: "script-overlap", severity: "blocked", offset: at, reason: "Instructions overlap." }); break;
      }
      covered.fill(at, at, at + size);
      const command: Command = { offset: at, opcode, size };
      byOffset.set(at, command); commands.push(command);
      if (flow.has(opcode)) { command.target = at + size + (readU32(bytes, at + size - 4) | 0); pending.push(command.target); }
      if (terminal.has(opcode) || opcode === 0x1e) break;
      at += size;
    }
  }
  if (steps >= 100000) diagnostics.push({ code: "script-budget", severity: "blocked", reason: "Script control-flow analysis exceeded its limit." });
  // Movement data is addressed relative to the end of ActorCmdExec, independently of script branches.
  const movements = new Set<number>();
  for (const command of commands.filter(command => command.opcode === 0x64)) {
    let at = command.offset + command.size + (readU32(bytes, command.offset + 4) | 0), ended = movements.has(at);
    const starts: number[] = [];
    if (ended) continue;
    for (let count = 0; count < 4096; count++, at += 4) {
      if (at < tableEnd || at + 4 > bytes.length || covered[at] !== -1) break;
      const opcode = readU16(bytes, at);
      if (!translationScriptContracts.movementOpcodes.includes(opcode)) break;
      starts.push(at);
      covered.fill(command.offset, at, at + 4);
      if (opcode === 0xfe) { ended = true; for (const start of starts) movements.add(start); break; }
    }
    if (!ended) diagnostics.push({ code: "movement-dependency", severity: "blocked", offset: command.offset, opcode: command.opcode,
      reason: "The movement target, terminator or movement command contract could not be validated." });
  }
  commands.sort((a, b) => a.offset - b.offset);
  return { entries, commands, byOffset, diagnostics, uncovered: bytes.filter((value, at) => at >= tableEnd && covered[at] === -1 && value !== 0) };
}

function token(bytes: Uint8Array, command: Command): string {
  let data = bytes.subarray(command.offset, command.offset + command.size);
  if (flow.has(command.opcode) || command.opcode === 0x64) data = data.subarray(0, data.length - 4);
  return Array.from(data, value => value.toString(16).padStart(2, "0")).join("");
}

/** Bounded LCS after removing common ends; keeps repeated commands paired by position. */
function align(a: string[], b: string[]): Map<number, number> | undefined {
  const result = new Map<number, number>();
  let first = 0, ae = a.length, be = b.length;
  while (first < ae && first < be && a[first] === b[first]) { result.set(first, first); first++; }
  while (ae > first && be > first && a[ae - 1] === b[be - 1]) { result.set(--be, --ae); }
  const n = ae - first, m = be - first;
  if (n * m > 4_000_000) return undefined;
  const rows = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) rows[i][j] = a[first + i] === b[first + j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[first + i] === b[first + j]) { result.set(first + j++, first + i++); }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i++;
    else j++;
  }
  return result;
}

export const translationScriptContracts = contracts as {
  globalRanges: { start: number; end: number; member: number; bank: number }[];
  zoneOverlays: Record<string, number>; sharedOverlays: Record<string, number>;
  handlers: Record<string, { address: number; segment: string }>;
  movementOpcodes: number[]; workVariables: number[];
  overlayHandlers: Record<string, Record<string, number>>;
};

export function translationScriptContexts(member: number, headers: Uint8Array | undefined, originalHeaders?: Uint8Array): ScriptContext[] {
  const contexts: ScriptContext[] = [];
  if (headers && headers.length % 48 === 0) for (let at = 0; at < headers.length; at += 48) {
    if (readU16(headers, at + 6) === member) contexts.push({ map: at / 48, bank: readU16(headers, at + 10),
      sourceBank: originalHeaders && readU16(originalHeaders, at + 6) === member ? readU16(originalHeaders, at + 10) : undefined,
      overlay: translationScriptContracts.zoneOverlays[at / 48] });
  }
  for (const range of translationScriptContracts.globalRanges.filter(range => range.member === member)) contexts.push({ bank: range.bank, sourceBank: range.bank, overlay: translationScriptContracts.sharedOverlays[member] });
  return contexts.length ? [...new Map(contexts.map(context => [`${context.bank}/${context.sourceBank}/${context.overlay}`, context])).values()] : [{}];
}

type AuditInput = {
  member: number; original: Uint8Array; incoming: Uint8Array; contexts: ScriptContext[];
  sourceText: ScriptTextLookup; donorText: ScriptTextLookup; outputText: ScriptTextLookup;
  globalEntryCount: (member: number) => number | undefined;
  nativeChanges?: ReadonlySet<string>; dataCounts?: Record<string, number>;
  locale?: TranslationLocaleId;
  addedBankWordSlot?: (bank: number) => { entry: number; slot: number } | undefined;
};

export function auditTranslationScript(input: AuditInput): { bytes: Uint8Array; audit: TranslationScriptAudit } {
  const { member, original, incoming, contexts } = input;
  const audit: TranslationScriptAudit = { member, status: "imported", entries: 0, commands: 0, contexts,
    references: [], diagnostics: [], rewrites: [], nativeDependencies: [] };
  const output = incoming.slice(), rewriteValues = new Map<number, Set<number>>();
  const add = (diagnostic: ScriptDiagnostic) => audit.diagnostics.push(diagnostic);
  for (const dependency of ["arm9", "arm9OverlayTable", "overlay/arm9/12"]) if (input.nativeChanges?.has(dependency)) add({
    code: "donor-native-dependency", severity: bytesEqual(original, incoming) ? "warning" : "blocked", dependency,
    reason: "The donor changed a VM/dispatch dependency. Its effect on script behavior cannot be resolved while retaining the US implementation.",
  });
  for (const context of contexts) {
    const us = program(original, context.overlay), donor = program(incoming, context.overlay);
    audit.entries = donor.entries.length; audit.commands = Math.max(audit.commands, donor.commands.length);
    audit.diagnostics.push(...donor.diagnostics);
    if (!bytesEqual(us.uncovered, donor.uncovered)) add({ code: "unparsed-script-data", severity: "blocked", reason: "Changed embedded or unreachable data has no decoded US script/movement contract." });
    if (us.entries.length !== donor.entries.length) add({ code: "script-entry-count", severity: "blocked", reason: "Entry count changed; map and global script IDs require the US entry contract." });
    const shape = (command: Command) => [0x4d, 0x4e].includes(command.opcode) ? "item-name" : String(command.opcode);
    const pairing = align(us.commands.map(shape), donor.commands.map(shape));
    if (!pairing) { add({ code: "script-diff-budget", severity: "blocked", reason: "The script changes exceed the bounded minor-edit comparison." }); continue; }
    const inherited = new Map<number, Command>(), structure = new Map<number, Command>();
    for (const [index, sourceIndex] of pairing) {
      const a = us.commands[sourceIndex], b = donor.commands[index]; structure.set(b.offset, a);
      if (token(original, a) === token(incoming, b)) inherited.set(b.offset, a);
    }
    const impacted = new Set<number>(), impactedSlots = new Set<number>();
    const sameItemBinding = (a: Command | undefined, b: Command | undefined) => a && b && [0x4d, 0x4e].includes(a.opcode) && [0x4d, 0x4e].includes(b.opcode)
      && original[a.offset + 2] === incoming[b.offset + 2] && readU16(original, a.offset + 3) === readU16(incoming, b.offset + 3);
    let changedOpaque = false, changedFlow = false;
    for (const command of donor.commands) if (!inherited.has(command.offset)) {
      if (writesWork(command.opcode)) impacted.add(readU16(incoming, command.offset + 2));
      else if (word(command.opcode) && !sameItemBinding(structure.get(command.offset), command)) impactedSlots.add(incoming[command.offset + 2]);
      else if (!pure.has(command.opcode) && !word(command.opcode) && !messageOperands[command.opcode] && command.opcode !== 0x64) changedOpaque = true;
    }
    const matchedSource = new Set([...inherited.values()].map(command => command.offset));
    for (const command of us.commands) if (!matchedSource.has(command.offset)) {
      if (writesWork(command.opcode)) impacted.add(readU16(original, command.offset + 2));
      else if (word(command.opcode) && !sameItemBinding(command, donor.commands.find(other => structure.get(other.offset) === command))) impactedSlots.add(original[command.offset + 2]);
      else if (!pure.has(command.opcode) && !word(command.opcode) && !messageOperands[command.opcode] && command.opcode !== 0x64) changedOpaque = true;
    }
    // Copies make edits to a source variable relevant to consumers of its destination too.
    let expanded = true;
    while (expanded) { expanded = false; for (const command of [...us.commands, ...donor.commands]) {
      const bytes = us.byOffset.get(command.offset) === command ? original : incoming;
      if ([0x29, 0x2a].includes(command.opcode) && impacted.has(readU16(bytes, command.offset + 4)) && !impacted.has(readU16(bytes, command.offset + 2))) {
        impacted.add(readU16(bytes, command.offset + 2)); expanded = true;
      }
    } }
    for (const command of donor.commands) {
      const counterpart = inherited.get(command.offset), shapeCounterpart = structure.get(command.offset);
      if (flow.has(command.opcode)) {
        let target = command.target!;
        // A new assignment may be inserted immediately before the original branch target.
        while (donor.byOffset.has(target) && !structure.has(target) && !flow.has(donor.byOffset.get(target)!.opcode) && !terminal.has(donor.byOffset.get(target)!.opcode)) target += donor.byOffset.get(target)!.size;
        if (!shapeCounterpart || structure.get(target)?.offset !== shapeCounterpart.target) changedFlow = true;
      }
      if (command.opcode < 1000 && !translationScriptContracts.handlers[command.opcode]) add({ code: "native-command-unavailable", severity: "blocked", offset: command.offset, opcode: command.opcode, reason: "This command has no native handler in the clean US ROM." });
      if (command.opcode >= 1000 && !translationScriptContracts.overlayHandlers[context.overlay ?? -1]?.[command.opcode]) add({ code: "native-overlay-command-unavailable", severity: "blocked", offset: command.offset, opcode: command.opcode,
        reason: "This overlay command has no verified native handler in the active US overlay." });
      const segment = command.opcode >= 1000 ? `overlay/arm9/${context.overlay}` : translationScriptContracts.handlers[command.opcode]?.segment ?? "unresolved";
      const unaudited = !counterpart && !editable(command.opcode);
      if (unaudited || segment === "unresolved") add({ code: "native-contract-unresolved", severity: "blocked", offset: command.offset, opcode: command.opcode, dependency: segment,
        reason: "A new or changed native call has no audited operand and side-effect contract for this port." });
      audit.nativeDependencies.push({ opcode: command.opcode, segment, resolution: unaudited || segment === "unresolved" ? "unresolved" : "US contract" });
      if (input.nativeChanges?.has(segment)) add({ code: "donor-native-dependency", severity: "blocked", offset: command.offset, opcode: command.opcode, dependency: segment,
        reason: "The donor edited the native module used by this script; its dependency on that code cannot be resolved while retaining US code." });
      if (globalCalls.has(command.opcode)) {
        const id = readU16(incoming, command.offset + 2), range = translationScriptContracts.globalRanges.find(range => id >= range.start && id <= range.end);
        const count = range && input.globalEntryCount(range.member);
        if (opcodeIsClearReservation(command.opcode, id) || id >= 1 && id <= donor.entries.length && context.map !== undefined) continue;
        if (id >= 0x4000 || !range || count === undefined || id - range.start >= count) add({ code: "global-script-reference", severity: counterpart ? "warning" : "blocked", offset: command.offset, opcode: command.opcode, dependency: `script/${id}`,
          reason: "The called or reserved global script entry could not be resolved in the US script table." });
        else if (translationScriptContracts.sharedOverlays[range.member] !== undefined && translationScriptContracts.sharedOverlays[range.member] !== context.overlay) add({ code: "native-overlay-context", severity: counterpart ? "warning" : "blocked", offset: command.offset, opcode: command.opcode,
          dependency: `overlay/arm9/${translationScriptContracts.sharedOverlays[range.member]}`, reason: "The callee needs a native command overlay that is not established in this map context." });
      }
    }
    // Context-insensitive return summaries over-approximate callers. Join conflicting
    // values to unknown rather than losing paths or enumerating exponential call strings.
    const returnEdges = new Map<number, Set<number>>();
    for (const call of donor.commands.filter(command => command.opcode === 4 || command.opcode === 0x20)) {
      const visited = new Set<number>(), todo = [call.target!];
      while (todo.length) {
        const at = todo.pop()!; if (visited.has(at)) continue; visited.add(at);
        const command = donor.byOffset.get(at); if (!command) continue;
        if (command.opcode === 5) { const targets = returnEdges.get(at) ?? new Set(); targets.add(call.offset + call.size); returnEdges.set(at, targets); }
        else if (!terminal.has(command.opcode)) {
          if (command.opcode === 0x1e || command.opcode === 0x1f) todo.push(command.target!);
          if (command.opcode !== 0x1e) todo.push(at + command.size);
        }
      }
      const graph = [call.target!], reachable = new Set<number>();
      while (graph.length) {
        const at = graph.pop()!; if (reachable.has(at)) continue; reachable.add(at);
        const command = donor.byOffset.get(at); if (!command || terminal.has(command.opcode)) continue;
        if (flow.has(command.opcode)) graph.push(command.target!);
        if (command.opcode !== 0x1e) graph.push(at + command.size);
      }
      const counterpart = structure.get(call.offset), introduced = !counterpart || structure.get(call.target!)?.offset !== counterpart.target;
      if (reachable.has(call.offset) && introduced) add({ code: "script-call-recursion", severity: "blocked", offset: call.offset, opcode: call.opcode,
        reason: "A new internal call can recurse into itself; its native VM stack bound is unresolved." });
    }
    type State = { at: number; values: Map<number, number>; slots: Set<number>; tainted: Set<number> };
    const pending: State[] = donor.entries.map(at => ({ at, values: new Map(), slots: new Set(), tainted: new Set() }));
    const seen = new Map<string, { values: Map<number, number>; slots: Set<number>; tainted: Set<number> }>(), tracked = new Set<number>();
    for (const command of donor.commands) {
      const spec = messageOperands[command.opcode];
      for (const relative of [...(spec?.ids ?? []), ...(spec?.bank === undefined ? [] : [spec.bank])]) {
        const raw = readU16(incoming, command.offset + relative); if (raw >= 0x4000) tracked.add(raw);
      }
    }
    // Include all copy dependencies, even when the copied variable itself is not a message operand.
    expanded = true;
    while (expanded) { expanded = false; for (const command of donor.commands) if ([0x29, 0x2a].includes(command.opcode) && tracked.has(readU16(incoming, command.offset + 2))) {
      const id = readU16(incoming, command.offset + 4); if (id >= 0x4000 && !tracked.has(id)) { tracked.add(id); expanded = true; }
    } }
    let steps = 0;
    while (pending.length && steps++ < 20000) {
      const state = pending.pop()!;
      const key = String(state.at), previous = seen.get(key);
      if (previous) {
        const values = new Map([...previous.values].filter(([id, value]) => state.values.get(id) === value));
        const slots = new Set([...previous.slots].filter(slot => state.slots.has(slot)));
        const tainted = new Set([...previous.tainted, ...state.tainted]);
        if (values.size === previous.values.size && slots.size === previous.slots.size && tainted.size === previous.tainted.size) continue;
        state.values = values; state.slots = slots;
        state.tainted = tainted;
      }
      seen.set(key, { values: new Map(state.values), slots: new Set(state.slots), tainted: new Set(state.tainted) });
      const command = donor.byOffset.get(state.at); if (!command) continue;
      const { offset, opcode, size } = command, counterpart = inherited.get(offset);
      const value = (raw: number) => raw < 0x4000 ? raw : state.values.get(raw);
      const spec = messageOperands[opcode];
      if (!pure.has(opcode) && !word(opcode) && !spec) {
        const explicit = [...state.tainted].find(variable => Array.from({ length: Math.max(0, size - 3) }, (_, i) => readU16(incoming, offset + 2 + i)).includes(variable));
        const implicit = globalCalls.has(opcode) ? [...state.tainted].find(variable => variable >= 0x8000 && variable < 0x8020) : undefined;
        const variable = explicit ?? implicit;
        if (variable !== undefined) add({ code: "native-argument-unresolved", severity: "blocked", offset, opcode, variable,
          dependency: globalCalls.has(opcode) ? `script/${readU16(incoming, offset + 2)}` : translationScriptContracts.handlers[opcode]?.segment,
          reason: "An edited work value reaches a native/global callee without an audited argument contract. Its data bounds or downstream effects cannot be resolved." });
      }
      if (spec) for (const relative of spec.ids) {
        const rawBank = spec.bank === undefined ? undefined : readU16(incoming, offset + spec.bank);
        const rawId = readU16(incoming, offset + relative);
        if (opcode === 0x230 && input.locale === "korean" && context.bank !== undefined) add({ code: "regional-text-renderer", severity: "blocked", offset, opcode, bank: context.bank, dependency: "Korean Abyssal Ruins renderer/resources",
          reason: "The regional sign renderer and its special glyph/resource references require a dedicated US port; the ordinary Korean text slots are empty." });
        const bankValue = rawBank === undefined ? 1024 : value(rawBank);
        const selectedBank = bankValue === 1024 ? context.bank : bankValue;
        const id = value(rawId);
        const shapeCounterpart = structure.get(offset), oldSpec = shapeCounterpart && messageOperands[shapeCounterpart.opcode];
        const sourceBank = oldSpec?.bank === undefined || readU16(original, shapeCounterpart!.offset + oldSpec.bank) === 1024 ? context.sourceBank : readU16(original, shapeCounterpart!.offset + oldSpec.bank);
        const sourceId = shapeCounterpart ? readU16(original, shapeCounterpart.offset + relative) : undefined;
        if (selectedBank === undefined || id === undefined) {
          const bankUntouched = rawBank === undefined || rawBank === 1024 ? context.bank === context.sourceBank : rawBank < 0x4000 || !impacted.has(rawBank);
          const trusted = Boolean(counterpart) && bankUntouched && !impacted.has(rawId) && !changedOpaque && !changedFlow;
          const binding = selectedBank === undefined ? undefined : input.addedBankWordSlot?.(selectedBank);
          const assignedMessageIds = rawId >= 0x4000 ? [...new Set(donor.commands.filter(command => command.opcode === 0x28 && readU16(incoming, command.offset + 2) === rawId).map(command => readU16(incoming, command.offset + 4)))] : undefined;
          audit.references.push({ offset, opcode, bank: selectedBank, messageId: id, messageVariable: rawId >= 0x4000 ? rawId : undefined, assignedMessageIds, status: trusted && !binding ? "inherited" : "unresolved" });
          if (binding) add({ code: "dynamic-word-bank-contract", severity: bytesEqual(original, incoming) ? "warning" : "blocked", offset, opcode, bank: selectedBank, messageId: binding.entry,
            reason: `Output entry ${binding.entry} adds word slot ${binding.slot} to the US contract. A runtime-selected message cannot establish that slot's producer.` });
          add({ code: "dynamic-text-reference", severity: trusted && !binding || bytesEqual(original, incoming) ? "warning" : "blocked", offset, opcode, bank: selectedBank, variable: id === undefined ? rawId : rawBank,
            reason: trusted ? "The unchanged US call uses a native/runtime message value. It is retained as a US dependency; its runtime range was not statically proven." : "A new or affected text bank/message variable could not be resolved on every path." });
          continue;
        }
        let mapped = id, target = input.outputText(selectedBank, id);
        const incomingText = input.donorText(selectedBank, id);
        if (target === undefined && selectedBank === 436 && id >= 592 && id < 600 && incomingText !== undefined && input.donorText(selectedBank, id - 80)?.includes("VAR(514, 0)")
          && incomingText === input.donorText(selectedBank, id - 80)?.replace("VAR(514, 0)", "-VAR(514, 0)")) {
          mapped = id - 80; target = input.outputText(selectedBank, mapped);
        }
        const sourceText = sourceId !== undefined && sourceId < 0x4000 && sourceBank !== undefined ? input.sourceText(sourceBank, sourceId) : undefined;
        const slots = textSlots(target), originalSlots = textSlots(sourceText);
        const reference: ScriptTextReference = { offset, opcode, bank: selectedBank, messageId: id, status: target === undefined ? "unresolved" : mapped === id ? "resolved" : "remapped",
          sourceText: sample(sourceText), donorText: sample(incomingText), outputText: sample(target), wordSlots: slots };
        audit.references.push(reference);
        if (target === undefined) add({ code: "text-reference-missing", severity: "blocked", offset, opcode, bank: selectedBank, messageId: id,
          reason: "This text entry is absent from the actual merged output bank, including retained or omitted donor entries." });
        if (opcode === 0x230 && input.locale === "korean" && id >= 0x1000) add({ code: "regional-text-renderer", severity: "blocked", offset, opcode, bank: selectedBank, messageId: id, dependency: "Korean Abyssal Ruins renderer/resources",
          reason: "Special glyph IDs refer to a regional renderer/resource contract; the corresponding ordinary Korean text entries are empty." });
        for (const slot of slots) if (!state.slots.has(slot)) {
          const trusted = Boolean(shapeCounterpart) && originalSlots.includes(slot) && !impactedSlots.has(slot) && !changedOpaque && !changedFlow;
          add({ code: "word-binding-unresolved", severity: trusted ? "warning" : "blocked", offset, opcode, bank: selectedBank, messageId: id,
            reason: trusted ? `Word slot ${slot} is supplied by the unchanged US/native context; its producer is not statically resolved.` : `Word slot ${slot} required by the decrypted output text has no resolved producer on this path.` });
        }
        if (mapped !== id) {
          const at = offset + relative, values = rewriteValues.get(at) ?? new Set(); values.add(mapped); rewriteValues.set(at, values);
          audit.rewrites.push({ offset: at, before: rawId, after: mapped, reason: "Use the existing US boss-floor hint ID and its positive floor-label convention." });
        } else { const at = offset + relative, values = rewriteValues.get(at) ?? new Set(); values.add(rawId); rewriteValues.set(at, values); }
      }
      if (word(opcode)) {
        const slot = incoming[offset + 2];
        if (slot > 15) add({ code: "word-slot-range", severity: "blocked", offset, opcode, reason: "The word-buffer index is outside the audited US word-slot range." });
        state.slots.add(slot);
        const knownData = [0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x57, 0x58, 0x5c].includes(opcode);
        if (!knownData && (!counterpart || size >= 5 && state.tainted.has(readU16(incoming, offset + 3)))) add({ code: "native-word-data-contract", severity: "blocked", offset, opcode,
          reason: "The edited word-data lookup has no audited US data-index contract." });
        if (opcode === 0x5c) { const width = value(readU16(incoming, offset + 5)); if (width === undefined && !counterpart || width !== undefined && (width < 1 || width > 10)) add({ code: "native-number-format", severity: "blocked", offset, opcode,
          reason: "The number-format width is outside the supported contract or could not be resolved." }); }
        const bounds = [0x4d, 0x4e, 0x4f, 0x50, 0x52].includes(opcode) ? input.dataCounts?.items : opcode === 0x51 ? input.dataCounts?.moves : [0x57, 0x58].includes(opcode) ? input.dataCounts?.species : undefined;
        if (bounds !== undefined && size >= 5) { const id = value(readU16(incoming, offset + 3)); if (id !== undefined && id >= bounds) add({ code: "native-data-reference", severity: "blocked", offset, opcode, reason: "A word-name data index exceeds the corresponding output archive." }); }
        if ([0x53, 0x54].includes(opcode)) { const index = value(readU16(incoming, offset + 3)); if (index !== undefined && index >= 6) add({ code: "native-party-reference", severity: "blocked", offset, opcode, reason: "The party-name source index is outside the US party-slot contract." }); }
      }
      if (writesWork(opcode)) {
        const destination = readU16(incoming, offset + 2), operand = size >= 6 ? readU16(incoming, offset + 4) : undefined, v = operand === undefined ? undefined : value(operand);
        if (!translationScriptContracts.workVariables.includes(destination)) add({ code: "work-variable-range", severity: "blocked", offset, opcode, variable: destination, reason: "The work-variable destination has no verified use in the stock US script contract." });
        if (!counterpart || operand !== undefined && state.tainted.has(operand) || opcode !== 0x28 && state.tainted.has(destination)) state.tainted.add(destination);
        else state.tainted.delete(destination);
        if ([0x2c, 0x2d].includes(opcode) && v === 0) add({ code: "work-arithmetic", severity: "blocked", offset, opcode, reason: "A resolved division/modulo operand is zero." });
        if (tracked.has(destination)) {
          const previous = state.values.get(destination);
          if (opcode === 0x28) state.values.set(destination, operand!);
          else if (v !== undefined && (opcode === 0x29 || opcode === 0x2a)) state.values.set(destination, v);
          else if (v !== undefined && previous !== undefined && opcode === 0x26) state.values.set(destination, (previous + v) & 0xffff);
          else if (v !== undefined && previous !== undefined && opcode === 0x27) state.values.set(destination, (previous - v) & 0xffff);
          else if (v !== undefined && previous !== undefined && opcode === 0x12) state.values.set(destination, previous & v);
          else if (v !== undefined && previous !== undefined && opcode === 0x13) state.values.set(destination, previous | v);
          else state.values.delete(destination);
        }
      } else if (!pure.has(opcode) && !word(opcode) && !spec) {
        // Unknown native effects and global calls must not leave stale constant values behind.
        state.values.clear();
      }
      if (opcode === 3 || globalCalls.has(opcode) || spec) for (const id of state.values.keys()) if (id < 0x8000) state.values.delete(id);
      const next = offset + size;
      const push = (at: number) => pending.push({ at, values: new Map(state.values), slots: new Set(state.slots), tainted: new Set(state.tainted) });
      if (opcode === 5) { for (const target of returnEdges.get(offset) ?? []) push(target); }
      else if (terminal.has(opcode)) { /* entry finished */ }
      else if (opcode === 4 || opcode === 0x20) {
        push(command.target!);
        if (opcode === 0x20) push(next);
      } else if (opcode === 0x1e) push(command.target!);
      else if (opcode === 0x1f) { push(command.target!); push(next); }
      else push(next);
    }
    if (steps >= 20000) add({ code: "script-state-budget", severity: "blocked", reason: "Message/data-flow analysis exceeded its limit; unresolved paths are not imported." });
  }
  for (const [at, values] of rewriteValues) if (values.size > 1 && audit.rewrites.some(rewrite => rewrite.offset === at)) add({ code: "text-remap-ambiguous", severity: "blocked", offset: at,
    reason: "The same message operand needs different rewrites across contexts or paths." });
  audit.diagnostics = [...new Map(audit.diagnostics.map(item => [JSON.stringify(item), item])).values()];
  audit.references = [...new Map(audit.references.map(item => [JSON.stringify(item), item])).values()];
  audit.rewrites = [...new Map(audit.rewrites.map(item => [JSON.stringify(item), item])).values()];
  audit.nativeDependencies = [...new Map(audit.nativeDependencies.map(item => [`${item.opcode}/${item.segment}/${item.resolution}`, item])).values()];
  if (audit.diagnostics.some(item => item.severity === "blocked")) { audit.status = bytesEqual(original, incoming) ? "unchanged" : "retained"; return { bytes: original, audit }; }
  for (const rewrite of audit.rewrites) writeU16(output, rewrite.offset, rewrite.after);
  audit.status = audit.rewrites.length ? "adapted" : "imported";
  if (bytesEqual(output, original)) audit.status = bytesEqual(original, incoming) ? "unchanged" : "retained";
  return { bytes: output, audit };
}
