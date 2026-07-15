import { describe, expect, it } from "vitest";
import { writeU32 } from "../nds/binary";
import { classifyBattleBackgroundTextureNames, parseBattleBackgroundVariants } from "../pokeweb/battleBackgroundModel";

function nitro(stamp: string): Uint8Array {
  return new Uint8Array([...stamp].map((character) => character.charCodeAt(0)));
}

describe("battle background catalog", () => {
  it("resolves White 2's packed resource IDs and deduplicates repeated seasonal models", () => {
    const table = new Uint8Array(64);
    table.fill(0xff);
    writeU32(table, 0, (75 << 16) | 74);
    writeU32(table, 4, (75 << 16) | 74);
    writeU32(table, 8, 0xffff0000 | 76);
    const graphics = Array.from({ length: 77 }, () => nitro("BCA0"));
    graphics[74] = nitro("BMD0");
    graphics[75] = nitro("BMD0");
    graphics[76] = nitro("BMD0");

    expect(parseBattleBackgroundVariants(table, graphics, "IRDO")).toEqual([
      { tableIndex: 0, seasonIndex: 0, seasonName: "Spring", resourceId: 75, variantCount: 2, shapeKind: "unknown" },
      { tableIndex: 0, seasonIndex: 2, seasonName: "Autumn", resourceId: 76, variantCount: 2, shapeKind: "unknown" },
    ]);
  });

  it("chooses the low half of paired model IDs for Black 2", () => {
    const table = new Uint8Array(64);
    table.fill(0xff);
    writeU32(table, 0, (75 << 16) | 74);
    const graphics = Array.from({ length: 76 }, () => nitro("BCA0"));
    graphics[74] = nitro("BMD0");
    graphics[75] = nitro("BMD0");

    expect(parseBattleBackgroundVariants(table, graphics, "IREO")).toEqual([
      { tableIndex: 0, seasonIndex: 0, seasonName: "Spring", resourceId: 74, variantCount: 1, shapeKind: "unknown" },
    ]);
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
