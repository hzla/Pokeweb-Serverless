import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { detectStartersFromScriptBytes, getStarterEditorState, patchStarterScriptBytes } from "../pokeweb/starterModel";

describe("starterModel script patching", () => {
  it("patches starter species through the variable used by PokePartyAdd", () => {
    const script = makeVariableGiftScript([495, 498, 501]);

    const result = patchStarterScriptBytes(script, [495, 498, 501], [1, 4, 7]);

    expect(result.giftCommandCount).toBe(1);
    expect(result.directGiftUpdates).toBe(0);
    expect(result.variableGiftUpdates).toBe(3);
    expect(result.wordSpeciesUpdates).toBe(3);
    expect(readU16(result.bytes, 4)).toBe(1);
    expect(readU16(result.bytes, 15)).toBe(4);
    expect(readU16(result.bytes, 26)).toBe(7);
    expect(readU16(result.bytes, 37)).toBe(0x8025);
  });

  it("detects starter order from WorkSetConst commands feeding PokePartyAdd", () => {
    const script = makeVariableGiftScript([152, 155, 158]);

    expect(detectStartersFromScriptBytes(script)).toEqual([152, 155, 158]);
  });

  it("ignores assignments from other pointer-table entries", () => {
    const script = makePointerTableGiftScript([50, 47, 442], [498, 495, 501]);

    expect(detectStartersFromScriptBytes(script, "BW2")).toEqual([495, 498, 501]);
  });

  it("uses the loaded starter overlay as the authoritative displayed order", () => {
    const project = makeProject(makeVariableGiftScript([50, 47, 442]), [495, 498, 501]);

    expect(getStarterEditorState(project).slots.map((slot) => slot.speciesId)).toEqual([495, 498, 501]);
  });
});

function makeVariableGiftScript(speciesIds: number[]): Uint8Array {
  const bytes = new Uint8Array(43);
  let offset = 0;
  for (const speciesId of speciesIds) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
    writeU16(bytes, offset, 0x57);
    bytes[offset + 2] = 1;
    writeU16(bytes, offset + 3, speciesId);
    offset += 5;
  }
  writeU16(bytes, offset, 0x10c);
  writeU16(bytes, offset + 2, 0x8010);
  writeU16(bytes, offset + 4, 0x8025);
  writeU16(bytes, offset + 6, 0);
  writeU16(bytes, offset + 8, 5);
  return bytes;
}

function makePointerTableGiftScript(unrelated: number[], starters: number[]): Uint8Array {
  const firstEntry = 10;
  const secondEntry = firstEntry + unrelated.length * 6;
  const bytes = new Uint8Array(secondEntry + starters.length * 6 + 10);
  writeU32(bytes, 0, firstEntry - 4);
  writeU32(bytes, 4, secondEntry - 8);
  writeU16(bytes, 8, 0xfd13);
  let offset = firstEntry;
  for (const speciesId of unrelated) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
  }
  for (const speciesId of starters) {
    writeU16(bytes, offset, 0x28);
    writeU16(bytes, offset + 2, 0x8025);
    writeU16(bytes, offset + 4, speciesId);
    offset += 6;
  }
  writeU16(bytes, offset, 0x10c);
  writeU16(bytes, offset + 2, 0x8010);
  writeU16(bytes, offset + 4, 0x8025);
  writeU16(bytes, offset + 6, 0);
  writeU16(bytes, offset + 8, 5);
  return bytes;
}

function makeProject(script: Uint8Array, overlaySpecies: number[]): ProjectState {
  const overlay = new Uint8Array(0x2c1a);
  overlaySpecies.forEach((speciesId, index) => writeU16(overlay, 0x2c14 + index * 2, speciesId));
  return {
    session: { romName: "starter-test", generation: "gen5", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: { 316: overlay },
    narcs: {
      personal: makeStore("personal", Array.from({ length: 650 }, () => new Uint8Array(76))),
      scripts: makeStore("scripts", Array.from({ length: 855 }, (_unused, fileId) => fileId === 854 ? script : new Uint8Array())),
    },
    texts: { banks: { pokedex: Array.from({ length: 650 }, (_unused, id) => `Pokemon ${id}`) } },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return { name, sourcePath: "test", fileId: 1, fileCount: rawFiles.length, rawFiles, records: new Map(), dirty: new Set() };
}
