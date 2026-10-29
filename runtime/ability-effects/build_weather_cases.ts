/** Adjustable weather immunity: production ROM fixtures. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects,hydrateAbilityEffectsSource,ABILITY_EFFECTS_DLL_PATH,ABILITY_RULE_API} from "../../src/pokeweb/abilityEffectsModel";
import {abilityImport} from "../../src/pokeweb/abilityLibrary";
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

const [path,directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [LEGACY_EXPORT.nds] [--client]");
const out=resolve(directory),input=new Uint8Array(await readFile(path)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"weather-guard.nds",{selectedNarcs:["personal","items","message_texts","moves","trdata","trpok"]});
const client=process.argv.includes("--client");const legacyPath=process.argv[4]?.startsWith("--")?undefined:process.argv[4];let legacyReceipt:unknown;
if(legacyPath){
 const bytes=new Uint8Array(await readFile(legacyPath)),old=await load(bytes),before=inspectAbilityEffects(old);assert(before.editable,before.message);assert(before.rules.size>0);
 const [abilityId,rules]=[...before.rules][0];await configureAbilityRuleSets(old,[{abilityId,rules}]);
 const changed=inspectAbilityEffects(old);assert(changed.editable,changed.message);assert.deepEqual(changed.rules,before.rules);
 legacyReceipt={sha256:sha(bytes),rules:before.rules.size,editable:true,upgradePreservesRules:true};
}
let project=await load(input);
const all={kind:"group" as const,mode:"all" as const,children:[]};
const guard=(weather=3)=>({kind:"abilityRecipe:weatherGuard" as const,value:1,parameters:{weather}});
const slush=abilityImport(202).rule;
const protectedSlush=validateAbilityRule({...slush,effects:[...slush.effects,guard(),...(client?[{kind:"nativeAbility:42" as const,value:-1}]:[])]});
const entries=new Map<number,AbilityRuleSet>([
 [165,protectedSlush],
 [166,validateAbilityRule({effects:[guard()],conditions:all})],
 [167,validateAbilityRule({effects:[guard(4)],conditions:all})],
 [168,validateAbilityRule({effects:[guard(0)],conditions:all})],
 [169,validateAbilityRule({effects:[guard()],conditions:{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"species",value:4}]}]}})],
 [170,slush],
]);
const names=new Map([[165,"Slush Guard"],[166,"Hail Shield"],[167,"Sand Shield"],[168,"Weather Shield"],[169,"Hurt Hail Guard"],[170,"Slush Rush"]]);
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
const verify=()=>{const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/weather-guard.nds`,exported,{flag:"wx"});project=await load(exported);verify();
// Change the weather selector on an exported ROM, export/reload, then restore Hail.
entries.set(166,validateAbilityRule({effects:[guard(4)],conditions:all}));await configureAbilityRuleSets(project,[{abilityId:166,rules:entries.get(166)!}]);trim();
const edited=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/weather-guard-edited.nds`,edited,{flag:"wx"});project=await load(edited);verify();
entries.set(166,validateAbilityRule({effects:[guard()],conditions:all}));await configureAbilityRuleSets(project,[{abilityId:166,rules:entries.get(166)!}]);trim();
const reexported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/weather-guard-reloaded.nds`,reexported,{flag:"wx"});project=await load(reexported);verify();
const rom=new NintendoDSRom(reexported,{fileData:"view"});validateHarnessRom(rom);
const dllBytes=rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],dll=parseRpm(dllBytes,{allowedMagics:["DLXF"]});assert.equal(dll.metadata.PokewebAbilityPopupGroups,1);assert.equal(dll.metadata.PokewebAbilityWeatherGuard,1);
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,readU32(dll.code,symbols.AbilityRuleApi+i*4)&~1]]:[]));
const gateway=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+20*4)!;
const popupGateway=dll.symbols[gateway.sourceSymbolIndex].address;
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const overlay=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress);
const encoded=encodeAbilityRules(entries),nativeOffsets:number[]=[];
for(const[id,r]of entries){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
type Case={label:string;abilityId:number;enemyAbility?:number;enemyMove?:number;enemyLevel?:number;hp?:number;playerStatus?:"poison";checks:Record<string,unknown>};
const cases:Case[]=[
 {label:"slush-original-hail-damage",abilityId:170,enemyAbility:117,checks:{hpByTurn:[120,113,106],multiplier:8192,noRewrite:{key:65,value:1}}},
 {label:"slush-hail-immunity",abilityId:165,enemyAbility:117,checks:{noWeatherDamage:true,multiplier:8192,rewrite:{key:65,value:1},enemyWeatherDamage:true}},
 {label:"hail-selected",abilityId:166,enemyAbility:117,checks:{noWeatherDamage:true,rewrite:{key:65,value:1}}},
 {label:"hail-allows-sand",abilityId:166,enemyAbility:45,checks:{hpByTurn:[120,113,106],noRewrite:{key:65,value:1}}},
 {label:"sand-selected",abilityId:167,enemyAbility:45,checks:{noWeatherDamage:true,rewrite:{key:65,value:1}}},
 {label:"sand-allows-hail",abilityId:167,enemyAbility:117,checks:{hpByTurn:[120,113,106],noRewrite:{key:65,value:1}}},
 {label:"all-weather-hail",abilityId:168,enemyAbility:117,checks:{noWeatherDamage:true,rewrite:{key:65,value:1}}},
 {label:"all-weather-sand",abilityId:168,enemyAbility:45,checks:{noWeatherDamage:true,rewrite:{key:65,value:1}}},
 {label:"clear-weather",abilityId:166,checks:{noWeatherDamage:true,noRewrite:{key:65,value:1}}},
 {label:"and-or-positive",abilityId:169,hp:60,enemyAbility:117,checks:{hpByTurn:[60,60,60],rewrite:{key:65,value:1}}},
 {label:"and-or-negative",abilityId:169,enemyAbility:117,checks:{hpByTurn:[120,113,106],noRewrite:{key:65,value:1}}},
 {label:"slush-suppressed",abilityId:165,enemyAbility:117,enemyMove:380,checks:{hpByTurn:[120,113,106],suppressed:true,noMultiplierAfterFirstTurn:8192,noRewrite:{key:65,value:1}}},
 {label:"slush-swapped-and-regained",abilityId:165,enemyAbility:117,enemyMove:285,checks:{hpByTurn:[120,113,113],playerAbilities:[165,117,165],enemyAbilities:[117,165,117],multiplier:8192,rewrite:{key:65,value:1}}},
 {label:"move-damage-still-applies",abilityId:165,enemyAbility:117,enemyMove:33,enemyLevel:30,checks:{onlyMoveDamage:true,rewrite:{key:65,value:1},multiplier:8192}},
 {label:"poison-still-applies",abilityId:165,enemyAbility:117,playerStatus:"poison",checks:{hpByTurn:[120,105,90],status:5,rewrite:{key:65,value:1}}},
 {label:"weather-changes-to-sand",abilityId:166,enemyAbility:117,enemyMove:201,checks:{hpByTurn:[120,113,106],noRewrite:{key:65,value:1},weather:4}},
];
if(client)cases.splice(0,cases.length,cases[1]);
const baseSave=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
for(const[i,spec]of cases.entries()){
 const enemyMove=spec.enemyMove??150,enemyAbility=spec.enemyAbility??50,enemyLevel=spec.enemyLevel??(enemyMove===33?30:100);
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:"Singles",trainer:{team:[{speciesId:320,level:enemyLevel,moves:[enemyMove],itemId:0,abilityId:enemyAbility}],ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[150],itemId:0,abilityId:spec.abilityId,...(spec.hp!==undefined?{currentHp:spec.hp}:{}),...(spec.playerStatus?{status:spec.playerStatus}:{})}]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${enemyMove}-${enemyAbility}-${enemyLevel}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save,{flag:"wx"});
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeFile(`${out}/${filename}`,bytes,{flag:"wx"});hashes[filename]=sha(bytes);}
 fixtures.push({...spec,saveSha256:sha(save),label,speciesId:1,maxHp,hp:spec.hp??maxHp,rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:sha(input),exportSha256:sha(exported),editedSha256:sha(edited),reexportSha256:sha(reexported),weatherClient:client,legacy:legacyReceipt,editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:dllBytes.length,popupGateway,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true,weatherAddress:readU32(resolver.resolve("GetFieldWeather").code,8),damageReactionHook:resolver.resolve("ServerEvent_DamageReaction").address,eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address},null,2)+"\n",{flag:"wx"});
assert.equal(sha(new Uint8Array(await readFile(path))),sha(input));console.log(`${cases.length} native weather immunity fixtures; project/ROM export/reload and legacy upgrade passed.`);
