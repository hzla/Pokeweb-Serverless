import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  BW2_TUTOR_MOVE_OVERLAY_ID,
  BW2_TUTOR_MOVE_ROW_SIZE,
  BW2_TUTOR_MOVE_TABLE_LENGTH,
  BW2_TUTOR_MOVE_TABLE_OFFSET,
  getTutorMoveCompatibilityGroups,
  getTutorMoveRows,
  updateTutorMoveField,
} from "../pokeweb/tutorMoveModel";

describe("tutorMoveModel", () => {
  it("parses and edits BW2 overlay 36 tutor move rows", () => {
    const project = makeProject();

    const driftveil = getTutorMoveRows(project).filter((row) => row.group === "driftveil");
    expect(driftveil[0]).toMatchObject({
      rowIndex: 13,
      offset: BW2_TUTOR_MOVE_TABLE_OFFSET + 13 * BW2_TUTOR_MOVE_ROW_SIZE,
      moveId: 4,
      moveName: "Covet",
      shardCost: 2,
      compatibilityIndex: 0,
    });

    updateTutorMoveField(project, 13, "move", "Skitter Smack");
    updateTutorMoveField(project, 13, "shardCost", "8");
    updateTutorMoveField(project, 13, "compatibilityIndex", "9");

    const row = getTutorMoveRows(project)[13];
    expect(row).toMatchObject({ moveId: 19, moveName: "Skitter Smack", shardCost: 8, compatibilityIndex: 9 });
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
      compatibilityIndex: 9,
    });
  });
});

function makeProject(): ProjectState {
  const overlay = new Uint8Array(BW2_TUTOR_MOVE_TABLE_OFFSET + BW2_TUTOR_MOVE_TABLE_LENGTH + 0x10);
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
  driftveilMoves.forEach(([moveId, cost, compatibilityIndex], index) => {
    writeTutorRow(overlay, 13 + index, moveId, cost, compatibilityIndex);
  });

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
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

function writeTutorRow(overlay: Uint8Array, rowIndex: number, moveId: number, shardCost: number, compatibilityIndex: number): void {
  const offset = BW2_TUTOR_MOVE_TABLE_OFFSET + rowIndex * BW2_TUTOR_MOVE_ROW_SIZE;
  writeU32(overlay, offset, moveId);
  writeU32(overlay, offset + 4, shardCost);
  writeU32(overlay, offset + 8, compatibilityIndex);
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
