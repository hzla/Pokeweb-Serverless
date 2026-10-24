import manifest from '../assets/cutscenes/field-season-runtime.json';
import {NintendoDSRom} from '../nds/rom';
import {decompressCode} from '../nds/codeCompression';
import {NARC} from '../nds/narc';
import {getPmcInstallStatus,installBundledPmc,stageCodeInjectionDll} from './pmcModel';
import {loadActiveRomBytes} from './persistence';
import type {ProjectState} from './projectStore';

/** Reserve one explicit saved work value, without editing the supplied save. */
export async function fieldSeasonExportProject(project:ProjectState):Promise<ProjectState>{
  const romBytes=project.originalRomBytes??await loadActiveRomBytes();
  if(!romBytes)throw new Error('Load a White 2 ROM before exporting the season tour.');
  const rom=new NintendoDSRom(romBytes,{fileData:'view'}),arm=project.arm9.length?project.arm9:decompressCode(rom.arm9);
  for(const guard of manifest.guards)if(!guard.hex.match(/../g)!.every((v,i)=>arm[guard.address-rom.arm9RamAddress+i]===parseInt(v,16)))throw new Error('The native season/save calendar providers have changed.');
  const scripts=new NARC(rom.getFileByName('a/0/5/6'));
  for(const file of scripts.files)for(let i=0;i+1<file.length;i++)if(file[i]===(manifest.workId&255)&&file[i+1]===(manifest.workId>>>8))throw new Error('Saved work 0x41AE is already referenced by a map script. Choose a calendar work reservation before exporting.');
  const draft:ProjectState={...project,originalRomBytes:romBytes,arm9:project.arm9.slice(),overlays:Object.fromEntries(Object.entries(project.overlays).map(([id,b])=>[id,b?.slice()])),fileSystem:{replacements:{...project.fileSystem?.replacements},additions:{...project.fileSystem?.additions},tombstones:{...project.fileSystem?.tombstones}},codeInjection:structuredClone(project.codeInjection),actionChangelog:structuredClone(project.actionChangelog)};
  if(!getPmcInstallStatus(draft).installed)await installBundledPmc(draft);
  const response=await fetch(new URL('../assets/cutscenes/FieldSeasonW2.dll',import.meta.url));if(!response.ok)throw new Error('The saved calendar adapter is unavailable.');
  stageCodeInjectionDll(draft,'FieldSeasonW2.dll',new Uint8Array(await response.arrayBuffer()),'patches',romBytes);
  return draft;
}
