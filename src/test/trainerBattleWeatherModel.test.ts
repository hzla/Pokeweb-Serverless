import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { fieldBattleWeather, parseTrainerBattleWeather } from "../pokeweb/trainerBattleWeatherModel";

function script(words: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + words.length * 2);
  writeU32(bytes, 0, 2);
  [0xfd13, ...words, 0x02].forEach((word, i) => writeU16(bytes, 4 + i * 2, word));
  return bytes;
}

describe("trainer battle weather", () => {
  it("uses battle effects rather than the names of visual weather effects", () => {
    expect([2, 6].map(fieldBattleWeather)).toEqual(["Rain", "Rain"]);
    expect([3, 12].map(fieldBattleWeather)).toEqual(["Sand", "Sand"]);
    expect([4, 5].map(fieldBattleWeather)).toEqual(["Hail", "Hail"]);
    expect([0, 1, 7, 8, 9].map(fieldBattleWeather)).toEqual(Array(5).fill("Clear"));
    expect(fieldBattleWeather(15)).toBeUndefined();
  });

  it("captures the last weather before each battle and ignores later changes", () => {
    const result = parseTrainerBattleWeather(script([0x136, 2, 3, 0x85, 7, 0, 0, 0x136, 3, 3, 0x85, 8, 0, 0]), ["Clear"]);
    expect([...result.get(7)!]).toEqual(["Rain"]);
    expect([...result.get(8)!]).toEqual(["Sand"]);
  });

  it("carries weather set by a returning local helper into its caller", () => {
    const bytes = script([0x04, 0, 0, 0x85, 7, 0, 0, 0x02, 0x136, 2, 3, 0x05]);
    writeU32(bytes, 8, 10); // Call at 6 returns to 12; helper starts at 22.
    expect([...parseTrainerBattleWeather(bytes, ["Clear"]).get(7)!]).toEqual(["Rain"]);
  });

  it("carries weather through a returning global script", () => {
    const helper = script([0x136, 3, 3, 0x1d]);
    const bytes = script([0x1c, 10500, 0x85, 7, 0, 0]);
    const result = parseTrainerBattleWeather(bytes, ["Clear"], { globalScript: id => id === 10500 ? { bytes: helper, entryIndex: 0 } : undefined });
    expect([...result.get(7)!]).toEqual(["Sand"]);
  });

  it("preserves seasonal uncertainty unless the script overrides it", () => {
    const battle = script([0x85, 7, 0, 0]);
    expect(parseTrainerBattleWeather(battle, ["Rain", "Clear"]).get(7)).toEqual(new Set(["Rain", "Clear"]));
    const forced = script([0x136, 3, 3, 0x85, 7, 0, 0]);
    expect(parseTrainerBattleWeather(forced, ["Rain", "Clear"]).get(7)).toEqual(new Set(["Sand"]));
  });

  it("keeps weather separate for normal and Challenge Mode trainer records", () => {
    const bytes = new Uint8Array(39);
    writeU32(bytes, 0, 2); writeU16(bytes, 4, 0xfd13);
    writeU16(bytes, 6, 0x1f); bytes[8] = 1; writeU32(bytes, 9, 10);
    [0x85, 7, 0, 0, 0x02, 0x136, 2, 3, 0x85, 8, 0, 0, 0x02].forEach((word, i) => writeU16(bytes, 13 + i * 2, word));
    const result = parseTrainerBattleWeather(bytes, ["Clear"]);
    expect(result.get(7)).toEqual(new Set(["Clear"]));
    expect(result.get(8)).toEqual(new Set(["Rain"]));
  });

  it("marks one record with different reachable weather as ambiguous", () => {
    const bytes = new Uint8Array(29);
    writeU32(bytes, 0, 2); writeU16(bytes, 4, 0xfd13);
    writeU16(bytes, 6, 0x1f); bytes[8] = 1; writeU32(bytes, 9, 6);
    [0x136, 2, 3, 0x85, 7, 0, 0, 0x02].forEach((word, i) => writeU16(bytes, 13 + i * 2, word));
    expect(parseTrainerBattleWeather(bytes, ["Clear"]).get(7)).toEqual(new Set(["Clear", "Rain"]));
  });

  it("does not guess a weather selected by an unresolved work variable", () => {
    const bytes = script([0x136, 0x8000, 3, 0x85, 7, 0, 0]);
    expect(parseTrainerBattleWeather(bytes, ["Rain"]).get(7)).toEqual(new Set([undefined]));
  });

  it("does not read weather setters inside operands or unreachable bytes", () => {
    const bytes = script([0x02, 0x136, 2, 3, 0x85, 7, 0, 0]);
    expect(parseTrainerBattleWeather(bytes, ["Clear"]).size).toBe(0);
  });
});
