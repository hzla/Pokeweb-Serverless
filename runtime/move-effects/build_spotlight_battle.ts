import {moveDebugSymbols} from "./debug_symbols";
/** Disposable BW1 native battle fixture using the production move editor. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadProjectFromRomBytes} from '../../src/pokeweb/loader';
import {configureMoveRuleSets,inspectMoveEffects,MOVE_EFFECTS_DLL_PATH} from '../../src/pokeweb/moveEffectsModel';
import {configureAbilityRuleSets} from '../../src/pokeweb/abilityEffectsModel';
import {MOVE_RECIPE_LIBRARY} from '../../src/pokeweb/moveRecipeLibrary';
import {newMoveEffect} from '../../src/pokeweb/moveRules';
import {decodeRecord,markDirty} from '../../src/pokeweb/projectStore';
import {parseHarnessConfig,patchHarnessTrainer,patchHarnessSave} from '../../src/pokeweb/battleHarness';
import {buildTestBattleDownloads,rawSaveBytesFromDesmumeDsv} from '../../src/pokeweb/testBattle';
import {NintendoDSRom} from '../../src/nds/rom';
import {NARC} from '../../src/nds/narc';
import {parseRpm} from '../../src/pokeweb/rpm';
import {readU16,readU32,writeU16,writeU32} from '../../src/nds/binary';
import {refreshTestBattleSaveBlockChecksum,getTestBattleConfig} from '../../src/pokeweb/testBattle';
import {battleRuntimeResolver} from '../../src/pokeweb/battleRuntimeBindings';
import blackBindings from '../../src/assets/data/abilityBindingsB1.json';
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=='file:')throw Error('Only local bundled assets permitted');return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const [inputPath,out,which='Spotlight',mode='spotlight-doubles']=process.argv.slice(2);assert(out, 'Usage: ROM.nds NEW_OUTPUT_DIRECTORY [TEMPLATE] [MODE]');await mkdir(out);
const source=new Uint8Array(await readFile(inputPath));let project=await loadProjectFromRomBytes(source,'bw1.nds',{selectedNarcs:['personal','items','moves','message_texts','trdata','trpok']});
const rule={conditions:{kind:'group' as const,mode:'all' as const,children:[]},prerequisites:{kind:'group' as const,mode:'all' as const,children:[]},effects:[newMoveEffect('spotlight')]};
if(which==='Dragon Cheer')rule.effects=[{...newMoveEffect('criticalStageBoost'),target:'allies',conditions:{kind:'group',mode:'all',children:[{kind:'sameMon',subject:'target',value:0},{kind:'adjacent',subject:'target',value:1},{kind:'hidden',subject:'target',value:0}]},parameters:{type:15,enhanced:2}}];
if(mode==='inactive')rule.conditions={kind:'hp',subject:'user',comparison:'lt',percent:0};
if(mode==='neutral')rule.effects.find(e=>e.kind==='typeMatchup')!.parameters={effectiveness:3};
const weather=mode.includes('weather'),doubles=mode.endsWith('-doubles');
if(mode.startsWith('persistent-'))rule.effects.push({...newMoveEffect('vulnerableUntilAction')});
if(weather)rule.conditions=mode.startsWith('history-')?{kind:'group',mode:'all',children:[{kind:'weather',value:3},{kind:'statLowered',subject:'user',value:0}]}:{kind:'weather',value:3};
const move=decodeRecord(project,'moves',33).raw!;move.type=which==='Torch Song'?9:which==='Revelation Dance'?0:which==='Steel Beam'?8:which==='Eerie Spell'?13:which==='Core Enforcer'?15:14;move.category=0;move.target=2;move.power=move.category===0?0:70;move.accuracy=101;move.pp=30;move.hits=0;markDirty(project,'moves',33);
const edits=[{moveId:33,rules:rule}];if(mode==='capacity'||weather)for(let id=100;edits.length<100;id++){
  if(id===150||id===164)continue;
  const extra=decodeRecord(project,'moves',id).raw!;extra.category=0;markDirty(project,'moves',id);
  edits.push({moveId:id,rules:structuredClone(rule)});
}
await configureMoveRuleSets(project,edits);
if(weather)await configureAbilityRuleSets(project,[{abilityId:165,name:'Weather Test',rules:{effects:[{kind:'speed',value:2}],conditions:{kind:'weather',value:3}}}]);
if(which==='Core Enforcer'||which==='Doodle')await configureAbilityRuleSets(project,[{abilityId:165,name:'Speed Test',rules:{effects:[{kind:'speed',value:2}],conditions:{kind:'group',mode:'all',children:[]}}}]);
const enemy={speciesId:130,level:50,moves:[1],abilityId:50,itemId:0};
patchHarnessTrainer(project,parseHarnessConfig({trainerId:2,battleType:doubles?'Doubles':'Singles',trainer:{team:doubles?[enemy,{...enemy,speciesId:321,moves:[150]}]:[enemy],ai:0}}));
const downloads=await buildTestBattleDownloads(project,2);
if(doubles&&project.session.baseRom==="BW"){
 const fixture=new NintendoDSRom(downloads.romBytes,{fileData:'view'}),original=new NintendoDSRom(source,{fileData:'view'}),path='a/1/2/5',archive=new NARC(fixture.getFileByName(path)),before=new NARC(original.getFileByName(path));let partners=0;
 archive.files.forEach((bytes,i)=>{if(bytes.length!==before.files[i].length+36)return;const end=8+bytes[4]*20+bytes[5]*36,first=bytes.slice(end-36,end);if(readU16(first,10)!==3002)return;const partner=first.slice();writeU16(partner,0,readU16(first,0)+1);writeU16(partner,28,readU16(first,28)+1);const expanded=new Uint8Array(bytes.length+36);expanded.set(bytes.subarray(0,end));expanded.set(partner,end);expanded.set(bytes.subarray(end),end+36);expanded[5]++;writeU32(expanded,0,readU32(bytes,0)+36);archive.files[i]=expanded;partners++;});
 assert(partners>0,'Double-trainer field partner fixture missing');downloads.romBytes=fixture.save({files:new Map([[fixture.fileId(path),archive.save()]]),preserveOriginalLength:true});
}
const team=[{speciesId:6,level:100,moves:[33],abilityId:weather?117:50,itemId:0},...(doubles?[{speciesId:which==='Dragon Cheer'&&mode.startsWith('dragon-')?149:320,level:50,moves:[150],abilityId:165,itemId:0}]:[])];
const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),project,parseHarnessConfig({trainerId:2,player:{team}}));
if(doubles&&project.session.baseRom==="BW")for(const half of [0,0x24000]){
 const slots=Array.from({length:64},(_,n)=>half+0x1e200+n*80),first=slots.find(at=>(readU32(save,at)&1)&&readU16(save,at+24)===3002),free=slots.find(at=>!(readU32(save,at)&1));assert(first!==undefined&&free!==undefined);
 save.set(save.slice(first,first+80),free);save[free+8]=save[first+8]+1;for(const field of [32,38])writeU16(save,free+field,readU16(save,first+field)+1);
 refreshTestBattleSaveBlockChecksum(save,getTestBattleConfig('BW').saveLayout,half,0x1e200,0x1400,0x1f602,41);
}
const rom=new NintendoDSRom(downloads.romBytes,{fileData:'view'}),dll=parseRpm(rom.files[rom.fileId(MOVE_EFFECTS_DLL_PATH)],{allowedMagics:['DLXF']});
const reload=await loadProjectFromRomBytes(downloads.romBytes,'export.nds',{selectedNarcs:['moves','message_texts']});assert.deepEqual(inspectMoveEffects(reload).rules.get(33),rule);
const hook=dll.relocations.find(r=>r.target.module===(project.session.baseRom==='BW'?'93':'167')&&dll.symbols[r.sourceSymbolIndex]?.name==='MoveDispatch');assert(hook);
const symbols=moveDebugSymbols(dll);
const pmc=parseRpm(rom.files[rom.fileId('codeinjection/RPMSYM-PMC.rpm')]);
const pmcSymbols=Object.fromEntries(pmc.symbols.filter(s=>s.name&&/g_Modules|g_MainAllocator|g_UserHeapArea/.test(s.name)).map(s=>[s.name!,pmc.baseAddress+32+s.address]));
let eventList:number|undefined;
if(doubles&&project.session.baseRom==="BW"){const ov=rom.loadArm9Overlays([93]).get(93)!,resolver=battleRuntimeResolver(ov.data,ov.ramAddress,project.arm9,rom.arm9RamAddress,blackBindings.functions);eventList=readU32(resolver.resolve('BattleEvent_SeekItem').code,0x30);}
await writeFile(`${out}/battle.nds`,downloads.romBytes);await writeFile(`${out}/battle.sav`,save);
await writeFile(`${out}/fixture.json`,JSON.stringify({game:rom.idCode,hook:hook.target.address,symbols,pmcSymbols,doubles,eventList,recipeCount:edits.length,weatherService:readU32(dll.code,symbols.MoveRuleApi+8*4)&~1,codeBytes:dll.code.length,getter:readU32(dll.code,symbols.MoveRuleApi)&~1,template:which,expectedBoost:mode.startsWith('dragon-')?2:1,expected:mode==='inactive'?[2,4]:mode==='neutral'?[3,4]:[4,4]},null,2));
console.log(JSON.stringify({game:rom.idCode,template:which,exportReload:true,hook:hook.target.address}));
