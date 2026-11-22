import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { buildExpandedPmcTemplate } from "../pokeweb/pmcHeapRuntime";
import { assertFiveBoxDllCompatible } from "../pokeweb/pmcFiveBoxRuntime";
import { parseRpm, writeRpm } from "../pokeweb/rpm";

const originals = {
  B2: "38a31dd1650b25ccb7dbb942c5bad39527df649022e52935b8ae5ea48ac3dea1",
  W2: "996b9c78ce3f5f8ed943e9a0b315c1e384e93a4fe29c18b6e06c157ea813c16f",
  W2I: "286b4bd96e0acbe82014eb0121ed674fd3618ba6d328b2cd3c300e88779d4dfe",
};
describe("opt-in PMC heap packages", () => {
  it.each(Object.entries(originals))("retains the original %s bundle and derives only the checked cap change", (game, hash) => {
    const bytes = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${game}.rpm`, import.meta.url)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    const before = parseRpm(bytes), snapshot = structuredClone(before), after = buildExpandedPmcTemplate(before);
    expect(before).toEqual(snapshot);
    const allocator = before.symbols.find(s => s.name?.endsWith("CreateSystemAllocatorEv"))!;
    expect(readU16(after.code, allocator.address + 32)).toBe(0x23c8);
    const restored = after.code.slice(); restored[allocator.address + 32] = 160;
    const create = before.symbols.find(s => s.name?.includes("HeapArea8CreateIn"))!;
    restored[create.address + 10] = before.code[create.address + 10]; restored[create.address + 11] = before.code[create.address + 11];
    expect(restored).toEqual(before.code);
    expect(after.symbols).toEqual(before.symbols); expect(after.relocations).toEqual(before.relocations); expect(after.bssSize).toBe(before.bssSize);
    expect(after.metadata.PokewebPmcHeapKiB).toBe(200);
    const bundled = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${game}_200.rpm`, import.meta.url)));
    expect(writeRpm(after)).toEqual(bundled);
  });
  it("rejects unexpected allocator instructions", () => {
    const rpm = parseRpm(new Uint8Array(readFileSync(new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url))));
    rpm.code[rpm.symbols.find(s => s.name?.endsWith("CreateSystemAllocatorEv"))!.address + 36] ^= 1;
    expect(() => buildExpandedPmcTemplate(rpm)).toThrow(/instructions/);
  });
  it.each(["B2", "W2"])("builds the compact %s cap with identical symbols and relocations", game => {
    const input = parseRpm(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${game}.rpm`, import.meta.url))));
    const compact = buildExpandedPmcTemplate(input, 220);
    const regular = buildExpandedPmcTemplate(input);
    const allocator = input.symbols.find(s => s.name?.endsWith("CreateSystemAllocatorEv"))!;
    expect(readU16(compact.code, allocator.address + 32)).toBe(0x23dc);
    expect(compact.symbols).toEqual(regular.symbols);
    expect(compact.relocations).toEqual(regular.relocations);
    expect(compact.bssSize).toBe(regular.bssSize);
    expect(compact.metadata).toMatchObject({ PMCGameID: game, PMCVersion: "13.2.4-heap220", PokewebPmcHeapKiB: 220 });
    expect(writeRpm(compact)).toEqual(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PMC_${game}_220.rpm`, import.meta.url))));
  });
  it("protects the five-box save and PC hooks from conflicting DLLs", () => {
    const dll = (module: string, address: number) => writeRpm({
      code: new Uint8Array(16), bssSize: 0, baseAddress: 0,
      symbols: [{ name: "Patch", size: 8, address: 0, type: "FUNCTION_THM", attributes: 0 }],
      relocations: [{ target: { module, address, type: "FULL_COPY" }, sourceSymbolIndex: 0 }], metadata: {},
    }, { ident: "DLXF" });
    expect(() => assertFiveBoxDllCompatible(dll("ARM9", 0x0203ae78), "patches/Storage.dll")).toThrow(/Storage\.dll/);
    expect(() => assertFiveBoxDllCompatible(dll("255", 0x021bb790), "patches/PC.dll")).toThrow(/PC\.dll/);
    expect(() => assertFiveBoxDllCompatible(dll("ARM9", 0x020073ac), "patches/Other.dll")).not.toThrow();
  });
});
