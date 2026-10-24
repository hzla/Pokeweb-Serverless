import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../src/nds/rom';
import { readU32 } from '../src/nds/binary';
import { cutsceneDialogueRuntimeOffset } from '../src/pokeweb/cutsceneDialogueRuntime';
import { toDesmumeDsv } from "../src/pokeweb/testBattle";

const [romPath, savePath, out, frameArg = "6500"] = process.argv.slice(2);
if (!romPath || !savePath || !out) throw new Error("Usage: vite-node scripts/verify-native-cutscene-emulator.ts TEST.nds TEST.sav OUTPUT_DIR [FRAMES]");
await fs.mkdir(out, { recursive: true });
const rom = new Uint8Array(await fs.readFile(romPath)), rawSave = new Uint8Array(await fs.readFile(savePath));
const overlay=new NintendoDSRom(rom,{fileData:'view'}).loadArm9Overlays([293]).get(293)!.data,adapter=cutsceneDialogueRuntimeOffset(overlay);if(adapter===undefined)throw new Error('Dialogue adapter is missing.');const stateAddress=0x021a1ba0+adapter+24+readU32(overlay,adapter+12),stateOffset=stateAddress-0x02000000;
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
let wait: {start:number;clock:number;hash?:string}|undefined;const waits:Array<{start:number;end?:number;clock:number;hash?:string}>=[];const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
let timed:{start:number;clock:number;lastClock:number;end?:number}|undefined;const timedWindows:Array<NonNullable<typeof timed>>=[];
for (let frame = 0; frame < Number(frameArg); frame++) {
  const back = completions[0] === undefined ? Infinity : completions[0] + 360, replay = back + 120;
  let keys = frame >= 900 && frame < 918 || frame >= replay && frame < replay + 18 ? 4 : frame >= back && frame < back + 18 ? 8 : 0;
  // Hold A before and through the first window opening. It must not count as
  // an advance until released and pressed again later.
  if(resident&&!waits.length&&frame-starts[0]>=160)keys=0x80;
  if(wait&&waits.length===1&&frame-wait.start<90)keys=0x80;
  if(wait){const age=frame-wait.start;if(age>=180&&age<184)keys=waits.length%2?0x80:0x40;}
  core._runFrame(1, keys, 0, 0, 0);
  const memory = ram(), registry = 0x1a1ba0 + 39168;
  const nowResident = memory.subarray(registry, registry + 4).toString() === "PWCS" && memory[0x1a2a10] >= 28 && memory[0x1a2a10] <= 64;
  if (nowResident && !resident) starts.push(frame);
  if (!nowResident && resident) completions.push(frame);
  resident = nowResident;
  const waiting=nowResident&&memory.readUInt32LE(stateOffset+16)===1;
  if(waiting){const scene=memory.readUInt32LE(stateOffset+8)-0x02000000,camera=memory.readUInt32LE(scene+0x18)-0x02000000,clock=memory.readUInt32LE(camera+0x10);
    if(!wait){wait={start:frame,clock};waits.push(wait);console.log(JSON.stringify({waitStart:frame,clock,scene}));}
    assert.equal(clock,wait.clock,'Scene clock must remain fixed during dialogue.');assert.equal(memory.readUInt32LE(scene+0x14),0,'Native scene step must be zero.');
    const age=frame-wait.start;if(age===30||age===150){const fb=core._getSymbol(4)>>>0,pixels=core.HEAPU8.subarray(fb,fb+256*100*4),hash=digest(pixels);if(age===30)wait.hash=hash;else assert.equal(hash,wait.hash,'Camera, sprites and material animation must hold.');const png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await fs.writeFile(`${out}/wait-${waits.length}-${age}.png`,PNG.sync.write(png));}
  }else if(wait){waits[waits.length-1].end=frame;console.log(JSON.stringify({waitEnd:frame,held:frame-wait.start}));wait=undefined;}
  const textData=nowResident?memory.readUInt32LE(stateOffset+32):0;
  if(textData&&!waiting){
    const manager=memory.readUInt32LE(stateOffset+4)-0x02000000,scene=memory.readUInt32LE(manager+0x1c)-0x02000000,camera=memory.readUInt32LE(scene+0x18)-0x02000000,clock=memory.readUInt32LE(camera+0x10);
    if(!timed){timed={start:frame,clock,lastClock:clock};timedWindows.push(timed);}timed.lastClock=clock;
    if(frame-timed.start===30){const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await fs.writeFile(`${out}/timed-${timedWindows.length}.png`,PNG.sync.write(png));}
  }else if(timed){timed.end=frame;assert.ok(timed.lastClock-timed.clock>=50*4096,'Timed dialogue must leave the scene clock running.');timed=undefined;}

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
assert.ok(waits.length>=requiredPlaybacks*2&&waits.every(w=>w.end!==undefined&&(w.end-w.start)>=180),'Both dialogue waits must advance with A/B.');await fs.writeFile(`${out}/dialogue-waits.json`,JSON.stringify(waits,null,2));
assert.equal(timedWindows.length,requiredPlaybacks,'Each playback must include a running timed window.');await fs.writeFile(`${out}/timed-windows.json`,JSON.stringify(timedWindows,null,2));
console.log(JSON.stringify({ passed: true, waits, timedWindows, heldInputIgnored:true,starts, completions, repeatedPlayback: starts.length >= 2 && completions.length >= 2, inputRestored: completions.length >= 2, fieldReturned: completions.length >= 1, visibleSceneCaptures }));
