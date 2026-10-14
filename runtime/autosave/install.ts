// Experimental local installer. No ROM or save is changed in place.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from './manifest.json';
import { NintendoDSRom } from '../../src/nds/rom';
import { decompressCode } from '../../src/nds/codeCompression';
import { getRomFileBytes } from '../../src/pokeweb/fileSystemModel';
import { parseRpm } from '../../src/pokeweb/rpm';
import { installBundledPmc, getPmcInstallStatus, listCodeInjectionDlls, stageCodeInjectionDll } from '../../src/pokeweb/pmcModel';
import type { ProjectState } from '../../src/pokeweb/projectStore';
export async function installAutosave(project: ProjectState) {
 const game=project.session.baseVersion;
 if(game!=='B2'&&game!=='W2')throw new Error('Autosave MVP requires US revision-0 B2/W2.');
 const bytes=project.originalRomBytes;if(!bytes)throw new Error('Reload the source ROM.');
 const rom=new NintendoDSRom(bytes,{fileData:'view'}),p=manifest.games[game];
 if(rom.idCode!==p.idCode||bytes[30]!==0)throw new Error('Unsupported language/revision.');
 const overlays=rom.loadArm9Overlays([12,36]);
 const arm=project.arm9.length?project.arm9:decompressCode(rom.arm9);
 for(const s of p.signatures){
  const ov=overlays.get(Number(s.module));const data=s.module==='ARM9'?arm:project.overlays[Number(s.module)]??ov!.data,base=s.module==='ARM9'?rom.arm9RamAddress:ov!.ramAddress;
  if(Buffer.from(data.subarray(s.address-base,s.address-base+s.expectedHex.length/2)).toString('hex')!==s.expectedHex)throw new Error(`Native ${s.module}:0x${s.address.toString(16)} differs.`);
 }
 const dll=new Uint8Array(await readFile(new URL(`./artifacts/${p.fileName}`,import.meta.url)));
 if(createHash('sha256').update(dll).digest('hex')!==p.sha256)throw new Error('Build integrity mismatch.');
 for(const entry of listCodeInjectionDlls(project)){
  const added=project.fileSystem?.additions?.[entry.path],id=rom.filenames.idOf(entry.path);
  const existing=added??(id===undefined?undefined:getRomFileBytes(project,rom,id));
  if(!existing)throw new Error(`Cannot verify ${entry.path}.`);
  if(entry.fileName===p.fileName){
   const hash=createHash('sha256').update(existing).digest('hex');
   if(hash!==p.sha256&&!manifest.previousVersions.some(v=>v.games[game].sha256===hash))throw new Error('Unknown existing autosave module.');
   continue;
  }
  const rpm=parseRpm(existing,{allowedMagics:['DLXF']});
  for(const {target,sourceSymbolIndex}of rpm.relocations){
   const size=target.type==='FULL_COPY'?rpm.symbols[sourceSymbolIndex]?.size??0:target.type==='THUMB_BRANCH_SAFESTACK'?16:target.type==='THUMB_BRANCH'?12:4;
   if(p.signatures.some(s=>s.patchSize&&s.module===target.module&&target.address<s.address+s.patchSize&&target.address+size>s.address))throw new Error(`Autosave hook conflicts with ${entry.path}.`);
  }
 }
 if(!getPmcInstallStatus(project).installed)await installBundledPmc(project);
 return stageCodeInjectionDll(project,p.fileName,dll);
}
