/** Extract the indirect-damage call boundary from explicit US ROM inputs.
 * Native bytes are verification contracts; no third-party handler code is linked. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {decompressCode} from "../../src/nds/codeCompression";
import {readU16} from "../../src/nds/binary";
import {battleBranchTarget,battleRuntimeResolver,BATTLE_RUNTIME_SIGNATURES,type BattleRuntimeSignature} from "../../src/pokeweb/battleRuntimeBindings";
import black from "../../src/assets/data/abilityBindingsB1.json";
import white from "../../src/assets/data/abilityBindingsW1.json";
const [w2,b,w,output]=process.argv.slice(2);assert(output,"Usage: CLEAN_W2.nds CLEAN_B.nds CLEAN_W.nds OUTPUT.json");
const result:Record<string,Record<string,BattleRuntimeSignature>>={};
for(const[key,path,id,overlayId,catalog]of [["BW2",w2,"IRDO",167,BATTLE_RUNTIME_SIGNATURES],["B",b,"IRBO",93,black.functions],["W",w,"IRAO",93,white.functions]]as const){
 const rom=new NintendoDSRom(new Uint8Array(await readFile(path)),{fileData:"view"});assert.equal(rom.idCode,id);assert.equal(rom.data[30],0);
 const ov=rom.loadArm9Overlays([overlayId]).get(overlayId)!;
 // ldrh r2,[r4,#4]; mov r0,r5; mov r1,r6; bl check; cmp r0,#0
 const matches:number[]=[];
 for(let at=0;at+14<=ov.data.length;at+=2)if(Buffer.from(ov.data.subarray(at,at+6)).toString("hex")==="a288281c311c"&&readU16(ov.data,at+10)===0x2800&&(readU16(ov.data,at+12)&0xff00)===0xd000)matches.push(at);
 assert.equal(matches.length,1,`${key} indirect work boundary`);
 const site=matches[0],address=ov.ramAddress+site,target=battleBranchTarget(ov.data,site+6,ov.ramAddress),check=ov.data.slice(target-ov.ramAddress,target-ov.ramAddress+20);
 // The checked native wrapper delegates to event 0x80 through one call.
 assert.equal(readU16(check,0),0xb508);assert.equal(readU16(check,6),0x2800);
 const resolver=battleRuntimeResolver(ov.data,ov.ramAddress,decompressCode(rom.arm9),rom.arm9RamAddress,catalog as Record<string,BattleRuntimeSignature>);
 const module=String(overlayId),hex=(x:Uint8Array)=>Buffer.from(x).toString("hex");
 const siteBytes=ov.data.slice(site,site+14),siteMask=new Uint8Array(14).fill(255);siteMask.fill(0,6,10);
 const checkMask=new Uint8Array(20).fill(255);checkMask.fill(0,2,6);
 const eventAddress=battleBranchTarget(check,2,target),eventBytes=ov.data.slice(eventAddress-ov.ramAddress,eventAddress-ov.ramAddress+68),eventMask=new Uint8Array(68).fill(255),calls:Array<{offset:number;target:string}>=[];
 const names=["BattleEventVar_Push","GetMonID","BattleEventVar_SetConstValue","BattleEventVar_SetRewriteOnceValue","BattleEvent_CallHandlers","BattleEventVar_GetValue","BattleEventVar_Pop"];
 for(let at=0;at+4<=eventBytes.length;at+=2)if((readU16(eventBytes,at)&0xf800)===0xf000&&(readU16(eventBytes,at+2)&0xf800)===0xf800){const target=battleBranchTarget(eventBytes,at,eventAddress),name=names.find(n=>resolver.matches(n,target));assert(name,`${key} unknown damage event call +${at}`);calls.push({offset:at,target:name});eventMask.fill(0,at,at+4);at+=2;}
 assert.equal(calls.length,7);assert(eventBytes.includes(0x80));
 result[key]={AbilityIndirectDamageBoundary:{module,hex:hex(siteBytes),mask:hex(siteMask),calls:[{offset:6,target:"AbilityCheckIndirectDamage"}]},AbilityCheckIndirectDamage:{module,hex:hex(check),mask:hex(checkMask),calls:[{offset:2,target:"AbilityIndirectDamageEvent"}]},AbilityIndirectDamageEvent:{module,hex:hex(eventBytes),mask:hex(eventMask),calls}};
 console.log(`${key}: damage boundary ${address.toString(16)}, native check ${target.toString(16)}`);
}
await writeFile(output,JSON.stringify({version:1,profiles:result})+"\n");
