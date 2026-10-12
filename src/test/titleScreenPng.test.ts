import { describe, expect, it } from "vitest";
import { resizeTitlePng, titlePngPlacement, type TitlePngImage } from "../pokeweb/titleScreenPng";

const image: TitlePngImage = { width: 4, height: 2, rgba: Uint8ClampedArray.from({ length: 32 }, (_, i) => i % 4 === 3 ? 255 : i % 4 === 0 ? 248 : 0) };
describe("title PNG fitting and cropping", () => {
  it("scales the complete wide image without stretching and adds transparent padding", () => {
    const result = resizeTitlePng(image, { width: 8, height: 8 }, { mode: "fit", x: .5, y: .5, zoom: 1 });
    expect(result.rgba.slice(0, 8 * 2 * 4).every((v) => v === 0)).toBe(true);
    expect(result.rgba[(2 * 8) * 4 + 3]).toBe(255);
    expect(result.rgba[(5 * 8 + 7) * 4 + 3]).toBe(255);
    expect(result.rgba.slice(8 * 6 * 4).every((v) => v === 0)).toBe(true);
  });
  it("allows direct scaling to fill the required canvas", () => {
    const result = resizeTitlePng(image, { width: 8, height: 8 }, { mode: "stretch", x: .5, y: .5, zoom: 1 });
    expect(result.rgba.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
  });
  it("lets users move and zoom a crop while keeping its aspect ratio", () => {
    const target = { width: 256, height: 192 }, source = { width: 1000, height: 600 };
    const left = titlePngPlacement(source, target, { mode: "crop", x: 0, y: 0, zoom: 1 });
    const right = titlePngPlacement(source, target, { mode: "crop", x: 1, y: 1, zoom: 1 });
    expect(left.sw / left.sh).toBeCloseTo(4 / 3); expect(left.sx).toBe(0); expect(right.sx).toBeCloseTo(200);
    const zoomed = titlePngPlacement(source, target, { mode: "crop", x: 1, y: 1, zoom: 2 });
    expect(zoomed.sw).toBeCloseTo(400); expect(zoomed.sh).toBeCloseTo(300); expect(zoomed.sx).toBeCloseTo(600); expect(zoomed.sy).toBeCloseTo(300);
  });
  it("filters transparent edges without dark halos", () => {
    const source = { width: 2, height: 1, rgba: Uint8Array.of(248, 0, 0, 255, 0, 0, 0, 0) };
    const resized = resizeTitlePng(source, { width: 3, height: 1 }, { mode: "stretch", x: .5, y: .5, zoom: 1 });
    expect([...resized.rgba.slice(4, 8)]).toEqual([248, 0, 0, 128]);
  });
  it("preserves exact native pixels when dimensions already match", () => {
    expect(resizeTitlePng(image, image, { mode: "fit", x: .5, y: .5, zoom: 1 }).rgba).toEqual(image.rgba);
  });
});
