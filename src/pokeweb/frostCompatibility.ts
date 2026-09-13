import { readAscii, readU32, writeU32 } from "../nds/binary";
import { type Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { detectPmcInstallFromRom, PMC_OVERLAY_RESERVED_SIZE } from "./pmcModel";

/**
 * Frost ignores the overlay table's file IDs: it treats FAT[0..rowCount) as
 * overlays and subtracts the root FNT firstId when indexing every named file.
 * Pokeweb's normal PMC export instead appends the overlay to the filesystem.
 *
 * This opt-in view reserves an unnamed FAT slot for PMC before NitroFS. Keep
 * the named PMC image too: Pokeweb/CTRMap use that path to detect/reinstall PMC.
 * No archive member IDs, overlay IDs, RAM addresses or executable bytes change.
 * Native resource loading uses paths (GFL_ARC_Init's ArchiveFileTable); custom
 * code with hard-coded NitroFS FAT IDs is deliberately outside this option's
 * compatibility guarantee.
 */
export function exportFrostCompatibleRom(bytes: Uint8Array): Uint8Array {
  const rom = new NintendoDSRom(bytes);
  const retailCount = /^(IRA|IRB)/u.test(rom.idCode) ? 237 : /^(IRD|IRE)/u.test(rom.idCode) ? 344 : undefined;
  const reject = (reason: string): never => {
    throw new Error(`Frost compatibility export only supports Pokeweb's known Gen V filesystem/PMC layout. ${reason} Use normal Export for this ROM.`);
  };
  if (retailCount === undefined) return reject("This is not a supported Black/White ROM.");
  if (rom.arm7OverlayTable.length !== 0 || rom.arm9OverlayTable.length % 32 !== 0) {
    return reject("Unexpected overlay table layout.");
  }
  const count = rom.arm9OverlayTable.length / 32;
  for (let row = 0; row < Math.min(retailCount, count); row += 1) {
    if (readU32(rom.arm9OverlayTable, row * 32) !== row || readU32(rom.arm9OverlayTable, row * 32 + 24) !== row) {
      return reject("Retail overlays have been rearranged by another tool.");
    }
  }
  if (count === retailCount && rom.filenames.firstId === count) {
    validateNamedFiles(rom, count, reject);
    return bytes; // No injection: the normal export already has Frost's layout.
  }
  const pmc = detectPmcInstallFromRom(rom)?.pmc;
  const gameId = { IRA: "B", IRB: "W", IRD: "W2", IRE: "B2" }[rom.idCode.slice(0, 3)];
  if (!pmc?.version || pmc.gameId !== gameId || pmc.overlayId !== retailCount || count !== retailCount + 1) {
    return reject("The added overlay is not a recognized Pokeweb PMC installation.");
  }
  const namedId = rom.filenames.idOf(pmc.overlayPath);
  const image = namedId === undefined ? undefined : rom.files[namedId];
  const rowOffset = retailCount * 32;
  const actualId = readU32(rom.arm9OverlayTable, rowOffset + 24);
  if (!image || namedId! < count || readAscii(image, 0, 4) !== "RPM0" || image.length > PMC_OVERLAY_RESERVED_SIZE
    || readU32(rom.arm9OverlayTable, rowOffset) !== retailCount
    || readU32(rom.arm9OverlayTable, rowOffset + 8) !== image.length
    || readU32(rom.arm9OverlayTable, rowOffset + 12) !== PMC_OVERLAY_RESERVED_SIZE - image.length
    || (actualId !== namedId && actualId !== retailCount)) {
    return reject("PMC's named image and overlay table do not match the expected layout.");
  }
  const alreadyReserved = rom.filenames.firstId === count;
  if (alreadyReserved) {
    const reserved = rom.files[retailCount];
    if (!reserved || reserved.length !== image.length || readAscii(reserved, 0, 4) !== "RPM0") {
      return reject("The presumed PMC slot contains another file.");
    }
    if (!reserved.every((byte, index) => byte === image[index])) {
      return reject("PMC's runtime and named copies differ. Resolve the external PMC edits before converting this ROM.");
    }
  } else if (rom.filenames.firstId !== retailCount || actualId !== namedId) {
    return reject("The root file table has an unfamiliar starting index.");
  }
  validateNamedFiles(rom, alreadyReserved ? count : retailCount, reject);
  if (!alreadyReserved && rom.files.length >= 0x10000) return reject("The file-ID table is full.");

  const table = rom.arm9OverlayTable.slice();
  writeU32(table, rowOffset + 24, retailCount);
  // An insertion shifts all named paths together, preserving contiguous folder
  // ranges (especially /patches). Never erase the root filenames to fake firstId.
  return rom.save({
    arm9OverlayTable: table,
    ...(alreadyReserved
      ? { files: new Map([[retailCount, image]]) }
      : { insertedFiles: [{ fileId: retailCount, bytes: image }] }),
    priorityFileIds: [retailCount],
    preserveOriginalLength: true,
  });
}

function validateNamedFiles(rom: NintendoDSRom, firstId: number, reject: (reason: string) => never): void {
  const seen = new Set<number>();
  const visit = (folder: Folder): void => {
    folder.files.forEach((_name, index) => {
      const id = folder.firstId + index;
      if (id < firstId || id >= rom.files.length || seen.has(id)) reject("Named files overlap overlays or each other.");
      seen.add(id);
    });
    folder.folders.forEach(([, child]) => visit(child));
  };
  visit(rom.filenames);
}
