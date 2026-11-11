// Regional forms check on a clean US Black / White / Black 2 / White 2 ROM (desmond, headless).
// npx vite-node runtime/regional-forms/emulator.ts /path/clean.nds [--team TEXT] [--foe TEXT] [--families 19,554]
//   [--frames N] [--name label] [--after STEPS]
//
// Installs the regional forms (Fairy Type Support, Move Expansion, the animated sprite runtime and the evolution by
// form runtime with them), then runs a test battle: by default the player's Alolan Rattata, one EXP point short of
// level 20, knocks out a level 5 Chansey and evolves. A is pressed through the battle and the evolution scene (never
// B, which would stop it). Captures every 60 frames go to build/emulator/<label>/. --after runs steps once the frames
// are done, comma-separated: a button (a, b, x, y, up, down, left, right, start, select; held 4 frames, then 30 idle),
// wait:N, touch:X:Y, cap:NAME (a capture named NAME.png).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { installRegionalForms } from "../../src/pokeweb/regionalFormsModel";
import { importTrainerTeamShowdownText } from "../../src/pokeweb/trainerModel";
import { NintendoDSRom } from "../../src/nds/rom";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0]!;
const label = option("--name") ?? `${basename(romPath, ".nds")}-regional`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
const started = Date.now();
const families = option("--families")?.split(",").map(Number);
const report = await installRegionalForms(project, (stage) => installCodeInjectionPatch(project, stage), families);
console.log(`installed in ${Date.now() - started} ms:`, JSON.stringify({ forms: report.forms.length, skipped: report.skipped.length,
  abilitiesAdded: report.abilitiesAdded, abilityFallbacks: report.abilityFallbacks, movesLeftOut: report.movesLeftOut.length,
  noEvolution: report.noEvolution, moveExpansion: report.moveExpansion, fairy: report.fairyTypeInstalled }));
console.log(JSON.stringify(report.forms.filter((form) => [19, 20, 52, 53, 554, 555].includes(form.species))));
const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
const trainerId = Number(option("--trainer") ?? (project.session.baseRom === "BW" ? 1 : 156));
loadCodeInjectionNarcs(project, rom, ["trdata", "trpok"]);
importTrainerTeamShowdownText(project, trainerId, option("--foe") ?? "Chansey\nLevel: 5\n- Splash");
const { romBytes, saveBytes } = await buildTestBattleDownloads(project, trainerId, {
  playerTeamText: option("--team") ?? "Rattata^1\nExp: 7999\n- Dragon Rage",
});
await writeFile(join(output, "rom.nds"), romBytes);

const corePath = fileURLToPath(new URL("../../public/desmond/desmond.js", import.meta.url));
const generated = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r);
const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: corePath, console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module; core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]!);
const ptr = core._prepareRomBuffer(size); core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");

const frames = Number(option("--frames") ?? 4800);
for (let frame = 0; frame <= frames; frame++) {
  core._runFrame(1, frame % 40 < 2 ? 128 : 0, 0, 0, 0); // A every 40 frames
  if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
  if (frame % 60 === 0) {
    const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 });
    png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
    await writeFile(join(output, `f${String(frame).padStart(5, "0")}.png`), PNG.sync.write(png));
  }
}
const KEY = { right: 1, left: 2, down: 4, up: 8, select: 16, start: 32, b: 64, a: 128, y: 256, x: 512 } as const;
const run = (count: number, keys = 0, touch?: [number, number]) => {
  for (let i = 0; i < count; i++) {
    core._runFrame(1, keys, touch ? 1 : 0, touch?.[0] ?? 0, touch?.[1] ?? 0);
    if (fatal.length) throw new Error(`After step: ${fatal.join("; ")}`);
  }
};
const capture = async (name: string) => {
  const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 });
  png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
  await writeFile(join(output, `${name}.png`), PNG.sync.write(png));
};
for (const step of (option("--after") ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
  const [kind, ...args] = step.split(":");
  if (kind === "wait") run(Number(args[0]));
  else if (kind === "touch") { run(6, 0, [Number(args[0]), Number(args[1])]); run(2); }
  else if (kind === "cap") await capture(args[0]!);
  else if (kind! in KEY) { run(4, KEY[kind as keyof typeof KEY]); run(30); }
  else throw new Error(`Unknown step ${step}`);
}
console.log(JSON.stringify({ label, frames, captures: output }));
