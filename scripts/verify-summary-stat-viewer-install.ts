import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getSummaryStatViewerStatus, installSummaryStatViewer, uninstallSummaryStatViewer } from "../src/pokeweb/summaryStatViewerModel";
import { listCodeInjectionDlls } from "../src/pokeweb/pmcModel";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node scripts/verify-summary-stat-viewer-install.ts INPUT.nds [--output NEW.nds]");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = new Uint8Array(await readFile(input)), inputHash = digest(bytes);
const original = new NintendoDSRom(bytes, { fileData: "view" });
globalThis.fetch = (async (value: RequestInfo | URL) => {
  const url = value instanceof URL ? value : new URL(value instanceof Request ? value.url : String(value));
  const name = url.pathname.split("/").pop()!;
  return new Response(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${name}`, import.meta.url))));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: [] });
assert(getSummaryStatViewerStatus(project).compatible, getSummaryStatViewerStatus(project).message);
const result = await installSummaryStatViewer(project);
assert(getSummaryStatViewerStatus(project).options.includeEvs);
await installSummaryStatViewer(project, { includeEvs: false });
assert(!getSummaryStatViewerStatus(project).options.includeEvs);
assert.equal(listCodeInjectionDlls(project).filter(m => /SummaryStatViewer/u.test(m.fileName)).length, 1);
if (getSummaryStatViewerStatus(project).canUninstall) {
  uninstallSummaryStatViewer(project);
  assert(!getSummaryStatViewerStatus(project).installed);
  await installSummaryStatViewer(project, { includeEvs: false });
}
const output = await exportModifiedRom(project), exported = new NintendoDSRom(output, { fileData: "view" });
assert.equal(digest(bytes), inputHash);
assert.deepEqual(exported.loadArm9Overlays([207]).get(207)!.data, original.loadArm9Overlays([207]).get(207)!.data);
const beforeGraphics = new NARC(original.getFileByName("a/0/7/7")), afterGraphics = new NARC(exported.getFileByName("a/0/7/7"));
assert.deepEqual(afterGraphics.files.map(digest), beforeGraphics.files.map(digest));
const reopened = await loadProjectFromRomBytes(output, "summary-stats-verification.nds", { selectedNarcs: [] });
assert.deepEqual(getSummaryStatViewerStatus(reopened).options, { includeEvs: false });
assert(getSummaryStatViewerStatus(reopened).installed && getSummaryStatViewerStatus(reopened).compatible);
const id = exported.fileId(result.path);
await installSummaryStatViewer(reopened, { includeEvs: true });
assert(reopened.fileSystem?.replacements[id]);
assert(getSummaryStatViewerStatus(reopened).options.includeEvs);
assert.equal(digest(new Uint8Array(await readFile(input))), inputHash, "Input ROM changed on disk");
const at = process.argv.indexOf("--output");
if (at !== -1) {
  if (!process.argv[at + 1] || process.argv[at + 1] === input) throw new Error("--output requires a separately named ROM.");
  // Deliver the final, EV-enabled configuration after checking the IV-only
  // export/reload path. Never overwrite an existing ROM.
  await writeFile(process.argv[at + 1], await exportModifiedRom(reopened), { flag: "wx" });
}
console.log(project.session.baseVersion, "real-ROM install, options update, staged removal/reinstall, export/reload, unchanged native Summary/assets and unchanged source hash passed");
