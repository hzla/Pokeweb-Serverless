import {NintendoDSRom} from "../nds/rom";
import {getPmcHeapExpansionStatus,listCodeInjectionDlls} from "./pmcModel";
import type {ProjectState} from "./projectStore";
import {estimateRpmMemory,type RpmMemoryEstimate} from "./rpmMemory";

// Initial allocator block, HeapArea object and the 4 KiB PMC work arena.
export const PMC_BASE_ALLOCATION_BYTES=4176;
export type PmcPhaseMemory={residentBytes:number;loadingPeakBytes:number;modules:string[]};
export type PmcMemoryEstimate={capBytes:number;battle:PmcPhaseMemory;overworld:PmcPhaseMemory;modules:Array<RpmMemoryEstimate&{path:string;scope:"resident"|"battle"|"overworld"|"uncertain";order:number}>;unknown:string[];issues:Record<string,string>;conservative:string[]};
const roms=new WeakMap<ProjectState,{bytes:Uint8Array;rom:NintendoDSRom}>();
const estimates=new WeakMap<Uint8Array,RpmMemoryEstimate>();
function sourceRom(project:ProjectState):NintendoDSRom|undefined {
  const bytes=project.originalRomBytes;if(!bytes)return;
  let cached=roms.get(project);if(cached?.bytes!==bytes){cached={bytes,rom:new NintendoDSRom(bytes,{fileData:"view"})};roms.set(project,cached);}return cached.rom;
}
export function getPmcMemoryEstimate(project:ProjectState):PmcMemoryEstimate {
  const rom=sourceRom(project),modules:PmcMemoryEstimate["modules"]=[],unknown:string[]=[],conservative:string[]=[],issues:Record<string,string>={};
  const battle=new Set(project.session.baseRom==="BW"?[93,95]:[167,169]);
  const field=new Set(project.session.baseRom==="BW"?[21]:[36]);
  for(const entry of listCodeInjectionDlls(project)){
    try{
      const id=rom?.filenames.idOf(entry.path);
      const bytes=project.fileSystem?.additions?.[entry.path]??(id===undefined?undefined:project.fileSystem?.replacements?.[id]??rom!.files[id]);
      if(!bytes)throw Error("Missing DLL");
      if(bytes.length===4&&["PWAR","PWMR"].includes(new TextDecoder().decode(bytes)))continue;
      let estimate=estimates.get(bytes);if(!estimate){estimate=estimateRpmMemory(bytes);estimates.set(bytes,estimate);}
      const overlays=estimate.overlays;
      const resident=!overlays.length||overlays.some(id=>["ARM9","ARM7","0"].includes(id));
      const scope=resident?"resident":overlays.every(id=>battle.has(Number(id)))?"battle":overlays.every(id=>field.has(Number(id)))?"overworld":"uncertain";
      if(scope==="uncertain"||entry.target==="lib")conservative.push(entry.path);
      modules.push({...estimate,path:entry.path,order:id??(rom?.files.length??0)+Object.keys(project.fileSystem?.additions??{}).sort().indexOf(entry.path),scope:entry.target==="lib"?"uncertain":scope});
    }catch(error){unknown.push(entry.path);issues[entry.path]=error instanceof Error?error.message:String(error);}
  }
  // Preserve the loader's priority and NitroFS order, including staged additions.
  modules.sort((a,b)=>a.priority-b.priority||a.order-b.order);
  const phase=(name:"battle"|"overworld"):PmcPhaseMemory=>{
    const selected=modules.filter(m=>m.scope==="resident"||m.scope==="uncertain"||m.scope===name);
    const residentBytes=PMC_BASE_ALLOCATION_BYTES+selected.reduce((n,m)=>n+m.residentAllocationBytes,0);
    // Common modules are already resident before either phase starts. Unknown
    // lifetimes are conservatively treated as common rather than omitted.
    const common=selected.filter(m=>m.scope==="resident"||m.scope==="uncertain");
    let loaded=PMC_BASE_ALLOCATION_BYTES+common.reduce((n,m)=>n+m.residentAllocationBytes,0);
    let loadingPeakBytes=loaded+Math.max(0,...common.map(m=>m.loadAllocationBytes-m.residentAllocationBytes));
    for(const module of selected.filter(m=>m.scope===name)){loadingPeakBytes=Math.max(loadingPeakBytes,loaded+module.loadAllocationBytes);loaded+=module.residentAllocationBytes;}
    // Startup scans every patch DLL, including patches inactive in this phase.
    // Resident modules can remain expanded until the scan has finished.
    const residentLoads=modules.filter(m=>m.scope==="resident").reduce((n,m)=>n+m.loadAllocationBytes,0);
    const startupPeak=PMC_BASE_ALLOCATION_BYTES+residentLoads+Math.max(0,...modules.filter(m=>m.scope!=="resident").map(m=>m.loadAllocationBytes));
    return {residentBytes,loadingPeakBytes:Math.max(loadingPeakBytes,startupPeak),modules:selected.map(m=>m.path)};
  };
  return {capBytes:(getPmcHeapExpansionStatus(project).expanded?200:160)*1024,battle:phase("battle"),overworld:phase("overworld"),modules,unknown,issues,conservative};
}
