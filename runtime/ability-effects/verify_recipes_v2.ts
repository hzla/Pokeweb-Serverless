/** Hash-bound expanded recipe validation, including legacy export compatibility. */
import assert from'node:assert/strict';import{createHash}from'node:crypto';import{readFile,writeFile}from'node:fs/promises';
import{loadProjectFromRomBytes}from'../../src/pokeweb/loader';import{inspectAbilityEffects}from'../../src/pokeweb/abilityEffectsModel';import{abilityImport}from'../../src/pokeweb/abilityLibrary';
const[directory,original,...previous]=process.argv.slice(2);if(!original)throw new Error('Usage: OUTPUT_DIRECTORY ORIGINAL.nds [PREVIOUS_EXPORT.nds ...]');
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=='file:')throw new Error('Only local bundled assets permitted.');return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),m=JSON.parse(await readFile(`${directory}/cases.json`,'utf8'));assert.equal(sha(await readFile(original)),m.inputSha256);
const exports=[];
for(const[file,hash]of[['ability-imports.nds',m.exportSha256],['ability-imports-reloaded.nds',m.reexportSha256],...m.reloadedEdits.map((e:{file:string;sha256:string})=>[e.file,e.sha256])]){
 const bytes=new Uint8Array(await readFile(`${directory}/${file}`));assert.equal(sha(bytes),hash);const p=await loadProjectFromRomBytes(bytes,file,{selectedNarcs:['personal','message_texts']}),s=inspectAbilityEffects(p);assert(s.editable,s.message);assert.equal(s.rules.size,m.editedAbilities);for(const t of m.imports)assert.equal(p.texts.banks.abilities?.[t.assignedId],t.name);
 const edit=m.reloadedEdits.find((e:{file:string})=>e.file===file),sharp=m.imports.find((t:{officialId:number})=>t.officialId===292).assignedId,aero=m.imports.find((t:{officialId:number})=>t.officialId===184).assignedId;
 if(edit?.rules)assert.deepEqual(s.rules.get(edit.abilityId),edit.rules);
 else if(edit){assert.equal(s.rules.get(sharp)!.effects[0].value,edit.value);assert.deepEqual(s.rules.get(sharp)!.effects[0].parameters,edit.moveClass===9?{moveClass:9,type:17}:{moveClass:7});}
 else{assert.deepEqual(s.rules.get(sharp),abilityImport(292).rule);assert.deepEqual(s.rules.get(aero),abilityImport(184).rule);}
 exports.push({file,sha256:hash,editable:true,rules:s.rules.size});
}
for(const[file,hash]of Object.entries(m.romHashes))assert.equal(sha(await readFile(`${directory}/${file}`)),hash);
const results=[];
for(const spec of m.cases){
 const r=JSON.parse(await readFile(`${directory}/${spec.label}-result.json`,'utf8'));assert(r.passed);assert.equal(r.case,spec.label);assert.equal(r.romSha256,m.romHashes[spec.rom]);assert.equal(r.abilityId,spec.abilityId);assert.equal(r.loader.abilityPatchRecords,1);assert.equal(r.loader.liveRuleCount,m.editedAbilities);assert.equal(r.menus.length,spec.menuCount??3);
 for(const menu of r.menus)for(const owner of new Set(menu.abilityRegistrations.map((v:{owner:number})=>v.owner))){const registration=menu.abilityRegistrations.filter((v:{owner:number})=>v.owner===owner);assert.equal(new Set(registration.map((v:{id:number})=>v.id)).size,1);assert.deepEqual(registration.map((v:{priority:number})=>v.priority).sort(),registration[0].id===235?[4,5]:[5]);}
 if(spec.saveSha256)assert.equal(sha(await readFile(`${directory}/saves/${spec.label}.sav`)),spec.saveSha256);
 results.push(r);
}
for(const entry of m.imports)assert(results.some(r=>r.abilityId===entry.assignedId),`No native case for ${entry.name}`);
const previousExports=[];for(const path of previous){const bytes=new Uint8Array(await readFile(path)),p=await loadProjectFromRomBytes(bytes,'previous.nds',{selectedNarcs:['personal','message_texts']}),s=inspectAbilityEffects(p);assert(s.editable,s.message);previousExports.push({sha256:sha(bytes),rules:s.rules.size,canonicalModuleVerified:true});}
const summary={passed:results.length,completedTurns:results.reduce((n,r)=>n+r.menus.length-1,0),inputSha256:m.inputSha256,exports,projectReopen:m.projectReload,editedAbilities:m.editedAbilities,sharedAbilityDlls:1,imports:m.imports,codeBytes:m.codeBytes,bssBytes:m.bssBytes,serializedBytes:m.serializedBytes,previousExports,minimumObservedFreePayload:Object.fromEntries(['bookkeeping','system'].map(key=>[key,Math.min(...results.map(r=>r.minimumObservedFree[key].freePayloadBytes))])),cases:results.map(r=>({label:r.case,abilityId:r.abilityId,passed:true})),scope:'DS-mode melonDS cold boots; normal keypad input; read-only hooks; no game-service stubs or battle-state writes.'};await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
