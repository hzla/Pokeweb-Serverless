import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getTmEntries, parseTms, updateTmMove } from "../pokeweb/tmModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("tmModel", () => {
  it("parses the Gen V ARM9 TM/HM table in legacy display order", () => {
    const project = makeProject();
    project.tms = parseTms(project);

    const entries = getTmEntries(project);
    expect(project.tms.raw.tm_1).toBe(1);
    expect(project.tms.raw.hm_1).toBe(2);
    expect(project.tms.raw.tm_95).toBe(3);
    expect(entries[0]).toMatchObject({ kind: "hm", number: 1, moveName: "Vine Whip", moveId: 2 });
    expect(entries[6]).toMatchObject({ kind: "tm", number: 1, moveName: "Tackle", moveId: 1 });
  });

  it("updates TM moves, syncs ARM9 bytes, and marks the TM table dirty", () => {
    const project = makeProject();
    project.tms = parseTms(project);

    const result = updateTmMove(project, "tm_1", "Flamethrower");

    expect(result.rawValue).toBe(3);
    expect(project.tms.raw.tm_1).toBe(3);
    expect(project.tms.readable.tm_1).toBe("Flamethrower");
    expect(project.tms.dirty).toBe(true);
    expect(project.arm9[0x8ccb0]).toBe(3);
    expect(project.arm9[0x8ccb1]).toBe(0);
    expect(() => updateTmMove(project, "tm_2", "Nope")).toThrow(/Unknown move/u);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const moves = packRows(formats.moves!, [
    {},
    { type: 0, category: 1, power: 40, accuracy: 100 },
    { type: 11, category: 1, power: 45, accuracy: 100 },
    { type: 9, category: 2, power: 95, accuracy: 100 },
  ]);
  const arm9 = new Uint8Array(0x8ccb0 + 204);
  writeU16(arm9, 0x8ccb0, 1);
  writeU16(arm9, 0x8ccb0 + 92 * 2, 2);
  writeU16(arm9, 0x8ccb0 + 100 * 2, 3);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { moves: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: arm9.length },
    arm9,
    overlays: {},
    narcs: {
      moves: makeStore("moves", moves, 4),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { moves: ["None", "Tackle", "Vine Whip", "Flamethrower"] } },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, data: Uint8Array, count: number): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: splitRows(data, count),
    records: new Map(),
    dirty: new Set(),
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function splitRows(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.length / count);
  return Array.from({ length: count }, (_, index) => data.slice(index * size, (index + 1) * size));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
