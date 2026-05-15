import { concatBytes, pad4, writeU16, writeU32 } from "../nds/binary";
import type {
  PokemonAnimationFrameEdit,
  PokemonAnimationSequence,
  PokemonAnimationSide,
  PokemonCell,
  PokemonMultiCell,
  RigCell,
  RigCellsFile,
} from "./pokemonSpriteModel";

export type PokemonAnimationBundleFileIndex = 4 | 5 | 6 | 7 | 8 | 13 | 14 | 15 | 16 | 17;

export type PokemonAnimationBundle = {
  side: PokemonAnimationSide;
  files: Partial<Record<PokemonAnimationBundleFileIndex, Uint8Array>>;
};

export type PokemonCustomSpriteBundle = {
  side?: PokemonAnimationSide;
  frontSpritePng?: Uint8Array;
  backSpritePng?: Uint8Array;
  frontRigPng?: Uint8Array;
  backRigPng?: Uint8Array;
  normalPalettePng?: Uint8Array;
  shinyPalettePng?: Uint8Array;
  files?: Partial<Record<number, Uint8Array>>;
  animation?: PokemonAnimationBundle;
};

export type PokemonAnimationBuildPart = {
  name?: string;
  cellX: number;
  cellY: number;
  width: number;
  height: number;
  spriteX: number;
  spriteY: number;
  pivot?: { x: number; y: number };
  z?: number;
  frames?: PokemonAnimationFrameEdit[];
};

export type PokemonCellBankBuildOam = {
  x: number;
  y: number;
  width: number;
  height: number;
  characterName: number;
};

export type PokemonCellBankBuildCell = {
  oams: PokemonCellBankBuildOam[];
};

export type PokemonMultiCellsBuildOptions = {
  multiCellCopies?: number;
};

export type PokemonMultiCellBuildNode = {
  sequenceNumber: number;
  x: number;
  y: number;
  cellAnimationIndex?: number;
  playMode?: number;
};

export type PokemonAnimationBuildInput = {
  side: PokemonAnimationSide;
  parts: PokemonAnimationBuildPart[];
  frameDuration?: number;
  loopDuration?: number;
  flags?: Uint8Array;
};

type BuildPart = PokemonAnimationBuildPart & {
  sourceIndex: number;
  pivotX: number;
  pivotY: number;
  nodeX: number;
  nodeY: number;
};

type OamBlock = {
  x: number;
  y: number;
  width: number;
  height: number;
  characterName: number;
  shape: number;
  size: number;
};

type AnimationSequenceInput = {
  targetType: 1 | 2;
  mode: number;
  motionType?: 0 | 1 | 2;
  startFrameIndex?: number;
  frames: PokemonAnimationFrameEdit[];
};

const G2D_HEADER_SIZE = 0x10;
const CEBK_HEADER_SIZE = 0x18;
const ABNK_HEADER_SIZE = 0x18;
const MCBK_HEADER_SIZE = 0x14;
const DEFAULT_FRAME_DURATION = 6;
const DEFAULT_LOOP_DURATION = 72;
const CELL_TARGET_TYPE = 1;
const MULTICELL_TARGET_TYPE = 2;
const FORWARD_LOOP_MODE = 2;
const GEN5_CELL_MAPPING_MODE = 4;

const OAM_SIZES = [
  { width: 64, height: 64, shape: 0, size: 3 },
  { width: 64, height: 32, shape: 1, size: 3 },
  { width: 32, height: 64, shape: 2, size: 3 },
  { width: 32, height: 32, shape: 0, size: 2 },
  { width: 32, height: 16, shape: 1, size: 2 },
  { width: 16, height: 32, shape: 2, size: 2 },
  { width: 32, height: 8, shape: 1, size: 1 },
  { width: 8, height: 32, shape: 2, size: 1 },
  { width: 16, height: 16, shape: 0, size: 1 },
  { width: 16, height: 8, shape: 1, size: 0 },
  { width: 8, height: 16, shape: 2, size: 0 },
  { width: 8, height: 8, shape: 0, size: 0 },
] as const;

export function buildPokemonAnimationAssetBundle(input: PokemonAnimationBuildInput): PokemonAnimationBundle {
  const parts = normalizeBuildParts(input.parts);
  const sideOffset = input.side === "front" ? 0 : 9;
  return {
    side: input.side,
    files: {
      [(4 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonCellBankFile(parts),
      [(5 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonAnimationFile({
        targetType: CELL_TARGET_TYPE,
        mode: FORWARD_LOOP_MODE,
        frames: parts.map((part, index) => normalizedPartFrames(part, index, input.frameDuration)),
      }),
      [(6 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellsFile(parts, { multiCellCopies: 2 }),
      [(7 + sideOffset) as PokemonAnimationBundleFileIndex]: buildPokemonMultiCellAnimationFile(input.loopDuration ?? totalLoopDuration(parts, input.frameDuration)),
      [(8 + sideOffset) as PokemonAnimationBundleFileIndex]: buildRigCellsFile({ cells: parts.map(rigCellFromBuildPart), flags: input.flags ?? new Uint8Array(4) }),
    },
  };
}

export function buildPokemonCellBankFile(parts: PokemonAnimationBuildPart[]): Uint8Array {
  const normalized = "pivotX" in (parts[0] ?? {}) ? (parts as BuildPart[]) : normalizeBuildParts(parts);
  const cellRecords: Uint8Array[] = [];
  const oamRecords: Uint8Array[] = [];
  let oamOffset = 0;
  for (const part of normalized) {
    const oams = oamBlocksForPart(part);
    const minX = Math.min(...oams.map((oam) => oam.x));
    const minY = Math.min(...oams.map((oam) => oam.y));
    const maxX = Math.max(...oams.map((oam) => oam.x + oam.width));
    const maxY = Math.max(...oams.map((oam) => oam.y + oam.height));
    const cell = new Uint8Array(0x10);
    writeU16(cell, 0, oams.length);
    writeU16(cell, 2, 0);
    writeU32(cell, 4, oamOffset);
    writeS16Local(cell, 8, maxX);
    writeS16Local(cell, 10, maxY);
    writeS16Local(cell, 12, minX);
    writeS16Local(cell, 14, minY);
    cellRecords.push(cell);
    for (const oam of oams) oamRecords.push(encodeOam(oam));
    oamOffset += oams.length * 6;
  }

  const payload = new Uint8Array(CEBK_HEADER_SIZE + cellRecords.length * 0x10 + oamRecords.length * 6);
  writeU16(payload, 0, normalized.length);
  writeU16(payload, 2, 1);
  writeU32(payload, 4, CEBK_HEADER_SIZE);
  writeU32(payload, 8, GEN5_CELL_MAPPING_MODE);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  writeU32(payload, 0x14, 0);
  let offset = CEBK_HEADER_SIZE;
  for (const cell of cellRecords) {
    payload.set(cell, offset);
    offset += cell.length;
  }
  for (const oam of oamRecords) {
    payload.set(oam, offset);
    offset += oam.length;
  }
  return writeG2dFile("RECN", [{ signature: "CEBK", payload }]);
}

export function buildPokemonCellBankFileFromCells(cells: PokemonCellBankBuildCell[]): Uint8Array {
  const cellRecords: Uint8Array[] = [];
  const oamRecords: Uint8Array[] = [];
  let oamOffset = 0;
  for (const [cellIndex, cellInput] of cells.entries()) {
    if (cellInput.oams.length === 0) throw new Error(`Cell ${cellIndex} must contain at least one OAM`);
    const oams = cellInput.oams.map((oam) => normalizeExplicitOam(oam, cellIndex));
    const minX = Math.min(...oams.map((oam) => oam.x));
    const minY = Math.min(...oams.map((oam) => oam.y));
    const maxX = Math.max(...oams.map((oam) => oam.x + oam.width));
    const maxY = Math.max(...oams.map((oam) => oam.y + oam.height));
    const cell = new Uint8Array(0x10);
    writeU16(cell, 0, oams.length);
    writeU16(cell, 2, 0);
    writeU32(cell, 4, oamOffset);
    writeS16Local(cell, 8, maxX);
    writeS16Local(cell, 10, maxY);
    writeS16Local(cell, 12, minX);
    writeS16Local(cell, 14, minY);
    cellRecords.push(cell);
    for (const oam of oams) oamRecords.push(encodeOam(oam));
    oamOffset += oams.length * 6;
  }

  const payload = new Uint8Array(CEBK_HEADER_SIZE + cellRecords.length * 0x10 + oamRecords.length * 6);
  writeU16(payload, 0, cellRecords.length);
  writeU16(payload, 2, 1);
  writeU32(payload, 4, CEBK_HEADER_SIZE);
  writeU32(payload, 8, GEN5_CELL_MAPPING_MODE);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  writeU32(payload, 0x14, 0);
  let offset = CEBK_HEADER_SIZE;
  for (const cell of cellRecords) {
    payload.set(cell, offset);
    offset += cell.length;
  }
  for (const oam of oamRecords) {
    payload.set(oam, offset);
    offset += oam.length;
  }
  return writeG2dFile("RECN", [{ signature: "CEBK", payload }]);
}

export function buildPokemonCellBankFileFromParsed(cellBank: { cells: PokemonCell[]; mappingMode?: number }): Uint8Array {
  const cellRecords: Uint8Array[] = [];
  const oamRecords: Uint8Array[] = [];
  let oamOffset = 0;
  for (const [cellIndex, cellInput] of cellBank.cells.entries()) {
    if (cellInput.oams.length === 0) throw new Error(`Cell ${cellIndex} must contain at least one OAM`);
    const oams = cellInput.oams.map((oam) => normalizeParsedOam(oam, cellIndex));
    const visibleOams = oams.filter((oam) => !oam.disable);
    const boundsSource = visibleOams.length ? visibleOams : oams;
    const minX = Math.min(...boundsSource.map((oam) => oam.x));
    const minY = Math.min(...boundsSource.map((oam) => oam.y));
    const maxX = Math.max(...boundsSource.map((oam) => oam.x + oam.width));
    const maxY = Math.max(...boundsSource.map((oam) => oam.y + oam.height));
    const cell = new Uint8Array(0x10);
    writeU16(cell, 0, oams.length);
    writeU16(cell, 2, clampInt(cellInput.cellAttr, 0, 0xffff));
    writeU32(cell, 4, oamOffset);
    writeS16Local(cell, 8, maxX);
    writeS16Local(cell, 10, maxY);
    writeS16Local(cell, 12, minX);
    writeS16Local(cell, 14, minY);
    cellRecords.push(cell);
    for (const oam of oams) oamRecords.push(encodeParsedOam(oam));
    oamOffset += oams.length * 6;
  }

  const payload = new Uint8Array(CEBK_HEADER_SIZE + cellRecords.length * 0x10 + oamRecords.length * 6);
  writeU16(payload, 0, cellRecords.length);
  writeU16(payload, 2, 1);
  writeU32(payload, 4, CEBK_HEADER_SIZE);
  writeU32(payload, 8, cellBank.mappingMode ?? GEN5_CELL_MAPPING_MODE);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  writeU32(payload, 0x14, 0);
  let offset = CEBK_HEADER_SIZE;
  for (const cell of cellRecords) {
    payload.set(cell, offset);
    offset += cell.length;
  }
  for (const oam of oamRecords) {
    payload.set(oam, offset);
    offset += oam.length;
  }
  return writeG2dFile("RECN", [{ signature: "CEBK", payload }]);
}

export function buildPokemonAnimationFile(input: { targetType: 1 | 2; mode?: number; frames: PokemonAnimationFrameEdit[][] }): Uint8Array;
export function buildPokemonAnimationFile(input: PokemonAnimationSequence[]): Uint8Array;
export function buildPokemonAnimationFile(input: AnimationSequenceInput[]): Uint8Array;
export function buildPokemonAnimationFile(input: { targetType: 1 | 2; mode?: number; frames: PokemonAnimationFrameEdit[][] } | Array<AnimationSequenceInput | PokemonAnimationSequence>): Uint8Array {
  const rawSequences: AnimationSequenceInput[] = Array.isArray(input)
    ? input.map((sequence) => ({
        targetType: (sequence.targetType === 2 ? 2 : 1) as 1 | 2,
        mode: sequence.mode,
        motionType: (sequence.motionType === 0 || sequence.motionType === 2 ? sequence.motionType : 1) as 0 | 1 | 2,
        startFrameIndex: sequence.startFrameIndex,
        frames: sequence.frames,
      }))
    : input.frames.map((frames) => ({ targetType: input.targetType, mode: input.mode ?? FORWARD_LOOP_MODE, frames }));
  const sequences = rawSequences.map((sequence) => ({
    ...sequence,
    frames: sequence.frames.length > 0 ? sequence.frames : [defaultFrame(0, DEFAULT_FRAME_DURATION)],
  }));
  const sequenceBytes = new Uint8Array(sequences.length * 0x10);
  const frameBytes = new Uint8Array(sequences.reduce((sum, sequence) => sum + sequence.frames.length, 0) * 8);
  const valueParts: Uint8Array[] = [];
  let frameOffset = 0;
  let valueOffset = 0;

  sequences.forEach((sequence, sequenceIndex) => {
    const frames = sequence.frames;
    const motionType = sequence.motionType ?? 1;
    const sequenceOffset = sequenceIndex * 0x10;
    writeU16(sequenceBytes, sequenceOffset, frames.length);
    writeU16(sequenceBytes, sequenceOffset + 2, clampInt(sequence.startFrameIndex ?? 0, 0, 0xffff));
    writeU32(sequenceBytes, sequenceOffset + 4, motionType | (sequence.targetType << 16));
    writeU32(sequenceBytes, sequenceOffset + 8, sequence.mode);
    writeU32(sequenceBytes, sequenceOffset + 0x0c, frameOffset);
    for (const frame of frames) {
      valueOffset = alignValueParts(valueParts, valueOffset, motionType === 0 ? 2 : 4);
      const value = encodeAnimationFrame(frame, motionType);
      const frameRecordOffset = frameOffset;
      writeU32(frameBytes, frameRecordOffset, valueOffset);
      writeU16(frameBytes, frameRecordOffset + 4, clampInt(frame.duration, 1, 0xffff));
      writeU16(frameBytes, frameRecordOffset + 6, 0);
      valueParts.push(value);
      valueOffset += value.length;
      frameOffset += 8;
    }
  });

  const values = concatBytes(valueParts);
  const payload = new Uint8Array(ABNK_HEADER_SIZE + sequenceBytes.length + frameBytes.length + values.length);
  writeU16(payload, 0, sequences.length);
  writeU16(payload, 2, frameBytes.length / 8);
  writeU32(payload, 4, ABNK_HEADER_SIZE);
  writeU32(payload, 8, ABNK_HEADER_SIZE + sequenceBytes.length);
  writeU32(payload, 0x0c, ABNK_HEADER_SIZE + sequenceBytes.length + frameBytes.length);
  payload.set(sequenceBytes, ABNK_HEADER_SIZE);
  payload.set(frameBytes, ABNK_HEADER_SIZE + sequenceBytes.length);
  payload.set(values, ABNK_HEADER_SIZE + sequenceBytes.length + frameBytes.length);
  return writeG2dFile(sequences.every((sequence) => sequence.targetType === MULTICELL_TARGET_TYPE) ? "RAMN" : "RNAN", [{ signature: "ABNK", payload }]);
}

export function buildPokemonMultiCellsFile(parts: PokemonAnimationBuildPart[], options: PokemonMultiCellsBuildOptions = {}): Uint8Array {
  const normalized = "nodeX" in (parts[0] ?? {}) ? (parts as BuildPart[]) : normalizeBuildParts(parts);
  const nodes = normalized
    .map((part, index) => ({ part, index }))
    .sort((left, right) => (left.part.z ?? 0) - (right.part.z ?? 0) || left.index - right.index);
  const multiCellCopies = clampInt(options.multiCellCopies ?? 1, 1, 2);
  const multiCellRecordSize = multiCellCopies * 8;
  const hierarchySize = nodes.length * 8 * multiCellCopies;
  const payload = new Uint8Array(MCBK_HEADER_SIZE + multiCellRecordSize + hierarchySize);
  writeU16(payload, 0, multiCellCopies);
  writeU16(payload, 2, 0xbeef);
  writeU32(payload, 4, MCBK_HEADER_SIZE);
  writeU32(payload, 8, MCBK_HEADER_SIZE + multiCellRecordSize);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  for (let copyIndex = 0; copyIndex < multiCellCopies; copyIndex += 1) {
    const recordOffset = MCBK_HEADER_SIZE + copyIndex * 8;
    writeU16(payload, recordOffset, nodes.length);
    writeU16(payload, recordOffset + 2, normalized.length);
    writeU32(payload, recordOffset + 4, copyIndex * nodes.length * 8);
  }
  let offset = MCBK_HEADER_SIZE + multiCellRecordSize;
  for (let copyIndex = 0; copyIndex < multiCellCopies; copyIndex += 1) {
    nodes.forEach(({ part, index }) => {
      writeU16(payload, offset, index);
      writeS16Local(payload, offset + 2, part.nodeX);
      writeS16Local(payload, offset + 4, part.nodeY);
      writeU16(payload, offset + 6, ((index & 0xff) << 8) | 0x20);
      offset += 8;
    });
  }
  return writeG2dFile("RCMN", [{ signature: "MCBK", payload }]);
}

export function buildPokemonMultiCellsFileFromCells(cells: PokemonMultiCellBuildNode[][]): Uint8Array {
  const safeCells = cells.length ? cells : [[{ sequenceNumber: 0, x: 0, y: 0 }]];
  const multiCellRecordSize = safeCells.length * 8;
  const hierarchySize = safeCells.reduce((sum, nodes) => sum + nodes.length * 8, 0);
  const payload = new Uint8Array(MCBK_HEADER_SIZE + multiCellRecordSize + hierarchySize);
  writeU16(payload, 0, safeCells.length);
  writeU16(payload, 2, 0xbeef);
  writeU32(payload, 4, MCBK_HEADER_SIZE);
  writeU32(payload, 8, MCBK_HEADER_SIZE + multiCellRecordSize);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  let hierarchyOffset = 0;
  safeCells.forEach((nodes, index) => {
    const recordOffset = MCBK_HEADER_SIZE + index * 8;
    writeU16(payload, recordOffset, nodes.length);
    writeU16(payload, recordOffset + 2, Math.max(1, nodes.length));
    writeU32(payload, recordOffset + 4, hierarchyOffset);
    hierarchyOffset += nodes.length * 8;
  });
  let offset = MCBK_HEADER_SIZE + multiCellRecordSize;
  for (const nodes of safeCells) {
    nodes.forEach((node, index) => {
      const cellAnimationIndex = clampInt(node.cellAnimationIndex ?? index, 0, 0xff);
      writeU16(payload, offset, clampInt(node.sequenceNumber, 0, 0xffff));
      writeS16Local(payload, offset + 2, clampInt(Math.round(node.x), -0x8000, 0x7fff));
      writeS16Local(payload, offset + 4, clampInt(Math.round(node.y), -0x8000, 0x7fff));
      writeU16(payload, offset + 6, ((cellAnimationIndex & 0xff) << 8) | 0x20 | clampInt(node.playMode ?? 0, 0, 0x0f));
      offset += 8;
    });
  }
  return writeG2dFile("RCMN", [{ signature: "MCBK", payload }]);
}

export function buildPokemonMultiCellsFileFromParsed(cells: PokemonMultiCell[]): Uint8Array {
  const safeCells = cells.length ? cells : [{ index: 0, cellAnimationCount: 1, nodes: [{ sequenceNumber: 0, x: 0, y: 0, nodeAttr: 0x20, cellAnimationIndex: 0, playMode: 0, visible: true }] }];
  const multiCellRecordSize = safeCells.length * 8;
  const hierarchySize = safeCells.reduce((sum, cell) => sum + cell.nodes.length * 8, 0);
  const payload = new Uint8Array(MCBK_HEADER_SIZE + multiCellRecordSize + hierarchySize);
  writeU16(payload, 0, safeCells.length);
  writeU16(payload, 2, 0xbeef);
  writeU32(payload, 4, MCBK_HEADER_SIZE);
  writeU32(payload, 8, MCBK_HEADER_SIZE + multiCellRecordSize);
  writeU32(payload, 0x0c, 0);
  writeU32(payload, 0x10, 0);
  let hierarchyOffset = 0;
  safeCells.forEach((cell, index) => {
    const recordOffset = MCBK_HEADER_SIZE + index * 8;
    writeU16(payload, recordOffset, cell.nodes.length);
    writeU16(payload, recordOffset + 2, Math.max(1, clampInt(cell.cellAnimationCount, 1, 0xffff)));
    writeU32(payload, recordOffset + 4, hierarchyOffset);
    hierarchyOffset += cell.nodes.length * 8;
  });
  let offset = MCBK_HEADER_SIZE + multiCellRecordSize;
  for (const cell of safeCells) {
    for (const node of cell.nodes) {
      const cellAnimationIndex = clampInt(node.cellAnimationIndex, 0, 0xff);
      const playMode = clampInt(node.playMode, 0, 0x0f);
      const visible = node.visible ? 0x20 : 0;
      writeU16(payload, offset, clampInt(node.sequenceNumber, 0, 0xffff));
      writeS16Local(payload, offset + 2, clampInt(Math.round(node.x), -0x8000, 0x7fff));
      writeS16Local(payload, offset + 4, clampInt(Math.round(node.y), -0x8000, 0x7fff));
      writeU16(payload, offset + 6, ((cellAnimationIndex & 0xff) << 8) | visible | playMode);
      offset += 8;
    }
  }
  return writeG2dFile("RCMN", [{ signature: "MCBK", payload }]);
}

export function buildPokemonMultiCellAnimationFile(duration = DEFAULT_LOOP_DURATION): Uint8Array {
  return buildPokemonAnimationFile([{ targetType: MULTICELL_TARGET_TYPE, mode: FORWARD_LOOP_MODE, frames: [defaultFrame(0, duration)] }]);
}

export function buildRigCellsFile(cells: RigCellsFile): Uint8Array {
  const out = new Uint8Array(12 + cells.cells.length * 48 + cells.flags.length);
  writeU32(out, 0, cells.cells.length);
  writeRigCellsHeader(out, cells.cells);
  cells.cells.forEach((cell, index) => {
    writeRigCell(out, 12 + index * 48, cell, false);
    writeRigCell(out, 36 + index * 48, cell.subCell, true);
  });
  out.set(cells.flags, 12 + cells.cells.length * 48);
  return out;
}

export function packagePokemonAnimationBundle(bundle: PokemonAnimationBundle): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(sectionBytes("side", new TextEncoder().encode(bundle.side)));
  for (const [key, file] of Object.entries(bundle.files)) {
    if (!file) continue;
    parts.push(sectionBytes(`file${key}`, file));
  }
  return concatBytes(parts);
}

export function parsePokemonAnimationBundle(bytes: Uint8Array): PokemonAnimationBundle {
  const sections = parseSectionFile(bytes);
  const sideText = decodeAsciiSection(sections.get("side"));
  const side = sideText === "back" ? "back" : "front";
  const validIndexes = side === "front" ? [4, 5, 6, 7, 8] : [13, 14, 15, 16, 17];
  const files: PokemonAnimationBundle["files"] = {};
  for (const index of validIndexes) {
    const file = sections.get(`file${index}`);
    if (file) files[index as PokemonAnimationBundleFileIndex] = file;
  }
  if (Object.keys(files).length === 0) throw new Error("Animation bundle does not contain any sprite animation files");
  return { side, files };
}

export function packagePokemonCustomSpriteBundle(bundle: PokemonCustomSpriteBundle): Uint8Array {
  const parts: Uint8Array[] = [
    sectionBytes("format", new TextEncoder().encode("pokeweb-custom-sprite-bundle-v1")),
    sectionBytes("side", new TextEncoder().encode(bundle.side ?? "front")),
  ];
  if (bundle.frontSpritePng) parts.push(sectionBytes("front_sprite_png", bundle.frontSpritePng));
  if (bundle.backSpritePng) parts.push(sectionBytes("back_sprite_png", bundle.backSpritePng));
  if (bundle.frontRigPng) parts.push(sectionBytes("front_rig_png", bundle.frontRigPng));
  if (bundle.backRigPng) parts.push(sectionBytes("back_rig_png", bundle.backRigPng));
  if (bundle.normalPalettePng) parts.push(sectionBytes("normal_palette_png", bundle.normalPalettePng));
  if (bundle.shinyPalettePng) parts.push(sectionBytes("shiny_palette_png", bundle.shinyPalettePng));
  for (const [key, file] of Object.entries({ ...(bundle.animation?.files ?? {}), ...(bundle.files ?? {}) })) {
    if (!file) continue;
    parts.push(sectionBytes(`file${key}`, file));
  }
  return concatBytes(parts);
}

export function parsePokemonCustomSpriteBundle(bytes: Uint8Array): PokemonCustomSpriteBundle {
  const sections = parseSectionFile(bytes);
  const format = decodeAsciiSection(sections.get("format"));
  if (format !== "pokeweb-custom-sprite-bundle-v1") throw new Error("Custom sprite bundle is not a supported Pokeweb bundle");
  const sideText = decodeAsciiSection(sections.get("side"));
  const side = sideText === "back" ? "back" : "front";
  const files: Partial<Record<number, Uint8Array>> = {};
  for (let index = 0; index < 20; index += 1) {
    const file = sections.get(`file${index}`);
    if (file) files[index] = file;
  }
  const animationIndexes = side === "front" ? [4, 5, 6, 7, 8] : [13, 14, 15, 16, 17];
  const animationFiles: PokemonAnimationBundle["files"] = {};
  for (const index of animationIndexes) {
    const file = files[index];
    if (file) animationFiles[index as PokemonAnimationBundleFileIndex] = file;
  }
  return {
    side,
    frontSpritePng: sections.get("front_sprite_png"),
    backSpritePng: sections.get("back_sprite_png"),
    frontRigPng: sections.get("front_rig_png"),
    backRigPng: sections.get("back_rig_png"),
    normalPalettePng: sections.get("normal_palette_png"),
    shinyPalettePng: sections.get("shiny_palette_png"),
    files,
    animation: Object.keys(animationFiles).length > 0 ? { side, files: animationFiles } : undefined,
  };
}

function normalizeBuildParts(parts: PokemonAnimationBuildPart[]): BuildPart[] {
  if (parts.length === 0) throw new Error("Animation build requires at least one rig part");
  return parts.map((part, sourceIndex) => {
    validateAtlasRect(part, sourceIndex);
    const pivotX = clampFinite(part.pivot?.x, 0, part.width, part.width / 2);
    const pivotY = clampFinite(part.pivot?.y, 0, part.height, part.height / 2);
    return {
      ...part,
      sourceIndex,
      width: roundUp8(part.width),
      height: roundUp8(part.height),
      pivotX,
      pivotY,
      nodeX: Math.round(part.spriteX + pivotX),
      nodeY: Math.round(-part.spriteY + pivotY),
    };
  });
}

function validateAtlasRect(part: PokemonAnimationBuildPart, index: number): void {
  if (part.width <= 0 || part.height <= 0) throw new Error(`Part ${index} must have positive width and height`);
  if (part.cellX % 8 !== 0 || part.cellY % 8 !== 0) throw new Error(`Part ${index} atlas position must be aligned to 8px tiles`);
  const width = roundUp8(part.width);
  const height = roundUp8(part.height);
  if (part.cellX < 0 || part.cellY < 0 || part.cellX + width > 256 || part.cellY + height > 128) throw new Error(`Part ${index} is outside the 256x128 rig atlas`);
}

function normalizedPartFrames(part: BuildPart, index: number, frameDuration = DEFAULT_FRAME_DURATION): PokemonAnimationFrameEdit[] {
  const frames = part.frames?.length ? part.frames : [defaultFrame(index, frameDuration)];
  return frames.map((frame) => ({
    duration: clampInt(frame.duration, 1, 0xffff),
    cellIndex: clampInt(frame.cellIndex, 0, 0xffff),
    x: clampInt(frame.x, -0x8000, 0x7fff),
    y: clampInt(frame.y, -0x8000, 0x7fff),
    rotation: Number.isFinite(frame.rotation) ? frame.rotation : 0,
    xScale: clampFinite(frame.xScale, -128, 128, 1),
    yScale: clampFinite(frame.yScale, -128, 128, 1),
  }));
}

function defaultFrame(cellIndex: number, duration: number): PokemonAnimationFrameEdit {
  return { duration, cellIndex, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 };
}

function totalLoopDuration(parts: BuildPart[], frameDuration?: number): number {
  return Math.max(
    DEFAULT_FRAME_DURATION,
    ...parts.map((part, index) => normalizedPartFrames(part, index, frameDuration).reduce((sum, frame) => sum + Math.max(1, frame.duration), 0)),
  );
}

function rigCellFromBuildPart(part: BuildPart): RigCell {
  return {
    cellX: part.cellX,
    cellY: part.cellY,
    width: part.width,
    height: part.height,
    spriteX: part.spriteX,
    spriteY: part.spriteY,
    subCell: { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell },
  };
}

function oamBlocksForPart(part: BuildPart): OamBlock[] {
  const blocks: OamBlock[] = [];
  const covered = new Uint8Array((part.width / 8) * (part.height / 8));
  for (let y = 0; y < part.height; y += 8) {
    for (let x = 0; x < part.width; x += 8) {
      if (isCovered(covered, part.width, x, y)) continue;
      const size = OAM_SIZES.find((candidate) => candidate.width <= part.width - x && candidate.height <= part.height - y && canPlace(covered, part.width, x, y, candidate.width, candidate.height));
      if (!size) throw new Error(`Could not tile part ${part.sourceIndex}`);
      markCovered(covered, part.width, x, y, size.width, size.height);
      blocks.push({
        x: Math.round(x - part.pivotX),
        y: Math.round(y - part.pivotY),
        width: size.width,
        height: size.height,
        characterName: part.cellX / 8 + (part.cellY / 8) * 32 + x / 8 + (y / 8) * 32,
        shape: size.shape,
        size: size.size,
      });
    }
  }
  return blocks;
}

function normalizeExplicitOam(oam: PokemonCellBankBuildOam, cellIndex: number): OamBlock {
  if (!Number.isInteger(oam.x) || oam.x < -0x100 || oam.x > 0xff) throw new Error(`Cell ${cellIndex} OAM x is outside signed 9-bit range`);
  if (!Number.isInteger(oam.y) || oam.y < -0x80 || oam.y > 0x7f) throw new Error(`Cell ${cellIndex} OAM y is outside signed 8-bit range`);
  if (!Number.isInteger(oam.characterName) || oam.characterName < 0 || oam.characterName > 0x3ff) throw new Error(`Cell ${cellIndex} OAM characterName is outside 10-bit range`);
  const size = OAM_SIZES.find((candidate) => candidate.width === oam.width && candidate.height === oam.height);
  if (!size) throw new Error(`Cell ${cellIndex} OAM has unsupported dimensions ${oam.width}x${oam.height}`);
  return {
    x: oam.x,
    y: oam.y,
    width: oam.width,
    height: oam.height,
    characterName: oam.characterName,
    shape: size.shape,
    size: size.size,
  };
}

function normalizeParsedOam(oam: PokemonCell["oams"][number], cellIndex: number): PokemonCell["oams"][number] {
  if (!Number.isInteger(oam.x) || oam.x < -0x100 || oam.x > 0xff) throw new Error(`Cell ${cellIndex} OAM x is outside signed 9-bit range`);
  if (!Number.isInteger(oam.y) || oam.y < -0x80 || oam.y > 0x7f) throw new Error(`Cell ${cellIndex} OAM y is outside signed 8-bit range`);
  if (!Number.isInteger(oam.characterName) || oam.characterName < 0 || oam.characterName > 0x3ff) throw new Error(`Cell ${cellIndex} OAM characterName is outside 10-bit range`);
  if (!OAM_SIZES.some((candidate) => candidate.width === oam.width && candidate.height === oam.height && candidate.shape === oam.shape && candidate.size === oam.size)) {
    throw new Error(`Cell ${cellIndex} OAM has unsupported dimensions ${oam.width}x${oam.height}`);
  }
  return {
    ...oam,
    palette: clampInt(oam.palette, 0, 0x0f),
    priority: clampInt(oam.priority, 0, 0x03),
    mode: clampInt(oam.mode, 0, 0x03),
    matrix: clampInt(oam.matrix, 0, 0x1f),
    characterBits: oam.characterBits === 8 ? 8 : 4,
  };
}

function isCovered(covered: Uint8Array, width: number, x: number, y: number): boolean {
  return covered[(y / 8) * (width / 8) + x / 8] === 1;
}

function canPlace(covered: Uint8Array, width: number, x: number, y: number, blockWidth: number, blockHeight: number): boolean {
  for (let yy = y; yy < y + blockHeight; yy += 8) {
    for (let xx = x; xx < x + blockWidth; xx += 8) {
      if (isCovered(covered, width, xx, yy)) return false;
    }
  }
  return true;
}

function markCovered(covered: Uint8Array, width: number, x: number, y: number, blockWidth: number, blockHeight: number): void {
  for (let yy = y; yy < y + blockHeight; yy += 8) {
    for (let xx = x; xx < x + blockWidth; xx += 8) {
      covered[(yy / 8) * (width / 8) + xx / 8] = 1;
    }
  }
}

function encodeOam(oam: OamBlock): Uint8Array {
  const out = new Uint8Array(6);
  writeU16(out, 0, (oam.y & 0xff) | (oam.shape << 14));
  writeU16(out, 2, (oam.x & 0x1ff) | (oam.size << 14));
  writeU16(out, 4, oam.characterName & 0x03ff);
  return out;
}

function encodeParsedOam(oam: PokemonCell["oams"][number]): Uint8Array {
  const out = new Uint8Array(6);
  const attr0 =
    (oam.y & 0xff) |
    (oam.rotateScale ? 1 << 8 : 0) |
    ((oam.rotateScale ? oam.doubleSize : oam.disable) ? 1 << 9 : 0) |
    ((oam.mode & 0x03) << 10) |
    (oam.mosaic ? 1 << 12 : 0) |
    (oam.characterBits === 8 ? 1 << 13 : 0) |
    ((oam.shape & 0x03) << 14);
  const attr1 =
    (oam.x & 0x1ff) |
    (oam.rotateScale ? ((oam.matrix & 0x1f) << 9) : 0) |
    (!oam.rotateScale && oam.flipX ? 1 << 12 : 0) |
    (!oam.rotateScale && oam.flipY ? 1 << 13 : 0) |
    ((oam.size & 0x03) << 14);
  const attr2 =
    (oam.characterName & 0x03ff) |
    ((oam.priority & 0x03) << 10) |
    ((oam.palette & 0x0f) << 12);
  writeU16(out, 0, attr0);
  writeU16(out, 2, attr1);
  writeU16(out, 4, attr2);
  return out;
}

function encodeAnimationFrame(frame: PokemonAnimationFrameEdit, motionType: 0 | 1 | 2): Uint8Array {
  if (motionType === 0) {
    const out = new Uint8Array(2);
    writeU16(out, 0, clampInt(frame.cellIndex, 0, 0xffff));
    return out;
  }
  if (motionType === 2) {
    const out = new Uint8Array(8);
    writeU16(out, 0, clampInt(frame.cellIndex, 0, 0xffff));
    writeU16(out, 2, 0);
    writeS16Local(out, 4, clampInt(frame.x, -0x8000, 0x7fff));
    writeS16Local(out, 6, clampInt(frame.y, -0x8000, 0x7fff));
    return out;
  }
  const out = new Uint8Array(0x10);
  writeU16(out, 0, clampInt(frame.cellIndex, 0, 0xffff));
  writeU16(out, 2, Math.round((((frame.rotation % 360) + 360) % 360) * 65536 / 360) & 0xffff);
  writeS32Local(out, 4, Math.round(clampFinite(frame.xScale, -128, 128, 1) * 0x1000));
  writeS32Local(out, 8, Math.round(clampFinite(frame.yScale, -128, 128, 1) * 0x1000));
  writeS16Local(out, 0x0c, clampInt(frame.x, -0x8000, 0x7fff));
  writeS16Local(out, 0x0e, clampInt(frame.y, -0x8000, 0x7fff));
  return out;
}

function writeG2dFile(signature: "RECN" | "RNAN" | "RCMN" | "RAMN", blocks: Array<{ signature: string; payload: Uint8Array }>): Uint8Array {
  const blockBytes = blocks.map((block) => {
    const payload = pad4(block.payload);
    const out = new Uint8Array(8 + payload.length);
    out.set(new TextEncoder().encode(block.signature.split("").reverse().join("")), 0);
    writeU32(out, 4, out.length);
    out.set(payload, 8);
    return out;
  });
  const body = concatBytes(blockBytes);
  const out = new Uint8Array(G2D_HEADER_SIZE + body.length);
  out.set(new TextEncoder().encode(signature), 0);
  out[4] = 0xff;
  out[5] = 0xfe;
  out[6] = 0;
  out[7] = 1;
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, G2D_HEADER_SIZE);
  writeU16(out, 0x0e, blocks.length);
  out.set(body, G2D_HEADER_SIZE);
  return out;
}

function alignValueParts(parts: Uint8Array[], offset: number, alignment: number): number {
  const padding = (alignment - (offset % alignment)) % alignment;
  if (padding > 0) {
    parts.push(new Uint8Array(padding));
    return offset + padding;
  }
  return offset;
}

function sectionBytes(name: string, data: Uint8Array): Uint8Array {
  return concatBytes([new TextEncoder().encode(`{${name}|`), u32Bytes(data.length), new TextEncoder().encode(":"), data, new TextEncoder().encode("}")]);
}

function parseSectionFile(bytes: Uint8Array): Map<string, Uint8Array> {
  const sections = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0x7b) throw new Error("Invalid animation bundle");
    const nameStart = offset;
    while (offset < bytes.length && bytes[offset] !== 0x7c) offset += 1;
    if (offset >= bytes.length) throw new Error("Invalid animation bundle header");
    const name = new TextDecoder("ascii").decode(bytes.subarray(nameStart, offset));
    offset += 1;
    const length = readU32Local(bytes, offset);
    offset += 4;
    if (bytes[offset++] !== 0x3a) throw new Error("Invalid animation bundle payload");
    const data = bytes.slice(offset, offset + length);
    offset += length;
    if (bytes[offset++] !== 0x7d) throw new Error("Invalid animation bundle terminator");
    sections.set(name, data);
  }
  return sections;
}

function decodeAsciiSection(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder("ascii").decode(bytes) : "";
}

function u32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32(out, 0, value);
  return out;
}

function writeRigCell(out: Uint8Array, offset: number, cell: RigCell, subCell: boolean): void {
  writeS32Local(out, offset, Math.round(cell.spriteX * 0x100));
  writeS32Local(out, offset + 4, Math.round(cell.spriteY * 0x100));
  writeS32Local(out, offset + 8, Math.round(cell.width * 0x1000));
  writeS32Local(out, offset + 12, Math.round(cell.height * 0x1000));
  writeS32Local(out, offset + 16, Math.round(cell.cellX * 0x1000));
  writeS32Local(out, offset + 20, Math.round(cell.cellY * 0x1000));
  if (!subCell) return;
}

function writeRigCellsHeader(out: Uint8Array, cells: RigCell[]): void {
  if (cells.length === 0) return;
  const bounds = rigCellsBounds(cells);
  writeU16(out, 4, clampInt(Math.ceil(bounds.maxX - bounds.minX), 0, 0xffff));
  writeU16(out, 6, clampInt(Math.ceil(bounds.maxY - bounds.minY), 0, 0xffff));
  writeS16Local(out, 8, Math.round((bounds.minX + bounds.maxX) / 2));
  writeS16Local(out, 10, Math.round((bounds.minY + bounds.maxY) / 2));
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

function readU32Local(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16) | ((data[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeS16Local(data: Uint8Array, offset: number, value: number): void {
  writeU16(data, offset, clampInt(value, -0x8000, 0x7fff) & 0xffff);
}

function writeS32Local(data: Uint8Array, offset: number, value: number): void {
  writeU32(data, offset, value >>> 0);
}

function roundUp8(value: number): number {
  return Math.ceil(value / 8) * 8;
}

function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
