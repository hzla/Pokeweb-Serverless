import { describe, expect, it } from "vitest";
import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { ENCOUNTER_SEASONS, type NarcName } from "../pokeweb/constants";
import { syncEncountersToDexHabitats, updateEncounterField } from "../pokeweb/encounterModel";
import { getNarcFormats } from "../pokeweb/formats";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { createNarcStore, decodeRecord, type ProjectState, type RawRecord } from "../pokeweb/projectStore";

describe("BW2 habitat sync", () => {
  it.each(["B2", "W2"] as const)("keeps Moor of Icirrus and Icirrus City separate in %s", async (version) => {
    const project = makeProject();
    project.session.baseVersion = version;
    setPool(project, 2, { spring_grass_rate: 20, spring_grass_slot_0: 453 });
    setPool(project, 117, { spring_grass_rate: 20, spring_grass_slot_0: 314 });

    await syncEncountersToDexHabitats(project);

    expect(species(project, 46)).toEqual([314]);
    expect(species(project, 52)).toEqual([453]);
  });

  it("replaces all-seasonal headers with independent land/surf/fishing flags", async () => {
    const project = makeProject();
    const raw: RawRecord = {};
    for (const season of ENCOUNTER_SEASONS) {
      raw[`${season}_grass_rate`] = season === "winter" ? 0 : 20;
      raw[`${season}_grass_slot_0`] = 453; // Stale winter slots must stay disabled.
      raw[`${season}_surf_rate`] = 10;
      raw[`${season}_surf_slot_0`] = 618;
      raw[`${season}_super_rod_rate`] = 10;
      raw[`${season}_super_rod_slot_0`] = 339;
    }
    setPool(project, 2, raw, true);
    project.narcs.habitats!.rawFiles[52].set([1, 1, 1, 1, 1, 1, 2, 0]);

    await syncEncountersToDexHabitats(project);

    expect([...habitat(project, 52).slice(0, 8)]).toEqual([1, 0, 0, 1, 1, 1, 2, 0]);
    expect(flags(project, 52, 453).slice(0, 12)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(flags(project, 52, 618).slice(0, 12)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  });

  it("uses the native Route 16/5 habitat IDs and groups the Desert Resort entrance with its interior", async () => {
    const project = makeProject();
    for (const pool of [10, 11, 104, 105, 106, 125]) {
      setPool(project, pool, { spring_grass_rate: 20, spring_grass_slot_0: pool });
    }

    await syncEncountersToDexHabitats(project);

    expect(species(project, 0)).toEqual([104, 105]);
    expect(species(project, 8)).toEqual([125]);
    expect(species(project, 9)).toEqual([106]);
    expect(species(project, 41)).toEqual([10, 11]);
  });

  it.each([
    ["grass", 0], ["surf", 1], ["super_rod", 2],
  ] as const)("detects seasonality for %s only", async (kind, method) => {
    const project = makeProject();
    const raw: RawRecord = {};
    for (const season of ENCOUNTER_SEASONS) {
      raw[`${season}_${kind}_rate`] = 20;
      raw[`${season}_${kind}_slot_0`] = season === "winter" ? 2 : 1;
    }
    setPool(project, 2, raw, true);

    await syncEncountersToDexHabitats(project);

    const expected = [0, 0, 0, 0, 0, 0];
    expected[method] = expected[method + 3] = 1;
    expect([...habitat(project, 52).slice(0, 6)]).toEqual(expected);
  });

  it("compares merged species sets rather than slot order, form, or level", async () => {
    const project = makeProject();
    for (const [pool, reverse] of [[108, false], [109, true]] as const) {
      const raw: RawRecord = {};
      ENCOUNTER_SEASONS.forEach((season, index) => {
        raw[`${season}_grass_rate`] = 20 + index;
        raw[`${season}_grass_slot_0`] = ((index % 2 === 0) !== reverse ? 1 : 2) + index * 2048;
        raw[`${season}_grass_slot_0_min_level`] = 5 + index;
      });
      setPool(project, pool, raw, true);
    }

    await syncEncountersToDexHabitats(project);

    expect(species(project, 49)).toEqual([1, 2]);
    expect([...habitat(project, 49).slice(0, 6)]).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it("ignores disabled methods, clears stale availability, and honors unsaved edits", async () => {
    const project = makeProject();
    setPool(project, 2, { spring_grass_rate: 20, spring_grass_slot_0: 1, spring_surf_slot_0: 2 });
    project.narcs.habitats!.rawFiles[52].set([1, 1, 1, 1, 1, 1]);
    updateEncounterField(project, 2, "spring_grass_slot_0", "3");

    await syncEncountersToDexHabitats(project);

    expect(species(project, 52)).toEqual([1, 3]);
    expect([...habitat(project, 52).slice(0, 6)]).toEqual([1, 0, 0, 1, 0, 0]);
    expect(flags(project, 52, 3).slice(0, 12)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("inherits compact encounter seasons but preserves zeroes in present seasonal tables", () => {
    const project = makeProject();
    setPool(project, 2, { spring_grass_rate: 20, spring_grass_slot_0: 1 });
    setPool(project, 117, { spring_grass_rate: 20, spring_grass_slot_0: 1 }, true);

    expect(decodeRecord(project, "encounters", 2).raw!.winter_grass_slot_0).toBe(1);
    const seasonal = decodeRecord(project, "encounters", 117).raw!;
    expect(seasonal.winter_grass_rate).toBe(0);
    expect(seasonal.winter_grass_slot_0).toBe(0);
    project.narcs.encounters!.dirty.add(117);
    materializeProjectEdits(project);
    expect(project.narcs.encounters!.rawFiles[117].slice(232).every(byte => byte === 0)).toBe(true);
  });

  it("retains all 30 species, survives NARC serialization, and is idempotent", async () => {
    const project = makeProject();
    const raw: RawRecord = { spring_grass_rate: 20, spring_grass_doubles_rate: 20, spring_grass_special_rate: 20 };
    for (let slot = 0; slot < 12; slot += 1) {
      raw[`spring_grass_slot_${slot}`] = slot + 1;
      raw[`spring_grass_doubles_slot_${slot}`] = slot + 13;
      if (slot < 6) raw[`spring_grass_special_slot_${slot}`] = slot + 25;
    }
    setPool(project, 2, raw);
    await syncEncountersToDexHabitats(project);
    expect(species(project, 52)).toHaveLength(30);
    materializeProjectEdits(project);
    const narc = new NARC();
    narc.files = project.narcs.habitats!.rawFiles;
    const reloaded = new NARC(narc.save());
    expect(reloaded.files[52]).toEqual(habitat(project, 52));
    const before = reloaded.files.map(file => file.slice());
    await syncEncountersToDexHabitats(project);
    expect(project.narcs.habitats!.rawFiles).toEqual(before);
  });

  it.each(["overflow", "missing pool", "truncated pool", "missing header"])("rejects %s without partially syncing", async (failure) => {
    const project = makeProject();
    if (failure === "overflow") {
      const raw: RawRecord = { spring_grass_rate: 20, spring_grass_doubles_rate: 20, spring_grass_special_rate: 20 };
      for (let slot = 0; slot < 12; slot += 1) {
        raw[`spring_grass_slot_${slot}`] = slot + 1;
        raw[`spring_grass_doubles_slot_${slot}`] = slot + 13;
        raw[`spring_grass_special_slot_${slot}`] = slot + 25;
      }
      setPool(project, 2, raw);
    } else if (failure === "missing pool") project.narcs.encounters!.fileCount = 134;
    else if (failure === "truncated pool") project.narcs.encounters!.rawFiles[2] = new Uint8Array(231);
    else project.narcs.habitats!.rawFiles[52] = new Uint8Array(9);
    const store = project.narcs.habitats!;
    const before = store.rawFiles.map(file => file.slice());
    const cached = decodeRecord(project, "habitats", 0);
    store.dirty.add(0);

    await expect(syncEncountersToDexHabitats(project)).rejects.toThrow(/30|missing|complete|header/u);

    expect(store.rawFiles).toEqual(before);
    expect([...store.dirty]).toEqual([0]);
    expect(store.records.get(0)).toBe(cached);
    expect(project.actionChangelog?.entries ?? []).toEqual([]);
  });
});

function makeProject(): ProjectState {
  const store = (name: NarcName, count: number, size: number) => {
    const narc = new NARC();
    narc.files = Array.from({ length: count }, () => new Uint8Array(size));
    return createNarcStore(name, "test", 0, narc);
  };
  return {
    session: { romName: "test", baseVersion: "B2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IREO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, trpokInfo: [],
    narcs: { encounters: store("encounters", 135, 232), habitats: store("habitats", 58, 10) },
    texts: { banks: {} }, formats: getNarcFormats("BW2"),
  };
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

function habitat(project: ProjectState, id: number): Uint8Array { return project.narcs.habitats!.rawFiles[id]; }
function species(project: ProjectState, id: number): number[] {
  const bytes = habitat(project, id);
  return Array.from({ length: readU16(bytes, 8) }, (_, i) => readU16(bytes, 10 + i * 28));
}
function flags(project: ProjectState, id: number, pokemon: number): number[] {
  const offset = 12 + species(project, id).indexOf(pokemon) * 28;
  return [...habitat(project, id).slice(offset, offset + 26)];
}
