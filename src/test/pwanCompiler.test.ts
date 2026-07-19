import { describe, expect, it } from "vitest";
import {
  compileGifToPwan,
  parsePwanHeader,
  preparePwanPaletteFrames,
  pwanFirstFramePixels,
  pwanFramePixels,
  pwanFramesPerSecond,
  pwanPalette,
  pwanTimeline,
  pwanToGifBytes,
  PWAN_FRAME_BYTES,
  PWAN_HEIGHT,
  PWAN_PALETTE_COLORS,
  PWAN_WIDTH,
  replacePwanFramePixels,
  scalePwanFrames,
  scalePwanTimelineSpeed,
  scalePwanTimelineToFps,
  shiftPwanFrames,
  tileIndexedPixels,
  tilePwanSegmentedPixels,
} from "../pokeweb/pwanCompiler";
import type { AnimationAnalysisFrame } from "../pokeweb/gifAnimationFrames";

describe("pwanCompiler", () => {
  it("compiles a GIF into a 96x96 4bpp PWAN asset", () => {
    const result = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const header = parsePwanHeader(result.pwanBytes);

    expect(header.magic).toBe("PWAN");
    expect(header.version).toBe(1);
    expect(header.width).toBe(PWAN_WIDTH);
    expect(header.height).toBe(PWAN_HEIGHT);
    expect(header.bpp).toBe(4);
    expect(header.frameBytes).toBe(PWAN_FRAME_BYTES);
    expect(header.paletteColors).toBe(PWAN_PALETTE_COLORS);
    expect(header.frameCount).toBe(1);
    expect(header.timelineCount).toBe(1);
    expect(result.uniqueFrameCount).toBe(1);
    expect(result.totalTicks).toBeGreaterThan(0);
    expect(pwanPalette(result.pwanBytes)[0]).toBe(0);
  });

  it("bottom-aligns visible pixels and keeps palette index 0 transparent", () => {
    const result = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const pixels = pwanFirstFramePixels(result.pwanBytes);
    const nonTransparent: Array<[number, number]> = [];

    pixels.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) nonTransparent.push([x, y]);
      });
    });

    expect(nonTransparent.length).toBe(1);
    expect(nonTransparent[0]![1]).toBe(95);
    expect(result.visibleHeight).toBe(1);
  });

  it("preserves exact palette colors when frames already fit the PWAN palette", () => {
    const colors = [
      [240, 48, 32, 255],
      [72, 72, 80, 255],
      [248, 248, 240, 255],
    ] as const;
    const frame = makeRgbaFrame(4, 1, [
      [0, 0, 0, 0],
      ...colors,
    ]);

    const result = preparePwanPaletteFrames([frame]);

    expect(result.quantized).toBe(false);
    expect(result.strategy).toBe("exact");
    expect(result.frames[0]).toBe(frame);
    expect(result.palette).toEqual([
      { r: 72, g: 72, b: 80 },
      { r: 240, g: 48, b: 32 },
      { r: 248, g: 248, b: 240 },
    ]);
  });

  it("uses a compatible anchor frame palette for local-palette animations", () => {
    const anchorColors = [
      [24, 24, 24],
      [91, 91, 92],
      [174, 165, 165],
      [240, 239, 232],
      [239, 61, 150],
      [174, 51, 125],
      [40, 44, 120],
      [0, 97, 169],
      [122, 35, 37],
      [247, 60, 45],
      [242, 213, 0],
      [181, 51, 53],
    ] as const;
    const extraColors = Array.from({ length: 10 }, (_value, index) => [80 + index * 3, 20 + index * 5, 140 + index * 2] as const);
    const anchorFrame = makeRgbaFrame(anchorColors.length, 1, anchorColors.map((color) => [...color, 255]));
    const richFrame = makeRgbaFrame(anchorColors.length + extraColors.length, 1, [...anchorColors, ...extraColors].map((color) => [...color, 255]));

    const result = preparePwanPaletteFrames([anchorFrame, richFrame]);

    expect(result.quantized).toBe(true);
    expect(result.strategy).toBe("anchor-frame");
    expect(result.palette).toEqual(anchorColors.map(([r, g, b]) => ({ r, g, b })).sort(compareRgb));
    expect(uniqueOpaqueColors(result.frames[1]!)).toEqual(result.palette);
  });

  it("merges the closest visible pair when a single frame has one color too many", () => {
    const colors = [
      [10, 10, 10],
      [11, 10, 10],
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
      [255, 255, 0],
      [255, 0, 255],
      [0, 255, 255],
      [80, 0, 0],
      [0, 80, 0],
      [0, 0, 80],
      [160, 160, 0],
      [160, 0, 160],
      [0, 160, 160],
      [80, 80, 80],
      [240, 240, 240],
    ] as const;
    const frame = makeRgbaFrame(colors.length, 1, colors.map((color) => [...color, 255]));

    const result = preparePwanPaletteFrames([frame]);

    expect(result.quantized).toBe(true);
    expect(result.strategy).toBe("closest-merge");
    expect(result.palette).toHaveLength(PWAN_PALETTE_COLORS - 1);
    expect(result.palette).toContainEqual({ r: 10, g: 10, b: 10 });
    expect(result.palette).not.toContainEqual({ r: 11, g: 10, b: 10 });
    expect(result.palette).not.toContainEqual({ r: 10.5, g: 10, b: 10 });
    expect(result.warnings).toContain("Opaque colors were reduced by merging the least-visible closest color pairs to fit PWAN's 15-color visible palette");
  });

  it("uses bounded weighted quantization for dense GIF palettes", () => {
    const pixels = Array.from({ length: 32 * 32 }, (_value, index) => [
      (index % 32) * 8,
      Math.floor(index / 32) * 8,
      ((index % 32) ^ Math.floor(index / 32)) * 8,
      255,
    ] as const);
    const frame = makeRgbaFrame(32, 32, pixels);

    const result = preparePwanPaletteFrames([frame]);

    expect(result.strategy).toBe("weighted-median-cut");
    expect(result.palette).toHaveLength(PWAN_PALETTE_COLORS - 1);
    expect(uniqueOpaqueColors(result.frames[0]!)).toHaveLength(PWAN_PALETTE_COLORS - 1);
  });

  it("tiles carrier fallback pixels in PWAN segment order", () => {
    const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
    pixels[0]![64] = 5;

    const segmented = tilePwanSegmentedPixels(pixels);
    const linear = tileIndexedPixels(pixels, PWAN_WIDTH, PWAN_HEIGHT);

    expect(segmented).toHaveLength(PWAN_FRAME_BYTES);
    expect(segmented[0x800]! & 0x0f).toBe(5);
    expect(linear[0x100]! & 0x0f).toBe(5);
    expect(segmented[0x100]! & 0x0f).toBe(0);
  });

  it("rescales PWAN timeline ticks for saved playback speed changes", () => {
    const result = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const originalTicks = pwanTimeline(result.pwanBytes)[0]?.ticks ?? 1;
    const scaled = scalePwanTimelineSpeed(result.pwanBytes, 0.5);
    const scaledTicks = pwanTimeline(scaled.pwanBytes)[0]?.ticks ?? 1;

    expect(scaled.pwanBytes).not.toBe(result.pwanBytes);
    expect(scaledTicks).toBe(Math.max(1, Math.round(originalTicks * 0.5)));
    expect(parsePwanHeader(scaled.pwanBytes).totalTicks).toBe(scaledTicks);
    expect(scaled.totalTicks).toBe(scaledTicks);
  });

  it("retimes PWAN playback to a requested frame rate", () => {
    const result = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const retimed = scalePwanTimelineToFps(result.pwanBytes, 30);
    const timeline = pwanTimeline(retimed.pwanBytes);

    expect(timeline[0]?.ticks).toBe(2);
    expect(parsePwanHeader(retimed.pwanBytes).totalTicks).toBe(2);
    expect(pwanFramesPerSecond(retimed.pwanBytes)).toBe(30);
    expect(retimed.framesPerSecond).toBe(30);
  });

  it("shifts all PWAN frame pixels by an x/y offset", () => {
    const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
    pixels[10]![10] = 5;
    const pwanBytes = makePwanFromPixels(pixels);

    const shifted = shiftPwanFrames(pwanBytes, 3, 4);
    const decoded = pwanFramePixels(shifted.pwanBytes, 0);

    expect(decoded[10]![10]).toBe(0);
    expect(decoded[14]![13]).toBe(5);
    expect(shifted.visibleHeight).toBe(1);
  });

  it("replaces indexed pixels for an existing PWAN frame", () => {
    const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
    pixels[95]![48] = 2;
    const pwanBytes = makePwanFromPixels(pixels);
    const edited = pwanFramePixels(pwanBytes, 0);
    edited[94]![48] = 3;
    edited[95]![48] = 0;

    const replaced = replacePwanFramePixels(pwanBytes, 0, edited);
    const decoded = pwanFramePixels(replaced.pwanBytes, 0);

    expect(decoded[94]![48]).toBe(3);
    expect(decoded[95]![48]).toBe(0);
    expect(replaced.visibleHeight).toBe(1);
  });

  it("scales PWAN frame pixels around the bottom center of the canvas", () => {
    const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
    pixels[95]![48] = 5;
    const pwanBytes = makePwanFromPixels(pixels);

    const scaled = scalePwanFrames(pwanBytes, 2);
    const decoded = pwanFramePixels(scaled.pwanBytes, 0);

    expect(decoded[95]![48]).toBe(5);
    expect(decoded[95]![49]).toBe(5);
    expect(decoded[94]![48]).toBe(5);
    expect(decoded[95]![47]).toBe(0);
    expect(scaled.visibleHeight).toBe(2);
  });

  it("outline-fill scaling expands fill without thickening the external silhouette", () => {
    const pixels = makeOutlinedBlockPixels();
    const pwanBytes = makePwanFromPixels(pixels, { ticks: 7 });

    const scaled = scalePwanFrames(pwanBytes, 2, { mode: "outlineFill", outlineThreshold: 0 });
    const decoded = pwanFramePixels(scaled.pwanBytes, 0);

    expect(parsePwanHeader(scaled.pwanBytes)).toMatchObject({ width: PWAN_WIDTH, height: PWAN_HEIGHT, bpp: 4, frameBytes: PWAN_FRAME_BYTES });
    expect(pwanTimeline(scaled.pwanBytes)).toEqual([{ frameIndex: 0, ticks: 7 }]);
    expect(countPixels(decoded, 2)).toBeGreaterThan(countPixels(pixels, 2));
    expect(countPixels(decoded, 3)).toBeGreaterThan(0);
    expect(hasSolidBlock(decoded, 3, 2)).toBe(false);
    expect(scaled.visibleHeight).toBeGreaterThan(5);
  });

  it("outline-fill threshold 0 only protects the silhouette", () => {
    const pixels = makeOutlinedBlockPixels({ internalDarkLine: true });
    const pwanBytes = makePwanFromPixels(pixels);

    const silhouetteOnly = pwanFramePixels(scalePwanFrames(pwanBytes, 2, { mode: "outlineFill", outlineThreshold: 0 }).pwanBytes, 0);
    const darkProtected = pwanFramePixels(scalePwanFrames(pwanBytes, 2, { mode: "outlineFill", outlineThreshold: 96 }).pwanBytes, 0);

    expect(countPixels(silhouetteOnly, 1)).toBeGreaterThan(countPixels(darkProtected, 1));
  });

  it("outline-fill scaling preserves protected internal dark linework", () => {
    const pixels = makeOutlinedBlockPixels({ internalDarkLine: true });
    const pwanBytes = makePwanFromPixels(pixels);

    const scaled = scalePwanFrames(pwanBytes, 2, { mode: "outlineFill", outlineThreshold: 96 });
    const decoded = pwanFramePixels(scaled.pwanBytes, 0);

    expect(countInternalLinePixels(decoded, 1)).toBe(3);
    expect(hasSolidBlock(decoded, 1, 2)).toBe(false);
    expect(countPixels(decoded, 2)).toBeGreaterThan(countPixels(pixels, 2));
  });

  it("exports PWAN playback as a GIF", () => {
    const result = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const gif = pwanToGifBytes(result.pwanBytes);

    expect(String.fromCharCode(...gif.slice(0, 6))).toBe("GIF89a");
    expect(readU16(gif, 6)).toBe(PWAN_WIDTH);
    expect(readU16(gif, 8)).toBe(PWAN_HEIGHT);
    expect(gif[gif.length - 1]).toBe(0x3b);
  });

  it("exports edited PWAN pixels as a GIF", () => {
    const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
    pixels[95]![48] = 2;
    const pwanBytes = makePwanFromPixels(pixels);
    const edited = pwanFramePixels(pwanBytes, 0);
    edited[94]![48] = 3;
    edited[95]![48] = 0;

    const replaced = replacePwanFramePixels(pwanBytes, 0, edited);
    const exported = compileGifToPwan(pwanToGifBytes(replaced.pwanBytes));
    const exportedPixels = pwanFramePixels(exported.pwanBytes, 0);
    const exportedPalette = pwanPalette(exported.pwanBytes);
    const editedIndex = exportedPixels[94]![48]!;

    expect(editedIndex).toBeGreaterThan(0);
    expect(exportedPalette[editedIndex]).toBe(0x03e0);
    expect(exportedPixels[95]![48]).toBe(0);
  });
});

function makePwanFromPixels(pixels: number[][], options: { ticks?: number } = {}): Uint8Array {
  const ticks = options.ticks ?? 6;
  const paletteOffset = 0x30;
  const timelineOffset = paletteOffset + PWAN_PALETTE_COLORS * 2;
  const frameOffset = timelineOffset + 4;
  const frame = tilePwanSegmentedPixels(pixels);
  const out = new Uint8Array(frameOffset + frame.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PWAN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, PWAN_WIDTH, true);
  view.setUint16(8, PWAN_HEIGHT, true);
  view.setUint16(10, 4, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 1, true);
  view.setUint32(16, ticks, true);
  view.setUint32(20, PWAN_FRAME_BYTES, true);
  view.setUint32(24, PWAN_PALETTE_COLORS, true);
  view.setUint32(28, paletteOffset, true);
  view.setUint32(32, timelineOffset, true);
  view.setUint32(36, frameOffset, true);
  view.setUint16(paletteOffset + 1 * 2, 0x0000, true);
  view.setUint16(paletteOffset + 2 * 2, 0x7fff, true);
  view.setUint16(paletteOffset + 3 * 2, 0x03e0, true);
  view.setUint16(paletteOffset + 5 * 2, 0x7fff, true);
  view.setUint16(timelineOffset, 0, true);
  view.setUint16(timelineOffset + 2, ticks, true);
  out.set(frame, frameOffset);
  return out;
}

function makeRgbaFrame(width: number, height: number, rgbaPixels: ReadonlyArray<readonly [number, number, number, number]>): AnimationAnalysisFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  rgbaPixels.forEach((color, index) => pixels.set(color, index * 4));
  return {
    index: 0,
    width,
    height,
    delayMs: 100,
    pixels,
  };
}

function uniqueOpaqueColors(frame: AnimationAnalysisFrame): Array<{ r: number; g: number; b: number }> {
  const colors = new Map<string, { r: number; g: number; b: number }>();
  for (let offset = 0; offset < frame.pixels.length; offset += 4) {
    if ((frame.pixels[offset + 3] ?? 0) === 0) continue;
    const color = { r: frame.pixels[offset] ?? 0, g: frame.pixels[offset + 1] ?? 0, b: frame.pixels[offset + 2] ?? 0 };
    colors.set(`${color.r},${color.g},${color.b}`, color);
  }
  return [...colors.values()].sort(compareRgb);
}

function compareRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return a.r - b.r || a.g - b.g || a.b - b.b;
}

function makeOutlinedBlockPixels(options: { internalDarkLine?: boolean } = {}): number[][] {
  const pixels = Array.from({ length: PWAN_HEIGHT }, () => Array.from({ length: PWAN_WIDTH }, () => 0));
  for (let y = 91; y <= 95; y += 1) {
    for (let x = 46; x <= 50; x += 1) {
      pixels[y]![x] = x === 46 || x === 50 || y === 91 || y === 95 ? 3 : 2;
    }
  }
  if (options.internalDarkLine) {
    for (let y = 92; y <= 94; y += 1) pixels[y]![48] = 1;
  }
  return pixels;
}

function countPixels(pixels: number[][], colorIndex: number): number {
  return pixels.reduce((sum, row) => sum + row.filter((value) => value === colorIndex).length, 0);
}

function hasSolidBlock(pixels: number[][], colorIndex: number, size: number): boolean {
  for (let y = 0; y <= PWAN_HEIGHT - size; y += 1) {
    for (let x = 0; x <= PWAN_WIDTH - size; x += 1) {
      let allMatch = true;
      for (let dy = 0; dy < size && allMatch; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) {
          if (pixels[y + dy]?.[x + dx] !== colorIndex) {
            allMatch = false;
            break;
          }
        }
      }
      if (allMatch) return true;
    }
  }
  return false;
}

function countInternalLinePixels(pixels: number[][], colorIndex: number): number {
  let count = 0;
  for (let y = 88; y <= 94; y += 1) {
    for (let x = 47; x <= 50; x += 1) {
      if (pixels[y]?.[x] === colorIndex) count += 1;
    }
  }
  return count;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";
