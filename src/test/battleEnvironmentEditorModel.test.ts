import { describe, expect, it } from "vitest";
import {
  battleEnvironmentTypeName,
  cloneBattleEnvironmentZoneSpec,
  MAX_BATTLE_BACKGROUND_TYPES,
  parseBattleEnvironmentZoneSpecs,
  serializeBattleEnvironmentZoneSpecs,
  validateBattleEnvironmentZoneSpec,
  type BattleEnvironmentZoneSpec,
} from "../pokeweb/battleEnvironmentEditorModel";
import { BATTLE_ZONE_SPEC_RECORD_BYTES } from "../pokeweb/battleEnvironmentUsage";

function zoneSpec(overrides: Partial<BattleEnvironmentZoneSpec> = {}): BattleEnvironmentZoneSpec {
  return {
    timeZone: true,
    season: false,
    backgrounds: Array.from({ length: 17 }, (_unused, index) => index % 3),
    platforms: Array.from({ length: 17 }, (_unused, index) => (index + 1) % 3),
    ...overrides,
  };
}

describe("battle environment editor model", () => {
  it("round-trips the retail 36-byte zone-spec layout and ignores incomplete trailing data", () => {
    const first = zoneSpec();
    const second = zoneSpec({
      timeZone: false,
      season: true,
      backgrounds: Array(17).fill(7),
      platforms: Array(17).fill(9),
    });

    const encoded = serializeBattleEnvironmentZoneSpecs([first, second]);
    const withTrailingData = new Uint8Array(encoded.length + 5);
    withTrailingData.set(encoded);
    withTrailingData.fill(0xee, encoded.length);

    expect(encoded).toHaveLength(BATTLE_ZONE_SPEC_RECORD_BYTES * 2);
    expect(Array.from(encoded.slice(0, 4))).toEqual([1, 0, 0, 1]);
    expect(parseBattleEnvironmentZoneSpecs(withTrailingData)).toEqual([first, second]);
  });

  it("clones mappings without sharing their mutable arrays", () => {
    const original = zoneSpec();
    const cloned = cloneBattleEnvironmentZoneSpec(original);

    cloned.backgrounds[0] = 99;
    cloned.platforms[0] = 98;

    expect(original.backgrounds[0]).toBe(0);
    expect(original.platforms[0]).toBe(1);
  });

  it("validates table bounds separately from missing renderable models", () => {
    const valid = zoneSpec({ backgrounds: Array(17).fill(1), platforms: Array(17).fill(2) });
    const warning = validateBattleEnvironmentZoneSpec(
      valid,
      { tableEntryCount: 3, variants: [] },
      { tableEntryCount: 3, variants: [] },
    );
    expect(warning.valid).toBe(true);
    expect(warning.warnings).toContain("Lawn references background 1, which has no renderable model.");

    valid.platforms[5] = 8;
    const invalid = validateBattleEnvironmentZoneSpec(
      valid,
      { tableEntryCount: 3, variants: [] },
      { tableEntryCount: 3, variants: [] },
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain("Encounter grass references platform 8, outside the platform table.");
  });

  it("labels appended type slots and enforces the packed header's 5-bit limit", () => {
    expect(battleEnvironmentTypeName(1)).toBe("Seasonal grass");
    expect(battleEnvironmentTypeName(19)).toBe("Custom type 19");
    expect(() => serializeBattleEnvironmentZoneSpecs(Array.from({ length: MAX_BATTLE_BACKGROUND_TYPES + 1 }, () => zoneSpec()))).toThrow(/at most 32/u);
  });
});
