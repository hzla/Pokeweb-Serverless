/** Audit native contracts and bounded move recipe installation against explicit ROMs. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildMoveRuleModule, configureMoveRuleSets, clearMoveRules, inspectMoveEffects, hydrateMoveEffectsSource, MOVE_RECIPE_MANAGED_FIELDS, MOVE_EFFECTS_DLL_PATH, MOVE_RECIPE_BOOK_PATH } from "../../src/pokeweb/moveEffectsModel";
import type { Folder } from "../../src/nds/fnt";
import { NARC } from "../../src/nds/narc";
import { repairNarcBytes } from "../../src/pokeweb/romRepairModel";
import { MOVE_RECIPE_LIBRARY } from "../../src/pokeweb/moveRecipeLibrary";
import { writeRpm } from "../../src/pokeweb/rpm";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { decodeRecord,markDirty } from "../../src/pokeweb/projectStore";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../../src/nds/rom";
import { decodeGen5TextBank } from "../../src/pokeweb/text";
const [path,out] = process.argv.slice(2); assert(out,"Usage: ROM.nds EXTERNAL_OUTPUT_DIRECTORY"); await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const input=new Uint8Array(await readFile(path));
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"move-validation.nds",{selectedNarcs:["moves","message_texts"]});
let project=await load(input);
const state=inspectMoveEffects(project);assert(state.editable,state.message);
const entries=new Map(Array.from({length:100},(_,i)=>[i+1,MOVE_RECIPE_LIBRARY[i%MOVE_RECIPE_LIBRARY.length].rule]));
for(const[id,rule]of entries){const raw=decodeRecord(project,"moves",id).raw!;raw.category=rule.effects.some(e=>e.phase==="status")?0:1;raw.power=raw.category===0?0:40;if(rule.effects.some(e=>e.kind==="drainEachHit"))raw.hits=0;markDirty(project,"moves",id);}
const before = Array.from({length:100},(_,i)=>structuredClone(decodeRecord(project,"moves",i+1).raw!));
const rpm=buildMoveRuleModule(project,entries);await writeFile(resolve(out,"MoveEffects.dll"),writeRpm(rpm,{ident:"DLXF"}));
const overlayId=project.session.baseRom==="BW"?93:167,battleBank=project.session.baseRom==="BW"?14:18;
const rom=new NintendoDSRom(input,{fileData:"view"}),overlay=rom.loadArm9Overlays([overlayId]).get(overlayId)!;
await writeFile(resolve(out,`overlay${overlayId}.bin`),overlay.data);
console.log(JSON.stringify({game:rom.idCode,base:overlay.ramAddress,templates:entries.size,code:rpm.code.length,bss:rpm.bssSize}));

await configureMoveRuleSets(project,[...entries].map(([moveId,rules])=>({moveId,rules})));
assert(inspectMoveEffects(project).editable,inspectMoveEffects(project).message);assert.deepEqual(inspectMoveEffects(project).rules,entries);
project=openProjectSession(createProjectDocument(project,false));hydrateMoveEffectsSource(project,rom);project.originalRomBytes=undefined;
assert(inspectMoveEffects(project).editable,inspectMoveEffects(project).message);assert.deepEqual(inspectMoveEffects(project).rules,entries);
project.originalRomBytes=input;
const first=await exportModifiedRom(project,{forDsi:false});
project=await load(first);assert(inspectMoveEffects(project).editable,inspectMoveEffects(project).message);assert.deepEqual(inspectMoveEffects(project).rules,entries);
const exported=new NintendoDSRom(first,{fileData:"view"});let preservedFiles=0;
function checkFiles(folder:Folder,prefix=""){
 for(const[name,nested]of folder.folders)checkFiles(nested,`${prefix}${name}/`);
 for(const[name,index]of folder.files.map((name,index)=>[name,index]as const)){
  const path=`${prefix}${name}`;if(path==="a/0/2/1")continue;
  const id=exported.filenames.idOf(path);assert.notEqual(id,undefined,`Preserved file ${path}`);
  const original=rom.files[folder.firstId+index],actual=exported.files[id!];
  if(!Buffer.from(actual).equals(Buffer.from(original))){
   if(path==="a/0/0/2"){
    const before=new NARC(original).files,after=new NARC(actual).files;assert.equal(after.length,before.length);
    for(let bank=0;bank<before.length;++bank){
     if(bank!==battleBank){assert.deepEqual(after[bank],before[bank],`Unrelated message bank ${bank}`);continue;}
     const oldEntries=decodeGen5TextBank(before[bank]),newEntries=new Map(decodeGen5TextBank(after[bank]).map(entry=>[entry[0],entry]));
     // The third tuple member is the encryption key, which may change on
     // re-encoding. The ID includes the flags and compression marker.
     for(const entry of oldEntries)assert.deepEqual(newEntries.get(entry[0])?.slice(0,2),entry.slice(0,2),`Existing battle message ${entry[0]}`);
    }
    ++preservedFiles;continue;
   }
   const repair=repairNarcBytes(original);assert(repair.changed,`Unrelated file changed: ${path}`);
   assert.deepEqual(actual,repair.bytes,`Unexpected archive change: ${path}`);
   assert.deepEqual(new NARC(actual).files,new NARC(original).files,`Unrelated archive payload changed: ${path}`);
  }
  ++preservedFiles;
 }
}
checkFiles(rom.filenames);
for(let id=1;id<=100;++id){const now=decodeRecord(project,"moves",id).raw!;for(const[field,value]of Object.entries(before[id-1]))if(!MOVE_RECIPE_MANAGED_FIELDS.includes(field))assert.equal(now[field],value,`Ordinary field ${id}/${field}`);}
const oldMoves=await load(input);for(let id=101;id<project.narcs.moves!.fileCount;++id)assert.deepEqual(project.narcs.moves!.rawFiles[id],oldMoves.narcs.moves!.rawFiles[id],`Unedited move ${id}`);
const edited=structuredClone(entries.get(1)!);edited.effects=[{kind:"power",value:2.5,phase:"power",target:"user",chance:100,secondary:false,conditions:{kind:"group",mode:"all",children:[]}}];
await configureMoveRuleSets(project,[{moveId:1,rules:edited}]);entries.set(1,edited);
const second=await exportModifiedRom(project,{forDsi:false});project=await load(second);assert(inspectMoveEffects(project).editable,inspectMoveEffects(project).message);assert.deepEqual(inspectMoveEffects(project).rules,entries);
await clearMoveRules(project,1);assert.equal(inspectMoveEffects(project).rules.has(1),false);
const restored=decodeRecord(project,"moves",1).raw!;
for(const field of ["effect_category","result_effect","effect_chance","status","min_turns","max_turns","healing","recoil","flinch",...[1,2,3].flatMap(n=>[`stat_${n}`,`magnitude_${n}`,`stat_chance_${n}`])])assert.equal(restored[field],before[0][field],`Restored ${field}`);
const third=await exportModifiedRom(project,{forDsi:false});project=await load(third);assert.equal(inspectMoveEffects(project).rules.size,99);
const exportedRom=new NintendoDSRom(first,{fileData:"view"});assert.equal(exportedRom.filenames.folders.find(([n])=>n==="patches")?.[1].files.filter(n=>n==="MoveEffects.dll").length,1);
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");assert.equal(hash(new Uint8Array(await readFile(path))),hash(input));
await writeFile(resolve(out,"roundtrip.json"),JSON.stringify({game:rom.idCode,passed:true,editedMoves:100,exports:3,sharedMoveDlls:1,codeBytes:rpm.code.length,bssBytes:rpm.bssSize,inputUnchanged:true,preservedFiles})+"\n");
console.log("100-move project/ROM round trips, re-edit, restore and one DLL verified.");
if(!state.rules.size){
  let single=await load(input);
  const originalFields=structuredClone(decodeRecord(single,"moves",1).raw!);
  await configureMoveRuleSets(single,[{moveId:1,rules:{conditions:{kind:"group",mode:"all",children:[]},prerequisites:{kind:"group",mode:"all",children:[]},effects:[{kind:"power",value:2,phase:"power",target:"user",chance:100,secondary:false,conditions:{kind:"group",mode:"all",children:[]}}]}}]);
  single=await load(await exportModifiedRom(single,{forDsi:false}));
  await clearMoveRules(single,1);
  const removed=await exportModifiedRom(single,{forDsi:false}),reopened=await load(removed),restoredState=inspectMoveEffects(reopened);
  assert(restoredState.editable,restoredState.message);assert.equal(restoredState.rules.size,0);
  assert.equal(new NintendoDSRom(removed,{fileData:"view"}).getFileByName(MOVE_RECIPE_BOOK_PATH).length,0);
  for(const field of MOVE_RECIPE_MANAGED_FIELDS)assert.equal(decodeRecord(reopened,"moves",1).raw![field],originalFields[field]);
  console.log("Final recipe removal clears the sidecar and restores native data after reload.");
}
