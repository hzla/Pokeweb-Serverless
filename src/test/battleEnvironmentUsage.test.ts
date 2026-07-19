import { describe, expect, it } from "vitest";
import {
  BATTLE_ZONE_SPEC_RECORD_BYTES,
  parseBattleEnvironmentUsage,
} from "../pokeweb/battleEnvironmentUsage";
import type { HeaderCollection, HeaderRow } from "../pokeweb/headerModel";

function header(index: number, locationName: string, battleBackgroundType: number): HeaderRow {
  const packed = battleBackgroundType << 5;
  return {
    index,
    location_name: locationName,
    unknown_2: packed & 0xff,
    flags: packed >>> 8,
  };
}

describe("battle environment location usage", () => {
  it("traces header background types through every terrain attribute in the zone-spec table", () => {
    const zoneSpecRows = new Uint8Array(BATTLE_ZONE_SPEC_RECORD_BYTES * 5);
    zoneSpecRows.fill(0xff);
    const typeThree = BATTLE_ZONE_SPEC_RECORD_BYTES * 3;
    zoneSpecRows[typeThree + 2] = 5;
    zoneSpecRows[typeThree + 3] = 5;
    zoneSpecRows[typeThree + 4] = 7;
    zoneSpecRows[typeThree + 19] = 6;
    zoneSpecRows[typeThree + 20] = 8;
    const headers: HeaderCollection = {
      count: 2,
      rows: {
        1: header(0, "Route 1", 3),
        2: header(1, "Route 1", 3),
      },
    };

    const usage = parseBattleEnvironmentUsage(headers, zoneSpecRows);

    expect(usage.backgrounds.get(5)).toEqual([{
      locationName: "Route 1",
      headerIndexes: [0, 1],
      routes: [{
        battleBackgroundType: 3,
        battleBackgroundTypeName: "Seasonal city",
        attributeIndexes: [0, 1],
        attributeNames: ["Lawn", "Ground"],
      }],
    }]);
    expect(usage.backgrounds.get(7)?.[0]?.routes[0]?.attributeNames).toEqual(["Seasonal ground 1"]);
    expect(usage.platforms.get(6)?.[0]?.routes[0]?.attributeNames).toEqual(["Lawn"]);
    expect(usage.platforms.get(8)?.[0]?.routes[0]?.attributeNames).toEqual(["Ground"]);
  });

  it("ignores absent table entries and header types outside the available zone rows", () => {
    const zoneSpecRows = new Uint8Array(BATTLE_ZONE_SPEC_RECORD_BYTES);
    zoneSpecRows.fill(0xff);
    const headers: HeaderCollection = {
      count: 1,
      rows: { 1: header(0, "Mystery Zone", 18) },
    };

    const usage = parseBattleEnvironmentUsage(headers, zoneSpecRows);

    expect(usage.backgrounds.size).toBe(0);
    expect(usage.platforms.size).toBe(0);
  });

  it("labels control-code-only place names without exposing raw text escapes", () => {
    const zoneSpecRows = new Uint8Array(BATTLE_ZONE_SPEC_RECORD_BYTES);
    zoneSpecRows.fill(0xff);
    zoneSpecRows[2] = 2;
    const headers: HeaderCollection = {
      count: 1,
      rows: { 1: header(0, "\\xFF0D\\xFF0D", 0) },
    };

    expect(parseBattleEnvironmentUsage(headers, zoneSpecRows).backgrounds.get(2)?.[0]?.locationName).toBe("Unnamed location");
  });
});
