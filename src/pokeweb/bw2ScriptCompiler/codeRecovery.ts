import { readU16, readU32 } from "../../nds/binary";
import { bw2MovementByOpcode } from "./movementCommands";
import { bw2CommandByOpcode } from "./commands";

/** Recognize detached compiler output, never arbitrary partial instruction runs.
 * A candidate must end with a VM terminator or a branch to verified code. Its
 * internal targets must land on instruction boundaries. Movement-shaped words
 * alone are insufficient evidence of a code block. */
export function recoverBw2DetachedCode(bytes: Uint8Array, start: number, end: number, owner: Int32Array, verifiedCode: ReadonlySet<number>, overlayId?: number, protectedTargets: ReadonlySet<number> = new Set()): { offset: number; endOffset: number } | undefined {
  if ((end - start) % 2 === 0 && Array.from({ length: (end - start) / 2 }, (_, n) => readU16(bytes, start + n * 2)).every((op) => [2, 5, 0x1d].includes(op)) &&
      ![...protectedTargets].some((target) => target >= start && target < end && (target - start) % 2)) return { offset: start, endOffset: end };
  for (let pad = 0; pad <= 3 && start + pad < end; pad++) {
    const offset = start + pad;
    if (!bytes.subarray(start, offset).every((byte) => byte === 0)) continue;
    const boundaries = new Set<number>(), targets: number[] = [];
    let p = offset, evidence = false, terminated = false;
    while (p + 2 <= end) {
      const opcode = readU16(bytes, p), layout = bw2CommandByOpcode(opcode, overlayId)?.definition;
      if (!layout) break;
      const size = 2 + layout.widths.reduce((sum, width) => sum + width, 0);
      if (p + size > end || owner.subarray(p, p + size).some((tag) => tag !== 0)) break;
      boundaries.add(p); evidence ||= opcode > 0xc0;
      let argument = p + 2;
      for (const [index, width] of layout.widths.entries()) {
        const value = width === 1 ? bytes[argument] : width === 2 ? readU16(bytes, argument) : readU32(bytes, argument);
        if (width === 2 && value >= 0x4000 && value <= 0x80ff) evidence = true;
        const kind = layout.relative?.[index];
        if (kind === "jump" || kind === "call") { targets.push(argument + 4 + (value | 0)); evidence = true; }
        argument += width;
      }
      p += size;
      if ([2, 5, 0x1d].includes(opcode)) { terminated = true; break; }
      if (opcode === 0x1e && verifiedCode.has(targets.at(-1)!)) { terminated = true; break; }
    }
    if (!terminated && p === end && verifiedCode.has(end) && evidence) terminated = true;
    // A stray terminator can precede an otherwise complete, unused movement pool.
    let movementTail = false;
    if (terminated && !evidence && [2, 5, 0x1d].includes(readU16(bytes, offset))) {
      for (let align = 0; align <= 3 && p + align < end; align++) {
        if ((p + align) % 2 || !bytes.subarray(p, p + align).every((byte) => byte === 0)) continue;
        let q = p + align, lists = 0, valid = true;
        while (q + 4 <= end) {
          const op = readU16(bytes, q); if (op !== 0xfe && !bw2MovementByOpcode(op)) { valid = false; break; }
          q += 4; if (op === 0xfe) lists++;
        }
        if (valid && lists && readU16(bytes, q - 4) === 0xfe && end - q <= 3 && bytes.subarray(q, end).every((byte) => byte === 0)) { movementTail = true; break; }
      }
    }
    if (!terminated || (!evidence && !movementTail && !(end - p <= 3 && bytes.subarray(p, end).every((byte) => byte === 0)))) continue;
    // An unresolved live entry/jump is stronger evidence than a guessed block.
    // Do not turn its bytes into an operand and abort an otherwise lossless import.
    if ([...protectedTargets].some((target) => target >= start && target < p && !boundaries.has(target))) continue;
    if (targets.some((target) => target >= offset && target < p ? !boundaries.has(target) : owner[target] ? !verifiedCode.has(target) : target < 0 || target + 2 > bytes.length || !bw2CommandByOpcode(readU16(bytes, target), overlayId))) continue;
    return { offset, endOffset: p };
  }
}
