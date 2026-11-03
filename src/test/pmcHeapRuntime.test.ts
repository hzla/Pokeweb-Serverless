import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { buildExpandedPmcTemplate } from "../pokeweb/pmcHeapRuntime";
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
});
