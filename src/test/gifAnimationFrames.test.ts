import { describe, expect, it } from "vitest";
import { decodeGifFrames, quantizeFrames, type AnimationAnalysisFrame } from "../pokeweb/gifAnimationFrames";

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

  it("applies a Graphic Control Extension separated from its image by a comment (ezgif)", () => {
    // 2x1: palette {black, red}; GCE (transparent index 0, 100 ms), a comment, then the image [0, 1].
    const gif = Uint8Array.of(
      ...new TextEncoder().encode("GIF89a"), 2, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xf8, 0, 0,
      0x21, 0xf9, 4, 1, 10, 0, 0, 0,
      0x21, 0xfe, 2, 0x68, 0x69, 0,
      0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, 0x44, 0x0a, 0,
      0x3b,
    );
    const [frame] = decodeGifFrames(gif);
    expect(frame!.delayMs).toBe(100);
    expect(Array.from(frame!.pixels)).toEqual([0, 0, 0, 0, 248, 0, 0, 255]);
  });
});
