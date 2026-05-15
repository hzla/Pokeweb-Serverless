import { readAscii } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";

export type ExpandedRigAtlasPatchResult = {
  arm9: Uint8Array;
  patchedAddresses: number[];
  alreadyPatchedAddresses: number[];
};

export type White2ExpandedRigAtlasPatchState = "unpatched" | "patched" | "partial" | "unknown";

const WHITE2_ID_CODE = "IRDO";
const WHITE2_ARM9_RAM_BASE = 0x02004000;
const STRIDE_PATCH_SITES = [0x0201b41c, 0x0201b660] as const;
const TEXTURE_UPLOAD_HOOK_SITE = 0x0201b7a8;
const MOSAIC_SIZE_PATCH_SITES = [0x0201bcde, 0x0201be5c] as const;
const OLD_STRIDE_INSTRUCTION = 0x0380; // lsls r0, r0, #14
const LEGACY_GLOBAL_EXPANDED_STRIDE_INSTRUCTION = 0x03c0; // lsls r0, r0, #15
const OLD_MOSAIC_SIZE_INSTRUCTION = 0x03ad; // lsls r5, r5, #14
const NEW_MOSAIC_SIZE_INSTRUCTION = 0x03ed; // lsls r5, r5, #15
const SDK_NITROCODE_BE = 0xdec00621;
const SDK_NITROCODE_LE = 0x2106c0de;

const SIGNATURE_PREFIX = [0x01, 0x98, 0x39, 0x6b] as const;
const SIGNATURE_SUFFIX = [0x08, 0x18, 0xa8, 0x61] as const;
const TEXTURE_UPLOAD_HOOK_ORIGINAL = [0xa1, 0x69, 0xa3, 0x68] as const;
const MIXED_SLOT_HOOK_PREFIX = [0xf5, 0xb5, 0x25, 0x1c, 0x2e, 0x6a] as const;
const MIXED_SLOT_HOOK_POINTER_LITERAL_OFFSETS = [0x1fc, 0x200, 0x204, 0x208] as const;

// Thumb code injected into ARM9. It hooks TCB_LoadResource after the RGCN has
// been decoded, so it can pack 0x4000/0x8000 MCSS texture uploads into the
// caller's safe texture window instead of globally doubling every slot.
const MIXED_SLOT_HOOK = Uint8Array.of(
  0xf5, 0xb5, 0x25, 0x1c, 0x2e, 0x6a, 0x7d, 0x4f, 0x39, 0x68, 0xb1, 0x42, 0x02, 0xd0, 0x3e, 0x60,
  0x00, 0xf0, 0x69, 0xf8, 0x00, 0xf0, 0x75, 0xf8, 0x02, 0x9d, 0x2e, 0x6a, 0x32, 0x6b, 0xa9, 0x69,
  0x89, 0x1a, 0x8c, 0x0b, 0x01, 0x94, 0x0f, 0x2c, 0x59, 0xd8, 0x28, 0x68, 0x01, 0x69, 0x01, 0x23,
  0x9b, 0x03, 0x99, 0x42, 0x01, 0xd9, 0x02, 0x21, 0x00, 0xe0, 0x01, 0x21, 0x70, 0x4f, 0xa0, 0x00,
  0x00, 0x23, 0x3b, 0x50, 0x6f, 0x4f, 0x3b, 0x50, 0x6f, 0x4f, 0x6b, 0x6a, 0x3b, 0x50, 0x00, 0x20,
  0x6b, 0x4f, 0x6c, 0x4b, 0x00, 0x24, 0x10, 0x2c, 0x11, 0xda, 0xa5, 0x00, 0x7e, 0x59, 0x00, 0x2e,
  0x0b, 0xd0, 0x5d, 0x59, 0xad, 0x1a, 0xad, 0x0b, 0x01, 0x26, 0xae, 0x40, 0x30, 0x43, 0xa5, 0x00,
  0x7d, 0x59, 0x02, 0x2d, 0x01, 0xd1, 0x76, 0x00, 0x30, 0x43, 0x01, 0x34, 0xeb, 0xe7, 0x02, 0x9e,
  0x36, 0x6a, 0x32, 0x6b, 0x08, 0x26, 0x01, 0x23, 0x5b, 0x04, 0x9a, 0x42, 0x03, 0xd3, 0x04, 0x26,
  0x36, 0x04, 0xb6, 0x1a, 0xb6, 0x0b, 0x00, 0x24, 0x63, 0x18, 0xb3, 0x42, 0x0b, 0xd8, 0x01, 0x23,
  0xa3, 0x40, 0x02, 0x29, 0x02, 0xd1, 0x1d, 0x1c, 0x6d, 0x00, 0x2b, 0x43, 0x05, 0x1c, 0x1d, 0x42,
  0x09, 0xd0, 0x01, 0x34, 0xf0, 0xe7, 0x02, 0x29, 0x11, 0xd1, 0x01, 0x21, 0x00, 0x9d, 0x01, 0x23,
  0x9b, 0x03, 0x2b, 0x61, 0xdb, 0xe7, 0x01, 0x23, 0x9b, 0x03, 0x63, 0x43, 0x9b, 0x18, 0x4c, 0x4d,
  0x4c, 0x4e, 0x01, 0x9f, 0xbf, 0x00, 0xe9, 0x51, 0xf3, 0x51, 0x02, 0x9d, 0xab, 0x61, 0x02, 0x9d,
  0xa9, 0x69, 0xab, 0x68, 0xf5, 0xbd, 0x1f, 0xb5, 0x45, 0x48, 0x46, 0x49, 0x46, 0x4a, 0x00, 0x23,
  0x00, 0x24, 0x40, 0x2c, 0x04, 0xda, 0x03, 0x51, 0x0b, 0x51, 0x13, 0x51, 0x04, 0x34, 0xf8, 0xe7,
  0x1f, 0xbd, 0xff, 0xb5, 0x3d, 0x48, 0x00, 0x68, 0x01, 0x69, 0x42, 0x69, 0x3e, 0x4b, 0x3c, 0x4c,
  0x3c, 0x4d, 0x00, 0x26, 0x10, 0x2e, 0x0d, 0xda, 0x8e, 0x42, 0x04, 0xda, 0xb7, 0x00, 0xd0, 0x59,
  0xdf, 0x59, 0xb8, 0x42, 0x04, 0xd0, 0xb7, 0x00, 0x00, 0x20, 0xd8, 0x51, 0xe0, 0x51, 0xe8, 0x51,
  0x01, 0x36, 0xef, 0xe7, 0xff, 0xbd, 0xc0, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x38, 0x01, 0x00, 0x00, 0x3c, 0x01, 0x00, 0x00, 0x7c, 0x01, 0x00, 0x00,
  0xbc, 0x01, 0x00, 0x00,
);

export function patchWhite2ExpandedRigAtlasRom(romBytes: Uint8Array): { rom: Uint8Array; result: ExpandedRigAtlasPatchResult } {
  const headerId = readAscii(romBytes, 12, 4);
  if (headerId !== WHITE2_ID_CODE) {
    throw new Error(`Expected a White 2 ROM (${WHITE2_ID_CODE}), got ${headerId || "unknown"}.`);
  }

  const rom = new NintendoDSRom(romBytes);
  const arm9 = decompressCode(rom.arm9);
  const result = patchWhite2ExpandedRigAtlasArm9(arm9, rom.arm9RamAddress);
  return { rom: rom.save({ arm9: result.arm9 }), result };
}

export function patchWhite2ExpandedRigAtlasArm9(
  arm9: Uint8Array,
  arm9RamAddress = WHITE2_ARM9_RAM_BASE,
): ExpandedRigAtlasPatchResult {
  let out: Uint8Array = arm9.slice();
  const patchedAddresses: number[] = [];
  const alreadyPatchedAddresses: number[] = [];

  const statuses = STRIDE_PATCH_SITES.map((address) => inspectStridePatchSite(out, address, arm9RamAddress));
  for (const site of statuses) {
    if (site.state === "legacy-global-expanded") {
      writeU16Local(out, site.offset, OLD_STRIDE_INSTRUCTION);
      patchedAddresses.push(site.address);
    }
  }

  const hook = inspectTextureUploadHook(out, TEXTURE_UPLOAD_HOOK_SITE, arm9RamAddress);
  if (hook.state === "original") {
    const installed = installMixedSlotHook(out, arm9RamAddress);
    out = installed.arm9;
    patchedAddresses.push(TEXTURE_UPLOAD_HOOK_SITE, installed.hookAddress);
  } else {
    alreadyPatchedAddresses.push(TEXTURE_UPLOAD_HOOK_SITE, hook.hookAddress);
  }

  for (const site of MOSAIC_SIZE_PATCH_SITES.map((address) => inspectMosaicPatchSite(out, address, arm9RamAddress))) {
    if (site.state === "old") {
      writeU16Local(out, site.offset, NEW_MOSAIC_SIZE_INSTRUCTION);
      patchedAddresses.push(site.address);
    } else {
      alreadyPatchedAddresses.push(site.address);
    }
  }

  return {
    arm9: out,
    patchedAddresses,
    alreadyPatchedAddresses,
  };
}

export function detectWhite2ExpandedRigAtlasPatchState(
  arm9: Uint8Array,
  arm9RamAddress = WHITE2_ARM9_RAM_BASE,
): White2ExpandedRigAtlasPatchState {
  try {
    const statuses = STRIDE_PATCH_SITES.map((address) => inspectStridePatchSite(arm9, address, arm9RamAddress).state);
    const hook = inspectTextureUploadHook(arm9, TEXTURE_UPLOAD_HOOK_SITE, arm9RamAddress).state;
    const mosaic = MOSAIC_SIZE_PATCH_SITES.map((address) => inspectMosaicPatchSite(arm9, address, arm9RamAddress).state);
    if (statuses.every((state) => state === "old") && hook === "patched" && mosaic.every((state) => state === "patched")) {
      return "patched";
    }
    if (statuses.every((state) => state === "old") && hook === "original" && mosaic.every((state) => state === "old")) {
      return "unpatched";
    }
    return "partial";
  } catch {
    return "unknown";
  }
}

type PatchSiteStatus = {
  address: number;
  offset: number;
  state: "old" | "legacy-global-expanded";
};

function inspectStridePatchSite(arm9: Uint8Array, address: number, arm9RamAddress: number): PatchSiteStatus {
  const offset = address - arm9RamAddress;
  const signatureOffset = offset - SIGNATURE_PREFIX.length;
  if (signatureOffset < 0 || offset + 2 + SIGNATURE_SUFFIX.length > arm9.length) {
    throw new Error(`White 2 expanded rig atlas patch site ${formatAddress({ address })} is outside ARM9.`);
  }

  for (let i = 0; i < SIGNATURE_PREFIX.length; i += 1) {
    if (arm9[signatureOffset + i] !== SIGNATURE_PREFIX[i]) {
      throw new Error(`White 2 expanded rig atlas signature mismatch before ${formatAddress({ address })}.`);
    }
  }
  for (let i = 0; i < SIGNATURE_SUFFIX.length; i += 1) {
    if (arm9[offset + 2 + i] !== SIGNATURE_SUFFIX[i]) {
      throw new Error(`White 2 expanded rig atlas signature mismatch after ${formatAddress({ address })}.`);
    }
  }

  const instruction = readU16Local(arm9, offset);
  if (instruction === OLD_STRIDE_INSTRUCTION) return { address, offset, state: "old" };
  if (instruction === LEGACY_GLOBAL_EXPANDED_STRIDE_INSTRUCTION) {
    return { address, offset, state: "legacy-global-expanded" };
  }
  throw new Error(
    `White 2 expanded rig atlas patch site ${formatAddress({ address })} has unexpected instruction 0x${instruction
      .toString(16)
      .padStart(4, "0")}.`,
  );
}

type MosaicPatchSiteStatus = {
  address: number;
  offset: number;
  state: "old" | "patched";
};

function inspectMosaicPatchSite(arm9: Uint8Array, address: number, arm9RamAddress: number): MosaicPatchSiteStatus {
  const offset = address - arm9RamAddress;
  if (offset < 0 || offset + 2 > arm9.length) {
    throw new Error(`White 2 mosaic patch site ${formatAddress({ address })} is outside ARM9.`);
  }

  const instruction = readU16Local(arm9, offset);
  if (instruction === OLD_MOSAIC_SIZE_INSTRUCTION) return { address, offset, state: "old" };
  if (instruction === NEW_MOSAIC_SIZE_INSTRUCTION) return { address, offset, state: "patched" };
  throw new Error(
    `White 2 mosaic patch site ${formatAddress({ address })} has unexpected instruction 0x${instruction
      .toString(16)
      .padStart(4, "0")}.`,
  );
}

type TextureUploadHookStatus =
  | { state: "original"; address: number; offset: number }
  | { state: "patched"; address: number; offset: number; hookAddress: number };

function inspectTextureUploadHook(arm9: Uint8Array, address: number, arm9RamAddress: number): TextureUploadHookStatus {
  const offset = address - arm9RamAddress;
  if (offset < 0 || offset + TEXTURE_UPLOAD_HOOK_ORIGINAL.length > arm9.length) {
    throw new Error(`White 2 mixed rig slot hook site ${formatAddress({ address })} is outside ARM9.`);
  }

  if (bytesEqual(arm9, offset, TEXTURE_UPLOAD_HOOK_ORIGINAL)) {
    return { state: "original", address, offset };
  }

  const hookAddress = decodeThumbBlTarget(arm9, offset, address);
  if (hookAddress === undefined) {
    throw new Error(`White 2 mixed rig slot hook site ${formatAddress({ address })} does not contain the expected code.`);
  }

  const hookOffset = hookAddress - arm9RamAddress;
  if (hookOffset < 0 || hookOffset + MIXED_SLOT_HOOK_PREFIX.length > arm9.length) {
    throw new Error(`White 2 mixed rig slot hook target ${formatAddress({ address: hookAddress })} is outside ARM9.`);
  }
  if (!bytesEqual(arm9, hookOffset, MIXED_SLOT_HOOK_PREFIX)) {
    throw new Error(`White 2 mixed rig slot hook target ${formatAddress({ address: hookAddress })} has an unexpected signature.`);
  }

  return { state: "patched", address, offset, hookAddress };
}

function installMixedSlotHook(
  arm9: Uint8Array,
  arm9RamAddress: number,
): { arm9: Uint8Array; hookAddress: number } {
  const hookOffset = findStaticBssEndOffset(arm9, arm9RamAddress) ?? align(arm9.length, 4);
  const hookAddress = arm9RamAddress + hookOffset;
  const hook = relocatedMixedSlotHook(hookAddress);
  const out = new Uint8Array(hookOffset + hook.length);
  out.set(arm9);
  out.set(hook, hookOffset);
  writeThumbBl(out, TEXTURE_UPLOAD_HOOK_SITE - arm9RamAddress, TEXTURE_UPLOAD_HOOK_SITE, hookAddress);
  return { arm9: out, hookAddress };
}

function findStaticBssEndOffset(arm9: Uint8Array, arm9RamAddress: number): number | undefined {
  for (let offset = 0; offset + 36 <= arm9.length; offset += 4) {
    if (readU32Local(arm9, offset + 28) !== SDK_NITROCODE_BE || readU32Local(arm9, offset + 32) !== SDK_NITROCODE_LE) {
      continue;
    }
    const bssStart = readU32Local(arm9, offset + 12);
    const bssEnd = readU32Local(arm9, offset + 16);
    if (bssStart < arm9RamAddress || bssEnd < bssStart || bssEnd > 0x02400000) continue;
    const hookOffset = align(bssEnd - arm9RamAddress, 4);
    if (hookOffset < arm9.length) continue;
    return hookOffset;
  }
  return undefined;
}

function relocatedMixedSlotHook(hookAddress: number): Uint8Array {
  const hook = MIXED_SLOT_HOOK.slice();
  for (const offset of MIXED_SLOT_HOOK_POINTER_LITERAL_OFFSETS) {
    writeU32Local(hook, offset, hookAddress + readU32Local(hook, offset));
  }
  return hook;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function bytesEqual(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  for (let i = 0; i < expected.length; i += 1) {
    if (data[offset + i] !== expected[i]) return false;
  }
  return true;
}

function readU16Local(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function writeU16Local(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

function readU32Local(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function writeU32Local(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function writeThumbBl(data: Uint8Array, offset: number, fromAddress: number, toAddress: number): void {
  const delta = toAddress - (fromAddress + 4);
  if (delta % 2 !== 0 || delta < -0x400000 || delta > 0x3ffffe) {
    throw new Error(`White 2 mixed rig slot hook target ${formatAddress({ address: toAddress })} is out of BL range.`);
  }

  writeU16Local(data, offset, 0xf000 | ((delta >> 12) & 0x7ff));
  writeU16Local(data, offset + 2, 0xf800 | ((delta >> 1) & 0x7ff));
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number | undefined {
  const high = readU16Local(data, offset);
  const low = readU16Local(data, offset + 2);
  if ((high & 0xf800) !== 0xf000 || (low & 0xf800) !== 0xf800) return undefined;

  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return (fromAddress + 4 + delta) >>> 0;
}

function formatAddress(site: Pick<PatchSiteStatus, "address">): string {
  return `0x${site.address.toString(16).toUpperCase().padStart(8, "0")}`;
}
