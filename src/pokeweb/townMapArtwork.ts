import type { NitroBackgroundImage, NitroPaletteData } from "./nitroBg";
import { readTownMapLayer, writeTownMapLayer, type TownMapGraphicFiles, type TownMapLayer } from "./townMapGraphics";
import { moveTownMapArea, type TownMapArea, type TownMapDraft } from "./townMapModel";

export type TownMapArtworkRect = { x: number; y: number; width: number; height: number };
export type TownMapArtworkClipboard = {
  source: TownMapArtworkRect;
  layers: { layer: TownMapLayer; pixels: Uint16Array }[];
};
export const TOWN_MAP_TRANSPARENT_PIXEL = 65535;

export function validateTownMapArtworkRect(rect: TownMapArtworkRect): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
    || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
    || rect.x + rect.width > 256 || rect.y + rect.height > 256)
    throw new Error("Keep the artwork selection inside the 256 × 256 map.");
}

/** Absolute palette indices retain the shared color relationships of copied art. */
export function townMapArtworkPixels(image: NitroBackgroundImage): Uint16Array {
  const { entries, tilePixels, bitsPerPixel } = image.indexed, bankSize = bitsPerPixel === 8 ? 256 : 16;
  const pixels = new Uint16Array(256 * 256).fill(TOWN_MAP_TRANSPARENT_PIXEL);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const entry = entries[(y >> 3) * 32 + (x >> 3)], tile = tilePixels[entry & 1023];
    const px = entry & 1024 ? 7 - (x & 7) : x & 7, py = entry & 2048 ? 7 - (y & 7) : y & 7;
    const ink = tile[py * 8 + px];
    if (ink) pixels[y * 256 + x] = (entry >>> 12) * bankSize + ink;
  }
  return pixels;
}

export function captureTownMapArtwork(files: TownMapGraphicFiles, layers: readonly TownMapLayer[], rect: TownMapArtworkRect): TownMapArtworkClipboard {
  validateTownMapArtworkRect(rect);
  if (!layers.length || new Set(layers.map(l => l.screen)).size !== layers.length) throw new Error("Choose an artwork layer.");
  return { source: { ...rect }, layers: layers.map(layer => {
    const source = townMapArtworkPixels(readTownMapLayer(files, layer)), pixels = new Uint16Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) pixels.set(source.subarray((rect.y + y) * 256 + rect.x, (rect.y + y) * 256 + rect.x + rect.width), y * rect.width);
    return { layer, pixels };
  }) };
}

export function townMapArtworkAreas(areas: TownMapArea[], rect: TownMapArtworkRect): number[] {
  const inside = (p: { x: number; y: number }) => p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.width && p.y < rect.y + rect.height;
  return areas.flatMap((a, i) => inside(a.position) || inside(a.cursor) ? [i] : []);
}

export function townMapArtworkRgba(pixels: Uint16Array, palette: NitroPaletteData): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((ink, i) => {
    if (ink !== TOWN_MAP_TRANSPARENT_PIXEL) {
      const color = palette[ink]; if (!color) throw new Error("Copied artwork references a missing palette color.");
      rgba.set(color, i * 4);
    }
  });
  return rgba;
}

const colorKey = (c: readonly number[]) => c[0] | c[1] << 8 | c[2] << 16;

/** Rebuild affected cells with private tiles; other uses of a tile remain intact. */
function encodePixels(source: NitroBackgroundImage, pixels: Uint16Array, layer: TownMapLayer): NitroBackgroundImage {
  const original = townMapArtworkPixels(source), image = structuredClone(source), { indexed } = image;
  const bankSize = indexed.bitsPerPixel === 8 ? 256 : 16, bankCount = Math.floor(indexed.palette.length / bankSize);
  const colors = Array.from({ length: bankCount }, (_, bank) => {
    const map = new Map<number, number>();
    for (let ink = 1; ink < bankSize; ink++) {
      const key = colorKey(indexed.palette[bank * bankSize + ink]); if (!map.has(key)) map.set(key, ink);
    }
    return map;
  });
  const references = Array.from(indexed.entries, entry => ({ tile: entry & 1023, flags: entry & 0xfc00 }));
  const registry = new Map<string, { tile: number; flip: number }>();
  function register(tile: Uint8Array, id: number) {
    for (let flip = 0; flip < 4; flip++) {
      const key = Array.from({ length: 64 }, (_, p) => tile[(flip & 2 ? 7 - (p >> 3) : p >> 3) * 8 + (flip & 1 ? 7 - (p & 7) : p & 7)]).join(",");
      if (!registry.has(key)) registry.set(key, { tile: id, flip: flip << 10 });
    }
  }
  indexed.tilePixels.forEach(register);
  for (let cell = 0; cell < 1024; cell++) {
    const x = (cell % 32) * 8, y = (cell >> 5) * 8, inks = new Uint16Array(64);
    let changed = false;
    for (let p = 0; p < 64; p++) {
      const at = (y + (p >> 3)) * 256 + x + (p & 7); inks[p] = pixels[at]; changed ||= pixels[at] !== original[at];
    }
    if (!changed) continue;
    const sourceBanks = [...new Set([...inks].filter(ink => ink !== TOWN_MAP_TRANSPARENT_PIXEL).map(ink => Math.floor(ink / bankSize)))];
    if (sourceBanks.some(bank => bank >= bankCount)) throw new Error("Copied artwork references a missing palette bank.");
    const candidates = [...new Set([...(sourceBanks.length === 1 ? sourceBanks : []), indexed.entries[cell] >>> 12, ...sourceBanks, ...colors.keys()])];
    let tile: Uint8Array | undefined, bank = 0;
    for (const candidate of candidates) {
      const trial = new Uint8Array(64); let valid = true;
      for (let p = 0; p < 64; p++) {
        const ink = inks[p]; if (ink === TOWN_MAP_TRANSPARENT_PIXEL) continue;
        const color = indexed.palette[ink]; if (!color) throw new Error("Copied artwork references a missing palette color.");
        const mapped = Math.floor(ink / bankSize) === candidate ? ink % bankSize : colors[candidate]?.get(colorKey(color));
        if (mapped === undefined || mapped === 0) { valid = false; break; }
        trial[p] = mapped;
      }
      if (valid) { tile = trial; bank = candidate; break; }
    }
    if (!tile) throw new Error("This edit mixes palette banks within a tile. Use tile-aligned placement or image import to remap colors.");
    const key = [...tile].join(","); let match = registry.get(key);
    if (!match) { const id = indexed.tilePixels.length; indexed.tilePixels.push(tile); register(tile, id); match = registry.get(key)!; }
    references[cell] = { tile: match.tile, flags: match.flip | bank << 12 };
  }
  if (indexed.tilePixels.length > layer.maxTiles) {
    // Reclaim unused slots before rejecting an edit at the native tile limit.
    const used = [...new Set(references.map(r => r.tile))].sort((a, b) => a - b);
    if (used.length > layer.maxTiles) throw new Error(`${layer.label} would need ${used.length} tiles; its limit is ${layer.maxTiles}.`);
    const remap = new Map(used.map((id, i) => [id, i]));
    indexed.tilePixels = used.map(id => indexed.tilePixels[id]);
    references.forEach(r => { r.tile = remap.get(r.tile)!; });
  }
  references.forEach((r, i) => { indexed.entries[i] = r.tile | r.flags; });
  return image;
}

/** Graphics and optional area movement publish together, after every layer passes. */
export function placeTownMapArtwork(draft: TownMapDraft, clip: TownMapArtworkClipboard, destination: { x: number; y: number },
  options: { move?: boolean; moveAreas?: boolean; erase?: boolean } = {}): void {
  validateTownMapArtworkRect(clip.source);
  const target = { ...clip.source, ...destination }; validateTownMapArtworkRect(target);
  const graphics = new Map(draft.graphics), dx = destination.x - clip.source.x, dy = destination.y - clip.source.y;
  for (const { layer, pixels: copied } of clip.layers) {
    if (copied.length !== clip.source.width * clip.source.height) throw new Error("Invalid artwork clipboard dimensions.");
    const image = readTownMapLayer(graphics, layer), pixels = townMapArtworkPixels(image);
    if (options.move || options.erase) for (let y = 0; y < clip.source.height; y++)
      pixels.fill(TOWN_MAP_TRANSPARENT_PIXEL, (clip.source.y + y) * 256 + clip.source.x, (clip.source.y + y) * 256 + clip.source.x + clip.source.width);
    if (!options.erase) for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
      const ink = copied[y * target.width + x];
      if (ink !== TOWN_MAP_TRANSPARENT_PIXEL) pixels[(target.y + y) * 256 + target.x + x] = ink;
    }
    writeTownMapLayer(graphics, layer, encodePixels(image, pixels, layer));
  }
  let areas = draft.areas;
  if (options.move && options.moveAreas && !options.erase) {
    areas = structuredClone(areas);
    townMapArtworkAreas(draft.areas, clip.source).forEach(i => moveTownMapArea(areas[i], dx, dy, true));
  }
  draft.graphics = graphics; draft.areas = areas;
}
