import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { getNarcFormats } from "../pokeweb/formats";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  copySubwaySetFor,
  distinctSpecies,
  getPoolOfTrainer,
  getSlotTrainers,
  getSubwayPools,
  getSubwaySetUsers,
  getSubwayTrainer,
  getUnusedSubwaySets,
  setSubwayPoolSets,
  setSubwayTrainerSets,
  speciesNeeded,
  subwaySlot,
  subwayTrainerIv,
  subwayTrainsForTrainer,
  updateSubwayTrainerField,
} from "../pokeweb/subwayModel";

describe("subwayModel", () => {
  it("reads trainer N from file N + 1 with its name, quotes, IVs and slots", () => {
    const project = makeProject();
    const joshua = getSubwayTrainer(project, 0);
    expect(joshua).toMatchObject({ name: "Joshua", trainerClass: 2, setIds: [1, 2, 3], iv: 3, role: "regular" });
    expect(joshua.slots.map((entry) => entry.key)).toEqual(["n1a"]);
    expect(subwayTrainsForTrainer(joshua).map((train) => train.id)).toEqual(["single", "double", "multi"]);
    expect(getSubwayTrainer(project, 306)).toMatchObject({ role: "boss", boss: { name: "Ingo", train: "single" }, iv: 31 });
    expect(getSubwayTrainer(project, 301).role).toBe("partner");
    expect(subwayTrainerIv(55)).toBe(6);
    expect(subwayTrainerIv(250)).toBe(31);
  });

  it("lists a slot's trainers and groups identical lists into pools", () => {
    const project = makeProject();
    expect(getSlotTrainers(project, subwaySlot("n1a")!).map((trainer) => trainer.id)).toEqual(Array.from({ length: 50 }, (_unused, id) => id));
    const pool = getPoolOfTrainer(project, 0);
    expect(pool.trainerIds).toHaveLength(50);
    expect(getSubwayPools(project).length).toBeGreaterThan(1);
    expect(getSubwaySetUsers(project, 2)).toHaveLength(50);
    expect(getUnusedSubwaySets(project)).toEqual([5]);
  });

  it("edits a name, a quote and the class", () => {
    const project = makeProject();
    updateSubwayTrainerField(project, 0, "name", "Joey");
    updateSubwayTrainerField(project, 0, "quote_1", "I win!");
    updateSubwayTrainerField(project, 0, "trainerClass", 3);
    expect(getSubwayTrainer(project, 0)).toMatchObject({ name: "Joey", trainerClass: 3, setIds: [1, 2, 3] });
    expect(project.texts.messageTexts![376]![1]![1]).toBe("I win!");
  });

  it("edits one trainer's list, a whole pool, and copies a shared set", () => {
    const project = makeProject();
    setSubwayTrainerSets(project, 0, [1, 4]);
    expect(getSubwayTrainer(project, 0).setIds).toEqual([1, 4]);
    expect(getSubwayTrainer(project, 1).setIds).toEqual([1, 2, 3]);
    expect(() => setSubwayTrainerSets(project, 0, [99])).toThrow(/isn't in/u);

    const pool = getPoolOfTrainer(project, 1);
    setSubwayPoolSets(project, pool.trainerIds, [2, 3, 4]);
    expect(getSubwayTrainer(project, 49).setIds).toEqual([2, 3, 4]);

    const copy = copySubwaySetFor(project, [1], 2);
    expect(copy).toBe(6);
    expect(getSubwayTrainer(project, 1).setIds).toEqual([6, 3, 4]);
    expect(getSubwayTrainer(project, 2).setIds).toEqual([2, 3, 4]);
    expect(project.narcs.subway_sets?.rawFiles[6]).toEqual(project.narcs.subway_sets?.rawFiles[2]);
  });

  it("counts species for the freeze warning", () => {
    const project = makeProject();
    expect(distinctSpecies(project, [1, 2, 3, 4])).toBe(3);
    expect(speciesNeeded(getSubwayTrainer(project, 0))).toBe(8);
    expect(speciesNeeded(getSubwayTrainer(project, 306))).toBe(0);
  });
});

function trainer(cls: number, ids: number[]): Uint8Array {
  const out = new Uint8Array(4 + ids.length * 2);
  writeU16(out, 0, cls);
  writeU16(out, 2, ids.length);
  ids.forEach((id, index) => writeU16(out, 4 + index * 2, id));
  return out;
}

function set(species: number, item = 0): Uint8Array {
  const out = new Uint8Array(16);
  writeU16(out, 0, species);
  writeU16(out, 12, item);
  return out;
}

function makeProject(): ProjectState {
  const trainers = [trainer(0, [0])];
  for (let id = 0; id < 314; id += 1) trainers.push(id < 50 ? trainer(2, [1, 2, 3]) : id >= 306 ? trainer(0x9f, [4]) : trainer(3, [4]));
  const files: Partial<Record<NarcName, Uint8Array[]>> = {
    subway_trainers: trainers,
    // Sets 3 and 4 are the same species; set 5 is unused.
    subway_sets: [set(0), set(19), set(16), set(25), set(25), set(1)],
    message_texts: Array.from({ length: 400 }, () => new Uint8Array()),
  };
  const narcs: Partial<Record<NarcName, NarcStore>> = {};
  for (const [name, rawFiles] of Object.entries(files)) {
    narcs[name as NarcName] = { name: name as NarcName, fileId: 1, sourcePath: "test", fileCount: rawFiles!.length, rawFiles: rawFiles!, records: new Map(), dirty: new Set() };
  }
  const messageTexts: Array<Array<[string, string, number]>> = [];
  messageTexts[15] = Array.from({ length: 314 }, (_unused, id) => [`0_${id}`, id === 0 ? "Joshua" : id >= 306 ? "Ingo" : `T${id}`, 0]);
  messageTexts[376] = Array.from({ length: 942 }, (_unused, id) => [`0_${id}`, `Quote ${id}`, 0]);
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs,
    texts: { banks: { pokedex: ["None"], moves: ["None"], items: ["None"] }, messageTexts },
    formats: getNarcFormats("BW2"),
    trpokInfo: [],
  } as unknown as ProjectState;
}
