/** Explicit local ROM migration and sidecar checks; diagnostics go outside the repo. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {inspectAbilityEffects,hydrateAbilityEffectsSource} from "../../src/pokeweb/abilityEffectsModel";
import {inspectMoveEffects,configureMoveRuleSets,clearMoveRules,buildMoveRuleModule,MOVE_RECIPE_BOOK_PATH,MOVE_RECIPE_MANAGED_FIELDS} from "../../src/pokeweb/moveEffectsModel";
import {decodeRecord} from "../../src/pokeweb/projectStore";
import {parseRpm} from "../../src/pokeweb/rpm";
import {MOVE_ALWAYS,newMoveEffect,encodeMoveRules} from "../../src/pokeweb/moveRules";
import {createProjectDocument} from "../../src/pokeweb/projectDocument";
import {openProjectSession} from "../../src/pokeweb/projectSession";
import {hydrateMoveEffectsSource} from "../../src/pokeweb/moveEffectsModel";

const [path,out]=process.argv.slice(2);assert(path&&out,"INPUT.nds EXTERNAL_OUTPUT_DIRECTORY");await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const input=new Uint8Array(await readFile(path)),original=new NintendoDSRom(input,{fileData:"view"});
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"compact.nds",{selectedNarcs:["moves","message_texts","personal","items"]});
let project=await load(input);const state=inspectMoveEffects(project),ability=inspectAbilityEffects(project);assert(state.editable,state.message);assert(ability.editable,ability.message);assert(state.rules.size);
const movePath="patches/MoveEffects.dll",abilityPath="patches/AbilityEffects.dll";
await configureMoveRuleSets(project,[...state.rules].map(([moveId,rules])=>({moveId,rules})));
assert.deepEqual(inspectMoveEffects(project).rules,state.rules);
const exported=await exportModifiedRom(project,{forDsi:false});
await writeFile(resolve(out,"optimized.nds"),exported);
const rom=new NintendoDSRom(exported,{fileData:"view"});
assert.deepEqual(rom.getFileByName(abilityPath),original.getFileByName(abilityPath));
function compareFiles(folder:typeof original.filenames,prefix=""){
  for(const[name,child]of folder.folders)compareFiles(child,`${prefix}${name}/`);
  folder.files.forEach((name,index)=>{const path=prefix+name;if(path!==movePath&&path!==MOVE_RECIPE_BOOK_PATH)assert.deepEqual(rom.getFileByName(path),original.files[folder.firstId+index],path);});
}
compareFiles(original.filenames);
assert.deepEqual(rom.arm9,original.arm9);assert.deepEqual(rom.arm7,original.arm7);assert.deepEqual(rom.arm9OverlayTable,original.arm9OverlayTable);
const oldModule=parseRpm(original.getFileByName(movePath),{allowedMagics:["DLXF"]}),module=parseRpm(rom.getFileByName(movePath),{allowedMagics:["DLXF"]});
assert.equal(module.metadata.PokewebMovePackaging,2);assert.equal(module.metadata.MoveRecipeBook,undefined);assert.equal(module.bssSize,oldModule.bssSize);
const config=module.symbols.find(s=>s.name==="MoveRecipeConfig")!;assert.equal(module.code[config.address+2],2);
const configBytes=encodeMoveRules(state.rules,module.code[config.address+3],true);
for(let i=0;i<state.rules.size;i++)assert.equal(readU32(module.code,config.address+4+i*16+4),readU32(configBytes,4+i*16+4));
project=await load(exported);assert.deepEqual(inspectMoveEffects(project).rules,state.rules);assert.deepEqual(inspectAbilityEffects(project).rules,ability.rules);
const document=openProjectSession(createProjectDocument(project,false));hydrateMoveEffectsSource(document,rom);hydrateAbilityEffectsSource(document,rom);document.originalRomBytes=undefined;assert(inspectMoveEffects(document).editable,inspectMoveEffects(document).message);assert.deepEqual(inspectMoveEffects(document).rules,state.rules);
const sidecarId=rom.fileId(MOVE_RECIPE_BOOK_PATH);project.fileSystem??={replacements:{}};project.fileSystem.replacements??={};
project.fileSystem.replacements[sidecarId]=new Uint8Array();assert.equal(inspectMoveEffects(project).editable,false);delete project.fileSystem.replacements[sidecarId];
const corrupted=rom.getFileByName(MOVE_RECIPE_BOOK_PATH).slice();corrupted[10]^=1;project.fileSystem.replacements[sidecarId]=corrupted;assert.equal(inspectMoveEffects(project).editable,false);delete project.fileSystem.replacements[sidecarId];
assert(inspectMoveEffects(project).editable);
// Re-edit one move, restore a different one, then export and reopen again.
const id=[...state.rules.keys()][0],secondId=[...state.rules.keys()][1];
const edited=structuredClone(state.rules.get(id)!);edited.effects[0].conditions=structuredClone(edited.effects[0].conditions); // preserve the fixture while exercising a complete rebuild
await configureMoveRuleSets(project,[{moveId:id,rules:edited}]);
const next=await exportModifiedRom(project,{forDsi:false});project=await load(next);assert.deepEqual(inspectMoveEffects(project).rules,state.rules);
if(secondId){
  const book=(await import("../../src/pokeweb/moveRecipeBook")).decodeMoveRecipeBook(new TextDecoder().decode(rom.getFileByName(MOVE_RECIPE_BOOK_PATH)),MOVE_RECIPE_MANAGED_FIELDS);
  await clearMoveRules(project,secondId);const removed=await exportModifiedRom(project,{forDsi:false});const reopened=await load(removed);assert.equal(inspectMoveEffects(reopened).rules.has(secondId),false);
  for(const field of MOVE_RECIPE_MANAGED_FIELDS)assert.equal(decodeRecord(reopened,"moves",secondId).raw![field],book.originals.get(secondId)![field]);
}
const rule={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[newMoveEffect("modernKnockOff")]};
const many=buildMoveRuleModule(await load(exported),new Map(Array.from({length:100},(_,i)=>[i+1,rule]))),data=many.symbols.find(s=>s.name==="MoveRecipeConfig")!.address;
const records=new Set(Array.from({length:100},(_,i)=>readU32(many.code,data+4+i*16+4)));
const tables=new Set(Array.from({length:100},(_,i)=>many.relocations.find(r=>r.target.module==="base"&&r.target.address===data+4+i*16+8)!.sourceSymbolIndex));
assert.equal(records.size,1);assert.equal(tables.size,1);
const table=many.symbols[[...tables][0]],events=Array.from({length:readU16(many.code,data+6)},(_,i)=>readU32(many.code,table.address+i*8));assert.deepEqual(events,[3,4,0x37,0x83]);
const callbackSources=new Set(many.relocations.filter(r=>r.target.module==="base"&&r.target.address>=table.address&&r.target.address<table.address+table.size).map(r=>r.sourceSymbolIndex));assert.equal(callbackSources.size,4);
const summary={passed:true,game:rom.idCode,recipes:state.rules.size,oldFileBytes:original.getFileByName(movePath).length,newFileBytes:rom.getFileByName(movePath).length,oldCodeBytes:oldModule.code.length,newCodeBytes:module.code.length,bssBytes:module.bssSize,sidecarBytes:rom.getFileByName(MOVE_RECIPE_BOOK_PATH).length,recipeBodiesFor100Moves:records.size,eventTablesFor100Moves:tables.size,callbacksFor100Moves:callbackSources.size,exportReloadCycles:2,restoreAfterReload:true,sidecarTamperingRejected:true,abilityModuleUnchanged:true,unrelatedFilesUnchanged:true};
await writeFile(resolve(out,"roundtrip.json"),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
