/** Ability-only stat prevention, shared by the native BW1/BW2 battle runners. */
import {abilityImport} from "../../src/pokeweb/abilityLibrary";
import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
export function statSourceCases(includeItem=false){
 const all:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]};
 const guard={kind:"abilityRecipe:abilityStatGuard" as const,value:1};
 const make=(effects:AbilityRuleSet["effects"],conditions=all)=>validateAbilityRule({effects,conditions});
 const rules=new Map<number,AbilityRuleSet>([
  [100,make([guard])],[101,make([{...guard,parameters:{stat:3}}])],
  [102,make([guard],{kind:"type",value:9})],
  [103,make([guard,{kind:"nativeAbility:133",value:-1}])],
  [104,make([{kind:"nativeAbility:22",value:-1},{kind:"nativeAbility:22",value:-1,stat:3}])],[105,abilityImport(183).rule],
  [109,make([guard,{kind:"nativeAbility:86",value:-1}])],
  [110,make([guard,{kind:"nativeAbility:126",value:-1}])],
  [111,make([{kind:"abilityRecipe:statAction",value:1,parameters:{stat:1,scope:2}}])],
  [108,make([guard,{kind:"abilityRecipe:statAction",value:-6,parameters:{stat:1}}])],
  [106,make([guard,{...guard,parameters:{stat:3}}])],[107,make([{kind:"nativeAbility:22",value:-1,stat:3}])],
 ]);
 const names=new Map([...rules.keys()].map(id=>[id,id===100?"Ability Guard":`Guard Test ${id}`]));
 const neutral=[6,6,6,6,6,6,6],stage=(stat:number,value:number)=>neutral.map((v,i)=>i===stat-1?value:v);
 const cases:Array<{label:string;abilityId:number;enemyAbility?:number;enemyItem?:number;enemyMove?:number;enemyLevel?:number;move?:number;checks:Record<string,unknown>}>=[
  {label:"guard-intimidate",abilityId:100,enemyAbility:22,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-scare",abilityId:100,enemyAbility:107,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-multi-stat-once",abilityId:106,enemyAbility:104,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0],allPopupsByTurn:[2,0,0]}},
  {label:"guard-filter-allows-attack",abilityId:101,enemyAbility:22,checks:{stages:stage(1,5),popupOwner:0,popupsByTurn:[0,0,0]}},
  {label:"guard-filter-blocks-spatk",abilityId:101,enemyAbility:107,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-condition-false",abilityId:102,enemyAbility:22,checks:{stages:stage(1,5),popupOwner:0,popupsByTurn:[0,0,0]}},
  {label:"guard-gooey",abilityId:100,enemyAbility:105,move:33,checks:{stages:neutral,popupOwner:0,popupsByTurn:[0,1,1]}},
  {label:"guard-growl-unaffected",abilityId:100,enemyMove:45,checks:{playerStagesByTurn:[neutral,stage(1,5),stage(1,4)],popupOwner:0,popupsByTurn:[0,0,0]}},
  {label:"guard-own-weak-armor",abilityId:103,enemyMove:33,enemyLevel:30,checks:{playerStagesByTurn:[neutral,[6,5,6,6,7,6,6],[6,4,6,6,8,6,6]]}},
  {label:"guard-suppressed",abilityId:100,enemyAbility:105,enemyMove:380,enemyLevel:100,move:33,checks:{suppressed:true,speedStages:[6,5,4],popupOwner:0,popupsByTurn:[0,0,0]}},
  {label:"guard-floor-no-extra-popup",abilityId:108,enemyAbility:22,enemyLevel:30,checks:{stages:stage(1,0),popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-simple",abilityId:109,enemyAbility:22,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-contrary-allows-rise",abilityId:110,enemyAbility:22,checks:{stages:stage(1,7),popupOwner:0,popupsByTurn:[0,0,0]}},
  {label:"guard-contrary-blocks-drop",abilityId:110,enemyAbility:111,enemyLevel:30,checks:{stages:neutral,popupOwner:0,popupsByTurn:[1,0,0]}},
  {label:"guard-skill-swap",abilityId:100,enemyAbility:22,enemyMove:285,checks:{stages:neutral,enemyStages:neutral,playerAbilities:[100,22,100],enemyAbilities:[22,100,22]}},
 ];
 if(includeItem)cases.push({label:"guard-other-item-unaffected",abilityId:100,enemyAbility:50,enemyItem:85,move:33,checks:{speedStages:[6,5,4],popupOwner:0,popupsByTurn:[0,0,0]}});
 return {rules,names,cases};
}
