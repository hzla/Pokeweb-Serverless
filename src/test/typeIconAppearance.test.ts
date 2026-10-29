import { describe, expect, it } from "vitest";
import { typeIconBorderRgb555, typeIconBorderHex, typeIconPreview } from "../pokeweb/typeIconAppearance";

describe("type icon appearance previews", () => {
  it.each(["letters", "circular"] as const)("recolors only the %s borders", style => {
    const before = decodeURIComponent(typeIconPreview(style, "#101010"));
    const after = decodeURIComponent(typeIconPreview(style, "#00ff00"));
    expect(after).toContain('fill="#00ff00"');
    expect(after.replaceAll('fill="#00ff00"', 'fill="#101010"')).toBe(before);
    expect(after).toContain('fill="#f7f7f7"');
  });
  it("uses the same DS color precision for preview and installation", () => {
    expect(typeIconBorderRgb555("#d6d6d6")).toBe(0x6b5a);
    expect(typeIconBorderHex(typeIconBorderRgb555("#123456"))).toBe("#103152");
    expect(typeIconPreview("letters", "#123456")).toContain(encodeURIComponent('#103152'));
    expect(() => typeIconBorderRgb555("red")).toThrow(/border color/u);
  });
});
