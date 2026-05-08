import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  getGrottoOdds,
  getGrottoRecord,
  getMartRecord,
  grottoMatchesSearch,
  martMatchesSearch,
  remainingHiddenCommonOdd,
  updateGrottoField,
  updateGrottoOddsField,
  updateMartField,
} from "../pokeweb/martGrottoModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("martGrottoModel", () => {
  it("derives mart labels and inventory, updates items, and syncs mart_counts", () => {
    const project = makeProject();

    const mart = getMartRecord(project, 0);
    expect(mart.readable.name).toBe("Stock No Badges");
    expect(mart.inventory).toBe("Potion");

    const update = updateMartField(project, 0, "item_1", "Super Potion");
    const updated = getMartRecord(project, 0);

    expect(update.rawValue).toBe(2);
    expect(updated.inventory).toBe("Potion, Super Potion");
    expect(project.narcs.marts?.dirty.has(0)).toBe(true);
    expect(project.narcs.mart_counts?.rawFiles[0][0]).toBe(2);
    expect(project.narcs.mart_counts?.dirty.has(0)).toBe(true);
    expect(martMatchesSearch(updated, "badges, nope")).toBe(true);
  });

  it("derives grotto names, wild previews, odds, and updates pokemon/items/odds", () => {
    const project = makeProject();

    const grotto = getGrottoRecord(project, 0);
    expect(grotto.readable.name).toBe("Floccesy Ranch");
    expect(grotto.wilds).toContain("Bulbasaur");
    expect(grotto.wilds).toContain("Ivysaur");
    expect(grottoMatchesSearch(grotto, "floccesy")).toBe(true);

    updateGrottoField(project, 0, "black_common_pok_0", "Venusaur");
    updateGrottoField(project, 0, "normal_common_item_0", "Super Potion");
    updateGrottoField(project, 0, "black_common_min_lvl_0", "25");
    const oddsUpdate = updateGrottoOddsField(project, "rare_pok_odds_0", "15");

    const updated = getGrottoRecord(project, 0);
    expect(updated.raw.black_common_pok_0).toBe(3);
    expect(updated.readable.normal_common_item_0).toBe("Super Potion");
    expect(updated.readable.black_common_min_lvl_0).toBe(25);
    expect(oddsUpdate.rawValue).toBe(15);
    expect(getGrottoOdds(project).dirty).toBe(true);
    expect(project.narcs.grotto_odds?.rawFiles[0][0]).toBe(15);
    expect(remainingHiddenCommonOdd(project, 0)).toBe(18);
    expect(project.narcs.grottos?.dirty.has(0)).toBe(true);
    expect(project.narcs.grotto_odds?.dirty.has(0)).toBe(true);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const marts = packRows(formats.marts!, [{ item_0: 1, item_1: 0 }]);
  const grottoRow: Record<string, number> = {
    black_common_pok_0: 1,
    black_common_pok_1: 2,
    black_common_min_lvl_0: 10,
    black_common_max_lvl_0: 20,
    normal_common_item_0: 1,
  };
  const grottos = packRows(formats.grottos!, [grottoRow]);
  const odds = new Uint8Array(200);
  odds[0] = 10;
  odds[1] = 20;
  odds[2] = 30;
  odds[3] = 5;
  odds[4] = 4;
  odds[5] = 3;
  odds[6] = 2;
  odds[7] = 1;
  odds[8] = 1;
  odds[9] = 1;

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { marts: 1, mart_counts: 2, grottos: 3, grotto_odds: -1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      marts: makeStore("marts", marts, 1),
      mart_counts: makeStore("mart_counts", new Uint8Array([1]), 1, false),
      grottos: makeStore("grottos", grottos, 1),
      grotto_odds: makeStore("grotto_odds", odds, 1, false),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        items: ["None", "Potion", "Super Potion"],
        pokedex: ["None", "Bulbasaur", "Ivysaur", "Venusaur"],
      },
    },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, data: Uint8Array, count: number, split = true): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: split ? splitRows(data, count) : [data],
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
