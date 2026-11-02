/** Production apply/export/reload/remove checks for the two composable primitives. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {decodeRecord} from "../../src/pokeweb/projectStore";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {inspectAbilityEffects,configureAbilityRuleSets,clearAbilityRules,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {inspectMoveEffects,configureMoveRuleSets,clearMoveRules} from "../../src/pokeweb/moveEffectsModel";
import {validateAbilityRule} from "../../src/pokeweb/abilityRules";
import {MOVE_ALWAYS,newMoveEffect,validateMoveRule} from "../../src/pokeweb/moveRules";
import {parseRpm} from "../../src/pokeweb/rpm";
const [path]=process.argv.slice(2);assert(path,"Usage: vite-node test_primitives_lifecycle.ts ROM.nds");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets permitted");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const bytes=new Uint8Array(await readFile(path)),load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"lifecycle.nds",{selectedNarcs:["moves","personal","items","message_texts"]});
let project=await load(bytes);
const overlayId=project.session.baseRom==="BW"?93:167,originalBattleOverlay=new NintendoDSRom(bytes,{fileData:"view"}).loadArm9Overlays([overlayId]).get(overlayId)!.data;
const beforeAbilities=inspectAbilityEffects(project),beforeMoves=inspectMoveEffects(project);assert(beforeAbilities.editable,beforeAbilities.message);assert(beforeMoves.editable,beforeMoves.message);
const abilityId=Array.from({length:164},(_,n)=>n+1).find(id=>!beforeAbilities.rules.has(id))!;assert(abilityId);
const moveId=[282,...Array.from({length:559},(_,n)=>n+1)].find(id=>id<project.narcs.moves!.fileCount&&!beforeMoves.rules.has(id)&&decodeRecord(project,"moves",id).raw!.category!==0)!;assert(moveId);
const original=structuredClone(decodeRecord(project,"moves",moveId).raw),abilityName=project.texts.banks.abilities?.[abilityId];
const guard=validateAbilityRule({effects:[{kind:"abilityRecipe:abilityStatGuard",value:1}],conditions:MOVE_ALWAYS});
const knock=validateMoveRule({effects:[newMoveEffect("modernKnockOff")],conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS});
const expectedAbilities=new Map(beforeAbilities.rules).set(abilityId,guard),expectedMoves=new Map(beforeMoves.rules).set(moveId,knock);
const verify=(abilities:typeof expectedAbilities,moves:typeof expectedMoves)=>{
 const a=inspectAbilityEffects(project),m=inspectMoveEffects(project);assert(a.editable,a.message);assert(m.editable,m.message);assert.deepEqual(a.rules,abilities);assert.deepEqual(m.rules,moves);assert.equal(project.texts.banks.abilities?.[abilityId],abilityName);
};
await configureAbilityRuleSets(project,[{abilityId,rules:guard}]);await configureMoveRuleSets(project,[{moveId,rules:knock}]);verify(expectedAbilities,expectedMoves);
for(let pass=0;pass<2;pass++){project=await load(await exportModifiedRom(project,{forDsi:false}));verify(expectedAbilities,expectedMoves);}
await configureMoveRuleSets(project,[{moveId,rules:{...knock,effects:[{...knock.effects[0],value:2.5}]}}]);
project=await load(await exportModifiedRom(project,{forDsi:false}));assert.equal(inspectMoveEffects(project).rules.get(moveId)!.effects[0].value,2.5);
await clearMoveRules(project,moveId);clearAbilityRules(project,abilityId);
project=await load(await exportModifiedRom(project,{forDsi:false}));verify(beforeAbilities.rules,beforeMoves.rules);assert.deepEqual(decodeRecord(project,"moves",moveId).raw,original);
const rom=new NintendoDSRom(await exportModifiedRom(project,{forDsi:false}),{fileData:"view"});
assert.deepEqual(rom.loadArm9Overlays([overlayId]).get(overlayId)!.data,originalBattleOverlay);
let abilityBytes:Uint8Array|undefined;try{abilityBytes=rom.getFileByName(ABILITY_EFFECTS_DLL_PATH);}catch{assert.equal(beforeAbilities.rules.size,0);}
if(abilityBytes&&abilityBytes.length>4){
 const ability=parseRpm(abilityBytes,{allowedMagics:["DLXF"]});
 if(![...beforeAbilities.rules.values()].some(rule=>rule.effects.some(effect=>effect.kind==="abilityRecipe:abilityStatGuard")))assert(!ability.relocations.some(r=>ability.symbols[r.sourceSymbolIndex]?.name==="AbilityNativeCallback"));
}
console.log(JSON.stringify({passed:true,abilityId,moveId,preservedAbilityRecipes:beforeAbilities.rules.size,preservedMoveRecipes:beforeMoves.rules.size,exportReload:true,reedit:true,restoredNativeFields:true,preservedBattleOverlay:true,removedSourceHook:true}));
