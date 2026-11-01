/** Round-trip the enabled persistent templates on an explicitly selected ROM. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {configureMoveRuleSets,inspectMoveEffects} from "../../src/pokeweb/moveEffectsModel";
import {MOVE_PERSISTENT_TEMPLATES} from "../../src/pokeweb/moveRecipeLibraryPersistent";
import {decodeRecord,markDirty} from "../../src/pokeweb/projectStore";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
const [input,out]=process.argv.slice(2);assert(input&&out,"Usage: ROM.nds EXTERNAL_OUTPUT_DIRECTORY");await mkdir(out,{recursive:true});
globalThis.fetch=(async(request:RequestInfo|URL)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.protocol!=="file:")throw Error("Only local assets permitted");return new Response(new Uint8Array(await readFile(url)));}) as typeof fetch;
const load=(data:Uint8Array)=>loadProjectFromRomBytes(data,"persistent.nds",{selectedNarcs:["moves","message_texts"]});
let project=await load(new Uint8Array(await readFile(input)));
const edits=MOVE_PERSISTENT_TEMPLATES.map((t,n)=>({moveId:n+1,rules:structuredClone(t.rule)}));
for(const e of edits){const raw=decodeRecord(project,"moves",e.moveId).raw!;raw.category=e.rules.effects.some(x=>x.phase==="status")?0:1;markDirty(project,"moves",e.moveId);}
await configureMoveRuleSets(project,edits);
let result=inspectMoveEffects(project);assert(result.editable,result.message);assert.equal(result.rules.size,edits.length);
const rom=await exportModifiedRom(project,{forDsi:false});await writeFile(`${out}/persistent.nds`,rom);
project=await load(rom);result=inspectMoveEffects(project);assert(result.editable,result.message);assert.equal(result.rules.size,edits.length);
for(const e of edits)assert.deepEqual(result.rules.get(e.moveId),e.rules);
const id=edits.find(e=>e.rules.effects.some(x=>x.kind==="focusCritical"))!.moveId;
const edited=structuredClone(result.rules.get(id)!);edited.effects[0].value=3;await configureMoveRuleSets(project,[{moveId:id,rules:edited}]);
project=await load(await exportModifiedRom(project,{forDsi:false}));result=inspectMoveEffects(project);assert(result.editable,result.message);assert.deepEqual(result.rules.get(id),edited);
console.log(JSON.stringify({game:project.session.baseVersion,templates:edits.length,reedit:true}));
