import { describe, expect, it } from "vitest";
import { readU16, writeU16 } from "../nds/binary";
import { detectStartersFromScriptBytes, patchStarterScriptBytes } from "../pokeweb/starterModel";

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
