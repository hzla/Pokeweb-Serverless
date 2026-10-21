import { readU16, readU32, readAscii, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { tile, untile } from "../cgearButtons/compiler";

/** A 16px currency icon, centered in the native shop's 32px item cell. */
export function currencyGraphics(
  item: number,
  icons: NARC,
  mapping: Uint8Array,
): Uint8Array[] {
  const art = new Uint8Array(512);
  const blankPalette = new Uint8Array(72);
  blankPalette.set(new TextEncoder().encode("RLCN"));
  writeU16(blankPalette, 4, 0xfeff);
  writeU16(blankPalette, 6, 0x100);
  writeU32(blankPalette, 8, 72);
  writeU16(blankPalette, 12, 16);
  writeU16(blankPalette, 14, 1);
  blankPalette.set(new TextEncoder().encode("TTLP"), 16);
  writeU32(blankPalette, 20, 56);
  writeU32(blankPalette, 24, 3);
  writeU32(blankPalette, 32, 32);
  writeU32(blankPalette, 36, 16);
  if (!item) return [art, blankPalette];
  const character = icons.files[readU16(mapping, item * 4)],
    palette = icons.files[readU16(mapping, item * 4 + 2)];
  if (
    !character ||
    readAscii(character, 0, 4) !== "RGCN" ||
    character.length < 560 ||
    readU32(character, 40) !== 512 ||
    !palette ||
    readAscii(palette, 0, 4) !== "RLCN" ||
    palette.length < 72
  )
    throw new Error(`Unrecognized currency icon for item ${item}.`);
  const pixels = untile(character.subarray(48, 560));
  let left = 32,
    top = 32,
    right = -1,
    bottom = -1;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      if (pixels[y * 32 + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) throw new Error(`Currency item ${item} has an empty icon.`);
  const width = right - left + 1,
    height = bottom - top + 1,
    scale = 16 / Math.max(width, height),
    w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale)),
    result = new Uint8Array(1024);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      result[
        (y + Math.floor((32 - h) / 2)) * 32 + x + Math.floor((32 - w) / 2)
      ] =
        pixels[
          (top + Math.min(height - 1, Math.floor(((y + 0.5) * height) / h))) *
            32 +
            left +
            Math.min(width - 1, Math.floor(((x + 0.5) * width) / w))
        ];
  blankPalette.set(palette.subarray(40, 72), 40);
  return [tile(result), blankPalette];
}
