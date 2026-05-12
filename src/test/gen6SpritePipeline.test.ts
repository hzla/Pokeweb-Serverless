import { describe, expect, it } from "vitest";
import { decodePng, type AnimationAnalysisFrame } from "../pokeweb/pokemonAnimationAnalysis";
import {
  offsetForVariant,
  paletteToPngBytes,
  parseCsv,
  parseGen6SpriteCsv,
  buildPlaceholderRig,
  prepareStaticSprites,
  slugifyPokemonName,
  variantFileName,
} from "../pokeweb/gen6SpritePipeline";

describe("gen6SpritePipeline", () => {
  it("parses downloadable CSV rows after the Gen 6 header and assigns compact sprite IDs", () => {
    const csv = [
      ",,Front,Back,Front-shiny,Back-shiny,Animator,QC",
      "Gen 6 Pokemon,,,,,,,",
      "650,Chespin,,,,,Antiant (reserved),",
      "651,Quilladin,https://example.test/651.gif,https://example.test/651b.gif,https://example.test/651s.gif,,Antiant,",
      "Primal Reversion,,,,,,,",
      "382,Kyogre-primal,unchanged,,https://example.test/382s.gif,,Someone,",
      "Other Forms,,,,,,,",
      "025,\"Pikachu-Ph. D\",,,,https://example.test/pika.gif,,",
    ].join("\n");

    const assets = parseGen6SpriteCsv(csv);

    expect(assets).toHaveLength(3);
    expect(assets.map((asset) => asset.spriteId)).toEqual([1, 2, 3]);
    expect(assets[0]).toMatchObject({
      speciesId: 651,
      name: "Quilladin",
      slug: "quilladin",
      urls: {
        front: "https://example.test/651.gif",
        back: "https://example.test/651b.gif",
        "front-shiny": "https://example.test/651s.gif",
      },
    });
    expect(assets[1]!.urls).toEqual({ "front-shiny": "https://example.test/382s.gif" });
    expect(assets[2]!.slug).toBe("pikachu-ph-d");
  });

  it("handles quoted CSV fields, names, filenames, and offsets", () => {
    expect(parseCsv("1,\"A, B\",https://example.test/a.gif\n")).toEqual([["1", "A, B", "https://example.test/a.gif"]]);
    expect(slugifyPokemonName("Pikachu-Ph. D")).toBe("pikachu-ph-d");
    expect(variantFileName("quilladin", "front-shiny")).toBe("quilladin-front-shiny.gif");
    expect(offsetForVariant({ quilladin: { front: { x: 2, y: -1 }, "front-shiny": { x: 5 } } }, "quilladin", "front")).toEqual({ x: 2, y: -1 });
    expect(offsetForVariant({ quilladin: { front: { x: 2, y: -1 }, "front-shiny": { x: 5 } } }, "quilladin", "front-shiny")).toEqual({ x: 5 });
  });

  it("builds normal static sprites and derives shiny palettes from matching shiny frames", () => {
    const front = makeFrame(2, 1);
    setPixel(front, 0, 0, [10, 20, 30, 255]);
    setPixel(front, 1, 0, [40, 50, 60, 255]);
    const shiny = makeFrame(2, 1);
    setPixel(shiny, 0, 0, [100, 110, 120, 255]);
    setPixel(shiny, 1, 0, [130, 140, 150, 255]);

    const prepared = prepareStaticSprites({ front, frontShiny: shiny });

    expect(prepared.images.front).toMatchObject({ width: 2, height: 1 });
    expect(prepared.normalPalette[0]).toEqual({ r: 255, g: 0, b: 255 });
    expect(prepared.normalPalette[1]).toMatchObject({ r: expect.any(Number), g: expect.any(Number), b: expect.any(Number) });
    expect(prepared.shinyPalette?.[1]).not.toEqual(prepared.normalPalette[1]);
    expect(prepared.shinyPalette?.[2]).not.toEqual(prepared.normalPalette[2]);
    expect(decodePng(paletteToPngBytes(prepared.normalPalette))).toMatchObject({ width: 16, height: 1 });
  });

  it("quantizes oversized static palettes and reports missing shiny sources", () => {
    const front = makeFrame(20, 1);
    for (let index = 0; index < 17; index += 1) setPixel(front, index, 0, [index * 11, index * 7, index * 3, 255]);

    const prepared = prepareStaticSprites({ front });
    const usedColors = new Set<string>();
    for (let offset = 0; offset < prepared.images.front!.pixels.length; offset += 4) {
      if ((prepared.images.front!.pixels[offset + 3] ?? 0) > 0) {
        usedColors.add(`${prepared.images.front!.pixels[offset]},${prepared.images.front!.pixels[offset + 1]},${prepared.images.front!.pixels[offset + 2]}`);
      }
    }

    expect(usedColors.size).toBeLessThanOrEqual(15);
    expect(prepared.warnings).toContain("Static sprite colors were quantized for the 15 opaque color Gen 5 limit");
    expect(prepared.shinyPalette).toBeUndefined();
  });

  it("builds a one-cell placeholder rig with a bobbing default animation", () => {
    const source = makeFrame(96, 96);
    setPixel(source, 10, 20, [1, 2, 3, 255]);

    const placeholder = buildPlaceholderRig({ width: 96, height: 96, pixels: source.pixels });

    expect(placeholder.rig).toMatchObject({ width: 256, height: 128 });
    expect(Array.from(placeholder.rig.pixels.slice((20 * 256 + 10) * 4, (20 * 256 + 10) * 4 + 4))).toEqual([1, 2, 3, 255]);
    expect(placeholder.part).toMatchObject({ cellX: 0, cellY: 0, width: 96, height: 96, spriteX: -48, spriteY: 96, pivot: { x: 48, y: 48 } });
    expect(placeholder.part.frames.map((frame) => frame.y)).toEqual([0, -2, 0, 2]);
  });
});

function makeFrame(width: number, height: number): AnimationAnalysisFrame {
  return { index: 0, width, height, delayMs: 100, pixels: new Uint8ClampedArray(width * height * 4) };
}

function setPixel(frame: AnimationAnalysisFrame, x: number, y: number, color: [number, number, number, number]): void {
  frame.pixels.set(color, (y * frame.width + x) * 4);
}
