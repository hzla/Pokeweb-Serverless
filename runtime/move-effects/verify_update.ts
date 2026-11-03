/** Update an explicit older ROM; write diagnostics only to an external directory. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {inspectMoveEffects,upgradeMoveRuntime,MOVE_EFFECTS_DLL_PATH,MOVE_RECIPE_BOOK_PATH,MOVE_RECIPE_MANAGED_FIELDS} from "../../src/pokeweb/moveEffectsModel";
import {inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
import {decodeMoveRecipeBook} from "../../src/pokeweb/moveRecipeBook";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import {parseRpm} from "../../src/pokeweb/rpm";
const [path,out,expectedPath]=process.argv.slice(2);assert(path&&out,"OLDER_ROM.nds EXTERNAL_OUTPUT_DIRECTORY [EXPECTED_OPTIMIZED_ROM.nds]");await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const input=new Uint8Array(await readFile(path)),rom=new NintendoDSRom(input,{fileData:"view"});
const load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"move-update.nds",{selectedNarcs:["personal","items","moves","message_texts"]});
const project=await load(input),before=inspectMoveEffects(project),abilities=inspectAbilityEffects(project);assert(before.editable,before.message);assert(before.updateAvailable,"Input must contain a recognized older runtime");
const old=parseRpm(rom.getFileByName(MOVE_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]});
const originals=decodeMoveRecipeBook(String(old.metadata.MoveRecipeBook),MOVE_RECIPE_MANAGED_FIELDS).originals;
assert.equal(await upgradeMoveRuntime(project),true);const state=inspectMoveEffects(project);assert(state.editable,state.message);assert.equal(state.updateAvailable,false);assert.deepEqual(state.rules,before.rules);assert.deepEqual(inspectAbilityEffects(project).rules,abilities.rules);assert.equal(project.narcs.moves!.dirty.size,0);
const exported=await exportModifiedRom(project,{forDsi:false}),updated=new NintendoDSRom(exported,{fileData:"view"});
function preserve(folder:typeof rom.filenames,prefix=""){
  for(const[name,child]of folder.folders)preserve(child,`${prefix}${name}/`);
  folder.files.forEach((name,index)=>{const path=prefix+name;if(path!==MOVE_EFFECTS_DLL_PATH&&path!==MOVE_RECIPE_BOOK_PATH)assert.deepEqual(updated.getFileByName(path),rom.files[folder.firstId+index],path);});
}preserve(rom.filenames);assert.deepEqual(updated.arm9,rom.arm9);assert.deepEqual(updated.arm7,rom.arm7);assert.deepEqual(updated.arm9OverlayTable,rom.arm9OverlayTable);
assert.deepEqual(decodeMoveRecipeBook(new TextDecoder().decode(updated.getFileByName(MOVE_RECIPE_BOOK_PATH)),MOVE_RECIPE_MANAGED_FIELDS).originals,originals);
const reopened=await load(exported),inspected=inspectMoveEffects(reopened);assert(inspected.editable,inspected.message);assert(!inspected.updateAvailable);assert.deepEqual(inspected.rules,before.rules);
const fileState=structuredClone(reopened.fileSystem),changelog=structuredClone(reopened.actionChangelog);assert.equal(await upgradeMoveRuntime(reopened),false);assert.deepEqual(reopened.fileSystem,fileState);assert.deepEqual(reopened.actionChangelog,changelog);
const id=updated.fileId(MOVE_EFFECTS_DLL_PATH),bad=updated.files[id].slice();bad[32]^=1;reopened.fileSystem??={replacements:{}};reopened.fileSystem.replacements[id]=bad;
const corruptState=structuredClone(reopened.fileSystem);assert(!inspectMoveEffects(reopened).editable);await assert.rejects(upgradeMoveRuntime(reopened));assert.deepEqual(reopened.fileSystem,corruptState);
const pending=await load(input),moveId=[...before.rules.keys()][0],record=decodeRecord(pending,"moves",moveId).raw!;record.pp=record.pp===1?2:1;markDirty(pending,"moves",moveId);const pendingRecord=structuredClone(record),dirty=[...pending.narcs.moves!.dirty];await upgradeMoveRuntime(pending);assert.deepEqual(decodeRecord(pending,"moves",moveId).raw,pendingRecord);assert.deepEqual([...pending.narcs.moves!.dirty],dirty);
if(expectedPath){const expected=new NintendoDSRom(new Uint8Array(await readFile(expectedPath)),{fileData:"view"});assert.deepEqual(updated.getFileByName(MOVE_EFFECTS_DLL_PATH),expected.getFileByName(MOVE_EFFECTS_DLL_PATH));}
await writeFile(`${out}/updated.nds`,exported);const result={passed:true,game:rom.idCode,recipes:state.rules.size,fromRuntime:before.runtimeVersion,fromPackaging:before.packagingVersion,toRuntime:inspected.runtimeVersion,toPackaging:inspected.packagingVersion,moveDataUnchanged:true,originalSnapshotsPreserved:true,pendingEditsPreserved:true,exportReload:true,currentRuntimeNoop:true,corruptRuntimeRejected:true,previousOptimizedDllMatches:Boolean(expectedPath)};
await writeFile(`${out}/update.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
