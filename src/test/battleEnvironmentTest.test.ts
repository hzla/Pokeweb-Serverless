import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { pinBattleEnvironmentTable } from "../pokeweb/battleEnvironmentTest";

function fixture() {
  const graphics = Array.from({ length: 40 }, (_, i) => new TextEncoder().encode(i < 16 ? "BMD0" : i < 24 ? "BCA0" : i < 32 ? "BTA0" : "BMA0"));
  const zones = new Uint8Array(88).fill(3); zones[0] = 1; zones[1] = 0; zones[44] = 0; zones[45] = 1;
  const backgrounds = new Uint8Array(128), platforms = new Uint8Array(132);
  for (let row = 0; row < 2; row++) for (let kind = 0; kind < 4; kind++) for (let season = 0; season < 4; season++) {
    const id = kind === 0 ? row * 4 + season : 16 + (kind - 1) * 8 + row * 4 + season;
    writeU16(backgrounds, row * 64 + kind * 16 + season * 2, id);
    writeU32(platforms, row * 66 + 2 + kind * 16 + season * 4, id | (id << 16));
  }
  platforms[66] = 0x55; platforms[67] = 0x33;
  const table = new NARC(); table.files = [zones, backgrounds, platforms];
  return { table, graphics };
}

describe("battle environment test ROM selection", () => {
  const selection = { trainerId: 123, backgroundIndex: 1, backgroundSeasonIndex: 2, platformIndex: 1, platformSeasonIndex: 3 };
  it("pins every type and terrain, including trainer overrides, without modifying source data", () => {
    const { table, graphics } = fixture(), before = table.save();
    const result = pinBattleEnvironmentTable(table, "IRDO", graphics, selection);
    expect(table.save()).toEqual(before);
    for (const at of [0, 44]) {
      expect(result.files[0].subarray(at, at + 2)).toEqual(table.files[0].subarray(at, at + 2));
      expect(Array.from(result.files[0].subarray(at + 2, at + 42))).toEqual(Array(40).fill(1));
      expect(result.files[0].subarray(at + 42, at + 44)).toEqual(table.files[0].subarray(at + 42, at + 44));
    }
    for (let kind = 0; kind < 4; kind++) for (let season = 0; season < 4; season++) {
      expect(readU16(result.files[1], 64 + kind * 16 + season * 2)).toBe(readU16(table.files[1], 64 + kind * 16 + 4));
      expect(result.files[2].subarray(68 + kind * 16 + season * 4, 72 + kind * 16 + season * 4)).toEqual(table.files[2].subarray(68 + kind * 16 + 12, 72 + kind * 16 + 12));
    }
    expect(result.files[2].subarray(66, 68)).toEqual(table.files[2].subarray(66, 68)); // Edge color.
    expect(result.files[1].subarray(0, 64)).toEqual(table.files[1].subarray(0, 64));
  });
  it("preserves automatic platforms, including their seasonal resources", () => {
    const { table, graphics } = fixture();
    const result = pinBattleEnvironmentTable(table, "IRDO", graphics, { ...selection, platformIndex: undefined });
    expect(result.files[2]).toEqual(table.files[2]);
    for (const at of [0, 44]) expect(result.files[0].subarray(at + 22, at + 42)).toEqual(table.files[0].subarray(at + 22, at + 42));
  });
  it("pins complete spring resources when a missing seasonal model has no independent variant", () => {
    const { table, graphics } = fixture();
    writeU32(table.files[2], 68 + 12, 0xffffffff);
    const result = pinBattleEnvironmentTable(table, "IRDO", graphics, { ...selection, platformSeasonIndex: 0 });
    for (let kind = 0; kind < 4; kind++) for (let season = 0; season < 4; season++)
      expect(result.files[2].subarray(68 + kind * 16 + season * 4, 72 + kind * 16 + season * 4)).toEqual(table.files[2].subarray(68 + kind * 16, 72 + kind * 16));
    expect(() => pinBattleEnvironmentTable(table, "IRDO", graphics, selection)).toThrow(/platform/);
  });
  it("rejects missing variants and malformed tables instead of falling back to another environment", () => {
    const { table, graphics } = fixture();
    expect(() => pinBattleEnvironmentTable(table, "IRDO", graphics, { ...selection, backgroundIndex: 999 })).toThrow(/background/);
    expect(() => pinBattleEnvironmentTable(table, "IRDO", graphics, { ...selection, platformSeasonIndex: 9 })).toThrow(/platform/);
    table.files[0] = new Uint8Array(37);
    expect(() => pinBattleEnvironmentTable(table, "IRDO", graphics, selection)).toThrow(/Malformed/);
  });
});
