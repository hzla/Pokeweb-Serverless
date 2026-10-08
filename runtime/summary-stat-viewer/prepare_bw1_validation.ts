import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { readU32, writeU32 } from "../../src/nds/binary";
import { loadOverlayTable } from "../../src/nds/code";
import { decompressCode } from "../../src/nds/codeCompression";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { adoptExistingPmcInstall, getPmcInstallStatus, installPmcBytes, loadBundledPmcBytes,
  stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";

// This command prepares separately named test ROMs. It neither bundles these
// candidates nor changes normal installer availability or gameplay acceptance.
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) {
  throw new Error("Usage: vite-node runtime/summary-stat-viewer/prepare_bw1_validation.ts INPUT.nds NEW-OUTPUT.nds");
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array(await readFile(inputPath)), sourceHash = digest(bytes);
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const game = rom.idCode === "IRBO" ? "B" : rom.idCode === "IRAO" ? "W" : undefined;
assert(game && rom.data[0x1e] === 0, "Only US BW1 revision 0 is a candidate target.");
const manifest = JSON.parse(await readFile(new URL("./build/bw1-candidates.json", import.meta.url), "utf8"));
const profile = manifest.games[game];
assert(profile && !profile.dsAccepted, "Expected an unreleased BW1 candidate profile.");
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
const config = Buffer.from(rpm.code).indexOf("SSVCFG1\0");
assert(config >= 0 && readU32(rpm.code, config + 12) === 1);
writeU32(rpm.code, config + 12, 1); writeU32(rpm.code, config + 16, 0x53535630);
const project = await loadProjectFromRomBytes(bytes, basename(inputPath), { selectedNarcs: [] });
adoptExistingPmcInstall(project, bytes);
globalThis.fetch = async (input) => {
  const name = basename(new URL(String(input), "https://pokeweb.invalid").pathname);
  return new Response(new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${name}`, import.meta.url))));
};
if (!getPmcInstallStatus(project).installed) installPmcBytes(project, await loadBundledPmcBytes(game), bytes);
stageCodeInjectionDll(project, profile.fileName, writeRpm(rpm, { ident: "DLXF" }), "patches", bytes);
const exported = await exportModifiedRom(project), result = new NintendoDSRom(exported, { fileData: "view" });
assert.deepEqual(result.loadArm9Overlays([profile.overlayId]).get(profile.overlayId)!.data, overlay.data);
assert.deepEqual(new NARC(result.getFileByName(profile.graphicsArchive)).files, graphics.files);
assert.equal(parseRpm(result.getFileByName(`patches/${profile.fileName}`), { allowedMagics: ["DLXF"] }).metadata.PMCGameID, game);
assert.equal(digest(new Uint8Array(await readFile(inputPath))), sourceHash, "Source ROM changed.");
await writeFile(outputPath, exported, { flag: "wx" });
console.log(`${game}: unreleased Summary validation export prepared; gameplay acceptance pending.`);
