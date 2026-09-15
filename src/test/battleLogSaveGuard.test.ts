import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { battleLogSaveGuard, patchBattleLogGeonet } from "../pokeweb/battleLogSaveGuard";
import { parseRpm } from "../pokeweb/rpm";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const getBits = (record: Uint8Array, start: number, count: number) => {
  let value = 0;
  for (let i = 0; i < count; i++) value |= ((record[(start+i) >> 3]! >> ((start+i)&7)) & 1) << i;
  return value;
};
const geonet = (data: Uint8Array) => data.map((value) => {
  for (let bit = 0; bit < 8; bit += 2) if (((value >> bit) & 3) === 1) value = (value & ~(3 << bit)) | (2 << bit);
  return value;
});

describe("exclusive battle-log save ownership", () => {
  for (const version of ["W2", "B2", "W", "B"] as const) {
    const guard = battleLogSaveGuard(version);
    it(`${version}: has three resident hooks, stripped symbols and the verified application allocator`, () => {
      const dll = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${guard.filename}`, import.meta.url)));
      const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
      expect(rpm.bssSize).toBe(4);
      expect(dll.length + rpm.bssSize).toBeLessThan(1024);
      expect(rpm.symbols.every((symbol) => symbol.name === null)).toBe(true);
      const hooks = rpm.relocations.filter((relocation) => relocation.target.module !== "base");
      expect(hooks.map((hook) => hook.target)).toEqual(guard.hooks.map((hook) => ({
        module: "ARM9", address: hook.address | 1, type: "THUMB_BRANCH",
      })));
      // BW1 allocator is ARM, BW2 is Thumb. Preserve the instruction-set bit.
      const address = guard.imports[0]!.address | (version.endsWith("2") ? 1 : 0);
      const literal = Buffer.alloc(4); literal.writeUInt32LE(address);
      expect(Buffer.from(rpm.code).includes(literal)).toBe(true);
      for (const hook of hooks) expect(rpm.symbols[hook.sourceSymbolIndex]!.address & ~1).toBeLessThan(rpm.code.length);
    });
    it(`${version}: daily guard is exact, idempotent, reversible and rejects foreign bytes`, () => {
      const original = bytes(guard.daily.expectedHex);
      const result = patchBattleLogGeonet(original, guard.daily.address, version);
      expect(result).toEqual(bytes(guard.daily.disabledHex));
      expect(original).toEqual(bytes(guard.daily.expectedHex));
      expect(patchBattleLogGeonet(result, guard.daily.address, version)).toEqual(result);
      expect(patchBattleLogGeonet(result, guard.daily.address, version, true)).toEqual(original);
      expect(() => patchBattleLogGeonet(new Uint8Array(16), guard.daily.address, version)).toThrow(/signature/);
    });
  }

  it("reproduces Geonet spilling a KO into a previously zero death field", () => {
    const record = new Uint8Array(14);
    // Enemy slot six KO is credited to player slot four: bits 88..90 = 100.
    record[11] = 4;
    expect(getBits(record, 91, 3)).toBe(0);
    expect(getBits(geonet(record), 91, 3)).toBe(1);
    // Geonet cannot manufacture set bits from an entirely zero region.
    expect(geonet(new Uint8Array(14))).toEqual(new Uint8Array(14));
  });
});
