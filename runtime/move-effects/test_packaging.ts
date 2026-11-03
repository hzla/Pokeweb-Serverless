/** Packaging equivalence for explicit local ROMs; no gameplay services are mocked. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16,readU32} from "../../src/nds/binary";
import {parseRpm,writeRpm,type RpmModule} from "../../src/pokeweb/rpm";
import {decodeAbilityRecipeBook} from "../../src/pokeweb/abilityRecipeBook";
import {loadProjectFromRomBytes} from "../../src/pokeweb/loader";
import {inspectAbilityEffects,ABILITY_EFFECTS_DLL_PATH} from "../../src/pokeweb/abilityEffectsModel";
import {inspectMoveEffects,buildMoveRuleModule,MOVE_EFFECTS_DLL_PATH} from "../../src/pokeweb/moveEffectsModel";
import {MOVE_ALWAYS,newMoveEffect} from "../../src/pokeweb/moveRules";
const [beforePath,afterPath]=process.argv.slice(2);assert(beforePath&&afterPath,"BEFORE.nds AFTER.nds");
const load=async(path:string)=>{const bytes=new Uint8Array(await readFile(path));return{rom:new NintendoDSRom(bytes,{fileData:"view"}),project:await loadProjectFromRomBytes(bytes,"packaging.nds",{selectedNarcs:["personal","moves","items","message_texts"]})};};
const before=await load(beforePath),after=await load(afterPath);
for(const project of [before.project,after.project]){const a=inspectAbilityEffects(project),m=inspectMoveEffects(project);assert(a.editable,a.message);assert(m.editable,m.message);}
assert.deepEqual(inspectAbilityEffects(after.project).rules,inspectAbilityEffects(before.project).rules);
assert.deepEqual(inspectMoveEffects(after.project).rules,inspectMoveEffects(before.project).rules);
for(const store of Object.values(before.project.narcs))if(store&&store.fileId>=0)assert.deepEqual(after.rom.getFileByName(store.sourcePath),before.rom.getFileByName(store.sourcePath),store.sourcePath);
assert.deepEqual(after.project.arm9,before.project.arm9);
const overlayId=before.project.session.baseRom==="BW"?93:167;
assert.deepEqual(after.rom.loadArm9Overlays([overlayId]).get(overlayId)!.data,before.rom.loadArm9Overlays([overlayId]).get(overlayId)!.data);
const module=(rom:NintendoDSRom,path:string)=>parseRpm(rom.getFileByName(path),{allowedMagics:["DLXF"]});
const oldAbility=module(before.rom,ABILITY_EFFECTS_DLL_PATH),ability=module(after.rom,ABILITY_EFFECTS_DLL_PATH);
assert.deepEqual(ability.code,oldAbility.code,"Ability executable or binary recipes changed");assert.equal(ability.bssSize,oldAbility.bssSize);
assert.deepEqual(decodeAbilityRecipeBook(String(ability.metadata.PokewebAbilityRules)),decodeAbilityRecipeBook(String(oldAbility.metadata.PokewebAbilityRules)));
assert.deepEqual(ability.relocations,oldAbility.relocations);
assert.deepEqual(ability.symbols,oldAbility.symbols.map(s=>({...s,name:s.attributes&3?s.name:null})));
// Restoring just private names and JSON must reproduce the complete old DLL.
const restored=structuredClone(ability);restored.metadata.PokewebAbilityRules=oldAbility.metadata.PokewebAbilityRules;delete restored.metadata.PokewebAbilityPackaging;restored.symbols=structuredClone(oldAbility.symbols);
assert.deepEqual(writeRpm(restored,{ident:"DLXF"}),before.rom.getFileByName(ABILITY_EFFECTS_DLL_PATH));
const oldMove=module(before.rom,MOVE_EFFECTS_DLL_PATH),move=module(after.rom,MOVE_EFFECTS_DLL_PATH);
const config=(rpm:RpmModule)=>rpm.symbols.find(s=>s.name==="MoveRecipeConfig")!;
assert.equal(move.bssSize,oldMove.bssSize);assert.deepEqual(config(move),config(oldMove));
const end=config(move).address+config(move).size;
assert.deepEqual(move.code.slice(0,end),oldMove.code.slice(0,end),"Move executable, adapters or binary recipes changed");
function table(rpm:RpmModule,index:number){
 const row=config(rpm).address+4+index*16;
 const pointer=rpm.relocations.find(r=>r.target.module==="base"&&r.target.address===row+8)!;const at=rpm.symbols[pointer.sourceSymbolIndex].address;
 return Array.from({length:readU16(rpm.code,row+2)},(_,n)=>{const event=readU32(rpm.code,at+n*8),relocation=rpm.relocations.find(r=>r.target.module==="base"&&r.target.address===at+n*8+4)!;return{event,callback:rpm.symbols[relocation.sourceSymbolIndex]};});
}
for(let i=0;i<readU16(move.code,config(move).address);i++)assert.deepEqual(table(move,i),table(oldMove,i));
const external=(rpm:RpmModule)=>rpm.relocations.filter(r=>r.target.module!=="base").map(r=>({target:r.target,source:rpm.symbols[r.sourceSymbolIndex]}));
assert.deepEqual(external(move),external(oldMove));
for(const rpm of[ability,move])assert(rpm.symbols.every(s=>!s.name||s.attributes&3||s.name==="MoveRecipeConfig"));
// One hundred independent move IDs must share a table, with the same callbacks.
const rule={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS,effects:[newMoveEffect("modernKnockOff")]};
const many=buildMoveRuleModule(after.project,new Map(Array.from({length:100},(_,n)=>[n+1,rule]))),manyData=config(many).address;
const tables=new Set(Array.from({length:100},(_,i)=>many.relocations.find(r=>r.target.module==="base"&&r.target.address===manyData+4+i*16+8)!.sourceSymbolIndex));
assert.equal(tables.size,1);assert.deepEqual(table(many,0).map(e=>e.event),[3,4,0x37,0x83]);
console.log(JSON.stringify({passed:true,abilityCodeIdentical:true,moveCodeAndRecipesIdentical:true,eventTablesEquivalent:true,exportsAndHooksPreserved:true,bssUnchanged:true,unrelatedDataPreserved:true,sharedTablesFor100Moves:tables.size}));
