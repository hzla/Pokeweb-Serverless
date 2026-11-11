// Item expansion stress check on a clean US Black / White ROM (desmond, headless).
// npx vite-node runtime/item-expansion/emulator_bw1.ts /path/clean.nds --mode field|battle [--items N]
//
// Installs the expansion and authors items 627..626+N (default 396) as Poké Ball copies ("PW <id>": Items pocket,
// Poké Ball battle pocket), so the Items pocket holds far more than its retail 310 slots and the battle bag's ball
// pocket far more than its retail 36 rows. 3 of each go into the converted save's bag.
// * field: boots the quick-launch save, opens the bag, wraps to the Items pocket's last item, moves it up with
//   SELECT (move mode on the work copy) and confirms; reports the pool before and after.
// * battle: runs the automatic test battle (Mew holding the last authored item), opens the battle bag's ball pocket
//   and pages through it; reports the held item in battle.
// Screenshots go to runtime/item-expansion/build/emulator/<label>/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { itemFamily, stageItemExpansion, validateBagForProject } from "../../src/pokeweb/itemExpansionModel";
import { getTextBank, commitTextBank } from "../../src/pokeweb/textModel";
import { markDirty } from "../../src/pokeweb/projectStore";
import { NintendoDSRom } from "../../src/nds/rom";
import { BW1_BAG_POOL_VERSION, saveLayout, recoverSave, encodeSave, detectSaveFormat } from "../../src/pokeweb/itemSaveFormat";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
const mode = option("--mode") ?? "field";
const authored = Number(option("--items") ?? 396);
const label = option("--name") ?? `${basename(romPath, ".nds")}-bw1-${mode}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
const family = itemFamily(project);
if (family.save !== "BW1") throw new Error("Pass a clean US Black or White ROM.");
await installCodeInjectionPatch(project, (staged) => stageItemExpansion(staged));
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
const names = getTextBank(project, "message_texts", family.textBanks.names);
const ids = [...Array(authored).keys()].map((n) => family.nativeCount + n);
const ball = project.narcs.items!.rawFiles[4]!;
for (const id of ids) {
  names[id][1] = `PW ${id}`;
  project.narcs.items!.rawFiles[id] = ball.slice();
  markDirty(project, "items", id);
}
commitTextBank(project, "message_texts", family.textBanks.names);
const lastItem = ids[ids.length - 1]!;

const layout = saveLayout("BW1", "expanded");
function fillBag(raw: Uint8Array): Uint8Array {
  const recovered = recoverSave(raw, layout);
  const bag = recovered.payloads[25].slice();
  const read = (slot: number) => bag[4 + slot * 4] | (bag[5 + slot * 4] << 8);
  let used = 0;
  while (used < 1023 && read(used)) used++;
  const pocketOf = (item: number) => ((project.narcs.items!.rawFiles[item][8] | (project.narcs.items!.rawFiles[item][9] << 8)) >> 7) & 15;
  let at = 0;
  while (at < used && pocketOf(read(at)) === 0) at++;
  bag.copyWithin(4 + (at + ids.length) * 4, 4 + at * 4, 4 + used * 4);
  ids.forEach((id, n) => { const o = 4 + (at + n) * 4; bag[o] = id & 0xff; bag[o + 1] = id >> 8; bag[o + 2] = 3; bag[o + 3] = 0; });
  recovered.payloads[25] = bag;
  const problem = validateBagForProject(project, bag);
  if (problem) throw new Error(problem);
  return encodeSave(raw, layout, recovered.payloads, recovered.counts, recovered.generation);
}

const downloads = mode === "battle"
  ? await buildTestBattleDownloads(project, Number(option("--trainer") ?? 1), { playerTeamText: `Mew @ PW ${lastItem}\nAbility: Synchronize\nLevel: 100\n- Psychic\n- Recover` })
  : await buildQuickLaunchDownloads(project);
const romBytes = downloads.romBytes;
const saveBytes = new Uint8Array(downloads.saveBytes);
console.log("save format:", detectSaveFormat(saveBytes.subarray(0, 0x80000), "BW1"));
saveBytes.set(fillBag(saveBytes.subarray(0, 0x80000)), 0);
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
const press = (key: number, wait = 30) => { step(4, key); step(wait); };
const touch = (x: number, y: number, frames = 6) => { for (let i = 0; i < frames; i++, frame++) core._runFrame(1, 0, 1, x, y); step(2); };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };

// The bag the game loaded: the "PWB1" pool.
const findBag = () => {
  const memory = ram();
  const word = Buffer.alloc(4); word.writeUInt32LE(BW1_BAG_POOL_VERSION, 0);
  for (let at = memory.indexOf(word); at >= 0; at = memory.indexOf(word, at + 4)) {
    if (at % 4) continue;
    const items: Array<[number, number]> = [];
    for (let slot = 0; slot < 1023; slot++) {
      const item = memory.readUInt16LE(at + 4 + slot * 4), n = memory.readUInt16LE(at + 6 + slot * 4);
      if (!item) break;
      items.push([item, n]);
    }
    if (items.length > 20) return { address: 0x02000000 + at, bytes: new Uint8Array(memory.subarray(at, at + 0x1000)), items };
  }
  return undefined;
};

const result: Record<string, unknown> = { rom: basename(romPath), label, mode, authored };
if (mode === "field") {
  for (let i = 0; i < 160; i++) step(20, i % 3 === 0 ? KEY.a : 0);
  const before = findBag();
  result.poolBefore = before?.items.length;
  result.itemsPocketBefore = before?.items.filter(([item]) => item >= 627).length;
  step(30); press(KEY.x, 40); await capture("menu");
  touch(64, 105); step(120); await capture("bag");
  press(KEY.up, 40); await capture("bag-last");                // wraps to the Items pocket's last item
  press(KEY.select, 40); await capture("move-mode");          // move mode: the work copy (> 310 items)
  for (let i = 0; i < 3; i++) press(KEY.up, 20);
  await capture("move-moved");
  press(KEY.a, 60); await capture("move-confirmed");
  const after = findBag();
  const index = (pool: typeof after, item: number) => pool?.items.findIndex(([id]) => id === item) ?? -1;
  result.poolAfter = after?.items.length;
  result.lastItemIndexBefore = index(before, lastItem);
  result.lastItemIndexAfter = index(after, lastItem);
  result.poolValidAfter = after ? validateBagForProject(project, after.bytes) ?? "valid" : "missing";
  for (let i = 0; i < 5; i++) press(KEY.down, 15);
  await capture("bag-after");
  // The pocket's sort button (bottom bar): ITEMMENU_SortPocket over the whole pocket.
  const sortAt = (option("--sort") ?? "155,182").split(",").map(Number);
  touch(sortAt[0]!, sortAt[1]!); step(90); await capture("sorted");
  const sorted = findBag();
  result.sortedValid = sorted ? validateBagForProject(project, sorted.bytes) ?? "valid" : "missing";
  result.sortedFirstItems = sorted?.items.slice(0, 5);
  result.passOrbIndexBefore = before?.items.findIndex(([id]) => id === 0x1d5);
  result.passOrbIndexAfterMove = after?.items.findIndex(([id]) => id === 0x1d5);
  result.passOrbIndexAfterSort = sorted?.items.findIndex(([id]) => id === 0x1d5);
} else {
  const battleMons = () => {
    const m = ram(); const found: Array<{ address: string; item: number }> = [];
    for (let at = 0; at + 0x20 < m.length; at += 4) {
      const p0 = m.readUInt32LE(at);
      if (p0 < 0x02000000 || p0 >= 0x02400000 || m.readUInt16LE(at + 0xc) !== 151) continue;
      const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
      if (!max || hp > max || max > 999) continue;
      found.push({ address: `0x${(0x02000000 + at).toString(16)}`, item: m.readUInt16LE(at + 0x12) });
    }
    return found;
  };
  let mons: ReturnType<typeof battleMons> = [];
  for (let i = 0; i < 160 && !mons.length; i++) { step(30, i % 4 === 0 ? KEY.a : 0); if (i > 10) mons = battleMons(); }
  step(900); await capture("battle");
  result.battleMons = battleMons();
  result.heldItemSurvives = battleMons().some((mon) => mon.item === lastItem);
  const pocket = (option("--pocket") ?? "60,120").split(",").map(Number);
  touch(40, 165); step(150); await capture("battle-bag");
  touch(pocket[0]!, pocket[1]!); step(120); await capture("battle-bag-pocket");
  const next = (option("--next") ?? "232,172").split(",").map(Number);
  for (let page = 1; page <= Number(option("--pages") ?? 12); page++) {
    touch(next[0]!, next[1]!); step(30);
    if (page % 4 === 0) await capture(`battle-bag-page-${page}`);
  }
  touch(60, 30); step(90); await capture("battle-bag-item");    // first item of the page: its detail page
}
console.log(JSON.stringify(result));
await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
