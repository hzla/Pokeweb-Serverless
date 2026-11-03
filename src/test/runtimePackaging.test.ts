import { describe, expect, it } from "vitest";
import { strToU8, zlibSync } from "fflate";
import { decodeAbilityRecipeBook, encodeAbilityRecipeBook } from "../pokeweb/abilityRecipeBook";
import { cloneRpm, parseRpm, stripRpmPrivateSymbolNames, writeRpm, type RpmModule } from "../pokeweb/rpm";

describe("runtime packaging", () => {
  it("round trips legacy and compressed ability metadata, including Unicode and nested conditions", () => {
    const entries = [[255, { effects: [{ kind: "attack", value: 2.5 }], conditions: { kind: "group", mode: "any", children: [{ kind: "weather", value: 3 }] }, label: "Pokémon 雪" }]];
    const packed = encodeAbilityRecipeBook(entries);
    expect(packed.startsWith("z1:")).toBe(true);
    expect(decodeAbilityRecipeBook(packed)).toEqual(entries);
    expect(decodeAbilityRecipeBook(JSON.stringify(entries))).toEqual(entries);
    expect(encodeAbilityRecipeBook(decodeAbilityRecipeBook(packed))).toBe(packed);
    const catalog = Array.from({ length: 255 }, (_, i) => [i + 1, entries[0][1]]);
    expect(encodeAbilityRecipeBook(catalog).length).toBeLessThan(JSON.stringify(catalog).length / 4);
  });
  it("rejects malformed and oversized compressed metadata before parsing recipes", () => {
    for (const value of ["z1:!", "z1:YQ==", "{", "z1:" + "A".repeat(65536)]) expect(() => decodeAbilityRecipeBook(value)).toThrow();
    const oversized = "x".repeat(1024 * 1024 + 1);
    expect(() => encodeAbilityRecipeBook(oversized)).toThrow(/bound/);
    const compressed = zlibSync(strToU8(oversized));
    let binary = ""; for (const byte of compressed) binary += String.fromCharCode(byte);
    expect(() => decodeAbilityRecipeBook(`z1:${btoa(binary)}`)).toThrow();
  });
  it("strips only private names while preserving link keys, relocation records and editor sections", () => {
    const rpm: RpmModule = {
      code: new Uint8Array(64), bssSize: 16, baseAddress: 0, metadata: { PMCModulePriority: 4 },
      symbols: [
        { name: "privateHelper", address: 0, size: 4, type: "FUNCTION_THM", attributes: 0 },
        { name: "MoveRecipeConfig", address: 32, size: 16, type: "SECTION", attributes: 0 },
        { name: "publicEntry", address: 4, size: 4, type: "FUNCTION_THM", attributes: 1 },
        { name: "sharedImport", address: 123, size: 0, type: "FUNCTION_THM", attributes: 2 },
      ],
      relocations: [0, 1, 2, 3].map((sourceSymbolIndex, n) => ({ target: { module: "base", address: 16 + n * 4, type: "OFFSET" }, sourceSymbolIndex })),
    };
    const before = parseRpm(writeRpm(cloneRpm(rpm), { ident: "DLXF" }), { allowedMagics: ["DLXF"] });
    stripRpmPrivateSymbolNames(rpm, ["MoveRecipeConfig"]);
    const after = parseRpm(writeRpm(rpm, { ident: "DLXF" }), { allowedMagics: ["DLXF"] });
    expect(after.code).toEqual(before.code); expect(after.bssSize).toBe(before.bssSize);
    expect(after.relocations).toEqual(before.relocations);
    expect(after.symbols).toEqual(before.symbols.map(s => ({ ...s, name: s.name === "privateHelper" ? null : s.name })));
    expect(after.symbols.find(s => s.name === "publicEntry")?.nameHash).toBe(before.symbols.find(s => s.name === "publicEntry")?.nameHash);
  });
});
