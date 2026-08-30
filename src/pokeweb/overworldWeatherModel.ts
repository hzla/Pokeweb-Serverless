import { unzipSync } from "fflate";
import { readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, getRomFileBytes, insertNarcFiles, replaceNarcFile, replaceRomFile } from "./fileSystemModel";
import { getHeaderPackedValue, parseHeaders, updateHeaderPackedField, type HeaderRow } from "./headerModel";
import { nitroCellEffectFrameAt, parseNitroCellEffect, type NitroCellEffect } from "./nitroCell";
import { loadActiveRomBytes } from "./persistence";
import { getPmcInstallStatus, installBundledPmc, stageCodeInjectionDll } from "./pmcModel";
import type { BaseVersion } from "./constants";
import type { OverworldWeatherCustomEffect, ProjectState } from "./projectStore";

export const OVERWORLD_WEATHER_ARCHIVE_PATH = "a/0/5/5";
export const OVERWORLD_WEATHER_CALENDAR_PATH = "a/0/9/6";
export const OVERWORLD_WEATHER_CALENDAR_DAY_COUNT = 366;
export const STOCK_WEATHER_ID_MAX = 14;
export const CUSTOM_WEATHER_ID_MIN = 15;
export const CUSTOM_WEATHER_ID_MAX = 63;

export type WeatherPreviewBehavior = "clear" | "snow" | "rain" | "sand" | "hail" | "diamond" | "fog" | "mirage";

export type WeatherEffectDefinition = {
  id: number;
  name: string;
  description: string;
  status: "stock" | "dormant" | "custom";
  behavior: WeatherPreviewBehavior;
  channels: string[];
  tint?: string;
  particleResource?: { animation: number; cell: number; character: number; palette: number };
  sourceFileName?: string;
};

export type OverworldWeatherPreview = {
  effect: WeatherEffectDefinition;
  particle?: NitroCellEffect;
  customImageBytes?: Uint8Array;
  customImageMime?: string;
  runtime?: {
    particleDensity: number;
    movementSpeed: number;
    fogIntensity: number;
    fogColor: string;
    screenScrollSpeed: number;
  };
  warnings: string[];
};

export type WeatherCalendarRange = {
  weatherId: number;
  startDayIndex: number;
  endDayIndex: number;
};

export type WeatherCalendarZone = {
  zoneId: number;
  weatherByDay: Uint8Array;
  weatherIds: number[];
  ranges: WeatherCalendarRange[];
};

export type OverworldWeatherCalendar = {
  sourcePath: string;
  zones: Map<number, WeatherCalendarZone>;
  warnings: string[];
};

export type WeatherCalendarDate = {
  month: number;
  day: number;
  season: "Spring" | "Summer" | "Autumn" | "Winter";
};

export type WeatherBundleManifest = {
  format: "pokeweb-overworld-weather";
  version: 1;
  id: number;
  name: string;
  description?: string;
  baseVersions?: BaseVersion[];
  preview?: {
    image?: string;
    behavior?: WeatherPreviewBehavior;
    tint?: string;
    particle?: { character: string; palette: string; cell: string; animation: string };
  };
  runtime?: {
    external?: boolean;
    modules?: Array<{ file: string; target?: "patches" | "lib" }>;
    romFiles?: Array<{ file: string; path: string }>;
    narcFiles?: Array<{
      file: string;
      archivePath: string;
      operation: "append" | "replace";
      index?: number;
      name?: string;
    }>;
  };
};

export type ParsedWeatherBundle = {
  manifest: WeatherBundleManifest;
  sourceFileName: string;
  files: Record<string, Uint8Array>;
};

const STOCK_EFFECTS: WeatherEffectDefinition[] = [
  { id: 0, name: "Clear", description: "No weather overlay.", status: "stock", behavior: "clear", channels: [] },
  { id: 1, name: "Snow", description: "Light drifting snow.", status: "stock", behavior: "snow", channels: ["particles"], particleResource: { animation: 21, cell: 22, character: 23, palette: 24 } },
  { id: 2, name: "Rain", description: "Steady rain with depth fog and rain ambience.", status: "stock", behavior: "rain", channels: ["particles", "fog", "sound"], particleResource: { animation: 11, cell: 12, character: 13, palette: 14 } },
  { id: 3, name: "Sandstorm", description: "Windblown sand, colored fog, and storm ambience.", status: "stock", behavior: "sand", channels: ["particles", "fog", "lighting", "sound"], tint: "#b79555", particleResource: { animation: 32, cell: 33, character: 34, palette: 35 } },
  { id: 4, name: "Blizzard", description: "Dense, fast snow with a scrolling screen plane.", status: "stock", behavior: "snow", channels: ["particles", "screen plane", "fog", "sound"], particleResource: { animation: 29, cell: 30, character: 31, palette: 24 } },
  { id: 5, name: "Hail", description: "Falling hail particles.", status: "stock", behavior: "hail", channels: ["particles"], particleResource: { animation: 0, cell: 1, character: 2, palette: 3 } },
  { id: 6, name: "Thunder Rain", description: "Rain with lightning flashes and a foreground plane.", status: "stock", behavior: "rain", channels: ["particles", "screen plane", "fog", "lighting", "sound"], particleResource: { animation: 15, cell: 16, character: 17, palette: 14 } },
  { id: 7, name: "Wind Rain", description: "Strong wind and angled rain across two screen planes.", status: "stock", behavior: "rain", channels: ["particles", "screen planes", "fog", "sound"], particleResource: { animation: 4, cell: 5, character: 6, palette: 7 } },
  { id: 8, name: "Diamond Dust", description: "Slow sparkling snow used for diamond-dust scenes.", status: "stock", behavior: "diamond", channels: ["particles"], particleResource: { animation: 25, cell: 26, character: 27, palette: 28 } },
  { id: 9, name: "Mist", description: "A pale depth-fog overlay.", status: "stock", behavior: "fog", channels: ["fog"], tint: "#d5e2e5" },
  { id: 10, name: "Palace White Mist", description: "White battle-facility fog.", status: "stock", behavior: "fog", channels: ["fog", "lighting"], tint: "#f0f1e8" },
  { id: 11, name: "Palace Black Mist", description: "Dark battle-facility fog.", status: "stock", behavior: "fog", channels: ["fog", "lighting"], tint: "#343444" },
  { id: 12, name: "Strong Sandstorm", description: "A heavier sandstorm variant.", status: "stock", behavior: "sand", channels: ["particles", "screen plane", "fog", "lighting", "sound"], tint: "#a98645", particleResource: { animation: 32, cell: 33, character: 34, palette: 35 } },
  { id: 13, name: "Palace White Mist (High)", description: "High-density white battle-facility fog.", status: "stock", behavior: "fog", channels: ["fog", "lighting"], tint: "#ffffff" },
  { id: 14, name: "Palace Black Mist (High)", description: "High-density dark battle-facility fog.", status: "stock", behavior: "fog", channels: ["fog", "lighting"], tint: "#20202b" },
];

const DORMANT_EFFECTS: WeatherEffectDefinition[] = [
  { id: 15, name: "Evening Rain (dormant)", description: "Unused time-driven rain and sparkle callbacks remain in the BW2 rain source. A runtime patch must add a descriptor and dispatcher entry.", status: "dormant", behavior: "rain", channels: ["particles", "fog", "sound"], particleResource: { animation: 11, cell: 12, character: 13, palette: 14 } },
  { id: 16, name: "Spark Rain (dormant)", description: "Unused fast diagonal rain callbacks remain in the BW2 rain source. A runtime patch must add a descriptor and dispatcher entry.", status: "dormant", behavior: "rain", channels: ["particles", "fog"], particleResource: { animation: 18, cell: 19, character: 20, palette: 14 } },
  { id: 17, name: "Mirage (dormant)", description: "Mirage source and graphics remain, but its descriptor/callback code is not present in the retail storm overlay. A custom runtime must compile and register it.", status: "dormant", behavior: "mirage", channels: ["tile background", "raster scroll", "fog"], tint: "#d8c38f" },
];

export function stockWeatherEffects(): readonly WeatherEffectDefinition[] {
  return STOCK_EFFECTS;
}

export function dormantWeatherEffects(): readonly WeatherEffectDefinition[] {
  return DORMANT_EFFECTS;
}

export function getWeatherEffects(project: ProjectState): WeatherEffectDefinition[] {
  const customById = new Map((project.overworldWeather?.customEffects ?? []).map((effect) => [effect.id, effect]));
  return [
    ...STOCK_EFFECTS,
    ...DORMANT_EFFECTS.filter((effect) => !customById.has(effect.id)),
    ...[...customById.values()].map(customDefinition),
  ].sort((a, b) => a.id - b.id);
}

export function getAssignableWeatherEffects(project: ProjectState): WeatherEffectDefinition[] {
  return getWeatherEffects(project).filter((effect) => effect.status !== "dormant");
}

export function isWeatherEffectAssignable(project: ProjectState, weatherId: number): boolean {
  if (weatherId >= 0 && weatherId <= STOCK_WEATHER_ID_MAX) return true;
  return Boolean(project.overworldWeather?.customEffects.some((effect) =>
    effect.id === weatherId && (!effect.clone || effect.clone.runtimeReady),
  ));
}

export function getHeaderWeatherId(row: HeaderRow): number {
  return getHeaderPackedValue(row, "weather_camera") & 0x3f;
}

export function assignWeatherToArea(project: ProjectState, rowId: number, weatherId: number): void {
  if (!isWeatherEffectAssignable(project, weatherId)) {
    throw new Error(`Weather ID ${weatherId} is not safe to assign. Import a custom runtime bundle for IDs ${CUSTOM_WEATHER_ID_MIN}–${CUSTOM_WEATHER_ID_MAX}.`);
  }
  updateHeaderPackedField(project, rowId, "weather_camera", "weather", String(weatherId));
}

export function assignWeatherToAreas(project: ProjectState, rowIds: Iterable<number>, weatherId: number): number {
  let changed = 0;
  for (const rowId of new Set(rowIds)) {
    const row = project.headers?.rows[rowId];
    if (!row || getHeaderWeatherId(row) === weatherId) continue;
    assignWeatherToArea(project, rowId, weatherId);
    changed += 1;
  }
  return changed;
}

export function weatherUsageCounts(project: ProjectState): Map<number, number> {
  if (!project.headers) project.headers = parseHeaders(project);
  const counts = new Map<number, number>();
  for (const row of Object.values(project.headers.rows)) {
    const id = getHeaderWeatherId(row);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function loadOverworldWeatherCalendar(project: ProjectState): Promise<OverworldWeatherCalendar> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the source ROM to read its calendar weather schedules.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.filenames.idOf(OVERWORLD_WEATHER_CALENDAR_PATH);
  if (fileId === undefined) throw new Error(`ROM path ${OVERWORLD_WEATHER_CALENDAR_PATH} was not found.`);
  return parseOverworldWeatherCalendar(getRomFileBytes(project, rom, fileId), OVERWORLD_WEATHER_CALENDAR_PATH);
}

export function parseOverworldWeatherCalendar(bytes: Uint8Array, sourcePath = OVERWORLD_WEATHER_CALENDAR_PATH): OverworldWeatherCalendar {
  const narc = new NARC(bytes);
  const weatherData = narc.files[0];
  const indexData = narc.files[1];
  if (!weatherData || !indexData) throw new Error(`Calendar archive ${sourcePath} must contain weather data and an index.`);
  if (indexData.length < 2) throw new Error(`Calendar archive ${sourcePath} has a truncated index.`);
  const entryCount = readU16(indexData, 0);
  if (entryCount === 0 || 2 + entryCount * 4 > indexData.length) {
    throw new Error(`Calendar archive ${sourcePath} has an invalid zone count (${entryCount}).`);
  }

  const zones = new Map<number, WeatherCalendarZone>();
  const warnings: string[] = [];
  for (let entry = 0; entry < entryCount; entry += 1) {
    const indexOffset = 2 + entry * 4;
    const zoneId = readU16(indexData, indexOffset);
    const dataOffset = readU16(indexData, indexOffset + 2);
    if (dataOffset + OVERWORLD_WEATHER_CALENDAR_DAY_COUNT > weatherData.length) {
      throw new Error(`Calendar schedule ${entry} for zone ${zoneId} extends past the weather data.`);
    }
    if (zones.has(zoneId)) warnings.push(`Calendar zone ${zoneId} appears more than once; the last schedule is shown.`);
    const weatherByDay = weatherData.slice(dataOffset, dataOffset + OVERWORLD_WEATHER_CALENDAR_DAY_COUNT);
    const weatherIds = [...new Set(weatherByDay)].sort((a, b) => a - b);
    zones.set(zoneId, { zoneId, weatherByDay, weatherIds, ranges: weatherCalendarRanges(weatherByDay) });
  }
  return { sourcePath, zones, warnings };
}

export function weatherCalendarRanges(weatherByDay: Uint8Array): WeatherCalendarRange[] {
  if (weatherByDay.length !== OVERWORLD_WEATHER_CALENDAR_DAY_COUNT) {
    throw new Error(`A calendar weather schedule must contain ${OVERWORLD_WEATHER_CALENDAR_DAY_COUNT} days.`);
  }
  const ranges: WeatherCalendarRange[] = [];
  let startDayIndex = 0;
  for (let dayIndex = 1; dayIndex <= weatherByDay.length; dayIndex += 1) {
    if (dayIndex < weatherByDay.length && weatherByDay[dayIndex] === weatherByDay[startDayIndex]) continue;
    ranges.push({ weatherId: weatherByDay[startDayIndex], startDayIndex, endDayIndex: dayIndex - 1 });
    startDayIndex = dayIndex;
  }
  return ranges;
}

export function weatherCalendarUsageCounts(calendar: OverworldWeatherCalendar): Map<number, number> {
  const counts = new Map<number, number>();
  for (const zone of calendar.zones.values()) {
    for (const weatherId of zone.weatherIds) counts.set(weatherId, (counts.get(weatherId) ?? 0) + 1);
  }
  return counts;
}

export function weatherCalendarDate(dayIndex: number): WeatherCalendarDate {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= OVERWORLD_WEATHER_CALENDAR_DAY_COUNT) {
    throw new Error(`Calendar day index must be between 0 and ${OVERWORLD_WEATHER_CALENDAR_DAY_COUNT - 1}.`);
  }
  const monthLengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remaining = dayIndex;
  for (let monthIndex = 0; monthIndex < monthLengths.length; monthIndex += 1) {
    if (remaining < monthLengths[monthIndex]) {
      const month = monthIndex + 1;
      return { month, day: remaining + 1, season: weatherCalendarSeason(month) };
    }
    remaining -= monthLengths[monthIndex];
  }
  throw new Error(`Could not resolve calendar day ${dayIndex}.`);
}

export function weatherCalendarSeason(month: number): WeatherCalendarDate["season"] {
  const seasonIndex = ((month - 1) % 4 + 4) % 4;
  return (["Spring", "Summer", "Autumn", "Winter"] as const)[seasonIndex];
}

export function parseOverworldWeatherBundle(bytes: Uint8Array, sourceFileName: string, baseVersion: BaseVersion): ParsedWeatherBundle {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch (error) {
    throw new Error(`The weather bundle is not a valid ZIP archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files: Record<string, Uint8Array> = {};
  for (const [rawPath, fileBytes] of Object.entries(archive)) files[normalizeBundlePath(rawPath)] = fileBytes;
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new Error("The weather bundle is missing manifest.json at its root.");
  let manifest: WeatherBundleManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as WeatherBundleManifest;
  } catch (error) {
    throw new Error(`The weather manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateManifest(manifest, files, baseVersion);
  return { manifest, sourceFileName, files };
}

export async function installOverworldWeatherBundle(
  project: ProjectState,
  parsed: ParsedWeatherBundle,
  options: { replaceExisting?: boolean } = {},
): Promise<OverworldWeatherCustomEffect> {
  const existing = project.overworldWeather?.customEffects.find((effect) => effect.id === parsed.manifest.id);
  if (existing && !options.replaceExisting) throw new Error(`Weather ID ${parsed.manifest.id} is already installed as ${existing.name}.`);
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the source ROM before importing a custom weather bundle.");
  const rom = new NintendoDSRom(romBytes);
  const runtime = parsed.manifest.runtime ?? {};
  if ((runtime.modules?.length ?? 0) > 0 && !getPmcInstallStatus(project).installed) await installBundledPmc(project);

  const modulePaths: string[] = [];
  for (const module of runtime.modules ?? []) {
    const result = stageCodeInjectionDll(project, basename(module.file), bundleFile(parsed, module.file), module.target ?? "patches", romBytes);
    modulePaths.push(result.path);
  }
  for (const item of runtime.romFiles ?? []) {
    const normalizedPath = normalizeRomPath(item.path);
    const fileId = rom.filenames.idOf(normalizedPath);
    if (fileId === undefined) addRomFile(project, normalizedPath, bundleFile(parsed, item.file));
    else replaceRomFile(project, rom, fileId, bundleFile(parsed, item.file));
  }
  for (const item of runtime.narcFiles ?? []) {
    const archivePath = normalizeRomPath(item.archivePath);
    const fileId = rom.filenames.idOf(archivePath);
    if (fileId === undefined) throw new Error(`The target NARC does not exist in this ROM: ${archivePath}`);
    if (item.operation === "replace") replaceNarcFile(project, rom, fileId, item.index!, bundleFile(parsed, item.file));
    else insertNarcFiles(project, rom, fileId, 0, [{ name: item.name ?? basename(item.file), bytes: bundleFile(parsed, item.file) }], "append");
  }

  const preview = parsed.manifest.preview;
  const particle = preview?.particle;
  const effect: OverworldWeatherCustomEffect = {
    id: parsed.manifest.id,
    name: parsed.manifest.name.trim(),
    description: parsed.manifest.description?.trim(),
    sourceFileName: parsed.sourceFileName,
    importedAt: new Date().toISOString(),
    runtimeModulePaths: modulePaths,
    preview: preview ? {
      imageBytes: preview.image ? bundleFile(parsed, preview.image).slice() : undefined,
      imageMime: preview.image ? imageMime(preview.image) : undefined,
      behavior: preview.behavior,
      tint: preview.tint,
      particle: particle ? {
        characterBytes: bundleFile(parsed, particle.character).slice(),
        paletteBytes: bundleFile(parsed, particle.palette).slice(),
        cellBytes: bundleFile(parsed, particle.cell).slice(),
        animationBytes: bundleFile(parsed, particle.animation).slice(),
      } : undefined,
    } : undefined,
  };
  project.overworldWeather ??= { customEffects: [] };
  project.overworldWeather.customEffects = project.overworldWeather.customEffects.filter((candidate) => candidate.id !== effect.id);
  project.overworldWeather.customEffects.push(effect);
  project.overworldWeather.customEffects.sort((a, b) => a.id - b.id);
  recordGenericChange(project, "headers", `Imported custom overworld weather ${effect.id}: ${effect.name}.`, `Weather ${effect.id}`, {
    key: `overworld-weather:${effect.id}`,
  });
  return effect;
}

export function bundleWeatherId(bytes: Uint8Array, sourceFileName: string, baseVersion: BaseVersion): number {
  return parseOverworldWeatherBundle(bytes, sourceFileName, baseVersion).manifest.id;
}

export async function loadOverworldWeatherPreview(project: ProjectState, weatherId: number): Promise<OverworldWeatherPreview> {
  const effect = getWeatherEffects(project).find((candidate) => candidate.id === weatherId);
  if (!effect) throw new Error(`Unknown weather ID: ${weatherId}`);
  const custom = project.overworldWeather?.customEffects.find((candidate) => candidate.id === weatherId);
  const runtime = custom?.clone?.runtime;
  const warnings: string[] = [];
  if (custom?.preview?.imageBytes) {
    return { effect, customImageBytes: custom.preview.imageBytes, customImageMime: custom.preview.imageMime, runtime, warnings };
  }
  if (custom?.preview?.particle) {
    const resource = custom.preview.particle;
    const particle = parseNitroCellEffect(`custom-weather-${weatherId}`, 0, 0, 0, 0, resource.characterBytes, resource.paletteBytes, resource.cellBytes, resource.animationBytes, { originCentered: true });
    return { effect, particle, runtime, warnings: [...warnings, ...particle.warnings] };
  }
  if (!effect.particleResource) return { effect, runtime, warnings };
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) return { effect, warnings: ["Reload the source ROM to decode the original weather particle graphics."] };
  try {
    const rom = new NintendoDSRom(romBytes);
    const fileId = rom.filenames.idOf(OVERWORLD_WEATHER_ARCHIVE_PATH);
    if (fileId === undefined) throw new Error(`ROM path ${OVERWORLD_WEATHER_ARCHIVE_PATH} was not found`);
    const narc = new NARC(getRomFileBytes(project, rom, fileId));
    const resource = effect.particleResource;
    const particle = parseNitroCellEffect(
      `weather-${weatherId}`,
      resource.character,
      resource.palette,
      resource.cell,
      resource.animation,
      requireNarcMember(narc, resource.character),
      requireNarcMember(narc, resource.palette),
      requireNarcMember(narc, resource.cell),
      requireNarcMember(narc, resource.animation),
      { originCentered: true },
    );
    return { effect, particle, runtime, warnings: [...warnings, ...particle.warnings] };
  } catch (error) {
    return { effect, runtime, warnings: [error instanceof Error ? error.message : String(error)] };
  }
}

export { nitroCellEffectFrameAt };

function customDefinition(effect: OverworldWeatherCustomEffect): WeatherEffectDefinition {
  const clone = effect.clone;
  return {
    id: effect.id,
    name: effect.name,
    description: effect.description || (clone ? `Cloned from weather ${clone.donorId}.` : `Imported from ${effect.sourceFileName}.`),
    status: "custom",
    behavior: previewBehavior(clone?.behavior ?? effect.preview?.behavior),
    channels: clone?.channels ?? [effect.preview?.particle ? "particles" : "custom runtime"],
    tint: clone?.runtime.fogColor || clone?.tint || effect.preview?.tint,
    particleResource: clone?.particleResource,
    sourceFileName: effect.sourceFileName,
  };
}

function previewBehavior(value: string | undefined): WeatherPreviewBehavior {
  return value === "snow" || value === "rain" || value === "sand" || value === "hail" || value === "diamond" || value === "fog" || value === "mirage" ? value : "clear";
}

function validateManifest(manifest: WeatherBundleManifest, files: Record<string, Uint8Array>, baseVersion: BaseVersion): void {
  if (!manifest || manifest.format !== "pokeweb-overworld-weather" || manifest.version !== 1) {
    throw new Error('manifest.json must declare format "pokeweb-overworld-weather" and version 1.');
  }
  if (!Number.isInteger(manifest.id) || manifest.id < CUSTOM_WEATHER_ID_MIN || manifest.id > CUSTOM_WEATHER_ID_MAX) {
    throw new Error(`Custom weather ID must be an integer from ${CUSTOM_WEATHER_ID_MIN} to ${CUSTOM_WEATHER_ID_MAX}. IDs 0–${STOCK_WEATHER_ID_MAX} belong to the retail game.`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("Custom weather name is required.");
  if (manifest.baseVersions && !manifest.baseVersions.includes(baseVersion)) throw new Error(`This weather bundle does not support ${baseVersion}.`);
  const runtime = manifest.runtime;
  if (!(runtime?.external || runtime?.modules?.length)) {
    throw new Error("A custom weather bundle must include runtime.modules or declare runtime.external as true.");
  }
  for (const module of runtime.modules ?? []) {
    requireBundlePath(module.file, files);
    if (module.target && module.target !== "patches" && module.target !== "lib") throw new Error(`Invalid DLL target for ${module.file}.`);
  }
  for (const item of runtime.romFiles ?? []) {
    requireBundlePath(item.file, files);
    normalizeRomPath(item.path);
  }
  for (const item of runtime.narcFiles ?? []) {
    requireBundlePath(item.file, files);
    normalizeRomPath(item.archivePath);
    if (item.operation !== "append" && item.operation !== "replace") throw new Error(`Invalid NARC operation for ${item.file}.`);
    if (item.operation === "replace" && (!Number.isInteger(item.index) || item.index! < 0)) throw new Error(`NARC replacement ${item.file} requires a non-negative index.`);
  }
  if (manifest.preview?.image) requireBundlePath(manifest.preview.image, files);
  const particle = manifest.preview?.particle;
  if (particle) {
    requireBundlePath(particle.character, files);
    requireBundlePath(particle.palette, files);
    requireBundlePath(particle.cell, files);
    requireBundlePath(particle.animation, files);
  }
}

function bundleFile(parsed: ParsedWeatherBundle, path: string): Uint8Array {
  return parsed.files[normalizeBundlePath(path)] ?? (() => { throw new Error(`Bundle file not found: ${path}`); })();
}

function requireBundlePath(path: string, files: Record<string, Uint8Array>): void {
  if (typeof path !== "string" || !files[normalizeBundlePath(path)]) throw new Error(`Bundle file not found: ${String(path)}`);
}

function normalizeBundlePath(path: string): string {
  if (typeof path !== "string") throw new Error("Bundle paths must be strings.");
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) throw new Error(`Unsafe bundle path: ${path}`);
  return normalized;
}

function normalizeRomPath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe ROM path: ${path}`);
  return normalized;
}

function basename(path: string): string {
  return normalizeBundlePath(path).split("/").pop() || "weather.dll";
}

function imageMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function requireNarcMember(narc: NARC, index: number): Uint8Array {
  const bytes = narc.files[index];
  if (!bytes) throw new Error(`Weather graphics archive is missing member ${index}`);
  return bytes;
}
