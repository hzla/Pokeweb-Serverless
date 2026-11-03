import {readU16,readU32} from "../nds/binary";
import {parseRpm} from "./rpm";

export const PMC_ALLOCATION_HEADER_BYTES=16;
export const pmcAllocatedBytes=(bytes:number)=>Math.ceil(bytes/8)*8+PMC_ALLOCATION_HEADER_BYTES;
export type RpmMemoryEstimate={fileBytes:number;codeBytes:number;bssBytes:number;loadBytes:number;residentBytes:number;loadAllocationBytes:number;residentAllocationBytes:number;overlays:string[];imports:string[];exports:string[];priority:number};

/** PMC expands BSS in the same allocation, then discards internal relocations.
 * Code is already part of the file image: never add it a second time. */
export function estimateRpmMemory(bytes:Uint8Array):RpmMemoryEstimate {
  // The sidebar inspects arbitrary installed DLLs. Bound table walks before
  // handing their record counts to the general RPM reader.
  const within=(at:number,length:number)=>{if(at<0||length<0||at+length>bytes.length)throw Error("Invalid DLL section bounds.");};
  if(bytes.length>16*1024*1024)throw Error("Invalid DLL size.");
  within(0,32);
  const header=readU32(bytes,8),loadBytes=readU32(bytes,4),info=header+readU32(bytes,header+8);
  within(header,20);within(info,36);
  within(readU32(bytes,info+16),readU32(bytes,info+20));
  if(readU32(bytes,header+4)!==13)throw Error("Unrecognized DLL memory layout.");
  const section=(at:number)=>{const relative=readU32(bytes,at);if(relative===0xffffffff)return;const result=header+relative;within(result,4);return result;};
  const records=(at:number,countOffset:number,start:number,stride:number)=>{within(at,start);within(at+start,readU32(bytes,at+countOffset)*stride);};
  const symbols=section(info+4);if(symbols!==undefined)records(symbols,20,24,12);
  const metadata=section(info+32);if(metadata!==undefined)records(metadata,4,8,8);
  const rel=section(info+8);if(rel!==undefined){
    within(rel,24);
    for(const offset of [8,12,16]){const list=section(rel+offset);if(list!==undefined)records(list,0,4,8);}
    const names=section(rel+20);if(names!==undefined)within(names+2,readU16(bytes,names)*2);
  }
  const rpm=parseRpm(bytes,{allowedMagics:["DLXF","RPM0"]});
  if(loadBytes<bytes.length||loadBytes>16*1024*1024)throw Error("Invalid DLL allocation size.");
  const relative=readU32(bytes,info+8);
  let residentBytes=loadBytes;
  if(relative!==0xffffffff){
    const relocation=header+relative;
    if(relocation+24>bytes.length)throw Error("Invalid DLL relocation section.");
    const internal=readU32(bytes,relocation+8);
    if(internal!==0xffffffff){
      const end=header+internal;
      if(end<info+36||end>bytes.length)throw Error("Invalid DLL relocation boundary.");
      residentBytes=end+rpm.bssSize;
    }
  }
  if(residentBytes>loadBytes)throw Error("Invalid DLL resident size.");
  return {fileBytes:bytes.length,codeBytes:rpm.code.length,bssBytes:rpm.bssSize,loadBytes,residentBytes,loadAllocationBytes:pmcAllocatedBytes(loadBytes),residentAllocationBytes:pmcAllocatedBytes(residentBytes),overlays:[...new Set(rpm.relocations.filter(r=>r.target.module!=="base").map(r=>r.target.module))],imports:rpm.symbols.filter(s=>s.attributes&2&&s.name).map(s=>s.name!),exports:rpm.symbols.filter(s=>s.attributes&1&&s.name).map(s=>s.name!),priority:Number(rpm.metadata.PMCModulePriority??4)};
}
