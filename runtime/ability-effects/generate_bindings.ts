/** Generate checked bindings from explicit local ROM/symbol inputs. */
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { decompressCode } from "../../src/nds/codeCompression";
import { readU16, readU32 } from "../../src/nds/binary";
import { addAbilityParameterCatalog } from "./parameter_catalog";
const [input, overlaySymbols, armSymbols, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: ROM.nds OVERLAY_SYMBOLS ARM9_SYMBOLS OUTPUT.json");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
const overlay = rom.loadArm9Overlays([167]).get(167)!;
type Symbol = { address: number; size: number; module: string; thumb: boolean };
const symbols = new Map<string, Symbol>();
for (const [path, module] of [[overlaySymbols, "167"], [armSymbols, "ARM9"]]) {
  for (const m of (await readFile(path, "utf8")).matchAll(/^(\w+) kind:function\((thumb|arm),size=(0x[\da-f]+)\) addr:(0x[\da-f]+)/gmu))
    symbols.set(m[1], { address: Number(m[4]), size: Number(m[3]), module, thumb: m[2] === "thumb" });
}
const reverse = new Map([...symbols].map(([name, s]) => [s.address, name]));
const dispatcher=symbols.get("AbilityEvent_AddItem")!;
const candidates:number[]=[];
for(let at=0;at+158*8<=overlay.data.length;at+=4)if(readU32(overlay.data,at)===22&&readU32(overlay.data,at+8)===29&&readU32(overlay.data,at+16)===73)candidates.push(at);
if(candidates.length!==1)throw new Error("Missing native ability table");
const table=candidates[0], rows=Array.from({length:158},(_,i)=>readU32(overlay.data,table+i*8));
const profiles: Array<{id:number;priority?:number;factoryCalls?:Array<{offset:number;target:string}>;factorySize?:number;tableRefOffset?:number;factoryHex?:string;factoryMask?:string;events:Array<{event:number;handler:string}>;weather?:Array<{handler:string;offset:number;original:number}>;multipliers?:Array<{handler:string;mov:number;shift:number;original:number}>;chances?:Array<{handler:string;offset:number;original:number}>;stats?:Array<{handler:string;offset:number;original:number}>}> = [];
const names = ["AbilityEvent_AddItem", "HandlerMoldBreakerSkipCheck", "HandlerMoldBreakerStart", "HandlerIntimidateMemberIn", "HandlerSpeedBoost", "HandlerRainDish", "HandlerPoisonPoint", "HandlerTrace", "HandlerHugePower", "HandlerSwiftSwim", "loadAbilityNameToStrbuf", "AbilityEvent_RemoveItem", "AbilityEvent_Swap", "BattleEvent_SeekItem", "numHandlersWithHandlerPri"];
for(let index=0;index<rows.length;index++){
 const factory=(readU32(overlay.data,table+index*8+4)&~1)-overlay.ramAddress,regs=new Uint32Array(8);regs[0]=0x10000;let packed=0,eventTable=0,valid=false,tableRefOffset=0;
 for(let at=factory;at<factory+24;at+=2){const ins=readU16(overlay.data,at);
  if((ins&0xf800)===0x2000)regs[ins>>8&7]=ins&255;
  else if((ins&0xf800)===0x4800){const offset=((overlay.ramAddress+at+4)&~3)+(ins&255)*4-overlay.ramAddress;regs[ins>>8&7]=readU32(overlay.data,offset);if((ins>>8&7)===0)tableRefOffset=offset-factory;}
  else if((ins&0xf800)===0x0000)regs[ins&7]=regs[ins>>3&7]<<(ins>>6&31);
  else if((ins&0xf800)===0x6000&&regs[ins>>3&7]===0x10000)packed=regs[ins&7];
  else if(ins===0x4770){eventTable=regs[0]-overlay.ramAddress;valid=true;break;}else break;
 }
 const factoryCalls:Array<{offset:number;target:string}>=[];
 // Poison Touch calls the packed-priority helper instead of storing a plain count.
 // Accept only the reviewed factory and helper; Stall remains outside this catalog.
 if(rows[index]===143){
  const expected=[0xb510,0x1c04,0x2004,0x2101,0,0,0x6020,0x4801,0xbd10,0x46c0];
  if(!expected.every((ins,i)=>i===4||i===5||readU16(overlay.data,factory+i*2)===ins))throw new Error("Changed Poison Touch factory");
  const hi=readU16(overlay.data,factory+8),lo=readU16(overlay.data,factory+10);let delta=((hi&0x7ff)<<12)|((lo&0x7ff)<<1);if(delta&0x400000)delta-=0x800000;
  const helper=symbols.get("numHandlersWithHandlerPri")!;
  if((hi&0xf800)!==0xf000||(lo&0xf800)!==0xf800||overlay.ramAddress+factory+12+delta!==helper.address)throw new Error("Changed Poison Touch priority call");
  const helperCode=overlay.data.slice(helper.address-overlay.ramAddress,helper.address-overlay.ramAddress+helper.size);
  if(Buffer.from(helperCode).toString("hex")!=="000408437047")throw new Error("Changed packed ability priority helper");
  packed=(4<<16)|1;eventTable=readU32(overlay.data,factory+20)-overlay.ramAddress;tableRefOffset=20;valid=true;factoryCalls.push({offset:8,target:"numHandlersWithHandlerPri"});
 }
 const count=packed&65535;if(!valid||count<1||count>16||eventTable<0)continue;
 const events=Array.from({length:count},(_,i)=>({event:readU32(overlay.data,eventTable+i*8),handler:reverse.get(readU32(overlay.data,eventTable+i*8+4)&~1)!}));
 if(events.some(e=>!e.handler))continue;
 const factorySize=symbols.get(reverse.get(factory+overlay.ramAddress)!)!.size,factoryCode=overlay.data.slice(factory,factory+factorySize),factoryMask=new Uint8Array(factorySize).fill(255);factoryMask.fill(0,tableRefOffset,tableRefOffset+4);
 for(const call of factoryCalls)factoryMask.fill(0,call.offset,call.offset+4);
 profiles.push({id:rows[index],events,factorySize,tableRefOffset,factoryHex:Buffer.from(factoryCode).toString("hex"),factoryMask:Buffer.from(factoryMask).toString("hex"),...(factoryCalls.length?{priority:4,factoryCalls}:{})});for(const e of events)if(!names.includes(e.handler))names.push(e.handler);
}
const functions: Record<string, unknown> = {};
const ownedHelpers = ["CommonLowHPBoostAbility", "CommonWeatherRecoveryAbility", "CommonTypeRecoverHP"];
for(const name of ownedHelpers)if(!names.includes(name))names.push(name);
for (const name of names) {
  const s = symbols.get(name); if (!s) throw new Error(`Missing symbol: ${name}`);
  const data = s.module === "167" ? overlay.data : decompressCode(rom.arm9), base = s.module === "167" ? overlay.ramAddress : rom.arm9RamAddress;
  const bytes = data.slice(s.address-base, s.address-base+s.size), mask = new Uint8Array(bytes.length).fill(255), calls: Array<{offset:number;target:string}> = [];
  if (s.thumb) for (let at=0;at+4<=bytes.length;at+=2) {
    const hi=readU16(bytes,at),lo=readU16(bytes,at+2);
    if ((hi&0xf800)===0xf000 && [0xf800,0xe800].includes(lo&0xf800)) {
      let d=(hi&0x7ff)<<12|(lo&0x7ff)<<1;if(d&0x400000)d-=0x800000;
      // BLX enters ARM code at a word-aligned address. Its displacement changes
      // between B2 and W2 just like an ordinary Thumb BL.
      let address=s.address+at+4+d;if((lo&0xf800)===0xe800)address&=~3;
      const target=reverse.get(address); if(!target)throw new Error(`Unknown call in ${name}`);
      calls.push({offset:at,target});mask.fill(0,at,at+4);at+=2;
    }
  }
  for(let at=0;at+4<=bytes.length;at+=2)if((s.address+at)%4===0&&readU32(bytes,at)>=0x02000000&&readU32(bytes,at)<0x02400000)mask.fill(0,at,at+4);
  const tails:Array<{offset:number;target:string}>=[];
  // Short native wrappers load an absolute Thumb target, set arguments, then bx r3.
  if(profiles.some(p=>p.events.some(e=>e.handler===name))&&bytes.length<=20&&(readU16(bytes,0)&0xff00)===0x4b00){
   const offset=((s.address+4)&~3)+(bytes[0]*4)-s.address;
   if(offset>=0&&offset+4<=bytes.length&&Array.from({length:offset/2},(_,i)=>readU16(bytes,i*2)).includes(0x4718)){
    const target=reverse.get(readU32(bytes,offset)&~1);if(!target)throw new Error(`Unknown tail in ${name}`);tails.push({offset,target});
    if(!names.includes(target))names.push(target);
   }
  }
  if (["AbilityEvent_AddItem", "HandlerMoldBreakerSkipCheck", ...ownedHelpers, ...profiles.flatMap(p=>p.events.map(e=>e.handler))].includes(name)) for (const call of calls) if (!names.includes(call.target)) names.push(call.target);
  const variants:Array<{hex:string;mask:string}>=[];
  const typeGuard=name==="HandlerColorChange"?0x36:name==="DoesMonHaveType"?0x06:undefined;
  if(typeGuard!==undefined){
    if(readU16(bytes,typeGuard)!==(name==="HandlerColorChange"?0x2e11:0x2c11)||bytes[typeGuard+3]!==0xd0)throw new Error(`Unrecognized type-range check in ${name}`);
    const fairy=bytes.slice();fairy[typeGuard]=18;fairy[typeGuard+3]=0xda;
    variants.push({hex:Buffer.from(fairy).toString("hex"),mask:Buffer.from(mask).toString("hex")});
  }
  functions[name]={hex:Buffer.from(bytes).toString("hex"),mask:Buffer.from(mask).toString("hex"),calls,module:s.module,...(variants.length?{variants}:{}),...(!s.thumb?{thumb:false}:{}),...(tails.length?{tails}:{})};
}
const code=overlay.data.slice(dispatcher.address-overlay.ramAddress,dispatcher.address-overlay.ramAddress+dispatcher.size);
const tableRefs:Array<{offset:number;column:number}>=[];
for(let at=0;at+4<=code.length;at+=4){const v=readU32(code,at)-overlay.ramAddress-table;if(v===0||v===4)tableRefs.push({offset:at,column:v});}
if(tableRefs.length!==2)throw new Error("Missing dispatcher table references");
for(const profile of profiles){
 const weather:NonNullable<typeof profile.weather>=[],multipliers:NonNullable<typeof profile.multipliers>=[],chances:NonNullable<typeof profile.chances>=[];
 for(const event of profile.events){
  const f=functions[event.handler] as {hex:string;calls:Array<{offset:number;target:string}>},bytes=Uint8Array.from(Buffer.from(f.hex,"hex"));
  for(const call of f.calls){
   if(call.target==="GetWeather"&&readU16(bytes,call.offset+4)>>8===0x28)weather.push({handler:event.handler,offset:call.offset+4,original:bytes[call.offset+4]});
   if(call.target==="CommonWeatherGuard"&&readU16(bytes,4)>>8===0x24)weather.push({handler:event.handler,offset:4,original:bytes[4]});
   if(call.target==="BattleEventVar_MulValue"&&call.offset>=2){const ins=readU16(bytes,call.offset-2),rs=ins>>3&7;
    if((ins&0xf800)===0&&(ins&7)===1)for(let at=call.offset-4;at>=0;at-=2)if((readU16(bytes,at)&0xff00)===(0x2000|rs<<8)){multipliers.push({handler:event.handler,mov:at,shift:call.offset-2,original:bytes[at]*2**(ins>>6&31)/4096});break;}
   }
   if(call.target==="CommonContactStatusAbility")for(let at=0;at<call.offset-2;at+=2)if((readU16(bytes,at)&0xf800)===0x2000&&(readU16(bytes,at+2)&0xff00)===(0x9000|(readU16(bytes,at)>>8&7)<<8))chances.push({handler:event.handler,offset:at,original:bytes[at]});
  }
 }
 if(weather.length&&new Set(weather.map(c=>c.original)).size===1)profile.weather=weather;
 if(multipliers.length&&new Set(multipliers.map(c=>c.original)).size===1)profile.multipliers=multipliers;
 if(chances.length&&new Set(chances.map(c=>c.original)).size===1)profile.chances=chances;
 if(profile.id===22){
  const handler="HandlerIntimidateMemberIn",f=functions[handler] as {hex:string};
  if(!profile.events.every(e=>e.handler===handler)||f.hex.slice(0x50*2,0x5c*2)!=="011c01224a60901e08738a73")throw new Error("Unrecognized Intimidate stat assignment");
  profile.stats=[{handler,offset:0x54,original:1}];
 }
}
addAbilityParameterCatalog(profiles,functions);
await writeFile(output,JSON.stringify({version:1,functions,rows,tableRefs,profiles})+"\n");
console.log(`${names.length} ability bindings, ${rows.length} native assignments.`);
