import { describe, expect, it } from "vitest";
import {
  compileGifToPwan,
  parsePwanHeader,
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
  scalePwanFrames,
  scalePwanTimelineSpeed,
  scalePwanTimelineToFps,
  shiftPwanFrames,
  tileIndexedPixels,
  tilePwanSegmentedPixels,
} from "../pokeweb/pwanCompiler";

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
