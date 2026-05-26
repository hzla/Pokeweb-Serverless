import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import {
  copyMoveEffectHandlerAddress,
  formatAddress,
  getMoveEffectHandlerRows,
  updateMoveEffectHandlerAddress,
  updateMoveEffectHandlerMove,
  zeroMoveEffectHandlers,
} from "../pokeweb/moveEffectHandlerModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("moveEffectHandlerModel", () => {
  it("reads, edits, copies, zeros, and materializes handler addresses", () => {
    const project = makeProject();

    expect(getMoveEffectHandlerRows(project).slice(0, 3)).toMatchObject([
      { moveId: 1, moveName: "Tackle", addressHex: "0x12345678" },
      { moveId: 2, moveName: "Growl", addressHex: "0x00000009" },
      { moveId: 3, moveName: "Water Gun", addressHex: "0x00000010" },
    ]);

    updateMoveEffectHandlerMove(project, 2, "Ember");
    updateMoveEffectHandlerAddress(project, 0, "0xCAFEBABE");
    copyMoveEffectHandlerAddress(project, "Tackle", "Growl, Ember");

    let rows = getMoveEffectHandlerRows(project);
    expect(rows[1].addressHex).toBe("0xCAFEBABE");
    expect(rows[2]).toMatchObject({ moveId: 4, moveName: "Ember", address: 0xcafebabe });

    zeroMoveEffectHandlers(project, "Growl, Ember");
    rows = getMoveEffectHandlerRows(project);
    expect(rows[1].address).toBe(0);
    expect(rows[2].address).toBe(0);
    expect(project.narcs.move_effects_table?.dirty.has(0)).toBe(true);

    materializeProjectEdits(project);
    const bytes = project.narcs.move_effects_table?.rawFiles[0] ?? new Uint8Array();
    expect(readU32(bytes, 0)).toBe(1);
    expect(readU32(bytes, 4)).toBe(0xcafebabe);
    expect(readU32(bytes, 8)).toBe(2);
    expect(readU32(bytes, 12)).toBe(0);
    expect(formatAddress(16)).toBe("0x00000010");
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const table = new Uint8Array(258 * 8);
  writeEntry(table, 0, 1, 0x12345678);
  writeEntry(table, 1, 2, 9);
  writeEntry(table, 2, 3, 16);

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
    formats,
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

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  for (let n = 0; n < 4; n += 1) out[offset + n] = (value >>> (8 * n)) & 0xff;
}
