import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readU16, readU32, writeU16 } from "../../../src/nds/binary";
import { decompressCode } from "../../../src/nds/codeCompression";
import { NintendoDSRom } from "../../../src/nds/rom";
import { exportModifiedRom } from "../../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../../src/pokeweb/loader";
import { FIVE_BOX_PMC_VERSION } from "../../../src/pokeweb/pmcFiveBoxRuntime";
import { detectPmcInstallFromRom, getFiveBoxPmcStatus, installBundledPmc, PMC_SYMBOL_PATH,
  setFiveBoxPmcMode } from "../../../src/pokeweb/pmcModel";
import { readRelocatedIconPalette, WHITE_2_ICON_PALETTE_POINTER_OFFSET } from "../../../src/pokeweb/pokemonIconPaletteRuntime";

const [input, output, mode] = process.argv.slice(2);
assert(input && output && [undefined, "--frost"].includes(mode), "Expected INPUT.nds OUTPUT.nds [--frost]");
const frostCompatibility = mode === "--frost";
globalThis.fetch = async request => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
};
const open = (bytes: Uint8Array) => new NintendoDSRom(bytes, { fileData: "view" });
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "five-box.nds", { selectedNarcs: ["items", "message_texts"] });
const exportProject = (project: Awaited<ReturnType<typeof load>>) => exportModifiedRom(project, { frostCompatibility });
const modules = (rom: NintendoDSRom) => (detectPmcInstallFromRom(rom)?.modules ?? []).map(module => module.path);

const source = new Uint8Array(await readFile(input));
const original = open(source);
const sourceModules = modules(original);
const sourcePc = original.loadArm9Overlays([255]).get(255)!.data;
const sourceArm9 = decompressCode(original.arm9);
const palette = readRelocatedIconPalette(sourceArm9, original.arm9RamAddress, WHITE_2_ICON_PALETTE_POINTER_OFFSET);
function assertExistingPatches(rom: NintendoDSRom, branch: number) {
  const expectedPc = sourcePc.slice();
  writeU16(expectedPc, 0x44, branch);
  assert.deepEqual(rom.loadArm9Overlays([255]).get(255)!.data, expectedPc);
  assert.deepEqual(modules(rom), sourceModules);
  for (const path of sourceModules) {
    assert(Buffer.from(rom.getFileByName(path)).equals(Buffer.from(original.getFileByName(path))), `Changed ${path}`);
  }
  if (palette) {
    const arm9 = decompressCode(rom.arm9);
    assert.deepEqual(readRelocatedIconPalette(arm9, rom.arm9RamAddress, WHITE_2_ICON_PALETTE_POINTER_OFFSET), palette);
    assert.deepEqual(arm9.subarray(palette.markerOffset), sourceArm9.subarray(palette.markerOffset));
  }
}
let project = await load(source);
assert(!getFiveBoxPmcStatus(project).enabled);
const previousPatches = project.patches, previousPc = project.overlays[255];
const changedPc = sourcePc.slice();
changedPc[0] ^= 1;
project.overlays[255] = changedPc;
project.patches = { ...previousPatches, dirtyOverlayIds: [...(previousPatches?.dirtyOverlayIds ?? []), 255],
  applied: previousPatches?.applied ?? {} };
await assert.rejects(setFiveBoxPmcMode(project, true), /conflicts with an edit to the PC overlay/);
assert(!getFiveBoxPmcStatus(project).enabled);
project.patches = previousPatches;
if (previousPc) project.overlays[255] = previousPc;
else delete project.overlays[255];
await setFiveBoxPmcMode(project, true);
await assert.rejects(exportModifiedRom(project, { forDsi: true }), /DS-mode/);
const bytes = await exportProject(project);
const enabled = open(bytes);
assert.equal(detectPmcInstallFromRom(enabled)?.pmc?.version, FIVE_BOX_PMC_VERSION);
assert.equal(readU32(enabled.arm9OverlayTable, 344 * 32 + 8), 0x4000);
assert.equal(readU32(enabled.arm9OverlayTable, 344 * 32 + 12), 0);
assert.equal(readU32(enabled.data, 0x1c0), 0);
assert.equal(readU32(enabled.data, 0x1d0), 0);
assertExistingPatches(enabled, 0xe01c);

project = await load(bytes);
assert(getFiveBoxPmcStatus(project).enabled);
await installBundledPmc(project);
const updated = open(await exportProject(project));
assert.deepEqual(updated.arm9, enabled.arm9);
assert.deepEqual(updated.getFileByName(PMC_SYMBOL_PATH), enabled.getFileByName(PMC_SYMBOL_PATH));
assert.deepEqual(updated.getFileByName("overlay/overlay_0344.bin"), enabled.getFileByName("overlay/overlay_0344.bin"));
assertExistingPatches(updated, 0xe01c);

await setFiveBoxPmcMode(project, false);
const restored = open(await exportProject(project));
assert.equal(detectPmcInstallFromRom(restored)?.pmc?.version, "13.2.4-heap220");
assert.equal(readU32(restored.arm9OverlayTable, 344 * 32 + 8), 0x3000);
assertExistingPatches(restored, 0xd01c);

await writeFile(output, bytes, { flag: "wx" });
console.log(JSON.stringify({ frostCompatibility, installedModules: sourceModules.length, relocatedIconPalette: Boolean(palette),
  reimported: true, updated: true, restored: true }));
