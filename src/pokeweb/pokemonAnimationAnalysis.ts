import { decompressFrames, parseGIF } from "gifuct-js";
import { PNG } from "pngjs";

export type AnimationAnalysisFrame = {
  index: number;
  width: number;
  height: number;
  delayMs: number;
  pixels: Uint8ClampedArray;
};

export type AnimationCropResult = {
  frames: AnimationAnalysisFrame[];
  source: { width: number; height: number; frameCount: number; delaysMs: number[] };
  contentBounds: Box | undefined;
  cropBounds: Box;
  warnings: string[];
};

export type PaletteReport = {
  frameCount: number;
  transparentPixelCount: number;
  opaqueColorCount: number;
  colors: RgbColor[];
  compatible: boolean;
  quantized: boolean;
  warnings: string[];
};

export type MotionReport = {
  frameCount: number;
  changedPixelCount: number;
  changedBounds?: Box;
  perFrame: Array<{ frame: number; changedPixelCount: number; changedBounds?: Box; visibleBounds?: Box; newPixelCount: number; disappearedPixelCount: number }>;
  candidateParts: Array<{ id: number; description: string; bounds: Box; changedPixelCount: number; framesPresent: number[]; notes: string[] }>;
  warnings: string[];
};

export type Box = { x: number; y: number; width: number; height: number };
export type RgbColor = { r: number; g: number; b: number };

export const NORMALIZED_SPRITE_SIZE = 96;
export const MAX_GEN5_OPAQUE_COLORS = 15;

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

export function normalizeAnimationFrames(sourceFrames: AnimationAnalysisFrame[], size = NORMALIZED_SPRITE_SIZE): AnimationCropResult {
  if (sourceFrames.length === 0) throw new Error("GIF contains no frames");
  const width = sourceFrames[0].width;
  const height = sourceFrames[0].height;
  const warnings: string[] = [];
  for (const frame of sourceFrames) {
    if (frame.width !== width || frame.height !== height) throw new Error("All GIF frames must have the same dimensions");
  }
  const contentBounds = unionBounds(sourceFrames.map((frame) => alphaBounds(frame.pixels, frame.width, frame.height)).filter(Boolean) as Box[]);
  const centerX = contentBounds ? contentBounds.x + contentBounds.width / 2 : width / 2;
  const centerY = contentBounds ? contentBounds.y + contentBounds.height / 2 : height / 2;
  const cropBounds = { x: Math.round(centerX - size / 2), y: Math.round(centerY - size / 2), width: size, height: size };
  if (contentBounds && (contentBounds.width > size || contentBounds.height > size)) warnings.push(`Visible content is larger than ${size}x${size}; edges may be cropped`);
  const frames = sourceFrames.map((frame, index) => ({
    index,
    width: size,
    height: size,
    delayMs: frame.delayMs,
    pixels: cropFrame(frame, cropBounds, size),
  }));
  return {
    frames,
    source: { width, height, frameCount: sourceFrames.length, delaysMs: sourceFrames.map((frame) => frame.delayMs) },
    contentBounds,
    cropBounds,
    warnings,
  };
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

export function analyzeMotion(frames: AnimationAnalysisFrame[]): { report: MotionReport; unionMask: Uint8ClampedArray; stableMask: Uint8ClampedArray; frameDiffs: Uint8ClampedArray[] } {
  if (frames.length === 0) throw new Error("No frames to analyze");
  const base = frames[0];
  const unionMask = new Uint8ClampedArray(base.width * base.height * 4);
  const stableMask = new Uint8ClampedArray(base.width * base.height * 4);
  const frameDiffs: Uint8ClampedArray[] = [];
  const perFrame: MotionReport["perFrame"] = [];
  let changedPixelCount = 0;
  const changedPixels = new Uint8Array(base.width * base.height);

  for (const frame of frames) {
    const diff = new Uint8ClampedArray(base.width * base.height * 4);
    let count = 0;
    let newPixelCount = 0;
    let disappearedPixelCount = 0;
    let bounds: BoundsAccumulator = emptyBounds();
    for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
      const offset = pixel * 4;
      const baseAlpha = base.pixels[offset + 3] ?? 0;
      const alpha = frame.pixels[offset + 3] ?? 0;
      const changed = !samePixel(base.pixels, frame.pixels, offset);
      if (!changed) continue;
      count += 1;
      changedPixels[pixel] = 1;
      bounds = includePoint(bounds, pixel % base.width, Math.floor(pixel / base.width));
      diff[offset] = 255;
      diff[offset + 1] = alpha > 0 && baseAlpha > 0 ? 245 : alpha > 0 ? 80 : 80;
      diff[offset + 2] = alpha > 0 && baseAlpha > 0 ? 80 : alpha > 0 ? 80 : 255;
      diff[offset + 3] = 255;
      if (alpha > 0 && baseAlpha === 0) newPixelCount += 1;
      if (alpha === 0 && baseAlpha > 0) disappearedPixelCount += 1;
    }
    frameDiffs.push(diff);
    perFrame.push({
      frame: frame.index,
      changedPixelCount: count,
      changedBounds: boundsToBox(bounds),
      visibleBounds: alphaBounds(frame.pixels, frame.width, frame.height),
      newPixelCount,
      disappearedPixelCount,
    });
  }

  for (let pixel = 0; pixel < changedPixels.length; pixel += 1) {
    const offset = pixel * 4;
    if (changedPixels[pixel]) {
      changedPixelCount += 1;
      unionMask[offset] = 255;
      unionMask[offset + 1] = 245;
      unionMask[offset + 2] = 80;
      unionMask[offset + 3] = 255;
    } else if ((base.pixels[offset + 3] ?? 0) > 0) {
      stableMask[offset] = 80;
      stableMask[offset + 1] = 220;
      stableMask[offset + 2] = 140;
      stableMask[offset + 3] = 255;
    }
  }

  const candidateParts = connectedComponents(changedPixels, base.width, base.height).map((component, index) => {
    const framesPresent = perFrame.filter((frame) => boxesOverlap(component.bounds, frame.changedBounds)).map((frame) => frame.frame);
    const notes: string[] = [];
    if (component.bounds.width * component.bounds.height > component.changedPixelCount * 4) notes.push("Sparse motion region; may represent multiple parts or deformation");
    if (framesPresent.length < frames.length / 2) notes.push("Intermittent motion; check for occlusion or frame-specific effects");
    return { id: index, description: describeMotionRegion(component.bounds, frames), bounds: component.bounds, changedPixelCount: component.changedPixelCount, framesPresent, notes };
  });

  const warnings: string[] = [];
  if (perFrame.some((frame) => frame.newPixelCount > 0)) warnings.push("Some frames contain pixels that are transparent in frame 0; extra rig art may be needed");
  if (perFrame.some((frame) => frame.disappearedPixelCount > 0)) warnings.push("Some frame-0 pixels disappear later; occlusion or alternate cells may be needed");
  if (perFrame.some((frame) => frame.newPixelCount > 32 && frame.disappearedPixelCount > 32)) {
    warnings.push("Large simultaneous appearing/disappearing regions suggest deformation, rotation, or occlusion that may need manual rig decisions");
  }
  if (candidateParts.some((part) => part.notes.length > 0)) warnings.push("Some candidate regions are sparse or intermittent; review before converting to rig parts");

  return {
    report: {
      frameCount: frames.length,
      changedPixelCount,
      changedBounds: unionBounds(candidateParts.map((part) => part.bounds)),
      perFrame,
      candidateParts,
      warnings,
    },
    unionMask,
    stableMask,
    frameDiffs,
  };
}

export function encodePng(frame: Pick<AnimationAnalysisFrame, "width" | "height" | "pixels">): Uint8Array {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data = Buffer.from(frame.pixels);
  return PNG.sync.write(png);
}

export function decodePng(bytes: Uint8Array, index = 0, delayMs = 0): AnimationAnalysisFrame {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { index, width: png.width, height: png.height, delayMs, pixels: new Uint8ClampedArray(png.data) };
}

export function palettePng(colors: RgbColor[]): Uint8Array {
  const pixels = new Uint8ClampedArray(16 * 4);
  pixels[0] = 255;
  pixels[1] = 0;
  pixels[2] = 255;
  pixels[3] = 255;
  colors.slice(0, MAX_GEN5_OPAQUE_COLORS).forEach((color, index) => {
    const offset = (index + 1) * 4;
    const rounded = roundTripBgr555Color(color);
    pixels[offset] = rounded.r;
    pixels[offset + 1] = rounded.g;
    pixels[offset + 2] = rounded.b;
    pixels[offset + 3] = 255;
  });
  return encodePng({ width: 16, height: 1, pixels });
}

export function roundTripBgr555Color(color: RgbColor): RgbColor {
  const r = Math.min(31, Math.ceil(Math.max(0, Math.min(255, color.r)) / 8.25));
  const g = Math.min(31, Math.ceil(Math.max(0, Math.min(255, color.g)) / 8.25));
  const b = Math.min(31, Math.ceil(Math.max(0, Math.min(255, color.b)) / 8.25));
  return { r: Math.floor(r * 8.25), g: Math.floor(g * 8.25), b: Math.floor(b * 8.25) };
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

function cropFrame(frame: AnimationAnalysisFrame, crop: Box, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = crop.x + x;
      const sy = crop.y + y;
      if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) continue;
      out.set(frame.pixels.subarray((sy * frame.width + sx) * 4, (sy * frame.width + sx) * 4 + 4), (y * size + x) * 4);
    }
  }
  return out;
}

function alphaBounds(pixels: Uint8ClampedArray, width: number, height: number): Box | undefined {
  let bounds = emptyBounds();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 0) bounds = includePoint(bounds, x, y);
    }
  }
  return boundsToBox(bounds);
}

function unionBounds(boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  let bounds = emptyBounds();
  boxes.forEach((box) => {
    bounds = includePoint(bounds, box.x, box.y);
    bounds = includePoint(bounds, box.x + box.width - 1, box.y + box.height - 1);
  });
  return boundsToBox(bounds);
}

type BoundsAccumulator = { minX: number; minY: number; maxX: number; maxY: number };

function emptyBounds(): BoundsAccumulator {
  return { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
}

function includePoint(bounds: BoundsAccumulator, x: number, y: number): BoundsAccumulator {
  return { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) };
}

function boundsToBox(bounds: BoundsAccumulator): Box | undefined {
  if (!Number.isFinite(bounds.minX)) return undefined;
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1 };
}

function uniqueOpaqueColors(frames: AnimationAnalysisFrame[]): RgbColor[] {
  const seen = new Map<string, RgbColor>();
  for (const color of allOpaquePixels(frames)) seen.set(`${color.r},${color.g},${color.b}`, color);
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
  const ranges = ["r", "g", "b"].map((channel) => Math.max(...colors.map((color) => color[channel as keyof RgbColor])) - Math.min(...colors.map((color) => color[channel as keyof RgbColor])));
  return Math.max(...ranges);
}

function widestChannel(colors: RgbColor[]): keyof RgbColor {
  const channels = ["r", "g", "b"] as const;
  return channels.reduce((best, channel) => {
    const range = Math.max(...colors.map((color) => color[channel])) - Math.min(...colors.map((color) => color[channel]));
    const bestRange = Math.max(...colors.map((color) => color[best])) - Math.min(...colors.map((color) => color[best]));
    return range > bestRange ? channel : best;
  }, "r" as keyof RgbColor);
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

function samePixel(left: Uint8ClampedArray, right: Uint8ClampedArray, offset: number): boolean {
  return left[offset] === right[offset] && left[offset + 1] === right[offset + 1] && left[offset + 2] === right[offset + 2] && left[offset + 3] === right[offset + 3];
}

function connectedComponents(mask: Uint8Array, width: number, height: number): Array<{ bounds: Box; changedPixelCount: number }> {
  const visited = new Uint8Array(mask.length);
  const components: Array<{ bounds: Box; changedPixelCount: number }> = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let bounds = emptyBounds();
    let count = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor]!;
      count += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      bounds = includePoint(bounds, x, y);
      for (const next of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    const box = boundsToBox(bounds);
    if (box && count >= 4) components.push({ bounds: box, changedPixelCount: count });
  }
  return components.sort((a, b) => b.changedPixelCount - a.changedPixelCount);
}

function boxesOverlap(left: Box, right: Box | undefined): boolean {
  if (!right) return false;
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function describeMotionRegion(bounds: Box, frames: AnimationAnalysisFrame[]): string {
  const base = frames[0];
  const position = base ? positionName(bounds, base.width, base.height) : "unknown-position";
  const names = colorsForDescription(dominantColors(frames, bounds, 4));
  const colorText = names.length === 0 ? "transparent" : names.join("/");
  return `${position} ${colorText} region`;
}

function positionName(bounds: Box, width: number, height: number): string {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const horizontal = centerX < width / 3 ? "left" : centerX > (width * 2) / 3 ? "right" : "center";
  const vertical = centerY < height / 3 ? "upper" : centerY > (height * 2) / 3 ? "lower" : "middle";
  if (horizontal === "center") return vertical;
  return `${vertical}-${horizontal}`;
}

function dominantColors(frames: AnimationAnalysisFrame[], bounds: Box, limit: number): RgbColor[] {
  const counts = new Map<string, { color: RgbColor; count: number }>();
  for (const frame of frames) {
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
        const offset = (y * frame.width + x) * 4;
        if ((frame.pixels[offset + 3] ?? 0) === 0) continue;
        const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
        const key = `${color.r},${color.g},${color.b}`;
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { color, count: 1 });
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.color);
}

function colorName(color: RgbColor): string {
  const { r, g, b } = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 40) return "black";
  if (min > 210) return "white";
  if (max - min < 28) return max > 150 ? "light-gray" : "gray";
  if (r > 210 && g > 180 && b > 100) return "pale-yellow";
  if (r > 180 && g > 150 && b < 150) return "yellow";
  if (r > 120 && g > 70 && g < 180 && b < 120) return "brown";
  if (r > 180 && g > 70 && b < 80) return "orange";
  if (r > 150 && g < 90 && b < 90) return "red";
  if (g > r + 25 && g > b + 25) return "green";
  if (b > r + 25 && b > g + 25) return "blue";
  if (r > 100 && b > 100 && g < 100) return "purple";
  return "mixed-color";
}

function colorsForDescription(colors: RgbColor[]): string[] {
  const names = colors.map(colorName).filter(unique);
  if (names.length > 1) return names.filter((name) => name !== "black" && name !== "white" && name !== "gray").slice(0, 3);
  return names;
}

function unique<T>(value: T, index: number, values: T[]): boolean {
  return values.indexOf(value) === index;
}
