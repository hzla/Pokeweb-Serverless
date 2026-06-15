import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC, hasCtrMapIncompatibleFntb, hasEarlyFimgMagic } from "../nds/narc";
import { NintendoDSRom, crc16 } from "../nds/rom";
import type { Folder } from "../nds/fnt";

export type NarcRepairReason =
  | "early_fimg_magic"
  | "ctrmap_incompatible_fntb"
  | "fimg_trailing_gap"
  | "archive_size_mismatch"
  | "fimg_size_mismatch";

export type NarcRepairResult = {
  bytes: Uint8Array;
  changed: boolean;
  reasons: NarcRepairReason[];
};

export type RomHeaderRepairReason = "false_twl_extension";

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
  const headerRepair = repairRomHeader(data);
  const baseBytes = headerRepair.changed ? headerRepair.bytes : data;
  if (headerRepair.changed) onProgress?.("Repaired ROM header");

  const rom = new NintendoDSRom(baseBytes);
  const replacements = new Map<number, Uint8Array>();
  const paths = pathMapByFileId(rom.filenames);
  const entries: RomRepairEntry[] = [];
  let scannedNarcs = 0;
  let skippedNarcs = 0;

  rom.files.forEach((file, fileId) => {
    if (readAscii(file, 0, 4) !== "NARC") return;
    scannedNarcs += 1;
    if (scannedNarcs % 25 === 0) onProgress?.(`Scanned ${scannedNarcs} NARCs`);

    const repair = repairNarcBytes(file);
    if (!repair.changed) {
      if (repair.reasons.length > 0) skippedNarcs += 1;
      return;
    }

    replacements.set(fileId, repair.bytes);
    entries.push({
      fileId,
      path: paths.get(fileId),
      beforeSize: file.length,
      afterSize: repair.bytes.length,
      reasons: repair.reasons,
    });
  });

  const bytes = replacements.size > 0 ? rom.save({ files: replacements, preserveOriginalLength: true }) : baseBytes;
  return {
    bytes,
    scannedNarcs,
    repairedNarcs: entries.length,
    skippedNarcs,
    headerRepair: headerRepair.changed
      ? {
          beforeSize: data.length,
          afterSize: baseBytes.length,
          reasons: headerRepair.reasons,
        }
      : undefined,
    entries,
  };
}

export function repairNarcBytes(bytes: Uint8Array): NarcRepairResult {
  const reasons = detectNarcRepairReasons(bytes);
  if (reasons.length === 0) return { bytes, changed: false, reasons };

  try {
    const gapRepair = repairFimgTrailingGap(bytes, reasons);
    if (gapRepair) return gapRepair;

    const normalized = new NARC(bytes).save();
    return { bytes: normalized, changed: !bytesEqual(bytes, normalized), reasons };
  } catch {
    return { bytes, changed: false, reasons };
  }
}

export function detectNarcRepairReasons(bytes: Uint8Array): NarcRepairReason[] {
  if (readAscii(bytes, 0, 4) !== "NARC") return [];

  const reasons: NarcRepairReason[] = [];
  if (hasEarlyFimgMagic(bytes)) reasons.push("early_fimg_magic");
  if (hasCtrMapIncompatibleFntb(bytes)) reasons.push("ctrmap_incompatible_fntb");

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
    case "fimg_trailing_gap":
      return "FIMG data-start gap";
    case "archive_size_mismatch":
      return "archive size mismatch";
    case "fimg_size_mismatch":
      return "FIMG size mismatch";
  }
}

export function romHeaderRepairReasonLabel(reason: RomHeaderRepairReason): string {
  switch (reason) {
    case "false_twl_extension":
      return "false TWL extended header";
  }
}

function repairRomHeader(data: Uint8Array): { bytes: Uint8Array; changed: boolean; reasons: RomHeaderRepairReason[] } {
  const reasons: RomHeaderRepairReason[] = [];
  if (!hasFalseTwlExtension(data)) return { bytes: data, changed: false, reasons };

  reasons.push("false_twl_extension");
  const usedRomSize = readU32(data, 0x80);
  const targetLength = usedRomSize >= 0x200 && usedRomSize <= data.length ? usedRomSize : data.length;
  const out = data.slice(0, targetLength);

  writeU32(out, 0x80, out.length);
  writeU32(out, 0x210, 0);
  zeroOffsetWhenSizeIsZero(out, 0x50, 0x54);
  zeroOffsetWhenSizeIsZero(out, 0x58, 0x5c);
  writeU16(out, 0x15e, crc16(out.subarray(0, 0x15e)));
  return { bytes: out, changed: true, reasons };
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
