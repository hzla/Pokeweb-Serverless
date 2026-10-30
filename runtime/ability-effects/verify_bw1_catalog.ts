/** Verify every import through Black's normal installer and ROM loader. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects,buildAbilityRuleModule,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {ABILITY_IMPORT_LIBRARY} from "../../src/pokeweb/abilityLibrary";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {NintendoDSRom} from "../../src/nds/rom";
import {getTextBank} from "../../src/pokeweb/textModel";
import {parseRpm} from "../../src/pokeweb/rpm";
import bindings from "../../src/assets/data/abilityBindingsB1.json";
const[inputPath,outPath]=process.argv.slice(2);assert(outPath,"Usage: INPUT.nds OUTPUT_DIRECTORY");const out=resolve(outPath);await mkdir(out,{recursive:true});
const input=new Uint8Array(await readFile(inputPath)),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
globalThis.fetch=(async request=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"black-ability-catalog.nds",{selectedNarcs:["personal","message_texts"]});
const project=await load(input);assert.equal(project.session.baseVersion,"B");assert(project.overlays[93]);
let nativeEdits=0;for(const p of bindings.profiles){
 const e:{kind:string;value:number;parameters:Record<string,number>;stat?:number;weather?:number;chance?:number}={kind:`nativeAbility:${p.id}`,value:-1,parameters:{}};
 for(const c of p.parameters??[])e.parameters[c.key]=c.choices?.find(v=>v!==c.original)??(c.original===c.min?c.max:c.min);
 if('stats'in p)e.stat=3;if('weather'in p)e.weather=3;if('multipliers'in p)e.value=2.5;if('chances'in p)e.chance=100;
 buildAbilityRuleModule(project,new Map([[255,{effects:[e],conditions:{kind:"group",mode:"all",children:[]}}]]));nativeEdits++;
}
const receipts=[];
// Separate runs keep the existing shared-module budget for complex combinations.
for(let batch=0;batch<4;batch++){
 let p=await load(input);const entries=ABILITY_IMPORT_LIBRARY.slice(batch*22,batch*22+22),rules=new Map(entries.map((e,i)=>[i===21?255:165+i,e.rule]));
 await configureAbilityRuleSets(p,[...rules].map(([abilityId,rules],i)=>({abilityId,rules,name:entries[i].defaultName})));
 for(const[n,s]of Object.entries(p.narcs))if(!s?.dirty.size)delete p.narcs[n as keyof typeof p.narcs];
 const bytes=await exportModifiedRom(p,{forDsi:false});p=await load(bytes);const state=inspectAbilityEffects(p);assert(state.editable,state.message);assert.deepEqual(state.rules,rules);
 for(const[id]of rules)for(const bank of [182,285])assert.equal(getTextBank(p,"message_texts",bank)[id]?.[1],entries[[...rules.keys()].indexOf(id)].defaultName);
 for(const id of rules.keys())assert(getTextBank(p,"message_texts",183)[id]?.[1]);
 const rom=new NintendoDSRom(bytes,{fileData:"view"}),rpm=parseRpm(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]});
 assert.equal(rpm.metadata.PMCGameID,"B");assert(!rpm.relocations.some(r=>r.target.module==="167"));assert.equal([...rom.filenames.folders.find(([n])=>n==="patches")![1].files].filter(n=>n==="AbilityEffects.dll").length,1);
 receipts.push({batch,imports:entries.map(e=>e.label),count:rules.size,id255Name:getTextBank(p,"message_texts",182)[255][1],sha256:hash(bytes),codeBytes:rpm.code.length,bssBytes:rpm.bssSize});await writeFile(`${out}/catalog-${batch}.nds`,bytes);
}
assert.equal(hash(new Uint8Array(await readFile(inputPath))),hash(input));await writeFile(`${out}/catalog.json`,JSON.stringify({inputSha256:hash(input),nativeEdits,imports:ABILITY_IMPORT_LIBRARY.length,receipts},null,2)+"\n");console.log(`${nativeEdits} edited native templates and ${ABILITY_IMPORT_LIBRARY.length} imported recipes passed; four export/reloads, names through ID 255.`);
