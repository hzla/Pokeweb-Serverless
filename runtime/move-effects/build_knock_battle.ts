/** Production export/reload fixtures for modern Knock Off; local ROM inputs only. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureMoveRuleSets,inspectMoveEffects,MOVE_EFFECTS_DLL_PATH} from "../../src/pokeweb/moveEffectsModel";
import {configureAbilityRuleSets,inspectAbilityEffects} from "../../src/pokeweb/abilityEffectsModel";
import {configureItemRuleSets} from "../../src/pokeweb/itemEffectsModel";
import {newMoveEffect,MOVE_ALWAYS,validateMoveRule} from "../../src/pokeweb/moveRules";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {parseHarnessConfig,patchHarnessTrainer,patchHarnessSave} from "../../src/pokeweb/battleHarness";
import {buildTestBattleDownloads,rawSaveBytesFromDesmumeDsv} from "../../src/pokeweb/testBattle";
import {NintendoDSRom} from "../../src/nds/rom";
import {parseRpm} from "../../src/pokeweb/rpm";
import {readU32} from "../../src/nds/binary";
const [path,out]=process.argv.slice(2);assert(path&&out,"ROM.nds OUTPUT_DIRECTORY");await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets permitted");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"knock.nds",{selectedNarcs:["personal","items","moves","message_texts","trdata","trpok"]});
let project=await load(new Uint8Array(await readFile(path)));
const edits=[];
for(let id=33;edits.length<100;id++){
 if([45,150,164,182].includes(id))continue;
 const raw=decodeRecord(project,"moves",id).raw!;raw.category=1;raw.type=0;raw.power=40;raw.accuracy=101;raw.pp=30;raw.hits=id===38?0x22:0;markDirty(project,"moves",id);
 const effect={...newMoveEffect("modernKnockOff"),value:id===34?2.5:1.5,...(id===36?{conditions:{kind:"hp" as const,subject:"target" as const,comparison:"gte" as const,percent:100}}:{})};
 const conditions=id===35?{kind:"hp" as const,subject:"user" as const,comparison:"lt" as const,percent:0}:id===37?{kind:"hp" as const,subject:"target" as const,comparison:"lte" as const,percent:99}:MOVE_ALWAYS;
 edits.push({moveId:id,rules:validateMoveRule({effects:[effect],conditions,prerequisites:MOVE_ALWAYS})});
}
// A native Knock Off with the same pre-hit power supplies the KO oracle.
const nativeKnock=decodeRecord(project,"moves",282).raw!;nativeKnock.category=1;nativeKnock.type=0;nativeKnock.power=60;nativeKnock.accuracy=101;nativeKnock.pp=30;nativeKnock.hits=0;markDirty(project,"moves",282);
await configureAbilityRuleSets(project,[{abilityId:100,name:"Ability Guard",rules:{effects:[{kind:"abilityRecipe:abilityStatGuard",value:1}],conditions:MOVE_ALWAYS}}]);
await configureMoveRuleSets(project,edits);
if(project.session.baseRom==="BW2")await configureItemRuleSets(project,[{itemId:85,rules:{effects:[{kind:"healFlat",value:3}],conditions:MOVE_ALWAYS,consumable:false}}]);
const verify=()=>{const state=inspectMoveEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,new Map(edits.map(e=>[e.moveId,e.rules])));assert(inspectAbilityEffects(project).editable);};verify();
for(let pass=0;pass<2;pass++){const bytes=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/roundtrip-${pass}.nds`,bytes);project=await load(bytes);verify();}
// Re-edit an exported card and restore its original value before gameplay.
await configureMoveRuleSets(project,[{moveId:33,rules:{...edits[0].rules,effects:[{...edits[0].rules.effects[0],value:2}]}}]);
project=await load(await exportModifiedRom(project,{forDsi:false}));assert.equal(inspectMoveEffects(project).rules.get(33)!.effects[0].value,2);
await configureMoveRuleSets(project,[edits[0]]);verify();
const specs=[
 {label:"removable",item:234,power:60,removed:true},
 {label:"knockout",item:218,species:1,enemyLevel:1,enemyCount:2,power:60,removed:true},
 {label:"native-knockout",item:218,species:1,enemyLevel:1,enemyCount:2,move:282,removed:true},
 {label:"empty",item:0,power:40,removed:true},
 {label:"sticky-hold",item:218,ability:60,power:40,removed:false},
 {label:"unremovable-plate",item:298,species:493,power:40,removed:false},
 {label:"edited-2point5",item:234,move:34,power:100,removed:true},
 {label:"condition-false",item:218,move:35,power:40,removed:false},
 {label:"hp-condition-accepted-before-hit",item:218,move:36,power:60,removed:true},
 {label:"hp-condition-rejected-before-hit",item:218,move:37,power:40,removed:false},
 {label:"two-hits-one-removal",item:218,move:38,power:60,removed:true},
 {label:"protect",item:234,enemyMove:182,removed:false},
 {label:"substitute",item:234,enemyMove:164,power:40,removed:false},
 {label:"ghost-immunity",item:234,species:92,removed:false},
 {label:"mold-breaker",item:218,ability:60,userAbility:104,power:60,removed:true},
];
const only=process.argv.find(arg=>arg.startsWith("--only="))?.slice(7).split(",");
const fixtures=[];
for(const spec of specs){
 if(only&&!only.includes(spec.label))continue;
 patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,trainer:{team:[{speciesId:spec.species??320,level:spec.enemyLevel??100,moves:[spec.enemyMove??150],abilityId:spec.ability??50,itemId:spec.item},...((spec.enemyCount??1)>1?[{speciesId:320,level:100,moves:[150],abilityId:50,itemId:0}]:[])],ai:0}}));
 const download=await buildTestBattleDownloads(project,2);
 const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(download.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[spec.move??33],abilityId:spec.userAbility??100,itemId:0}]}}));
 const rom=new NintendoDSRom(download.romBytes,{fileData:"view"}),rpm=parseRpm(rom.getFileByName(MOVE_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]});
 const symbols=Object.fromEntries(rpm.symbols.filter(s=>s.name?.startsWith("Move")).map(s=>[s.name!,s.address]));
 const hook=rpm.relocations.find(r=>r.target.module===(project.session.baseRom==="BW"?"93":"167")&&rpm.symbols[r.sourceSymbolIndex]?.name==="MoveDispatch")!;
 const pmc=parseRpm(rom.getFileByName("codeinjection/RPMSYM-PMC.rpm"));
 const pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
 const battle=rom.loadArm9Overlays([project.session.baseRom==="BW"?93:167]).values().next().value!;
 const factory=readU32(rpm.code,symbols.MoveNativeGetters)&~1,table=readU32(battle.data,factory-battle.ramAddress+8),knockHandler=readU32(battle.data,table-battle.ramAddress+4)&~1;
 const romName=`${spec.label}.nds`;await writeFile(`${out}/${romName}`,download.romBytes);await writeFile(`${out}/${spec.label}.sav`,save);
 fixtures.push({...spec,rom:romName,game:rom.idCode,symbols,pmcSymbols,knockHandler,stat:readU32(rpm.code,symbols.MoveRuleApi+20)&~1,hook:hook.target.address,codeBytes:rpm.code.length,bssBytes:rpm.bssSize,getter:readU32(rpm.code,symbols.MoveRuleApi)&~1,rewrite:readU32(rpm.code,symbols.MoveRuleApi+8)&~1,pop:readU32(rpm.code,symbols.MoveRuleApi+44)&~1,weather:readU32(rpm.code,symbols.MoveRuleApi+32)&~1,blocked:readU32(rpm.code,symbols.MoveRuleApi+64*4)&~1});
}
await writeFile(`${out}/knock-cases.json`,JSON.stringify({count:100,exportReload:true,reedit:true,cases:fixtures},null,2));console.log("100 move recipes with ability/item coexistence; two ROM round trips and re-edit passed.");
