import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import {abilityImport} from "../../src/pokeweb/abilityLibrary";
import type {environmentCases} from "./environment_cases";

/** Hit-through-protection fixtures. Expected evidence comes from the
 * emulator-only PROTECT_TEST log (see protect.c), read by run_protect_cases.ts. */
export function protectCases():ReturnType<typeof environmentCases>&{cases:Array<ReturnType<typeof environmentCases>["cases"][number]&{playerMoves?:number[];turnMove?:number[]}>}{
 const all:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]};
 const rules=new Map<number,AbilityRuleSet>([
  [100,abilityImport(260).rule],[101,abilityImport(1000).rule],
  [102,validateAbilityRule({effects:[{kind:"abilityRecipe:protectBypass",value:.5,parameters:{moveClass:0}}],conditions:all})],
  [103,validateAbilityRule({...abilityImport(1000).rule,conditions:{kind:"type",value:9}})],
 ]);
 const names=new Map([[100,"Unseen Fist"],[101,"Piercing Drill"],[102,"Any Drill"],[103,"Fire Drill"]]);
 const protect=182,detect=197,quickGuard=501,wideGuard=469,tackle=33,quick=98,waterGun=55,earthquake=89,seismicToss=69,gastroAcid=380,skillSwap=285;
 const doubles={battleType:"Doubles" as const,enemyCount:2,ally:{speciesId:1,level:50,moves:[150],abilityId:50}};
 // checks.protect: per move use by the holder side: "hit" (damage, multiplier) or "blocked".
 const cases:ReturnType<typeof protectCases>["cases"]=[
  {label:"unseen-fist-protect",abilityId:100,move:tackle,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{bypass:1,multiplier:4096}}}},
  {label:"piercing-drill-protect",abilityId:101,move:tackle,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{bypass:1,multiplier:1024}}}},
  {label:"piercing-drill-detect",abilityId:101,move:tackle,enemyMove:detect,enemyLevel:100,checks:{protect:{first:{bypass:1,multiplier:1024}}}},
  {label:"piercing-drill-unprotected",abilityId:101,move:tackle,enemyMove:150,checks:{protect:{first:{multiplier:4096,protected:0}}}},
  {label:"piercing-drill-noncontact",abilityId:101,move:waterGun,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{blocked:true}}}},
  {label:"control-protect",abilityId:50,move:tackle,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{blocked:true}}}},
  {label:"piercing-drill-condition-false",abilityId:103,move:tackle,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{blocked:true}}}},
  {label:"piercing-drill-fixed-damage",abilityId:101,move:seismicToss,enemyMove:protect,enemyLevel:100,checks:{protect:{first:{bypass:1,damage:50,noDamageStage:true}}}},
  {label:"unseen-fist-quick-guard",abilityId:100,move:quick,enemyMove:quickGuard,enemyLevel:100,checks:{protect:{first:{paused:1,multiplier:4096}}}},
  {label:"piercing-drill-quick-guard",abilityId:101,move:quick,enemyMove:quickGuard,enemyLevel:100,checks:{protect:{first:{paused:1,multiplier:1024}}}},
  {label:"control-quick-guard",abilityId:50,move:quick,enemyMove:quickGuard,enemyLevel:100,checks:{protect:{first:{blocked:true}}}},
  {label:"any-drill-wide-guard",abilityId:102,move:earthquake,enemyMove:wideGuard,enemyLevel:100,...doubles,checks:{protect:{first:{paused:1,multiplier:2048,allyMultiplier:4096}}}},
  {label:"control-wide-guard",abilityId:50,move:earthquake,enemyMove:wideGuard,enemyLevel:100,...doubles,checks:{protect:{first:{blocked:true}}}},
  // The opponent holds the ability; the player protects.
  {label:"enemy-piercing-drill",abilityId:50,move:protect,enemyAbility:101,enemyMove:tackle,enemyLevel:30,checks:{protect:{enemy:{bypass:1,multiplier:1024}}}},
  {label:"enemy-piercing-drill-suppressed",abilityId:50,playerMoves:[gastroAcid,protect],turnMove:[0,1],enemyAbility:101,enemyMove:tackle,enemyLevel:30,menuCount:2,checks:{protect:{enemySecond:{blocked:true}}}},
  {label:"enemy-gains-piercing-drill",abilityId:101,playerMoves:[skillSwap,protect],turnMove:[0,1],enemyMove:tackle,enemyLevel:30,menuCount:2,checks:{protect:{enemySecond:{bypass:1,multiplier:1024}}}},
 ];
 return {rules,names,cases};
}
