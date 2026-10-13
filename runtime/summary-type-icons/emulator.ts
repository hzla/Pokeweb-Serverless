// Isolated DS rendering check; the fixture save exists only in emulator RAM.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { installSummaryTypeIcons } from "../../src/pokeweb/summaryTypeIconsModel";
import { installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";
import { installCGearQuickActions } from "../../src/pokeweb/cgearQuickActionsModel";
import { ensureCGearButtons } from "../../src/pokeweb/cgearButtonsModel";

const input=process.argv[2];if(!input)throw new Error("Pass a clean BW2 ROM.");
const game=input.includes("black")?"B2":"W2",out=new URL(`./build/emulator-${game}${process.argv.includes("--native-types")?"-native":""}/`,import.meta.url);await mkdir(out,{recursive:true});
globalThis.fetch=(async(v:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(v instanceof URL?v:new URL(v instanceof Request?v.url:String(v)))))) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"summary-types.nds",{selectedNarcs:[]});
await installSummaryStatViewer(project);if(!process.argv.includes("--native-types"))await installSummaryTypeIcons(project);
const design=ensureCGearButtons(project).document;Object.assign(design.buttons[0],{label:"PARTY",action:"party"});
await installCGearQuickActions(project);const downloads=await buildQuickLaunchDownloads(project);
const corePath=new URL("../../public/desmond/desmond.js",import.meta.url),source=await readFile(corePath,"utf8");
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...a:unknown[])=>{if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(a.join(" ")))fatal.push(a.join(" "));};
const ctx=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:fileURLToPath(corePath),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),ctx);await initialized;const core=ctx.Module;
core._main(0,0);const size=Math.max(downloads.romBytes.length,128*1024*2**downloads.romBytes[0x14]),ptr=core._prepareRomBuffer(size);
core.HEAPU8.set(downloads.romBytes,ptr);core.HEAPU8.fill(255,ptr+downloads.romBytes.length,ptr+size);
core.HEAPU8.set(downloads.saveBytes,core._savGetPointer(downloads.saveBytes.length));core._savUpdateChangeFlag();
if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM.");
const inputs=process.env.SUMMARY_ICON_INPUTS?JSON.parse(process.env.SUMMARY_ICON_INPUTS):[
  {frame:750,touch:[60,116]},{frame:950,buttons:128},{frame:1070,buttons:128},
  {frame:1430,buttons:1},{frame:1610,buttons:128},{frame:1830,buttons:64},
  {frame:2050,buttons:1},{frame:2230,buttons:1},{frame:2450,buttons:2},
  {frame:2630,buttons:2},{frame:2810,buttons:2},{frame:2990,buttons:4},
  {frame:3210,buttons:64},{frame:3370,buttons:64}];
const trace:unknown[]=[];
for(let frame=0;frame<Number(process.env.SUMMARY_ICON_FRAMES??3550);frame++){
  const input=inputs.find((i:{frame:number;duration?:number})=>frame>=i.frame&&frame<i.frame+(i.duration??4));
  core._runFrame(1,input?.buttons??0,input?.touch?1:0,input?.touch?.[0]??0,input?.touch?.[1]??0);
  if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
  if(frame%100===0){
    const png=new PNG({width:256,height:384}),fb=core._getSymbol(4)>>>0;
    png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));
    const ram=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000),s=ram.lastIndexOf(Buffer.from('SYTI'));
    trace.push({frame,session:s<0?null:s,active:s<0?null:ram.readUInt32LE(s+1188),
      bindings:s<0?null:Array.from({length:2},(_,i)=>{
        const actor=ram.readUInt32LE(s+12+i*4);
        return {actor,type:ram.readUInt32LE(s+1176+i*4),visible:actor?Boolean(ram.readUInt32LE(actor-0x02000000+0x60)&(1<<26)):false};
      })});
  }
  if(frame%300===0)console.log(game,"frame",frame);
}
await writeFile(new URL("trace.json",out),JSON.stringify(trace,null,2));console.log(game,"emulator finished",fileURLToPath(out));
if(!process.argv.includes("--native-types")&&!process.env.SUMMARY_ICON_INPUTS&&Number(process.env.SUMMARY_ICON_FRAMES??3550)>=3550){
  const rows=trace as {frame:number;active:number;bindings:{actor:number;type:number;visible:boolean}[]}[];
  const at=(frame:number)=>rows.find(r=>r.frame===frame)!;
  for(const frame of [1200,1500,1700,2100,2300,3100])if(at(frame).active!==1)throw new Error(`Summary icons inactive at ${frame}`);
  if(at(1200).bindings.map(b=>b.type).join()!=="13,17")throw new Error("Information-page Psychic badge did not bind.");
  if(at(1700).bindings.map(b=>b.type).join()!=="13,17")throw new Error("Move details changed information-page assets.");
  for(const frame of [1500,1700,2100,2300])if(at(frame).bindings.some(b=>b.visible))throw new Error(`Information badges visible outside the information page at ${frame}`);
  if(!at(1200).bindings[0].visible||at(1200).bindings[1].visible)throw new Error("Monotype information visibility incorrect.");
  if(at(3100).bindings.map(b=>b.type).join()!=="4,8")throw new Error("Dual-type Pokémon did not update both palettes.");
  if(at(3100).bindings.some(b=>!b.visible))throw new Error("Dual-type information badges hidden.");
  if(at(3500).active!==0||at(3500).bindings.some(b=>b.actor))throw new Error("Summary teardown retained actor bindings.");
  console.log(game,"information-only badges, native move details, IV/EV navigation, dual-type switch and teardown assertions passed");
}
