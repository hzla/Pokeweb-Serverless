import {
  analyzePalette,
  encodePng,
  palettePng,
  quantizeFrames,
  roundTripBgr555Color,
  type AnimationAnalysisFrame,
  type Box,
  type RgbColor,
} from "./pokemonAnimationAnalysis";
import type { RgbaImageData } from "./pokemonSpriteModel";

export type Gen6SpriteVariant = "front" | "back" | "front-shiny" | "back-shiny";
export type Gen6SpriteSide = "front" | "back";

export type Gen6CsvAsset = {
  csvRow: number;
  spriteId: number;
  speciesId: number;
  name: string;
  slug: string;
  urls: Partial<Record<Gen6SpriteVariant, string>>;
};

export type Gen6CsvParseOptions = {
  startSpriteId?: number;
  limit?: number;
};

export type Gen6OffsetMap = Record<string, Partial<Record<Gen6SpriteVariant | Gen6SpriteSide, { x?: number; y?: number }>>>;

export type PreparedStaticSprites = {
  normalPalette: RgbColor[];
  shinyPalette?: RgbColor[];
  images: Partial<Record<Gen6SpriteSide, RgbaImageData>>;
  warnings: string[];
};

export type PlaceholderRigBuild = {
  rig: RgbaImageData;
  part: {
    name: string;
    cellX: number;
    cellY: number;
    width: number;
    height: number;
    spriteX: number;
    spriteY: number;
    pivot: { x: number; y: number };
    z: number;
    frames: Array<{ duration: number; cellIndex: number; x: number; y: number; rotation: number; xScale: number; yScale: number }>;
  };
};

const CSV_VARIANTS: Array<{ index: number; variant: Gen6SpriteVariant }> = [
  { index: 2, variant: "front" },
  { index: 3, variant: "back" },
  { index: 4, variant: "front-shiny" },
  { index: 5, variant: "back-shiny" },
];

const TRANSPARENT_COLOR: RgbColor = { r: 255, g: 0, b: 255 };
const EMPTY_COLOR: RgbColor = { r: 0, g: 0, b: 0 };
const TRANSPARENT_ALPHA_THRESHOLD = 128;
const MAX_OPAQUE_COLORS = 15;

export function parseGen6SpriteCsv(csvText: string, options: Gen6CsvParseOptions = {}): Gen6CsvAsset[] {
  const rows = parseCsv(csvText);
  const assets: Gen6CsvAsset[] = [];
  const usedSlugs = new Set<string>();
  let afterGen6Header = false;
  let nextSpriteId = options.startSpriteId ?? 1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (!afterGen6Header) {
      afterGen6Header = row.some((cell) => cell.trim().toLowerCase() === "gen 6 pokemon");
      continue;
    }

    const speciesText = row[0]?.trim() ?? "";
    if (!/^\d+$/u.test(speciesText)) continue;
    const urls: Partial<Record<Gen6SpriteVariant, string>> = {};
    for (const { index, variant } of CSV_VARIANTS) {
      const value = row[index]?.trim() ?? "";
      if (isDownloadableUrl(value)) urls[variant] = value;
    }
    if (Object.keys(urls).length === 0) continue;

    const speciesId = Number(speciesText);
    const name = row[1]?.trim() || `Pokemon ${speciesId}`;
    const baseSlug = slugifyPokemonName(name);
    const slug = uniqueSlug(baseSlug, usedSlugs, speciesId, nextSpriteId);
    usedSlugs.add(slug);
    assets.push({
      csvRow: rowIndex + 1,
      spriteId: nextSpriteId,
      speciesId,
      name,
      slug,
      urls,
    });
    nextSpriteId += 1;
    if (options.limit !== undefined && assets.length >= options.limit) break;
  }

  return assets;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

export function isDownloadableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function slugifyPokemonName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "pokemon"
  );
}

export function variantFileName(slug: string, variant: Gen6SpriteVariant): string {
  return `${slug}-${variant}.gif`;
}

export function offsetForVariant(offsets: Gen6OffsetMap, slug: string, variant: Gen6SpriteVariant): { x?: number; y?: number } {
  const side = sideForVariant(variant);
  return offsets[slug]?.[variant] ?? offsets[slug]?.[side] ?? {};
}

export function sideForVariant(variant: Gen6SpriteVariant): Gen6SpriteSide {
  return variant.startsWith("back") ? "back" : "front";
}

export function isShinyVariant(variant: Gen6SpriteVariant): boolean {
  return variant.endsWith("shiny");
}

export function prepareStaticSprites(input: {
  front?: AnimationAnalysisFrame;
  back?: AnimationAnalysisFrame;
  frontShiny?: AnimationAnalysisFrame;
  backShiny?: AnimationAnalysisFrame;
}): PreparedStaticSprites {
  const normalFrames = [input.front, input.back].filter((frame): frame is AnimationAnalysisFrame => frame !== undefined);
  if (normalFrames.length === 0) throw new Error("At least one normal front/back frame is required");

  const normal = preparePaletteAndFrames(normalFrames);
  const images: Partial<Record<Gen6SpriteSide, RgbaImageData>> = {};
  let index = 0;
  if (input.front) images.front = frameToImage(normal.frames[index++]!);
  if (input.back) images.back = frameToImage(normal.frames[index++]!);

  const warnings = [...normal.warnings];
  const shinyPalette = deriveShinyPalette({
    normalPalette: normal.palette,
    normalFront: images.front,
    normalBack: images.back,
    shinyFront: input.frontShiny,
    shinyBack: input.backShiny,
    warnings,
  });

  return {
    normalPalette: normal.palette,
    shinyPalette,
    images,
    warnings,
  };
}

export function paletteToPngBytes(palette: RgbColor[]): Uint8Array {
  return palettePng(palette.slice(1));
}

export function pngPaletteToColors(image: AnimationAnalysisFrame): RgbColor[] {
  if (image.width < 16 || image.height < 1) throw new Error("Palette PNG must be at least 16 x 1");
  return Array.from({ length: 16 }, (_, index) => {
    const offset = index * 4;
    return {
      r: image.pixels[offset] ?? 0,
      g: image.pixels[offset + 1] ?? 0,
      b: image.pixels[offset + 2] ?? 0,
    };
  });
}

export function staticSpritePngBytes(image: RgbaImageData): Uint8Array {
  return encodePng(image);
}

export function buildPlaceholderRig(image: RgbaImageData): PlaceholderRigBuild {
  if (image.width !== 96 || image.height !== 96) throw new Error("Placeholder rig source image must be 96 x 96");
  const rig: RgbaImageData = { width: 256, height: 128, pixels: new Uint8ClampedArray(256 * 128 * 4) };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = (y * rig.width + x) * 4;
      rig.pixels.set(image.pixels.subarray(source, source + 4), target);
    }
  }
  return {
    rig,
    part: {
      name: "full-sprite",
      cellX: 0,
      cellY: 0,
      width: 96,
      height: 96,
      spriteX: -48,
      spriteY: 96,
      pivot: { x: 48, y: 48 },
      z: 0,
      frames: [
        { duration: 8, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
        { duration: 8, cellIndex: 0, x: 0, y: -2, rotation: 0, xScale: 1, yScale: 1 },
        { duration: 8, cellIndex: 0, x: 0, y: 0, rotation: 0, xScale: 1, yScale: 1 },
        { duration: 8, cellIndex: 0, x: 0, y: 2, rotation: 0, xScale: 1, yScale: 1 },
      ],
    },
  };
}

function preparePaletteAndFrames(frames: AnimationAnalysisFrame[]): { palette: RgbColor[]; frames: AnimationAnalysisFrame[]; warnings: string[] } {
  const report = analyzePalette(frames);
  const warnings = [...report.warnings];
  const sourceFrames = report.opaqueColorCount > MAX_OPAQUE_COLORS ? quantizeFrames(frames, MAX_OPAQUE_COLORS).frames : frames;
  if (report.opaqueColorCount > MAX_OPAQUE_COLORS) warnings.push("Static sprite colors were quantized for the 15 opaque color Gen 5 limit");

  const opaqueColors = firstSeenOpaqueColors(sourceFrames).map(roundTripBgr555Color);
  const palette = normalizePalette([TRANSPARENT_COLOR, ...dedupeColors(opaqueColors)]);
  const remappedFrames = sourceFrames.map((frame) => remapFrameToPalette(frame, palette));
  return { palette, frames: remappedFrames, warnings };
}

function deriveShinyPalette(input: {
  normalPalette: RgbColor[];
  normalFront?: RgbaImageData;
  normalBack?: RgbaImageData;
  shinyFront?: AnimationAnalysisFrame;
  shinyBack?: AnimationAnalysisFrame;
  warnings: string[];
}): RgbColor[] | undefined {
  if (!input.shinyFront && !input.shinyBack) return undefined;

  const buckets = Array.from({ length: 16 }, () => new Map<string, { color: RgbColor; count: number }>());
  collectShinyPaletteVotes(input.normalPalette, input.normalFront, input.shinyFront, buckets, input.warnings, "front");
  collectShinyPaletteVotes(input.normalPalette, input.normalBack, input.shinyBack, buckets, input.warnings, "back");

  const shiny = input.normalPalette.map((color, index) => {
    if (index === 0) return color;
    const bucket = buckets[index]!;
    let best: { color: RgbColor; count: number } | undefined;
    for (const value of bucket.values()) {
      if (!best || value.count > best.count) best = value;
    }
    return best ? roundTripBgr555Color(best.color) : color;
  });
  return normalizePalette(shiny);
}

function collectShinyPaletteVotes(
  normalPalette: RgbColor[],
  normalImage: RgbaImageData | undefined,
  shinyFrame: AnimationAnalysisFrame | undefined,
  buckets: Array<Map<string, { color: RgbColor; count: number }>>,
  warnings: string[],
  side: Gen6SpriteSide,
): void {
  if (!normalImage || !shinyFrame) {
    if (normalImage || shinyFrame) warnings.push(`Missing ${side} ${normalImage ? "shiny" : "normal"} frame for shiny palette pairing`);
    return;
  }
  if (normalImage.width !== shinyFrame.width || normalImage.height !== shinyFrame.height) {
    warnings.push(`Shiny ${side} frame size does not match normal frame; skipped shiny colors for that side`);
    return;
  }

  let alphaMismatchCount = 0;
  for (let pixel = 0; pixel < normalImage.width * normalImage.height; pixel += 1) {
    const offset = pixel * 4;
    const normalAlpha = normalImage.pixels[offset + 3] ?? 0;
    const shinyAlpha = shinyFrame.pixels[offset + 3] ?? 0;
    if (normalAlpha < TRANSPARENT_ALPHA_THRESHOLD && shinyAlpha < TRANSPARENT_ALPHA_THRESHOLD) continue;
    if (normalAlpha < TRANSPARENT_ALPHA_THRESHOLD || shinyAlpha < TRANSPARENT_ALPHA_THRESHOLD) {
      alphaMismatchCount += 1;
      continue;
    }

    const paletteIndex = exactPaletteIndex(normalPalette, {
      r: normalImage.pixels[offset] ?? 0,
      g: normalImage.pixels[offset + 1] ?? 0,
      b: normalImage.pixels[offset + 2] ?? 0,
    });
    if (paletteIndex <= 0) continue;
    const shinyColor = roundTripBgr555Color({
      r: shinyFrame.pixels[offset] ?? 0,
      g: shinyFrame.pixels[offset + 1] ?? 0,
      b: shinyFrame.pixels[offset + 2] ?? 0,
    });
    const key = colorKey(shinyColor);
    const bucket = buckets[paletteIndex]!;
    const current = bucket.get(key);
    bucket.set(key, { color: shinyColor, count: (current?.count ?? 0) + 1 });
  }

  if (alphaMismatchCount > 0) warnings.push(`Shiny ${side} frame has ${alphaMismatchCount} alpha mismatch pixel(s) against normal frame`);
}

function remapFrameToPalette(frame: AnimationAnalysisFrame, palette: RgbColor[]): AnimationAnalysisFrame {
  const pixels = new Uint8ClampedArray(frame.pixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
      continue;
    }
    const color = nearestPaletteColor({ r: pixels[offset] ?? 0, g: pixels[offset + 1] ?? 0, b: pixels[offset + 2] ?? 0 }, palette.slice(1));
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = 255;
  }
  return { ...frame, pixels };
}

function firstSeenOpaqueColors(frames: AnimationAnalysisFrame[]): RgbColor[] {
  const out: RgbColor[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      if ((frame.pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) continue;
      const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
      const key = colorKey(color);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(color);
    }
  }
  return out;
}

function normalizePalette(colors: RgbColor[]): RgbColor[] {
  const out = colors.slice(0, 16);
  while (out.length < 16) out.push(EMPTY_COLOR);
  return out;
}

function dedupeColors(colors: RgbColor[]): RgbColor[] {
  const seen = new Set<string>();
  const out: RgbColor[] = [];
  for (const color of colors) {
    const key = colorKey(color);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out;
}

function exactPaletteIndex(palette: RgbColor[], color: RgbColor): number {
  return palette.findIndex((entry) => entry.r === color.r && entry.g === color.g && entry.b === color.b);
}

function nearestPaletteColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  let best = palette[0] ?? EMPTY_COLOR;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const distance = (color.r - candidate.r) ** 2 + (color.g - candidate.g) ** 2 + (color.b - candidate.b) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function frameToImage(frame: AnimationAnalysisFrame): RgbaImageData {
  return { width: frame.width, height: frame.height, pixels: frame.pixels };
}

function colorKey(color: RgbColor): string {
  return `${color.r},${color.g},${color.b}`;
}

function uniqueSlug(baseSlug: string, usedSlugs: Set<string>, speciesId: number, spriteId: number): string {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  const speciesSlug = `${baseSlug}-${speciesId}`;
  if (!usedSlugs.has(speciesSlug)) return speciesSlug;
  return `${speciesSlug}-${spriteId}`;
}

export function boxToJson(box: Box | undefined): Box | undefined {
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : undefined;
}
