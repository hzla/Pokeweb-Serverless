import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { configureBundledBgmRuntime, readBgmRuntimeConfig, type BgmRuntimeMapping } from "../pokeweb/pmcModel";
import { parseRpm, setRpmBaseAddress, updateRpmCodeImageForBase, writeRpm } from "../pokeweb/rpm";

const dll = (version: "B2" | "W2") => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/BgmToggle${version}.dll`, import.meta.url)));
const mappings: BgmRuntimeMapping[] = Array.from({ length: 161 }, (_, index) => ({
  targetSequenceId: 1000 + index, streamId: index + 1, originalSequenceFileId: 100 + index,
  shadowFileId: 5000 + index * 2, streamFileId: 5001 + index * 2,
}));
const configSymbol = (rpm: ReturnType<typeof parseRpm>) => rpm.symbols.find((symbol) => symbol.nameHash === 0x59ce771e)!;

describe("variable-length BGM runtime configuration", () => {
  beforeEach(() => vi.stubGlobal("fetch", async (url: URL) => new Response(dll(url.pathname.includes("B2") ? "B2" : "W2"))));
  afterEach(() => vi.unstubAllGlobals());

  it.each(["B2", "W2"] as const)("round-trips 161 %s mappings, materializes BSS, and preserves all relocation addresses", async (version) => {
    const original = parseRpm(dll(version), { allowedMagics: ["DLXF"] });
    const configured = await configureBundledBgmRuntime(version, { shortcutEnabled: true, mappings: [...mappings].reverse() });
    expect(readBgmRuntimeConfig(configured)).toMatchObject({ abiVersion: 2, shortcutEnabled: true, mappings });
    const rpm = parseRpm(configured, { allowedMagics: ["DLXF"] });
    expect(rpm.bssSize).toBe(0);
    expect(rpm.code.subarray(original.code.length, original.code.length + original.bssSize)).toEqual(new Uint8Array(original.bssSize));
    expect(rpm.symbols).toEqual(original.symbols);
    expect(rpm.relocations).toEqual(original.relocations);
    const offset = configSymbol(rpm).address;
    expect(offset + readU32(rpm.code, offset + 8)).toBeGreaterThanOrEqual(original.code.length + original.bssSize);
    // Resolve the unchanged relocation graph at an actual DS RAM address.
    setRpmBaseAddress(rpm, 0x02300000);
    setRpmBaseAddress(original, 0x02300000);
    updateRpmCodeImageForBase(rpm);
    updateRpmCodeImageForBase(original);
    for (const relocation of original.relocations.filter((entry) => entry.target.module === "base")) {
      const at = relocation.target.address & ~1;
      expect(rpm.code.slice(at, at + 4)).toEqual(original.code.slice(at, at + 4));
    }
  });

  it("detects legacy ABI 1 mappings for migration", () => {
    const rpm = parseRpm(dll("W2"), { allowedMagics: ["DLXF"] });
    const symbol = configSymbol(rpm);
    const at = symbol.address;
    symbol.size = 24;
    writeU16(rpm.code, at + 4, 1);
    writeU16(rpm.code, at + 6, 3);
    const entry = mappings[0]!;
    [entry.targetSequenceId, entry.streamId, entry.originalSequenceFileId, entry.shadowFileId, entry.streamFileId].forEach((id, index) => writeU16(rpm.code, at + 8 + index * 2, id));
    writeU16(rpm.code, at + 18, 24);
    writeU32(rpm.code, at + 20, 0x31474250);
    expect(readBgmRuntimeConfig(writeRpm(rpm, { ident: "DLXF" }))).toMatchObject({ abiVersion: 1, shortcutEnabled: true, mappings: [entry] });
  });

  it.each(["table", "offset", "count", "stride", "marker"])("rejects a corrupt %s without accepting a partial mapping", async (field) => {
    const configured = await configureBundledBgmRuntime("W2", { shortcutEnabled: false, mappings });
    const rpm = parseRpm(configured, { allowedMagics: ["DLXF"] });
    const at = configSymbol(rpm).address;
    if (field === "table") rpm.code[at + readU32(rpm.code, at + 8) + 2] ^= 1;
    if (field === "offset") writeU32(rpm.code, at + 8, 0xfffffff0);
    if (field === "count") writeU16(rpm.code, at + 12, 0xffff);
    if (field === "stride") writeU16(rpm.code, at + 14, 12);
    if (field === "marker") writeU32(rpm.code, at + 20, 0);
    expect(readBgmRuntimeConfig(writeRpm(rpm, { ident: "DLXF" }))).toBeUndefined();
  });

  it("rejects duplicate IDs and native sentinel IDs", async () => {
    await expect(configureBundledBgmRuntime("W2", { shortcutEnabled: false, mappings: [mappings[0]!, mappings[0]!] })).rejects.toThrow(/duplicate/u);
    await expect(configureBundledBgmRuntime("W2", { shortcutEnabled: false, mappings: [{ ...mappings[0]!, streamId: 0xffff }] })).rejects.toThrow(/16 bits/u);
  });
});
