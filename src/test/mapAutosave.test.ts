import { readFileSync } from 'node:fs';
import { afterEach,describe,expect,it,vi } from 'vitest';
import manifest from '../../runtime/autosave/manifest.json';
import { installAutosave } from '../../runtime/autosave/install';
import { NintendoDSRom } from '../nds/rom';
import { Folder } from '../nds/fnt';
import { writeU32 } from '../nds/binary';
import { exportModifiedRom } from '../pokeweb/exportRom';
import { detectPmcInstallFromRom,listCodeInjectionDlls,stageCodeInjectionDll } from '../pokeweb/pmcModel';
import { parseRpm,writeRpm } from '../pokeweb/rpm';
import type { ProjectState } from '../pokeweb/projectStore';
afterEach(()=>vi.unstubAllGlobals());
function fixture(game:'B2'|'W2',source?:Uint8Array):ProjectState{
 if(!source){
  const r=new NintendoDSRom(new Uint8Array(0x200));r.data.set(new TextEncoder().encode(manifest.games[game].idCode),12);r.arm9RamAddress=0x02004000;writeU32(r.data,0x28,r.arm9RamAddress);r.arm9=new Uint8Array(0x1c0000);
  r.files=Array.from({length:344},()=>new Uint8Array(4));r.filenames=new Folder();r.arm9OverlayTable=new Uint8Array(344*32);
  for(let id=0;id<344;id++){writeU32(r.arm9OverlayTable,id*32,id);writeU32(r.arm9OverlayTable,id*32+24,id);}
  for(const mod of [12,36]){
   const signatures=manifest.games[game].signatures.filter(s=>s.module===String(mod)),base=Math.min(...signatures.map(s=>s.address))&~255;
   r.files[mod]=new Uint8Array(Math.max(...signatures.map(s=>s.address+s.expectedHex.length/2))-base);
   writeU32(r.arm9OverlayTable,mod*32+4,base);writeU32(r.arm9OverlayTable,mod*32+8,r.files[mod].length);
   for(const s of signatures)r.files[mod].set(Buffer.from(s.expectedHex,'hex'),s.address-base);
  }
  for(const s of manifest.games[game].signatures.filter(s=>s.module==='ARM9'))r.arm9.set(Buffer.from(s.expectedHex,'hex'),s.address-r.arm9RamAddress);
  source=r.save();
 }
 const r=new NintendoDSRom(source);
 return {originalRomBytes:source,arm9:r.arm9,overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],session:{romName:'test',baseRom:'BW2',baseVersion:game,fairy:false,fileIds:{},blacklist:[]},romInfo:{title:'test',idCode:r.idCode,fileName:'test.nds',size:source.length},codeInjection:detectPmcInstallFromRom(r)};
}
function assets(){vi.stubGlobal('fetch',vi.fn(async(input:URL)=>new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${input.pathname.split('/').pop()}`,import.meta.url))))));}
describe.each(['B2','W2']as const)('Map autosave MVP %s',game=>{
 it('installs PMC automatically, is idempotent, and survives export/reopening',async()=>{
  assets();const p=fixture(game),before=new NintendoDSRom(p.originalRomBytes!).loadArm9Overlays([36]).get(36)!.data.slice();
  await installAutosave(p);await installAutosave(p);
  expect(listCodeInjectionDlls(p).filter(d=>d.fileName===manifest.games[game].fileName)).toHaveLength(1);
  const bytes=await exportModifiedRom(p),r=new NintendoDSRom(bytes);
  expect(r.loadArm9Overlays([36]).get(36)!.data).toEqual(before);
  const reopened=fixture(game,bytes);await installAutosave(reopened);
  expect(listCodeInjectionDlls(reopened).filter(d=>d.fileName===manifest.games[game].fileName)).toHaveLength(1);
 });
 it('rejects altered native hooks before staging anything',async()=>{
  const p=fixture(game),s=manifest.games[game].signatures.find(s=>s.patchSize&&s.module==='ARM9')!;p.arm9[s.address-0x2004000]^=1;
  await expect(installAutosave(p)).rejects.toThrow('differs');expect(p.fileSystem).toBeUndefined();
 });
 it('rejects another DLL claiming a hook while preserving the existing installation',async()=>{
  assets();const p=fixture(game);await installAutosave(p);
  const dll=new Uint8Array(readFileSync(new URL(`../../runtime/autosave/artifacts/${manifest.games[game].fileName}`,import.meta.url)));
  stageCodeInjectionDll(p,'Conflict.dll',dll);const before=structuredClone(p.fileSystem);
  await expect(installAutosave(p)).rejects.toThrow('conflicts');expect(p.fileSystem).toEqual(before);
 });
 it('upgrades the recognized one-step build without duplicating its runtime',async()=>{
  assets();const p=fixture(game);await installAutosave(p);
  const old=new Uint8Array(readFileSync(new URL(`../../runtime/autosave/previous/0.1.0-test/${manifest.games[game].fileName}`,import.meta.url)));
  stageCodeInjectionDll(p,manifest.games[game].fileName,old);
  const exported=await exportModifiedRom(p),reopened=fixture(game,exported);
  await installAutosave(reopened);
  const r=new NintendoDSRom(await exportModifiedRom(reopened));
  expect(r.getFileByName(`patches/${manifest.games[game].fileName}`)).toEqual(new Uint8Array(readFileSync(new URL(`../../runtime/autosave/artifacts/${manifest.games[game].fileName}`,import.meta.url))));
  expect(listCodeInjectionDlls(reopened).filter(d=>d.fileName===manifest.games[game].fileName)).toHaveLength(1);
 });
 it('rejects an unrecognized same-name module',async()=>{
  assets();const p=fixture(game);await installAutosave(p);
  const dll=new Uint8Array(readFileSync(new URL(`../../runtime/autosave/artifacts/${manifest.games[game].fileName}`,import.meta.url))),rpm=parseRpm(dll,{allowedMagics:['DLXF']});rpm.code[0]^=1;
  stageCodeInjectionDll(p,manifest.games[game].fileName,writeRpm(rpm,{ident:"DLXF"}));
  await expect(installAutosave(p)).rejects.toThrow('Unknown existing');
 });
});
