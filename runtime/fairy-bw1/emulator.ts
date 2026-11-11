// Fairy Type Support check on a clean US Black / White ROM (desmond, headless).
// npx vite-node runtime/fairy-bw1/emulator.ts /path/clean.nds [--name label] [--no-fairy]
//
// Installs Fairy Type Support with the modern typings (Clefable becomes Fairy), then starts a test battle: the player's
// Garchomp (Dragon Claw, Charm) against the trainer's Clefable. The player picks Dragon Claw: with Fairy, Dragon does
// nothing to Clefable. Reports both sides' BattleMons (types, HP) and saves screenshots to build/emulator/<label>/
// (the move screen shows Charm's Fairy button).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { addFairyTypeSupport, detectFairyTypePatch } from "../../src/pokeweb/romPatchModel";
import { importTrainerTeamShowdownText } from "../../src/pokeweb/trainerModel";
import { NintendoDSRom } from "../../src/nds/rom";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
const fairy = !argv.includes("--no-fairy");
const label = option("--name") ?? `${basename(romPath, ".nds")}-fairy${fairy ? "" : "-off"}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const install = fairy ? await addFairyTypeSupport(project, { updateModernFairyTypings: true }) : undefined;
console.log(detectFairyTypePatch(project), install?.summary);
const trainerId = Number(option("--trainer") ?? 1);
loadCodeInjectionNarcs(project, rom, ["trdata", "trpok"]);
importTrainerTeamShowdownText(project, trainerId, "Clefable\nLevel: 50\n- Charm\n- Moonlight");
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, {
  playerTeamText: "Garchomp\nLevel: 100\n- Dragon Claw\n- Charm",
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
const species = new Set([35, 36, 445]);
const battleMons = () => {
  const m = ram(); const found: Array<Record<string, number>> = [];
  for (let at = 0; at + 0x1f8 < m.length; at += 4) {
    const p0 = m.readUInt32LE(at);
    if (p0 < 0x02000000 || p0 >= 0x02400000 || !species.has(m.readUInt16LE(at + 0xc))) continue;
    const hp = m.readUInt16LE(at + 0x10), max = m.readUInt16LE(at + 0xe);
    if (!max || hp > max || max > 999 || m[at + 0x19] > 23 || m[at + 0x18] < 1 || m[at + 0x18] > 100 || m[at + 0xf8] > 18 || m[at + 0xf9] > 18) continue;
    found.push({ species: m.readUInt16LE(at + 0xc), monId: m[at + 0x19], type1: m[at + 0xf8], type2: m[at + 0xf9], hp, max });
  }
  return found;
};
for (let i = 0; i < 160 && (i <= 10 || !battleMons().length); i++) step(30, i % 4 === 0 ? KEY.a : 0);
step(Number(option("--settle") ?? 1500), 0); await capture("command");
const before = battleMons();
touch(128, 85); step(60); await capture("moves");
touch(64, 44); step(10);
for (let i = 0; i < 16; i++) { step(30, 0); await capture(`turn-${String(i).padStart(2, "0")}`); }
const after = battleMons();
const result = { label, fairy, frame, before, after };
console.log(JSON.stringify(result));
await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
process.exit(0);
