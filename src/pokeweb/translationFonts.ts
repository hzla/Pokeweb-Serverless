import { readAscii, readU16, readU32 } from "../nds/binary";

type Block = { at: number; size: number };
function fontBlocks(bytes: Uint8Array): Map<string, Block> {
  if (bytes.length < 16 || readAscii(bytes, 0, 4) !== "RTFN" || readU16(bytes, 12) !== 16) throw new Error("The numeric font is not a supported NFTR resource.");
  const blocks = new Map<string, Block>();
  let at = 16;
  for (let index = 0; index < readU16(bytes, 14); index++) {
    if (at + 8 > bytes.length) throw new Error("The numeric font block table is truncated.");
    const size = readU32(bytes, at + 4), name = readAscii(bytes, at, 4);
    if (size < 8 || at + size > bytes.length || blocks.has(name)) throw new Error("The numeric font has an unsupported block layout.");
    blocks.set(name, { at, size }); at += size;
  }
  if (at !== bytes.length) throw new Error("The numeric font contains undecoded trailing data.");
  return blocks;
}

/** Font 3 stores three glyph metrics followed by a packed 2bpp cell.
 * US numeric readers use 13-pixel cells, even when the donor font declares 11.
 * Keep the entire US reader contract and expand donor pixels into its cells.
 * No font bitmaps or character tables are bundled with the translator. */
export function adaptTranslationNumericFont(original: Uint8Array, incoming: Uint8Array): Uint8Array {
  const us = fontBlocks(original), donor = fontBlocks(incoming);
  const a = us.get("PLGC"), b = donor.get("PLGC"), am = us.get("PAMC"), bm = donor.get("PAMC");
  if (!a || !b || !am || !bm || us.size !== 4 || donor.size !== 4 || !us.has("FNIF") || !us.has("HDWC") || !donor.has("FNIF") || !donor.has("HDWC")) throw new Error("The numeric font has an unaudited glyph/table layout.");
  const aw = original[a.at + 8], bw = incoming[b.at + 8], height = original[a.at + 9];
  const ac = readU16(original, a.at + 10), bc = readU16(incoming, b.at + 10);
  if (a.size < 16 || b.size < 16 || aw !== 13 || height !== 8 || original[a.at + 14] !== 2 || incoming[b.at + 14] !== 2
    || incoming[b.at + 9] !== height || bw < 1 || bw > aw || ac !== 29 || bc !== 3 + bw * height / 4
    || a.size !== 16 + 32 * ac || b.size !== 16 + 32 * bc) throw new Error("The numeric font cell geometry cannot be adapted to the US 13-pixel reader.");
  // The physical next-table address moves with the bitmap size; character IDs must not.
  if (am.size !== bm.size || am.size < 24 || readU16(original, am.at + 12) !== 2 || readU16(incoming, bm.at + 12) !== 2
    || readU16(original, am.at + 20) !== 32 || readU16(incoming, bm.at + 20) !== 32
    || original.subarray(am.at + 8, am.at + 16).some((value, index) => value !== incoming[bm.at + 8 + index])
    || original.subarray(am.at + 20, am.at + am.size).some((value, index) => value !== incoming[bm.at + 20 + index])) throw new Error("Numeric font character-to-glyph IDs changed; a separate font port is required.");
  const output = original.slice();
  for (let glyph = 0; glyph < 32; glyph++) {
    const src = b.at + 16 + glyph * bc + 3, dst = a.at + 16 + glyph * ac + 3;
    output.fill(0, dst, dst + ac - 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < bw; x++) {
      const from = (y * bw + x) * 2, to = (y * aw + x) * 2;
      output[dst + (to >>> 3)] |= ((incoming[src + (from >>> 3)] >>> (6 - from % 8)) & 3) << (6 - to % 8);
    }
  }
  return output;
}
