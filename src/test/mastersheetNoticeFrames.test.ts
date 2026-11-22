import { describe, expect, it } from "vitest";
import { noticeFrameVars } from "../mastersheetViewer/noticeFrames";

const svg = (vars: Record<string, string>) => decodeURIComponent(vars["--notice-frame"]!.slice('url("data:image/svg+xml,'.length, -2));
const fills = (vars: Record<string, string>) => [...svg(vars).matchAll(/fill="(#[0-9a-f]{6})"/gu)].map((match) => match[1]);

describe("notice frames", () => {
  it("draws the game's signs in their own palettes, tan when no colour is given", () => {
    expect(fills(noticeFrameVars("sign"))).toEqual(expect.arrayContaining(["#181818", "#bd9c63", "#9c7342", "#845a21", "#734208", "#ffdebd", "#ffdead"]));
    expect(fills(noticeFrameVars("sign", "#427b9c"))).toEqual(expect.arrayContaining(["#084a73", "#215a84", "#427b9c", "#7badd6", "#addeff"]));
    expect(noticeFrameVars("sign")["--notice-slice"]).toBe("8 10 7 10");
    expect(noticeFrameVars("sign")["--notice-width"]).toBe("16px 20px 14px 20px");
  });

  it("draws the light system message in its greys, and in a colour's shades when given one", () => {
    expect(fills(noticeFrameVars("system")).sort()).toEqual(["#000000", "#525252", "#c6c6c6", "#ffffff"]);
    const purple = fills(noticeFrameVars("system", "#af74b3"));
    expect(purple).toContain("#ffffff");
    expect(purple).not.toContain("#525252");
  });

  it("shades any colour like the game's signs: its hue, the game's lightness", () => {
    const red = noticeFrameVars("sign", "#f26253");
    const [fill] = fills(red).filter((colour) => colour !== "#181818").slice(-1);
    expect(fill).toMatch(/^#ff/u);
    // A grey gives a grey sign, as the game's rose-grey one is nearly.
    expect(fills(noticeFrameVars("sign", "#777777")).every((colour) => colour!.slice(1, 3) === colour!.slice(3, 5) && colour!.slice(3, 5) === colour!.slice(5, 7))).toBe(true);
    // Shorthand reads as the same colour.
    expect(noticeFrameVars("sign", "#fff")).toEqual(noticeFrameVars("sign", "#ffffff"));
  });
});
