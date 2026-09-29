import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { applyCustomUi, disableCustomUi } from "../src/pokeweb/customUiModel";
import { getLearnsetViewerStatus, installLearnsetViewer, learnsetViewerPaths } from "../src/pokeweb/learnsetViewerModel";
import { getRomFileBytes } from "../src/pokeweb/fileSystemModel";
import { installMenuEvolution } from "../src/pokeweb/menuEvolutionModel";
import { installBattleLog } from "../src/pokeweb/battleLogModel";
import { nativeLearnsetPreset } from "../src/customUi/nativeCatalog";
import { ARCHIVE_PATH, exportBundle } from "../src/customUi/bundle";
import { readCustomUiConfig } from "../src/customUi/runtimeConfig";

const path = process.argv[2]; if (!path) throw new Error("Usage: vite-node scripts/verify-custom-ui-install.ts input.nds [--enhanced] [--output separately-named.nds]");
const input = new Uint8Array(await readFile(path)), hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), before = hash(input);
const project = await loadProjectFromRomBytes(input, basename(path), { selectedNarcs: ["message_texts", "personal", "moves", "learnsets", "evolutions"] });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  const name = url.pathname.split("/").pop()!;
  try { return new Response(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${name}`, import.meta.url)))); }
  catch { return new Response(undefined, { status: 404 }); }
}) as typeof fetch;
if (process.argv.includes("--enhanced")) { await installBattleLog(project); await installMenuEvolution(project); await installLearnsetViewer(project); }
project.customUi = nativeLearnsetPreset();
await applyCustomUi(project);
assert(project.customUi.installation?.enabled);
const version = project.session.baseVersion as "W2" | "B2", rom = new NintendoDSRom(input, { fileData: "view" });
const menuPath = learnsetViewerPaths(version)[0];
let cfg = readCustomUiConfig(project.fileSystem!.additions![menuPath])!;
assert(cfg.enabled && cfg.validMenu); assert.equal(cfg.learnsetEnabled, process.argv.includes("--enhanced"));
const first = project.fileSystem!.additions![ARCHIVE_PATH].slice(), originalProgram = new NARC(first).files[2];
assert.deepEqual([...first.slice(4, 8)], [0xfe, 0xff, 0, 1], "Retail archive header accepted by the bounded native reader");
await applyCustomUi(project); assert.deepEqual(project.fileSystem!.additions![ARCHIVE_PATH], first, "Idempotent apply");
project.customUi!.document.launchers.field = "learnset";
const fsBefore = project.fileSystem, codeBefore = project.codeInjection;
await assert.rejects(applyCustomUi(project), /field-menu/);
assert.equal(project.fileSystem, fsBefore); assert.equal(project.codeInjection, codeBefore); assert.deepEqual(project.fileSystem!.additions![ARCHIVE_PATH], first);
delete project.customUi!.document.launchers.field;
project.customUi!.document.screens[0].elements.find(e => e.native === "learnset.stats")!.hidden = true;
await applyCustomUi(project); assert.notDeepEqual(new NARC(project.fileSystem!.additions![ARCHIVE_PATH]).files[2], originalProgram);
project.customUi!.document.screens[0].elements.find(e => e.native === "learnset.stats")!.hidden = false;
await applyCustomUi(project);
// A separate learnset install must preserve the registered custom command.
if (process.argv.includes("--enhanced")) { await installLearnsetViewer(project); assert(readCustomUiConfig(project.fileSystem!.additions![menuPath])!.enabled); }
const output = await exportModifiedRom(project), exported = new NintendoDSRom(output, { fileData: "view" });
assert.deepEqual(exported.getFileByName("a/1/2/5"), rom.getFileByName("a/1/2/5"), "Native tutor art is unchanged");
const reloaded = await loadProjectFromRomBytes(output, "custom-ui-test.nds", { selectedNarcs: ["message_texts"] });
assert.deepEqual(exportBundle(reloaded.customUi!), exportBundle(project.customUi!)); assert(reloaded.customUi!.installation!.enabled);
assert(getLearnsetViewerStatus(reloaded).compatible);
await disableCustomUi(reloaded); assert(!reloaded.customUi!.installation!.enabled);
const moduleId = exported.filenames.idOf(menuPath)!;
cfg = readCustomUiConfig(getRomFileBytes(reloaded, exported, moduleId))!; assert(!cfg.enabled && cfg.validMenu);
assert.deepEqual(exportBundle(reloaded.customUi!), exportBundle(project.customUi!));
assert.equal(hash(input), before); assert.equal(hash(new Uint8Array(await readFile(path))), before);
const outAt = process.argv.indexOf("--output");
if (outAt >= 0) { const out = process.argv[outAt + 1]; if (!out || out === path) throw new Error("Choose a separate output filename."); await writeFile(out, output, { flag: "wx" }); console.log("Created", out); }
console.log(JSON.stringify({ game: version, sourceSha256: before, outputSha256: hash(output), install: true, update: true, idempotence: true, failedStagingPreservesPrior: true, disableAfterReload: true, sourceRoundTrip: true, enhancedCoexistence: process.argv.includes("--enhanced"), emulatorTested: false }, null, 2));
