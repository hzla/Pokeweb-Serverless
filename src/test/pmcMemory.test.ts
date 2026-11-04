import {describe,expect,it,vi} from "vitest";
import {readU32,writeU32} from "../nds/binary";
import {estimateRpmMemory,pmcAllocatedBytes} from "../pokeweb/rpmMemory";
import {writeRpm,type RpmModule} from "../pokeweb/rpm";
import {getPmcMemoryEstimate,PMC_BASE_ALLOCATION_BYTES} from "../pokeweb/pmcMemoryModel";
import type {ProjectState} from "../pokeweb/projectStore";
import {renderPmcCapacity} from "../ui/pmcCapacity";
vi.mock("../pokeweb/pmcModel",()=>({getPmcHeapExpansionStatus:(p:ProjectState)=>({expanded:p.codeInjection?.pmc?.version?.includes("heap200")}),listCodeInjectionDlls:(p:ProjectState)=>Object.keys(p.fileSystem?.additions??{}).map(path=>({path,target:path.startsWith("lib/")?"lib":"patches"}))}));
function dll(overlay="93",bssSize=1500,priority=4){
  const module:RpmModule={code:new Uint8Array(4096),bssSize,baseAddress:0,symbols:[{name:"Entry",type:"FUNCTION_THM",address:0,size:12,attributes:1}],relocations:[{target:{module:overlay,address:0x02100000,type:"THUMB_BRANCH"},sourceSymbolIndex:0},{target:{module:"base",address:16,type:"OFFSET"},sourceSymbolIndex:0}],metadata:{PMCModulePriority:priority,Book:"long metadata ".repeat(100)}};
  return writeRpm(module,{ident:"DLXF"});
}
function project(files:Record<string,Uint8Array>,version="13.2.4"){return {session:{baseRom:"BW",baseVersion:"B"},fileSystem:{replacements:{},additions:files},codeInjection:{pmc:{version}}}as unknown as ProjectState;}
describe("PMC memory estimates",()=>{
  it("classifies BW2 graphics overlay 168 as battle and keeps summary overlap conservative",()=>{
    const p=project({"patches/Graphics.dll":dll("168"),"patches/Summary.dll":dll("207")});p.session.baseRom="BW2";p.session.baseVersion="W2";
    const estimate=getPmcMemoryEstimate(p);
    expect(estimate.battle.modules).toContain("patches/Graphics.dll");
    expect(estimate.overworld.modules).not.toContain("patches/Graphics.dll");
    expect(estimate.battle.modules).toContain("patches/Summary.dll");
    expect(estimate.conservative).toContain("patches/Summary.dll");
  });
  it("counts code exactly once and includes expanded BSS, link retention and allocator headers",()=>{
    const bytes=dll(),m=estimateRpmMemory(bytes),header=readU32(bytes,8),info=header+readU32(bytes,header+8),relocation=header+readU32(bytes,info+8);
    expect(m.loadBytes).toBe(readU32(bytes,4));
    expect(m.loadBytes).toBeLessThan(bytes.length+m.codeBytes+m.bssBytes);
    expect(m.residentBytes).toBe(header+readU32(bytes,relocation+8)+1500);
    expect(m.residentAllocationBytes).toBe(Math.ceil(m.residentBytes/8)*8+16);
    expect(m.loadAllocationBytes).toBeGreaterThan(m.residentAllocationBytes);
  });
  it("keeps the full allocation when there is no relocation tail to discard",()=>{
    const bytes=writeRpm({code:new Uint8Array(64),bssSize:32,baseAddress:0,symbols:[],relocations:[],metadata:{}},{ident:"DLXF"});
    const m=estimateRpmMemory(bytes);expect(m.residentBytes).toBe(m.loadBytes);
  });
  it("rejects malformed table counts before walking arbitrary DLL data",()=>{
    const bytes=dll(),header=readU32(bytes,8),info=header+readU32(bytes,header+8),symbols=header+readU32(bytes,info+4);
    writeU32(bytes,symbols+20,0xffffffff);expect(()=>estimateRpmMemory(bytes)).toThrow("Invalid DLL section bounds");
    expect(()=>estimateRpmMemory(new Uint8Array(10))).toThrow();
  });
  it("separates battle/field scopes, retains common modules and follows load order",()=>{
    const a=dll("93"),b=dll("95"),common=dll("ARM9",0,0),field=dll("21");
    const estimate=getPmcMemoryEstimate(project({"patches/A.dll":a,"patches/B.dll":b,"patches/Common.dll":common,"patches/Field.dll":field}));
    const ma=estimateRpmMemory(a),mb=estimateRpmMemory(b),mc=estimateRpmMemory(common),mf=estimateRpmMemory(field);
    expect(estimate.battle.modules).toEqual(["patches/Common.dll","patches/A.dll","patches/B.dll"]);
    expect(estimate.overworld.modules).toEqual(["patches/Common.dll","patches/Field.dll"]);
    expect(estimate.battle.residentBytes).toBe(PMC_BASE_ALLOCATION_BYTES+mc.residentAllocationBytes+ma.residentAllocationBytes+mb.residentAllocationBytes);
    expect(estimate.overworld.residentBytes).toBe(PMC_BASE_ALLOCATION_BYTES+mc.residentAllocationBytes+mf.residentAllocationBytes);
    expect(estimate.battle.loadingPeakBytes).toBeGreaterThanOrEqual(estimate.battle.residentBytes);
    expect(estimate.capBytes).toBe(160*1024);
  });
  it("does not hide unknown modules, missing data or staged updates",()=>{
    const p=project({"patches/Other.dll":dll("200"),"patches/Bad.dll":new Uint8Array(10)},"13.2.4-heap200");
    const before=getPmcMemoryEstimate(p);expect(before.capBytes).toBe(200*1024);expect(before.unknown).toEqual(["patches/Bad.dll"]);expect(before.battle.modules).toContain("patches/Other.dll");expect(before.overworld.modules).toContain("patches/Other.dll");
    p.fileSystem!.additions!["patches/Other.dll"]=dll("93",5000);
    const after=getPmcMemoryEstimate(p);expect(after.battle.residentBytes).toBeGreaterThan(before.battle.residentBytes);expect(after.overworld.modules).not.toContain("patches/Other.dll");
  });
  it("shows two accessible estimates with cap and uncertainty labels",()=>{
    const estimate=getPmcMemoryEstimate(project({"patches/Other.dll":dll("200")}));
    const html=renderPmcCapacity(estimate,true);expect(html.match(/role="meter"/gu)).toHaveLength(2);
    expect(html).toContain("BW1 can allocate less than this cap");expect(html).toContain("Loading peak");expect(html).toContain("Unclassified DLLs");
    expect(pmcAllocatedBytes(1)).toBe(24);
  });
});
