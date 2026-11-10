/** Headless runner for the simulated move weather (Mega Sol) fixtures.
 * Requires fixtures built with the emulator-only log:
 *   ABILITY_WEATHER_TEST=1 python3 runtime/ability-effects/build.py --weather-moves-only   (in a disposable checkout)
 *   npx vite-node runtime/ability-effects/build_scoped_cases.ts CLEAN_W2.nds OUT --weather-moves
 *   npx vite-node runtime/ability-effects/build_bw1_cases.ts CLEAN_B_OR_W.nds OUT --weather-moves
 * then: npx vite-node runtime/ability-effects/run_weather_cases.ts OUT [--only=label,...] [--frames=9000] */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {runLoggedBattle,type LogEntry} from "./battle_log_runner";

const [directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: FIXTURE_DIRECTORY [--only=a,b]");
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
const manifest=JSON.parse(await readFile(`${directory}/cases.json`,"utf8"));
const evidence=`${directory}/weather-evidence/`;await mkdir(evidence,{recursive:true});
const shots=process.argv.includes("--shots"),frames=Number(process.argv.find(a=>a.startsWith("--frames="))?.slice(9)??9000);

/** Move uses: event 3 (x = simulated weather in effect), then damage stages (x = resolved type) and hits. */
function uses(entries:LogEntry[],user:number){
 const out:Array<{move:number;scope:number;types:number[];hits:number}>=[];let current:typeof out[number]|undefined;
 for(const e of entries){
  if(e.event===3){current=e.a===user?{move:e.move,scope:e.x,types:[],hits:0}:undefined;if(current)out.push(current);continue;}
  if(!current)continue;
  if(e.event===0x47&&e.a===user)current.types.push(e.x);
  if(e.event===0x4b&&e.a===user)current.hits++;
 }
 return out;
}
function check(spec:any,entries:LogEntry[]):string[]{
 const c=spec.checks.weather,errors:string[]=[];
 const opponent=entries.find(e=>e.event===3&&e.a>=6)?.a??12;
 if(c.player){
  const use=uses(entries,0)[0];
  if(!use)errors.push("player move not found");
  else{
   if(c.player.scope!==undefined&&use.scope!==c.player.scope)errors.push(`simulated weather ${use.scope} != ${c.player.scope}`);
   if(c.player.type!==undefined&&(!use.types.length||use.types.some(t=>t!==c.player.type)))errors.push(`move types ${JSON.stringify(use.types)} != ${c.player.type}`);
   if(c.player.hitFirstUse!==undefined&&(use.hits>0)!==c.player.hitFirstUse)errors.push(`first use hits ${use.hits}, expected ${c.player.hitFirstUse?"a hit":"no hit"}`);
  }
 }
 if(c.enemy){
  const use=uses(entries,opponent)[0];
  if(!use)errors.push("opponent move not found");
  else if(!use.types.length||use.types.some(t=>t!==c.enemy.type)||use.scope!==0)errors.push(`opponent types ${JSON.stringify(use.types)} scope ${use.scope}`);
 }
 if(c.noWeatherDamage){
  if(entries.filter(e=>e.event===3).length<4)errors.push("fewer than two turns observed");
  // The end-of-turn weather check runs every turn; it must see no weather and deal no damage.
  const residual=entries.filter(e=>e.event===0x7f);
  if(!residual.length)errors.push("end-of-turn weather check not observed");
  if(residual.some(e=>e.x!==0||e.value!==0))errors.push(`weather damage observed: ${JSON.stringify(residual)}`);
 }
 return errors;
}
const results=[];let failed=0;
for(const spec of manifest.cases){
 if(only&&!only.includes(spec.label.replace(/^\d+-/u,"")))continue;
 const started=Date.now(),{entries,frames:used}=await runLoggedBattle(directory,spec,{tag:"WTRL",frames,shots,evidence}),errors=check(spec,entries);
 if(errors.length)failed++;
 results.push({label:spec.label,passed:!errors.length,errors,frames:used,entries});
 console.log(`${errors.length?"FAIL":"ok  "} ${spec.label} (${used} frames, ${((Date.now()-started)/1000).toFixed(0)} s)${errors.length?"\n     "+errors.join("\n     "):""}`);
}
await writeFile(`${evidence}results.json`,JSON.stringify(results,null,1));
console.log(`${results.length-failed}/${results.length} weather cases passed.`);
if(failed)process.exitCode=1;
