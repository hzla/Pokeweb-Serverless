import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressNitro } from "./pokemonSpriteModel";
import { parseNitroBackground, type NitroBackgroundImage } from "./nitroBg";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";

export type TownMapLayer = { label: string; screen: number; characters: number; palette: number; extended?: boolean };
export const TOWN_MAP_LAYERS: readonly TownMapLayer[] = [
  { label: "Map · back", screen: 16, characters: 7, palette: 0, extended: true },
  { label: "Map · front", screen: 17, characters: 5, palette: 0, extended: true },
  { label: "Information background", screen: 15, characters: 6, palette: 1 },
];
export type TownMapGraphicFiles = Map<number, Uint8Array>;
export const equalTownMapBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export function unpackTownMapResource(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x10 && bytes[0] !== 0x11) return bytes;
  const size = readU32(bytes, 0) >>> 8;
  if (!size || size > 4 * 1024 * 1024) throw new Error("Invalid Town Map compressed resource size.");
  const result = decompressNitro(bytes);
  if (result.length !== size) throw new Error("Truncated Town Map compressed resource.");
  return result;
}
export function repackTownMapResource(original: Uint8Array, edited: Uint8Array): Uint8Array {
  if (equalTownMapBytes(unpackTownMapResource(original), edited)) return original;
  if (original[0] !== 0x10 && original[0] !== 0x11) return edited;
  // Literal packets preserve the source compression type without requiring a host codec.
  const result = new Uint8Array(4 + edited.length + Math.ceil(edited.length / 8));
  writeU32(result, 0, (edited.length << 8) | original[0]);
  for (let at = 0, out = 4; at < edited.length;) {
    result[out++] = 0;
    for (let n = 0; n < 8 && at < edited.length; n++) result[out++] = edited[at++];
  }
  return result;
}
export function townMapBlock(bytes: Uint8Array, stamp: string): number {
  if (bytes.length < 16 || readU32(bytes, 8) !== bytes.length) throw new Error("Invalid Nitro resource length.");
  let at = readU16(bytes, 12);
  for (let i = 0; i < readU16(bytes, 14); i++) {
    const size = readU32(bytes, at + 4);
    if (at < 16 || size < 8 || at + size > bytes.length) throw new Error("Invalid Nitro block bounds.");
    if (readAscii(bytes, at, 4) === stamp) return at;
    at += size;
  }
  throw new Error(`Missing ${stamp} graphics block.`);
}
function replacePayload(original: Uint8Array, block: number, start: number, size: number, payload: Uint8Array): Uint8Array {
  if (start < block + 8 || start + size > block + readU32(original, block + 4)) throw new Error("Invalid graphics payload bounds.");
  const out = new Uint8Array(original.length + payload.length - size);
  out.set(original.subarray(0, start)); out.set(payload, start); out.set(original.subarray(start + size), start + payload.length);
  writeU32(out, 8, out.length); writeU32(out, block + 4, readU32(original, block + 4) + payload.length - size);
  return out;
}
export function readTownMapLayer(files: TownMapGraphicFiles, layer: TownMapLayer): NitroBackgroundImage {
  const read = (id: number) => {
    const bytes = files.get(id); if (!bytes) throw new Error(`Town Map graphics member ${id} is missing.`);
    return unpackTownMapResource(bytes);
  };
  const screen = read(layer.screen), chars = read(layer.characters), palette = read(layer.palette);
  const sb = townMapBlock(screen, "NRCS"), cb = townMapBlock(chars, "RAHC"), pb = townMapBlock(palette, "TTLP");
  if (readU16(screen, sb + 8) !== 256 || readU16(screen, sb + 10) !== 256 || readU32(screen, sb + 16) !== 2048)
    throw new Error("Town Map layers must be 256 × 256 pixels with 1024 screen entries.");
  if (readU32(chars, cb + 12) !== (layer.extended ? 4 : 3)) throw new Error("Unsupported Town Map character depth.");
  if (cb + 32 + readU32(chars, cb + 24) > cb + readU32(chars, cb + 4)
    || pb + 24 + readU32(palette, pb + 16) > pb + readU32(palette, pb + 4)) throw new Error("Truncated Town Map graphics.");
  const image = parseNitroBackground(layer.screen, screen, chars, palette,
    { transparentIndexZero: true, extendedPaletteBanks: Boolean(layer.extended) });
  if (image.warnings.length || image.indexed.entries.some(entry => (entry & 1023) >= image.indexed.tilePixels.length))
    throw new Error(image.warnings.join(" ") || "Screen references a missing tile.");
  return image;
}
export function writeTownMapLayer(files: TownMapGraphicFiles, layer: TownMapLayer, image: NitroBackgroundImage): void {
  const { entries, tilePixels, palette, bitsPerPixel } = image.indexed;
  const maxTiles = layer.extended ? 1024 : 1024;
  if (entries.length !== 1024 || !tilePixels.length || tilePixels.length > maxTiles || tilePixels.some(t => t.length !== 64))
    throw new Error("A Town Map layer needs 1024 entries and at most 1024 tiles.");
  const expectedDepth = layer.extended ? 8 : 4;
  if (bitsPerPixel !== expectedDepth || palette.length > (layer.extended ? 4096 : 256)) throw new Error("Palette or tile depth exceeds this layer's native capacity.");
  if (entries.some(e => (e & 1023) >= tilePixels.length || ((e >>> 12) + 1) * (bitsPerPixel === 8 ? 256 : 16) > palette.length))
    throw new Error("Screen references a missing tile or palette bank.");
  const staged = new Map<number, Uint8Array>();
  const screenSource = files.get(layer.screen)!, screen = unpackTownMapResource(screenSource).slice(), sb = townMapBlock(screen, "NRCS");
  entries.forEach((e, i) => writeU16(screen, sb + 20 + i * 2, e)); staged.set(layer.screen, repackTownMapResource(screenSource, screen));
  const charSource = files.get(layer.characters)!, chars = unpackTownMapResource(charSource), cb = townMapBlock(chars, "RAHC");
  const pixels = new Uint8Array(tilePixels.length * (bitsPerPixel === 8 ? 64 : 32));
  tilePixels.forEach((tile, i) => {
    for (let p = 0; p < 64; p++) {
      if (tile[p] >= (1 << bitsPerPixel)) throw new Error("Pixel exceeds the indexed color range.");
      if (bitsPerPixel === 8) pixels[i * 64 + p] = tile[p];
      else pixels[i * 32 + (p >> 1)] |= tile[p] << ((p & 1) * 4);
    }
  });
  const out = replacePayload(chars, cb, cb + 32, readU32(chars, cb + 24), pixels); writeU32(out, cb + 24, pixels.length);
  if (!equalTownMapBytes(out, chars)) { writeU16(out, cb + 8, 0xffff); writeU16(out, cb + 10, 0xffff); }
  staged.set(layer.characters, repackTownMapResource(charSource, out));
  const palSource = files.get(layer.palette)!, pal = unpackTownMapResource(palSource), pb = townMapBlock(pal, "TTLP");
  const colors = new Uint8Array(palette.length * 2);
  palette.forEach(([r, g, b], i) => writeU16(colors, i * 2, (Math.min(31, Math.round(r / 8)) | Math.min(31, Math.round(g / 8)) << 5 | Math.min(31, Math.round(b / 8)) << 10) | (readU16(pal, pb + 24 + i * 2) & 0x8000)));
  const po = replacePayload(pal, pb, pb + 24, readU32(pal, pb + 16), colors); writeU32(po, pb + 16, colors.length);
  staged.set(layer.palette, repackTownMapResource(palSource, po));
  staged.forEach((bytes, id) => files.set(id, bytes));
}
export type TownMapImageConversion = { image: NitroBackgroundImage; changedPixels: number; tiles: number; paletteBanks: number };
/** Quantize against the existing shared palette. Other layers' colors stay intact. */
export function convertTownMapImage(source: NitroBackgroundImage, rgba: Uint8ClampedArray, width: number, height: number): TownMapImageConversion {
  if (width !== 256 || height !== 256 || rgba.length !== 256 * 256 * 4) throw new Error("Import a 256 × 256 PNG or BMP.");
  const image = structuredClone(source), { indexed } = image, bankSize = indexed.bitsPerPixel === 8 ? 256 : 16;
  const banks = Math.min(16, Math.floor(indexed.palette.length / bankSize));
  if (!banks) throw new Error("Layer has no complete palette bank.");
  const tiles: Uint8Array[] = [], keys = new Map<string, number>(), usedBanks = new Set<number>();
  let changedPixels = 0;
  const matches = new Map<string, { color: number; error: number }>();
  function nearest(bank: number, at: number) {
    if (rgba[at + 3] < 128) return { color: 0, error: 0 };
    const key = `${bank}:${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`;
    const cached = matches.get(key); if (cached) return cached;
    let color = 1, error = Infinity;
    for (let i = 1; i < bankSize; i++) {
      const c = indexed.palette[bank * bankSize + i];
      const d = (c[0] - rgba[at]) ** 2 + (c[1] - rgba[at + 1]) ** 2 + (c[2] - rgba[at + 2]) ** 2;
      if (d < error) { color = i; error = d; if (!d) break; }
    }
    const result = { color, error }; matches.set(key, result); return result;
  }
  for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
    let bestError = Infinity, chosenBank = 0, chosenTile = new Uint8Array(64);
    for (let bank = 0; bank < banks; bank++) {
      let error = 0; const tile = new Uint8Array(64);
      for (let p = 0; p < 64; p++) {
        const at = ((ty * 8 + (p >> 3)) * 256 + tx * 8 + (p & 7)) * 4, match = nearest(bank, at);
        tile[p] = match.color; error += match.error;
      }
      if (error < bestError) { bestError = error; chosenBank = bank; chosenTile = tile; if (!error) break; }
    }
    for (let p = 0; p < 64; p++) {
      const at = ((ty * 8 + (p >> 3)) * 256 + tx * 8 + (p & 7)) * 4;
      if (nearest(chosenBank, at).error) changedPixels++;
    }
    const key = Array.from(chosenTile).join(","); let tileId = keys.get(key);
    if (tileId === undefined) { tileId = tiles.length; keys.set(key, tileId); tiles.push(chosenTile); }
    indexed.entries[ty * 32 + tx] = tileId | (chosenBank << 12); usedBanks.add(chosenBank);
  }
  indexed.tilePixels = tiles;
  return { image, changedPixels, tiles: tiles.length, paletteBanks: usedBanks.size };
}
export function fillTownMapTiles(entries: Uint16Array, start: number, value: number): void {
  const old = entries[start]; if (old === value) return;
  const pending = [start], seen = new Set<number>();
  while (pending.length) {
    const at = pending.pop()!; if (seen.has(at) || at < 0 || at >= entries.length || entries[at] !== old) continue;
    seen.add(at); entries[at] = value;
    if (at % 32) pending.push(at - 1); if (at % 32 < 31) pending.push(at + 1);
    pending.push(at - 32, at + 32);
  }
}
export type TownMapTileSet = { tiles: Uint8Array[]; palette: NitroPaletteData; bitsPerPixel: 4 | 8 };
export function readTownMapTileSet(files: TownMapGraphicFiles, character: number, palette: number): TownMapTileSet {
  const chars = unpackTownMapResource(files.get(character)!), cb = townMapBlock(chars, "RAHC");
  const bpp = readU32(chars, cb + 12) === 4 ? 8 : 4;
  const size = readU32(chars, cb + 24), start = cb + 32, stride = bpp === 8 ? 64 : 32;
  if (size % stride || start + size > chars.length) throw new Error("Invalid tile data length.");
  const tiles = Array.from({ length: size / stride }, (_, t) => {
    const out = new Uint8Array(64);
    for (let p = 0; p < 64; p++) out[p] = bpp === 8 ? chars[start + t * stride + p] : (chars[start + t * stride + (p >> 1)] >> ((p & 1) * 4)) & 15;
    return out;
  });
  return { tiles, bitsPerPixel: bpp, palette: parseNitroPalette(unpackTownMapResource(files.get(palette)!)) };
}
export function writeTownMapTileSet(files: TownMapGraphicFiles, character: number, palette: number, set: TownMapTileSet): void {
  const original = files.get(character)!, source = unpackTownMapResource(original), cb = townMapBlock(source, "RAHC"), bytes = source.slice();
  const stride = set.bitsPerPixel === 8 ? 64 : 32;
  if (set.tiles.length * stride !== readU32(bytes, cb + 24) || set.tiles.some(t => t.length !== 64 || t.some(p => p >= 1 << set.bitsPerPixel))) throw new Error("Sprite tile dimensions or color indices changed.");
  for (let t = 0; t < set.tiles.length; t++) for (let p = 0; p < stride; p++)
    bytes[cb + 32 + t * stride + p] = set.bitsPerPixel === 8 ? set.tiles[t][p] : set.tiles[t][p * 2] | set.tiles[t][p * 2 + 1] << 4;
  const palOriginal = files.get(palette)!, pal = unpackTownMapResource(palOriginal).slice(), pb = townMapBlock(pal, "TTLP");
  if (set.palette.length * 2 !== readU32(pal, pb + 16)) throw new Error("Sprite palette length changed.");
  set.palette.forEach(([r, g, b], i) => writeU16(pal, pb + 24 + i * 2, Math.min(31, Math.round(r / 8)) | Math.min(31, Math.round(g / 8)) << 5 | Math.min(31, Math.round(b / 8)) << 10 | (readU16(pal, pb + 24 + i * 2) & 0x8000)));
  files.set(character, repackTownMapResource(original, bytes)); files.set(palette, repackTownMapResource(palOriginal, pal));
}
