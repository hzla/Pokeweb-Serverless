/** Exercise checked history, ability and item module installation orders. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureMoveRuleSets,inspectMoveEffects} from "../../src/pokeweb/moveEffectsModel";
import {configureAbilityRuleSets,inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
import {configureItemRuleSets,inspectItemEffect} from "../../src/pokeweb/itemEffectsModel";
import {MOVE_ALWAYS,newMoveEffect} from "../../src/pokeweb/moveRules";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import {MOVE_PERSISTENT_TEMPLATES} from "../../src/pokeweb/moveRecipeLibraryPersistent";
import {MOVE_HISTORY_CANDIDATES} from "../../src/pokeweb/moveRecipeLibraryHistory";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";

const [path,order="ability-first",abilityMode="speed"]=process.argv.slice(2);assert(path);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets are permitted.");return new Response(new Uint8Array(await readFile(url)));}) as typeof fetch;
const source=new Uint8Array(await readFile(path));const load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"combined.nds",{selectedNarcs:["personal","moves","items","message_texts"]});
let project=await load(source);
const rule={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[{...newMoveEffect("power"),conditions:{kind:"ateBerry" as const,subject:"user" as const,value:1}}]};
const edits=Array.from({length:100},(_,n)=>({moveId:n+1,rules:n<MOVE_PERSISTENT_TEMPLATES.length?structuredClone(MOVE_PERSISTENT_TEMPLATES[n].rule):n===MOVE_PERSISTENT_TEMPLATES.length?structuredClone(MOVE_HISTORY_CANDIDATES.find(t=>t.label==="Gigaton Hammer")!.rule):rule}));
for(const e of edits){const raw=decodeRecord(project,"moves",e.moveId).raw!;raw.category=e.rules.effects.some(x=>x.phase==="status")?0:1;markDirty(project,"moves",e.moveId);}
const moves=()=>configureMoveRuleSets(project,edits);
const ability=()=>configureAbilityRuleSets(project,[{abilityId:165,name:"History Test",rules:{effects:abilityMode==="trap"?[{kind:"nativeAbility:42",value:-1,parameters:{trapType:17}}]:[{kind:"speed",value:2}],conditions:MOVE_ALWAYS}}]);
const item=()=>configureItemRuleSets(project,[{itemId:85,rules:{effects:[{kind:"healFlat",value:3}],conditions:MOVE_ALWAYS,consumable:false}}]);
if(order==="ability-first"){await ability();await item();await moves();}else{await moves();await item();await ability();}
assert(inspectAbilityEffects(project).editable);assert(inspectItemEffect(project,85).editable);assert.equal(inspectMoveEffects(project).rules.size,100);
const rom=await exportModifiedRom(project,{forDsi:false});project=await load(rom);
assert(inspectAbilityEffects(project).editable);assert(inspectItemEffect(project,85).editable);assert.equal(inspectMoveEffects(project).rules.size,100);
console.log(JSON.stringify({game:project.session.baseVersion,order,moves:100,exportReload:true}));
