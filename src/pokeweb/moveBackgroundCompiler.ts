import { readAscii, readU32, writeU16 } from "../nds/binary";
import { parseNitroBackground, type NitroBackgroundImage } from "./nitroBg";

export const MOVE_BACKGROUND_VIEWPORT_WIDTH = 256;
export const MOVE_BACKGROUND_VIEWPORT_HEIGHT = 192;
export const MOVE_BACKGROUND_MAP_SIZE = 512;
export const MOVE_BACKGROUND_PALETTE_BANKS = 6;

const TILE_SIZE = 8;
const TILES_WIDE = MOVE_BACKGROUND_VIEWPORT_WIDTH / TILE_SIZE;
const TILES_HIGH = MOVE_BACKGROUND_VIEWPORT_HEIGHT / TILE_SIZE;
const MAP_TILES_WIDE = MOVE_BACKGROUND_MAP_SIZE / TILE_SIZE;
const COLORS_PER_BANK = 16;
const OPAQUE_COLORS_PER_BANK = COLORS_PER_BANK - 1;
const TRANSPARENT_COLOR = 0xffff;

export type MoveBackgroundSourceImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type MoveBackgroundFiles = {
  screen: Uint8Array;
  characters: Uint8Array;
  palette: Uint8Array;
};

export type MoveBackgroundImportReport = {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
  uniqueTileCount: number;
  paletteBankCount: number;
  usedPaletteBankCount: number;
};

export type CompiledMoveBackground = {
  files: MoveBackgroundFiles;
  background: NitroBackgroundImage;
  report: MoveBackgroundImportReport;
};

type SourceTile = {
  colors: Uint16Array;
  average: [number, number, number];
  opaqueCount: number;
};

type PaletteColor = { value: number; r: number; g: number; b: number; count: number };
type PaletteBox = { colors: PaletteColor[]; population: number; range: number };

export function createEmptyMoveBackgroundFiles(templates: MoveBackgroundFiles): MoveBackgroundFiles {
  const files = cloneAndValidateTemplates(templates);
  blockData(files.screen, "NRCS", 20).fill(0);
  blockData(files.characters, "RAHC", 32).fill(0);
  blockData(files.palette, "TTLP", 24).fill(0);
  return files;
}

export function compileMoveBackgroundImage(
  backgroundId: number,
  source: MoveBackgroundSourceImage,
  templates: MoveBackgroundFiles,
): CompiledMoveBackground {
  validateSource(source);
  const files = createEmptyMoveBackgroundFiles(templates);
  const fitted = fitCover(source, MOVE_BACKGROUND_VIEWPORT_WIDTH, MOVE_BACKGROUND_VIEWPORT_HEIGHT);
  const sourceTiles = makeSourceTiles(fitted);
  let assignments = clusterTiles(sourceTiles, MOVE_BACKGROUND_PALETTE_BANKS);
  let palettes = buildPalettes(sourceTiles, assignments);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    assignments = assignTilesToPalettes(sourceTiles, palettes);
    palettes = buildPalettes(sourceTiles, assignments);
  }
  assignments = assignTilesToPalettes(sourceTiles, palettes);

  const encoded = encodeTiles(sourceTiles, assignments, palettes);
  writeScreen(files.screen, encoded.entries);
  writeCharacters(files.characters, encoded.tiles);
  writePalette(files.palette, palettes);

  const background = parseNitroBackground(backgroundId, files.screen, files.characters, files.palette, {
    paletteBankOffset: 8,
    transparentIndexZero: true,
  });
  return {
    files,
    background,
    report: {
      sourceWidth: source.width,
      sourceHeight: source.height,
      viewportWidth: MOVE_BACKGROUND_VIEWPORT_WIDTH,
      viewportHeight: MOVE_BACKGROUND_VIEWPORT_HEIGHT,
      mapWidth: MOVE_BACKGROUND_MAP_SIZE,
      mapHeight: MOVE_BACKGROUND_MAP_SIZE,
      uniqueTileCount: encoded.tiles.length,
      paletteBankCount: MOVE_BACKGROUND_PALETTE_BANKS,
      usedPaletteBankCount: new Set(assignments).size,
    },
  };
}

function validateSource(source: MoveBackgroundSourceImage): void {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
    throw new Error("The PNG has invalid dimensions.");
  }
  if (source.pixels.length !== source.width * source.height * 4) {
    throw new Error("The decoded PNG pixel data does not match its dimensions.");
  }
}

function cloneAndValidateTemplates(templates: MoveBackgroundFiles): MoveBackgroundFiles {
  const files = {
    screen: templates.screen.slice(),
    characters: templates.characters.slice(),
    palette: templates.palette.slice(),
  };
  const screenData = blockData(files.screen, "NRCS", 20);
  const characterData = blockData(files.characters, "RAHC", 32);
  const paletteData = blockData(files.palette, "TTLP", 24);
  if (screenData.length < MAP_TILES_WIDE * MAP_TILES_WIDE * 2) throw new Error("The move-background NSCR template is smaller than 512×512.");
  if (characterData.length < 1024 * 32) throw new Error("The move-background NCGR template does not contain 1024 4bpp tiles.");
  if (paletteData.length < MOVE_BACKGROUND_PALETTE_BANKS * COLORS_PER_BANK * 2) throw new Error("The move-background NCLR template does not contain six palette banks.");
  return files;
}

function fitCover(source: MoveBackgroundSourceImage, width: number, height: number): Uint8ClampedArray {
  const scale = Math.max(width / source.width, height / source.height);
  const sampledWidth = width / scale;
  const sampledHeight = height / scale;
  const sourceLeft = (source.width - sampledWidth) / 2;
  const sourceTop = (source.height - sampledHeight) / 2;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = sourceTop + ((y + 0.5) / height) * sampledHeight - 0.5;
    const y0 = clamp(Math.floor(sy), 0, source.height - 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = Math.max(0, sy - Math.floor(sy));
    for (let x = 0; x < width; x += 1) {
      const sx = sourceLeft + ((x + 0.5) / width) * sampledWidth - 0.5;
      const x0 = clamp(Math.floor(sx), 0, source.width - 1);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = Math.max(0, sx - Math.floor(sx));
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = lerp(source.pixels[(y0 * source.width + x0) * 4 + channel] ?? 0, source.pixels[(y0 * source.width + x1) * 4 + channel] ?? 0, fx);
        const bottom = lerp(source.pixels[(y1 * source.width + x0) * 4 + channel] ?? 0, source.pixels[(y1 * source.width + x1) * 4 + channel] ?? 0, fx);
        out[target + channel] = Math.round(lerp(top, bottom, fy));
      }
    }
  }
  return out;
}

function makeSourceTiles(pixels: Uint8ClampedArray): SourceTile[] {
  const tiles: SourceTile[] = [];
  for (let tileY = 0; tileY < TILES_HIGH; tileY += 1) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX += 1) {
      const colors = new Uint16Array(64);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let opaqueCount = 0;
      for (let y = 0; y < TILE_SIZE; y += 1) {
        for (let x = 0; x < TILE_SIZE; x += 1) {
          const pixelOffset = (((tileY * TILE_SIZE + y) * MOVE_BACKGROUND_VIEWPORT_WIDTH) + tileX * TILE_SIZE + x) * 4;
          const tileOffset = y * TILE_SIZE + x;
          if ((pixels[pixelOffset + 3] ?? 0) < 128) {
            colors[tileOffset] = TRANSPARENT_COLOR;
            continue;
          }
          const r = Math.min(31, Math.round((pixels[pixelOffset] ?? 0) / 8));
          const g = Math.min(31, Math.round((pixels[pixelOffset + 1] ?? 0) / 8));
          const b = Math.min(31, Math.round((pixels[pixelOffset + 2] ?? 0) / 8));
          colors[tileOffset] = r | (g << 5) | (b << 10);
          sumR += r;
          sumG += g;
          sumB += b;
          opaqueCount += 1;
        }
      }
      tiles.push({
        colors,
        average: opaqueCount ? [sumR / opaqueCount, sumG / opaqueCount, sumB / opaqueCount] : [0, 0, 0],
        opaqueCount,
      });
    }
  }
  return tiles;
}

function clusterTiles(tiles: SourceTile[], count: number): number[] {
  const opaque = tiles.map((tile, index) => ({ tile, index })).filter(({ tile }) => tile.opaqueCount > 0);
  if (!opaque.length) return tiles.map(() => 0);
  const centers: Array<[number, number, number]> = [averagePoints(opaque.map(({ tile }) => tile.average))];
  while (centers.length < count) {
    const next = opaque.reduce((best, candidate) => {
      const distance = Math.min(...centers.map((center) => pointDistance(candidate.tile.average, center)));
      return distance > best.distance ? { point: candidate.tile.average, distance } : best;
    }, { point: opaque[0]!.tile.average, distance: -1 });
    centers.push([...next.point]);
  }
  const assignments = tiles.map(() => 0);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    tiles.forEach((tile, index) => {
      assignments[index] = tile.opaqueCount ? nearestPoint(tile.average, centers) : 0;
    });
    for (let group = 0; group < count; group += 1) {
      const points = tiles.filter((_tile, index) => assignments[index] === group && tiles[index]!.opaqueCount > 0).map((tile) => tile.average);
      if (points.length) centers[group] = averagePoints(points);
    }
  }
  return assignments;
}

function buildPalettes(tiles: SourceTile[], assignments: number[]): number[][] {
  const global = colorHistogram(tiles);
  return Array.from({ length: MOVE_BACKGROUND_PALETTE_BANKS }, (_unused, group) => {
    const grouped = tiles.filter((_tile, index) => assignments[index] === group);
    return quantizeHistogram(colorHistogram(grouped).size ? colorHistogram(grouped) : global, OPAQUE_COLORS_PER_BANK);
  });
}

function assignTilesToPalettes(tiles: SourceTile[], palettes: number[][]): number[] {
  return tiles.map((tile) => {
    if (!tile.opaqueCount) return 0;
    let bestBank = 0;
    let bestError = Number.POSITIVE_INFINITY;
    for (let bank = 0; bank < palettes.length; bank += 1) {
      const error = tilePaletteError(tile, palettes[bank]!);
      if (error < bestError) {
        bestError = error;
        bestBank = bank;
      }
    }
    return bestBank;
  });
}

function colorHistogram(tiles: SourceTile[]): Map<number, number> {
  const histogram = new Map<number, number>();
  for (const tile of tiles) {
    for (const value of tile.colors) {
      if (value === TRANSPARENT_COLOR) continue;
      histogram.set(value, (histogram.get(value) ?? 0) + 1);
    }
  }
  return histogram;
}

function quantizeHistogram(histogram: Map<number, number>, maxColors: number): number[] {
  if (!histogram.size) return [0];
  const colors = [...histogram].map(([value, count]) => ({
    value,
    r: value & 0x1f,
    g: (value >>> 5) & 0x1f,
    b: (value >>> 10) & 0x1f,
    count,
  }));
  let boxes = [makePaletteBox(colors)];
  while (boxes.length < maxColors) {
    boxes.sort((left, right) => right.range * right.population - left.range * left.population);
    const boxIndex = boxes.findIndex((box) => box.colors.length > 1 && box.range > 0);
    if (boxIndex < 0) break;
    const [box] = boxes.splice(boxIndex, 1);
    const [left, right] = splitPaletteBox(box!);
    boxes.push(left, right);
  }
  const result: number[] = [];
  for (const box of boxes.sort((left, right) => averagePaletteBox(left) - averagePaletteBox(right))) {
    const value = averagePaletteBox(box);
    if (!result.includes(value)) result.push(value);
  }
  for (const color of colors.sort((left, right) => right.count - left.count)) {
    if (result.length >= maxColors) break;
    if (!result.includes(color.value)) result.push(color.value);
  }
  return result.slice(0, maxColors);
}

function makePaletteBox(colors: PaletteColor[]): PaletteBox {
  const population = colors.reduce((sum, color) => sum + color.count, 0);
  const range = Math.max(channelRange(colors, "r"), channelRange(colors, "g"), channelRange(colors, "b"));
  return { colors, population, range };
}

function splitPaletteBox(box: PaletteBox): [PaletteBox, PaletteBox] {
  const channel = (["r", "g", "b"] as const).reduce((best, next) => channelRange(box.colors, next) > channelRange(box.colors, best) ? next : best, "r");
  const sorted = [...box.colors].sort((left, right) => left[channel] - right[channel] || left.value - right.value);
  const midpoint = box.population / 2;
  let population = 0;
  let splitAt = 1;
  for (; splitAt < sorted.length; splitAt += 1) {
    population += sorted[splitAt - 1]!.count;
    if (population >= midpoint) break;
  }
  return [makePaletteBox(sorted.slice(0, splitAt)), makePaletteBox(sorted.slice(splitAt))];
}

function channelRange(colors: PaletteColor[], channel: "r" | "g" | "b"): number {
  let min = 31;
  let max = 0;
  for (const color of colors) {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  }
  return max - min;
}

function averagePaletteBox(box: PaletteBox): number {
  const sum = box.colors.reduce((totals, color) => ({
    r: totals.r + color.r * color.count,
    g: totals.g + color.g * color.count,
    b: totals.b + color.b * color.count,
  }), { r: 0, g: 0, b: 0 });
  const population = Math.max(1, box.population);
  const r = clamp(Math.round(sum.r / population), 0, 31);
  const g = clamp(Math.round(sum.g / population), 0, 31);
  const b = clamp(Math.round(sum.b / population), 0, 31);
  return r | (g << 5) | (b << 10);
}

function tilePaletteError(tile: SourceTile, palette: number[]): number {
  let error = 0;
  for (const color of tile.colors) {
    if (color === TRANSPARENT_COLOR) continue;
    error += nearestPaletteColor(color, palette).distance;
  }
  return error;
}

function nearestPaletteColor(value: number, palette: number[]): { index: number; distance: number } {
  const r = value & 0x1f;
  const g = (value >>> 5) & 0x1f;
  const b = (value >>> 10) & 0x1f;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate, index) => {
    const dr = r - (candidate & 0x1f);
    const dg = g - ((candidate >>> 5) & 0x1f);
    const db = b - ((candidate >>> 10) & 0x1f);
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return { index: bestIndex, distance: bestDistance };
}

function encodeTiles(tiles: SourceTile[], assignments: number[], palettes: number[][]): { entries: Uint16Array; tiles: Uint8Array[] } {
  const viewportEntries = new Uint16Array(tiles.length);
  const transparentTile = new Uint8Array(64);
  const uniqueTiles: Uint8Array[] = [transparentTile];
  const lookup = new Map<string, { index: number; flipX: boolean; flipY: boolean }>();
  registerTileFlips(lookup, transparentTile, 0);
  tiles.forEach((tile, sourceIndex) => {
    const bank = assignments[sourceIndex] ?? 0;
    const palette = palettes[bank] ?? palettes[0] ?? [0];
    const indexed = Uint8Array.from(tile.colors, (color) => color === TRANSPARENT_COLOR ? 0 : nearestPaletteColor(color, palette).index + 1);
    let match = lookup.get(tileKey(indexed));
    if (!match) {
      const index = uniqueTiles.length;
      if (index >= 1024) throw new Error("The converted PNG needs more than the DS limit of 1024 unique tiles.");
      uniqueTiles.push(indexed);
      registerTileFlips(lookup, indexed, index);
      match = { index, flipX: false, flipY: false };
    }
    viewportEntries[sourceIndex] = match.index
      | (match.flipX ? 0x0400 : 0)
      | (match.flipY ? 0x0800 : 0)
      | ((bank + 8) << 12);
  });

  const entries = new Uint16Array(MAP_TILES_WIDE * MAP_TILES_WIDE);
  entries.fill(0x8000);
  for (let tileY = 0; tileY < TILES_HIGH; tileY += 1) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX += 1) {
      entries[tileY * MAP_TILES_WIDE + tileX] = viewportEntries[tileY * TILES_WIDE + tileX] ?? 0x8000;
    }
  }
  return { entries, tiles: uniqueTiles };
}

function registerTileFlips(lookup: Map<string, { index: number; flipX: boolean; flipY: boolean }>, tile: Uint8Array, index: number): void {
  for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const transformed = transformTile(tile, flipX, flipY);
    if (!lookup.has(tileKey(transformed))) lookup.set(tileKey(transformed), { index, flipX, flipY });
  }
}

function transformTile(tile: Uint8Array, flipX: boolean, flipY: boolean): Uint8Array {
  const out = new Uint8Array(64);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const sourceX = flipX ? TILE_SIZE - 1 - x : x;
      const sourceY = flipY ? TILE_SIZE - 1 - y : y;
      out[y * TILE_SIZE + x] = tile[sourceY * TILE_SIZE + sourceX] ?? 0;
    }
  }
  return out;
}

function tileKey(tile: Uint8Array): string {
  return Array.from(tile, (value) => String.fromCharCode(value)).join("");
}

function writeScreen(screen: Uint8Array, logicalEntries: Uint16Array): void {
  const raw = blockData(screen, "NRCS", 20);
  raw.fill(0);
  for (let tileY = 0; tileY < MAP_TILES_WIDE; tileY += 1) {
    for (let tileX = 0; tileX < MAP_TILES_WIDE; tileX += 1) {
      const blockX = Math.floor(tileX / 32);
      const blockY = Math.floor(tileY / 32);
      const localX = tileX % 32;
      const localY = tileY % 32;
      const rawIndex = (blockY * 2 + blockX) * 1024 + localY * 32 + localX;
      writeU16(raw, rawIndex * 2, logicalEntries[tileY * MAP_TILES_WIDE + tileX] ?? 0);
    }
  }
}

function writeCharacters(characters: Uint8Array, tiles: Uint8Array[]): void {
  const raw = blockData(characters, "RAHC", 32);
  raw.fill(0);
  tiles.forEach((tile, tileIndex) => {
    const offset = tileIndex * 32;
    for (let pixel = 0; pixel < 64; pixel += 2) {
      raw[offset + pixel / 2] = (tile[pixel] ?? 0) | ((tile[pixel + 1] ?? 0) << 4);
    }
  });
}

function writePalette(paletteFile: Uint8Array, palettes: number[][]): void {
  const raw = blockData(paletteFile, "TTLP", 24);
  raw.fill(0);
  palettes.forEach((palette, bank) => {
    palette.slice(0, OPAQUE_COLORS_PER_BANK).forEach((color, index) => writeU16(raw, (bank * COLORS_PER_BANK + index + 1) * 2, color));
  });
}

function blockData(file: Uint8Array, stamp: string, headerSize: number): Uint8Array {
  const blockOffset = findBlock(file, stamp);
  if (blockOffset < 0) throw new Error(`The move-background template is missing its ${stamp} block.`);
  const blockSize = readU32(file, blockOffset + 4);
  const dataOffset = blockOffset + headerSize;
  return file.subarray(dataOffset, Math.min(file.length, blockOffset + blockSize));
}

function findBlock(bytes: Uint8Array, stamp: string): number {
  for (let offset = 16; offset + 8 <= bytes.length; ) {
    if (readAscii(bytes, offset, 4) === stamp) return offset;
    const size = readU32(bytes, offset + 4);
    if (size < 8) break;
    offset += size;
  }
  return -1;
}

function averagePoints(points: Array<[number, number, number]>): [number, number, number] {
  const sum = points.reduce((total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]] as [number, number, number], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function nearestPoint(point: [number, number, number], centers: Array<[number, number, number]>): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const distance = pointDistance(point, center);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function pointDistance(left: [number, number, number], right: [number, number, number]): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
