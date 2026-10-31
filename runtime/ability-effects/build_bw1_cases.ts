/** Black revision-0 ability recipes: production export/reload and native fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import { readU16, readU32, writeU16, writeU32 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API, buildAbilityRuleModule } from "../../src/pokeweb/abilityEffectsModel";
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
import bindings from "../../src/assets/data/abilityBindingsB1.json";

const [inputPath, directory] = process.argv.slice(2); assert(directory, "Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [--only=CASE,...]");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath)), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.equal(new NintendoDSRom(input, {fileData:"view"}).idCode,"IRBO");await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch = (async (request: RequestInfo | URL) => { const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-black.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
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
if(frost){assert(project.session.fairy,"Expected a Fairy-enabled Black ROM");rules.set(186,imported("Pixilate"));rules.set(187,{effects:[{kind:"nativeAbility:16",value:-1}],conditions:all});rules.set(188,{effects:[{kind:"nativeAbility:42",value:-1,parameters:{trapType:17}}],conditions:all});rules.set(189,{effects:[{kind:"healFlat",value:7}],conditions:{kind:"type",value:17}});rules.set(190,imported("Refrigerate"));rules.set(191,imported("Tera Shell"));}
rules.set(192,{effects:[{kind:"speed",value:2}],conditions:{kind:"weather",value:3}});
if(process.argv.includes("--stress"))for(let id=1;id<=164&&rules.size<100;id++)if(id!==13&&id!==50&&id!==117&&!rules.has(id))rules.set(id,{effects:[{kind:"healFlat",value:1}],conditions:all});
for(const[id,r]of rules)rules.set(id,validateAbilityRule(r));
// Every imported recipe is linked with Black's native services before fixtures.
for(const entry of ABILITY_IMPORT_LIBRARY)buildAbilityRuleModule(project,new Map([[255,entry.rule]]));
await configureAbilityRuleSets(project,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:abilityId===167?"Scare":`Black ${abilityId}`})));
const verify=()=>{const state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,rules);};verify();
project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateAbilityEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
const trim=()=>{for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];};
trim();const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/black-abilities.nds`,exported);project=await load(exported);verify();
// Re-edit an exported custom ID, then restore and verify the same FAT entry.
await configureAbilityRuleSets(project,[{abilityId:167,rules:{...rules.get(167)!,effects:[{kind:"nativeAbility:22",value:-1,stat:4}]},name:"Scare"}]);
trim();const reedited=await exportModifiedRom(project,{forDsi:false});project=await load(reedited);assert.equal(inspectAbilityEffects(project).rules.get(167)!.effects[0].stat,4);
await configureAbilityRuleSets(project,[{abilityId:167,rules:rules.get(167)!}]);trim();const final=await exportModifiedRom(project,{forDsi:false});project=await load(final);verify();
const rom=new NintendoDSRom(final,{fileData:"view"}),dllBytes=rom.files[rom.fileId(ABILITY_EFFECTS_DLL_PATH)],dll=parseRpm(dllBytes,{allowedMagics:["DLXF"]});
const symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Ability")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries(ABILITY_RULE_API.flatMap((name,i)=>name?[[name,readU32(dll.code,symbols.AbilityRuleApi+i*4)&~1]]:[]));
const gateway=dll.relocations.find(r=>r.target.module==="base"&&r.target.address===symbols.AbilityRuleApi+20*4)!;
const pmc=parseRpm(rom.files[rom.fileId("codeinjection/RPMSYM-PMC.rpm")]),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const ov=rom.loadArm9Overlays([93]).get(93)!,resolver=battleRuntimeResolver(ov.data,ov.ramAddress,project.arm9,rom.arm9RamAddress,bindings.functions);
let clientTrapStores:Record<string,number>|undefined;
const clientFunction=dll.symbols.find(s=>s.name==="AbilityClientTrapped");if(clientFunction){const code=Buffer.from(dll.code.subarray(clientFunction.address,clientFunction.address+clientFunction.size));const store=(hex:string,offset:number)=>{const pattern=Buffer.from(hex,"hex"),at=code.indexOf(pattern);assert(at>=0&&code.indexOf(pattern,at+1)===-1);return clientFunction.address+at+offset;};clientTrapStores={trapper:store("08ab1b5d019a1370",6),ability:store("029b002b00d01e800025",6)};}
const encoded=encodeAbilityRules(rules),nativeOffsets:number[]=[];for(const[id,r]of rules){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
const neutral=[6,6,6,6,6,6,6];const mon=(speciesId=320,level=100,move=150,abilityId=50):HarnessPokemon=>({speciesId,level,moves:[move],abilityId,itemId:0});
type Case={label:string;playerSpecies?:number;abilityId:number;playerMoves?:number[];turnMove?:number[];hp?:number;ally?:HarnessPokemon;enemies?:HarnessPokemon[];battleType?:"Doubles";enemyAbility?:number;menuCount?:number;bench?:HarnessPokemon[];checks:Record<string,unknown>};
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
 const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:spec.playerSpecies??1,level:50,moves:spec.playerMoves??[150],abilityId:spec.abilityId,itemId:0,...(spec.hp===undefined?{}:{currentHp:spec.hp})},...(spec.ally?[spec.ally]:[]),...(spec.bench??[])]}}));
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
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:sha(input),exportSha256:sha(exported),reexportSha256:sha(final),projectReload:true,romExportReload:true,importsLinked:ABILITY_IMPORT_LIBRARY.length,editedAbilities:rules.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:dllBytes.length,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,api,symbols,pmcSymbols,popupGateway:dll.symbols[gateway.sourceSymbolIndex].address,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,priorityRuntime:true,...(clientTrapStores?{clientTrapStores,typeQuery:resolver.resolve("DoesMonHaveType").address}:{}),damageReactionHook:resolver.resolve("ServerEvent_DamageReaction").address,eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30),manualLaunch:true,openingHook:0x021bbb60,flowRegister:"r0",commandHook:0x021bacac},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))),sha(input));console.log(`${fixtures.length} Black native fixtures; project and ROM reload passed.`);
