import { readU16, readU32 } from "../../nds/binary";
import { gen5ScriptCommandSize, gen5ScriptEntries } from "../gen5ScriptCommands";
import { bw2CommandByOpcode } from "./commands";
import { compileBw2Script } from "./compiler";
import { BW2_OVERLAY_LAYOUTS } from "./commandLayouts";

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
  stats: { entries: number; instructions: number; structuredBlocks: number; helpers: number };
};
type Instruction = { offset: number; next: number; opcode: number; args: number[]; targets: Map<number, number> };
const OPS = ["<", "==", ">", "<=", ">=", "!="];
const INVERSE = [">=", "!=", "<=", ">", "<", "=="];
const hex = (n: number, width = 4): string => `0x${n.toString(16).padStart(width, "0")}`;
export const bw2ScriptBytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Decode reachable code only. Unrecognized bytes remain explicit, read-only data. */
export function decompileBw2Script(bytes: Uint8Array, options: { overlayId?: number } = {}): DecompiledBw2Script {
  const overlayId = options.overlayId;
  if (overlayId !== undefined && !Object.hasOwn(BW2_OVERLAY_LAYOUTS, overlayId)) throw new Bw2ScriptDecompileError("Unsupported BW2 command overlay", 0);
  if (bytes.length > 4_000_000) throw new Bw2ScriptDecompileError("Script exceeds the four-million-byte limit", 0);
  const entries = gen5ScriptEntries(bytes);
  if (!entries.length) throw new Bw2ScriptDecompileError("Unrecognized entry table", 0);
  const tableEnd = entries.length * 4 + 2;
  const fail = (message: string, offset: number): never => { throw new Bw2ScriptDecompileError(message, offset); };
  const instructions = new Map<number, Instruction>();
  const owner = new Int32Array(bytes.length);
  const data = new Set<number>();
  const calls = new Set<number>();
  const targets = new Set(entries);
  const edges: { from: number; to: number }[] = entries.map((to) => ({ from: -1, to }));
  const warnings = new Set<string>();
  const pending = [...new Set(entries)];
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
      if (movement && !(id <= 0x5b || (id >= 0x9f && id <= 0xa1))) {
        warnings.add(`Unknown movement ${hex(id)} at ${hex(p)}; edits are disabled.`); return;
      }
      claim(p, p + size, movement ? -1 : -2); p += size;
    }
    if (!terminated) warnings.add(`Unterminated ${movement ? "movement" : "elevator"} data at ${hex(start)}; edits are disabled.`);
  };
  while (pending.length) {
    let offset = pending.pop()!;
    while (!instructions.has(offset)) {
      checkTarget(offset, offset);
      if (owner[offset]) fail("Control flow targets an operand or data byte", offset);
      const opcode = readU16(bytes, offset);
      const layout = bw2CommandByOpcode(opcode, overlayId)?.definition;
      const size = gen5ScriptCommandSize(opcode, "BW2", overlayId);
      if (!layout || !size || 2 + layout.widths.reduce((sum, width) => sum + width, 0) !== size || offset + size > bytes.length) {
        warnings.add(`Unknown or truncated command ${hex(opcode)} at ${hex(offset)}; edits are disabled.`);
        break;
      }
      const instruction: Instruction = { offset, next: offset + size, opcode, args: [], targets: new Map() };
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
            pending.push(target); edges.push({ from: offset, to: target });
            if (kind === "call") calls.add(target);
          }
        }
        p += width;
      }
      instructions.set(offset, instruction);
      if (opcode === 2 || opcode === 5 || opcode === 0x1d || opcode === 0x1e) break;
      if (instruction.next === bytes.length) { warnings.add(`Code falls off the file at ${hex(offset)}; edits are disabled.`); break; }
      offset = instruction.next;
    }
  }
  // A later decoded instruction must not hide an earlier unknown entry/branch target.
  for (const target of targets) {
    if (!data.has(target) && owner[target] && !instructions.has(target)) fail("Control flow targets an operand or data byte", target);
  }
  for (let p = tableEnd; p < bytes.length; p++) {
    if (!owner[p] && bytes[p] !== 0) { warnings.add("Unrecognized nonzero payload bytes are preserved; edits are disabled."); break; }
  }
  const names = new Map<number, string>();
  entries.forEach((offset, index) => { if (!names.has(offset)) names.set(offset, `script_${index + 1}`); });
  for (const offset of calls) if (!names.has(offset)) names.set(offset, `helper_${offset.toString(16)}`);
  for (const offset of targets) if (!names.has(offset)) names.set(offset, `${data.has(offset) ? "data" : "loc"}_${offset.toString(16)}`);
  const name = (offset: number): string => names.get(offset) ?? `loc_${offset.toString(16)}`;
  const roots = new Set([...entries, ...calls]);
  const works = new Set<number>();
  for (const i of instructions.values()) {
    if ([0x19, 0x1a, 0x26, 0x27, 0x28, 0x29].includes(i.opcode) && i.args[0] >= 0x4000) {
      works.add(i.args[0]);
      if ([0x1a, 0x29].includes(i.opcode) || ([0x26, 0x27].includes(i.opcode) && i.args[1] >= 0x4000)) {
        if (i.args[1] >= 0x4000) works.add(i.args[1]);
      }
    }
  }
  const work = (id: number): string => `work_${id.toString(16)}`;
  const condition = (i: Instruction, branch: Instruction, invert: boolean): string | undefined => {
    if (i.opcode !== 0x19 && i.opcode !== 0x1a) return;
    if (branch.opcode !== 0x1f || branch.args[0] > 5 || i.args[0] < 0x4000 || (i.opcode === 0x1a && i.args[1] < 0x4000)) return;
    if (targets.has(branch.offset)) return;
    return `${work(i.args[0])} ${(invert ? INVERSE : OPS)[branch.args[0]]} ${i.opcode === 0x1a ? work(i.args[1]) : hex(i.args[1])}`;
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
  function renderRange(start: number, end: number, indent: string, structured: boolean, depth = 0): string[] {
    const lines: string[] = [];
    let p = start;
    while (p < end) {
      const i = instructions.get(p)!;
      if (targets.has(p) && p !== start) lines.push(`${indent}label :${name(p)}`);
      const branch = instructions.get(i.next);
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
        const test = condition(i, branch, true);
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
        const directTest = condition(i, branch, false);
        if (directTest && falseOffset !== undefined) {
          lines.push(`${indent}jump :${name(falseOffset)} if ${directTest}`); p = branch.next; continue;
        }
      }
      if ([0x26, 0x27, 0x28, 0x29].includes(i.opcode) && works.has(i.args[0]) && (i.opcode !== 0x29 || works.has(i.args[1]))) {
        const rhs = i.opcode === 0x29 || ([0x26, 0x27].includes(i.opcode) && i.args[1] >= 0x4000) ? work(i.args[1]) : hex(i.args[1]);
        lines.push(`${indent}${work(i.args[0])} ${i.opcode === 0x26 ? "+=" : i.opcode === 0x27 ? "-=" : "="} ${rhs}`);
      } else if (i.opcode === 4 || i.opcode === 0x1e) lines.push(`${indent}${i.opcode === 4 ? "call" : "jump"} :${name(i.targets.get(0)!)}`);
      else {
        const command = bw2CommandByOpcode(i.opcode, overlayId)!;
        lines.push(`${indent}${command.name}${i.args.length ? " " : ""}${i.args.map((arg, index) => i.targets.has(index) ? `:${name(i.targets.get(index)!)}` : hex(arg, command.definition.widths[index] * 2)).join(", ")}`);
      }
      p = i.next;
    }
    return lines;
  }
  function source(structured: boolean): string {
    structuredBlocks = 0;
    const lines = ["# Imported BW2 script. Exact layout and explicit terminators are preserved.", "preserve_layout", ""];
    if (overlayId !== undefined) lines.push(`overlay ${overlayId}`, "");
    for (const id of [...works].sort((a, b) => a - b)) lines.push(`work :${work(id)}, ${hex(id)}`);
    if (works.size) lines.push("");
    // Entry declarations are separate from code: slots may share or enter a block.
    entries.forEach((offset, index) => {
      if (!instructions.has(offset) || entries.indexOf(offset) !== index) lines.push(`entry ${index + 1}, :${name(offset)}`);
    });
    lines.push("");
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
      } else {
        const start = p;
        p++;
        while (p < bytes.length && !instructions.has(p) && !targets.has(p) && p - start < 96) p++;
        lines.push(`data :${names.get(start) ?? `bytes_${start.toString(16)}`}, ${Array.from(bytes.subarray(start, p), (byte) => hex(byte, 2)).join(", ")}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
  let rendered = source(true);
  try { if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) rendered = source(false); }
  catch { rendered = source(false); }
  if (!bw2ScriptBytesEqual(compileBw2Script(rendered).bytes, bytes)) fail("Decompile/compile round trip changed bytes", 0);
  return { source: rendered, roundTripVerified: true, editable: warnings.size === 0, warnings: [...warnings], stats: { entries: entries.length, instructions: instructions.size, structuredBlocks, helpers: [...calls].filter((offset) => !entries.includes(offset) && instructions.has(offset)).length } };
}
