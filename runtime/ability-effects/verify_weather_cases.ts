/** Verify native weather fixtures, editable exports and source/evidence hashes. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,readdir,writeFile} from "node:fs/promises";
import {resolve,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {NintendoDSRom} from "../../src/nds/rom";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {ABILITY_EFFECTS_DLL_PATH,inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
import {abilityImport} from "../../src/pokeweb/abilityLibrary";
import {parseRpm} from "../../src/pokeweb/rpm";

const directories=process.argv.slice(2).map(p=>resolve(p));assert.equal(directories.length,2,"Usage: MAIN_COHORT CLIENT_COHORT");
const root=fileURLToPath(new URL("../..",import.meta.url)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const cohorts=[],minimum:Record<string,number>={};let total=0;
for(const out of directories){
 const m=JSON.parse(await readFile(`${out}/cases.json`,"utf8")),results=[];
 for(const[file,digest]of Object.entries({...m.romHashes,"weather-guard.nds":m.exportSha256,"weather-guard-edited.nds":m.editedSha256,"weather-guard-reloaded.nds":m.reexportSha256}))assert.equal(sha(await readFile(`${out}/${file}`)),digest);
 for(const[file,weather]of [["weather-guard-edited.nds",4],["weather-guard-reloaded.nds",3]]as const){
  const bytes=new Uint8Array(await readFile(`${out}/${file}`)),project=await loadProjectFromRomBytes(bytes,file,{selectedNarcs:["personal","items","message_texts","moves"]});
  const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,m.editedAbilities);
  assert.equal(state.rules.get(166)?.effects[0].parameters?.weather,weather);
  assert.deepEqual(state.rules.get(165)?.effects.slice(0,2).map(e=>[e.kind,e.value]),[["speed",2],["abilityRecipe:weatherGuard",1]]);
  const rom=new NintendoDSRom(bytes,{fileData:"view"}),dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});
  assert.equal(dll.metadata.PokewebAbilityWeatherGuard,1);assert.equal(dll.metadata.PokewebAbilityClientTraps,m.weatherClient?1:undefined);
 }
 for(const spec of m.cases){
  assert.equal(sha(await readFile(`${out}/saves/${spec.label}.sav`)),spec.saveSha256);
  const r=JSON.parse(await readFile(`${out}/${spec.label}-result.json`,"utf8"));assert.equal(r.passed,true);assert.equal(r.romSha256,m.romHashes[spec.rom]);assert.equal(r.menus.length,3);
  assert.equal(r.loader.abilityPatchRecords,1);assert.equal(r.loader.liveRuleCount,m.editedAbilities);
  const hp=r.menus.map((s:{hp:number})=>s.hp),immune=spec.checks.noWeatherDamage;
  if(immune)assert.deepEqual(hp,[120,120,120]);if(spec.checks.hpByTurn)assert.deepEqual(hp,spec.checks.hpByTurn);
  if(spec.checks.multiplier)assert(r.multipliers.some((v:{value:number})=>v.value===spec.checks.multiplier));
  if(spec.checks.rewrite)assert(r.rewrites.some((v:{key:number;value:number;owner:number})=>v.key===65&&v.value===1&&v.owner===0));
  for(const[name,stats]of Object.entries(r.minimumObservedFree)as Array<[string,{freePayloadBytes:number}]>)minimum[name]=Math.min(minimum[name]??Infinity,stats.freePayloadBytes);
  results.push({label:spec.label,hp,abilityPatchRecords:r.loader.abilityPatchRecords});
 }
 total+=results.length;cohorts.push({directory:relative(root,out),weatherClient:m.weatherClient,cases:results,codeBytes:m.codeBytes,bssBytes:m.bssBytes,serializedBytes:m.serializedBytes,legacy:m.legacy});
}
assert.equal(total,17);assert.deepEqual(cohorts.map(c=>c.weatherClient),[false,true]);assert.equal(abilityImport(202).rule.effects.length,1);
const main=directories[0],tests=await readFile(`${main}/tests.log`,"utf8"),pmc=await readFile(`${main}/pmc-tests.log`,"utf8"),production=await readFile(`${main}/production.log`,"utf8");
const count=(log:string)=>{const m=log.match(/Tests\s+(\d+) passed \(\1\)/u);assert(m);assert(!/FAIL|failed/u.test(log));return Number(m[1]);};
let committedTests="";try{committedTests=await readFile(`${main}/committed-tests.log`,"utf8");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
const automatedTests=committedTests?count(committedTests):count(tests)+count(pmc);assert(production.includes("✓ built in"));
if(committedTests)assert((await readFile(`${main}/committed-production.log`,"utf8")).includes("✓ built in"));
const gui=JSON.parse(await readFile(`${main}/gui.json`,"utf8"));assert.equal(gui.state,"Custom effects · Shared DLL");assert.equal(gui.weather,"3");assert.equal(gui.speed,"2");
const assets=(await readdir(`${root}/src/assets/data`)).filter(p=>/^abilityRuleRuntime.*\.json$/u.test(p));
const legacyTemplates:Record<string,string>={};
for(const name of assets.filter(p=>!p.endsWith("Weather.json"))){const p=`src/assets/data/${name}`,bytes=await readFile(`${root}/${p}`);assert.deepEqual(bytes,execFileSync("git",["show",`HEAD:${p}`],{cwd:root}));legacyTemplates[p]=sha(bytes);}
assert.equal(Object.keys(legacyTemplates).length,10);
const paths=["runtime/ability-effects/rules.c","runtime/ability-effects/recipes.c","runtime/ability-effects/library.c","runtime/ability-effects/client_traps.c","runtime/ability-effects/build.py","runtime/ability-effects/build_weather_cases.ts","runtime/ability-effects/emulator.py","runtime/ability-effects/verify_weather_cases.ts","src/pokeweb/abilityEffectsModel.ts","src/pokeweb/abilityRecipeEffects.ts","src/pokeweb/abilityRules.ts","src/ui/itemRuleEditor.ts","src/test/abilityWeatherGuard.test.ts",...assets.map(p=>`src/assets/data/${p}`)];
const source=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(`${root}/${p}`))])));
const evidence:Record<string,string>={};for(const out of directories)for(const name of(await readdir(out)).filter(p=>/\.json$|\.png$|\.log$/u.test(p)&&p!=="receipt.json"))evidence[`${relative(root,out)}/${name}`]=sha(await readFile(`${out}/${name}`));
const summary={nativeCases:total,completedTurns:total*2,automatedTests,oneSharedAbilityDll:true,minimumObservedFree:minimum,cohorts};
await writeFile(`${main}/receipt.json`,JSON.stringify({summary,source,evidence,legacyTemplates},null,2)+"\n");
const table=cohorts.flatMap(c=>c.cases.map(r=>`| ${r.label}${c.weatherClient?" (client adapter)":""} | ${r.hp.join(" → ")} |`)).join("\n");
console.log(JSON.stringify({nativeCases:total,completedTurns:total*2,automatedTests,minimumObservedFree:minimum},null,2));
