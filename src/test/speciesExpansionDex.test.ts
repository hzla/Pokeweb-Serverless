import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POKEDEX_CAUGHT, POKEDEX_SEEN, POKEDEX_SHOWN, editPokedexSave, pokedexFlag, preparePokedexExtension, readPokedexSave,
  registerPokedexSpecies, setNationalPokedex, setPokedexFlag,
} from "../pokeweb/speciesExpansionSaveModel";
import { patchDexSearchCode, searchEntrySpecies } from "../pokeweb/speciesExpansionDexModel";

const save = new Uint8Array(readFileSync(new URL("../assets/testbattle/test.sav", import.meta.url)));
const u32 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset).getUint32(at, true);

describe("Species expansion Pokédex save", () => {
  it("keeps retail's lists for 1-672 and puts 673-1025 in the other languages' area", () => {
    const dex = new Uint8Array(0x4dc).fill(0xaa, 0x328, 0x4d8);
    setPokedexFlag(dex, POKEDEX_CAUGHT, 1);
    setPokedexFlag(dex, POKEDEX_SEEN + 1, 672);
    expect(dex[0x08]).toBe(1);
    expect(dex[0x5c + 0x54 + 83]).toBe(0x80); // seen (female) list, bit 671
    expect(u32(dex, 0x4d4)).not.toBe(0x58445750); // untouched until a number past 672
    setPokedexFlag(dex, POKEDEX_SHOWN, 673);
    expect(u32(dex, 0x4d4)).toBe(0x58445750); // "PWDX"
    expect(dex[0x328 + 5 * 45]).toBe(1); // cleared, then the shown (male) list's first bit
    expect(dex.subarray(0x328, 0x328 + 5 * 45).every((byte) => byte === 0)).toBe(true);
    setPokedexFlag(dex, POKEDEX_SHOWN + 3, 1025);
    expect(dex[0x328 + 8 * 45 + 44]).toBe(1); // bit 352 of the last list: the area's 405 bytes are enough
    expect(pokedexFlag(dex, POKEDEX_SHOWN + 3, 1025)).toBe(true);
    expect(pokedexFlag(dex, POKEDEX_SHOWN + 2, 1025)).toBe(false);
    expect(() => pokedexFlag(dex, POKEDEX_CAUGHT, 1026)).toThrow(/outside/u);
    preparePokedexExtension(dex); // marked: kept
    expect(pokedexFlag(dex, POKEDEX_SHOWN, 673)).toBe(true);
  });

  it("registers added species in a save, keeping the rest of it", () => {
    const edited = editPokedexSave(save, (dex) => {
      setNationalPokedex(dex);
      registerPokedexSpecies(dex, 650, true);
      registerPokedexSpecies(dex, 1023, false);
    });
    expect(edited).toHaveLength(save.length);
    const dex = readPokedexSave(edited);
    expect(u32(dex, 4) & 1).toBe(1);
    expect(u32(dex, 4) >> 10 & 3).toBe(1);
    expect([650, 1023].map((national) => pokedexFlag(dex, POKEDEX_SEEN, national))).toEqual([true, true]);
    expect([650, 1023].map((national) => pokedexFlag(dex, POKEDEX_CAUGHT, national))).toEqual([true, false]);
    expect(pokedexFlag(dex, POKEDEX_SHOWN, 1023)).toBe(true);
    const before = readPokedexSave(save);
    expect([...dex.subarray(0x5c, 0x5c + 0x50)]).toEqual([...before.subarray(0x5c, 0x5c + 0x50)]); // retail's seen 1-640
  });
});

describe("Species expansion Pokédex search", () => {
  // The retail sequences the patch looks for, in a fake overlay.
  const retail = new Uint8Array(64);
  retail.set([0x10, 0x48, 0x09, 0x90, 0x18, 0x30, 0x09, 0x90], 0);
  retail.set([0x3f, 0x21, 0x89, 0x02, 0x08, 0x40, 0x80, 0x01, 0x00, 0x0c], 10);
  retail.set([0xe7, 0x03, 0, 0, 0x89, 0x02, 0, 0, 0xe6, 0x02, 0, 0, 0xff, 0x03, 0, 0], 32);

  it("reads 11-bit species and a longer national list", () => {
    const patched = patchDexSearchCode(retail, 1023);
    expect([...patched.subarray(0, 8)]).toEqual([0xff, 0x20, 0xc0, 0x00, 0x07, 0x30, 0x09, 0x90]); // the ldr of 999 too
    expect([...patched.subarray(10, 20)]).toEqual([0x1f, 0x21, 0xc9, 0x02, 0x08, 0x40, 0x40, 0x01, 0x00, 0x0c]);
    expect([...patched.subarray(36, 38)]).toEqual([0xff, 0x03]); // 1023
    expect([...patched.subarray(44, 46)]).toEqual([0xff, 0x07]);
    expect([...patchDexSearchCode(patched, 1025).subarray(36, 38)]).toEqual([0x01, 0x04]); // again
    expect(() => patchDexSearchCode(new Uint8Array(64), 1023)).toThrow(/not found/u);
    expect(searchEntrySpecies(1060 | 2 << 11)).toBe(1060);
  });
});
