import { readU16 } from "../../nds/binary";
import { bw2MovementByOpcode } from "./movementCommands";

export type RecoveredMovement = { start: number; end: number; steps: { offset: number; opcode: number; parameter: number }[] };

/** Recover bounded pools; callers trust only complete, documented records. */
export function recoverBw2Movements(bytes: Uint8Array, starts: ReadonlySet<number>, targets: ReadonlySet<number>, owner: Int32Array, codeEnd: number, readOnly: boolean): Map<number, RecoveredMovement> {
  const read = (start: number, pool = false): RecoveredMovement | undefined => {
    const steps: RecoveredMovement["steps"] = [];
    for (let offset = start; offset + 4 <= bytes.length; offset += 4) {
      const opcode = readU16(bytes, offset), parameter = readU16(bytes, offset + 2);
      for (let p = offset; p < offset + 4; p++) {
        if (owner[p] > 0 || owner[p] === -2 || (!pool && owner[p] !== -1)) return;
        if (targets.has(p) && (!starts.has(p) || (p - start) % 4)) return;
      }
      if (opcode !== 0xfe && !bw2MovementByOpcode(opcode) && !(pool && readOnly)) return;
      steps.push({ offset, opcode, parameter });
      if (opcode === 0xfe) return { start, end: offset + 4, steps };
    }
  };
  const candidates = [...starts].sort((a, b) => a - b).map((start) => read(start)).filter((block): block is RecoveredMovement => Boolean(block));
  // Pools can include unreferenced lists before the next decoded code block,
  // or at EOF. Require complete records and at most three zero padding bytes.
  // Numeric unknown records remain a read-only view of their original words.
  let coveredEnd = -1;
  for (const poolStart of [...starts].sort((a, b) => a - b)) {
    if (poolStart < coveredEnd) continue;
    const pool: RecoveredMovement[] = [];
    let p = poolStart;
    while (p + 4 <= bytes.length) {
      const block = read(p, true);
      if (!block) break;
      pool.push(block); p = block.end;
    }
    let boundary = p;
    while (boundary < bytes.length && !owner[boundary] && !targets.has(boundary) && bytes[boundary] === 0 && boundary - p < 3) boundary++;
    const bounded = boundary === bytes.length || owner[boundary] > 0 || owner[boundary] === -2;
    // CodeEnd also prevents treating an unexplained data boundary beyond code
    // as an interleaved pool; terminal pools must actually reach EOF.
    if (pool.length && bounded && (boundary < codeEnd || boundary === bytes.length || owner[boundary] === -2)) {
      coveredEnd = p;
      for (let index = candidates.length - 1; index >= 0; index--) if (candidates[index].start >= poolStart && candidates[index].start < p) candidates.splice(index, 1);
      candidates.push(...pool);
    }
  }
  const regions = new Map<number, RecoveredMovement>();
  let previous: RecoveredMovement | undefined;
  for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
    if (previous && candidate.start < previous.end) {
      // Multiple pointers may enter the same list's suffix. The renderer keeps
      // those targets as labels instead of emitting the suffix twice.
      if (candidate.end === previous.end && (candidate.start - previous.start) % 4 === 0) continue;
      regions.delete(previous.start); previous = undefined; continue;
    }
    regions.set(candidate.start, candidate); previous = candidate;
  }
  return regions;
}

/** Unreferenced lists emitted with a movement pool have no code pointer of their
 * own. Recover only a whole bounded region, documented records, FE terminators,
 * and at most three leading/trailing zero alignment bytes. */
export function recoverOrphanBw2MovementPools(bytes: Uint8Array, starts: ReadonlySet<number>, targets: ReadonlySet<number>, owner: Int32Array): RecoveredMovement[] {
  const result: RecoveredMovement[] = [];
  for (let start = 0; start < bytes.length; start++) {
    if (owner[start]) continue;
    let end = start;
    while (end < bytes.length && owner[end] <= 0 && owner[end] !== -2) end++;
    for (let padding = 0; padding <= 3 && start + padding < end; padding++) {
      const first = start + padding;
      if (first % 2 || !bytes.subarray(start, first).every((byte) => byte === 0)) continue;
      const blocks: RecoveredMovement[] = []; let p = first, valid = true;
      while (p + 4 <= end) {
        const begin = p, steps: RecoveredMovement["steps"] = []; let terminated = false;
        while (p + 4 <= end) {
          if ([0, 1, 2, 3].some((n) => targets.has(p + n) && (!starts.has(p + n) || n !== 0))) { valid = false; break; }
          const opcode = readU16(bytes, p), parameter = readU16(bytes, p + 2);
          if (opcode !== 0xfe && !bw2MovementByOpcode(opcode)) { valid = false; break; }
          steps.push({ offset: p, opcode, parameter }); p += 4;
          if (opcode === 0xfe) { terminated = true; break; }
        }
        if (!terminated) { valid = false; break; }
        blocks.push({ start: begin, end: p, steps });
        if (end - p <= 3 && bytes.subarray(p, end).every((byte) => byte === 0)) break;
      }
      if (valid && blocks.length && end - p <= 3 && bytes.subarray(p, end).every((byte) => byte === 0)) { result.push(...blocks); break; }
    }
    start = end - 1;
  }
  return result;
}
