/** Audit native contracts and bounded move recipe installation against explicit ROMs. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildMoveRuleModule, configureMoveRuleSets, clearMoveRules, inspectMoveEffects, hydrateMoveEffectsSource, MOVE_RECIPE_MANAGED_FIELDS, MOVE_EFFECTS_DLL_PATH } from "../../src/pokeweb/moveEffectsModel";
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
const [path,out] = process.argv.slice(2); assert(out,"Usage: ROM.nds EXTERNAL_OUTPUT_DIRECTORY"); await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const input=new Uint8Array(await readFile(path));
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"move-validation.nds",{selectedNarcs:["moves","message_texts"]});
let project=await load(input);
const state=inspectMoveEffects(project);assert(state.editable,state.message);
const entries=new Map(Array.from({length:100},(_,i)=>[i+1,MOVE_RECIPE_LIBRARY[i%MOVE_RECIPE_LIBRARY.length].rule]));
for(const[id,rule]of entries){const raw=decodeRecord(project,"moves",id).raw!;raw.category=rule.effects.some(e=>e.phase==="status")?0:1;raw.power=raw.category===0?0:40;markDirty(project,"moves",id);}
const before = Array.from({length:100},(_,i)=>structuredClone(decodeRecord(project,"moves",i+1).raw!));
const rpm=buildMoveRuleModule(project,entries);await writeFile(resolve(out,"MoveEffects.dll"),writeRpm(rpm,{ident:"DLXF"}));
const rom=new NintendoDSRom(input,{fileData:"view"}),overlay=rom.loadArm9Overlays([167]).get(167)!;
await writeFile(resolve(out,"overlay167.bin"),overlay.data);
console.log(JSON.stringify({game:rom.idCode,base:overlay.ramAddress,templates:entries.size,code:rpm.code.length,bss:rpm.bssSize}));

await configureMoveRuleSets(project,[...entries].map(([moveId,rules])=>({moveId,rules})));
assert.deepEqual(inspectMoveEffects(project).rules,entries);
project=openProjectSession(createProjectDocument(project,false));hydrateMoveEffectsSource(project,rom);project.originalRomBytes=undefined;
assert.deepEqual(inspectMoveEffects(project).rules,entries);
project.originalRomBytes=input;
const first=await exportModifiedRom(project,{forDsi:false});
project=await load(first);assert.deepEqual(inspectMoveEffects(project).rules,entries);
const exported=new NintendoDSRom(first,{fileData:"view"});let preservedFiles=0;
function checkFiles(folder:Folder,prefix=""){
 for(const[name,nested]of folder.folders)checkFiles(nested,`${prefix}${name}/`);
 for(const[name,index]of folder.files.map((name,index)=>[name,index]as const)){
  const path=`${prefix}${name}`;if(path==="a/0/2/1")continue;
  const id=exported.filenames.idOf(path);assert.notEqual(id,undefined,`Preserved file ${path}`);
  const original=rom.files[folder.firstId+index],actual=exported.files[id!];
  if(!Buffer.from(actual).equals(Buffer.from(original))){
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
const second=await exportModifiedRom(project,{forDsi:false});project=await load(second);assert.deepEqual(inspectMoveEffects(project).rules,entries);
await clearMoveRules(project,1);assert.equal(inspectMoveEffects(project).rules.has(1),false);
const restored=decodeRecord(project,"moves",1).raw!;
for(const field of ["effect_category","result_effect","effect_chance","status","min_turns","max_turns","healing","recoil","flinch",...[1,2,3].flatMap(n=>[`stat_${n}`,`magnitude_${n}`,`stat_chance_${n}`])])assert.equal(restored[field],before[0][field],`Restored ${field}`);
const third=await exportModifiedRom(project,{forDsi:false});project=await load(third);assert.equal(inspectMoveEffects(project).rules.size,99);
const exportedRom=new NintendoDSRom(first,{fileData:"view"});assert.equal(exportedRom.filenames.folders.find(([n])=>n==="patches")?.[1].files.filter(n=>n==="MoveEffects.dll").length,1);
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");assert.equal(hash(new Uint8Array(await readFile(path))),hash(input));
await writeFile(resolve(out,"roundtrip.json"),JSON.stringify({game:rom.idCode,passed:true,editedMoves:100,exports:3,sharedMoveDlls:1,codeBytes:rpm.code.length,bssBytes:rpm.bssSize,inputUnchanged:true,preservedFiles})+"\n");
console.log("100-move project/ROM round trips, re-edit, restore and one DLL verified.");
