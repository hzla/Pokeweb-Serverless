import bindings from "../../assets/data/abilityBindingsB1.json";
import { writeU16, writeU32 } from "../../nds/binary";
import { NintendoDSRom } from "../../nds/rom";
import { getNarcFormats } from "../../pokeweb/formats";
import type { ProjectState } from "../../pokeweb/projectStore";
import { hydrateAbilityEffectsSource } from "../../pokeweb/abilityEffectsModel";
import type { BattleRuntimeSignature } from "../../pokeweb/battleRuntimeBindings";

/** Synthetic binary contracts with independent code offsets and overlay relocation. */
export function makeBlackAbilityProject(shift=0,relocate=0,fairy=false){
 const base=0x02190000+relocate,armBase=0x02000000,overlay=new Uint8Array(0x100000),arm9=new Uint8Array(0x100000);
 const locations=new Map<string,number>();let at=0x100+shift,armAt=0x100;
 const functions=bindings.functions as Record<string,BattleRuntimeSignature>;
 const hex=(s:string)=>Uint8Array.from(s.match(/../gu)!,v=>parseInt(v,16));
 for(const[name,s]of Object.entries(functions)){
  const bytes=hex(fairy?s.variants?.[0]?.hex??s.hex:s.hex);if(s.module==="ARM9"){locations.set(name,armBase+armAt);arm9.set(bytes,armAt);armAt=(armAt+bytes.length+3)&~3;}
  else{locations.set(name,base+at);overlay.set(bytes,at);at=(at+bytes.length+3)&~3;}
 }
 for(const[name,s]of Object.entries(functions)){
  const address=locations.get(name)!,code=s.module==="ARM9"?arm9:overlay,offset=address-(s.module==="ARM9"?armBase:base);
  for(const call of s.calls){const delta=locations.get(call.target)!-(address+call.offset+4);writeU16(code,offset+call.offset,0xf000|(delta>>12)&0x7ff);writeU16(code,offset+call.offset+2,(functions[call.target].thumb===false?0xe800:0xf800)|(delta>>1)&0x7ff);}
  for(const tail of s.tails??[])writeU32(code,offset+tail.offset,locations.get(tail.target)!|1);
 }
 const table=at;at+=bindings.rows.length*8;
 bindings.rows.forEach((id,i)=>{writeU32(overlay,table+i*8,id);const p=bindings.profiles.find(p=>p.id===id);if(!p)return;
  const factory=at,bytes=hex(p.factoryHex),events=(factory+bytes.length+3)&~3;overlay.set(bytes,factory);writeU32(overlay,factory+p.tableRefOffset,base+events);
  for(const c of 'factoryCalls'in p?p.factoryCalls as Array<{offset:number;target:string}>:[]){const delta=locations.get(c.target)!-(base+factory+c.offset+4);writeU16(overlay,factory+c.offset,0xf000|(delta>>12)&0x7ff);writeU16(overlay,factory+c.offset+2,0xf800|(delta>>1)&0x7ff);}
  p.events.forEach((e,n)=>{writeU32(overlay,events+n*8,e.event);writeU32(overlay,events+n*8+4,locations.get(e.handler)!|1);});writeU32(overlay,table+i*8+4,(base+factory)|1);at=events+p.events.length*8;
 });
 for(const ref of bindings.tableRefs)writeU32(overlay,locations.get("AbilityEvent_AddItem")!-base+ref.offset,base+table+ref.column);
 const bytes=new Uint8Array(0x1000);bytes.set(new TextEncoder().encode("IRBO"),12);writeU32(bytes,0x20,0x800);writeU32(bytes,0x28,armBase);writeU32(bytes,0x2c,4);writeU32(bytes,0x50,0x400);writeU32(bytes,0x54,32);writeU32(bytes,0x400,93);writeU32(bytes,0x404,base);
 const project={originalRomBytes:bytes,session:{baseRom:"BW",baseVersion:"B",romName:"Black fixture",fairy,fileIds:{},blacklist:[]},romInfo:{idCode:"IRBO",fileName:"fixture.nds",title:"Fixture",size:bytes.length},arm9:arm9.slice(0,armAt),overlays:{93:overlay.slice(0,at)},formats:getNarcFormats("BW"),trpokInfo:[],narcs:{},texts:{banks:{abilities:Array.from({length:165},(_,i)=>`Ability ${i}`)}}} as ProjectState;
 hydrateAbilityEffectsSource(project,new NintendoDSRom(bytes,{fileData:"view"}));return{project,locations,base};
}
