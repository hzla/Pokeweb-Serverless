import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { appendGroundItemEntry, checkItemFlag, parseGroundItemFile, suggestItemFlag, trainerIdForScript } from "../pokeweb/overworldShortcutModel";
import type { ProjectState } from "../pokeweb/projectStore";

/** A small global item script file: two item balls calling one pickup routine, in the retail layout. */
function itemFile(): Uint8Array {
  const entries = 3;
  const tableEnd = entries * 4;
  const codeStart = tableEnd + 2;
  const itemLength = 26;
  const routineStart = codeStart + itemLength * 2;
  const routine = [0x28, 0x8020, 0, 0x02]; // WorkSetConst 0x8020, 0; VMHalt
  const bytes = new Uint8Array(routineStart + routine.length * 2);
  const starts = [codeStart, codeStart + itemLength, routineStart];
  starts.forEach((start, index) => writeU32(bytes, index * 4, (start - index * 4 - 4) >>> 0));
  writeU16(bytes, tableEnd, 0xfd13);
  [[380, 1], [84, 3]].forEach(([item, quantity], index) => {
    const start = starts[index]!;
    [0x2e, 0x28, 0x800c, item!, 0x28, 0x800d, quantity!, 0x04].forEach((word, n) => writeU16(bytes, start + n * 2, word));
    writeU32(bytes, start + 16, (routineStart - (start + 20)) >>> 0);
    [0x30, 0x2f, 0x02].forEach((word, n) => writeU16(bytes, start + 20 + n * 2, word));
  });
  routine.forEach((word, n) => writeU16(bytes, routineStart + n * 2, word));
  return bytes;
}

function entryStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  for (let offset = 0; readU16(bytes, offset) !== 0xfd13; offset += 4) starts.push(offset + 4 + (readU32(bytes, offset) | 0));
  return starts;
}

function project(baseRom: "BW" | "BW2", trainerCount = 800): ProjectState {
  return { session: { baseRom }, narcs: { trdata: { fileCount: trainerCount } } } as unknown as ProjectState;
}

describe("item ball scripts", () => {
  it("reads the retail entries and skips the pickup routine", () => {
    expect(parseGroundItemFile(itemFile())).toEqual([
      { scriptId: 7000, itemId: 380, quantity: 1 },
      { scriptId: 7001, itemId: 84, quantity: 3 },
    ]);
  });

  it("appends an entry that calls the same routine and leaves the others intact", () => {
    const before = itemFile();
    const after = appendGroundItemEntry(before, undefined, 25, 2);
    const oldStarts = entryStarts(before);
    const newStarts = entryStarts(after);
    expect(newStarts).toHaveLength(4);
    // Every old entry still points at its own code, now 4 bytes later.
    oldStarts.forEach((start, index) => {
      expect(newStarts[index]).toBe(start + 4);
      expect(after.subarray(newStarts[index]!, newStarts[index]! + 8)).toEqual(before.subarray(start, start + 8));
    });
    expect(parseGroundItemFile(after)).toEqual([
      { scriptId: 7000, itemId: 380, quantity: 1 },
      { scriptId: 7001, itemId: 84, quantity: 3 },
      { scriptId: 7003, itemId: 25, quantity: 2 },
    ]);
    // The new entry's VMCall lands on the routine.
    const start = newStarts[3]!;
    expect(start + 20 + (readU32(after, start + 16) | 0)).toBe(newStarts[2]);
    // So do the old ones.
    expect(newStarts[0]! + 20 + (readU32(after, newStarts[0]! + 16) | 0)).toBe(newStarts[2]);
  });
});

describe("item ball flags", () => {
  it("rules out map-local, trainer, daily and hidden item flags", () => {
    const bw2 = project("BW2", 813);
    const used = new Map([[1100, "item"], [1101, "item"]]);
    expect(checkItemFlag(bw2, 50, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 1100, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 0x5f0 + 12, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 0xaa0, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 0xb04, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 0x964, used).ok).toBe(false);
    expect(checkItemFlag(bw2, 1484, used).ok).toBe(true);
    const bw = project("BW", 600);
    expect(checkItemFlag(bw, 950, new Map()).ok).toBe(false); // BW hidden items
    expect(checkItemFlag(bw, 1420 + 5, new Map()).ok).toBe(false); // BW trainer flags
  });

  it("suggests the first free flag in the item block", () => {
    const used = new Map(Array.from({ length: 384 }, (_, n) => [1100 + n, "item"] as const));
    expect(suggestItemFlag(project("BW2", 813), used)).toBe(1484);
    // Once the block before the trainer flags is full, it falls back to the free flags below it.
    for (let flag = 1484; flag < 0x5f0; flag += 1) used.set(flag, "item");
    expect(suggestItemFlag(project("BW2", 813), used)).toBe(100);
  });
});

describe("trainer scripts", () => {
  it("maps scripts to trainers", () => {
    expect(trainerIdForScript(3012)).toBe(12);
    expect(trainerIdForScript(5012)).toBe(12);
    expect(trainerIdForScript(7012)).toBeUndefined();
  });
});
