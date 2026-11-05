import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaults, moveButton, neighbor, swapButtons, validate } from "../nativeUi/document";
import { configureCompanion, needsCompanion } from "../nativeUi/model";
import { parseRpm } from "../pokeweb/rpm";
import { readU16, readU32 } from "../nds/binary";

describe("Native menu editing", () => {
  it("moves the artwork, icon, text and touch target together when exchanging commands", () => {
    const design = defaults(), a = design.buttons[0], b = design.buttons[5];
    swapButtons(a, b);
    expect(a).toMatchObject({ id: 1, x: 128, y: 120, iconX: 160, iconY: 140, labelX: 176, labelY: 128, touch: { x: 136, y: 120 } });
    expect(b).toMatchObject({ id: 6, x: 0, y: 24, iconX: 32, iconY: 44, labelX: 48, labelY: 32 });
    expect(validate(design)).toEqual([]); expect(needsCompanion(design)).toBe(true);
  });
  it("clamps group movement before it reaches the status bar or footer", () => {
    const b = defaults().buttons[0]; moveButton(b, -32, -80);
    expect([b.x, b.y, b.labelX, b.labelY]).toEqual([0, 24, 48, 32]);
  });
  it("resolves directional overrides, hidden targets and Close", () => {
    const design = defaults();
    expect(neighbor(design, 1, "right")).toBe(2);
    design.buttons[0].neighbors.right = 6;
    expect(neighbor(design, 1, "right")).toBe(6);
    expect(neighbor(design, 1, "right", [1, 2, 3, 4, 5, 7])).toBe(2);
    expect(neighbor(design, 6, "down")).toBe(7);
  });
  it("refuses overlapping touch areas, unrelated palette writes and unknown art", () => {
    const design = defaults(); design.buttons[1].touch = { ...design.buttons[0].touch }; design.colors["0:1"] = "#ff0000";
    expect(validate(design)).toEqual(expect.arrayContaining([expect.stringContaining("overlapping"), expect.stringContaining("palette")]));
  });
  it("keeps animated icon bounds clear of the fixed controls", () => {
    const design = defaults(); design.buttons[0].iconY = 141;
    expect(validate(design)).toContain("Pokémon: the animated icon must stay within the button area.");
  });
  it("disables the native adapter when restoring the imported retail layout", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../assets/codeinjection/UiScreensW2.dll", import.meta.url)));
    const module = parseRpm(configureCompanion(bytes, defaults()), { allowedMagics: ["DLXF"] });
    let found = false;
    for (let at = 0; at + 420 <= module.code.length; at += 4) if (readU32(module.code, at) === 0x49555750 && readU16(module.code, at + 6) === 420) { expect(readU32(module.code, at + 8)).toBe(0); found = true; }
    expect(found).toBe(true);
  });
  it("does not mutate a borrowed Node buffer when configuring a module", () => {
    const bytes = readFileSync(new URL("../assets/codeinjection/UiScreensW2.dll", import.meta.url)), before = Buffer.from(bytes), design = defaults();
    design.buttons[0].label = "TEAM";
    configureCompanion(bytes, design);
    expect(bytes.equals(before)).toBe(true);
  });
  it.each(["B2", "W2"])("configures the shipped %s native module without changing its hook targets", game => {
    const bytes = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/UiScreens${game}.dll`, import.meta.url)));
    const before = parseRpm(bytes, { allowedMagics: ["DLXF"] }), d = defaults();
    swapButtons(d.buttons[0], d.buttons[5]); d.buttons[0].label = "PARTY"; d.buttons[0].neighbors.left = 7;
    const result = parseRpm(configureCompanion(bytes, d), { allowedMagics: ["DLXF"] });
    expect(result.relocations).toEqual(before.relocations); expect(result.metadata.PMCGameID).toBe(game);
    expect(result.relocations.filter(r => r.target.module === "36")).toHaveLength(6);
    let at = -1;
    for (let i = 0; i + 420 <= result.code.length; i += 4) if (readU32(result.code, i) === 0x49555750 && readU16(result.code, i + 6) === 420) at = i;
    expect(at).toBeGreaterThanOrEqual(0); expect(readU32(result.code, at + 8)).toBe(1);
    expect([...result.code.subarray(at + 12, at + 24)]).toEqual([1, 192, 140, 160, 140, 22, 16, 1, 120, 160, 136, 248]);
    expect(readU16(result.code, at + 28)).toBe("P".charCodeAt(0)); expect(readU16(result.code, at + 38)).toBe(0xffff);
    for (let i = 0; i < result.code.length; i++) if (i < at + 8 || i >= at + 420) expect(result.code[i]).toBe(before.code[i]);
  });
});
