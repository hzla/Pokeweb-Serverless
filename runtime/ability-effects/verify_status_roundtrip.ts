/** Export/reload with ability, move and item recipes in either install order. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadProjectFromRomBytes} from '../../src/pokeweb/loader';
import {configureAbilityRuleSets,inspectAbilityEffects} from '../../src/pokeweb/abilityEffectsModel';
import {configureMoveRuleSets,inspectMoveEffects} from '../../src/pokeweb/moveEffectsModel';
import {configureItemRuleSets,inspectItemEffect} from '../../src/pokeweb/itemEffectsModel';
import {abilityImport} from '../../src/pokeweb/abilityLibrary';
import {exportModifiedRom} from '../../src/pokeweb/exportRom';
const [input,out]=process.argv.slice(2);assert(out,'Usage: INPUT_ROM NEW_OUTPUT_DIRECTORY [--ability-first]');await mkdir(out);
globalThis.fetch=(async(r:RequestInfo|URL)=>{const u=new URL(r instanceof Request?r.url:String(r));assert.equal(u.protocol,'file:');return new Response(new Uint8Array(await readFile(u)));}) as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,'status-roundtrip.nds',{selectedNarcs:['personal','items','moves','message_texts']});
let p=await load(new Uint8Array(await readFile(input)));const rules=new Map([239,310,212,277].map((id,i)=>[165+i,abilityImport(id).rule]));
const abilities=()=>configureAbilityRuleSets(p,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:`Custom ${abilityId}`})));
const others=async()=>{
 const all={kind:'group' as const,mode:'all' as const,children:[]};
 await configureMoveRuleSets(p,[{moveId:33,rules:{effects:[{kind:'power',value:1.5,phase:'power',target:'user',chance:100,secondary:false,conditions:all}],conditions:all,prerequisites:all}}]);
 await configureItemRuleSets(p,[{itemId:281,rules:{effects:[{kind:'healDivisor',value:16}],conditions:all,consumable:false}}]);
};
if(process.argv.includes('--ability-first')){await abilities();await others();}else{await others();await abilities();}
for(let n=0;n<2;n++){
 const s=inspectAbilityEffects(p);assert(s.editable,s.message);assert.deepEqual(s.rules,rules);
 assert(inspectMoveEffects(p).editable);assert(inspectItemEffect(p,281).editable);
 const b=await exportModifiedRom(p,{forDsi:false});await writeFile(`${out}/export-${n}.nds`,b);p=await load(b);
}
assert.deepEqual(inspectAbilityEffects(p).rules,rules);
await writeFile(`${out}/result.json`,JSON.stringify({game:p.session.baseVersion,order:process.argv.includes('--ability-first')?'ability-first':'move-item-first',roundTrips:2,abilityCount:rules.size,abilityEditable:inspectAbilityEffects(p).editable,moveEditable:inspectMoveEffects(p).editable,itemEditable:inspectItemEffect(p,281).editable}));
console.log(`${p.session.baseVersion}: two exports/reloads and ability/move/item coexistence passed`);
