import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { pokemonFormLabel } from "./pokemonFormLabels";
import { findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "./pokemonLabels";
import {
  buildPokemonAnimationFile,
  buildPokemonCellBankFileFromParsed,
  buildPokemonMultiCellAnimationFile,
  buildPokemonMultiCellsFileFromParsed,
  buildRigCellsFile,
  parsePokemonAnimationBundle,
} from "./pokemonSpriteWriters";

export type PokemonPaletteKind = "normal" | "shiny";
export type PokemonSpriteVariant = {
  kind: "sprite" | "rig";
  side: "front" | "back";
  gender: "male" | "female";
};
export type PokemonIconVariant = "male" | "female";
export type RgbColor = { r: number; g: number; b: number };
export type RgbaImageData = { width: number; height: number; pixels: Uint8ClampedArray };
export type IndexedImageData = { width: number; height: number; indices: Uint8Array };
export type RigAtlasDimensions = { width: number; height: number };
export type PokemonSpriteEntry = {
  spriteId: number;
  files: Uint8Array[];
  hasFemale: boolean;
  palette: RgbColor[];
  shinyPalette: RgbColor[];
};
export type RigCell = {
  cellX: number;
  cellY: number;
  width: number;
  height: number;
  spriteX: number;
  spriteY: number;
  subCell: RigCell;
};
export type RigCellsFile = {
  cells: RigCell[];
  flags: Uint8Array;
};
export type PokemonAnimationSide = "front" | "back";
export type PokemonAnimationFrame = {
  duration: number;
  cellIndex: number;
  x: number;
  y: number;
  rotation: number;
  xScale: number;
  yScale: number;
  frameType: "index" | "index-srt" | "index-t";
  valueOffset: number;
  sequenceFrameOffset: number;
};
export type PokemonAnimationFrameEdit = Pick<PokemonAnimationFrame, "duration" | "cellIndex" | "x" | "y" | "rotation" | "xScale" | "yScale">;
export type PokemonAnimationSequence = {
  index: number;
  frameCount: number;
  startFrameIndex: number;
  motionType: number;
  targetType: number;
  mode: number;
  frames: PokemonAnimationFrame[];
};
export type PokemonAnimation = {
  side: PokemonAnimationSide;
  sequences: PokemonAnimationSequence[];
  raw: Uint8Array;
};
export type PokemonMultiCellNode = {
  sequenceNumber: number;
  x: number;
  y: number;
  nodeAttr: number;
  cellAnimationIndex: number;
  playMode: number;
  visible: boolean;
};
export type PokemonMultiCell = {
  index: number;
  nodes: PokemonMultiCellNode[];
  cellAnimationCount: number;
};
export type PokemonMultiCells = {
  side: PokemonAnimationSide;
  cells: PokemonMultiCell[];
  raw: Uint8Array;
};
export type PokemonCellOam = {
  x: number;
  y: number;
  width: number;
  height: number;
  characterName: number;
  palette: number;
  flipX: boolean;
  flipY: boolean;
  disable: boolean;
  rotateScale: boolean;
  doubleSize: boolean;
  matrix: number;
  mode: number;
  mosaic: boolean;
  shape: number;
  size: number;
  priority: number;
  characterBits: 4 | 8;
};
export type PokemonCell = {
  index: number;
  nAttribs: number;
  cellAttr: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  oams: PokemonCellOam[];
};
export type PokemonCellBank = {
  side: PokemonAnimationSide;
  mappingMode: number;
  cells: PokemonCell[];
  raw: Uint8Array;
};

const SPRITE_FILES_PER_ENTRY = 20;
const BW_ALT_FORM_SPRITE_START = 652;
const BW2_ALT_FORM_SPRITE_START = 685;
const W2U_FORM_SPRITE_START = 724;
const PALETTE_OFFSET = 40;
const IMAGE_DATA_OFFSET = 48;
export const DEFAULT_RIG_ATLAS_DIMENSIONS: RigAtlasDimensions = { width: 256, height: 128 };
export const EXPANDED_RIG_ATLAS_DIMENSIONS: RigAtlasDimensions = { width: 256, height: 256 };
const TRANSPARENT_ALPHA_THRESHOLD = 128;

const SPRITE_UNSCRAMBLE_RECTS = [
  [0, 0, 64, 64, 0, 0],
  [64, 0, 32, 8, 0, 64],
  [64, 8, 32, 8, 32, 64],
  [64, 16, 32, 8, 0, 72],
  [64, 24, 32, 8, 32, 72],
  [64, 32, 32, 8, 0, 80],
  [64, 40, 32, 8, 32, 80],
  [64, 48, 32, 8, 0, 88],
  [64, 56, 32, 8, 32, 88],
  [0, 64, 64, 32, 0, 96],
  [64, 64, 32, 8, 0, 128],
  [64, 72, 32, 8, 32, 128],
  [64, 80, 32, 8, 0, 136],
  [64, 88, 32, 8, 32, 136],
] as const;

export function getPokemonSpriteFormOptions(project: ProjectState, speciesId: number): Array<{ formIndex: number; label: string; spriteId: number }> {
  const formOwner = findPokemonPersonalFormOwner(project, speciesId);
  if (formOwner) {
    return [{
      formIndex: 0,
      label: pokemonSpeciesLabel(project, speciesId),
      spriteId: resolvePokemonSpriteId(project, speciesId, 0),
    }];
  }
  const record = decodeRecord(project, "personal", speciesId);
  const formCount = Math.max(1, Number(record.raw?.num_forms ?? 1));
  const baseLabel = pokemonSpeciesLabel(project, speciesId);
  return Array.from({ length: formCount }, (_, formIndex) => ({
    formIndex,
    label: formIndex === 0 ? "Base Form" : pokemonFormLabel(baseLabel, formIndex),
    spriteId: resolvePokemonSpriteId(project, speciesId, formIndex),
  }));
}

export function resolvePokemonSpriteId(project: ProjectState, speciesId: number, formIndex = 0): number {
  const formSpriteStart = usesW2uExpandedPokegra(project) ? W2U_FORM_SPRITE_START : project.session.baseRom === "BW2" ? BW2_ALT_FORM_SPRITE_START : BW_ALT_FORM_SPRITE_START;
  if (formIndex <= 0) {
    const formOwner = findPokemonPersonalFormOwner(project, speciesId);
    return formOwner ? formSpriteStart + formOwner.formSpriteOffset + formOwner.formIndex - 1 : speciesId;
  }
  const record = decodeRecord(project, "personal", speciesId);
  const formCount = Math.max(1, Number(record.raw?.num_forms ?? 1));
  if (formIndex >= formCount) throw new Error(`Form ${formIndex} is out of range for Pokemon ${speciesId}`);
  return formSpriteStart + Number(record.raw?.form ?? 0) + formIndex - 1;
}

function usesW2uExpandedPokegra(project: ProjectState): boolean {
  return project.session.baseRom === "BW2" && (project.narcs.personal?.fileCount ?? 0) > 1024;
}

export function getPokemonSpriteEntry(project: ProjectState, spriteId: number): PokemonSpriteEntry {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon sprite NARC is not loaded");
  const start = spriteId * SPRITE_FILES_PER_ENTRY;
  const files = store.rawFiles.slice(start, start + SPRITE_FILES_PER_ENTRY);
  if (files.length !== SPRITE_FILES_PER_ENTRY || files.some((file) => file === undefined)) throw new Error(`Sprite ${spriteId} is missing data`);
  return {
    spriteId,
    files,
    hasFemale: files[1].length > 0,
    palette: readPalette(files[18]),
    shinyPalette: readPalette(files[19]),
  };
}

export function getPokemonSpriteImage(project: ProjectState, spriteId: number, variant: PokemonSpriteVariant, paletteKind: PokemonPaletteKind): RgbaImageData {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[spriteVariantFileIndex(variant)];
  if (file.length === 0) throw new Error("This sprite variant is empty");
  const palette = paletteKind === "shiny" ? entry.shinyPalette : entry.palette;
  return variant.kind === "rig" ? decodeRigImage(decompressNitro(file), palette, getPokemonRigAtlasDimensions(project)) : decodeBattleSpriteImage(decompressNitro(file), palette);
}

export function getPokemonSpriteIndexedImage(project: ProjectState, spriteId: number, variant: PokemonSpriteVariant): IndexedImageData {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[spriteVariantFileIndex(variant)];
  if (file.length === 0) throw new Error("This sprite variant is empty");
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  return variant.kind === "rig" ? decodeLinear4bppIndices(decompressNitro(file), rigAtlas.width, rigAtlas.height) : decodeBattleSpriteIndices(decompressNitro(file));
}

export function setPokemonSpriteImage(
  project: ProjectState,
  spriteId: number,
  variant: PokemonSpriteVariant,
  paletteKind: PokemonPaletteKind,
  image: RgbaImageData,
): void {
  const expected = variant.kind === "rig" ? getPokemonRigAtlasDimensions(project) : { width: 96, height: 96 };
  if (image.width !== expected.width || image.height !== expected.height) {
    throw new Error(`${variant.kind === "rig" ? "Rig" : "Sprite"} image must be ${expected.width} x ${expected.height}`);
  }
  const entry = getPokemonSpriteEntry(project, spriteId);
  const palette = paletteKind === "shiny" ? entry.shinyPalette : entry.palette;
  const fileIndex = spriteVariantFileIndex(variant);
  let decompressed: Uint8Array<ArrayBufferLike> = new Uint8Array(decompressNitro(entry.files[fileIndex]));
  if (variant.kind === "rig") {
    decompressed = ensureRigImageDataCapacity(decompressed, expected);
    encodeRigImage(decompressed, image, palette);
  }
  else encodeBattleSpriteImage(decompressed, image, palette);
  writePokemonSpriteFile(project, spriteId, fileIndex, compressLz11Literal(decompressed));
}

export function getPokemonRigAtlasDimensions(project: ProjectState): RigAtlasDimensions {
  return project.rigAtlas?.expanded ? EXPANDED_RIG_ATLAS_DIMENSIONS : DEFAULT_RIG_ATLAS_DIMENSIONS;
}

export function copyPokemonSpriteVariant(project: ProjectState, spriteId: number, source: PokemonSpriteVariant, target: PokemonSpriteVariant): void {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const sourceFile = entry.files[spriteVariantFileIndex(source)];
  if (!sourceFile || sourceFile.length === 0) throw new Error("Source sprite variant is empty");
  writePokemonSpriteFile(project, spriteId, spriteVariantFileIndex(target), sourceFile.slice());
  recordGenericChange(project, "pokemon_sprites", `${spriteVariantLabel(target)} copied from ${spriteVariantLabel(source)}.`, pokemonSpriteSubject(project, spriteId), {
    key: `pokemon-sprite-copy:${spriteId}:${spriteVariantFileIndex(target)}`,
  });
}

export function getPokemonPalettes(project: ProjectState, spriteId: number): { normal: RgbColor[]; shiny: RgbColor[] } {
  const entry = getPokemonSpriteEntry(project, spriteId);
  return { normal: entry.palette, shiny: entry.shinyPalette };
}

export function setPokemonPalette(project: ProjectState, spriteId: number, paletteKind: PokemonPaletteKind, palette: RgbColor[]): void {
  if (palette.length !== 16) throw new Error("Pokemon palettes must contain exactly 16 colors");
  const fileIndex = paletteKind === "shiny" ? 19 : 18;
  const entry = getPokemonSpriteEntry(project, spriteId);
  const out = entry.files[fileIndex].slice();
  if (out.length < PALETTE_OFFSET + 32) throw new Error("Palette file is too small");
  palette.forEach((color, index) => writeU16(out, PALETTE_OFFSET + index * 2, writeBgr555(color)));
  writePokemonSpriteFile(project, spriteId, fileIndex, out);
}

export function exportPokemonSpritePackage(project: ProjectState, spriteId: number): Uint8Array {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < SPRITE_FILES_PER_ENTRY; i += 1) {
    const file = entry.files[i];
    parts.push(asciiBytes(`{file${i}|`), u32Bytes(file.length), asciiBytes(":"), file, asciiBytes("}"));
  }
  return concatBytes(parts);
}

export function importPokemonSpritePackage(project: ProjectState, spriteId: number, bytes: Uint8Array): void {
  const sections = parseSectionFile(bytes);
  for (let i = 0; i < SPRITE_FILES_PER_ENTRY; i += 1) {
    const file = sections.get(`file${i}`);
    if (!file) throw new Error(`Sprite data package is missing file${i}`);
    writePokemonSpriteFile(project, spriteId, i, file);
  }
}

export function importPokemonAnimationBundle(project: ProjectState, spriteId: number, bytes: Uint8Array): void {
  const bundle = parsePokemonAnimationBundle(bytes);
  const expected = bundle.side === "front" ? [4, 5, 6, 7, 8] : [13, 14, 15, 16, 17];
  for (const fileIndex of expected) {
    const file = bundle.files[fileIndex as keyof typeof bundle.files];
    if (!file) throw new Error(`Animation bundle is missing file${fileIndex}`);
    writePokemonSpriteFile(project, spriteId, fileIndex, file);
  }
}

export function getPokemonIconImage(project: ProjectState, spriteId: number, variant: PokemonIconVariant, paletteId?: number): RgbaImageData {
  const store = project.narcs.pokemon_icons;
  if (!store) throw new Error("Pokemon icon NARC is not loaded");
  const actualPaletteId = paletteId ?? getPokemonIconPaletteAssignment(project, spriteId, variant).paletteId;
  const fileIndex = iconFileIndex(project, spriteId, variant);
  const file = store.rawFiles[fileIndex];
  if (!file || file.length === 0) throw new Error("This icon variant is empty");
  const palette = getPokemonIconPalettes(project)[actualPaletteId] ?? getPokemonIconPalettes(project)[0];
  return decodeIconImage(file, palette);
}

export function setPokemonIconImage(project: ProjectState, spriteId: number, variant: PokemonIconVariant, paletteId: number, image: RgbaImageData): void {
  if (image.width !== 32 || image.height !== 64) throw new Error("Icon image must be 32 x 64");
  const store = project.narcs.pokemon_icons;
  if (!store) throw new Error("Pokemon icon NARC is not loaded");
  const fileIndex = iconFileIndex(project, spriteId, variant);
  const file = store.rawFiles[fileIndex];
  if (!file || file.length === 0) throw new Error("This icon variant is empty");
  const palette = getPokemonIconPalettes(project)[paletteId];
  if (!palette) throw new Error(`Icon palette ${paletteId} does not exist`);
  const out = file.slice();
  encodeIconImage(out, image, palette);
  store.rawFiles[fileIndex] = out;
  store.dirty.add(fileIndex);
  recordPokemonSpriteAsset(project, "pokemon_icons", spriteId, `Icon ${variant} image changed.`);
}

export function getPokemonIconPalettes(project: ProjectState): RgbColor[][] {
  const file = project.narcs.pokemon_icons?.rawFiles[0];
  if (!file) throw new Error("Pokemon icon palette file is not loaded");
  return Array.from({ length: 3 }, (_, paletteId) =>
    Array.from({ length: 16 }, (_, colorIndex) => readBgr555(readU16(file, PALETTE_OFFSET + paletteId * 32 + colorIndex * 2))),
  );
}

export function genderedPokemonIcons(project: ProjectState, spriteId: number): boolean {
  const store = project.narcs.pokemon_icons;
  if (!store) return false;
  const file = store.rawFiles[iconFileIndex(project, spriteId, "female")];
  return Boolean(file?.length);
}

export function getPokemonIconPaletteAssignment(project: ProjectState, spriteId: number, variant: PokemonIconVariant): { editable: boolean; paletteId: number } {
  const layout = iconPaletteAssignmentLayout(project);
  const index = iconPaletteAssignmentIndex(project, spriteId);
  if (!layout || index === undefined || index >= layout.capacity) return { editable: false, paletteId: 0 };
  const value = project.arm9[layout.offset + index] ?? 0;
  return {
    editable: true,
    paletteId: variant === "female" ? (value >>> 4) & 0x0f : value & 0x0f,
  };
}

export function ensurePokemonIconPaletteAssignmentCapacity(project: ProjectState, spriteId: number): void {
  const config = iconPaletteAssignmentConfig(project);
  const layout = iconPaletteAssignmentLayout(project);
  const index = iconPaletteAssignmentIndex(project, spriteId);
  if (!config || !layout || index === undefined) throw new Error("Icon palette assignments are not available for this ROM");
  if (index < layout.capacity) return;

  const arm9RamAddress = projectArm9RamAddress(project);
  const currentTableAddress = arm9RamAddress + layout.offset;
  if (config.pointerOffset + 4 > project.arm9.length || readU32(project.arm9, config.pointerOffset) !== currentTableAddress) {
    throw new Error("Pokeweb could not safely relocate this ROM's icon palette assignment table");
  }

  // IconPalAtr ends flush against other ARM9 constants. The configured heap
  // boundary sits after every ARM9 overlay, so reserve the relocated table
  // there and advance the heap instead of overwriting rodata or overlay RAM.
  const heapStartAddress = config.heapStartOffset + 4 <= project.arm9.length ? readU32(project.arm9, config.heapStartOffset) : 0;
  const markerOffset = heapStartAddress - arm9RamAddress;
  if (markerOffset < project.arm9.length || heapStartAddress < arm9RamAddress || heapStartAddress >= ARM9_MAIN_MEMORY_END) {
    throw new Error("Pokeweb could not safely reserve ARM9 memory for expanded icon palette assignments");
  }

  const capacity = alignTo(Math.max(index + 1, layout.capacity * 2), 4);
  const tableOffset = markerOffset + ICON_PALETTE_RELOCATION_HEADER_SIZE;
  const endOffset = tableOffset + capacity;
  if (arm9RamAddress + endOffset > ARM9_MAIN_MEMORY_END) throw new Error("The expanded icon palette assignment table does not fit in ARM9 memory");

  const out = new Uint8Array(endOffset);
  out.set(project.arm9);
  out.set(ICON_PALETTE_RELOCATION_MAGIC, markerOffset);
  writeU32(out, markerOffset + 8, capacity);
  writeU32(out, markerOffset + 12, config.pointerOffset);
  out.set(project.arm9.subarray(layout.offset, layout.offset + layout.capacity), tableOffset);
  writeU32(out, config.pointerOffset, arm9RamAddress + tableOffset);
  writeU32(out, config.heapStartOffset, arm9RamAddress + alignTo(endOffset, 4));
  project.arm9 = out;
  project.arm9Dirty = true;
  recordGenericChange(project, "pokemon_icons", `Expanded icon palette assignments to ${capacity} entries.`, "Icon palette assignments", {
    key: `pokemon-icon-palette-expand:${capacity}`,
  });
}

export function setPokemonIconPaletteAssignment(project: ProjectState, spriteId: number, variant: PokemonIconVariant, paletteId: number): void {
  if (!Number.isInteger(paletteId) || paletteId < 0 || paletteId > 2) throw new Error("Icon palette must be 0, 1, or 2");
  ensurePokemonIconPaletteAssignmentCapacity(project, spriteId);
  const layout = iconPaletteAssignmentLayout(project);
  const assignmentIndex = iconPaletteAssignmentIndex(project, spriteId);
  if (!layout || assignmentIndex === undefined || assignmentIndex >= layout.capacity) {
    throw new Error("Icon palette assignments are not available for this ROM");
  }
  const index = layout.offset + assignmentIndex;
  const value = project.arm9[index] ?? 0;
  project.arm9[index] = variant === "female" ? (value & 0x0f) | (paletteId << 4) : (value & 0xf0) | paletteId;
  project.arm9Dirty = true;
  recordFieldChange(project, "pokemon_icons", pokemonSpriteSubject(project, spriteId), `${variant} icon palette`, (variant === "female" ? (value >>> 4) & 0x0f : value & 0x0f), paletteId, {
    key: `pokemon-icon-palette:${spriteId}:${variant}`,
  });
}

export function getRigCells(project: ProjectState, spriteId: number, side: "front" | "back"): RigCellsFile {
  const entry = getPokemonSpriteEntry(project, spriteId);
  return parseRigCells(entry.files[side === "front" ? 8 : 17]);
}

export function setRigCells(project: ProjectState, spriteId: number, side: "front" | "back", next: RigCellsFile): void {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const fileIndex = side === "front" ? 8 : 17;
  const out = entry.files[fileIndex].slice();
  if (out.length < 12 + next.cells.length * 48) throw new Error("Rig-cell file is too small for the imported cell count");
  writeU32LE(out, 0, next.cells.length);
  writeRigCellsHeader(out, next.cells);
  for (let i = 0; i < next.cells.length; i += 1) {
    writeRigCell(out, 12 + i * 48, next.cells[i], false);
    writeRigCell(out, 36 + i * 48, next.cells[i].subCell, true);
  }
  const flagPos = next.cells.length * 48 + 12;
  if (flagPos + next.flags.length > out.length) throw new Error("Rig flags do not fit in this rig-cell file");
  out.fill(0, flagPos);
  out.set(next.flags, flagPos);
  writePokemonSpriteFile(project, spriteId, fileIndex, out);
}

export function replaceRigCells(project: ProjectState, spriteId: number, side: PokemonAnimationSide, next: RigCellsFile): RigCellsFile {
  const raw = buildRigCellsFile(next);
  writePokemonSpriteFile(project, spriteId, side === "front" ? 8 : 17, raw);
  return parseRigCells(raw);
}

export function getPokemonAnimation(project: ProjectState, spriteId: number, side: PokemonAnimationSide): PokemonAnimation {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[animationFileIndex(side)];
  if (!file || file.length === 0) throw new Error("This animation file is empty");
  return parsePokemonAnimation(decompressNitro(file), side);
}

export function getPokemonMultiCells(project: ProjectState, spriteId: number, side: PokemonAnimationSide): PokemonMultiCells {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[multiCellFileIndex(side)];
  if (!file || file.length === 0) throw new Error("This multi-cell file is empty");
  return parsePokemonMultiCells(decompressNitroIfNeeded(file), side);
}

export function getPokemonMultiCellAnimation(project: ProjectState, spriteId: number, side: PokemonAnimationSide): PokemonAnimation {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[multiCellAnimationFileIndex(side)];
  if (!file || file.length === 0) throw new Error("This multi-cell animation file is empty");
  return parsePokemonAnimation(decompressNitroIfNeeded(file), side, "RAMN", "Multi-cell animation");
}

export function getPokemonCellBank(project: ProjectState, spriteId: number, side: PokemonAnimationSide): PokemonCellBank {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[cellBankFileIndex(side)];
  if (!file || file.length === 0) throw new Error("This cell bank file is empty");
  return parsePokemonCellBank(decompressNitroIfNeeded(file), side);
}

export function setPokemonAnimation(project: ProjectState, spriteId: number, side: PokemonAnimationSide, next: PokemonAnimation): PokemonAnimation {
  validatePokemonAnimationReferences(project, spriteId, side, next, "nanr");
  const raw = buildPokemonAnimationFile(next.sequences.map((sequence) => ({ ...sequence, targetType: 1 as const })));
  writePokemonSpriteFile(project, spriteId, animationFileIndex(side), compressLz11Literal(raw));
  return parsePokemonAnimation(raw, side);
}

export function setPokemonMultiCellAnimation(project: ProjectState, spriteId: number, side: PokemonAnimationSide, next: PokemonAnimation): PokemonAnimation {
  validatePokemonAnimationReferences(project, spriteId, side, next, "nmar");
  const raw = buildPokemonAnimationFile(next.sequences.map((sequence) => ({ ...sequence, targetType: 2 as const })));
  writePokemonSpriteFile(project, spriteId, multiCellAnimationFileIndex(side), raw);
  return parsePokemonAnimation(raw, side, "RAMN", "Multi-cell animation");
}

export function setPokemonMultiCells(project: ProjectState, spriteId: number, side: PokemonAnimationSide, next: PokemonMultiCells): PokemonMultiCells {
  validatePokemonMultiCellReferences(project, spriteId, side, next);
  const raw = buildPokemonMultiCellsFileFromParsed(next.cells);
  writePokemonSpriteFile(project, spriteId, multiCellFileIndex(side), raw);
  return parsePokemonMultiCells(raw, side);
}

export function setPokemonCellBank(project: ProjectState, spriteId: number, side: PokemonAnimationSide, next: PokemonCellBank): PokemonCellBank {
  const raw = buildPokemonCellBankFileFromParsed(next);
  writePokemonSpriteFile(project, spriteId, cellBankFileIndex(side), raw);
  return parsePokemonCellBank(raw, side);
}

export function setPokemonAnimationFrame(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  sequenceIndex: number,
  frameIndex: number,
  next: PokemonAnimationFrameEdit,
): PokemonAnimation {
  const animation = getPokemonAnimation(project, spriteId, side);
  const sequence = animation.sequences[sequenceIndex];
  const frame = sequence?.frames[frameIndex];
  if (!sequence || !frame) throw new Error("Animation frame is out of range");
  const safe = sanitizePokemonAnimationFrameEdit(next);
  const raw = animation.raw.slice();
  writeU16(raw, frame.sequenceFrameOffset + 4, safe.duration);
  writeU16(raw, frame.valueOffset, safe.cellIndex);
  if (sequence.motionType === 2) {
    writeS16(raw, frame.valueOffset + 4, safe.x);
    writeS16(raw, frame.valueOffset + 6, safe.y);
  } else if (sequence.motionType === 1) {
    writeU16(raw, frame.valueOffset + 2, Math.round((((safe.rotation % 360) + 360) % 360) * 65536 / 360));
    writeS32(raw, frame.valueOffset + 4, Math.round(safe.xScale * 0x1000));
    writeS32(raw, frame.valueOffset + 8, Math.round(safe.yScale * 0x1000));
    writeS16(raw, frame.valueOffset + 0x0c, safe.x);
    writeS16(raw, frame.valueOffset + 0x0e, safe.y);
  }
  writePokemonSpriteFile(project, spriteId, animationFileIndex(side), compressLz11Literal(raw));
  return parsePokemonAnimation(raw, side);
}

export function updatePokemonAnimationFrame(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  sequenceIndex: number,
  frameIndex: number,
  update: Partial<PokemonAnimationFrameEdit>,
): PokemonAnimation {
  const animation = getPokemonAnimation(project, spriteId, side);
  const sequence = animation.sequences[sequenceIndex];
  const frame = sequence?.frames[frameIndex];
  if (!sequence || !frame) throw new Error("Animation frame is out of range");
  return setPokemonAnimationFrame(project, spriteId, side, sequenceIndex, frameIndex, {
    duration: frame.duration,
    cellIndex: frame.cellIndex,
    x: frame.x,
    y: frame.y,
    rotation: frame.rotation,
    xScale: frame.xScale,
    yScale: frame.yScale,
    ...update,
  });
}

export function scalePokemonAnimationDurations(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  ratio: number,
): void {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  scaleAnimationFileDurations(project, spriteId, side, animationFileIndex(side), "RNAN", "Animation", safeRatio, true);
  scaleAnimationFileDurations(project, spriteId, side, multiCellAnimationFileIndex(side), "RAMN", "Multi-cell animation", safeRatio, false);
}

export function rewritePokemonAnimationSequences(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  sequenceFrames: PokemonAnimationFrameEdit[][],
): PokemonAnimation {
  const animation = getPokemonAnimation(project, spriteId, side);
  const sequences = animation.sequences.map((sequence, index) => ({
    targetType: (sequence.targetType === 2 ? 2 : 1) as 1 | 2,
    mode: sequence.mode,
    frames: sequenceFrames[index] ?? sequence.frames.map(animationFrameEdit),
  }));
  const raw = buildPokemonAnimationFile(sequences);
  writePokemonSpriteFile(project, spriteId, animationFileIndex(side), compressLz11Literal(raw));
  const loopDuration = Math.max(1, sequenceFrames[0]?.reduce((sum, frame) => sum + Math.max(1, Math.round(frame.duration)), 0) ?? 1);
  writePokemonSpriteFile(project, spriteId, multiCellAnimationFileIndex(side), buildPokemonMultiCellAnimationFile(loopDuration));
  return parsePokemonAnimation(raw, side);
}

export function parseRigCells(bytes: Uint8Array): RigCellsFile {
  if (bytes.length === 0) return { cells: [], flags: new Uint8Array() };
  const count = Math.min(readU32(bytes, 0), Math.max(0, Math.floor((bytes.length - 12) / 48)));
  const cells = Array.from({ length: count }, (_, index) => {
    const offset = 12 + index * 48;
    return {
      spriteX: readS32(bytes, offset) / 0x100,
      spriteY: readS32(bytes, offset + 4) / 0x100,
      width: readS32(bytes, offset + 8) / 0x1000,
      height: readS32(bytes, offset + 12) / 0x1000,
      cellX: readS32(bytes, offset + 16) / 0x1000,
      cellY: readS32(bytes, offset + 20) / 0x1000,
      subCell: {
        spriteX: readS32(bytes, offset + 24) / 0x100,
        spriteY: readS32(bytes, offset + 28) / 0x100,
        width: readS32(bytes, offset + 32) / 0x1000,
        height: readS32(bytes, offset + 36) / 0x1000,
        cellX: readS32(bytes, offset + 40) / 0x1000,
        cellY: readS32(bytes, offset + 44) / 0x1000,
        subCell: emptyRigCell(),
      },
    };
  });
  const flagPos = count * 48 + 12;
  return { cells, flags: bytes.slice(Math.min(flagPos, bytes.length)) };
}

export function parsePokemonAnimation(bytes: Uint8Array, side: PokemonAnimationSide = "front", signature = "RNAN", label = "Animation"): PokemonAnimation {
  if (readAscii(bytes, 0, 4) !== signature) throw new Error(`${label} file is not ${signature === "RAMN" ? "RAMN/NMAR" : "RNAN/NANR"}`);
  const abnk = findNnsBlockPayload(bytes, "ABNK");
  if (!abnk) throw new Error("Animation file is missing ABNK data");
  const sequenceCount = readU16(bytes, abnk.offset);
  const sequenceArrayOffset = readU32(bytes, abnk.offset + 4);
  const frameArrayOffset = readU32(bytes, abnk.offset + 8);
  const animationOffset = readU32(bytes, abnk.offset + 0x0c);
  const sequences: PokemonAnimationSequence[] = [];
  for (let index = 0; index < sequenceCount; index += 1) {
    const sequenceOffset = abnk.offset + sequenceArrayOffset + index * 0x10;
    if (sequenceOffset + 0x10 > bytes.length) break;
    const frameCount = readU16(bytes, sequenceOffset);
    const startFrameIndex = readU16(bytes, sequenceOffset + 2);
    const type = readU32(bytes, sequenceOffset + 4);
    const motionType = type & 0xffff;
    const targetType = type >>> 16;
    const mode = readU32(bytes, sequenceOffset + 8);
    const sequenceFramesOffset = abnk.offset + frameArrayOffset + readU32(bytes, sequenceOffset + 0x0c);
    const frames: PokemonAnimationFrame[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const sequenceFrameOffset = sequenceFramesOffset + frameIndex * 8;
      if (sequenceFrameOffset + 8 > bytes.length) break;
      const valueOffset = abnk.offset + animationOffset + readU32(bytes, sequenceFrameOffset);
      if (valueOffset + pokemonAnimationFrameSize(motionType) > bytes.length) continue;
      frames.push(readPokemonAnimationFrame(bytes, motionType, valueOffset, sequenceFrameOffset));
    }
    sequences.push({ index, frameCount, startFrameIndex, motionType, targetType, mode, frames });
  }
  return { side, sequences, raw: bytes };
}

function scaleAnimationFileDurations(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  fileIndex: number,
  signature: "RNAN" | "RAMN",
  label: string,
  ratio: number,
  compress: boolean,
): void {
  const entry = getPokemonSpriteEntry(project, spriteId);
  const file = entry.files[fileIndex];
  if (!file || file.length === 0) return;
  const raw = (signature === "RNAN" ? decompressNitro(file) : decompressNitroIfNeeded(file)).slice();
  const animation = parsePokemonAnimation(raw, side, signature, label);
  for (const sequence of animation.sequences) {
    for (const frame of sequence.frames) {
      writeU16(raw, frame.sequenceFrameOffset + 4, clampInt(Math.round(frame.duration * ratio), 1, 0xffff));
    }
  }
  writePokemonSpriteFile(project, spriteId, fileIndex, compress ? compressLz11Literal(raw) : raw);
}

function animationFrameEdit(frame: PokemonAnimationFrame): PokemonAnimationFrameEdit {
  return {
    duration: frame.duration,
    cellIndex: frame.cellIndex,
    x: frame.x,
    y: frame.y,
    rotation: frame.rotation,
    xScale: frame.xScale,
    yScale: frame.yScale,
  };
}

function validatePokemonAnimationReferences(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  animation: PokemonAnimation,
  kind: "nanr" | "nmar",
): void {
  const targetCount = kind === "nanr" ? getPokemonCellBank(project, spriteId, side).cells.length : getPokemonMultiCells(project, spriteId, side).cells.length;
  animation.sequences.forEach((sequence, sequenceIndex) => {
    if (sequence.frames.length === 0) throw new Error(`${kind.toUpperCase()} sequence ${sequenceIndex} must contain at least one frame`);
    sequence.frames.forEach((frame, frameIndex) => {
      if (!Number.isInteger(frame.cellIndex) || frame.cellIndex < 0 || frame.cellIndex >= targetCount) {
        throw new Error(`${kind.toUpperCase()} sequence ${sequenceIndex} frame ${frameIndex} references missing ${kind === "nanr" ? "NCER cell" : "NMCR group"} ${frame.cellIndex}`);
      }
    });
  });
}

function validatePokemonMultiCellReferences(project: ProjectState, spriteId: number, side: PokemonAnimationSide, multiCells: PokemonMultiCells): void {
  const sequenceCount = getPokemonAnimation(project, spriteId, side).sequences.length;
  multiCells.cells.forEach((cell, cellIndex) => {
    if (cell.cellAnimationCount < 1) throw new Error(`NMCR group ${cellIndex} must have at least one cell animation`);
    cell.nodes.forEach((node, nodeIndex) => {
      if (!Number.isInteger(node.sequenceNumber) || node.sequenceNumber < 0 || node.sequenceNumber >= sequenceCount) {
        throw new Error(`NMCR group ${cellIndex} node ${nodeIndex} references missing NANR sequence ${node.sequenceNumber}`);
      }
      if (!Number.isInteger(node.cellAnimationIndex) || node.cellAnimationIndex < 0 || node.cellAnimationIndex >= cell.cellAnimationCount) {
        throw new Error(`NMCR group ${cellIndex} node ${nodeIndex} cell animation index must be < ${cell.cellAnimationCount}`);
      }
    });
  });
}

export function parsePokemonMultiCells(bytes: Uint8Array, side: PokemonAnimationSide = "front"): PokemonMultiCells {
  if (readAscii(bytes, 0, 4) !== "RCMN") throw new Error("Multi-cell file is not RCMN/NMCR");
  const mcbk = findNnsBlockPayload(bytes, "MCBK");
  if (!mcbk) throw new Error("Multi-cell file is missing MCBK data");
  const count = readU16(bytes, mcbk.offset);
  const multiCellOffset = mcbk.offset + readU32(bytes, mcbk.offset + 4);
  const hierarchyOffset = mcbk.offset + readU32(bytes, mcbk.offset + 8);
  const cells: PokemonMultiCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = multiCellOffset + index * 8;
    if (offset + 8 > bytes.length) break;
    const nodeCount = readU16(bytes, offset);
    const cellAnimationCount = readU16(bytes, offset + 2);
    const nodeOffset = hierarchyOffset + readU32(bytes, offset + 4);
    const nodes: PokemonMultiCellNode[] = [];
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const node = nodeOffset + nodeIndex * 8;
      if (node + 8 > bytes.length) break;
      const nodeAttr = readU16(bytes, node + 6);
      nodes.push({
        sequenceNumber: readU16(bytes, node),
        x: readS16(bytes, node + 2),
        y: readS16(bytes, node + 4),
        nodeAttr,
        cellAnimationIndex: (nodeAttr >>> 8) & 0xff,
        playMode: nodeAttr & 0x0f,
        visible: ((nodeAttr >>> 5) & 1) === 1,
      });
    }
    cells.push({ index, nodes, cellAnimationCount });
  }
  return { side, cells, raw: bytes };
}

export function parsePokemonCellBank(bytes: Uint8Array, side: PokemonAnimationSide = "front"): PokemonCellBank {
  if (readAscii(bytes, 0, 4) !== "RECN") throw new Error("Cell bank file is not RECN/NCER");
  const cebk = findNnsBlockPayload(bytes, "CEBK");
  if (!cebk) throw new Error("Cell bank file is missing CEBK data");
  const count = readU16(bytes, cebk.offset);
  const bankAttribs = readU16(bytes, cebk.offset + 2);
  const cellDataOffset = cebk.offset + readU32(bytes, cebk.offset + 4);
  const mappingMode = readU32(bytes, cebk.offset + 8);
  const cellRecordSize = 8 + (bankAttribs === 1 ? 8 : 0);
  const oamDataOffset = cellDataOffset + count * cellRecordSize;
  const cells: PokemonCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const cellOffset = cellDataOffset + index * cellRecordSize;
    if (cellOffset + 8 > bytes.length) break;
    const nAttribs = readU16(bytes, cellOffset);
    const cellAttr = readU16(bytes, cellOffset + 2);
    const attrOffset = oamDataOffset + readU32(bytes, cellOffset + 4);
    const oams: PokemonCellOam[] = [];
    for (let oamIndex = 0; oamIndex < nAttribs; oamIndex += 1) {
      const offset = attrOffset + oamIndex * 6;
      if (offset + 6 > bytes.length) break;
      oams.push(decodePokemonCellOam(readU16(bytes, offset), readU16(bytes, offset + 2), readU16(bytes, offset + 4)));
    }
    const bounds =
      bankAttribs === 1 && cellOffset + 16 <= bytes.length
        ? {
            maxX: readS16(bytes, cellOffset + 8),
            maxY: readS16(bytes, cellOffset + 10),
            minX: readS16(bytes, cellOffset + 12),
            minY: readS16(bytes, cellOffset + 14),
          }
        : boundsForOams(oams);
    cells.push({ index, nAttribs, cellAttr, ...bounds, oams });
  }
  return { side, mappingMode, cells, raw: bytes };
}

export function readPalette(bytes: Uint8Array): RgbColor[] {
  if (bytes.length < PALETTE_OFFSET + 32) return Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
  return Array.from({ length: 16 }, (_, index) => readBgr555(readU16(bytes, PALETTE_OFFSET + index * 2)));
}

export function decompressNitro(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  if (data[0] === 0x10) return decompressLz10(data);
  if (data[0] === 0x11) return decompressLz11(data);
  throw new Error(`Unsupported Nitro compression type: 0x${(data[0] ?? 0).toString(16)}`);
}

function decompressNitroIfNeeded(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  return data[0] === 0x10 || data[0] === 0x11 ? decompressNitro(data) : data;
}

export function compressLz11Literal(data: Uint8Array): Uint8Array {
  const headerLength = data.length < 0x1000000 ? 4 : 8;
  const groups = Math.ceil(data.length / 8);
  const out = new Uint8Array(headerLength + groups + data.length);
  out[0] = 0x11;
  if (headerLength === 4) {
    out[1] = data.length & 0xff;
    out[2] = (data.length >>> 8) & 0xff;
    out[3] = (data.length >>> 16) & 0xff;
  } else {
    writeU32LE(out, 4, data.length);
  }
  let input = 0;
  let output = headerLength;
  while (input < data.length) {
    out[output++] = 0;
    const count = Math.min(8, data.length - input);
    out.set(data.subarray(input, input + count), output);
    input += count;
    output += count;
  }
  return out;
}

function decodeBattleSpriteImage(data: Uint8Array, palette: RgbColor[]): RgbaImageData {
  const tiled = decodeTiled4bpp(data, 64, 144, palette);
  const out = emptyImage(96, 96);
  for (const rect of SPRITE_UNSCRAMBLE_RECTS) copyRect(tiled, out, rect[4], rect[5], rect[2], rect[3], rect[0], rect[1]);
  return out;
}

function decodeBattleSpriteIndices(data: Uint8Array): IndexedImageData {
  const tiled = decodeTiled4bppIndices(data, 64, 144);
  const out = emptyIndexedImage(96, 96);
  for (const rect of SPRITE_UNSCRAMBLE_RECTS) copyIndexRect(tiled, out, rect[4], rect[5], rect[2], rect[3], rect[0], rect[1]);
  return out;
}

function encodeBattleSpriteImage(data: Uint8Array, image: RgbaImageData, palette: RgbColor[]): void {
  const scrambled = emptyImage(64, 144);
  for (const rect of SPRITE_UNSCRAMBLE_RECTS) copyRect(image, scrambled, rect[0], rect[1], rect[2], rect[3], rect[4], rect[5]);
  encodeTiled4bpp(data, scrambled, palette);
}

function decodeRigImage(data: Uint8Array, palette: RgbColor[], dimensions: RigAtlasDimensions): RgbaImageData {
  return decodeLinear4bpp(data, dimensions.width, dimensions.height, palette);
}

function encodeRigImage(data: Uint8Array, image: RgbaImageData, palette: RgbColor[]): void {
  encodeLinear4bpp(data, image, palette);
}

function ensureRigImageDataCapacity(data: Uint8Array, dimensions: RigAtlasDimensions): Uint8Array {
  const dataSize = dimensions.width * dimensions.height / 2;
  const requiredLength = IMAGE_DATA_OFFSET + dataSize;
  if (data.length >= requiredLength) return data;
  const rahc = findNnsBlockPayload(data, "CHAR") ?? findNnsBlockPayload(data, "RAHC");
  if (!rahc) throw new Error("Rig image file is missing a RAHC character block");

  const out = new Uint8Array(requiredLength);
  out.set(data);
  const blockOffset = rahc.offset - 8;
  const blockSize = requiredLength - blockOffset;
  writeU32(out, 8, requiredLength);
  writeU32(out, blockOffset + 4, blockSize);
  writeU16(out, rahc.offset, dimensions.height / 8);
  writeU16(out, rahc.offset + 2, dimensions.width / 8);
  writeU32(out, rahc.offset + 0x10, dataSize);
  return out;
}

function decodeIconImage(data: Uint8Array, palette: RgbColor[]): RgbaImageData {
  return decodeTiled4bpp(data, 32, 64, palette);
}

function encodeIconImage(data: Uint8Array, image: RgbaImageData, palette: RgbColor[]): void {
  encodeTiled4bpp(data, image, palette);
}

function decodeTiled4bpp(data: Uint8Array, width: number, height: number, palette: RgbColor[]): RgbaImageData {
  const out = emptyImage(width, height);
  const widthInTiles = width / 8;
  const tileCount = (width * height) / 64;
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = tile % widthInTiles;
    const tileY = Math.floor(tile / widthInTiles);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const packed = data[tile * 32 + y * 4 + Math.floor(x / 2) + IMAGE_DATA_OFFSET] ?? 0;
        const colorIndex = (packed >>> ((x % 2) * 4)) & 0x0f;
        setPixel(out, tileX * 8 + x, tileY * 8 + y, palette[colorIndex], colorIndex === 0 ? 0 : 255);
      }
    }
  }
  return out;
}

function decodeTiled4bppIndices(data: Uint8Array, width: number, height: number): IndexedImageData {
  const out = emptyIndexedImage(width, height);
  const widthInTiles = width / 8;
  const tileCount = (width * height) / 64;
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = tile % widthInTiles;
    const tileY = Math.floor(tile / widthInTiles);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const packed = data[tile * 32 + y * 4 + Math.floor(x / 2) + IMAGE_DATA_OFFSET] ?? 0;
        out.indices[(tileY * 8 + y) * width + tileX * 8 + x] = (packed >>> ((x % 2) * 4)) & 0x0f;
      }
    }
  }
  return out;
}

function encodeTiled4bpp(data: Uint8Array, image: RgbaImageData, palette: RgbColor[]): void {
  const widthInTiles = image.width / 8;
  const tileCount = (image.width * image.height) / 64;
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = tile % widthInTiles;
    const tileY = Math.floor(tile / widthInTiles);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const offset = tile * 32 + y * 4 + Math.floor(x / 2) + IMAGE_DATA_OFFSET;
        if (offset >= data.length) throw new Error("Image data does not fit in the target sprite file");
        const colorIndex = findPaletteColor(image, tileX * 8 + x, tileY * 8 + y, palette);
        data[offset] = x % 2 === 0 ? (data[offset] & 0xf0) | colorIndex : (data[offset] & 0x0f) | (colorIndex << 4);
      }
    }
  }
}

function decodeLinear4bpp(data: Uint8Array, width: number, height: number, palette: RgbColor[]): RgbaImageData {
  const out = emptyImage(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const packed = data[Math.floor(i / 2) + IMAGE_DATA_OFFSET] ?? 0;
    const colorIndex = i % 2 === 0 ? packed & 0x0f : (packed >>> 4) & 0x0f;
    setPixel(out, i % width, Math.floor(i / width), palette[colorIndex], colorIndex === 0 ? 0 : 255);
  }
  return out;
}

function decodeLinear4bppIndices(data: Uint8Array, width: number, height: number): IndexedImageData {
  const out = emptyIndexedImage(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const packed = data[Math.floor(i / 2) + IMAGE_DATA_OFFSET] ?? 0;
    out.indices[i] = i % 2 === 0 ? packed & 0x0f : (packed >>> 4) & 0x0f;
  }
  return out;
}

function encodeLinear4bpp(data: Uint8Array, image: RgbaImageData, palette: RgbColor[]): void {
  for (let i = 0; i < image.width * image.height; i += 1) {
    const offset = Math.floor(i / 2) + IMAGE_DATA_OFFSET;
    if (offset >= data.length) throw new Error("Image data does not fit in the target rig file");
    const colorIndex = findPaletteColor(image, i % image.width, Math.floor(i / image.width), palette);
    data[offset] = i % 2 === 0 ? (data[offset] & 0xf0) | colorIndex : (data[offset] & 0x0f) | (colorIndex << 4);
  }
}

function spriteVariantFileIndex(variant: PokemonSpriteVariant): number {
  const sideOffset = variant.side === "back" ? 9 : 0;
  const kindOffset = variant.kind === "rig" ? 2 : 0;
  const genderOffset = variant.gender === "female" ? 1 : 0;
  return sideOffset + kindOffset + genderOffset;
}

function animationFileIndex(side: PokemonAnimationSide): number {
  return side === "front" ? 5 : 14;
}

function multiCellFileIndex(side: PokemonAnimationSide): number {
  return side === "front" ? 6 : 15;
}

function multiCellAnimationFileIndex(side: PokemonAnimationSide): number {
  return side === "front" ? 7 : 16;
}

function cellBankFileIndex(side: PokemonAnimationSide): number {
  return side === "front" ? 4 : 13;
}

function findNnsBlockPayload(bytes: Uint8Array, signature: string): { offset: number; size: number } | undefined {
  const expected = signature.split("").reverse().join("");
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let i = 0; i < sectionCount && offset + 8 <= bytes.length; i += 1) {
    const blockSize = readU32(bytes, offset + 4);
    if (readAscii(bytes, offset, 4) === expected) return { offset: offset + 8, size: Math.max(0, blockSize - 8) };
    offset += blockSize;
  }
  return undefined;
}

function iconFileIndex(project: ProjectState, spriteId: number, variant: PokemonIconVariant): number {
  return (project.session.baseRom === "BW2" ? 8 : 7) + spriteId * 2 + (variant === "female" ? 1 : 0);
}

function writePokemonSpriteFile(project: ProjectState, spriteId: number, fileIndex: number, bytes: Uint8Array): void {
  const store = project.narcs.pokemon_sprites;
  if (!store) throw new Error("Pokemon sprite NARC is not loaded");
  const absoluteIndex = spriteId * SPRITE_FILES_PER_ENTRY + fileIndex;
  store.rawFiles[absoluteIndex] = bytes;
  markDirty(project, "pokemon_sprites", absoluteIndex);
  recordPokemonSpriteAsset(project, "pokemon_sprites", spriteId, `${spriteFileLabel(fileIndex)} changed.`);
}

function recordPokemonSpriteAsset(project: ProjectState, domain: string, spriteId: number, text: string): void {
  recordGenericChange(project, domain, text, pokemonSpriteSubject(project, spriteId), {
    key: `${domain}:${spriteId}:${text}`,
  });
}

function pokemonSpriteSubject(project: ProjectState, spriteId: number): string {
  return project.texts.banks.pokedex?.[spriteId] ?? `Pokemon sprite ${spriteId}`;
}

function spriteVariantLabel(variant: PokemonSpriteVariant): string {
  return `${variant.gender} ${variant.side} ${variant.kind}`;
}

function spriteFileLabel(fileIndex: number): string {
  return `Sprite file ${fileIndex}`;
}

type IconPaletteAssignmentConfig = {
  offset: number;
  pointerOffset: number;
  heapStartOffset: number;
  capacity: number;
  shiftAfter?: number;
};

type IconPaletteAssignmentLayout = {
  offset: number;
  capacity: number;
};

const DEFAULT_GEN5_ARM9_RAM_ADDRESS = 0x02004000;
const ARM9_MAIN_MEMORY_END = 0x02400000;
const ICON_PALETTE_RELOCATION_HEADER_SIZE = 16;
const ICON_PALETTE_RELOCATION_MAGIC = Uint8Array.of(0x50, 0x57, 0x49, 0x43, 0x4f, 0x4e, 0x50, 0x4c); // PWICONPL

function iconPaletteAssignmentConfig(project: ProjectState): IconPaletteAssignmentConfig | undefined {
  const whiteVersion = project.session.baseVersion === "W" || project.session.baseVersion === "W2";
  if (project.session.baseRom === "BW2") {
    return whiteVersion
      ? { offset: 0x8c578, pointerOffset: 0x1d0e8, heapStartOffset: 0x7741c, capacity: 756, shiftAfter: 680 }
      : { offset: 0x8c54c, pointerOffset: 0x1d0bc, heapStartOffset: 0x773f0, capacity: 756, shiftAfter: 680 };
  }
  if (project.session.baseRom === "BW") {
    return whiteVersion
      ? { offset: 0x9a48c, pointerOffset: 0x17c00, heapStartOffset: 0x8275c, capacity: 712 }
      : { offset: 0x9a474, pointerOffset: 0x17be4, heapStartOffset: 0x82744, capacity: 712 };
  }
  return undefined;
}

function iconPaletteAssignmentLayout(project: ProjectState): IconPaletteAssignmentLayout | undefined {
  const config = iconPaletteAssignmentConfig(project);
  if (!config) return undefined;
  const arm9RamAddress = projectArm9RamAddress(project);
  const pointerAddress = config.pointerOffset + 4 <= project.arm9.length ? readU32(project.arm9, config.pointerOffset) : 0;
  const pointerTableOffset = pointerAddress - arm9RamAddress;
  const markerOffset = pointerTableOffset - ICON_PALETTE_RELOCATION_HEADER_SIZE;

  if (
    pointerTableOffset >= ICON_PALETTE_RELOCATION_HEADER_SIZE &&
    markerOffset + ICON_PALETTE_RELOCATION_HEADER_SIZE <= project.arm9.length &&
    bytesEqual(project.arm9, markerOffset, ICON_PALETTE_RELOCATION_MAGIC) &&
    readU32(project.arm9, markerOffset + 12) === config.pointerOffset
  ) {
    const capacity = readU32(project.arm9, markerOffset + 8);
    if (capacity > 0 && pointerTableOffset + capacity <= project.arm9.length && iconPaletteAssignmentValid(project, pointerTableOffset)) {
      return { offset: pointerTableOffset, capacity };
    }
  }

  if (config.offset + config.capacity <= project.arm9.length && iconPaletteAssignmentValid(project, config.offset)) {
    return { offset: config.offset, capacity: config.capacity };
  }
  return undefined;
}

function iconPaletteAssignmentIndex(project: ProjectState, spriteId: number): number | undefined {
  if (!Number.isInteger(spriteId) || spriteId < 0) return undefined;
  const config = iconPaletteAssignmentConfig(project);
  if (!config) return undefined;
  return spriteId + (config.shiftAfter !== undefined && spriteId > config.shiftAfter ? 2 : 0);
}

function iconPaletteAssignmentValid(project: ProjectState, offset: number): boolean {
  if (project.arm9.length < offset + 16) return false;
  for (let i = 0; i < 16; i += 1) {
    const value = project.arm9[offset + i];
    if (value !== 0 && value !== 17 && value !== 34) return false;
  }
  return true;
}

function projectArm9RamAddress(project: ProjectState): number {
  const bytes = project.originalRomBytes;
  if (bytes && bytes.length >= 0x2c) {
    const address = readU32(bytes, 0x28);
    if (address >= 0x02000000 && address < ARM9_MAIN_MEMORY_END) return address;
  }
  return DEFAULT_GEN5_ARM9_RAM_ADDRESS;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function bytesEqual(data: Uint8Array, offset: number, expected: ArrayLike<number>): boolean {
  if (offset < 0 || offset + expected.length > data.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (data[offset + index] !== expected[index]) return false;
  }
  return true;
}

function readBgr555(value: number): RgbColor {
  return {
    r: Math.floor((value & 0x1f) * 8.25),
    g: Math.floor(((value >>> 5) & 0x1f) * 8.25),
    b: Math.floor(((value >>> 10) & 0x1f) * 8.25),
  };
}

function writeBgr555(color: RgbColor): number {
  const r = Math.min(31, Math.ceil(clampByte(color.r) / 8.25));
  const g = Math.min(31, Math.ceil(clampByte(color.g) / 8.25));
  const b = Math.min(31, Math.ceil(clampByte(color.b) / 8.25));
  return r | (g << 5) | (b << 10);
}

function findPaletteColor(image: RgbaImageData, x: number, y: number, palette: RgbColor[]): number {
  const offset = (y * image.width + x) * 4;
  const alpha = image.pixels[offset + 3] ?? 255;
  if (alpha < TRANSPARENT_ALPHA_THRESHOLD) return 0;
  const r = image.pixels[offset] ?? 0;
  const g = image.pixels[offset + 1] ?? 0;
  const b = image.pixels[offset + 2] ?? 0;
  const index = palette.findIndex((color) => color.r === r && color.g === g && color.b === b);
  if (index < 0) throw new Error(`Pixel ${x},${y} is not in the selected 16-color palette`);
  return index;
}

function emptyImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function emptyIndexedImage(width: number, height: number): IndexedImageData {
  return { width, height, indices: new Uint8Array(width * height) };
}

function setPixel(image: RgbaImageData, x: number, y: number, color: RgbColor = { r: 0, g: 0, b: 0 }, alpha = 255): void {
  const offset = (y * image.width + x) * 4;
  image.pixels[offset] = color.r;
  image.pixels[offset + 1] = color.g;
  image.pixels[offset + 2] = color.b;
  image.pixels[offset + 3] = alpha;
}

function copyRect(source: RgbaImageData, target: RgbaImageData, sx: number, sy: number, width: number, height: number, tx: number, ty: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = ((sy + y) * source.width + sx + x) * 4;
      const targetOffset = ((ty + y) * target.width + tx + x) * 4;
      target.pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

function copyIndexRect(source: IndexedImageData, target: IndexedImageData, sx: number, sy: number, width: number, height: number, tx: number, ty: number): void {
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (sy + y) * source.width + sx;
    const targetStart = (ty + y) * target.width + tx;
    target.indices.set(source.indices.subarray(sourceStart, sourceStart + width), targetStart);
  }
}

function parseSectionFile(bytes: Uint8Array): Map<string, Uint8Array> {
  const sections = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0x7b) throw new Error("Invalid section file");
    const nameStart = offset;
    while (offset < bytes.length && bytes[offset] !== 0x7c) offset += 1;
    if (offset >= bytes.length) throw new Error("Invalid section header");
    const name = new TextDecoder("ascii").decode(bytes.subarray(nameStart, offset));
    offset += 1;
    const length = readU32(bytes, offset);
    offset += 4;
    if (bytes[offset++] !== 0x3a) throw new Error("Invalid section payload");
    const data = bytes.slice(offset, offset + length);
    offset += length;
    if (bytes[offset++] !== 0x7d) throw new Error("Invalid section terminator");
    sections.set(name, data);
  }
  return sections;
}

function decompressLz10(data: Uint8Array): Uint8Array {
  const { length, dataOffset } = nitroLength(data);
  const out = new Uint8Array(length);
  let input = dataOffset;
  let output = 0;
  while (output < out.length) {
    const flags = data[input++] ?? 0;
    for (let bit = 0; bit < 8 && output < out.length; bit += 1) {
      if ((flags & (0x80 >>> bit)) !== 0) {
        const first = data[input++] ?? 0;
        const second = data[input++] ?? 0;
        const count = (first >>> 4) + 3;
        const disp = ((first & 0x0f) << 8) | second;
        copyDisplacement(out, output, disp, count);
        output += count;
      } else {
        out[output++] = data[input++] ?? 0;
      }
    }
  }
  return out;
}

function decompressLz11(data: Uint8Array): Uint8Array {
  const { length, dataOffset } = nitroLength(data);
  const out = new Uint8Array(length);
  let input = dataOffset;
  let output = 0;
  while (output < out.length) {
    const flags = data[input++] ?? 0;
    for (let bit = 0; bit < 8 && output < out.length; bit += 1) {
      if ((flags & (0x80 >>> bit)) === 0) {
        out[output++] = data[input++] ?? 0;
        continue;
      }
      const first = data[input++] ?? 0;
      let count = 0;
      let disp = 0;
      if ((first >>> 4) === 0) {
        const second = data[input++] ?? 0;
        const third = data[input++] ?? 0;
        count = ((first & 0x0f) << 4) + (second >>> 4) + 0x11;
        disp = ((second & 0x0f) << 8) | third;
      } else if ((first >>> 4) === 1) {
        const second = data[input++] ?? 0;
        const third = data[input++] ?? 0;
        const fourth = data[input++] ?? 0;
        count = ((first & 0x0f) << 12) + (second << 4) + (third >>> 4) + 0x111;
        disp = ((third & 0x0f) << 8) | fourth;
      } else {
        const second = data[input++] ?? 0;
        count = (first >>> 4) + 1;
        disp = ((first & 0x0f) << 8) | second;
      }
      copyDisplacement(out, output, disp, count);
      output += count;
    }
  }
  return out;
}

function nitroLength(data: Uint8Array): { length: number; dataOffset: number } {
  const shortLength = (data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16);
  if (shortLength !== 0) return { length: shortLength, dataOffset: 4 };
  return { length: readU32(data, 4), dataOffset: 8 };
}

function copyDisplacement(out: Uint8Array, output: number, disp: number, count: number): void {
  const source = output - disp - 1;
  if (source < 0) throw new Error("Invalid Nitro LZ displacement");
  for (let i = 0; i < count && output + i < out.length; i += 1) out[output + i] = out[source + i];
}

function readS32(data: Uint8Array, offset: number): number {
  return readU32(data, offset) | 0;
}

function readS16(data: Uint8Array, offset: number): number {
  const value = readU16(data, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function writeS16(data: Uint8Array, offset: number, value: number): void {
  writeU16(data, offset, clampInt(value, -0x8000, 0x7fff) & 0xffff);
}

function writeS32(data: Uint8Array, offset: number, value: number): void {
  writeU32LE(data, offset, value >>> 0);
}

function writeU32LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function writeRigCell(out: Uint8Array, offset: number, cell: RigCell, subCell: boolean): void {
  writeS32(out, offset, Math.round(cell.spriteX * 0x100));
  writeS32(out, offset + 4, Math.round(cell.spriteY * 0x100));
  writeS32(out, offset + 8, Math.round(cell.width * 0x1000));
  writeS32(out, offset + 12, Math.round(cell.height * 0x1000));
  writeS32(out, offset + 16, Math.round(cell.cellX * 0x1000));
  writeS32(out, offset + 20, Math.round(cell.cellY * 0x1000));
  if (!subCell) return;
}

function writeRigCellsHeader(out: Uint8Array, cells: RigCell[]): void {
  out.fill(0, 4, 12);
  if (cells.length === 0) return;
  const bounds = rigCellsBounds(cells);
  writeU16(out, 4, clampInt(Math.ceil(bounds.maxX - bounds.minX), 0, 0xffff));
  writeU16(out, 6, clampInt(Math.ceil(bounds.maxY - bounds.minY), 0, 0xffff));
  writeS16(out, 8, Math.round((bounds.minX + bounds.maxX) / 2));
  writeS16(out, 10, Math.round((bounds.minY + bounds.maxY) / 2));
}

function rigCellsBounds(cells: RigCell[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (cell: RigCell | undefined): void => {
    if (!cell || cell.width <= 0 || cell.height <= 0) return;
    minX = Math.min(minX, cell.spriteX);
    maxX = Math.max(maxX, cell.spriteX + cell.width);
    minY = Math.min(minY, cell.spriteY - cell.height);
    maxY = Math.max(maxY, cell.spriteY);
  };
  for (const cell of cells) {
    include(cell);
    include(cell.subCell);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function emptyRigCell(): RigCell {
  return { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell };
}

function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function u32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32LE(out, 0, value);
  return out;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizePokemonAnimationFrameEdit(next: PokemonAnimationFrameEdit): PokemonAnimationFrameEdit {
  return {
    duration: clampInt(next.duration, 1, 0xffff),
    cellIndex: clampInt(next.cellIndex, 0, 0xffff),
    x: clampInt(next.x, -0x8000, 0x7fff),
    y: clampInt(next.y, -0x8000, 0x7fff),
    rotation: Number.isFinite(next.rotation) ? next.rotation : 0,
    xScale: clampFinite(next.xScale, -128, 128, 1),
    yScale: clampFinite(next.yScale, -128, 128, 1),
  };
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function pokemonAnimationFrameSize(motionType: number): number {
  if (motionType === 1) return 16;
  if (motionType === 2) return 8;
  return 2;
}

function decodePokemonCellOam(attr0: number, attr1: number, attr2: number): PokemonCellOam {
  const shape = attr0 >>> 14;
  const size = attr1 >>> 14;
  const rotateScale = ((attr0 >>> 8) & 1) === 1;
  const characterBits = ((attr0 >>> 13) & 1) === 1 ? 8 : 4;
  const [width, height] = pokemonObjDimensions(shape, size);
  return {
    x: signExtend(attr1 & 0x01ff, 9),
    y: signExtend(attr0 & 0x00ff, 8),
    width,
    height,
    characterName: attr2 & 0x03ff,
    palette: (attr2 >>> 12) & 0x0f,
    flipX: !rotateScale && ((attr1 >>> 12) & 1) === 1,
    flipY: !rotateScale && ((attr1 >>> 13) & 1) === 1,
    disable: rotateScale ? false : ((attr0 >>> 9) & 1) === 1,
    rotateScale,
    doubleSize: rotateScale && ((attr0 >>> 9) & 1) === 1,
    matrix: rotateScale ? (attr1 >>> 9) & 0x1f : 0,
    mode: (attr0 >>> 10) & 3,
    mosaic: ((attr0 >>> 12) & 1) === 1,
    shape,
    size,
    priority: (attr2 >>> 10) & 3,
    characterBits,
  };
}

function pokemonObjDimensions(shape: number, size: number): [number, number] {
  const widths = [
    [8, 16, 32, 64],
    [16, 32, 32, 64],
    [8, 8, 16, 32],
    [8, 8, 8, 8],
  ];
  const heights = [
    [8, 16, 32, 64],
    [8, 8, 16, 32],
    [16, 32, 32, 64],
    [8, 8, 8, 8],
  ];
  return [widths[shape]?.[size] ?? 8, heights[shape]?.[size] ?? 8];
}

function boundsForOams(oams: PokemonCellOam[]): Pick<PokemonCell, "minX" | "minY" | "maxX" | "maxY"> {
  const visible = oams.filter((oam) => !oam.disable);
  if (visible.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return visible.reduce(
    (bounds, oam) => ({
      minX: Math.min(bounds.minX, oam.x),
      minY: Math.min(bounds.minY, oam.y),
      maxX: Math.max(bounds.maxX, oam.x + oam.width),
      maxY: Math.max(bounds.maxY, oam.y + oam.height),
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & sign) !== 0 ? value - (1 << bits) : value;
}

function readPokemonAnimationFrame(bytes: Uint8Array, motionType: number, valueOffset: number, sequenceFrameOffset: number): PokemonAnimationFrame {
  const base = {
    duration: readU16(bytes, sequenceFrameOffset + 4),
    cellIndex: readU16(bytes, valueOffset),
    x: 0,
    y: 0,
    rotation: 0,
    xScale: 1,
    yScale: 1,
    valueOffset,
    sequenceFrameOffset,
  };
  if (motionType === 1) {
    return {
      ...base,
      frameType: "index-srt",
      rotation: readU16(bytes, valueOffset + 2) * 360 / 65536,
      xScale: readS32(bytes, valueOffset + 4) / 0x1000,
      yScale: readS32(bytes, valueOffset + 8) / 0x1000,
      x: readS16(bytes, valueOffset + 0x0c),
      y: readS16(bytes, valueOffset + 0x0e),
    };
  }
  if (motionType === 2) {
    return {
      ...base,
      frameType: "index-t",
      x: readS16(bytes, valueOffset + 4),
      y: readS16(bytes, valueOffset + 6),
    };
  }
  return { ...base, frameType: "index" };
}
