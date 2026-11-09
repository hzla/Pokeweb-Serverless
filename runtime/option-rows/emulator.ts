// Options-row check on a clean US ROM. Inputs are read-only; captures go to runtime/option-rows/build/emulator/<name>/.
// npx vite-node runtime/option-rows/emulator.ts /path/clean.nds --script steps.json [--name label] [--autorun] [--rows-dll path]
// A script is a list of steps: {"keys":"down|up|left|right|a|b|x|start","frames":N} | {"touch":[x,y]} | {"wait":N} | {"capture":"name"}.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import type { ProjectState } from "../../src/pokeweb/projectStore";

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const romPath = argv[0];
if (!romPath) throw new Error("Pass a clean US Black, White, Black 2 or White 2 ROM.");
const scriptPath = option("--script");
type Step = { keys?: string; frames?: number; touch?: [number, number]; wait?: number; capture?: string; dump?: string };
const steps: Step[] = scriptPath ? JSON.parse(await readFile(scriptPath, "utf8")) : [];
const name = option("--name") ?? basename(romPath, ".nds");
const output = fileURLToPath(new URL(`./build/emulator/${name}/`, import.meta.url));
await mkdir(output, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;

const project: ProjectState = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
const setup = option("--setup");
if (setup) {
  const module = await import(fileURLToPath(new URL(setup, `file://${process.cwd()}/`)));
  await module.default(project, argv);
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
const KEYS: Record<string, number> = { right: 1, left: 2, down: 4, up: 8, select: 16, start: 32, b: 64, a: 128, y: 256, x: 512, l: 1024, r: 2048 };
let frame = 0;
const run = (count: number, keys = 0, touch?: [number, number]) => {
  for (let i = 0; i < count; i++, frame++) {
    core._runFrame(1, keys, touch ? 1 : 0, touch?.[0] ?? 0, touch?.[1] ?? 0);
    if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
  }
};
const capture = async (label: string) => { const fb = core._getSymbol(4) >>> 0, png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(join(output, `${label}.png`), PNG.sync.write(png)); };
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);

// Boot: A through the title, continue and C-Gear prompts until Autorun's field hook runs (or a fixed time without it).
const fieldReady = () => { const memory = ram(); for (let at = memory.indexOf(Buffer.from("ARUN")); at >= 0; at = memory.indexOf(Buffer.from("ARUN"), at + 4)) if (memory.readUInt32LE(at + 4) === 1 && memory.readUInt32LE(at + 8) > 30) return true; return false; };
for (let i = 0; i < 200 && !fieldReady(); i++) run(20, i % 3 === 0 ? KEYS.a : 0);
run(240);
for (const step of steps) {
  if (step.wait) run(step.wait);
  if (step.keys) { const keys = step.keys.split("+").reduce((sum, key) => sum | (KEYS[key] ?? 0), 0); run(step.frames ?? 4, keys); run(12); }
  if (step.touch) { run(4, 0, step.touch); run(16); }
  if (step.capture) await capture(step.capture);
  if (step.dump) {
    // Print every live copy of the tagged debug block (the DLL file image in RAM also contains the tag).
    const memory = ram(); const hits: string[] = [];
    for (let at = memory.indexOf(Buffer.from(step.dump)); at >= 0; at = memory.indexOf(Buffer.from(step.dump), at + 4)) hits.push(`0x${(at + 0x02000000).toString(16)}:${memory.subarray(at, at + (step.dump === "FWDG" ? 60 : 24)).toString("hex")}`);
    console.log(step.dump, `frame ${frame}`, hits.join(" "));
  }
}
const savedLength = core._savGetSize(), saved = Buffer.from(core.HEAPU8.buffer, core._savGetPointer(savedLength), savedLength);
await writeFile(join(output, "after.dsv"), saved);
console.log(`captures: ${output}`);
