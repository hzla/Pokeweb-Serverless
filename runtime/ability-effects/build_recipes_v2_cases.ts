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
import {decryptPk5Party} from "../../src/pokeweb/testBattleTeam";
import {battleRuntimeResolver} from "../../src/pokeweb/battleRuntimeBindings";
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
// Deterministic status fixture: the imported default (30%) remains unit-checked.
const toxic=entries.get(slots.get(302)!)!;entries.set(slots.get(302)!,validateAbilityRule({...toxic,effects:[{...toxic.effects[0],chance:100}]}));
entries.set(234,validateAbilityRule({...abilityImport(181).rule,effects:[{kind:"ability:power",value:2.5,parameters:{moveClass:1}}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}]}}));names.set(234,"Fierce Claws");
entries.set(235,validateAbilityRule({effects:[...abilityImport(181).rule.effects,{kind:"nativeAbility:143",value:-1,parameters:{contactStatus:4,activationChance:100}}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(235,"Burning Claws");
entries.set(236,validateAbilityRule({effects:[{kind:"nativeAbility:3",value:-1}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(236,"Speed Buddy");
entries.set(237,validateAbilityRule({effects:[{kind:"nativeAbility:4",value:-1}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(237,"Armor Check");
entries.set(238,validateAbilityRule({effects:[{kind:"abilityRecipe:convertType",value:2.5,parameters:{type:17}}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}]}}));names.set(238,"Fierce Aero");
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
const verify=()=>{const s=inspectAbilityEffects(project);assert(s.editable,s.message);assert.deepEqual(s.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeArtifact(`${out}/ability-imports.nds`,exported);project=await load(exported);verify();
// Re-edit an imported effect and conditions after loading its exported ROM.
const editReceipts=[];
const editedId=slots.get(292)!;
for(const [value,moveClass,type]of [[2.5,9,17],[1.5,7,0]]){
 const rules=validateAbilityRule({...entries.get(editedId)!,effects:[{kind:"ability:power",value,parameters:moveClass===9?{moveClass,type}:{moveClass}}]});entries.set(editedId,rules);
 await configureAbilityRuleSets(project,[{abilityId:editedId,rules}]);trim();const bytes=await exportModifiedRom(project,{forDsi:false}),file=`ability-imports-edited-${editReceipts.length}.nds`;await writeArtifact(`${out}/${file}`,bytes);project=await load(bytes);verify();editReceipts.push({file,value,moveClass,type,sha256:sha(bytes),editableAfterReload:true});
}
const convertedId=slots.get(184)!,originalConversion=structuredClone(entries.get(convertedId)!);
for(const rules of [entries.get(238)!,originalConversion]){
 entries.set(convertedId,rules);await configureAbilityRuleSets(project,[{abilityId:convertedId,rules}]);trim();const bytes=await exportModifiedRom(project,{forDsi:false}),file=`ability-imports-edited-${editReceipts.length}.nds`;await writeArtifact(`${out}/${file}`,bytes);project=await load(bytes);verify();editReceipts.push({file,abilityId:convertedId,rules,sha256:sha(bytes),editableAfterReload:true});
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
type Case={label:string;abilityId:number;enemyAbility?:number;enemySpecies?:number;playerSpecies?:number;enemyMove?:number;enemyLevel?:number;enemyCount?:number;move?:number;hp?:number;playerItem?:number;playerStatus?:HarnessPokemon["status"];ally?:HarnessPokemon;ally2?:HarnessPokemon;battleType?:"Doubles"|"Triples";menuCount?:number;checks:Record<string,unknown>};
const cases:Case[]=[];
const stages=(stat:number,...values:number[])=>values.map(v=>Array.from({length:7},(_,i)=>i===stat-1?v:6));
function test(official:number,label:string,checks:Case["checks"],extra:Partial<Case>={}){cases.push({label,abilityId:slots.get(official)!,checks,...extra});}
test(169,"fur-coat",{multiplier:8192},{enemyMove:33});
test(171,"bulletproof",{hpByTurn:[120,120,120],rewrite:{key:64,value:1}},{enemyMove:247});
test(172,"competitive",{stages:[5,6,8,6,6,6,6]},{enemyAbility:22});
test(173,"strong-jaw",{multiplier:6144},{move:44});
test(173,"strong-jaw-negative",{noMultiplier:6144},{move:33});
test(177,"gale-wings",{rewrite:{key:24,value:8}},{move:17});
test(177,"gale-wings-hp-negative",{noRewrite:{key:24,value:8}},{move:17,hp:119});
test(177,"gale-wings-type-negative",{noRewrite:{key:24,value:8}},{move:33});
test(181,"tough-claws",{multiplier:5325},{move:33});
test(183,"gooey",{enemySpeedStages:[6,5,4]},{enemyMove:33});
test(192,"stamina",{playerStagesByTurn:stages(2,6,7,8)},{enemyMove:33});
test(195,"water-compaction",{playerStagesByTurn:stages(2,6,8,10)},{enemyMove:55});
test(199,"water-bubble",{allMultipliers:[8192,2048]},{move:55,enemyMove:52});
test(199,"water-bubble-burn-immunity",{status:0},{enemyMove:261});
test(200,"steelworker",{multiplier:6144},{move:232});
test(202,"slush-rush",{multiplier:8192,weatherDamage:true},{enemyAbility:117});
test(205,"triage",{healPercent:50,rewrite:{key:24,value:10}},{move:105,hp:10});
test(205,"triage-draining-move",{rewrite:{key:24,value:10},hpIncreases:true,enemyDamaged:true},{move:409,hp:10});
test(218,"fluffy-contact",{multiplier:2048},{enemyMove:33});
test(218,"fluffy-fire",{multiplier:8192},{enemyMove:52,enemyLevel:20});
test(218,"fluffy-contact-fire",{allMultipliers:[2048,8192]},{enemyMove:7});
test(221,"tangling-hair",{enemySpeedStages:[6,5,4]},{enemyMove:33});
test(230,"full-metal-body",{stages:[6,6,6,6,6,6,6]},{enemyAbility:22});
test(231,"shadow-shield",{multiplier:2048},{enemyAbility:104,enemyMove:55});
test(232,"prism-armor",{multiplier:3072},{enemyAbility:104,enemyMove:52});
test(233,"neuroforce",{multiplier:5120},{move:22});
test(243,"steam-engine-fire",{speedStages:[6,12,12]},{enemyMove:52});
test(243,"steam-engine-water",{speedStages:[6,12,12]},{enemyMove:55});
test(243,"steam-engine-negative",{speedStages:[6,6,6]},{enemyMove:33});
test(244,"punk-rock",{allMultipliers:[5325,2048]},{move:496,enemyMove:304,enemyLevel:60});
test(246,"ice-scales",{multiplier:2048},{enemyMove:55});
test(246,"ice-scales-physical-negative",{noMultiplier:2048},{enemyMove:33});
test(246,"ice-scales-mold-breaker",{noMultiplier:2048},{enemyMove:55,enemyAbility:104});
test(262,"transistor",{multiplier:5325},{move:84});
test(263,"dragons-maw",{multiplier:6144},{move:225});
test(264,"chilling-neigh",{playerStagesByTurn:stages(1,6,7,8)},{move:22,enemyLevel:5,enemyCount:3});
test(265,"grim-neigh",{playerStagesByTurn:stages(3,6,7,8)},{move:22,enemyLevel:5,enemyCount:3});
test(270,"thermal-exchange",{playerStagesByTurn:stages(1,6,7,8)},{enemyMove:52});
test(270,"thermal-exchange-burn-immunity",{status:0},{enemyMove:261});
test(272,"purifying-salt-status",{status:0},{enemyMove:86});
test(272,"purifying-salt-ghost",{multiplier:2048},{enemyMove:247});
test(273,"well-baked-body",{hpByTurn:[120,120,120],playerStagesByTurn:stages(2,6,8,10)},{enemyMove:52});
test(276,"rocky-payload",{multiplier:6144},{move:88});
test(292,"sharpness",{multiplier:6144},{move:163});
test(297,"earth-eater",{healPercent:25},{enemyMove:189,hp:10});
test(302,"toxic-chain-edited-chance",{enemyStatus:5},{move:33});
cases.push({label:"edited-ratio-and-or-positive",abilityId:234,move:33,hp:60,checks:{multiplier:10240}},
 {label:"edited-ratio-and-or-negative",abilityId:234,move:33,hp:61,checks:{noMultiplier:10240}},
 {label:"mixed-library-priority-native",abilityId:235,move:33,checks:{multiplier:5325,enemyStatus:4}},
 {label:"suppression-stops-library-and-native",abilityId:235,move:33,enemyMove:380,enemyLevel:100,checks:{noMultiplier:5325,enemyStatus:0,suppressed:true}},
 {label:"swap-custom-to-native",abilityId:235,move:33,enemyMove:285,enemyLevel:100,checks:{playerAbilities:[235,50,235],enemyAbilities:[50,235,50],enemyStatusByTurn:[0,0,4]}},
 {label:"swap-between-custom",abilityId:235,move:33,enemyMove:285,enemyLevel:100,enemyAbility:236,checks:{playerAbilities:[235,236,235],enemyAbilities:[236,235,236],enemySpeedStages:[6,6,7]}});
// Additional primitives: native engine checks use deterministic moves / fixtures.
for(const[id,label,type]of [[184,"aerilate",2],[182,"pixilate",17],[174,"refrigerate",14],[206,"galvanize",12]])test(id,label,{multiplier:4915,rewrite:{key:22,value:type}},{move:33});
test(204,"liquid-voice",{rewrite:{key:22,value:10}},{move:496});
test(165,"aroma-veil",{conditionAbsent:11},{enemyMove:269});
test(166,"flower-veil",{status:0},{enemyMove:86});
test(166,"flower-veil-stat",{stages:[6,6,6,6,6,6,6]},{enemyAbility:22});
test(175,"sweet-veil",{status:0},{enemyMove:47});
test(167,"cheek-pouch",{hpByTurn:[70,70,70],itemByTurn:[0,0,0]},{hp:20,playerItem:155});
test(201,"berserk",{playerStagesByTurn:stages(3,6,6,7),hpByTurn:[120,80,40]},{enemyMove:82});
test(271,"anger-shell",{playerStagesByTurn:[[6,6,6,6,6,6,6],[6,6,6,6,6,6,6],[7,5,7,5,7,6,6]],hpByTurn:[120,80,40]},{enemyMove:82});
test(224,"beast-boost",{playerStagesByTurn:stages(3,6,7,8)},{move:22,enemyLevel:5,enemyCount:3});
test(220,"soul-heart",{playerStagesByTurn:stages(3,6,7,8)},{move:22,enemyLevel:5,enemyCount:3});
test(215,"innards-out",{retaliateExact:true},{move:22,enemyLevel:5,enemyCount:3,enemyAbility:slots.get(215)});
test(196,"merciless",{allEnemyCritical:true},{move:150,playerStatus:"poison"});
// The poisoned holder is the defender for the enemy Merciless callback.
cases[cases.length-1].enemyAbility=slots.get(196);cases[cases.length-1].enemyMove=33;
test(238,"cotton-down",{enemySpeedStages:[6,5,4]},{enemyMove:33});
test(234,"intrepid-sword",{stages:[7,6,6,6,6,6,6]});
test(235,"dauntless-shield",{stages:[6,7,6,6,6,6,6]});
test(245,"sand-spit",{weather:4,weatherDamage:true},{enemyMove:33});
test(257,"pastel-veil",{status:0},{playerStatus:"poison",enemyMove:139});
test(253,"perish-body",{conditionPresent:20,enemyConditionPresent:20},{enemyMove:33});
test(283,"good-as-gold",{status:0,rewrite:{key:64,value:1}},{enemyMove:86});
test(283,"good-as-gold-own-recover",{healPercent:50},{move:105,hp:10});
test(275,"guard-dog",{stages:[7,6,6,6,6,6,6]},{enemyAbility:22});
test(300,"minds-eye-accuracy",{stages:[6,6,6,6,6,6,6]},{enemyMove:28});
test(306,"supersweet-syrup",{enemyStages:[6,6,6,6,6,6,5]});
test(308,"tera-shell",{effectiveness:[2,4]},{enemyMove:52});
test(295,"toxic-debris",{hazardLayers:[0,1,2,2]},{enemyMove:33,menuCount:4});
test(288,"orichalcum-pulse",{multiplier:5461,weather:1},{move:33});
test(274,"wind-rider-wind",{hpByTurn:[120,120,120],playerStagesByTurn:stages(1,6,7,8)},{enemyMove:16});
test(274,"wind-rider-tailwind",{playerStagesByTurn:stages(1,6,7,7)},{move:366});
// Doubles cover ally-only scope, copy/reset, type guards and healing.
const allyMon:HarnessPokemon={speciesId:85,level:50,moves:[33],abilityId:50,itemId:0};
for(const[id,label,checks,extra]of [
 [217,"battery",{multiplier:5325},{ally:{...allyMon,moves:[55]}}],
 [249,"power-spot",{multiplier:5325},{ally:allyMon}],
 [252,"steely-spirit",{multiplier:6144},{ally:{...allyMon,moves:[232]}}],
 [294,"costar",{stages:[7,6,6,6,6,6,6]},{ally:{...allyMon,abilityId:slots.get(234)}}],
 [261,"curious-medicine",{partyStages:[[6,6,6,6,6,6,6],[6,6,6,6,6,6,6]]},{ally:{...allyMon,abilityId:slots.get(234)}}],
 [299,"hospitality",{allyHpByTurn:[93,93,93]},{ally:{...allyMon,currentHp:60,moves:[150]}}],
 [251,"screen-cleaner",{screensCleared:true},{enemyMove:115,enemyLevel:100,ally:{...allyMon,abilityId:50,moves:[115],pp:[1,0,0,0]},move:285}],
 
]as Array<[number,string,Record<string,unknown>,Partial<Case>]>)test(id,label,checks,{battleType:"Doubles",enemyCount:2,...extra});
cases.push({label:"aroma-veil-protects-ally",abilityId:50,battleType:"Doubles",enemyCount:2,enemyMove:269,ally:{...allyMon,abilityId:slots.get(165),moves:[150]},checks:{conditionAbsent:11,allyConditionAbsent:11,rewrite:{key:65,value:1}}});
test(166,"flower-veil-protects-ally",{partyStages:[[6,6,6,6,6,6,6],[6,6,6,6,6,6,6]]},{battleType:"Doubles",enemyCount:2,enemyAbility:22,ally:{...allyMon,speciesId:2,moves:[150]}});
test(234,"entry-once-survives-swap",{playerAbilities:[slots.get(234),50,slots.get(234)],playerStagesByTurn:stages(1,7,7,7)},{enemyMove:285,enemyLevel:100});
test(184,"conversion-suppressed",{noMultiplier:4915,suppressed:true},{move:33,enemyMove:380,enemyLevel:100});
test(238,"reaction-swap",{playerAbilities:[slots.get(238),50,slots.get(238)],enemyAbilities:[50,slots.get(238),50]},{enemyMove:285,enemyLevel:100});
test(308,"tera-shell-mold-breaker",{effectiveness:[4,4]},{enemyMove:52,enemyAbility:104});
test(308,"tera-shell-damaged",{effectiveness:[4,4]},{enemyMove:52,hp:119});
test(283,"good-as-gold-mold-breaker",{status:1},{enemyMove:86,enemyAbility:104});
test(166,"flower-veil-yawn",{conditionAbsent:14,status:0},{enemyMove:281});
test(166,"flower-veil-own-rest",{status:2},{move:156,hp:30});
test(257,"pastel-veil-ally-cure",{allyStatus:0},{battleType:"Doubles",enemyCount:2,ally:{...allyMon,moves:[150],status:"poison"}});
test(201,"berserk-healing-berry",{playerStagesFirstTurn:[6,6,7,6,6,6,6],berryAfterStage:true},{enemyMove:52,hp:66,playerItem:155,menuCount:2});
test(224,"beast-boost-suppressed",{playerStagesByTurn:stages(3,6,6,6),suppressed:true},{move:22,enemyMove:380,enemyLevel:5,enemyCount:3,enemyAbility:158});
test(217,"battery-suppressed",{someHolderSuppressed:true,noSuppressedMultipliers:true},{move:55,battleType:"Doubles",enemyCount:2,enemyMove:380,enemyLevel:100,ally:{...allyMon,abilityId:slots.get(217),moves:[55]}});
cases.push({label:"merciless-respects-armor",abilityId:237,playerStatus:"poison",enemyMove:33,enemyAbility:slots.get(196),checks:{noEnemyCritical:true}});
cases.push({label:"new-recipe-and-or-positive",abilityId:238,move:33,hp:60,checks:{multiplier:10240,rewrite:{key:22,value:17}}},{label:"new-recipe-and-or-negative",abilityId:238,move:33,hp:61,checks:{noMultiplier:10240,noRewrite:{key:22,value:17}}});
test(299,"hospitality-adjacent-triples",{partyHpByTurn:[[120,93,60],[120,93,60],[120,93,60]]},{battleType:"Triples",enemyCount:3,ally:{...allyMon,currentHp:60,moves:[150]},ally2:{...allyMon,speciesId:84,currentHp:60,moves:[150]}});
test(306,"supersweet-adjacent-triples",{enemyPartyStages:[[6,6,6,6,6,6,6],[6,6,6,6,6,6,5],[6,6,6,6,6,6,5]]},{battleType:"Triples",enemyCount:3,ally:{...allyMon,moves:[150]},ally2:{...allyMon,speciesId:84,moves:[150]}});
cases.push({label:"costar-copies-critical-focus-on-gain",abilityId:50,move:285,battleType:"Doubles",enemyCount:2,enemyAbility:slots.get(294),ally:{...allyMon,moves:[116]},checks:{playerFocusByTurn:[false,true,true]}});
test(308,"tera-shell-preserves-ghost-immunity",{noDamage:true,effectiveness:[]},{playerSpecies:353,enemyMove:33});
test(300,"minds-eye-ignores-evasion",{rewrite:{key:40,value:6},enemyDamaged:true},{move:33,enemyMove:104,enemyLevel:100});
test(300,"minds-eye-hits-ghost",{enemyDamaged:true},{move:33,enemySpecies:353});
test(201,"berserk-sheer-force-keeps-berry-timing",{playerStagesFirstTurn:[6,6,6,6,6,6,6],itemAtMoveEndFirstTurn:155,itemByTurn:[155,0]},{enemyMove:52,enemyAbility:125,hp:66,playerItem:155,menuCount:2});
test(275,"guard-dog-allows-intimidate-holders-growl",{playerStagesByTurn:stages(1,7,6,5)},{enemyAbility:22,enemyMove:45});
cases.push({label:"native-berry-timing-baseline",abilityId:236,hp:66,playerItem:155,enemyMove:52,enemyAbility:125,menuCount:2,checks:{itemAtMoveEndFirstTurn:155,itemByTurn:[155,0]}});
const baseSave=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
for(const[i,spec]of cases.entries()){
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:spec.battleType??"Singles",trainer:{team:Array.from({length:spec.enemyCount??1},()=>({speciesId:spec.enemySpecies??320,level:spec.enemyLevel??(spec.enemyMove?30:100),moves:[spec.enemyMove??150],itemId:0,abilityId:spec.enemyAbility??50})),ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:spec.playerSpecies??1,level:50,moves:[spec.move??150],itemId:spec.playerItem??0,abilityId:spec.abilityId,...(spec.playerStatus?{status:spec.playerStatus}:{}),...(spec.hp!==undefined?{currentHp:spec.hp}:{})},...(spec.ally?[spec.ally]:[]),...(spec.ally2?[spec.ally2]:[])]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${spec.enemySpecies??320}-${spec.battleType??"Singles"}-${spec.enemyMove??150}-${spec.enemyAbility??50}-${spec.enemyLevel??(spec.enemyMove?30:100)}-${spec.enemyCount??1}.nds`;
 await writeArtifact(`${out}/saves/${label}.sav`,save);
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeArtifact(`${out}/${filename}`,bytes);hashes[filename]=sha(bytes);}
 fixtures.push({...spec,saveSha256:sha(save),label,speciesId:spec.playerSpecies??1,maxHp,hp:spec.hp??maxHp,rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:inputHash,exportSha256:sha(exported),reexportSha256:sha(reexported),editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length,nameLoader,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true,reloadedEdits:editReceipts,imports:ABILITY_IMPORT_LIBRARY.map(t=>({officialId:t.id,assignedId:slots.get(t.id),name:t.defaultName,generation:t.generation})),priorityRuntime:true,eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address,sideTableAddress,weatherAddress:readU32(resolver.resolve("GetFieldWeather").code,8),damageReactionHook:resolver.resolve("ServerEvent_DamageReaction").address,nativeChanceHook:resolver.resolve("AbilityEvent_RollEffectChance").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30)},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(path))),inputHash);console.log(`${cases.length} ability import fixtures; export/reload and parameter re-edits passed.`);
