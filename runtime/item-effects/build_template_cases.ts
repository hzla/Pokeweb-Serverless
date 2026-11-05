/** Production item-template export/reload fixtures for US BW/BW2. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureItemRuleSets,hydrateItemEffectsSource,inspectItemEffect,ITEM_EFFECTS_DLL_PATH} from "../../src/pokeweb/itemEffectsModel";
import {configureAbilityRuleSets} from "../../src/pokeweb/abilityEffectsModel";
import {itemRulePreset,ITEM_RECIPE_TEMPLATE_IDS} from "../../src/pokeweb/itemRulePresets";
import {encodeItemRulesV4,validateItemRule,type ItemRuleSet} from "../../src/pokeweb/itemRules";
import {ITEM_RULE_API} from "../../src/pokeweb/itemRuleRuntime";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {createProjectDocument} from "../../src/pokeweb/projectDocument";
import {openProjectSession} from "../../src/pokeweb/projectSession";
import {parseRpm} from "../../src/pokeweb/rpm";
import {configureHarnessRuntime,parseHarnessConfig,patchHarnessSave,patchHarnessTrainer} from "../../src/pokeweb/battleHarness";
import {prepareBw2TestBattleCodeInjection,stageCodeInjectionDll} from "../../src/pokeweb/pmcModel";
import {buildTestBattleDownloads,getTestBattleConfig,rawSaveBytesFromDesmumeDsv} from "../../src/pokeweb/testBattle";
import {decryptPk5Party} from "../../src/pokeweb/testBattleTeam";
import {updateMoveField} from "../../src/pokeweb/moveItemModel";
import {battleRuntimeResolver,BATTLE_RUNTIME_SIGNATURES} from "../../src/pokeweb/battleRuntimeBindings";
import strikes from "../../src/assets/data/abilityStrikeBindings.json";
import black from "../../src/assets/data/abilityBindingsB1.json";
import white from "../../src/assets/data/abilityBindingsW1.json";
const [inputPath,outPath]=process.argv.slice(2);assert(outPath,"Usage: INPUT.nds NEW_OUTPUT_DIRECTORY [--only=labels] [--hazards]");
const out=resolve(outPath);await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch=(async input=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const input=new Uint8Array(await readFile(inputPath)),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"item-templates.nds",{selectedNarcs:["items","personal","moves","trdata","trpok","message_texts"]});
let project=await load(input);const game=project.session.baseVersion,isBw1=project.session.baseRom==="BW",overlay=isBw1?93:167;
for(const id of [79,86,181,196,33,292,359,458])updateMoveField(project,id,"accuracy","100");
// Guaranteed secondary effects make prevention controls deterministic.
for(const id of [181,196])updateMoveField(project,id,"effect_chance","100");
type Case={label:string;rules:ItemRuleSet;species?:number;move?:number;enemyMove?:number;enemyAbility?:number;enemyItem?:number;ability?:number;itemId?:number;hp?:number;bench?:boolean;fairyMove?:boolean;checks:Record<string,unknown>};
const cases:Case[]=[];
const add=(label:string,id:number,checks:Record<string,unknown>,extra:Partial<Case>={},edit?:(r:ItemRuleSet)=>void)=>{const rules=itemRulePreset(id,false,Boolean(project.session.fairy));edit?.(rules);cases.push({label,rules,checks,...extra});};
add("maranga-special",10001,{stages:{4:7},consumed:true},{enemyMove:55});
add("weakness-policy",10002,{stages:{1:8,3:8},consumed:true},{enemyMove:67});
add("feather-edited-water",10003,{multiplier:6144,multiplierKey:49,bothTurns:true,retained:true},{move:55},r=>{r.effects[0].value=1.5;r.effects[0].parameters={type:10};});
add("roseli-edited-fire",10004,{multiplier:1024,firstTurnOnly:true,consumed:true},{species:1,enemyMove:52},r=>{r.effects[0].value=.25;r.effects[0].parameters={type:9};});
add("native-occa-edit",184,{multiplier:3072,firstTurnOnly:true,consumed:true},{species:1,enemyMove:52},r=>{r.effects[0].value=.75;});
add("goggles-hail",10005,{noDamage:true,status:0,retained:true},{enemyAbility:117});
add("goggles-powder",10005,{status:0,retained:true},{enemyMove:79});
add("goggles-klutz",10005,{status:2,retained:true},{ability:103,enemyMove:79});
add("amulet-growl",10007,{stages:{1:6},retained:true,itemNotice:0},{enemyMove:45});
add("amulet-intimidate",10007,{initialStages:{1:6},stages:{1:6},retained:true,itemNotice:0},{enemyAbility:22});
add("amulet-self-cost",10007,{stagesPerTurn:{1:[6,5,4],2:[6,5,4]},retained:true},{move:276});
add("amulet-edited-stat",10007,{stagesPerTurn:{1:[6,5,4]},retained:true},{enemyMove:45},r=>{r.effects[0].parameters={stat:2};});
add("amulet-false-condition",10007,{stagesPerTurn:{1:[6,5,4]},retained:true},{enemyMove:45},r=>{r.conditions={kind:"type",value:9};});
add("cloak-status-secondary",10008,{status:0,retained:true},{enemyMove:181});
add("cloak-stat-secondary",10008,{stages:{5:6},retained:true},{enemyMove:196});
add("cloak-primary-status",10008,{status:1,retained:true},{enemyMove:86});
add("cloak-primary-stat",10008,{stagesPerTurn:{1:[6,5,4]},retained:true},{enemyMove:45});
add("cloak-edited-status-allow",10008,{status:3,retained:true},{enemyMove:181},r=>{r.effects[0].parameters={status:0};});
add("dice-four-or-five",10009,{hitCounts:[4,5],retained:true},{move:292});
add("dice-five",10009,{hitCounts:[5],retained:true},{move:292},r=>{r.effects[0].value=5;});
add("dice-fixed-two-control",10009,{hitCounts:[2],fixedCountControl:true,retained:true},{move:458});
add("dice-klutz-control",10009,{nativeHitCounts:true,retained:true},{move:292,ability:103});
add("herb-swords-dance",10010,{stages:{1:8},consumed:true,itemNotice:1},{enemyMove:14});
add("herb-shell-smash",10010,{stages:{1:8,3:8,5:8,2:6,4:6},consumed:true,itemNotice:1},{enemyMove:504});
add("herb-reusable-scale",10010,{stagesPerTurn:{1:[6,7,8]},retained:true},{enemyMove:14},r=>{r.consumable=false;r.effects[0].value=.5;});
add("herb-false-condition",10010,{stages:{1:6},retained:true},{enemyMove:14},r=>{r.conditions={kind:"type",value:9};});
add("glove-punch",10011,{multiplier:4506,multiplierKey:49,bothTurns:true,retained:true},{move:409});
add("glove-nonpunch",10011,{noMultiplier:4506,retained:true},{move:55});
add("glove-edited-sound",10011,{multiplier:6144,multiplierKey:49,bothTurns:true,retained:true},{move:448},r=>{r.effects[0].value=1.5;r.effects[0].parameters={moveClass:5};});
add("glove-and-or",10011,{multiplier:4506,multiplierKey:49,bothTurns:true,retained:true},{move:409},r=>{r.conditions={kind:"group",mode:"all",children:[{kind:"hp",comparison:"gt",percent:0},{kind:"group",mode:"any",children:[{kind:"type",value:0},{kind:"weather",value:3}]}]};});
if(process.argv.includes("--hazards")||process.argv.includes("--entry")){
 const conditions={kind:"group" as const,mode:"all" as const,children:[]};
 await configureAbilityRuleSets(project,[...(process.argv.includes("--hazards")?[{abilityId:165,name:"Hazard Fixture",rules:{effects:[6,7,8].map(hazard=>({kind:"abilityRecipe:hazard" as const,value:1,parameters:{hazard}})),conditions}}]:[]),...(process.argv.includes("--entry")?[{abilityId:166,name:"Entry Fixture",rules:{effects:[{kind:"abilityRecipe:statAction" as const,value:1,parameters:{stat:1}},{kind:"abilityRecipe:statAction" as const,value:2,parameters:{stat:2}}],conditions}},{abilityId:167,name:"Cap Fixture",rules:{effects:[{kind:"abilityRecipe:statAction" as const,value:5,parameters:{stat:1}}],conditions}},{abilityId:168,name:"Low Fixture",rules:{effects:[{kind:"abilityRecipe:statAction" as const,value:-6,parameters:{stat:1}}],conditions}}]:[])]);
}
if(process.argv.includes("--hazards")){
 add("boots-all-hazards",10006,{partyHpFull:true,partyStatusClear:true,retained:true},{move:33,enemyMove:46,enemyAbility:165,bench:true});
 add("boots-false-condition",10006,{partyDamaged:true,partyPoisoned:true,retained:true},{move:33,enemyMove:46,enemyAbility:165,bench:true},r=>{r.conditions={kind:"type",value:9};});
 add("boots-poison-absorption",10006,{partyHpFull:true,partyStatusClear:true,retained:true,absorbedToxicSpikes:true},{species:1,move:33,enemyMove:46,enemyAbility:165,bench:true});
}
add("cloak-consumable",10008,{statusPerTurn:[0,0,3],consumed:true},{enemyMove:181},r=>{r.consumable=true;});
add("amulet-mold-breaker",10007,{stages:{1:6},retained:true},{enemyMove:45,enemyAbility:104});
add("cloak-mold-breaker",10008,{stages:{5:6},retained:true},{enemyMove:196,enemyAbility:104});
add("glove-magic-room",10011,{multiplier:4506,multiplierKey:49,firstTurnOnly:true,retained:true},{move:409,enemyMove:478});
add("glove-trick",10011,{multiplier:4506,multiplierKey:49,multiplierTurns:[1],itemByTurn:true},{move:409,enemyMove:271});
add("dice-skill-link",10009,{hitCounts:[5],retained:true},{move:292,ability:92});
add("glove-keeps-contact",10011,{multiplier:4506,multiplierKey:49,bothTurns:true,damageDivisor:6,retained:true},{move:359,enemyItem:540});
add("cloak-no-secondary",10008,{status:0,retained:true},{enemyMove:33},r=>{r.consumable=true;});
if(process.argv.includes("--entry"))add("herb-entry-group",10010,{initialStages:{1:7,2:8},stages:{1:7,2:8},consumed:true,itemNotice:1},{enemyAbility:166});
if(process.argv.includes("--entry")){
 add("herb-capped-gain",10010,{initialStages:{1:6},stages:{1:7},consumed:true},{species:151,move:164,enemyMove:14,enemyAbility:167},r=>{r.conditions={kind:"hp",comparison:"lt",percent:100};});
 add("herb-belly-drum",10010,{initialStages:{1:0},stages:{1:12},consumed:true},{species:151,move:164,ability:168,enemyMove:187,enemyAbility:168},r=>{r.conditions={kind:"hp",comparison:"lt",percent:100};});
}
if(project.session.fairy){
 add("feather-original-fairy",10003,{multiplier:4915,multiplierKey:49,bothTurns:true,retained:true},{move:33,fairyMove:true});
 add("roseli-original-fairy",10004,{multiplier:2048,firstTurnOnly:true,consumed:true},{species:197,enemyMove:33,fairyMove:true});
}
const entries=new Map<number,ItemRuleSet>();let next=85;
for(const c of cases){c.itemId??=next++;c.rules=validateItemRule(c.rules);entries.set(c.itemId,c.rules);}
// Include all eleven templates even when only a subset of battles is requested.
for(const id of Object.values(ITEM_RECIPE_TEMPLATE_IDS))entries.set(next++,itemRulePreset(id,false,Boolean(project.session.fairy)));
while(entries.size<100)entries.set(next++,validateItemRule({effects:[{kind:"healDivisor",value:16}],conditions:{kind:"group",mode:"all",children:[]},consumable:false}));
await configureItemRuleSets(project,[...entries].map(([itemId,rules])=>({itemId,rules})));
const verify=()=>{for(const[id,r]of entries){const state=inspectItemEffect(project,id);assert(state.editable,state.message);assert.deepEqual(state.rules,r);}};verify();
project=openProjectSession(createProjectDocument(project,false));project.originalRomBytes=input;hydrateItemEffectsSource(project,new NintendoDSRom(input,{fileData:"view"}));verify();
for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];
const exported=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/templates-100.nds`,exported,{flag:"wx"});project=await load(exported);verify();
const rom=new NintendoDSRom(exported,{fileData:"view"}),dll=parseRpm(rom.getFileByName(ITEM_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]}),symbols=Object.fromEntries(dll.symbols.filter(s=>s.name?.startsWith("Rule")||s.name?.startsWith("Item")).map(s=>[s.name!,s.address]));
const api=Object.fromEntries([...ITEM_RULE_API,"BattleEventVar_RewriteValue","BattleEventVar_SetConstValue","BattleEventVar_GetValueIfExist"].map((name,i)=>[name,readU32(dll.code,symbols.ItemRuleApi+(i<18?i:name==="BattleEventVar_RewriteValue"?28:name==="BattleEventVar_SetConstValue"?22:26)*4)&~1]));
const pmc=parseRpm(rom.getFileByName("codeinjection/RPMSYM-PMC.rpm")),pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/u.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
const ov=rom.loadArm9Overlays([overlay]).get(overlay)!,resolver=battleRuntimeResolver(ov.data,ov.ramAddress,project.arm9,rom.arm9RamAddress,{...(isBw1?(game==="W"?white:black).functions:BATTLE_RUNTIME_SIGNATURES),...strikes.profiles[isBw1?game as "B"|"W":"BW2"]});
async function writeFixture(filename:string,bytes:Uint8Array){
 const target=`${out}/${filename}`;
 try{execFileSync("cp",["-c",`${out}/templates-100.nds`,target]);}catch{await writeFile(target,bytes,{flag:"wx"});return;}
 const file=await open(target,"r+");try{for(let at=0;at<bytes.length;at+=65536){const chunk=bytes.subarray(at,Math.min(at+65536,bytes.length));if(at+chunk.length<=exported.length&&Buffer.from(chunk).equals(Buffer.from(exported.subarray(at,at+chunk.length))))continue;await file.write(chunk,0,chunk.length,at);}await file.truncate(bytes.length);}finally{await file.close();}
}
const sideOverlay=rom.loadArm9Overlays([isBw1?95:169]).get(isBw1?95:169)!,sidePattern=Buffer.from("e022424302480901801808587047c046","hex");
const sideCandidates:number[]=[];for(let at=0;at+20<=sideOverlay.data.length;at+=2)if(sidePattern.every((v,i)=>sideOverlay.data[at+i]===v))sideCandidates.push(at);
assert.equal(sideCandidates.length,1);const sideTableAddress=readU32(sideOverlay.data,sideCandidates[0]+16)-12;
const results:Record<string,unknown>[]=[],hashes:Record<string,string>={},romsByHash=new Map<string,string>();
const only=process.argv.find(s=>s.startsWith("--only="))?.slice(7).split(",");
for(const[index,c]of cases.entries()){
 if(only&&!only.includes(c.label))continue;
 const species=c.species??242,label=`${String(index).padStart(3,"0")}-${c.label}`;
 const player={speciesId:species,level:100,moves:[c.move??150],itemId:c.itemId,abilityId:c.ability??50,...(c.hp?{currentHp:c.hp}:{})};
 const enemyLevel=c.move&&c.move!==150?100:30;
 const config=parseHarnessConfig({trainerId:2,player:{team:[player,...(c.bench?[player]:[])]},trainer:{team:[{speciesId:c.move===448?242:320,level:enemyLevel,moves:[c.enemyMove??150],itemId:c.enemyItem??0,abilityId:c.enemyAbility??50}],ai:0}});
 patchHarnessTrainer(project,config);updateMoveField(project,33,"type",c.fairyMove?"Fairy":"Normal");
 let bytes:Uint8Array,seed:Uint8Array;
 if(isBw1||game==="B2"){const downloads=await buildTestBattleDownloads(project,2);bytes=downloads.romBytes;seed=rawSaveBytesFromDesmumeDsv(downloads.saveBytes);}
 else{
  await prepareBw2TestBattleCodeInjection(project);
  const rule=patchHarnessTrainer(project,config);stageCodeInjectionDll(project,"BattleHarnessW2.dll",configureHarnessRuntime(new Uint8Array(await readFile(new URL("../../src/assets/testbattle/BattleHarnessW2.dll",import.meta.url))),2,rule));
  seed=rawSaveBytesFromDesmumeDsv(new Uint8Array(await readFile(getTestBattleConfig("BW2").saveUrl)));
  const stores=structuredClone(project.narcs);for(const[name,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[name as keyof typeof project.narcs];bytes=await exportModifiedRom(project,{forDsi:false});project.narcs=stores;
 }
 const save=patchHarnessSave(seed,project,config),raw=decryptPk5Party(save.subarray(0x18e08,0x18e08+220)),maxHp=readU16(raw,0x90);
 const hash=sha(bytes),filename=romsByHash.get(hash)??`${label}.nds`;if(!romsByHash.has(hash)){await writeFixture(filename,bytes);romsByHash.set(hash,filename);}hashes[filename]=hash;
 await writeFile(`${out}/saves/${label}.sav`,save,{flag:"wx"});results.push({...c,label,hp:c.hp??maxHp,maxHp,speciesId:species,rom:filename});
}
const encoded=encodeItemRulesV4(entries),layout=isBw1?{manualLaunch:true,flowRegister:"r0",openingHook:game==="W"?0x021bbb80:0x021bbb60,commandHook:game==="W"?0x021baccc:0x021bacac}:{openingHook:api.BtlServerFlow_IsSimulating,flowRegister:"r0",commandHook:game==="B2"?0x021ceed8:0x021cef18,...(game==="B2"?{manualLaunch:true}:{})};
await writeFile(`${out}/cases.json`,JSON.stringify({game,inputSha256:sha(input),exportSha256:sha(exported),editedItems:entries.size,templateCount:11,projectReload:true,romExportReload:true,codeBytes:dll.code.length,bssBytes:dll.bssSize,serializedBytes:rom.getFileByName(ITEM_EFFECTS_DLL_PATH).length,api,pmcSymbols,symbols,hook:resolver.resolve("ItemEvent_AddItemCore").address,configHex:Buffer.from(encoded.bytes).toString("hex"),nativeOffsets:encoded.nativeEffects.map(e=>e.offset),romHashes:hashes,sideTableAddress,eventList:readU32(resolver.resolve("BattleEvent_SeekItem").code,0x30),countHook:resolver.resolve("AbilityStrikeNativeCount").address,itemMessages:JSON.parse(String(dll.metadata.PokewebItemMessages)),...layout,cases:results},null,2)+"\n");
assert.equal(sha(new Uint8Array(await readFile(inputPath))),sha(input));console.log(`${game}: 100 rules and 11 templates verified through export/reload; ${results.length} native battle fixtures prepared.`);
