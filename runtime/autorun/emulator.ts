// Autorun field check on a clean US ROM. Inputs are read-only; outputs go to runtime/autorun/build/emulator/.
// npx vite-node runtime/autorun/emulator.ts /path/clean.nds [--dll path] [--vanilla] [--off] [--hold-b] [--rows] [--frames N]
// Holds one direction at a time from a standstill and reports the tiles moved per 32 frames.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { installAutorun } from "../../src/pokeweb/autorunModel";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
if (!romPath) throw new Error("Pass a clean US Black, White, Black 2 or White 2 ROM.");
const label = option("--name") ?? [basename(romPath, ".nds"), argv.includes("--vanilla") ? "vanilla" : "autorun", argv.includes("--off") ? "off" : "", argv.includes("--hold-b") ? "b" : ""].filter(Boolean).join("-");
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
if (!argv.includes("--vanilla")) {
  const dll = option("--dll");
  await installAutorun(project, dll ? { dllOverride: new Uint8Array(await readFile(dll)) } : {});
}
const { romBytes, saveBytes } = await buildQuickLaunchDownloads(project);

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

// desmume-wasm key bits: right 0, left 1, down 2, up 3, select 4, start 5, B 6, A 7, Y 8, X 9, L 10, R 11.
const KEY = { right: 1, left: 2, down: 4, up: 8, b: 64, a: 128 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };
const debugAt = () => { const memory = ram(); let at = memory.indexOf(Buffer.from("ARUN")); while (at >= 0 && memory.readUInt32LE(at + 4) !== 1) at = memory.indexOf(Buffer.from("ARUN"), at + 4); return at; };
const state = () => { const at = debugAt(), m = ram(); return at < 0 ? undefined : { grid: m.readUInt32LE(at + 8), nogrid: m.readUInt32LE(at + 12), keys: m.readUInt32LE(at + 16), enabled: m.readUInt32LE(at + 20), x: m.readInt16LE(at + 24), z: m.readInt16LE(at + 28) }; };

// Boot through the quick-launch save into the field (A on the title/continue screens).
let booted = -1;
for (let tries = 0; tries < 200 && booted < 0; tries++) {
  step(20, tries % 3 === 0 ? KEY.a : 0);
  const s = state();
  if (s && s.grid > 30) booted = frame;
}
if (argv.includes("--vanilla")) step(300); else if (booted < 0) { await capture("boot-failed"); throw new Error("Autorun hook never ran; inspect boot-failed.png"); }
step(60);
if (argv.includes("--off")) {
  // Set "Autorun off" (CONFIG bit 12) directly in the loaded save's CONFIG halfword the hook reads.
  throw new Error("--off is checked through the Options row test; see emulator_options.ts");
}
await capture("field");
const results: Record<string, unknown>[] = [];
for (const [name, key] of [["right", KEY.right], ["left", KEY.left], ["down", KEY.down], ["up", KEY.up]] as const) {
  step(30);
  const before = state();
  step(32, key | (argv.includes("--hold-b") ? KEY.b : 0));
  const during = state();
  step(24);
  const after = state();
  results.push({ direction: name, before, during, after, tiles: before && after ? Math.abs(after.x - before.x) + Math.abs(after.z - before.z) : undefined });
  await capture(`after-${name}`);
}
const summary = { rom: basename(romPath), autorun: !argv.includes("--vanilla"), holdB: argv.includes("--hold-b"), booted, results };
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
