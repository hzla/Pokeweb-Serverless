/** Verify native receipts plus editable registry persistence against the final catalog. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
const [directory,original,...previous]=process.argv.slice(2);if(!original)throw new Error("Usage: EVIDENCE_DIRECTORY ORIGINAL.nds [PREVIOUS_EXPORT.nds ...]");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"ability-recipes.nds",{selectedNarcs:["personal","message_texts"]});
const m=JSON.parse(await readFile(`${directory}/cases.json`,"utf8")),results=[];
assert.equal(sha(await readFile(original)),m.inputSha256);
assert.equal(sha(await readFile(`${directory}/scare.nds`)),m.exportSha256);
assert.equal(sha(await readFile(`${directory}/scare-reloaded.nds`)),m.reexportSha256);
for(const[name,hash]of Object.entries(m.romHashes))assert.equal(sha(await readFile(`${directory}/${name}`)),hash);
for(const spec of m.cases){const r=JSON.parse(await readFile(`${directory}/${spec.label}-result.json`,"utf8"));assert(r.passed);assert.equal(r.abilityId,spec.abilityId);assert.equal(r.romSha256,m.romHashes[spec.rom]);assert.equal(r.loader.abilityPatchRecords,1);assert.equal(r.loader.liveRuleCount,m.editedAbilities);assert.equal(r.menus.length,3);
 if(spec.checks.noMultiplier2!==undefined)assert(r.multipliers.every((v:{value:number})=>v.value!==spec.checks.noMultiplier2));
 results.push(r);
}
let project=await load(new Uint8Array(await readFile(`${directory}/scare-reloaded.nds`)));
let state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,m.editedAbilities);
const rules=state.rules,overgrow=rules.get(168)!;assert.deepEqual(overgrow.effects[0].parameters,{hpThreshold:50,power:2.5,type:0});
const edits=[];
for(const parameters of [{type:17,hpThreshold:40,power:2.25},{type:0,hpThreshold:50,power:2.5}]){
 await configureAbilityRuleSets(project,[{abilityId:168,rules:{...overgrow,effects:[{...overgrow.effects[0],parameters}]}}]);
 for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];
 const bytes=await exportModifiedRom(project,{forDsi:false}),file=`recipe-edited-${edits.length}.nds`;await writeFile(`${directory}/${file}`,bytes,{flag:"wx"});project=await load(bytes);state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,rules.size);
 assert.deepEqual(state.rules.get(168)!.effects[0].parameters,parameters);assert.equal(project.texts.banks.abilities?.[168],"Last Stand");
 for(const[id,rule]of rules)if(id!==168)assert.deepEqual(state.rules.get(id),rule);
 edits.push({parameters,file,sha256:sha(bytes),editableAfterReload:true});
}
const previousExports=[];
for(const path of previous){const bytes=new Uint8Array(await readFile(path)),s=inspectAbilityEffects(await load(bytes));assert(s.editable,s.message);previousExports.push({sha256:sha(bytes),retainedRules:s.rules.size,canonicalModuleVerified:true});}
const minimum=Object.fromEntries(["bookkeeping","system"].map(key=>[key,Math.min(...results.map(r=>r.minimumObservedFree[key].freePayloadBytes))]));
const summary={passed:results.length,completedTurns:results.length*2,inputSha256:m.inputSha256,exportSha256:m.exportSha256,reexportSha256:m.reexportSha256,editedAbilities:m.editedAbilities,sharedAbilityDlls:1,codeBytes:m.codeBytes,bssBytes:m.bssBytes,serializedBytes:m.serializedBytes,projectReopen:m.projectReload,romExportReload:m.romExportReload,assignmentByName:m.assignmentByName,reloadedParameterEdits:edits,previousExports,minimumObservedFreePayload:minimum,cases:results.map(r=>({label:r.case,abilityId:r.abilityId,passed:true})),scope:"DS-mode melonDS cold boots; normal keypad input; read-only hooks; no game-service stubs or battle-state writes."};
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2)+"\n");console.log(JSON.stringify(summary,null,2));
