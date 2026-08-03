import { readFile } from "node:fs/promises";
import { readAscii } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import type { Folder } from "../src/nds/fnt";
import { detectNarcRepairReasons } from "../src/pokeweb/romRepairModel";

const paths = [
  "/Users/andylee/Downloads/radiantchromelatest.nds",
  "/Users/andylee/Downloads/radiantchromelatest-form-evolution.nds",
  "/Users/andylee/Downloads/radiantchromelatest-modified.nds",
];

function pathMap(root: Folder): Map<number, string> {
  const out = new Map<number, string>();
  const visit = (folder: Folder, prefix: string) => {
    folder.files.forEach((name, index) => out.set(folder.firstId + index, `${prefix}${name}`));
    folder.folders.forEach(([name, child]) => visit(child, `${prefix}${name}/`));
  };
  visit(root, "");
  return out;
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

const roms = [];
for (const path of paths) {
  const rom = new NintendoDSRom(new Uint8Array(await readFile(path)));
  const overlayCount = rom.arm9OverlayTable.length / 32;
  const afterOverlayCount = rom.files.length - overlayCount;
  const mapped = pathMap(rom.filenames);
  const frostFailures = [];
  for (let narcId = 0; narcId < 308; narcId += 1) {
    const hundreds = Math.floor(narcId / 100);
    const tens = Math.floor((narcId % 100) / 10);
    const ones = narcId % 10;
    const narcPath = `a/${hundreds}/${tens}/${ones}`;
    const fileId = rom.filenames.idOf(narcPath);
    if (fileId === undefined) {
      frostFailures.push({ narcId, path: narcPath, reason: "missing path" });
      continue;
    }
    const frostIndex = fileId - rom.filenames.firstId;
    if (frostIndex < 0 || frostIndex >= afterOverlayCount) {
      frostFailures.push({ narcId, path: narcPath, fileId, frostIndex, afterOverlayCount, reason: "collection index out of range" });
    } else if (overlayCount + frostIndex !== fileId) {
      frostFailures.push({ narcId, path: narcPath, fileId, frostIndex, actualFileId: overlayCount + frostIndex, reason: "indexes wrong FAT entry" });
    }
  }

  const malformedNarcs = [];
  const invalidNarcs = [];
  for (let fileId = 0; fileId < rom.files.length; fileId += 1) {
    const bytes = rom.files[fileId];
    if (readAscii(bytes, 0, 4) !== "NARC") continue;
    const pathName = mapped.get(fileId);
    const reasons = detectNarcRepairReasons(bytes, { path: pathName });
    if (reasons.length > 0) malformedNarcs.push({ fileId, path: pathName, size: bytes.length, reasons });
    try {
      new NARC(bytes);
    } catch (error) {
      invalidNarcs.push({ fileId, path: pathName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const wrongFatEntries = frostFailures.filter((failure) => failure.reason === "indexes wrong FAT entry");
  const outOfRangeEntries = frostFailures.filter((failure) => failure.reason === "collection index out of range");
  const missingEntries = frostFailures.filter((failure) => failure.reason === "missing path");
  console.log(JSON.stringify({
    path,
    title: rom.name,
    idCode: rom.idCode,
    romSize: rom.data.length,
    fatFileCount: rom.files.length,
    arm9OverlayCount: overlayCount,
    rootFirstFile: rom.filenames.firstId,
    filesAfterOverlays: afterOverlayCount,
    firstNarcFileId: rom.filenames.idOf("a/0/0/0"),
    lastFrostNarcFileId: rom.filenames.idOf("a/3/0/7"),
    rootFiles: rom.filenames.files,
    frostFailureSummary: {
      total: frostFailures.length,
      wrongFatEntryCount: wrongFatEntries.length,
      outOfRangeCount: outOfRangeEntries.length,
      missingCount: missingEntries.length,
      first: frostFailures[0],
      last: frostFailures.at(-1),
    },
    malformedNarcs,
    invalidNarcs,
  }, null, 2));
  roms.push({ path, rom, mapped });
}

for (let index = 1; index < roms.length; index += 1) {
  const before = roms[index - 1];
  const after = roms[index];
  const max = Math.max(before.rom.files.length, after.rom.files.length);
  const changed = [];
  for (let fileId = 0; fileId < max; fileId += 1) {
    if (!sameBytes(before.rom.files[fileId], after.rom.files[fileId])) {
      changed.push({
        fileId,
        beforePath: before.mapped.get(fileId),
        afterPath: after.mapped.get(fileId),
        beforeSize: before.rom.files[fileId]?.length,
        afterSize: after.rom.files[fileId]?.length,
      });
    }
  }
  console.log(JSON.stringify({ comparison: `${before.path} -> ${after.path}`, changedCount: changed.length, changed: changed.slice(0, 20) }, null, 2));
}
