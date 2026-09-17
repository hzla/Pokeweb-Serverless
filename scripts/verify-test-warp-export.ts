// Reproduce the complete Test Warp export path, including its second rebuild.
// Inputs remain untouched; the optional output uses exclusive ROM/save creation.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { readU32 } from "../src/nds/binary";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { buildOverworldTestWarpDownloads } from "../src/pokeweb/testOverworldWarp";
import { getOverworldScene } from "../src/pokeweb/overworldModel";
import { detectPmcInstallFromRom } from "../src/pokeweb/pmcModel";

const input = process.argv[2], output = process.argv[3];
if (!input) throw new Error("Expected INPUT.nds [OUTPUT.nds]");
const bytes = new Uint8Array(await readFile(input));
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts", "overworlds", "matrix", "maps"] });
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = request instanceof URL ? request : new URL(request instanceof Request ? request.url : String(request));
  const name = url.pathname.split("/").pop()!;
  const group = name.endsWith(".dsv") || name.endsWith(".sav") ? "testbattle" : "codeinjection";
  return new Response(new Uint8Array(await readFile(new URL(`../src/assets/${group}/${name}`, import.meta.url))));
}) as typeof fetch;
const scene = getOverworldScene(project, 0), x = 15, y = 9;
const map = scene.maps.find((entry) => x >= entry.x && x < entry.x + entry.width && y >= entry.y && y < entry.y + entry.height);
assert(map && !map.empty && !map.missing);
const result = await buildOverworldTestWarpDownloads(project, {
  overworldId: 0, mapId: map.id, index: (y - map.y) * map.width + x - map.x, x, y,
});
const rom = new NintendoDSRom(result.romBytes);
const pmcId = detectPmcInstallFromRom(rom)?.pmc?.overlayId;
assert(pmcId !== undefined, "No active PMC loader detected");
const fileId = readU32(rom.arm9OverlayTable, pmcId * 32 + 24);
const offset = readU32(result.romBytes, readU32(result.romBytes, 0x48) + fileId * 8);
assert(offset < 0x10000000, "Launch rebuild moved the startup loader beyond 256 MiB");
const original = new NintendoDSRom(bytes);
assert.deepEqual(rom.arm9, original.arm9, "Test Warp changed startup code");
assert.deepEqual(rom.arm9OverlayTable, original.arm9OverlayTable, "Test Warp changed overlay IDs or placement in RAM");
const patches = original.filenames.folders.find(([name]) => name === "patches")?.[1];
assert(patches, "Expected a patches directory in the fixture");
for (const name of patches.files) {
  assert.deepEqual(rom.getFileByName(`patches/${name}`), original.getFileByName(`patches/${name}`));
}
if (output) {
  await writeFile(output, result.romBytes, { flag: "wx" });
  await writeFile(output.replace(/\.nds$/i, "") + ".dsv", result.saveBytes, { flag: "wx" });
}
console.log(JSON.stringify({ game: rom.idCode, testWarp: "passed", pmcOffset: `0x${offset.toString(16)}`, patchModulesUnchanged: true, output: output ? basename(output) : undefined }));
