import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { PLEDGE_TUTOR_PICKER_OVERLAY_ID } from "../pokeweb/pledgeTutorPatch";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  B2_TUTOR_MOVE_TABLE_OFFSET,
  BW2_TUTOR_MOVE_OVERLAY_ID,
  BW2_TUTOR_MOVE_ROW_SIZE,
  BW2_TUTOR_MOVE_TABLE_LENGTH,
  W2_TUTOR_MOVE_TABLE_OFFSET,
  getPledgeTutorMoveRows,
  getTutorMoveCompatibilityGroups,
  getTutorMoveRows,
  tutorMoveTableOffset,
  updatePledgeTutorMove,
  updateTutorMoveField,
} from "../pokeweb/tutorMoveModel";

describe("tutorMoveModel", () => {
  it("parses and edits BW2 overlay 36 tutor move rows", () => {
    const project = makeProject();

    const driftveil = getTutorMoveRows(project).filter((row) => row.group === "driftveil");
    expect(driftveil[0]).toMatchObject({
      rowIndex: 13,
      offset: W2_TUTOR_MOVE_TABLE_OFFSET + 13 * BW2_TUTOR_MOVE_ROW_SIZE,
      moveId: 4,
      moveName: "Covet",
      shardCost: 2,
      displayIndex: 0,
    });

    updateTutorMoveField(project, 13, "move", "Skitter Smack");
    updateTutorMoveField(project, 13, "shardCost", "8");
    updateTutorMoveField(project, 13, "displayIndex", "9");

    const row = getTutorMoveRows(project)[13];
    expect(row).toMatchObject({ moveId: 19, moveName: "Skitter Smack", shardCost: 8, displayIndex: 9 });
    expect(project.narcs.tutor_moves?.dirty.has(0)).toBe(true);

    const table = project.narcs.tutor_moves?.rawFiles[0];
    if (!table) throw new Error("Missing tutor table");
    const offset = 13 * BW2_TUTOR_MOVE_ROW_SIZE;
    expect(readU32(table, offset)).toBe(19);
    expect(readU32(table, offset + 4)).toBe(8);
    expect(readU32(table, offset + 8)).toBe(9);

    const driftveilGroup = getTutorMoveCompatibilityGroups(project).find((group) => group.key === "driftveil");
    expect(driftveilGroup?.moves.find((move) => move.moveName === "Skitter Smack")).toEqual({
      moveName: "Skitter Smack",
      compatibilityIndex: 0,
    });
  });

  it.each([
    ["B2", B2_TUTOR_MOVE_TABLE_OFFSET],
    ["W2", W2_TUTOR_MOVE_TABLE_OFFSET],
  ] as const)("reads the %s tutor table from its version-specific offset", (baseVersion, expectedOffset) => {
    const project = makeProject(baseVersion);
    const firstRow = getTutorMoveRows(project)[0];

    expect(tutorMoveTableOffset(baseVersion)).toBe(expectedOffset);
    expect(firstRow).toMatchObject({
      offset: expectedOffset,
      moveId: 1,
      moveName: "Bind",
      shardCost: 2,
      displayIndex: 0,
    });
  });

  it("uses physical tutor rows as personal-data compatibility bits", () => {
    const project = makeProject();
    const humilau = getTutorMoveCompatibilityGroups(project).find((group) => group.key === "humilau");

    expect(humilau?.moves.find((move) => move.moveName === "Knock Off")).toEqual({
      moveName: "Knock Off",
      compatibilityIndex: 2,
    });
  });

  it("stages both overlays and keeps Pledge moves tied to their original compatibility bits", () => {
    const project = makeProject();
    const field = project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID]!;
    const picker = new Uint8Array(0x4100);
    seedStockPledgeTutor(field, picker);
    project.overlays[PLEDGE_TUTOR_PICKER_OVERLAY_ID] = picker;
    const names = project.texts.banks.moves!;
    names.push(...Array<string>(801 - names.length).fill(""));
    names[518] = "Water Pledge";
    names[519] = "Fire Pledge";
    names[520] = "Grass Pledge";
    names[800] = "Expanded Move";
    expect(getPledgeTutorMoveRows(project)?.map((row) => row.moveId)).toEqual([520, 519, 518]);
    updatePledgeTutorMove(project, 0, "Grass Pledge");
    expect(project.patches).toBeUndefined();

    updatePledgeTutorMove(project, 0, "800");
    updatePledgeTutorMove(project, 1, "Fire Punch");
    updatePledgeTutorMove(project, 2, "Bounce");
    expect(project.patches?.dirtyOverlayIds).toEqual([36, 165]);
    expect(getPledgeTutorMoveRows(project)?.map((row) => row.moveId)).toEqual([800, 16, 7]);
    const nextField = project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID]!;
    const nextPicker = project.overlays[PLEDGE_TUTOR_PICKER_OVERLAY_ID]!;
    expect(readU16(nextField, 0x2fbfe)).toBe(800);
    expect(readU16(nextField, 0x2fbf8)).toBe(16);
    expect(readU16(nextField, 0x2fbfc)).toBe(7);
    expect([0x40e8, 0x40ea, 0x40ec].map((offset) => readU16(nextPicker, offset))).toEqual([800, 16, 7]);
    expect(getTutorMoveCompatibilityGroups(project)[0].moves.slice(0, 3)).toEqual([
      { moveName: "Expanded Move", compatibilityIndex: 0 },
      { moveName: "Fire Punch", compatibilityIndex: 1 },
      { moveName: "Bounce", compatibilityIndex: 2 },
    ]);

    expect(() => updatePledgeTutorMove(project, 0, "None")).toThrow("Choose a move");
    nextPicker[0x40e8] ^= 1;
    expect(() => updatePledgeTutorMove(project, 0, "Bind")).toThrow("out of sync");
    expect(project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID]).toBe(nextField);
    expect(getTutorMoveRows(project)[0].moveName).toBe("Bind");
    nextPicker[0x40e8] ^= 1;

    updatePledgeTutorMove(project, 0, "Grass Pledge");
    updatePledgeTutorMove(project, 1, "Fire Pledge");
    updatePledgeTutorMove(project, 2, "Water Pledge");
    expect(Buffer.compare(project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID]!, field)).toBe(0);
    expect(Buffer.compare(project.overlays[PLEDGE_TUTOR_PICKER_OVERLAY_ID]!, picker)).toBe(0);
  });
});

function seedStockPledgeTutor(field: Uint8Array, picker: Uint8Array): void {
  const writeWords = (bytes: Uint8Array, offset: number, words: number[]) => {
    words.forEach((word, index) => writeU16(bytes, offset + index * 2, word));
  };
  writeWords(field, 0x2fb7e, [0xd01a, 0xe031]);
  writeWords(field, 0x2fbaa, [0xd01c]);
  writeWords(field, 0x2fbbe, [0xd002, 0x2082, 0x0080, 0xbd10]);
  writeWords(field, 0x2fbd2, [0x4809, 0xbd10]);
  writeWords(field, 0x2fbe0, [0xd001, 0x4806, 0xbd10, 0x4802, 0xbd10, 0x46c0]);
  writeWords(field, 0x2fbf8, [519, 0, 518, 0]);
  writeWords(picker, 0x40d4, [0x1e49, 0x4288, 0xd10a, 0x9801, 0x9003, 0x3884, 0x9003, 0x9801, 0x9002,
    0x3885, 0x9002, 0x9801, 0x3886, 0xe000, 0x9002, 0x9001, 0x2500]);
}

function makeProject(baseVersion: "B2" | "W2" = "W2"): ProjectState {
  const tableOffset = tutorMoveTableOffset(baseVersion);
  const overlay = new Uint8Array(B2_TUTOR_MOVE_TABLE_OFFSET + BW2_TUTOR_MOVE_TABLE_LENGTH + 0x10);
  writeTutorRow(overlay, tableOffset, 0, 1, 2, 0);
  writeTutorRow(overlay, tableOffset, 2, 3, 4, 3);
  if (baseVersion === "B2") writeTutorRow(overlay, W2_TUTOR_MOVE_TABLE_OFFSET, 0, 24, 404, 24);
  const driftveilMoves = [
    [4, 2, 0],
    [5, 2, 1],
    [6, 4, 2],
    [7, 4, 3],
    [8, 6, 4],
    [9, 6, 5],
    [10, 6, 6],
    [11, 8, 7],
    [12, 8, 8],
    [13, 10, 9],
    [14, 10, 10],
    [15, 10, 11],
    [16, 10, 12],
    [17, 10, 13],
    [18, 10, 14],
  ];
  driftveilMoves.forEach(([moveId, cost, displayIndex], index) => {
    writeTutorRow(overlay, tableOffset, 13 + index, moveId, cost, displayIndex);
  });

  return {
    session: {
      romName: "test",
      baseVersion,
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: overlay.length },
    arm9: new Uint8Array(),
    overlays: { [BW2_TUTOR_MOVE_OVERLAY_ID]: overlay },
    narcs: {
      moves: makeStore("moves", Array.from({ length: 20 }, () => new Uint8Array()), 20),
    },
    texts: {
      banks: {
        moves: [
          "None",
          "Bind",
          "Snore",
          "Knock Off",
          "Covet",
          "Bug Bite",
          "Drill Run",
          "Bounce",
          "Signal Beam",
          "Iron Head",
          "Super Fang",
          "Uproar",
          "Seed Bomb",
          "Dual Chop",
          "Low Kick",
          "Gunk Shot",
          "Fire Punch",
          "Thunder Punch",
          "Ice Punch",
          "Skitter Smack",
        ],
      },
    },
    formats: {},
    trpokInfo: [],
  };
}

function writeTutorRow(overlay: Uint8Array, tableOffset: number, rowIndex: number, moveId: number, shardCost: number, displayIndex: number): void {
  const offset = tableOffset + rowIndex * BW2_TUTOR_MOVE_ROW_SIZE;
  writeU32(overlay, offset, moveId);
  writeU32(overlay, offset + 4, shardCost);
  writeU32(overlay, offset + 8, displayIndex);
}

function makeStore(name: NarcName, rawFiles: Uint8Array[], count: number): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}
