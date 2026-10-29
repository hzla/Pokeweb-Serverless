/** Verify a complete native popup cohort and seal its source/evidence hashes. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,writeFile} from "node:fs/promises";
import {resolve,relative} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {parseRpm} from "../../src/pokeweb/rpm";

const directory=process.argv[2];if(!directory)throw new Error("Usage: EVIDENCE_DIRECTORY");
const root=resolve(new URL("../..",import.meta.url).pathname),out=resolve(directory),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const manifest=JSON.parse(await readFile(`${out}/cases.json`,"utf8"));
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
for(const[file,digest]of Object.entries({...manifest.romHashes,"ability-popup.nds":manifest.exportSha256,"ability-popup-reloaded.nds":manifest.reexportSha256}))assert.equal(sha(await readFile(`${out}/${file}`)),digest);
const bytes=new Uint8Array(await readFile(`${out}/ability-popup-reloaded.nds`)),project=await loadProjectFromRomBytes(bytes,"ability-popup.nds",{selectedNarcs:["personal","items","message_texts","moves"]});
const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,manifest.editedAbilities);
assert.deepEqual(state.rules.get(166)?.effects.map(e=>[e.kind,e.value]),[["defense",1.2],["speed",.8]]);
const rom=new NintendoDSRom(bytes,{fileData:"view"}),dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});assert.equal(dll.metadata.PokewebAbilityPopupGroups,1);
assert.equal(dll.code.length,manifest.codeBytes);assert.equal(dll.bssSize,manifest.bssBytes);
const minimum:Record<string,number>={},results=[];
for(const spec of manifest.cases){
 assert.equal(sha(await readFile(`${out}/saves/${spec.label}.sav`)),spec.saveSha256);
 const result=JSON.parse(await readFile(`${out}/${spec.label}-result.json`,"utf8"));assert.equal(result.passed,true);assert.equal(result.romSha256,manifest.romHashes[spec.rom]);
 assert.equal(result.loader.abilityPatchRecords,1);assert.equal(result.loader.liveRuleCount,manifest.editedAbilities);assert.equal(result.menus.length,3);
 for(const command of[2,3])assert.deepEqual(spec.checks.popupsByTurn,result.menus.map((_:unknown,i:number)=>result.popups.filter((p:{command:number;turnIndex:number})=>p.command===command&&p.turnIndex===i).length));
 for(const[name,stats]of Object.entries(result.minimumObservedFree)as Array<[string,{freePayloadBytes:number}]>)minimum[name]=Math.min(minimum[name]??Infinity,stats.freePayloadBytes);
 results.push({label:spec.label,popupsByTurn:spec.checks.popupsByTurn,stages:result.menus.map((m:{stages:number[]})=>m.stages),abilityPatchRecords:result.loader.abilityPatchRecords});
}
const tests=await readFile(`${out}/tests.log`,"utf8"),pmc=await readFile(`${out}/pmc-tests.log`,"utf8"),production=await readFile(`${out}/production.log`,"utf8");
const count=(text:string)=>{const match=text.match(/Tests\s+(\d+) passed \(\1\)/u);assert(match);assert(!/FAIL|failed/u.test(text));return Number(match[1]);};
const automatedTests=count(tests)+count(pmc);assert(production.includes("✓ built in"));
const sourcePaths=["runtime/ability-effects/rules.c","runtime/ability-effects/recipes.c","runtime/ability-effects/library.c","runtime/ability-effects/client_traps.c","runtime/ability-effects/build.py","runtime/ability-effects/build_popup_cases.ts","runtime/ability-effects/emulator.py","runtime/ability-effects/verify_popup_cases.ts","src/pokeweb/abilityEffectsModel.ts","src/pokeweb/abilityRules.ts","src/pokeweb/itemRules.ts","src/ui/itemRuleEditor.ts","src/test/abilityPopupGroups.test.ts",...(await readdir(`${root}/src/assets/data`)).filter(p=>/^abilityRuleRuntime.*\.json$/u.test(p)).map(p=>`src/assets/data/${p}`),...(await readdir(`${root}/src/test/fixtures/ability-popup-legacy`)).filter(p=>p.endsWith(".dll")).map(p=>`src/test/fixtures/ability-popup-legacy/${p}`)];
const source=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(`${root}/${p}`))])));
const evidence=Object.fromEntries(await Promise.all((await readdir(out)).filter(p=>/\.json$|\.png$|\.log$/u.test(p)&&p!=="receipt.json").map(async p=>[p,sha(await readFile(`${out}/${p}`))])));
const summary={nativeCases:results.length,completedTurns:results.length*2,automatedTests,editedAbilities:manifest.editedAbilities,oneSharedAbilityDll:true,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:manifest.serializedBytes,minimumObservedFree:minimum,projectAndRomReload:true,legacy:manifest.legacy};
await writeFile(`${out}/receipt.json`,JSON.stringify({summary,source,evidence,romHashes:manifest.romHashes,results},null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
