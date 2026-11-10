import {validateAbilityRule,type AbilityRuleSet} from '../../src/pokeweb/abilityRules';
import {abilityImport} from '../../src/pokeweb/abilityLibrary';
import type {weatherCases} from './weather_cases';
export function statusCases(){
 const rules=new Map<number,AbilityRuleSet>([[100,abilityImport(239).rule],[101,abilityImport(310).rule],[102,abilityImport(212).rule],[103,abilityImport(277).rule]]);
 const edit=(id:number,base:number,parameters:Record<string,number>,value?:number,conditions?:AbilityRuleSet['conditions'])=>rules.set(id,validateAbilityRule({...rules.get(base)!,effects:rules.get(base)!.effects.map(e=>({...e,value:value??e.value,parameters:{...e.parameters,...parameters}})),...(conditions?{conditions}:{})}));
 edit(104,103,{moveClass:1},1.5);edit(105,101,{condition:4});edit(106,102,{condition:4,type:9,secondType:18});edit(107,100,{moveClass:1});
 const falseCondition:AbilityRuleSet['conditions']={kind:'group',mode:'all',children:[{kind:'type',value:9},{kind:'group',mode:'any',children:[{kind:'hp',comparison:'lt',percent:50},{kind:'weather',value:1}]}]};
 for(const[id,base]of [[108,101],[109,102],[110,103],[111,100]])edit(id,base,{},undefined,falseCondition);
 rules.set(112,validateAbilityRule({effects:[{kind:"abilityRecipe:sideEntry",value:1,parameters:{condition:4,side:0,duration:4,layers:1}}],conditions:{kind:"group",mode:"all",children:[]}}));
 rules.set(113,validateAbilityRule({effects:[...abilityImport(277).rule.effects,{kind:"abilityRecipe:convertType",value:1,parameters:{moveClass:5,sourceType:18,type:10}}],conditions:{kind:"group",mode:"all",children:[]}}));
 const names=new Map([...rules].map(([id])=>[id,`Status ${id}`]));
 const cases:Array<ReturnType<typeof weatherCases>['cases'][number]&{enemy2Ability?:number;enemy2Move?:number}>=[
  {label:'puppeteer-toxic',abilityId:101,move:92,checks:{extension:{statuses:[5,6]}}},
  {label:'puppeteer-status-fails',abilityId:101,move:92,enemySpecies:1,checks:{extension:{absent:[5,6]}}},
  {label:'puppeteer-suppressed',abilityId:101,move:92,enemyMove:380,enemyLevel:100,checks:{extension:{statuses:[5],absent:[6]}}},
  {label:'puppeteer-swapped',abilityId:50,move:92,enemyMove:285,enemyLevel:100,enemyAbility:101,checks:{extension:{statuses:[5,6]}}},
  {label:'puppeteer-synchronize',abilityId:101,move:92,enemyAbility:28,checks:{extension:{statuses:[5,6]}}},
  {label:'puppeteer-own-tempo',abilityId:101,move:92,enemyAbility:20,checks:{extension:{statuses:[5],absent:[6]}}},
  {label:'puppeteer-condition-false',abilityId:108,move:92,checks:{extension:{statuses:[5],absent:[6]}}},
  {label:'puppeteer-edited-burn',abilityId:105,move:261,checks:{extension:{statuses:[4,6]}}},
  {label:'corrosion-poison-type',abilityId:102,move:92,enemySpecies:1,checks:{extension:{statuses:[5]}}},
  {label:'corrosion-steel-type',abilityId:102,move:92,enemySpecies:436,checks:{extension:{statuses:[5]}}},
  {label:'corrosion-safeguard',abilityId:102,move:92,enemySpecies:1,enemyMove:219,enemyLevel:100,checks:{extension:{absent:[5]}}},
  {label:'corrosion-immunity',abilityId:102,move:92,enemySpecies:1,enemyAbility:17,checks:{extension:{absent:[5]}}},
  {label:'corrosion-condition-false',abilityId:109,move:92,enemySpecies:1,checks:{extension:{absent:[5]}}},
  {label:'corrosion-edited-burn',abilityId:106,move:261,enemySpecies:4,checks:{extension:{statuses:[4]}}},
  {label:'corrosion-suppressed',abilityId:102,move:92,enemySpecies:1,enemyMove:380,enemyLevel:100,checks:{extension:{absent:[5]}}},
  {label:'corrosion-swapped',abilityId:50,move:92,enemySpecies:1,enemyMove:285,enemyLevel:100,enemyAbility:102,checks:{extension:{statuses:[5]}}},
  {label:'corrosion-damage-immunity',abilityId:102,move:51,enemySpecies:436,checks:{extension:{noPlayerHits:true}}},
  {label:'wind-power',abilityId:103,move:85,playerSpecies:25,enemyMove:16,enemyLevel:70,menuCount:2,checks:{extension:{ratio:8192}}},
  {label:'wind-power-edited',abilityId:104,move:85,playerSpecies:376,enemyMove:33,enemyLevel:70,menuCount:2,checks:{extension:{ratio:6144}}},
  {label:'wind-power-wrong-flag',abilityId:103,move:85,playerSpecies:25,enemyMove:52,enemyLevel:70,menuCount:2,checks:{extension:{noRatio:8192}}},
  {label:'wind-power-condition-false',abilityId:110,move:85,playerSpecies:25,enemyMove:16,enemyLevel:70,menuCount:2,checks:{extension:{noRatio:8192}}},
  {label:'wind-power-tailwind',abilityId:103,move:366,playerSpecies:25,playerMoves:[366,85],turnMove:[0,1],menuCount:2,checks:{extension:{ratio:8192}}},
  {label:'wind-power-converted-electric',abilityId:113,playerMoves:[496,85],turnMove:[0,1],playerSpecies:376,enemyMove:16,enemyLevel:100,menuCount:2,checks:{extension:{ratio:8192,firstType:10}}},
  {label:'wind-power-native-charge',abilityId:103,playerMoves:[268,85],turnMove:[0,1],playerSpecies:376,enemyMove:16,enemyLevel:100,menuCount:2,checks:{extension:{ratio:8192,noRatio:16384}}},
  {label:'wind-charge-after-swap',abilityId:103,playerMoves:[285,85],turnMove:[0,1],playerSpecies:213,enemyMove:150,enemy2Move:150,enemyLevel:100,battleType:'Doubles',enemyCount:2,ally:{speciesId:1,level:50,moves:[150],abilityId:112},menuCount:2,checks:{extension:{ratio:8192,ability:50}}},
  {label:'wind-charge-after-suppression',abilityId:103,playerMoves:[266,85],turnMove:[0,1],playerSpecies:213,enemyMove:380,enemy2Move:150,enemyLevel:100,battleType:'Doubles',enemyCount:2,ally:{speciesId:1,level:50,moves:[150],abilityId:112},menuCount:2,checks:{extension:{ratio:8192,ability:0}}},
  {label:'propeller-lightning-rod',abilityId:100,move:85,enemySpecies:320,enemyLevel:30,enemyAbility:31,enemy2Ability:50,battleType:'Doubles',enemyCount:2,checks:{extension:{selectedTarget:true}}},
  {label:'propeller-follow-me',abilityId:100,move:33,enemyLevel:30,enemyMove:266,enemy2Move:150,battleType:'Doubles',enemyCount:2,checks:{extension:{selectedTarget:true}}},
  {label:'propeller-reflection',abilityId:100,playerSpecies:25,move:92,enemyAbility:156,checks:{extension:{playerStatus:5}}},
  {label:'propeller-selected-immunity',abilityId:100,move:85,enemyLevel:30,enemyAbility:50,enemy2Ability:31,battleType:'Doubles',enemyCount:2,checks:{extension:{noPlayerHits:true}}},
  {label:'propeller-control',abilityId:50,move:85,enemyLevel:30,enemyAbility:31,enemy2Ability:50,battleType:'Doubles',enemyCount:2,checks:{extension:{noPlayerHits:true}}},
  {label:'propeller-edited-filter',abilityId:107,move:85,enemyLevel:30,enemyAbility:31,enemy2Ability:50,battleType:'Doubles',enemyCount:2,checks:{extension:{noPlayerHits:true}}},
  {label:'propeller-condition-false',abilityId:111,move:85,enemyLevel:30,enemyAbility:31,enemy2Ability:50,battleType:'Doubles',enemyCount:2,checks:{extension:{noPlayerHits:true}}},
  {label:'propeller-suppressed',abilityId:100,move:85,playerMoves:[266,85],turnMove:[0,1],menuCount:2,enemyLevel:100,enemyMove:380,enemyAbility:31,enemy2Ability:50,battleType:'Doubles',enemyCount:2,checks:{extension:{noPlayerHits:true,ability:0}}},
 ];
 for(const c of cases)if(c.battleType==="Doubles"){
  c.ally??={speciesId:1,level:50,moves:[150],abilityId:50};
  if(c.turnMove)c.ally.moves=[150,150];
 }
 return {rules,names,cases};
}
