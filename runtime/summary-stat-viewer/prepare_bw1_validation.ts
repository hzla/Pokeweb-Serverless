import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadOverlayTable } from "../../src/nds/code";
import { decompressCode } from "../../src/nds/codeCompression";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import shippedManifest from "../../src/assets/codeinjection/summaryStatViewerManifest.json";
import { getSummaryStatViewerStatus, installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";
import { parseRpm } from "../../src/pokeweb/rpm";

// Exercise the normal installer on separately named validation ROMs. The
// temporary acceptance override exists only in this process, never on disk.
const [inputPath, outputPath, option] = process.argv.slice(2);
const verifyOnly = outputPath === "--verify-only";
if (!inputPath || !outputPath || (!verifyOnly && resolve(inputPath) === resolve(outputPath)) || (option && option !== "--iv-only")) {
  throw new Error("Usage: vite-node runtime/summary-stat-viewer/prepare_bw1_validation.ts INPUT.nds NEW-OUTPUT.nds|--verify-only [--iv-only]");
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array(await readFile(inputPath)), sourceHash = digest(bytes);
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const game = rom.idCode === "IRBO" ? "B" : rom.idCode === "IRAO" ? "W" : undefined;
assert(game && rom.data[0x1e] === 0, "Only US BW1 revision 0 is a candidate target.");
const manifest = JSON.parse(await readFile(new URL("./build/bw1-candidates.json", import.meta.url), "utf8"));
const profile = manifest.games[game];
assert(profile, "Expected a BW1 profile.");
const overlay = loadOverlayTable(rom.arm9OverlayTable, (_id, fileId) => rom.files[fileId], new Set([profile.overlayId])).get(profile.overlayId)!;
const arm9 = decompressCode(rom.arm9);
for (const signature of profile.signatures) {
  const data = signature.module === "ARM9" ? arm9 : overlay.data;
  const base = signature.module === "ARM9" ? rom.arm9RamAddress : overlay.ramAddress;
  const at = signature.address - base;
  assert(at >= 0 && Buffer.from(data.subarray(at, at + signature.expectedHex.length / 2)).toString("hex") === signature.expectedHex,
    `Unrecognized native code at ${signature.module}:0x${signature.address.toString(16)}`);
}
const graphics = new NARC(rom.getFileByName(profile.graphicsArchive));
for (const resource of profile.resources) assert.equal(digest(graphics.files[resource.member]), resource.sha256);
const dll = new Uint8Array(await readFile(new URL(`./build/${profile.fileName}`, import.meta.url)));
assert.equal(digest(dll), profile.sha256);
const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
assert.equal(rpm.metadata.PMCGameID, game);
assert.equal(rpm.metadata.PMCVersion, manifest.version);
const project = await loadProjectFromRomBytes(bytes, basename(inputPath), { selectedNarcs: [] });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const name = basename(new URL(String(input), "https://pokeweb.invalid").pathname);
  if (name === profile.fileName) return new Response(dll);
  return new Response(new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${name}`, import.meta.url))));
};
const previous = { B: shippedManifest.games.B, W: shippedManifest.games.W };
let exported: Uint8Array;
try {
  shippedManifest.games.B = { ...manifest.games.B, dsAccepted: true };
  shippedManifest.games.W = { ...manifest.games.W, dsAccepted: true };
  const options = { includeEvs: option !== "--iv-only" };
  const installed = await installSummaryStatViewer(project, options);
  assert.equal(installed.path, `patches/${profile.fileName}`);
  assert.deepEqual(getSummaryStatViewerStatus(project).options, options);
  exported = await exportModifiedRom(project);
  const reopened = await loadProjectFromRomBytes(exported, basename(outputPath), { selectedNarcs: [] });
  const status = getSummaryStatViewerStatus(reopened);
  assert(status.installed && status.compatible && !status.canUninstall);
  assert.deepEqual(status.options, options, "Settings changed after export/reopen.");
  const result = new NintendoDSRom(exported, { fileData: "view" }), id = result.fileId(installed.path);
  await installSummaryStatViewer(reopened, { includeEvs: !options.includeEvs });
  assert(reopened.fileSystem?.replacements[id], "Reinstall did not update the existing FAT entry.");
  assert.deepEqual(getSummaryStatViewerStatus(reopened).options, { includeEvs: !options.includeEvs });
} finally {
  Object.assign(shippedManifest.games, previous);
  globalThis.fetch = originalFetch;
}
const result = new NintendoDSRom(exported!, { fileData: "view" });
assert.deepEqual(result.loadArm9Overlays([profile.overlayId]).get(profile.overlayId)!.data, overlay.data);
assert.deepEqual(new NARC(result.getFileByName(profile.graphicsArchive)).files, graphics.files);
assert.equal(parseRpm(result.getFileByName(`patches/${profile.fileName}`), { allowedMagics: ["DLXF"] }).metadata.PMCGameID, game);
assert.equal(digest(new Uint8Array(await readFile(inputPath))), sourceHash, "Source ROM changed.");
if (!verifyOnly) await writeFile(outputPath, exported, { flag: "wx" });
console.log(`${game}: candidate installed, exported and reopened${verifyOnly ? " in memory" : ""}.`);
