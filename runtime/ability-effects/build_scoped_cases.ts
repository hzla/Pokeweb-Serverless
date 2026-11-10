import {statusCases} from "./status_cases";
import {environmentCases} from "./environment_cases";
import {strikeCases} from "./strike_cases";
import {protectCases} from "./protect_cases";
import {weatherCases} from "./weather_cases";
import {configureItemRuleSets} from "../../src/pokeweb/itemEffectsModel";
import {configureMoveRuleSets} from "../../src/pokeweb/moveEffectsModel";
import {statSourceCases} from "./stat_source_cases";
import { prepareCustomFlagCases, customFlagCases } from "./custom_flag_cases";
import { statusPopupCases } from "./status_popup_cases";
import blackAbilityBindings from "../../src/assets/data/abilityBindingsB1.json";
/** Editable Gen 6–9 recipe imports: ROM lifecycle and native battle fixtures. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects,hydrateAbilityEffectsSource,ABILITY_EFFECTS_DLL_PATH,ABILITY_RULE_API} from "../../src/pokeweb/abilityEffectsModel";
import {ABILITY_IMPORT_LIBRARY,abilityImport} from "../../src/pokeweb/abilityLibrary";
import {validateAbilityRule,encodeAbilityRules,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import {configureHarnessRuntime, type HarnessPokemon,parseHarnessConfig,patchHarnessSave,patchHarnessTrainer,validateHarnessRom} from "../../src/pokeweb/battleHarness";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {createProjectDocument} from "../../src/pokeweb/projectDocument";
import {openProjectSession} from "../../src/pokeweb/projectSession";
import {parseRpm} from "../../src/pokeweb/rpm";
import {prepareBw2TestBattleCodeInjection,stageCodeInjectionDll} from "../../src/pokeweb/pmcModel";
import {getTestBattleConfig,rawSaveBytesFromDesmumeDsv} from "../../src/pokeweb/testBattle";
import {patchTestBattleSavePlayerParty} from "../../src/pokeweb/testBattleTeam";
import {decryptPk5Party} from "../../src/pokeweb/testBattleTeam";
import {battleRuntimeResolver} from "../../src/pokeweb/battleRuntimeBindings";
import moveBindings from "../../src/assets/data/moveRecipeBindings.json";
import blackMoveBindings from "../../src/assets/data/moveRecipeBindingsB1.json";
const [path,directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: INPUT.nds OUTPUT_DIRECTORY");
const out=resolve(directory),input=new Uint8Array(await readFile(path)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex"),inputHash=sha(input);
await mkdir(`${out}/saves`,{recursive:true});
// Resuming a cohort may add corrected fixture filenames; existing artifacts must be identical.
async function writeArtifact(path:string,bytes:Uint8Array){let old:Uint8Array|undefined;try{old=new Uint8Array(await readFile(path));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}if(old){assert.equal(sha(old),sha(bytes),`Existing artifact differs: ${path}; use a fresh output directory.`);return;}await writeFile(path,bytes,{flag:"wx"});}

globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"ability-imports.nds",{selectedNarcs:["personal","items","message_texts","moves","trdata","trpok"]});
let project=await load(input);
const entries=new Map<number,AbilityRuleSet>(),names=new Map<number,string>();
const slots=new Map<number,number>();
for(const [i,t]of ABILITY_IMPORT_LIBRARY.entries()){
 const id=165+i;slots.set(t.id,id);entries.set(id,abilityImport(t.id).rule);names.set(id,t.defaultName);
}
const all={kind:"group" as const,mode:"all" as const,children:[]};
const variants:Record<number,AbilityRuleSet>={
 126:validateAbilityRule({effects:[...[{kind:"abilityRecipe:statAction",value:6,parameters:{stat:1}},{kind:"abilityRecipe:statAction",value:-6,parameters:{stat:2}},{kind:"abilityRecipe:statAction",value:6,parameters:{stat:3}},{kind:"abilityRecipe:statAction",value:-6,parameters:{stat:4}},{kind:"abilityRecipe:statAction",value:6,parameters:{stat:5}}],...abilityImport(271).rule.effects],conditions:all}),
 127:validateAbilityRule({effects:[{kind:"abilityRecipe:statAction",value:6,parameters:{stat:1}},...abilityImport(271).rule.effects],conditions:all}),
 129:validateAbilityRule({effects:[{kind:"abilityRecipe:priorityGuard",value:2}],conditions:all}),
 130:validateAbilityRule({...abilityImport(168).rule,effects:[{...abilityImport(168).rule.effects[0],parameters:{limit:0}}]}),
 131:validateAbilityRule({...abilityImport(186).rule,effects:[{...abilityImport(186).rule.effects[0],value:2}],conditions:{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"species",value:4}]}]}}),
 132:validateAbilityRule({effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:1}}],conditions:all}),
 133:validateAbilityRule({effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:1}},{kind:"abilityRecipe:statAction",value:1,parameters:{stat:2}}],conditions:all}),
 134:validateAbilityRule({...abilityImport(168).rule,effects:[{...abilityImport(168).rule.effects[0],parameters:{limit:0,type:9}}]}),
};
for(const[id,rule]of Object.entries(variants)){entries.set(Number(id),rule);names.set(Number(id),`Test ${id}`);}
const customFlagsMode=process.argv.includes("--custom-flags");
if(customFlagsMode)for(const[id,rule]of await prepareCustomFlagCases(project)){entries.set(id,rule);names.set(id,`Flag Test ${id}`);}
const statusPopups=process.argv.includes("--status-extensions")?statusCases():process.argv.includes("--weather-moves")?weatherCases():process.argv.includes("--protect")?protectCases():process.argv.includes("--strikes")?strikeCases():process.argv.includes("--environment")?environmentCases():process.argv.includes("--stat-source")?statSourceCases(true):process.argv.includes("--status-popups")?statusPopupCases():undefined;
if(statusPopups){entries.clear();names.clear();for(const[id,rule]of statusPopups.rules){entries.set(id,rule);names.set(id,statusPopups.names.get(id)!);}}
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
if(process.argv.includes("--strikes-coexist")||process.argv.includes("--status-coexist")){
 await configureItemRuleSets(project,[{itemId:281,rules:{effects:[{kind:"healPercent",value:10}],conditions:all,consumable:false}}]);
 await configureMoveRuleSets(project,[{moveId:33,rules:{effects:[{kind:"power",value:2,phase:"power",target:"user",chance:100,secondary:false,conditions:all}],conditions:all,prerequisites:all}}]);
}
if(process.argv.includes("--stat-source"))await configureItemRuleSets(project,[{itemId:85,rules:{effects:[{kind:"statStage",value:-1,stat:5,trigger:"afterContact",target:"attacker",chance:100}],conditions:all,consumable:false}}]);
if(process.argv.includes("--status-extensions")){const {decodeRecord,markDirty}=await import("../../src/pokeweb/projectStore");for(const id of [92,261,496]){decodeRecord(project,"moves",id).raw!.accuracy=100;if(id===496)decodeRecord(project,"moves",id).raw!.type=12;markDirty(project,"moves",id);}}
if(process.argv.includes("--environment")){
 // Fixture-only accuracy: isolate damage immunity from Leech Seed's hit roll.
 const {decodeRecord,markDirty}=await import("../../src/pokeweb/projectStore");decodeRecord(project,"moves",73).raw!.accuracy=100;markDirty(project,"moves",73);
}
const verify=()=>{const s=inspectAbilityEffects(project);assert(s.editable,s.message);assert.deepEqual(s.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeArtifact(`${out}/ability-imports.nds`,exported);project=await load(exported);verify();
const editReceipts=[];
for(const official of(process.argv.includes("--quick")||statusPopups?[]:[168,186,198,240,284,290,293,296,180,178])){
 const editedId=slots.get(official)!,original=entries.get(editedId)!;
 const changed=validateAbilityRule({...original,effects:original.effects.map(e=>({...e,conditions:undefined,parameters:{...e.parameters,...(official===168?{limit:0,type:9}:official===186?{type:17,invertedPercent:50}:official===240||official===290?{stat:3}:official===284?{stat:2}:official===293?{cap:3}:official===296?{scope:0}:official===180?{activationChance:75}:{})},value:official===198?2.5:official===178?2: e.value})),conditions:{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}});
 for(const rules of[changed,original]){entries.set(editedId,rules);await configureAbilityRuleSets(project,[{abilityId:editedId,rules}]);trim();const bytes=await exportModifiedRom(project,{forDsi:false});project=await load(bytes);verify();editReceipts.push({officialId:official,sha256:sha(bytes),editableAfterReload:true});}
}
trim();const reexported=await exportModifiedRom(project,{forDsi:false});await writeArtifact(`${out}/ability-imports-reloaded.nds`,reexported);project=await load(reexported);verify();
const rom=new NintendoDSRom(reexported,{fileData:"view"});validateHarnessRom(rom);
const dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi+i*4,true)&~1]]:[]));
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const overlay=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress),nameLoader=resolver.resolve("loadAbilityNameToStrbuf").address;
const sideOverlay=rom.loadArm9Overlays([169]).get(169)!,sidePattern=Buffer.from("e022424302480901801808587047c046","hex"),sideCandidates:number[]=[];
for(let at=0;at+20<=sideOverlay.data.length;at+=2)if(sidePattern.every((v,i)=>sideOverlay.data[at+i]===v))sideCandidates.push(at);
assert.equal(sideCandidates.length,1);const sideTableAddress=readU32(sideOverlay.data,sideCandidates[0]+16)-12;
assert(sideTableAddress>=sideOverlay.ramAddress+sideOverlay.data.length&&sideTableAddress+448<=sideOverlay.ramAddress+sideOverlay.ramSize+sideOverlay.bssSize);
const encoded=encodeAbilityRules(entries),nativeOffsets:number[]=[];
for(const[id,r]of entries){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
type Case={label:string;abilityId:number;enemyAbility?:number;enemySpecies?:number;playerSpecies?:number;playerGender?:0|1;enemyMove?:number;enemyLevel?:number;enemyCount?:number;enemyItem?:number;move?:number;playerMoves?:number[];turnMove?:number[];hp?:number;playerItem?:number;playerStatus?:HarnessPokemon["status"];ally?:HarnessPokemon;ally2?:HarnessPokemon;battleType?:"Doubles"|"Triples";menuCount?:number;checks:Record<string,unknown>;enemy2Ability?:number;enemy2Move?:number};
const cases:Case[]=[];
const stages=(stat:number,...values:number[])=>values.map(v=>Array.from({length:7},(_,i)=>i===stat-1?v:6));
function test(official:number,label:string,checks:Case["checks"],extra:Partial<Case>={}){cases.push({label,abilityId:slots.get(official)!,checks,...extra});}
test(168,"protean-status",{playerTypesAfterFirstTurn:[0,0]},{move:150});
test(168,"protean-immunity",{playerTypesAfterFirstTurn:[10,10]},{move:55,enemyAbility:11});
test(168,"protean-once",{playerTypesByTurn:[[11,3],[10,10],[10,10]],stabByTurn:[true,false]},{playerMoves:[55,52],turnMove:[0,1]});
cases.push({label:"protean-every-move",abilityId:130,playerMoves:[55,52],turnMove:[0,1],checks:{playerTypesByTurn:[[11,3],[10,10],[9,9]],stabByTurn:[true,true]}});
test(293,"supreme-fainted-bench",{multiplier:4506},{move:55,ally:{speciesId:1,level:50,moves:[150],abilityId:50,currentHp:0}});
test(168,"protean",{playerTypesAfterFirstTurn:[10,10],enemyDamaged:true},{move:55});
test(236,"libero",{playerTypesAfterFirstTurn:[10,10],enemyDamaged:true},{move:55});
test(168,"protean-suppressed",{playerTypesAfterFirstTurn:[11,3],suppressed:true},{move:55,enemyMove:380,enemyLevel:100});
test(168,"protean-skill-swap",{playerAbilities:[slots.get(168),50,slots.get(168)],enemyAbilities:[50,slots.get(168),50]},{enemyMove:285,enemyLevel:100,move:55});
test(186,"dark-aura",{multiplier:5461},{move:44});
test(187,"fairy-aura",{multiplier:5461},{move:496});
test(186,"aura-duplicate",{multiplier:5461},{move:44,enemyAbility:slots.get(186)});
test(188,"aura-break",{multiplier:3072,noMultiplier:5461},{move:44,enemyAbility:slots.get(186)});
test(186,"aura-wrong-type",{noMultiplier:5461},{move:55});
test(186,"aura-suppressed",{noMultiplier:5461,suppressed:true},{move:44,enemyMove:380,enemyLevel:100});
cases.push({label:"aura-and-or-positive",abilityId:131,move:44,hp:60,checks:{multiplier:8192}},{label:"aura-and-or-negative",abilityId:131,move:44,checks:{noMultiplier:8192}});
test(284,"beads-of-ruin",{multiplier:3072},{move:55});
test(285,"sword-of-ruin",{multiplier:3072},{move:33});
test(286,"tablets-of-ruin",{multiplier:3072},{enemyMove:33});
test(287,"vessel-of-ruin",{multiplier:3072},{enemyMove:55});
test(284,"ruin-duplicate-exemption",{noMultiplier:3072},{move:55,enemyAbility:slots.get(284)});
test(285,"ruin-suppressed",{noMultiplier:3072,suppressed:true},{move:33,enemyMove:380,enemyLevel:100});
test(168,"protean-weather-ball",{playerTypesAfterFirstTurn:[10,10],stabByTurn:[true,true]},{move:311,enemyAbility:2});
test(293,"supreme-entry-snapshot",{noMultiplier:4506,allyHpByTurn:[1,0,0]},{move:55,enemyMove:57,enemyLevel:30,battleType:"Doubles",enemyCount:2,ally:{speciesId:1,level:1,moves:[150],abilityId:50,currentHp:1}});
test(296,"priority-prankster",{stages:[6,6,6,6,6,6,6],rewrite:{key:64,value:1}},{enemyMove:45,enemyAbility:158});
test(296,"priority-allies",{noDamage:true,allyHpByTurn:[120,120,120],rewrite:{key:64,value:1}},{enemyMove:98,enemyLevel:30,battleType:"Doubles",enemyCount:2,ally:{speciesId:1,level:50,moves:[150],abilityId:50}});
test(198,"stakeout-switch",{multiplier:8192},{move:55,enemyMove:369,enemyLevel:30,enemySpecies:101,enemyCount:2});
test(198,"stakeout-initial-lead",{noMultiplier:8192},{move:33});
test(293,"supreme-no-faints",{noMultiplier:4506},{move:33});
for(const official of[214,219,296])test(official,`priority-${official}`,{noDamage:true,rewrite:{key:64,value:1}},{enemyMove:98});
test(296,"priority-normal",{onlyMoveDamage:true},{enemyMove:33});
test(296,"priority-suppressed",{suppressed:true,noRewrite:{key:64,value:1}},{enemyMove:380,enemyLevel:100});
test(240,"mirror-armor",{stages:[6,6,6,6,6,6,6],enemyStagesByTurn:stages(1,6,5,4)},{enemyMove:45});
test(240,"mirror-double",{stages:[6,6,6,6,6,6,6],enemyStagesByTurn:stages(1,6,5,4)},{enemyMove:45,enemyAbility:slots.get(240)});
test(240,"mirror-clear-body",{stages:[6,6,6,6,6,6,6],enemyStages:[6,6,6,6,6,6,6]},{enemyMove:45,enemyAbility:29});
test(290,"opportunist",{playerStagesByTurn:stages(1,6,8,10)},{enemyMove:14});
test(290,"opportunist-double",{playerStagesByTurn:stages(1,6,8,10),enemyStagesByTurn:stages(1,6,8,10)},{enemyMove:14,enemyAbility:slots.get(290)});
test(290,"opportunist-entry",{stages:[7,7,6,6,6,6,6]},{enemyAbility:133});
test(290,"opportunist-suppressed",{suppressed:true,stages:[6,6,6,6,6,6,6]},{enemyMove:380,enemyLevel:100});
test(170,"magician",{itemByTurn:[0,234,234]},{move:33,enemyItem:234});
test(170,"magician-already-held",{itemByTurn:[238,238,238]},{move:33,enemyItem:234,playerItem:238});
test(170,"magician-sticky-hold",{itemByTurn:[0,0,0]},{move:33,enemyItem:234,enemyAbility:60});
test(180,"symbiosis-berry",{itemByTurn:[234,234,234],allyItemsByTurn:[0,0,0]},{playerItem:155,hp:50,ally:{speciesId:1,level:50,moves:[150],itemId:234,abilityId:slots.get(180)!},battleType:"Doubles",enemyCount:2});
test(180,"symbiosis-white-herb",{itemByTurn:[214,234,234],allyItemsByTurn:[234,0,0]},{playerItem:214,enemyMove:45,ally:{speciesId:1,level:50,moves:[150],itemId:234,abilityId:slots.get(180)!},battleType:"Doubles",enemyCount:2});
for(const official of[186,284,240])test(official,`swap-${official}`,{playerAbilities:[slots.get(official),50,slots.get(official)],enemyAbilities:[50,slots.get(official),50]},{enemyMove:285,enemyLevel:100,move:official===186?44:55});
test(290,"opportunist-swapped-reactions",{playerAbilities:[slots.get(290),132,slots.get(290)],enemyAbilities:[132,slots.get(290),132],playerStagesByTurn:stages(1,7,8,9),enemyStagesByTurn:stages(1,7,8,9)},{enemyMove:285,enemyAbility:132,enemyLevel:100});
test(170,"magician-swapped",{playerAbilities:[slots.get(170),50,slots.get(170)],itemByTurn:[0,0,234]},{move:33,enemyMove:285,enemyLevel:100,enemyItem:234});
test(293,"supreme-swapped-fainted",{playerAbilities:[slots.get(293),50,slots.get(293)],multiplier:4506},{move:55,enemyMove:285,enemyLevel:100,ally:{speciesId:1,level:50,moves:[150],abilityId:50,currentHp:0}});
// Follow Me deterministically redirects Gastro Acid to the item donor.
test(180,"symbiosis-suppressed-donor-follow-me",{allySuppressed:true,itemByTurn:[155,155,0],allyItemsByTurn:[234,234,234],hpByTurn:[90,75,70]},{playerItem:155,hp:90,playerStatus:"poison",enemyMove:380,enemyLevel:100,battleType:"Doubles",enemyCount:2,ally:{speciesId:1,level:50,moves:[266],abilityId:slots.get(180)!,itemId:234}});
cases.push({label:"stock-speed-boost",abilityId:3,checks:{speedStages:[6,7,8]}},{label:"stock-clear-body",abilityId:29,enemyMove:45,checks:{stages:[6,6,6,6,6,6,6]}});
test(178,"mega-launcher",{multiplier:6144},{move:352});
test(178,"mega-launcher-negative",{noMultiplier:6144},{move:55});
test(178,"mega-launcher-suppressed",{noMultiplier:6144,suppressed:true},{move:352,enemyMove:380,enemyLevel:100});
test(178,"heal-pulse-unchanged",{enemyHpByTurn:[120,1,61],noMultiplier:6144},{hp:1,playerMoves:[283,505],turnMove:[0,1],enemySpecies:1,enemyLevel:50});
cases.push({label:"heal-pulse-stock-control",abilityId:50,hp:1,playerMoves:[283,505],turnMove:[0,1],enemySpecies:1,enemyLevel:50,checks:{enemyHpByTurn:[120,1,61],noMultiplier:6144}});
if(process.argv.includes("--notifications")){
 cases.length=0;
 test(271,"anger-shell",{playerStagesByTurn:[[6,6,6,6,6,6,6],[7,5,7,5,7,6,6],[7,5,7,5,7,6,6]],popupsByTurn:[0,1,0]},{enemyMove:162});
 cases.push({label:"anger-shell-capped",abilityId:126,enemyMove:162,checks:{stages:[12,0,12,0,12,6,6],popupsByTurn:[1,0,0]}});
 cases.push({label:"anger-shell-partial",abilityId:127,enemyMove:162,checks:{playerStagesByTurn:[[12,6,6,6,6,6,6],[12,5,7,5,7,6,6],[12,5,7,5,7,6,6]],popupsByTurn:[1,1,0]}});
 for(const[official,label]of [[214,"queenly-message"],[219,"dazzling-message"],[296,"armor-tail-message"]]as const)test(official,label,{noDamage:true,popupsByTurn:[0,1,1],blockMessages:{ability:slots.get(official),move:98,count:2}},{enemyMove:98});
 test(214,"queenly-normal",{popupsByTurn:[0,0,0],blockMessages:{count:0}},{enemyMove:33});
 cases.push({label:"queenly-edited-threshold",abilityId:129,enemyMove:98,checks:{popupsByTurn:[0,0,0],blockMessages:{count:0}}});
 test(214,"queenly-swap",{playerAbilities:[slots.get(214),50,slots.get(214)],blockMessages:{ability:slots.get(214),move:98,count:1}},{move:285,enemyMove:98});
 test(171,"bulletproof-message",{noDamage:true,popupsByTurn:[0,1,1],blockMessages:{ability:slots.get(171),move:247,count:2}},{enemyMove:247});
 test(283,"good-as-gold-message",{noDamage:true,status:0,popupsByTurn:[0,1,1],guardMessages:{id:210,count:2}},{enemyMove:86});
 for(const[official,label,slot]of [[186,"aura-entry",31],[188,"aura-break-entry",1],[284,"ruin-entry",5]]as const)test(official,label,{popupsByTurn:[1,0,0],noticeMessages:{slot,count:1}});
 test(293,"overlord-no-faints",{popupsByTurn:[0,0,0],noticeMessages:{slot:10,count:0}});
 test(293,"overlord-fainted-bench",{popupsByTurn:[1,0,0],noticeMessages:{slot:10,count:1}},{ally:{speciesId:1,level:50,moves:[150],abilityId:50,currentHp:0}});
 test(251,"cleaner-no-screens",{popupsByTurn:[0,0,0]});
 test(251,"cleaner-with-screens",{screensCleared:true,popupsByTurn:[0,1,1]},{enemyMove:115,enemyLevel:100,battleType:"Doubles",enemyCount:2,ally:{speciesId:85,level:50,abilityId:50,moves:[115],pp:[1,0,0,0]},move:285});
 test(295,"toxic-debris-at-layer-cap",{hazardLayers:[0,1,2,2],popupsByTurn:[0,1,1,0]},{enemyMove:33,menuCount:4});
 const partner:HarnessPokemon={speciesId:85,level:50,moves:[33],abilityId:slots.get(234)};
 test(294,"costar-message",{stages:[7,6,6,6,6,6,6],noticeMessages:{slot:13,count:1},popupsByTurn:[1,0,0],popupOwner:0},{battleType:"Doubles",enemyCount:2,ally:partner});
 test(261,"curious-medicine-message",{partyStages:[[6,6,6,6,6,6,6],[6,6,6,6,6,6,6]],noticeMessages:{slot:12,count:1},popupsByTurn:[1,0,0],popupOwner:0},{battleType:"Doubles",enemyCount:2,ally:partner});
 for(const[official,label]of [[294,"costar-no-change"],[261,"curious-medicine-no-change"]]as const)test(official,label,{popupsByTurn:[0,0,0]},{battleType:"Doubles",enemyCount:2,ally:{...partner,abilityId:50}});
 test(253,"perish-body-countdown",{perishFaint:true,perishCountdown:[0,3,2,1],noticeMessages:{slot:14,count:1},popupsByTurn:[0,1,0,0]},{enemyMove:33,menuCount:4});
 test(253,"perish-body-no-contact",{conditionAbsent:20,popupsByTurn:[0,0,0]},{enemyMove:55});
 test(274,"wind-rider-whirlwind",{noDamage:true,playerStagesByTurn:[[6,6,6,6,6,6,6],[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]],popupsByTurn:[0,1,1]},{enemyMove:18,ally:{speciesId:1,level:50,moves:[150],abilityId:50}});
}
if(process.argv.includes("--expanded-classes")){
 const ball=project.texts.banks.moves!.indexOf("Pyro Ball"),wind=project.texts.banks.moves!.indexOf("Bleakwind Storm");assert(ball>=560&&wind>=560);
 test(171,"expanded-bulletproof",{noDamage:true,blockMessages:{ability:slots.get(171),move:ball,count:2},popupsByTurn:[0,1,1]},{enemyMove:ball});
 test(274,"expanded-wind-rider",{noDamage:true,playerStagesByTurn:[[6,6,6,6,6,6,6],[7,6,6,6,6,6,6],[8,6,6,6,6,6,6]],popupsByTurn:[0,1,1]},{enemyMove:wind});
}
if(customFlagsMode)cases.splice(0,cases.length,...customFlagCases(project));
if(statusPopups)cases.splice(0,cases.length,...statusPopups.cases);
if(process.argv.includes("--strikes-coexist")){
 const coexist=cases.find(c=>c.label==="strike-quarter")!;
 coexist.hp=90;coexist.playerItem=281;coexist.checks.power={move:33,value:100};coexist.checks.hpByTurn=[90,102,114];
}
const seedPath=process.argv.slice(4).find(arg=>!arg.startsWith("--"));
const seed=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(seedPath??getTestBattleConfig("BW2").saveUrl)));
// Rebuild only the disposable copy's party before the strict harness checks it.
// This permits an expanded-roster bundled seed with an unexpanded target ROM.
const baseSave=patchTestBattleSavePlayerParty(seed,project,"Bulbasaur\nLevel: 50\n- Splash");
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(",");
for(const[i,spec]of cases.entries()){
 if(only&&!only.includes(spec.label))continue;
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:spec.battleType??"Singles",trainer:{team:Array.from({length:spec.enemyCount??1},(_,index)=>({speciesId:spec.enemySpecies??320,level:spec.enemyLevel??(spec.enemyMove?30:100),moves:[index?spec.enemy2Move??spec.enemyMove??150:spec.enemyMove??150],itemId:spec.enemyItem??0,abilitySlot:index?2:1,abilityId:index?spec.enemy2Ability??spec.enemyAbility??50:spec.enemyAbility??50,...(statusPopups?{gender:0 as const}:{})})),ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:spec.playerSpecies??1,level:50,moves:spec.playerMoves??[spec.move??150],itemId:spec.playerItem??0,abilityId:spec.abilityId,...(spec.playerGender===undefined?{}:{gender:spec.playerGender}),...(spec.playerStatus?{status:spec.playerStatus}:{}),...(spec.hp!==undefined?{currentHp:spec.hp}:{})},...(spec.ally?[spec.ally]:[]),...(spec.ally2?[spec.ally2]:[])]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${spec.enemySpecies??320}-${spec.battleType??"Singles"}-${spec.enemyMove??150}-${spec.enemyAbility??50}-${spec.enemyLevel??(spec.enemyMove?30:100)}-${spec.enemyCount??1}-${spec.enemyItem??0}-${spec.enemy2Ability??50}-${spec.enemy2Move??150}.nds`;
 await writeArtifact(`${out}/saves/${label}.sav`,save);
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeArtifact(`${out}/${filename}`,bytes);hashes[filename]=sha(bytes);}
 fixtures.push({...spec,saveSha256:sha(save),label,speciesId:spec.playerSpecies??1,maxHp,hp:spec.hp??maxHp,rom:filename});
}
const messageSignature=structuredClone(blackMoveBindings.functions.BW1_BTL_SERVER_FLOW_PushMsgRecord);messageSignature.module="167";
if(messageSignature.hex.slice(128,132)!=="216a")throw Error("Unrecognized message signature");
messageSignature.hex=messageSignature.hex.slice(0,128)+"616a"+messageSignature.hex.slice(132);
const messageHook=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress,{...moveBindings.functions,NotificationMessage:messageSignature}).resolve("NotificationMessage").address;
let powerHook:number|undefined;
if(customFlagsMode||process.argv.includes("--strikes-coexist")){
 const extras=Object.fromEntries(Object.entries(blackAbilityBindings.functions).filter(([name])=>name.startsWith("BW1_")).map(([name,s])=>[name,{...s,module:s.module==="ARM9"?"ARM9":"167"}]));
 // The reviewed W2 routine has the same instructions/calls as BW1; its
 // diagnostic source-line marker is 0x30e6 rather than 0x30c7.
 const powerSignature=extras.BW1_BTL_SERVER_FLOW_CalcMovePower;
 assert.equal(powerSignature.hex.slice(320),"c7300000");
 powerSignature.hex=powerSignature.hex.slice(0,320)+"e6300000";
 powerHook=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress,{...moveBindings.functions,...extras}).resolve("BW1_BTL_SERVER_FLOW_CalcMovePower").address;
}
const popupGateway=dll.symbols[dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+80)!.sourceSymbolIndex].address;
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:inputHash,exportSha256:sha(exported),reexportSha256:sha(reexported),editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length,nameLoader,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true,reloadedEdits:editReceipts,imports:statusPopups?[]:ABILITY_IMPORT_LIBRARY.map(t=>({officialId:t.id,assignedId:slots.get(t.id),name:t.defaultName,generation:t.generation})),priorityRuntime:true,powerHook,popupGateway,messageHook,blockMessage:dll.metadata.PokewebAbilityBlockMessage,presentationMessages:JSON.parse(String(dll.metadata.PokewebAbilityPresentationMessages??"[]")),eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address,sideTableAddress,fieldAddress:readU32(resolver.resolve("IsFieldEffectActive").code,8),weatherAddress:readU32(resolver.resolve("GetFieldWeather").code,8),damageReactionHook:resolver.resolve("ServerEvent_DamageReaction").address,nativeChanceHook:resolver.resolve("AbilityEvent_RollEffectChance").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30)},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(path))),inputHash);console.log(`${fixtures.length} ability import fixtures; export/reload and ${editReceipts.length} parameter re-edits passed.`);
