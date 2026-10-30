/** Black revision-0 ability recipes: production export/reload and native fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NintendoDSRom } from "../../src/nds/rom";
import { readU16, readU32 } from "../../src/nds/binary";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { configureAbilityRuleSets, inspectAbilityEffects, hydrateAbilityEffectsSource, ABILITY_EFFECTS_DLL_PATH, ABILITY_RULE_API, buildAbilityRuleModule } from "../../src/pokeweb/abilityEffectsModel";
import { validateAbilityRule, encodeAbilityRules, type AbilityRuleSet } from "../../src/pokeweb/abilityRules";
import { ABILITY_IMPORT_LIBRARY } from "../../src/pokeweb/abilityLibrary";
import { parseHarnessConfig, patchHarnessSave, patchHarnessTrainer, type HarnessPokemon } from "../../src/pokeweb/battleHarness";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { createProjectDocument } from "../../src/pokeweb/projectDocument";
import { openProjectSession } from "../../src/pokeweb/projectSession";
import { parseRpm } from "../../src/pokeweb/rpm";
import { buildTestBattleDownloads, rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";
import { decryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import bindings from "../../src/assets/data/abilityBindingsB1.json";

const [inputPath, directory] = process.argv.slice(2); assert(directory, "Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [--only=CASE,...]");
const out = resolve(directory), input = new Uint8Array(await readFile(inputPath)), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.equal(new NintendoDSRom(input, {fileData:"view"}).idCode,"IRBO");await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch = (async (request: RequestInfo | URL) => { const url = new URL(request instanceof Request ? request.url : String(request)); assert.equal(url.protocol, "file:"); return new Response(new Uint8Array(await readFile(url))); }) as typeof fetch;
const load = (bytes: Uint8Array) => loadProjectFromRomBytes(bytes, "ability-black.nds", { selectedNarcs: ["personal", "items", "message_texts", "moves", "trdata", "trpok"] });
let project = await load(input);
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
 [175,{effects:[{kind:"nativeAbility:47",value:.25,parameters:{type1:10,type2:9}}],conditions:all}],
]);
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
const encoded=encodeAbilityRules(rules),nativeOffsets:number[]=[];for(const[id,r]of rules){const at=readU16(encoded,id*2),start=at+4+encoded[at+1]*4;r.effects.forEach((e,i)=>{if(e.kind.startsWith("nativeAbility:"))nativeOffsets.push(start+i*16);});}
const neutral=[6,6,6,6,6,6,6];const mon=(speciesId=320,level=100,move=150,abilityId=50):HarnessPokemon=>({speciesId,level,moves:[move],abilityId,itemId:0});
type Case={label:string;abilityId:number;playerMoves?:number[];turnMove?:number[];hp?:number;ally?:HarnessPokemon;enemies?:HarnessPokemon[];battleType?:"Doubles";checks:Record<string,unknown>};
const cases:Case[]=[
 {label:"entry-grouped",abilityId:165,checks:{stages:[6,7,6,6,5,6,6],popupsByTurn:[1,0,0]}},
 {label:"scare-spatk",abilityId:167,checks:{enemyStages:[6,6,5,6,6,6,6]}},
 {label:"slush-rush-hail",abilityId:166,enemies:[mon(320,100,150,117)],checks:{multiplier:10240,noWeatherDamage:true}},
 {label:"and-or-heal",abilityId:168,hp:10,checks:{heal:7}},
 {label:"high-pressure",abilityId:169,playerMoves:[55],checks:{partyStages:[[6,6,8,6,4,6,6]]}},
 {label:"indignation",abilityId:171,enemies:[mon(320,30,33)],checks:{highestTargets:true}},
 {label:"poison-touch-burn",abilityId:172,playerMoves:[33],checks:{enemyStatus:4}},
 {label:"custom-status",abilityId:173,checks:{status:4}},
 {label:"suppression",abilityId:168,hp:10,enemies:[mon(320,100,380)],checks:{heal:0,suppressed:true}},
 {label:"swap-away",abilityId:165,playerMoves:[285],checks:{playerAbilities:[165,50,165]}},
 {label:"swap-gain",abilityId:50,playerMoves:[285],enemies:[mon(320,100,150,165)],checks:{playerAbilities:[50,165,50]}},
];
const only=process.argv.find(a=>a.startsWith("--only="))?.slice(7).split(","),hashes:Record<string,string>={},fixtures=[];
for(const[index,spec]of cases.entries()){
 if(only&&!only.includes(spec.label))continue;
 const enemies=spec.enemies??[mon()];patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:spec.battleType??"Singles",trainer:{team:enemies,ai:0}}));
 const downloads=await buildTestBattleDownloads(project,2);
 const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:1,level:50,moves:spec.playerMoves??[150],abilityId:spec.abilityId,itemId:0,...(spec.hp===undefined?{}:{currentHp:spec.hp})},...(spec.ally?[spec.ally]:[])]}}));
 const raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),label=`${String(index).padStart(3,"0")}-${spec.label}`,filename=`battle-${sha(new TextEncoder().encode(JSON.stringify([spec.battleType,enemies]))).slice(0,16)}.nds`;
 await writeFile(`${out}/saves/${label}.sav`,save);if(!hashes[filename]){await writeFile(`${out}/${filename}`,downloads.romBytes);hashes[filename]=sha(downloads.romBytes);}
 fixtures.push({...spec,enemyCount:enemies.length,label,speciesId:1,maxHp:readU16(raw,0x90),hp:spec.hp??readU16(raw,0x90),rom:filename});
}
await writeFile(`${out}/cases.json`,JSON.stringify({inputSha256:sha(input),exportSha256:sha(exported),reexportSha256:sha(final),projectReload:true,romExportReload:true,importsLinked:ABILITY_IMPORT_LIBRARY.length,editedAbilities:rules.size,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:dllBytes.length,nameLoader:resolver.resolve("loadAbilityNameToStrbuf").address,api,symbols,pmcSymbols,popupGateway:dll.symbols[gateway.sourceSymbolIndex].address,hook:resolver.resolve("AbilityEvent_AddItem").address,configHex:Buffer.from(encoded).toString("hex"),nativeOffsets,romHashes:hashes,cases:fixtures,priorityRuntime:true,eventConstHook:resolver.resolve("BattleEventVar_SetConstValue").address,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30),manualLaunch:true,openingHook:0x021bdb88,flowRegister:"r0",commandHook:0x021bacac},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))),sha(input));console.log(`${fixtures.length} Black native fixtures; project and ROM reload passed.`);
