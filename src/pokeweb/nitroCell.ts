import { readAscii, readU16, readU32 } from "../nds/binary";
import {
  decompressNitro,
  parsePokemonAnimation,
  parsePokemonCellBank,
  type PokemonAnimationFrame,
  type PokemonCell,
  type PokemonCellOam,
} from "./pokemonSpriteModel";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";

export type NitroCellEffectFrame = {
  index: number;
  duration: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type NitroCellEffect = {
  id: string;
  charId: number;
  paletteId: number;
  cellId: number;
  animationId: number;
  width: number;
  height: number;
  totalFrames: number;
  frames: NitroCellEffectFrame[];
  sequences: NitroCellEffectFrame[][];
  warnings: string[];
};

type NitroCharacterData = {
  tileCount: number;
  sourceTilesWide: number;
  tiles: Uint8Array[];
};

type CellRenderInput = {
  characters: NitroCharacterData;
  palette: NitroPaletteData;
  cells: PokemonCell[];
  animationFrames: PokemonAnimationFrame[];
  mappingMode: number;
};

export function parseNitroCellEffect(
  id: string,
  charId: number,
  paletteId: number,
  cellId: number,
  animationId: number,
  characterBytes: Uint8Array,
  paletteBytes: Uint8Array,
  cellBytes: Uint8Array,
  animationBytes: Uint8Array,
): NitroCellEffect {
  const warnings: string[] = [];
  const characters = parseNitroCharacters(decompressNitroIfNeeded(characterBytes), warnings);
  const palette = parseNitroPalette(decompressNitroIfNeeded(paletteBytes), warnings);
  const cellBank = parsePokemonCellBank(decompressNitroIfNeeded(cellBytes));
  const animation = parsePokemonAnimation(decompressNitroIfNeeded(animationBytes));
  const fallbackFrame = { duration: 1, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 } as PokemonAnimationFrame;
  const animationSequences = animation.sequences.length ? animation.sequences.map((sequence) => (sequence.frames.length ? sequence.frames : [fallbackFrame])) : [[fallbackFrame]];
  const bounds = renderBounds(cellBank.cells, animationSequences.flat());
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const renderInput: CellRenderInput = {
    characters,
    palette,
    cells: cellBank.cells,
    animationFrames: animationSequences[0] ?? [fallbackFrame],
    mappingMode: cellBank.mappingMode,
  };
  const sequences = animationSequences.map((animationFrames) =>
    animationFrames.map((frame, index) => ({
      index,
      duration: Math.max(1, frame.duration || 1),
      width,
      height,
      rgba: renderCellFrame(renderInput, frame, width, height, bounds.minX, bounds.minY, warnings),
    })),
  );
  const frames = sequences[0] ?? [];
  const totalFrames = frames.reduce((sum, frame) => sum + frame.duration, 0);
  return { id, charId, paletteId, cellId, animationId, width, height, totalFrames, frames, sequences, warnings };
}

export function nitroCellEffectFrameAt(effect: NitroCellEffect, localFrame: number, sequenceIndex = 0): NitroCellEffectFrame | undefined {
  const frames = effect.sequences[sequenceIndex]?.length ? effect.sequences[sequenceIndex] : effect.frames;
  if (frames.length === 0) return undefined;
  const total = Math.max(1, frames.reduce((sum, frame) => sum + frame.duration, 0));
  let cursor = positiveModulo(Math.floor(localFrame), total);
  for (const frame of frames) {
    if (cursor < frame.duration) return frame;
    cursor -= frame.duration;
  }
  return frames[frames.length - 1];
}

function parseNitroCharacters(bytes: Uint8Array, warnings: string[]): NitroCharacterData {
  if (readAscii(bytes, 0, 4) !== "RGCN") throw new Error("NCGR character file has an unsupported stamp");
  const blockOffset = findRawBlock(bytes, "RAHC");
  if (blockOffset < 0) throw new Error("NCGR character file is missing the RAHC block");
  const bitDepth = readU32(bytes, blockOffset + 12);
  if (bitDepth !== 3) warnings.push(`NCGR bit depth ${bitDepth} is approximated as 4bpp OBJ tiles`);
  const dataSize = readU32(bytes, blockOffset + 24);
  const dataOffset = blockOffset + 32;
  const available = Math.min(dataSize, Math.max(0, bytes.length - dataOffset));
  const declaredTilesWide = readU16(bytes, blockOffset + 16);
  const tileCount = Math.floor(available / 32);
  const tiles: Uint8Array[] = [];
  for (let tile = 0; tile < tileCount; tile += 1) {
    const out = new Uint8Array(64);
    const base = dataOffset + tile * 32;
    for (let index = 0; index < 32; index += 1) {
      const value = bytes[base + index] ?? 0;
      out[index * 2] = value & 0x0f;
      out[index * 2 + 1] = value >>> 4;
    }
    tiles.push(out);
  }
  if (available < dataSize) warnings.push(`NCGR character data is truncated: ${available}/${dataSize} bytes`);
  return { tileCount, sourceTilesWide: Math.max(1, declaredTilesWide || Math.ceil(Math.sqrt(Math.max(1, tileCount)))), tiles };
}

function renderBounds(cells: PokemonCell[], frames: PokemonAnimationFrame[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const frame of frames) {
    const cell = cells[frame.cellIndex] ?? cells[0];
    if (!cell) continue;
    minX = Math.min(minX, cell.minX + frame.x);
    minY = Math.min(minY, cell.minY + frame.y);
    maxX = Math.max(maxX, cell.maxX + frame.x);
    maxY = Math.max(maxY, cell.maxY + frame.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function renderCellFrame(
  input: CellRenderInput,
  frame: PokemonAnimationFrame,
  width: number,
  height: number,
  minX: number,
  minY: number,
  warnings: string[],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const cell = input.cells[frame.cellIndex] ?? input.cells[0];
  if (!cell) return rgba;
  for (const oam of cell.oams.filter((entry) => !entry.disable)) {
    if (oam.rotateScale) warnings.push(`NCER cell ${cell.index} uses affine OAM; preview renders it without affine matrix ${oam.matrix}`);
    drawOam(rgba, width, height, input, oam, oam.x + frame.x - minX, oam.y + frame.y - minY);
  }
  return rgba;
}

function drawOam(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  input: CellRenderInput,
  oam: PokemonCellOam,
  dx: number,
  dy: number,
): void {
  const tilesWide = Math.max(1, Math.ceil(oam.width / 8));
  const tilesHigh = Math.max(1, Math.ceil(oam.height / 8));
  const tileStart = ncerTileStart(oam.characterName, input.mappingMode, oam.characterBits);
  for (let tileY = 0; tileY < tilesHigh; tileY += 1) {
    for (let tileX = 0; tileX < tilesWide; tileX += 1) {
      const sourceTileX = oam.flipX ? tilesWide - 1 - tileX : tileX;
      const sourceTileY = oam.flipY ? tilesHigh - 1 - tileY : tileY;
      const tileIndex = ncerTileIndex(tileStart, sourceTileX, sourceTileY, tilesWide, input.characters.sourceTilesWide, input.mappingMode);
      const tile = input.characters.tiles[tileIndex];
      if (!tile) continue;
      drawTile(rgba, width, height, tile, input.palette, oam.palette, dx + tileX * 8, dy + tileY * 8, oam.flipX, oam.flipY);
    }
  }
}

function drawTile(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  tile: Uint8Array,
  palette: NitroPaletteData,
  paletteBank: number,
  dx: number,
  dy: number,
  flipX: boolean,
  flipY: boolean,
): void {
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      const sx = flipX ? 7 - px : px;
      const sy = flipY ? 7 - py : py;
      const colorIndex = tile[sy * 8 + sx] ?? 0;
      if (colorIndex === 0) continue;
      const x = dx + px;
      const y = dy + py;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const color = palette[paletteBank * 16 + colorIndex] ?? palette[colorIndex] ?? [0, 0, 0, 0];
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
}

function ncerTileStart(characterName: number, mappingMode: number, characterBits: 4 | 8): number {
  const boundaryBytes = ncerMappingBoundaryBytes(mappingMode);
  return Math.floor((boundaryBytes * characterName) / (characterBits * 8));
}

function ncerTileIndex(tileStart: number, tileX: number, tileY: number, objectTilesWide: number, sourceTilesWide: number, mappingMode: number): number {
  if (ncerIs2dMappingMode(mappingMode)) return tileStart + tileX + tileY * sourceTilesWide;
  return tileStart + tileX + tileY * objectTilesWide;
}

function ncerIs2dMappingMode(mappingMode: number): boolean {
  return mappingMode === 0 || mappingMode === 4;
}

function ncerMappingBoundaryBytes(mappingMode: number): number {
  if (mappingMode === 1 || mappingMode === 0x100010) return 64;
  if (mappingMode === 2 || mappingMode === 0x200010) return 128;
  if (mappingMode === 3 || mappingMode === 0x300010) return 256;
  return 32;
}

function findRawBlock(bytes: Uint8Array, signature: string): number {
  const headerSize = readU16(bytes, 0x0c);
  const sectionCount = readU16(bytes, 0x0e);
  let offset = headerSize;
  for (let index = 0; index < sectionCount && offset + 8 <= bytes.length; index += 1) {
    const blockSize = readU32(bytes, offset + 4);
    if (readAscii(bytes, offset, 4) === signature) return offset;
    if (blockSize < 8) break;
    offset += blockSize;
  }
  return -1;
}

function decompressNitroIfNeeded(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
