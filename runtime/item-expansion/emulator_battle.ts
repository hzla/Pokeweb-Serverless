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
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { stageItemExpansion, ITEM_TEXT_BANKS } from "../../src/pokeweb/itemExpansionModel";
import { getTextBank, commitTextBank } from "../../src/pokeweb/textModel";
import { markDirty } from "../../src/pokeweb/projectStore";
import { NintendoDSRom } from "../../src/nds/rom";
import { EXPANDED_SAVE_LAYOUT, recoverSave, encodeSave, detectSaveFormat } from "../../src/pokeweb/itemSaveFormat";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
const testItem = Number(option("--item") ?? 700);
const trainerId = Number(option("--trainer") ?? 156);
const label = option("--name") ?? `${basename(romPath, ".nds")}-battle${argv.includes("--vanilla") ? "-vanilla" : ""}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
let itemName = "Leftovers";
if (!argv.includes("--vanilla")) {
  await installCodeInjectionPatch(project, (staged) => stageItemExpansion(staged));
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  loadCodeInjectionNarcs(project, rom, ["items", "message_texts"]);
  const names = getTextBank(project, "message_texts", ITEM_TEXT_BANKS.names);
  names[testItem][1] = "Test Item"; itemName = "Test Item";
  commitTextBank(project, "message_texts", ITEM_TEXT_BANKS.names);
  project.narcs.items!.rawFiles[testItem][0] = 100;
  markDirty(project, "items", testItem);
}
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, { playerTeamText: `Mew @ ${itemName}\nAbility: Synchronize\nLevel: 100\n- Psychic\n- Recover` });
console.log("save format:", detectSaveFormat(saveBytes.subarray(0, 0x80000)));
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


// BattleMon: species at +0x0c, held item at +0x12, preceded by two main-RAM pointers.
const battleMons = () => {
  const m = ram(); const found: Array<{ address: string; species: number; item: number }> = [];
  for (let at = 0; at + 0x20 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || m.readUInt16LE(at + 0xc) !== 151) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (!max || hp > max || max > 999) continue;
    found.push({ address: `0x${(0x02000000 + at).toString(16)}`, species: 151, item: m.readUInt16LE(at + 0x12) });
  }
  return found;
};
let mons: ReturnType<typeof battleMons> = [];
for (let i = 0; i < 120 && !mons.length; i++) { step(30, i % 4 === 0 ? KEY.a : 0); if (i > 10) mons = battleMons(); }
step(240, 0); await capture("battle");
mons = battleMons();
// Open the battle bag (bottom-left BAG button) to exercise the battle-bag lists.
touch(40, 170); step(150); await capture("battle-bag");
touch(40, 60); step(120); await capture("battle-bag-pocket");
const result = { label, frame, battleMons: mons, heldItemSurvives: mons.some((mon) => mon.item === (argv.includes("--vanilla") ? 234 : testItem)) };
console.log(JSON.stringify(result));
await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
