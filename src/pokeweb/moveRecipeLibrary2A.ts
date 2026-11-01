import { MOVE_ALWAYS,newMoveEffect,validateMoveRule,type MoveEffect,type MoveRuleSet,type MoveCondition,type MoveSubject } from "./moveRules";
/** Editable transaction and composed-operation templates. */
const effect=(kind:string,value:number,parameters?:Record<string,number>,target:MoveEffect["target"]="user",phase:MoveEffect["phase"]="status"):MoveEffect=>({...newMoveEffect(kind),value,phase,secondary:false,target,parameters});
const recipe=(sourceId:number,label:string,effects:MoveEffect[],prerequisites=MOVE_ALWAYS,nativeBase?:number)=>({sourceId,label,rule:validateMoveRule({effects,conditions:structuredClone(MOVE_ALWAYS),prerequisites,nativeBase})});
const type=(value:number,subject:MoveSubject="target",negate=false):MoveCondition=>({kind:"type",subject,value,negate});
const condition=(e:MoveEffect,c:MoveCondition):MoveEffect=>({...e,conditions:c});
const trap=(secondary:boolean)=>({...condition(effect("sourceCondition",22,undefined,"target","afterRealHits"),type(7,"target",true)),secondary});
const visible:MoveCondition={kind:"hidden",subject:"target",value:0};
const allyHeal=(typed=false)=>condition(effect("heal",1,{denominator:4,...(typed?{immunityType:11}:{})},"allies"),visible);
const allyCure=()=>condition(effect("cure",0,undefined,"allies"),visible);
export const MOVE_STAGE2A_CANDIDATES:readonly {sourceId:number;label:string;rule:MoveRuleSet}[]=[
 recipe(668,"Strength Sap",[effect("statDrain",1,{stat:1,denominator:1,change:-1},"target")],{kind:"stage",subject:"target",stat:1,comparison:"gt",value:0}),
 recipe(685,"Purify",[effect("cureAndHeal",1,{denominator:2,condition:0},"target")]),
 recipe(747,"Stuff Cheeks",[effect("berryBoost",2,{stats:2})],{kind:"berry",subject:"user",value:1}),
 recipe(752,"Teatime",[effect("useBerry",1,undefined,"target")]),
 recipe(775,"Clangorous Soul",[effect("hpCostBoost",1,{stats:31,numerator:33,denominator:100})]),
 recipe(868,"Fillet Away",[effect("hpCostBoost",2,{stats:21,numerator:1,denominator:2})]),
 recipe(827,"Dire Claw",[{...newMoveEffect("randomStatus"),target:"target",value:19,chance:50}]),
 recipe(593,"Hyperspace Hole",[],MOVE_ALWAYS,364),
 recipe(615,"Thousand Waves",[trap(false)]),
 recipe(662,"Spirit Shackle",[trap(true)]),
 recipe(677,"Anchor Shot",[trap(true)]),
 recipe(682,"Burn Up",[effect("changeType",9,{operation:1},"user","execute")],type(9,"user")),
 recipe(892,"Double Shock",[effect("changeType",12,{operation:1},"user","execute")],type(12,"user")),
 recipe(683,"Speed Swap",[effect("swapRawStat",5,undefined,"target")]),
 recipe(687,"Core Enforcer",[condition(effect("suppressAbility",1,undefined,"target","afterRealHits"),{kind:"targetActed",subject:"target",value:1})]),
 recipe(712,"Spectral Thief",[effect("stealStages",127,undefined,"target","beforeDamage")]),
 recipe(713,"Sunsteel Strike",[effect("ignoreAbilities",1,undefined,"user","sequenceStart")]),
 recipe(714,"Moongeist Beam",[effect("ignoreAbilities",1,undefined,"user","sequenceStart")]),
 recipe(720,"Mind Blown",[effect("maxHpRecoil",1,{denominator:2,trigger:0,rockHead:0},"user","sequenceEnd")]),
 recipe(796,"Steel Beam",[effect("maxHpRecoil",1,{denominator:2,trigger:0,rockHead:0},"user","sequenceEnd")]),
 recipe(835,"Chloroblast",[effect("maxHpRecoil",1,{denominator:2,trigger:1,rockHead:1},"user","sequenceEnd")]),
 recipe(738,"Sappy Seed",[{...condition(effect("sourceCondition",18,undefined,"target","hit"),type(11,"target",true)),secondary:true}]),
 recipe(750,"Magic Powder",[effect("changeType",13,undefined,"target")],type(11,"target",true)),
 recipe(791,"Life Dew",[allyHeal(true)]),
 recipe(816,"Jungle Healing",[allyCure(),allyHeal()]),
 recipe(849,"Lunar Blessing",[allyCure(),allyHeal()]),
 recipe(809,"Poltergeist",[effect("requireHeldItem",1,undefined,"target","beforeDamage")]),
 recipe(810,"Corrosive Gas",[effect("removeItem",1,undefined,"target")]),
 recipe(826,"Eerie Spell",[{...effect("reducePP",3,undefined,"target","hit"),secondary:true},effect("bypassSubstitute",1,undefined,"user","beforeDamage")]),
 recipe(830,"Stone Axe",[{...effect("hazard",8,{side:1},"user","hitSide"),secondary:true}]),
 recipe(845,"Ceaseless Edge",[{...effect("hazard",6,{side:1},"user","hitSide"),secondary:true}]),
 recipe(866,"Mortal Spin",[{...effect("status",5,undefined,"target","hit"),secondary:true},effect("native",229,undefined,"user","hitSide")]),
 recipe(867,"Doodle",[effect("copyAbility",1,{allies:1})]),
 recipe(882,"Tidy Up",[effect("tidyField",1,{hazards:15,substitutes:1}),effect("statStage",1,{stat:1}),effect("statStage",1,{stat:5})]),
];
export const MOVE_STAGE2A_ENABLED:readonly number[]=MOVE_STAGE2A_CANDIDATES.map(t=>t.sourceId);
