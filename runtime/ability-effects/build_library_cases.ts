import {recipeAbilityEffect} from "../../src/pokeweb/abilityRecipeEffects";
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
import {configureHarnessRuntime,parseHarnessConfig,patchHarnessSave,patchHarnessTrainer,validateHarnessRom} from "../../src/pokeweb/battleHarness";
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
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"ability-imports.nds",{selectedNarcs:["personal","items","message_texts","moves","trdata","trpok"]});
let project=await load(input);
const entries=new Map<number,AbilityRuleSet>(),names=new Map<number,string>();
const slots=new Map<number,number>();
const legacyImports=ABILITY_IMPORT_LIBRARY.filter(t=>t.rule.effects.every(e=>!recipeAbilityEffect(e.kind)));
for(const [i,t]of legacyImports.entries()){
 const id=165+i;slots.set(t.id,id);entries.set(id,abilityImport(t.id).rule);names.set(id,t.defaultName);
}
// Deterministic status fixture: the imported default (30%) remains unit-checked.
const toxic=entries.get(slots.get(302)!)!;entries.set(slots.get(302)!,validateAbilityRule({...toxic,effects:[{...toxic.effects[0],chance:100}]}));
entries.set(198,validateAbilityRule({...abilityImport(181).rule,effects:[{kind:"ability:power",value:2.5,parameters:{moveClass:1}}],conditions:{kind:"group",mode:"all",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"type",value:11},{kind:"weather",value:3}]}]}}));names.set(198,"Fierce Claws");
entries.set(199,validateAbilityRule({effects:[...abilityImport(181).rule.effects,{kind:"nativeAbility:143",value:-1,parameters:{contactStatus:4,activationChance:100}}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(199,"Burning Claws");
entries.set(200,validateAbilityRule({effects:[{kind:"nativeAbility:3",value:-1}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(200,"Speed Buddy");
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
const verify=()=>{const s=inspectAbilityEffects(project);assert(s.editable,s.message);assert.deepEqual(s.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/ability-imports.nds`,exported,{flag:"wx"});project=await load(exported);verify();
// Re-edit an imported effect and conditions after loading its exported ROM.
const editReceipts=[];
const editedId=slots.get(292)!;
for(const [value,moveClass,type]of [[2.5,9,17],[1.5,7,0]]){
 const rules=validateAbilityRule({...entries.get(editedId)!,effects:[{kind:"ability:power",value,parameters:moveClass===9?{moveClass,type}:{moveClass}}]});entries.set(editedId,rules);
 await configureAbilityRuleSets(project,[{abilityId:editedId,rules}]);trim();const bytes=await exportModifiedRom(project,{forDsi:false}),file=`ability-imports-edited-${editReceipts.length}.nds`;await writeFile(`${out}/${file}`,bytes,{flag:"wx"});project=await load(bytes);verify();editReceipts.push({file,value,moveClass,type,sha256:sha(bytes),editableAfterReload:true});
}
trim();const reexported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/ability-imports-reloaded.nds`,reexported,{flag:"wx"});project=await load(reexported);verify();
const rom=new NintendoDSRom(reexported,{fileData:"view"});validateHarnessRom(rom);
const dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi+i*4,true)&~1]]:[]));
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const overlay=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress),nameLoader=resolver.resolve("loadAbilityNameToStrbuf").address;
const encoded=encodeAbilityRules(entries),nativeOffsets:number[]=[];
for(const[id,r]of entries){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
type Case={label:string;abilityId:number;enemyAbility?:number;enemyMove?:number;enemyLevel?:number;enemyCount?:number;move?:number;hp?:number;checks:Record<string,unknown>};
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
test(218,"fluffy-fire",{multiplier:8192},{enemyMove:52});
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
cases.push({label:"edited-ratio-and-or-positive",abilityId:198,move:33,hp:60,checks:{multiplier:10240}},
 {label:"edited-ratio-and-or-negative",abilityId:198,move:33,hp:61,checks:{noMultiplier:10240}},
 {label:"mixed-library-priority-native",abilityId:199,move:33,checks:{multiplier:5325,enemyStatus:4}},
 {label:"suppression-stops-library-and-native",abilityId:199,move:33,enemyMove:380,enemyLevel:100,checks:{noMultiplier:5325,enemyStatus:0,suppressed:true}},
 {label:"swap-custom-to-native",abilityId:199,move:33,enemyMove:285,enemyLevel:100,checks:{playerAbilities:[199,50,199],enemyAbilities:[50,199,50],enemyStatusByTurn:[0,0,4]}},
 {label:"swap-between-custom",abilityId:199,move:33,enemyMove:285,enemyLevel:100,enemyAbility:200,checks:{playerAbilities:[199,200,199],enemyAbilities:[200,199,200],enemySpeedStages:[6,6,7]}});
const baseSave=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
for(const[i,spec]of cases.entries()){
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:"Singles",trainer:{team:Array.from({length:spec.enemyCount??1},()=>({speciesId:320,level:spec.enemyLevel??(spec.enemyMove?30:100),moves:[spec.enemyMove??150],itemId:0,abilityId:spec.enemyAbility??50})),ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[spec.move??150],itemId:0,abilityId:spec.abilityId,...(spec.hp!==undefined?{currentHp:spec.hp}:{})}]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${spec.enemyMove??150}-${spec.enemyAbility??50}-${spec.enemyLevel??(spec.enemyMove?30:100)}-${spec.enemyCount??1}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save,{flag:"wx"});
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeFile(`${out}/${filename}`,bytes,{flag:"wx"});hashes[filename]=sha(bytes);}
 fixtures.push({...spec,label,speciesId:1,maxHp,hp:spec.hp??maxHp,rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:inputHash,exportSha256:sha(exported),reexportSha256:sha(reexported),editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length,nameLoader,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true,reloadedEdits:editReceipts,imports:legacyImports.map(t=>({officialId:t.id,assignedId:slots.get(t.id),name:t.defaultName,generation:t.generation})),priorityRuntime:true,nativeChanceHook:resolver.resolve("AbilityEvent_RollEffectChance").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30)},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(path))),inputHash);console.log(`${cases.length} ability import fixtures; export/reload and parameter re-edits passed.`);
