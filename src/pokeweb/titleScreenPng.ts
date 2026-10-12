import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decodeTitleComposition, titleNitroBlocks, type TitleScreenDocument } from "./titleScreenModel";
import { parsePokemonCellBank } from "./pokemonSpriteModel";

export type TitlePngLayer = "logo" | "background" | "credits" | "prompt";
export type TitlePngImage = { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray };
export type TitlePngFit = { mode: "fit" | "stretch" | "crop"; x: number; y: number; zoom: number };
export type TitlePngTarget = { width: number; height: number; x: number; y: number };
export type TitlePngImport = {
  imports: Map<string, Uint8Array>;
  image: TitlePngImage;
  colors: number;
  colorLimit: number;
  tiles: number;
  quantized: boolean;
  approximatedTiles: number;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const color555 = (rgba: ArrayLike<number>, at: number) => [0, 1, 2].reduce((v, c) => v | Math.min(31, Math.round(rgba[at + c] / 8)) << (c * 5), 0);
const distance = (a: number, b: number) => (a & 31) - (b & 31);
const colorDistance = (a: number, b: number) => distance(a, b) ** 2 + distance(a >> 5, b >> 5) ** 2 + distance(a >> 10, b >> 10) ** 2;

function asset(document: TitleScreenDocument, id: string): Uint8Array {
  const found = document.assets.find((a) => a.id === id);
  if (!found) throw new Error(`Missing title asset: ${id}`);
  return found.bytes;
}

export function titlePngTarget(document: TitleScreenDocument, layer: TitlePngLayer, fullLogo = false): TitlePngTarget {
  if (layer === "prompt") {
    const oams = parsePokemonCellBank(asset(document, "prompt-cells")).cells.flatMap((c) => c.oams).filter((o) => !o.disable);
    if (!oams.length) throw new Error("Press Start has no visible sprite cells to replace.");
    const x = Math.min(...oams.map((o) => o.x)), y = Math.min(...oams.map((o) => o.y));
    return { x, y, width: Math.max(...oams.map((o) => o.x + o.width)) - x, height: Math.max(...oams.map((o) => o.y + o.height)) - y };
  }
  const bytes = asset(document, `${layer === "background" ? "background" : layer}-map`), block = titleNitroBlocks(bytes).get("NRCS")!;
  return { x: 0, y: 0, width: readU16(bytes, block + 8), height: layer === "logo" && !fullLogo ? Math.min(192, readU16(bytes, block + 10)) : readU16(bytes, block + 10) };
}

/** Full-canvas Press Start exports include the sprite's centered origin. */
export function prepareTitlePngSource(document: TitleScreenDocument, layer: TitlePngLayer, image: TitlePngImage): TitlePngImage {
  validateImage(image);
  if (layer !== "prompt" || image.width !== 256 || image.height !== 256) return image;
  const target = titlePngTarget(document, layer), rgba = new Uint8ClampedArray(target.width * target.height * 4);
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    const sx = target.x + 128 + x, sy = target.y + 128 + y;
    if (sx >= 0 && sy >= 0 && sx < 256 && sy < 256) rgba.set(image.rgba.subarray((sy * 256 + sx) * 4, (sy * 256 + sx) * 4 + 4), (y * target.width + x) * 4);
  }
  return { width: target.width, height: target.height, rgba };
}

export function titlePngPlacement(source: Pick<TitlePngImage, "width" | "height">, target: Pick<TitlePngTarget, "width" | "height">, fit: TitlePngFit) {
  let sx = 0, sy = 0, sw = source.width, sh = source.height, dx = 0, dy = 0, dw = target.width, dh = target.height;
  if (fit.mode === "fit") {
    const scale = Math.min(dw / sw, dh / sh);
    dw = sw * scale; dh = sh * scale; dx = (target.width - dw) / 2; dy = (target.height - dh) / 2;
  } else if (fit.mode === "crop") {
    const scale = Math.max(dw / sw, dh / sh) * clamp(fit.zoom, 1, 4);
    sw = dw / scale; sh = dh / scale; sx = (source.width - sw) * clamp(fit.x, 0, 1); sy = (source.height - sh) * clamp(fit.y, 0, 1);
  }
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/** Premultiplied bilinear filtering preserves color at transparent PNG edges. */
export function resizeTitlePng(source: TitlePngImage, target: Pick<TitlePngTarget, "width" | "height">, fit: TitlePngFit): TitlePngImage {
  validateImage(source);
  if (!Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width < 1 || target.height < 1 || target.width > 256 || target.height > 256) throw new Error("Invalid title layer dimensions.");
  const p = titlePngPlacement(source, target, fit), rgba = new Uint8ClampedArray(target.width * target.height * 4);
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    if (x + .5 < p.dx || x + .5 >= p.dx + p.dw || y + .5 < p.dy || y + .5 >= p.dy + p.dh) continue;
    const sx = clamp(p.sx + (x + .5 - p.dx) * p.sw / p.dw - .5, 0, source.width - 1), sy = clamp(p.sy + (y + .5 - p.dy) * p.sh / p.dh - .5, 0, source.height - 1);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const samples = [[x0, y0, (1 - fx) * (1 - fy)], [Math.min(x0 + 1, source.width - 1), y0, fx * (1 - fy)], [x0, Math.min(y0 + 1, source.height - 1), (1 - fx) * fy], [Math.min(x0 + 1, source.width - 1), Math.min(y0 + 1, source.height - 1), fx * fy]];
    const out = (y * target.width + x) * 4;
    let alpha = 0;
    const rgb = [0, 0, 0];
    for (const [px, py, weight] of samples) {
      const at = (py * source.width + px) * 4, a = source.rgba[at + 3] * weight;
      alpha += a;
      for (let c = 0; c < 3; c++) rgb[c] += source.rgba[at + c] * a;
    }
    rgba[out + 3] = alpha;
    if (alpha) for (let c = 0; c < 3; c++) rgba[out + c] = rgb[c] / alpha;
  }
  return { ...target, rgba };
}

function validateImage(image: TitlePngImage): void {
  if (![image.width, image.height].every((v) => Number.isInteger(v) && v > 0 && v <= 8192) || image.width * image.height > 16 * 1024 * 1024 || image.rgba.length !== image.width * image.height * 4) throw new Error("PNG must contain valid pixels and be at most 8192 pixels per side and 16 megapixels.");
}

/** Weighted median cut over the finite RGB555 space, keeping reserved colors exact. */
function quantize(histogram: Map<number, number>, limit: number): number[] {
  if (histogram.size <= limit) return [...histogram.keys()];
  const boxes = [[...histogram.keys()]];
  const channels = (v: number) => [v & 31, v >> 5 & 31, v >> 10 & 31];
  while (boxes.length < limit) {
    let chosen = -1, axis = 0, score = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const min = [31, 31, 31], max = [0, 0, 0]; let weight = 0;
      for (const v of box) { const c = channels(v); for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], c[a]); max[a] = Math.max(max[a], c[a]); } weight += histogram.get(v)!; }
      const ranges = max.map((v, a) => v - min[a]), a = ranges.indexOf(Math.max(...ranges)), next = ranges[a] * Math.sqrt(weight);
      if (next > score) { chosen = i; axis = a; score = next; }
    });
    if (chosen < 0) break;
    const box = boxes[chosen].sort((a, b) => channels(a)[axis] - channels(b)[axis] || a - b), half = box.reduce((sum, c) => sum + histogram.get(c)!, 0) / 2;
    let sum = 0, split = 1;
    for (; split < box.length; split++) { sum += histogram.get(box[split - 1])!; if (sum >= half) break; }
    split = Math.min(split, box.length - 1); boxes.splice(chosen, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map((box) => {
    const sums = [0, 0, 0]; let weight = 0;
    for (const v of box) { const count = histogram.get(v)!; weight += count; channels(v).forEach((c, a) => sums[a] += c * count); }
    return sums.reduce((v, c, a) => v | Math.round(c / weight) << (a * 5), 0);
  });
}

function indexImage(image: TitlePngImage, palette: number[], pinned: Set<number>, limit: number) {
  const histogram = new Map<number, number>(), fixed = new Set([...pinned].filter((i) => i !== 0).map((i) => palette[i]));
  for (let at = 0; at < image.rgba.length; at += 4) if (image.rgba[at + 3] >= 128) {
    const color = color555(image.rgba, at);
    if (!fixed.has(color)) histogram.set(color, (histogram.get(color) ?? 0) + 1);
  }
  const slots = Array.from({ length: limit - 1 }, (_, i) => i + 1).filter((i) => !pinned.has(i));
  const colors = slots.length ? quantize(histogram, slots.length) : [];
  colors.forEach((color, i) => palette[slots[i]] = color);
  const available = [...pinned].filter((i) => i > 0).concat(slots.slice(0, colors.length));
  if (!available.length) available.push(1);
  const cache = new Map<number, number>(), indices = new Uint8Array(image.width * image.height);
  for (let i = 0; i < indices.length; i++) {
    if (image.rgba[i * 4 + 3] < 128) continue;
    const color = color555(image.rgba, i * 4); let index = cache.get(color);
    if (index === undefined) {
      let best = Infinity; index = available[0];
      for (const candidate of available) { const d = colorDistance(color, palette[candidate]); if (d < best) { best = d; index = candidate; } }
      cache.set(color, index);
    }
    indices[i] = index;
  }
  return { indices, quantized: [...cache].some(([color, index]) => color !== palette[index]) };
}

const tileKey = (tile: Uint8Array) => String.fromCharCode(...tile);
function flipTile(tile: Uint8Array, flags: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => tile[((flags & 0x800) ? 7 - (i >> 3) : i >> 3) * 8 + ((flags & 0x400) ? 7 - (i & 7) : i & 7)]);
}
class TileBank {
  tiles: Uint8Array[] = [];
  lookup = new Map<string, number>();
  constructor() { this.add(new Uint8Array(64)); }
  add(tile: Uint8Array): number {
    const existing = this.lookup.get(tileKey(tile));
    if (existing !== undefined) return existing;
    const index = this.tiles.length; this.tiles.push(tile.slice());
    for (const flags of [0, 0x400, 0x800, 0xc00]) { const key = tileKey(flipTile(tile, flags)); if (!this.lookup.has(key)) this.lookup.set(key, index | flags); }
    return index;
  }
  map(indices: Uint8Array, width: number, height: number, palette: number[], limit: number) {
    const tiles = Array.from({ length: width * height / 64 }, (_, i) => Uint8Array.from({ length: 64 }, (_, p) => indices[((i / (width / 8) | 0) * 8 + (p >> 3)) * width + (i % (width / 8)) * 8 + (p & 7)]));
    const unique = new Map<string, { tile: Uint8Array; count: number }>();
    for (const tile of tiles) {
      const key = [0, 0x400, 0x800, 0xc00].map((flags) => tileKey(flipTile(tile, flags))).sort()[0];
      const entry = unique.get(key); if (entry) entry.count++; else unique.set(key, { tile, count: 1 });
    }
    const ranked = [...unique.values()].sort((a, b) => b.count - a.count);
    for (const { tile } of ranked) if (this.tiles.length < limit) this.add(tile);
    let approximatedTiles = 0;
    const cache = new Map<string, number>(), entries = new Uint16Array(tiles.length);
    // Only imported tiles may be approximated; the other shared layer is pinned.
    const distances = Array.from({ length: palette.length }, (_, a) => Uint16Array.from(palette, (b, i) => !a !== !i ? 6000 : colorDistance(palette[a], b)));
    tiles.forEach((tile, i) => {
      const key = tileKey(tile), exact = this.lookup.get(key);
      if (exact !== undefined) { entries[i] = exact; return; }
      approximatedTiles++;
      let index = cache.get(key);
      if (index === undefined) {
        let best = Infinity; index = 0;
        this.tiles.forEach((candidate, j) => {
          let error = 0;
          for (let p = 0; p < 64 && error < best; p++) {
            // Approximation may remove fine detail, but must not paint over
            // a transparent source pixel. The empty tile is always available.
            if (tile[p] === 0 && candidate[p] !== 0) { error = Infinity; break; }
            error += distances[tile[p]][candidate[p]];
          }
          if (error < best) { best = error; index = j; }
        });
        cache.set(key, index);
      }
      entries[i] = index;
    });
    return { entries, approximatedTiles };
  }
}

/** Keep ancillary Nitro blocks while replacing one block's payload and sizes. */
function replaceBlock(template: Uint8Array, stamp: string, headerSize: number, data: Uint8Array): Uint8Array {
  const offset = titleNitroBlocks(template).get(stamp);
  if (offset === undefined) throw new Error(`Missing ${stamp} title data.`);
  const oldSize = readU32(template, offset + 4), size = headerSize + data.length;
  const bytes = new Uint8Array(template.length - oldSize + size);
  bytes.set(template.subarray(0, offset + headerSize)); bytes.set(data, offset + headerSize); bytes.set(template.subarray(offset + oldSize), offset + size);
  writeU32(bytes, 8, bytes.length); writeU32(bytes, offset + 4, size);
  return bytes;
}
function writePalette(template: Uint8Array, palette: number[]): Uint8Array {
  const data = new Uint8Array(512); palette.forEach((c, i) => writeU16(data, i * 2, c));
  const bytes = replaceBlock(template, "TTLP", 24, data), offset = titleNitroBlocks(bytes).get("TTLP")!;
  writeU32(bytes, offset + 16, data.length); writeU32(bytes, offset + 20, 16); return bytes;
}
function writeCharacters(template: Uint8Array, tiles: Uint8Array[], bpp: 4 | 8): Uint8Array {
  // These are the allocations used by the title loaders: 32 KiB BG / 16 KiB 4bpp.
  const data = new Uint8Array(bpp === 8 ? 0x8000 : 0x4000);
  tiles.forEach((tile, i) => { if (bpp === 8) data.set(tile, i * 64); else for (let p = 0; p < 64; p++) data[i * 32 + (p >> 1)] |= tile[p] << ((p & 1) * 4); });
  const bytes = replaceBlock(template, "RAHC", 32, data), offset = titleNitroBlocks(bytes).get("RAHC")!;
  writeU16(bytes, offset + 8, 16); writeU16(bytes, offset + 10, 32); writeU32(bytes, offset + 24, data.length); writeU32(bytes, offset + 28, 24); return bytes;
}
function writeMap(template: Uint8Array, entries: Uint16Array): Uint8Array {
  const bytes = template.slice(), offset = titleNitroBlocks(bytes).get("NRCS")!;
  if (entries.length * 2 !== readU32(bytes, offset + 16)) throw new Error("Imported tilemap dimensions do not match the title layer.");
  entries.forEach((entry, i) => writeU16(bytes, offset + 20 + i * 2, entry)); return bytes;
}

export function compileTitlePng(document: TitleScreenDocument, layer: TitlePngLayer, image: TitlePngImage): TitlePngImport {
  validateImage(image);
  const target = titlePngTarget(document, layer, layer === "logo" && image.height > 192);
  if (image.width !== target.width || image.height !== target.height) throw new Error(`Resize the PNG to ${target.width}×${target.height} before compiling.`);
  if (layer === "prompt") return compilePrompt(document, image, target);
  const composition = decodeTitleComposition(document), original = composition[layer], shared = layer === "logo" || layer === "background";
  const palette = original.indexed.palette.map((c) => color555(c, 0));
  while (palette.length < 256) palette.push(0);
  const pinned = new Set<number>([0]), bank = new TileBank(), imports = new Map<string, Uint8Array>();
  if (shared) {
    const sibling = layer === "logo" ? "background" : "logo", other = composition[sibling];
    const entries = Uint16Array.from(other.indexed.entries, (entry) => {
      const tile = other.indexed.tilePixels[entry & 1023];
      if (!tile) throw new Error("The existing shared title layer references missing tiles.");
      tile.forEach((index) => pinned.add(index));
      return (bank.add(tile) ^ (entry & 0xc00)) | (entry & 0xf000);
    });
    imports.set(`${sibling}-map`, writeMap(asset(document, `${sibling}-map`), entries));
  }
  if (bank.tiles.length > 512) throw new Error("The existing shared layer leaves no room for the transparent tile required by PNG import.");
  const indexed = indexImage(image, palette, pinned, shared ? 256 : 16);
  // Unseen rows below the visible logo viewport must stay transparent.
  const pixels = new Uint8Array(original.width * original.height); pixels.set(indexed.indices);
  const mapped = bank.map(pixels, original.width, original.height, palette, 512);
  const prefix = shared ? "logo" : "credits";
  imports.set(`${layer}-map`, writeMap(asset(document, `${layer}-map`), mapped.entries));
  imports.set(`${prefix}-tiles`, writeCharacters(asset(document, `${prefix}-tiles`), bank.tiles, shared ? 8 : 4));
  imports.set(`${prefix}-palette`, writePalette(asset(document, `${prefix}-palette`), palette));
  const candidate = { ...document, assets: document.assets.map((a) => ({ ...a, bytes: imports.get(a.id) ?? a.bytes })) };
  const preview = decodeTitleComposition(candidate)[layer];
  const rgba = preview.rgba.slice(0, image.width * image.height * 4);
  return { imports, image: { width: image.width, height: image.height, rgba }, colors: new Set(pixels).size, colorLimit: shared ? 256 : 16, tiles: bank.tiles.length, quantized: indexed.quantized, approximatedTiles: mapped.approximatedTiles };
}

function compilePrompt(document: TitleScreenDocument, image: TitlePngImage, target: TitlePngTarget): TitlePngImport {
  const template = asset(document, "prompt-tiles"), offset = titleNitroBlocks(template).get("RAHC")!;
  const cells = parsePokemonCellBank(asset(document, "prompt-cells")), oams = cells.cells.flatMap((c) => c.oams).filter((o) => !o.disable);
  if (oams.some((o) => o.rotateScale || o.characterBits !== 4)) throw new Error("PNG import requires non-affine 4bpp Press Start cells.");
  const palette = Array.from({ length: 256 }, () => 0), indexed = indexImage(image, palette, new Set([0]), 16);
  const data = template.slice(), dataSize = readU32(template, offset + 24);
  const wide = Math.max(1, readU16(template, offset + 16) || Math.ceil(Math.sqrt(Math.max(1, dataSize / 32))));
  const mapping = cells.mappingMode, twoD = mapping === 0 || mapping === 4;
  const boundary = mapping === 1 || mapping === 0x100010 ? 64 : mapping === 2 || mapping === 0x200010 ? 128 : mapping === 3 || mapping === 0x300010 ? 256 : 32;
  const written = new Map<number, number>();
  for (const o of oams) {
    for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
      const sx = o.x + x - target.x, sy = o.y + y - target.y, index = indexed.indices[sy * target.width + sx];
      const px = o.flipX ? o.width - 1 - x : x, py = o.flipY ? o.height - 1 - y : y;
      const tile = o.characterName * boundary / 32 + (py >> 3) * (twoD ? wide : o.width / 8) + (px >> 3), p = tile * 64 + (py & 7) * 8 + (px & 7);
      if (p / 2 >= dataSize) throw new Error("Press Start cells reference tiles outside their allocation.");
      if (written.has(p) && written.get(p) !== index) throw new Error("Press Start cells reuse pixels at different positions. Import native resources for this custom layout.");
      written.set(p, index);
      const at = offset + 32 + (p >> 1), shift = (p & 1) * 4;
      data[at] = (data[at] & ~(15 << shift)) | index << shift;
    }
    for (let i = 1; i < 16; i++) palette[o.palette * 16 + i] = palette[i];
  }
  const imports = new Map([["prompt-tiles", data], ["prompt-palette", writePalette(asset(document, "prompt-palette"), palette)]]);
  const rgba = new Uint8ClampedArray(image.rgba.length);
  for (let i = 0; i < indexed.indices.length; i++) {
    // Artwork outside the existing sprite rectangles cannot appear in game.
    const x = i % image.width + target.x, y = (i / image.width | 0) + target.y;
    if (!oams.some((o) => x >= o.x && x < o.x + o.width && y >= o.y && y < o.y + o.height)) continue;
    const index = indexed.indices[i], c = palette[index]; if (index) rgba.set([(c & 31) << 3, (c >> 5 & 31) << 3, (c >> 10 & 31) << 3, 255], i * 4);
  }
  return { imports, image: { ...image, rgba }, colors: new Set(indexed.indices).size, colorLimit: 16, tiles: dataSize / 32, quantized: indexed.quantized, approximatedTiles: 0 };
}
