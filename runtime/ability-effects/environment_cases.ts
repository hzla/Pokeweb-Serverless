import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import type {HarnessPokemon} from "../../src/pokeweb/battleHarness";
export function environmentCases(){
 const all:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]};
 const make=(effects:AbilityRuleSet["effects"],conditions=all)=>validateAbilityRule({effects,conditions});
 const guard=(sources:number)=>({kind:"abilityRecipe:damageGuard" as const,value:1,parameters:{sources}});
 const field=(condition=1,duration=2)=>({kind:"abilityRecipe:fieldEntry" as const,value:1,parameters:{condition,duration}});
 const side=(condition=4,duration=2,layers=1)=>({kind:"abilityRecipe:sideEntry" as const,value:1,parameters:{condition,duration,layers,side:condition>=6?1:0}});
 const rules=new Map<number,AbilityRuleSet>([
  [100,make([guard(3)])],[101,make([guard(1)])],[102,make([guard(2)])],
  [103,make([field()])],[104,make([side()])],[105,make([side(6,0,3)])],
  [106,make([guard(3)],{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"species",value:4}]}]})],
  [107,make([guard(1<<10)])],[108,make([guard(1<<8)])],[109,make([guard(32)])],
  [110,make([guard(16383)])],[111,make([field(2,3),side(0,3),side(1,3)])],
  [112,make([side()],{kind:"type",value:9})],[113,make([field(1,3)])],
  [114,make([guard(1),{kind:"nativeAbility:85",value:-1}])],
  [115,make([{kind:"nativeAbility:85",value:-1},guard(1)])],
 ]);
 const names=new Map([...rules.keys()].map(id=>[id,`Env ${id}`]));
 const cases:Array<{label:string;abilityId:number;enemyAbility?:number;enemyMove?:number;enemyLevel?:number;enemySpecies?:number;enemyCount?:number;playerSpecies?:number;move?:number;hp?:number;playerStatus?:"burn"|"poison";battleType?:"Doubles";ally?:HarnessPokemon;menuCount?:number;checks:Record<string,unknown>}>= [
  {label:"guard-burn-poison-burn",abilityId:100,playerStatus:"burn",checks:{hpByTurn:[120,120,120],status:4}},
  {label:"guard-burn-poison-poison",abilityId:100,playerStatus:"poison",checks:{hpByTurn:[120,120,120],status:5}},
  {label:"burn-only-allows-poison",abilityId:101,playerStatus:"poison",checks:{hpByTurn:[120,105,90],status:5}},
  {label:"poison-only-allows-burn",abilityId:102,playerStatus:"burn",checks:{hpByTurn:[120,105,90],status:4}},
  {label:"guard-and-or-active",abilityId:106,hp:50,playerStatus:"burn",checks:{hpByTurn:[50,50,50],status:4}},
  {label:"guard-and-or-inactive",abilityId:106,playerStatus:"burn",checks:{hpByTurn:[120,105,90],status:4}},
  {label:"guard-suppressed",abilityId:100,playerStatus:"burn",enemyMove:380,enemyLevel:100,checks:{hpByTurn:[120,105,90],suppressed:true}},
  {label:"guard-swapped",abilityId:100,playerStatus:"poison",enemyMove:285,enemyLevel:100,checks:{hpByTurn:[120,105,105],playerAbilities:[100,50,100]}},
  {label:"guard-allows-move-damage",abilityId:100,enemyMove:33,enemyLevel:5,checks:{weatherDamage:true}},
  {label:"guard-contact-retaliation",abilityId:107,enemyAbility:24,move:33,checks:{hpByTurn:[120,120,120]}},
  {label:"guard-burn-allows-contact",abilityId:101,enemyAbility:24,move:33,checks:{hpByTurn:[120,105,90]}},
  {label:"guard-leech-seed",abilityId:108,playerSpecies:4,enemyMove:73,checks:{noDamage:true,conditionPresent:18}},
  {label:"guard-selected-hail",abilityId:109,enemyAbility:117,checks:{hpByTurn:[120,120,120]}},
  {label:"guard-hail-allows-sand",abilityId:109,enemyAbility:45,checks:{hpByTurn:[120,113,106]}},
  {label:"entry-trick-room-expires",abilityId:103,checks:{fieldActive:{condition:1,values:[true,true,false]},popupsByTurn:[1,0,0]}},
  {label:"entry-tailwind-expires",abilityId:104,checks:{nativeSide:{condition:4,side:0,layers:[1,1,0]},popupsByTurn:[1,0,0]}},
  {label:"entry-spikes-three-layers",abilityId:105,checks:{nativeSide:{condition:6,side:1,layers:[3,3,3]},popupsByTurn:[1,0,0]}},
  {label:"entry-condition-inactive",abilityId:112,checks:{nativeSide:{condition:4,side:0,layers:[0,0,0]},popupsByTurn:[0,0,0]}},
  {label:"entry-ability-gain",abilityId:50,enemyAbility:104,move:285,checks:{nativeSide:{condition:4,side:0,layers:[0,1,0]},playerAbilities:[50,104,50]}},
  {label:"entry-existing-field-no-popup",abilityId:113,enemyAbility:113,checks:{fieldActive:{condition:1,values:[true,true,true]},popupsByTurn:[1,0,0],allPopupsByTurn:[1,0,0]}},
  {label:"entry-grouped-conditions",abilityId:111,enemyMove:45,checks:{fieldActive:{condition:2,values:[true,true,true]},nativeSide:{condition:0,side:0,layers:[1,1,1]},popupsByTurn:[1,0,0]}},
  {label:"guard-before-heatproof",abilityId:114,playerStatus:"burn",checks:{hpByTurn:[120,120,120],status:4}},
  {label:"guard-after-heatproof",abilityId:115,playerStatus:"burn",checks:{hpByTurn:[120,120,120],status:4}},
 ];
 return {rules,names,cases};
}
