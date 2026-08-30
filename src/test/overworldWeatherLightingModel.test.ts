import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import {
  parseWeatherLightingMember,
  STOCK_WEATHER_LIGHT_MEMBERS,
  weatherLightingMemberId,
  weatherLightingSeasonTimes,
  WEATHER_LIGHT_RECORD_SIZE,
  writeWeatherLightingMember,
  type WeatherDirectionalLight,
  type WeatherLightingRecord,
} from "../pokeweb/overworldWeatherLightingModel";
import type { ProjectState } from "../pokeweb/projectStore";

describe("overworld weather lighting", () => {
  it("round-trips the complete 52-byte LIGHT_DATA layout", () => {
    const record: WeatherLightingRecord = {
      timezone: 3,
      changeMinutes: -25,
      lights: [
        light(true, "#ff0000", -1, 0.5, 1.25),
        light(false, "#00ff00", 0, -2, 0.25),
        light(true, "#0000ff", 7.5, -8, 0),
        light(false, "#ffffff", 0.125, -0.125, 0.75),
      ],
      diffuse: "#ff0000",
      ambient: "#00ff00",
      specular: "#0000ff",
      emission: "#ffffff",
      fogColor: "#000000",
      backgroundColor: "#ffffff",
    };

    const bytes = writeWeatherLightingMember([record]);
    const parsed = parseWeatherLightingMember(bytes)[0]!;

    expect(bytes).toHaveLength(WEATHER_LIGHT_RECORD_SIZE);
    expect(readU16(bytes, 0)).toBe(3);
    expect(readU16(bytes, 2)).toBe(0xffe7);
    expect([...bytes.slice(4, 8)]).toEqual([1, 0, 1, 0]);
    expect(readU16(bytes, 8)).toBe(0x001f);
    expect(readU16(bytes, 10)).toBe(0x03e0);
    expect(readU16(bytes, 12)).toBe(0x7c00);
    expect(readU16(bytes, 16)).toBe(0xf000);
    expect(readU16(bytes, 18)).toBe(0x0800);
    expect(parsed).toEqual(record);
  });

  it("uses the retail weather-to-light-member table and lets clones own a member", () => {
    expect(STOCK_WEATHER_LIGHT_MEMBERS[2]).toBe(7);
    expect(STOCK_WEATHER_LIGHT_MEMBERS[4]).toBe(8);
    expect(STOCK_WEATHER_LIGHT_MEMBERS[5]).toBe(8);
    expect(STOCK_WEATHER_LIGHT_MEMBERS[8]).toBe(8);
    expect(STOCK_WEATHER_LIGHT_MEMBERS[0]).toBeUndefined();

    const project = {
      overworldWeather: {
        customEffects: [
          { id: 15, clone: { donorId: 2 } },
          { id: 16, clone: { donorId: 2, lightingResourceId: 10 } },
        ],
      },
    } as unknown as ProjectState;
    expect(weatherLightingMemberId(project, 15)).toBe(7);
    expect(weatherLightingMemberId(project, 16)).toBe(10);
  });

  it("shows the season-dependent clock time for a timezone-relative keyframe", () => {
    const record = { ...emptyRecord(), timezone: 0, changeMinutes: -30 };
    expect(weatherLightingSeasonTimes(record)).toEqual({
      Spring: "04:30",
      Summer: "03:30",
      Autumn: "05:30",
      Winter: "06:30",
    });
  });

  it("rejects truncated LIGHT_DATA members", () => {
    expect(() => parseWeatherLightingMember(new Uint8Array(51))).toThrow(/52-byte/u);
  });
});

function light(enabled: boolean, color: string, x: number, y: number, z: number): WeatherDirectionalLight {
  return { enabled, color, vector: { x, y, z } };
}

function emptyRecord(): WeatherLightingRecord {
  return {
    timezone: 0,
    changeMinutes: 0,
    lights: Array.from({ length: 4 }, () => light(false, "#000000", 0, 0, 0)),
    diffuse: "#000000",
    ambient: "#000000",
    specular: "#000000",
    emission: "#000000",
    fogColor: "#000000",
    backgroundColor: "#000000",
  };
}
