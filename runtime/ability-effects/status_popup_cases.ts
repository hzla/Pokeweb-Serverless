/** Status template activation cases shared by the BW1 and BW2 native runners. */
import { abilityImport } from "../../src/pokeweb/abilityLibrary";
import { ABILITY_RULE_PRESETS, validateAbilityRule, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";

export function statusPopupCases() {
  const rules = new Map<number, AbilityRuleSet>(), names = new Map<number, string>();
  const cases: Array<{label:string;abilityId:number;move?:number;enemyMove?:number;enemyLevel?:number;playerGender?:0|1;playerSpecies?:number;checks:Record<string,unknown>}> = [];
  const all: AbilityRuleSet["conditions"] = {kind:"group",mode:"all",children:[]};
  let next = 100;
  for (const [source,label,status,offensive] of [
    [9,"static",1,false], [38,"poison-point",5,false], [49,"copied-flame-body",4,false],
    [27,"effect-spore",undefined,false], [56,"cute-charm",undefined,false], [143,"poison-touch",5,true],
  ] as const) for (const chance of [1,100]) {
    const abilityId = next++;
    rules.set(abilityId,validateAbilityRule({effects:[{kind:`nativeAbility:${source}`,value:-1,...(source===143?{parameters:{activationChance:chance}}:{chance})}],conditions:all}));
    names.set(abilityId,label.replaceAll("-"," ").slice(0,15));
    // A female-only species makes Cute Charm's native gender prerequisite explicit.
    cases.push({label:`${label}-${chance===1?"failed-roll":"success"}`,abilityId,move:offensive?33:150,enemyMove:offensive?150:33,enemyLevel:offensive?100:30,playerGender:1,...(source===56?{playerSpecies:29}:{}),
      checks:chance===1?{enemyStatus:0,popupsByTurn:[0,0,0],statusPopupMatchesRolls:true,nativeStatusRolls:true,minimumFailedStatusRolls:1,abilityNamesByTurn:[0,0,0],oppositeGenders:source===56}:
        {...(status?{enemyStatusFirstTurn:status}:source===27?{enemyAnyStatusFirstTurn:[1,2,5]}:{enemyConditionPresent:7,oppositeGenders:true}),abilityNamesByTurn:[0,1,0],popupOwner:0}});
  }
  for (const [label,rule,offensive] of [
    ["flame-body-preset",ABILITY_RULE_PRESETS.find(p=>p.id===49)!.rule,false],
    ["toxic-chain-import",abilityImport(302).rule,true],
  ] as const) for (const chance of [1,100]) {
    const abilityId = next++;
    rules.set(abilityId,validateAbilityRule({...rule,effects:rule.effects.map(e=>({...e,chance}))}));
    names.set(abilityId,offensive?"Toxic Chain":"Flame Body");
    cases.push({label:`${label}-${chance===1?"failed-roll":"success"}`,abilityId,move:offensive?33:150,enemyMove:offensive?150:33,enemyLevel:offensive?100:30,
      checks:chance===1?{enemyStatus:0,popupsByTurn:[0,0,0],statusPopupMatchesRolls:true,minimumFailedStatusRolls:1,abilityNamesByTurn:[0,0,0]}:
        {enemyStatusFirstTurn:offensive?5:4,popupsByTurn:[0,1,0],abilityNamesByTurn:[0,1,0]}});
  }
  const synchronize = next++;
  rules.set(synchronize,validateAbilityRule({effects:[{kind:"nativeAbility:28",value:-1}],conditions:all}));names.set(synchronize,"Synchronize");
  // Thunder Wave is deterministic here; paralysis is reflected only once.
  cases.push({label:"synchronize-success",abilityId:synchronize,enemyMove:86,enemyLevel:30,checks:{status:1,enemyStatus:1,popupsByTurn:[0,1,0],abilityNamesByTurn:[0,1,0]}});
  cases.push({label:"synchronize-no-status",abilityId:synchronize,enemyMove:150,checks:{status:0,enemyStatus:0,popupsByTurn:[0,0,0],abilityNamesByTurn:[0,0,0]}});
  return {rules,names,cases};
}
