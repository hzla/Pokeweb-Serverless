import { readAscii, readU16, readU32 } from "../nds/binary";

export type BtxTextureLayout = "auto" | "linear" | "tiled";
export type BtxParseMode = "hgss_overworld" | "generic";

export type BtxTextureEntry = {
  index: number;
  name: string;
  imageOffsetBytes: number;
  params: number;
  format: number;
  width: number;
  height: number;
  color0Transparent: boolean;
  widthHint?: number;
};

export type BtxPaletteEntry = {
  index: number;
  name: string;
  paletteOffsetBytes: number;
  unknown0?: number;
  unknown1?: number;
};

export type BtxFile = {
  mode: BtxParseMode;
  tex0Offset: number;
  textureDataOffset: number;
  paletteDataOffset: number;
  textureDataSizeBytes: number;
  paletteDataSizeBytes: number;
  textures: BtxTextureEntry[];
  palettes: BtxPaletteEntry[];
  warnings: string[];
  source: Uint8Array;
};

export type BtxImage = {
  name: string;
  textureIndex: number;
  paletteIndex: number;
  format: number;
  layout: Exclude<BtxTextureLayout, "auto">;
  width: number;
  height: number;
  rgba: Uint8Array;
};

type Tex0Header = {
  texInfoOffset: number;
  texDataOffset: number;
  texDataSizeBytes: number;
  palInfoOffset: number;
  palDataOffset: number;
  palDataSizeBytes: number;
};

type DecodedParams16 = {
  format: number;
  width: number;
  height: number;
  color0Transparent: boolean;
};

const BTX_MAGIC = "BTX0";
const TEX0_MAGIC = "TEX0";

export function parseBtx(bytes: Uint8Array): BtxFile {
  if (readAscii(bytes, 0, 4) !== BTX_MAGIC) throw new Error("Not a BTX0 file");
  const blockCount = readU16(bytes, 0x0e);
  const blockOffsets = Array.from({ length: blockCount }, (_value, index) => readU32(bytes, 0x10 + index * 4));
  const tex0Offset = blockOffsets.find((offset) => readAscii(bytes, offset, 4) === TEX0_MAGIC);
  if (tex0Offset === undefined) throw new Error("BTX0 file does not contain a TEX0 block");

  const tex0 = readTex0Header(bytes, tex0Offset);
  const parsed = tryParseHgssOverworld(bytes, tex0Offset, tex0) ?? parseGenericBtx(bytes, tex0Offset, tex0);
  return {
    ...parsed,
    tex0Offset,
    textureDataOffset: tex0Offset + tex0.texDataOffset,
    paletteDataOffset: tex0Offset + tex0.palDataOffset,
    textureDataSizeBytes: tex0.texDataSizeBytes,
    paletteDataSizeBytes: tex0.palDataSizeBytes,
    warnings: parsed.warnings,
    source: bytes,
  };
}

export function decodeBtxImage(
  fileOrBytes: BtxFile | Uint8Array,
  textureIndex = 0,
  paletteIndex = 0,
  layout: BtxTextureLayout = "auto",
): BtxImage {
  const file = fileOrBytes instanceof Uint8Array ? parseBtx(fileOrBytes) : fileOrBytes;
  const texture = file.textures[textureIndex];
  if (!texture) throw new Error(`BTX texture ${textureIndex} is missing`);
  const palette = file.palettes[paletteIndex] ?? file.palettes[0];
  if (!palette && textureRequiresPalette(texture.format)) throw new Error(`BTX palette ${paletteIndex} is missing`);

  const actualLayout = layout === "auto" ? (file.mode === "hgss_overworld" ? "linear" : "tiled") : layout;
  const paletteRgba = palette ? readPalette(file, palette, paletteEntryCount(texture.format)) : [];
  const rgba = decodeTexture(file, texture, paletteRgba, actualLayout);
  return {
    name: texture.name,
    textureIndex,
    paletteIndex: palette?.index ?? 0,
    format: texture.format,
    layout: actualLayout,
    width: texture.width,
    height: texture.height,
    rgba,
  };
}

export function decodeBtxImages(fileOrBytes: BtxFile | Uint8Array, paletteIndex = 0, layout: BtxTextureLayout = "auto"): BtxImage[] {
  const file = fileOrBytes instanceof Uint8Array ? parseBtx(fileOrBytes) : fileOrBytes;
  return file.textures.map((texture) => decodeBtxImage(file, texture.index, paletteIndex, layout));
}

export function decodeBtxParams16(params: number): DecodedParams16 {
  return {
    format: (params >>> 10) & 7,
    height: 8 << ((params >>> 7) & 7),
    width: 8 << ((params >>> 4) & 7),
    color0Transparent: ((params >>> 13) & 1) !== 0,
  };
}

function readTex0Header(bytes: Uint8Array, tex0Offset: number): Tex0Header {
  if (readAscii(bytes, tex0Offset, 4) !== TEX0_MAGIC) throw new Error(`Expected TEX0 block at 0x${tex0Offset.toString(16)}`);
  return {
    texDataSizeBytes: readU16(bytes, tex0Offset + 0x0c) * 8,
    texInfoOffset: readU16(bytes, tex0Offset + 0x0e),
    texDataOffset: readU32(bytes, tex0Offset + 0x14),
    palDataSizeBytes: readU32(bytes, tex0Offset + 0x30) * 8,
    palInfoOffset: readU32(bytes, tex0Offset + 0x34),
    palDataOffset: readU32(bytes, tex0Offset + 0x38),
  };
}

function tryParseHgssOverworld(
  bytes: Uint8Array,
  tex0Offset: number,
  tex0: Tex0Header,
): Pick<BtxFile, "mode" | "textures" | "palettes" | "warnings"> | undefined {
  const textureInfoOffset = tex0Offset + tex0.texInfoOffset;
  const paletteInfoOffset = tex0Offset + tex0.palInfoOffset;
  if (!isRange(bytes, textureInfoOffset, 8) || !isRange(bytes, paletteInfoOffset, 0x10)) return undefined;

  const textureCount = bytes[textureInfoOffset + 1] ?? 0;
  const textureUnknownSectionSize = readU16(bytes, textureInfoOffset + 6);
  const texturePropertiesOffset = textureInfoOffset + 4 + textureUnknownSectionSize;
  const textureNamesOffset = texturePropertiesOffset + textureCount * 8;
  if (!isRange(bytes, texturePropertiesOffset, textureCount * 8) || !isRange(bytes, textureNamesOffset, textureCount * 16)) return undefined;

  const paletteCount = bytes[paletteInfoOffset + 1] ?? 0;
  const palettePropertiesOffset = paletteInfoOffset + 0x0c;
  const paletteNamesOffset = palettePropertiesOffset + 4 + paletteCount * 8;
  const paletteOffsetsOffset = paletteNamesOffset - paletteCount * 4;
  if (!isRange(bytes, palettePropertiesOffset, paletteCount * 4) || !isRange(bytes, paletteOffsetsOffset, paletteCount * 4)) return undefined;
  if (!isRange(bytes, paletteNamesOffset, paletteCount * 16)) return undefined;

  const textures = Array.from({ length: textureCount }, (_value, index) => {
    const offset = texturePropertiesOffset + index * 8;
    const params = readU16(bytes, offset + 2);
    const decoded = decodeBtxParams16(params);
    return {
      index,
      name: readName(bytes, textureNamesOffset + index * 16) || `texture_${index}`,
      imageOffsetBytes: readU16(bytes, offset) * 8,
      params,
      format: decoded.format,
      width: decoded.width,
      height: decoded.height,
      color0Transparent: decoded.color0Transparent,
      widthHint: bytes[offset + 4] ?? 0,
    };
  });

  if (textures.some((texture) => !isSaneTexture(texture))) return undefined;

  const palettes = Array.from({ length: paletteCount }, (_value, index) => ({
    index,
    name: readName(bytes, paletteNamesOffset + index * 16) || `palette_${index}`,
    paletteOffsetBytes: readU32(bytes, paletteOffsetsOffset + index * 4),
    unknown0: readU16(bytes, palettePropertiesOffset + index * 4),
    unknown1: readU16(bytes, palettePropertiesOffset + index * 4 + 2),
  }));

  return {
    mode: "hgss_overworld",
    textures,
    palettes,
    warnings: [],
  };
}

function parseGenericBtx(
  bytes: Uint8Array,
  tex0Offset: number,
  tex0: Tex0Header,
): Pick<BtxFile, "mode" | "textures" | "palettes" | "warnings"> {
  const textureInfoOffset = tex0Offset + tex0.texInfoOffset;
  const paletteInfoOffset = tex0Offset + tex0.palInfoOffset;
  const textureEntries = parseDictionary(bytes, textureInfoOffset);
  const paletteEntries = parseDictionary(bytes, paletteInfoOffset);
  const textures = textureEntries.map((entry) => {
    const params = readU16(bytes, entry.offset + 2);
    const decoded = decodeBtxParams16(params);
    return {
      index: entry.index,
      name: entry.name || `texture_${entry.index}`,
      imageOffsetBytes: readU16(bytes, entry.offset) * 8,
      params,
      format: decoded.format,
      width: decoded.width,
      height: decoded.height,
      color0Transparent: decoded.color0Transparent,
    };
  });
  const palettes = paletteEntries.map((entry) => ({
    index: entry.index,
    name: entry.name || `palette_${entry.index}`,
    paletteOffsetBytes: entry.offset >= 0 ? 0 : 0,
  }));
  return {
    mode: "generic",
    textures,
    palettes,
    warnings: ["Generic BTX dictionary fallback does not expose per-palette offsets yet."],
  };
}

function parseDictionary(bytes: Uint8Array, offset: number): Array<{ index: number; offset: number; name: string }> {
  const count = bytes[offset + 1] ?? 0;
  const dictionarySize = readU16(bytes, offset + 2);
  const unknownSectionSize = readU16(bytes, offset + 6);
  const dataOffset = offset + 4 + unknownSectionSize;
  const namesOffset = offset + dictionarySize - count * 16;
  const dataBytes = dictionarySize - (4 + unknownSectionSize) - count * 16;
  const entrySize = count === 0 ? 0 : Math.floor(dataBytes / count);
  if (count > 0 && (!isRange(bytes, dataOffset, count * entrySize) || !isRange(bytes, namesOffset, count * 16))) {
    throw new Error("BTX dictionary is truncated");
  }
  return Array.from({ length: count }, (_value, index) => ({
    index,
    offset: dataOffset + index * entrySize,
    name: readName(bytes, namesOffset + index * 16),
  }));
}

function decodeTexture(
  file: BtxFile,
  texture: BtxTextureEntry,
  palette: Array<[number, number, number, number]>,
  layout: Exclude<BtxTextureLayout, "auto">,
): Uint8Array {
  if (texture.format === 2) return decodeIndexed2Bpp(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height, palette, texture.color0Transparent, layout);
  if (texture.format === 3) return decodeIndexed4Bpp(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height, palette, texture.color0Transparent, layout);
  if (texture.format === 4) return decodeIndexed8Bpp(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height, palette, texture.color0Transparent, layout);
  if (texture.format === 1) return decodeAlphaIndexed(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height, palette, (value) => value & 0x1f, (value) => a3ToA8(value >>> 5));
  if (texture.format === 6) return decodeAlphaIndexed(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height, palette, (value) => value & 0x07, (value) => extend5To8(value >>> 3));
  if (texture.format === 7) return decodeDirectColor(file.source, file.textureDataOffset + texture.imageOffsetBytes, texture.width, texture.height);
  throw new Error(`BTX texture format ${texture.format} is not supported yet`);
}

function decodeIndexed2Bpp(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  palette: Array<[number, number, number, number]>,
  color0Transparent: boolean,
  layout: Exclude<BtxTextureLayout, "auto">,
): Uint8Array {
  return decodePackedIndexed(bytes, offset, width, height, palette, 2, color0Transparent, layout);
}

function decodeIndexed4Bpp(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  palette: Array<[number, number, number, number]>,
  color0Transparent: boolean,
  layout: Exclude<BtxTextureLayout, "auto">,
): Uint8Array {
  return decodePackedIndexed(bytes, offset, width, height, palette, 4, color0Transparent, layout);
}

function decodeIndexed8Bpp(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  palette: Array<[number, number, number, number]>,
  color0Transparent: boolean,
  layout: Exclude<BtxTextureLayout, "auto">,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const write = (x: number, y: number, value: number) => writePalettePixel(rgba, y * width + x, palette, value, color0Transparent);
  if (layout === "linear") {
    for (let index = 0; index < width * height; index += 1) write(index % width, Math.floor(index / width), bytes[offset + index] ?? 0);
    return rgba;
  }
  let cursor = offset;
  forEachTilePixel(width, height, (x, y) => write(x, y, bytes[cursor++] ?? 0));
  return rgba;
}

function decodePackedIndexed(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  palette: Array<[number, number, number, number]>,
  bitsPerPixel: 2 | 4,
  color0Transparent: boolean,
  layout: Exclude<BtxTextureLayout, "auto">,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const perByte = 8 / bitsPerPixel;
  const mask = (1 << bitsPerPixel) - 1;
  const write = (x: number, y: number, value: number) => writePalettePixel(rgba, y * width + x, palette, value, color0Transparent);

  if (layout === "linear") {
    let cursor = offset;
    for (let index = 0; index < width * height; index += perByte) {
      const value = bytes[cursor++] ?? 0;
      for (let sub = 0; sub < perByte && index + sub < width * height; sub += 1) {
        write((index + sub) % width, Math.floor((index + sub) / width), (value >>> (sub * bitsPerPixel)) & mask);
      }
    }
    return rgba;
  }

  let cursor = offset;
  let packed = 0;
  let remaining = 0;
  forEachTilePixel(width, height, (x, y) => {
    if (remaining === 0) {
      packed = bytes[cursor++] ?? 0;
      remaining = perByte;
    }
    const shift = (perByte - remaining) * bitsPerPixel;
    write(x, y, (packed >>> shift) & mask);
    remaining -= 1;
  });
  return rgba;
}

function decodeAlphaIndexed(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  palette: Array<[number, number, number, number]>,
  colorIndex: (value: number) => number,
  alpha: (value: number) => number,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = bytes[offset + index] ?? 0;
    const color = palette[colorIndex(value)] ?? [0, 0, 0, 0];
    rgba.set([color[0], color[1], color[2], alpha(value)], index * 4);
  }
  return rgba;
}

function decodeDirectColor(bytes: Uint8Array, offset: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = readU16(bytes, offset + index * 2);
    rgba.set(rgb555ToRgba(value, value & 0x8000 ? 255 : 0), index * 4);
  }
  return rgba;
}

function forEachTilePixel(width: number, height: number, callback: (x: number, y: number) => void): void {
  const tilesX = Math.ceil(width / 8);
  const tilesY = Math.ceil(height / 8);
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      for (let pixelY = 0; pixelY < 8; pixelY += 1) {
        for (let pixelX = 0; pixelX < 8; pixelX += 1) {
          const x = tileX * 8 + pixelX;
          const y = tileY * 8 + pixelY;
          if (x < width && y < height) callback(x, y);
        }
      }
    }
  }
}

function readPalette(file: BtxFile, palette: BtxPaletteEntry, count: number): Array<[number, number, number, number]> {
  return Array.from({ length: count }, (_value, index) => {
    const value = readU16(file.source, file.paletteDataOffset + palette.paletteOffsetBytes + index * 2);
    return rgb555ToRgba(value, 255);
  });
}

function writePalettePixel(
  rgba: Uint8Array,
  index: number,
  palette: Array<[number, number, number, number]>,
  colorIndex: number,
  color0Transparent: boolean,
): void {
  const color = palette[colorIndex] ?? [0, 0, 0, 0];
  rgba.set([color[0], color[1], color[2], color0Transparent && colorIndex === 0 ? 0 : color[3]], index * 4);
}

function paletteEntryCount(format: number): number {
  if (format === 2) return 4;
  if (format === 3) return 16;
  if (format === 1) return 32;
  if (format === 6) return 8;
  return 256;
}

function textureRequiresPalette(format: number): boolean {
  return [1, 2, 3, 4, 5, 6].includes(format);
}

function isSaneTexture(texture: BtxTextureEntry): boolean {
  return texture.width >= 8 && texture.height >= 8 && texture.width <= 1024 && texture.height <= 1024 && texture.format >= 0 && texture.format <= 7;
}

function rgb555ToRgba(value: number, alpha: number): [number, number, number, number] {
  return [extend5To8(value & 31), extend5To8((value >>> 5) & 31), extend5To8((value >>> 10) & 31), alpha];
}

function extend5To8(value: number): number {
  return (value << 3) | (value >>> 2);
}

function a3ToA8(value: number): number {
  return extend5To8((value << 2) | (value >>> 1));
}

function readName(bytes: Uint8Array, offset: number): string {
  return readAscii(bytes, offset, 16).replace(/\0.*$/u, "");
}

function isRange(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}
