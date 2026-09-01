import type { OverworldWeatherCustomEffect } from "./projectStore";

export type WeatherCloneRuntime = NonNullable<NonNullable<OverworldWeatherCustomEffect["clone"]>["runtime"]>;

export const WEATHER_FOG_DEPTH_START = 32735;
export const WEATHER_FOG_DEFAULT_DEPTH_DELTA = 160;
export const WEATHER_FOG_DEFAULT_SLOPE = 9;
export const WEATHER_FOG_DEFAULT_FADE_IN_FRAMES = 90;
export const WEATHER_FOG_DEFAULT_FADE_OUT_FRAMES = 50;
export const WEATHER_FOG_DEFAULT_TABLE = Object.freeze([
  0, 4, 8, 12, 16, 20, 24, 28,
  33, 37, 41, 45, 49, 53, 57, 61,
  66, 70, 74, 78, 82, 86, 90, 94,
  99, 103, 107, 111, 115, 119, 123, 127,
]);

export const WEATHER_FOG_SLOPES = Object.freeze([
  { value: 0, ratio: "0x8000" },
  { value: 1, ratio: "0x4000" },
  { value: 2, ratio: "0x2000" },
  { value: 3, ratio: "0x1000" },
  { value: 4, ratio: "0x0800" },
  { value: 5, ratio: "0x0400" },
  { value: 6, ratio: "0x0200" },
  { value: 7, ratio: "0x0100" },
  { value: 8, ratio: "0x0080" },
  { value: 9, ratio: "0x0040" },
  { value: 10, ratio: "0x0020" },
]);

export function normalizeWeatherCloneRuntime(runtime: Partial<WeatherCloneRuntime> | undefined): WeatherCloneRuntime {
  const sourceTable = Array.isArray(runtime?.fogTable) ? runtime.fogTable : WEATHER_FOG_DEFAULT_TABLE;
  return {
    particleDensity: clampNumber(runtime?.particleDensity ?? 1, 0, 4),
    movementSpeed: clampNumber(runtime?.movementSpeed ?? 1, 0, 4),
    fogOffset: clampInteger(runtime?.fogOffset ?? WEATHER_FOG_DEPTH_START - WEATHER_FOG_DEFAULT_DEPTH_DELTA, 0, 32767),
    fogSlope: clampInteger(runtime?.fogSlope ?? WEATHER_FOG_DEFAULT_SLOPE, 0, 10),
    fogTable: Array.from({ length: 32 }, (_unused, index) => clampInteger(sourceTable[index] ?? WEATHER_FOG_DEFAULT_TABLE[index], 0, 127)),
    fogFadeInFrames: clampInteger(runtime?.fogFadeInFrames ?? WEATHER_FOG_DEFAULT_FADE_IN_FRAMES, 1, 600),
    fogFadeOutFrames: clampInteger(runtime?.fogFadeOutFrames ?? WEATHER_FOG_DEFAULT_FADE_OUT_FRAMES, 1, 600),
    fogColor: /^#[0-9a-f]{6}$/iu.test(runtime?.fogColor ?? "") ? runtime!.fogColor! : "#d5e2e5",
    screenScrollSpeed: clampNumber(runtime?.screenScrollSpeed ?? 1, -4, 4),
  };
}

export function previewFogStrength(runtime: WeatherCloneRuntime | undefined): number {
  if (!runtime) return 1;
  const normalized = normalizeWeatherCloneRuntime(runtime);
  const reach = Math.max(0, WEATHER_FOG_DEPTH_START - normalized.fogOffset) / WEATHER_FOG_DEFAULT_DEPTH_DELTA;
  const tableStrength = Math.max(...normalized.fogTable) / 127;
  return Math.max(0, Math.min(2, reach * tableStrength));
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}
