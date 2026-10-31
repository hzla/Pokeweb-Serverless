/** Explicit local ROM round trip for actual expanded IDs and source mappings. */
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {installMoveExpansion,getMoveExpansionSourceMoveId} from "../../src/pokeweb/moveExpansionPatch";
import {configureMoveRuleSets,inspectMoveEffects,clearMoveRules,MOVE_RECIPE_MANAGED_FIELDS} from "../../src/pokeweb/moveEffectsModel";
import {MOVE_RECIPE_LIBRARY} from "../../src/pokeweb/moveRecipeLibrary";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
const [input,out]=process.argv.slice(2);assert(out,"ROM EXTERNAL_OUTPUT_DIRECTORY");await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));assert.equal(url.protocol,"file:");return new Response(new Uint8Array(await readFile(url)));})as typeof fetch;
const load=(bytes:Uint8Array)=>loadProjectFromRomBytes(bytes,"expanded-move-recipes.nds",{selectedNarcs:["moves","message_texts"]});
let project=await load(new Uint8Array(await readFile(input)));await installMoveExpansion(project,{includeBundledAnimations:false});
const mappings=MOVE_RECIPE_LIBRARY.map(t=>{const id=Array.from({length:320},(_,n)=>680+n).find(id=>getMoveExpansionSourceMoveId(id)===t.sourceId);assert(id,`Missing source mapping ${t.label}`);return {name:t.label,sourceId:t.sourceId,romId:id};});
const original=structuredClone(decodeRecord(project,"moves",999).raw!);
const rules=new Map(Array.from({length:100},(_,n)=>[680+n,MOVE_RECIPE_LIBRARY[n%31].rule]));rules.set(999,MOVE_RECIPE_LIBRARY.find(t=>t.sourceId===912)!.rule);
for(const[id,rule]of rules){const raw=decodeRecord(project,"moves",id).raw!;raw.category=rule.effects.some(e=>e.phase==="status")?0:1;raw.power=raw.category===0?0:40;markDirty(project,"moves",id);}
await configureMoveRuleSets(project,[...rules].map(([moveId,rules])=>({moveId,rules})));
const bytes=await exportModifiedRom(project,{forDsi:false});project=await load(bytes);assert.deepEqual(inspectMoveEffects(project).rules,rules);assert.equal(project.narcs.moves!.fileCount,1000);
await clearMoveRules(project,999);project=await load(await exportModifiedRom(project,{forDsi:false}));assert.equal(inspectMoveEffects(project).rules.size,100);
for(const field of MOVE_RECIPE_MANAGED_FIELDS)assert.equal(decodeRecord(project,"moves",999).raw![field],original[field]);
await writeFile(`${out}/expanded-roundtrip.json`,JSON.stringify({passed:true,editedMoves:101,highestRomId:999,mappings},null,2));
console.log("Expanded source mappings, actual ROM ID 999 and 101 recipes round-trip correctly.");
