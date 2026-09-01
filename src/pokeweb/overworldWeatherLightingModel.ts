import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, insertNarcFiles, replaceNarcFile } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";

export const OVERWORLD_WEATHER_LIGHT_ARCHIVE_PATH = "a/0/6/1";
export const WEATHER_LIGHT_RECORD_SIZE = 52;
export const WEATHER_LIGHT_RECORD_COUNT = 15;

export const WEATHER_TIMEZONE_NAMES = ["Morning", "Noon", "Evening", "Night", "Midnight"] as const;

export const WEATHER_TIMEZONE_SEASON_HOURS = {
  Spring: [5, 10, 17, 20, 0],
  Summer: [4, 9, 19, 21, 0],
  Autumn: [6, 10, 17, 20, 0],
  Winter: [7, 11, 17, 19, 0],
} as const;

/** Retail weather ID to a/0/6/1 member, matching FIELD_LIGHT_STATUS_GetWeatherLightDatIdx. */
export const STOCK_WEATHER_LIGHT_MEMBERS: Readonly<Record<number, number>> = {
  1: 8,
  2: 7,
  3: 9,
  4: 8,
  5: 8,
  6: 6,
  7: 0,
  8: 8,
  9: 1,
  10: 4,
  11: 2,
  12: 9,
  13: 5,
  14: 3,
};

export type WeatherLightVector = {
  x: number;
  y: number;
  z: number;
};

export type WeatherDirectionalLight = {
  enabled: boolean;
  color: string;
  vector: WeatherLightVector;
};

export type WeatherLightingRecord = {
  timezone: number;
  changeMinutes: number;
  lights: WeatherDirectionalLight[];
  diffuse: string;
  ambient: string;
  specular: string;
  emission: string;
  fogColor: string;
  backgroundColor: string;
};

export type WeatherLightingDocument = {
  memberId: number;
  records: WeatherLightingRecord[];
  bytes: Uint8Array;
  source: "stock" | "custom" | "inherited";
  sharedEffectIds: number[];
  runtimeLinked: boolean;
};

export function weatherLightingMemberId(project: ProjectState, weatherId: number): number | undefined {
  const custom = project.overworldWeather?.customEffects.find((effect) => effect.id === weatherId);
  if (custom?.clone?.lightingResourceId !== undefined) return custom.clone.lightingResourceId;
  if (custom?.clone) return STOCK_WEATHER_LIGHT_MEMBERS[custom.clone.donorId];
  return STOCK_WEATHER_LIGHT_MEMBERS[weatherId];
}

export async function loadWeatherLightingDocument(project: ProjectState, weatherId: number): Promise<WeatherLightingDocument | undefined> {
  const memberId = weatherLightingMemberId(project, weatherId);
  if (memberId === undefined) return undefined;
  const custom = project.overworldWeather?.customEffects.find((effect) => effect.id === weatherId);
  const { narc } = await loadWeatherLightingNarc(project);
  const bytes = requireLightingMember(narc, memberId).slice();
  const source = custom?.clone?.lightingResourceId !== undefined ? "custom" : custom?.clone ? "inherited" : "stock";
  return {
    memberId,
    records: parseWeatherLightingMember(bytes),
    bytes,
    source,
    sharedEffectIds: weatherIdsReferencingLightingMember(project, memberId),
    // PWTH ABI 3 preserves donor lighting. A future runtime hook must consume a custom member redirect.
    runtimeLinked: source !== "custom",
  };
}

export function parseWeatherLightingMember(bytes: Uint8Array): WeatherLightingRecord[] {
  if (bytes.length === 0 || bytes.length % WEATHER_LIGHT_RECORD_SIZE !== 0) {
    throw new Error(`Weather-light data must contain complete ${WEATHER_LIGHT_RECORD_SIZE}-byte LIGHT_DATA records.`);
  }
  return Array.from({ length: bytes.length / WEATHER_LIGHT_RECORD_SIZE }, (_unused, index) => {
    const offset = index * WEATHER_LIGHT_RECORD_SIZE;
    const lights = Array.from({ length: 4 }, (_light, lightIndex): WeatherDirectionalLight => ({
      enabled: bytes[offset + 4 + lightIndex] !== 0,
      color: bgr555ToHex(readU16(bytes, offset + 8 + lightIndex * 2)),
      vector: {
        x: fx16(readS16(bytes, offset + 16 + lightIndex * 6)),
        y: fx16(readS16(bytes, offset + 18 + lightIndex * 6)),
        z: fx16(readS16(bytes, offset + 20 + lightIndex * 6)),
      },
    }));
    return {
      timezone: readU16(bytes, offset),
      changeMinutes: readS16(bytes, offset + 2),
      lights,
      diffuse: bgr555ToHex(readU16(bytes, offset + 40)),
      ambient: bgr555ToHex(readU16(bytes, offset + 42)),
      specular: bgr555ToHex(readU16(bytes, offset + 44)),
      emission: bgr555ToHex(readU16(bytes, offset + 46)),
      fogColor: bgr555ToHex(readU16(bytes, offset + 48)),
      backgroundColor: bgr555ToHex(readU16(bytes, offset + 50)),
    };
  });
}

export function writeWeatherLightingMember(records: readonly WeatherLightingRecord[]): Uint8Array {
  if (records.length === 0) throw new Error("Weather-light data must contain at least one keyframe.");
  const bytes = new Uint8Array(records.length * WEATHER_LIGHT_RECORD_SIZE);
  records.forEach((record, index) => writeWeatherLightingRecord(bytes, index, record));
  return bytes;
}

export function writeWeatherLightingRecord(bytes: Uint8Array, recordIndex: number, record: WeatherLightingRecord): void {
  if (!Number.isInteger(recordIndex) || recordIndex < 0 || (recordIndex + 1) * WEATHER_LIGHT_RECORD_SIZE > bytes.length) {
    throw new Error("Weather-light keyframe index is out of range.");
  }
  if (record.lights.length !== 4) throw new Error("A weather-light keyframe must contain four directional lights.");
  const offset = recordIndex * WEATHER_LIGHT_RECORD_SIZE;
  writeU16(bytes, offset, clampInteger(record.timezone, 0, 0xffff));
  writeU16(bytes, offset + 2, clampInteger(record.changeMinutes, -0x8000, 0x7fff) & 0xffff);
  record.lights.forEach((light, lightIndex) => {
    bytes[offset + 4 + lightIndex] = light.enabled ? 1 : 0;
    writeU16(bytes, offset + 8 + lightIndex * 2, hexToBgr555(light.color));
    writeU16(bytes, offset + 16 + lightIndex * 6, vectorComponentToFx16(light.vector.x) & 0xffff);
    writeU16(bytes, offset + 18 + lightIndex * 6, vectorComponentToFx16(light.vector.y) & 0xffff);
    writeU16(bytes, offset + 20 + lightIndex * 6, vectorComponentToFx16(light.vector.z) & 0xffff);
  });
  writeU16(bytes, offset + 40, hexToBgr555(record.diffuse));
  writeU16(bytes, offset + 42, hexToBgr555(record.ambient));
  writeU16(bytes, offset + 44, hexToBgr555(record.specular));
  writeU16(bytes, offset + 46, hexToBgr555(record.emission));
  writeU16(bytes, offset + 48, hexToBgr555(record.fogColor));
  writeU16(bytes, offset + 50, hexToBgr555(record.backgroundColor));
}

export async function updateWeatherLightingRecord(
  project: ProjectState,
  memberId: number,
  recordIndex: number,
  record: WeatherLightingRecord,
): Promise<void> {
  const { rom, fileId, narc } = await loadWeatherLightingNarc(project);
  const bytes = requireLightingMember(narc, memberId).slice();
  parseWeatherLightingMember(bytes);
  writeWeatherLightingRecord(bytes, recordIndex, record);
  replaceNarcFile(project, rom, fileId, memberId, bytes);
  recordGenericChange(project, "file_system", `Updated weather-light member ${memberId}, keyframe ${recordIndex}.`, `Weather lighting ${memberId}`, {
    key: `weather-lighting:${memberId}`,
  });
}

export async function replaceWeatherLightingResource(project: ProjectState, memberId: number, bytes: Uint8Array): Promise<void> {
  const { rom, fileId, narc } = await loadWeatherLightingNarc(project);
  const current = requireLightingMember(narc, memberId);
  parseWeatherLightingMember(bytes);
  if (bytes.length !== current.length) {
    throw new Error(`Replacement lighting data must be exactly ${current.length} bytes (${current.length / WEATHER_LIGHT_RECORD_SIZE} keyframes).`);
  }
  replaceNarcFile(project, rom, fileId, memberId, bytes.slice());
  recordGenericChange(project, "file_system", `Replaced weather-light member ${memberId}.`, `Weather lighting ${memberId}`, {
    key: `weather-lighting:${memberId}`,
  });
}

export async function cloneWeatherLightingResource(
  project: ProjectState,
  donorWeatherId: number,
  targetWeatherId: number,
): Promise<number | undefined> {
  const donorMemberId = weatherLightingMemberId(project, donorWeatherId);
  if (donorMemberId === undefined) return undefined;
  const { rom, fileId, narc } = await loadWeatherLightingNarc(project);
  const source = requireLightingMember(narc, donorMemberId).slice();
  parseWeatherLightingMember(source);
  const targetMemberId = narc.files.length;
  insertNarcFiles(project, rom, fileId, 0, [{
    name: `weather_light_${targetWeatherId}_copy_${donorMemberId}.bin`,
    bytes: source,
  }], "append");
  recordGenericChange(project, "file_system", `Cloned weather-light member ${donorMemberId} to ${targetMemberId}.`, `Weather lighting ${targetMemberId}`, {
    key: `weather-lighting-clone:${targetWeatherId}`,
  });
  return targetMemberId;
}

export function weatherLightingSeasonTimes(record: WeatherLightingRecord): Record<keyof typeof WEATHER_TIMEZONE_SEASON_HOURS, string> {
  return Object.fromEntries(Object.entries(WEATHER_TIMEZONE_SEASON_HOURS).map(([season, hours]) => {
    const baseHour = hours[record.timezone] ?? 0;
    const totalMinutes = baseHour * 60 + record.changeMinutes;
    const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
    return [season, `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`];
  })) as Record<keyof typeof WEATHER_TIMEZONE_SEASON_HOURS, string>;
}

function weatherIdsReferencingLightingMember(project: ProjectState, memberId: number): number[] {
  const ids: number[] = [];
  for (let weatherId = 0; weatherId <= 14; weatherId += 1) {
    if (STOCK_WEATHER_LIGHT_MEMBERS[weatherId] === memberId) ids.push(weatherId);
  }
  for (const effect of project.overworldWeather?.customEffects ?? []) {
    if (weatherLightingMemberId(project, effect.id) === memberId) ids.push(effect.id);
  }
  return [...new Set(ids)].sort((left, right) => left - right);
}

async function loadWeatherLightingNarc(project: ProjectState): Promise<{ rom: NintendoDSRom; fileId: number; narc: NARC }> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the source ROM to edit weather lighting.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.filenames.idOf(OVERWORLD_WEATHER_LIGHT_ARCHIVE_PATH);
  if (fileId === undefined) throw new Error(`ROM path ${OVERWORLD_WEATHER_LIGHT_ARCHIVE_PATH} was not found.`);
  return { rom, fileId, narc: new NARC(getRomFileBytes(project, rom, fileId)) };
}

function requireLightingMember(narc: NARC, memberId: number): Uint8Array {
  const bytes = narc.files[memberId];
  if (!bytes) throw new Error(`Weather-light member ${memberId} is missing.`);
  return bytes;
}

function readS16(bytes: Uint8Array, offset: number): number {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function fx16(value: number): number {
  return value / 4096;
}

function vectorComponentToFx16(value: number): number {
  return clampInteger((Number.isFinite(value) ? value : 0) * 4096, -0x8000, 0x7fff);
}

function bgr555ToHex(value: number): string {
  const red = Math.round((value & 0x1f) * 255 / 31);
  const green = Math.round(((value >>> 5) & 0x1f) * 255 / 31);
  const blue = Math.round(((value >>> 10) & 0x1f) * 255 / 31);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexToBgr555(hex: string): number {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new Error("Lighting colors must use #RRGGBB format.");
  const value = Number.parseInt(hex.slice(1), 16);
  const red = Math.round(((value >>> 16) & 0xff) * 31 / 255);
  const green = Math.round(((value >>> 8) & 0xff) * 31 / 255);
  const blue = Math.round((value & 0xff) * 31 / 255);
  return red | (green << 5) | (blue << 10);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}
