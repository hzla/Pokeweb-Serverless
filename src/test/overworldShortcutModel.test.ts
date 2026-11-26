import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { groundItemScriptFileId } from "../pokeweb/docGeneratorModel";
import { getNarcFormats } from "../pokeweb/formats";
import { appendGroundItemEntry, checkItemFlag, parseGroundItemFile, replaceItemBallReward, replaceTrainerNpc, suggestItemFlag, trainerIdForScript } from "../pokeweb/overworldShortcutModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";

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

function store(name: NarcStore["name"], rawFiles: Uint8Array[]): NarcStore {
  return { name, rawFiles, fileCount: rawFiles.length, fileId: 0, sourcePath: "test", container: "narc", records: new Map(), dirty: new Set() };
}

function overworldProject(baseRom: "BW" | "BW2", npcs: { script: number; sprite: number; flag: number }[]): ProjectState {
  const state = project(baseRom);
  state.formats = getNarcFormats(baseRom);
  state.texts = { banks: {} };
  const bytes = new Uint8Array(8 + 36 * npcs.length);
  writeU32(bytes, 0, bytes.length - 4);
  bytes[5] = npcs.length;
  npcs.forEach(({ script, sprite, flag }, index) => {
    const offset = 8 + index * 36;
    writeU16(bytes, offset, index);
    writeU16(bytes, offset + 2, sprite);
    writeU16(bytes, offset + 8, flag);
    writeU16(bytes, offset + 10, script);
    writeU16(bytes, offset + 12, 2);
    writeU16(bytes, offset + 28, index + 4);
  });
  state.narcs.overworlds = store("overworlds", [bytes]);
  state.narcs.scripts = store("scripts", []);
  state.narcs.trdata = store("trdata", []);
  return state;
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

  it.each(["BW", "BW2"] as const)("changes just the selected %s ball even when it shares a script", (baseRom) => {
    const state = overworldProject(baseRom, [{ script: 7000, sprite: 210, flag: 1100 }, { script: 7000, sprite: 110, flag: 1101 }]);
    const scripts = state.narcs.scripts!;
    const fileId = groundItemScriptFileId(state);
    scripts.rawFiles[fileId] = itemFile();
    const overworld = state.narcs.overworlds!;
    const original = overworld.rawFiles[0].slice();

    expect(replaceItemBallReward(state, 0, 0, 380, 1)).toBe(false);
    expect(overworld.dirty.size).toBe(0);
    expect(replaceItemBallReward(state, 0, 0, 84, 3)).toBe(true);
    expect(scripts.dirty.size).toBe(0);
    expect(decodeRecord(state, "overworlds", 0).raw?.npc_0_script_id).toBe(7001);
    expect(replaceItemBallReward(state, 0, 0, 25, 2)).toBe(true);

    materializeProjectEdits(state);
    writeU16(original, 18, 7003);
    expect(overworld.rawFiles[0]).toEqual(original);
    expect(scripts.dirty.has(fileId)).toBe(true);
    expect(parseGroundItemFile(scripts.rawFiles[fileId])).toEqual([
      { scriptId: 7000, itemId: 380, quantity: 1 },
      { scriptId: 7001, itemId: 84, quantity: 3 },
      { scriptId: 7003, itemId: 25, quantity: 2 },
    ]);
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

  function trainerProject(): ProjectState {
    const state = overworldProject("BW2", [
      { script: 3001, sprite: 25, flag: 50 },
      { script: 5001, sprite: 26, flag: 51 },
      { script: 3002, sprite: 42, flag: 52 },
    ]);
    const entries = 18;
    const code = entries * 4 + 2;
    const scripts = new Uint8Array(code + 10);
    for (let id = 0; id < entries; id += 1) writeU32(scripts, id * 4, code + (id >= 16 ? 2 : 0) - id * 4 - 4);
    writeU16(scripts, entries * 4, 0xfd13);
    state.narcs.scripts!.rawFiles[1239] = scripts;
    const trainers = store("trdata", Array.from({ length: 19 }, () => new Uint8Array(20)));
    for (const [id, trainerClass, battleType] of [[1, 1, 1], [2, 8, 0], [3, 250, 0], [18, 8, 1]]) {
      trainers.records.set(id, { id, bytes: trainers.rawFiles[id], raw: { class: trainerClass, battle_type_1: battleType } });
    }
    state.narcs.trdata = trainers;
    return state;
  }

  it("redirects both halves of a doubles pair and expands the table for a new trainer", () => {
    const state = trainerProject();
    const original = state.narcs.overworlds!.rawFiles[0].slice();
    expect(() => replaceTrainerNpc(state, 0, 1, 2)).toThrow(/Choose a Doubles trainer/);
    expect(state.narcs.overworlds!.dirty.size).toBe(0);
    expect(state.narcs.scripts!.dirty.size).toBe(0);

    expect(replaceTrainerNpc(state, 0, 1, 18)).toBe(true);
    expect(state.narcs.scripts!.dirty.has(1239)).toBe(true);
    materializeProjectEdits(state);
    writeU16(original, 10, 42);
    writeU16(original, 18, 3018);
    writeU16(original, 46, 42);
    writeU16(original, 54, 5018);
    expect(state.narcs.overworlds!.rawFiles[0]).toEqual(original);
  });

  it("retains the current sprite when there is no mapping for the new trainer class", () => {
    const state = trainerProject();
    expect(replaceTrainerNpc(state, 0, 2, 3)).toBe(true);
    expect(decodeRecord(state, "overworlds", 0).raw).toMatchObject({
      npc_2_script_id: 3003,
      npc_2_overworld_sprite: 42,
    });
    expect(state.narcs.scripts!.dirty.size).toBe(0);
  });
});
