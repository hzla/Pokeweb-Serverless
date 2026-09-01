import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { OverworldWeatherCustomEffect, ProjectState } from "./projectStore";
import { normalizeWeatherCloneRuntime, WEATHER_FOG_DEFAULT_TABLE } from "./overworldWeatherRuntimeModel";

export const OVERWORLD_WEATHER_REGISTRY_PATH = "weather/pwth.bin";
export const OVERWORLD_WEATHER_REGISTRY_MAGIC = "PWTH";
export const OVERWORLD_WEATHER_REGISTRY_VERSION = 2;
export const OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE = 16;
export const OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE = 68;
export const OVERWORLD_WEATHER_FIRST_CUSTOM_ID = 15;
export const OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT = 49;
export const OVERWORLD_WEATHER_LAST_CUSTOM_ID = 63;
export const OVERWORLD_WEATHER_UNUSED_RESOURCE = 0xffff;

export const enum WeatherRegistryChannel {
  ParticleOam = 1 << 0,
  BgFront = 1 << 1,
  BgBack = 1 << 2,
  Fog = 1 << 3,
  Lighting = 1 << 4,
  Sound = 1 << 5,
}

export type OverworldWeatherRegistryEntry = {
  weatherId: number;
  enabled: boolean;
  donorBehaviorId: number;
  channelFlags: number;
  animationMemberId: number;
  cellMemberId: number;
  characterMemberId: number;
  paletteMemberId: number;
  auxiliaryMemberIds: [number, number];
  particleDensityQ8_8: number;
  movementSpeedQ8_8: number;
  fogOffset: number;
  fogRed5: number;
  fogGreen5: number;
  fogBlue5: number;
  fogSlope: number;
  screenScrollSpeedQ8_8: number;
  fogFadeInFrames: number;
  fogFadeOutFrames: number;
  entryFlags: number;
  fogTable: number[];
};

export type OverworldWeatherRegistry = {
  formatVersion: number;
  entrySize: number;
  firstCustomId: number;
  entryCount: number;
  flags: number;
  entries: OverworldWeatherRegistryEntry[];
};

export function createEmptyOverworldWeatherRegistry(): Uint8Array {
  return writeOverworldWeatherRegistry([]);
}

export function serializeProjectOverworldWeatherRegistry(project: ProjectState): Uint8Array {
  const entries = (project.overworldWeather?.customEffects ?? [])
    .filter((effect) => effect.clone?.runtimeReady)
    .map(registryEntryFromClone);
  return writeOverworldWeatherRegistry(entries);
}

export function writeOverworldWeatherRegistry(entries: Iterable<OverworldWeatherRegistryEntry>): Uint8Array {
  const size = OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE
    + OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE * OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT;
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode(OVERWORLD_WEATHER_REGISTRY_MAGIC), 0);
  writeU16(bytes, 4, OVERWORLD_WEATHER_REGISTRY_VERSION);
  writeU16(bytes, 6, OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE);
  bytes[8] = OVERWORLD_WEATHER_FIRST_CUSTOM_ID;
  bytes[9] = OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT;
  writeU16(bytes, 10, OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE);
  writeU32(bytes, 12, 0);

  for (let index = 0; index < OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT; index += 1) {
    writeRegistryEntry(bytes, index, emptyEntry(OVERWORLD_WEATHER_FIRST_CUSTOM_ID + index));
  }
  for (const entry of entries) {
    if (!Number.isInteger(entry.weatherId) || entry.weatherId < OVERWORLD_WEATHER_FIRST_CUSTOM_ID || entry.weatherId > OVERWORLD_WEATHER_LAST_CUSTOM_ID) {
      throw new Error(`PWTH weather ID must be ${OVERWORLD_WEATHER_FIRST_CUSTOM_ID}–${OVERWORLD_WEATHER_LAST_CUSTOM_ID}.`);
    }
    writeRegistryEntry(bytes, entry.weatherId - OVERWORLD_WEATHER_FIRST_CUSTOM_ID, entry);
  }
  return bytes;
}

export function parseOverworldWeatherRegistry(bytes: Uint8Array): OverworldWeatherRegistry {
  const expectedSize = OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE
    + OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE * OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT;
  if (bytes.length !== expectedSize) throw new Error(`PWTH registry must be exactly ${expectedSize} bytes.`);
  if (readAscii(bytes, 0, 4) !== OVERWORLD_WEATHER_REGISTRY_MAGIC) throw new Error("PWTH registry magic is missing.");
  const formatVersion = readU16(bytes, 4);
  const entrySize = readU16(bytes, 6);
  const firstCustomId = bytes[8];
  const entryCount = bytes[9];
  const headerSize = readU16(bytes, 10);
  const flags = readU32(bytes, 12);
  if (formatVersion !== OVERWORLD_WEATHER_REGISTRY_VERSION || entrySize !== OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE
    || firstCustomId !== OVERWORLD_WEATHER_FIRST_CUSTOM_ID || entryCount !== OVERWORLD_WEATHER_CUSTOM_ENTRY_COUNT
    || headerSize !== OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE || flags !== 0) {
    throw new Error("Unsupported PWTH registry header.");
  }
  return {
    formatVersion,
    entrySize,
    firstCustomId,
    entryCount,
    flags,
    entries: Array.from({ length: entryCount }, (_unused, index) => readRegistryEntry(bytes, index)),
  };
}

function registryEntryFromClone(effect: OverworldWeatherCustomEffect): OverworldWeatherRegistryEntry {
  const clone = effect.clone!;
  const runtime = normalizeWeatherCloneRuntime(clone.runtime);
  const particle = clone.particleResource;
  const auxiliary: [number, number] = [
    clone.auxiliaryResourceIds[0] ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
    clone.auxiliaryResourceIds[1] ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
  ];
  let channelFlags = 0;
  if (particle) channelFlags |= WeatherRegistryChannel.ParticleOam;
  if (clone.auxiliaryResourceIds.length >= 1) channelFlags |= WeatherRegistryChannel.BgFront;
  if (clone.auxiliaryResourceIds.length >= 2) channelFlags |= WeatherRegistryChannel.BgBack;
  if (clone.behavior === "fog" || clone.channels.includes("fog")) channelFlags |= WeatherRegistryChannel.Fog;
  if (clone.channels.includes("lighting")) channelFlags |= WeatherRegistryChannel.Lighting;
  if (clone.channels.includes("sound")) channelFlags |= WeatherRegistryChannel.Sound;
  const [fogRed5, fogGreen5, fogBlue5] = rgb5(runtime.fogColor);
  return {
    weatherId: effect.id,
    enabled: true,
    donorBehaviorId: clone.donorId,
    channelFlags,
    animationMemberId: particle?.animation ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
    cellMemberId: particle?.cell ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
    characterMemberId: particle?.character ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
    paletteMemberId: particle?.palette ?? OVERWORLD_WEATHER_UNUSED_RESOURCE,
    auxiliaryMemberIds: auxiliary,
    particleDensityQ8_8: q8_8(runtime.particleDensity, 0, 4),
    movementSpeedQ8_8: q8_8(runtime.movementSpeed, 0, 4),
    fogOffset: runtime.fogOffset,
    fogRed5,
    fogGreen5,
    fogBlue5,
    fogSlope: runtime.fogSlope,
    screenScrollSpeedQ8_8: signedQ8_8(runtime.screenScrollSpeed, -4, 4),
    fogFadeInFrames: runtime.fogFadeInFrames,
    fogFadeOutFrames: runtime.fogFadeOutFrames,
    entryFlags: 0,
    fogTable: [...runtime.fogTable],
  };
}

function emptyEntry(weatherId: number): OverworldWeatherRegistryEntry {
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
    fogOffset: 32575,
    fogRed5: 27,
    fogGreen5: 28,
    fogBlue5: 28,
    fogSlope: 9,
    screenScrollSpeedQ8_8: 0x0100,
    fogFadeInFrames: 90,
    fogFadeOutFrames: 50,
    entryFlags: 0,
    fogTable: [...WEATHER_FOG_DEFAULT_TABLE],
  };
}

function entryOffset(index: number): number {
  return OVERWORLD_WEATHER_REGISTRY_HEADER_SIZE + index * OVERWORLD_WEATHER_REGISTRY_ENTRY_SIZE;
}

function writeRegistryEntry(bytes: Uint8Array, index: number, entry: OverworldWeatherRegistryEntry): void {
  const offset = entryOffset(index);
  bytes[offset] = entry.enabled ? 1 : 0;
  bytes[offset + 1] = entry.donorBehaviorId & 0xff;
  writeU16(bytes, offset + 2, entry.channelFlags);
  writeU16(bytes, offset + 4, entry.animationMemberId);
  writeU16(bytes, offset + 6, entry.cellMemberId);
  writeU16(bytes, offset + 8, entry.characterMemberId);
  writeU16(bytes, offset + 10, entry.paletteMemberId);
  writeU16(bytes, offset + 12, entry.auxiliaryMemberIds[0]);
  writeU16(bytes, offset + 14, entry.auxiliaryMemberIds[1]);
  writeU16(bytes, offset + 16, entry.particleDensityQ8_8);
  writeU16(bytes, offset + 18, entry.movementSpeedQ8_8);
  writeU16(bytes, offset + 20, entry.fogOffset);
  bytes[offset + 22] = entry.fogRed5;
  bytes[offset + 23] = entry.fogGreen5;
  bytes[offset + 24] = entry.fogBlue5;
  bytes[offset + 25] = entry.fogSlope;
  writeU16(bytes, offset + 26, entry.screenScrollSpeedQ8_8 & 0xffff);
  writeU16(bytes, offset + 28, entry.fogFadeInFrames);
  writeU16(bytes, offset + 30, entry.fogFadeOutFrames);
  writeU32(bytes, offset + 32, entry.entryFlags);
  for (let tableIndex = 0; tableIndex < 32; tableIndex += 1) {
    bytes[offset + 36 + tableIndex] = Math.max(0, Math.min(127, Math.round(entry.fogTable[tableIndex] ?? 0)));
  }
}

function readRegistryEntry(bytes: Uint8Array, index: number): OverworldWeatherRegistryEntry {
  const offset = entryOffset(index);
  const signedScroll = readU16(bytes, offset + 26);
  return {
    weatherId: OVERWORLD_WEATHER_FIRST_CUSTOM_ID + index,
    enabled: bytes[offset] === 1,
    donorBehaviorId: bytes[offset + 1],
    channelFlags: readU16(bytes, offset + 2),
    animationMemberId: readU16(bytes, offset + 4),
    cellMemberId: readU16(bytes, offset + 6),
    characterMemberId: readU16(bytes, offset + 8),
    paletteMemberId: readU16(bytes, offset + 10),
    auxiliaryMemberIds: [readU16(bytes, offset + 12), readU16(bytes, offset + 14)],
    particleDensityQ8_8: readU16(bytes, offset + 16),
    movementSpeedQ8_8: readU16(bytes, offset + 18),
    fogOffset: readU16(bytes, offset + 20),
    fogRed5: bytes[offset + 22],
    fogGreen5: bytes[offset + 23],
    fogBlue5: bytes[offset + 24],
    fogSlope: bytes[offset + 25],
    screenScrollSpeedQ8_8: signedScroll & 0x8000 ? signedScroll - 0x10000 : signedScroll,
    fogFadeInFrames: readU16(bytes, offset + 28),
    fogFadeOutFrames: readU16(bytes, offset + 30),
    entryFlags: readU32(bytes, offset + 32),
    fogTable: [...bytes.slice(offset + 36, offset + 68)],
  };
}

function q8_8(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)) * 256);
}

function signedQ8_8(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)) * 256);
}

function rgb5(hex: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/iu.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0xd5e2e5;
  return [((value >>> 16) & 0xff) >>> 3, ((value >>> 8) & 0xff) >>> 3, (value & 0xff) >>> 3];
}
