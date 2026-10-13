import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { sha256Hex } from "../src/nds/sha256";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getSummaryTypeIconsStatus, installSummaryTypeIcons, uninstallSummaryTypeIcons } from "../src/pokeweb/summaryTypeIconsModel";
import { getSummaryStatViewerStatus, installSummaryStatViewer } from "../src/pokeweb/summaryStatViewerModel";
import { listCodeInjectionDlls } from "../src/pokeweb/pmcModel";

const input = process.argv[2];
if (!input) throw new Error("Pass a clean US BW2 ROM, optionally --output NEW.nds.");
globalThis.fetch = (async (v: RequestInfo | URL) => new Response(new Uint8Array(await readFile(
  v instanceof URL ? v : new URL(v instanceof Request ? v.url : String(v)))))) as typeof fetch;
const bytes = new Uint8Array(await readFile(input)), hash = sha256Hex(bytes), original = new NintendoDSRom(bytes, { fileData: "view" });
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: [] });
assert(getSummaryTypeIconsStatus(project).compatible, getSummaryTypeIconsStatus(project).message);
await installSummaryStatViewer(project); await installSummaryTypeIcons(project);
assert(getSummaryStatViewerStatus(project).compatible);
await installSummaryTypeIcons(project); assert.equal(listCodeInjectionDlls(project).length, 2);
uninstallSummaryTypeIcons(project); assert(!getSummaryTypeIconsStatus(project).installed); await installSummaryTypeIcons(project);
const output = await exportModifiedRom(project), rom = new NintendoDSRom(output, { fileData: "view" });
assert.deepEqual(rom.loadArm9Overlays([207]).get(207)!.data, original.loadArm9Overlays([207]).get(207)!.data);
for (const path of ["a/0/8/2", "a/0/7/7"]) assert.deepEqual(new NARC(rom.getFileByName(path)).files, new NARC(original.getFileByName(path)).files);
const re = await loadProjectFromRomBytes(output, "summary-type-icons.nds", { selectedNarcs: [] });
assert(getSummaryTypeIconsStatus(re).installed && getSummaryTypeIconsStatus(re).compatible);
assert(getSummaryStatViewerStatus(re).compatible); await installSummaryTypeIcons(re);
assert.equal(sha256Hex(new Uint8Array(await readFile(input))), hash);
const at = process.argv.indexOf("--output");
if (at !== -1) { assert(process.argv[at + 1] && process.argv[at + 1] !== input); await writeFile(process.argv[at + 1], output, { flag: "wx" }); }
console.log(project.session.baseVersion, "install/reinstall/remove, IV/EV coexistence, export/reload, exact native archives and source preservation passed");
