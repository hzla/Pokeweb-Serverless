/** Headless desmume-wasm runner for the hit-through-protection fixtures.
 * Requires fixtures built with the emulator-only log:
 *   ABILITY_PROTECT_TEST=1 python3 runtime/ability-effects/build.py --protect-only   (in a disposable checkout)
 *   npx vite-node runtime/ability-effects/build_scoped_cases.ts CLEAN_W2.nds OUT --protect
 *   npx vite-node runtime/ability-effects/build_bw1_cases.ts ... OUT --protect
 * then: npx vite-node runtime/ability-effects/run_protect_cases.ts OUT [--only=label,...]
 * The fixture inputs are read-only; screenshots go to OUT/protect-evidence/. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {PNG} from "pngjs";
import {toDesmumeDsv} from "../../src/pokeweb/testBattle";

const [directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: FIXTURE_DIRECTORY [--only=a,b]");
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
const manifest=JSON.parse(await readFile(`${directory}/cases.json`,"utf8"));
const evidence=`${directory}/protect-evidence/`;await mkdir(evidence,{recursive:true});
const corePath=fileURLToPath(new URL("../../public/desmond/desmond.js",import.meta.url)),generated=await readFile(corePath,"utf8");
type Entry={event:number;a:number;d:number;x:number;move:number;y:number;value:number};
const shots=process.argv.includes("--shots");
const A=128,B=64,frames=Number(process.argv.find(a=>a.startsWith("--frames="))?.slice(9)??5200);

async function run(spec:any):Promise<{entries:Entry[];frames:number}>{
 let ready!:()=>void;const initialized=new Promise<void>(r=>ready=r);
 const context=vm.createContext({Module:{noInitialRun:true,onRuntimeInitialized:ready},require:createRequire(import.meta.url),process,Buffer,URL,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance,wasmReady(){},__dirname:fileURLToPath(new URL("../../public/desmond",import.meta.url)),__filename:corePath,console:{log(){},warn(){},error(){},info(){},debug(){}}});
 vm.runInContext(generated.slice(generated.indexOf("var Module=typeof Module")),context);await initialized;
 const core=context.Module;core._main(0,0);
 const rom=new Uint8Array(await readFile(`${directory}/${spec.rom}`)),save=toDesmumeDsv(new Uint8Array(await readFile(`${directory}/saves/${spec.label}.sav`)));
 const size=Math.max(rom.length,128*1024*2**rom[0x14]!),ptr=core._prepareRomBuffer(size);core.HEAPU8.set(rom,ptr);core.HEAPU8.fill(255,ptr+rom.length,ptr+size);
 core.HEAPU8.set(save,core._savGetPointer(save.length));core._savUpdateChangeFlag();
 if(core._loadROM(size)!==1)throw new Error("ROM rejected");
 const ram=()=>Buffer.from(core.HEAPU8.buffer,core._getSymbol(7)>>>0,0x400000);
 const read=():Entry[]=>{
  const m=ram(),hits:Entry[][]=[];
  for(let at=m.indexOf(Buffer.from("PRTL"));at>=0;at=m.indexOf(Buffer.from("PRTL"),at+4)){
   // The DLL's code also contains the tag; a live log starts with a move start.
   const total=m.readUInt32LE(at+4);if(!total||total>100000||m[at+8]!==3)continue;
   const count=Math.min(total,20),list:Entry[]=[];
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
  if(log&&playerMoves>=turns&&log.filter(e=>e.event===3).length>=(spec.battleType==="Doubles"?4:2)*turns){/* every battler acted */ frame+=600;for(let k=0;k<600;++k)core._runFrame(1,frame%12<3?A:0,0,0,0);break;}
  let keys=0,touch:[number,number]|undefined;
  // BW1 fixtures start the battle by talking to the trainer; A also picks
  // move 1, which every multi-turn case uses first.
  if(turnMove&&started){
   // Choose the move for the next turn by touch: Fight, then the move slot.
   const choice=turnMove[Math.min(playerMoves,turnMove.length-1)],phase=frame%300;
   if(phase>=100&&phase<104)touch=[128,85];
   if(phase>=180&&phase<184)touch=[choice%2===0?64:192,choice<2?44:115];
   // B advances messages without choosing anything; menus are chosen by touch.
   if(phase<90&&frame%12<3)keys=B;
  }else if(frame%12<3)keys=A;
  core._runFrame(1,keys,touch?1:0,touch?.[0]??0,touch?.[1]??0);
  if(frame===1500)await capture("f1500");
  if(shots&&frame>=600&&frame%30===0)await capture(`s${frame}`);
 }
 await capture("end");
 return {entries:read(),frames:frame};
}

/** Holder's move uses from the log: each starts at event 3 and lists its checks and hits. */
function uses(entries:Entry[],user:number){
 const out:Array<{move:number;bypass?:number;paused:number;stages:Entry[];hits:Entry[]}>=[];let current:typeof out[number]|undefined,owner=-1;
 for(const e of entries){
  if(e.event===3){owner=e.a;current=e.a===user?{move:e.move,paused:0,stages:[],hits:[]}:undefined;if(current)out.push(current);continue;}
  if(!current||owner!==user)continue;
  if(e.event===0x2e&&e.a===user)current.bypass=e.value;
  if(e.event===0x2c&&e.a===user)current.paused+=e.x;
  if(e.event===0x47&&e.a===user)current.stages.push(e);
  if(e.event===0x4b&&e.a===user)current.hits.push(e);
 }
 return out;
}
function check(spec:any,entries:Entry[]):string[]{
 const c=spec.checks.protect,errors:string[]=[];
 const expect=(name:string,use:ReturnType<typeof uses>[number]|undefined,want:any,user:number)=>{
  if(!use){errors.push(`${name}: holder move not found`);return;}
  // Battle IDs: player party 0-5 (doubles ally 1), opponent party 6-11.
  const side=(id:number)=>id<6?0:1,opposing=use.stages.filter(s=>side(s.d)!==side(user)),allyTargets=use.stages.filter(s=>side(s.d)===side(user)&&s.d!==user);
  if(want.blocked){if(opposing.length||use.hits.some(h=>side(h.d)!==side(user)))errors.push(`${name}: expected blocked, got ${JSON.stringify(use)}`);return;}
  if(want.bypass!==undefined&&use.bypass!==want.bypass)errors.push(`${name}: protect-break ${use.bypass} != ${want.bypass}`);
  if(want.paused&&!use.paused)errors.push(`${name}: guard items were not paused`);
  if(want.noDamageStage){if(use.stages.length)errors.push(`${name}: fixed damage reached the damage stage`);}
  else if(want.multiplier!==undefined){const targets=opposing;if(!targets.length||targets.some(s=>s.value!==want.multiplier))errors.push(`${name}: multipliers ${JSON.stringify(targets.map(s=>s.value))} != ${want.multiplier}`);}
  if(want.protected!==undefined&&use.stages.some(s=>s.y!==want.protected))errors.push(`${name}: protected flag ${JSON.stringify(use.stages.map(s=>s.y))}`);
  if(want.allyMultiplier!==undefined&&allyTargets.some(s=>s.value!==want.allyMultiplier))errors.push(`${name}: ally multipliers ${JSON.stringify(allyTargets.map(s=>s.value))}`);
  if(want.damage!==undefined&&!use.hits.some(h=>h.value===want.damage))errors.push(`${name}: damage ${JSON.stringify(use.hits.map(h=>h.value))} != ${want.damage}`);
  if(!use.hits.some(h=>side(h.d)!==side(user)))errors.push(`${name}: no damage dealt`);
 };
 const opponent=entries.find(e=>e.event===3&&e.a>=6)?.a??6,player=uses(entries,0),enemy=uses(entries,opponent);
 if(c.first)expect("first",player.find(u=>u.move===(spec.playerMoves?.[0]??spec.move)),c.first,0);
 if(c.enemy)expect("enemy",enemy[0],c.enemy,6);
 if(c.enemySecond)expect("enemySecond",enemy[1],c.enemySecond,6);
 return errors;
}

const results=[];let failed=0;
for(const spec of manifest.cases){
 if(only&&!only.includes(spec.label.replace(/^\d+-/u,"")))continue;
 const started=Date.now(),{entries,frames:used}=await run(spec),errors=check(spec,entries);
 if(errors.length)failed++;
 results.push({label:spec.label,passed:!errors.length,errors,frames:used,entries});
 console.log(`${errors.length?"FAIL":"ok  "} ${spec.label} (${used} frames, ${((Date.now()-started)/1000).toFixed(0)} s)${errors.length?"\n     "+errors.join("\n     "):""}`);
}
await writeFile(`${evidence}results.json`,JSON.stringify(results,null,1));
console.log(`${results.length-failed}/${results.length} protection cases passed.`);
if(failed)process.exitCode=1;
