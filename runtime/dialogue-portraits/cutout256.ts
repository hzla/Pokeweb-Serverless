import assert from "node:assert/strict";
import type { PNG } from "pngjs";
import { readU32, writeU16, writeU32 } from "../../src/nds/binary";
import type { NARC } from "../../src/nds/narc";

// Outline the final DS silhouette using its original coverage mask. Cardinal
// neighbors keep diagonals one pixel wide. The canvas ends at the dialogue rim.
export function outlineSilhouette(image: PNG) {
  const { width, height, data } = image;
  const original = Buffer.from(data);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const pixel = (y * width + x) * 4;
      const alpha = pixel + 3;
      if (original[alpha]) continue;
      const touchesArt = (x > 0 && original[alpha - 4]) || (x + 1 < width && original[alpha + 4])
        || (y > 0 && original[alpha - width * 4]) || (y + 1 < height && original[alpha + width * 4]);
      if (touchesArt) data.set([49, 41, 58, 255], pixel);
    }
  }
}

// Append portrait resources to the field's bitmap sprite archive. Member 4
// already animates cell zero with the required one-frame static sequence.
export function appendCutout256(archive: NARC, image: PNG) {
  assert(archive.files.length >= 9 && (archive.files.length - 9) % 3 === 0);
  assert(image.width > 0 && image.width <= 160 && image.width % 8 === 0);
  assert.equal(image.height, 80);
  const indices = new Map<number, number>();
  const palette = Buffer.alloc(512);
  const tiles: Buffer[] = [];
  const oams: number[][] = [];
  for (let cy = 0; cy < image.height; cy += 16) {
    for (let cx = 0; cx < image.width; cx += 32) {
      const chars = Buffer.alloc(512);
      for (let y = 0; y < 16; ++y) {
        for (let x = 0; x < 32 && cx + x < image.width; ++x) {
          const pixel = ((cy + y) * image.width + cx + x) * 4;
          const [r, g, b, a] = image.data.subarray(pixel, pixel + 4);
          if (a === 0) continue;
          assert.equal(a, 255);
          const rgb = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
          let index = indices.get(rgb);
          if (index === undefined) {
            index = indices.size + 1;
            assert(index <= 255, "8bpp requires one transparent palette entry");
            indices.set(rgb, index);
            writeU16(palette, index * 2, rgb);
          }
          const tile = (y >> 3) * 4 + (x >> 3);
          chars[tile * 64 + (y & 7) * 8 + (x & 7)] = index;
        }
      }
      if (!chars.some(Boolean)) continue;
      // Center the cell on the visible canvas so the same graphics can flip in place.
      oams.push([0x6000 | ((cy - 40) & 255), 0x8000 | ((cx - image.width / 2) & 511), tiles.length * 8]);
      tiles.push(chars);
    }
  }
  function nitro(magic: string, block: string, data: Buffer, version = 0x100) {
    const file = Buffer.alloc(24 + data.length);
    file.write(magic);
    writeU16(file, 4, 0xfeff);
    writeU16(file, 6, version);
    writeU32(file, 8, file.length);
    writeU16(file, 12, 16);
    writeU16(file, 14, 1);
    file.write(block, 16);
    writeU32(file, 20, 8 + data.length);
    data.copy(file, 24);
    return file;
  }
  const charHeader = Buffer.from(archive.files[5].slice(24, 48));
  assert.equal(readU32(charHeader, 8), 0x100010);
  writeU32(charHeader, 4, 4); // PLTT256
  writeU32(charHeader, 16, tiles.length * 512);
  const pltt = Buffer.alloc(16 + palette.length);
  writeU32(pltt, 0, 4);
  writeU32(pltt, 4, 1); // Extended OBJ palette
  writeU32(pltt, 8, palette.length);
  writeU32(pltt, 12, 16);
  palette.copy(pltt, 16);
  const cell = Buffer.alloc((32 + oams.length * 6 + 3) & ~3);
  writeU16(cell, 0, 1);
  writeU32(cell, 4, 24);
  writeU32(cell, 8, 1); // 1D 64 KiB mapping
  writeU16(cell, 24, oams.length);
  writeU16(cell, 26, 24); // Bounding radius in four-pixel units
  oams.forEach((attrs, i) => attrs.forEach((attr, j) => writeU16(cell, 32 + i * 6 + j * 2, attr)));
  archive.files.push(nitro("RGCN", "RAHC", Buffer.concat([charHeader, ...tiles]), 0x101),
    nitro("RLCN", "TTLP", pltt), nitro("RECN", "KBEC", cell));
  return { visibleColors: indices.size, characterBytes: tiles.length * 512 };
}
