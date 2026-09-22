// Local ROM integration test; creates a separate playable ROM and save copy.
// npx vite-node scripts/verify-following-emulator.ts ../cleanwhite2.nds [frames]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PNG } from 'pngjs';
import { loadProjectFromRomBytes } from '../src/pokeweb/loader';
import { installFollowerAlpha, setFollowerAlphaEnabled } from '../src/pokeweb/followingPokemonProject';
import { exportModifiedRom } from '../src/pokeweb/exportRom';
import { buildQuickLaunchDownloads } from '../src/pokeweb/testBattle';
const [romPath, frameArg='5000']=process.argv.slice(2);
const reload=process.argv.includes('--reload');
if(!romPath)throw new Error('Expected the clean IRDO ROM path');
const output=fileURLToPath(new URL('../runtime/following-pokemon/build/emulator/',import.meta.url));
await mkdir(output,{recursive:true});
globalThis.fetch=(async(input:RequestInfo|URL)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.protocol!=='file:')throw new Error(`Expected local asset ${url}`);
 return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const input=new Uint8Array(await readFile(romPath));
const project=await loadProjectFromRomBytes(input,basename(romPath),{selectedNarcs:[]});
await installFollowerAlpha(project);
await installFollowerAlpha(project);
await setFollowerAlphaEnabled(project,false);
await setFollowerAlphaEnabled(project,true);
const normalRom=await exportModifiedRom(project);
await writeFile(join(output,'White2-Following-Alpha.nds'),normalRom);
let {romBytes,saveBytes}=await buildQuickLaunchDownloads(project);
await writeFile(join(output,'White2-Following-Alpha-QuickLaunch.nds'),romBytes);
await writeFile(join(output,'White2-Following-Alpha.dsv'),saveBytes);
await writeFile(join(output,'White2-Following-Alpha.sav'),saveBytes.subarray(0,512*1024));
if(reload){romBytes=normalRom;saveBytes=new Uint8Array(await readFile(join(output,'after-test.dsv')));}
console.log(`Playable export: ${output}`);
const corePath=fileURLToPath(new URL('../public/desmond/desmond.js',import.meta.url));
const generated=await readFile(corePath,'utf8');
let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r);
const fatal:string[]=[];const log=(...args:unknown[])=>{const line=args.join(' ');if(/Undefined instruction|Assertion failed|Aborted\(/iu.test(line))fatal.push(line);};
const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL('../public/desmond',import.meta.url)),__filename:corePath,console:{log,warn:log,error:log,info:log,debug:log}});
vm.runInContext(generated.slice(generated.indexOf('var Module=typeof Module')),context);
await initialized;const core=context.Module;core._main(0,0);
const size=Math.max(romBytes.length,128*1024*2**romBytes[0x14]!);
const ptr=core._prepareRomBuffer(size);core.HEAPU8.set(romBytes,ptr);core.HEAPU8.fill(255,ptr+romBytes.length,ptr+size);
core.HEAPU8.set(saveBytes,core._savGetPointer(saveBytes.length));core._savUpdateChangeFlag();
if(core._loadROM(size)!==1)throw new Error('ROM rejected');
const trace:unknown[]=[];
const effectTrace:unknown[]=[];let lastEffect="";
let debugAt=-1, routeStage=0,reloadReady=-1;
for(let frame=0;frame<Number(frameArg);++frame){
 // D-pad bits: right 0, left 1, down 2, up 3; B 6; A 7.
 let direction=frame<700?0:1<<([2,1,3,0][Math.floor((frame-700)/120)%4]);
 if(frame>=1500 && frame<1800)direction=frame>=1530 && frame<1534?(1<<9):frame>=1620 && frame<1624?(1<<6):0;
 if(frame>=1800 && debugAt>=0){
  direction=0;
  const memory=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
  const player=memory.readUInt32LE(debugAt+36)-0x02000000;
  if(player>=0 && player<0x3fff00 && memory.readUInt32LE(debugAt+20)===0){
   const x=memory.readInt16LE(player+60),z=memory.readInt16LE(player+64);
   if(routeStage===0 && z>=741)++routeStage;
   if(routeStage===1 && x<=48)++routeStage;
   direction=routeStage===0?4:routeStage===1?2:frame>=2600?4:8;
   if(frame>=2800 && z>100)direction=frame<3080?65:frame<3200?66:0;
  }
 }
 if(frame>=3300)direction=frame>=3330 && frame<3334?512:frame>=3490 && frame<3700 && frame%40<3?128:0;
 if(reload && reloadReady<0 && debugAt>=0){
  const memory=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
  if(memory.readUInt32LE(debugAt)===0x47445746 && memory.readUInt32LE(debugAt+20)===0)reloadReady=frame;
 }
 if(reload)direction=reloadReady<0?(frame%30<3?128:0):frame<reloadReady+60?0:frame<reloadReady+240?1:frame<reloadReady+420?2:0;
 const touch=!reload && frame>=3400 && frame<3404;
 core._runFrame(1,direction,Number(touch),60,155);
 if(fatal.length)throw new Error(`Frame ${frame}: ${fatal.join('; ')}`);
 const effectRam=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
 let effectAt=effectRam.indexOf(Buffer.from('FWFX'));
 while(effectAt>=0){
  if(effectAt+32<=effectRam.length && effectRam.readUInt32LE(effectAt+4)===1){
   const data=Array.from({length:8},(_,i)=>effectRam.readUInt32LE(effectAt+i*4));
   const key=data.join(':');
   if(key!==lastEffect){
    lastEffect=key;effectTrace.push({frame,address:effectAt+0x02000000,data});
    if(data[2]){
     const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));
     await writeFile(join(output,`${reload?'reload-':''}effect-${frame}-${data[2]}-${data[5]}.png`),PNG.sync.write(png));
    }
   }
   break;
  }
  effectAt=effectRam.indexOf(Buffer.from('FWFX'),effectAt+4);
 }
 if(frame%60===0 || frame===Number(frameArg)-1){
  const ram=Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
  let at=ram.indexOf(Buffer.from('FWDG'));const diagnostics=[];
  while(at>=0){
   if(at+60<=ram.length && ram.readUInt32LE(at+4)===1 && ram.readUInt32LE(at+8)>0){
    debugAt=at;
    const data=Array.from({length:15},(_,i)=>ram.readUInt32LE(at+i*4));
    if(reload && reloadReady<0 && data[5]===0)reloadReady=frame;
    const actor=(address:number)=>address>=0x02000000 && address<0x023fff00 ? { flags:ram.readUInt32LE(address-0x02000000),moveflags:ram.readUInt32LE(address-0x02000000+4),grid:[0,1,2].map(i=>ram.readInt16LE(address-0x02000000+60+i*2)),world:[0,1,2].map(i=>ram.readInt32LE(address-0x02000000+68+i*4)),face:ram.readUInt16LE(address-0x02000000+24)}:null;
    diagnostics.push({address:at+0x02000000,data,actor:actor(data[8]),player:actor(data[9])});
   }
   at=ram.indexOf(Buffer.from('FWDG'),at+4);
  }
  const entry={frame,diagnostics};trace.push(entry);console.log(JSON.stringify(entry));
 }
 if(frame%300===0 || frame===1590 || frame===Number(frameArg)-1){
  const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await writeFile(join(output,`${reload?"reload-":""}frame-${frame}.png`),PNG.sync.write(png));
  const len=core._saveState(1);await writeFile(join(output,'latest.dst'),Buffer.from(core.HEAPU8.buffer,core._stateGetPointer(0)>>>0,len));
 }
}
await writeFile(join(output,reload?'reload-trace.json':'trace.json'),JSON.stringify(trace,null,2));
await writeFile(join(output,reload?'reload-effects.json':'effects-trace.json'),JSON.stringify(effectTrace,null,2));
const rows=trace as Array<{frame:number;diagnostics:Array<{data:number[];actor:{world:number[];grid:number[]}|null;player:{world:number[];grid:number[]}|null}>}>;
const visible=rows.flatMap(row=>row.diagnostics.filter(d=>d.data[10]===1));
if(!visible.length || (!reload && (!visible.some(d=>d.player && d.player.grid[2]<100) || !visible.some(d=>d.player && d.player.grid[2]>100))))throw new Error('Missing visible outdoor/indoor follower; inspect trace');
if(!reload && !rows.some(row=>row.frame>=1500 && row.frame<1800 && row.diagnostics.some(d=>d.data[4]>=1)))throw new Error('Menu recall was not observed');
const savedLength=core._savGetSize(),savedPointer=core._savGetPointer(savedLength);
if(!reload){const saved=Buffer.from(core.HEAPU8.buffer,savedPointer,savedLength);await writeFile(join(output,'after-test.dsv'),saved);await writeFile(join(output,'after-test.sav'),saved.subarray(0,524288));}
console.log(JSON.stringify({visibleSamples:visible.length,outdoorAndIndoor:!reload,menuRecall:!reload,reload}));
console.log(`Captures: ${output}`);
