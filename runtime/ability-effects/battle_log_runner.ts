/** Shared headless desmume-wasm driver for battle fixtures that carry an
 * emulator-only evidence log (a tagged 20-entry table in the ability DLL).
 * Used by run_protect_cases.ts and run_weather_cases.ts. Inputs are read-only. */
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {PNG} from "pngjs";
import {toDesmumeDsv} from "../../src/pokeweb/testBattle";

export type LogEntry={event:number;a:number;d:number;x:number;move:number;y:number;value:number};
export type RunOptions={tag:string;frames:number;shots:boolean;evidence:string;logCapacity?:number};
const A=128;

export async function runLoggedBattle(directory:string,spec:any,options:RunOptions):Promise<{entries:LogEntry[];frames:number}>{
 const {tag,frames,shots,evidence}=options;
 const corePath=fileURLToPath(new URL("../../public/desmond/desmond.js",import.meta.url)),generated=await readFile(corePath,"utf8");
 let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r);
 const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:corePath,console:{log(){},warn(){},error(){},info(){},debug(){}}});
 vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")),context);await initialized;
 const core=context.Module;core._main(0,0);
 const rom=new Uint8Array(await readFile(`${directory}/${spec.rom}`)),save=toDesmumeDsv(new Uint8Array(await readFile(`${directory}/saves/${spec.label}.sav`)));
 const size=Math.max(rom.length,128*1024*2**rom[0x14]!),ptr=core._prepareRomBuffer(size);core.HEAPU8.set(rom,ptr);core.HEAPU8.fill(255,ptr+rom.length,ptr+size);
 core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();
 if(core._loadROM(size)!==1)throw new Error("ROM rejected");
 const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
 const read=():LogEntry[]=>{
  const m=ram(),hits:LogEntry[][]=[];
  for(let at=m.indexOf(Buffer.from(tag));at>=0;at=m.indexOf(Buffer.from(tag),at+4)){
   // The DLL's code also contains the tag; a live log starts with a move start.
   const total=m.readUInt32LE(at+4);if(!total||total>100000||m[at+8]!==3)continue;
   const count=Math.min(total,options.logCapacity??20),list:LogEntry[]=[];
   for(let n=0;n<count;++n){const e=at+8+n*12;list.push({event:m[e],a:m[e+1],d:m[e+2],x:m[e+3],move:m.readUInt16LE(e+4),y:m.readUInt16LE(e+6),value:m.readUInt32LE(e+8)});}
   hits.push(list);
  }
  return hits.sort((p,q)=>q.length-p.length)[0]??[];
 };
 const capture=async(name:string)=>{const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await writeFile(`${evidence}${spec.label}-${name}.png`,PNG.sync.write(png));};
 const turnMove:number[]|undefined=spec.turnMove,turns=spec.menuCount??1;
 let frame=0,started=false;
 for(;frame<frames;++frame){
  const log=frame%30===0?read():undefined;
  if(log?.length)started=true;
  const playerMoves=log?log.filter(e=>e.event===3&&e.a===0).length:0;
  if(log&&playerMoves>=turns&&log.filter(e=>e.event===3).length>=(spec.battleType==="Doubles"?4:2)*turns){/* every battler acted */ frame+=600;for(let k=0;k<600;++k)core._runFrame(1,(frame+k)%12<3?A:0,0,0,0);break;}
  let keys=0,touch:[number,number]|undefined;
  // BW1 fixtures start the battle by talking to the trainer; A also picks
  // move 1, which every multi-turn case uses first.
  if(turnMove&&started){
   // Choose the move for the next turn by touch: Fight, then the move slot.
   const choice=turnMove[Math.min(playerMoves,turnMove.length-1)],phase=frame%300;
   if(phase>=100&&phase<104)touch=[128,85];
   if(phase>=180&&phase<184)touch=[choice%2===0?64:192,choice<2?44:115];
   if(phase>=250&&phase<254)touch=[192,60]; // right opponent
   if(phase>=270&&phase<274)touch=[192,115]; // ally self-targeting moves
   if(phase>=285&&phase<289)touch=[64,115]; // holder self-targeting moves
   // Confirm after offering each legal target position.
   if(phase>=295&&phase<299)keys=A;
  }else if(frame%12<3)keys=A;
  core._runFrame(1,keys,touch?1:0,touch?.[0]??0,touch?.[1]??0);
  if(frame===1500)await capture("f1500");
  if(shots&&frame>=600&&frame%30===0)await capture(`s${frame}`);
 }
 await capture("end");
 return {entries:read(),frames:frame};
}

