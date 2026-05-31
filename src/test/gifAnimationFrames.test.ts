import { describe, expect, it } from "vitest";
import { quantizeFrames, type AnimationAnalysisFrame } from "../pokeweb/gifAnimationFrames";

describe("gifAnimationFrames", () => {
  it("quantizes dense frames without overflowing the JavaScript call stack", () => {
    const pixels = new Uint8ClampedArray(96 * 96 * 24 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const pixel = offset / 4;
      pixels[offset] = pixel & 0xff;
      pixels[offset + 1] = (pixel * 3) & 0xff;
      pixels[offset + 2] = (pixel * 7) & 0xff;
      pixels[offset + 3] = 255;
    }
    const frame: AnimationAnalysisFrame = {
      index: 0,
      width: 96,
      height: 96 * 24,
      delayMs: 100,
      pixels,
    };

    const result = quantizeFrames([frame], 15);

    expect(result.palette).toHaveLength(15);
  });
});
