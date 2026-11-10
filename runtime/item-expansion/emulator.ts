// Item expansion check on a clean US White 2 / Black 2 ROM (desmond, headless).
// npx vite-node runtime/item-expansion/emulator.ts /path/clean.nds [--vanilla] [--retail-save] [--item 700] [--frames N]
//
// Installs the expansion, names item --item ("Test Item", Items pocket), puts 7 of it in the converted quick-launch
// save's bag and boots to the field. Reports whether the game reached the field, the bag block the game loaded, the
// format error screen for --retail-save, and saves screenshots to runtime/item-expansion/build/emulator/<label>/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { stageItemExpansion, ITEM_TEXT_BANKS } from "../../src/pokeweb/itemExpansionModel";
import { getTextBank, commitTextBank } from "../../src/pokeweb/textModel";
import { markDirty } from "../../src/pokeweb/projectStore";
import { NintendoDSRom } from "../../src/nds/rom";
import { EXPANDED_SAVE_LAYOUT, recoverSave, encodeSave, detectSaveFormat } from "../../src/pokeweb/itemSaveFormat";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
if (!romPath) throw new Error("Pass a clean US Black 2 or White 2 ROM.");
const testItem = Number(option("--item") ?? 700);
const label = option("--name") ?? [basename(romPath, ".nds"), argv.includes("--vanilla") ? "vanilla" : "items", argv.includes("--retail-save") ? "retail-save" : ""].filter(Boolean).join("-");
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
if (!argv.includes("--vanilla")) {
  await installCodeInjectionPatch(project, (staged) => stageItemExpansion(staged));
  // Author the test item: a name and the Items pocket (field pocket bits 7-10 of the attribute halfword are 0).
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  const names = getTextBank(project, "message_texts", ITEM_TEXT_BANKS.names);
  names[testItem][1] = "Test Item";
  commitTextBank(project, "message_texts", ITEM_TEXT_BANKS.names);
  const record = project.narcs.items!.rawFiles[testItem];
  record[0] = 100; // price
  markDirty(project, "items", testItem);
}
const downloads = await buildQuickLaunchDownloads(project);
const romBytes = downloads.romBytes;
let saveBytes = downloads.saveBytes;
// The quick-launch save is a DeSmuME .dsv: raw 512 KiB followed by a footer.
const raw = saveBytes.subarray(0, 0x80000);
console.log("quick-launch save format:", detectSaveFormat(raw));
if (!argv.includes("--vanilla") && !argv.includes("--retail-save")) {
  // Put 7 of the test item into the bag (Items pocket items come first in the pool).
  const recovered = recoverSave(raw, EXPANDED_SAVE_LAYOUT);
  const bag = recovered.payloads[25].slice();
  let used = 0;
  while (used < 1023 && (bag[4 + used * 4] | (bag[5 + used * 4] << 8))) used++;
  // Insert at the end of the Items pocket (pocket 0): find the first slot whose item is not in pocket 0.
  const pocketOf = (item: number) => item >= 639 ? 0 : ((project.narcs.items!.rawFiles[item][8] | (project.narcs.items!.rawFiles[item][9] << 8)) >> 7) & 15;
  let at = 0;
  while (at < used && pocketOf(bag[4 + at * 4] | (bag[5 + at * 4] << 8)) === 0) at++;
  bag.copyWithin(4 + (at + 1) * 4, 4 + at * 4, 4 + used * 4);
  bag[4 + at * 4] = testItem & 0xff; bag[5 + at * 4] = testItem >> 8; bag[6 + at * 4] = 7; bag[7 + at * 4] = 0;
  recovered.payloads[25] = bag;
  const patched = encodeSave(raw, EXPANDED_SAVE_LAYOUT, recovered.payloads, recovered.counts, recovered.generation);
  saveBytes = new Uint8Array(saveBytes); saveBytes.set(patched, 0);
} else if (argv.includes("--retail-save")) {
  const original = await buildQuickLaunchDownloads({ ...project, codeInjection: { ...project.codeInjection, itemExpansion: undefined } });
  saveBytes = new Uint8Array(saveBytes); saveBytes.set(original.saveBytes.subarray(0, 0x80000), 0);
  console.log("forced retail save:", detectSaveFormat(saveBytes.subarray(0, 0x80000)));
}
await writeFile(join(output, "rom.nds"), romBytes);
await writeFile(join(output, "save.dsv"), saveBytes);

const corePath = fileURLToPath(new URL("../../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r);
const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (argv.includes("--debug")) console.log(line); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: corePath, console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module; core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const ptr = core._prepareRomBuffer(size); core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");

const KEY = { right: 1, left: 2, down: 4, up: 8, select: 16, start: 32, b: 64, a: 128, y: 256, x: 512 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const touch = (x: number, y: number, frames = 6) => { for (let i = 0; i < frames; i++, frame++) core._runFrame(1, 0, 1, x, y); step(2); };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };

// The loaded bag in RAM: the version-2 pool begins with the word 2 followed by item/count pairs.
const findBag = () => {
  const memory = ram();
  const needle = Buffer.alloc(8); needle.writeUInt32LE(2, 0);
  for (let at = memory.indexOf(Buffer.from([2, 0, 0, 0])); at >= 0; at = memory.indexOf(Buffer.from([2, 0, 0, 0]), at + 4)) {
    if (at % 4) continue;
    let ok = true, count = 0;
    for (let slot = 0; slot < 1023; slot++) {
      const item = memory.readUInt16LE(at + 4 + slot * 4), n = memory.readUInt16LE(at + 6 + slot * 4);
      if (!item) { if (n) ok = false; break; }
      if (item > 1023 || !n || n > 999) { ok = false; break; }
      count++;
    }
    if (ok && count > 20) {
      const items: Array<[number, number]> = [];
      for (let slot = 0; slot < count; slot++) items.push([memory.readUInt16LE(at + 4 + slot * 4), memory.readUInt16LE(at + 6 + slot * 4)]);
      return { address: 0x02000000 + at, count, items };
    }
  }
  return undefined;
};

for (let i = 0; i < 160; i++) step(20, i % 3 === 0 ? KEY.a : 0);
await capture("after-boot");
const bag = findBag();
const result: Record<string, unknown> = { rom: basename(romPath), label, frames: frame, bagFound: Boolean(bag), bagCount: bag?.count, testItem: bag?.items.find(([item]) => item === testItem) };
// Open the field menu and the bag, then wrap from the first row to the Items pocket's last item.
step(30); step(4, KEY.x); step(40); await capture("menu");
touch(64, 105); step(120); await capture("bag");
step(4, KEY.up); step(30); await capture("bag-last");
step(4, KEY.up); step(30); await capture("bag-last-2");
result.bagOpened = true;
if (argv.includes("--save")) {
  // Give the test item to the first party Pokemon (swapping its item back into the bag), save, read the card back.
  step(4, KEY.a); step(40); await capture("give-1");
  step(4, KEY.a); step(90); await capture("give-2");       // "Give" -> party
  step(4, KEY.a); step(60); await capture("give-3");       // first Pokemon -> "already holding ... swap?"
  for (let i = 0; i < 4; i++) { step(4, KEY.a); step(50); await capture(`give-4-${i}`); }
  for (let i = 0; i < 6; i++) { step(4, KEY.b); step(40); }
  await capture("after-give");
  step(4, KEY.x); step(60); touch(64, 153); step(90); await capture("save-prompt");
  for (let i = 0; i < 6; i++) { step(4, KEY.a); step(60); }
  step(600); await capture("saved");
  const card = new Uint8Array(core.HEAPU8.subarray(core._savGetPointer(0), core._savGetPointer(0) + 0x80000));
  const format = detectSaveFormat(card);
  const recovered = recoverSave(card, EXPANDED_SAVE_LAYOUT);
  const bagAfter = recovered.payloads[25];
  let found: [number, number] | undefined;
  for (let slot = 0; slot < 1023; slot++) { const item = bagAfter[4 + slot * 4] | (bagAfter[5 + slot * 4] << 8); if (item === testItem) found = [item, bagAfter[6 + slot * 4]]; }
  result.saved = { format, generation: recovered.generation, testItemInBag: found };
  await writeFile(join(output, "saved.sav"), card);
}
console.log(JSON.stringify(result));
await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
