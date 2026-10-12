import { writeU16, writeU32 } from "../../nds/binary";

/** Synthetic 32-glyph numeric font. No ROM font data is stored here. */
export function numericFontFixture(width: number, localized = false): Uint8Array {
  const cell = 3 + width * 2, glyphSize = 16 + 32 * cell;
  const bytes = new Uint8Array(16 + 28 + glyphSize + 544 + 152);
  const stamp = (at: number, text: string) => bytes.set(new TextEncoder().encode(text), at);
  stamp(0, "RTFN"); writeU32(bytes, 8, bytes.length); writeU16(bytes, 12, 16); writeU16(bytes, 14, 4);
  stamp(16, "FNIF"); writeU32(bytes, 20, 28); bytes[31] = width;
  stamp(44, "PLGC"); writeU32(bytes, 48, glyphSize); bytes[52] = width; bytes[53] = 8; writeU16(bytes, 54, cell); bytes[58] = 2;
  for (let glyph = 0; glyph < 32; glyph++) {
    const at = 60 + glyph * cell; bytes.set([0, localized && glyph === 15 ? 6 : 8, 8], at);
    for (let y = 0; y < 8; y++) for (let x = 0; x < Math.min(width, 8); x++) {
      const value = localized && glyph === 15 ? x === 0 || y === 7 ? 1 : 0 : x === y || x === glyph % 8 ? 3 : 0;
      const bit = (y * width + x) * 2; bytes[at + 3 + (bit >>> 3)] |= value << (6 - bit % 8);
    }
  }
  const widths = 44 + glyphSize, map = widths + 544;
  stamp(widths, "HDWC"); writeU32(bytes, widths + 4, 544);
  stamp(map, "PAMC"); writeU32(bytes, map + 4, 152); writeU16(bytes, map + 10, 0xffff); writeU16(bytes, map + 12, 2);
  writeU32(bytes, map + 16, bytes.length + 8); writeU16(bytes, map + 20, 32);
  for (let glyph = 0; glyph < 32; glyph++) { writeU16(bytes, map + 22 + glyph * 4, 32 + glyph); writeU16(bytes, map + 24 + glyph * 4, glyph); }
  return bytes;
}
