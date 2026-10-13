import { readU16, readU32 } from "../../nds/binary";
import { gen5ScriptCommandSize, gen5ScriptEntries } from "../gen5ScriptCommands";
import { bw2CommandByOpcode } from "./commands";
import { compileBw2Script } from "./compiler";
import { BW2_OVERLAY_LAYOUTS } from "./commandLayouts";
import { BW2_WORK_OPERANDS, bw2WorkAlias } from "./workAliases";
import { bw2MovementByOpcode } from "./movementCommands";
import { recoverBw2Movements, recoverOrphanBw2MovementPools } from "./movementRecovery";
import { verifyBw2ScriptDispatch } from "./dispatchValidation";
import { recoverBw2DetachedCode } from "./codeRecovery";
import { BW2_SCRIPT_MACROS } from "./macros";

export class Bw2ScriptDecompileError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (byte 0x${offset.toString(16)})`);
    this.name = "Bw2ScriptDecompileError";
  }
}
export type DecompiledBw2Script = {
  source: string;
  roundTripVerified: true;
  editable: boolean;
  warnings: string[];
  stats: { entries: number; instructions: number; structuredBlocks: number; helpers: number; movements: number };
};
type Instruction = { offset: number; next: number; opcode: number; args: number[]; targets: Map<number, number>; dispatchId?: number };
const OPS = ["<", "==", ">", "<=", ">=", "!="];
const INVERSE = [">=", "!=", "<=", ">", "<", "=="];
const hex = (n: number, width = 4): string => `0x${n.toString(16).padStart(width, "0")}`;
export const bw2ScriptBytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Decode live control flow and complete detached code/movement records.
 * Unrecognized bytes remain explicit, read-only data. */
export function decompileBw2Script(bytes: Uint8Array, options: { overlayId?: number; recoverMacros?: boolean; codeOffsets?: readonly number[]; movementOffsets?: readonly number[]; codeRanges?: readonly { offset: number; endOffset: number }[]; dispatchHints?: readonly { offset: number; dispatchId: number }[] } = {}): DecompiledBw2Script {
  const overlayId = options.overlayId;
  if (overlayId !== undefined && !Object.hasOwn(BW2_OVERLAY_LAYOUTS, overlayId)) throw new Bw2ScriptDecompileError("Unsupported BW2 command overlay", 0);
  if (bytes.length > 4_000_000) throw new Bw2ScriptDecompileError("Script exceeds the four-million-byte limit", 0);
  const entries = gen5ScriptEntries(bytes);
  if (!entries.length) {
    if (bytes.length < 2 || readU16(bytes, 0) !== 0xfd13) throw new Bw2ScriptDecompileError("Unrecognized entry table", 0);
    const tail = bytes.subarray(2), editable = tail.every((byte) => byte === 0);
    const source = `# Empty BW2 script entry table.\npreserve_layout\n${overlayId !== undefined ? `overlay ${overlayId}\n` : ""}${tail.length ? `data :padding, ${Array.from(tail, (byte) => hex(byte, 2)).join(", ")}\n` : ""}`;
    if (!bw2ScriptBytesEqual(compileBw2Script(source).bytes, bytes)) throw new Bw2ScriptDecompileError("Empty entry table round trip changed bytes", 0);
    return { source, roundTripVerified: true, editable, warnings: editable ? [] : ["Unrecognized nonzero payload bytes are preserved; edits are disabled."], stats: { entries: 0, instructions: 0, structuredBlocks: 0, helpers: 0, movements: 0 } };
  }
  const tableEnd = entries.length * 4 + 2;
  const fail = (message: string, offset: number): never => { throw new Bw2ScriptDecompileError(message, offset); };
  const instructions = new Map<number, Instruction>();
  const owner = new Int32Array(bytes.length);
  const data = new Set<number>();
  const movementStarts = new Set<number>();
  const calls = new Set<number>();
  const targets = new Set(entries);
  const edges: { from: number; to: number }[] = entries.map((to) => ({ from: -1, to }));
  const warnings = new Set<string>();
  const sourceRoots = new Set(options.codeOffsets ?? []);
  const liveRoots = new Set(entries);
  const pending = [...new Set([...sourceRoots, ...entries])];
  const dispatchHints = new Map((options.dispatchHints ?? []).map((hint) => [hint.offset, hint.dispatchId]));
  // Compiler-generated zero-store prologues/epilogues have no relative operands.
  // Decode only the complete recognized sequence; never walk through its padding.
  const islands = new Map<number, number>((options.codeRanges ?? []).map((range) => [range.offset, range.endOffset]));
  const recoverZeroStores = (start: number): number => {
    let p = start;
    while (p + 6 <= bytes.length && !owner[p] && readU16(bytes, p) === 0x28 && readU16(bytes, p + 2) >= 0x8020 && readU16(bytes, p + 2) <= 0x80ff && readU16(bytes, p + 4) === 0 &&
      Array.from(owner.subarray(p, p + 6)).every((tag) => !tag)) p += 6;
    if ([...targets].some((target) => target >= start && target < p && (target - start) % 6)) return start;
    if (p > start) { sourceRoots.add(start); pending.push(start); islands.set(start, p); }
    return p;
  };


  const checkTarget = (target: number, from: number): void => {
    if (target < tableEnd || target + 2 > bytes.length) fail("Relative pointer leaves the script payload", from);
  };
  const claim = (start: number, end: number, tag: number): void => {
    for (let p = start; p < end; p++) {
      if (owner[p] && owner[p] !== tag) fail("Code, operands, or typed data overlap", p);
      owner[p] = tag;
    }
  };
  const typedData = (start: number, movement: boolean): void => {
    if (owner[start] > 0) fail("Code and typed data overlap", start);
    data.add(start); targets.add(start);
    if (movement) movementStarts.add(start);
    if (movement && start % 2) warnings.add(`Unaligned movement data at ${hex(start)}; edits are disabled.`);
    let p = start, terminated = false;
    for (let record = 0; record < (movement ? bytes.length / 4 : 8); record++) {
      if (p + 2 > bytes.length) break;
      const id = readU16(bytes, p);
      if (id === (movement ? 0xfe : 0xffff)) {
        // Movement terminators still carry a two-byte parameter.
        const end = p + (movement ? 4 : 2);
        if (end > bytes.length) break;
        claim(p, end, movement ? -1 : -2); terminated = true; break;
      }
      const size = movement ? 4 : 10;
      if (p + size > bytes.length) break;
      // Unsupported movement IDs may use different payloads: do not relocate them.
      if (movement && !bw2MovementByOpcode(id)) {
        warnings.add(`Unknown movement ${hex(id)} at ${hex(p)}; edits are disabled.`); return;
      }
      claim(p, p + size, movement ? -1 : -2); p += size;
    }
    if (!terminated) warnings.add(`Unterminated ${movement ? "movement" : "elevator"} data at ${hex(start)}; edits are disabled.`);
  };
  while (pending.length) {
    let offset = pending.pop()!;
    let dispatchId = dispatchHints.get(offset) ?? overlayId;
    const live = liveRoots.has(offset);
    const codeLimit = live ? undefined : islands.get(offset);
    while (!instructions.has(offset)) {
      checkTarget(offset, offset);
      if (owner[offset]) fail("Control flow targets an operand or data byte", offset);
      if (dispatchHints.has(offset)) dispatchId = dispatchHints.get(offset);
      const opcode = readU16(bytes, offset);
      const layout = bw2CommandByOpcode(opcode, dispatchId)?.definition;
      const size = gen5ScriptCommandSize(opcode, "BW2", dispatchId);
      if (!layout || !size || 2 + layout.widths.reduce((sum, width) => sum + width, 0) !== size || offset + size > bytes.length) {
        warnings.add(`Unknown or truncated command ${hex(opcode)} at ${hex(offset)}; edits are disabled.`);
        break;
      }
      const instruction: Instruction = { offset, next: offset + size, opcode, args: [], targets: new Map(), dispatchId };
      claim(offset, instruction.next, offset + 1);
      let p = offset + 2;
      for (const [index, width] of layout.widths.entries()) {
        const value = width === 1 ? bytes[p] : width === 2 ? readU16(bytes, p) : readU32(bytes, p);
        instruction.args.push(value);
        const kind = layout.relative?.[index];
        if (kind) {
          const target = p + 4 + (value | 0);
          checkTarget(target, p); instruction.targets.set(index, target); targets.add(target);
          if (kind === "movement" || kind === "data") typedData(target, kind === "movement");
          else {
            pending.push(target); if (!dispatchHints.has(target) && dispatchId !== undefined) dispatchHints.set(target, dispatchId); if (live) liveRoots.add(target); edges.push({ from: offset, to: target });
            if (kind === "call") calls.add(target);
          }
        }
        p += width;
      }
      instructions.set(offset, instruction);
      if (overlayId === 58 && opcode === 0x2c6) dispatchId = 60;
      if (overlayId === 58 && opcode === 0x2c7) dispatchId = 58;
      if (opcode === 2 || opcode === 5 || opcode === 0x1d || opcode === 0x1e) break;
      if (instruction.next === bytes.length) { if (instruction.next !== codeLimit) warnings.add(`Code falls off the file at ${hex(offset)}; edits are disabled.`); break; }
      if (codeLimit !== undefined && instruction.next > codeLimit) fail("Declared code range ends inside an instruction", codeLimit);
      if (instruction.next === codeLimit) break;
      offset = instruction.next;
    }
  }
  // A complete movement pool is stronger evidence than an incidental opcode
  // pattern inside its parameters. Claim it before scanning for zero stores.
  for (const movement of recoverOrphanBw2MovementPools(bytes, movementStarts, targets, owner)) {
    if (movement.start < tableEnd) continue;
    claim(movement.start, movement.end, -1);
    movementStarts.add(movement.start); data.add(movement.start); targets.add(movement.start);
  }
  // Recover only pointer-free zero-store islands and orphan jumps whose target
  // already has a verified instruction boundary. New code still uses the same decoder.
  for (let p = tableEnd; p + 2 <= bytes.length; p++) {
    if (owner[p] || !bytes[p]) continue;
    const end = recoverZeroStores(p);
    if (end > p) { p = end - 1; continue; }
    if (p + 6 <= bytes.length && readU16(bytes, p) === 0x1e && Array.from(owner.subarray(p, p + 6)).every((tag) => !tag) &&
        ![...targets].some((target) => target > p && target < p + 6) && instructions.has(p + 6 + (readU32(bytes, p + 2) | 0))) {
      sourceRoots.add(p); pending.push(p);
    }
  }
  if (pending.length) {
    // A recursive pass with verified roots reuses all overlap and size checks.
    return decompileBw2Script(bytes, { ...options, codeOffsets: [...new Set([...sourceRoots, ...pending])], codeRanges: [...islands].map(([offset, endOffset]) => ({ offset, endOffset })), dispatchHints: [...dispatchHints].map(([offset, dispatchId]) => ({ offset, dispatchId })) });
  }
  for (const offset of options.movementOffsets ?? []) { checkTarget(offset, offset); typedData(offset, true); }
  for (const offset of sourceRoots) { checkTarget(offset, offset); targets.add(offset); }
  // Hints from verified source declare unused code/movements. Every hinted
  // region still passes the decoder's independent boundaries and opcode checks.
  // A later decoded instruction must not hide an earlier unknown entry/branch target.
  for (const target of targets) {
    if (!data.has(target) && owner[target] && !instructions.has(target)) fail("Control flow targets an operand or data byte", target);
  }
  const detached: { offset: number; endOffset: number }[] = [];
  for (let start = tableEnd; start < bytes.length; start++) {
    if (owner[start]) continue;
    let end = start; while (end < bytes.length && !owner[end]) end++;
    const range = recoverBw2DetachedCode(bytes, start, end, owner, new Set(instructions.keys()), overlayId, targets);
    if (range && !sourceRoots.has(range.offset)) detached.push(range);
    start = end - 1;
  }
  if (detached.length) return decompileBw2Script(bytes, { ...options,
    codeOffsets: [...new Set([...sourceRoots, ...detached.map((range) => range.offset)])],
    codeRanges: [...islands].map(([offset, endOffset]) => ({ offset, endOffset })).concat(detached),
    dispatchHints: [...dispatchHints].map(([offset, dispatchId]) => ({ offset, dispatchId })),
  });
  for (const warning of verifyBw2ScriptDispatch(entries, instructions, overlayId)) warnings.add(warning);
  let codeEnd = tableEnd;
  for (const instruction of instructions.values()) codeEnd = Math.max(codeEnd, instruction.next);
  let unownedNonzero = false;
  for (let p = tableEnd; p < bytes.length; p++) if (!owner[p] && bytes[p] !== 0) { unownedNonzero = true; break; }
  const movements = recoverBw2Movements(bytes, movementStarts, targets, owner, codeEnd, warnings.size > 0 || unownedNonzero);
  // Only complete lists made entirely of documented movement records become
  // trusted typed data. Numeric recovery of unknown words remains read-only.
  for (const movement of movements.values()) {
    if (movement.steps.every((step) => step.opcode === 0xfe || bw2MovementByOpcode(step.opcode))) claim(movement.start, movement.end, -1);
  }
  for (let p = tableEnd; p < bytes.length; p++) {
    if (!owner[p] && bytes[p] !== 0) { warnings.add("Unrecognized nonzero payload bytes are preserved; edits are disabled."); break; }
  }
  const names = new Map<number, string>();
  entries.forEach((offset, index) => { if (!names.has(offset)) names.set(offset, `script_${index + 1}`); });
  for (const offset of calls) if (!names.has(offset)) names.set(offset, `helper_${offset.toString(16)}`);
  for (const offset of targets) if (!names.has(offset)) names.set(offset, `${data.has(offset) ? "data" : "loc"}_${offset.toString(16)}`);
  for (const block of movements.values()) {
    names.set(block.start, `movement_${block.start.toString(16)}`);
    for (const step of block.steps) if (movementStarts.has(step.offset)) names.set(step.offset, `movement_${step.offset.toString(16)}`);
  }
  const name = (offset: number): string => names.get(offset) ?? `loc_${offset.toString(16)}`;
  const roots = new Set([...entries, ...calls, ...sourceRoots]);
  const works = new Set<number>();
  for (const i of instructions.values()) {
    for (const index of bw2CommandByOpcode(i.opcode, i.dispatchId)?.definition.workOperands ?? BW2_WORK_OPERANDS[i.opcode] ?? []) if (i.args[index] >= 0x4000) works.add(i.args[index]);
  }
  const work = (id: number): string => bw2WorkAlias(id).name;
  type StackNode = { text: string; boolean: boolean; inverse?: string };
  type StackTest = { expression: StackNode; branch: Instruction };
  const stackTests = new Map<number, StackTest>();
  // Only fold a self-contained expression with no entry/jump into its interior.
  // Pop/dup/arithmetic, indirect flags, and push-work literal encodings stay raw.
  for (const start of instructions.values()) {
    if (![0x08, 0x09, 0x10].includes(start.opcode)) continue;
    const stack: StackNode[] = [];
    let p = start.offset;
    for (let count = 0; count < 128; count++) {
      const i = instructions.get(p);
      if (!i || (p !== start.offset && targets.has(p))) break;
      const value = i.args[0];
      if (i.opcode === 0x08) stack.push({ text: hex(value), boolean: value === 0 || value === 1 });
      else if (i.opcode === 0x09 && value >= 0x4000) stack.push({ text: work(value), boolean: false });
      else if (i.opcode === 0x10 && value < 0x4000) stack.push({ text: `flag_set?(${hex(value)})`, boolean: true });
      else if (i.opcode === 0x11 && value <= 7 && stack.length >= 2) {
        const right = stack.pop()!, left = stack.pop()!;
        if (value >= 6 && (!left.boolean || !right.boolean)) break;
        const operator = value === 6 ? "||" : value === 7 ? "&&" : OPS[value];
        stack.push({ text: `(${left.text} ${operator} ${right.text})`, boolean: true,
          inverse: value < 6 ? `(${left.text} ${INVERSE[value]} ${right.text})` : undefined });
      } else if (i.opcode === 0x1f && value === 0xff && stack.length === 1 && stack[0].boolean) {
        const expression = stack[0];
        // Bare stack constants are Boolean in a condition but stay numeric in comparisons.
        if (expression.text === "0x0000" || expression.text === "0x0001") expression.text = expression.text === "0x0001" ? "true" : "false";
        stackTests.set(start.offset, { expression, branch: i }); break;
      } else break;
      p = i.next;
    }
  }
  const stackEncoding = stackTests.size > 0;
  const condition = (i: Instruction, branch: Instruction, invert: boolean): string | undefined => {
    if (i.opcode !== 0x19 && i.opcode !== 0x1a) return;
    if (branch.opcode !== 0x1f || branch.args[0] > 5 || i.args[0] < 0x4000 || (i.opcode === 0x1a && i.args[1] < 0x4000)) return;
    if (targets.has(branch.offset)) return;
    const test = `${work(i.args[0])} ${(invert ? INVERSE : OPS)[branch.args[0]]} ${i.opcode === 0x1a ? work(i.args[1]) : hex(i.args[1])}`;
    return stackEncoding ? `vm_compare(${test})` : test;
  };
  const safeRegion = (start: number, end: number, retained: number[]): boolean => {
    const keep = new Set([start, end, ...retained]);
    return !edges.some((edge) => edge.to > start && edge.to < end && !keep.has(edge.to)) &&
      ![...roots].some((root) => root > start && root < end);
  };
  let structuredBlocks = 0;
  function recoverCase(start: number, end: number): { subject: number; clauses: { values: number[]; start: number; end: number }[]; otherwise: number; end: number } | undefined {
    const first = instructions.get(start)!;
    if (first.opcode !== 0x19 || !works.has(first.args[0])) return;
    const clauses: { values: number[]; start: number; end: number }[] = [];
    const structural = new Set<number>();
    const retained = new Set<number>();
    const seen = new Set<number>();
    let cursor = start, commonEnd: number | undefined;
    while (cursor < end && clauses.length < 128) {
      const values: number[] = [];
      let body: number | undefined;
      while (cursor < end) {
        const compare = instructions.get(cursor), branch = compare && instructions.get(compare.next);
        if (!compare || compare.opcode !== 0x19 || compare.args[0] !== first.args[0] || !branch || branch.opcode !== 0x1f || branch.args[0] !== 1 || targets.has(branch.offset)) break;
        const target = branch.targets.get(1)!;
        if (body !== undefined && body !== target || seen.has(compare.args[1])) return;
        seen.add(compare.args[1]); values.push(compare.args[1]); body = target;
        structural.add(branch.offset); cursor = branch.next;
      }
      if (!values.length || body === undefined) break;
      const skip = instructions.get(cursor);
      if (!skip || skip.opcode !== 0x1e || skip.next !== body) return;
      const next = skip.targets.get(0)!;
      const tail = instructions.get(next - 6);
      if (next > end || next < body || !tail || tail.opcode !== 0x1e || tail.offset < body) return;
      const destination = tail.targets.get(0)!;
      if (destination < next || destination > end || commonEnd !== undefined && destination !== commonEnd) return;
      commonEnd = destination;
      structural.add(skip.offset); structural.add(tail.offset); retained.add(body);
      clauses.push({ values, start: body, end: tail.offset }); cursor = next;
      if (cursor === commonEnd) break;
    }
    if (!clauses.length || commonEnd === undefined) return;
    retained.add(cursor);
    if ([...roots].some((root) => root > start && root < commonEnd)) return;
    if (edges.some((edge) => edge.to > start && edge.to < commonEnd && !retained.has(edge.to) && !structural.has(edge.from))) return;
    return { subject: first.args[0], clauses, otherwise: cursor, end: commonEnd };
  }
  function recoverMacro(start: number, end: number): { text: string; next: number } | undefined {
    for (const [macroName, macro] of Object.entries(BW2_SCRIPT_MACROS)) {
      let cursor = start, matches = true;
      const values = new Map<string, number>();
      for (const template of macro.sequence) {
        const command = instructions.get(cursor);
        if (!command || command.next > end || command.opcode !== template.opcode || command.args.length !== template.args.length || (cursor !== start && targets.has(cursor))) { matches = false; break; }
        for (const [index, operand] of template.args.entries()) {
          const value = command.args[index];
          if (typeof operand === "number") { if (value !== operand) matches = false; }
          else { if (values.has(operand) && values.get(operand) !== value) matches = false; values.set(operand, value); }
        }
        if (!matches) break;
        cursor = command.next;
      }
      if (matches) return { next: cursor, text: macroName + (macro.parameters.length ? " " : "") + macro.parameters.map((parameter) => {
        const value = values.get(parameter.name)!;
        const alias = Object.entries(parameter.aliases ?? {}).find(([, id]) => id === value)?.[0];
        return `${parameter.name}: ${!parameter.literalOnly && value >= 0x4000 ? work(value) : alias ? `:${alias}` : value}`;
      }).join(", ") };
    }
  }
  let readableMacros = options.recoverMacros !== false;
  function renderRange(start: number, end: number, indent: string, structured: boolean, depth = 0): string[] {
    const lines: string[] = [];
    let p = start;
    while (p < end) {
      const i = instructions.get(p)!;
      if (targets.has(p) && p !== start) lines.push(`${indent}label :${name(p)}`);
      const macro = readableMacros ? recoverMacro(p, end) : undefined;
      if (macro) { lines.push(`${indent}${macro.text}`); p = macro.next; continue; }
      const stackTest = structured ? stackTests.get(p) : undefined;
      const branch = stackTest?.branch ?? instructions.get(i.next);
      if (structured && depth < 80 && branch) {
        const match = recoverCase(p, end);
        if (match) {
          lines.push(`${indent}case ${work(match.subject)}`);
          for (const clause of match.clauses) {
            lines.push(`${indent}when ${clause.values.map((value) => hex(value)).join(", ")}`, `${indent}  label :${name(clause.start)}`);
            lines.push(...renderRange(clause.start, clause.end, `${indent}  `, true, depth + 1));
          }
          if (match.otherwise < match.end) {
            lines.push(`${indent}else`, `${indent}  label :${name(match.otherwise)}`);
            lines.push(...renderRange(match.otherwise, match.end, `${indent}  `, true, depth + 1));
          }
          lines.push(`${indent}end`); structuredBlocks++; p = match.end; continue;
        }
        const test = stackTest?.expression.text ?? condition(i, branch, true);
        const falseOffset = branch.targets.get(1);
        if (test && falseOffset !== undefined && falseOffset >= branch.next && falseOffset <= end) {
          const tail = instructions.get(falseOffset - 6);
          const tailTarget = tail?.opcode === 0x1e ? tail.targets.get(0) : undefined;
          // Labels at structural boundaries let inner explicit jumps keep their targets.
          if (tailTarget === p && tail!.offset >= branch.next && safeRegion(p, falseOffset, [branch.next])) {
            lines.push(`${indent}while ${test}`);
            if (targets.has(branch.next)) lines.push(`${indent}  label :${name(branch.next)}`);
            lines.push(...renderRange(branch.next, tail!.offset, `${indent}  `, true, depth + 1), `${indent}end`);
            structuredBlocks++; p = falseOffset; continue;
          }
          if (tailTarget !== undefined && tailTarget >= falseOffset && tailTarget <= end && tail!.offset >= branch.next && safeRegion(p, tailTarget, [branch.next, falseOffset])) {
            lines.push(`${indent}if ${test}`);
            if (targets.has(branch.next)) lines.push(`${indent}  label :${name(branch.next)}`);
            lines.push(...renderRange(branch.next, tail!.offset, `${indent}  `, true, depth + 1), `${indent}else`);
            if (targets.has(falseOffset)) lines.push(`${indent}  label :${name(falseOffset)}`);
            lines.push(...renderRange(falseOffset, tailTarget, `${indent}  `, true, depth + 1), `${indent}end`);
            structuredBlocks++; p = tailTarget; continue;
          }
          // A single explicit jump uses the postfix branch syntax instead.
          if (safeRegion(p, falseOffset, [branch.next]) && !(instructions.get(branch.next)?.opcode === 0x1e && instructions.get(branch.next)?.next === falseOffset)) {
            lines.push(`${indent}if ${test}`);
            if (targets.has(branch.next)) lines.push(`${indent}  label :${name(branch.next)}`);
            lines.push(...renderRange(branch.next, falseOffset, `${indent}  `, true, depth + 1), `${indent}end`);
            structuredBlocks++; p = falseOffset; continue;
          }
        }
        const directTest = stackTest ? (stackTest.expression.inverse ?? stackTest.expression.text) : condition(i, branch, false);
        if (directTest && falseOffset !== undefined) {
          const modifier = stackTest && !stackTest.expression.inverse ? "unless" : "if";
          lines.push(`${indent}jump :${name(falseOffset)} ${modifier} ${directTest}`); p = branch.next; continue;
        }
      }
      if ([0x26, 0x27, 0x28, 0x29].includes(i.opcode) && works.has(i.args[0]) && (i.opcode !== 0x29 || works.has(i.args[1]))) {
        const rhs = i.opcode === 0x29 || ([0x26, 0x27].includes(i.opcode) && i.args[1] >= 0x4000) ? work(i.args[1]) : hex(i.args[1]);
        lines.push(`${indent}${work(i.args[0])} ${i.opcode === 0x26 ? "+=" : i.opcode === 0x27 ? "-=" : "="} ${rhs}`);
      } else if (i.opcode === 4 || i.opcode === 0x1e) lines.push(`${indent}${i.opcode === 4 ? "call" : "jump"} :${name(i.targets.get(0)!)}`);
      else {
        const command = bw2CommandByOpcode(i.opcode, i.dispatchId)!;
        lines.push(`${indent}${command.name}${i.args.length ? " " : ""}${i.args.map((arg, index) => i.targets.has(index) ? `:${name(i.targets.get(index)!)}` : (command.definition.workOperands ?? BW2_WORK_OPERANDS[i.opcode])?.includes(index) && works.has(arg) ? work(arg) : hex(arg, command.definition.widths[index] * 2)).join(", ")}`);
      }
      p = i.next;
    }
    return lines;
  }
  function source(structured: boolean, readableMovements = true, useMacros = options.recoverMacros !== false): string {
    readableMacros = useMacros;
    structuredBlocks = 0;
    const lines = ["# Imported BW2 script. Exact layout and explicit terminators are preserved.", "preserve_layout", ""];
    if (readableMovements && movements.size && [...movements.keys()].every((offset) => offset % 2 === 0)) lines.push("movement_alignment 2", "");
    if (stackEncoding) lines.push("condition_encoding :stack", "");
    if (overlayId !== undefined) lines.push(`overlay ${overlayId}`, "");
    for (const id of [...works].sort((a, b) => a - b)) {
      const alias = bw2WorkAlias(id);
      lines.push(`# ${alias.description}`, `work :${work(id)}, ${hex(id)}`);
    }
    if (works.size) lines.push("");
    // Entry declarations are separate from code: slots may share or enter a block.
    entries.forEach((offset, index) => {
      if (!instructions.has(offset) || entries.indexOf(offset) !== index) lines.push(`entry ${index + 1}, :${name(offset)}`);
    });
    lines.push("");
    const movementLines: string[] = [];
    let p = tableEnd;
    while (p < bytes.length) {
      const i = instructions.get(p);
      if (i) {
        let end = i.next;
        while (instructions.has(end) && !roots.has(end)) end = instructions.get(end)!.next;
        const helper = calls.has(p) && !entries.includes(p);
        const entry = entries.indexOf(p);
        lines.push(entry >= 0 ? `script :${name(p)}, entry: ${entry + 1} do` : helper ? `def ${name(p)}` : `block :${name(p)} do`, ...renderRange(p, end, "  ", structured), "end", "");
        p = end;
      } else if (readableMovements && movements.has(p)) {
        const movement = movements.get(p)!;
        let next = movement.end;
        while (movements.has(next)) next = movements.get(next)!.end;
        const anchor = next < bytes.length ? instructions.has(next) ? name(next) : names.get(next) ?? `bytes_${next.toString(16)}` : undefined;
        // Definitions can live at the end of the source while their records
        // retain their physical position before the next code/data block.
        movementLines.push(`movement :${name(p)}${anchor ? `, before: :${anchor}` : ""} do`);
        for (const step of movement.steps) {
          if (step.offset !== p && targets.has(step.offset)) movementLines.push(`  label :${name(step.offset)}`);
          if (step.opcode === 0xfe) {
            if (step.parameter) movementLines.push(`  finish ${step.parameter}`);
          } else {
            const command = bw2MovementByOpcode(step.opcode);
            movementLines.push(command ? `  ${command.name} ${step.parameter}` : `  raw_step ${hex(step.opcode)}, ${step.parameter} # Unverified movement; import remains read-only.`);
          }
        }
        movementLines.push("end", ""); p = movement.end;
      } else {
        const start = p;
        p++;
        while (p < bytes.length && !instructions.has(p) && !targets.has(p) && !(readableMovements && movements.has(p)) && p - start < 96) p++;
        lines.push(`data :${names.get(start) ?? `bytes_${start.toString(16)}`}, ${Array.from(bytes.subarray(start, p), (byte) => hex(byte, 2)).join(", ")}`);
      }
    }
    lines.push(...movementLines);
    return `${lines.join("\n")}\n`;
  }
  let rendered = source(true);
  // Structured flow can fail its layout check independently of a valid macro.
  // Try raw branches with macros before falling back to expanded commands.
  try { if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) rendered = source(false, true); }
  catch { rendered = source(false, true); }
  try { if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) rendered = source(false, true, false); }
  catch { rendered = source(false, true, false); }
  try { if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) rendered = source(false, false, false); }
  catch { rendered = source(false, false, false); }
  if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) fail("Decompile/compile round trip changed bytes", 0);
  return { source: rendered, roundTripVerified: true, editable: warnings.size === 0, warnings: [...warnings], stats: { entries: entries.length, instructions: instructions.size, structuredBlocks, helpers: [...calls].filter((offset) => !entries.includes(offset) && instructions.has(offset)).length, movements: (rendered.match(/^movement :/gm) ?? []).length } };
}
