import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import {
  NARC,
  hasCtrMapIncompatibleFntb,
  hasEarlyFimgMagic,
  hasTinkeIncompatibleNamelessFntb,
} from "../nds/narc";
import { NintendoDSRom, crc16 } from "../nds/rom";
import { loadFnt, type Folder } from "../nds/fnt";
import { repairLegacyPmcRomStructure } from "./pmcModel";

export type NarcRepairReason =
  | "early_fimg_magic"
  | "ctrmap_incompatible_fntb"
  | "tinke_incompatible_nameless_fntb"
  | "frost_incompatible_sprite_padding"
  | "fimg_trailing_gap"
  | "archive_size_mismatch"
  | "fimg_size_mismatch";

export type NarcRepairOptions = {
  path?: string;
};

export type NarcRepairResult = {
  bytes: Uint8Array;
  changed: boolean;
  reasons: NarcRepairReason[];
};

export type RomHeaderRepairReason =
  | "false_twl_extension"
  | "frost_overlay_fnt_mismatch"
  | "legacy_pmc_overlay_layout"
  | "legacy_pmc_root_fnt";

export type RomHeaderRepairEntry = {
  beforeSize: number;
  afterSize: number;
  reasons: RomHeaderRepairReason[];
};

export type RomRepairEntry = {
  fileId: number;
  path?: string;
  beforeSize: number;
  afterSize: number;
  reasons: NarcRepairReason[];
};

export type RomRepairResult = {
  bytes: Uint8Array;
  scannedNarcs: number;
  repairedNarcs: number;
  skippedNarcs: number;
  headerRepair?: RomHeaderRepairEntry;
  entries: RomRepairEntry[];
};

type NarcLayout = {
  arcSize: number;
  fatbSize: number;
  fileCount: number;
  fntbOffset: number;
  fntbSize: number;
  fimgOffset: number;
  fimgSize: number;
  rawOffset: number;
  maxFatEnd: number;
  maxPaddedFatEnd: number;
};

export function repairRomNarcs(data: Uint8Array, onProgress?: (message: string) => void): RomRepairResult {
  const rawHeaderRepair = repairRomHeader(data);
  const baseBytes = rawHeaderRepair.changed ? rawHeaderRepair.bytes : data;
  if (rawHeaderRepair.changed) onProgress?.("Repaired ROM header");

  const rom = new NintendoDSRom(baseBytes);
  const legacyPmcRepair = repairLegacyPmcRomStructure(rom);
  // PMC deliberately appends an overlay whose ID shares the retail root file
  // base. Applying the generic Frost alignment to that valid layout erases the
  // retail root names, which was the source of the second legacy export bug.
  const frostOverlayFntMismatch = !legacyPmcRepair.detected && hasFrostOverlayFntMismatch(baseBytes);
  if (frostOverlayFntMismatch) onProgress?.("Repaired Frost overlay/FNT file base");
  if (legacyPmcRepair.repairedOverlayLayout) onProgress?.("Repaired legacy PMC overlay layout");
  if (legacyPmcRepair.repairedRootFnt) onProgress?.("Restored legacy PMC root filenames");
  const replacements = new Map<number, Uint8Array>();
  const paths = pathMapByFileId(rom.filenames);
  const entries: RomRepairEntry[] = [];
  let scannedNarcs = 0;
  let skippedNarcs = 0;

  rom.files.forEach((file, fileId) => {
    if (readAscii(file, 0, 4) !== "NARC") return;
    scannedNarcs += 1;
    if (scannedNarcs % 25 === 0) onProgress?.(`Scanned ${scannedNarcs} NARCs`);

    const path = paths.get(fileId);
    const repair = repairNarcBytes(file, { path });
    if (!repair.changed) {
      if (repair.reasons.length > 0) skippedNarcs += 1;
      return;
    }

    replacements.set(fileId, repair.bytes);
    entries.push({
      fileId,
      path,
      beforeSize: file.length,
      afterSize: repair.bytes.length,
      reasons: repair.reasons,
    });
  });

  const bytes = replacements.size > 0 || frostOverlayFntMismatch || legacyPmcRepair.repairedOverlayLayout || legacyPmcRepair.repairedRootFnt
    ? rom.save({
        arm9OverlayTable: legacyPmcRepair.arm9OverlayTable,
        filenames: legacyPmcRepair.repairedRootFnt ? rom.filenames : undefined,
        files: replacements,
        alignFntFirstFileToArm9OverlayCount: frostOverlayFntMismatch,
        preserveOriginalLength: true,
      })
    : baseBytes;
  const structuralReasons: RomHeaderRepairReason[] = [
    ...rawHeaderRepair.reasons,
    ...(frostOverlayFntMismatch ? (["frost_overlay_fnt_mismatch"] as const) : []),
    ...(legacyPmcRepair.repairedOverlayLayout ? (["legacy_pmc_overlay_layout"] as const) : []),
    ...(legacyPmcRepair.repairedRootFnt ? (["legacy_pmc_root_fnt"] as const) : []),
  ];
  return {
    bytes,
    scannedNarcs,
    repairedNarcs: entries.length,
    skippedNarcs,
    headerRepair: structuralReasons.length > 0
      ? {
          beforeSize: data.length,
          afterSize: bytes.length,
          reasons: structuralReasons,
        }
      : undefined,
    entries,
  };
}

export function repairNarcBytes(bytes: Uint8Array, options: NarcRepairOptions = {}): NarcRepairResult {
  const reasons = detectNarcRepairReasons(bytes, options);
  if (reasons.length === 0) return { bytes, changed: false, reasons };

  try {
    const gapRepair = repairFimgTrailingGap(bytes, reasons);
    const source = new NARC(gapRepair?.bytes ?? bytes);
    if (reasons.includes("frost_incompatible_sprite_padding")) repairFrostSpritePadding(source);

    const normalized = source.save();
    return { bytes: normalized, changed: !bytesEqual(bytes, normalized), reasons };
  } catch {
    return { bytes, changed: false, reasons };
  }
}

export function detectNarcRepairReasons(bytes: Uint8Array, options: NarcRepairOptions = {}): NarcRepairReason[] {
  if (readAscii(bytes, 0, 4) !== "NARC") return [];

  const reasons: NarcRepairReason[] = [];
  if (hasEarlyFimgMagic(bytes)) reasons.push("early_fimg_magic");
  if (hasCtrMapIncompatibleFntb(bytes)) reasons.push("ctrmap_incompatible_fntb");
  if (hasTinkeIncompatibleNamelessFntb(bytes)) reasons.push("tinke_incompatible_nameless_fntb");
  if (isPokemonSpriteArchive(options.path) && hasFrostIncompatibleSpritePadding(bytes)) {
    reasons.push("frost_incompatible_sprite_padding");
  }

  const layout = readStandardNarcLayout(bytes);
  if (!layout) return reasons;

  const declaredFimgEnd = layout.fimgOffset + layout.fimgSize;
  if (layout.arcSize !== bytes.length) reasons.push("archive_size_mismatch");
  if (layout.fimgSize !== 8 + layout.maxPaddedFatEnd) reasons.push("fimg_size_mismatch");
  if (layout.arcSize > declaredFimgEnd && canRepairFimgTrailingGap(bytes, layout)) reasons.push("fimg_trailing_gap");

  return [...new Set(reasons)];
}

export function repairReasonLabel(reason: NarcRepairReason): string {
  switch (reason) {
    case "early_fimg_magic":
      return "early GMIF magic";
    case "ctrmap_incompatible_fntb":
      return "CTRMap-incompatible FNTB";
    case "tinke_incompatible_nameless_fntb":
      return "Tinke-incompatible nameless BTNF";
    case "frost_incompatible_sprite_padding":
      return "Frost-incompatible Pokemon form sprite padding";
    case "fimg_trailing_gap":
      return "FIMG data-start gap";
    case "archive_size_mismatch":
      return "archive size mismatch";
    case "fimg_size_mismatch":
      return "FIMG size mismatch";
  }
}

const POKEMON_SPRITE_ARCHIVE_PATH = "a/0/0/4";
const POKEMON_SPRITE_FILES_PER_ENTRY = 20;
const RESERVED_SPRITE_PALETTE_COUNT = 5;

function isPokemonSpriteArchive(path: string | undefined): boolean {
  return path?.replace(/^\/+/, "") === POKEMON_SPRITE_ARCHIVE_PATH;
}

function hasFrostIncompatibleSpritePadding(bytes: Uint8Array): boolean {
  try {
    return findFrostSpritePaddingStarts(new NARC(bytes)).length > 0;
  } catch {
    return false;
  }
}

function repairFrostSpritePadding(narc: NARC): void {
  for (const start of findFrostSpritePaddingStarts(narc)) {
    const donorStart = start + POKEMON_SPRITE_FILES_PER_ENTRY;
    for (let slot = RESERVED_SPRITE_PALETTE_COUNT; slot < POKEMON_SPRITE_FILES_PER_ENTRY; slot += 1) {
      narc.files[start + slot] = narc.files[donorStart + slot].slice();
    }
  }
}

function findFrostSpritePaddingStarts(narc: NARC): number[] {
  const starts: number[] = [];
  for (
    let start = 0;
    start + POKEMON_SPRITE_FILES_PER_ENTRY * 2 <= narc.files.length;
    start += POKEMON_SPRITE_FILES_PER_ENTRY
  ) {
    const reservedPalettes = narc.files
      .slice(start, start + RESERVED_SPRITE_PALETTE_COUNT)
      .every((file) => readAscii(file, 0, 4) === "RLCN");
    const emptyPadding = narc.files
      .slice(start + RESERVED_SPRITE_PALETTE_COUNT, start + POKEMON_SPRITE_FILES_PER_ENTRY)
      .every((file) => file.length === 0);
    const donorStart = start + POKEMON_SPRITE_FILES_PER_ENTRY;
    const donorPalettes = [18, 19].every((slot) => readAscii(narc.files[donorStart + slot], 0, 4) === "RLCN");
    if (reservedPalettes && emptyPadding && donorPalettes) starts.push(start);
  }
  return starts;
}

export function romHeaderRepairReasonLabel(reason: RomHeaderRepairReason): string {
  switch (reason) {
    case "false_twl_extension":
      return "false TWL extended header";
    case "frost_overlay_fnt_mismatch":
      return "Frost-incompatible overlay/FNT file base";
    case "legacy_pmc_overlay_layout":
      return "legacy PMC overlay short-read layout";
    case "legacy_pmc_root_fnt":
      return "legacy PMC-erased root filenames";
  }
}

function repairRomHeader(data: Uint8Array): { bytes: Uint8Array; changed: boolean; reasons: RomHeaderRepairReason[] } {
  const reasons: RomHeaderRepairReason[] = [];
  const falseTwlExtension = hasFalseTwlExtension(data);
  if (!falseTwlExtension) return { bytes: data, changed: false, reasons };

  let targetLength = data.length;
  if (falseTwlExtension) {
    reasons.push("false_twl_extension");
    const usedRomSize = readU32(data, 0x80);
    targetLength = usedRomSize >= 0x200 && usedRomSize <= data.length ? usedRomSize : data.length;
  }
  const out = data.slice(0, targetLength);

  if (falseTwlExtension) {
    writeU32(out, 0x80, out.length);
    writeU32(out, 0x210, 0);
    zeroOffsetWhenSizeIsZero(out, 0x50, 0x54);
    zeroOffsetWhenSizeIsZero(out, 0x58, 0x5c);
    writeU16(out, 0x15e, crc16(out.subarray(0, 0x15e)));
  }
  return { bytes: out, changed: true, reasons };
}

function hasFrostOverlayFntMismatch(data: Uint8Array): boolean {
  if (data.length < 0x200) return false;
  const overlayOffset = readU32(data, 0x50);
  const overlaySize = readU32(data, 0x54);
  const fntOffset = readU32(data, 0x40);
  const fntSize = readU32(data, 0x44);
  if (overlaySize === 0 || overlaySize % 32 !== 0 || fntSize < 8) return false;
  if (!rangeWithin(data, overlayOffset, overlaySize) || !rangeWithin(data, fntOffset, fntSize)) return false;

  const overlayCount = overlaySize / 32;
  if (overlayCount > 0xffff) return false;
  let appendedOverlay = false;
  for (let index = 0; index < overlayCount; index += 1) {
    const fileId = readU32(data, overlayOffset + index * 32 + 24);
    if (fileId >= overlayCount) appendedOverlay = true;
  }
  if (!appendedOverlay) return false;

  try {
    const filenames = loadFnt(data.subarray(fntOffset, fntOffset + fntSize));
    return filenames.firstId !== overlayCount || filenames.files.length > 0;
  } catch {
    return false;
  }
}

function hasFalseTwlExtension(data: Uint8Array): boolean {
  if (data.length < 0x22c) return false;
  if ((data[0x12] ?? 0) !== 2) return false;
  if (readU32(data, 0x210) === 0) return false;
  return !hasValidTwlRegion(data);
}

function hasValidTwlRegion(data: Uint8Array): boolean {
  const totalUsedRomSize = readU32(data, 0x210);
  const arm9iOffset = readU32(data, 0x1c0);
  const arm9iSize = readU32(data, 0x1cc);
  const arm7iOffset = readU32(data, 0x1d0);
  const arm7iSize = readU32(data, 0x1dc);
  const modcryptArea1Offset = readU32(data, 0x21c);
  const modcryptArea1Size = readU32(data, 0x220);

  return (
    totalUsedRomSize > 0 &&
    totalUsedRomSize <= data.length &&
    arm9iSize >= 0x4000 &&
    modcryptArea1Size >= 0x4000 &&
    rangeWithin(data, arm9iOffset, arm9iSize) &&
    rangeWithin(data, arm7iOffset, arm7iSize) &&
    rangeWithin(data, modcryptArea1Offset, modcryptArea1Size)
  );
}

function rangeWithin(data: Uint8Array, offset: number, length: number): boolean {
  return offset > 0 && length > 0 && offset <= data.length && length <= data.length - offset;
}

function zeroOffsetWhenSizeIsZero(out: Uint8Array, offsetField: number, sizeField: number): void {
  if (readU32(out, sizeField) === 0) writeU32(out, offsetField, 0);
}

function repairFimgTrailingGap(bytes: Uint8Array, reasons: NarcRepairReason[]): NarcRepairResult | undefined {
  const layout = readStandardNarcLayout(bytes);
  if (!layout) return undefined;

  const declaredFimgEnd = layout.fimgOffset + layout.fimgSize;
  const shift = layout.arcSize - declaredFimgEnd;
  if (shift <= 0 || !canRepairFimgTrailingGap(bytes, layout)) return undefined;

  const source = new NARC(bytes);
  source.files = [];
  for (let i = 0; i < layout.fileCount; i += 1) {
    const entryOffset = 0x1c + i * 8;
    const start = readU32(bytes, entryOffset);
    const end = readU32(bytes, entryOffset + 4);
    source.files.push(bytes.slice(layout.rawOffset + shift + start, layout.rawOffset + shift + end));
  }

  const normalized = source.save();
  return { bytes: normalized, changed: !bytesEqual(bytes, normalized), reasons };
}

function canRepairFimgTrailingGap(bytes: Uint8Array, layout: NarcLayout): boolean {
  const declaredFimgEnd = layout.fimgOffset + layout.fimgSize;
  const shift = layout.arcSize - declaredFimgEnd;
  if (shift <= 0 || shift > 0x4000) return false;
  if (layout.rawOffset + shift + layout.maxFatEnd > bytes.length) return false;
  if (layout.rawOffset + shift + layout.maxFatEnd > layout.arcSize) return false;
  return isPadding(bytes.subarray(layout.rawOffset, layout.rawOffset + shift));
}

function readStandardNarcLayout(bytes: Uint8Array): NarcLayout | undefined {
  if (bytes.length < 0x24 || readAscii(bytes, 0, 4) !== "NARC") return undefined;
  const headerSize = readU16(bytes, 0x0c);
  const fatbOffset = headerSize;
  if (fatbOffset + 0x0c > bytes.length || readAscii(bytes, fatbOffset, 4) !== "BTAF") return undefined;

  const arcSize = readU32(bytes, 8);
  const fatbSize = readU32(bytes, fatbOffset + 4);
  const fileCount = readU32(bytes, fatbOffset + 8);
  const fntbOffset = fatbOffset + fatbSize;
  if (fileCount > 0x10000 || fntbOffset + 8 > bytes.length || readAscii(bytes, fntbOffset, 4) !== "BTNF") return undefined;

  const fntbSize = readU32(bytes, fntbOffset + 4);
  const fimgOffset = fntbOffset + fntbSize;
  if (fimgOffset + 8 > bytes.length || readAscii(bytes, fimgOffset, 4) !== "GMIF") return undefined;

  const fimgSize = readU32(bytes, fimgOffset + 4);
  let maxFatEnd = 0;
  let maxPaddedFatEnd = 0;
  for (let i = 0; i < fileCount; i += 1) {
    const entryOffset = 0x1c + i * 8;
    if (entryOffset + 8 > bytes.length) return undefined;
    const start = readU32(bytes, entryOffset);
    const end = readU32(bytes, entryOffset + 4);
    if (end < start) return undefined;
    maxFatEnd = Math.max(maxFatEnd, end);
    maxPaddedFatEnd = Math.max(maxPaddedFatEnd, pad4Length(end));
  }

  return {
    arcSize,
    fatbSize,
    fileCount,
    fntbOffset,
    fntbSize,
    fimgOffset,
    fimgSize,
    rawOffset: fimgOffset + 8,
    maxFatEnd,
    maxPaddedFatEnd,
  };
}

function isPadding(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  return bytes.every((byte) => byte === 0) || bytes.every((byte) => byte === 0xff);
}

function pad4Length(value: number): number {
  return (value + 3) & ~3;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function pathMapByFileId(root: Folder): Map<number, string> {
  const paths = new Map<number, string>();
  const visit = (folder: Folder, prefix: string): void => {
    folder.files.forEach((file, index) => {
      paths.set(folder.firstId + index, prefix ? `${prefix}/${file}` : file);
    });
    folder.folders.forEach(([name, child]) => {
      visit(child, prefix ? `${prefix}/${name}` : name);
    });
  };
  visit(root, "");
  return paths;
}
