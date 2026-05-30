import { describe, expect, it } from "vitest";
import {
  compileGifToPwan,
  parsePwanHeader,
  pwanFirstFramePixels,
  pwanPalette,
  PWAN_FRAME_BYTES,
  PWAN_HEIGHT,
  PWAN_PALETTE_COLORS,
  PWAN_WIDTH,
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
});

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";
