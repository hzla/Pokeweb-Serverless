/** Disposable in-game history fixture; output must be outside the repository. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureMoveRuleSets,inspectMoveEffects,MOVE_EFFECTS_DLL_PATH} from "../../src/pokeweb/moveEffectsModel";
import {configureAbilityRuleSets} from "../../src/pokeweb/abilityEffectsModel";
import {configureItemRuleSets} from "../../src/pokeweb/itemEffectsModel";
import {MOVE_ALWAYS,newMoveEffect,type MoveCondition} from "../../src/pokeweb/moveRules";
import {MOVE_HISTORY_CANDIDATES} from "../../src/pokeweb/moveRecipeLibraryHistory";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import {parseHarnessConfig,patchHarnessTrainer,patchHarnessSave} from "../../src/pokeweb/battleHarness";
import {buildTestBattleDownloads,rawSaveBytesFromDesmumeDsv} from "../../src/pokeweb/testBattle";
import {NintendoDSRom} from "../../src/nds/rom";
import {parseRpm} from "../../src/pokeweb/rpm";
import {readU32} from "../../src/nds/binary";

const [path,out,kind="statLowered",mode="positive"]=process.argv.slice(2);assert(path&&out);
await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets are permitted.");return new Response(new Uint8Array(await readFile(url)));}) as typeof fetch;
const source=new Uint8Array(await readFile(path));const project=await loadProjectFromRomBytes(source,"history-battle.nds",{selectedNarcs:["personal","items","moves","message_texts","trdata","trpok"]});
const raw=decodeRecord(project,"moves",33).raw!;raw.type=0;raw.category=1;raw.power=40;raw.accuracy=101;raw.pp=30;raw.hits=0;markDirty(project,"moves",33);
if(kind==="mutualTrap"&&mode==="negative"){raw.type=16;markDirty(project,"moves",33);}
if(["targetType","fieldStatus","selfTrap","octolock","powder","focus","focusCombined","critBoost","critTransform","critPass","fieldLock"].includes(kind)){raw.category=0;raw.power=0;markDirty(project,"moves",33);}
const combined=kind==="suppression"||kind==="swap"||kind==="focusCombined";
const priorFailure=kind==="immuneFailure"||kind==="missFailure";
if(priorFailure){
 const second=decodeRecord(project,"moves",52).raw!;second.category=1;second.power=40;second.accuracy=101;second.pp=30;markDirty(project,"moves",52);
 if(kind==="missFailure"){raw.accuracy=1;markDirty(project,"moves",33);}
}
const condition={kind:combined||kind==="pluck"?"ateBerry":kind==="moveFailedProtect"||priorFailure?"moveFailed":kind==="calledMove"?"selectedMove":kind==="historyBurn"?"statRaised":kind,subject:["statRaised","partyFaints","historyBurn"].includes(kind)?"target":"user",value:kind==="calledMove"?214:kind==="selectedMove"?(mode==="edited"?34:33):["hitsTaken","partyFaints"].includes(kind)&&mode==="edited"?2:["ateBerry","moveFailed","statRaised","statLowered","historyBurn"].includes(kind)&&mode==="edited"?0:1,...(mode==="negative"?{negate:true}:{})} as MoveCondition;
const effect=kind==="fieldLock"?newMoveEffect("fieldSwitchLock"):["critBoost","critTransform","critPass"].includes(kind)?{...newMoveEffect("criticalStageBoost"),parameters:{type:15,enhanced:2}}:["focus","focusCombined"].includes(kind)?{...newMoveEffect("focusCritical"),value:2}:kind==="soundBlock"?{...newMoveEffect("blockMoveFlag"),value:8,secondary:true,parameters:{turns:2}}:kind==="powder"?{...newMoveEffect("powderReaction"),value:9,parameters:{denominator:mode==="edited"?5:4}}:kind==="mutualTrap"?{...newMoveEffect("mutualTrap")}:kind==="selfTrap"?{...newMoveEffect("selfTrapBoost"),parameters:{stats:31}}:kind==="fieldStatus"?{...newMoveEffect("fieldMoveType"),value:12,parameters:{fromType:0}}:kind==="fieldType"?{...newMoveEffect("fieldMoveType"),phase:"afterRealHits" as const,value:12,parameters:{fromType:0}}:kind==="targetType"?{...newMoveEffect("targetMoveType"),target:"target" as const,value:12}:kind==="residualDamage"?{...newMoveEffect("residualDamage"),target:"target" as const,secondary:true,parameters:{specialDenominator:mode==="edited"?5:4,type1:10,type2:8,turns:0}}:kind==="residualStat"?{...newMoveEffect("residualStat"),target:"target" as const,secondary:true,value:mode==="edited"?-2:-1,parameters:{stat:5,turns:3,linked:1}}:kind==="vulnerable"?{...newMoveEffect("vulnerableUntilAction"),value:mode==="edited"?1.5:2,parameters:{alwaysHits:1}}:(kind==="historyPower"||kind==="transformHits"||kind==="faintPower")?{...newMoveEffect("historyPower"),value:mode==="edited"?25:50,parameters:{source:kind==="faintPower"?1:0,limit:mode==="edited"?1:6}}:kind==="historyBurn"?{...newMoveEffect("status"),value:4,phase:"hit" as const,target:"target" as const,secondary:true,chance:100,conditions:condition}:{...newMoveEffect("power"),conditions:condition};
const octoRule={conditions:MOVE_ALWAYS,prerequisites:{kind:"group" as const,mode:"all" as const,children:[{kind:"type" as const,subject:"target" as const,value:7,negate:true},{kind:"persistentFromMove" as const,subject:"target" as const,value:0,negate:true}]},effects:[{...newMoveEffect("sourceCondition"),value:22,phase:"status" as const,target:"target" as const},...[2,4].map(stat=>({...newMoveEffect("residualStat"),phase:"status" as const,target:"target" as const,parameters:{stat,turns:0,linked:1}}))]};
const rule=kind==="octolock"?octoRule:kind==="selectionGate"||kind==="belchGate"?structuredClone(MOVE_HISTORY_CANDIDATES.find(t=>t.label===(kind==="selectionGate"?"Gigaton Hammer":"Belch"))!.rule):{conditions:MOVE_ALWAYS,prerequisites:kind==="moveFailed"?{kind:"firstTurn",subject:"user",value:0} as MoveCondition:MOVE_ALWAYS,effects:[effect]};
await configureMoveRuleSets(project,[{moveId:priorFailure?52:33,rules:rule}]);
if(combined){
 await configureAbilityRuleSets(project,[{abilityId:165,name:"History Test",rules:{effects:[{kind:"speed",value:2}],conditions:MOVE_ALWAYS}}]);
 if(project.session.baseRom==="BW2")await configureItemRuleSets(project,[{itemId:85,rules:{effects:[{kind:"healFlat",value:3}],conditions:MOVE_ALWAYS,consumable:false}}]);
}
const attacks=["hitsTaken","historyPower","partyFaints"].includes(kind);
const enemy=kind==="critTransform"?[{speciesId:132,level:50,moves:[144],abilityId:50,itemId:0}]:["focus","focusCombined"].includes(kind)?[{speciesId:130,level:100,moves:[150],abilityId:mode==="negative"?4:50,itemId:0}]:kind==="soundBlock"?[{speciesId:130,level:50,moves:[mode==="negative"?1:45],abilityId:50,itemId:0}]:kind==="powder"?[{speciesId:130,level:50,moves:[mode==="negative"?1:52],abilityId:50,itemId:0}]:kind==="mutualTrap"&&mode==="negative"?[{speciesId:92,level:100,moves:[150],abilityId:50,itemId:0}]:["residualDamage","residualStat"].includes(kind)&&mode==="negative"?[{speciesId:92,level:100,moves:[150],abilityId:50,itemId:0}]:["fieldType","fieldStatus","targetType"].includes(kind)?[{speciesId:130,level:mode==="negative"?100:50,moves:[kind==="targetType"?52:kind==="fieldStatus"?1:33],abilityId:50,itemId:0}]:kind==="vulnerable"?[{speciesId:130,level:50,moves:[33],abilityId:50,itemId:0}]:kind==="immuneFailure"?[{speciesId:92,level:100,moves:[150],abilityId:50,itemId:0}]:kind==="transformHits"?[{speciesId:132,level:50,moves:[144],abilityId:50,itemId:0}]:["partyFaints","faintPower"].includes(kind)?[{speciesId:1,level:1,moves:[150],abilityId:50,itemId:0},{speciesId:130,level:100,moves:[kind==="faintPower"?33:150],abilityId:50,itemId:0}]:[{speciesId:130,level:attacks?50:100,moves:[attacks?33:["statRaised","historyBurn"].includes(kind)?14:kind==="moveFailedProtect"?182:kind==="suppression"?380:kind==="swap"?285:150],abilityId:kind==="statLowered"?22:kind==="residualStat"&&mode==="simple"?86:kind==="residualStat"&&mode==="contrary"?126:50,itemId:kind==="pluck"?155:combined&&project.session.baseRom==="BW2"?85:0}];
patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:"Singles",trainer:{team:enemy,ai:0}}));
const downloads=await buildTestBattleDownloads(project,2);
const hasBerry=kind==="ateBerry"||combined||kind==="belchGate"&&mode==="positive";
const team=[{speciesId:kind==="fieldLock"&&mode==="negative"?92:kind==="critBoost"&&mode==="edited"?147:["transformHits","vulnerable","fieldType","fieldStatus","targetType","powder","soundBlock","critTransform","critPass"].includes(kind)?6:1,level:["partyFaints","faintPower"].includes(kind)?100:50,moves:kind==="critPass"?[33,226]:["focus","focusCombined","critBoost","critTransform"].includes(kind)?[33,1]:priorFailure?[33,52]:kind==="calledMove"?[214,33]:kind==="pluck"?[365,33]:["selectionGate","belchGate"].includes(kind)?[33,150]:[33],abilityId:combined?165:50,itemId:kind==="fieldLock"&&mode==="shell"?295:hasBerry?155:0,...(hasBerry?{currentHp:10}:{}),...(kind==="calledMove"?{status:"sleep" as const}:{})}];
if(["critPass","fieldLock"].includes(kind))team.push({speciesId:1,level:50,moves:[1],abilityId:50,itemId:0});
const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team}}));
const rom=new NintendoDSRom(downloads.romBytes,{fileData:"view"}),dll=parseRpm(rom.files[rom.fileId(MOVE_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});
const reload=await loadProjectFromRomBytes(downloads.romBytes,"export.nds",{selectedNarcs:["moves","message_texts"]});assert.deepEqual(inspectMoveEffects(reload).rules.get(priorFailure?52:33),rule);
const moduleId=project.session.baseRom==="BW"?"93":"167",hook=dll.relocations.find(r=>r.target.module===moduleId&&dll.symbols[r.sourceSymbolIndex]?.name==="MoveDispatch");assert(hook);
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name&&(s.name.startsWith("Move")||["moveHistory","moveCritBoost","moveCritPending","moveFieldLockTurns"].includes(s.name))).map(s=>[s.name!,s.address]));
await writeFile(`${out}/battle.nds`,downloads.romBytes);await writeFile(`${out}/battle.sav`,save);
await writeFile(`${out}/fixture.json`,JSON.stringify({game:rom.idCode,hook:hook.target.address,symbols,kind,mode,codeBytes:dll.code.length,getter:readU32(dll.code,symbols.MoveRuleApi)&~1,rewrite:readU32(dll.code,symbols.MoveRuleApi+8)&~1,multiply:readU32(dll.code,symbols.MoveRuleApi+12)&~1,pop:readU32(dll.code,symbols.MoveRuleApi+44)&~1},null,2));
console.log(JSON.stringify({game:rom.idCode,kind,exportReload:true}));
