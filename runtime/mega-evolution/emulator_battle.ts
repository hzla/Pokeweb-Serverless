// Mega Evolution check on a clean US White 2 / Black 2 ROM (desmond, headless).
// npx vite-node runtime/mega-evolution/emulator_battle.ts /path/clean.nds [--giratina] [--touch] [--no-mega] [--dll path]
//
// Installs Mega Evolution through the model with two test routes (Rotom holding Leftovers -> Heat Rotom, Giratina
// holding Leftovers -> Origin Forme), or stages --dll as is (build.py --test-routes), starts a test battle with
// a level 100 Rotom, opens the move screen, arms the Mega (START, or the touch button with --touch) and picks the
// first move. Reports the player's BattleMons (server and client copies) before and after the turn: form, types,
// base form, ability, and the party data after the battle. Screenshots go to runtime/mega-evolution/build/emulator/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch } from "../../src/pokeweb/codeInjectionInstall";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import { setMegaEvolutionConfig, stageMegaEvolution } from "../../src/pokeweb/megaEvolutionModel";
import { readGen5SavePokemon } from "../../src/pokeweb/gen5SaveReader";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
const romBytesIn = new Uint8Array(await readFile(romPath));
const game = String.fromCharCode(...romBytesIn.subarray(0x0c, 0x10)) === "IREO" ? "B2" : "W2";
const dllPath = option("--dll");
const trainerId = Number(option("--trainer") ?? 156);
const label = option("--name") ?? `${basename(romPath, ".nds")}-${argv.includes("--touch") ? "touch" : "start"}${argv.includes("--no-mega") ? "-nomega" : ""}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(romBytesIn, basename(romPath), { selectedNarcs: [] });
if (dllPath) {
  const dll = new Uint8Array(await readFile(dllPath));
  await installCodeInjectionPatch(project, (staged) => { stageCodeInjectionDll(staged, basename(dllPath), dll); });
} else {
  await installCodeInjectionPatch(project, (staged) => stageMegaEvolution(staged));
  setMegaEvolutionConfig(project, { routes: [
    { species: 479, trigger: 234, sourceForm: 0, targetForm: 1 },
    { species: 487, trigger: 234, sourceForm: 0, targetForm: 1 },
  ] });
}
// --giratina: the test DLL's second route (Giratina holding Leftovers -> Origin Forme) changes the ability too.
const giratina = argv.includes("--giratina");
const SPECIES = giratina ? 487 : 479;
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, {
  playerTeamText: giratina
    ? "Giratina @ Leftovers\nAbility: Pressure\nLevel: 100\n- Dragon Claw\n- Shadow Sneak"
    : "Rotom @ Leftovers\nAbility: Levitate\nLevel: 100\n- Thunderbolt\n- Shadow Ball",
});
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

// BattleMon (0x1f8 bytes): src pointer at +0, species +0x0c, max HP +0x0e, HP +0x10, item +0x12, base ability +0x16,
// monId +0x19, base form bits 0-4 of +0x1b, types +0xf8/+0xf9, ability +0x13c, weight +0x13e, form +0x141.
const battleMons = () => {
  const m = ram(); const found: Array<Record<string, number | string>> = [];
  for (let at = 0; at + 0x1f8 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || m.readUInt16LE(at + 0xc) !== SPECIES) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (!max || hp > max || max > 999 || m[at + 0x19] > 23) continue;
    found.push({ address: `0x${(0x02000000 + at).toString(16)}`, monId: m[at + 0x19], item: m.readUInt16LE(at + 0x12), form: m[at + 0x141], baseForm: m[at + 0x1b] & 0x1f,
      type1: m[at + 0xf8], type2: m[at + 0xf9], ability: m.readUInt16LE(at + 0x13c), baseAbility: m.readUInt16LE(at + 0x16), weight: m.readUInt16LE(at + 0x13e), speed: m.readUInt16LE(at + 0xf6) });
  }
  return found;
};
let mons: ReturnType<typeof battleMons> = [];
for (let i = 0; i < 160 && !mons.length; i++) { step(30, i % 4 === 0 ? KEY.a : 0); if (i > 10) mons = battleMons(); }
// Wait for the command screen (no input for a while), then open the move screen.
step(Number(option("--settle") ?? 1500), 0); await capture("command");
const before = battleMons();
touch(128, 85); step(60); await capture("moves");
if (!argv.includes("--no-mega")) {
  if (argv.includes("--touch")) touch(128, 168); else { step(4, KEY.start); step(4, 0); }
  step(20); await capture("moves-armed");
}
touch(64, 44); step(30); await capture("after-pick");
const frames: string[] = [];
for (let i = 0; i < 12; i++) { step(60, 0); if (i % 3 === 1) { await capture(`turn-${i}`); frames.push(`turn-${i}`); } }
const after = battleMons();
// Finish the battle with the first move, then save in the field and read the party back.
for (let turn = 0; turn < 12 && battleMons().length; turn++) {
  step(300, 0); touch(128, 85); step(60); touch(64, 44);
  for (let i = 0; i < 30; i++) step(30, i % 2 ? KEY.a : 0);
}
step(600, 0); await capture("after-battle");
let party: Array<Record<string, unknown>> = [];
if (!battleMons().length) {
  step(4, KEY.x); step(60); touch(64, 153); step(90); await capture("save-prompt");
  for (let i = 0; i < 6; i++) { step(4, KEY.a); step(60); }
  step(600); await capture("saved");
  const card = new Uint8Array(core.HEAPU8.subarray(core._savGetPointer(0), core._savGetPointer(0) + 0x80000));
  party = readGen5SavePokemon(project, card).filter((mon) => mon.storage === "party")
    .map((mon) => ({ species: mon.speciesId, form: mon.formIndex, ability: mon.abilityId, item: mon.itemId }));
}
const result = { label, game, frame, before, after, megaEvolved: after.some((mon) => mon.form === 1 && mon.baseForm === 1), party };
console.log(JSON.stringify(result, null, 1));
await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
