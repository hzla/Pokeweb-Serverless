/** Native fixtures for the generic custom move filter, shared across BW/BW2. */
import assert from "node:assert/strict";
import { createCustomMoveFlag, configureCustomMoveFlag } from "../../src/pokeweb/abilityEffectsModel";
import { customMoveFlagFilter } from "../../src/pokeweb/customMoveFlags";
import { validateAbilityRule, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { decodeRecord } from "../../src/pokeweb/projectStore";
import type { ProjectState } from "../../src/pokeweb/projectStore";
export async function prepareCustomFlagCases(project:ProjectState):Promise<Map<number,AbilityRuleSet>>{
 const kick=await createCustomMoveFlag(project,"Kick"),other=await createCustomMoveFlag(project,"Other");
 assert.equal(kick,1);assert.equal(other,2);
 for(const move of[24,26,67])await configureCustomMoveFlag(project,move,kick,true);
 await configureCustomMoveFlag(project,33,other,true);
 const all={kind:"group"as const,mode:"all"as const,children:[]};
 return new Map([
  [165,validateAbilityRule({effects:[{kind:"ability:power",value:1.5,parameters:{moveClass:customMoveFlagFilter(kick)}}],conditions:all})],
  [166,validateAbilityRule({effects:[{kind:"ability:power",value:1.5,parameters:{moveClass:customMoveFlagFilter(other)}}],conditions:all})],
  [167,validateAbilityRule({effects:[{kind:"abilityRecipe:convertType",value:2,parameters:{moveClass:customMoveFlagFilter(kick),sourceType:18,type:14}}],conditions:all})],
  [168,validateAbilityRule({effects:[{kind:"ability:immunity",value:1,parameters:{moveClass:customMoveFlagFilter(kick)}}],conditions:all})],
  [169,validateAbilityRule({effects:[{kind:"ability:power",value:1.5,parameters:{moveClass:customMoveFlagFilter(kick)}}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}]}})],
 ]);
}
export const CUSTOM_FLAG_CASES=[
 {label:"custom-kick-power",abilityId:165,move:24,checks:{power:{move:24,value:45,type:1},enemyDamaged:true}},
 {label:"custom-kick-wrong-move",abilityId:165,move:33,checks:{power:{move:33,value:40,type:0},enemyDamaged:true}},
 {label:"custom-kick-wrong-tag",abilityId:166,move:24,checks:{power:{move:24,value:30,type:1},enemyDamaged:true}},
 {label:"custom-kick-conversion",abilityId:167,move:24,checks:{power:{move:24,value:60,type:14},enemyDamaged:true}},
 {label:"custom-kick-conversion-excluded",abilityId:167,move:33,checks:{power:{move:33,value:40,type:0}}},
 {label:"custom-kick-immunity",abilityId:168,enemyMove:24,checks:{noDamage:true,popupsByTurn:[0,1,1]}},
 {label:"custom-kick-and-or",abilityId:169,move:24,hp:60,checks:{power:{move:24,value:45,type:1}}},
 {label:"custom-kick-condition-false",abilityId:169,move:24,checks:{power:{move:24,value:30,type:1}}},
 {label:"custom-kick-suppressed",abilityId:165,move:24,enemyMove:380,enemyLevel:100,checks:{power:{move:24,value:30,type:1},suppressed:true,noMultiplier:6144}},
 {label:"custom-kick-swapped",abilityId:165,move:285,enemyMove:24,enemyLevel:30,checks:{playerAbilities:[165,50,165],power:{move:24,value:45,type:1}}},
];

export function customFlagCases(project:ProjectState){
 return CUSTOM_FLAG_CASES.map(spec=>{
  const power=spec.checks.power;
  if(!power)return spec;
  const raw=decodeRecord(project,"moves",power.move).raw!;
  const factor=power.value/(power.move===24?30:40);
  return{...spec,checks:{...spec.checks,power:{...power,value:Number(raw.power)*factor,type:spec.label==="custom-kick-conversion"?14:Number(raw.type)}}};
 });
}
