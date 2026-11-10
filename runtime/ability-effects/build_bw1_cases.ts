import {statusCases} from "./status_cases";
import {environmentCases} from "./environment_cases";
import {strikeCases} from "./strike_cases";
import {protectCases} from "./protect_cases";
import {weatherCases} from "./weather_cases";
import { abilityExecutionLayout } from "../../src/pokeweb/abilityRecipeOptimization";
import {statSourceCases} from "./stat_source_cases";
import { prepareCustomFlagCases, customFlagCases } from "./custom_flag_cases";
import { statusPopupCases } from "./status_popup_cases";
/** BW1 revision-0 ability recipes: production export/reload and native fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { getTextBank,parseTextEntryId } from "../../src/pokeweb/textModel";
import { NARC } from "../../src/nds/narc";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import { readU16, readU32, writeU16, writeU32 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API, buildAbilityRuleModule } from "../../src/pokeweb/abilityEffectsModel";
import { configureMoveDllFlags } from "../../src/pokeweb/abilityEffectsModel";
import { configureMoveRuleSets } from "../../src/pokeweb/moveEffectsModel";
import { validateAbilityRule, encodeAbilityRules, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { ABILITY_IMPORT_LIBRARY } from "../../src/pokeweb/abilityLibrary";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, type HarnessPokemon } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv, getTestBattleConfig, refreshTestBattleSaveBlockChecksum } from "../../src/pokeweb/testBattle";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import blackBindings from "../../src/assets/data/abilityBindingsB1.json";
import whiteBindings from "../../src/assets/data/abilityBindingsW1.json";
import blackMoveBindings from "../../src/assets/data/moveRecipeBindingsB1.json";
import whiteMoveBindings from "../../src/assets/data/moveRecipeBindingsW1.json";

const [inputPath, directory] = process.argv.slice(2); assert(directory, "Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [--only=CASE,...]");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath)), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inputRom=new NintendoDSRom(input,{fileData:"view"});assert(["IRBO","IRAO"].includes(inputRom.idCode));assert.equal(inputRom.data[30],0);
const game=inputRom.idCode==="IRAO"?"W":"B",bindings=game==="W"?whiteBindings:blackBindings;
await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch = (async (request: RequestInfo | URL) => { const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-bw1.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
const imported=(label:string)=>structuredClone(ABILITY_IMPORT_LIBRARY.find(p=>p.label===label)!.rule);
const all:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]};
const rules=new Map<number,AbilityRuleSet>([
 [165,{effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:2}},{kind:"abilityRecipe:statAction",value:-1,parameters:{stat:5}}],conditions:all}],
 [166,{effects:[{kind:"nativeAbility:146",value:2.5,weather:3},{kind:"abilityRecipe:weatherGuard",value:1,parameters:{weather:3}}],conditions:all}],
 [167,{effects:[{kind:"nativeAbility:22",value:-1,stat:3}],conditions:all}],
 [168,{effects:[{kind:"healFlat",value:7},{kind:"defense",value:1.2},{kind:"speed",value:.8}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}]}}],
 [169,{effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{activation:5,stat:3,type:10}},{kind:"abilityRecipe:statAction",value:-1,parameters:{activation:5,stat:5,type:10}}],conditions:all}],
 [170,{effects:[{kind:"abilityRecipe:knockoutSplash",value:20},{kind:"nativeAbility:104",value:-1}],conditions:all}],
 [171,{effects:[{kind:"abilityRecipe:statAction",value:-1,parameters:{activation:1,stat:8,statSource:1,scope:2}}],conditions:all}],
 [172,{effects:[{kind:"nativeAbility:143",value:-1,parameters:{activationChance:100,contactStatus:4}}],conditions:all}],
 [173,{effects:[{kind:"status",value:4,trigger:"turnEnd",target:"holder",chance:100}],conditions:all}],
 [174,{effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:3}},{kind:"abilityRecipe:weatherGuard",value:1,parameters:{weather:3}}],conditions:all}],
 [176,{effects:[{kind:"nativeAbility:143",value:-1,parameters:{activationChance:100,contactStatus:4}},{kind:"nativeAbility:3",value:-1}],conditions:all}],
 [177,imported("Tough Claws")],[178,imported("Protean")],[179,imported("Queenly Majesty")],[180,imported("Mirror Armor")],
 [181,{effects:[{kind:"nativeAbility:7",value:-1,parameters:{immunityStatus:4}}],conditions:all}],
 [182,{effects:[{kind:"recoil",value:10,trigger:"afterAttack",target:"holder",chance:100}],conditions:all}],
 [183,{effects:[{kind:"critical",value:4}],conditions:all}],
 [255,{effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:3}}],conditions:all}],
 [175,{effects:[{kind:"nativeAbility:47",value:.25,parameters:{type1:10,type2:9}}],conditions:all}],
]);
if(process.argv.includes("--client"))rules.set(185,{effects:[{kind:"nativeAbility:42",value:-1,parameters:{trapType:11}}],conditions:all});
const frost=process.argv.includes("--frost");
if(frost){assert(game==="B"&&project.session.fairy,"Expected the reviewed Fairy-enabled Black ROM");rules.set(186,imported("Pixilate"));rules.set(187,{effects:[{kind:"nativeAbility:16",value:-1}],conditions:all});rules.set(188,{effects:[{kind:"nativeAbility:42",value:-1,parameters:{trapType:17}}],conditions:all});rules.set(189,{effects:[{kind:"healFlat",value:7}],conditions:{kind:"type",value:17}});rules.set(190,imported("Refrigerate"));rules.set(191,imported("Tera Shell"));}
rules.set(192,{effects:[{kind:"speed",value:2}],conditions:{kind:"weather",value:3}});
if(process.argv.includes("--stress"))for(let id=1;id<=164&&rules.size<100;id++)if(id!==13&&id!==50&&id!==117&&!rules.has(id))rules.set(id,{effects:[{kind:"healFlat",value:1}],conditions:all});
const moveClasses=process.argv.includes("--move-classes");
const notifications=process.argv.includes("--notifications");
if(notifications){
 rules.clear();
 for(const[id,name]of [[165,"Queenly Majesty"],[166,"Dazzling"],[167,"Armor Tail"],[168,"Bulletproof"],[169,"Good as Gold"],[170,"Wind Rider"],[171,"Sweet Veil"],[172,"Flower Veil"],[173,"Guard Dog"],[176,"Toxic Debris"],[177,"Perish Body"],[178,"Anger Shell"]]as const)rules.set(id,imported(name));
 rules.set(179,validateAbilityRule({effects:[...[{kind:"abilityRecipe:statAction",value:6,parameters:{stat:1}},{kind:"abilityRecipe:statAction",value:-6,parameters:{stat:2}},{kind:"abilityRecipe:statAction",value:6,parameters:{stat:3}},{kind:"abilityRecipe:statAction",value:-6,parameters:{stat:4}},{kind:"abilityRecipe:statAction",value:6,parameters:{stat:5}}],...imported("Anger Shell").effects],conditions:all}));
 rules.set(180,validateAbilityRule({effects:[{kind:"abilityRecipe:statAction",value:6,parameters:{stat:1}},...imported("Anger Shell").effects],conditions:all}));
 rules.set(174,{effects:[{kind:"abilityRecipe:priorityGuard",value:2}],conditions:all});
 rules.set(175,{effects:[{kind:"abilityRecipe:statAction",value:6,parameters:{stat:1}},...imported("Wind Rider").effects],conditions:all});
 for(const[id,rule]of inspectAbilityEffects(project).rules)if(!rules.has(id))rules.set(id,rule);
}
if(moveClasses){
 rules.clear();
 rules.set(165,{effects:[{kind:"abilityRecipe:convertType",value:1,parameters:{type:14}}],conditions:all});
 rules.set(166,{effects:[{kind:"abilityRecipe:convertType",value:3,parameters:{type:14}}],conditions:all});
 rules.set(167,{effects:[{kind:"ability:power",value:3,parameters:{moveClass:4}}],conditions:all});
 rules.set(168,imported("Wind Rider"));
 const entry=(stages:number)=>({kind:"abilityRecipe:statAction" as const,value:stages,parameters:{stat:2}});
 const hit=(stages:number,stat=2)=>({kind:"ability:hitStat" as const,value:stages,parameters:{stat}});
 rules.set(169,{effects:[entry(6),hit(1)],conditions:all});
 rules.set(170,{effects:[entry(-6),hit(-1)],conditions:all});
 rules.set(171,{effects:[entry(6),hit(1),hit(1,1)],conditions:all});
 for(const[id,rule]of inspectAbilityEffects(project).rules)if(!rules.has(id))rules.set(id,rule);
}
const customFlagsMode=process.argv.includes("--custom-flags");
if(customFlagsMode){for(const[id,rule]of inspectAbilityEffects(project).rules)if(!rules.has(id))rules.set(id,rule);for(const[id,rule]of await prepareCustomFlagCases(project))rules.set(id,rule);}
const actionResultsMode=process.argv.includes("--action-results");
const actionResultNames:Record<number,string>={220:"Fairy Aura",221:"Dark Aura",222:"Water Aura",223:"Toxic One",224:"Toxic Chain",226:"Toxic Thirty"};
if(actionResultsMode){
 rules.clear();for(const[id,rule]of inspectAbilityEffects(project).rules)rules.set(id,rule);
 rules.set(220,imported("Fairy Aura"));rules.set(221,imported("Dark Aura"));
 rules.set(222,{effects:[{kind:"abilityRecipe:fieldPower",value:1.333333,parameters:{type:10}}],conditions:all});
 for(const[id,chance]of [[223,1],[224,100],[226,30]])rules.set(id,{effects:[{kind:"status",value:7,trigger:"afterAttack",target:"defender",chance}],conditions:all});
}
const statusPopups = process.argv.includes("--status-extensions") ? statusCases() : process.argv.includes("--weather-moves") ? weatherCases() : process.argv.includes("--protect") ? protectCases() : process.argv.includes("--strikes") ? strikeCases() : process.argv.includes("--environment") ? environmentCases() : process.argv.includes("--stat-source") ? statSourceCases() : process.argv.includes("--status-popups") ? statusPopupCases() : undefined;
if(statusPopups){rules.clear();for(const[id,rule]of inspectAbilityEffects(project).rules)rules.set(id,rule);for(const[id,rule]of statusPopups.rules)rules.set(id,rule);}
for(const[id,r]of rules)rules.set(id,validateAbilityRule(r));
// Every imported recipe is linked with this game's native services before fixtures.
for(const entry of ABILITY_IMPORT_LIBRARY)buildAbilityRuleModule(project,new Map([[255,entry.rule]]));
if(process.argv.includes("--status-extensions"))for(const id of [92,261,496]){decodeRecord(project,"moves",id).raw!.accuracy=100;if(id===496)decodeRecord(project,"moves",id).raw!.type=12;markDirty(project,"moves",id);}
await configureAbilityRuleSets(project,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:statusPopups?statusPopups.names.get(abilityId):actionResultsMode?actionResultNames[abilityId]:notifications?({165:"Queenly Majesty",166:"Dazzling",167:"Armor Tail",168:"Bulletproof",169:"Good as Gold",170:"Wind Rider",171:"Sweet Veil",172:"Flower Veil",173:"Guard Dog",174:"Priority Two",175:"Capped Wind",176:"Toxic Debris",177:"Perish Body",178:"Anger Shell",179:"Capped Shell",180:"Partial Shell"}as Record<number,string>)[abilityId]:abilityId===167?"Scare":`BW ${abilityId}`})));
if(moveClasses){
 await configureMoveDllFlags(project,33,34);await configureMoveDllFlags(project,352,0);await configureMoveDllFlags(project,16,0);
 if(process.argv.includes("--move-power"))await configureMoveRuleSets(project,[{moveId:44,rules:{effects:[{kind:"power",value:3,phase:"power",target:"user",chance:100,secondary:false,conditions:all}],conditions:all,prerequisites:all}}]);
}
if(process.argv.includes("--environment")){
 // Fixture-only accuracy: isolate damage immunity from Leech Seed's hit roll.
 const {decodeRecord,markDirty}=await import("../../src/pokeweb/projectStore");decodeRecord(project,"moves",73).raw!.accuracy=100;markDirty(project,"moves",73);
}
const verify=()=>{const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,rules);};verify();
project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/bw1-abilities.nds`,exported);project=await load(exported);verify();
// Re-edit an exported custom ID, then restore and verify the same FAT entry.
const reeditId=statusPopups?100:167,reedit=moveClasses?{effects:[{kind:"ability:power",value:2,parameters:{moveClass:4}}],conditions:all}:{...rules.get(reeditId)!,effects:[{kind:"nativeAbility:22",value:-1,stat:4}]};
await configureAbilityRuleSets(project,[{abilityId:reeditId,rules:reedit,...(statusPopups?{}:{name:notifications?"Armor Tail":"Scare"})}]);
trim();const reedited=await exportModifiedRom(project,{forDsi:false});project=await load(reedited);assert.equal(moveClasses?inspectAbilityEffects(project).rules.get(reeditId)!.effects[0].value:inspectAbilityEffects(project).rules.get(reeditId)!.effects[0].stat,moveClasses?2:4);
await configureAbilityRuleSets(project,[{abilityId:reeditId,rules:rules.get(reeditId)!}]);trim();const final=await exportModifiedRom(project,{forDsi:false});project=await load(final);verify();
const rom=new NintendoDSRom(final,{fileData:"view"}),dllBytes=rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],dll=parseRpm(dllBytes,{allowedMagics:["DLXF"]});
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,readU32(dll.code,symbols.AbilityRuleApi+i*4)&~1]]:[]));
const gateway=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+20*4)!;
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const ov=rom.loadArm9Overlays([93]).get(93)!,resolver=battleRuntimeResolver(ov.data,ov.ramAddress,project.arm9,rom.arm9RamAddress,bindings.functions);
const notificationsMetadata=notifications||actionResultsMode?{blockMessage:dll.metadata.PokewebAbilityBlockMessage,messageHook:battleRuntimeResolver(ov.data,ov.ramAddress,project.arm9,rom.arm9RamAddress,{...bindings.functions,...(game==="W"?whiteMoveBindings:blackMoveBindings).functions}).resolve("BW1_BTL_SERVER_FLOW_PushMsgRecord").address}:{};
let clientTrapStores:Record<string,number>|undefined;
const clientFunction=dll.symbols.find(s=>s.name==="AbilityClientTrapped");if(clientFunction){const code=Buffer.from(dll.code.subarray(clientFunction.address,clientFunction.address+clientFunction.size));const store=(hex:string,offset:number)=>{const pattern=Buffer.from(hex,"hex"),at=code.indexOf(pattern);assert(at>=0&&code.indexOf(pattern,at+1)===-1);return clientFunction.address+at+offset;};clientTrapStores={trapper:store("08ab1b5d019a1370",6),ability:store("029b002b00d01e800025",6)};}
const {bytes:encoded,nativeOffsets}=abilityExecutionLayout(rules);
const neutral=[6,6,6,6,6,6,6];const mon=(speciesId=320,level=100,move=150,abilityId=50):HarnessPokemon=>({speciesId,level,moves:[move],abilityId,itemId:0});
type Case={label:string;playerSpecies?:number;playerGender?:0|1;abilityId:number;playerMoves?:number[];playerStatus?:HarnessPokemon["status"];turnMove?:number[];hp?:number;ally?:HarnessPokemon;enemies?:HarnessPokemon[];battleType?:"Doubles";enemyAbility?:number;menuCount?:number;bench?:HarnessPokemon[];checks:Record<string,unknown>};
const cases:Case[]=[
 {label:"entry-grouped",abilityId:165,checks:{stages:[6,7,6,6,5,6,6],popupsByTurn:[1,0,0]}},
 {label:"scare-spatk",abilityId:167,checks:{enemyStages:[6,6,5,6,6,6,6]}},
 {label:"slush-rush-hail",abilityId:166,enemies:[mon(320,100,150,117)],checks:{multiplier:10240,noWeatherDamage:true}},
 {label:"and-or-heal",abilityId:168,hp:10,checks:{heal:7}},
 {label:"high-pressure",abilityId:169,playerMoves:[55],checks:{playerStagesByTurn:[neutral,[6,6,7,6,5,6,6],[6,6,8,6,4,6,6]]}},
 {label:"indignation",abilityId:171,enemies:[mon(320,30,33)],checks:{highestTargets:true}},
 {label:"poison-touch-burn",abilityId:172,playerMoves:[33],checks:{enemyStatus:4}},
 {label:"custom-status",abilityId:173,checks:{status:4}},
 {label:"suppression",abilityId:168,hp:10,enemies:[mon(320,100,380)],checks:{heal:0,suppressed:true}},
 {label:"swap-away",abilityId:165,playerMoves:[285],checks:{playerAbilities:[165,50,165]}},
 {label:"and-or-false",abilityId:168,hp:100,checks:{heal:0}},
 {label:"highest-id-entry",abilityId:255,checks:{stages:[6,6,7,6,6,6,6]}},
 {label:"tough-claws",abilityId:177,playerMoves:[33],checks:{multiplier:5325}},
 {label:"protean",abilityId:178,playerMoves:[55],checks:{playerTypesAfterFirstTurn:[10,10]}},
 {label:"queenly-majesty",abilityId:179,enemies:[mon(320,100,98)],checks:{noDamage:true}},
 {label:"mirror-armor",abilityId:180,enemies:[mon(320,100,45)],checks:{stages:neutral,enemyStagesByTurn:[neutral,[5,6,6,6,6,6,6],[4,6,6,6,6,6,6]]}},
 {label:"copied-status-immunity",abilityId:181,enemies:[mon(320,100,261)],checks:{status:0,abilityPopupAfterFirstMenu:true}},
 {label:"recoil",abilityId:182,playerMoves:[33],checks:{recoilPercent:10}},
 {label:"critical",abilityId:183,playerMoves:[33],checks:{rewrite:{key:44,value:4}}},
 {label:"mixed-priority",abilityId:176,playerMoves:[33],checks:{enemyStatus:4,speedStages:[6,7,8],priorityGroups:true,mixedPriorityIds:[176]}},
 {label:"mixed-suppression",abilityId:176,playerMoves:[33],enemies:[mon(320,100,380)],checks:{enemyStatus:0,stages:neutral,suppressed:true,priorityGroups:true,mixedPriorityIds:[176]}},
 {label:"mixed-swap",abilityId:176,playerMoves:[285],checks:{playerAbilities:[176,50,176],priorityGroups:true,mixedPriorityIds:[176]}},
 {label:"knockout-splash",abilityId:170,playerMoves:[82],ally:mon(1,50),enemies:[mon(113,100),mon(320,1),mon(321,100)],battleType:"Doubles",checks:{knockoutSplash:{percent:20,hpBasis:0}}},
 {label:"swap-gain",abilityId:50,playerMoves:[285],enemies:[mon(320,100,150,165)],checks:{playerAbilities:[50,165,50]}},
];
cases.push({label:"weather-immunity",abilityId:174,enemies:[mon(320,100,150,117)],checks:{noWeatherDamage:true,stages:[6,6,7,6,6,6,6]}});
cases.push(
 {label:"weather-condition-true",abilityId:192,enemies:[mon(320,100,150,117)],checks:{multiplier:8192,weatherDamage:true}},
 {label:"weather-condition-false",abilityId:192,checks:{noMultiplier:8192,noDamage:true}},
 {label:"weather-condition-suppressed",abilityId:192,enemies:[mon(320,100,380,117)],checks:{suppressed:true,noMultiplierAfterFirstTurn:8192}},
 {label:"weather-condition-cloud-nine",abilityId:192,ally:mon(320,100,150,117),enemies:[mon(320,100,150,13),mon(321)],battleType:"Doubles",checks:{noMultiplier:8192,noWeatherDamage:true}}
);
if(process.argv.includes("--client"))cases.push({label:"client-magnet-pull",abilityId:50,enemies:[mon(320,100,150,185)],enemyAbility:185,menuCount:1,bench:[mon(4,50)],checks:{trapType:11}});
if(frost){
 const personal=decodeRecord(project,"personal",175).raw!;personal.type_1=17;personal.type_2=17;markDirty(project,"personal",175);
 const move=decodeRecord(project,"moves",1).raw!;move.type=17;markDirty(project,"moves",1);
 cases.push(
  {label:"pixilate-fairy-super-effective",abilityId:186,playerMoves:[33],enemies:[mon(147)],checks:{multiplier:4915,outgoingEffectiveness:[4,4]}},
  {label:"refrigerate-converted",abilityId:190,playerMoves:[33],enemies:[mon(147)],checks:{multiplier:4915,outgoingEffectiveness:[4,4]}},
  {label:"refrigerate-existing-ice",abilityId:190,playerMoves:[181],enemies:[mon(147)],checks:{noMultiplier:4915,outgoingEffectiveness:[4,4]}},
  {label:"fairy-immune-dragon",abilityId:50,playerSpecies:175,enemies:[mon(147,100,337)],checks:{noDamage:true}},
  {label:"fairy-color-change",abilityId:187,enemies:[mon(320,100,1)],checks:{playerTypesAfterFirstTurn:[17,17]}},
  {label:"fairy-magnet-pull",abilityId:50,playerSpecies:175,enemies:[mon(320,100,150,188)],enemyAbility:188,menuCount:1,bench:[mon(4,50)],checks:{trapType:17}},
  {label:"fairy-conditions",abilityId:189,playerSpecies:175,hp:10,checks:{heal:7}},
  {label:"fairy-pixilate-suppression",abilityId:186,playerMoves:[33],enemies:[mon(320,100,380)],checks:{noMultiplier:4915,suppressed:true}},
  {label:"fairy-pixilate-swap",abilityId:186,playerMoves:[285,33],turnMove:[0,1],checks:{playerAbilities:[186,50,50],noMultiplierAfterFirstTurn:4915}},
  {label:"fairy-tera-shell",abilityId:191,playerSpecies:175,enemies:[mon(320,30,430)],checks:{effectiveness:[2,4]}}
 );
}
if(moveClasses){
 const basePower=Number(decodeRecord(project,"moves",33).raw!.power),waterPower=Number(decodeRecord(project,"moves",352).raw!.power),icePower=Number(decodeRecord(project,"moves",420).raw!.power);
 cases.splice(0,cases.length,
  {label:"refrigerate-one",playerSpecies:527,abilityId:165,playerMoves:[33],enemies:[mon(527)],checks:{power:{move:33,value:basePower,type:14}}},
  {label:"refrigerate-three",playerSpecies:527,abilityId:166,playerMoves:[33],enemies:[mon(527)],checks:{power:{move:33,value:basePower*3,type:14}}},
  {label:"refrigerate-existing-ice",playerSpecies:527,abilityId:166,playerMoves:[420],enemies:[mon(527)],checks:{power:{move:420,value:icePower,type:14}}},
  {label:"mega-launcher-added-pulse",abilityId:167,playerMoves:[33],checks:{power:{move:33,value:basePower*3,type:0}}},
  {label:"mega-launcher-cleared-pulse",abilityId:167,playerMoves:[352],checks:{power:{move:352,value:waterPower,type:10}}},
  {label:"wind-rider-added-wind",abilityId:168,enemies:[mon(320,30,33)],checks:{noDamage:true,playerStagesByTurn:[neutral,[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]]}},
  {label:"wind-rider-cleared-wind",abilityId:168,enemies:[mon(320,30,16)],checks:{stages:neutral}},
  {label:"stamina-capped",abilityId:169,enemies:[mon(320,5,33)],checks:{stages:[6,12,6,6,6,6,6],popupsByTurn:[1,0,0]}},
  {label:"stat-drop-capped",abilityId:170,enemies:[mon(320,5,33)],checks:{stages:[6,0,6,6,6,6,6],popupsByTurn:[1,0,0]}},
  {label:"mixed-capped-and-valid",abilityId:171,enemies:[mon(320,5,33)],checks:{playerStagesByTurn:[[6,12,6,6,6,6,6],[7,12,6,6,6,6,6],[8,12,6,6,6,6,6]],popupsByTurn:[1,1,1]}},
  {label:"move-editor-power-three",abilityId:50,playerMoves:[44],checks:{power:{move:44,value:Number(decodeRecord(project,"moves",44).raw!.power)*3,type:16}}}
 );
 if(!process.argv.includes("--move-power"))cases.pop();
}
if(notifications){
 const blocked=(ability:number,move:number)=>({blockMessages:{ability,move,count:2},noDamage:true,popupsByTurn:[0,1,1]});
 cases.splice(0,cases.length,
  {label:"anger-shell",abilityId:178,enemies:[mon(320,30,162)],checks:{playerStagesByTurn:[neutral,[7,5,7,5,7,6,6],[7,5,7,5,7,6,6]],popupsByTurn:[0,1,0]}},
  {label:"anger-shell-capped",abilityId:179,enemies:[mon(320,30,162)],checks:{stages:[12,0,12,0,12,6,6],popupsByTurn:[1,0,0]}},
  {label:"anger-shell-partial",abilityId:180,enemies:[mon(320,30,162)],checks:{playerStagesByTurn:[[12,6,6,6,6,6,6],[12,5,7,5,7,6,6],[12,5,7,5,7,6,6]],popupsByTurn:[1,1,0]}},
  {label:"queenly-block-message",abilityId:165,enemies:[mon(320,30,98)],checks:blocked(165,98)},
  {label:"dazzling-block-message",abilityId:166,enemies:[mon(320,30,98)],checks:blocked(166,98)},
  {label:"armor-tail-block-message",abilityId:167,enemies:[mon(320,30,98)],checks:blocked(167,98)},
  {label:"queenly-normal-move",abilityId:165,enemies:[mon(320,30,33)],checks:{blockMessages:{count:0},popupsByTurn:[0,0,0]}},
  {label:"queenly-edited-threshold",abilityId:174,enemies:[mon(320,30,98)],checks:{blockMessages:{count:0},popupsByTurn:[0,0,0]}},
  {label:"queenly-skill-swap",abilityId:165,playerMoves:[285],enemies:[mon(320,30,98)],checks:{playerAbilities:[165,50,165],blockMessages:{ability:165,move:98,count:1}}},
  {label:"bulletproof-block-message",abilityId:168,enemies:[mon(320,30,247)],checks:blocked(168,247)},
  {label:"good-as-gold-block-message",abilityId:169,enemies:[mon(320,30,86)],checks:{...blocked(169,86),blockMessages:{count:0},guardMessages:{id:210,count:2},status:0}},
  {label:"wind-rider-block-message",abilityId:170,enemies:[mon(320,30,16)],checks:{...blocked(170,16),blockMessages:{count:0},playerStagesByTurn:[neutral,[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]]}},
  {label:"wind-rider-capped-block-message",abilityId:175,enemies:[mon(320,30,16)],checks:{...blocked(175,16),blockMessages:{count:0},guardMessages:{id:210,count:2},popupsByTurn:[1,1,1],stages:[12,6,6,6,6,6,6]}},
  {label:"sweet-veil-status-message",abilityId:171,enemies:[mon(320,30,147)],checks:{noDamage:true,status:0,guardMessages:{id:210,count:2},popupsByTurn:[0,1,1]}},
  {label:"flower-veil-stat-message",abilityId:172,enemies:[mon(320,30,45)],checks:{noDamage:true,stages:neutral,guardMessages:{id:198,count:2},popupsByTurn:[0,1,1]}},
  {label:"toxic-debris-at-layer-cap",abilityId:176,enemies:[mon(320,5,33)],menuCount:4,checks:{popupsByTurn:[0,1,1,0]}},
  {label:"wind-rider-whirlwind",abilityId:170,enemies:[mon(320,30,18)],ally:mon(1,50,150),checks:{noDamage:true,playerStagesByTurn:[[6,6,6,6,6,6,6],[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]],popupsByTurn:[0,1,1]}},
  {label:"perish-body-countdown",abilityId:177,enemies:[mon(320,5,33)],menuCount:4,checks:{perishFaint:true,perishCountdown:[0,3,2,1],noticeMessages:{slot:14,count:1},popupsByTurn:[0,1,0,0]}},
  {label:"perish-body-no-contact",abilityId:177,enemies:[mon(320,5,55)],checks:{conditionAbsent:20,popupsByTurn:[0,0,0]}},
  {label:"guard-dog-message",abilityId:173,enemies:[mon(320,30,150,22)],checks:{stages:[7,6,6,6,6,6,6],guardMessages:{id:198,count:1},popupsByTurn:[1,0,0],popupOwner:0}}
 );
}
if(actionResultsMode)cases.splice(0,cases.length,
 {label:"fairy-aura-label",abilityId:220,playerSpecies:498,checks:{noticeMessages:{slot:32,count:1},popupsByTurn:[1,0,0],captureAuraText:"Fairy"}},
 {label:"dark-aura-label",abilityId:221,checks:{noticeMessages:{slot:31,count:1},popupsByTurn:[1,0,0],captureAuraText:"Dark"}},
 {label:"edited-water-aura-label",abilityId:222,checks:{noticeMessages:{slot:25,count:1},popupsByTurn:[1,0,0],captureAuraText:"Water"}},
 {label:"toxic-chain-failed-roll",abilityId:223,playerMoves:[33],checks:{enemyStatus:0,popupsByTurn:[0,0,0],statusPopupMatchesRolls:true,minimumFailedStatusRolls:1}},
 {label:"toxic-chain-success-once",abilityId:224,playerMoves:[33],checks:{enemyStatus:5,popupsByTurn:[0,1,0]}},
 {label:"toxic-chain-thirty-percent",abilityId:226,playerMoves:[33],menuCount:4,checks:{statusPopupMatchesRolls:true}},
 {label:"toxic-chain-steel-immunity",abilityId:224,playerMoves:[33],enemies:[mon(81)],checks:{enemyStatus:0,popupsByTurn:[0,0,0]}},
 {label:"toxic-chain-suppressed",abilityId:224,playerMoves:[33],enemies:[mon(320,100,380)],checks:{enemyStatus:0,suppressed:true,popupsByTurn:[0,0,0]}}
);
if(process.argv.includes("--expanded-classes")){
 const names=new Map(getTextBank(project,"message_texts",203).filter(e=>parseTextEntryId(e[0]).block===0).map(e=>[e[1].replace(/[^a-z]/gi,"").toLowerCase(),parseTextEntryId(e[0]).entry]));
 const ball=names.get("pyroball")!,wind=names.get("bleakwindstorm")!;assert(ball>=560&&wind>=560);
 cases.push({label:"expanded-bulletproof",abilityId:168,enemies:[mon(320,30,ball)],checks:{noDamage:true,blockMessages:{ability:168,move:ball,count:2},popupsByTurn:[0,1,1]}},
 {label:"expanded-wind-rider",abilityId:170,enemies:[mon(320,30,wind)],checks:{noDamage:true,playerStagesByTurn:[neutral,[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]],popupsByTurn:[0,1,1]}});
}
if(customFlagsMode){
 cases.splice(0,cases.length,...customFlagCases(project).map(spec=>({label:spec.label,abilityId:spec.abilityId,playerMoves:[spec.move??150],hp:spec.hp,enemies:[mon(320,spec.enemyLevel??(spec.enemyMove?30:100),spec.enemyMove??150)],checks:spec.checks})));
}
if(statusPopups)cases.splice(0,cases.length,...statusPopups.cases.map(spec=>({...spec,playerMoves:"playerMoves"in spec&&spec.playerMoves?spec.playerMoves:[spec.move??150],enemies:Array.from({length:spec.enemyCount??1},(_,index)=>({...mon(spec.enemySpecies??320,spec.enemyLevel??100,index?spec.enemy2Move??spec.enemyMove??150:spec.enemyMove??150),abilitySlot:index?2:1,abilityId:index?spec.enemy2Ability??spec.enemyAbility??50:spec.enemyAbility??50,gender:0 as const}))})));
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(","),hashes:Record<string,string>={},fixtures=[];
for(const[index,spec]of cases.entries()){
 if(only&&!only.includes(spec.label))continue;
 const enemies=spec.enemies??[mon()];patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:spec.battleType??"Singles",trainer:{team:enemies,ai:0}}));
 const downloads=await buildTestBattleDownloads(project,2);
 if(spec.battleType==="Doubles"){
  // BW1's normal double-trainer launch requires a second field NPC with the
  // same trainer ID. Add the partner to this disposable fixture, using retail
  // data and the ordinary battle script rather than a battle-engine hook.
  const fixture=new NintendoDSRom(downloads.romBytes,{fileData:"view"}),path="a/1/2/5",archive=new NARC(fixture.getFileByName(path)),before=new NARC(rom.getFileByName(path));let partners=0;
  archive.files.forEach((bytes,i)=>{if(bytes.length!==before.files[i].length+36)return;const end=8+bytes[4]*20+bytes[5]*36,first=bytes.slice(end-36,end);if(readU16(first,10)!==3002)return;const partner=first.slice();writeU16(partner,0,readU16(first,0)+1);writeU16(partner,28,readU16(first,28)+1);const expanded=new Uint8Array(bytes.length+36);expanded.set(bytes.subarray(0,end));expanded.set(partner,end);expanded.set(bytes.subarray(end),end+36);expanded[5]++;writeU32(expanded,0,readU32(bytes,0)+36);archive.files[i]=expanded;partners++;});
  assert(partners>0,"Double-trainer field partner fixture missing");downloads.romBytes=fixture.save({files:new Map([[fixture.fileId(path),archive.save()]]),preserveOriginalLength:true});
 }
 const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:spec.playerSpecies??1,level:50,moves:spec.playerMoves??[150],abilityId:spec.abilityId,itemId:0,...(spec.playerGender===undefined?{}:{gender:spec.playerGender}),...(spec.hp===undefined?{}:{currentHp:spec.hp}),...(spec.playerStatus?{status:spec.playerStatus}:{})},...(spec.ally?[spec.ally]:[]),...(spec.bench??[])]}}));
 if(spec.battleType==="Doubles")for(const half of [0,0x24000]){
  // The bundled save restores field actors, so the partner also needs its own
  // actor record. Preserve the first actor and every unrelated saved actor.
  const slots=Array.from({length:64},(_,n)=>half+0x1e200+n*80),first=slots.find(at=>(readU32(save,at)&1)&&readU16(save,at+24)===3002),free=slots.find(at=>!(readU32(save,at)&1));assert(first!==undefined&&free!==undefined);
  save.set(save.slice(first,first+80),free);save[free+8]=save[first+8]+1;for(const field of [32,38])writeU16(save,free+field,readU16(save,first+field)+1);
  refreshTestBattleSaveBlockChecksum(save,getTestBattleConfig("BW").saveLayout,half,0x1e200,0x1400,0x1f602,41);
 }
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),label=`${String(index).padStart(3,"0")}-${spec.label}`,filename=`battle-${sha(new TextEncoder().encode(JSON.stringify([spec.battleType,enemies]))).slice(0,16)}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save);if(!hashes[filename]){await writeFile(`${out}/${filename}`,downloads.romBytes);hashes[filename]=sha(downloads.romBytes);}
 fixtures.push({...spec,enemyCount:enemies.length,label,speciesId:spec.playerSpecies??1,maxHp:readU16(raw,0x90),hp:spec.hp??readU16(raw,0x90),rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:sha(input),exportSha256:sha(exported),reexportSha256:sha(final),projectReload:true,romExportReload:true,importsLinked:ABILITY_IMPORT_LIBRARY.length,editedAbilities:rules.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:dllBytes.length,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,api,symbols,pmcSymbols,popupGateway:dll.symbols[gateway.sourceSymbolIndex].address,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,priorityRuntime:true,...notificationsMetadata,presentationMessages:JSON.parse(String(dll.metadata.PokewebAbilityPresentationMessages??"[]")),...(moveClasses||customFlagsMode?{powerHook:resolver.resolve("BW1_BTL_SERVER_FLOW_CalcMovePower").address}:{}),...(clientTrapStores?{clientTrapStores,typeQuery:resolver.resolve("DoesMonHaveType").address}:{}),damageReactionHook:resolver.resolve("ServerEvent_DamageReaction").address,eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30),fieldAddress:readU32(resolver.resolve("IsFieldEffectActive").code,8),sideTableAddress:(()=>{const side=rom.loadArm9Overlays([95]).get(95)!;return side.ramAddress+side.ramSize;})(),manualLaunch:true,openingHook:game==="W"?0x021bbb80:0x021bbb60,flowRegister:"r0",commandHook:game==="W"?0x021baccc:0x021bacac},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))),sha(input));console.log(`${fixtures.length} ${game} native fixtures; project and ROM reload passed.`);
