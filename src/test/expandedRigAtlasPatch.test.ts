import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { detectWhite2ExpandedRigAtlasPatchState, patchWhite2ExpandedRigAtlasArm9, patchWhite2ExpandedRigAtlasRom } from "../pokeweb/expandedRigAtlasPatch";

const ARM9_BASE = 0x02004000;
const STRIDE_ADDRESSES = [0x0201b41c, 0x0201b660] as const;
const TEXTURE_UPLOAD_HOOK_SITE = 0x0201b7a8;
const MOSAIC_SIZE_ADDRESSES = [0x0201bcde, 0x0201be5c] as const;
const OLD_STRIDE_INSTRUCTION = 0x0380;
const LEGACY_GLOBAL_EXPANDED_STRIDE_INSTRUCTION = 0x03c0;
const OLD_MOSAIC_SIZE_INSTRUCTION = 0x03ad;
const NEW_MOSAIC_SIZE_INSTRUCTION = 0x03ed;
const TEXTURE_UPLOAD_HOOK_ORIGINAL = [0xa1, 0x69, 0xa3, 0x68] as const;
const MIXED_SLOT_HOOK_PREFIX = [0xf5, 0xb5, 0x25, 0x1c, 0x2e, 0x6a] as const;
const SDK_NITROCODE_BE = 0xdec00621;
const SDK_NITROCODE_LE = 0x2106c0de;

describe("White 2 expanded rig atlas patch", () => {
  it("installs the mixed-size MCSS texture slot hook and mosaic size patch", () => {
    const arm9 = makeArm9();

    const result = patchWhite2ExpandedRigAtlasArm9(arm9);

    expect(result.patchedAddresses).toContain(TEXTURE_UPLOAD_HOOK_SITE);
    for (const address of MOSAIC_SIZE_ADDRESSES) expect(result.patchedAddresses).toContain(address);
    expect(result.alreadyPatchedAddresses).toEqual([]);
    for (const address of STRIDE_ADDRESSES) {
      expect(readU16(result.arm9, address - ARM9_BASE)).toBe(OLD_STRIDE_INSTRUCTION);
    }
    for (const address of MOSAIC_SIZE_ADDRESSES) {
      expect(readU16(result.arm9, address - ARM9_BASE)).toBe(NEW_MOSAIC_SIZE_INSTRUCTION);
    }

    const hookAddress = decodeThumbBlTarget(result.arm9, TEXTURE_UPLOAD_HOOK_SITE - ARM9_BASE, TEXTURE_UPLOAD_HOOK_SITE);
    expect(hookAddress).toBeGreaterThan(ARM9_BASE + arm9.length - 1);
    expect([...result.arm9.slice(hookAddress - ARM9_BASE, hookAddress - ARM9_BASE + MIXED_SLOT_HOOK_PREFIX.length)]).toEqual([
      ...MIXED_SLOT_HOOK_PREFIX,
    ]);
  });

  it("accepts already-patched ARM9 data", () => {
    const arm9 = makeArm9();
    const once = patchWhite2ExpandedRigAtlasArm9(arm9);

    const result = patchWhite2ExpandedRigAtlasArm9(once.arm9);

    expect(result.patchedAddresses).toEqual([]);
    expect(result.arm9.length).toBe(once.arm9.length);
    expect(result.alreadyPatchedAddresses).toContain(TEXTURE_UPLOAD_HOOK_SITE);
    for (const address of MOSAIC_SIZE_ADDRESSES) expect(result.alreadyPatchedAddresses).toContain(address);
  });

  it("converts the old global-stride patch back to vanilla stride before installing the hook", () => {
    const arm9 = makeArm9();
    for (const address of STRIDE_ADDRESSES) {
      writeU16(arm9, address - ARM9_BASE, LEGACY_GLOBAL_EXPANDED_STRIDE_INSTRUCTION);
    }

    const result = patchWhite2ExpandedRigAtlasArm9(arm9);

    for (const address of STRIDE_ADDRESSES) {
      expect(readU16(result.arm9, address - ARM9_BASE)).toBe(OLD_STRIDE_INSTRUCTION);
      expect(result.patchedAddresses).toContain(address);
    }
  });

  it("places the hook after static BSS when module params are present", () => {
    const arm9 = makeArm9();
    const bssEnd = ARM9_BASE + arm9.length + 0x1000;
    writeModuleParams(arm9, 0x100, ARM9_BASE + arm9.length - 0x400, bssEnd);

    const result = patchWhite2ExpandedRigAtlasArm9(arm9);

    const hookAddress = decodeThumbBlTarget(result.arm9, TEXTURE_UPLOAD_HOOK_SITE - ARM9_BASE, TEXTURE_UPLOAD_HOOK_SITE);
    expect(hookAddress).toBe(bssEnd);
    expect(result.arm9.length).toBeGreaterThan(bssEnd - ARM9_BASE);
  });

  it("detects unpatched, patched, partial, and unknown ARM9 states", () => {
    const unpatched = makeArm9();
    const patched = patchWhite2ExpandedRigAtlasArm9(makeArm9()).arm9;
    const partial = makeArm9();
    const unknown = makeArm9();
    writeU16(partial, MOSAIC_SIZE_ADDRESSES[0] - ARM9_BASE, NEW_MOSAIC_SIZE_INSTRUCTION);
    unknown[STRIDE_ADDRESSES[0] - ARM9_BASE - 1] ^= 0xff;

    expect(detectWhite2ExpandedRigAtlasPatchState(unpatched)).toBe("unpatched");
    expect(detectWhite2ExpandedRigAtlasPatchState(patched)).toBe("patched");
    expect(detectWhite2ExpandedRigAtlasPatchState(partial)).toBe("partial");
    expect(detectWhite2ExpandedRigAtlasPatchState(unknown)).toBe("unknown");
  });

  it("rejects a hook site mismatch", () => {
    const arm9 = makeArm9();
    arm9[TEXTURE_UPLOAD_HOOK_SITE - ARM9_BASE] ^= 0xff;

    expect(() => patchWhite2ExpandedRigAtlasArm9(arm9)).toThrow(/hook site/u);
  });

  it("rejects a mosaic size instruction mismatch", () => {
    const arm9 = makeArm9();
    writeU16(arm9, MOSAIC_SIZE_ADDRESSES[0] - ARM9_BASE, 0x46c0);

    expect(() => patchWhite2ExpandedRigAtlasArm9(arm9)).toThrow(/mosaic patch site/u);
  });

  it("rejects non-White 2 ROMs", () => {
    const rom = makeRom("IREO", makeArm9());

    expect(() => patchWhite2ExpandedRigAtlasRom(rom)).toThrow(/Expected a White 2 ROM/u);
  });

  it("rejects signature mismatches", () => {
    const arm9 = makeArm9();
    arm9[STRIDE_ADDRESSES[0] - ARM9_BASE - 1] ^= 0xff;

    expect(() => patchWhite2ExpandedRigAtlasArm9(arm9)).toThrow(/signature mismatch/u);
  });
});

function makeArm9(): Uint8Array {
  const arm9 = new Uint8Array(0x20000);
  for (const address of STRIDE_ADDRESSES) {
    const offset = address - ARM9_BASE;
    arm9.set([0x01, 0x98, 0x39, 0x6b], offset - 4);
    writeU16(arm9, offset, OLD_STRIDE_INSTRUCTION);
    arm9.set([0x08, 0x18, 0xa8, 0x61], offset + 2);
  }
  arm9.set(TEXTURE_UPLOAD_HOOK_ORIGINAL, TEXTURE_UPLOAD_HOOK_SITE - ARM9_BASE);
  for (const address of MOSAIC_SIZE_ADDRESSES) writeU16(arm9, address - ARM9_BASE, OLD_MOSAIC_SIZE_INSTRUCTION);
  return arm9;
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number {
  const high = readU16(data, offset);
  const low = readU16(data, offset + 2);
  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return (fromAddress + 4 + delta) >>> 0;
}

function writeModuleParams(arm9: Uint8Array, offset: number, bssStart: number, bssEnd: number): void {
  writeU32(arm9, offset + 12, bssStart);
  writeU32(arm9, offset + 16, bssEnd);
  writeU32(arm9, offset + 28, SDK_NITROCODE_BE);
  writeU32(arm9, offset + 32, SDK_NITROCODE_LE);
}

function makeRom(idCode: string, arm9: Uint8Array): Uint8Array {
  const out = new Uint8Array(0x4000 + arm9.length + 0x400);
  out.set([...idCode].map((char) => char.charCodeAt(0)), 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x28, ARM9_BASE);
  writeU32(out, 0x2c, arm9.length);
  writeU32(out, 0x30, 0x4000 + arm9.length);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x4000 + arm9.length + 4);
  writeU32(out, 0x44, 0);
  writeU32(out, 0x48, 0x4000 + arm9.length + 4);
  writeU32(out, 0x4c, 0);
  writeU32(out, 0x50, 0x4000 + arm9.length + 4);
  writeU32(out, 0x54, 0);
  writeU32(out, 0x58, 0x4000 + arm9.length + 4);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set(arm9, 0x4000);
  return out;
}
