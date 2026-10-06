import { readAscii, readU32, writeU16, writeU32 } from "../nds/binary";
import { digestHmacFromRom, readDsiDigestSource } from "../nds/dsiDigest";
import { NintendoDSRom } from "../nds/rom";
import { validateDsRomSections } from "../nds/romValidation";

export type DsiRomRepairResult = { bytes: Uint8Array; game: "Black 2" | "White 2" };
const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;

/** Recover from a user-supplied donor; no retail ROM or firmware data is bundled. */
export async function repairDsiRom(source: Uint8Array, donor: Uint8Array, onProgress?: (message: string) => void | Promise<void>): Promise<DsiRomRepairResult> {
  await onProgress?.("Checking game, revision, and native DS files…");
  validateDsRomSections(source);
  validateDsRomSections(donor);
  const gameCode = readAscii(source, 0x0c, 4);
  if (!["IREO", "IRDO"].includes(gameCode) || source[0x12] !== 2) {
    throw new Error("DSi ROM Repair currently supports English Black 2 and White 2 and compatible hacks.");
  }
  if (readAscii(donor, 0x0c, 4) !== gameCode || donor[0x12] !== 2 || donor[0x1e] !== source[0x1e]) {
    throw new Error("The clean ROM must match the damaged ROM's game, language, and revision. Use clean Black 2 for Black 2, or clean White 2 for White 2.");
  }
  if ((readU32(source, 0x84) || 0x4000) !== 0x4000 || (readU32(donor, 0x84) || 0x4000) !== 0x4000) {
    throw new Error("This ROM uses an unrecognized native header layout. DSi repair requires the standard Black 2 / White 2 header so native DS code cannot overlap the restored DSi metadata.");
  }
  for (const field of [0x24, 0x28, 0x34, 0x38]) {
    if (readU32(source, field) !== readU32(donor, field)) throw new Error("This hack changes native program addresses. Its compatibility with the clean ROM's DSi programs cannot be verified.");
  }
  const mapping = source.subarray(0x180, 0x1c0);
  const missingMapping = mapping.every((value) => value === 0)
    // Some stripped dumps contain 0/1 placeholder bytes instead of addresses.
    // Accept that recognizable absence only when no digest tables remain;
    // the native program-address and digest-configuration checks still apply.
    || (mapping.every((value) => value <= 1) && [0x1f0, 0x1f4, 0x1f8, 0x1fc, 0x200, 0x204].every((field) => readU32(source, field) === 0));
  if (!missingMapping && !mapping.every((value, i) => value === donor[0x180 + i])) {
    throw new Error("This ROM has an unrecognized DSi memory mapping. Use the original compatible ROM or restore its mapping before repairing.");
  }
  if ((donor[0x1c] & 6) === 6 && !source.subarray(0, 16).every((value, i) => value === donor[i])) {
    throw new Error("The donor uses header-dependent debug encryption and cannot repair a ROM with a different title.");
  }

  await onProgress?.("Authenticating the clean ROM's DSi integrity tables…");
  let digest;
  try {
    digest = readDsiDigestSource(donor);
  } catch (error) {
    throw new Error(`The clean donor ROM has invalid DSi data. Choose an intact original ROM. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!digest) throw new Error("The clean donor ROM is missing its DSi integrity tables. Choose an intact original ROM.");
  const regionEnd = digest.regionStart + digest.regionSize;
  for (const [field, sizeField] of [[0x1c0, 0x1cc], [0x1d0, 0x1dc], [0x220, 0x224], [0x228, 0x22c]]) {
    const at = readU32(donor, field), size = readU32(donor, sizeField);
    if (!at && !size && field >= 0x220) continue;
    if (!size || at < digest.regionStart || at + size > regionEnd) throw new Error("The donor's DSi programs or encryption ranges are missing or incomplete. Choose an intact clean ROM.");
  }
  const sectors = donor.subarray(readU32(donor, 0x1f0), readU32(donor, 0x1f0) + readU32(donor, 0x1f4));
  const blocks = donor.subarray(readU32(donor, 0x1f8), readU32(donor, 0x1f8) + readU32(donor, 0x1fc));
  await onProgress?.("Checking the edited ROM's native digest configuration…");
  // Authenticate the source's own ARM9 against the donor's known block.
  // Compatible hacks may relocate this configuration; no fixed key is used.
  try {
    digestHmacFromRom(source, sectors.subarray(0, digest.blockSectors * 20), blocks.subarray(0, 20));
  } catch {
    throw new Error("The edited ROM does not retain a compatible native DSi digest configuration. This hack cannot be repaired with the selected clean ROM.");
  }

  await onProgress?.("Restoring DSi programs and encryption metadata…");
  const sectorAt = align(source.length, 0x200), blockAt = align(sectorAt + sectors.length, 0x200);
  const regionAt = align(blockAt + blocks.length, 0x80000);
  const length = regionAt + digest.regionSize;
  if (length > 0x7fffffff || regionAt / 0x80000 > 0xffff) throw new Error("The repaired ROM exceeds the supported ROM size.");
  let restored: Uint8Array;
  try {
    restored = new Uint8Array(length);
  } catch {
    throw new Error("Not enough memory to repair these ROMs. Close other tabs and try again on a device with more available memory.");
  }
  restored.set(source);
  // Keep the native DS header/code/files from the edited ROM. The TWL
  // header and encrypted programs must come from the same authenticated donor.
  restored.set(donor.subarray(0x180, 0x1000), 0x180);
  restored[0x1c] = (source[0x1c] & ~6) | (donor[0x1c] & 6);
  restored.set(sectors, sectorAt);
  restored.set(blocks, blockAt);
  restored.set(donor.subarray(digest.regionStart, regionEnd), regionAt);
  writeU32(restored, 0x1f0, sectorAt);
  writeU32(restored, 0x1f8, blockAt);
  writeU32(restored, 0x1e8, regionAt + digest.twlStart - digest.regionStart);
  writeU16(restored, 0x90, regionAt / 0x80000);
  writeU16(restored, 0x92, regionAt / 0x80000);
  for (const field of [0x1c0, 0x1d0, 0x220, 0x228]) {
    const offset = readU32(donor, field);
    if (offset) writeU32(restored, field, regionAt + offset - digest.regionStart);
  }
  writeU32(restored, 0x210, length);

  await onProgress?.("Rebuilding integrity tables for the edited game content…");
  const bytes = new NintendoDSRom(restored, { fileData: "view" }).save({ forDsi: true });
  await onProgress?.("Verifying the repaired layout…");
  validateDsRomSections(bytes);
  if (!readDsiDigestSource(bytes)) throw new Error("The repaired DSi integrity tables could not be verified. No ROM was downloaded.");
  return { bytes, game: gameCode === "IREO" ? "Black 2" : "White 2" };
}

export function dsiRepairedRomFilename(name: string): string {
  return `${name.replace(/\.nds$/iu, "") || "rom"}-dsi-repaired.nds`;
}
