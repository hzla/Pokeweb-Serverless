import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { TYPES, isGen5BaseRom, type BaseRom, type Gen5BaseRom } from "./constants";
import { scanGen5ScriptPokemonCommands } from "./gen5ScriptPokemonScanner";
import { encodeBattleSpriteIndexedImage, getPokemonSpriteIndexedImage, type IndexedImageData } from "./pokemonSpriteModel";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { getTextBank, commitTextBank } from "./textModel";

const VANILLA_STARTERS = [495, 498, 501] as const;
const SPRITE_FILES_PER_ENTRY = 20;
const STARTER_GRAPHIC_FILES = [12, 13, 14] as const;
const STARTER_PALETTE_FILES = [0, 2, 4] as const;
const STARTER_SHADOW_PALETTE_FILES = [1, 3, 5] as const;
const STARTER_SOURCE_GRAPHIC_OFFSET = 0;
const STARTER_SOURCE_PALETTE_OFFSET = 18;
const STARTER_CANVAS_SIZE = 96;
const STARTER_MAX_GRAPHIC_SIZE = 80;
const STARTER_GRAPHIC_DATA_SIZE = 0x1200;
const STARTER_GRAPHIC_FILE_SIZE = 0x1230;
const STARTER_PALETTE_DATA_SIZE = 0x200;
const STARTER_PALETTE_FILE_SIZE = 0x228;
const NITRO_DATA_OFFSET = 0x28;
const WORK_SET_CONST = 0x28;
const WORD_SET_POKE_SPECIES = 0x57;
const WORD_SET_POKE_SPECIES_WITH_ARTICLE = 0x58;
const POKE_PARTY_ADD = 0x10c;
const POKE_PARTY_ADD_EX = 0x10e;
const POKE_PARTY_ADD_N = 0x2ea;
const SCRIPT_VARIABLE_MIN = 0x4000;
const STARTER_LEVEL = 5;
const STARTER_FORM = 0;

type StarterConfig = {
  scriptFileIds: number[];
  overlayIds: number[];
  overlayOffset?: number;
  textBankHint?: number;
  fallbackTextEntryBySlot?: number[];
};

const STARTER_CONFIG: Record<Gen5BaseRom, StarterConfig> = {
  BW: {
    // t01r0102.ev in resource/fldmapdata/script/zone_script_bin.list.
    scriptFileIds: [782],
    // FS_OVERLAY_ID(psel), derived from the BW overlay source list order.
    overlayIds: [223],
    overlayOffset: 0x3170,
    textBankHint: 430,
    // BW English bank 430 stores Water/Fire/Grass in this order.
    fallbackTextEntryBySlot: [18, 17, 16],
  },
  BW2: {
    scriptFileIds: [854],
    overlayIds: [316],
    overlayOffset: 0x2c14,
    textBankHint: 169,
    // BW2 English bank 169 stores Water/Fire/Grass in this order.
    fallbackTextEntryBySlot: [37, 36, 35],
  },
};

export type StarterSlot = {
  slot: number;
  speciesId: number;
  name: string;
  typeId: number;
  typeName: string;
};

export type StarterEditorState = {
  slots: StarterSlot[];
  warnings: string[];
};

export type StarterScriptPatchResult = {
  bytes: Uint8Array;
  changed: boolean;
  giftCommandCount: number;
  directGiftUpdates: number;
  variableGiftUpdates: number;
  wordSpeciesUpdates: number;
};

export type RandomizedStarterApplyResult = {
  state: StarterEditorState;
  warnings: string[];
};

export function getStarterOverlayIds(baseRom: BaseRom): number[] {
  return starterConfig(baseRom).overlayIds;
}

function starterConfig(baseRom: BaseRom): StarterConfig {
  if (!isGen5BaseRom(baseRom)) throw new Error("Starter editing is currently only supported for Gen 5 ROMs.");
  return STARTER_CONFIG[baseRom];
}

export function getDirtyStarterOverlayIds(project: ProjectState): number[] {
  return project.starters?.dirtyOverlayIds ?? [];
}

export function getStarterEditorState(project: ProjectState): StarterEditorState {
  const detection = detectCurrentStarters(project);
  const missingOverlays = getStarterOverlayIds(project.session.baseRom).filter((overlayId) => !project.overlays[overlayId]);
  const overlayWarnings = missingOverlays.length > 0 ? [`Starter overlay ${missingOverlays.join(", ")} is not loaded. Reload the ROM with Starter Sprites selected before applying changes.`] : [];
  const malformedSlots = malformedStarterSpriteSlots(project);
  const spriteWarnings = malformedSlots.length > 0
    ? [`Malformed starter-selection graphics were detected in ${starterSlotList(malformedSlots)}. Apply Starters to rebuild them.`]
    : [];
  return {
    slots: detection.speciesIds.map((speciesId, slot) => makeStarterSlot(project, slot, speciesId)),
    warnings: [...detection.warnings, ...overlayWarnings, ...spriteWarnings],
  };
}

export function applyStarters(project: ProjectState, speciesIds: number[]): StarterEditorState {
  if (speciesIds.length !== 3) throw new Error("Exactly three starter Pokemon are required.");
  const missingOverlays = getStarterOverlayIds(project.session.baseRom).filter((overlayId) => !project.overlays[overlayId]);
  if (missingOverlays.length > 0) throw new Error(`Starter overlay ${missingOverlays.join(", ")} is not loaded. Reload the ROM with Starter Sprites selected.`);
  const nextSpeciesIds = speciesIds.map((speciesId) => validateStarterSpecies(project, speciesId));
  const current = detectCurrentStarters(project);
  assertStarterSpriteSources(project, nextSpeciesIds);

  updateStarterScripts(project, current.speciesIds, nextSpeciesIds);
  const spriteUpdate = copyStarterSprites(project, current.speciesIds, nextSpeciesIds);
  updateStarterTypeText(project, current.speciesIds, nextSpeciesIds);
  updateStarterOverlays(project, current.speciesIds, nextSpeciesIds);

  project.starters = {
    speciesIds: nextSpeciesIds,
    dirtyOverlayIds: project.starters?.dirtyOverlayIds ?? [],
  };
  recordGenericChange(project, "starter_sprites", `Starters changed to ${nextSpeciesIds.map((id) => starterName(project, id)).join(", ")}.`, "Starters", {
    key: "starters:selection",
  });
  const state = getStarterEditorState(project);
  if (spriteUpdate.repairedSlots.length > 0) state.warnings.push(`Repaired malformed starter-selection graphics in ${starterSlotList(spriteUpdate.repairedSlots)}.`);
  return state;
}

export function applyRandomizedStarters(project: ProjectState, speciesIds: number[]): RandomizedStarterApplyResult {
  if (speciesIds.length !== 3) throw new Error("Exactly three starter Pokemon are required.");
  const nextSpeciesIds = speciesIds.map((speciesId) => validateStarterSpecies(project, speciesId));
  const current = detectCurrentStarters(project);
  const warnings: string[] = [];

  updateStarterScripts(project, current.speciesIds, nextSpeciesIds);
  if (project.narcs.pokemon_sprites && project.narcs.starter_sprites) {
    assertStarterSpriteSources(project, nextSpeciesIds);
    const spriteUpdate = copyStarterSprites(project, current.speciesIds, nextSpeciesIds);
    if (spriteUpdate.repairedSlots.length > 0) warnings.push(`Repaired malformed starter-selection graphics in ${starterSlotList(spriteUpdate.repairedSlots)}.`);
  } else {
    warnings.push("Starter species were changed in scripts, but starter sprite archives were not loaded, so the selection graphics were left unchanged.");
  }
  updateStarterTypeText(project, current.speciesIds, nextSpeciesIds);
  updateStarterOverlays(project, current.speciesIds, nextSpeciesIds);

  project.starters = {
    speciesIds: nextSpeciesIds,
    dirtyOverlayIds: project.starters?.dirtyOverlayIds ?? [],
  };
  recordGenericChange(project, "starter_sprites", `Starters changed to ${nextSpeciesIds.map((id) => starterName(project, id)).join(", ")}.`, "Starters", {
    key: "starters:selection",
  });
  return { state: getStarterEditorState(project), warnings };
}

function detectCurrentStarters(project: ProjectState): { speciesIds: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const saved = project.starters?.speciesIds;
  if (isStarterTriplet(project, saved)) return { speciesIds: [...saved], warnings };

  const overlayTriplet = detectStartersFromOverlay(project);
  if (overlayTriplet) return { speciesIds: overlayTriplet, warnings };

  const scriptTriplet = detectStartersFromScripts(project);
  if (scriptTriplet) return { speciesIds: scriptTriplet, warnings };

  warnings.push("Current starters could not be detected from the loaded ROM data, so vanilla Snivy, Tepig, and Oshawott were used as the replacement baseline.");
  return { speciesIds: [...VANILLA_STARTERS], warnings };
}

function detectStartersFromOverlay(project: ProjectState): number[] | undefined {
  const config = starterConfig(project.session.baseRom);
  for (const overlayId of config.overlayIds) {
    const overlay = project.overlays[overlayId];
    if (!overlay) continue;
    if (config.overlayOffset !== undefined && config.overlayOffset + 6 <= overlay.length) {
      const triplet = readTriplet(overlay, config.overlayOffset);
      if (isStarterTriplet(project, triplet)) return triplet;
    }
    const vanillaOffset = findTripletOffset(overlay, [...VANILLA_STARTERS]);
    if (vanillaOffset !== undefined) return readTriplet(overlay, vanillaOffset);
    const saved = project.starters?.speciesIds;
    const savedOffset = isStarterTriplet(project, saved) ? findTripletOffset(overlay, saved) : undefined;
    if (savedOffset !== undefined) return readTriplet(overlay, savedOffset);
  }
  return undefined;
}

function detectStartersFromScripts(project: ProjectState): number[] | undefined {
  const store = project.narcs.scripts;
  if (!store) return undefined;
  for (const fileId of findStarterScriptFileIds(project)) {
    const file = store.rawFiles[fileId];
    if (!file) continue;
    const commandTriplet = detectStartersFromScriptBytes(file, project.session.baseRom);
    if (commandTriplet && isStarterTriplet(project, commandTriplet)) return commandTriplet;
    const saved = project.starters?.speciesIds;
    const savedOffset = isStarterTriplet(project, saved) ? findTripletOffset(file, saved) : undefined;
    if (savedOffset !== undefined) return readTriplet(file, savedOffset);
    const offset = findTripletOffset(file, [...VANILLA_STARTERS]);
    if (offset !== undefined) return readTriplet(file, offset);
  }
  return undefined;
}

type StarterSpriteUpdate = {
  updatedSlots: number[];
  repairedSlots: number[];
};

function copyStarterSprites(project: ProjectState, previousSpeciesIds: number[], speciesIds: number[]): StarterSpriteUpdate {
  const pokemonSprites = project.narcs.pokemon_sprites;
  const starterSprites = project.narcs.starter_sprites;
  if (!pokemonSprites) throw new Error("Pokemon Sprites must be loaded before editing starters.");
  if (!starterSprites) throw new Error("Starter Sprites must be loaded before editing starters.");

  const result: StarterSpriteUpdate = { updatedSlots: [], repairedSlots: [] };

  speciesIds.forEach((speciesId, slot) => {
    const sourceBase = speciesId * SPRITE_FILES_PER_ENTRY;
    const sourceGraphic = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_GRAPHIC_OFFSET];
    const sourcePalette = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_PALETTE_OFFSET];
    if (!sourceGraphic || !sourcePalette) throw new Error(`Pokemon sprite files are missing for species ${speciesId}.`);

    const graphicFile = STARTER_GRAPHIC_FILES[slot];
    const paletteFile = STARTER_PALETTE_FILES[slot];
    const shadowPaletteFile = STARTER_SHADOW_PALETTE_FILES[slot];
    const targetGraphic = starterSprites.rawFiles[graphicFile];
    const targetPalette = starterSprites.rawFiles[paletteFile];
    const malformed = !isPreparedStarterGraphic(targetGraphic) || !isPreparedStarterPalette(targetPalette);
    const speciesChanged = previousSpeciesIds[slot] !== speciesId;
    if (!malformed && !speciesChanged) return;

    const sourceImage = getPokemonSpriteIndexedImage(project, speciesId, { kind: "sprite", side: "front", gender: "male" });
    const preparedImage = prepareStarterGraphicIndices(sourceImage);
    starterSprites.rawFiles[graphicFile] = buildPreparedStarterGraphic(preparedImage);
    starterSprites.rawFiles[paletteFile] = buildPreparedStarterPalette(
      targetPalette,
      starterSprites.rawFiles[shadowPaletteFile],
      sourcePalette,
    );
    markDirty(project, "starter_sprites", graphicFile);
    markDirty(project, "starter_sprites", paletteFile);
    result.updatedSlots.push(slot);
    if (malformed) result.repairedSlots.push(slot);
  });

  return result;
}

function assertStarterSpriteSources(project: ProjectState, speciesIds: number[]): void {
  const pokemonSprites = project.narcs.pokemon_sprites;
  const starterSprites = project.narcs.starter_sprites;
  if (!pokemonSprites) throw new Error("Pokemon Sprites must be loaded before editing starters.");
  if (!starterSprites) throw new Error("Starter Sprites must be loaded before editing starters.");
  for (const speciesId of speciesIds) {
    const sourceBase = speciesId * SPRITE_FILES_PER_ENTRY;
    const sourceGraphic = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_GRAPHIC_OFFSET];
    const sourcePalette = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_PALETTE_OFFSET];
    if (!sourceGraphic || !sourcePalette) {
      throw new Error(`Pokemon sprite files are missing for species ${speciesId}.`);
    }
    getPokemonSpriteIndexedImage(project, speciesId, { kind: "sprite", side: "front", gender: "male" });
    starterPaletteDataOffset(sourcePalette);
  }
}

export function prepareStarterGraphicIndices(source: IndexedImageData): IndexedImageData {
  if (source.width !== STARTER_CANVAS_SIZE || source.height !== STARTER_CANVAS_SIZE) {
    throw new Error(`Starter source graphic must be ${STARTER_CANVAS_SIZE}x${STARTER_CANVAS_SIZE}`);
  }
  const bounds = indexedOpaqueBounds(source);
  const out = { width: STARTER_CANVAS_SIZE, height: STARTER_CANVAS_SIZE, indices: new Uint8Array(STARTER_CANVAS_SIZE * STARTER_CANVAS_SIZE) };
  if (!bounds) return out;

  const cropped = cropIndexedImage(source, bounds);
  const doubled = scale2xIndexedImage(cropped);
  const fit = Math.min(1, STARTER_MAX_GRAPHIC_SIZE / doubled.width, STARTER_MAX_GRAPHIC_SIZE / doubled.height);
  const scaledWidth = Math.max(1, Math.min(STARTER_MAX_GRAPHIC_SIZE, Math.round(doubled.width * fit)));
  const scaledHeight = Math.max(1, Math.min(STARTER_MAX_GRAPHIC_SIZE, Math.round(doubled.height * fit)));
  const scaled = scaledWidth === doubled.width && scaledHeight === doubled.height ? doubled : resizeIndexedNearest(doubled, scaledWidth, scaledHeight);
  const targetX = Math.floor((STARTER_CANVAS_SIZE - scaled.width) / 2);
  const targetY = Math.floor((STARTER_CANVAS_SIZE - scaled.height) / 2);
  copyIndexedImage(scaled, out, targetX, targetY);
  return out;
}

function malformedStarterSpriteSlots(project: ProjectState): number[] {
  const starterSprites = project.narcs.starter_sprites;
  if (!starterSprites) return [];
  return STARTER_GRAPHIC_FILES
    .map((_file, slot) => slot)
    .filter((slot) => !isPreparedStarterGraphic(starterSprites.rawFiles[STARTER_GRAPHIC_FILES[slot]]) || !isPreparedStarterPalette(starterSprites.rawFiles[STARTER_PALETTE_FILES[slot]]));
}

function isPreparedStarterGraphic(bytes: Uint8Array | undefined): boolean {
  return Boolean(
    bytes
    && bytes.length === STARTER_GRAPHIC_FILE_SIZE
    && readAscii(bytes, 0, 4) === "RGCN"
    && readU32(bytes, 8) === STARTER_GRAPHIC_FILE_SIZE
    && readAscii(bytes, 0x10, 4) === "RAHC"
    && readU32(bytes, 0x14) === STARTER_GRAPHIC_FILE_SIZE - 0x10
    && readU16(bytes, 0x18) === 0xffff
    && readU16(bytes, 0x1a) === 0xffff
    && readU32(bytes, 0x1c) === 3
    && readU32(bytes, 0x20) === 0x10
    && readU32(bytes, 0x24) === 0
    && readU32(bytes, 0x28) === STARTER_GRAPHIC_DATA_SIZE
    && readU32(bytes, 0x2c) === 0x18
  );
}

function isPreparedStarterPalette(bytes: Uint8Array | undefined): boolean {
  return Boolean(
    bytes
    && bytes.length === STARTER_PALETTE_FILE_SIZE
    && readAscii(bytes, 0, 4) === "RLCN"
    && readU32(bytes, 8) === STARTER_PALETTE_FILE_SIZE
    && readAscii(bytes, 0x10, 4) === "TTLP"
    && readU32(bytes, 0x14) === STARTER_PALETTE_FILE_SIZE - 0x10
    && readU32(bytes, 0x18) === 3
    && readU32(bytes, 0x20) === STARTER_PALETTE_DATA_SIZE
    && readU32(bytes, 0x24) === 0x10
  );
}

function buildPreparedStarterGraphic(image: IndexedImageData): Uint8Array {
  const out = new Uint8Array(STARTER_GRAPHIC_FILE_SIZE);
  out.set([0x52, 0x47, 0x43, 0x4e, 0xff, 0xfe, 0x01, 0x01], 0);
  writeU32(out, 8, STARTER_GRAPHIC_FILE_SIZE);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set([0x52, 0x41, 0x48, 0x43], 0x10);
  writeU32(out, 0x14, STARTER_GRAPHIC_FILE_SIZE - 0x10);
  writeU16(out, 0x18, 0xffff);
  writeU16(out, 0x1a, 0xffff);
  writeU32(out, 0x1c, 3);
  writeU32(out, 0x20, 0x10);
  writeU32(out, 0x24, 0);
  writeU32(out, 0x28, STARTER_GRAPHIC_DATA_SIZE);
  writeU32(out, 0x2c, 0x18);
  encodeBattleSpriteIndexedImage(out, image);
  return out;
}

function buildPreparedStarterPalette(target: Uint8Array | undefined, shadowTemplate: Uint8Array | undefined, source: Uint8Array): Uint8Array {
  const out = isPreparedStarterPalette(target)
    ? target!.slice()
    : isPreparedStarterPalette(shadowTemplate)
      ? shadowTemplate!.slice()
      : emptyPreparedStarterPalette();
  const sourceOffset = starterPaletteDataOffset(source);
  const targetOffset = starterPaletteDataOffset(out);
  // Palette entry zero is the scene's transparent/backdrop color. Preserve the
  // starter archive's value while replacing the fifteen visible Pokemon colors.
  out.set(source.subarray(sourceOffset + 2, sourceOffset + 0x20), targetOffset + 2);
  return out;
}

function emptyPreparedStarterPalette(): Uint8Array {
  const out = new Uint8Array(STARTER_PALETTE_FILE_SIZE);
  out.set([0x52, 0x4c, 0x43, 0x4e, 0xff, 0xfe, 0x00, 0x01], 0);
  writeU32(out, 8, STARTER_PALETTE_FILE_SIZE);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set([0x54, 0x54, 0x4c, 0x50], 0x10);
  writeU32(out, 0x14, STARTER_PALETTE_FILE_SIZE - 0x10);
  writeU32(out, 0x18, 3);
  writeU32(out, 0x1c, 0);
  writeU32(out, 0x20, STARTER_PALETTE_DATA_SIZE);
  writeU32(out, 0x24, 0x10);
  return out;
}

function starterPaletteDataOffset(bytes: Uint8Array): number {
  if (bytes.length < NITRO_DATA_OFFSET + 0x20 || readAscii(bytes, 0, 4) !== "RLCN" || readAscii(bytes, 0x10, 4) !== "TTLP") {
    throw new Error("Pokemon starter source palette is not a supported NCLR file");
  }
  const dataSize = readU32(bytes, 0x20);
  if (dataSize < 0x20 || NITRO_DATA_OFFSET + dataSize > bytes.length) throw new Error("Pokemon starter source palette is truncated");
  return NITRO_DATA_OFFSET;
}

function indexedOpaqueBounds(image: IndexedImageData): { x: number; y: number; width: number; height: number } | undefined {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.indices[y * image.width + x] ?? 0) === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX || maxY < minY ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropIndexedImage(source: IndexedImageData, bounds: { x: number; y: number; width: number; height: number }): IndexedImageData {
  const out = { width: bounds.width, height: bounds.height, indices: new Uint8Array(bounds.width * bounds.height) };
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = (bounds.y + y) * source.width + bounds.x;
    out.indices.set(source.indices.subarray(sourceStart, sourceStart + bounds.width), y * bounds.width);
  }
  return out;
}

function scale2xIndexedImage(source: IndexedImageData): IndexedImageData {
  const out = { width: source.width * 2, height: source.height * 2, indices: new Uint8Array(source.width * source.height * 4) };
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return 0;
    return source.indices[y * source.width + x] ?? 0;
  };
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const center = at(x, y);
      const top = at(x, y - 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const bottom = at(x, y + 1);
      const offset = y * 2 * out.width + x * 2;
      if (top !== bottom && left !== right) {
        out.indices[offset] = left === top ? left : center;
        out.indices[offset + 1] = top === right ? right : center;
        out.indices[offset + out.width] = left === bottom ? left : center;
        out.indices[offset + out.width + 1] = bottom === right ? right : center;
      } else {
        out.indices[offset] = center;
        out.indices[offset + 1] = center;
        out.indices[offset + out.width] = center;
        out.indices[offset + out.width + 1] = center;
      }
    }
  }
  return out;
}

function resizeIndexedNearest(source: IndexedImageData, width: number, height: number): IndexedImageData {
  const out = { width, height, indices: new Uint8Array(width * height) };
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      out.indices[y * width + x] = source.indices[sourceY * source.width + sourceX] ?? 0;
    }
  }
  return out;
}

function copyIndexedImage(source: IndexedImageData, target: IndexedImageData, targetX: number, targetY: number): void {
  for (let y = 0; y < source.height; y += 1) {
    if (targetY + y < 0 || targetY + y >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      if (targetX + x < 0 || targetX + x >= target.width) continue;
      target.indices[(targetY + y) * target.width + targetX + x] = source.indices[y * source.width + x] ?? 0;
    }
  }
}

function starterSlotList(slots: number[]): string {
  const labels = ["the left slot", "the middle slot", "the right slot"];
  return slots.map((slot) => labels[slot] ?? `slot ${slot + 1}`).join(slots.length > 1 ? ", " : "");
}

function updateStarterTypeText(project: ProjectState, previousSpeciesIds: number[], nextSpeciesIds: number[]): void {
  const refs = findStarterTextEntries(project, previousSpeciesIds);
  if (refs.length < 3) return;
  const textBySlot = refs.reduce<Array<{ bankId: number; entryIndex: number; text: string } | undefined>>((acc, ref) => {
    acc[ref.slot] = ref;
    return acc;
  }, []);
  for (let slot = 0; slot < 3; slot += 1) {
    const ref = textBySlot[slot];
    if (!ref) continue;
    const bank = getTextBank(project, "story_texts", ref.bankId);
    const entry = bank[ref.entryIndex];
    if (!entry) continue;
    entry[1] = replaceTypeText(entry[1], pokemonTypeName(project, nextSpeciesIds[slot]), starterName(project, nextSpeciesIds[slot]));
    commitTextBank(project, "story_texts", ref.bankId);
  }
}

function findStarterTextEntries(project: ProjectState, previousSpeciesIds: number[]): Array<{ slot: number; bankId: number; entryIndex: number; text: string }> {
  const refs: Array<{ slot: number; bankId: number; entryIndex: number; text: string }> = [];
  const config = starterConfig(project.session.baseRom);
  const banks = project.texts.storyTexts ?? [];
  const previousTypeBySlot = previousSpeciesIds.map((speciesId) => pokemonTypeName(project, speciesId));

  if (config.textBankHint !== undefined) {
    collectStarterTextEntriesFromBank(refs, banks, config.textBankHint, previousTypeBySlot);
    if (refs.length === 3) return refs;
    const fallbackRefs = fallbackStarterTextEntries(project, config);
    if (fallbackRefs.length === 3) return fallbackRefs;
  }

  for (let bankId = 0; bankId < banks.length; bankId += 1) {
    if (bankId === config.textBankHint) continue;
    collectStarterTextEntriesFromBank(refs, banks, bankId, previousTypeBySlot);
    if (refs.length === 3) return refs;
  }

  return refs;
}

function collectStarterTextEntriesFromBank(
  refs: Array<{ slot: number; bankId: number; entryIndex: number; text: string }>,
  banks: ProjectState["texts"]["storyTexts"],
  bankId: number,
  previousTypeBySlot: string[],
): void {
  const bank = banks?.[bankId];
  if (!bank) return;
  bank.forEach((entry, entryIndex) => {
    const text = entry[1];
    if (!/-type Pok(?:e|é)mon/iu.test(text)) return;
    const slot = previousTypeBySlot.findIndex((typeName) => new RegExp(`\\b${escapeRegExp(typeName)}-type Pok(?:e|é)mon\\b`, "iu").test(text));
    if (slot >= 0 && !refs.some((ref) => ref.slot === slot)) refs.push({ slot, bankId, entryIndex, text });
  });
}

function fallbackStarterTextEntries(project: ProjectState, config: StarterConfig): Array<{ slot: number; bankId: number; entryIndex: number; text: string }> {
  if (config.textBankHint === undefined || !config.fallbackTextEntryBySlot) return [];
  const bank = project.texts.storyTexts?.[config.textBankHint];
  if (!bank) return [];
  return config.fallbackTextEntryBySlot
    .map((entryIndex, slot) => {
      const entry = bank[entryIndex];
      return entry ? { slot, bankId: config.textBankHint as number, entryIndex, text: entry[1] } : undefined;
    })
    .filter((ref): ref is { slot: number; bankId: number; entryIndex: number; text: string } => Boolean(ref));
}

function replaceTypeText(text: string, typeName: string, pokemonName: string): string {
  const replaced = text.replace(/((?:The )?)([A-Za-z]+)(-type Pok(?:e|é)mon)/iu, `$1${typeName}$3`);
  const withType = replaced !== text ? replaced : `The ${typeName}-type Pokémon\\nVAR(257, 1)`;
  return withType.replace(/((?:\\[rnf])+)(VAR\(\d+(?:,\s*\d+)?\))?([^\\\r\n\f]+)$/u, (match, lineBreak: string, control: string | undefined, name: string) => {
    if (/VAR\(/u.test(name)) return match;
    return `${lineBreak}${control ?? ""}${pokemonName}`;
  });
}

function updateStarterScripts(project: ProjectState, previousSpeciesIds: number[], nextSpeciesIds: number[]): void {
  const store = project.narcs.scripts;
  if (!store) throw new Error("Scripts must be loaded before editing starters.");
  const patches: Array<{ fileId: number; result: StarterScriptPatchResult }> = [];
  let giftUpdates = 0;
  let giftCommandCount = 0;
  for (const fileId of findStarterScriptFileIds(project, previousSpeciesIds)) {
    const file = store.rawFiles[fileId];
    if (!file) continue;
    const result = patchStarterScriptBytes(file, previousSpeciesIds, nextSpeciesIds);
    patches.push({ fileId, result });
    giftUpdates += result.directGiftUpdates + result.variableGiftUpdates;
    giftCommandCount += result.giftCommandCount;
  }
  const selectionChanged = previousSpeciesIds.some((speciesId, index) => speciesId !== nextSpeciesIds[index]);
  if (selectionChanged && giftUpdates === 0) {
    const detail = giftCommandCount === 0 ? "starter gift commands" : "starter species assignments used by the gift commands";
    throw new Error(`Could not find ${detail} in the loaded script files. Starter scripts were not changed.`);
  }
  for (const { fileId, result } of patches) {
    if (!result.changed) continue;
    store.rawFiles[fileId] = result.bytes;
    markDirty(project, "scripts", fileId);
  }
}

/**
 * Finds the starter selection script by its level-five gift command pattern.
 * The retail file IDs are checked first, then the whole loaded script archive is
 * scanned so hacks may relocate or append the selection script.
 */
export function findStarterScriptFileIds(project: ProjectState, expectedSpecies?: number[]): number[] {
  const store = project.narcs.scripts;
  if (!store) return [];
  const configured = starterConfig(project.session.baseRom).scriptFileIds.filter((fileId) => Boolean(store.rawFiles[fileId]));
  const rest = store.rawFiles.map((_file, fileId) => fileId).filter((fileId) => !configured.includes(fileId));
  const matches = (fileIds: number[]) => fileIds.filter((fileId) => {
    const detected = detectStartersFromScriptBytes(store.rawFiles[fileId]!, project.session.baseRom);
    return detected && (!expectedSpecies || tripletEquals(detected, expectedSpecies));
  });
  const configuredMatches = matches(configured);
  if (configuredMatches.length > 0) return configuredMatches;
  const discoveredMatches = matches(rest);
  return discoveredMatches.length > 0 ? discoveredMatches : configured;
}

function updateStarterOverlays(project: ProjectState, previousSpeciesIds: number[], nextSpeciesIds: number[]): void {
  const config = starterConfig(project.session.baseRom);
  const dirtyOverlayIds = new Set(project.starters?.dirtyOverlayIds ?? []);
  for (const overlayId of config.overlayIds) {
    const overlay = project.overlays[overlayId];
    if (!overlay) continue;
    const knownOffsetTriplet = config.overlayOffset !== undefined && config.overlayOffset + 6 <= overlay.length ? readTriplet(overlay, config.overlayOffset) : undefined;
    const offset =
      config.overlayOffset !== undefined && knownOffsetTriplet && isBaseStarterTriplet(knownOffsetTriplet)
        ? config.overlayOffset
        : findTripletOffset(overlay, previousSpeciesIds) ?? findTripletOffset(overlay, [...VANILLA_STARTERS]);
    if (offset === undefined) continue;
    const next = new Uint8Array(overlay);
    writeTriplet(next, offset, nextSpeciesIds);
    project.overlays[overlayId] = next;
    dirtyOverlayIds.add(overlayId);
  }
  if (!project.starters) project.starters = { speciesIds: [...nextSpeciesIds], dirtyOverlayIds: [] };
  project.starters.dirtyOverlayIds = [...dirtyOverlayIds];
}

export function detectStartersFromScriptBytes(bytes: Uint8Array, baseRom: BaseRom = "BW2"): number[] | undefined {
  const semanticTriplet = detectEntryScopedStarterAssignments(bytes, baseRom);
  if (semanticTriplet) return normalizeVanillaStarterOrder(semanticTriplet);

  const giftSpeciesVars = collectStarterGiftSpeciesVars(bytes);
  const directSpecies: number[] = [];
  const variableSpecies: number[] = [];

  for (let offset = 0; offset + 2 <= bytes.length; offset += 1) {
    const opcode = readU16(bytes, offset);
    if (opcode === POKE_PARTY_ADD || opcode === POKE_PARTY_ADD_EX || opcode === POKE_PARTY_ADD_N) {
      const command = readGiftCommand(bytes, offset, opcode);
      if (command && command.directSpecies !== undefined && isBaseSpeciesId(command.directSpecies) && !directSpecies.includes(command.directSpecies)) {
        directSpecies.push(command.directSpecies);
      }
      continue;
    }
    if (opcode !== WORK_SET_CONST || offset + 6 > bytes.length) continue;
    const variableId = readU16(bytes, offset + 2);
    const speciesId = readU16(bytes, offset + 4);
    if (giftSpeciesVars.has(variableId) && isBaseSpeciesId(speciesId) && !variableSpecies.includes(speciesId)) variableSpecies.push(speciesId);
  }

  if (variableSpecies.length >= 3) return normalizeVanillaStarterOrder(variableSpecies.slice(0, 3));
  if (directSpecies.length >= 3) return normalizeVanillaStarterOrder(directSpecies.slice(0, 3));
  return undefined;
}

function normalizeVanillaStarterOrder(speciesIds: number[]): number[] {
  return speciesIds.length === VANILLA_STARTERS.length
    && VANILLA_STARTERS.every((speciesId) => speciesIds.includes(speciesId))
    ? [...VANILLA_STARTERS]
    : speciesIds;
}

function detectEntryScopedStarterAssignments(bytes: Uint8Array, baseRom: BaseRom): number[] | undefined {
  if (baseRom !== "BW" && baseRom !== "BW2") return undefined;
  const scan = scanGen5ScriptPokemonCommands(bytes, baseRom);
  const directSpecies: number[] = [];
  for (const command of scan.commands) {
    if (command.type !== "party_gift" && command.type !== "party_gift_ex") continue;
    if (command.fields.level?.value !== STARTER_LEVEL || command.fields.form?.value !== STARTER_FORM) continue;
    const species = command.fields.species;
    if (!species) continue;
    if (species.value !== undefined && isBaseSpeciesId(species.value)) {
      if (!directSpecies.includes(species.value)) directSpecies.push(species.value);
      if (directSpecies.length >= 3) return directSpecies.slice(0, 3);
      continue;
    }
    if (species.rawValue < SCRIPT_VARIABLE_MIN) continue;
    const assignments: number[] = [];
    for (let offset = command.scriptStart; offset + 6 <= command.commandOffset; offset += 1) {
      if (readU16(bytes, offset) !== WORK_SET_CONST || readU16(bytes, offset + 2) !== species.rawValue) continue;
      const value = readU16(bytes, offset + 4);
      if (isBaseSpeciesId(value) && !assignments.includes(value)) assignments.push(value);
    }
    if (assignments.length >= 3) return assignments.slice(-3);
  }
  return directSpecies.length >= 3 ? directSpecies.slice(0, 3) : undefined;
}

export function patchStarterScriptBytes(bytes: Uint8Array, fromValues: number[], toValues: number[]): StarterScriptPatchResult {
  const out = new Uint8Array(bytes);
  const replacements = new Map<number, number>();
  fromValues.forEach((from, index) => {
    if (!replacements.has(from)) replacements.set(from, toValues[index]);
  });

  const giftSpeciesVars = new Set<number>();
  let giftCommandCount = 0;
  let directGiftUpdates = 0;
  let variableGiftUpdates = 0;
  let wordSpeciesUpdates = 0;

  // Opcodes and parameter widths match FrostFalcon's Gen 5 script headers:
  // WorkSetConst(var, value), WordSetPokeSpecies(buf, species), and PokePartyAdd(success, species, forme, level).
  for (let offset = 0; offset + 2 <= bytes.length; offset += 1) {
    const opcode = readU16(bytes, offset);
    if (opcode !== POKE_PARTY_ADD && opcode !== POKE_PARTY_ADD_EX && opcode !== POKE_PARTY_ADD_N) continue;
    const command = readGiftCommand(bytes, offset, opcode);
    if (!command) continue;
    giftCommandCount += 1;
    if (command.speciesVariable !== undefined) {
      giftSpeciesVars.add(command.speciesVariable);
      continue;
    }
    if (command.directSpecies === undefined) continue;
    const next = replacements.get(command.directSpecies);
    if (next !== undefined) {
      writeU16(out, command.speciesOffset, next);
      directGiftUpdates += 1;
    }
  }

  for (let offset = 0; offset + 2 <= bytes.length; offset += 1) {
    const opcode = readU16(bytes, offset);
    if (opcode === WORK_SET_CONST && offset + 6 <= bytes.length) {
      const variableId = readU16(bytes, offset + 2);
      const speciesId = readU16(bytes, offset + 4);
      const next = giftSpeciesVars.has(variableId) ? replacements.get(speciesId) : undefined;
      if (next !== undefined) {
        writeU16(out, offset + 4, next);
        variableGiftUpdates += 1;
      }
      continue;
    }

    if ((opcode === WORD_SET_POKE_SPECIES || opcode === WORD_SET_POKE_SPECIES_WITH_ARTICLE) && offset + 5 <= bytes.length) {
      const speciesOffset = offset + 3;
      const next = replacements.get(readU16(bytes, speciesOffset));
      if (next !== undefined) {
        writeU16(out, speciesOffset, next);
        wordSpeciesUpdates += 1;
      }
    }
  }

  return {
    bytes: out,
    changed: !bytesEqual(bytes, out),
    giftCommandCount,
    directGiftUpdates,
    variableGiftUpdates,
    wordSpeciesUpdates,
  };
}

function collectStarterGiftSpeciesVars(bytes: Uint8Array): Set<number> {
  const giftSpeciesVars = new Set<number>();
  for (let offset = 0; offset + 2 <= bytes.length; offset += 1) {
    const opcode = readU16(bytes, offset);
    if (opcode !== POKE_PARTY_ADD && opcode !== POKE_PARTY_ADD_EX && opcode !== POKE_PARTY_ADD_N) continue;
    const command = readGiftCommand(bytes, offset, opcode);
    if (command?.speciesVariable !== undefined) giftSpeciesVars.add(command.speciesVariable);
  }
  return giftSpeciesVars;
}

function readGiftCommand(
  bytes: Uint8Array,
  offset: number,
  opcode: number,
): { speciesOffset: number; directSpecies?: number; speciesVariable?: number } | undefined {
  const length = opcode === POKE_PARTY_ADD_N ? 14 : opcode === POKE_PARTY_ADD_EX ? 20 : 10;
  if (offset + length > bytes.length) return undefined;
  const successVariable = readU16(bytes, offset + 2);
  if (successVariable < SCRIPT_VARIABLE_MIN || successVariable >= 0xff00) return undefined;
  const speciesOffset = offset + 4;
  const species = readU16(bytes, speciesOffset);
  const level = readU16(bytes, opcode === POKE_PARTY_ADD_N ? offset + 6 : offset + 8);
  if (level !== STARTER_LEVEL) return undefined;
  if (opcode !== POKE_PARTY_ADD_N && readU16(bytes, offset + 6) !== STARTER_FORM) return undefined;
  if (species >= SCRIPT_VARIABLE_MIN) return { speciesOffset, speciesVariable: species };
  if (isBaseSpeciesId(species)) return { speciesOffset, directSpecies: species };
  return undefined;
}

function isBaseSpeciesId(speciesId: number): boolean {
  return Number.isInteger(speciesId) && speciesId > 0 && speciesId < SCRIPT_VARIABLE_MIN;
}

function isBaseStarterTriplet(value: number[]): boolean {
  return value.length === 3 && value.every(isBaseSpeciesId);
}

function makeStarterSlot(project: ProjectState, slot: number, speciesId: number): StarterSlot {
  const typeId = pokemonTypeId(project, speciesId);
  return {
    slot,
    speciesId,
    name: starterName(project, speciesId),
    typeId,
    typeName: TYPES[typeId] ?? String(typeId),
  };
}

function validateStarterSpecies(project: ProjectState, speciesId: number): number {
  if (!Number.isInteger(speciesId) || speciesId <= 0 || speciesId >= SCRIPT_VARIABLE_MIN) throw new Error("Starter species must fit in a direct Gen 5 script species operand.");
  const count = project.narcs.personal?.fileCount ?? 0;
  if (count > 0 && speciesId >= count) throw new Error("Starter selection must use a Pokémon present in the loaded personal archive.");
  return speciesId;
}

function pokemonTypeId(project: ProjectState, speciesId: number): number {
  const record = decodeRecord(project, "personal", speciesId);
  return Number(record.raw?.type_1 ?? 0);
}

function pokemonTypeName(project: ProjectState, speciesId: number): string {
  return TYPES[pokemonTypeId(project, speciesId)] ?? "Normal";
}

function starterName(project: ProjectState, speciesId: number): string {
  return project.texts.banks.pokedex?.[speciesId] ?? `Pokemon ${speciesId}`;
}

function readTriplet(bytes: Uint8Array, offset: number): number[] {
  return [readU16(bytes, offset), readU16(bytes, offset + 2), readU16(bytes, offset + 4)];
}

function writeTriplet(bytes: Uint8Array, offset: number, speciesIds: number[]): void {
  speciesIds.forEach((speciesId, index) => writeU16(bytes, offset + index * 2, speciesId));
}

function findTripletOffset(bytes: Uint8Array, speciesIds: number[]): number | undefined {
  for (let offset = 0; offset + 6 <= bytes.length; offset += 1) {
    if (tripletEquals(readTriplet(bytes, offset), speciesIds)) return offset;
  }
  return undefined;
}

function isStarterTriplet(project: ProjectState, value: unknown): value is number[] {
  const count = project.narcs.personal?.fileCount ?? SCRIPT_VARIABLE_MIN;
  return Array.isArray(value) && value.length === 3 && value.every((speciesId) => Number.isInteger(speciesId) && speciesId > 0 && speciesId < count);
}

function tripletEquals(left: readonly number[], right: readonly number[]): boolean {
  return left.length === 3 && right.length === 3 && left.every((value, index) => value === right[index]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
