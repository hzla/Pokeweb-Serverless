import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import type {environmentCases} from "./environment_cases";

export function strikeCases():ReturnType<typeof environmentCases>{
 const all:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]};
 const make=(value:number,conditions:AbilityRuleSet["conditions"]=all)=>validateAbilityRule({effects:[{kind:"abilityRecipe:additionalStrike",value}],conditions});
 const rules=new Map<number,AbilityRuleSet>([
  [100,make(.25)],[101,make(.5)],
  [102,make(.25,{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"species",value:4}]}]})],
  [103,make(.25,{kind:"moveType",value:0})],[104,make(.25,{kind:"moveType",value:9})],
  [105,make(.25,{kind:"weather",value:1})],
  [106,validateAbilityRule({effects:[{kind:"abilityRecipe:additionalStrike",value:.25},{kind:"attack",value:2}],conditions:all})],
 ]);
 const cases:ReturnType<typeof environmentCases>["cases"]=[
  {label:"strike-quarter",abilityId:100,move:33,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024],noAbilityWeatherQueries:true}},
  {label:"strike-edited-half",abilityId:101,move:33,checks:{outgoingHits:[2,2],strikeMultipliers:[2048,2048]}},
  {label:"strike-condition-true",abilityId:102,move:33,hp:50,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024]}},
  {label:"strike-condition-false",abilityId:102,move:33,checks:{outgoingHits:[1,1],strikeMultipliers:[]}},
  {label:"strike-move-type-true",abilityId:103,move:33,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024]}},
  {label:"strike-move-type-false",abilityId:104,move:33,checks:{outgoingHits:[1,1],strikeMultipliers:[]}},
  {label:"strike-native-multihit",abilityId:100,move:24,checks:{outgoingHits:[2,2],strikeMultipliers:[]}},
  {label:"strike-suppressed",abilityId:100,move:33,enemyMove:380,enemyLevel:100,checks:{outgoingHits:[1,1],strikeMultipliers:[],suppressed:true}},
  {label:"strike-swapped",abilityId:50,enemyAbility:100,enemyMove:33,move:285,enemyLevel:60,checks:{incomingHits:[2,1],strikeMultipliers:[1024],playerAbilities:[50,100,50]}},
  {label:"strike-protect",abilityId:100,move:33,enemyMove:182,enemyLevel:100,menuCount:2,checks:{outgoingHits:[0],strikeMultipliers:[]}},
  {label:"strike-immunity",abilityId:100,move:33,enemySpecies:92,checks:{outgoingHits:[0,0],strikeMultipliers:[]}},
  {label:"strike-spread-doubles",abilityId:100,move:89,battleType:"Doubles",enemyCount:2,ally:{speciesId:16,level:50,moves:[150],abilityId:50},checks:{outgoingHits:[2,2],strikeMultipliers:[]}},
  {label:"strike-contact-reactions",abilityId:100,move:33,enemyAbility:24,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024],hpByTurn:[120,90,60]}},
  {label:"strike-first-hit-ko",abilityId:100,move:33,enemyLevel:1,enemyCount:2,menuCount:2,checks:{outgoingHits:[1],strikeMultipliers:[]}},
  {label:"strike-weather",abilityId:105,move:33,enemyAbility:70,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024],abilityWeatherQueryCount:2}},
  {label:"strike-weather-doubles",abilityId:105,move:33,enemyAbility:105,enemyMove:33,enemyLevel:30,enemyCount:2,battleType:"Doubles",ally:{speciesId:16,level:50,moves:[150],abilityId:70},checks:{outgoingHits:[2,2],abilityWeatherQueriesAtMost:6}},
  {label:"strike-composed",abilityId:106,move:33,checks:{outgoingHits:[2,2],strikeMultipliers:[1024,1024],multiplier:8192}},
 ];
 return {rules,names:new Map([...rules.keys()].map(id=>[id,`Strike ${id}`])),cases};
}
