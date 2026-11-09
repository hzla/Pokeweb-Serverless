import { describe, expect, it } from "vitest";
import contract from "../assets/data/bw2TownMapNativeContract.json";
import { writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NarcName } from "../pokeweb/constants";
import {
  decodeDexAreaFile,
  dexAreaPools,
  dexAreaSlots,
  encodeDexAreaFile,
  readDexArea,
  syncEncountersToDexAreas,
  writeDexArea,
} from "../pokeweb/dexAreaModel";
import { getNarcFormats } from "../pokeweb/formats";
import type { HeaderRow } from "../pokeweb/headerModel";
import { createNarcStore, type ProjectState, type RawRecord } from "../pokeweb/projectStore";
import { TOWN_MAP_STRIDE } from "../pokeweb/townMapModel";

const SPECIES = 8;
const ZONES = contract.B2.habitatZones;

describe("BW2 Pokédex areas", () => {
  it("round-trips a file and derives the year-round and empty-season bytes", () => {
    const seasons = [new Array(85).fill(0), new Array(85).fill(0), new Array(85).fill(0), new Array(85).fill(0)];
    seasons[0][3] = 0b1001;
    seasons[1][3] = 0b1001;
    const bytes = encodeDexAreaFile(seasons, 85);
    expect(bytes.length).toBe(345);
    expect(bytes[0]).toBe(0);
    expect([bytes[1], bytes[1 + 86], bytes[1 + 2 * 86], bytes[1 + 3 * 86]]).toEqual([0, 0, 1, 1]);
    expect(decodeDexAreaFile(bytes)).toEqual(seasons);
    expect(encodeDexAreaFile(seasons.map(() => seasons[0]), 85)[0]).toBe(1);
    expect(encodeDexAreaFile(seasons.map(() => new Array(128).fill(0)), 128).length).toBe(517);
    expect(() => encodeDexAreaFile(seasons, 90)).toThrow(/85 or 128/u);
  });

  it("maps slots to Town Map zones and groups pools by place name", () => {
    const project = makeProject();
    const slots = dexAreaSlots(project);
    expect(slots).toHaveLength(85);
    expect(slots[0]).toMatchObject({ slot: 0, zone: ZONES[0], pools: [10, 11] });
    expect(dexAreaPools(project, ZONES[1])).toEqual([12]);

    // Moving a Town Map record moves its slot to the new zone's encounters.
    const areas = project.narcs.town_map!.rawFiles[0];
    writeU16(areas, contract.B2.stockRecordZones.indexOf(ZONES[0]) * TOWN_MAP_STRIDE, ZONES[1]);
    expect(dexAreaSlots(project)[0]).toMatchObject({ zone: ZONES[1], pools: [12] });
  });

  it("syncs methods per season from every pool of the area and clears stale entries", async () => {
    const project = makeProject();
    setPool(project, 10, { spring_grass_rate: 20, spring_grass_slot_0: 1, spring_super_rod_rate: 5, spring_super_rod_slot_0: 2 });
    const seasonal: RawRecord = {};
    (["spring", "summer", "fall", "winter"] as const).forEach((season, i) => {
      seasonal[`${season}_surf_rate`] = 10;
      seasonal[`${season}_surf_slot_0`] = i === 3 ? 4 : 3;
    });
    setPool(project, 11, seasonal, true);
    setPool(project, 12, { spring_grass_rate: 0, spring_grass_slot_0: 5 });
    project.narcs.town_map_species_habitats!.rawFiles[5] = staleFile(); // species 6

    const result = await syncEncountersToDexAreas(project);

    expect(readDexArea(project, 1).map((flags) => flags[0])).toEqual([1, 1, 1, 1]);
    expect(readDexArea(project, 2).map((flags) => flags[0])).toEqual([1 << 5, 1 << 5, 1 << 5, 1 << 5]);
    expect(readDexArea(project, 3).map((flags) => flags[0])).toEqual([8, 8, 8, 0]);
    expect(readDexArea(project, 4).map((flags) => flags[0])).toEqual([0, 0, 0, 8]);
    expect(readDexArea(project, 5).flat().every((value) => value === 0)).toBe(true); // disabled method
    expect(readDexArea(project, 6).flat().every((value) => value === 0)).toBe(true);
    expect(project.narcs.town_map_species_habitats!.rawFiles[0][0]).toBe(1);
    expect(project.narcs.town_map_species_habitats!.rawFiles[2][0]).toBe(0);
    expect(result).toMatchObject({ species: 4, slots: 85 });
    expect(project.actionChangelog?.entries.some((entry) => entry.key === "dex-area-sync")).toBe(true);

    const before = project.narcs.town_map_species_habitats!.rawFiles.map((file) => file.slice());
    expect((await syncEncountersToDexAreas(project)).changed).toBe(0);
    expect(project.narcs.town_map_species_habitats!.rawFiles).toEqual(before);
  });

  it("keeps 128-slot files at their widened size", async () => {
    const project = makeProject(517);
    setPool(project, 12, { spring_grass_rate: 20, spring_grass_slot_0: 7 });
    await syncEncountersToDexAreas(project);
    const file = project.narcs.town_map_species_habitats!.rawFiles[6];
    expect(file.length).toBe(517);
    expect(readDexArea(project, 7).map((flags) => flags[1])).toEqual([1, 1, 1, 1]);
  });

  it("writes one species, marks it dirty and skips unchanged writes", () => {
    const project = makeProject();
    const seasons = readDexArea(project, 2);
    expect(writeDexArea(project, 2, seasons)).toBe(false);
    seasons[2][4] = 0b11;
    expect(writeDexArea(project, 2, seasons, "Ivysaur")).toBe(true);
    expect(readDexArea(project, 2)[2][4]).toBe(3);
    expect([...project.narcs.town_map_species_habitats!.dirty]).toEqual([1]);
    expect(project.actionChangelog?.entries.find((entry) => entry.key === "dex-area:2")?.text).toMatch(/Ivysaur/u);
  });
});

function staleFile(): Uint8Array {
  const seasons = [0, 1, 2, 3].map(() => new Array(85).fill(0x7f));
  return encodeDexAreaFile(seasons, 85);
}

function makeProject(fileSize = 345): ProjectState {
  const store = (name: NarcName, files: Uint8Array[]) => {
    const narc = new NARC();
    narc.files = files;
    return createNarcStore(name, "test", 0, narc);
  };
  const empty = fileSize === 345 ? 85 : 128;
  const areas = new Uint8Array(85 * TOWN_MAP_STRIDE);
  contract.B2.stockRecordZones.forEach((zone, i) => writeU16(areas, i * TOWN_MAP_STRIDE, zone));
  const species = Array.from({ length: SPECIES }, () => encodeDexAreaFile([0, 1, 2, 3].map(() => new Array(empty).fill(0)), empty));
  const rows: Record<number, HeaderRow> = {};
  const zoneCount = 700;
  for (let zone = 0; zone < zoneCount; zone += 1) rows[zone + 1] = { place_name_id: 1000 + zone, encounter_id: 65535, location_name: `Place ${zone}` } as unknown as HeaderRow;
  // Slot 0's zone shares its place name with another zone that has a second pool.
  rows[ZONES[0] + 1] = { place_name_id: 1, encounter_id: 10, location_name: "Route A" } as unknown as HeaderRow;
  rows[650 + 1] = { place_name_id: 1, encounter_id: 11, location_name: "Route A" } as unknown as HeaderRow;
  rows[ZONES[1] + 1] = { place_name_id: 2, encounter_id: 12, location_name: "Route B" } as unknown as HeaderRow;
  return {
    session: { romName: "test", baseVersion: "B2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IREO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, trpokInfo: [],
    narcs: {
      encounters: store("encounters", Array.from({ length: 135 }, () => new Uint8Array(232))),
      town_map: store("town_map", [areas]),
      town_map_species_habitats: store("town_map_species_habitats", species),
    },
    headers: { count: zoneCount, rows },
    texts: { banks: {} }, formats: getNarcFormats("BW2"),
  } as ProjectState;
}

function setPool(project: ProjectState, id: number, raw: RawRecord, seasonal = false): void {
  const bytes = new Uint8Array(seasonal ? 928 : 232);
  let offset = 0;
  for (const [size, field] of project.formats.encounters!) {
    if (offset >= bytes.length) break;
    if (size === 2) writeU16(bytes, offset, raw[field] ?? 0);
    else bytes[offset] = raw[field] ?? 0;
    offset += size;
  }
  project.narcs.encounters!.rawFiles[id] = bytes;
  project.narcs.encounters!.records.delete(id);
}
