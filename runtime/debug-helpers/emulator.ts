// Headless gameplay smoke test. Uses only a bundled fixture save in memory.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, buildTestBattleDownloads } from "../../src/pokeweb/testBattle";
import { installTestingPatch } from "../../src/pokeweb/testingPatchesModel";

const [romPath, frameArg = "2800", delayArg = "850"] = process.argv.slice(2);
const fieldOnly = process.argv.includes("--field");
const midAnimation = process.argv.includes("--animation");
const fastText = process.argv.includes("--fast-text");
if (!romPath) throw new Error("Pass an original US White 2 ROM path.");
const out = new URL(`./build/emulator-${fieldOnly ? "field" : midAnimation ? "animation" : delayArg}${fastText ? "-fast" : ""}/`, import.meta.url);
await mkdir(out, { recursive: true });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") throw new Error("Only local assets are expected.");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), "White2.nds", { selectedNarcs: [] });
for (const id of ["walk-through-walls", "instant-victory", "instant-fast-text"] as const) await installTestingPatch(project, id);
const { romBytes, saveBytes } = fieldOnly ? await buildQuickLaunchDownloads(project) : await buildTestBattleDownloads(project, 2);
const corePath = new URL("../../public/desmond/desmond.js", import.meta.url);
const source = await readFile(corePath, "utf8");
let ready!: () => void;
const initialized = new Promise<void>((r) => { ready = r; });
const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)), __filename: fileURLToPath(corePath), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')), ctx);
await initialized;
const core = ctx.Module;
core._main(0, 0);
const size = Math.max(romBytes.length, 128 * 1024 * 2 ** romBytes[0x14]);
const ptr = core._prepareRomBuffer(size);
core.HEAPU8.set(romBytes, ptr); core.HEAPU8.fill(255, ptr + romBytes.length, ptr + size);
core.HEAPU8.set(saveBytes, core._savGetPointer(saveBytes.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM");
const trace = [];
let main = -1, battleFound = -1;
let victoryObserved = false;
const collisionStates: number[] = [];
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
let configOffset = -1;
for (let frame = 0; frame < Number(frameArg); frame++) {
  // Set the fixture's Options value in emulator RAM only; no user save is read
  // or written. Resolve the same save-block pointers as SaveData_GetConfig.
  if (frame === 500 && fastText) {
    const memory = ram();
    const pointer = (at: number) => {
      const value = memory.readUInt32LE(at) - 0x02000000;
      if (value < 0 || value >= memory.length - 0x200) throw new Error("Invalid fixture save pointer");
      return value;
    };
    const manager = pointer(pointer(0x9a378) + 0x10);
    const blocks = pointer(manager + 0x2c);
    const entries = pointer(blocks + 0x14);
    configOffset = pointer(manager + 0x34) + memory.readUInt32LE(entries + 27 * 12 + 8);
    memory.writeUInt16LE((memory.readUInt16LE(configOffset) & ~15) | 2, configOffset);
  }
  let keys = frame > 800 && (battleFound < 0 || frame < battleFound + (midAnimation ? 850 : 700)) && frame % 30 < 3 ? 0x80 : 0;
  if (midAnimation && battleFound >= 0) {
    if (frame >= battleFound + 910 && frame < battleFound + 914) keys = 2;
    if (frame >= battleFound + 930 && frame < battleFound + 934) keys = 0x80;
  }
  if (fieldOnly) {
    keys = frame >= 650 && frame < 800 || frame >= 900 && frame < 960 ? 2 : 0;
    if (frame >= 850 && frame < 858 || frame >= 1130 && frame < 1138) keys = 0xc20;
  }
  if (battleFound >= 0 && frame >= battleFound + Number(delayArg) && frame < battleFound + Number(delayArg) + 6) keys = 0xe0;
  core._runFrame(1, keys, 0, 0, 0);
  if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
  const memory = ram();
  if (main >= 0 && memory.readUInt32LE(main + 0x444) === 1) victoryObserved = true;
  const lo = memory.readUInt16LE(0x19c966), hi = memory.readUInt16LE(0x19c968);
  if ((lo & 0xf800) === 0xf000 && (hi & 0xf800) === 0xf800) {
    let delta = ((lo & 0x7ff) << 12) | ((hi & 0x7ff) << 1);
    if (delta & 0x400000) delta -= 0x800000;
    const base = 0x0219c966 + 4 + delta - 0x4c - 0x02000000;
    if (base > 0 && base < 0x3fff00) {
      const enabled = memory.readUInt32LE(base + 0x74);
      if (enabled <= 1 && collisionStates[collisionStates.length - 1] !== enabled) collisionStates.push(enabled);
    }
  }
  if (main < 0 && frame % 30 === 0) {
    for (let p = 0; p < memory.length - 0x480; p += 4) {
      if (memory.readUInt32LE(p + 0x464) === 0x0219bc2d && memory.readUInt32LE(p + 0x444) === 7) {
        const setup = memory.readUInt32LE(p) - 0x02000000;
        if (setup > 0 && setup < 0x3fff00 && memory.readUInt32LE(setup) === 1) { main = p; battleFound = frame; break; }
      }
    }
  }
  if (frame % 120 === 0 || frame === Number(frameArg) - 1 || midAnimation && battleFound >= 0 && frame === battleFound + Number(delayArg) - 1) {
    const row = { frame, main, battleFound, result: main >= 0 ? memory.readUInt32LE(main + 0x444) : null };
    trace.push(row); console.log(JSON.stringify(row));
    const fb = core._getSymbol(4) >>> 0;
    const png = new PNG({ width: 256, height: 384 }); png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
    await writeFile(new URL(`frame-${frame}.png`, out), PNG.sync.write(png));
  }
}
const textOption = configOffset >= 0 ? ram().readUInt16LE(configOffset) & 15 : undefined;
await writeFile(new URL("trace.json", out), JSON.stringify({ trace, victoryObserved, collisionStates, textOption }, null, 2));
const length = core._saveState(1);
await writeFile(new URL("latest.dst", out), Buffer.from(core.HEAPU8.buffer, core._stateGetPointer(0) >>> 0, length));
console.log(`Smoke-test captures: ${fileURLToPath(out)}`);
if (!fieldOnly && !victoryObserved) throw new Error("Did not observe the native victory result.");
if (fieldOnly && collisionStates.join(",") !== "0,1,0") throw new Error(`Unexpected collision toggle states: ${collisionStates}`);
if (fastText && textOption !== 2) throw new Error("The fixture's Fast text option was changed.");
