import { readU16, readU32, writeU16 } from "../nds/binary";
import type { BaseVersion } from "./constants";

export type TrainerNaturePatchState = "patched" | "unpatched" | "unsupported" | "unknown";

export type TrainerNatureArm9PatchResult = {
  status: "applied" | "already-applied";
  arm9: Uint8Array;
  offset: number;
  hookAddress: number;
};

type TrainerNaturePatchSite = {
  address: number;
  original: readonly number[];
  patchedPrefix: readonly number[];
};

type TrainerNaturePatchConfig = {
  setupAddress: number;
  expForLevelAddress: number;
  setParamAddress: number;
  recalcStatsAddress: number;
  sites: TrainerNaturePatchSite[];
};

const BW2_ARM9_RAM_BASE = 0x02004000;
const SDK_NITROCODE_BE = 0xdec00621;
const SDK_NITROCODE_LE = 0x2106c0de;
const PF_EXP = 0x08;
const PF_NATURE = 0x70;

const SITE1_ORIGINAL = [
  0x0d, 0x9a, 0x0d, 0x9b, 0xd2, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0xe6, 0xf9,
] as const;
const SITE2_ORIGINAL = [
  0x09, 0x98, 0x01, 0x01, 0x1a, 0x98, 0x43, 0x18, 0xda, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c,
  0x00, 0xf0, 0x67, 0xf9,
] as const;
const SITE3_ORIGINAL = [
  0x0c, 0x9a, 0x0c, 0x9b, 0xd2, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0xd9, 0xf8,
] as const;
const SITE4_ORIGINAL = [0xfa, 0x88, 0x7b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0x50, 0xf8] as const;

const SITE1_PATCH_PREFIX = [0x0d, 0x9a, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46, 0xc0, 0x46] as const;
const SITE2_PATCH_PREFIX = [
  0x09, 0x9a, 0x12, 0x01, 0x1a, 0x98, 0x82, 0x18, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46,
] as const;
const SITE3_PATCH_PREFIX = [0x0c, 0x9a, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46, 0xc0, 0x46] as const;
const SITE4_PATCH_PREFIX = [0x3a, 0x1c, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46] as const;

const TRAINER_NATURE_HELPER_MARKER = asciiBytes("PWTRNAT1");
const TRAINER_NATURE_HELPER_PREFIX = [
  0xf0, 0xb5, 0x04, 0x1c, 0x0d, 0x1c, 0x16, 0x1c, 0x20, 0x1c, 0x29, 0x1c, 0xf2, 0x88, 0x73, 0x78,
] as const;

const TRAINER_NATURE_HELPER_CODE = Uint8Array.of(
  0xf0, 0xb5,
  0x04, 0x1c,
  0x0d, 0x1c,
  0x16, 0x1c,
  0x20, 0x1c,
  0x29, 0x1c,
  0xf2, 0x88,
  0x73, 0x78,
  0xff, 0xf7, 0xfe, 0xff,
  0xf4, 0x78,
  0x01, 0x2c,
  0x15, 0xd3,
  0x19, 0x2c,
  0x13, 0xd8,
  0x01, 0x3c,
  0xb0, 0x88,
  0x00, 0x21,
  0xb2, 0x78,
  0xff, 0xf7, 0xfe, 0xff,
  0x07, 0x1c,
  0x28, 0x1c,
  PF_EXP, 0x21,
  0x3a, 0x1c,
  0xff, 0xf7, 0xfe, 0xff,
  0x28, 0x1c,
  PF_NATURE, 0x21,
  0x22, 0x1c,
  0xff, 0xf7, 0xfe, 0xff,
  0x28, 0x1c,
  0xff, 0xf7, 0xfe, 0xff,
  0xf0, 0xbd,
);

const HELPER_SETUP_BL_OFFSET = 0x10;
const HELPER_EXP_FOR_LEVEL_BL_OFFSET = 0x26;
const HELPER_SET_EXP_PARAM_BL_OFFSET = 0x32;
const HELPER_SET_NATURE_PARAM_BL_OFFSET = 0x3c;
const HELPER_RECALC_STATS_BL_OFFSET = 0x42;

const PATCH_CONFIGS: Partial<Record<BaseVersion, TrainerNaturePatchConfig>> = {
  W2: {
    setupAddress: 0x02030e2c,
    expForLevelAddress: 0x0201d5e0,
    setParamAddress: 0x0201cd48,
    recalcStatsAddress: 0x0201d620,
    sites: [
      { address: 0x02030a50, original: SITE1_ORIGINAL, patchedPrefix: SITE1_PATCH_PREFIX },
      { address: 0x02030b4a, original: SITE2_ORIGINAL, patchedPrefix: SITE2_PATCH_PREFIX },
      { address: 0x02030c6a, original: SITE3_ORIGINAL, patchedPrefix: SITE3_PATCH_PREFIX },
      { address: 0x02030d80, original: SITE4_ORIGINAL, patchedPrefix: SITE4_PATCH_PREFIX },
    ],
  },
  B2: {
    setupAddress: 0x02030e00,
    expForLevelAddress: 0x0201d5b4,
    setParamAddress: 0x0201cd1c,
    recalcStatsAddress: 0x0201d5f4,
    sites: [
      { address: 0x02030a24, original: SITE1_ORIGINAL, patchedPrefix: SITE1_PATCH_PREFIX },
      { address: 0x02030b1e, original: SITE2_ORIGINAL, patchedPrefix: SITE2_PATCH_PREFIX },
      { address: 0x02030c3e, original: SITE3_ORIGINAL, patchedPrefix: SITE3_PATCH_PREFIX },
      { address: 0x02030d54, original: SITE4_ORIGINAL, patchedPrefix: SITE4_PATCH_PREFIX },
    ],
  },
};

export function applyTrainerNaturePatchToArm9(
  arm9: Uint8Array,
  baseVersion: BaseVersion,
  arm9RamAddress = BW2_ARM9_RAM_BASE,
): TrainerNatureArm9PatchResult | undefined {
  const config = PATCH_CONFIGS[baseVersion];
  if (!config) return undefined;

  const siteStatuses = config.sites.map((site) => inspectPatchSite(arm9, site, arm9RamAddress));
  if (siteStatuses.every((status) => status.state === "patched")) {
    const hookAddress = siteStatuses.find((status) => status.state === "patched")?.hookAddress ?? 0;
    return { status: "already-applied", arm9, offset: hookAddress - arm9RamAddress, hookAddress };
  }
  if (!siteStatuses.every((status) => status.state === "original")) return undefined;

  const existingHookOffset = findExistingTrainerNatureHelper(arm9, arm9RamAddress, config);
  const helperOffset = existingHookOffset ?? findStaticBssEndOffset(arm9, arm9RamAddress) ?? align(arm9.length, 4);
  const hookAddress = arm9RamAddress + helperOffset;
  const out = new Uint8Array(Math.max(arm9.length, helperOffset) + (existingHookOffset === undefined ? trainerNatureHelperLength() : 0));
  out.set(arm9);
  if (existingHookOffset === undefined) out.set(buildTrainerNatureHelper(hookAddress, config), helperOffset);

  for (const site of config.sites) patchSite(out, site, arm9RamAddress, hookAddress);
  return { status: "applied", arm9: out, offset: helperOffset, hookAddress };
}

export function detectTrainerNaturePatchState(
  arm9: Uint8Array,
  baseVersion: BaseVersion,
  arm9RamAddress = BW2_ARM9_RAM_BASE,
): TrainerNaturePatchState {
  const config = PATCH_CONFIGS[baseVersion];
  if (!config) return "unsupported";
  if (arm9.length === 0) return "unknown";

  const siteStatuses = config.sites.map((site) => inspectPatchSite(arm9, site, arm9RamAddress));
  if (siteStatuses.every((status) => status.state === "original")) return "unpatched";
  if (siteStatuses.every((status) => status.state === "patched")) return "patched";
  return "unknown";
}

function patchSite(out: Uint8Array, site: TrainerNaturePatchSite, arm9RamAddress: number, hookAddress: number): void {
  const offset = site.address - arm9RamAddress;
  out.set(site.patchedPrefix, offset);
  writeThumbBl(out, offset + site.patchedPrefix.length, site.address + site.patchedPrefix.length, hookAddress);
}

function inspectPatchSite(
  arm9: Uint8Array,
  site: TrainerNaturePatchSite,
  arm9RamAddress: number,
): { state: "original" } | { state: "patched"; hookAddress: number } | { state: "unknown" } {
  const offset = site.address - arm9RamAddress;
  if (offset < 0 || offset + site.original.length > arm9.length) return { state: "unknown" };
  if (matchesSequence(arm9, site.original, offset)) return { state: "original" };
  if (!matchesSequence(arm9, site.patchedPrefix, offset)) return { state: "unknown" };

  const hookAddress = decodeThumbBlTarget(arm9, offset + site.patchedPrefix.length, site.address + site.patchedPrefix.length);
  if (hookAddress === undefined) return { state: "unknown" };
  const helperOffset = hookAddress - arm9RamAddress;
  return isTrainerNatureHelper(arm9, helperOffset) ? { state: "patched", hookAddress } : { state: "unknown" };
}

function buildTrainerNatureHelper(hookAddress: number, config: TrainerNaturePatchConfig): Uint8Array {
  const code = new Uint8Array(trainerNatureHelperLength());
  code.set(TRAINER_NATURE_HELPER_CODE);
  code.set(TRAINER_NATURE_HELPER_MARKER, TRAINER_NATURE_HELPER_CODE.length);
  writeThumbBl(code, HELPER_SETUP_BL_OFFSET, hookAddress + HELPER_SETUP_BL_OFFSET, config.setupAddress);
  writeThumbBl(code, HELPER_EXP_FOR_LEVEL_BL_OFFSET, hookAddress + HELPER_EXP_FOR_LEVEL_BL_OFFSET, config.expForLevelAddress);
  writeThumbBl(code, HELPER_SET_EXP_PARAM_BL_OFFSET, hookAddress + HELPER_SET_EXP_PARAM_BL_OFFSET, config.setParamAddress);
  writeThumbBl(code, HELPER_SET_NATURE_PARAM_BL_OFFSET, hookAddress + HELPER_SET_NATURE_PARAM_BL_OFFSET, config.setParamAddress);
  writeThumbBl(code, HELPER_RECALC_STATS_BL_OFFSET, hookAddress + HELPER_RECALC_STATS_BL_OFFSET, config.recalcStatsAddress);
  return code;
}

function trainerNatureHelperLength(): number {
  return TRAINER_NATURE_HELPER_CODE.length + TRAINER_NATURE_HELPER_MARKER.length;
}

function findExistingTrainerNatureHelper(arm9: Uint8Array, arm9RamAddress: number, config: TrainerNaturePatchConfig): number | undefined {
  for (let offset = 0; offset + trainerNatureHelperLength() <= arm9.length; offset += 2) {
    if (!isTrainerNatureHelper(arm9, offset)) continue;
    if (decodeThumbBlTarget(arm9, offset + HELPER_SETUP_BL_OFFSET, arm9RamAddress + offset + HELPER_SETUP_BL_OFFSET) !== config.setupAddress) continue;
    if (decodeThumbBlTarget(arm9, offset + HELPER_EXP_FOR_LEVEL_BL_OFFSET, arm9RamAddress + offset + HELPER_EXP_FOR_LEVEL_BL_OFFSET) !== config.expForLevelAddress) continue;
    if (decodeThumbBlTarget(arm9, offset + HELPER_SET_EXP_PARAM_BL_OFFSET, arm9RamAddress + offset + HELPER_SET_EXP_PARAM_BL_OFFSET) !== config.setParamAddress) continue;
    if (decodeThumbBlTarget(arm9, offset + HELPER_SET_NATURE_PARAM_BL_OFFSET, arm9RamAddress + offset + HELPER_SET_NATURE_PARAM_BL_OFFSET) !== config.setParamAddress) continue;
    if (decodeThumbBlTarget(arm9, offset + HELPER_RECALC_STATS_BL_OFFSET, arm9RamAddress + offset + HELPER_RECALC_STATS_BL_OFFSET) !== config.recalcStatsAddress) continue;
    return offset;
  }
  return undefined;
}

function isTrainerNatureHelper(arm9: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + trainerNatureHelperLength() > arm9.length) return false;
  return (
    matchesSequence(arm9, TRAINER_NATURE_HELPER_PREFIX, offset) &&
    matchesSequence(arm9, TRAINER_NATURE_HELPER_MARKER, offset + TRAINER_NATURE_HELPER_CODE.length)
  );
}

function findStaticBssEndOffset(arm9: Uint8Array, arm9RamAddress: number): number | undefined {
  for (let offset = 0; offset + 36 <= arm9.length; offset += 4) {
    if (readU32(arm9, offset + 28) !== SDK_NITROCODE_BE || readU32(arm9, offset + 32) !== SDK_NITROCODE_LE) continue;
    const bssStart = readU32(arm9, offset + 12);
    const bssEnd = readU32(arm9, offset + 16);
    if (bssStart < arm9RamAddress || bssEnd < bssStart || bssEnd > 0x02400000) continue;
    const hookOffset = align(bssEnd - arm9RamAddress, 4);
    if (hookOffset < arm9.length) continue;
    return hookOffset;
  }
  return undefined;
}

function writeThumbBl(data: Uint8Array, offset: number, fromAddress: number, toAddress: number): void {
  const delta = toAddress - (fromAddress + 4);
  if (delta % 2 !== 0 || delta < -0x400000 || delta > 0x3ffffe) {
    throw new Error(`Trainer nature helper target ${formatAddress(toAddress)} is out of BL range.`);
  }

  writeU16(data, offset, 0xf000 | ((delta >> 12) & 0x7ff));
  writeU16(data, offset + 2, 0xf800 | ((delta >> 1) & 0x7ff));
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number | undefined {
  const high = readU16(data, offset);
  const low = readU16(data, offset + 2);
  if ((high & 0xf800) !== 0xf000 || (low & 0xf800) !== 0xf800) return undefined;

  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return (fromAddress + 4 + delta) >>> 0;
}

function matchesSequence(data: Uint8Array, sequence: ArrayLike<number>, offset: number): boolean {
  if (offset < 0 || offset + sequence.length > data.length) return false;
  for (let index = 0; index < sequence.length; index += 1) {
    if (data[offset + index] !== sequence[index]) return false;
  }
  return true;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from([...value].map((char) => char.charCodeAt(0)));
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, "0")}`;
}
