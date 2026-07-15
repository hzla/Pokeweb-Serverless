import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import {
  compileMoveBackgroundImage,
  createEmptyMoveBackgroundFiles,
  type MoveBackgroundFiles,
  type MoveBackgroundSourceImage,
} from "../pokeweb/moveBackgroundCompiler";
import { parseNitroBackground } from "../pokeweb/nitroBg";

describe("moveBackgroundCompiler", () => {
  it("creates an empty, game-format background triplet", () => {
    const files = createEmptyMoveBackgroundFiles(makeTemplates());
    const background = parseNitroBackground(267, files.screen, files.characters, files.palette, {
      paletteBankOffset: 8,
      transparentIndexZero: true,
    });

    expect(stamp(files.screen)).toBe("RCSN");
    expect(stamp(files.characters)).toBe("RGCN");
    expect(stamp(files.palette)).toBe("RLCN");
    expect(background).toMatchObject({ datId: 267, width: 512, height: 512, hasTransparency: true });
    expect(background.indexed.tilePixels).toHaveLength(1024);
    expect(background.indexed.palette).toHaveLength(96);
    expect(background.rgba.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
  });

  it("cover-fits a PNG-like image without duplicating it outside the initial viewport", () => {
    const source = makeGradient(700, 500);
    const compiled = compileMoveBackgroundImage(267, source, makeTemplates());

    expect(compiled.report).toMatchObject({
      sourceWidth: 700,
      sourceHeight: 500,
      viewportWidth: 256,
      viewportHeight: 192,
      mapWidth: 512,
      mapHeight: 512,
      paletteBankCount: 6,
    });
    expect(compiled.report.uniqueTileCount).toBeLessThanOrEqual(769);
    expect(compiled.report.usedPaletteBankCount).toBeGreaterThan(1);
    expect(compiled.background.indexed.bitsPerPixel).toBe(4);
    const paletteBanks = new Set(Array.from(compiled.background.indexed.entries, (entry) => entry >>> 12));
    expect([...paletteBanks].every((bank) => bank >= 8 && bank <= 13)).toBe(true);
    expect(pixelAt(compiled.background.rgba, 512, 24, 24)[3]).toBe(255);
    expect(pixelAt(compiled.background.rgba, 512, 280, 24)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(compiled.background.rgba, 512, 24, 216)).toEqual([0, 0, 0, 0]);
  });
});

function makeTemplates(): MoveBackgroundFiles {
  const screen = new Uint8Array(36 + 64 * 64 * 2);
  writeNnsHeader(screen, "RCSN");
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, screen.length - 16);
  writeU16(screen, 24, 512);
  writeU16(screen, 26, 512);
  writeU32(screen, 32, 64 * 64 * 2);

  const characters = new Uint8Array(48 + 1024 * 32);
  writeNnsHeader(characters, "RGCN");
  writeAscii(characters, 16, "RAHC");
  writeU32(characters, 20, characters.length - 16);
  writeU16(characters, 24, 32);
  writeU16(characters, 26, 32);
  writeU32(characters, 28, 3);
  writeU32(characters, 40, 1024 * 32);

  const palette = new Uint8Array(40 + 96 * 2);
  writeNnsHeader(palette, "RLCN");
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 24, 3);
  writeU32(palette, 32, 96 * 2);
  return { screen, characters, palette };
}

function writeNnsHeader(bytes: Uint8Array, stampValue: string): void {
  writeAscii(bytes, 0, stampValue);
  writeU16(bytes, 4, 0xfeff);
  writeU16(bytes, 6, 1);
  writeU32(bytes, 8, bytes.length);
  writeU16(bytes, 12, 16);
  writeU16(bytes, 14, 1);
}

function makeGradient(width: number, height: number): MoveBackgroundSourceImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 150 + Math.round((x / width) * 80);
      pixels[offset + 1] = 45 + Math.round((y / height) * 150);
      pixels[offset + 2] = 190 + Math.round((y / height) * 60);
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  return Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
}

function stamp(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.subarray(0, 4));
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}
