import { describe, expect, it } from "vitest";
import { renderDescriptionPreview, type DescriptionAssets } from "../pokeweb/descriptionPreview";

function fixture(): DescriptionAssets {
  const glyph = { left: 0, width: 1, advance: 6, pixels: new Uint8Array([1]) };
  return { font: { width: 1, height: 1, maxAdvance: 6, fallback: glyph, glyphs: new Map(Array.from({ length: 224 }, (_, i) => [i + 32, glyph])) }, ink: [[0, 0, 0, 0], [90, 82, 82, 255]], lightInk: [[0, 0, 0, 0], [255, 255, 255, 255]], move: new Uint8ClampedArray(256 * 48 * 4), ability: new Uint8ClampedArray(176 * 48 * 4) };
}
describe("Summary description preview", () => {
  it("preserves three explicit move rows and uses native font advances without wrapping", () => {
    const a = fixture(), r = renderDescriptionPreview(a, "move", "One\\nTwo\nThree");
    expect(r.widths).toEqual([18, 18, 30]); expect(r.warnings).toEqual([]);
    expect([...r.rgba.subarray((32 * 256 + 8) * 4, (32 * 256 + 8) * 4 + 4)]).toEqual(a.ink[1]);
    expect(a.move.every(v => v === 0)).toBe(true);
  });
  it("uses the smaller ability box, reserves its name header and flags third description rows", () => {
    const r = renderDescriptionPreview(fixture(), "ability", "One\\nTwo\\nThree", "Simple");
    expect([r.width, r.height]).toEqual([176, 48]);
    expect(r.warnings).toEqual(["Line 3 is outside the 2-line description box."]);
    expect(r.rgba[(16 * 176 + 8) * 4 + 3]).toBe(255);
  });
  it("reports clipped widths, unsupported glyphs and page controls instead of fitting text silently", () => {
    expect(renderDescriptionPreview(fixture(), "ability", "W".repeat(28)).warnings[0]).toContain("168px exceeds 160px");
    expect(renderDescriptionPreview(fixture(), "move", "W".repeat(41)).warnings[0]).toContain("246px exceeds 240px");
    expect(renderDescriptionPreview(fixture(), "move", "☃").warnings[0]).toContain("Unsupported glyph");
    expect(renderDescriptionPreview(fixture(), "move", "First\\rSecond").warnings[0]).toContain("only the first page");
  });
});
