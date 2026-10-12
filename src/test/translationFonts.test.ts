import { describe, expect, it } from "vitest";
import { readU32, writeU16 } from "../nds/binary";
import { adaptTranslationNumericFont } from "../pokeweb/translationFonts";
import { numericFontFixture } from "./fixtures/numericFont";

describe("US numeric-font layout", () => {
  it("repackages 11-pixel glyphs into US cells while preserving numeric glyphs and all US metrics/tables", () => {
    const original = numericFontFixture(13), incoming = numericFontFixture(11, true);
    const before = incoming.slice(), output = adaptTranslationNumericFont(original, incoming);
    expect(output.length).toBe(original.length);
    expect(output.subarray(0, 60)).toEqual(original.subarray(0, 60));
    expect(output.subarray(44 + readU32(original, 48))).toEqual(original.subarray(44 + readU32(original, 48)));
    for (let glyph = 0; glyph < 32; glyph++) {
      expect(output.subarray(60 + glyph * 29, 63 + glyph * 29)).toEqual(original.subarray(60 + glyph * 29, 63 + glyph * 29));
      if (glyph !== 15) expect(output.subarray(60 + glyph * 29, 60 + (glyph + 1) * 29)).toEqual(original.subarray(60 + glyph * 29, 60 + (glyph + 1) * 29));
    }
    expect(output.subarray(63 + 15 * 29, 60 + 16 * 29)).not.toEqual(original.subarray(63 + 15 * 29, 60 + 16 * 29));
    expect(incoming).toEqual(before);
  });
  it("imports custom glyph artwork that already uses US-sized cells", () => {
    const source = numericFontFixture(13), donor = numericFontFixture(13, true);
    const result = adaptTranslationNumericFont(source, donor);
    expect(result.subarray(63 + 15 * 29, 60 + 16 * 29)).toEqual(donor.subarray(63 + 15 * 29, 60 + 16 * 29));
    expect(result.subarray(60 + 15 * 29, 63 + 15 * 29)).toEqual(source.subarray(60 + 15 * 29, 63 + 15 * 29));
  });
  it("rejects glyph-ID drift, incompatible geometry and truncated resources", () => {
    const source = numericFontFixture(13), donor = numericFontFixture(11);
    const map = donor.length - 152; writeU16(donor, map + 24, 9);
    expect(() => adaptTranslationNumericFont(source, donor)).toThrow("character-to-glyph IDs");
    expect(() => adaptTranslationNumericFont(source, numericFontFixture(14))).toThrow("cell geometry");
    expect(() => adaptTranslationNumericFont(source, numericFontFixture(11).slice(0, -1))).toThrow("block layout");
  });
});
