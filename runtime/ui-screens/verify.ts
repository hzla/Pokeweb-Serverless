// Local integration verification. ROMs, save copies and captures stay in the output directory.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { openMainMenu, applyMainMenu, designKey, GRAPHICS_PATH } from "../../src/nativeUi/model";
import { defaults, moveButton, swapButtons } from "../../src/nativeUi/document";
import { compileGraphics, compose, bodyImage, iconImage, fixedPaletteColors } from "../../src/nativeUi/graphics";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";

const input = process.argv[2], output = process.argv[3];
if (!input || !output) throw new Error("Usage: vite-node runtime/ui-screens/verify.ts SOURCE.nds OUTPUT_DIRECTORY [--emulator]");
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => { const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input)); if (url.protocol !== "file:") throw new Error("This verifier only reads bundled local assets."); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = new Uint8Array(await readFile(input)), project = await loadProjectFromRomBytes(bytes, "native-menu-verification.nds", { selectedNarcs: [] });
const library = await openMainMenu(project), stock = new NARC(library.state.source);
const noop = compileGraphics(stock.files, library.state.draft, library.version);
check(noop.files.length === stock.files.length && noop.files.every((b, i) => hash(b) === hash(stock.files[i])), "No-op graphics changed bytes.");
check(!(await applyMainMenu(project, library)).changed && !project.fileSystem, "No-op apply staged ROM mutations.");
const pinned = [...fixedPaletteColors(stock.files)].find(i => i > 0 && i < 160 && i % 16);
check(pinned !== undefined, "No protected palette colors were inspected.");
const forbidden = defaults(); forbidden.colors[`2:${pinned}`] = "#abcdef";
let paletteRejected = false;
try { compileGraphics(stock.files, forbidden, library.version); } catch { paletteRejected = true; }
check(paletteRejected, "A fixed control's shared color was writable.");
const crowded = defaults(); let random = 89173;
for (let id = 1; id <= 6; id++) { const pixels = new Uint8ClampedArray(128 * 40 * 4); for (let p = 0; p < pixels.length; p += 4) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; const v = random >>> 31 ? 240 : 32; pixels.set([v, v, v, 255], p); } crowded.images[`body:${id}`] = { width: 128, height: 40, pixels }; }
let budgetRejected = false; try { compileGraphics(stock.files, crowded, library.version); } catch { budgetRejected = true; }
check(budgetRejected, "Oversized tile artwork was accepted.");
const cosmetic = await loadProjectFromRomBytes(bytes, "cosmetic-verification.nds", { selectedNarcs: [] }), cosmeticLibrary = await openMainMenu(cosmetic);
cosmeticLibrary.state.draft.colors["2:33"] = "#406070"; await applyMainMenu(cosmetic, cosmeticLibrary);
check(!cosmetic.codeInjection?.pmc && !cosmetic.arm9Dirty && !Object.keys(cosmetic.fileSystem!.additions!).some(p => p.endsWith(".dll")), "Cosmetic edits installed a native runtime.");

swapButtons(library.state.draft.buttons[0], library.state.draft.buttons[5]);
library.state.draft.buttons[0].label = "PARTY";
library.state.draft.buttons[0].neighbors.up = 2;
const panel = bodyImage(stock.files, 3, library.version);
for (let y = 24; y < 32; y++) for (let x = 104; x < 120; x++) panel.pixels.set([112, 112, 112, 255], (y * 128 + x) * 4);
library.state.draft.images["body:3"] = panel;
const icon = iconImage(stock.files, 6, "male", false); icon.pixels.set([0, 255, 0, 255], (16 * 32 + 16) * 4);
library.state.draft.images["icon:6:male:normal"] = icon;
library.state.draft.colors["2:33"] = "#406070";

const borrowed = stock.files.map(b => Buffer.from(b)), borrowedHashes = borrowed.map(hash);
compileGraphics(borrowed, library.state.draft, library.version);
check(borrowed.every((b, i) => hash(b) === borrowedHashes[i]), "Graphics compilation mutated borrowed input buffers.");
const preview = compose(library.resources, library.state.draft, { gender: "male", focus: 1, pressed: false, trainer: "Player" });
const previewPng = new PNG({ width: preview.width, height: preview.height }); previewPng.data = Buffer.from(preview.pixels); await writeFile(`${output}/preview.png`, PNG.sync.write(previewPng));
await applyMainMenu(project, library);
const applied = designKey(project.uiScreens!.applied), document = createProjectDocument(project, true), restored = openProjectSession(structuredClone(document));
check(designKey(restored.uiScreens!.draft) === applied, "Project persistence lost the applied design.");
const exported = await exportModifiedRom(project, { forDsi: false }), result = new NintendoDSRom(exported, { fileData: "view" });
const graphics = new NARC(result.getFileByName(GRAPHICS_PATH));
check(hash(graphics.files[43]) === hash(stock.files[18]), "The special menu lost its original map.");
for (const id of Array.from({ length: 43 }, (_, i) => i).filter(i => ![2, 3, 6, 18].includes(i))) check(hash(graphics.files[id]) === hash(stock.files[id]), `Unrelated menu resource ${id} changed.`);
const beforeOverlay = library.rom.loadArm9Overlays([36]).get(36)!, afterOverlay = result.loadArm9Overlays([36]).get(36)!;
const allowedFiles = new Set([library.rom.fileId(GRAPHICS_PATH), beforeOverlay.fileId]);
const names = new Map<number, string>();
function collect(folder: NintendoDSRom["filenames"], prefix = ""): void { folder.files.forEach((name, i) => names.set(folder.firstId + i, prefix + name)); for (const [name, child] of folder.folders) collect(child, prefix + name + "/"); }
collect(library.rom.filenames);
let unchangedFiles = 0;
for (let id = 0; id < library.rom.files.length; id++) if (!allowedFiles.has(id)) { const name = names.get(id), target = name ? result.fileId(name) : id; check(hash(library.rom.files[id]) === hash(result.files[target]), `Unrelated ROM file ${id} changed.`); unchangedFiles++; }
check(unchangedFiles > 300, "ROM isolation check inspected too few files.");

let changed = 0;
for (let i = 0; i < beforeOverlay.data.length; i++) if (beforeOverlay.data[i] !== afterOverlay.data[i]) changed++;
check(changed > 0 && changed <= 4, "Unexpected field overlay changes.");
const reloaded = await loadProjectFromRomBytes(exported, "native-menu-reopened.nds", { selectedNarcs: [] }), reopened = await openMainMenu(reloaded);
check(designKey(reopened.state.applied) === applied, "ROM export/reload lost the editable design.");
check(!(await applyMainMenu(reloaded, reopened)).changed, "Reapplying the exported design was not a no-op.");
reopened.state.draft = defaults();
await applyMainMenu(reloaded, reopened);
const resetArchive = new NARC(reloaded.fileSystem!.replacements[reopened.rom.fileId(GRAPHICS_PATH)]);
check(resetArchive.files.length === stock.files.length && resetArchive.files.every((b, i) => hash(b) === hash(stock.files[i])), "Reset did not restore the original graphics archive.");
reopened.state.draft = structuredClone(project.uiScreens!.applied);
await applyMainMenu(reloaded, reopened);
check(designKey(reopened.state.applied) === applied, "Editing again after Reset lost the design.");
const abort = new AbortController(); abort.abort(); const appliedSnapshot = designKey(project.uiScreens!.applied), filesSnapshot = Object.keys(project.fileSystem!.additions!).length;
project.uiScreens!.draft.buttons[0].label = "TEAM";
let cancelled = false; try { await applyMainMenu(project, library, abort.signal); } catch (e) { cancelled = e instanceof Error && e.name === "AbortError"; }
check(cancelled && appliedSnapshot === designKey(project.uiScreens!.applied) && filesSnapshot === Object.keys(project.fileSystem!.additions!).length, "Closing the editor did not cancel atomic staging.");
project.uiScreens!.draft.buttons[0].label = "PARTY";
// An ownership conflict must leave all staged files and the applied state intact.
const conflict = await openMainMenu(project), snapshot = designKey(project.uiScreens!.applied), fileCount = Object.keys(project.fileSystem!.additions!).length;
project.uiScreens!.draft.buttons[0].label = "TEAM";
const owned = new NARC(project.fileSystem!.replacements[library.rom.fileId(GRAPHICS_PATH)]); owned.files[18][40] ^= 1; project.fileSystem!.replacements[library.rom.fileId(GRAPHICS_PATH)] = owned.save();
moveButton(project.uiScreens!.draft.buttons[0], 0, -8);
const conflictHash = hash(project.fileSystem!.replacements[library.rom.fileId(GRAPHICS_PATH)]);
let rejected = false;
try { await applyMainMenu(project, conflict); } catch { rejected = true; }
check(rejected, "Conflicting owned graphics were accepted.");
check(snapshot === designKey(project.uiScreens!.applied) && fileCount === Object.keys(project.fileSystem!.additions!).length && conflictHash === hash(project.fileSystem!.replacements[library.rom.fileId(GRAPHICS_PATH)]), "Rejected staging mutated the project.");
console.log(JSON.stringify({ game: library.version, noOp: true, projectRoundTrip: true, exportRoundTrip: true, specialMapPreserved: true, fieldOverlayBytesChanged: changed, graphicsConflictRejected: true }));
await writeFile(`${output}/edited.nds`, exported);
if (!process.argv.includes("--emulator")) process.exit(0);

const downloads = await buildQuickLaunchDownloads(reloaded);
await writeFile(`${output}/test.nds`, downloads.romBytes); await writeFile(`${output}/test.dsv`, downloads.saveBytes);
const sourcePath = new URL("../../public/desmond/desmond.js", import.meta.url), source = await readFile(sourcePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => { ready = r; }), fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: fileURLToPath(sourcePath), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), ctx); await initialized;
const core = ctx.Module; core._main(0, 0);
const size = Math.max(downloads.romBytes.length, 128 * 1024 * 2 ** downloads.romBytes[0x14]), pointer = core._prepareRomBuffer(size);
core.HEAPU8.set(downloads.romBytes, pointer); core.HEAPU8.fill(255, pointer + downloads.romBytes.length, pointer + size);
core.HEAPU8.set(downloads.saveBytes, core._savGetPointer(downloads.saveBytes.length)); core._savUpdateChangeFlag(); check(core._loadROM(size) === 1, "Emulator rejected ROM.");
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
function menuWork(): number {
  const m = ram();
  for (let p = 0x100000; p + 0x150 < m.length; p += 4) {
    if (m.readUInt32LE(p + 0x34) !== 1 || m.readUInt32LE(p + 0x3c) !== 1) continue;
    let matches = true;
    for (let i = 1; i < 6; i++) if (m.readUInt32LE(p + 0x34 + i * 28) !== 1 || m.readUInt32LE(p + 0x3c + i * 28) !== i + 1) { matches = false; break; }
    if (matches) return p;
  }
  return -1;
}
let frame = 0;
const trace: unknown[] = [];
function step(count: number, keys = 0, touch?: [number, number]): void {
  for (let i = 0; i < count; i++, frame++) {
    core._runFrame(1, keys, Number(!!touch), touch?.[0] ?? 0, touch?.[1] ?? 0);
    check(!fatal.length, `Native crash at frame ${frame}: ${fatal.join("; ")}`);
  }
}
function fb(): Buffer { const at = core._getSymbol(4) >>> 0; return Buffer.from(core.HEAPU8.subarray(at, at + 256 * 384 * 4)); }
async function capture(name: string): Promise<void> {
  const png = new PNG({ width: 256, height: 384 }); png.data = fb(); await writeFile(`${output}/${name}.png`, PNG.sync.write(png));
  const m = ram(), w = menuWork(); const row = { name, frame, work: w, mode: w >= 0 ? m[w + 0x21] : -1, slot: w >= 0 ? m[w + 0x1e] + 2 * m[w + 0x1f] : -1, positions: w >= 0 ? Array.from({ length: 6 }, (_, i) => [m[w + 0x48 + i * 28], m[w + 0x49 + i * 28]]) : [] };
  trace.push(row); console.log(JSON.stringify(row));
}
function key(code: number): void { step(4, code); step(150); }
step(900); key(512); await capture("main-menu");
let work = menuWork(); check(work >= 0 && ram()[work + 0x21] === 0, "The ordinary six-button menu was not reached.");
for (const b of reopened.state.applied.buttons) check(ram()[work + 0x48 + (b.id - 1) * 28] === b.x + 64 && ram()[work + 0x49 + (b.id - 1) * 28] === b.y + 20, "Native button placement does not match the editor.");
const actual = fb();
for (const [x, y] of [[116, 100], [20, 44]]) {
  const offset = (y * 256 + x) * 4, nativeOffset = ((y + 192) * 256 + x) * 4;
  check([0, 1, 2].every(c => Math.abs(preview.pixels[offset + c] - actual[nativeOffset + c]) <= 8), "Native artwork differs from the compiled preview.");
}
const reference = fb(), samplePoints: number[] = [];
for (const b of reopened.state.applied.buttons) for (const x of [80, 96, 112]) for (const y of [28, 32]) samplePoints.push(((192 + b.y + y) * 256 + b.x + x) * 4);
function mainVisible(): boolean { const image = fb(); return samplePoints.filter(at => [0, 1, 2].every(c => Math.abs(image[at + c] - reference[at + c]) < 12)).length >= 24; }
async function returnMain(): Promise<void> {
  for (let i = 0; i < 4 && !mainVisible(); i++) key(64);
  if (!mainVisible()) key(512);
  check(mainVisible(), "Native application did not return to the field menu.");
}
key(8); key(8); await capture("navigation-check"); work = menuWork(); check(work >= 0 && ram()[work + 0x1e] + 2 * ram()[work + 0x1f] === 1, "The authored Up navigation override did not select Pokédex.");
await capture("dpad-up");
key(128); step(300); check(!mainVisible(), "A did not open the selected native Pokédex."); await capture("action-2"); await returnMain();
for (const id of [1, 3, 4, 6, 5]) {
  const b = reopened.state.applied.buttons.find(b => b.id === id)!;
  const before = fb();
  step(4, 0, [Math.floor(b.touch.x + b.touch.width / 2), Math.floor(b.touch.y + b.touch.height / 2)]); step(400);
  if (id !== 5) check(!mainVisible(), `Touch did not open native command ${id}.`);
  else check(!mainVisible() || fb().subarray(0, 256 * 192 * 4).some((v, i) => v !== before[i]), "Save did not open its native confirmation.");
  await capture(`action-${id}`);
  if (id === 5) {
    const saveHash = () => { const at = core._savGetPointer(0), size = core._savGetSize(); return hash(core.HEAPU8.subarray(at, at + size)); };
    const savedBefore = saveHash();
    for (let attempt = 0; attempt < 3 && saveHash() === savedBefore; attempt++) { key(128); step(700); await capture(`save-confirm-${attempt}`); }
    check(saveHash() !== savedBefore, "The native Save command did not write the disposable save.");
    await capture("save-completed"); key(128);
  }
  await returnMain();
}
key(64); check(!mainVisible(), "B did not close the menu."); key(512); check(mainVisible(), "X did not reopen the menu.");
key(512); check(!mainVisible(), "X did not close the menu."); key(512); check(mainVisible(), "Repeated X opening failed.");
step(4, 0, [236, 180]); step(180); check(!mainVisible(), "The unchanged Close control did not close the menu."); key(512); check(mainVisible(), "The menu did not reopen after Close.");
await capture("reopened");
await writeFile(`${output}/trace.json`, JSON.stringify(trace, null, 2));
console.log(JSON.stringify({ game: library.version, nativePlacement: true, navigationOverride: true, allSixActions: true, saveWritten: true, bClose: true, xClose: true, closeTouch: true, repeatedOpening: true }));
