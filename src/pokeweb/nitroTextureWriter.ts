import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { align, ensure, nitroBlocks, readDictionary, writeDictionary, writeNitroFile } from "./nitroResourceWriter";

export type ImportTexture = { name: string; width: number; height: number; rgba: Uint8Array };
export type EncodedTexture = { name: string; width: number; height: number; params: number; pixels: Uint8Array; palette: Uint8Array; quantized: boolean };
const rgb = (v: number) => [v & 31, (v >>> 5) & 31, (v >>> 10) & 31];
/** Weighted median-cut in the DS's native RGB555 color space. */
function paletteColors(histogram: Map<number, number>, limit: number): number[] {
  const boxes = [[...histogram.keys()]];
  while (boxes.length < limit) {
    let chosen = -1, axis = 0, score = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const values = box.map(rgb), ranges = [0, 1, 2].map(a => Math.max(...values.map(c => c[a])) - Math.min(...values.map(c => c[a])));
      const a = ranges.indexOf(Math.max(...ranges)), weight = box.reduce((n, c) => n + histogram.get(c)!, 0);
      if (ranges[a] * Math.sqrt(weight) > score) { chosen = i; axis = a; score = ranges[a] * Math.sqrt(weight); }
    });
    if (chosen < 0) break;
    const box = boxes[chosen].sort((a, b) => rgb(a)[axis] - rgb(b)[axis]);
    const half = box.reduce((n, c) => n + histogram.get(c)!, 0) / 2;
    let sum = 0, split = 1;
    for (; split < box.length; split++) { sum += histogram.get(box[split - 1])!; if (sum >= half) break; }
    split = Math.min(split, box.length - 1); boxes.splice(chosen, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map(box => {
    const weight = box.reduce((n, c) => n + histogram.get(c)!, 0);
    const channels = [0, 1, 2].map(a => Math.round(box.reduce((n, c) => n + rgb(c)[a] * histogram.get(c)!, 0) / weight));
    return channels[0] | channels[1] << 5 | channels[2] << 10;
  });
}
export function encodeNitroTexture(image: ImportTexture): EncodedTexture {
  const { width, height, rgba } = image;
  ensure([width, height].every(n => Number.isInteger(n) && n >= 8 && n <= 1024 && (n & (n - 1)) === 0) && rgba.length === width * height * 4, `Texture ${image.name} must have power-of-two dimensions from 8 to 1024.`);
  const histogram = new Map<number, number>(), colors = new Uint16Array(width * height);
  let transparent = false, translucent = false;
  for (let i = 0; i < colors.length; i++) {
    colors[i] = Math.round(rgba[i * 4] * 31 / 255) | Math.round(rgba[i * 4 + 1] * 31 / 255) << 5 | Math.round(rgba[i * 4 + 2] * 31 / 255) << 10;
    const alpha = rgba[i * 4 + 3]; transparent ||= alpha === 0; translucent ||= alpha > 0 && alpha < 255;
    if (alpha) histogram.set(colors[i], (histogram.get(colors[i]) ?? 0) + 1);
  }
  if (!histogram.size) histogram.set(0, 1);
  const reserve = transparent && !translucent ? 1 : 0, limit = translucent ? 32 : 256 - reserve;
  const quantized = histogram.size > limit;
  const palette = quantized ? paletteColors(histogram, limit) : [...histogram.keys()];
  if (reserve) palette.unshift(0);
  const format = translucent ? 1 : palette.length <= 16 ? 3 : 4;
  const pixels = new Uint8Array(format === 3 ? colors.length / 2 : colors.length), cache = new Map<number, number>();
  for (let i = 0; i < colors.length; i++) {
    let index = cache.get(colors[i]);
    if (index === undefined) {
      const c = rgb(colors[i]); let distance = Infinity; index = reserve;
      palette.forEach((v, j) => { if (j < reserve) return; const other = rgb(v), d = c.reduce((n, x, k) => n + (x - other[k]) ** 2, 0); if (d < distance) { distance = d; index = j; } });
      cache.set(colors[i], index);
    }
    if (reserve && !rgba[i * 4 + 3]) index = 0;
    if (format === 3) pixels[i >>> 1] |= index << ((i & 1) * 4);
    else pixels[i] = index | (format === 1 ? Math.round(rgba[i * 4 + 3] * 7 / 255) << 5 : 0);
  }
  const paletteBytes = new Uint8Array(align(palette.length * 2, 8)); palette.forEach((c, i) => writeU16(paletteBytes, i * 2, c));
  const params = ((Math.log2(width) - 3) << 20) | ((Math.log2(height) - 3) << 23) | (format << 26) | (reserve << 29);
  return { name: image.name, width, height, params, pixels, palette: paletteBytes, quantized };
}

/** Append textures without changing any existing palette addresses, compressed data, or animation names. */
export function appendNitroTextures(template: Uint8Array, images: EncodedTexture[]): Uint8Array {
  if (!images.length) return template;
  const blocks = nitroBlocks(template), index = blocks.findIndex(b => readAscii(b, 0, 4) === "TEX0"); ensure(index >= 0, "Missing texture block.");
  const old = blocks[index], textures = readDictionary(old, readU16(old, 14)), palettes = readDictionary(old, readU16(old, 52));
  const bank = (offset: number, size: number) => { const start = readU32(old, offset), length = readU16(old, size) * 8; ensure(start + length <= old.length, "Invalid texture bank."); return old.slice(start, start + length); };
  const texData: Uint8Array[] = [bank(20, 12)], paletteData: Uint8Array[] = [bank(56, 48)];
  const compressed = bank(36, 28), compressedIndices = old.slice(readU32(old, 40), readU32(old, 40) + compressed.length / 2);
  let texLength = texData[0].length, paletteLength = paletteData[0].length;
  for (const image of images) {
    const existing = textures.find(t => t.name === image.name), existingPalette = palettes.find(p => p.name === image.name);
    if (existing || existingPalette) {
      ensure(existing && existingPalette, "Imported texture name collides with an existing resource.");
      const params = readU32(existing.data, 0), pixelOffset = (params & 0xffff) * 8, paletteOffset = readU16(existingPalette.data, 0) * 8;
      ensure((params & 0xffff0000) === image.params && image.pixels.every((v, i) => texData[0][pixelOffset + i] === v) && image.palette.every((v, i) => paletteData[0][paletteOffset + i] === v), "Imported texture name collides with different native pixels.");
      continue;
    }
    const tex = new Uint8Array(8), pal = new Uint8Array(4);
    writeU32(tex, 0, image.params | (texLength / 8)); writeU32(tex, 4, (image.width | image.height << 11 | 0x80000000) >>> 0);
    // The dictionary stores offsets in 8-byte units, but the runtime halves
    // them for every format except 4-color textures (which we do not emit).
    // Align each palette to 16 bytes or hardware reads the preceding colors.
    const padding = align(paletteLength, 16) - paletteLength;
    if (padding) { paletteData.push(new Uint8Array(padding)); paletteLength += padding; }
    writeU16(pal, 0, paletteLength / 8);
    textures.push({ name: image.name, data: tex }); palettes.push({ name: image.name, data: pal });
    texData.push(image.pixels); paletteData.push(image.palette); texLength += image.pixels.length; paletteLength += image.palette.length;
  }
  ensure(texLength + compressed.length * 1.5 <= 256 * 1024 && paletteLength <= 32 * 1024, "Imported textures exceed the DS texture/palette memory budget. Reduce texture sizes or colors.");
  const td = writeDictionary(textures, 8), pd = writeDictionary(palettes, 4);
  const texStart = align(60 + td.length + pd.length, 8), cmpStart = texStart + texLength, idxStart = cmpStart + compressed.length, palStart = align(idxStart + compressedIndices.length, 8);
  const out = new Uint8Array(palStart + paletteLength); out.set(old.subarray(0, 60)); writeU32(out, 4, out.length);
  writeU16(out, 12, texLength / 8); writeU16(out, 14, 60); writeU32(out, 20, texStart);
  writeU16(out, 30, 60); writeU32(out, 36, cmpStart); writeU32(out, 40, idxStart);
  writeU16(out, 48, paletteLength / 8); writeU32(out, 52, 60 + td.length); writeU32(out, 56, palStart);
  out.set(td, 60); out.set(pd, 60 + td.length); out.set(concatBytes(texData), texStart); out.set(compressed, cmpStart); out.set(compressedIndices, idxStart); out.set(concatBytes(paletteData), palStart);
  blocks[index] = out; return writeNitroFile(template, blocks);
}
