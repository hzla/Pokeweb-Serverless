/** Extract the two native damage-move call sites from explicit revision-0 ROMs. */
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {NintendoDSRom} from "../../src/nds/rom";
import {readU16} from "../../src/nds/binary";
import {battleBranchTarget,type BattleRuntimeSignature} from "../../src/pokeweb/battleRuntimeBindings";
const [w2,b,w,output]=process.argv.slice(2);
assert(output,"Usage: CLEAN_W2.nds CLEAN_B.nds CLEAN_W.nds OUTPUT.json");
const result:Record<string,Record<string,BattleRuntimeSignature>>={};
const prefix=Buffer.from("f8b586b00c1c002104910021161c0391","hex");
for(const[key,path,id,overlayId]of [["BW2",w2,"IRDO",167],["B",b,"IRBO",93],["W",w,"IRAO",93]] as const){
 const rom=new NintendoDSRom(new Uint8Array(await readFile(path)),{fileData:"view"});assert.equal(rom.idCode,id);assert.equal(rom.data[30],0);
 const ov=rom.loadArm9Overlays([overlayId]).get(overlayId)!;
 const candidates:number[]=[];
 for(let at=0;at+256<=ov.data.length;at+=2)if(prefix.every((v,i)=>ov.data[at+i]===v))candidates.push(at);
 assert.equal(candidates.length,1,`${key}: expected one damage-move boundary`);
 const at=candidates[0],address=ov.ramAddress+at,module=String(overlayId);
 const signature=(start:number,size:number,calls:Array<{offset:number;target:string}>):BattleRuntimeSignature=>{
  const bytes=ov.data.slice(start,start+size),mask=new Uint8Array(size).fill(255);
  for(let i=0;i+4<=size;i+=2)if((readU16(bytes,i)&0xf800)===0xf000&&(readU16(bytes,i+2)&0xf800)===0xf800){mask.fill(0,i,i+4);i+=2;}
  return {module,hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex"),calls};
 };
 const target=(offset:number)=>battleBranchTarget(ov.data,at+offset,ov.ramAddress)-ov.ramAddress;
 for(const offset of [54,94,184])assert((readU16(ov.data,at+offset)&0xf800)===0xf000,`${key}: changed call ${offset}`);
 result[key]={
  AbilityStrikeBoundary:signature(at,256,[{offset:54,target:"AbilityStrikeNativeCount"},{offset:94,target:"AbilityStrikeTargetCount"},{offset:184,target:"AbilityStrikeNativeEnd"}]),
  AbilityStrikeNativeCount:signature(target(54),172,[]),
  AbilityStrikeTargetCount:signature(target(94),16,[]),
  AbilityStrikeNativeEnd:signature(target(184),32,[]),
 };
 console.log(`${key}: verified damage-move boundary ${address.toString(16)}`);
}
await writeFile(output,JSON.stringify({version:1,profiles:result})+"\n");
