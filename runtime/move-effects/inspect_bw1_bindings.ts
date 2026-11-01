/** Inspect BW1 move dispatch and reviewed native operations in an explicit ROM. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";
import bw2 from "../../src/assets/data/moveRecipeBindings.json";
import blackAbility from "../../src/assets/data/abilityBindingsB1.json";
import { MOVE_RULE_API } from "../../src/pokeweb/moveEffectsModel";
import { battleBranchTarget, battleRuntimeResolver } from "../../src/pokeweb/battleRuntimeBindings";

const [input, reference, output, serviceCatalog] = process.argv.slice(2);
assert(input && reference && output, "Usage: ROM.nds REFERENCE_DIRECTORY OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
const hashes: Record<string, string> = { IRBO: "26ad0b9967aa279c4a266ee69f52b9b2332399a5", IRAO: "bc696a0dfb448c7b3a8a206f0f8214411a039208" };
assert(rom.data[30] === 0 && hashes[rom.idCode], "Expected US revision-0 Black or White");
assert.equal(createHash("sha1").update(rom.data).digest("hex"), hashes[rom.idCode], "Expected the clean reference revision");
const ov = rom.loadArm9Overlays([93]).get(93)!;
type Sym = { name: string; address: number; size: number };
const symbols = new Map<string, Sym>();
for (const line of (await readFile(`${reference}/layout/function_addrs.tsv`, "utf8")).trim().split("\n").slice(1)) {
  const [region,address,name,isa,size] = line.split("\t");
  if (region === "ov093" && isa === "thumb") symbols.set(name,{ name,address:Number(address),size:Number(size) });
}
if (rom.idCode === "IRAO") {
  const mapped = JSON.parse(await readFile(`${reference}/layout/matched_white/ov093.json`, "utf8"));
  for (const row of mapped.functions) { const symbol = symbols.get(row.name); if (symbol && row.white_address) symbol.address = Number(row.white_address); }
}
const at = (address: number) => { const offset = address - ov.ramAddress; assert(offset >= 0 && offset < ov.data.length, `Address outside overlay: ${address.toString(16)}`); return offset; };
const byAddress = new Map([...symbols.values()].map(symbol => [symbol.address, symbol]));
const dispatch = symbols.get("HAND_WAZA_AddMoveHandler"); assert(dispatch && dispatch.size >= 120);
const d = at(dispatch.address), first = readU32(ov.data,d+108), count = readU32(ov.data,d+112), second = readU32(ov.data,d+116);
assert.equal(second, first+4); assert(count > 0 && count < 1024);
const table = at(first); assert(table+count*8 <= ov.data.length);
const rows = Array.from({length:count},(_,i)=>readU32(ov.data,table+i*8));
assert.equal(new Set(rows).size, rows.length);
const operations: Record<string, unknown> = {};
const functions: Record<string, { hex:string; mask:string; module:string; calls:never[] }> = {};
const getters: Record<string, { name:string; tableRef:number; events:Array<{event:number;handler:string}> }> = {};
function recordSignature(name:string,symbol:Sym):void {
  const start=at(symbol.address),bytes=ov.data.slice(start,start+symbol.size),mask=new Uint8Array(bytes.length).fill(255);
  assert.equal(bytes.length,symbol.size,`Truncated ${symbol.name}`);
  // Native callbacks execute in place: preserve their branch instructions so
  // a patched call target cannot silently pass as the reviewed handler.
  for(let n=0;n+4<=bytes.length;n+=2)if((symbol.address+n)%4===0){
    const value=readU32(bytes,n);if(value>=0x02000000&&value<0x02400000)mask.fill(0,n,n+4);
  }
  const signature={hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex"),module:"93",calls:[] as never[]};
  if(functions[name])assert.deepEqual(functions[name],signature,`Native operation ${name} maps to different code`);
  else functions[name]=signature;
}
for (const [id, expected] of Object.entries(bw2.getters)) {
  const index = rows.indexOf(Number(id));
  if (index < 0) { operations[id] = { available: false, reason: "missing registry entry" }; continue; }
  const address = readU32(ov.data,table+index*8+4)&~1, factory = byAddress.get(address);
  if (!factory) { operations[id] = { available: false, reason: "unmapped factory" }; continue; }
  const start = at(address), candidates: Array<{ offset:number; events:number[]; handlers:string[] }> = [];
  for (let offset=0; offset+4<=factory.size; offset+=2) {
    if ((address+offset)%4) continue;
    const pointer=readU32(ov.data,start+offset), e=pointer-ov.ramAddress;
    if (e<0 || e+expected.events.length*8>ov.data.length) continue;
    const events=expected.events.map((_,n)=>readU32(ov.data,e+n*8));
    const handlers=expected.events.map((_,n)=>byAddress.get(readU32(ov.data,e+n*8+4)&~1)?.name ?? "");
    if(events.every((event,n)=>event===expected.events[n].event)&&handlers.every(Boolean))candidates.push({offset,events,handlers});
  }
  operations[id] = candidates.length===1 ? { available:true,factory:factory.name,tableRef:candidates[0].offset,events:candidates[0].events,handlers:candidates[0].handlers } : { available:false,factory:factory.name,reason:`${candidates.length} matching event tables` };
  if(candidates.length===1){
    recordSignature(expected.name,factory);
    const handlerEvents=expected.events.map((event,n)=>{
      const handler=symbols.get(candidates[0].handlers[n]);assert(handler);
      recordSignature(event.handler,handler);return {event:event.event,handler:event.handler};
    });
    getters[id]={name:expected.name,tableRef:candidates[0].offset,events:handlerEvents};
  }
}
// Presence in the ability catalog is only a starting point. These services
// still need ABI and call-site review for the move runtime on each game.
const knownServices = MOVE_RULE_API.filter(name => name !== null)
  .filter(name => Object.hasOwn(blackAbility.functions, name));
const missingServices = MOVE_RULE_API.filter(name => name !== null)
  .filter(name => !Object.hasOwn(blackAbility.functions, name));
const moveParamSites:Array<{address:number;hex:string;mask:string}> = [];
if(serviceCatalog){
  const profile=JSON.parse(await readFile(serviceCatalog,"utf8"));
  assert.equal(profile.game,rom.idCode==="IRBO"?"B":"W","Service catalog is for another game");
  const resolver=battleRuntimeResolver(ov.data,ov.ramAddress,decompressCode(rom.arm9),rom.arm9RamAddress,profile.functions);
  const service=resolver.resolve("ServerEvent_GetMoveParam");
  for(let offset=16;offset+32<=ov.data.length;offset+=2){
    const hi=readU16(ov.data,offset),lo=readU16(ov.data,offset+2);
    if((hi&0xf800)!==0xf000||(lo&0xf800)!==0xf800||battleBranchTarget(ov.data,offset,ov.ramAddress)!==service.address)continue;
    const start=offset-16,bytes=ov.data.slice(start,start+48),mask=new Uint8Array(bytes.length).fill(255);
    for(let n=0;n+4<=bytes.length;n+=2){
      const first=readU16(bytes,n),second=readU16(bytes,n+2);
      if((first&0xf800)===0xf000&&[0xf800,0xe800].includes(second&0xf800)){mask.fill(0,n,n+4);n+=2;}
    }
    for(let n=0;n+4<=bytes.length;n+=2)if((ov.ramAddress+start+n)%4===0){const v=readU32(bytes,n);if(v>=0x02000000&&v<0x02400000)mask.fill(0,n,n+4);}
    moveParamSites.push({address:ov.ramAddress+offset,hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex")});
  }
  assert.equal(moveParamSites.length,8,"Unexpected move-parameter callers");
}
const result={game:rom.idCode,overlay:93,count,rows,operations,knownServices,missingServices,functions,getters,moveParamSites};
await writeFile(output,JSON.stringify(result,null,2)+"\n");
const available=Object.values(operations).filter(o=>(o as {available:boolean}).available).length;
console.log(`${rom.idCode}: ${count} native move handlers; ${available}/${Object.keys(operations).length} reviewed operation event tables match.`);
console.log(`${knownServices.length} move API names are present in the existing Black ability catalog; ${missingServices.length} require separate mappings.`);
