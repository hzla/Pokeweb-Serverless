// Mega content check on a clean US White 2 / Black 2 ROM (desmond, headless).
// npx vite-node runtime/mega-evolution/emulator_content.ts /path/clean.nds [--move-expansion] [--foe] [--name label]
//
// Installs Item Expansion and the Mega content (PWAN runtime, Mega runtime, 71 forms, stones, messages; with
// --move-expansion also the Move Expansion and Hibiki's animation), then starts a test battle with Charizard holding
// Charizardite X. The player arms the Mega with START and picks the first move. With --foe the trainer's first
// Pokémon is a Charizard holding Charizardite Y and the player's Pokémon has no stone (the AI Megas on its own).
// Reports both sides' BattleMons (form, types, ability) and saves screenshots to build/emulator/<label>/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { stageItemExpansion } from "../../src/pokeweb/itemExpansionModel";
import { installMegaContent } from "../../src/pokeweb/megaContentModel";
import { importTrainerTeamShowdownText } from "../../src/pokeweb/trainerModel";
import { NintendoDSRom } from "../../src/nds/rom";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
const foe = argv.includes("--foe");
const label = option("--name") ?? `${basename(romPath, ".nds")}-content${foe ? "-foe" : ""}${argv.includes("--move-expansion") ? "-anim" : ""}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
if (argv.includes("--move-expansion")) {
  const { installMoveExpansion } = await import("../../src/pokeweb/moveExpansionPatch");
  await installMoveExpansion(project);
}
await installCodeInjectionPatch(project, (staged) => stageItemExpansion(staged));
const started = Date.now();
const report = await installMegaContent(project, (stage) => installCodeInjectionPatch(project, stage));
console.log(`content installed in ${Date.now() - started} ms:`, JSON.stringify({ forms: report.forms.length, stones: report.stones, skipped: report.skipped,
  abilitiesAdded: report.abilitiesAdded, abilityFallbacks: report.abilityFallbacks, typeFallbacks: report.typeFallbacks.length, animation: report.animation }));
const charizard = report.forms.filter((form) => form.species === 6);
console.log("charizard forms:", JSON.stringify(charizard), "routes:", project.codeInjection?.megaEvolution?.routes.length,
  "messages:", JSON.stringify(project.codeInjection?.megaEvolution?.messages), "animation:", project.codeInjection?.megaEvolution?.animationMove);
const trainerId = Number(option("--trainer") ?? 156);
if (foe) {
  loadCodeInjectionNarcs(project, rom, ["trdata", "trpok"]);
  importTrainerTeamShowdownText(project, trainerId, "Charizard @ Charizardite Y\nLevel: 60\n- Flamethrower\n- Air Slash");
}
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, {
  playerTeamText: foe ? "Blastoise\nLevel: 100\n- Surf\n- Bite" : "Charizard @ Charizardite X\nLevel: 100\n- Dragon Claw\n- Flamethrower",
});
await writeFile(join(output, "rom.nds"), romBytes);

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

const KEY = { start: 32, a: 128 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const touch = (x: number, y: number, frames = 6) => { for (let i = 0; i < frames; i++, frame++) core._runFrame(1, 0, 1, x, y); step(2); };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };
const species = new Set([6, 9]);
const battleMons = () => {
  const m = ram(); const found: Array<Record<string, number | string>> = [];
  for (let at = 0; at + 0x1f8 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || !species.has(m.readUInt16LE(at + 0xc))) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (!max || hp > max || max > 999 || m[at + 0x19] > 23) continue;
    found.push({ species: m.readUInt16LE(at + 0xc), monId: m[at + 0x19], item: m.readUInt16LE(at + 0x12), form: m[at + 0x141], baseForm: m[at + 0x1b] & 0x1f,
      type1: m[at + 0xf8], type2: m[at + 0xf9], ability: m.readUInt16LE(at + 0x13c), atk: m.readUInt16LE(at + 0xee), spa: m.readUInt16LE(at + 0xf2) });
  }
  return found;
};
for (let i = 0; i < 160 && !battleMons().length; i++) step(30, i % 4 === 0 ? KEY.a : 0);
step(Number(option("--settle") ?? 1500), 0); await capture("command");
const before = battleMons();
touch(128, 85); step(60); await capture("moves");
if (!foe) { step(4, KEY.start); step(4, 0); step(20); await capture("moves-armed"); }
touch(64, 44); step(10);
for (let i = 0; i < 24; i++) { step(30, 0); await capture(`turn-${String(i).padStart(2, "0")}`); }
const after = battleMons();
const result = { label, frame, before, after };
console.log(JSON.stringify(result));
await writeFile(join(output, "summary.json"), JSON.stringify({ report, ...result }, null, 2));
