/** Local-ROM regression for transparent ability/move imports and UI validation. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {inspectMoveEffects,MOVE_EFFECTS_DLL_PATH} from "../../src/pokeweb/moveEffectsModel";
import {renderMoveDllFlags} from "../../src/ui/moveDllFlagsEditor";
import {exportModifiedRom} from "../../src/pokeweb/exportRom";
import {NintendoDSRom} from "../../src/nds/rom";
import {parseRpm,writeRpm} from "../../src/pokeweb/rpm";
const [path]=process.argv.slice(2);assert(path,"Usage: vite-node test_editor_performance.ts ROM.nds");
const bytes=new Uint8Array(await readFile(path)),load=(b:Uint8Array)=>loadProjectFromRomBytes(b,"performance.nds",{selectedNarcs:["moves","personal","items","message_texts"]});
const project=await load(bytes),timings:Record<string,number>={};
function timed<T>(label:string,action:()=>T):T{const start=performance.now(),result=action();timings[label]=Math.round(performance.now()-start);assert(timings[label]<10000,`${label} exceeded 10 seconds`);return result;}
const ability=timed("abilityValidation",()=>inspectAbilityEffects(project));assert(ability.editable,ability.message);
const moves=timed("moveValidation",()=>inspectMoveEffects(project));assert(moves.editable,moves.message);assert(ability.rules.size&&moves.rules.size,"This regression requires both shared runtimes");
for(let i=0;i<3;i++)timed(`reopenEffects${i}`,()=>{const next=inspectMoveEffects(project);assert(next.editable,next.message);assert.deepEqual(next.rules,moves.rules);});
timed("expandedFlags",()=>renderMoveDllFlags(project,project.narcs.moves!.fileCount-1));
const start=performance.now(),exported=await exportModifiedRom(project,{forDsi:false});timings.export=Math.round(performance.now()-start);assert(timings.export<10000);
const reopened=await load(exported);assert.deepEqual(inspectMoveEffects(reopened).rules,moves.rules);assert.deepEqual(inspectAbilityEffects(reopened).rules,ability.rules);
const rom=new NintendoDSRom(bytes,{fileData:"view"});
for(const path of [MOVE_EFFECTS_DLL_PATH,ABILITY_EFFECTS_DLL_PATH]){
 const data=rom.getFileByName(path),module=parseRpm(data,{allowedMagics:["DLXF"]});module.code[0]^=1;
 (project.fileSystem??={replacements:{}}).additions??={};project.fileSystem.additions[path]=writeRpm(module,{ident:"DLXF"});
 const state=timed(path===MOVE_EFFECTS_DLL_PATH?"rejectModifiedMove":"rejectModifiedAbility",()=>path===MOVE_EFFECTS_DLL_PATH?inspectMoveEffects(project):inspectAbilityEffects(project));assert(!state.editable,"Modified code was incorrectly accepted");
 delete project.fileSystem.additions[path];
}
console.log(JSON.stringify({passed:true,moves:project.narcs.moves!.fileCount,abilityRecipes:ability.rules.size,moveRecipes:moves.rules.size,timings,exportReload:true,modifiedCodeRejected:true}));
