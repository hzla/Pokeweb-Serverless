import { describe, expect, it } from "vitest";
import { readU16, writeU16 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getTmEntries, parseTms, syncAllTmIcons, updateTmMove } from "../pokeweb/tmModel";
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

  it("locates the TM table from the vanilla HM anchor when the version offset points at TM23", () => {
    const tmValues = Array.from({ length: 101 }, () => 1);
    tmValues[0] = 468;
    tmValues[22] = 479;
    [15, 19, 57, 70, 127, 291].forEach((moveId, index) => {
      tmValues[92 + index] = moveId;
    });
    tmValues[100] = 555;

    const moveNames = Array.from({ length: 560 }, (_, index) => `Move ${index}`);
    moveNames[468] = "Hone Claws";
    moveNames[479] = "Smack Down";

    const project = makeProject({ tmOffset: B2_TM_TABLE_OFFSET, tmValues, moveNames });
    project.tms = parseTms(project);

    expect(readU16(project.arm9, W2_TM_TABLE_OFFSET)).toBe(479);
    expect(project.tms.offset).toBe(B2_TM_TABLE_OFFSET);
    expect(project.tms.raw.tm_1).toBe(468);
    expect(project.tms.readable.tm_1).toBe("Hone Claws");
  });

  it("updates TM moves, syncs ARM9 bytes, and marks the TM table dirty", () => {
    const project = makeProject();
    project.tms = parseTms(project);

    const result = updateTmMove(project, "tm_1", "Flamethrower");

    expect(result.rawValue).toBe(3);
    expect(project.tms.raw.tm_1).toBe(3);
    expect(project.tms.readable.tm_1).toBe("Flamethrower");
    expect(project.tms.dirty).toBe(true);
    expect(project.arm9Dirty).toBe(true);
    expect(project.arm9[W2_TM_TABLE_OFFSET]).toBe(3);
    expect(project.arm9[W2_TM_TABLE_OFFSET + 1]).toBe(0);
    expect(readU16(project.arm9, itemGraphicsEntryOffset(328) + 2)).toBe(406);
    expect(() => updateTmMove(project, "tm_2", "Nope")).toThrow(/Unknown move/u);
  });

  it("syncs all TM icon palette indexes from the current TM move types", () => {
    const project = makeProject();
    project.tms = parseTms(project);
    writeU16(project.arm9, itemGraphicsEntryOffset(328) + 2, 402);
    writeU16(project.arm9, itemGraphicsEntryOffset(420) + 2, 402);

    const changed = syncAllTmIcons(project);

    expect(changed).toBe(2);
    expect(readU16(project.arm9, itemGraphicsEntryOffset(328) + 2)).toBe(402);
    expect(readU16(project.arm9, itemGraphicsEntryOffset(420) + 2)).toBe(405);
    expect(project.arm9Dirty).toBe(true);
  });
});

const ITEM_GRAPHICS_TABLE_OFFSET = 0x100;
const B2_TM_TABLE_OFFSET = 0x8cc84;
const W2_TM_TABLE_OFFSET = 0x8ccb0;

function makeProject(options: { tmOffset?: number; tmValues?: number[]; moveNames?: string[] } = {}): ProjectState {
  const formats = getNarcFormats("BW2");
  const moves = packRows(formats.moves!, [
    {},
    { type: 0, category: 1, power: 40, accuracy: 100 },
    { type: 11, category: 1, power: 45, accuracy: 100 },
    { type: 9, category: 2, power: 95, accuracy: 100 },
  ]);
  const tmOffset = options.tmOffset ?? W2_TM_TABLE_OFFSET;
  const arm9 = new Uint8Array(Math.max(tmOffset + 204, W2_TM_TABLE_OFFSET + 204));
  writeItemGraphicsAnchor(arm9, ITEM_GRAPHICS_TABLE_OFFSET);
  for (const itemId of tmItemIds()) writeU16(arm9, itemGraphicsEntryOffset(itemId) + 2, 402);
  if (options.tmValues) {
    options.tmValues.forEach((moveId, index) => writeU16(arm9, tmOffset + index * 2, moveId));
  } else {
    writeU16(arm9, tmOffset, 1);
    writeU16(arm9, tmOffset + 92 * 2, 2);
    writeU16(arm9, tmOffset + 100 * 2, 3);
  }

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
    texts: { banks: { moves: options.moveNames ?? ["None", "Tackle", "Vine Whip", "Flamethrower"] } },
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

function itemGraphicsEntryOffset(itemId: number): number {
  return ITEM_GRAPHICS_TABLE_OFFSET + itemId * 4;
}

function writeItemGraphicsAnchor(arm9: Uint8Array, offset: number): void {
  const rows: Array<readonly [number, number]> = [
    [0, 0],
    [2, 3],
    [4, 5],
    [6, 7],
    [8, 9],
    [10, 11],
    [12, 13],
    [14, 15],
    [16, 17],
    [18, 19],
    [20, 19],
    [21, 22],
    [23, 22],
  ];
  rows.forEach(([cgx, pal], index) => {
    writeU16(arm9, offset + index * 4, cgx);
    writeU16(arm9, offset + index * 4 + 2, pal);
  });
}

function tmItemIds(): number[] {
  return [
    ...Array.from({ length: 92 }, (_, index) => 328 + index),
    ...Array.from({ length: 6 }, (_, index) => 420 + index),
    ...Array.from({ length: 3 }, (_, index) => 618 + index),
  ];
}
