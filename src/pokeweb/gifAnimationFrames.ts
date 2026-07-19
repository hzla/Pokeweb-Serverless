import { decompressFrames, parseGIF } from "gifuct-js";

export type AnimationAnalysisFrame = {
  index: number;
  width: number;
  height: number;
  delayMs: number;
  pixels: Uint8ClampedArray;
};

export type Box = { x: number; y: number; width: number; height: number };
export type RgbColor = { r: number; g: number; b: number };

export type PaletteReport = {
  frameCount: number;
  transparentPixelCount: number;
  opaqueColorCount: number;
  colors: RgbColor[];
  compatible: boolean;
  quantized: boolean;
  warnings: string[];
};

const MAX_GEN5_OPAQUE_COLORS = 15;

export function decodeGifFrames(bytes: Uint8Array): AnimationAnalysisFrame[] {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const parsed = parseGIF(arrayBuffer);
  const decompressed = decompressFrames(parsed, true);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  let canvas = new Uint8ClampedArray(width * height * 4);
  return decompressed.map((frame, index) => {
    const before = new Uint8ClampedArray(canvas);
    blitPatch(canvas, width, height, frame.patch, frame.dims);
    const output = new Uint8ClampedArray(canvas);
    if (frame.disposalType === 2) clearRect(canvas, width, height, frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    else if (frame.disposalType === 3) canvas = before;
    return {
      index,
      width,
      height,
      delayMs: Math.max(10, frame.delay ?? 100),
      pixels: output,
    };
  });
}

export function analyzePalette(frames: AnimationAnalysisFrame[]): PaletteReport {
  const colors = uniqueOpaqueColors(frames);
  const transparentPixelCount = frames.reduce((sum, frame) => sum + countTransparentPixels(frame), 0);
  const warnings: string[] = [];
  if (colors.length > MAX_GEN5_OPAQUE_COLORS) warnings.push(`Uses ${colors.length} opaque colors; Gen 5 battle sprites support ${MAX_GEN5_OPAQUE_COLORS} plus transparency`);
  if (transparentPixelCount === 0) warnings.push("No transparent pixels found; background may need to become transparent before import");
  return {
    frameCount: frames.length,
    transparentPixelCount,
    opaqueColorCount: colors.length,
    colors,
    compatible: colors.length <= MAX_GEN5_OPAQUE_COLORS,
    quantized: false,
    warnings,
  };
}

export function quantizeFrames(frames: AnimationAnalysisFrame[], maxColors = MAX_GEN5_OPAQUE_COLORS): { frames: AnimationAnalysisFrame[]; palette: RgbColor[] } {
  const sourceColors = allOpaquePixels(frames);
  const palette = medianCut(sourceColors, maxColors);
  const remapped = frames.map((frame) => {
    const pixels = new Uint8ClampedArray(frame.pixels);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset + 3] ?? 0) === 0) continue;
      const color = nearestColor({ r: pixels[offset] ?? 0, g: pixels[offset + 1] ?? 0, b: pixels[offset + 2] ?? 0 }, palette);
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = 255;
    }
    return { ...frame, pixels };
  });
  return { frames: remapped, palette };
}

function blitPatch(canvas: Uint8ClampedArray, width: number, height: number, patch: Uint8ClampedArray, dims: { left: number; top: number; width: number; height: number }): void {
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      const source = (y * dims.width + x) * 4;
      if ((patch[source + 3] ?? 0) === 0) continue;
      const tx = dims.left + x;
      const ty = dims.top + y;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      canvas.set(patch.subarray(source, source + 4), (ty * width + tx) * 4);
    }
  }
}

function clearRect(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, boxWidth: number, boxHeight: number): void {
  for (let py = y; py < y + boxHeight; py += 1) {
    for (let px = x; px < x + boxWidth; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      pixels.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 4);
    }
  }
}

function uniqueOpaqueColors(frames: AnimationAnalysisFrame[]): RgbColor[] {
  const seen = new Map<string, RgbColor>();
  for (const frame of frames) {
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      if ((frame.pixels[offset + 3] ?? 0) === 0) continue;
      const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
      seen.set(`${color.r},${color.g},${color.b}`, color);
    }
  }
  return [...seen.values()].sort((a, b) => a.r - b.r || a.g - b.g || a.b - b.b);
}

function allOpaquePixels(frames: AnimationAnalysisFrame[]): RgbColor[] {
  const colors: RgbColor[] = [];
  for (const frame of frames) {
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
      if ((frame.pixels[offset + 3] ?? 0) === 0) continue;
      colors.push({ r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 });
    }
  }
  return colors;
}

function countTransparentPixels(frame: AnimationAnalysisFrame): number {
  let count = 0;
  for (let offset = 3; offset < frame.pixels.length; offset += 4) if ((frame.pixels[offset] ?? 0) === 0) count += 1;
  return count;
}

function medianCut(colors: RgbColor[], maxColors: number): RgbColor[] {
  if (colors.length === 0) return [];
  let buckets = [colors];
  while (buckets.length < maxColors) {
    buckets = buckets.sort((a, b) => colorRange(b) - colorRange(a));
    const bucket = buckets.shift();
    if (!bucket || bucket.length <= 1) {
      if (bucket) buckets.push(bucket);
      break;
    }
    const channel = widestChannel(bucket);
    const sorted = [...bucket].sort((a, b) => a[channel] - b[channel]);
    const mid = Math.ceil(sorted.length / 2);
    buckets.push(sorted.slice(0, mid), sorted.slice(mid));
  }
  return buckets.map(averageColor);
}

function colorRange(colors: RgbColor[]): number {
  const r = channelRange(colors, "r");
  const g = channelRange(colors, "g");
  const b = channelRange(colors, "b");
  return Math.max(r, g, b);
}

function widestChannel(colors: RgbColor[]): keyof RgbColor {
  const channels = ["r", "g", "b"] as const;
  const ranges = {
    r: channelRange(colors, "r"),
    g: channelRange(colors, "g"),
    b: channelRange(colors, "b"),
  };
  return channels.reduce((best, channel) => {
    return ranges[channel] > ranges[best] ? channel : best;
  }, "r" as keyof RgbColor);
}

function channelRange(colors: RgbColor[], channel: keyof RgbColor): number {
  let min = 255;
  let max = 0;
  for (const color of colors) {
    const value = color[channel];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function averageColor(colors: RgbColor[]): RgbColor {
  const sum = colors.reduce((acc, color) => ({ r: acc.r + color.r, g: acc.g + color.g, b: acc.b + color.b }), { r: 0, g: 0, b: 0 });
  return { r: Math.round(sum.r / colors.length), g: Math.round(sum.g / colors.length), b: Math.round(sum.b / colors.length) };
}

function nearestColor(color: RgbColor, palette: RgbColor[]): RgbColor {
  return palette.reduce((best, next) => (colorDistance(color, next) < colorDistance(color, best) ? next : best), palette[0] ?? color);
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}
