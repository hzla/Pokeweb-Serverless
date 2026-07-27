import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { copyEncounterData, copyEncounterSeason, encounterKindLabel, getEncounterRecord, syncEncountersToDexHabitats, updateEncounterField } from "../pokeweb/encounterModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
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
    expect(encounter.grassWilds).toEqual(["Bulbasaur", "Ivysaur"]);
    expect(encounter.waterWilds).toEqual(["Ivysaur"]);
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

  it("copies all encounter data from one area to another while retaining the target area identity", () => {
    const project = makeProject();

    updateEncounterField(project, 1, "spring_grass_slot_0", "Ivysaur");
    updateEncounterField(project, 1, "spring_grass_slot_0_form", "4");
    updateEncounterField(project, 1, "spring_grass_rate", "44");
    const copied = copyEncounterData(project, 0, 1);

    expect(copied.id).toBe(0);
    expect(copied.locations).toEqual([]);
    expect(copied.raw.spring_grass_slot_0).toBe(8194);
    expect(copied.raw.spring_grass_rate).toBe(44);
    expect(copied.readable.spring_grass_slot_0).toBe("Ivysaur");
    expect(copied.readable.spring_grass_slot_0_form).toBe(4);
    expect(getEncounterRecord(project, 1).locations).toEqual(["Route 1 (1)", "Route 1 Gate (2)"]);
    expect(project.narcs.encounters?.dirty.has(0)).toBe(true);
    materializeProjectEdits(project);
    expect(project.narcs.encounters?.rawFiles[0]).toEqual(project.narcs.encounters?.rawFiles[1]);
  });

  it("rejects unavailable or identical encounter copy sources", () => {
    const project = makeProject();

    expect(() => copyEncounterData(project, 0, -1)).toThrow(/No encounter data/u);
    expect(() => copyEncounterData(project, 0, 2)).toThrow(/No encounter data/u);
    expect(() => copyEncounterData(project, 0, 0)).toThrow(/different source/u);
  });

  it("syncs BW2 dex habitat entries from encounter pools", async () => {
    const project = makeProject();

    const result = await syncEncountersToDexHabitats(project);
    const habitat = project.narcs.habitats?.rawFiles[34];

    expect(result.habitats).toBe(58);
    expect(habitat).toBeDefined();
    expect(readU16(habitat!, 8)).toBe(2);
    expect(readU16(habitat!, 10)).toBe(1);
    expect(habitat![12]).toBe(1);
    expect(habitat![15]).toBe(1);
    expect(readU16(habitat!, 38)).toBe(2);
    expect(habitat![40]).toBe(1);
    expect(habitat![41]).toBe(1);
    expect(project.narcs.habitats?.dirty.has(34)).toBe(true);
  });

  it("parses and materializes DPPt encounter records", () => {
    const project = makeGen4EncounterProject("Pt", "Pt", [makeDpptEncounterBytes()]);

    const encounter = getEncounterRecord(project, 0);

    expect(encounter.locations).toEqual(["Route 201 (1)"]);
    expect(encounter.grassWilds).toContain("Bulbasaur");
    expect(encounter.grassWilds).toContain("Metapod");
    expect(encounter.grassWilds).toContain("Beedrill");
    expect(encounter.waterWilds).toEqual(["Venusaur", "Charmander"]);
    expect(encounter.readable.spring_grass_slot_0).toBe("Bulbasaur");
    expect(encounter.readable.spring_day_slot_0).toBe("Charmeleon");
    expect(encounter.readable.spring_poke_radar_slot_2).toBe("Weedle");
    expect(encounter.readable.spring_ruby_slot_0).toBe("Beedrill");
    expect(encounter.readable.spring_old_rod_slot_0).toBe("Charmander");
    expect(encounterKindLabel(project, "poke_radar")).toBe("Poke Radar");
    expect(encounterKindLabel(project, "old_rod")).toBe("Old Rod");

    updateEncounterField(project, 0, "spring_grass_slot_0", "Ivysaur");
    updateEncounterField(project, 0, "spring_grass_slot_0_max_level", "11");
    updateEncounterField(project, 0, "spring_day_slot_0", "Charizard");
    updateEncounterField(project, 0, "spring_poke_radar_slot_2", "Pidgey");
    updateEncounterField(project, 0, "spring_old_rod_slot_0_min_level", "7");
    materializeProjectEdits(project);

    const out = project.narcs.encounters!.rawFiles[0];
    expect(readInt(out, 4, 4)).toBe(11);
    expect(readInt(out, 8, 4)).toBe(2);
    expect(readInt(out, 0x6c, 4)).toBe(6);
    expect(readInt(out, 0x84, 4)).toBe(16);
    expect(readInt(out, 0x128 + 1, 1)).toBe(7);
    expect(readInt(out, 0x128 + 4, 4)).toBe(4);
  });

  it("parses and materializes HGSS encounter records", () => {
    const project = makeGen4EncounterProject("HG", "HGSS", [makeHgssEncounterBytes()]);

    const encounter = getEncounterRecord(project, 0);

    expect(encounter.grassWilds).toContain("Bulbasaur");
    expect(encounter.grassWilds).toContain("Squirtle");
    expect(encounter.grassWilds).toContain("Metapod");
    expect(encounter.waterWilds).toEqual(["Charmander", "Charmeleon"]);
    expect(encounter.readable.spring_grass_doubles_slot_0).toBe("Ivysaur");
    expect(encounter.readable.spring_hoenn_radio_slot_1).toBe("Squirtle");
    expect(encounter.readable.spring_swarm_slot_2).toBe("Butterfree");
    expect(encounter.readable.spring_rock_smash_slot_0).toBe("Charmeleon");
    expect(encounterKindLabel(project, "grass_doubles")).toBe("Day");
    expect(encounterKindLabel(project, "hoenn_radio")).toBe("Hoenn Radio");

    updateEncounterField(project, 0, "spring_rock_smash_slot_0", "Bulbasaur");
    updateEncounterField(project, 0, "spring_grass_special_slot_0_max_level", "9");
    updateEncounterField(project, 0, "spring_hoenn_radio_slot_1", "Pidgey");
    updateEncounterField(project, 0, "spring_swarm_slot_2", "Pidgeotto");
    materializeProjectEdits(project);

    const out = project.narcs.encounters!.rawFiles[0];
    expect(readInt(out, 94, 2)).toBe(16);
    expect(readInt(out, 122, 2)).toBe(1);
    expect(readInt(out, 192, 2)).toBe(17);
    expect(readInt(out, 8, 1)).toBe(9);
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
      spring_surf_slot_0: 2,
      spring_surf_slot_0_min_level: 10,
      spring_surf_slot_0_max_level: 12,
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
      habitats: makeStore("habitats", new Uint8Array(10 * 58), 58),
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

function makeGen4EncounterProject(baseVersion: "D" | "P" | "Pt" | "HG" | "SS", baseRom: "DP" | "Pt" | "HGSS", files: Uint8Array[]): ProjectState {
  return {
    session: {
      romName: "test",
      generation: "gen4",
      baseVersion,
      baseRom,
      fairy: false,
      fileIds: { encounters: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: files.reduce((sum, file) => sum + file.length, 0) },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      encounters: makeFileStore("encounters", files),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: [
          "",
          "Bulbasaur",
          "Ivysaur",
          "Venusaur",
          "Charmander",
          "Charmeleon",
          "Charizard",
          "Squirtle",
          "Wartortle",
          "Blastoise",
          "Caterpie",
          "Metapod",
          "Butterfree",
          "Weedle",
          "Kakuna",
          "Beedrill",
          "Pidgey",
          "Pidgeotto",
        ],
      },
    },
    formats: getNarcFormats(baseRom),
    trpokInfo: [],
    headers: {
      count: 1,
      rows: {
        1: { index: 0, location_name: "Route 201", encounter_id: 0 },
      },
    },
  };
}

function makeFileStore(name: NarcName, files: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: files.length,
    rawFiles: files.map((file) => file.slice()),
    records: new Map(),
    dirty: new Set(),
  };
}

function makeDpptEncounterBytes(): Uint8Array {
  const out = new Uint8Array(0x1a8);
  writeInt(out, 0, 4, 25);
  writeInt(out, 4, 4, 5);
  writeInt(out, 8, 4, 1);
  writeInt(out, 12, 4, 6);
  writeInt(out, 16, 4, 2);
  writeGen4SpeciesOnlyGroup(out, 0x64, 4, [9, 10]);
  writeGen4SpeciesOnlyGroup(out, 0x6c, 4, [5, 6]);
  writeGen4SpeciesOnlyGroup(out, 0x74, 4, [7, 8]);
  writeGen4SpeciesOnlyGroup(out, 0x7c, 4, [11, 12, 13, 14]);
  writeGen4SpeciesOnlyGroup(out, 0xa4, 4, [15, 16]);
  writeDpptWaterSlot(out, 0xcc, 0xd0, 0, 3, 10, 16);
  writeDpptWaterSlot(out, 0x124, 0x128, 0, 4, 4, 8);
  return out;
}

function writeDpptWaterSlot(out: Uint8Array, rateOffset: number, slotsOffset: number, slot: number, species: number, minLevel: number, maxLevel: number): void {
  writeInt(out, rateOffset, 4, 30);
  const offset = slotsOffset + slot * 8;
  writeInt(out, offset, 1, maxLevel);
  writeInt(out, offset + 1, 1, minLevel);
  writeInt(out, offset + 4, 4, species);
}

function makeHgssEncounterBytes(): Uint8Array {
  const out = new Uint8Array(196);
  out.set([20, 30, 15, 40, 50, 60], 0);
  for (let slot = 0; slot < 12; slot += 1) out[8 + slot] = 5 + slot;
  writeInt(out, 20, 2, 1);
  writeInt(out, 44, 2, 2);
  writeInt(out, 68, 2, 3);
  writeGen4SpeciesOnlyGroup(out, 92, 2, [6, 7]);
  writeGen4SpeciesOnlyGroup(out, 96, 2, [8, 9]);
  writeHgssWaterSlot(out, 100, 0, 4, 10, 20);
  writeHgssWaterSlot(out, 120, 0, 5, 6, 8);
  writeGen4SpeciesOnlyGroup(out, 188, 2, [10, 11, 12, 13]);
  return out;
}

function writeHgssWaterSlot(out: Uint8Array, slotsOffset: number, slot: number, species: number, minLevel: number, maxLevel: number): void {
  const offset = slotsOffset + slot * 4;
  writeInt(out, offset, 1, minLevel);
  writeInt(out, offset + 1, 1, maxLevel);
  writeInt(out, offset + 2, 2, species);
}

function writeGen4SpeciesOnlyGroup(out: Uint8Array, offset: number, size: 2 | 4, speciesIds: number[]): void {
  speciesIds.forEach((species, slot) => writeInt(out, offset + slot * size, size, species));
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

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i += 1) value |= (bytes[offset + i] ?? 0) << (8 * i);
  return value >>> 0;
}
