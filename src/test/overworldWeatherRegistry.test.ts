import { describe, expect, it } from "vitest";
import { readAscii, readU16 } from "../nds/binary";
import {
  createEmptyOverworldWeatherRegistry,
  OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT,
  OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE,
  OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE,
  OVERWORLD_WEATHER_UNUSED_RESOURCE,
  parseOverworldWeatherRegistry,
  serializeProjectOverworldWeatherRegistry,
  WeatherRegistryChannel,
  writeOverworldWeatherRegistry,
  type OverworldWeatherRegistryEntry,
} from "../pokeweb/overworldWeatherRegistry";
import type { ProjectState } from "../pokeweb/projectStore";

describe("overworld weather PWTH registry", () => {
  it("writes the fixed 16-byte header followed by exactly 49 empty rows", () => {
    const bytes = createEmptyOverworldWeatherRegistry();

    expect(bytes.length).toBe(OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE
      + OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT * OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE);
    expect(bytes.length).toBe(2368);
    expect(readAscii(bytes, 0, 4)).toBe("PWTH");
    expect(readU16(bytes, 4)).toBe(1);
    expect(readU16(bytes, 6)).toBe(48);
    expect([...bytes.slice(8, 12)]).toEqual([15, 49, 16, 0]);

    const parsed = parseOverworldWeatherRegistry(bytes);
    expect(parsed.entries).toHaveLength(49);
    expect(parsed.entries[0]).toMatchObject({ weatherId: 15, enabled: false, donorBehaviorId: 0 });
    expect(parsed.entries[48]).toMatchObject({ weatherId: 63, enabled: false });
    expect(parsed.entries[0]?.animationMemberId).toBe(OVERWORLD_WEATHER_UNUSED_RESOURCE);
  });

  it("round-trips particle and fog resource rows at their implicit IDs", () => {
    const rain = entry(15, {
      enabled: true,
      donorBehaviorId: 2,
      channelFlags: WeatherRegistryChannel.ParticleOam,
      animationMemberId: 300,
      cellMemberId: 301,
      characterMemberId: 302,
      paletteMemberId: 303,
    });
    const fog = entry(16, {
      enabled: true,
      donorBehaviorId: 9,
      channelFlags: WeatherRegistryChannel.Fog,
      fogIntensityQ8_8: 0x0180,
      fogRed5: 4,
      fogGreen5: 12,
      fogBlue5: 27,
    });

    const bytes = writeOverworldWeatherRegistry([rain, fog]);
    const parsed = parseOverworldWeatherRegistry(bytes);

    expect(parsed.entries[0]).toEqual(rain);
    expect(parsed.entries[1]).toEqual(fog);
    expect(readU16(bytes, 16 + 4)).toBe(300);
    expect(readU16(bytes, 16 + 48 + 20)).toBe(0x0180);
  });

  it("serializes runtime-ready clones and leaves all other custom slots disabled", () => {
    const project = {
      overworldWeather: {
        customEffects: [{
          id: 15,
          name: "Independent rain",
          sourceFileName: "Created in Weather Graphics",
          importedAt: "2026-01-01T00:00:00.000Z",
          runtimeModulePaths: [],
          clone: {
            donorId: 2,
            behavior: "rain",
            channels: ["particle", "sound"],
            runtimeReady: true,
            particleResource: { animation: 400, cell: 401, character: 402, palette: 403 },
            auxiliaryResourceIds: [404, 405],
            runtime: {
              particleDensity: 1.5,
              movementSpeed: 0.75,
              fogIntensity: 0,
              fogColor: "#204060",
              screenScrollSpeed: -0.5,
            },
          },
        }],
      },
    } as unknown as ProjectState;

    const parsed = parseOverworldWeatherRegistry(serializeProjectOverworldWeatherRegistry(project));

    expect(parsed.entries[0]).toMatchObject({
      enabled: true,
      donorBehaviorId: 2,
      channelFlags: WeatherRegistryChannel.ParticleOam | WeatherRegistryChannel.BgFront
        | WeatherRegistryChannel.BgBack | WeatherRegistryChannel.Sound,
      animationMemberId: 400,
      cellMemberId: 401,
      characterMemberId: 402,
      paletteMemberId: 403,
      auxiliaryMemberIds: [404, 405],
      particleDensityQ8_8: 0x0180,
      movementSpeedQ8_8: 0x00c0,
      fogIntensityQ8_8: 0,
      screenScrollSpeedQ8_8: -0x0080,
    });
    expect(parsed.entries.slice(1).every((candidate) => !candidate.enabled)).toBe(true);
  });

  it("rejects malformed headers and IDs outside 15–63", () => {
    const badMagic = createEmptyOverworldWeatherRegistry();
    badMagic[0] = 0;
    expect(() => parseOverworldWeatherRegistry(badMagic)).toThrow(/magic/u);
    expect(() => writeOverworldWeatherRegistry([entry(64)])).toThrow(/15–63/u);
  });
});

function entry(weatherId: number, overrides: Partial<OverworldWeatherRegistryEntry> = {}): OverworldWeatherRegistryEntry {
  return {
    weatherId,
    enabled: false,
    donorBehaviorId: 0,
    channelFlags: 0,
    animationMemberId: OVERWORLD_WEATHER_UNUSED_RESOURCE,
    cellMemberId: OVERWORLD_WEATHER_UNUSED_RESOURCE,
    characterMemberId: OVERWORLD_WEATHER_UNUSED_RESOURCE,
    paletteMemberId: OVERWORLD_WEATHER_UNUSED_RESOURCE,
    auxiliaryMemberIds: [OVERWORLD_WEATHER_UNUSED_RESOURCE, OVERWORLD_WEATHER_UNUSED_RESOURCE],
    particleDensityQ8_8: 0x0100,
    movementSpeedQ8_8: 0x0100,
    fogIntensityQ8_8: 0x0100,
    fogRed5: 27,
    fogGreen5: 28,
    fogBlue5: 28,
    fogSlope: 9,
    screenScrollSpeedQ8_8: 0x0100,
    fogFadeInFrames: 90,
    fogFadeOutFrames: 50,
    entryFlags: 0,
    ...overrides,
  };
}
