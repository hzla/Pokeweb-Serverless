import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getItemRecord, getMoveRecord, moveMatchesSearch, updateItemField, updateMoveField } from "../pokeweb/moveItemModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("moveItemModel", () => {
  it("derives move readable fields including effects, hits, signed magnitudes, and props", () => {
    const project = makeProject();
    const move = getMoveRecord(project, 1);

    expect(move.readable.name).toBe("Tackle");
    expect(move.readable.type).toBe("Normal");
    expect(move.readable.category).toBe("Physical");
    expect(move.readable.effect).toBe("None");
    expect(move.readable.min_hits).toBe(1);
    expect(move.readable.max_hits).toBe(3);
    expect(move.readable.magnitude_1).toBe(-1);
    expect(move.readable.contact).toBe(1);
  });

  it("updates move text fields, numeric fields, hits, and property packing", () => {
    const project = makeProject();

    updateMoveField(project, 1, "type", "Fire");
    updateMoveField(project, 1, "category", "Special");
    updateMoveField(project, 1, "power", "90");
    updateMoveField(project, 1, "min_hits", "2");
    updateMoveField(project, 1, "max_hits", "5");
    updateMoveField(project, 1, "magnitude_1", "-2");
    updateMoveField(project, 1, "sound_move", true);

    const move = getMoveRecord(project, 1);
    expect(move.raw.type).toBe(9);
    expect(move.raw.category).toBe(2);
    expect(move.raw.power).toBe(90);
    expect(move.raw.hits).toBe(0x52);
    expect(move.raw.magnitude_1).toBe(254);
    expect(move.readable.sound_move).toBe(1);
    expect(project.narcs.moves?.dirty.has(1)).toBe(true);
    expect(moveMatchesSearch(move, "tackle", new Set(["special"]), new Set(["fire"]))).toBe(true);
  });

  it("updates item numeric fields and rejects out-of-range values", () => {
    const project = makeProject();

    updateItemField(project, 1, "market_value", "500");
    updateItemField(project, 1, "item_type", "12");

    const item = getItemRecord(project, 1);
    expect(item.readable.name).toBe("Potion");
    expect(item.raw.market_value).toBe(500);
    expect(item.raw.item_type).toBe(12);
    expect(project.narcs.items?.dirty.has(1)).toBe(true);
    expect(() => updateItemField(project, 1, "market_value", "70000")).toThrow(/between 0 and 65535/u);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const moves = packRows(formats.moves!, [
    {},
    { type: 0, category: 1, power: 40, accuracy: 100, pp: 35, effect: 0, result_effect: 0, status: 0, target: 0, stat_1: 1, magnitude_1: 255, hits: 0x31, properties: 1 },
  ]);
  const items = packRows(formats.items!, [{}, { market_value: 300, item_type: 1 }]);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { moves: 1, items: 2 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: moves.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      moves: makeStore("moves", moves, 2),
      items: makeStore("items", items, 2),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        moves: ["None", "Tackle"],
        items: ["None", "Potion"],
      },
    },
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
