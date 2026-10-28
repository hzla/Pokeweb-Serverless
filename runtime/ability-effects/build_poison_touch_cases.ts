/** Poison Touch: editable native copies, priority groups and ROM lifecycle. */
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
const [path,directory]=process.argv.slice(2);if(!directory)throw new Error("Usage: INPUT.nds OUTPUT_DIRECTORY");
const out=resolve(directory),input=new Uint8Array(await readFile(path)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex"),inputHash=sha(input);
await mkdir(`${out}/saves`,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw new Error("Only local bundled assets permitted.");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"poison-touch.nds",{selectedNarcs:["personal","items","message_texts","moves","trdata","trpok"]});
let project=await load(input);
const entries=new Map<number,AbilityRuleSet>(),names=new Map<number,string>();
function recipe(id:number,name:string,status?:number,chance?:number,extra:AbilityRuleSet["effects"]=[],conditions:AbilityRuleSet["conditions"]={kind:"group",mode:"all",children:[]}){
 names.set(id,name);entries.set(id,validateAbilityRule({effects:[{kind:"nativeAbility:143",value:-1,...(status===undefined?{}:{parameters:{contactStatus:status,activationChance:chance!}})},...extra],conditions}));
}
recipe(165,"Venom Touch");recipe(166,"Burn Touch",4,100);recipe(167,"Numb Touch",1,100);recipe(168,"Frost Touch",3,100);recipe(169,"Sleep Touch",2,100);recipe(170,"Zero Touch",4,0);
recipe(171,"Warm Mix",4,100,[{kind:"nativeAbility:3",value:-1}]);
recipe(172,"Conditional",4,100,[],{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"hp",comparison:"lte",percent:50},{kind:"group",mode:"any",children:[{kind:"weather",value:3},{kind:"status",value:0}]}]});
recipe(173,"Poison Touch+",5,100);
entries.set(174,validateAbilityRule({effects:[{kind:"nativeAbility:3",value:-1}],conditions:{kind:"group",mode:"all",children:[]}}));names.set(174,"Speed Buddy");
await configureAbilityRuleSets(project,[...entries].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
const verify=()=>{const s=inspectAbilityEffects(project);assert(s.editable,s.message);assert.deepEqual(s.rules,entries);for(const[id,name]of names)assert.equal(project.texts.banks.abilities?.[id],name);};
verify();project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/poison-touch.nds`,exported,{flag:"wx"});project=await load(exported);verify();
// Change both controls after reload, export/reload, then restore the battle fixture values.
const editReceipts=[];
for(const parameters of [{contactStatus:1,activationChance:67},{contactStatus:4,activationChance:100}]){
 const rules=validateAbilityRule({...entries.get(166)!,effects:[{...entries.get(166)!.effects[0],parameters}]});entries.set(166,rules);
 await configureAbilityRuleSets(project,[{abilityId:166,rules}]);trim();const bytes=await exportModifiedRom(project,{forDsi:false}),file=`poison-touch-edited-${editReceipts.length}.nds`;await writeFile(`${out}/${file}`,bytes,{flag:"wx"});project=await load(bytes);verify();editReceipts.push({file,parameters,sha256:sha(bytes),editableAfterReload:true});
}
trim();const reexported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/poison-touch-reloaded.nds`,reexported,{flag:"wx"});project=await load(reexported);verify();
const rom=new NintendoDSRom(reexported,{fileData:"view"});validateHarnessRom(rom);
const dll=parseRpm(rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],{allowedMagics:["DLXF"]});
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,new DataView(dll.code.buffer).getUint32(symbols.AbilityRuleApi+i*4,true)&~1]]:[]));
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const overlay=rom.loadArm9Overlays([167]).get(167)!,resolver=battleRuntimeResolver(overlay.data,overlay.ramAddress,project.arm9,rom.arm9RamAddress),nameLoader=resolver.resolve("loadAbilityNameToStrbuf").address;
const encoded=encodeAbilityRules(entries),nativeOffsets:number[]=[];
for(const[id,r]of entries){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
type Case={label:string;abilityId:number;enemyAbility?:number;enemyMove?:number;move?:number;hp?:number;checks:Record<string,unknown>};
const cases:Case[]=[
 {label:"original-copy-chance-30",abilityId:165,move:33,checks:{nativeChance:30,priorityGroups:true}},
 {label:"burn-contact",abilityId:166,move:33,checks:{enemyStatus:4,nativeChance:100,priorityGroups:true,name:true}},
 {label:"paralysis-contact",abilityId:167,move:33,checks:{enemyStatus:1,nativeChance:100,priorityGroups:true}},
 {label:"freeze-contact",abilityId:168,move:33,checks:{enemyStatusFirstTurn:3,nativeChance:100,priorityGroups:true}},
 {label:"sleep-contact",abilityId:169,move:33,checks:{enemyStatusFirstTurn:2,nativeChance:100,priorityGroups:true}},
 {label:"poison-contact",abilityId:173,move:33,checks:{enemyStatus:5,nativeChance:100,priorityGroups:true}},
 {label:"noncontact-negative",abilityId:166,move:55,checks:{enemyStatus:0,noNativeChance:true,priorityGroups:true}},
 {label:"zero-chance-negative",abilityId:170,move:33,checks:{enemyStatus:0,nativeChance:0,priorityGroups:true}},
 {label:"mixed-speed-boost",abilityId:171,move:33,checks:{enemyStatus:4,speedStages:[6,7,8],priorityGroups:true}},
 {label:"and-or-conditions-positive",abilityId:172,move:33,hp:60,checks:{enemyStatus:4,priorityGroups:true}},
 {label:"and-or-conditions-negative",abilityId:172,move:33,hp:61,checks:{enemyStatus:0,noNativeChance:true,priorityGroups:true}},
 {label:"suppression-stops-both-groups",abilityId:171,move:33,enemyMove:380,checks:{enemyStatus:0,suppressed:true,speedStages:[6,6,6],noNativeChance:true,priorityGroups:true}},
 {label:"swap-custom-to-native",abilityId:171,move:33,enemyMove:285,checks:{playerAbilities:[171,50,171],enemyAbilities:[50,171,50],enemySpeedStages:[6,7,7],enemyStatusByTurn:[0,0,4],priorityGroups:true}},
 {label:"swap-between-custom",abilityId:171,move:33,enemyMove:285,enemyAbility:174,checks:{playerAbilities:[171,174,171],enemyAbilities:[174,171,174],enemySpeedStages:[6,7,8],priorityGroups:true}},
 {label:"native-donor-unchanged",abilityId:143,move:33,checks:{nativeChance:30,nativeChanceOwned:false,priorityGroups:true}},
];
const baseSave=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
await prepareBw2TestBattleCodeInjection(project);
const hashes:Record<string,string>={},fixtures=[];
for(const[i,spec]of cases.entries()){
 const trainer=patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:"Singles",trainer:{team:[{speciesId:320,level:100,moves:[spec.enemyMove??150],itemId:0,abilityId:spec.enemyAbility??50}],ai:0}}));
 stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,trainer));
 const save=patchHarnessSave(baseSave,project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:[spec.move??150],itemId:0,abilityId:spec.abilityId,...(spec.hp!==undefined?{currentHp:spec.hp}:{})}]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90),label=`${String(i).padStart(3,"0")}-${spec.label}`,filename=`battle-${spec.enemyMove??150}-${spec.enemyAbility??50}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save,{flag:"wx"});
 if(!hashes[filename]){const keep=project.narcs;project.narcs=Object.fromEntries(Object.entries(keep).filter(([name,store])=>["personal","trdata","trpok"].includes(name)&&store?.dirty.size));const bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=keep;await writeFile(`${out}/${filename}`,bytes,{flag:"wx"});hashes[filename]=sha(bytes);}
 fixtures.push({...spec,label,speciesId:1,maxHp,hp:spec.hp??maxHp,rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:inputHash,exportSha256:sha(exported),reexportSha256:sha(reexported),editedAbilities:entries.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)].length,nameLoader,api,symbols,pmcSymbols,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,projectReload:true,romExportReload:true,reloadedEdits:editReceipts,priorityRuntime:true,nativeChanceHook:resolver.resolve("AbilityEvent_RollEffectChance").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30)},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(path))),inputHash);console.log(`${cases.length} Poison Touch fixtures; export/reload and parameter re-edits passed.`);
