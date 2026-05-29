import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { findArm9ModuleParamsOffset, repairDecompressedArm9CompressionMetadata } from "../nds/arm9ModuleParams";

describe("ARM9 module params", () => {
  it("zeros stale compression metadata on decompressed ARM9 data", () => {
    const arm9 = makeArm9WithModuleParams(0x020738a4);

    expect(findArm9ModuleParamsOffset(arm9)).toBe(0xfb0);
    expect(repairDecompressedArm9CompressionMetadata(arm9)).toBe(true);
    expect(readU32(arm9, 0xfb0 + 0x14)).toBe(0);
  });

  it("leaves already-uncompressed metadata alone", () => {
    const arm9 = makeArm9WithModuleParams(0);

    expect(repairDecompressedArm9CompressionMetadata(arm9)).toBe(false);
    expect(readU32(arm9, 0xfb0 + 0x14)).toBe(0);
  });
});

function makeArm9WithModuleParams(compressedStaticEnd: number): Uint8Array {
  const arm9 = new Uint8Array(0x6000);
  const moduleParamsOffset = 0xfb0;
  writeU32(arm9, moduleParamsOffset + 0x14, compressedStaticEnd);
  arm9.set([0x21, 0x06, 0xc0, 0xde, 0xde, 0xc0, 0x06, 0x21], moduleParamsOffset + 0x1c);
  return arm9;
}
