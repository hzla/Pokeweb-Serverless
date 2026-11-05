/** Explicit-ROM round trips. Writes its diagnostic receipt only to the supplied path. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureAbilityRuleSets,inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {validateAbilityRule,type AbilityRuleSet} from "../../src/pokeweb/abilityRules";
import {NintendoDSRom} from "../../src/nds/rom";
import {parseRpm} from "../../src/pokeweb/rpm";
import {estimateRpmMemory} from "../../src/pokeweb/rpmMemory";
const [output,...inputs]=process.argv.slice(2);assert(output&&inputs.length,"Usage: OUTPUT.json INPUT.nds [...INPUT.nds]");
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const sha=(x:Uint8Array)=>createHash("sha256").update(x).digest("hex");
const receipts=[];
for(const input of inputs){
 const original=new Uint8Array(await readFile(input)),before=sha(original);
 const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"environment.nds",{selectedNarcs:["personal","moves","items","message_texts"]});
 let project=await load(original);
 const rules=new Map<number,AbilityRuleSet>();
 for(let id=156;id<=255;id++)rules.set(id,validateAbilityRule({conditions:{kind:"group",mode:"all",children:[{kind:"type",value:11},{kind:"group",mode:"any",children:[{kind:"hp",comparison:"lte",percent:50},{kind:"status",value:4}]}]},effects:[{kind:"abilityRecipe:damageGuard",value:1,parameters:{sources:id-155}},{kind:"abilityRecipe:fieldEntry",value:1,parameters:{duration:id%63+1}},{kind:"abilityRecipe:sideEntry",value:1,parameters:{condition:6,side:1,layers:id%3+1}}]}));
 await configureAbilityRuleSets(project,[...rules].map(([abilityId,rules])=>({abilityId,rules,name:`Env ${abilityId}`})));
 const trim=()=>{for(const[key,store]of Object.entries(project.narcs))if(!store?.dirty.size)delete project.narcs[key as keyof typeof project.narcs];};
 trim();const first=await exportModifiedRom(project,{forDsi:false});project=await load(first);
 let state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,rules);
 const changed=structuredClone(rules.get(255)!);changed.effects[0].parameters!.sources=16383;changed.effects[1].parameters!.duration=63;changed.effects[2].parameters!.layers=3;rules.set(255,changed);
 await configureAbilityRuleSets(project,[{abilityId:255,rules:changed}]);trim();const second=await exportModifiedRom(project,{forDsi:false});project=await load(second);
 state=inspectAbilityEffects(project);assert(state.editable,state.message);assert.deepEqual(state.rules,rules);
 const rom=new NintendoDSRom(second,{fileData:"view"}),module=parseRpm(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH),{allowedMagics:["DLXF"]});
 assert.equal(rom.filenames.folders.find(([name])=>name==="patches")?.[1].files.filter(name=>name==="AbilityEffects.dll").length,1);
 assert.equal(module.relocations.filter(r=>module.symbols[r.sourceSymbolIndex].name==="AbilityIndirectDamageSite").length,1);
 assert.equal(sha(new Uint8Array(await readFile(input))),before);
 receipts.push({game:rom.idCode,inputSha256:before,exportSha256:sha(first),reexportSha256:sha(second),recipes:state.rules.size,runtimeVersion:state.runtimeVersion,memory:estimateRpmMemory(rom.getFileByName(ABILITY_EFFECTS_DLL_PATH)),sharedDllCount:1,damageAdapters:1});
 console.log(`${rom.idCode}: 100 recipes, export/reopen/re-edit/export/reopen passed; one ability DLL and one damage adapter`);
}
await writeFile(output,JSON.stringify(receipts,null,2)+"\n",{flag:"wx"});
