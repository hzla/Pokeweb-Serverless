import { describe, expect, it } from "vitest";
import { battleTypeHudPanelExpansion as changes, transformBattleTypeHudPanel } from "../pokeweb/battleTypeHudResources";
import { readU32 } from "../nds/binary";

describe("Type Icons player sprite expansion", () => {
  it.each(["438", "439"] as const)("expands and restores %s without changing any existing pixels or drawing pieces", member => {
    const original = new Uint8Array(member === "438" ? 2096 : 103);
    // Synthetic art, with the verified native header fields at each edit.
    original.fill(0x55);
    for (const edit of changes[member].edits) original.set(Uint8Array.from(edit.old.match(/../gu) ?? [], hex => Number.parseInt(hex, 16)), edit.offset);
    const expanded = transformBattleTypeHudPanel(original, member);
    expect(expanded.length).toBe(original.length + (member === "438" ? 256 : 8));
    expect(readU32(expanded, 8)).toBe(expanded.length);
    if (member === "438") {
      expect(expanded.slice(48, 2096)).toEqual(original.slice(48));
      expect(expanded.slice(2096)).toEqual(new Uint8Array(256));
      expect(readU32(expanded, 40)).toBe(2304);
    } else {
      expect(expanded.slice(0x38, 0x44)).toEqual(original.slice(0x38, 0x44));
      expect(expanded.slice(0x44, 0x4c)).toEqual(new Uint8Array([0xf4, 0x40, 0xbc, 0x81, 32, 0, 0, 0]));
      expect(expanded.slice(0x4c)).toEqual(original.slice(0x44));
    }
    expect(transformBattleTypeHudPanel(expanded, member, true)).toEqual(original);
    expanded[8] ^= 1;
    expect(() => transformBattleTypeHudPanel(expanded, member, true)).toThrow(/layout mismatch/);
  });
  it("upgrades the previous cell position reversibly and leaves the input intact", () => {
    const original = new Uint8Array(103).fill(0x55);
    for (const edit of changes["439"].edits) original.set(Buffer.from(edit.old, "hex"), edit.offset);
    const current = transformBattleTypeHudPanel(original, "439");
    const previous = current.slice(); previous[0x46] = 0xb0;
    expect(transformBattleTypeHudPanel(previous, "439")).toEqual(current);
    expect(previous[0x46]).toBe(0xb0);
    expect(transformBattleTypeHudPanel(previous, "439", true)).toEqual(original);
    expect(transformBattleTypeHudPanel(current, "439")).toEqual(current);
    previous[0x46] = 0xbd;
    expect(() => transformBattleTypeHudPanel(previous, "439")).toThrow(/layout mismatch/);
  });

});
