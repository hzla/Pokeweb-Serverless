import { describe, expect, it } from "vitest";
import { canUndoActionChange, undoActionChange } from "../pokeweb/actionUndo";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import { updateMoveEffectHandlerAddress, updateMoveEffectHandlerMove, getMoveEffectHandlerRows } from "../pokeweb/moveEffectHandlerModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("actionUndo", () => {
  it("undoes field changelog entries and removes them when restored", () => {
    const project = makeProject();

    updateMoveEffectHandlerAddress(project, 0, "0xCAFEBABE");
    updateMoveEffectHandlerMove(project, 1, "Ember");

    const addressEntry = project.actionChangelog?.entries.find((entry) => entry.key === "move-effect-handler:0:address");
    const moveEntry = project.actionChangelog?.entries.find((entry) => entry.key === "move-effect-handler:1:move");
    expect(addressEntry && canUndoActionChange(addressEntry)).toBe(true);
    expect(moveEntry && canUndoActionChange(moveEntry)).toBe(true);

    undoActionChange(project, addressEntry!);
    undoActionChange(project, moveEntry!);

    const rows = getMoveEffectHandlerRows(project);
    expect(rows[0].addressHex).toBe("0x12345678");
    expect(rows[1].moveName).toBe("Growl");
    expect(project.actionChangelog?.entries.some((entry) => entry.key === "move-effect-handler:0:address")).toBe(false);
    expect(project.actionChangelog?.entries.some((entry) => entry.key === "move-effect-handler:1:move")).toBe(false);
  });
});

function makeProject(): ProjectState {
  const table = new Uint8Array(258 * 8);
  writeEntry(table, 0, 1, 0x12345678);
  writeEntry(table, 1, 2, 9);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { move_effects_table: -1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: table.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      move_effects_table: makeStore("move_effects_table", table),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        moves: ["None", "Tackle", "Growl", "Water Gun", "Ember"],
      },
    },
    formats: getNarcFormats("BW2"),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, data: Uint8Array): NarcStore {
  return {
    name,
    fileId: -1,
    sourcePath: "overlay167:move_effects_table",
    fileCount: 1,
    rawFiles: [data],
    records: new Map(),
    dirty: new Set(),
  };
}

function writeEntry(out: Uint8Array, index: number, moveId: number, address: number): void {
  const offset = index * 8;
  writeU32(out, offset, moveId);
  writeU32(out, offset + 4, address);
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  for (let n = 0; n < 4; n += 1) out[offset + n] = (value >>> (8 * n)) & 0xff;
}
