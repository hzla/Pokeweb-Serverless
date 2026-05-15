import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { writeU16 } from "../nds/binary";
import {
  getFacilityChoiceRecord,
  getFacilitySetRecord,
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
      count: 2,
      setIds: [0, 999],
      invalidSetIds: [999],
      byteLength: 8,
    });
    expect(getFacilityChoiceRecord(project, "pwt_tr6", 0)).toMatchObject({
      trainerType: 12,
      count: 6,
      setIds: [0, 1, 2, 3, 4, 5],
      byteLength: 16,
    });

    updateFacilityChoiceField(project, "pwt_tr1", 0, "set_1", "0");
    expect(getFacilityChoiceRecord(project, "pwt_tr1", 0).invalidSetIds).toEqual([]);
    expect(project.narcs.pwt_tr1?.dirty.has(0)).toBe(true);
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

function makeProject(files: Partial<Record<FacilitySetNarcName | FacilityChoiceNarcName, Uint8Array[]>>): ProjectState {
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
