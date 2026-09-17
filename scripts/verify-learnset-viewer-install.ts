import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { readU32 } from "../src/nds/binary";
import { decompressCode } from "../src/nds/codeCompression";
import { setArm9CompressedStaticEnd } from "../src/nds/arm9ModuleParams";
import { detectPmcInstallFromRom } from "../src/pokeweb/pmcModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer, learnsetViewerPaths, LEARNSET_INFO_MESSAGES } from "../src/pokeweb/learnsetViewerModel";
import { installMenuEvolution, getMenuEvolutionInstallStatus } from "../src/pokeweb/menuEvolutionModel";
import { installBattleLog } from "../src/pokeweb/battleLogModel";
import { getTextBank } from "../src/pokeweb/textModel";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node scripts/verify-learnset-viewer-install.ts INPUT.nds [--enhanced-first|--enhanced-last] [--output OUTPUT.nds]");
const bytes = new Uint8Array(await readFile(input));
const rom = new NintendoDSRom(bytes);
const existingPmc = detectPmcInstallFromRom(rom)?.pmc;
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts", "evolutions"] });
const version = project.session.baseVersion;
assert(version === "W2" || version === "B2");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const name = url.pathname.split("/").pop()!;
  try { return new Response(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${name}`, import.meta.url)))); }
  catch { return new Response(undefined, { status: 404 }); }
}) as typeof fetch;
async function enhanced() { await installBattleLog(project); await installMenuEvolution(project); }
if (process.argv.includes("--enhanced-first")) await enhanced();
const arm9BeforeLearnset = project.arm9.slice();
const before = getLearnsetViewerStatus(project);
assert(before.compatible, before.message);
const oldTutor = structuredClone(getTextBank(project, "message_texts", 401));
const first = await installLearnsetViewer(project);
const allocatedInfoIds = project.codeInjection!.learnsetViewer!.infoMessageIds!.slice();
allocatedInfoIds.forEach((id, i) => assert.equal(getTextBank(project, "message_texts", 401)[id]![1], LEARNSET_INFO_MESSAGES[i]![1], "Private info ID points at outdated text"));
assert.equal(getLearnsetViewerStatus(project).updateAvailable, false, "Companion update did not replace the old metadata");
if (before.messageIds) assert.deepEqual(first, before.messageIds, "Updating must preserve allocated message IDs");
assert.deepEqual(await installLearnsetViewer(project), first);
assert.deepEqual(project.codeInjection!.learnsetViewer!.infoMessageIds, allocatedInfoIds);
for (const [, text] of LEARNSET_INFO_MESSAGES) assert.equal(getTextBank(project, "message_texts", 401).filter(entry => entry[1] === text).length, 1);
assert.deepEqual(getTextBank(project, "message_texts", 401).slice(0, oldTutor.length), oldTutor, "Shared tutor messages changed");
for (const [bank, text] of [[178, "LEARNSET"], [401, "No level-up moves."], [401, "Learnset unavailable."]] as const) {
  assert.equal(getTextBank(project, "message_texts", bank).filter(entry => entry[1] === text).length, 1);
}
if (getLearnsetViewerStatus(project).canUninstall) {
  uninstallLearnsetViewer(project);
  assert(!getLearnsetViewerStatus(project).installed);
  assert.deepEqual(await installLearnsetViewer(project), first);
}
if (existingPmc) assert.deepEqual(project.arm9, arm9BeforeLearnset, "LEARNSET changed ARM9 while an existing PMC loader was installed");
if (process.argv.includes("--enhanced-last")) await enhanced();
assert(getLearnsetViewerStatus(project).compatible, getLearnsetViewerStatus(project).message);
if (process.argv.includes("--enhanced-first") || process.argv.includes("--enhanced-last")) assert(getMenuEvolutionInstallStatus(project).upToDate);
const output = await exportModifiedRom(project);
const exported = new NintendoDSRom(output);
if (existingPmc) {
  // Export may normalize a stale compressed-static-end pointer even when the
  // input ARM9 is already uncompressed. Compare executable bytes independently
  // of that SDK compression bookkeeping field.
  const beforeArm9 = decompressCode(rom.arm9).slice(), afterArm9 = decompressCode(exported.arm9).slice();
  setArm9CompressedStaticEnd(beforeArm9, 0); setArm9CompressedStaticEnd(afterArm9, 0);
  // Battle Log deliberately changes other ARM9 routines. Always verify PMC's
  // caller/wrapper; without that optional feature, verify the whole executable.
  for (const [address, length] of [[0x0200400c, 24], [0x0200512a, 4]]) {
    const offset = address - rom.arm9RamAddress;
    assert.deepEqual(afterArm9.subarray(offset, offset + length), beforeArm9.subarray(offset, offset + length), "PMC startup code changed");
  }
  if (!process.argv.includes("--enhanced-first") && !process.argv.includes("--enhanced-last")) {
    assert.deepEqual(afterArm9, beforeArm9, "Installing LEARNSET changed ARM9 executable code");
  }
  assert.deepEqual(exported.arm9OverlayTable, rom.arm9OverlayTable, "Installing LEARNSET changed the existing overlay table");
  const fileId = readU32(rom.arm9OverlayTable, existingPmc.overlayId * 32 + 24);
  assert.deepEqual(exported.files[fileId], rom.files[fileId], "Installing LEARNSET replaced the existing PMC image");
  assert.deepEqual(detectPmcInstallFromRom(exported)?.pmc, existingPmc);
}
assert.deepEqual(exported.getFileByName("a/1/2/5"), rom.getFileByName("a/1/2/5"), "Global tutor graphics changed");
for (const path of learnsetViewerPaths(version)) assert(exported.getFileByName(path).length > 0);
const reloaded = await loadProjectFromRomBytes(output, "learnset-check.nds", { selectedNarcs: ["message_texts"] });
const status = getLearnsetViewerStatus(reloaded);
assert(status.installed && status.compatible && !status.updateAvailable && !status.canUninstall, JSON.stringify(status));
assert.deepEqual(status.messageIds, first);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1) {
  const path = process.argv[outputIndex + 1];
  if (!path) throw new Error("--output needs a filename");
  await writeFile(path, output, { flag: "wx" }); // never overwrite an existing ROM
  console.log("Created", basename(path));
}
console.log(version, "LEARNSET install, idempotence, removal/reinstall, private messages/graphics, enhanced-menu coexistence, export and reload passed.");
