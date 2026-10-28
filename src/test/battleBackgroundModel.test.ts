import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { classifyBattleBackgroundTextureNames, parseBattleBackgroundVariants } from "../pokeweb/battleBackgroundModel";

function nitro(stamp: string): Uint8Array {
  return new Uint8Array([...stamp].map((character) => character.charCodeAt(0)));
}

describe("battle background catalog", () => {
  it("reads four native halfword seasons and ignores the four special variant slots", () => {
    const table = new Uint8Array(64).fill(0xff);
    [74, 75, 74, 76, 77, 77, 77, 77].forEach((id, i) => writeU16(table, i * 2, id));
    const graphics = Array.from({ length: 78 }, () => nitro("BCA0"));
    for (const id of [74, 75, 76, 77]) graphics[id] = nitro("BMD0");
    for (const game of ["IRDO", "IREO"]) expect(parseBattleBackgroundVariants(table, graphics, game)).toEqual([
      { tableIndex: 0, seasonIndex: 0, seasonName: "Spring", resourceId: 74, variantCount: 3, shapeKind: "unknown" },
      { tableIndex: 0, seasonIndex: 1, seasonName: "Summer", resourceId: 75, variantCount: 3, shapeKind: "unknown" },
      { tableIndex: 0, seasonIndex: 3, seasonName: "Winter", resourceId: 76, variantCount: 3, shapeKind: "unknown" },
    ]);
  });

  it("does not resolve missing native seasons to graphics member zero", () => {
    const table = new Uint8Array(64).fill(0xff);
    expect(parseBattleBackgroundVariants(table, [nitro("BMD0")], "IRDO")).toEqual([]);
  });

  it("retains the existing BW1 packed-resource decoding", () => {
    const table = new Uint8Array(64).fill(0xff);
    writeU32(table, 0, (2 << 16) | 1);
    expect(parseBattleBackgroundVariants(table, [nitro("XXXX"), nitro("BMD0"), nitro("BMD0")], "IRAO")[0].resourceId).toBe(2);
  });

  it("classifies the canonical field material family separately from custom scene meshes", () => {
    expect(classifyBattleBackgroundTextureNames(["batt_field01", "batt_sky01"])).toBe("standard");
    expect(classifyBattleBackgroundTextureNames(["batt_fd_vs3", "demo_sinka01"])).toBe("standard");
    expect(classifyBattleBackgroundTextureNames(["city_ground", "city_road"])).toBe("non-standard");
    expect(classifyBattleBackgroundTextureNames([])).toBe("unknown");
  });

  it("rejects data that is not composed of complete 64-byte table records", () => {
    expect(parseBattleBackgroundVariants(new Uint8Array(63), [nitro("BMD0")], "IRDO")).toEqual([]);
  });
});
