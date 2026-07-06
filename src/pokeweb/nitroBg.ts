import { readAscii, readU16, readU32 } from "../nds/binary";

export type NitroBackgroundImage = {
  datId: number;
  hasTransparency: boolean;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  indexed: NitroBackgroundIndexedData;
  frameImages?: NitroBackgroundImage[];
  warnings: string[];
};

export type NitroBackgroundIndexedData = {
  entries: Uint16Array;
  tilePixels: Uint8Array[];
  bitsPerPixel: 4 | 8;
  palette: NitroPaletteData;
  transparentIndexZero: boolean;
};

export type NitroPaletteData = Array<[number, number, number, number]>;

export type NitroBackgroundPaletteAnimation = {
  datId: number;
  paletteArcId: number;
  frames: Array<{ paletteIndex: number; wait: number }>;
  palettes: NitroPaletteData;
  warnings: string[];
};

export type NitroBackgroundOptions = {
  transparentIndexZero?: boolean;
};

type ScreenData = {
  width: number;
  height: number;
  entries: Uint16Array;
};

type CharacterData = {
  tileCount: number;
  bitsPerPixel: 4 | 8;
  pixels: Uint8Array[];
};

export function parseNitroBackground(
  datId: number,
  screenBytes: Uint8Array,
  characterBytes: Uint8Array,
  paletteBytes: Uint8Array,
  options: NitroBackgroundOptions = {},
): NitroBackgroundImage {
  const warnings: string[] = [];
  const screen = parseScreen(screenBytes, warnings);
  const characters = parseCharacters(characterBytes, warnings);
  const palette = parseNitroPalette(paletteBytes, warnings);
  const indexed = {
    entries: screen.entries,
    tilePixels: characters.pixels,
    bitsPerPixel: characters.bitsPerPixel,
    palette,
    transparentIndexZero: Boolean(options.transparentIndexZero),
  };
  const { rgba, hasTransparency } = renderNitroBackgroundRgba(screen.width, screen.height, indexed);

  if (characters.tileCount < Math.max(...screen.entries.map((entry) => entry & 0x03ff), 0) + 1) {
    warnings.push(`Background ${datId} references tiles beyond the character data`);
  }

  return { datId, hasTransparency, width: screen.width, height: screen.height, rgba, indexed, warnings };
}

export function parseNitroPalette(bytes: Uint8Array, warnings: string[] = []): NitroPaletteData {
  if (readAscii(bytes, 0, 4) !== "RLCN") throw new Error("NCLR palette file has an unsupported stamp");
  const blockOffset = findBlock(bytes, "TTLP");
  if (blockOffset < 0) throw new Error("NCLR palette file is missing the TTLP block");
  const dataSize = readU32(bytes, blockOffset + 16);
  const dataOffset = blockOffset + 24;
  const colorCount = Math.floor(Math.min(dataSize, Math.max(0, bytes.length - dataOffset)) / 2);
  const palette: NitroPaletteData = [];
  for (let index = 0; index < colorCount; index += 1) palette.push(rgb555(readU16(bytes, dataOffset + index * 2)));
  if (palette.length === 0) palette.push([0, 0, 0, 255]);
  if (colorCount < dataSize / 2) warnings.push(`NCLR palette data is truncated: ${colorCount * 2}/${dataSize} bytes`);
  return palette;
}

export function renderNitroBackgroundImage(background: NitroBackgroundImage, paletteOverride?: NitroPaletteData): Uint8ClampedArray {
  return renderNitroBackgroundRgba(background.width, background.height, {
    ...background.indexed,
    palette: paletteOverride ?? background.indexed.palette,
  }).rgba;
}

function parseScreen(bytes: Uint8Array, warnings: string[]): ScreenData {
  if (readAscii(bytes, 0, 4) !== "RCSN") throw new Error("NSCR screen file has an unsupported stamp");
  const blockOffset = findBlock(bytes, "NRCS");
  if (blockOffset < 0) throw new Error("NSCR screen file is missing the NRCS block");
  const width = readU16(bytes, blockOffset + 8);
  const height = readU16(bytes, blockOffset + 10);
  const dataSize = readU32(bytes, blockOffset + 16);
  const dataOffset = blockOffset + 20;
  const entryCount = Math.min(dataSize >> 1, Math.floor((bytes.length - dataOffset) / 2));
  const rawEntries = new Uint16Array(entryCount);
  for (let index = 0; index < entryCount; index += 1) rawEntries[index] = readU16(bytes, dataOffset + index * 2);
  if (width <= 0 || height <= 0) throw new Error("NSCR screen file has invalid dimensions");
  const expectedEntries = (width / 8) * (height / 8);
  if (entryCount < expectedEntries) warnings.push(`NSCR tile map is truncated: ${entryCount} entries for ${width}x${height}`);
  return { width, height, entries: arrangeScreenEntries(rawEntries, width, height) };
}

function arrangeScreenEntries(rawEntries: Uint16Array, width: number, height: number): Uint16Array {
  const tilesWide = width / 8;
  const tilesHigh = height / 8;
  const entries = new Uint16Array(tilesWide * tilesHigh);
  const blockTiles = 32;
  const blockCols = Math.max(1, Math.ceil(tilesWide / blockTiles));
  const blockRows = Math.max(1, Math.ceil(tilesHigh / blockTiles));
  if (blockCols === 1 && blockRows === 1) {
    entries.set(rawEntries.subarray(0, entries.length));
    return entries;
  }
  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockCols; blockX += 1) {
      const blockBase = (blockY * blockCols + blockX) * blockTiles * blockTiles;
      for (let localY = 0; localY < blockTiles; localY += 1) {
        const tileY = blockY * blockTiles + localY;
        if (tileY >= tilesHigh) continue;
        for (let localX = 0; localX < blockTiles; localX += 1) {
          const tileX = blockX * blockTiles + localX;
          if (tileX >= tilesWide) continue;
          entries[tileY * tilesWide + tileX] = rawEntries[blockBase + localY * blockTiles + localX] ?? 0;
        }
      }
    }
  }
  return entries;
}

function parseCharacters(bytes: Uint8Array, warnings: string[]): CharacterData {
  if (readAscii(bytes, 0, 4) !== "RGCN") throw new Error("NCGR character file has an unsupported stamp");
  const blockOffset = findBlock(bytes, "RAHC");
  if (blockOffset < 0) throw new Error("NCGR character file is missing the RAHC block");
  const bitDepth = readU32(bytes, blockOffset + 12);
  const dataSize = readU32(bytes, blockOffset + 24);
  const dataOffset = blockOffset + 32;
  if (bitDepth !== 3 && bitDepth !== 4) warnings.push(`NCGR bit depth ${bitDepth} is approximated as 4bpp indexed tiles`);
  const bitsPerPixel = bitDepth === 4 ? 8 : 4;
  const bytesPerTile = bitsPerPixel === 8 ? 64 : 32;
  const available = Math.min(dataSize, Math.max(0, bytes.length - dataOffset));
  const tileCount = Math.floor(available / bytesPerTile);
  const pixels: Uint8Array[] = [];
  for (let tile = 0; tile < tileCount; tile += 1) {
    const out = new Uint8Array(64);
    const base = dataOffset + tile * bytesPerTile;
    if (bitsPerPixel === 8) {
      out.set(bytes.subarray(base, base + 64));
    } else {
      for (let i = 0; i < 32; i += 1) {
        const value = bytes[base + i] ?? 0;
        out[i * 2] = value & 0x0f;
        out[i * 2 + 1] = value >>> 4;
      }
    }
    pixels.push(out);
  }
  if (available < dataSize) warnings.push(`NCGR character data is truncated: ${available}/${dataSize} bytes`);
  return { tileCount, bitsPerPixel, pixels };
}

function renderNitroBackgroundRgba(
  width: number,
  height: number,
  indexed: NitroBackgroundIndexedData,
): { rgba: Uint8ClampedArray; hasTransparency: boolean } {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let hasTransparency = false;

  for (let tileY = 0; tileY < height / 8; tileY += 1) {
    for (let tileX = 0; tileX < width / 8; tileX += 1) {
      const entry = indexed.entries[tileY * (width / 8) + tileX] ?? 0;
      const tileIndex = entry & 0x03ff;
      const flipX = (entry & 0x0400) !== 0;
      const flipY = (entry & 0x0800) !== 0;
      const paletteBank = (entry >>> 12) & 0x0f;
      const tile = indexed.tilePixels[tileIndex];
      if (!tile) continue;
      if (drawTile(rgba, width, tileX * 8, tileY * 8, tile, indexed.bitsPerPixel, indexed.palette, paletteBank, flipX, flipY, indexed.transparentIndexZero)) {
        hasTransparency = true;
      }
    }
  }

  return { rgba, hasTransparency };
}

function drawTile(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  tile: Uint8Array,
  bitsPerPixel: 4 | 8,
  palette: NitroPaletteData,
  paletteBank: number,
  flipX: boolean,
  flipY: boolean,
  transparentIndexZero: boolean,
): boolean {
  let transparent = false;
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      const sx = flipX ? 7 - px : px;
      const sy = flipY ? 7 - py : py;
      const colorIndex = tile[sy * 8 + sx] ?? 0;
      const offset = ((y + py) * width + x + px) * 4;
      if (transparentIndexZero && colorIndex === 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
        transparent = true;
        continue;
      }
      const paletteIndex = bitsPerPixel === 8 ? colorIndex : paletteBank * 16 + colorIndex;
      const color = palette[paletteIndex] ?? palette[colorIndex] ?? [0, 0, 0, 0];
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
  return transparent;
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

function rgb555(value: number): [number, number, number, number] {
  const r = value & 0x1f;
  const g = (value >>> 5) & 0x1f;
  const b = (value >>> 10) & 0x1f;
  return [(r << 3) | (r >>> 2), (g << 3) | (g >>> 2), (b << 3) | (b >>> 2), 255];
}
