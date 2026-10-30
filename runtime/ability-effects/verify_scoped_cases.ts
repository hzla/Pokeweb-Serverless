/** Seal the editable-ROM lifecycle and native battle evidence for scoped recipes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProjectFromRomBytes} from '../../src/pokeweb/loader';
import {NintendoDSRom} from '../../src/nds/rom';
import {inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from '../../src/pokeweb/abilityEffectsModel';
import {encodeAbilityRules} from '../../src/pokeweb/abilityRules';
import {ABILITY_IMPORT_LIBRARY} from '../../src/pokeweb/abilityLibrary';
import {parseRpm} from '../../src/pokeweb/rpm';
const [directory,input]=process.argv.slice(2);assert(directory&&input,'Usage: COHORT INPUT.nds');
const out=resolve(directory),root=fileURLToPath(new URL('../..',import.meta.url)),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const m=JSON.parse(await readFile(`${out}/cases.json`,'utf8'));
assert.equal(sha(await readFile(input)),m.inputSha256,'Input ROM changed');
assert(m.projectReload&&m.romExportReload);assert.equal(m.reloadedEdits.length,20);assert.equal(m.imports.length,88);
for(const [name,digest]of Object.entries(m.romHashes))assert.equal(sha(await readFile(`${out}/${name}`)),digest);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,'file:');return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
for(const[name,digest]of [['ability-imports.nds',m.exportSha256],['ability-imports-reloaded.nds',m.reexportSha256]]){
 const bytes=new Uint8Array(await readFile(`${out}/${name}`));assert.equal(sha(bytes),digest);
 const p=await loadProjectFromRomBytes(bytes,name,{selectedNarcs:['personal','items','message_texts','moves']}),state=inspectAbilityEffects(p);assert(state.editable,state.message);assert.equal(state.rules.size,m.editedAbilities);
 assert.equal(Buffer.from(encodeAbilityRules(state.rules)).toString('hex'),m.configHex);
 for(const t of ABILITY_IMPORT_LIBRARY){const assigned=m.imports.find((i:{officialId:number})=>i.officialId===t.id)!;assert.equal(p.texts.banks.abilities?.[assigned.assignedId],t.defaultName);assert.deepEqual(state.rules.get(assigned.assignedId),t.rule);}
 const rom=new NintendoDSRom(bytes,{fileData:'view'}),dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:['DLXF']});assert.equal(dll.metadata.PokewebAbilityScoped,1);assert.equal(dll.metadata.PokewebAbilityPopupGroups,1);assert(dll.bssSize<=16384&&dll.code.length+dll.bssSize<=65536);assert(m.serializedBytes+dll.code.length+dll.bssSize<=112*1024);
}
const results=[],minimum:Record<string,number>={};let turns=0;
for(const c of m.cases){
 assert.equal(sha(await readFile(`${out}/saves/${c.label}.sav`)),c.saveSha256);
 const r=JSON.parse(await readFile(`${out}/${c.label}-result.json`,'utf8'));assert(r.passed,c.label);assert.equal(r.romSha256,m.romHashes[c.rom]);assert.equal(r.loader.abilityPatchRecords,1);assert.equal(r.loader.liveRuleCount,m.editedAbilities);assert.equal(r.menus.length,c.menuCount??3);
 if(c.checks.allySuppressed)assert(r.menus.slice(1).every((v:{allyConditions:number[]})=>v.allyConditions[16]),c.label);
 if(c.checks.finalSuppressed)assert(r.menus.at(-1).conditions[16],c.label);
 if(c.checks.enemyHpByTurn)assert.deepEqual(r.menus.map((v:{enemyHp:number})=>v.enemyHp),c.checks.enemyHpByTurn,c.label);
 if(c.checks.stabByTurn)assert.deepEqual(r.nativeStab.map((v:{stab:boolean})=>v.stab),c.checks.stabByTurn,c.label);
 for(const[k,v]of Object.entries(r.minimumObservedFree)as Array<[string,{freePayloadBytes:number}]>){assert(v.freePayloadBytes>0);minimum[k]=Math.min(minimum[k]??Infinity,v.freePayloadBytes);}
 turns+=r.menus.length-1;results.push({label:c.label,sha256:sha(await readFile(`${out}/${c.label}-result.json`)),passed:true});
}
assert.equal(m.cases.length,61);assert.equal(results.length,61);
const tests=await readFile(`${out}/tests.log`,'utf8'),production=await readFile(`${out}/production.log`,'utf8'),types=await readFile(`${out}/types.log`,'utf8');assert(!types.trim());assert(production.includes('built in'));const count=Number(tests.match(/Tests\s+(\d+) passed/u)?.[1]);assert(count>=317&&!tests.includes(' failed'));
const templates=execFileSync('git',['ls-files','src/assets/data/abilityRuleRuntime*.json'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>!p.includes('Scoped'));
assert.equal(templates.length,12);for(const p of templates)assert.equal(sha(await readFile(`${root}/${p}`)),sha(execFileSync('git',['show',`HEAD:${p}`],{cwd:root})),`Old template changed: ${p}`);
const sourcePaths=['src/pokeweb/abilityScopedEffects.ts','src/pokeweb/abilityRecipeEffects.ts','src/pokeweb/abilityLibrary.ts','src/pokeweb/abilityRules.ts','src/pokeweb/abilityEffectsModel.ts','src/pokeweb/battleRuntimeBindings.ts','src/ui/itemRuleEditor.ts','src/test/abilityScoped.test.ts','src/test/fixtures/itemEffectsProject.ts','src/assets/data/abilityScopedBindings.json','src/assets/data/abilityRuleRuntimeRecipesScoped.json','src/assets/data/abilityRuleRuntimeClientScoped.json','runtime/ability-effects/scoped.c','runtime/ability-effects/recipes.c','runtime/ability-effects/rules.c','runtime/ability-effects/build.py','runtime/ability-effects/generate_scoped_bindings.ts','runtime/ability-effects/build_scoped_cases.ts','runtime/ability-effects/emulator.py','runtime/ability-effects/verify_scoped_cases.ts','runtime/ability-effects/README.md',...templates];
const source=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(`${root}/${p}`))])));
const evidence=Object.fromEntries(await Promise.all((await readdir(out)).filter(p=>/\.json$|\.png$|\.log$/u.test(p)&&p!=='receipt.json').map(async p=>[p,sha(await readFile(`${out}/${p}`))])));
const summary={nativeCases:results.length,completedTurns:turns,automatedTests:count,templates:88,newTemplates:19,editedAbilities:m.editedAbilities,oneSharedDll:true,codeBytes:m.codeBytes,bssBytes:m.bssBytes,serializedBytes:m.serializedBytes,minimumObservedFree:minimum,parameterReedits:20,olderTemplatesUnchanged:12,inputUnchanged:true};
await writeFile(`${out}/receipt.json`,JSON.stringify({summary,source,evidence,romHashes:m.romHashes,results},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
