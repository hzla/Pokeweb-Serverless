/** Popup grouping and precise passive multipliers: production ROM fixtures. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects,hydrateAbilityEffectsSource,ABILITY_EFFECTS_DLL_PATH,ABILITY_RULE_API} from "../../src/pokeweb/abilityEffectsModel";
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

const [path,directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [LEGACY_EXPORT.nds]");
const out=resolve(directory),input=new Uint8Array(await readFile(path)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"ability-popup.nds",{selectedNarcs:["personal","items","message_texts","moves","trdata","trpok"]});
const legacyPath=process.argv[4];let legacyReceipt:unknown;
if(legacyPath){
 const bytes=new Uint8Array(await readFile(legacyPath)),old=await load(bytes),before=inspectAbilityEffects(old);assert(before.editable,before.message);assert(before.rules.size>0);
 const [abilityId,rules]=[...before.rules][0];await configureAbilityRuleSets(old,[{abilityId,rules}]);
 const changed=inspectAbilityEffects(old);assert(changed.editable,changed.message);assert.deepEqual(changed.rules,before.rules);
 legacyReceipt={sha256:sha(bytes),rules:before.rules.size,editable:true,upgradePreservesRules:true};
}
let project=await load(input);
const all={kind:"group" as const,mode:"all" as const,children:[]};
const harden=validateAbilityRule({effects:[{kind:"abilityRecipe:statAction",value:1,parameters:{stat:2}},{kind:"abilityRecipe:statAction",value:-1,parameters:{stat:5}}],conditions:all});
const entries=new Map<number,AbilityRuleSet>([
 [165,harden],
 [166,validateAbilityRule({effects:[{kind:"defense",value:1.2},{kind:"speed",value:.8}],conditions:all})],
 [167,validateAbilityRule({effects:[...harden.effects,{kind:"statStage",stat:2,value:1,trigger:"turnEnd"},{kind:"statStage",stat:5,value:-1,trigger:"turnEnd"}],conditions:all})],
 [168,validateAbilityRule({effects:[{kind:"nativeAbility:22",value:-1,stat:1},{kind:"nativeAbility:22",value:-1,stat:3}],conditions:all})],
 [169,validateAbilityRule({effects:[{kind:"nativeAbility:22",value:-1,stat:3},...harden.effects],conditions:all})],
 [170,validateAbilityRule({...harden,conditions:{kind:"hp",comparison:"lte",percent:50}})],
 [171,validateAbilityRule({effects:Array.from({length:16},(_,i)=>({kind:"abilityRecipe:statAction" as const,value:i<8?1:-1,parameters:{stat:i%8%7+1,once:i===7||i===15?1:0}})),conditions:all})],
 [172,validateAbilityRule({effects:[{kind:"ability:hitStat",value:1,parameters:{stat:2}},{kind:"ability:hitStat",value:-1,parameters:{stat:5}}],conditions:all})],
]);
const names=new Map([[165,"Harden"],[166,"Sturdy Pace"],[167,"Slow Armor"],[168,"Dual Scare"],[169,"Scary Armor"],[170,"Hurt Armor"],[171,"Many Changes"],[172,"Hit Armor"]]);
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
const verify=()=>{const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/ability-popup.nds`,exported,{flag:"wx"});project=await load(exported);verify();
// Reapplying the recipe on a loaded export must retain the grouped runtime.
await configureAbilityRuleSets(project,[{abilityId:165,rules:harden}]);trim();
const reexported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/ability-popup-reloaded.nds`,reexported,{flag:"wx"});project=await load(reexported);verify();
const rom=new NintendoDSRom(reexported,{fileData:"view"});validateHarnessRom(rom);
const dllBytes=rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],dll=parseRpm(dllBytes,{allowedMagics:["DLXF"]});assert.equal(dll.metadata.PokewebAbilityPopupGroups,1);
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,readU32(dll.code,symbols.AbilityRuleApi+i*4)&~1]]:[]));
const gateway=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+20*4)!;
const popupGateway=dll.symbols[gateway.sourceSymbolIndex].address;
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const overlay=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress);
const encoded=encodeAbilityRules(entries),nativeOffsets:number[]=[];
for(const[id,r]of entries){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
const neutral=[6,6,6,6,6,6,6],hard=[6,7,6,6,5,6,6],hard2=[6,8,6,6,4,6,6],scare=[5,6,5,6,6,6,6];
const cases=[
 {label:"harden-entry",abilityId:165,checks:{stages:hard,popupsByTurn:[1,0,0],name:true}},
 {label:"harden-both-holders",abilityId:165,enemyAbility:165,checks:{stages:hard,enemyStages:hard,popupsByTurn:[2,0,0]}},
 {label:"harden-swap-gain",abilityId:165,enemyMove:285,enemyLevel:100,checks:{playerAbilities:[165,50,165],enemyAbilities:[50,165,50],playerStagesByTurn:[hard,hard,hard2],enemyStagesByTurn:[neutral,hard,hard],popupsByTurn:[1,1,1]}},
 {label:"harden-suppressed",abilityId:167,enemyMove:380,enemyLevel:100,checks:{stages:hard,suppressed:true,popupsByTurn:[1,0,0]}},
 {label:"separate-entry-end-turn",abilityId:167,checks:{playerStagesByTurn:[hard,hard2,[6,9,6,6,3,6,6]],popupsByTurn:[1,1,1]}},
 {label:"copied-intimidates",abilityId:168,checks:{enemyStages:scare,popupsByTurn:[1,0,0]}},
 {label:"native-and-recipe",abilityId:169,checks:{stages:hard,enemyStages:[6,6,5,6,6,6,6],popupsByTurn:[1,0,0]}},
 {label:"conditions-false",abilityId:170,checks:{stages:neutral,popupsByTurn:[0,0,0]}},
 {label:"conditions-true",abilityId:170,hp:60,checks:{stages:hard,popupsByTurn:[1,0,0]}},
 {label:"sixteen-effects",abilityId:171,checks:{stages:neutral,popupsByTurn:[1,0,0]}},
 {label:"precise-passive-stats",abilityId:166,enemyMove:33,checks:{stages:neutral,allMultipliers:[4915,3277],popupsByTurn:[0,0,0]}},
 {label:"precise-stats-suppressed",abilityId:166,enemyMove:380,enemyLevel:100,checks:{suppressed:true,noMultiplierAfterFirstTurn:3277,popupsByTurn:[0,0,0]}},
 {label:"hit-stat-pair",abilityId:172,enemyMove:33,checks:{playerStagesByTurn:[neutral,hard,hard2],popupsByTurn:[0,1,1]}},
];
const baseSave=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
for(const[i,spec]of cases.entries()){
 const enemyMove="enemyMove"in spec?spec.enemyMove:150,enemyAbility="enemyAbility"in spec?spec.enemyAbility:50,enemyLevel="enemyLevel"in spec?spec.enemyLevel:enemyMove===33?30:100;
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:"Singles",trainer:{team:[{speciesId:320,level:enemyLevel,moves:[enemyMove],itemId:0,abilityId:enemyAbility}],ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[150],itemId:0,abilityId:spec.abilityId,...("hp"in spec?{currentHp:spec.hp}:{})}]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${enemyMove}-${enemyAbility}-${enemyLevel}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save,{flag:"wx"});
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeFile(`${out}/${filename}`,bytes,{flag:"wx"});hashes[filename]=sha(bytes);}
 fixtures.push({...spec,saveSha256:sha(save),label,speciesId:1,maxHp,hp:"hp"in spec?spec.hp:maxHp,rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:sha(input),exportSha256:sha(exported),reexportSha256:sha(reexported),legacy:legacyReceipt,editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:dllBytes.length,popupGateway,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true},null,2)+"\n",{flag:"wx"});
assert.equal(sha(new Uint8Array(await readFile(path))),sha(input));console.log(`${cases.length} native popup fixtures; project/ROM export/reload and legacy upgrade passed.`);
