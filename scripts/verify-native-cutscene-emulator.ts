import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { toDesmumeDsv } from "../src/pokeweb/testBattle";

const [romPath, savePath, out, frameArg = "6500"] = process.argv.slice(2);
if (!romPath || !savePath || !out) throw new Error("Usage: vite-node scripts/verify-native-cutscene-emulator.ts TEST.nds TEST.sav OUTPUT_DIR [FRAMES]");
await fs.mkdir(out, { recursive: true });
const rom = new Uint8Array(await fs.readFile(romPath)), rawSave = new Uint8Array(await fs.readFile(savePath));
const save = savePath.endsWith(".sav") ? toDesmumeDsv(rawSave) : rawSave;
const coreUrl = new URL("../public/desmond/desmond.js", import.meta.url), source = await fs.readFile(coreUrl, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => { ready = r; }); const fatal: string[] = [];
const log = (...args: unknown[]) => { const line = args.join(" "); if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line); };
const ctx = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../public/desmond", import.meta.url)), __filename: fileURLToPath(coreUrl), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), ctx); await initialized; const core = ctx.Module;
core._main(0, 0); const size = Math.max(rom.length, 128 * 1024 * 2 ** rom[0x14]), pointer = core._prepareRomBuffer(size);
core.HEAPU8.set(rom, pointer); core.HEAPU8.fill(255, pointer + rom.length, pointer + size);
core.HEAPU8.set(save, core._savGetPointer(save.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM.");
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
const trace: unknown[] = [];
const starts: number[] = [], completions: number[] = [];
let resident = false;let visibleSceneCaptures=0;
for (let frame = 0; frame < Number(frameArg); frame++) {
  const back = completions[0] === undefined ? Infinity : completions[0] + 360, replay = back + 120;
  const keys = frame >= 900 && frame < 918 || frame >= replay && frame < replay + 18 ? 4 : frame >= back && frame < back + 18 ? 8 : 0;
  core._runFrame(1, keys, 0, 0, 0);
  const memory = ram(), registry = 0x1a1ba0 + 39168;
  const nowResident = memory.subarray(registry, registry + 4).toString() === "PWCS" && memory[0x1a2a10] >= 28 && memory[0x1a2a10] <= 64;
  if (nowResident && !resident) starts.push(frame);
  if (!nowResident && resident) completions.push(frame);
  resident = nowResident;
  if (frame % 240 === 0 || frame === Number(frameArg) - 1) {
    const row = { frame, registryResident: nowResident, idBound: memory[0x1a2a10], starts: [...starts], completions: [...completions], fatal };
    trace.push(row); console.log(JSON.stringify(row));
    const png = new PNG({ width: 256, height: 384 }), fb = core._getSymbol(4) >>> 0;
    png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4));
    if(nowResident){let visible=0;for(let i=0;i<256*192*4;i+=4)if(Math.max(png.data[i],png.data[i+1],png.data[i+2])-Math.min(png.data[i],png.data[i+1],png.data[i+2])>16)visible++;if(visible>1500)visibleSceneCaptures++;}
    await fs.writeFile(`${out}/frame-${frame}.png`, PNG.sync.write(png));
  }
}
await fs.writeFile(`${out}/ram.bin`, ram()); await fs.writeFile(`${out}/trace.json`, JSON.stringify(trace, null, 2));
if (fatal.length) throw new Error(fatal.join("\n"));
if (starts.length < 2 || completions.length < 2) throw new Error("The custom sequence did not complete twice through player-triggered replay.");
if(visibleSceneCaptures<2)throw new Error("The custom sequence completed but did not produce enough visible scene captures.");
console.log(JSON.stringify({ passed: true, starts, completions, repeatedPlayback: starts.length >= 2 && completions.length >= 2, inputRestored: completions.length >= 2, fieldReturned: completions.length >= 1, visibleSceneCaptures }));
