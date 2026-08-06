import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { writeU16 } from "../nds/binary";
import {
  defaultSetLibraryForChoice,
  getFacilityAreaPoolRecord,
  getFacilityChoiceRecord,
  getFacilitySetRecord,
  isBossFacilityChoice,
  updateFacilityAreaPoolValue,
  updateFacilityChoiceField,
  updateFacilitySetField,
  type FacilityChoiceNarcName,
  type FacilitySetNarcName,
} from "../pokeweb/battleFacilityModel";
import { getNarcFormats } from "../pokeweb/formats";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("battleFacilityModel", () => {
  it("parses and updates compact 16-byte Pokemon set records", () => {
    const project = makeProject({
      subway_sets: [packSet({ species: 1, moves: [2, 3, 4, 5], evSpread: 0b000101, nature: 3, item: 1, form: 0 })],
    });

    const record = getFacilitySetRecord(project, "subway_sets", 0);
    expect(record).toMatchObject({
      speciesId: 1,
      speciesName: "Bulbasaur",
      moves: [
        { id: 2, name: "Vine Whip" },
        { id: 3, name: "Flamethrower" },
        { id: 4, name: "Surf" },
        { id: 5, name: "Thunderbolt" },
      ],
      evSpread: 5,
      evStats: [true, false, true, false, false, false],
      natureId: 3,
      itemName: "Potion",
    });

    updateFacilitySetField(project, "subway_sets", 0, "species", "Ivysaur");
    updateFacilitySetField(project, "subway_sets", 0, "move_0", "Tackle");
    updateFacilitySetField(project, "subway_sets", 0, "ev_1", true);
    updateFacilitySetField(project, "subway_sets", 0, "nature", "Adamant (3)");
    updateFacilitySetField(project, "subway_sets", 0, "item", "Berry");
    updateFacilitySetField(project, "subway_sets", 0, "form", "2");

    const updated = getFacilitySetRecord(project, "subway_sets", 0);
    expect(updated).toMatchObject({
      speciesId: 2,
      evSpread: 7,
      itemId: 2,
      form: 2,
    });
    expect(updated.moves[0]).toEqual({ id: 1, name: "Tackle" });
    expect(project.narcs.subway_sets?.dirty.has(0)).toBe(true);
  });

  it("parses variable-length trainer choice and mapping records", () => {
    const project = makeProject({
      pwt_sets_3: [packSet({ species: 1, moves: [1, 2, 3, 4], evSpread: 0, nature: 0, item: 0, form: 0 })],
      pwt_tr1: [packChoice([12, 2, 0, 999])],
      pwt_tr6: [packChoice([12, 6, 0, 1, 2, 3, 4, 5])],
    });

    expect(getFacilityChoiceRecord(project, "pwt_tr1", 0)).toMatchObject({
      trainerType: 12,
      trainerTypeName: "Header 12",
      count: 2,
      setIds: [0, 999],
      invalidSetIds: [999],
      byteLength: 8,
    });
    expect(getFacilityChoiceRecord(project, "pwt_tr6", 0)).toMatchObject({
      trainerType: 12,
      trainerTypeName: "Header 12",
      count: 6,
      setIds: [0, 1, 2, 3, 4, 5],
      byteLength: 16,
    });

    updateFacilityChoiceField(project, "pwt_tr1", 0, "set_1", "0");
    expect(getFacilityChoiceRecord(project, "pwt_tr1", 0).invalidSetIds).toEqual([]);
    expect(project.narcs.pwt_tr1?.dirty.has(0)).toBe(true);
  });

  it("parses WBT sets, trainer choices, and boss records", () => {
    const project = makeProject({
      wbt_sets: [
        packSet({ species: 1, moves: [1, 2, 3, 4], evSpread: 0, nature: 0, item: 0, form: 0 }),
        packSet({ species: 2, moves: [2, 3, 4, 5], evSpread: 0b001010, nature: 3, item: 2, form: 0 }),
        packSet({ species: 1, moves: [5, 4, 3, 2], evSpread: 0, nature: 1, item: 1, form: 0 }),
      ],
      wbt_trainers: [packChoice([59, 3, 0, 1, 2]), packChoice([60, 10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), packChoice([61, 20, ...Array.from({ length: 20 }, (_unused, index) => index)])],
    });

    expect(defaultSetLibraryForChoice(project, "wbt_trainers")).toBe("wbt_sets");
    expect(getFacilitySetRecord(project, "wbt_sets", 1)).toMatchObject({
      speciesId: 2,
      itemId: 2,
      natureId: 3,
      evSpread: 10,
    });

    const boss = getFacilityChoiceRecord(project, "wbt_trainers", 0);
    expect(boss).toMatchObject({
      trainerType: 59,
      count: 3,
      setIds: [0, 1, 2],
      byteLength: 10,
      setLibrary: "wbt_sets",
    });
    expect(isBossFacilityChoice(boss)).toBe(true);

    const normal = getFacilityChoiceRecord(project, "wbt_trainers", 1);
    expect(normal).toMatchObject({ count: 10, byteLength: 24 });
    expect(isBossFacilityChoice(normal)).toBe(false);

    updateFacilityChoiceField(project, "wbt_trainers", 0, "trainerType", "60");
    expect(getFacilityChoiceRecord(project, "wbt_trainers", 0).trainerType).toBe(60);
    expect(project.narcs.wbt_trainers?.dirty.has(0)).toBe(true);
  });

  it("parses and updates WBT area pool trainer references", () => {
    const area = new Uint8Array(0x698).fill(0xff);
    writeU16(area, 0, 1);
    writeU16(area, 2, 0);
    writeU16(area, 4, 2);
    [1, 2, 0, 65000, 3].forEach((value, index) => writeU16(area, 0x60 + index * 2, value));
    [4, 5, 6].forEach((value, index) => writeU16(area, 0x80 + index * 2, value));

    const project = makeProject({
      wbt_area_pools: [area],
      wbt_trainers: [
        packChoice([0, 1, 0]),
        packChoice([59, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
        packChoice([60, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
        packChoice([61, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
        packChoice([62, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
        packChoice([63, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
        packChoice([64, 20, ...Array.from({ length: 20 }, (_unused, index) => index)]),
      ],
    });

    const record = getFacilityAreaPoolRecord(project, 0);
    expect(record.recordId).toBe(1);
    expect(record.pools).toHaveLength(2);
    expect(record.pools[0]).toMatchObject({ startOffset: 0x60, trainerRefCount: 3 });
    expect(record.pools[0].values.map((value) => value.isTrainerRef)).toEqual([true, true, false, false, true]);
    expect(record.pools[0].values[0].trainerTypeName).toBe("Pokemon Fan (Male)");

    updateFacilityAreaPoolValue(project, 0, 0x62, "4");
    expect(getFacilityAreaPoolRecord(project, 0).pools[0].values[1]).toMatchObject({ value: 4, isTrainerRef: true });
    expect(project.narcs.wbt_area_pools?.dirty.has(0)).toBe(true);
  });

  it("updates raw hex while preserving record size", () => {
    const project = makeProject({
      pwt_sets_6: [packSet({ species: 1, moves: [1, 2, 3, 4], evSpread: 0, nature: 0, item: 0, form: 0 })],
      pwt_map_2: [packChoice([1, 2, 3, 4, 5, 6])],
    });

    updateFacilitySetField(project, "pwt_sets_6", 0, "rawHex", "02 00 01 00 02 00 03 00 04 00 03 01 02 00 01 00");
    expect(getFacilitySetRecord(project, "pwt_sets_6", 0)).toMatchObject({ speciesId: 2, evSpread: 3, natureId: 1, itemId: 2, form: 1 });

    updateFacilityChoiceField(project, "pwt_map_2", 0, "rawHex", "09 00 01 00 00 00 07 00 08 00 09 00");
    expect(getFacilityChoiceRecord(project, "pwt_map_2", 0)).toMatchObject({ trainerType: 9, count: 1, setIds: [0], extraValues: [7, 8, 9] });
  });
});

function makeProject(files: Partial<Record<FacilitySetNarcName | FacilityChoiceNarcName | "wbt_area_pools", Uint8Array[]>>): ProjectState {
  const narcs: Partial<Record<NarcName, NarcStore>> = {};
  for (const [name, rawFiles] of Object.entries(files)) {
    narcs[name as NarcName] = makeStore(name as NarcName, rawFiles);
  }
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs,
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur", "Ivysaur"],
        moves: ["None", "Tackle", "Vine Whip", "Flamethrower", "Surf", "Thunderbolt"],
        items: ["None", "Potion", "Berry"],
      },
    },
    formats: getNarcFormats("BW2"),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function packSet(record: { species: number; moves: number[]; evSpread: number; nature: number; item: number; form: number }): Uint8Array {
  const out = new Uint8Array(16);
  writeU16(out, 0, record.species);
  record.moves.forEach((move, index) => writeU16(out, 2 + index * 2, move));
  out[10] = record.evSpread;
  out[11] = record.nature;
  writeU16(out, 12, record.item);
  writeU16(out, 14, record.form);
  return out;
}

function packChoice(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((value, index) => writeU16(out, index * 2, value));
  return out;
}
