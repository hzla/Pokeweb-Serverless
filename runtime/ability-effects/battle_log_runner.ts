/** Shared headless desmume-wasm driver for battle fixtures that carry an
 * emulator-only evidence log (a tagged 20-entry table in the ability DLL).
 * Used by run_protect_cases.ts and run_weather_cases.ts. Inputs are read-only. */
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {PNG} from "pngjs";
import { getTestBattleConfig, refreshTestBattleSaveBlockChecksum, testBattleScriptIdForTrainer, toDesmumeDsv } from "../../src/pokeweb/testBattle";
import type { BaseRom } from "../../src/pokeweb/constants";
import { readU16, readU32, writeU16, writeU32 } from "../../src/nds/binary";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";

export type LogEntry={event:number;a:number;d:number;x:number;move:number;y:number;value:number};
export type RunOptions={tag:string;frames:number;shots:boolean;evidence?:string;logCapacity?:number;texts?:readonly string[];observeMemory?:(memory:Buffer)=>void;sampleMemory?:(memory:Buffer)=>void};
type BattleResult={entries:LogEntry[];frames:number;seenTexts:string[]};
const A=128;

/** The ordinary overworld double-battle script expects two actors with
 * the same trainer script ID. Add its partner to the ROM and its saved map. */
export function addDoubleTrainerPartner(romBytes: Uint8Array, base: NintendoDSRom, save: Uint8Array, game: BaseRom, trainerId: number): Uint8Array {
 const config = getTestBattleConfig(game), script = testBattleScriptIdForTrainer(trainerId);
 const fixture = new NintendoDSRom(romBytes,{fileData:"view"}), path = config.paths.overworlds;
 const archive = new NARC(fixture.getFileByName(path)), original = new NARC(base.getFileByName(path));
 let partners = 0;
 for (const [i, bytes] of archive.files.entries()) {
  if (bytes.length !== original.files[i].length+36) continue;
  const end = 8+bytes[4]*20+bytes[5]*36, partner = bytes.slice(end-36,end);
  if (readU16(partner,10)!==script) continue;
  writeU16(partner,0,readU16(partner,0)+1);writeU16(partner,28,readU16(partner,28)+1);
  const expanded = new Uint8Array(bytes.length+36);
  expanded.set(bytes.subarray(0,end));expanded.set(partner,end);expanded.set(bytes.subarray(end),end+36);
  expanded[5]++;writeU32(expanded,0,readU32(bytes,0)+36);archive.files[i]=expanded;partners++;
 }
 if (!partners) throw Error("Double-trainer field partner fixture missing.");
 for (const half of [0,config.saveLayout.saveHalfOffset]) {
  const slots = Array.from({length:64},(_,n)=>half+0x1e200+n*80);
  const first = slots.find(at=>(readU32(save,at)&1)&&readU16(save,at+24)===script);
  const free = slots.find(at=>!(readU32(save,at)&1));
  if (first===undefined||free===undefined) throw Error("Double-trainer actor slot missing.");
  save.set(save.slice(first,first+80),free);save[free+8]=save[first+8]+1;
  for (const field of [32,38]) writeU16(save,free+field,readU16(save,first+field)+1);
  refreshTestBattleSaveBlockChecksum(save,config.saveLayout,half,0x1e200,0x1400,0x1f602,41);
 }
 return fixture.save({files:new Map([[fixture.fileId(path),archive.save()]]),preserveOriginalLength:true});
}

export async function runLoggedBattle(directory:string,spec:any,options:RunOptions):Promise<BattleResult>{
 const rom=new Uint8Array(await readFile(`${directory}/${spec.rom}`));
 const save=new Uint8Array(await readFile(`${directory}/saves/${spec.label}.sav`));
 return runLoggedBattleBytes(rom,save,spec,options);
}

export async function runLoggedBattleBytes(rom:Uint8Array,rawSave:Uint8Array,spec:any,options:RunOptions):Promise<BattleResult>{
 const {tag,frames,shots,evidence}=options;
 const corePath=fileURLToPath(new URL("../../public/desmond/desmond.js",import.meta.url)),generated=await readFile(corePath,"utf8");
 let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r);
 const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:corePath,console:{log(){},warn(){},error(){},info(){},debug(){}}});
 vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")),context);await initialized;
 const core=context.Module;core._main(0,0);
 const save=toDesmumeDsv(rawSave);
 const size=Math.max(rom.length,128*1024*2**rom[0x14]!),ptr=core._prepareRomBuffer(size);core.HEAPU8.set(rom,ptr);core.HEAPU8.fill(255,ptr+rom.length,ptr+size);
 core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();
 if(core._loadROM(size)!==1)throw new Error("ROM rejected");
 const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
 const pendingTexts=new Map(options.texts?.map(text=>[text,Buffer.from(text,"utf16le")]));
 const seenTexts:string[]=[];
 const readTexts=()=>{
  if(!pendingTexts.size)return;
  const memory=ram();
  for(const [text,bytes] of pendingTexts)if(memory.includes(bytes)){seenTexts.push(text);pendingTexts.delete(text);}
 };
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
 const capture=async(name:string)=>{if(!evidence)return;const fb=core._getSymbol(4)>>>0,png=new PNG({width:256,height:384});png.data=Buffer.from(core.HEAPU8.subarray(fb,fb+256*384*4));await writeFile(`${evidence}${spec.label}-${name}.png`,PNG.sync.write(png));};
 const turnMove:number[]|undefined=spec.turnMove,turns=spec.menuCount??1;
 let frame=0,started=false;
 for(;frame<frames;++frame){
  const sample=frame%30===0;
  const log=sample?read():undefined;
  if(sample){readTexts();options.sampleMemory?.(ram());}
  if(log?.length)started=true;
  const playerMoves=log?log.filter(e=>e.event===3&&e.a===0).length:0;
  if(log&&playerMoves>=turns&&log.filter(e=>e.event===3).length>=(spec.battleType==="Doubles"?4:2)*turns){/* every battler acted */ frame+=600;for(let k=0;k<600;++k){core._runFrame(1,(frame+k)%12<3?A:0,0,0,0);if(k%30===0)readTexts();}break;}
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
 options.observeMemory?.(ram());
 return {entries:read(),frames:frame,seenTexts};
}

