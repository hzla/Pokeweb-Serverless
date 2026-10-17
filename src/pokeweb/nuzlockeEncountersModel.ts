import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readU16,readU32,writeU16,writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { parseRpm,type RpmModule } from "./rpm";
import { addRomFile,getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls,stageCodeInjectionDll } from "./pmcModel";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getPokenavStatus,installPokenav,disablePokenav } from "./pokenavModel";
import { getCGearQuickActionsStatus,disableCGearQuickActions } from "./cgearQuickActionsModel";
import { recordGenericChange } from "./actionChangelog";
import type { ProjectState } from "./projectStore";
import manifest from "../assets/codeinjection/nuzlockeEncountersManifest.json";

export const NUZLOCKE_ENCOUNTERS_VERSION=manifest.version;
export const NUZLOCKE_ENCOUNTERS_ARCHIVE="nuzlocke/encounters.narc";
type Version="B2"|"W2";
const urls={B2:new URL("../assets/codeinjection/NuzlockeStyleEncountersB2.dll",import.meta.url),W2:new URL("../assets/codeinjection/NuzlockeStyleEncountersW2.dll",import.meta.url)};
const hex=(data:Uint8Array)=>Array.from(data,b=>b.toString(16).padStart(2,"0")).join("");
function bytes(project:ProjectState,rom:NintendoDSRom|undefined,path:string){
  const added=Object.keys(project.fileSystem?.additions??{}).find(p=>p.toLowerCase()===path.toLowerCase());
  if(added)return project.fileSystem!.additions![added];
  const id=rom?.filenames.idOf(path);return rom&&id!==undefined?getRomFileBytes(project,rom,id):undefined;
}
export function nuzlockeEncountersArchive(enabled:boolean,allowExhausted=false):Uint8Array{
  const h=new Uint8Array(20);writeU32(h,0,0x455a554e);writeU16(h,4,1);writeU16(h,6,20);
  writeU32(h,8,Number(enabled));writeU32(h,12,Number(!allowExhausted));writeU32(h,16,(Number(enabled)^Number(!allowExhausted)^0xffffffff)>>>0);
  const a=new NARC();a.files=[h,new TextEncoder().encode(JSON.stringify({version:NUZLOCKE_ENCOUNTERS_VERSION}))];return a.save();
}
export function readNuzlockeEncountersArchive(data:Uint8Array){
  const a=new NARC(data),h=a.files[0];
  if(a.files.length!==2||!h||h.length!==20||readU32(h,0)!==0x455a554e||readU16(h,4)!==1||readU16(h,6)!==20
    ||readU32(h,8)>1||readU32(h,12)>1||readU32(h,16)!==((readU32(h,8)^readU32(h,12)^0xffffffff)>>>0))throw new Error("Unrecognized Nuzlocke Style Encounters configuration.");
  const metadata=JSON.parse(new TextDecoder().decode(a.files[1]));if(typeof metadata.version!=="string")throw new Error("Invalid Nuzlocke version metadata.");
  return {enabled:Boolean(readU32(h,8)),allowExhausted:!readU32(h,12),version:metadata.version as string};
}
export function isNuzlockeEncountersModule(rpm:RpmModule,version:Version){
  const p=manifest.games[version],types=["NULL","VALUE","FUNCTION_ARM","FUNCTION_THM","SECTION"];
  return rpm.metadata.PMCGameID===version&&rpm.metadata.PMCModulePriority===4&&rpm.metadata.PMCVersion===manifest.version
    &&rpm.baseAddress===0&&rpm.bssSize===p.bss&&hex(rpm.code)===p.codeHex&&!rpm.symbols.some(s=>s.attributes&2)
    &&JSON.stringify(rpm.relocations.map(({target:t,sourceSymbolIndex:i})=>{const s=rpm.symbols[i];return `${t.module}:${t.address.toString(16)}:${t.type}:${s.address.toString(16)}:${types.indexOf(s.type)}:${s.attributes}`;}).sort())===JSON.stringify(p.relocations);
}
export function getNuzlockeEncountersStatus(project:ProjectState){
  const state={supported:false,compatible:false,installed:false,enabled:false,allowExhausted:false,updateAvailable:false,message:"Requires English US revision-0 Black 2 or White 2."};
  const v=project.session.baseVersion;if(project.session.baseRom!=="BW2"||(v!=="B2"&&v!=="W2"))return state;
  const p=manifest.games[v];let rom:NintendoDSRom|undefined;
  try{if(project.originalRomBytes)rom=new NintendoDSRom(project.originalRomBytes,{fileData:"view"});}catch{return state;}
  if((rom?.idCode??project.romInfo.idCode)!==p.idCode||(project.originalRomBytes&&project.originalRomBytes[0x1e]!==0))return state;
  state.supported=true;
  try{
    const config=bytes(project,rom,NUZLOCKE_ENCOUNTERS_ARCHIVE);
    if(config){const c=readNuzlockeEncountersArchive(config);state.enabled=c.enabled;state.allowExhausted=c.allowExhausted;state.updateAvailable=c.version!==manifest.version;}
    let matches=0;
    for(const entry of listCodeInjectionDlls(project)){
      const raw=bytes(project,rom,entry.path);let rpm:RpmModule|undefined;
      try{if(raw)rpm=parseRpm(raw,{allowedMagics:["DLXF"]});}catch{/* Reserved names and overlapping modules are rejected below. */}
      if(rpm&&isNuzlockeEncountersModule(rpm,v)){
        if(entry.target!=="patches"||entry.fileName!==p.fileName)throw new Error("Restore the standard Nuzlocke DLL filename in patches before updating.");
        ++matches;continue;
      }
      if(entry.fileName===p.fileName||(rpm&&rpm.relocations.some(({target:t,sourceSymbolIndex:i})=>{
        const size=t.type==="FULL_COPY"?rpm!.symbols[i]?.size??0:t.type==="THUMB_BRANCH_SAFESTACK"?16:t.type==="THUMB_BRANCH"?12:4;
        return p.hooks.some(h=>h.module===t.module&&t.address<h.address+h.patchSize&&t.address+size>h.address);
      })))throw new Error(`Conflicting encounter module: ${entry.path}.`);
    }
    if(matches>1)throw new Error("Remove the duplicate Nuzlocke DLL before updating.");
    state.installed=matches===1;state.updateAvailable||=Boolean(config)&&!state.installed;
    if(!rom)return {...state,message:"Reload the ROM to verify native encounter and save interfaces."};
    const overlays=loadOverlayTable(project.patches?.arm9OverlayTable??rom.arm9OverlayTable,(_,id)=>getRomFileBytes(project,rom!,id),new Set([36]));
    const arm=decompressCode(project.arm9??rom.arm9);
    for(const s of p.signatures){
      const o=overlays.get(Number(s.module)),base=s.module==="ARM9"?rom.arm9RamAddress:o?.ramAddress;
      const candidates=s.module==="ARM9"?[arm]:[o?.data,project.overlays[Number(s.module)]??o?.data];
      const at=base===undefined?-1:s.address-base;
      if(candidates.some(b=>!b||at<0||hex(b.subarray(at,at+s.expectedHex.length/2))!==s.expectedHex))throw new Error(`Unrecognized ${s.label} at 0x${s.address.toString(16)}.`);
    }
    state.compatible=true;
    state.message=state.enabled&&state.installed?"Enabled. Caught evolution families are excluded from wild tables; Pokenav marks them gray."
      :state.installed?"Disabled. Caught records and encounter data are unchanged.":"Ready. Uses evolution families from this ROM and the save's caught records. Pokenav is optional.";
    return state;
  }catch(error){return {...state,compatible:false,message:error instanceof Error?error.message:String(error)};}
}
function stage(project:ProjectState,enabled:boolean,allowExhausted:boolean){
  const rom=new NintendoDSRom(project.originalRomBytes!,{fileData:"view"}),data=nuzlockeEncountersArchive(enabled,allowExhausted),id=rom.filenames.idOf(NUZLOCKE_ENCOUNTERS_ARCHIVE);
  if(id===undefined)addRomFile(project,NUZLOCKE_ENCOUNTERS_ARCHIVE,data);
  else{project.fileSystem??={replacements:{}};project.fileSystem.replacements[id]=data;}
}
export async function installNuzlockeEncounters(project:ProjectState,options:{allowExhausted?:boolean}={}){
  await installCodeInjectionPatch(project,async staged=>{
    const status=getNuzlockeEncountersStatus(staged);if(!status.compatible)throw new Error(status.message);
    const v=staged.session.baseVersion as Version,response=await fetch(urls[v]);if(!response.ok)throw new Error(`Could not load Nuzlocke Style Encounters (${response.status}).`);
    const data=new Uint8Array(await response.arrayBuffer());
    if(!isNuzlockeEncountersModule(parseRpm(data,{allowedMagics:["DLXF"]}),v))throw new Error("Nuzlocke bundle failed its integrity check.");
    stageCodeInjectionDll(staged,manifest.games[v].fileName,data);
    stage(staged,true,options.allowExhausted??status.allowExhausted);
    const nav=getPokenavStatus(staged);
    if(nav.installed){
      const quick=getCGearQuickActionsStatus(staged);
      await installPokenav(staged);
      if(!nav.enabled)await disablePokenav(staged);
      if(quick.installed&&!quick.enabled)disableCGearQuickActions(staged);
    }
    recordGenericChange(staged,"code_injection","Nuzlocke Style Encounters installed: caught families excluded and Pokenav dupes shaded gray.","Nuzlocke Style Encounters",{key:"code-injection:nuzlocke-encounters"});
  });
}
export async function disableNuzlockeEncounters(project:ProjectState){
  await installCodeInjectionPatch(project,staged=>{
    const status=getNuzlockeEncountersStatus(staged);if(!status.compatible||!status.installed)throw new Error(status.message);
    stage(staged,false,status.allowExhausted);
    recordGenericChange(staged,"code_injection","Nuzlocke Style Encounters disabled; native encounter tables restored at runtime.","Nuzlocke Style Encounters",{key:"code-injection:nuzlocke-encounters"});
  });
}
