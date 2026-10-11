import {
  analyzePalette,
  decodeGifFrames,
  type AnimationAnalysisFrame,
  type Box,
  type RgbColor,
} from "./gifAnimationFrames";

export type PwanCompileResult = {
  pwanBytes: Uint8Array;
  visibleHeight: number;
  frameCount: number;
  uniqueFrameCount: number;
  timelineCount: number;
  totalTicks: number;
  paletteBgr555: Uint16Array;
  warnings: string[];
  conversion: {
    colorPreset: PwanColorPreset;
    sourceColorCount: number;
    visibleColorCount: number;
    paletteStrategy: PwanPaletteFrames["strategy"];
  };
  /** Unadjusted, pixel-resized source frames. Only returned for import previews. */
  previewFrames?: AnimationAnalysisFrame[];
};

export type PwanColorPreset = "none" | "gen5";
export type PwanCompileOptions = {
  colorPreset?: PwanColorPreset;
  includePreview?: boolean;
};

export type PwanPaletteFrames = {
  frames: AnimationAnalysisFrame[];
  palette: RgbColor[];
  quantized: boolean;
  strategy: "exact" | "closest-merge" | "weighted-median-cut";
  warnings: string[];
};

export type PwanHeader = {
  magic: string;
  version: number;
  width: number;
  height: number;
  bpp: number;
  frameCount: number;
  timelineCount: number;
  totalTicks: number;
  frameBytes: number;
  paletteColors: number;
  paletteOffset: number;
  timelineOffset: number;
  frameOffset: number;
};

export type PwanTimelineEntry = { frameIndex: number; ticks: number };
export type PwanFrameScaleMode = "nearest" | "outlineFill";
export type PwanFrameScaleOptions = {
  mode?: PwanFrameScaleMode;
  outlineThreshold?: number;
};

export const PWAN_WIDTH = 96;
export const PWAN_HEIGHT = 96;
export const PWAN_FRAME_BYTES = 0x1200;
export const PWAN_PALETTE_COLORS = 16;
export const PWAN_MAX_TIMELINE = 192;

const PWAN_HEADER_BYTES = 0x30;
const TRANSPARENT_ALPHA_THRESHOLD = 128;
const CLOSEST_MERGE_COLOR_LIMIT = 64;
const SEGMENTS = [
  { x: 0, y: 0, width: 64, height: 64 },
  { x: 64, y: 0, width: 32, height: 64 },
  { x: 0, y: 64, width: 64, height: 32 },
  { x: 64, y: 64, width: 32, height: 32 },
] as const;

export function compileGifToPwan(bytes: Uint8Array, options: PwanCompileOptions = {}): PwanCompileResult {
  const sourceFrames = decodeGifFrames(bytes);
  return compilePwanAnimationFrames(sourceFrames, options);
}

/** Shared by the GIF importer and deterministic conversion tests. Never mutates source frames. */
export function compilePwanAnimationFrames(sourceFrames: AnimationAnalysisFrame[], options: PwanCompileOptions = {}): PwanCompileResult {
  const colorPreset = options.colorPreset ?? "none";
  if (colorPreset !== "none" && colorPreset !== "gen5") throw new Error("Unsupported GIF color preset");
  if (sourceFrames.length === 0) throw new Error("GIF contains no frames");

  const normalized = normalizePwanSourceFrames(sourceFrames);
  const adjusted = applyPwanColorPreset(normalized, colorPreset);
  const paletteFrames = preparePwanPaletteFrames(adjusted);
  const warnings = [...paletteFrames.warnings];
  if (sourceFrames[0] && (sourceFrames[0].width > PWAN_WIDTH || sourceFrames[0].height > PWAN_HEIGHT)) {
    warnings.push(`Source GIF is ${sourceFrames[0].width}x${sourceFrames[0].height}; resized into 96x96 using nearest-neighbor sampling (no blended pixels)`);
  }
  if (colorPreset === "gen5") warnings.push("Gen 5-inspired color preset applied: +15% saturation and +10% contrast; review the preview for clipped highlights or lost shades");
  const palette = normalizePalette(paletteFrames.palette);
  const compiledFrames = paletteFrames.frames.map((frame) => compilePwanFrame(frame, palette));
  const uniqueFrames: Uint8Array[] = [];
  const frameIndexByHash = new Map<string, number>();
  const timeline: PwanTimelineEntry[] = [];

  compiledFrames.forEach((frame, index) => {
    const hash = hashBytes(frame);
    let frameIndex = frameIndexByHash.get(hash);
    if (frameIndex === undefined) {
      frameIndex = uniqueFrames.length;
      frameIndexByHash.set(hash, frameIndex);
      uniqueFrames.push(frame);
    }
    const ticks = msToTicks(normalized[index]?.delayMs ?? 100);
    const previous = timeline.at(-1);
    // Long GIFs often encode held poses as many identical frames. Consolidate
    // only exact consecutive output frames, without dropping poses or time.
    if (sourceFrames.length > PWAN_MAX_TIMELINE && previous?.frameIndex === frameIndex && previous.ticks + ticks <= 0xffff) previous.ticks += ticks;
    else timeline.push({ frameIndex, ticks });
  });

  if (timeline.length > PWAN_MAX_TIMELINE) throw new Error(`PWAN timeline has ${timeline.length} entries; maximum is ${PWAN_MAX_TIMELINE}`);
  if (timeline.length < sourceFrames.length) warnings.push(`Consecutive identical output frames merged losslessly: ${sourceFrames.length} source frames to ${timeline.length} timeline steps; duration unchanged`);
  const totalTicks = timeline.reduce((sum, entry) => sum + entry.ticks, 0);
  const paletteBgr555 = Uint16Array.from(palette.map(writeBgr555));
  const pwanBytes = encodePwan({ paletteBgr555, timeline, uniqueFrames, totalTicks });
  if (pwanBytes.length > 1024 * 1024) warnings.push(`PWAN asset is ${(pwanBytes.length / 1024 / 1024).toFixed(1)} MiB; large assets may slow ROM export and runtime loading`);

  return {
    pwanBytes,
    visibleHeight: pwanVisibleHeightFromFrames(uniqueFrames),
    frameCount: sourceFrames.length,
    uniqueFrameCount: uniqueFrames.length,
    timelineCount: timeline.length,
    totalTicks,
    paletteBgr555,
    warnings,
    conversion: {
      colorPreset,
      sourceColorCount: analyzePalette(normalized).opaqueColorCount,
      visibleColorCount: paletteFrames.palette.length,
      paletteStrategy: paletteFrames.strategy,
    },
    ...(options.includePreview ? { previewFrames: normalized } : {}),
  };
}

export function preparePwanPaletteFrames(frames: AnimationAnalysisFrame[]): PwanPaletteFrames {
  return prepareRgb555PaletteFrames(frames, PWAN_PALETTE_COLORS - 1);
}

/** Shared color selection, not a PWAN format extension. A3I5 previews use 32 visible slots. */
export function prepareRgb555PaletteFrames(frames: AnimationAnalysisFrame[], maxColors: number): PwanPaletteFrames {
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("Invalid RGB555 palette budget");
  // Select in the actual RGB555 color space: near-identical GIF colors must not
  // consume separate slots only to collapse to the same hardware color later.
  const hardwareFrames = mapOpaqueFrameColors(frames, (color) => ({
    r: (color.r >>> 3) << 3, g: (color.g >>> 3) << 3, b: (color.b >>> 3) << 3,
  }));
  const paletteReport = analyzePalette(hardwareFrames);
  if (paletteReport.opaqueColorCount <= maxColors) {
    return {
      frames: hardwareFrames,
      palette: paletteReport.colors,
      quantized: false,
      strategy: "exact",
      warnings: maxColors === 15 ? [...paletteReport.warnings] : paletteReport.warnings.filter(w => !w.startsWith("Uses ")),
    };
  }

  const reduced = reducePaletteColors(hardwareFrames, maxColors);
  const description = maxColors === 15 ? "PWAN's 15-color visible palette" : `the ${maxColors}-color visible palette`;
  return {
    frames: reduced.frames,
    palette: reduced.palette,
    quantized: true,
    strategy: reduced.strategy,
    warnings: [
      ...(maxColors === 15 ? paletteReport.warnings : paletteReport.warnings.filter(w => !w.startsWith("Uses "))),
      reduced.strategy === "closest-merge"
        ? `Opaque colors were reduced by merging the least-visible closest color pairs to fit ${description}`
        : `Opaque colors were reduced with weighted median-cut source-color selection to fit ${description}`,
    ],
  };
}

type CountedColor = RgbColor & {
  count: number;
  key: string;
  protected?: boolean;
};

export function applyPwanColorPreset(frames: AnimationAnalysisFrame[], preset: PwanColorPreset): AnimationAnalysisFrame[] {
  if (preset === "none") return frames;
  if (preset !== "gen5") throw new Error("Unsupported GIF color preset");
  return mapOpaqueFrameColors(frames, (color) => {
    const luma = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
    const adjust = (value: number) => clampInt((luma + (value - luma) * 1.15 - 128) * 1.10 + 128, 0, 255);
    return { r: adjust(color.r), g: adjust(color.g), b: adjust(color.b) };
  });
}

function mapOpaqueFrameColors(frames: AnimationAnalysisFrame[], map: (color: RgbColor) => RgbColor): AnimationAnalysisFrame[] {
  const cache = new Map<string, RgbColor>();
  return frames.map((frame) => {
    const pixels = new Uint8ClampedArray(frame.pixels);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) {
        pixels.fill(0, offset, offset + 4);
        continue;
      }
      const color = { r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]! };
      const key = colorKey(color);
      let mapped = cache.get(key);
      if (!mapped) { mapped = map(color); cache.set(key, mapped); }
      pixels.set([mapped.r, mapped.g, mapped.b, 255], offset);
    }
    return { ...frame, pixels };
  });
}

function reducePaletteColors(
  frames: AnimationAnalysisFrame[],
  maxColors: number,
): { frames: AnimationAnalysisFrame[]; palette: RgbColor[]; strategy: "closest-merge" | "weighted-median-cut" } {
  const colors = countOpaqueColors(frames);
  // Preserve the darkest linework and brightest highlight. Frequency weighting
  // is softened so small eyes/accents aren't erased by a large flat body color.
  const byLuma = [...colors].sort((a, b) => colorLuma(a) - colorLuma(b) || compareRgb(a, b));
  byLuma[0]!.protected = true;
  byLuma[byLuma.length - 1]!.protected = true;
  const strategy = colors.length <= CLOSEST_MERGE_COLOR_LIMIT ? "closest-merge" : "weighted-median-cut";
  const protectedColors = colors.filter((color) => color.protected);
  const palette = strategy === "closest-merge"
    ? reduceColorsByClosestMerges(colors, maxColors)
    : [...protectedColors, ...weightedMedianCutPalette(colors.filter((color) => !color.protected), maxColors - protectedColors.length)].map(({ r, g, b }) => ({ r, g, b })).sort(compareRgb);
  return {
    frames: remapFramesToPalette(frames, palette),
    palette,
    strategy,
  };
}

function weightedMedianCutPalette(colors: CountedColor[], maxColors: number): RgbColor[] {
  if (colors.length === 0) return [];
  const buckets: CountedColor[][] = [[...colors]];
  while (buckets.length < maxColors) {
    let splitIndex = -1;
    let splitScore = -1;
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]!;
      if (bucket.length <= 1) continue;
      const score = bucketColorRange(bucket) * bucket.reduce((sum, color) => sum + color.count, 0);
      if (score > splitScore) {
        splitIndex = index;
        splitScore = score;
      }
    }
    if (splitIndex < 0) break;
    const bucket = buckets[splitIndex]!;
    const channel = widestCountedColorChannel(bucket);
    const sorted = [...bucket].sort((left, right) => left[channel] - right[channel] || compareRgb(left, right));
    const halfWeight = sorted.reduce((sum, color) => sum + color.count, 0) / 2;
    let weight = 0;
    let cut = 1;
    for (; cut < sorted.length; cut += 1) {
      weight += sorted[cut - 1]!.count;
      if (weight >= halfWeight) break;
    }
    cut = Math.max(1, Math.min(sorted.length - 1, cut));
    buckets.splice(splitIndex, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  // Choose an existing color nearest each bucket's centroid rather than inventing
  // an averaged shade. This keeps source ramps and avoids another RGB555 collapse.
  return buckets.map((bucket) => nearestColor(weightedAverageColor(bucket), bucket)).sort(compareRgb);
}

function bucketColorRange(colors: CountedColor[]): number {
  return Math.max(countedChannelRange(colors, "r"), countedChannelRange(colors, "g"), countedChannelRange(colors, "b"));
}

function widestCountedColorChannel(colors: CountedColor[]): "r" | "g" | "b" {
  const ranges = {
    r: countedChannelRange(colors, "r"),
    g: countedChannelRange(colors, "g"),
    b: countedChannelRange(colors, "b"),
  };
  return ranges.g > ranges.r && ranges.g >= ranges.b ? "g" : ranges.b > ranges.r && ranges.b > ranges.g ? "b" : "r";
}

function countedChannelRange(colors: CountedColor[], channel: "r" | "g" | "b"): number {
  let min = 255;
  let max = 0;
  for (const color of colors) {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  }
  return max - min;
}

function weightedAverageColor(colors: CountedColor[]): RgbColor {
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of colors) {
    weight += color.count;
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
  }
  return {
    r: Math.round(r / Math.max(1, weight)),
    g: Math.round(g / Math.max(1, weight)),
    b: Math.round(b / Math.max(1, weight)),
  };
}

function reduceColorsByClosestMerges(colors: CountedColor[], maxColors: number): RgbColor[] {
  const clusters = colors.map((color) => ({ ...color }));
  while (clusters.length > maxColors) {
    const pair = closestMergePair(clusters);
    if (!pair) break;
    const first = clusters[pair.first]!;
    const second = clusters[pair.second]!;
    const keep = first.protected ? first : second.protected ? second : first.count >= second.count ? first : second;
    const drop = keep === first ? second : first;
    keep.count += drop.count;
    clusters.splice(clusters.indexOf(drop), 1);
  }
  return clusters.map(({ r, g, b }) => ({ r, g, b })).sort(compareRgb);
}

function closestMergePair(colors: CountedColor[]): { first: number; second: number } | undefined {
  if (colors.length < 2) return undefined;
  let best = { first: 0, second: 1, score: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };
  for (let first = 0; first < colors.length; first += 1) {
    for (let second = first + 1; second < colors.length; second += 1) {
      const a = colors[first]!;
      const b = colors[second]!;
      if (a.protected && b.protected) continue;
      const distance = colorDistance(a, b);
      const score = distance * (a.protected ? b.count : b.protected ? a.count : Math.min(a.count, b.count));
      if (score < best.score || (score === best.score && distance < best.distance)) best = { first, second, score, distance };
    }
  }
  return best;
}

function countOpaqueColors(frames: AnimationAnalysisFrame[]): CountedColor[] {
  const colors = new Map<string, CountedColor>();
  for (const frame of frames) {
    const duration = msToTicks(frame.delayMs);
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      if ((frame.pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) continue;
      const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
      const key = colorKey(color);
      const existing = colors.get(key);
      if (existing) existing.count += duration;
      else colors.set(key, { ...color, count: duration, key });
    }
  }
  return [...colors.values()].map((color) => ({ ...color, count: Math.sqrt(color.count) })).sort(compareRgb);
}

function remapFramesToPalette(frames: AnimationAnalysisFrame[], palette: RgbColor[]): AnimationAnalysisFrame[] {
  if (palette.length === 0) return frames.map((frame) => ({ ...frame, pixels: new Uint8ClampedArray(frame.pixels) }));
  const cache = new Map<string, RgbColor>();
  return frames.map((frame) => {
    const pixels = new Uint8ClampedArray(frame.pixels);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) {
        pixels.fill(0, offset, offset + 4);
        continue;
      }
      const source = { r: pixels[offset] ?? 0, g: pixels[offset + 1] ?? 0, b: pixels[offset + 2] ?? 0 };
      const key = colorKey(source);
      let color = cache.get(key);
      if (!color) { color = nearestColor(source, palette); cache.set(key, color); }
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = 255;
    }
    return { ...frame, pixels };
  });
}

function nearestColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  return palette.reduce((best, next) => (colorDistance(color, next) < colorDistance(color, best) ? next : best), palette[0] ?? color);
}

function colorKey(color: RgbColor): string {
  return `${color.r},${color.g},${color.b}`;
}

function compareRgb(a: RgbColor, b: RgbColor): number {
  return a.r - b.r || a.g - b.g || a.b - b.b;
}

export function parsePwanHeader(bytes: Uint8Array): PwanHeader {
  if (bytes.length < PWAN_HEADER_BYTES) throw new Error("PWAN file is too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  return {
    magic,
    version: view.getUint16(4, true),
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
    bpp: view.getUint16(10, true),
    frameCount: view.getUint16(12, true),
    timelineCount: view.getUint16(14, true),
    totalTicks: view.getUint32(16, true),
    frameBytes: view.getUint32(20, true),
    paletteColors: view.getUint32(24, true),
    paletteOffset: view.getUint32(28, true),
    timelineOffset: view.getUint32(32, true),
    frameOffset: view.getUint32(36, true),
  };
}

export function validatePwan(bytes: Uint8Array): PwanHeader {
  const header = parsePwanHeader(bytes);
  if (
    header.magic !== "PWAN" ||
    header.version !== 1 ||
    header.width !== PWAN_WIDTH ||
    header.height !== PWAN_HEIGHT ||
    header.bpp !== 4 ||
    header.frameBytes !== PWAN_FRAME_BYTES ||
    header.paletteColors !== PWAN_PALETTE_COLORS ||
    header.timelineCount > PWAN_MAX_TIMELINE
  ) {
    throw new Error("Unsupported PWAN asset; expected 96x96 4bpp PWAN v1");
  }
  const minimumLength = header.frameOffset + header.frameCount * header.frameBytes;
  if (minimumLength > bytes.length) throw new Error("PWAN asset is truncated");
  return header;
}

export function pwanPalette(bytes: Uint8Array): Uint16Array {
  const header = validatePwan(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: PWAN_PALETTE_COLORS }, (_value, index) => view.getUint16(header.paletteOffset + index * 2, true));
}

export function pwanFirstFramePixels(bytes: Uint8Array): number[][] {
  const header = validatePwan(bytes);
  if (header.frameCount < 1) throw new Error("PWAN asset contains no frames");
  return decodePwanFrame(bytes.subarray(header.frameOffset, header.frameOffset + header.frameBytes));
}

export function pwanFramePixels(bytes: Uint8Array, frameIndex: number): number[][] {
  const header = validatePwan(bytes);
  const index = clampInt(frameIndex, 0, Math.max(0, header.frameCount - 1));
  return decodePwanFrame(bytes.subarray(header.frameOffset + index * header.frameBytes, header.frameOffset + (index + 1) * header.frameBytes));
}

export function pwanFrameRgbaImage(bytes: Uint8Array, frameIndex = 0): { width: number; height: number; pixels: Uint8ClampedArray } {
  const indices = pwanFramePixels(bytes, frameIndex);
  const palette = pwanPalette(bytes);
  const pixels = new Uint8ClampedArray(PWAN_WIDTH * PWAN_HEIGHT * 4);
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const colorIndex = indices[y]?.[x] ?? 0;
      const color = bgr555ToRgb(palette[colorIndex] ?? 0);
      const offset = (y * PWAN_WIDTH + x) * 4;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = colorIndex === 0 ? 0 : 255;
    }
  }
  return { width: PWAN_WIDTH, height: PWAN_HEIGHT, pixels };
}

export function replacePwanFramePixels(bytes: Uint8Array, frameIndex: number, pixels: number[][]): { pwanBytes: Uint8Array; visibleHeight: number } {
  return replacePwanFramesPixels(bytes, [{ frameIndex, pixels }]);
}

export function replacePwanFramesPixels(bytes: Uint8Array, edits: Array<{ frameIndex: number; pixels: number[][] }>): { pwanBytes: Uint8Array; visibleHeight: number } {
  const header = validatePwan(bytes);
  const out = bytes.slice();
  for (const edit of edits) {
    const frameIndex = clampInt(edit.frameIndex, 0, Math.max(0, header.frameCount - 1));
    const encoded = tilePwanSegmentedPixels(clampIndexedPixels(edit.pixels));
    out.set(encoded, header.frameOffset + frameIndex * header.frameBytes);
  }
  const frames = Array.from({ length: header.frameCount }, (_value, index) => out.subarray(header.frameOffset + index * header.frameBytes, header.frameOffset + (index + 1) * header.frameBytes));
  return { pwanBytes: out, visibleHeight: pwanVisibleHeightFromFrames(frames) };
}

export function pwanTimeline(bytes: Uint8Array): PwanTimelineEntry[] {
  const header = validatePwan(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: header.timelineCount }, (_value, index) => ({
    frameIndex: view.getUint16(header.timelineOffset + index * 4, true),
    ticks: view.getUint16(header.timelineOffset + index * 4 + 2, true),
  }));
}

export function scalePwanTimelineSpeed(bytes: Uint8Array, durationScale: number): { pwanBytes: Uint8Array; totalTicks: number } {
  const header = validatePwan(bytes);
  const out = bytes.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const scale = Number.isFinite(durationScale) && durationScale > 0 ? durationScale : 1;
  let totalTicks = 0;
  for (let index = 0; index < header.timelineCount; index += 1) {
    const offset = header.timelineOffset + index * 4 + 2;
    const ticks = view.getUint16(offset, true);
    const nextTicks = clampInt(ticks * scale, 1, 0xff);
    view.setUint16(offset, nextTicks, true);
    totalTicks += nextTicks;
  }
  view.setUint32(16, totalTicks, true);
  return { pwanBytes: out, totalTicks };
}

export function pwanFramesPerSecond(bytes: Uint8Array): number {
  const timeline = pwanTimeline(bytes);
  const totalTicks = timeline.reduce((sum, entry) => sum + Math.max(1, entry.ticks), 0);
  return totalTicks > 0 ? timeline.length * 60 / totalTicks : 0;
}

export function scalePwanTimelineToFps(bytes: Uint8Array, framesPerSecond: number): { pwanBytes: Uint8Array; totalTicks: number; framesPerSecond: number } {
  const currentFps = pwanFramesPerSecond(bytes);
  const nextFps = clampFinite(framesPerSecond, 1, 60, currentFps || 10);
  if (currentFps <= 0) {
    const header = validatePwan(bytes);
    return { pwanBytes: bytes.slice(), totalTicks: header.totalTicks, framesPerSecond: nextFps };
  }
  const scaled = scalePwanTimelineSpeed(bytes, currentFps / nextFps);
  return { ...scaled, framesPerSecond: pwanFramesPerSecond(scaled.pwanBytes) };
}

export function shiftPwanFrames(bytes: Uint8Array, offsetX: number, offsetY: number): { pwanBytes: Uint8Array; visibleHeight: number } {
  const header = validatePwan(bytes);
  const dx = clampInt(offsetX, -PWAN_WIDTH, PWAN_WIDTH);
  const dy = clampInt(offsetY, -PWAN_HEIGHT, PWAN_HEIGHT);
  const out = bytes.slice();
  const frames: Uint8Array[] = [];
  for (let index = 0; index < header.frameCount; index += 1) {
    const frameOffset = header.frameOffset + index * header.frameBytes;
    const shifted = shiftIndexedPixels(decodePwanFrame(bytes.subarray(frameOffset, frameOffset + header.frameBytes)), dx, dy);
    const encoded = tilePwanSegmentedPixels(shifted);
    out.set(encoded, frameOffset);
    frames.push(encoded);
  }
  return { pwanBytes: out, visibleHeight: pwanVisibleHeightFromFrames(frames) };
}

export function scalePwanFrames(bytes: Uint8Array, scale: number, options: PwanFrameScaleOptions = {}): { pwanBytes: Uint8Array; visibleHeight: number } {
  const header = validatePwan(bytes);
  const factor = clampFinite(scale, 0.25, 4, 1);
  const mode = options.mode === "outlineFill" ? "outlineFill" : "nearest";
  const palette = mode === "outlineFill" ? pwanPalette(bytes) : undefined;
  const out = bytes.slice();
  const frames: Uint8Array[] = [];
  for (let index = 0; index < header.frameCount; index += 1) {
    const frameOffset = header.frameOffset + index * header.frameBytes;
    const pixels = decodePwanFrame(bytes.subarray(frameOffset, frameOffset + header.frameBytes));
    const scaled = mode === "outlineFill" && palette ? scaleIndexedPixelsOutlineFillBottomCenter(pixels, factor, palette, options.outlineThreshold ?? 48) : scaleIndexedPixelsBottomCenter(pixels, factor);
    const encoded = tilePwanSegmentedPixels(scaled);
    out.set(encoded, frameOffset);
    frames.push(encoded);
  }
  return { pwanBytes: out, visibleHeight: pwanVisibleHeightFromFrames(frames) };
}

export function pwanVisibleHeight(bytes: Uint8Array): number {
  const header = validatePwan(bytes);
  const frames = Array.from({ length: header.frameCount }, (_value, index) => bytes.subarray(header.frameOffset + index * header.frameBytes, header.frameOffset + (index + 1) * header.frameBytes));
  return pwanVisibleHeightFromFrames(frames);
}

export function pwanToGifBytes(bytes: Uint8Array): Uint8Array {
  const header = validatePwan(bytes);
  const palette = pwanPalette(bytes);
  const timeline = pwanTimeline(bytes);
  const parts: Uint8Array[] = [
    asciiBytes("GIF89a"),
    u16Bytes(PWAN_WIDTH),
    u16Bytes(PWAN_HEIGHT),
    new Uint8Array([0xf3, 0, 0]),
    gifColorTable(palette),
    new Uint8Array([0x21, 0xff, 0x0b]),
    asciiBytes("NETSCAPE2.0"),
    new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  const entries = timeline.length ? timeline : Array.from({ length: header.frameCount }, (_value, frameIndex) => ({ frameIndex, ticks: 6 }));
  for (const entry of entries) {
    const indices = flattenIndexedPixels(pwanFramePixels(bytes, entry.frameIndex));
    parts.push(new Uint8Array([0x21, 0xf9, 0x04, 0x09]), u16Bytes(clampInt(entry.ticks * 100 / 60, 1, 0xffff)), new Uint8Array([0, 0]));
    parts.push(new Uint8Array([0x2c]), u16Bytes(0), u16Bytes(0), u16Bytes(PWAN_WIDTH), u16Bytes(PWAN_HEIGHT), new Uint8Array([0, 4]));
    parts.push(gifSubBlocks(gifLzwEncode(indices, 4)));
  }
  parts.push(new Uint8Array([0x3b]));
  return concatBytes(parts);
}

export function tileIndexedPixels(pixels: number[][], width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = pixels[tileY + y]?.[tileX + x] ?? 0;
          const hi = pixels[tileY + y]?.[tileX + x + 1] ?? 0;
          out[offset++] = (lo & 0x0f) | ((hi & 0x0f) << 4);
        }
      }
    }
  }
  return out;
}

export function tilePwanSegmentedPixels(pixels: number[][]): Uint8Array {
  const chunks = SEGMENTS.map((segment) => tileIndexedPixelsRegion(pixels, segment.x, segment.y, segment.width, segment.height));
  const out = concatBytes(chunks);
  if (out.length !== PWAN_FRAME_BYTES) throw new Error(`Segmented PWAN frame is ${out.length} bytes; expected ${PWAN_FRAME_BYTES}`);
  return out;
}

export function makeWidePwanPixels(src: number[][]): number[][] {
  const pixels = Array.from({ length: 128 }, () => Array.from({ length: 256 }, () => 0));
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) pixels[y]![x] = src[y]?.[x] ?? 0;
  }
  return pixels;
}

export function normalizePwanSourceFrames(frames: AnimationAnalysisFrame[]): AnimationAnalysisFrame[] {
  return frames.map(normalizeFrameBottomAligned);
}

function normalizeFrameBottomAligned(frame: AnimationAnalysisFrame, index: number): AnimationAnalysisFrame {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0 || frame.pixels.length !== frame.width * frame.height * 4) {
    throw new Error("Invalid GIF frame dimensions or pixel data");
  }
  const bounds = alphaBounds(frame);
  const scale = Math.min(1, PWAN_WIDTH / frame.width, PWAN_HEIGHT / frame.height);
  const scaledWidth = Math.max(1, Math.round(frame.width * scale));
  const scaledHeight = Math.max(1, Math.round(frame.height * scale));
  const scaled = scaleRgba(frame.pixels, frame.width, frame.height, scaledWidth, scaledHeight);
  const pixels = new Uint8ClampedArray(PWAN_WIDTH * PWAN_HEIGHT * 4);
  const dstX = Math.floor((PWAN_WIDTH - scaledWidth) / 2);
  const dstY = PWAN_HEIGHT - scaledHeight;
  blitRgba(pixels, PWAN_WIDTH, scaled, scaledWidth, scaledHeight, dstX, dstY);
  normalizeAlpha(pixels);
  return { index, width: PWAN_WIDTH, height: PWAN_HEIGHT, delayMs: frame.delayMs, pixels: bounds ? pixels : new Uint8ClampedArray(PWAN_WIDTH * PWAN_HEIGHT * 4) };
}

function normalizePalette(colors: RgbColor[]): RgbColor[] {
  const palette: RgbColor[] = [{ r: 0, g: 0, b: 0 }, ...colors.slice(0, PWAN_PALETTE_COLORS - 1)];
  while (palette.length < PWAN_PALETTE_COLORS) palette.push({ r: 0, g: 0, b: 0 });
  return palette;
}

function compilePwanFrame(frame: AnimationAnalysisFrame, palette: RgbColor[]): Uint8Array {
  const chunks = SEGMENTS.map((segment) => tileRgbaRegion(frame, palette, segment.x, segment.y, segment.width, segment.height));
  const out = concatBytes(chunks);
  if (out.length !== PWAN_FRAME_BYTES) throw new Error(`Compiled PWAN frame is ${out.length} bytes; expected ${PWAN_FRAME_BYTES}`);
  return out;
}

function tileRgbaRegion(frame: AnimationAnalysisFrame, palette: RgbColor[], x0: number, y0: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = nearestPaletteIndex(frame, palette, x0 + tileX + x, y0 + tileY + y);
          const hi = nearestPaletteIndex(frame, palette, x0 + tileX + x + 1, y0 + tileY + y);
          out[offset++] = lo | (hi << 4);
        }
      }
    }
  }
  return out;
}

function tileIndexedPixelsRegion(pixels: number[][], x0: number, y0: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width * height) / 2);
  let offset = 0;
  for (let tileY = 0; tileY < height; tileY += 8) {
    for (let tileX = 0; tileX < width; tileX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 2) {
          const lo = pixels[y0 + tileY + y]?.[x0 + tileX + x] ?? 0;
          const hi = pixels[y0 + tileY + y]?.[x0 + tileX + x + 1] ?? 0;
          out[offset++] = (lo & 0x0f) | ((hi & 0x0f) << 4);
        }
      }
    }
  }
  return out;
}

function clampIndexedPixels(pixels: number[][]): number[][] {
  return Array.from({ length: PWAN_HEIGHT }, (_value, y) =>
    Array.from({ length: PWAN_WIDTH }, (_inner, x) => clampInt(pixels[y]?.[x] ?? 0, 0, PWAN_PALETTE_COLORS - 1)),
  );
}

function nearestPaletteIndex(frame: AnimationAnalysisFrame, palette: RgbColor[], x: number, y: number): number {
  const offset = (y * frame.width + x) * 4;
  const a = frame.pixels[offset + 3] ?? 0;
  if (a < TRANSPARENT_ALPHA_THRESHOLD) return 0;
  const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < palette.length; index += 1) {
    const distance = colorDistance(color, palette[index]!);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function encodePwan(input: { paletteBgr555: Uint16Array; timeline: PwanTimelineEntry[]; uniqueFrames: Uint8Array[]; totalTicks: number }): Uint8Array {
  const paletteOffset = PWAN_HEADER_BYTES;
  const timelineOffset = paletteOffset + PWAN_PALETTE_COLORS * 2;
  const frameOffset = timelineOffset + input.timeline.length * 4;
  const out = new Uint8Array(frameOffset + input.uniqueFrames.length * PWAN_FRAME_BYTES);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PWAN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, PWAN_WIDTH, true);
  view.setUint16(8, PWAN_HEIGHT, true);
  view.setUint16(10, 4, true);
  view.setUint16(12, input.uniqueFrames.length, true);
  view.setUint16(14, input.timeline.length, true);
  view.setUint32(16, input.totalTicks, true);
  view.setUint32(20, PWAN_FRAME_BYTES, true);
  view.setUint32(24, PWAN_PALETTE_COLORS, true);
  view.setUint32(28, paletteOffset, true);
  view.setUint32(32, timelineOffset, true);
  view.setUint32(36, frameOffset, true);
  input.paletteBgr555.forEach((color, index) => view.setUint16(paletteOffset + index * 2, color, true));
  input.timeline.forEach((entry, index) => {
    view.setUint16(timelineOffset + index * 4, entry.frameIndex, true);
    view.setUint16(timelineOffset + index * 4 + 2, entry.ticks, true);
  });
  input.uniqueFrames.forEach((frame, index) => out.set(frame, frameOffset + index * PWAN_FRAME_BYTES));
  return out;
}

function decodePwanFrame(frame: Uint8Array): number[][] {
  const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  let segmentOffset = 0;
  for (const segment of SEGMENTS) {
    const tilesW = segment.width / 8;
    const tilesH = segment.height / 8;
    for (let tileY = 0; tileY < tilesH; tileY += 1) {
      for (let tileX = 0; tileX < tilesW; tileX += 1) {
        const tileOffset = segmentOffset + (tileY * tilesW + tileX) * 32;
        for (let y = 0; y < 8; y += 1) {
          for (let xPair = 0; xPair < 4; xPair += 1) {
            const packed = frame[tileOffset + y * 4 + xPair] ?? 0;
            const x = segment.x + tileX * 8 + xPair * 2;
            const yy = segment.y + tileY * 8 + y;
            pixels[yy]![x] = packed & 0x0f;
            pixels[yy]![x + 1] = (packed >>> 4) & 0x0f;
          }
        }
      }
    }
    segmentOffset += (segment.width * segment.height) / 2;
  }
  return pixels;
}

function shiftIndexedPixels(pixels: number[][], dx: number, dy: number): number[][] {
  const shifted = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= PWAN_WIDTH || nextY >= PWAN_HEIGHT) continue;
      shifted[nextY]![nextX] = pixels[y]?.[x] ?? 0;
    }
  }
  return shifted;
}

function scaleIndexedPixelsBottomCenter(pixels: number[][], scale: number): number[][] {
  const scaled = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const sourceX = Math.floor(anchorX + (x + 0.5 - anchorX) / scale);
      const sourceY = Math.floor(anchorY + (y + 0.5 - anchorY) / scale);
      if (sourceX < 0 || sourceY < 0 || sourceX >= PWAN_WIDTH || sourceY >= PWAN_HEIGHT) continue;
      scaled[y]![x] = pixels[sourceY]?.[sourceX] ?? 0;
    }
  }
  return scaled;
}

function scaleIndexedPixelsOutlineFillBottomCenter(pixels: number[][], scale: number, palette: Uint16Array, outlineThreshold: number): number[][] {
  if (Math.abs(scale - 1) < 0.0001) return pixels.map((row) => [...row]);
  const threshold = clampInt(outlineThreshold, 0, 128);
  const silhouette = outlineMask(pixels, palette, 0);
  const protectedMask = outlineMask(pixels, palette, threshold);
  const scaled = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));

  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const source = inverseScalePoint(x, y, scale);
      const index = pixels[source.y]?.[source.x] ?? 0;
      if (index === 0 || protectedMask[source.y]?.[source.x]) continue;
      scaled[y]![x] = index;
    }
  }

  const outlinePixels = maskPoints(silhouette);
  const outlineSource = outlinePixels.length ? outlinePixels : maskPoints(protectedMask);
  if (outlineSource.length > 0) {
    const withOutline = scaled.map((row) => [...row]);
    for (let y = 0; y < PWAN_HEIGHT; y += 1) {
      for (let x = 0; x < PWAN_WIDTH; x += 1) {
        if (scaled[y]?.[x] !== 0 || !touchesOpaque(scaled, x, y)) continue;
        const nearest = nearestPoint(outlineSource, inverseScalePoint(x, y, scale));
        withOutline[y]![x] = pixels[nearest.y]?.[nearest.x] ?? 0;
      }
    }
    for (let y = 0; y < PWAN_HEIGHT; y += 1) scaled[y] = withOutline[y]!;
  }

  for (const point of maskPoints(protectedMask)) {
    if (silhouette[point.y]?.[point.x]) continue;
    const projected = forwardScalePoint(point.x, point.y, scale);
    if (projected.x < 0 || projected.y < 0 || projected.x >= PWAN_WIDTH || projected.y >= PWAN_HEIGHT) continue;
    scaled[projected.y]![projected.x] = pixels[point.y]?.[point.x] ?? 0;
  }

  return scaled;
}

function outlineMask(pixels: number[][], palette: Uint16Array, outlineThreshold: number): boolean[][] {
  const threshold = Math.max(0, outlineThreshold);
  return Array.from({ length: PWAN_HEIGHT }, (_value, y) =>
    Array.from({ length: PWAN_WIDTH }, (_inner, x) => {
      const index = pixels[y]?.[x] ?? 0;
      if (index === 0) return false;
      if (touchesTransparency(pixels, x, y)) return true;
      return threshold > 0 && bgr555Luminance(palette[index] ?? 0) <= threshold;
    }),
  );
}

function touchesTransparency(pixels: number[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= PWAN_WIDTH || yy >= PWAN_HEIGHT || (pixels[yy]?.[xx] ?? 0) === 0) return true;
    }
  }
  return false;
}

function touchesOpaque(pixels: number[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= PWAN_WIDTH || yy >= PWAN_HEIGHT) continue;
      if ((pixels[yy]?.[xx] ?? 0) !== 0) return true;
    }
  }
  return false;
}

function maskPoints(mask: boolean[][]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      if (mask[y]?.[x]) points.push({ x, y });
    }
  }
  return points;
}

function inverseScalePoint(x: number, y: number, scale: number): { x: number; y: number } {
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  return {
    x: clampInt(Math.floor(anchorX + (x + 0.5 - anchorX) / scale), 0, PWAN_WIDTH - 1),
    y: clampInt(Math.floor(anchorY + (y + 0.5 - anchorY) / scale), 0, PWAN_HEIGHT - 1),
  };
}

function forwardScalePoint(x: number, y: number, scale: number): { x: number; y: number } {
  const anchorX = PWAN_WIDTH / 2;
  const anchorY = PWAN_HEIGHT;
  return {
    x: Math.round(anchorX + (x + 0.5 - anchorX) * scale - 0.5),
    y: Math.round(anchorY + (y + 0.5 - anchorY) * scale - 0.5),
  };
}

function nearestPoint(points: Array<{ x: number; y: number }>, target: { x: number; y: number }): { x: number; y: number } {
  let best = points[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function bgr555Luminance(value: number): number {
  const r = ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2);
  const g = (((value >>> 5) & 0x1f) << 3) | (((value >>> 5) & 0x1f) >>> 2);
  const b = (((value >>> 10) & 0x1f) << 3) | (((value >>> 10) & 0x1f) >>> 2);
  return Math.round((r * 299 + g * 587 + b * 114) / 1000);
}

function pwanVisibleHeightFromFrames(frames: Uint8Array[]): number {
  let minY = PWAN_HEIGHT;
  let maxY = -1;
  for (const frame of frames) {
    const pixels = decodePwanFrame(frame);
    for (let y = 0; y < PWAN_HEIGHT; y += 1) {
      for (let x = 0; x < PWAN_WIDTH; x += 1) {
        if ((pixels[y]?.[x] ?? 0) === 0) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxY < minY ? 0 : maxY - minY + 1;
}

function msToTicks(ms: number): number {
  return clampInt(Math.round(ms * 60 / 1000), 1, 0xffff);
}

function writeBgr555(color: RgbColor): number {
  const r = Math.min(31, Math.max(0, Math.round(color.r) >> 3));
  const g = Math.min(31, Math.max(0, Math.round(color.g) >> 3));
  const b = Math.min(31, Math.max(0, Math.round(color.b) >> 3));
  return r | (g << 5) | (b << 10);
}

function scaleRgba(src: Uint8ClampedArray, srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  for (let y = 0; y < dstHeight; y += 1) {
    const sy = Math.min(srcHeight - 1, Math.floor((y + 0.5) * srcHeight / dstHeight));
    for (let x = 0; x < dstWidth; x += 1) {
      const sx = Math.min(srcWidth - 1, Math.floor((x + 0.5) * srcWidth / dstWidth));
      const dst = (y * dstWidth + x) * 4;
      const source = (sy * srcWidth + sx) * 4;
      out.set(src.subarray(source, source + 4), dst);
    }
  }
  return out;
}

function blitRgba(dst: Uint8ClampedArray, dstWidth: number, src: Uint8ClampedArray, srcWidth: number, srcHeight: number, dstX: number, dstY: number): void {
  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const tx = dstX + x;
      const ty = dstY + y;
      if (tx < 0 || ty < 0 || tx >= dstWidth || ty >= Math.floor(dst.length / 4 / dstWidth)) continue;
      dst.set(src.subarray((y * srcWidth + x) * 4, (y * srcWidth + x) * 4 + 4), (ty * dstWidth + tx) * 4);
    }
  }
}

function normalizeAlpha(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) pixels.fill(0, offset, offset + 4);
    else pixels[offset + 3] = 255;
  }
}

function alphaBounds(frame: AnimationAnalysisFrame): Box | undefined {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if ((frame.pixels[(y * frame.width + x) * 4 + 3] ?? 0) < TRANSPARENT_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined;
}

function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function flattenIndexedPixels(pixels: number[][]): Uint8Array {
  const out = new Uint8Array(PWAN_WIDTH * PWAN_HEIGHT);
  let offset = 0;
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) out[offset++] = pixels[y]?.[x] ?? 0;
  }
  return out;
}

function gifColorTable(palette: Uint16Array): Uint8Array {
  const out = new Uint8Array(16 * 3);
  palette.forEach((value, index) => {
    const color = bgr555ToRgb(value);
    out[index * 3] = color.r;
    out[index * 3 + 1] = color.g;
    out[index * 3 + 2] = color.b;
  });
  return out;
}

function bgr555ToRgb(value: number): { r: number; g: number; b: number } {
  return {
    r: ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2),
    g: (((value >>> 5) & 0x1f) << 3) | (((value >>> 5) & 0x1f) >>> 2),
    b: (((value >>> 10) & 0x1f) << 3) | (((value >>> 10) & 0x1f) >>> 2),
  };
}

function gifLzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minCodeSize + 1;
  const writer = new GifBitWriter();
  const literalRunLimit = 12;
  let literalRunLength = 0;

  writer.write(clearCode, codeSize);
  for (const index of indices) {
    if (literalRunLength >= literalRunLimit) {
      writer.write(clearCode, codeSize);
      literalRunLength = 0;
    }
    writer.write(index & ((1 << minCodeSize) - 1), codeSize);
    literalRunLength += 1;
  }
  writer.write(endCode, codeSize);
  return writer.finish();
}

class GifBitWriter {
  private bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  write(code: number, size: number): void {
    let value = code;
    for (let index = 0; index < size; index += 1) {
      this.current |= (value & 1) << this.bitCount;
      value >>>= 1;
      this.bitCount += 1;
      if (this.bitCount === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.bitCount = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) this.bytes.push(this.current);
    return Uint8Array.from(this.bytes);
  }
}

function gifSubBlocks(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.slice(offset, offset + 255);
    parts.push(new Uint8Array([chunk.length]), chunk);
  }
  parts.push(new Uint8Array([0]));
  return concatBytes(parts);
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff));
}

function u16Bytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return 2 * (a.r - b.r) ** 2 + 4 * (a.g - b.g) ** 2 + 3 * (a.b - b.b) ** 2;
}

function colorLuma(color: RgbColor): number {
  return color.r * 299 + color.g * 587 + color.b * 114;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
