import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { getNarcFormats } from "../pokeweb/formats";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  battleClassForObjCode,
  copyPwtSetForTrainer,
  createPwtTeam,
  getPwtSetUsers,
  getPwtTeam,
  getPwtTrainer,
  getTournamentTrainers,
  setPwtTeamLead,
  setPwtTeamSets,
  updatePwtTrainerField,
  usesPlayerBattleClass,
  TYPE_ANY,
} from "../pokeweb/pwtModel";

describe("pwtModel", () => {
  it("reads trainer rows, names and tournament membership", () => {
    const project = makeProject();
    const cheren = getPwtTrainer(project, 0);
    expect(cheren).toMatchObject({ name: "Cheren", type: 0, trainerClass: 0x73, exclusive: 5, expertType: 0, hasLead: true });
    // Byte 5 = 0x7e: Driftveil, World Leaders, Rental, Mix, Rental Master, Mix Master (not the first-visit Driftveil).
    expect(cheren.tournaments).toEqual(expect.arrayContaining([4, 10, 12, 14, 13, 15, 5, 2]));
    expect(cheren.tournaments).not.toContain(11);
    expect(getPwtTrainer(project, 2).tournaments).toEqual([]);

    expect(getTournamentTrainers(project, 5).map((trainer) => trainer.name)).toEqual(["Cheren"]);
    expect(getTournamentTrainers(project, 2, 0).map((trainer) => trainer.name)).toEqual(["Cheren", "Roxie"]);
    expect(getTournamentTrainers(project, 2, 3).map((trainer) => trainer.name)).toEqual(["Roxie"]);
  });

  it("reads a trainer's team from file row + 1 of its pool", () => {
    const project = makeProject();
    expect(getPwtTeam(project, "leaders", 0)).toMatchObject({ exists: true, setIds: [1, 2], leadSetId: 1 });
    expect(getPwtTeam(project, "leaders", 5)).toMatchObject({ exists: false, setIds: [] });
  });

  it("edits membership, rank and the lead flag in the trainer row", () => {
    const project = makeProject();
    updatePwtTrainerField(project, 2, "tournament_10", true);
    updatePwtTrainerField(project, 2, "tournament_6", true);
    updatePwtTrainerField(project, 0, "tournament_5", false);
    updatePwtTrainerField(project, 0, "tournament_2", false);
    updatePwtTrainerField(project, 1, "rank", 5);
    updatePwtTrainerField(project, 1, "hasLead", false);
    expect(getPwtTrainer(project, 2).tournaments).toEqual(expect.arrayContaining([10, 6]));
    expect(getPwtTrainer(project, 0).tournaments).not.toContain(5);
    expect(getPwtTrainer(project, 0).tournaments).not.toContain(2);
    expect(getPwtTrainer(project, 1)).toMatchObject({ rank: 5, hasLead: false });
    expect(project.narcs.pwt_trainer_table?.dirty.has(0)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.key === "pwt-trainer:2:tournament_10")).toBe(true);
  });

  it("finds trainers sharing a set and gives one trainer its own copy", () => {
    const project = makeProject();
    expect(getPwtSetUsers(project, "leaders", 2).map((user) => user.name)).toEqual(["Cheren", "Roxie"]);

    const copyId = copyPwtSetForTrainer(project, "leaders", 0, 1);
    expect(copyId).toBe(4);
    expect(getPwtTeam(project, "leaders", 0)).toMatchObject({ setIds: [4, 2], leadSetId: 4 });
    expect(project.narcs.pwt_sets_3?.rawFiles[4]).toEqual(project.narcs.pwt_sets_3?.rawFiles[1]);
    expect(getPwtSetUsers(project, "leaders", 1).map((user) => user.name)).toEqual([]);
  });

  it("edits a roster, its lead, and creates a team from another pool", () => {
    const project = makeProject();
    setPwtTeamSets(project, "leaders", 0, [2, 3]);
    // The lead was dropped from the roster, so it follows the new first set.
    expect(getPwtTeam(project, "leaders", 0)).toMatchObject({ setIds: [2, 3], leadSetId: 2 });
    setPwtTeamLead(project, "leaders", 0, 3);
    expect(getPwtTeam(project, "leaders", 0).leadSetId).toBe(3);
    expect(() => setPwtTeamSets(project, "leaders", 0, [99])).toThrow(/not in the Leaders pool/u);

    const team = createPwtTeam(project, "masters", 1, "leaders");
    expect(team.exists).toBe(true);
    expect(team.setIds).toHaveLength(2);
    // Roxie's file is row 1 + 1; the archive grew to reach it.
    expect(project.narcs.pwt_tr6?.rawFiles.length).toBe(3);
    expect(project.narcs.pwt_sets_6?.rawFiles.length).toBe(1 + 2);
  });
});

describe("pwt battle classes", () => {
  it("flags player-class trainers and maps overworld models back to battle classes", () => {
    expect(usesPlayerBattleClass({ trainerClass: 0 })).toBe(true);
    expect(usesPlayerBattleClass({ trainerClass: 0x73 })).toBe(false);
    expect(battleClassForObjCode(11)).toBe(2); // Ted's model -> Youngster
    expect(battleClassForObjCode(15)).toBe(3); // Lass
    expect(battleClassForObjCode(0xdf)).toBeUndefined();
  });
});

function row(values: { type: number; gender: number; obj: number; cls: number; flags: number; exclusive: number; expert: number; rank: number; lead: number }): number[] {
  const out = new Uint8Array(16);
  out[0] = values.type;
  out[1] = values.gender;
  writeU16(out, 2, values.obj);
  out[4] = values.cls;
  out[5] = values.flags;
  out[6] = values.exclusive;
  out[7] = values.expert;
  out[8] = values.rank;
  writeU16(out, 10, 1132);
  writeU16(out, 12, 1263);
  writeU16(out, 14, values.lead);
  return [...out];
}

function list(header: number, ids: number[]): Uint8Array {
  const out = new Uint8Array(4 + ids.length * 2);
  writeU16(out, 0, header);
  writeU16(out, 2, ids.length);
  ids.forEach((id, index) => writeU16(out, 4 + index * 2, id));
  return out;
}

function set(species: number): Uint8Array {
  const out = new Uint8Array(16);
  writeU16(out, 0, species);
  return out;
}

function makeProject(): ProjectState {
  const table = Uint8Array.from([
    ...row({ type: 0, gender: 0, obj: 0xdf, cls: 0x73, flags: 0x7e, exclusive: 5, expert: 0, rank: 3, lead: 1 }),
    ...row({ type: 3, gender: 1, obj: 0xe0, cls: 0x74, flags: 0, exclusive: 0, expert: TYPE_ANY, rank: 3, lead: 1 }),
    ...row({ type: 6, gender: 0, obj: 0xe1, cls: 0x75, flags: 0, exclusive: 0, expert: 0xff, rank: 1, lead: 0 }),
  ]);
  const files: Partial<Record<NarcName, Uint8Array[]>> = {
    pwt_trainer_table: [table],
    pwt_map_1: [list(0, [0]), list(2, [1]), list(2, [3])],
    pwt_map_2: [list(0, [0]), list(2, [1, 2]), list(2, [2, 3])],
    pwt_sets_3: [set(0), set(508), set(506), set(573)],
    pwt_tr1: [list(0, [0])],
    pwt_tr6: [list(0, [0])],
    pwt_sets_6: [set(0)],
  };
  const narcs: Partial<Record<NarcName, NarcStore>> = {};
  for (const [name, rawFiles] of Object.entries(files)) {
    narcs[name as NarcName] = { name: name as NarcName, fileId: 1, sourcePath: "test", fileCount: rawFiles!.length, rawFiles: rawFiles!, records: new Map(), dirty: new Set() };
  }
  const messageTexts: Array<Array<[string, string, number]>> = [];
  messageTexts[409] = [["0", "Cheren", 0], ["1", "Roxie", 0], ["2", "Burgh", 0]];
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
