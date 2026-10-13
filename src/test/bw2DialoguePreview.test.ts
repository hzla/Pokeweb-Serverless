import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { layoutBw2Dialogue, parseBw2DialogueFont, renderBw2DialoguePage, type DialogueFont, type DialogueAssets } from "../pokeweb/bw2DialoguePreview";

function fontFixture(): Uint8Array {
  const bytes = new Uint8Array(130);
  const stamp = (at: number, value: string) => bytes.set(Array.from(value, (char) => char.charCodeAt(0)), at);
  stamp(0, "RTFN"); stamp(16, "FNIF"); writeU32(bytes, 32, 52); writeU32(bytes, 40, 84);
  stamp(44, "PLGC"); writeU32(bytes, 48, 32);
  bytes.set([2, 2, 4, 0, 0, 2, 2, 0], 52);
  bytes.set([0xff, 2, 3, 0x18, 0, 2, 8, 0x54, 0, 2, 6, 0xa8, 0, 0, 2, 0], 60);
  stamp(76, "PAMC"); writeU32(bytes, 80, 24); writeU16(bytes, 84, 65); writeU16(bytes, 86, 66); writeU32(bytes, 92, 108);
  stamp(100, "PAMC"); writeU32(bytes, 104, 30); writeU16(bytes, 108, 0); writeU16(bytes, 110, 0xffff); writeU16(bytes, 112, 2); writeU32(bytes, 116, 138);
  writeU16(bytes, 120, 2); writeU16(bytes, 122, 63); writeU16(bytes, 124, 2); writeU16(bytes, 126, 87); writeU16(bytes, 128, 1);
  return bytes;
}
function metrics(): DialogueFont {
  const glyph = { left: 0, width: 1, advance: 6, pixels: new Uint8Array([1]) };
  return { width: 1, height: 1, maxAdvance: 10, fallback: glyph, glyphs: new Map(Array.from({ length: 95 }, (_, index) => [32 + index, glyph])) };
}

describe("BW2 native dialogue font and layout preview", () => {
  it("decodes inline glyph metrics, packed pixels, direct/sparse maps and the retail catch-all end pointer", () => {
    const font = parseBw2DialogueFont(fontFixture());
    expect(font.glyphs.get(65)).toMatchObject({ left: -1, width: 2, advance: 3, pixels: new Uint8Array([0, 1, 2, 0]) });
    expect(font.glyphs.get(87)?.advance).toBe(8);
    expect(font.fallback.advance).toBe(6);
    expect(font.maxAdvance).toBe(8);
    const table = fontFixture(); writeU16(table, 88, 1); writeU16(table, 96, 1); writeU16(table, 98, 0xffff);
    expect(parseBw2DialogueFont(table).glyphs.has(66)).toBe(false);
    expect(parseBw2DialogueFont(table).glyphs.get(65)?.advance).toBe(8);
  });
  it("rejects truncated glyphs, invalid mapping indices, unsupported cell formats and cyclic maps", () => {
    expect(() => parseBw2DialogueFont(fontFixture().subarray(0, 70))).toThrow(/truncated/);
    const invalid = fontFixture(); writeU16(invalid, 96, 40);
    expect(() => parseBw2DialogueFont(invalid)).toThrow(/invalid glyph/);
    const format = fontFixture(); format[58] = 4;
    expect(() => parseBw2DialogueFont(format)).toThrow(/glyph format/);
    const cycle = fontFixture(); writeU32(cycle, 116, 84);
    expect(() => parseBw2DialogueFont(cycle)).toThrow(/character map/);
  });
  it("keeps explicit line breaks, clears pages and consumes the newline immediately after a page/scroll pause", () => {
    const result = layoutBw2Dialogue("One\\nTwo\\r\\nThree\\nFour\\f\\nFive", metrics());
    expect(result.pages.map((page) => page.widths)).toEqual([[18, 18], [30, 24], [24, 24]]);
    expect(result.pages[2].glyphs.filter((glyph) => glyph.y === 0).map((glyph) => String.fromCharCode(glyph.code)).join("")).toBe("Four");
    expect(result.pages[2].glyphs.filter((glyph) => glyph.y === 16).map((glyph) => String.fromCharCode(glyph.code)).join("")).toBe("Five");
    expect(result.warnings).toEqual([]);
    expect(layoutBw2Dialogue("End\\r", metrics()).pages).toHaveLength(1);
    expect(layoutBw2Dialogue("One\\nTwo\\f", metrics()).pages).toHaveLength(1);
  });
  it("uses maximum-length placeholders at the widest native advance, with a conservative fallback for unidentified word buffers", () => {
    const known = layoutBw2Dialogue("VAR(256, 1): Hello", metrics(), { 1: { label: "rival name", length: 7 } });
    expect(known.pages[0].glyphs.filter((glyph) => glyph.placeholder)).toHaveLength(7);
    expect(known.pages[0].widths[0]).toBe(112);
    expect(known.variables).toEqual([{ slot: 1, length: 7, label: "rival name" }]);
    const unknown = layoutBw2Dialogue("VAR(256, 2)", metrics());
    expect(unknown.variables[0].length).toBe(64);
    expect(unknown.warnings[0]).toContain("640px exceeds 232px");
  });
  it("flags clipped lines and third rows, handles positioning controls and does not silently wrap or simulate unsupported controls", () => {
    const long = layoutBw2Dialogue(`${"W".repeat(40)}\\nSecond\\nThird`, metrics());
    expect(long.pages).toHaveLength(1);
    expect(long.warnings).toContain("Page 1, line 1: 240px exceeds 232px by 8px.");
    expect(long.warnings.some((warning) => warning.includes("line 3 is below"))).toBe(true);
    expect(layoutBw2Dialogue("A VAR(48389, 10)B", metrics()).pages[0].widths[0]).toBe(16);
    expect(layoutBw2Dialogue("VAR(48386, 0)A", metrics()).warnings[0]).toContain("not simulated");
    expect(() => layoutBw2Dialogue("VAR(", metrics())).toThrow(/Unclosed/);
  });
  it("renders ROM tile colors, flipped corners, glyph pixels, and continuation-arrow colors within the native box", () => {
    const font = metrics(), palette = Array.from({ length: 16 }, (_, index) => [index, index + 1, index + 2, 255] as [number, number, number, number]);
    const assets: DialogueAssets = { font, frame: Array.from({ length: 6 }, () => new Uint8Array(64).fill(2)), framePalette: palette, fontPalette: palette, arrow: new Uint8Array(64).fill(3), arrowPalette: palette };
    assets.frame[1][0] = 0;
    const rgba = renderBw2DialoguePage(assets, layoutBw2Dialogue("A", font).pages[0]);
    const pixel = (x: number, y: number) => [...rgba.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4)];
    expect(rgba).toHaveLength(256 * 48 * 4);
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(255, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(16, 8)).toEqual(palette[1]);
    expect(pixel(20, 20)).toEqual(palette[15]);
    expect(pixel(240, 32)).toEqual(palette[3]);
  });
});
