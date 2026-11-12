import { describe, expect, it } from "vitest";
import { RETAIL_TYPE_ICON_PALETTES, typeIconPalettes } from "../pokeweb/typeIconPalettes";

describe("type icon palettes", () => {
  const arm9With = (table: number[]) => {
    const arm9 = new Uint8Array(4096).fill(9);
    arm9.set([...table, 1, 1, 2, 0], 1000);
    return arm9;
  };

  it("reads a hack's Fairy palette from the ARM9 table", () => {
    expect(typeIconPalettes(arm9With([...RETAIL_TYPE_ICON_PALETTES.slice(0, 17), 2]))[17]).toBe(2);
  });

  it("keeps the retail table when the ROM has the retail table or none", () => {
    expect(typeIconPalettes(arm9With(RETAIL_TYPE_ICON_PALETTES))).toEqual(RETAIL_TYPE_ICON_PALETTES);
    expect(typeIconPalettes(new Uint8Array(64))).toEqual(RETAIL_TYPE_ICON_PALETTES);
    expect(typeIconPalettes(undefined)).toEqual(RETAIL_TYPE_ICON_PALETTES);
  });
});
