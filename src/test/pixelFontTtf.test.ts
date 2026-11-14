import { describe, expect, it } from "vitest";
import { buildPixelTtf, emboldenGlyph, traceOutline, type PixelGlyph } from "../pokeweb/pixelFontTtf";

const glyph = (rows: string[], code = 65): PixelGlyph => ({
  code,
  advance: rows[0]!.length + 1,
  left: 0,
  width: rows[0]!.length,
  height: rows.length,
  pixels: Uint8Array.from(rows.join("").split("").map((char) => (char === "#" ? 1 : 0))),
});

describe("pixel fonts", () => {
  it("traces a square as one clockwise loop of four corners", () => {
    const [loop, ...rest] = traceOutline(glyph(["##", "##"]), 2);
    expect(rest).toHaveLength(0);
    expect(loop).toHaveLength(4);
    // Shoelace: clockwise in y-up coordinates has a negative signed area.
    const area = loop!.reduce((sum, [x, y], index) => {
      const [nx, ny] = loop![(index + 1) % loop!.length]!;
      return sum + (x * ny - nx * y);
    }, 0);
    expect(area).toBeLessThan(0);
  });

  it("traces a ring as an outer loop and a hole", () => {
    expect(traceOutline(glyph(["###", "#.#", "###"]), 3)).toHaveLength(2);
  });

  it("thickens glyphs one pixel to the right", () => {
    const bold = emboldenGlyph(glyph(["#.", ".#"]));
    expect(bold.width).toBe(3);
    expect([...bold.pixels]).toEqual([1, 1, 0, 0, 1, 1]);
    expect(bold.advance).toBe(4);
  });

  it("writes a TrueType file with the usual tables", () => {
    const buffer = buildPixelTtf({ family: "Test", style: "Regular", ascent: 3, descent: 1, pixelsPerEm: 16, glyphs: [glyph(["###", "#.#", "###", "..."]), { ...glyph(["."], 32), width: 0, pixels: new Uint8Array() }] });
    const view = new DataView(buffer);
    expect(view.getUint32(0)).toBe(0x00010000);
    const tables = Array.from({ length: view.getUint16(4) }, (_, index) => String.fromCharCode(...new Uint8Array(buffer, 12 + index * 16, 4)));
    expect(tables).toEqual(["OS/2", "cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post"]);
  });
});
