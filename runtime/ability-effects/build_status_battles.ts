/** Native trainer encounters for the status templates, using Test Battle's
 * normal ROM/save export path. No battle-engine test harness is required. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProjectFromRomBytes} from '../../src/pokeweb/loader';
import {configureAbilityRuleSets,inspectAbilityEffects} from '../../src/pokeweb/abilityEffectsModel';
import {buildTestBattleDownloads,rawSaveBytesFromDesmumeDsv,getTestBattleConfig,refreshTestBattleSaveBlockChecksum} from '../../src/pokeweb/testBattle';
import {patchHarnessTrainer,patchHarnessSave,parseHarnessConfig} from '../../src/pokeweb/battleHarness';
import {decodeRecord,markDirty} from '../../src/pokeweb/projectStore';
import {NintendoDSRom} from '../../src/nds/rom';
import {NARC} from '../../src/nds/narc';
import {readU16,readU32,writeU16,writeU32} from '../../src/nds/binary';
import {statusCases} from './status_cases';
const [input,out]=process.argv.slice(2);assert(out,'Usage: ROM NEW_OUTPUT_DIRECTORY');await mkdir(out);await mkdir(`${out}/saves`);
globalThis.fetch=(async(r:RequestInfo|URL)=>{const u=new URL(r instanceof Request?r.url:String(r));assert.equal(u.protocol,'file:');return new Response(new Uint8Array(await readFile(u)));}) as typeof fetch;
const p=await loadProjectFromRomBytes(new Uint8Array(await readFile(input)),'status-native.nds',{selectedNarcs:['personal','moves','items','message_texts','trdata','trpok']});
const {rules,names,cases}=statusCases();await configureAbilityRuleSets(p,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:names.get(abilityId)!})));
for(const id of [92,261]){decodeRecord(p,'moves',id).raw!.accuracy=100;markDirty(p,'moves',id);}
const fixtures=[];const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',')??['puppeteer-toxic','corrosion-poison-type','wind-power','propeller-lightning-rod'];
const config=getTestBattleConfig(p.session.baseRom),hashes:Record<string,string>={};
for(const spec of cases){if(!only.includes(spec.label))continue;
 const enemies=Array.from({length:spec.enemyCount??1},(_,i)=>({speciesId:spec.enemySpecies??320,level:spec.enemyLevel??100,moves:[i?spec.enemy2Move??spec.enemyMove??150:spec.enemyMove??150],abilityId:i?spec.enemy2Ability??spec.enemyAbility??50:spec.enemyAbility??50,abilitySlot:(i?2:1)as 1|2,gender:0 as const}));
 patchHarnessTrainer(p,parseHarnessConfig({trainerId:2,battleType:spec.battleType??'Singles',trainer:{team:enemies,ai:0}}));
 const downloads=await buildTestBattleDownloads(p,2);
 const save=patchHarnessSave(rawSaveBytesFromDesmumeDsv(downloads.saveBytes),p,parseHarnessConfig({trainerId:2,player:{team:[{speciesId:spec.playerSpecies??1,level:50,moves:spec.playerMoves??[spec.move??150],abilityId:spec.abilityId},...(spec.ally?[spec.ally]:[])]}}));
 if(spec.battleType==='Doubles'){
  const rom=new NintendoDSRom(downloads.romBytes,{fileData:'view'}),path=config.paths.overworlds,archive=new NARC(rom.getFileByName(path));let partners=0;
  for(const bytes of archive.files){if(bytes[5]<1)continue;const end=8+bytes[4]*20+bytes[5]*36,first=bytes.slice(end-36,end);if(readU16(first,10)!==3002)continue;
   const partner=first.slice();writeU16(partner,0,readU16(first,0)+1);writeU16(partner,28,readU16(first,28)+1);const expanded=new Uint8Array(bytes.length+36);expanded.set(bytes.subarray(0,end));expanded.set(partner,end);expanded.set(bytes.subarray(end),end+36);expanded[5]++;writeU32(expanded,0,readU32(bytes,0)+36);archive.files[archive.files.indexOf(bytes)]=expanded;partners++;
  }
  assert(partners>0);downloads.romBytes=rom.save({files:new Map([[rom.fileId(path),archive.save()]]),preserveOriginalLength:true});
  for(const half of [0,config.saveLayout.saveHalfOffset]){const slots=Array.from({length:64},(_,n)=>half+0x1e200+n*80),first=slots.find(at=>(readU32(save,at)&1)&&readU16(save,at+24)===3002),free=slots.find(at=>!(readU32(save,at)&1));assert(first!==undefined&&free!==undefined);save.set(save.slice(first,first+80),free);save[free+8]=save[first+8]+1;for(const field of [32,38])writeU16(save,free+field,readU16(save,first+field)+1);refreshTestBattleSaveBlockChecksum(save,config.saveLayout,half,0x1e200,0x1400,0x1f602,41);}
 }
 const label=spec.label,rom=`${label}.nds`;await writeFile(`${out}/${rom}`,downloads.romBytes);await writeFile(`${out}/saves/${label}.sav`,save);hashes[rom]=createHash('sha256').update(downloads.romBytes).digest('hex');fixtures.push({...spec,label,rom});
}
await writeFile(`${out}/cases.json`,JSON.stringify({game:p.session.baseVersion,romHashes:hashes,cases:fixtures,abilityCount:inspectAbilityEffects(p).rules.size}));console.log(`${p.session.baseVersion}: ${fixtures.length} native encounter fixtures`);
