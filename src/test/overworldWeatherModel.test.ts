import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getHeaderPackedValue, parseHeaders } from "../pokeweb/headerModel";
import {
  assignWeatherToArea,
  assignWeatherToAreas,
  dormantWeatherEffects,
  getAssignableWeatherEffects,
  getHeaderWeatherId,
  isWeatherEffectAssignable,
  parseOverworldWeatherCalendar,
  parseOverworldWeatherBundle,
  stockWeatherEffects,
  weatherCalendarDate,
  weatherCalendarSeason,
  weatherCalendarUsageCounts,
  weatherUsageCounts,
} from "../pokeweb/overworldWeatherModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("overworldWeatherModel", () => {
  it("defines the complete retail BW2 registry and the three dormant source candidates", () => {
    expect(stockWeatherEffects().map((effect) => [effect.id, effect.name])).toEqual([
      [0, "Clear"], [1, "Snow"], [2, "Rain"], [3, "Sandstorm"], [4, "Blizzard"], [5, "Hail"],
      [6, "Thunder Rain"], [7, "Wind Rain"], [8, "Diamond Dust"], [9, "Mist"], [10, "Palace White Mist"],
      [11, "Palace Black Mist"], [12, "Strong Sandstorm"], [13, "Palace White Mist (High)"], [14, "Palace Black Mist (High)"],
    ]);
    expect(dormantWeatherEffects().map((effect) => [effect.id, effect.name])).toEqual([
      [15, "Evening Rain (dormant)"], [16, "Spark Rain (dormant)"], [17, "Mirage (dormant)"],
    ]);
  });

  it("changes only the six-bit weather part of a packed BW2 header", () => {
    const project = makeProject([
      { weather_id: 0b1100_0001, camera_id: 0b1010_1010, location_name_id: 1 },
      { weather_id: 2, camera_id: 0, location_name_id: 2 },
    ]);
    project.headers = parseHeaders(project);
    const before = getHeaderPackedValue(project.headers.rows[1], "weather_camera");

    assignWeatherToArea(project, 1, 12);

    const after = getHeaderPackedValue(project.headers.rows[1], "weather_camera");
    expect(getHeaderWeatherId(project.headers.rows[1])).toBe(12);
    expect(after & ~0x3f).toBe(before & ~0x3f);
    expect(project.narcs.headers?.dirty.has(0)).toBe(true);
  });

  it("bulk assigns selected areas and reports usage counts", () => {
    const project = makeProject([
      { weather_id: 0, location_name_id: 1 },
      { weather_id: 2, location_name_id: 2 },
      { weather_id: 2, location_name_id: 1 },
    ]);
    project.headers = parseHeaders(project);

    expect(assignWeatherToAreas(project, [1, 3], 9)).toBe(2);
    expect([...weatherUsageCounts(project).entries()].sort(([a], [b]) => a - b)).toEqual([[2, 1], [9, 2]]);
  });

  it("parses BW2's 366-day zone weather calendar and preserves date ranges", () => {
    const firstSchedule = new Uint8Array(366);
    firstSchedule.fill(2, 31, 60);
    const secondSchedule = new Uint8Array(366).fill(2);
    const weatherData = new Uint8Array(732);
    weatherData.set(firstSchedule, 0);
    weatherData.set(secondSchedule, 366);
    const indexData = new Uint8Array(10);
    writeU16(indexData, 0, 2);
    writeU16(indexData, 2, 96);
    writeU16(indexData, 4, 0);
    writeU16(indexData, 6, 331);
    writeU16(indexData, 8, 366);
    const narc = new NARC();
    narc.files = [weatherData, indexData];

    const calendar = parseOverworldWeatherCalendar(narc.save());

    expect(calendar.zones.size).toBe(2);
    expect(calendar.zones.get(96)?.weatherIds).toEqual([0, 2]);
    expect(calendar.zones.get(96)?.ranges).toEqual([
      { weatherId: 0, startDayIndex: 0, endDayIndex: 30 },
      { weatherId: 2, startDayIndex: 31, endDayIndex: 59 },
      { weatherId: 0, startDayIndex: 60, endDayIndex: 365 },
    ]);
    expect([...weatherCalendarUsageCounts(calendar).entries()].sort(([a], [b]) => a - b)).toEqual([[0, 1], [2, 2]]);
    expect(weatherCalendarDate(59)).toEqual({ month: 2, day: 29, season: "Summer" });
    expect(weatherCalendarDate(60)).toEqual({ month: 3, day: 1, season: "Autumn" });
    expect([1, 5, 9].map(weatherCalendarSeason)).toEqual(["Spring", "Spring", "Spring"]);
    expect([4, 8, 12].map(weatherCalendarSeason)).toEqual(["Winter", "Winter", "Winter"]);
  });

  it("does not expose dormant IDs until a custom runtime bundle is registered", () => {
    const project = makeProject([{ weather_id: 0, location_name_id: 1 }]);
    project.headers = parseHeaders(project);
    expect(getAssignableWeatherEffects(project).some((effect) => effect.id === 15)).toBe(false);
    expect(() => assignWeatherToArea(project, 1, 15)).toThrow(/not safe to assign/u);

    project.overworldWeather = {
      customEffects: [{ id: 15, name: "Evening Rain", sourceFileName: "evening.pwwweather", importedAt: "2026-01-01T00:00:00.000Z", runtimeModulePaths: [] }],
    };
    expect(getAssignableWeatherEffects(project).find((effect) => effect.id === 15)?.status).toBe("custom");
    expect(() => assignWeatherToArea(project, 1, 15)).not.toThrow();
  });

  it("does not invent custom aliases merely because the bundled runtime is installed", () => {
    const project = makeProject([{ weather_id: 0, location_name_id: 1 }]);
    project.headers = parseHeaders(project);
    project.codeInjection = {
      modules: [{
        path: "patches/PokewebOverworldWeatherW2.dll",
        fileName: "PokewebOverworldWeatherW2.dll",
        target: "patches",
      }],
    };

    expect(getAssignableWeatherEffects(project).some((effect) => effect.id >= 15)).toBe(false);
    expect(isWeatherEffectAssignable(project, 15)).toBe(false);

    project.overworldWeather = {
      customEffects: [{
        id: 15,
        name: "Rain clone",
        sourceFileName: "Created in Weather Graphics",
        importedAt: "2026-01-01T00:00:00.000Z",
        runtimeModulePaths: [],
        clone: {
          donorId: 2,
          behavior: "rain",
          channels: ["particle"],
          runtimeReady: true,
          particleResource: { animation: 100, cell: 101, character: 102, palette: 103 },
          auxiliaryResourceIds: [],
          runtime: {
            particleDensity: 1,
            movementSpeed: 1,
            fogOffset: 32735,
            fogSlope: 9,
            fogTable: Array.from({ length: 32 }, (_unused, index) => Math.round(index * 127 / 31)),
            fogFadeInFrames: 90,
            fogFadeOutFrames: 50,
            fogColor: "#d5e2e5",
            screenScrollSpeed: 1,
          },
        },
      }],
    };
    expect(getAssignableWeatherEffects(project).find((effect) => effect.id === 15)?.name).toBe("Rain clone");
    expect(isWeatherEffectAssignable(project, 15)).toBe(true);
    expect(() => assignWeatherToArea(project, 1, 15)).not.toThrow();
  });

  it("parses a custom bundle and validates its runtime and version", () => {
    const manifest = {
      format: "pokeweb-overworld-weather",
      version: 1,
      id: 18,
      name: "Soft Fog",
      baseVersions: ["W2"],
      preview: { image: "preview/fog.png", behavior: "fog" },
      runtime: { external: true },
    };
    const bytes = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "preview/fog.png": Uint8Array.of(1, 2, 3),
    });

    const parsed = parseOverworldWeatherBundle(bytes, "soft-fog.pwwweather", "W2");
    expect(parsed.manifest.id).toBe(18);
    expect(parsed.files["preview/fog.png"]).toEqual(Uint8Array.of(1, 2, 3));
    expect(() => parseOverworldWeatherBundle(bytes, "soft-fog.pwwweather", "B2")).toThrow(/does not support B2/u);
  });

  it("rejects retail ID replacement and custom bundles with no runtime declaration", () => {
    const makeBundle = (manifest: Record<string, unknown>) => zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)) });
    expect(() => parseOverworldWeatherBundle(makeBundle({ format: "pokeweb-overworld-weather", version: 1, id: 14, name: "Bad", runtime: { external: true } }), "bad.zip", "W2")).toThrow(/15 to 63/u);
    expect(() => parseOverworldWeatherBundle(makeBundle({ format: "pokeweb-overworld-weather", version: 1, id: 20, name: "No Runtime" }), "bad.zip", "W2")).toThrow(/runtime\.modules/u);
  });
});

function makeProject(rows: Array<Record<string, number>>): ProjectState {
  const formats = getNarcFormats("BW2");
  const format = formats.headers!;
  const data = packRows(format, rows);
  const headersStore: NarcStore = {
    name: "headers",
    fileId: 1,
    sourcePath: "a/0/1/2",
    fileCount: 1,
    rawFiles: [data],
    records: new Map(),
    dirty: new Set(),
  };
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: { headers: 1 }, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: data.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: { headers: headersStore } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { locations: ["Unknown", "Route 19", "Aspertia City"] } },
    formats,
    trpokInfo: [],
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor((row[field] ?? 0) / 2 ** (8 * index)) & 0xff;
      offset += size;
    }
  });
  return out;
}
