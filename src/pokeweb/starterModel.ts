import { readU16, writeU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { TYPES, isGen5BaseRom, type BaseRom, type Gen5BaseRom } from "./constants";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { getTextBank, commitTextBank } from "./textModel";

const VANILLA_STARTERS = [495, 498, 501] as const;
const SPRITE_FILES_PER_ENTRY = 20;
const STARTER_GRAPHIC_FILES = [12, 13, 14] as const;
const STARTER_PALETTE_FILES = [0, 2, 4] as const;
const STARTER_SOURCE_GRAPHIC_OFFSET = 0;
const STARTER_SOURCE_PALETTE_OFFSET = 18;
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
  return {
    slots: detection.speciesIds.map((speciesId, slot) => makeStarterSlot(project, slot, speciesId)),
    warnings: [...detection.warnings, ...overlayWarnings],
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
  copyStarterSprites(project, nextSpeciesIds);
  updateStarterTypeText(project, current.speciesIds, nextSpeciesIds);
  updateStarterOverlays(project, current.speciesIds, nextSpeciesIds);

  project.starters = {
    speciesIds: nextSpeciesIds,
    dirtyOverlayIds: project.starters?.dirtyOverlayIds ?? [],
  };
  recordGenericChange(project, "starter_sprites", `Starters changed to ${nextSpeciesIds.map((id) => starterName(project, id)).join(", ")}.`, "Starters", {
    key: "starters:selection",
  });
  return getStarterEditorState(project);
}

function detectCurrentStarters(project: ProjectState): { speciesIds: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const saved = project.starters?.speciesIds;
  if (isStarterTriplet(project, saved)) return { speciesIds: [...saved], warnings };

  const scriptTriplet = detectStartersFromScripts(project);
  if (scriptTriplet) return { speciesIds: scriptTriplet, warnings };

  const overlayTriplet = detectStartersFromOverlay(project);
  if (overlayTriplet) return { speciesIds: overlayTriplet, warnings };

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
  const config = starterConfig(project.session.baseRom);
  for (const fileId of config.scriptFileIds) {
    const file = store.rawFiles[fileId];
    if (!file) continue;
    const commandTriplet = detectStartersFromScriptBytes(file);
    if (commandTriplet && isStarterTriplet(project, commandTriplet)) return commandTriplet;
    const saved = project.starters?.speciesIds;
    const savedOffset = isStarterTriplet(project, saved) ? findTripletOffset(file, saved) : undefined;
    if (savedOffset !== undefined) return readTriplet(file, savedOffset);
    const offset = findTripletOffset(file, [...VANILLA_STARTERS]);
    if (offset !== undefined) return readTriplet(file, offset);
  }
  return undefined;
}

function copyStarterSprites(project: ProjectState, speciesIds: number[]): void {
  const pokemonSprites = project.narcs.pokemon_sprites;
  const starterSprites = project.narcs.starter_sprites;
  if (!pokemonSprites) throw new Error("Pokemon Sprites must be loaded before editing starters.");
  if (!starterSprites) throw new Error("Starter Sprites must be loaded before editing starters.");

  speciesIds.forEach((speciesId, slot) => {
    const sourceBase = speciesId * SPRITE_FILES_PER_ENTRY;
    const sourceGraphic = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_GRAPHIC_OFFSET];
    const sourcePalette = pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_PALETTE_OFFSET];
    if (!sourceGraphic || !sourcePalette) throw new Error(`Pokemon sprite files are missing for species ${speciesId}.`);

    const graphicFile = STARTER_GRAPHIC_FILES[slot];
    const paletteFile = STARTER_PALETTE_FILES[slot];
    starterSprites.rawFiles[graphicFile] = new Uint8Array(sourceGraphic);
    starterSprites.rawFiles[paletteFile] = new Uint8Array(sourcePalette);
    markDirty(project, "starter_sprites", graphicFile);
    markDirty(project, "starter_sprites", paletteFile);
  });
}

function assertStarterSpriteSources(project: ProjectState, speciesIds: number[]): void {
  const pokemonSprites = project.narcs.pokemon_sprites;
  const starterSprites = project.narcs.starter_sprites;
  if (!pokemonSprites) throw new Error("Pokemon Sprites must be loaded before editing starters.");
  if (!starterSprites) throw new Error("Starter Sprites must be loaded before editing starters.");
  for (const speciesId of speciesIds) {
    const sourceBase = speciesId * SPRITE_FILES_PER_ENTRY;
    if (!pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_GRAPHIC_OFFSET] || !pokemonSprites.rawFiles[sourceBase + STARTER_SOURCE_PALETTE_OFFSET]) {
      throw new Error(`Pokemon sprite files are missing for species ${speciesId}.`);
    }
  }
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
  for (const fileId of starterConfig(project.session.baseRom).scriptFileIds) {
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

export function detectStartersFromScriptBytes(bytes: Uint8Array): number[] | undefined {
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

  if (variableSpecies.length >= 3) return variableSpecies.slice(0, 3);
  if (directSpecies.length >= 3) return directSpecies.slice(0, 3);
  return undefined;
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
  return Number.isInteger(speciesId) && speciesId > 0 && speciesId < 650;
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
  if (!Number.isInteger(speciesId) || speciesId <= 0) throw new Error("Starter species must be a valid Pokemon ID.");
  const count = project.narcs.personal?.fileCount ?? 0;
  if (count > 0 && speciesId >= Math.min(count, 650)) throw new Error("Starter selection supports base Pokemon only, not alternate forms.");
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
  const count = project.narcs.personal?.fileCount ?? 650;
  return Array.isArray(value) && value.length === 3 && value.every((speciesId) => Number.isInteger(speciesId) && speciesId > 0 && speciesId < Math.min(count, 650));
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
