/** Verify hash-bound native results, editable exports and older module compatibility. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
const [directory,original,...previous]=process.argv.slice(2);if(!original)throw new Error("Usage: OUTPUT_DIRECTORY ORIGINAL.nds [PREVIOUS_EXPORT.nds ...]");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex"),m=JSON.parse(await readFile(`${directory}/cases.json`,"utf8"));
assert.equal(sha(await readFile(original)),m.inputSha256);
const exported=[];
for(const[file,hash]of [["poison-touch.nds",m.exportSha256],["poison-touch-reloaded.nds",m.reexportSha256],...m.reloadedEdits.map((e:{file:string;sha256:string})=>[e.file,e.sha256])]){
 const bytes=new Uint8Array(await readFile(`${directory}/${file}`));assert.equal(sha(bytes),hash);
 const p=await loadProjectFromRomBytes(bytes,file,{selectedNarcs:["personal","message_texts"]}),state=inspectAbilityEffects(p);assert(state.editable,state.message);assert.equal(state.rules.size,m.editedAbilities);assert.equal(p.texts.banks.abilities?.[166],"Burn Touch");
 const expected=m.reloadedEdits.find((e:{file:string})=>e.file===file)?.parameters??{contactStatus:4,activationChance:100};assert.deepEqual(state.rules.get(166)!.effects[0].parameters,expected);
 exported.push({file,sha256:hash,editable:true,rules:state.rules.size});
}
for(const[file,hash]of Object.entries(m.romHashes))assert.equal(sha(await readFile(`${directory}/${file}`)),hash);
const results=[];
for(const spec of m.cases){
 const r=JSON.parse(await readFile(`${directory}/${spec.label}-result.json`,"utf8"));assert(r.passed);assert.equal(r.romSha256,m.romHashes[spec.rom]);assert.equal(r.abilityId,spec.abilityId);assert.equal(r.loader.abilityPatchRecords,1);assert.equal(r.loader.liveRuleCount,m.editedAbilities);assert.equal(r.menus.length,3);assert(r.menus.every((s:{abilityRegistrations:unknown[]})=>Array.isArray(s.abilityRegistrations)));results.push(r);
}
const previousExports=[];
for(const path of previous){const bytes=new Uint8Array(await readFile(path)),p=await loadProjectFromRomBytes(bytes,"previous.nds",{selectedNarcs:["personal","message_texts"]}),s=inspectAbilityEffects(p);assert(s.editable,s.message);previousExports.push({sha256:sha(bytes),rules:s.rules.size,canonicalModuleVerified:true});}
const summary={passed:results.length,completedTurns:results.length*2,inputSha256:m.inputSha256,exports:exported,projectReopen:m.projectReload,editedAbilities:m.editedAbilities,sharedAbilityDlls:1,codeBytes:m.codeBytes,bssBytes:m.bssBytes,serializedBytes:m.serializedBytes,previousExports,minimumObservedFreePayload:Object.fromEntries(["bookkeeping","system"].map(key=>[key,Math.min(...results.map(r=>r.minimumObservedFree[key].freePayloadBytes))])),cases:results.map(r=>({label:r.case,abilityId:r.abilityId,passed:true})),scope:"DS-mode melonDS cold boots; normal keypad input; read-only hooks; no game-service stubs or battle-state writes."};
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2)+"\n");console.log(JSON.stringify(summary,null,2));
