import {MOVE_ALWAYS,newMoveEffect,validateMoveRule,type MoveCondition,type MoveEffect,type MoveRuleSet} from "./moveRules";

type Template={sourceId:number;label:string;rule:MoveRuleSet};
const when=(kind:"moveFailed"|"statRaised"|"statLowered",subject:"user"|"target"):MoveCondition=>({kind,subject,value:1});
const power=(conditions:MoveCondition):MoveEffect=>({...newMoveEffect("power"),value:2,conditions});
const status=(value:number):MoveEffect=>({...newMoveEffect("status"),value,phase:"hit",target:"target",secondary:true,chance:100,conditions:when("statRaised","target")});
const counted=(source:number,limit:number):MoveEffect=>({...newMoveEffect("historyPower"),value:50,parameters:{source,limit}});
const gate=(conditions:MoveCondition,requireSuccess:number):MoveEffect=>({...newMoveEffect("selectionGate"),conditions,parameters:{requireSuccess}});
const template=(sourceId:number,label:string,effects:MoveEffect[],prerequisites:MoveCondition=MOVE_ALWAYS):Template=>({sourceId,label,rule:validateMoveRule({conditions:MOVE_ALWAYS,prerequisites,effects})});

export const MOVE_HISTORY_CANDIDATES:readonly Template[]=[
 template(562,"Belch",[gate({kind:"ateBerry",subject:"user",value:0},0)],{kind:"ateBerry",subject:"user",value:1}),
 template(707,"Stomping Tantrum",[power(when("moveFailed","user"))]),
 template(807,"Burning Jealousy",[status(4)]),
 template(808,"Lash Out",[power(when("statLowered","user"))]),
 template(854,"Last Respects",[counted(1,100)]),
 template(889,"Rage Fist",[counted(0,6)]),
 template(893,"Gigaton Hammer",[gate({kind:"selectedMove",subject:"user",value:0},1)]),
 template(901,"Blood Moon",[gate({kind:"selectedMove",subject:"user",value:0},1)]),
 template(914,"Alluring Voice",[{...newMoveEffect("bypassSubstitute")},status(6)]),
 template(915,"Temper Flare",[power(when("moveFailed","user"))]),
];
