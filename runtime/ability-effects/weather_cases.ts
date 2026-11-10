import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import {abilityImport} from "../../src/pokeweb/abilityLibrary";
import type {environmentCases} from "./environment_cases";

/** Simulated move weather (Mega Sol and variants) fixtures. Evidence comes from
 * the emulator-only WEATHER_TEST log (see weather.c), read by run_weather_cases.ts. */
export function weatherCases():ReturnType<typeof environmentCases>&{cases:Array<ReturnType<typeof environmentCases>["cases"][number]&{playerMoves?:number[];turnMove?:number[]}>}{
 const rules=new Map<number,AbilityRuleSet>([
  [100,abilityImport(1001).rule],[101,abilityImport(1002).rule],[102,abilityImport(1003).rule],[103,abilityImport(1004).rule],
  [104,validateAbilityRule({...abilityImport(1001).rule,conditions:{kind:"type",value:9}})],
 ]);
 const names=new Map([[100,"Mega Sol"],[101,"Mega Rain"],[102,"Mega Hail"],[103,"Mega Sand"],[104,"Fire Sol"]]);
 const weatherBall=311,solarBeam=76,rainDance=240,gastroAcid=380,splash=150,cloudNine=13;
 // checks.weather: player's first move (type at the damage stage, whether it hit on that use), opponent's first move type, residual weather damage.
 const cases:ReturnType<typeof weatherCases>["cases"]=[
  {label:"mega-sol-weather-ball",abilityId:100,move:weatherBall,checks:{weather:{player:{type:9,scope:1}}}},
  {label:"mega-rain-weather-ball",abilityId:101,move:weatherBall,checks:{weather:{player:{type:10,scope:2}}}},
  {label:"mega-hail-weather-ball",abilityId:102,move:weatherBall,checks:{weather:{player:{type:14,scope:3}}}},
  {label:"mega-sand-weather-ball",abilityId:103,move:weatherBall,checks:{weather:{player:{type:5,scope:4}}}},
  {label:"control-weather-ball",abilityId:50,move:weatherBall,checks:{weather:{player:{type:0,scope:0}}}},
  {label:"mega-sol-replaces-real-rain",abilityId:100,move:weatherBall,enemyMove:rainDance,enemyLevel:100,checks:{weather:{player:{type:9,scope:1}}}},
  {label:"control-real-rain",abilityId:50,move:weatherBall,enemyMove:rainDance,enemyLevel:100,checks:{weather:{player:{type:10,scope:0}}}},
  {label:"mega-sol-solar-beam-one-turn",abilityId:100,move:solarBeam,checks:{weather:{player:{type:11,scope:1,hitFirstUse:true}}}},
  {label:"control-solar-beam-charges",abilityId:50,move:solarBeam,checks:{weather:{player:{hitFirstUse:false}}}},
  {label:"opponent-weather-ball-unaffected",abilityId:100,move:splash,enemyMove:weatherBall,enemyLevel:30,checks:{weather:{enemy:{type:0}}}},
  {label:"mega-sol-cloud-nine",abilityId:100,move:weatherBall,enemyAbility:cloudNine,checks:{weather:{player:{type:9,scope:1}}}},
  {label:"mega-sol-suppressed",abilityId:100,move:weatherBall,enemyMove:gastroAcid,enemyLevel:100,checks:{weather:{player:{type:0,scope:0}}}},
  {label:"mega-sol-condition-false",abilityId:104,move:weatherBall,checks:{weather:{player:{type:0,scope:0}}}},
  {label:"mega-hail-no-residual",abilityId:102,move:splash,menuCount:2,checks:{weather:{noWeatherDamage:true}}},
 ];
 return {rules,names,cases};
}
