// Isolated BW1 functional checks. Original ROMs and saves are read-only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { PNG } from "pngjs";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, patchTestBattleSaveBadges } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerParty } from "../../src/pokeweb/testBattleTeam";
import { installCGearQuickActions, getCGearQuickActionsStatus } from "../../src/pokeweb/cgearQuickActionsModel";
import { ensureCGearButtons } from "../../src/pokeweb/cgearButtonsModel";
import { actionFor, newButton, type ActionId } from "../../src/cgearButtons/document";
import manifest from "../../src/assets/codeinjection/cgearQuickActionsBw1Manifest.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
const option=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const input=process.argv[2];if(!input)throw new Error("Pass a US BW1 revision-0 ROM.");
const action=option("--action","repel") as ActionId,scenario=option("--scenario","preview"),frames=Number(option("--frames","4200"));
globalThis.fetch=(async(input:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(input instanceof URL?input:new URL(input instanceof Request?input.url:String(input))))))as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),"bw1-cgear.nds",{selectedNarcs:[]});
const game=project.session.baseVersion;if(game!=="B"&&game!=="W")throw new Error("Only BW1.");
const name=option("--name",`bw1-${game}-${scenario}-${action}`);if(!/^[\w-]+$/.test(name))throw new Error("Invalid output name.");
const out=new URL(`./build/${name}/`,import.meta.url);await mkdir(out,{recursive:true});
const doc=ensureCGearButtons(project).document,choice=actionFor(action,"BW");if(!choice)throw new Error("Unsupported BW1 action.");
Object.assign(doc.buttons[0],{action,label:choice.label,flag:undefined});
if(process.argv.includes("--eight"))while(doc.buttons.length<8)doc.buttons.push(newButton(doc,doc.buttons.length===6?"rod":"pokeradar"));
if(!process.argv.includes("--vanilla")){await installCGearQuickActions(project);if(!getCGearQuickActionsStatus(project).compatible)throw new Error("Staging failed.");}
const downloads=await buildQuickLaunchDownloads(project),rom=downloads.romBytes;
const team=`Mew\nLevel: 20\n- ${process.argv.includes("--no-fly")?"Pound":"Fly"}\n\nOshawott\nLevel: 15\n- Tackle\n\nPikachu\nLevel: 15\n- Tackle`;
const fixturePath=option("--fixture-copy","");
const fixture=fixturePath?Buffer.from(await readFile(fixturePath)):Buffer.from(patchTestBattleSavePlayerParty(patchTestBattleSaveBadges(downloads.saveBytes,getTestBattleConfigForProject(project)),project,team,"BW"));
const crc=(bytes:Uint8Array)=>{let c=0xffff;for(const v of bytes){c^=v<<8;for(let i=0;i<8;i++)c=c&0x8000?(c<<1)^0x1021:c<<1;c&=65535;}return c;};
for(const half of [0,0x24000]){
 const zoneOption=option("--zone","");
 if(zoneOption){
  const zone=Number(zoneOption),r=new NintendoDSRom(rom,{fileData:"view"}),headers=Buffer.from(new NARC(r.files[r.fileId("a/0/1/2")]).files[0]);
  if(!Number.isInteger(zone)||zone<0||zone*48+48>headers.length)throw new Error("Invalid fixture zone.");
  const x=Number(option("--x",String(headers.readInt32LE(zone*48+36)))),y=headers.readInt32LE(zone*48+40),z=Number(option("--z",String(headers.readInt32LE(zone*48+44))));
  const start=half+0x19500;fixture.fill(0,start,start+28);fixture.writeUInt32LE(1,start);fixture.writeUInt16LE(zone,start+4);fixture.writeInt16LE(-1,start+6);fixture.writeInt16LE(2,start+8);
  fixture.writeUInt32LE(zone,half+0x19580);fixture.fill(0,half+0x19584,half+0x19590);
  for(const [at,value]of [[start+16,(x+.5)*65536],[start+20,y*65536],[start+24,(z+.5)*65536],[half+0x19584,(x+.5)*65536],[half+0x19588,y*65536],[half+0x1958c,(z+.5)*65536]])fixture.writeUInt32LE(value,at);
  const sum=crc(fixture.subarray(start,start+0x9c));fixture.writeUInt16LE(sum,start+0x9e);fixture.writeUInt16LE(sum,half+0x23f38);
 }
 for(const id of [442,450,447,471,465,437,...choice.item?[choice.item]:[]]){
  let slot=-1;for(let i=0;i<83;i++){const at=half+0x18400+0x4d8+i*4,current=fixture.readUInt16LE(at);if(current===id){slot=at;break;}if(!current&&slot<0)slot=at;}
  if(slot<0)throw new Error("Fixture key-item pocket full.");fixture.writeUInt16LE(id,slot);fixture.writeUInt16LE(1,slot+2);
 }
 const bag=crc(fixture.subarray(half+0x18400,half+0x18dc0));fixture.writeUInt16LE(bag,half+0x18dc2);fixture.writeUInt16LE(bag,half+0x23f32);
 const flag=1517,at=half+0x20100+0x27c+(flag>>3);fixture[at]&=~(1<<(flag&7));
 const flags=crc(fixture.subarray(half+0x20100,half+0x204ec));fixture.writeUInt16LE(flags,half+0x204ee);fixture.writeUInt16LE(flags,half+0x23f5a);
 fixture.writeUInt16LE(crc(fixture.subarray(half+0x23f00,half+0x23f8c)),half+0x23f9a);
}
const corePath=new URL("../../public/desmond/desmond.js",import.meta.url),source=await readFile(corePath,"utf8");
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];
const log=(...args:unknown[])=>{if(process.argv.includes("--debug"))console.log(...args);if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(args.join(" ")))fatal.push(args.join(" "));};
const ctx=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready,onExit:(code:number)=>{throw new Error(`Core exited ${code}`);}},require:createRequire(import.meta.url),process:{...process,exit:(code:number)=>{throw new Error(`Core process exit ${code}`);}},Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:fileURLToPath(corePath),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")),ctx);await initialized;
const core=ctx.Module;core._main(0,0);
const size=Math.max(rom.length,128*1024*2**rom[0x14]),ptr=core._prepareRomBuffer(size);core.HEAPU8.set(rom,ptr);core.HEAPU8.fill(255,ptr+rom.length,ptr+size);core.HEAPU8.set(fixture,core._savGetPointer(fixture.length));core._savUpdateChangeFlag();if(core._loadROM(size)!==1)throw new Error("Emulator rejected ROM.");
const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
type Input={frame:number;buttons?:number;touch?:[number,number];duration?:number};
const inputs:Input[]=[{frame:1500,buttons:32},{frame:1800,buttons:128},{frame:2000,buttons:128},{frame:2200,buttons:128},{frame:2400,buttons:process.argv.includes("--power-on")?8:4},{frame:2500,buttons:128},{frame:3000,buttons:128},{frame:3500,buttons:128}];
if(scenario!=="preview")inputs.push({frame:4000,touch:scenario.startsWith("power")?[222,170]:[60,116],duration:scenario==="held"?100:6});
if(scenario==="repeat")inputs.push({frame:4400,touch:[60,116]});
if(scenario==="action")inputs.push({frame:4800,buttons:64},{frame:5200,buttons:64});
if(scenario==="power-cancel")inputs.push({frame:4800,touch:[216,86]});
if(scenario==="power-confirm")inputs.push({frame:4800,touch:[216,64]},{frame:6000,buttons:128},{frame:6400,buttons:128});
if(scenario==="fly-confirm")inputs.push({frame:4800,buttons:128},{frame:5200,buttons:128});
const inputPath=option("--input","");if(inputPath)inputs.splice(0,inputs.length,...JSON.parse(await readFile(inputPath,"utf8")));
if(process.argv.includes("--power-on")){const choice=inputs.find(i=>i.frame===2400);if(choice)choice.buttons=8;}
const trace:any[]=[],display:any[]=[];let last="";
const captures=new Set([1000,2000,2500,3000,3900,4200,4600,5000,5500,6000,6500,frames-1,...option("--captures","").split(",").filter(Boolean).map(Number)]);
for(let frame=0;frame<frames;frame++){
 if(process.argv.includes("--debug")&&frame%100===0)console.log("Frame",frame);
 const action=inputs.find(i=>frame>=i.frame&&frame<i.frame+(i.duration??6));core._runFrame(1,action?.buttons??0,action?.touch?1:0,action?.touch?.[0]??0,action?.touch?.[1]??0);
 if(frame%30===0){const m=ram();let at=-1,cursor=0;
  while((cursor=m.indexOf(Buffer.from([0x43,0x51,0x41,0x31]),cursor))>=0){if(cursor<m.length-924&&m[cursor+908]<=8&&m[cursor+909]<=1&&m[cursor+916]<=40){at=cursor;break;}cursor++;}
  if(at>=0&&at<m.length-924){const sub=m.readUInt32LE(at+4)-0x2000000,work=sub>=0&&sub<m.length-36?m.readUInt32LE(sub+32)-0x2000000:-1;
   const field=sub>=0&&sub<m.length-36?m.readUInt32LE(sub+20)-0x2000000:-1,sys=field>=0&&field<m.length-8?m.readUInt32LE(field+4)-0x2000000:-1,g=sys>=0&&sys<m.length-32?m.readUInt32LE(sys+28)-0x2000000:-1;
   const enc=g>=0&&g<m.length-0x5e8?m.readUInt32LE(g+0x5e4)-0x2000000:-1;
   const row={frame,session:at+0x2000000,sub:sub+0x2000000,work:work+0x2000000,game:g+0x2000000,playerForm:g>=0&&g<m.length-0x158?m.readUInt32LE(g+0x154):-1,mode:sub>=0&&sub<m.length-36?m.readUInt32LE(sub):-1,state:work>=0&&work<m.length-0x468?m.readUInt32LE(work):0,
    phenomenon:enc>=0&&enc<m.length-40?{valid:m[enc+0x1d]&15,bytes:m.subarray(enc+16,enc+30).toString("hex")}:undefined,
    count:m[at+908],visible:m[at+909],active:m[at+910],attempted:m[at+911],held:m[at+912],pending:m[at+913],pressed:m[at+914],drag:m[at+915],error:m[at+916],edit:m[at+917],design:work>=0&&work<m.length-0x45b?m[work+0x458]:-1,power:work>=0&&work<m.length-0x45b?m[work+0x45a]:-1,
    shown:[...m.subarray(at+892,at+900)],available:[...m.subarray(at+900,at+908)],actors:Array.from({length:10},(_,i)=>m.readUInt32LE(at+12+i*4)),positions:[...m.subarray(at+144,at+160)]};
   const key=JSON.stringify({...row,frame:0});if(key!==last||frame%300===0){trace.push(row);last=key;}
  }
 }
 if(process.argv.includes("--check-panels")&&frame%30===0){
  const length=core._saveState(0),at=core._stateGetPointer(0),state=Buffer.from(core.HEAPU8.buffer,at,length);
  const registers=state.indexOf(Buffer.from([0x39,0x52,0x45,0x47,1,0,0,0,0,32,0,0]));
  if(registers<0)throw new Error("Missing native display registers in state export.");
  const dispcnt=state.readUInt32LE(registers+12+0x1000),m=ram(),setter=manifest.games[game].functions.SubPlanes.entry-0x2000000,cache=m.readUInt32LE(setter+32)-0x2000000;
  const row={frame,dispcnt,planes:dispcnt>>8&31,cache:cache>=0&&cache<m.length-4?m.readUInt32LE(cache):null,visible:!!trace.at(-1)?.visible};display.push(row);
  if(row.visible&&(row.planes&1))throw new Error(`Native panels visible at frame ${frame}.`);
 }
 if(captures.has(frame)){
  const pixels=new Uint8Array(core.HEAPU8.subarray(core._getSymbol(4),core._getSymbol(4)+256*384*4));const png=new PNG({width:256,height:384});png.data=Buffer.from(pixels);await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));
 }
 if(fatal.length)throw new Error(fatal.join("\n"));
}
const rawSave=(b:Uint8Array)=>b.length===524410&&Buffer.from(b.subarray(-16)).toString()==="|-DESMUME SAVE-|"?b.subarray(0,524288):b;
await writeFile(new URL("trace.json",out),JSON.stringify({game,scenario,action,trace,display,fatal},null,2));await writeFile(new URL("ram.bin",out),ram());await writeFile(new URL("test.nds",out),rom);await writeFile(new URL("test.sav",out),rawSave(fixture));
const saveSize=core._savGetSize(),saveAt=core._savGetPointer(saveSize);await writeFile(new URL("saved.sav",out),rawSave(core.HEAPU8.subarray(saveAt,saveAt+saveSize)));
if(!process.argv.includes("--vanilla")&&!trace.some(t=>t.visible&&t.error===0))throw new Error("Custom C-Gear did not initialize.");
console.log(JSON.stringify({game,scenario,action,trace:trace.slice(-6),fatal}));
