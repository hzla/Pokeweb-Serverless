/** Explicit local ROM round trips and disposable native flag battle fixtures. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {configureAbilityRuleSets,configureMoveDllFlags,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH,ABILITY_RULE_API,CURRENT_ABILITY_RUNTIME_VERSION} from "../../src/pokeweb/abilityEffectsModel";
import {getMoveRecord,updateMoveField} from "../../src/pokeweb/moveItemModel";
import {VANILLA_MOVE_FLAGS} from "../../src/pokeweb/abilityMoveFilters";
import {validateAbilityRule,EMPTY_ABILITY_RULE,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import {abilityExecutionLayout} from "../../src/pokeweb/abilityRecipeOptimization";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {getPmcInstallStatus,installBundledPmc} from "../../src/pokeweb/pmcModel";
import {buildTestBattleDownloads,rawSaveBytesFromDesmumeDsv} from "../../src/pokeweb/testBattle";
import {patchHarnessTrainer,patchHarnessSave,parseHarnessConfig} from "../../src/pokeweb/battleHarness";
import {decryptPk5Party} from "../../src/pokeweb/testBattleTeam";
import {parseRpm} from "../../src/pokeweb/rpm";
import {battleRuntimeResolver} from "../../src/pokeweb/battleRuntimeBindings";
import black from "../../src/assets/data/abilityBindingsB1.json";
import white from "../../src/assets/data/abilityBindingsW1.json";
import moveBindings from "../../src/assets/data/moveRecipeBindings.json";

const [path,out]=process.argv.slice(2);assert(path&&out,"INPUT.nds NEW_EXTERNAL_DIRECTORY");await mkdir(out);await mkdir(`${out}/saves`);
const roundTripOnly=process.argv.includes("--roundtrip-only");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex"),input=new Uint8Array(await readFile(path));
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"native-flags.nds",{selectedNarcs:["personal","items","moves","message_texts","trdata","trpok"]});
let project=await load(input);assert((roundTripOnly?["B","W","B2","W2"]:["B","W","W2"]).includes(project.session.baseVersion),"Native fixture launcher requires B/W/W2");
for(const [move,enabled]of [[33,true],[1,false]]as const){updateMoveField(project,move,"healing_move",enabled);updateMoveField(project,move,"blocked_by_protect",enabled);}
const conditions=EMPTY_ABILITY_RULE.conditions,healing=VANILLA_MOVE_FLAGS.find(flag=>flag.key==="healing_move")!.filter,protect=VANILLA_MOVE_FLAGS.find(flag=>flag.key==="blocked_by_protect")!.filter;
const rules=new Map<number,AbilityRuleSet>([
 [165,{conditions,effects:[{kind:"ability:priority",value:3,parameters:{moveClass:healing}}]}],
 [166,{conditions,effects:[{kind:"ability:power",value:2,parameters:{moveClass:protect}}]}],
 [167,{conditions,effects:[{kind:"ability:power",value:2,parameters:{moveClass:healing}}]}],
 [168,{conditions,effects:[{kind:"ability:damageTaken",value:.5,parameters:{moveClass:healing}}]}],
 [169,{conditions,effects:[{kind:"abilityRecipe:convertType",value:2,parameters:{moveClass:healing,sourceType:18,type:14}}]}],
 [170,{conditions,effects:[{kind:"abilityRecipe:statGroup",value:1,parameters:{activation:5,defenseStages:1,speedStages:-1,moveClass:healing}}]}],
 [171,{conditions,effects:[{kind:"ability:priority",value:3,parameters:{moveClass:12}}]}],
 [172,{conditions,effects:[{kind:"abilityRecipe:moveGuard",value:1,parameters:{moveClass:healing}}]}],
]);
for(const[id,rule]of rules)rules.set(id,validateAbilityRule(rule));
await configureAbilityRuleSets(project,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:`Flag ${abilityId}`})));
await configureMoveDllFlags(project,33,0);await configureMoveDllFlags(project,1,64);
const verify=()=>{const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.equal(state.runtimeVersion,CURRENT_ABILITY_RUNTIME_VERSION);assert.deepEqual(state.rules,rules);assert.equal(getMoveRecord(project,33).readable.healing_move,1);assert.equal(getMoveRecord(project,1).readable.healing_move,0);};verify();
const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/native-flags.nds`,exported);project=await load(exported);verify();
// Change the chosen native flag after reopening, then restore the saved recipe.
await configureAbilityRuleSets(project,[{abilityId:165,rules:validateAbilityRule({conditions,effects:[{kind:"ability:priority",value:2,parameters:{moveClass:protect}}]})}]);
project=await load(await exportModifiedRom(project,{forDsi:false}));assert.equal(inspectAbilityEffects(project).rules.get(165)!.effects[0].parameters?.moveClass,protect);
await configureAbilityRuleSets(project,[{abilityId:165,rules:rules.get(165)!}]);project=await load(await exportModifiedRom(project,{forDsi:false}));verify();
const status=getPmcInstallStatus(project);if(status.installed&&!status.version?.startsWith("13.2.4"))await installBundledPmc(project);
const final=await exportModifiedRom(project,{forDsi:false}),rom=new NintendoDSRom(final,{fileData:"view"});project=await load(final);
verify();
if(roundTripOnly){assert.equal(hash(new Uint8Array(await readFile(path))),hash(input));console.log(`${rom.idCode}: export/reload, native/expanded flags and parameter re-edit passed; source unchanged.`);process.exit(0);}
const dll=parseRpm(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]}),symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const pmc=parseRpm(rom.getFileByName("codeinjection/RPMSYM-PMC.rpm")),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const bw1=project.session.baseRom==="BW",id=bw1?93:167,overlay=rom.loadArm9Overlays([id]).get(id)!,bindings=project.session.baseVersion==="W"?white:black;
const resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress,bw1?bindings.functions:undefined);
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,n)=>name?[[name,readU32(dll.code,symbols.AbilityRuleApi+n*4)&~1]]:[])),gateway=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+20*4)!;
let powerHook:number;
if(bw1)powerHook=resolver.resolve("BW1_BTL_SERVER_FLOW_CalcMovePower").address;
else{
 const extras=Object.fromEntries(Object.entries(black.functions).filter(([name])=>name.startsWith("BW1_")).map(([name,s])=>[name,{...s,module:s.module==="ARM9"?"ARM9":"167"}]));
 const signature=extras.BW1_BTL_SERVER_FLOW_CalcMovePower;assert.equal(signature.hex.slice(320),"c7300000");signature.hex=signature.hex.slice(0,320)+"e6300000";
 powerHook=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress,{...moveBindings.functions,...extras}).resolve("BW1_BTL_SERVER_FLOW_CalcMovePower").address;
}
const base=Number(getMoveRecord(project,33).raw.power),pound=Number(getMoveRecord(project,1).raw.power),neutral=[6,6,6,6,6,6,6];
const cases=[
 {label:"native-healing-priority",abilityId:165,move:33,checks:{rewrite:{key:24,value:10}}},
 {label:"expanded-healing-is-not-native",abilityId:165,move:1,checks:{noRewrite:{key:24,value:10}}},
 {label:"native-protect-power",abilityId:166,move:33,checks:{power:{move:33,value:base*2,type:0},enemyDamaged:true}},
 {label:"native-protect-power-negative",abilityId:166,move:1,checks:{power:{move:1,value:pound,type:0},enemyDamaged:true}},
 {label:"native-healing-power",abilityId:167,move:33,checks:{power:{move:33,value:base*2,type:0}}},
 {label:"native-healing-power-negative",abilityId:167,move:1,checks:{power:{move:1,value:pound,type:0}}},
 {label:"expanded-healing-priority-preserved",abilityId:171,move:1,checks:{rewrite:{key:24,value:10}}},
 {label:"native-healing-is-not-expanded",abilityId:171,move:33,checks:{noRewrite:{key:24,value:10}}},
 {label:"native-flag-incoming-damage",abilityId:168,enemyMove:33,enemyLevel:30,checks:{multiplier:2048}},
 {label:"native-flag-conversion",abilityId:169,move:33,checks:{power:{move:33,value:base*2,type:14}}},
 {label:"native-flag-conversion-negative",abilityId:169,move:1,checks:{power:{move:1,value:pound,type:0}}},
 {label:"native-flag-after-move",abilityId:170,move:33,checks:{playerStagesByTurn:[neutral,[6,7,6,6,5,6,6],[6,8,6,6,4,6,6]]}},
 {label:"native-flag-after-move-negative",abilityId:170,move:1,checks:{stages:neutral}},
 {label:"native-flag-blocking",abilityId:172,enemyMove:33,checks:{noDamage:true}},
 {label:"native-flag-suppression",abilityId:166,move:33,enemyMove:380,enemyLevel:100,checks:{suppressed:true,noMultiplier:8192,power:{move:33,value:base,type:0}}},
 {label:"native-flag-swapping",abilityId:166,move:285,enemyMove:33,enemyLevel:30,checks:{playerAbilities:[166,50,166],power:{move:33,value:base*2,type:0}}},
];
const hashes:Record<string,string>={},fixtures=[];
for(const[index,spec]of cases.entries()){
 patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,trainer:{team:[{speciesId:320,level:spec.enemyLevel??100,moves:[spec.enemyMove??150],abilityId:50,itemId:0}],ai:0}}));
 const downloads=await buildTestBattleDownloads(project,2),save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[spec.move??150],abilityId:spec.abilityId,itemId:0}]}}));
 const label=`${String(index).padStart(3,"0")}-${spec.label}`,file=`battle-${spec.enemyMove??150}-${spec.enemyLevel??100}.nds`,raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220));
 await writeFile(`${out}/saves/${label}.sav`,save);if(!hashes[file]){await writeFile(`${out}/${file}`,downloads.romBytes);hashes[file]=hash(downloads.romBytes);}
 fixtures.push({...spec,label,rom:file,speciesId:1,enemyCount:1,hp:readU16(raw,0x90),maxHp:readU16(raw,0x90)});
}
const execution=abilityExecutionLayout(rules);
await writeFile(`${out}/cases.json`,JSON.stringify({game:rom.idCode,romExportReload:true,parameterReedit:true,editedAbilities:rules.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,symbols,pmcSymbols,api,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,popupGateway:dll.symbols[gateway.sourceSymbolIndex].address,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(execution.bytes).toString("hex"),nativeOffsets:execution.nativeOffsets,romHashes:hashes,cases:fixtures,priorityRuntime:true,powerHook,...(bw1?{manualLaunch:true,openingHook:project.session.baseVersion==="W"?0x021bbb80:0x021bbb60,commandHook:project.session.baseVersion==="W"?0x021baccc:0x021bacac,flowRegister:"r0"}:{})},null,2));
assert.equal(hash(new Uint8Array(await readFile(path))),hash(input));console.log(`${fixtures.length} ${rom.idCode} fixtures; export/reload and flag/parameter re-edit passed.`);
