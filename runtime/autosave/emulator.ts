// Isolated native emulator validation; only copied fixture bytes are written.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { PNG } from 'pngjs';
import { loadProjectFromRomBytes } from '../../src/pokeweb/loader';
import { buildQuickLaunchDownloads,rawSaveBytesFromDesmumeDsv,bundleTestBattleSaveForQuickLaunch } from '../../src/pokeweb/testBattle';
import { installAutosave } from './install';
import { NintendoDSRom } from '../../src/nds/rom';
import { NARC } from '../../src/nds/narc';
import { patchOverworldTestWarpEvent,patchOverworldTestWarpSave } from '../../src/pokeweb/testOverworldWarp';
const [input,scenarioFile]=process.argv.slice(2);if(!input)throw new Error('Pass clean B2/W2 ROM and optional input JSON.');
const game=input.toLowerCase().includes('black')?'B2':'W2';
const scenario=scenarioFile?JSON.parse(await readFile(scenarioFile,'utf8')):{name:'idle',frames:1300,inputs:[],captures:[900,1299]};
const out=new URL(`./build/emulator-${game}-${scenario.name}${process.argv.includes('--companions')?'-companions':''}/`,import.meta.url);await mkdir(out,{recursive:true});
globalThis.fetch=(async(v:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(v instanceof URL?v:new URL(v instanceof Request?v.url:String(v))))))as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),'autosave-test.nds',{selectedNarcs:[]});
if(!process.argv.includes('--baseline'))await installAutosave(project);
if(process.argv.includes('--companions')){const {installCGearQuickActions}=await import('../../src/pokeweb/cgearQuickActionsModel');await installCGearQuickActions(project);}
const downloads=await buildQuickLaunchDownloads(project);let romBytes=new NintendoDSRom(downloads.romBytes,{fileData:'view'}).save({preserveOriginalLength:false});
const saveOption=process.argv.indexOf('--save');let save=saveOption<0?downloads.saveBytes:bundleTestBattleSaveForQuickLaunch(rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(process.argv[saveOption+1]))));
function crc(b:Uint8Array){let c=65535;for(const v of b){c^=v<<8;for(let i=0;i<8;i++)c=((c<<1)^(c&32768?0x1021:0))&65535;}return c;}
if(scenario.position){
 const b=Buffer.from(save.buffer,save.byteOffset,save.length),{zone,x,y,z}=scenario.position;
 for(const half of[0,0x26000]){
  const start=half+0x19500;b.fill(0,start,start+28);b.writeUInt32LE(1,start);b.writeUInt16LE(zone,start+4);b.writeInt16LE(-1,start+6);b.writeInt16LE(3,start+8);
  b.writeUInt32LE(zone,half+0x19580);
  for(const[o,v]of[[start+16,(x+.5)*65536],[start+20,y*65536],[start+24,(z+.5)*65536],[half+0x19584,(x+.5)*65536],[half+0x19588,y*65536],[half+0x1958c,(z+.5)*65536]])b.writeUInt32LE(v,o);
  const c=crc(b.subarray(start,start+0xa8));b.writeUInt16LE(c,start+0xaa);b.writeUInt16LE(c,half+0x25f38);b.writeUInt16LE(crc(b.subarray(half+0x25f00,half+0x25f94)),half+0x25fa2);
 }
}
if(scenario.sameHeaderWarp){
 const r=new NintendoDSRom(romBytes,{fileData:'view'}),headers=new NARC(r.files[r.fileId('a/0/1/2')]).files[0],eventsId=r.fileId('a/1/2/6'),events=new NARC(r.files[eventsId]);
 const member=Buffer.from(headers).readUInt16LE(427*48+22),destination={zoneId:427,gridX:53,gridZ:728};
 events.files[member]=patchOverworldTestWarpEvent(events.files[member],{zoneId:427,gridX:53,gridY:1,gridZ:730},destination);
 romBytes=r.save({files:new Map([[eventsId,events.save()]])});
 save=bundleTestBattleSaveForQuickLaunch(patchOverworldTestWarpSave(rawSaveBytesFromDesmumeDsv(save),destination));
}
await writeFile(new URL('test.nds',out),romBytes);await writeFile(new URL('initial.dsv',out),save);await writeFile(new URL('initial.sav',out),rawSaveBytesFromDesmumeDsv(save));
console.log('fixture',save.length,'zone',Buffer.from(save).readUInt32LE(0x19580),'x',Buffer.from(save).readUInt16LE(0x19586),'z',Buffer.from(save).readUInt16LE(0x1958e));
const corePath=new URL('../../public/desmond/desmond.js',import.meta.url),source=await readFile(corePath,'utf8');let ready!:()=>void;
const initialized=new Promise<void>(r=>ready=r),fatal:string[]=[];const log=(...a:unknown[])=>{if(process.env.AUTOSAVE_VERBOSE)console.log(...a);if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(a.join(' ')))fatal.push(a.join(' '));};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL('../../public/desmond',import.meta.url)),__filename:fileURLToPath(corePath),console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(source.slice(source.indexOf('var Module=typeof Module')),context);await initialized;const core=context.Module;core._main(0,0);
const size=Math.max(romBytes.length,128*1024*2**romBytes[0x14]),ptr=core._prepareRomBuffer(size);core.HEAPU8.set(romBytes,ptr);core.HEAPU8.fill(255,ptr+romBytes.length,ptr+size);
core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();if(core._loadROM(size)!==1)throw new Error('ROM rejected');
const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
const trace:unknown[]=[];let previous='';let firstWriting=-1,savingCaptured=false;
for(let frame=0;frame<scenario.frames;frame++){
 const input=scenario.inputs.find((v:any)=>frame>=v.frame&&frame<v.frame+(v.duration??4));const touch=input?.touch;
 core._runFrame(1,input?.buttons??0,touch?1:0,touch?.[0]??0,touch?.[1]??0);
 if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
 const m=ram();let at=m.indexOf(Buffer.from('ASMV'));
 if(at>=0){
  const values=Array.from({length:12},(_,i)=>m.readUInt32LE(at+i*4));const field=values[10]-0x2000000;
  const row={frame,values,zone:field>=0&&field+0xe8<m.length?m.readUInt16LE(field+0xe8):null,field:values[10]};
  if(firstWriting<0&&values[7]===3&&values[3]>values[4])firstWriting=frame;
  if(!savingCaptured&&firstWriting>=0&&frame>=firstWriting+4&&values[7]===3&&values[3]>values[4]){
   const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));
   await writeFile(new URL('saving.png',out),PNG.sync.write(png));savingCaptured=true;
  }
  const key=JSON.stringify([values.slice(2,9),row.zone]);if(previous!==key){trace.push(row);console.log(JSON.stringify(row));previous=key;}
 }
 if(scenario.captures?.includes(frame)||frame===scenario.frames-1){
  const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));
  await writeFile(new URL(`frame-${frame}.png`,out),PNG.sync.write(png));await writeFile(new URL('ram.bin',out),m);
 }
}
if(scenario.expect){
 const m=ram(),d=m.indexOf(Buffer.from('ASMV'));if(d<0)throw new Error('Runtime missing.');
 const actual={transitions:m.readUInt32LE(d+8),completed:m.readUInt32LE(d+16),zone:m.readUInt16LE(m.readUInt32LE(d+40)-0x2000000+0xe8)};
 if(JSON.stringify(actual)!==JSON.stringify(scenario.expect)||m.readUInt32LE(d+20)||m.readUInt32LE(d+24)||m.readUInt32LE(d+28))throw new Error(`Acceptance mismatch: ${JSON.stringify(actual)}`);
}
const savedSize=core._savGetSize(),savedPtr=core._savGetPointer(savedSize)>>>0;
const saved=new Uint8Array(core.HEAPU8.subarray(savedPtr,savedPtr+savedSize));await writeFile(new URL('saved.dsv',out),saved);await writeFile(new URL('saved.sav',out),rawSaveBytesFromDesmumeDsv(saved));await writeFile(new URL('trace.json',out),JSON.stringify(trace,null,2));
console.log(fileURLToPath(out));
