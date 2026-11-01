/** Inspect checked history-hook candidates in an explicitly supplied ROM. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16 } from "../../src/nds/binary";
import { BATTLE_RUNTIME_SIGNATURES, battleBranchTarget, battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";
import { moveHistoryInitCall } from "../../src/pokeweb/moveHistoryBindings";
import black from "../../src/assets/data/moveRecipeBindingsB1.json";
import white from "../../src/assets/data/moveRecipeBindingsW1.json";
import sequel from "../../src/assets/data/moveRecipeBindings.json";
import selection from "../../src/assets/data/moveHistorySelectBindings.json";

const [path, output] = process.argv.slice(2);
assert(path && output, "Usage: ROM.nds EXTERNAL_OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(path)), {fileData:"view"});
assert(["IRBO", "IRAO", "IRDO", "IREO"].includes(rom.idCode) && rom.data[30] === 0);
const bw1 = rom.idCode === "IRBO" || rom.idCode === "IRAO", overlay = rom.loadArm9Overlays([bw1 ? 93 : 167]).get(bw1 ? 93 : 167)!;
const arm = decompressCode(rom.arm9), catalog = rom.idCode === "IRBO" ? black : rom.idCode === "IRAO" ? white : sequel;
const selectionProfiles=selection as Record<string,typeof selection.IRBO>;
const resolver = battleRuntimeResolver(overlay.data, overlay.ramAddress, arm, rom.arm9RamAddress, {...BATTLE_RUNTIME_SIGNATURES, ...catalog.functions,HistorySelect:selectionProfiles[rom.idCode]});
const names = ["BattleEvent_Init", "BattleEvent_AddItem", "BattleEvent_CallHandlers", "GetMonID", "GetTurnCounter", "PML_ItemIsBerry", "ServerControl_ChangeHeldItem", "BattleHandler_ForceUseItem"];
const services = Object.fromEntries(names.map(name => {
  const service = resolver.resolve(name);
  const callers: Array<{address:number;window:string}> = [];
  for (let at = 16; at + 20 <= overlay.data.length; at += 2) {
    const hi = readU16(overlay.data,at), lo = readU16(overlay.data,at+2);
    if ((hi & 0xf800) !== 0xf000 || (lo & 0xf800) !== 0xf800) continue;
    if (battleBranchTarget(overlay.data,at,overlay.ramAddress) !== service.address) continue;
    callers.push({address:overlay.ramAddress+at,window:Buffer.from(overlay.data.subarray(at-16,at+20)).toString("hex")});
  }
  return [name,{address:service.address,callers}];
}));
const consumption=services.ServerControl_ChangeHeldItem.callers.filter(c=>{
 const at=c.address-overlay.ramAddress;return readU16(overlay.data,at-8)===0x1c28&&readU16(overlay.data,at-6)===0x1c31&&readU16(overlay.data,at-2)===0x2301;
});
assert.equal(consumption.length,1);
const consumeAt=consumption[0].address-overlay.ramAddress-56;
const consumeHex=Buffer.from(overlay.data.subarray(consumeAt,consumeAt+64)).toString("hex");
const consumeDependencies=[18,34,44,56].map(offset=>{const target=battleBranchTarget(overlay.data,consumeAt+offset,overlay.ramAddress),at=target-overlay.ramAddress;return {offset,target,hex:Buffer.from(overlay.data.subarray(at,at+160)).toString("hex")};});
const consumeCallers:number[]=[];
for(let at=0;at+4<=overlay.data.length;at+=2){
 const hi=readU16(overlay.data,at),lo=readU16(overlay.data,at+2);
 if((hi&0xf800)===0xf000&&(lo&0xf800)===0xf800&&battleBranchTarget(overlay.data,at,overlay.ramAddress)===overlay.ramAddress+consumeAt)consumeCallers.push(overlay.ramAddress+at);
}
const selectAddress=rom.idCode==="IRBO"?0x21cf5b0:rom.idCode==="IRAO"?0x21cf5d0:rom.idCode==="IRDO"?0x21b47f8:0x21b47b8;
const selectAt=selectAddress-overlay.ramAddress;
const selectHex=Buffer.from(overlay.data.subarray(selectAt,selectAt+32)).toString("hex");
assert.equal(resolver.resolve("HistorySelect").address,selectAddress,"Unrecognized native move-selection binding");
const protectSites:Array<{address:number;target:number;targetHex:string}> = [];
const protectPrefix=Uint8Array.from([0x02,0x9b,0x28,0x1c,0x1b,0x88,0x31,0x1c,0x3a,0x1c]);
for(let at=10;at+12<=overlay.data.length;at+=2){
 if(!protectPrefix.every((v,n)=>overlay.data[at-10+n]===v))continue;
 if(readU16(overlay.data,at+4)!==0x2800||readU16(overlay.data,at+6)!==0xd10e)continue;
 try{const target=battleBranchTarget(overlay.data,at,overlay.ramAddress),offset=target-overlay.ramAddress;assert(offset>=0&&offset+68<=overlay.data.length);protectSites.push({address:overlay.ramAddress+at,target,targetHex:Buffer.from(overlay.data.subarray(offset,offset+68)).toString("hex")});}catch{/* not a reviewed branch */}
}
assert.equal(protectSites.length,1,"Unrecognized native Protect call site");
const transformSites:Array<{address:number;target:number;targetHex:string;callerHex:string}> = [];
for(let at=82;at+4<=overlay.data.length;at+=2){
 if(readU16(overlay.data,at-4)!==0x9902||readU16(overlay.data,at-2)!==0x1c20||readU16(overlay.data,at+4)!==0x2800||readU16(overlay.data,at+6)!==0xd044)continue;
 if(readU16(overlay.data,at-82)!==0xb5f0||readU16(overlay.data,at-80)!==0xb083)continue;
 try{const target=battleBranchTarget(overlay.data,at,overlay.ramAddress),offset=target-overlay.ramAddress;transformSites.push({address:overlay.ramAddress+at,target,targetHex:Buffer.from(overlay.data.subarray(offset,offset+260)).toString("hex"),callerHex:Buffer.from(overlay.data.subarray(at-82,at+162)).toString("hex")});}catch{/* not the checked call */}
}
assert.equal(moveHistoryInitCall(overlay.data,overlay.ramAddress,services.BattleEvent_Init.address),services.BattleEvent_Init.callers[0]?.address);
await writeFile(output,JSON.stringify({game:rom.idCode,overlay:overlay.ramAddress,services,protectSites,transformSites,consumeHex,consumeCallers,consumeDependencies,selectAddress,selectHex},null,2)+"\n");
console.log(JSON.stringify({game:rom.idCode,callCounts:Object.fromEntries(Object.entries(services).map(([name,value])=>[name,value.callers.length]))}));
