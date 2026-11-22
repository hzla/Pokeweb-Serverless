import { describe, expect, it } from "vitest";
import { hackMarkImage } from "../mastersheetViewer/hackMarks";
import table from "../assets/data/vanillaWhite2Stats.json";
import { vanillaMove, vanillaPokemonKey, vanillaPokemonStats } from "../pokeweb/vanillaWhite2Stats";

describe("vanilla White 2 numbers", () => {
  it("finds Pokémon, their forms and moves by name, however they are written", () => {
    expect(vanillaPokemonStats(table, "PIKACHU")).toEqual({ hp: 35, atk: 55, def: 30, spa: 50, spd: 40, spe: 90 });
    expect(vanillaPokemonStats(table, "Deoxys", 1)?.atk).toBe(180);
    expect(vanillaPokemonKey("Farfetch'd")).toBe("farfetchd");
    expect(vanillaMove(table, "Hyper Beam")).toEqual({ power: 150, accuracy: 90, pp: 5 });
    expect(vanillaMove(table, "Chilling Water")).toBeUndefined();
  });
});

describe("hack marks", () => {
  it("letters NEW! and CHANGED! in the start menu's style", () => {
    const fresh = hackMarkImage("new"), changed = hackMarkImage("changed");
    expect([fresh.width, fresh.height]).toEqual([31, 10]);
    expect([changed.width, changed.height]).toEqual([61, 10]);
    // The top-left corner is clear, the outline starts beside it, and the first letter's top row is its darkest shade.
    const at = (x: number, y: number) => Array.from(fresh.pixels.subarray((y * fresh.width + x) * 4, (y * fresh.width + x) * 4 + 4));
    expect(at(0, 0)).toEqual([0x48, 0x20, 0x20, 255]);
    expect(at(1, 1)).toEqual([0xb0, 0x28, 0x28, 255]);
    expect(at(1, 4)).toEqual([0xf8, 0x50, 0x50, 255]);
  });
});
