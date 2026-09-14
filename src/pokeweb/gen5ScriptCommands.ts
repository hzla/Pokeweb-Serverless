import { readU16, readU32 } from "../nds/binary";
import type { BaseRom } from "./constants";
import { BW2_OVERLAY_COMMAND_BYTES } from "./gen5ScriptOverlayCommands";

export type ScriptWalkOptions = { overlayId?: number; entryIndices?: readonly number[] };
export type ResolvedScriptOperand = { offset: number; command: number; operandOffset: number; values: number[] };

export function gen5ScriptCommandSize(command: number, baseRom: BaseRom, overlayId?: number): number {
  if (baseRom === "BW2" && command >= 1000) return BW2_OVERLAY_COMMAND_BYTES[overlayId ?? -1]?.[command - 1000] ?? 0;
  return (baseRom === "BW" ? BW_COMMAND_BYTES : baseRom === "BW2" ? BW2_COMMAND_BYTES : [])[command] ?? 0;
}

export function gen5ScriptEntries(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  let tableEnd = 0;
  while (tableEnd + 2 <= bytes.length && readU16(bytes, tableEnd) !== 0xfd13) {
    if (tableEnd + 4 > bytes.length) return [];
    starts.push(tableEnd + 4 + (readU32(bytes, tableEnd) | 0));
    tableEnd += 4;
  }
  if (tableEnd + 2 > bytes.length) return [];
  tableEnd += 2;
  if (starts.some((start) => start < tableEnd || start + 2 > bytes.length)) return [];
  return starts;
}

/** Visit only commands reachable from script entries, never operand or movement bytes. */
export function gen5ScriptCommandOffsets(bytes: Uint8Array, baseRom: BaseRom, options: ScriptWalkOptions = {}): number[] {
  if (baseRom !== "BW" && baseRom !== "BW2") return [];
  const entries = gen5ScriptEntries(bytes);
  const starts = options.entryIndices ? options.entryIndices.map((i) => entries[i]).filter((i): i is number => i !== undefined) : entries;
  const tableEnd = entries.length * 4 + 2;

  const offsets: number[] = [];
  const visited = new Set<number>();
  const pending = [...new Set(starts)].reverse();
  while (pending.length) {
    let offset = pending.pop()!;
    while (offset >= tableEnd && offset + 2 <= bytes.length && !visited.has(offset)) {
      visited.add(offset);
      const command = readU16(bytes, offset);
      const size = gen5ScriptCommandSize(command, baseRom, options.overlayId);
      // Unknown/truncated instructions cannot safely be skipped by guessing a size.
      if (!size || offset + size > bytes.length) break;
      offsets.push(offset);
      if (command === 0x02 || command === 0x05 || command === 0x1d) break;
      if (command === 0x04 || command === 0x1e || command === 0x1f || command === 0x20) {
        const target = offset + size + (readU32(bytes, offset + size - 4) | 0);
        if (target >= tableEnd && target + 2 <= bytes.length) pending.push(target);
        if (command === 0x1e) break;
      }
      offset += size;
    }
  }
  return offsets;
}

/**
 * Resolve literal and work-variable operands along reachable script paths.
 * This is intentionally a small abstract interpreter: it follows local calls
 * and branches, models work assignments, and invalidates tracked values when
 * arithmetic makes the result uncertain.
 */
export function gen5ResolvedScriptOperands(
  bytes: Uint8Array,
  baseRom: BaseRom,
  commandOperands: Readonly<Record<number, readonly number[]>>,
  options: ScriptWalkOptions = {},
): ResolvedScriptOperand[] {
  if (baseRom !== "BW" && baseRom !== "BW2") return [];
  const entries = gen5ScriptEntries(bytes);
  const starts = options.entryIndices
    ? options.entryIndices.map((index) => entries[index]).filter((offset): offset is number => offset !== undefined)
    : entries;
  const tableEnd = entries.length * 4 + 2;
  const reachableOffsets = gen5ScriptCommandOffsets(bytes, baseRom, options);
  const trackedWork = new Set<number>();
  for (const offset of reachableOffsets) {
    const command = readU16(bytes, offset);
    const size = gen5ScriptCommandSize(command, baseRom, options.overlayId);
    for (const operandOffset of commandOperands[command] ?? []) {
      if (operandOffset + 2 <= size) {
        const raw = readU16(bytes, offset + operandOffset);
        if (raw >= 0x4000) trackedWork.add(raw);
      }
    }
  }
  // Include variables copied into a tracked trainer operand.
  let addedDependency = true;
  while (addedDependency) {
    addedDependency = false;
    for (const offset of reachableOffsets) {
      const command = readU16(bytes, offset);
      if (command !== 0x29 && command !== 0x2a) continue;
      if (!trackedWork.has(readU16(bytes, offset + 2))) continue;
      const source = readU16(bytes, offset + 4);
      if (source >= 0x4000 && !trackedWork.has(source)) {
        trackedWork.add(source);
        addedDependency = true;
      }
    }
  }
  type WorkState = Map<number, number>;
  type PendingPath = { offset: number; state: WorkState };
  const pending: PendingPath[] = [...new Set(starts)].map((offset) => ({ offset, state: new Map() }));
  const visited = new Set<string>();
  const resolved: ResolvedScriptOperand[] = [];

  const clone = (state: WorkState): WorkState => new Map(state);
  const valueOf = (raw: number, state: WorkState): number | undefined => raw < 0x4000 ? raw : state.get(raw);
  const stateKey = (state: WorkState): string => [...state].sort(([a], [b]) => a - b).map(([key, value]) => `${key}:${value}`).join(",");
  const branchTarget = (offset: number, size: number): number => offset + size + (readU32(bytes, offset + size - 4) | 0);

  while (pending.length) {
    let { offset, state } = pending.pop()!;
    while (offset >= tableEnd && offset + 2 <= bytes.length) {
      const key = `${offset}|${stateKey(state)}`;
      if (visited.has(key)) break;
      visited.add(key);
      const command = readU16(bytes, offset);
      const size = gen5ScriptCommandSize(command, baseRom, options.overlayId);
      if (!size || offset + size > bytes.length) break;

      for (const operandOffset of commandOperands[command] ?? []) {
        if (operandOffset + 2 > size) continue;
        const value = valueOf(readU16(bytes, offset + operandOffset), state);
        if (value !== undefined) resolved.push({ offset, command, operandOffset, values: [value] });
      }

      if (command >= 0x26 && command <= 0x2d && size >= 6) {
        const destination = readU16(bytes, offset + 2);
        const operand = readU16(bytes, offset + 4);
        const source = valueOf(operand, state);
        if (trackedWork.has(destination)) {
          if (command === 0x28) state.set(destination, operand);
          else if (command === 0x29 || command === 0x2a) {
            if (source === undefined) state.delete(destination);
            else state.set(destination, source);
          } else state.delete(destination);
        }
      }

      if (command === 0x02 || command === 0x05 || command === 0x1d) break;
      if (command === 0x04 || command === 0x1e || command === 0x1f || command === 0x20) {
        const target = branchTarget(offset, size);
        if (target >= tableEnd && target + 2 <= bytes.length) pending.push({ offset: target, state: clone(state) });
        if (command === 0x1e) break;
      }
      offset += size;
    }
  }
  return resolved;
}

// Command byte lengths (including the opcode), indexed by opcode; 0 means unknown.
// Derived from the BW1 and BW2 BeaterScript command definitions in
// reference_repos/FrostsGen5Editor/Data/NARCTypes/ScriptNARC.cs.
// Keep separate tables: command layouts diverge between BW and BW2.

const BW_COMMAND_BYTES: readonly number[] = [
  2, 2, 2, 4, 6, 2, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, // 0x000
  4, 4, 6, 6, 4, 7, 4, 4, 4, 6, 6, 4, 4, 2, 6, 7, // 0x010
  7, 4, 4, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 2, 2, // 0x020
  2, 2, 2, 4, 6, 6, 2, 4, 5, 2, 10, 4, 12, 10, 2, 2, // 0x030
  6, 2, 2, 6, 2, 8, 2, 4, 14, 14, 5, 2, 3, 5, 8, 5, // 0x040
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 6, 5, 5, // 0x050
  5, 5, 5, 5, 8, 2, 6, 8, 6, 14, 6, 4, 4, 12, 4, 6, // 0x060
  12, 8, 10, 6, 2, 4, 10, 2, 4, 8, 4, 10, 8, 10, 4, 6, // 0x070
  4, 2, 6, 4, 4, 8, 10, 8, 8, 0, 6, 4, 2, 4, 2, 0, // 0x080
  0, 0, 6, 6, 10, 4, 4, 6, 4, 0, 0, 6, 0, 0, 2, 4, // 0x090
  2, 4, 6, 4, 4, 6, 4, 2, 2, 4, 2, 6, 2, 9, 9, 8, // 0x0a0
  2, 2, 9, 10, 2, 8, 8, 8, 8, 6, 6, 6, 4, 6, 10, 10, // 0x0b0
  12, 8, 10, 2, 12, 2, 4, 2, 4, 2, 4, 6, 4, 4, 4, 4, // 0x0c0
  6, 6, 4, 4, 6, 6, 4, 4, 6, 4, 8, 2, 12, 6, 6, 8, // 0x0d0
  4, 4, 4, 2, 4, 6, 6, 4, 6, 4, 4, 4, 2, 2, 4, 4, // 0x0e0
  4, 4, 6, 6, 6, 6, 6, 4, 6, 4, 4, 6, 6, 8, 6, 6, // 0x0f0
  4, 6, 6, 6, 2, 8, 4, 8, 6, 10, 8, 8, 10, 6, 20, 8, // 0x100
  8, 8, 6, 6, 6, 8, 6, 6, 8, 8, 10, 8, 8, 4, 4, 6, // 0x110
  6, 6, 10, 20, 6, 2, 10, 10, 4, 6, 4, 8, 4, 10, 8, 4, // 0x120
  2, 2, 4, 0, 2, 4, 4, 8, 4, 4, 4, 4, 2, 2, 2, 2, // 0x130
  2, 2, 2, 24, 4, 2, 6, 4, 18, 6, 2, 2, 2, 6, 8, 6, // 0x140
  4, 6, 2, 4, 6, 6, 4, 2, 6, 2, 10, 4, 2, 2, 2, 2, // 0x150
  6, 4, 2, 5, 4, 7, 7, 5, 4, 7, 7, 10, 4, 4, 6, 2, // 0x160
  4, 2, 4, 4, 8, 4, 4, 2, 8, 2, 2, 4, 4, 4, 4, 6, // 0x170
  4, 4, 4, 2, 4, 4, 4, 4, 4, 4, 2, 2, 6, 4, 4, 18, // 0x180
  4, 4, 4, 4, 4, 4, 2, 4, 4, 4, 6, 4, 4, 4, 4, 4, // 0x190
  4, 4, 4, 4, 4, 2, 2, 6, 2, 10, 10, 4, 2, 2, 2, 2, // 0x1a0
  6, 2, 4, 6, 6, 2, 2, 2, 2, 6, 6, 2, 4, 6, 6, 8, // 0x1b0
  0, 6, 2, 4, 6, 10, 2, 4, 2, 6, 2, 6, 2, 4, 6, 8, // 0x1c0
  10, 4, 8, 8, 2, 2, 4, 10, 10, 12, 10, 4, 6, 6, 6, 8, // 0x1d0
  10, 4, 2, 4, 14, 2, 2, 2, 6, 6, 10, 10, 12, 10, 6, 6, // 0x1e0
  6, 6, 2, 4, 2, 2, 8, 14, 2, 2, 2, 6, 8, 10, 2, 4, // 0x1f0
  8, 6, 4, 4, 4, 4, 4, 6, 4, 10, 10, 4, 10, 10, 14, 8, // 0x200
  4, 4, 8, 4, 10, 6, 6, 4, 6, 6, 6, 2, 6, 4, 4, 2, // 0x210
  10, 14, 10, 4, 4, 8, 4, 10, 6, 6, 4, 6, 0, 4, 4, 6, // 0x220
  6, 4, 6, 6, 6, 6, 10, 6, 4, 4, 6, 6, 2, 6, 6, 2, // 0x230
  4, 4, 6, 6, 4, 6, 4, 12, 6, 10, 4, 4, 4, 2, 6, 14, // 0x240
  12, 8, 2, 6, 4, 14, 8, 2, 2, 4, 4, 2, 14, 4, 2, 2, // 0x250
  2, // 0x260
];

const BW2_COMMAND_BYTES: readonly number[] = [
  2, 2, 2, 4, 6, 2, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, // 0x000
  4, 4, 6, 6, 4, 7, 4, 4, 4, 6, 6, 4, 4, 2, 6, 7, // 0x010
  7, 4, 4, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 2, 2, // 0x020
  2, 2, 2, 4, 6, 6, 2, 4, 5, 2, 10, 4, 12, 10, 2, 2, // 0x030
  6, 2, 2, 6, 2, 8, 2, 4, 14, 14, 5, 2, 3, 5, 8, 5, // 0x040
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7, 6, 5, 5, // 0x050
  5, 5, 5, 5, 8, 2, 6, 8, 6, 14, 6, 4, 4, 12, 4, 6, // 0x060
  12, 8, 10, 6, 2, 4, 10, 2, 4, 8, 4, 10, 8, 10, 4, 6, // 0x070
  4, 2, 6, 4, 4, 8, 10, 8, 8, 0, 6, 4, 2, 4, 2, 4, // 0x080
  4, 0, 6, 6, 10, 4, 4, 6, 4, 0, 0, 6, 0, 0, 2, 4, // 0x090
  2, 4, 6, 4, 4, 6, 4, 2, 2, 4, 2, 6, 2, 9, 9, 8, // 0x0a0
  2, 2, 9, 10, 2, 8, 8, 8, 8, 6, 6, 6, 4, 6, 10, 10, // 0x0b0
  12, 8, 10, 2, 12, 2, 4, 2, 4, 2, 4, 6, 4, 4, 4, 4, // 0x0c0
  6, 6, 4, 4, 6, 6, 4, 4, 6, 4, 8, 2, 12, 6, 6, 8, // 0x0d0
  4, 4, 4, 2, 4, 6, 6, 4, 6, 0, 4, 4, 2, 2, 4, 4, // 0x0e0
  4, 4, 6, 6, 6, 6, 6, 4, 6, 4, 4, 6, 6, 8, 6, 6, // 0x0f0
  4, 6, 6, 6, 2, 8, 4, 10, 6, 10, 8, 8, 10, 6, 20, 8, // 0x100
  8, 8, 6, 6, 6, 8, 6, 6, 8, 8, 10, 8, 8, 4, 4, 6, // 0x110
  6, 6, 10, 20, 6, 2, 10, 10, 4, 6, 4, 8, 4, 10, 8, 4, // 0x120
  2, 2, 4, 0, 2, 0, 6, 4, 8, 4, 4, 4, 2, 2, 2, 2, // 0x130
  2, 2, 2, 24, 4, 2, 6, 4, 18, 6, 2, 2, 2, 6, 8, 6, // 0x140
  4, 6, 2, 4, 6, 6, 4, 4, 2, 4, 2, 4, 4, 2, 2, 2, // 0x150
  6, 4, 2, 5, 4, 7, 7, 10, 4, 4, 6, 0, 0, 0, 2, 0, // 0x160
  4, 0, 4, 0, 8, 2, 2, 4, 4, 2, 4, 6, 4, 4, 0, 0, // 0x170
  0, 0, 0, 0, 0, 0, 2, 4, 0, 0, 0, 0, 6, 4, 4, 4, // 0x180
  4, 4, 0, 0, 0, 0, 0, 4, 4, 2, 4, 4, 4, 4, 0, 0, // 0x190
  0, 10, 4, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 2, 6, // 0x1a0
  6, 2, 4, 6, 6, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0x1b0
  0, 6, 2, 4, 6, 10, 2, 4, 2, 8, 2, 2, 4, 4, 6, 6, // 0x1c0
  10, 6, 8, 8, 8, 6, 6, 10, 10, 12, 10, 6, 6, 8, 6, 2, // 0x1d0
  10, 2, 2, 8, 14, 2, 2, 2, 4, 8, 6, 6, 2, 4, 4, 4, // 0x1e0
  4, 6, 4, 4, 6, 4, 10, 10, 6, 10, 10, 6, 8, 10, 2, 4, // 0x1f0
  8, 6, 6, 4, 4, 4, 4, 3, 3, 6, 2, 4, 2, 10, 14, 10, // 0x200
  4, 4, 8, 4, 10, 6, 6, 4, 6, 6, 6, 2, 6, 4, 4, 6, // 0x210
  6, 6, 4, 6, 8, 4, 4, 6, 6, 0, 6, 6, 0, 4, 4, 6, // 0x220
  6, 4, 6, 4, 10, 6, 10, 6, 4, 4, 6, 2, 2, 2, 8, 2, // 0x230
  6, 4, 0, 0, 0, 4, 4, 12, 10, 14, 4, 2, 2, 2, 6, 14, // 0x240
  12, 6, 4, 3, 0, 0, 0, 0, 0, 0, 4, 2, 8, 4, 0, 4, // 0x250
  0, 0, 6, 4, 6, 4, 4, 2, 4, 2, 0, 0, 5, 5, 5, 0, // 0x260
  0, 6, 6, 4, 2, 7, 6, 2, 8, 2, 6, 10, 6, 8, 6, 6, // 0x270
  0, 0, 0, 0, 6, 8, 0, 0, 0, 0, 6, 2, 0, 0, 4, 4, // 0x280
  3, 4, 4, 4, 6, 2, 2, 10, 5, 5, 5, 3, 0, 0, 6, 4, // 0x290
  6, 4, 2, 2, 2, 4, 2, 4, 2, 2, 0, 0, 2, 0, 4, 4, // 0x2a0
  4, 4, 6, 6, 6, 6, 6, 4, 2, 2, 4, 2, 6, 4, 12, 0, // 0x2b0
  6, 0, 4, 4, 2, 4, 2, 2, 0, 0, 4, 4, 0, 0, 0, 10, // 0x2c0
  2, 4, 2, 6, 4, 6, 0, 6, 4, 6, 4, 6, 8, 4, 4, 4, // 0x2d0
  0, 2, 0, 2, 0, 10, 2, 0, 6, 6, 14, 0, 0, 6, 6, 4, // 0x2e0
  0, 4, 6, // 0x2f0
];
