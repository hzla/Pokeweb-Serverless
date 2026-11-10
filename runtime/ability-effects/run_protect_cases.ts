/** Headless desmume-wasm runner for the hit-through-protection fixtures.
 * Requires fixtures built with the emulator-only log:
 *   ABILITY_PROTECT_TEST=1 python3 runtime/ability-effects/build.py --protect-only   (in a disposable checkout)
 *   npx vite-node runtime/ability-effects/build_scoped_cases.ts CLEAN_W2.nds OUT --protect
 *   npx vite-node runtime/ability-effects/build_bw1_cases.ts ... OUT --protect
 * then: npx vite-node runtime/ability-effects/run_protect_cases.ts OUT [--only=label,...]
 * The fixture inputs are read-only; screenshots go to OUT/protect-evidence/. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {runLoggedBattle,type LogEntry as Entry} from "./battle_log_runner";

const [directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: FIXTURE_DIRECTORY [--only=a,b]");
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
const manifest=JSON.parse(await readFile(`${directory}/cases.json`,"utf8"));
const evidence=`${directory}/protect-evidence/`;await mkdir(evidence,{recursive:true});
const shots=process.argv.includes("--shots"),frames=Number(process.argv.find(a=>a.startsWith("--frames="))?.slice(9)??5200);
const run=(spec:any)=>runLoggedBattle(directory,spec,{tag:"PRTL",frames,shots,evidence});

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
