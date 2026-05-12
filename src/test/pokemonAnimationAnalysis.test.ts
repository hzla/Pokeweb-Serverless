import { describe, expect, it } from "vitest";
import {
  analyzeMotion,
  analyzePalette,
  decodeGifFrames,
  decodePng,
  encodePng,
  normalizeAnimationFrames,
  palettePng,
  quantizeFrames,
  type AnimationAnalysisFrame,
} from "../pokeweb/pokemonAnimationAnalysis";

describe("pokemonAnimationAnalysis", () => {
  it("decodes a tiny GIF fixture", () => {
    const bytes = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const frames = decodeGifFrames(bytes);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ width: 1, height: 1 });
  });

  it("normalizes visible content into a centered 96x96-style crop", () => {
    const source = makeFrame(32, 32);
    fillRect(source, 10, 12, 4, 4, [255, 80, 40, 255]);

    const normalized = normalizeAnimationFrames([source], 16);

    expect(normalized.contentBounds).toEqual({ x: 10, y: 12, width: 4, height: 4 });
    expect(normalized.cropBounds).toEqual({ x: 4, y: 6, width: 16, height: 16 });
    expect(normalized.frames[0]!.width).toBe(16);
    expect(pixelAt(normalized.frames[0]!, 6, 6)).toEqual([255, 80, 40, 255]);
  });

  it("applies crop offsets as visible sprite translations", () => {
    const source = makeFrame(32, 32);
    fillRect(source, 10, 12, 4, 4, [255, 80, 40, 255]);

    const normalized = normalizeAnimationFrames([source], 16, { x: 2, y: -1 });

    expect(normalized.cropBounds).toEqual({ x: 2, y: 7, width: 16, height: 16 });
    expect(pixelAt(normalized.frames[0]!, 8, 5)).toEqual([255, 80, 40, 255]);
  });

  it("validates Gen 5 palette compatibility and quantizes oversized palettes", () => {
    const frame = makeFrame(20, 1);
    for (let index = 0; index < 17; index += 1) setPixel(frame, index, 0, [index * 10, index * 5, index * 3, 255]);

    const report = analyzePalette([frame]);
    const quantized = quantizeFrames([frame]);
    const quantizedReport = analyzePalette(quantized.frames);
    const paletteImage = decodePng(palettePng(quantized.palette));

    expect(report.compatible).toBe(false);
    expect(report.opaqueColorCount).toBe(17);
    expect(quantized.palette.length).toBeLessThanOrEqual(15);
    expect(quantizedReport.compatible).toBe(true);
    expect(pixelAt(paletteImage, 0, 0)).toEqual([255, 0, 255, 255]);
    expect(pixelAt(paletteImage, 1, 0)[3]).toBe(255);
  });

  it("reports simple translation-like motion and new/disappearing pixels", () => {
    const base = makeFrame(8, 8, 0);
    const moved = makeFrame(8, 8, 1);
    setPixel(base, 1, 1, [200, 10, 10, 255]);
    setPixel(moved, 2, 1, [200, 10, 10, 255]);

    const motion = analyzeMotion([base, moved]);

    expect(motion.report.perFrame[1]).toMatchObject({
      frame: 1,
      changedPixelCount: 2,
      newPixelCount: 1,
      disappearedPixelCount: 1,
    });
    expect(motion.report.warnings).toContain("Some frames contain pixels that are transparent in frame 0; extra rig art may be needed");
    expect(motion.report.warnings).toContain("Some frame-0 pixels disappear later; occlusion or alternate cells may be needed");
  });

  it("round-trips PNG frames for bundle writing", () => {
    const frame = makeFrame(4, 4);
    setPixel(frame, 2, 3, [1, 2, 3, 255]);

    const decoded = decodePng(encodePng(frame), 7, 80);

    expect(decoded).toMatchObject({ index: 7, width: 4, height: 4, delayMs: 80 });
    expect(pixelAt(decoded, 2, 3)).toEqual([1, 2, 3, 255]);
  });
});

function makeFrame(width: number, height: number, index = 0): AnimationAnalysisFrame {
  return { index, width, height, delayMs: 100, pixels: new Uint8ClampedArray(width * height * 4) };
}

function fillRect(frame: AnimationAnalysisFrame, x: number, y: number, width: number, height: number, color: [number, number, number, number]): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(frame, px, py, color);
  }
}

function setPixel(frame: AnimationAnalysisFrame, x: number, y: number, color: [number, number, number, number]): void {
  frame.pixels.set(color, (y * frame.width + x) * 4);
}

function pixelAt(frame: AnimationAnalysisFrame, x: number, y: number): [number, number, number, number] {
  const offset = (y * frame.width + x) * 4;
  return [frame.pixels[offset]!, frame.pixels[offset + 1]!, frame.pixels[offset + 2]!, frame.pixels[offset + 3]!];
}
