import manifest from "../assets/codeinjection/cgearQuickActionsBw1Manifest.json";
import { compile, fingerprint } from "../cgearButtons/compiler";
import { readU16 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { buttonAssets, disableButtonArchive, ensureCGearButtons, hydrateCGearButtons, privateArchive, stageButtonArchive, validateButtonArchive } from "./cgearButtonsModel";
import type { CGearQuickActionsOptions, CGearQuickActionsStatus } from "./cgearQuickActionsModel";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installPmcBytes, listCodeInjectionDlls, loadBundledPmcBytes, removeStagedCodeInjectionDll, stageCodeInjectionDll, type CodeInjectionDllInstallResult } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
type Version="B"|"W";
export const CGEAR_QUICK_ACTIONS_BW1_VERSION=manifest.version;
type Profile=typeof manifest.games.B;
const urls={B:new URL("../assets/codeinjection/CGearQuickActionsB.dll",import.meta.url),W:new URL("../assets/codeinjection/CGearQuickActionsW.dll",import.meta.url)};
const archiveUrl=new URL("../assets/codeinjection/cgearQuickActionsBw1.narc",import.meta.url);
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const hash=async(bytes:Uint8Array)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes))));
const fnv=(bytes:Uint8Array)=>fingerprint(bytes).toString(16).padStart(8,"0");
function dllBytes(project:ProjectState,rom:NintendoDSRom|undefined,path:string):Uint8Array|undefined{
 const added=Object.keys(project.fileSystem?.additions??{}).find(p=>p.toLowerCase()===path.toLowerCase());
 if(added)return project.fileSystem!.additions![added];
 const id=rom?.filenames.idOf(path);return id===undefined?undefined:getRomFileBytes(project,rom!,id);
}
function recognized(rpm:RpmModule,version:Version):boolean{
 const current=manifest.games[version],older=manifest.previousVersions[rpm.metadata.PMCVersion as keyof typeof manifest.previousVersions];
 const p=rpm.metadata.PMCVersion===manifest.version?current:older?.games[version];
 if(!p||rpm.baseAddress||rpm.metadata.PMCGameID!==version||rpm.metadata.PMCModulePriority!==4
  ||rpm.bssSize!==p.bssSize||fnv(rpm.code)!==p.codeFingerprint||rpm.symbols.some(s=>s.attributes&2))return false;
 const hooks=older?.games[version].hooks??current.signatures.filter(s=>s.patchSize).map(s=>({module:s.module,address:s.address,type:["QaInput","QaGearUnit","QaGearEnd","QaRepelStep","QaRepelDepleted","QaPhenomenonInterval","QaPhenomenonChance"].includes(s.label)?"THUMB_BRANCH_LINK":"FULL_COPY"}));
 const expected=hooks.map(s=>`${s.module}:${s.address}:${s.type}`).sort();
 const actual=rpm.relocations.filter(r=>r.target.module!=="base").map(r=>`${r.target.module}:${r.target.address}:${r.target.type}`).sort();
 return expected.join("|")===actual.join("|");
}
function conflicts(rpm:RpmModule,profile:Profile):boolean{
 return rpm.relocations.some(({target,sourceSymbolIndex})=>{
  const size=target.type==="FULL_COPY"?rpm.symbols[sourceSymbolIndex]?.size??0:target.type==="THUMB_BRANCH_SAFESTACK"?16:target.type==="THUMB_BRANCH"?12:4;
  return profile.signatures.some(s=>s.module===target.module&&target.address<s.address+s.expectedHex.length/2&&target.address+size>s.address);
 });
}
export function getBw1CGearStatus(project:ProjectState):CGearQuickActionsStatus{
 const state:CGearQuickActionsStatus={supported:false,compatible:false,installed:false,enabled:false,pmcInstalled:getPmcInstallStatus(project).installed,updateAvailable:false,canRemove:false,pcHideFlag:1517,message:"C-Gear Quick Actions supports US revision-0 Black and White."};
 const v=project.session.baseVersion;if(project.session.baseRom!=="BW"||(v!=="B"&&v!=="W"))return state;
 let rom:NintendoDSRom|undefined;
 try{if(project.originalRomBytes)rom=new NintendoDSRom(project.originalRomBytes,{fileData:"view"});}catch{return {...state,message:"Reload the ROM to check C-Gear compatibility."};}
 const profile=manifest.games[v];if((rom?.idCode??project.romInfo.idCode)!==profile.idCode||(rom&&rom.data[0x1e]!==0))return state;
 state.supported=true;const owned:string[]=[];let older=false;
 for(const entry of listCodeInjectionDlls(project)){
  let rpm:RpmModule|undefined;try{const bytes=dllBytes(project,rom,entry.path);if(bytes)rpm=parseRpm(bytes,{allowedMagics:["DLXF"]});}catch{/* Detect an unrecognized named module below. */}
  if(entry.target==="patches"&&rpm&&recognized(rpm,v)){owned.push(entry.path);older=rpm.metadata.PMCVersion!==manifest.version;}
  else if(rpm&&conflicts(rpm,profile)||/^CGearQuickActions[WB](?:2)?\.dll$/iu.test(entry.fileName))return {...state,message:`Conflicting C-Gear, encounter, or field action code in ${entry.path}. Remove the conflicting module before installing.`};
 }
 state.installed=owned.length>0;state.dllPath=owned[0];state.updateAvailable=state.installed&&older;
 if(owned.length>1)return {...state,message:"Multiple C-Gear runtimes are present. Remove the duplicate before updating."};
 if(!rom)return {...state,message:"Reload the ROM to verify native C-Gear hooks."};
 const prior=privateArchive(project,rom);
 if(prior){try{
  if(![8,9].includes(readU16(new NARC(prior).files[0],4)))throw new Error("This private C-Gear archive belongs to another game profile.");
  state.enabled=validateButtonArchive(prior);hydrateCGearButtons(project,rom);
  state.pcHideFlag=ensureCGearButtons(project).document.buttons.find(b=>b.action==="pc")?.flag?.id??1517;
 }catch(e){return {...state,message:(e as Error).message};}
  if(!state.installed&&state.enabled)return {...state,message:"An enabled C-Gear archive has no matching runtime. Remove the orphan archive before installing."};
 }else if(state.installed)return {...state,message:"The C-Gear runtime's private archive is missing."};
 state.canRemove=!!state.dllPath&&canRemoveStagedCodeInjectionDll(project,state.dllPath)&&!!project.fileSystem?.additions?.[manifest.archivePath];
 try{
  const id=rom.filenames.idOf(profile.nativeArchive);
  if(id===undefined||fnv(new NARC(getRomFileBytes(project,rom,id)).save())!==profile.nativeGraphicsFingerprint)throw new Error("BW1 requires compatible native C-Gear graphics. Restore the default graphics before installing.");
  const overlays=loadOverlayTable(project.patches?.arm9OverlayTable??rom.arm9OverlayTable,(_id,file)=>getRomFileBytes(project,rom!,file),new Set([10,21,29]));
  const arm=project.arm9.length?project.arm9:decompressCode(rom.arm9);
  for(const s of profile.signatures){
   const o=overlays.get(Number(s.module)),base=s.module==="ARM9"?rom.arm9RamAddress:o?.ramAddress;
   const buffers=s.module==="ARM9"?[arm]:[o?.data,project.overlays[Number(s.module)]??o?.data],offset=base===undefined?-1:s.address-base;
   if(buffers.some(b=>!b||offset<0||hex(b.subarray(offset,offset+s.expectedHex.length/2))!==s.expectedHex))throw new Error(`Unrecognized ${s.label} code in ${s.module==="ARM9"?"ARM9":`overlay ${s.module}`} at 0x${s.address.toString(16)}.`);
  }
 }catch(e){return {...state,message:(e as Error).message};}
 state.compatible=true;state.message=state.installed?(state.enabled?"C-Gear buttons are enabled. Native communication controls are removed.":"C-Gear buttons are disabled; saved preferences remain dormant."):"Native BW1 hooks match. Uses the default C-Gear background and replaces native communication controls.";
 return state;
}
export async function installBw1CGear(project:ProjectState,options:CGearQuickActionsOptions={}):Promise<CodeInjectionDllInstallResult>{
 const bytes=project.originalRomBytes??await loadActiveRomBytes();if(!bytes)throw new Error("Reload the ROM before installing C-Gear buttons.");
 const input={...project,originalRomBytes:bytes},status=getBw1CGearStatus(input);if(!status.supported||!status.compatible)throw new Error(status.message);
 const rom=new NintendoDSRom(bytes,{fileData:"view"});hydrateCGearButtons(project,rom);const state=structuredClone(ensureCGearButtons(project));
 if(options.pcHideFlag!==undefined){if(!Number.isInteger(options.pcHideFlag)||options.pcHideFlag<1||options.pcHideFlag>2911)throw new Error("PC hide flag must be from 1 to 2911.");const pc=state.document.buttons.find(b=>b.action==="pc");if(pc)pc.flag={id:options.pcHideFlag,when:"clear"};}
 const before=JSON.stringify(project.cgearButtons?.document);state.applied=structuredClone(state.document);state.enabled=true;
 const compiled=compile(state.document,buttonAssets(project,rom),true,state);if(!compiled.archive)throw new Error(compiled.diagnostics.filter(d=>d.severity==="error").map(d=>d.message).join("\n"));
 if(state.document.buttons.some(b=>b.action==="pc")){
  const p=manifest.pcScript,id=rom.filenames.idOf(p.archive),script=id===undefined?undefined:new NARC(getRomFileBytes(project,rom,id)).files[p.member];
  if(!script||script.length!==p.length||fnv(script)!==p.fingerprint)throw new Error("The native PC storage script has incompatible changes. Restore it or remove PC from the design.");
 }
 const v=project.session.baseVersion as Version,p=manifest.games[v];
 const [dllResponse,archiveResponse]=await Promise.all([fetch(urls[v]),fetch(archiveUrl)]);if(!dllResponse.ok||!archiveResponse.ok)throw new Error("Could not load the bundled BW1 C-Gear patch.");
 const [dll,archive]=await Promise.all([dllResponse.arrayBuffer().then(b=>new Uint8Array(b)),archiveResponse.arrayBuffer().then(b=>new Uint8Array(b))]);
 if(await hash(dll)!==p.sha256||await hash(archive)!==manifest.archiveSha256||!recognized(parseRpm(dll,{allowedMagics:["DLXF"]}),v)||!validateButtonArchive(archive))throw new Error("The bundled BW1 C-Gear patch failed its integrity check.");
 const staged={...input,arm9:project.arm9.slice(),overlays:Object.fromEntries(Object.entries(project.overlays).map(([id,b])=>[id,b?.slice()])),fileSystem:structuredClone(project.fileSystem),codeInjection:structuredClone(project.codeInjection),patches:structuredClone(project.patches),actionChangelog:structuredClone(project.actionChangelog)};
 adoptExistingPmcInstall(staged,bytes);if(!getPmcInstallStatus(staged).installed)installPmcBytes(staged,await loadBundledPmcBytes(v),bytes);
 const result=stageCodeInjectionDll(staged,status.dllPath?.split("/").pop()??p.fileName,dll,"patches",bytes);stageButtonArchive(staged,rom,compiled.archive);
 recordGenericChange(staged,"code_injection",`C-Gear Buttons applied: ${state.document.buttons.map(b=>b.label).join(", ")||"no buttons"}.`,"C-Gear Buttons",{key:"code-injection:cgear-quick-actions"});
 if(JSON.stringify(project.cgearButtons?.document)!==before)throw new Error("The button design changed while staging. Apply again.");
 project.cgearButtons=state;Object.assign(project,{originalRomBytes:bytes,arm9:staged.arm9,arm9Dirty:staged.arm9Dirty,overlays:staged.overlays,fileSystem:staged.fileSystem,codeInjection:staged.codeInjection,patches:staged.patches,actionChangelog:staged.actionChangelog});return result;
}
export function disableBw1CGear(project:ProjectState){
 const s=getBw1CGearStatus(project);if(!s.installed||!s.compatible||!project.originalRomBytes)throw new Error(s.message);
 const rom=new NintendoDSRom(project.originalRomBytes,{fileData:"view"}),prior=privateArchive(project,rom)!;
 stageButtonArchive(project,rom,disableButtonArchive(prior));if(project.cgearButtons)project.cgearButtons.enabled=false;
 recordGenericChange(project,"code_injection","C-Gear buttons disabled; saved preferences remain dormant.","C-Gear Buttons",{key:"code-injection:cgear-quick-actions"});
}
export function removeBw1CGear(project:ProjectState){
 const s=getBw1CGearStatus(project);if(!s.canRemove||!s.dllPath)throw new Error("Only a C-Gear patch staged in this project can be removed. Use Disable for an exported installation.");
 removeStagedCodeInjectionDll(project,s.dllPath);if(project.fileSystem?.additions?.[manifest.archivePath])delete project.fileSystem.additions[manifest.archivePath];
 if(project.cgearButtons){project.cgearButtons.enabled=false;project.cgearButtons.applied=undefined;}
 recordGenericChange(project,"code_injection","Staged C-Gear buttons removed.","C-Gear Buttons",{key:"code-injection:cgear-quick-actions"});
}
