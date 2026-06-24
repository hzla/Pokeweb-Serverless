import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { expandTrainerScriptArchive, getTrainerScriptArchiveStatus } from "../pokeweb/trainerScriptArchiveModel";

const TRAINER_SCRIPT_FILE_ID = 1239;
const EVENT_DATA_END_CODE = 0xfd13;

describe("trainerScriptArchiveModel", () => {
  it("reports a trainer script table that already covers current trainers", () => {
    const project = makeProject(20, makeTrainerScriptArchive(20, 2));

    const status = getTrainerScriptArchiveStatus(project);

    expect(status).toMatchObject({
      ok: true,
      scriptFileId: TRAINER_SCRIPT_FILE_ID,
      trainerCount: 20,
      tableEntryCount: 22,
      normalEntryCount: 20,
      needsExpansion: false,
      helperTrainerIds: [],
    });
  });

  it("expands missing trainer entries without moving helper script IDs", () => {
    const source = makeTrainerScriptArchive(20, 2);
    const sourceStarts = scriptStarts(source);
    const project = makeProject(25, source);

    const result = expandTrainerScriptArchive(project);
    const expanded = project.narcs.scripts!.rawFiles[TRAINER_SCRIPT_FILE_ID];
    const expandedStarts = scriptStarts(expanded);

    expect(result.addedEntries).toBe(3);
    expect(result.tableEntryCount).toBe(25);
    expect(result.helperTrainerIds).toEqual([20, 21]);
    expect(result.missingTrainerIds).toEqual([]);
    expect(project.narcs.scripts!.dirty.has(TRAINER_SCRIPT_FILE_ID)).toBe(true);
    expect(expanded.length).toBe(source.length + 12);

    const normalStart = expandedStarts[0];
    expect(expandedStarts.slice(0, 20).every((start) => start === normalStart)).toBe(true);
    expect(expandedStarts[20]).toBe(sourceStarts[20] + 12);
    expect(expandedStarts[21]).toBe(sourceStarts[21] + 12);
    expect(expandedStarts.slice(22, 25)).toEqual([normalStart, normalStart, normalStart]);
    expect(readU16(expanded, 25 * 4)).toBe(EVENT_DATA_END_CODE);
  });

  it("surfaces trainer IDs that collide with preserved helper slots", () => {
    const project = makeProject(21, makeTrainerScriptArchive(20, 2));

    const status = getTrainerScriptArchiveStatus(project);
    const result = expandTrainerScriptArchive(project);

    expect(status).toMatchObject({
      ok: true,
      needsExpansion: false,
      canExpand: false,
      helperTrainerIds: [20],
    });
    expect(result.addedEntries).toBe(0);
    expect(project.narcs.scripts!.dirty.size).toBe(0);
  });
});

function makeProject(trainerCount: number, trainerScriptBytes: Uint8Array): ProjectState {
  const scripts: Uint8Array[] = Array.from({ length: TRAINER_SCRIPT_FILE_ID + 1 }, () => new Uint8Array());
  scripts[TRAINER_SCRIPT_FILE_ID] = trainerScriptBytes;
  const trdataFiles = Array.from({ length: trainerCount }, () => new Uint8Array([0]));
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      scripts: makeStore("scripts", scripts),
      trdata: makeStore("trdata", trdataFiles),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    container: "narc",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeTrainerScriptArchive(normalEntries: number, helperEntries: number): Uint8Array {
  const entryCount = normalEntries + helperEntries;
  const tableEndOffset = entryCount * 4;
  const codeStart = tableEndOffset + 2;
  const out = new Uint8Array(codeStart + helperEntries * 8 + 16);
  const normalStart = codeStart;

  for (let index = 0; index < normalEntries; index += 1) writeEventPointer(out, index * 4, normalStart);
  for (let index = 0; index < helperEntries; index += 1) {
    writeEventPointer(out, (normalEntries + index) * 4, normalStart + 8 * (index + 1));
  }
  writeU16(out, tableEndOffset, EVENT_DATA_END_CODE);
  for (let index = codeStart; index < out.length; index += 1) out[index] = index & 0xff;
  return out;
}

function scriptStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && readU16(bytes, offset) !== EVENT_DATA_END_CODE) {
    starts.push(offset + readU32(bytes, offset) + 4);
    offset += 4;
  }
  return starts;
}

function writeEventPointer(out: Uint8Array, pointerOffset: number, targetOffset: number): void {
  writeU32(out, pointerOffset, (targetOffset - pointerOffset - 4) >>> 0);
}
