import { describe, expect, it } from "vitest";
import { readPk5Ability, writePk5Ability } from "../pokeweb/pk5AbilityPacking";

describe("expanded PK5 ability packing", () => {
  it("preserves every unrelated flag combination and clears old high bits", () => {
    for (let flags = 0; flags < 256; flags++) {
      const data = new Uint8Array(136);
      data[0x42] = flags;
      for (const ability of [1, 255, 256, 511, 512, 1023, 2]) {
        writePk5Ability(data, ability);
        expect(readPk5Ability(data)).toBe(ability);
        expect(data[0x42] & 0x3f).toBe(flags & 0x3f);
      }
    }
  });
  it("rejects out-of-range abilities and truncated records", () => {
    for (const ability of [0, -1, 1024, 1.5, NaN])
      expect(() => writePk5Ability(new Uint8Array(136), ability)).toThrow(/abilityId/);
    expect(() => readPk5Ability(new Uint8Array(0x42))).toThrow(/Truncated/);
    expect(() => writePk5Ability(new Uint8Array(0x42), 1)).toThrow(/Truncated/);
  });
});
