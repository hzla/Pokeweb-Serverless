/** Validate history configuration and ROM round trips on an explicit ROM. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildMoveRuleModule, configureMoveRuleSets, inspectMoveEffects } from "../../src/pokeweb/moveEffectsModel";
import { MOVE_ALWAYS, newMoveEffect, type MoveCondition, type MoveRuleSet } from "../../src/pokeweb/moveRules";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { decodeRecord, markDirty } from "../../src/pokeweb/projectStore";
import { MOVE_HISTORY_CANDIDATES } from "../../src/pokeweb/moveRecipeLibraryHistory";

const [input,output]=process.argv.slice(2);assert(input&&output,"Usage: ROM.nds EXTERNAL_OUTPUT_DIRECTORY");
await mkdir(output,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets are permitted.");return new Response(new Uint8Array(await readFile(url)));}) as typeof fetch;
const original=new Uint8Array(await readFile(input));
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"history-test.nds",{selectedNarcs:["moves","message_texts"]});
let project=await load(original);
const kinds=["ateBerry","moveFailed","hitsTaken","partyFaints","statRaised","statLowered","selectedMove"] as const;
const edits=kinds.map((kind,index)=>{
  const moveId=index+1,raw=decodeRecord(project,"moves",moveId).raw!;raw.category=1;raw.power=50;markDirty(project,"moves",moveId);
  const condition={kind,subject:"user",value:kind==="selectedMove"?0:1} as MoveCondition;
  const rules:MoveRuleSet={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[{...newMoveEffect("power"),conditions:condition}]};
  return {moveId,rules};
});
for(const [index,template] of MOVE_HISTORY_CANDIDATES.entries()){
 const moveId=20+index,raw=decodeRecord(project,"moves",moveId).raw!;raw.category=1;raw.power=50;markDirty(project,"moves",moveId);edits.push({moveId,rules:structuredClone(template.rule)});
}
const module=buildMoveRuleModule(project,new Map(edits.map(e=>[e.moveId,e.rules])));
assert.equal(module.metadata.PokewebMoveRecipes,8);
await configureMoveRuleSets(project,edits);
let state=inspectMoveEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,edits.length);
const rom=await exportModifiedRom(project,{forDsi:false});await writeFile(resolve(output,"history.nds"),rom);
project=await load(rom);state=inspectMoveEffects(project);assert(state.editable,state.message);assert.equal(state.rules.size,edits.length);
for(const e of edits)assert.equal(state.rules.get(e.moveId)?.effects[0].conditions.kind,e.rules.effects[0].conditions.kind);
const updated=structuredClone(edits[2].rules);(updated.effects[0].conditions as {value:number}).value=3;
await configureMoveRuleSets(project,[{moveId:edits[2].moveId,rules:updated}]);
project=await load(await exportModifiedRom(project,{forDsi:false}));state=inspectMoveEffects(project);
assert(state.editable,state.message);assert.deepEqual(state.rules.get(edits[2].moveId),updated);

console.log(JSON.stringify({game:project.session.baseVersion,rules:state.rules.size,code:module.code.length,bss:module.bssSize}));
