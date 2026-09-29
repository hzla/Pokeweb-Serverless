import { unzlibSync, zlibSync } from "fflate";
import { readU16, readU32 } from "../nds/binary";
import type { SummaryArt } from "./summaryAssets";
import type { Pokemon } from "./document";
import type { Document } from "./document";
export type Image = { width: number; height: number; pixels: Uint8ClampedArray };
export type Glyph = { width: number; height: number; advance: number; pixels: Uint8Array };
export type NativeLearnsetArt = {
  palette: string[];
  typeNames: string[];
  sprites: Record<string, Image & { x: number; y: number }>;
  cursor: { sprite: string; duration: number }[];
};
export interface Assets {
  nativeLearnset?: NativeLearnsetArt;
  nativeSummary?: SummaryArt;
  summaryPokemon?(pokemon: Pokemon): Pokemon;
  pokemonSprite?(pokemon: Pokemon): Image | undefined;
  resolveNative?(document: Document): Document;
  glyph(font: number, character: string): Glyph | undefined;
  image(key: string): Image | undefined;
  icon(species: number, form: number, pose: number, egg?: boolean): Image | undefined;
}
export function rgb555(color: string): number { const n = parseInt(color.slice(1), 16); return (n >> 19 & 31) | (n >> 6 & 992) | (n << 7 & 31744); }
export function expand555(n: number): number[] { return [(n & 31) * 255 / 31, (n >> 5 & 31) * 255 / 31, (n >> 10 & 31) * 255 / 31]; }

/** Decode the ROM's native 2-bit glyphs, including its authored shadow pixels. */
export class NativeFont {
  private readonly cache = new Map<string, Glyph | undefined>();
  constructor(private readonly bytes: Uint8Array) {}
  glyph(character: string): Glyph | undefined {
    if (this.cache.has(character)) return this.cache.get(character);
    const b = this.bytes, code = character.codePointAt(0)!;
    if (b.length < 44) return;
    const glyphs = readU32(b, 32); let mapping = readU32(b, 40), cell: number | undefined;
    const seen = new Set<number>();
    while (mapping && mapping + 12 <= b.length && !seen.has(mapping)) {
      seen.add(mapping); const first = readU16(b, mapping), last = readU16(b, mapping + 2), method = readU16(b, mapping + 4);
      if (code >= first && code <= last) {
        if (method === 0) cell = readU16(b, mapping + 12) + code - first;
        else if (method === 1 && mapping + 14 + 2 * (code - first) <= b.length) cell = readU16(b, mapping + 12 + 2 * (code - first));
        else if (method === 2) { const count = readU16(b, mapping + 12); for (let i = 0; i < count && mapping + 18 + i * 4 <= b.length; i++) if (readU16(b, mapping + 14 + i * 4) === code) { cell = readU16(b, mapping + 16 + i * 4); break; } }
        break;
      }
      mapping = readU32(b, mapping + 8);
    }
    if (cell === undefined || cell === 0xffff || glyphs + 8 > b.length) return;
    const width = b[glyphs], height = b[glyphs + 1], size = readU16(b, glyphs + 2), start = glyphs + 8 + size * cell;
    if (!width || width > 32 || !height || height > 32 || size < 3 + Math.ceil(width * height / 4) || start + size > b.length) return;
    const left = b[start], advance = b[start + 2]; if (left > 32 || advance > 64) return;
    const pixels = new Uint8Array((width + left) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pos = y * width + x, level = b[start + 3 + (pos >> 2)] >> (6 - (pos & 3) * 2) & 3;
      pixels[y * (width + left) + x + left] = level === 1 || level === 2 ? level : 0;
    }
    const result = { width: width + left, height, advance, pixels }; this.cache.set(character, result); return result;
  }
}

/** Portable PNG decoder shared by the browser and CLI. No browser font/image substitution. */
export function decodePng(bytes: Uint8Array): Image {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || bytes.slice(0, 8).join() !== "137,80,78,71,13,10,26,10") throw new Error("Not a PNG file.");
  const width = view.getUint32(16), height = view.getUint32(20), depth = bytes[24], type = bytes[25];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (width < 1 || height < 1 || width > 1024 || height > 1024 || !channels || bytes[26] || bytes[27] || bytes[28] || ![1, 2, 4, 8, 16].includes(depth) || (type !== 0 && type !== 3 && depth < 8) || (type === 3 && depth === 16)) throw new Error("Use a non-interlaced PNG up to 1024×1024 pixels.");
  let palette: Uint8Array = new Uint8Array(), alpha: Uint8Array = new Uint8Array(), length = 0, ended = false; const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = view.getUint32(at); if (size > bytes.length - at - 12) throw new Error("Truncated PNG chunk.");
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), data = bytes.subarray(at + 8, at + 8 + size);
    if (name === "IDAT") { parts.push(data); length += size; }
    else if (name === "PLTE") palette = data;
    else if (name === "tRNS") alpha = data;
    else if (name === "IEND") { ended = true; break; }
    at += size + 12;
  }
  if (!ended || !length) throw new Error("Incomplete PNG.");
  const packed = new Uint8Array(length); let offset = 0; for (const p of parts) { packed.set(p, offset); offset += p.length; }
  const stride = Math.ceil(width * channels * depth / 8), step = Math.max(1, Math.ceil(channels * depth / 8));
  const raw = unzlibSync(packed, { out: new Uint8Array((stride + 1) * height) });
  if (raw.length !== (stride + 1) * height) throw new Error("Invalid PNG scanline length.");
  const scan = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; if (filter > 4) throw new Error("Invalid PNG filter.");
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? scan[y * stride + x - step] : 0, b = y ? scan[(y - 1) * stride + x] : 0, c = y && x >= step ? scan[(y - 1) * stride + x - step] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      scan[y * stride + x] = raw[y * (stride + 1) + 1 + x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0);
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4), max = (1 << depth) - 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const values = Array.from({ length: channels }, (_, c) => {
      const bit = (x * channels + c) * depth, pos = y * stride + (bit >> 3);
      return depth === 16 ? scan[pos] * 256 + scan[pos + 1] : depth === 8 ? scan[pos] : scan[pos] >> (8 - depth - (bit & 7)) & max;
    });
    const pos = (y * width + x) * 4, value = (i: number) => Math.round(values[i] * 255 / max);
    if (type === 3) {
      const index = values[0]; if (index * 3 + 2 >= palette.length) throw new Error("PNG palette index is out of range.");
      pixels.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], alpha[index] ?? 255], pos);
    } else if (type === 0 || type === 4) {
      const transparent = type === 0 && alpha.length === 2 && values[0] === (alpha[0] * 256 + alpha[1]);
      pixels.set([value(0), value(0), value(0), type === 4 ? value(1) : transparent ? 0 : 255], pos);
    } else {
      const transparent = type === 2 && alpha.length === 6 && values.every((v, i) => v === alpha[i * 2] * 256 + alpha[i * 2 + 1]);
      pixels.set([value(0), value(1), value(2), type === 6 ? value(3) : transparent ? 0 : 255], pos);
    }
  }
  return { width, height, pixels };
}

export function encodePng(image: Image): Uint8Array {
  function chunk(name: string, data: Uint8Array) {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer); view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(name), 4); out.set(data, 8); let crc = 0xffffffff;
    for (const byte of out.subarray(4, out.length - 4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, image.width); view.setUint32(4, image.height); header[8] = 8; header[9] = 6;
  const scan = new Uint8Array((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++) scan.set(image.pixels.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * (image.width * 4 + 1) + 1);
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk("IHDR", header), chunk("IDAT", zlibSync(scan)), chunk("IEND", new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length; } return bytes;
}
