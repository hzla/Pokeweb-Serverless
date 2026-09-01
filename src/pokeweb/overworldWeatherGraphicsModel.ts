import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, insertNarcFiles, replaceNarcFile } from "./fileSystemModel";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";
import {
  parsePokemonAnimation,
  parsePokemonCellBank,
  type PokemonAnimation,
  type PokemonCellBank,
} from "./pokemonSpriteModel";
import { buildPokemonAnimationFile, buildPokemonCellBankFileFromParsed } from "./pokemonSpriteWriters";
import { loadActiveRomBytes } from "./persistence";
import {
  detectBundledOverworldWeatherRuntime,
  installBundledOverworldWeatherRuntime,
  syncBundledOverworldWeatherRegistry,
} from "./pmcModel";
import type { OverworldWeatherCustomEffect, ProjectState } from "./projectStore";
import {
  cloneWeatherLightingResource,
  loadWeatherLightingDocument,
  type WeatherLightingDocument,
} from "./overworldWeatherLightingModel";
import {
  CUSTOM_WEATHER_ID_MAX,
  CUSTOM_WEATHER_ID_MIN,
  OVERWORLD_WEATHER_ARCHIVE_PATH,
  getWeatherEffects,
  type WeatherEffectDefinition,
  type WeatherPreviewBehavior,
} from "./overworldWeatherModel";
import {
  normalizeWeatherCloneRuntime,
  WEATHER_FOG_DEFAULT_FADE_IN_FRAMES,
  WEATHER_FOG_DEFAULT_FADE_OUT_FRAMES,
  WEATHER_FOG_DEFAULT_SLOPE,
  WEATHER_FOG_DEFAULT_TABLE,
  WEATHER_FOG_DEPTH_START,
  WEATHER_FOG_DEFAULT_DEPTH_DELTA,
  type WeatherCloneRuntime,
} from "./overworldWeatherRuntimeModel";

export type WeatherCharacterData = {
  memberId: number;
  bitsPerPixel: 4 | 8;
  dataOffset: number;
  dataSize: number;
  tileCount: number;
  tilesWide: number;
  width: number;
  height: number;
  indices: Uint8Array;
  bytes: Uint8Array;
};

export type WeatherPaletteData = {
  memberId: number;
  dataOffset: number;
  colors: NitroPaletteData;
  bytes: Uint8Array;
};

export type WeatherParticleDocument = {
  resource: NonNullable<WeatherEffectDefinition["particleResource"]>;
  character: WeatherCharacterData;
  palette: WeatherPaletteData;
  cellBank: PokemonCellBank;
  animation: PokemonAnimation;
  cellBytes: Uint8Array;
  animationBytes: Uint8Array;
};

export type WeatherAuxiliaryResource = {
  memberId: number;
  magic: string;
  byteLength: number;
  role: string;
  bytes: Uint8Array;
};

export type WeatherGraphicsDocument = {
  effect: WeatherEffectDefinition;
  particle?: WeatherParticleDocument;
  lighting?: WeatherLightingDocument;
  auxiliary: WeatherAuxiliaryResource[];
  sharedResources: Array<{ memberId: number; effectIds: number[] }>;
  clone?: OverworldWeatherCustomEffect["clone"];
};

const STOCK_AUXILIARY_RESOURCES: Record<number, Array<{ memberId: number; role: string }>> = {
  4: [{ memberId: 42, role: "Blizzard foreground plane (BTX0)" }],
  6: [{ memberId: 41, role: "Thunder-rain foreground plane (BTX0)" }],
  7: [
    { memberId: 40, role: "Wind-rain front plane (BTX0)" },
    { memberId: 39, role: "Wind plane (BTX0)" },
  ],
  12: [{ memberId: 43, role: "Strong-sandstorm foreground plane (BTX0)" }],
  17: [
    { memberId: 8, role: "Dormant mirage tiles (NCGR)" },
    { memberId: 9, role: "Dormant mirage palette (NCLR)" },
    { memberId: 10, role: "Dormant mirage tile map (NSCR)" },
  ],
};

export async function loadWeatherGraphicsDocument(project: ProjectState, weatherId: number): Promise<WeatherGraphicsDocument> {
  const effect = getWeatherEffects(project).find((candidate) => candidate.id === weatherId);
  if (!effect) throw new Error(`Unknown weather ID ${weatherId}.`);
  const { narc } = await loadWeatherNarc(project);
  const particle = effect.particleResource ? parseParticleDocument(narc, effect.particleResource) : undefined;
  const auxiliaryRefs = weatherAuxiliaryResourceRefs(project, weatherId);
  const auxiliary = auxiliaryRefs.map(({ memberId, role }) => {
    const bytes = requireMember(narc, memberId);
    return { memberId, role, bytes, magic: readAscii(bytes, 0, Math.min(4, bytes.length)), byteLength: bytes.length };
  });
  const referenced = new Set<number>([
    ...(effect.particleResource ? Object.values(effect.particleResource) : []),
    ...auxiliaryRefs.map((entry) => entry.memberId),
  ]);
  const sharedResources = [...referenced]
    .map((memberId) => ({ memberId, effectIds: weatherEffectsReferencingMember(project, memberId) }))
    .filter((entry) => entry.effectIds.length > 1);
  const clone = project.overworldWeather?.customEffects.find((candidate) => candidate.id === weatherId)?.clone;
  if (clone) clone.runtime = normalizeWeatherCloneRuntime(clone.runtime);
  const lighting = await loadWeatherLightingDocument(project, weatherId);
  return { effect, particle, lighting, auxiliary, sharedResources, clone };
}

export async function cloneWeatherEffect(
  project: ProjectState,
  donorId: number,
  targetId: number,
  name: string,
): Promise<OverworldWeatherCustomEffect> {
  if (!Number.isInteger(targetId) || targetId < CUSTOM_WEATHER_ID_MIN || targetId > CUSTOM_WEATHER_ID_MAX) {
    throw new Error(`Custom weather ID must be ${CUSTOM_WEATHER_ID_MIN}–${CUSTOM_WEATHER_ID_MAX}.`);
  }
  if (targetId === donorId) throw new Error("The clone must use a different weather ID from its donor.");
  if (project.overworldWeather?.customEffects.some((effect) => effect.id === targetId)) {
    throw new Error(`Custom weather ID ${targetId} is already in use.`);
  }
  const donor = getWeatherEffects(project).find((effect) => effect.id === donorId);
  if (!donor) throw new Error(`Donor weather ${donorId} does not exist.`);
  const donorClone = project.overworldWeather?.customEffects.find((effect) => effect.id === donorId)?.clone;
  const donorBehaviorId = donorId <= 14 ? donorId : donorClone?.donorId;
  if (donorBehaviorId === undefined || donorBehaviorId < 0 || donorBehaviorId > 14) {
    throw new Error("A clone must ultimately use a retail donor behavior from ID 0–14.");
  }
  const cleanName = name.trim();
  if (!cleanName) throw new Error("A name is required for the cloned weather.");
  if (detectBundledOverworldWeatherRuntime(project) !== "patched") {
    await installBundledOverworldWeatherRuntime(project);
  }

  const { rom, fileId, narc } = await loadWeatherNarc(project);
  const donorAuxiliary = weatherAuxiliaryResourceRefs(project, donorId);
  const sourceIds = [...new Set([
    ...(donor.particleResource ? Object.values(donor.particleResource) : []),
    ...donorAuxiliary.map((entry) => entry.memberId),
  ])];
  const firstNewId = narc.files.length;
  const remap = new Map<number, number>();
  sourceIds.forEach((sourceId, index) => remap.set(sourceId, firstNewId + index));
  if (sourceIds.length) {
    insertNarcFiles(
      project,
      rom,
      fileId,
      0,
      sourceIds.map((sourceId) => ({ name: `weather_${targetId}_copy_${sourceId}.bin`, bytes: requireMember(narc, sourceId).slice() })),
      "append",
    );
  }

  const lightingResourceId = await cloneWeatherLightingResource(project, donorId, targetId);

  const behavior = donor.behavior;
  const runtime = defaultCloneRuntime(behavior, donor.channels, donor.tint);
  const channels = [...donor.channels];
  if (lightingResourceId !== undefined && !channels.includes("lighting")) channels.push("lighting");
  const clone: NonNullable<OverworldWeatherCustomEffect["clone"]> = {
    donorId: donorBehaviorId,
    behavior,
    channels,
    tint: donor.tint,
    runtimeReady: true,
    particleResource: donor.particleResource ? {
      animation: remap.get(donor.particleResource.animation)!,
      cell: remap.get(donor.particleResource.cell)!,
      character: remap.get(donor.particleResource.character)!,
      palette: remap.get(donor.particleResource.palette)!,
    } : undefined,
    auxiliaryResourceIds: donorAuxiliary.map((entry) => remap.get(entry.memberId)!),
    lightingResourceId,
    runtime,
  };
  const effect: OverworldWeatherCustomEffect = {
    id: targetId,
    name: cleanName,
    description: `Independent clone of weather ${donorId}: ${donor.name}.`,
    sourceFileName: "Created in Weather Graphics",
    importedAt: new Date().toISOString(),
    runtimeModulePaths: [],
    clone,
  };
  project.overworldWeather ??= { customEffects: [] };
  project.overworldWeather.customEffects.push(effect);
  project.overworldWeather.customEffects.sort((left, right) => left.id - right.id);
  await syncBundledOverworldWeatherRegistry(project);
  recordGenericChange(project, "file_system", `Cloned overworld weather ${donorId} to custom ID ${targetId}.`, `Weather ${targetId}`, {
    key: `overworld-weather-clone:${targetId}`,
  });
  return effect;
}

export async function updateWeatherPaletteColor(project: ProjectState, weatherId: number, colorIndex: number, hex: string): Promise<void> {
  const document = await loadWeatherGraphicsDocument(project, weatherId);
  const palette = document.particle?.palette;
  if (!palette) throw new Error("This weather has no sprite palette.");
  if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= palette.colors.length) throw new Error("Palette color is out of range.");
  const bytes = await weatherMemberBytes(project, palette.memberId);
  writeU16(bytes, palette.dataOffset + colorIndex * 2, hexToBgr555(hex));
  await replaceWeatherMember(project, palette.memberId, bytes, `Updated weather ${weatherId} palette color ${colorIndex}.`);
}

export async function updateWeatherAnimation(project: ProjectState, weatherId: number, animation: PokemonAnimation): Promise<void> {
  const document = await loadWeatherGraphicsDocument(project, weatherId);
  const memberId = document.particle?.resource.animation;
  if (memberId === undefined) throw new Error("This weather has no NANR animation.");
  const bytes = buildPokemonAnimationFile(animation.sequences);
  await replaceWeatherMember(project, memberId, bytes, `Updated weather ${weatherId} NANR animation.`);
}

export async function updateWeatherCellBank(project: ProjectState, weatherId: number, cellBank: PokemonCellBank): Promise<void> {
  const document = await loadWeatherGraphicsDocument(project, weatherId);
  const memberId = document.particle?.resource.cell;
  if (memberId === undefined) throw new Error("This weather has no NCER cell bank.");
  const bytes = buildPokemonCellBankFileFromParsed(cellBank);
  await replaceWeatherMember(project, memberId, bytes, `Updated weather ${weatherId} NCER cells.`);
}

export async function updateWeatherCharacterIndices(project: ProjectState, weatherId: number, indices: Uint8Array): Promise<void> {
  const document = await loadWeatherGraphicsDocument(project, weatherId);
  const character = document.particle?.character;
  if (!character) throw new Error("This weather has no NCGR character graphics.");
  if (indices.length !== character.width * character.height) throw new Error(`Expected ${character.width}×${character.height} indexed pixels.`);
  const bytes = await weatherMemberBytes(project, character.memberId);
  const bytesPerTile = character.bitsPerPixel === 4 ? 32 : 64;
  for (let tile = 0; tile < character.tileCount; tile += 1) {
    const tileX = tile % character.tilesWide;
    const tileY = Math.floor(tile / character.tilesWide);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const value = indices[(tileY * 8 + y) * character.width + tileX * 8 + x] ?? 0;
        const offset = character.dataOffset + tile * bytesPerTile + y * (character.bitsPerPixel === 4 ? 4 : 8) + (character.bitsPerPixel === 4 ? Math.floor(x / 2) : x);
        if (character.bitsPerPixel === 8) bytes[offset] = value & 0xff;
        else bytes[offset] = x % 2 === 0 ? (bytes[offset] & 0xf0) | (value & 0x0f) : (bytes[offset] & 0x0f) | ((value & 0x0f) << 4);
      }
    }
  }
  await replaceWeatherMember(project, character.memberId, bytes, `Updated weather ${weatherId} NCGR pixels.`);
}

export async function replaceWeatherResource(project: ProjectState, memberId: number, bytes: Uint8Array): Promise<void> {
  const current = await weatherMemberBytes(project, memberId);
  const expectedMagic = readAscii(current, 0, Math.min(4, current.length));
  const nextMagic = readAscii(bytes, 0, Math.min(4, bytes.length));
  if (expectedMagic !== nextMagic) throw new Error(`Expected a ${expectedMagic} resource, but the imported file is ${nextMagic || "empty"}.`);
  await replaceWeatherMember(project, memberId, bytes.slice(), `Replaced weather graphics member ${memberId}.`);
}

export async function updateWeatherCloneRuntime(project: ProjectState, weatherId: number, update: Partial<WeatherCloneRuntime>): Promise<void> {
  const effect = project.overworldWeather?.customEffects.find((candidate) => candidate.id === weatherId);
  if (!effect?.clone) throw new Error("Runtime template values can only be changed on a cloned custom weather.");
  const current = normalizeWeatherCloneRuntime(effect.clone.runtime);
  effect.clone.runtime = normalizeWeatherCloneRuntime({ ...current, ...update });
  effect.clone.tint = effect.clone.runtime.fogColor;
  await syncBundledOverworldWeatherRegistry(project);
  recordGenericChange(project, "file_system", `Updated custom weather ${weatherId} runtime template.`, `Weather ${weatherId}`, {
    key: `overworld-weather-runtime:${weatherId}`,
  });
}

export function weatherAuxiliaryResourceRefs(project: ProjectState, weatherId: number): Array<{ memberId: number; role: string }> {
  const clone = project.overworldWeather?.customEffects.find((effect) => effect.id === weatherId)?.clone;
  if (clone) {
    const donorRoles = weatherAuxiliaryResourceRefs(project, clone.donorId);
    return clone.auxiliaryResourceIds.map((memberId, index) => ({ memberId, role: donorRoles[index]?.role ?? `Auxiliary graphics ${index + 1}` }));
  }
  return STOCK_AUXILIARY_RESOURCES[weatherId]?.map((entry) => ({ ...entry })) ?? [];
}

function parseParticleDocument(narc: NARC, resource: NonNullable<WeatherEffectDefinition["particleResource"]>): WeatherParticleDocument {
  const characterBytes = requireMember(narc, resource.character);
  const paletteBytes = requireMember(narc, resource.palette);
  const cellBytes = requireMember(narc, resource.cell);
  const animationBytes = requireMember(narc, resource.animation);
  return {
    resource,
    character: parseCharacter(resource.character, characterBytes),
    palette: parsePalette(resource.palette, paletteBytes),
    cellBank: parsePokemonCellBank(cellBytes),
    animation: parsePokemonAnimation(animationBytes),
    cellBytes,
    animationBytes,
  };
}

function parseCharacter(memberId: number, bytes: Uint8Array): WeatherCharacterData {
  if (readAscii(bytes, 0, 4) !== "RGCN") throw new Error(`Weather member ${memberId} is not NCGR character data.`);
  const block = findBlock(bytes, "RAHC");
  if (block < 0) throw new Error(`Weather NCGR ${memberId} has no RAHC block.`);
  const depth = readU32(bytes, block + 12);
  const bitsPerPixel = depth === 4 ? 8 : 4;
  const bytesPerTile = bitsPerPixel === 4 ? 32 : 64;
  const dataSize = Math.min(readU32(bytes, block + 24), Math.max(0, bytes.length - (block + 32)));
  const dataOffset = block + 32;
  const tileCount = Math.floor(dataSize / bytesPerTile);
  const declaredWidth = readU16(bytes, block + 10);
  const tilesWide = declaredWidth !== 0xffff && declaredWidth > 0 ? declaredWidth : Math.min(16, Math.max(1, nextPowerOfTwo(Math.ceil(Math.sqrt(tileCount)))));
  const tilesHigh = Math.max(1, Math.ceil(tileCount / tilesWide));
  const width = tilesWide * 8;
  const height = tilesHigh * 8;
  const indices = new Uint8Array(width * height);
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = tile % tilesWide;
    const tileY = Math.floor(tile / tilesWide);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const source = dataOffset + tile * bytesPerTile + y * (bitsPerPixel === 4 ? 4 : 8) + (bitsPerPixel === 4 ? Math.floor(x / 2) : x);
        const packed = bytes[source] ?? 0;
        indices[(tileY * 8 + y) * width + tileX * 8 + x] = bitsPerPixel === 8 ? packed : (packed >>> ((x % 2) * 4)) & 0x0f;
      }
    }
  }
  return { memberId, bitsPerPixel, dataOffset, dataSize, tileCount, tilesWide, width, height, indices, bytes };
}

function parsePalette(memberId: number, bytes: Uint8Array): WeatherPaletteData {
  const block = findBlock(bytes, "TTLP");
  if (block < 0) throw new Error(`Weather NCLR ${memberId} has no TTLP block.`);
  return { memberId, dataOffset: block + 24, colors: parseNitroPalette(bytes), bytes };
}

function weatherEffectsReferencingMember(project: ProjectState, memberId: number): number[] {
  return getWeatherEffects(project).filter((effect) => {
    const particleMembers = effect.particleResource ? Object.values(effect.particleResource) : [];
    const auxiliaryMembers = weatherAuxiliaryResourceRefs(project, effect.id).map((entry) => entry.memberId);
    return particleMembers.includes(memberId) || auxiliaryMembers.includes(memberId);
  }).map((effect) => effect.id);
}

async function loadWeatherNarc(project: ProjectState): Promise<{ rom: NintendoDSRom; fileId: number; narc: NARC }> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the source ROM to edit weather graphics.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.filenames.idOf(OVERWORLD_WEATHER_ARCHIVE_PATH);
  if (fileId === undefined) throw new Error(`ROM path ${OVERWORLD_WEATHER_ARCHIVE_PATH} was not found.`);
  return { rom, fileId, narc: new NARC(getRomFileBytes(project, rom, fileId)) };
}

async function weatherMemberBytes(project: ProjectState, memberId: number): Promise<Uint8Array> {
  const { narc } = await loadWeatherNarc(project);
  return requireMember(narc, memberId).slice();
}

async function replaceWeatherMember(project: ProjectState, memberId: number, bytes: Uint8Array, message: string): Promise<void> {
  const { rom, fileId } = await loadWeatherNarc(project);
  replaceNarcFile(project, rom, fileId, memberId, bytes);
  recordGenericChange(project, "file_system", message, `Weather graphics ${memberId}`, { key: `weather-graphics:${memberId}` });
}

function requireMember(narc: NARC, memberId: number): Uint8Array {
  const bytes = narc.files[memberId];
  if (!bytes) throw new Error(`Weather graphics member ${memberId} is missing.`);
  return bytes;
}

function findBlock(bytes: Uint8Array, stamp: string): number {
  for (let offset = 16; offset + 8 <= bytes.length; ) {
    if (readAscii(bytes, offset, 4) === stamp) return offset;
    const size = readU32(bytes, offset + 4);
    if (size < 8) break;
    offset += size;
  }
  return -1;
}

function defaultCloneRuntime(behavior: WeatherPreviewBehavior, channels: string[], tint?: string): WeatherCloneRuntime {
  const hasFog = behavior === "fog" || channels.includes("fog");
  return {
    particleDensity: behavior === "fog" || behavior === "clear" ? 0 : 1,
    movementSpeed: 1,
    fogOffset: hasFog ? WEATHER_FOG_DEPTH_START - WEATHER_FOG_DEFAULT_DEPTH_DELTA : WEATHER_FOG_DEPTH_START,
    fogSlope: WEATHER_FOG_DEFAULT_SLOPE,
    fogTable: [...WEATHER_FOG_DEFAULT_TABLE],
    fogFadeInFrames: WEATHER_FOG_DEFAULT_FADE_IN_FRAMES,
    fogFadeOutFrames: WEATHER_FOG_DEFAULT_FADE_OUT_FRAMES,
    fogColor: tint && /^#[0-9a-f]{6}$/iu.test(tint) ? tint : behavior === "sand" ? "#b79555" : "#d5e2e5",
    screenScrollSpeed: 1,
  };
}

function hexToBgr555(hex: string): number {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new Error("Palette colors must use #RRGGBB format.");
  const value = Number.parseInt(hex.slice(1), 16);
  const red = ((value >>> 16) & 0xff) >>> 3;
  const green = ((value >>> 8) & 0xff) >>> 3;
  const blue = (value & 0xff) >>> 3;
  return red | (green << 5) | (blue << 10);
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}
