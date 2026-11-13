import { describe, expect, it } from "vitest";
import { menuLabelImage } from "../pokeweb/gen5MenuFont";

describe("baked main menu font", () => {
  it("draws capitals at the game's advance widths and line height", () => {
    const image = menuLabelImage("ROM UPLOAD");
    expect(image.height).toBe(15);
    expect(image.width).toBeGreaterThan(40);
    expect(image.pixels.length).toBe(image.width * image.height * 4);
    // Some pixels are the white letter ink, some the grey shadow.
    const colours = new Set<string>();
    for (let i = 0; i < image.pixels.length; i += 4) if (image.pixels[i + 3]) colours.add(image.pixels.slice(i, i + 3).join(","));
    expect(colours).toEqual(new Set(["248,248,248", "88,88,88"]));
  });

  it("prints lower case as capitals and unknown characters as ?", () => {
    expect(menuLabelImage("about").width).toBe(menuLabelImage("ABOUT").width);
    expect(menuLabelImage("ж").width).toBe(menuLabelImage("?").width);
  });
});
