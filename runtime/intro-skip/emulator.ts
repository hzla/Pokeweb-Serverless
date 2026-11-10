// Skip Intro new-game check on a clean US Black 2 / White 2 ROM. Inputs are read-only; screenshots go to
// runtime/intro-skip/build/emulator/<label>/.
// npx vite-node runtime/intro-skip/emulator.ts /path/clean.nds [--vanilla] [--dll path] [--frames N]
// Starts a new game from a blank save (A / Start through the title and Professor Juniper's intro), waits for the
// ISKP counters to show all five hooks ran, then walks and captures the house.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { toDesmumeDsv } from "../../src/pokeweb/testBattle";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { installIntroSkip } from "../../src/pokeweb/introSkipModel";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
if (!romPath) throw new Error("Pass a clean US Black 2 or White 2 ROM.");
const vanilla = argv.includes("--vanilla");
const label = option("--name") ?? `${basename(romPath, ".nds")}-${vanilla ? "vanilla" : "skip"}`;
const output = fileURLToPath(new URL(`./build/emulator/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
if (!vanilla) {
  const dll = option("--dll");
  await installIntroSkip(project, dll ? { dllOverride: new Uint8Array(await readFile(dll)) } : {});
}
const romBytes = vanilla ? new Uint8Array(await readFile(romPath)) : await exportModifiedRom(project);

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
const blank = toDesmumeDsv(new Uint8Array(512 * 1024).fill(0xff));
core.HEAPU8.set(blank, core._savGetPointer(blank.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("ROM rejected");

const KEY = { right: 1, left: 2, down: 4, up: 8, start: 32, b: 64, a: 128 } as const;
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let frame = 0;
const step = (count: number, keys = 0) => { for (let i = 0; i < count; i++, frame++) { core._runFrame(1, keys, 0, 0, 0); if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`); } };
const capture = async (name: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${name}.png`), PNG.sync.write(png)); };
const debugAt = () => { const m = ram(), tag = Buffer.from("ISKP"); let at = m.indexOf(tag); while (at >= 0 && m.readUInt32LE(at + 4) !== 1) at = m.indexOf(tag, at + 4); return at; };
const counters = () => { const at = debugAt(), m = ram(); return at < 0 ? undefined : { demo: m.readUInt32LE(at + 8), init: m.readUInt32LE(at + 12), hide: m.readUInt32LE(at + 16), script: m.readUInt32LE(at + 20), spawn: m.readUInt32LE(at + 24) }; };

const limit = Number(option("--frames") ?? 24000), every = Number(option("--every") ?? 3000);
let reached = -1;
while (frame < limit && reached < 0) {
  // Title, menu and Juniper's intro: A every 40 frames (it also types the name), Start every 1200 to reach OK.
  step(4, frame % 1200 === 600 ? KEY.start : frame % 40 === 0 ? KEY.a : 0);
  step(4);
  if (frame % every < 8) await capture(`f${frame}`);
  const c = counters();
  if (c && c.script >= 2 && c.spawn && c.init && c.demo && c.hide) reached = frame;
}
const atField = counters();
if (reached < 0 && !vanilla) { await capture("not-reached"); throw new Error(`Intro hooks did not all run: ${JSON.stringify(atField)}`); }
step(90);
await capture("house");
step(16, KEY.down); step(20); await capture("after-down");
step(16, KEY.left); step(20); await capture("after-left");
step(16, KEY.up); step(20); await capture("after-up");
step(240); await capture("settled");
// --walk "down:64,left:64" then a few A presses, to reach the house's first trigger (10,8) and mom.
for (const [index, part] of (option("--walk") ?? "").split(",").filter(Boolean).entries()) {
  const [direction, frames] = part.split(":") as [keyof typeof KEY, string];
  step(Number(frames), KEY[direction]); step(30); await capture(`walk-${index}-${direction}`);
}
if (option("--walk")) for (let i = 0; i < 6; i++) { step(60); await capture(`talk-${i}`); step(4, KEY.a); }
const summary = { rom: basename(romPath), vanilla, reached, counters: counters() };
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
