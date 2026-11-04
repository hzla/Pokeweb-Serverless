import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { RgbColor } from "./pokemonSpriteModel";

export type NaturePaletteSource = "native" | "pwan-front" | "pwan-back";
export type NaturePaletteTarget = { spriteId: number; source: NaturePaletteSource; nature: number; shiny: boolean };
export type NaturePaletteRecord = { key: number; mask: number; colors: number[] };
export const NATURE_PALETTE_PATH = "pokemon/nature-palettes.bin";
export const NATURE_NAMES = ["Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax", "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky"] as const;
const SOURCES: NaturePaletteSource[] = ["native", "pwan-front", "pwan-back"];
const MAGIC = 0x504e5750; // PWNP, little endian
const HEADER = 16;
const MAX_KEY = 65536 * 150 - 1;

export function rgb555(color: RgbColor): number {
  for (const n of [color.r, color.g, color.b]) if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error("Invalid palette color.");
  return Math.round(color.r * 31 / 255) | (Math.round(color.g * 31 / 255) << 5) | (Math.round(color.b * 31 / 255) << 10);
}
export function rgbFrom555(value: number): RgbColor {
  return { r: Math.floor((value & 31) * 8.25), g: Math.floor(((value >>> 5) & 31) * 8.25), b: Math.floor(((value >>> 10) & 31) * 8.25) };
}
export function naturePaletteKey(t: NaturePaletteTarget): number {
  const source = SOURCES.indexOf(t.source);
  if (!Number.isInteger(t.spriteId) || t.spriteId < 0 || t.spriteId > 65535 || source < 0 || !Number.isInteger(t.nature) || t.nature < 0 || t.nature > 24 || typeof t.shiny !== "boolean") throw new Error("Invalid nature palette target.");
  return ((t.spriteId * 3 + source) * 25 + t.nature) * 2 + Number(t.shiny);
}
export function naturePaletteTarget(key: number): NaturePaletteTarget {
  if (!Number.isInteger(key) || key < 0 || key > MAX_KEY) throw new Error("Invalid nature palette key.");
  return { spriteId: Math.floor(key / 150), source: SOURCES[Math.floor(key / 50) % 3], nature: Math.floor(key / 2) % 25, shiny: Boolean(key & 1) };
}
export function maskCount(mask: number): number {
  let n = 0;
  for (; mask; mask &= mask - 1) ++n;
  return n;
}
function validateRecord(r: NaturePaletteRecord): void {
  naturePaletteTarget(r.key);
  if (!Number.isInteger(r.mask) || r.mask < 2 || r.mask > 0xfffe || (r.mask & 1) || maskCount(r.mask) !== r.colors.length || r.colors.some(c => !Number.isInteger(c) || c < 0 || c > 0x7fff)) throw new Error("Invalid nature palette record.");
}
export function encodeNaturePalettes(records: readonly NaturePaletteRecord[]): Uint8Array {
  const sorted = [...records].sort((a, b) => a.key - b.key);
  sorted.forEach((r, i) => { validateRecord(r); if (i && sorted[i - 1].key === r.key) throw new Error("Duplicate nature palette."); });
  const dataStart = HEADER + sorted.length * 8;
  const out = new Uint8Array(dataStart + sorted.reduce((n, r) => n + 2 + r.colors.length * 2, 0));
  writeU32(out, 0, MAGIC); writeU16(out, 4, 1); writeU16(out, 6, HEADER); writeU32(out, 8, sorted.length); writeU32(out, 12, out.length);
  let at = dataStart;
  sorted.forEach((r, i) => {
    writeU32(out, HEADER + i * 8, r.key); writeU32(out, HEADER + i * 8 + 4, at);
    writeU16(out, at, r.mask); at += 2;
    for (const color of r.colors) { writeU16(out, at, color); at += 2; }
  });
  return out;
}
export function decodeNaturePalettes(bytes: Uint8Array): NaturePaletteRecord[] {
  if (bytes.length < HEADER || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== HEADER || readU32(bytes, 12) !== bytes.length) throw new Error("Unrecognized nature palette table.");
  const count = readU32(bytes, 8);
  if (count > Math.floor((bytes.length - HEADER) / 12)) throw new Error("Invalid nature palette directory.");
  const records: NaturePaletteRecord[] = [];
  let at = HEADER + count * 8;
  for (let i = 0; i < count; ++i) {
    const key = readU32(bytes, HEADER + i * 8), offset = readU32(bytes, HEADER + i * 8 + 4);
    if (offset !== at || at + 2 > bytes.length || (i > 0 && key <= records[i - 1].key)) throw new Error("Invalid nature palette directory.");
    const mask = readU16(bytes, at), size = 2 + maskCount(mask) * 2;
    if (at + size > bytes.length) throw new Error("Truncated nature palette.");
    const r = { key, mask, colors: Array.from({ length: maskCount(mask) }, (_, j) => readU16(bytes, at + 2 + j * 2)) };
    validateRecord(r); records.push(r); at += size;
  }
  if (at !== bytes.length) throw new Error("Invalid nature palette table length.");
  return records;
}
export function paletteDelta(target: NaturePaletteTarget, base: readonly RgbColor[], palette: readonly RgbColor[]): NaturePaletteRecord | undefined {
  if (base.length !== 16 || palette.length !== 16) throw new Error("Pokemon palettes must contain exactly 16 colors.");
  const key = naturePaletteKey(target), colors: number[] = [];
  let mask = 0;
  for (let i = 1; i < 16; ++i) {
    const value = rgb555(palette[i]);
    if (value !== rgb555(base[i])) { mask |= 1 << i; colors.push(value); }
  }
  return mask ? { key, mask, colors } : undefined;
}
export function applyPaletteDelta(base: readonly RgbColor[], record?: NaturePaletteRecord): RgbColor[] {
  if (base.length !== 16) throw new Error("Pokemon palettes must contain exactly 16 colors.");
  const result = base.map(c => ({ ...c }));
  if (record) {
    validateRecord(record);
    let j = 0;
    for (let i = 1; i < 16; ++i) if (record.mask & (1 << i)) result[i] = rgbFrom555(record.colors[j++]);
  }
  return result;
}
