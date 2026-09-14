import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getLearnsetViewerStatus, installLearnsetViewer, uninstallLearnsetViewer, learnsetViewerPaths } from "../src/pokeweb/learnsetViewerModel";
import { installMenuEvolution, getMenuEvolutionInstallStatus } from "../src/pokeweb/menuEvolutionModel";
import { installBattleLog } from "../src/pokeweb/battleLogModel";
import { getTextBank } from "../src/pokeweb/textModel";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node scripts/verify-learnset-viewer-install.ts INPUT.nds [--enhanced-first|--enhanced-last] [--output OUTPUT.nds]");
const bytes = new Uint8Array(await readFile(input));
const rom = new NintendoDSRom(bytes);
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
const before = getLearnsetViewerStatus(project);
assert(before.compatible, before.message);
const oldTutor = structuredClone(getTextBank(project, "message_texts", 401));
const first = await installLearnsetViewer(project);
assert.equal(getLearnsetViewerStatus(project).updateAvailable, false, "Companion update did not replace the old metadata");
if (before.messageIds) assert.deepEqual(first, before.messageIds, "Updating must preserve allocated message IDs");
assert.deepEqual(await installLearnsetViewer(project), first);
assert.deepEqual(getTextBank(project, "message_texts", 401).slice(0, oldTutor.length), oldTutor, "Shared tutor messages changed");
for (const [bank, text] of [[178, "LEARNSET"], [401, "No level-up moves."], [401, "Learnset unavailable."]] as const) {
  assert.equal(getTextBank(project, "message_texts", bank).filter(entry => entry[1] === text).length, 1);
}
if (getLearnsetViewerStatus(project).canUninstall) {
  uninstallLearnsetViewer(project);
  assert(!getLearnsetViewerStatus(project).installed);
  assert.deepEqual(await installLearnsetViewer(project), first);
}
if (process.argv.includes("--enhanced-last")) await enhanced();
assert(getLearnsetViewerStatus(project).compatible, getLearnsetViewerStatus(project).message);
if (process.argv.includes("--enhanced-first") || process.argv.includes("--enhanced-last")) assert(getMenuEvolutionInstallStatus(project).upToDate);
const output = await exportModifiedRom(project);
const exported = new NintendoDSRom(output);
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
