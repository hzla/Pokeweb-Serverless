import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { copyEncounterSeason, getEncounterRecord, updateEncounterField } from "../pokeweb/encounterModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";

describe("encounterModel", () => {
  it("derives encounter locations, unique wilds, forms, and spring fallback values", () => {
    const project = makeProject();
    const rawRecord = decodeRecord(project, "encounters", 1);
    const encounter = getEncounterRecord(project, 1);

    expect(rawRecord.raw?.summer_grass_rate).toBe(10);
    expect(encounter.locations).toEqual(["Route 1 (1)", "Route 1 Gate (2)"]);
    expect(encounter.readable.spring_grass_slot_0).toBe("Bulbasaur");
    expect(encounter.readable.spring_grass_slot_0_form).toBe(2);
    expect(encounter.wilds).toEqual(["Bulbasaur", "Ivysaur"]);
  });

  it("updates species, form, numeric fields, empty slots, and dirty state", () => {
    const project = makeProject();

    const species = updateEncounterField(project, 1, "spring_grass_slot_0", "Ivysaur");
    const form = updateEncounterField(project, 1, "spring_grass_slot_0_form", "3");
    const rate = updateEncounterField(project, 1, "spring_grass_rate", "35");
    const empty = updateEncounterField(project, 1, "spring_grass_slot_1", "-");

    const encounter = getEncounterRecord(project, 1);
    expect(species.rawValue).toBe(2 + 2 * 2048);
    expect(form.rawValue).toBe(2 + 3 * 2048);
    expect(rate.value).toBe(35);
    expect(empty.rawValue).toBe(0);
    expect(encounter.raw.spring_grass_slot_0).toBe(6146);
    expect(encounter.readable.spring_grass_slot_0).toBe("Ivysaur");
    expect(encounter.readable.spring_grass_slot_0_form).toBe(3);
    expect(encounter.raw.spring_grass_slot_1).toBe(0);
    expect(project.narcs.encounters?.dirty.has(1)).toBe(true);
  });

  it("rejects invalid encounter edits", () => {
    const project = makeProject();

    expect(() => updateEncounterField(project, 1, "spring_grass_slot_0", "Missingno")).toThrow(/Unknown Pokemon/u);
    expect(() => updateEncounterField(project, 1, "spring_grass_rate", "101")).toThrow(/between 0 and 100/u);
    expect(() => updateEncounterField(project, 1, "spring_grass_slot_0_form", "x")).toThrow(/integer/u);
  });

  it("copies one season to the other seasons and keeps readable data in sync", () => {
    const project = makeProject();

    updateEncounterField(project, 1, "spring_grass_slot_0", "Ivysaur");
    updateEncounterField(project, 1, "spring_grass_slot_0_form", "4");
    updateEncounterField(project, 1, "spring_grass_rate", "44");
    copyEncounterSeason(project, 1, "spring");

    const encounter = getEncounterRecord(project, 1);
    expect(encounter.raw.spring_grass_slot_0).toBe(8194);
    expect(encounter.raw.summer_grass_slot_0).toBe(8194);
    expect(encounter.raw.fall_grass_rate).toBe(44);
    expect(encounter.raw.winter_grass_rate).toBe(44);
    expect(encounter.readable.summer_grass_slot_0).toBe("Ivysaur");
    expect(encounter.readable.summer_grass_slot_0_form).toBe(4);
    expect(project.narcs.encounters?.dirty.has(1)).toBe(true);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const encounters = packRows(formats.encounters!, [
    {},
    {
      spring_grass_rate: 10,
      spring_grass_slot_0: 1 + 2 * 2048,
      spring_grass_slot_0_min_level: 5,
      spring_grass_slot_0_max_level: 7,
      spring_grass_slot_1: 2,
      spring_grass_slot_1_min_level: 6,
      spring_grass_slot_1_max_level: 8,
    },
  ]);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { encounters: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: encounters.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      encounters: makeStore("encounters", encounters, 2),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: ["", "Bulbasaur", "Ivysaur"],
      },
    },
    formats,
    trpokInfo: [],
    headers: {
      count: 2,
      rows: {
        1: { index: 0, location_name: "Route 1", encounter_id: 1 },
        2: { index: 1, location_name: "Route 1 Gate", encounter_id: 1 },
      },
    },
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
