// Exercise the trainer-test rebuild without entering a battle. All inputs are
// read-only, and optional output ROM/save files are created exclusively.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { readU32 } from "../src/nds/binary";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { detectPmcInstallFromRom } from "../src/pokeweb/pmcModel";
import { buildTestBattleDownloads } from "../src/pokeweb/testBattle";

const [input, output] = process.argv.slice(2);
if (!input) throw new Error("Expected INPUT.nds [OUTPUT.nds]");
const bytes = new Uint8Array(await readFile(input));
const original = new NintendoDSRom(bytes);
const project = await loadProjectFromRomBytes(bytes, basename(input), {
  selectedNarcs: ["message_texts", "trdata", "trpok", "overworlds", "trtext_table", "trtext_offsets"],
});
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  const name = url.pathname.split("/").pop()!;
  const group = name.endsWith(".dsv") || name.endsWith(".sav") ? "testbattle" : "codeinjection";
  return new Response(new Uint8Array(await readFile(new URL(`../src/assets/${group}/${name}`, import.meta.url))));
}) as typeof fetch;
const result = await buildTestBattleDownloads(project, 1);
const rom = new NintendoDSRom(result.romBytes);
const pmc = detectPmcInstallFromRom(original)?.pmc;
assert(pmc, "The input must already contain a verified PMC installation");
assert.deepEqual(detectPmcInstallFromRom(rom)?.pmc, pmc);
assert.deepEqual(rom.arm9, original.arm9, "Test Battle changed startup code");
assert.deepEqual(rom.arm9OverlayTable, original.arm9OverlayTable, "Test Battle changed overlay IDs or placement in RAM");
const fileId = readU32(rom.arm9OverlayTable, pmc.overlayId * 32 + 24);
assert.deepEqual(rom.files[fileId], original.files[fileId], "Test Battle replaced the PMC image");
const offset = readU32(result.romBytes, readU32(result.romBytes, 0x48) + fileId * 8);
assert(offset < 0x10000000, "Launch rebuild moved the startup loader beyond 256 MiB");
if (output) {
  await writeFile(output, result.romBytes, { flag: "wx" });
  await writeFile(output.replace(/\.nds$/i, "") + ".dsv", result.saveBytes, { flag: "wx" });
}
console.log(JSON.stringify({ game: rom.idCode, trainerTestExport: "passed", pmcOffset: `0x${offset.toString(16)}`, output: output ? basename(output) : undefined }));
