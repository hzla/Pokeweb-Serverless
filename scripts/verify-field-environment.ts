import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { toDesmumeDsv } from "../src/pokeweb/testBattle";

const [romPath, savePath, out, frameArg = "4600", captureArg = "240"] = process.argv.slice(2);
if (!romPath || !savePath || !out) throw new Error("Usage: vite-node scripts/verify-native-cutscene-emulator.ts TEST.nds TEST.sav OUTPUT_DIR [FRAMES]");
const sceneSource=JSON.parse(await fs.readFile(romPath.replace(/\.nds$/,'.scene.json'),'utf8'));
const ramped=Boolean(sceneSource.environment?.tempo);
const approachArg=process.argv.find(a=>a.startsWith('--approach='));
const approach:number[][]=approachArg?JSON.parse(await fs.readFile(approachArg.slice(11),'utf8')):[];let approachIndex=0;
await fs.mkdir(out, { recursive: true });
const rom = new Uint8Array(await fs.readFile(romPath)), rawSave = new Uint8Array(await fs.readFile(savePath));
if(process.argv.includes('--audit-only')){const trace=JSON.parse(await fs.readFile(`${out}/trace.json`,'utf8'));const active=trace.filter((r:any)=>r.active&&r.player);await audit(trace,active[0]?.frame??-1,active.find((r:any)=>r.done&&r.follow)?.frame??-1);process.exit(0);}
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

const manifest=JSON.parse(await fs.readFile(romPath.replace(/\.nds$/,'.manifest.json'),'utf8')),stateAddress=manifest.environment.runtime.stateAddress-0x02000000;
const trace:any[]=[];let finish=-1,started=-1;
for(let frame=0;frame<Number(frameArg);frame++){
 let keys=frame>=900&&frame<918?4:0;
 const prior=trace.at(-1);
 if(frame>=940&&approach.length&&!prior?.active&&prior?.player){
  while(approachIndex<approach.length&&Math.hypot(prior.player[0]-(approach[approachIndex][0]*16+8),prior.player[2]-(approach[approachIndex][1]*16+8))<.1)approachIndex++;
  const next=approach[approachIndex];if(next){const dx=next[0]*16+8-prior.player[0],dz=next[1]*16+8-prior.player[2];keys=Math.abs(dx)>.1?(dx>0?1:2):(dz>0?4:8);}
 }if(finish>=0&&frame>=finish+60&&frame<finish+78)keys=4;
 core._runFrame(1,keys,0,0,0);const m=ram();let row:any={frame,fatal};
 if(m.readUInt32LE(stateAddress)===0x53455750){
  const field=m.readUInt32LE(stateAddress+8)-0x02000000,counter=m.readUInt32LE(stateAddress+12),active=m.readUInt32LE(stateAddress+16),done=m.readUInt32LE(stateAddress+20),errors=m.readUInt32LE(stateAddress+28),resources=m.readUInt32LE(stateAddress+32);
  row={...row,field,counter,active,done,errors,resources,uploads:m.readUInt32LE(stateAddress+24),level:m.readUInt32LE(stateAddress+36),pair:m.readUInt32LE(stateAddress+560),audioPlaying:m.readUInt32LE(stateAddress+568)};
  if(field>=0&&field<0x3fff00){const cam=m.readUInt32LE(field+16)-0x02000000;if(cam>=0&&cam<0x3fff00){const ref=m.readUInt32LE(cam+24)-0x02000000,follow=m.readUInt32LE(cam+28);row={...row,cam,follow,pos:[0,1,2].map(k=>m.readInt32LE(cam+36+k*4)/4096),target:[0,1,2].map(k=>m.readInt32LE(cam+72+k*4)/4096),pitch:m.readUInt16LE(cam+120),distance:m.readInt32LE(cam+124)/4096};const gd=m.readUInt32LE(field+8)-0x02000000;if(gd>=0&&gd<0x3ffe00){row.season=m[gd+0x1c8];row.seasonLocked=m[gd+0x1d2];const work=m.readUInt32LE(gd+0x1ac)-0x02000000;if(work>=0&&work<0x3ffa00)row.calendarWork=m.readUInt16LE(work+860);}const mapper=m.readUInt32LE(field+0x50)-0x02000000;if(mapper>=0&&mapper<0x3fff00){const anim=m.readUInt32LE(mapper+0x68)-0x02000000;if(anim>=0&&anim<0x3ffff0)row.textureSpeed=m.readUInt32LE(anim+4)/4096;const props=m.readUInt32LE(mapper+0x64)-0x02000000;if(props>=0&&props<0x3ffd00){const count=m.readUInt32LE(props+0x244),instances=m.readUInt32LE(props+0x248)-0x02000000;if(count<512&&instances>=0&&instances+count*24<0x400000)for(let i=0;i<count;i++){const r=m.readUInt32LE(instances+i*24+4)-0x02000000,actor=m.readUInt32LE(instances+i*24)-0x02000000;if(r<0||actor<0||r>0x3fff00||actor>0x3fff00)continue;const info=m.readUInt32LE(r)-0x02000000;if(info<0||info>0x3fff00||m.readUInt16LE(info)!==442)continue;const anims=m.readUInt32LE(actor+4)-0x02000000,animation=m.readUInt32LE(anims)-0x02000000,object=m.readUInt32LE(animation+4)-0x02000000;if(object>=0&&object<0x3fff00)row.cloudFrame=m.readInt32LE(object)/4096;}}}if(ref>=0&&ref<0x3fff00)row.player=[0,1,2].map(k=>m.readInt32LE(ref+k*4)/4096);if(active&&!follow&&started<0)started=frame;if(done&&follow&&finish<0)finish=frame;}}
 }
 trace.push(row);
 if(frame%Number(captureArg)===0||(row.counter>=680&&finish<0)||(finish>=0&&frame<=finish+30)){if(frame%Number(captureArg)===0)console.log(JSON.stringify(row));const png=new PNG({width:256,height:384}),fb=core._getSymbol(4)>>>0;png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await fs.writeFile(`${out}/frame-${frame}.png`,PNG.sync.write(png));}
 if(fatal.length)break;
}
await fs.writeFile(`${out}/trace.json`,JSON.stringify(trace));await fs.writeFile(`${out}/ram.bin`,ram());await audit(trace,started,finish);

async function audit(trace:any[],started:number,finish:number){
if(started<0||finish<0||trace.some(r=>r.fatal?.length))throw new Error('Live environment tour failed to complete.');
const active=trace.filter(r=>r.active&&r.player),handoff=active.find(r=>r.frame===finish),after=active.find(r=>r.frame===finish+120),tour=active.filter(r=>r.frame<=finish),deltas=tour.slice(1).map((r,i)=>Math.hypot(...r.pos.map((v:number,k:number)=>v-tour[i].pos[k])));
if(active.some(r=>r.errors))throw new Error('A VRAM transfer failed.');
if(handoff.season!==2||handoff.seasonLocked!==Number(!sceneSource.environment?.persistSeason)||handoff.level!==31||handoff.textureSpeed!==1)throw new Error('Autumn or normal texture speed was not retained.');
if(Math.max(...deltas)>8)throw new Error('Camera jump during the tour.');
if(!after||after.player[2]<=handoff.player[2])throw new Error('Player input did not work after control return.');
if(tour.some(r=>Math.abs(r.player[0]-568)>.01||Math.abs(r.player[2]-11352)>.01))throw new Error('The locked player moved during the effect.');
const cloudSteps=active.slice(1).flatMap((r,i)=>r.counter>70&&r.counter<650&&r.cloudFrame>active[i].cloudFrame?[r.cloudFrame-active[i].cloudFrame]:[]);if(!cloudSteps.length||(!ramped&&cloudSteps.some(n=>Math.abs(n-4)>.01)))throw new Error('Cloud animation did not step at its expected rate.');
if(ramped){const peak=Math.max(...tour.map(r=>r.textureSpeed??0));if(peak<15.99)throw new Error('The animation never reached peak speed.');const rates=new Set(tour.map(r=>r.pair&255));if(rates.size!==4)throw new Error('The tour did not visit all four seasons.');if(handoff.calendarWork!==0xa7c2)throw new Error('The autumn override was not written to saved story work.');if(!tour.some(r=>r.audioPlaying))throw new Error('The native stream did not start.');}
const secondStart=active.find(r=>r.frame>finish+150&&!r.follow&&r.counter<60),secondFinish=secondStart?active.find(r=>r.frame>secondStart.frame&&r.done&&r.follow):undefined;
if(process.argv.includes('--replay')&&(!secondStart||!secondFinish))throw new Error('The lookout trigger did not replay the full environment tour.');
let minColored=999999;
for(let f=finish-30;f<=finish+30;f++){const png=PNG.sync.read(await fs.readFile(`${out}/frame-${f}.png`));let colored=0;for(let k=0;k<256*192*4;k+=4)if(Math.max(...png.data.subarray(k,k+3))>24)colored++;minColored=Math.min(minColored,colored);if(colored<5000)throw new Error('A black/loading frame appeared at handoff.');}
const result={passed:true,ramped,calendarWork:handoff.calendarWork,nativeStreamStarted:tour.some(r=>r.audioPlaying),peakAmbientSpeed:Math.max(...tour.map(r=>r.textureSpeed??0)),visitedSeasons:[...new Set(tour.map(r=>r.pair&255))],started,finish,season:handoff.season,seasonLocked:handoff.seasonLocked,level:handoff.level,textureSpeedAfter:handoff.textureSpeed,maxCameraDelta:Math.max(...deltas),handoffCameraDelta:Math.hypot(...handoff.pos.map((v:number,k:number)=>v-trace.find(r=>r.frame===finish-1).pos[k])),lockedPlayer:handoff.player,firstUserStep:after.player,cloudAnimationSamples:cloudSteps.length,minColoredPixelsAtHandoff:minColored,transferErrors:0,allFramesChecked:trace.length};
await fs.writeFile(`${out}/validation.json`,JSON.stringify(result,null,2)+'\n');console.log(result);

}
