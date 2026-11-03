import {readFileSync} from "node:fs";
import {afterEach,describe,expect,it,vi} from "vitest";
import {NintendoDSRom} from "../nds/rom";
import {writeU32} from "../nds/binary";
import {writeRpm} from "../pokeweb/rpm";
import {exportModifiedRom} from "../pokeweb/exportRom";
import {getSaveMenuStatus,uninstallSaveMenu,SAVE_MENU_SETTINGS_PATH,encodeSaveMenuSettings} from "../pokeweb/saveMenuModel";
import {listCodeInjectionDlls,stageCodeInjectionDll} from "../pokeweb/pmcModel";
import {renderCodeInjectionEditor} from "../ui/codeInjectionEditor";
import * as saveMenu from "../pokeweb/saveMenuModel";
import type {ProjectState} from "../pokeweb/projectStore";
import manifest from "../assets/codeinjection/save-menu-compatibility.json";

function fixture(version:"W2"|"B2",installed=true){
 const target=manifest.games[version],dll=new Uint8Array(readFileSync(new URL(`../assets/codeinjection/SaveMenu${version}.dll`,import.meta.url)));
 const map=new Uint8Array(readFileSync(new URL("../assets/codeinjection/save-menu-map.lz",import.meta.url)));
 const settings={music:"off"as const,bpm:150,stepsPerBeat:2 as const};
 const files=[{path:`patches/SaveMenu${version}.dll`,bytes:dll},{path:manifest.map.path,bytes:map},{path:SAVE_MENU_SETTINGS_PATH,bytes:encodeSaveMenuSettings(settings)},
  {path:"ui/save-menu/spin-index.bin",bytes:Uint8Array.of(1)},{path:"ui/save-menu/spin-art.narc",bytes:Uint8Array.of(2)}];
 const header=new Uint8Array(0x4000);header.set(new TextEncoder().encode(target.gameCode),12);
 let rom=new NintendoDSRom(header);rom.arm9=new Uint8Array(64);rom.arm9RamAddress=0x02000000;
 const following=`patches/PokewebFollowingField${version}.dll`;
 const inert=writeRpm({code:new Uint8Array(4),baseAddress:0,bssSize:0,metadata:{PMCVersion:"fixture"},symbols:[],relocations:[]},{ident:"DLXF"});
 rom=new NintendoDSRom(rom.save({addedFiles:[{path:"overlay/overlay_0162.bin",bytes:Uint8Array.from(target.hookBytes.match(/../g)!,b=>parseInt(b,16))},
  {path:following,bytes:inert},{path:"following/keep.bin",bytes:Uint8Array.of(77,88)},{path:"ui/streamed-music/library.json",bytes:new TextEncoder().encode("{}")},...(installed?files:[])].sort((a,b)=>a.path.localeCompare(b.path))}));
 const table=new Uint8Array(32);[162,target.hook,16,0,0,0,rom.fileId("overlay/overlay_0162.bin"),0].forEach((v,n)=>writeU32(table,n*4,v));
 const source=rom.save({arm9OverlayTable:table});rom=new NintendoDSRom(source);
 const project:ProjectState={originalRomBytes:source,session:{romName:"fixture",baseRom:"BW2",baseVersion:version,fairy:false,fileIds:{},blacklist:[]},
  romInfo:{title:"fixture",idCode:rom.idCode,fileName:"fixture.nds",size:source.length},arm9:rom.arm9.slice(),overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],codeInjection:{saveMenuSettings:settings}};
 if(!installed)project.fileSystem={replacements:{},additions:Object.fromEntries(files.map(f=>[f.path,f.bytes]))};
 return {project,rom,source,dll,following,files};
}
afterEach(()=>vi.restoreAllMocks());
describe("interactive save-menu removal",()=>{
 it.each(["W2","B2"]as const)("removes staged %s files without changing PMC, followers, music or native code",async version=>{
  const {project,source,following}=fixture(version,false);
  project.codeInjection!.pmc={overlayId:344,overlayPath:"overlay/overlay_0344.bin",version:"13.2.4",gameId:version};
  const before=structuredClone(project);expect(getSaveMenuStatus(project).canUninstall).toBe(true);
  await uninstallSaveMenu(project);
  expect(getSaveMenuStatus(project)).toMatchObject({installed:false,canUninstall:false,dependencyPresent:true});
  expect(project.codeInjection!.pmc).toEqual(before.codeInjection!.pmc);
  expect(project.originalRomBytes).toBe(source);expect(project.arm9).toEqual(before.arm9);expect(project.overlays).toEqual(before.overlays);
  expect(Object.keys(project.fileSystem!.additions!)).toEqual([]);
  expect(listCodeInjectionDlls(project).map(m=>m.path)).toEqual([following]);
  expect(project.codeInjection!.saveMenuSettings).toBeUndefined();
 });
 it.each(["W2","B2"]as const)("exports/reopens removal of an installed %s DLL without shifting unrelated file IDs",async version=>{
  const {project,rom,following,source,files}=fixture(version);
  const untouched=new Map(rom.files.map((data,id)=>[id,data]));for(const file of files)untouched.delete(rom.fileId(file.path));
  await uninstallSaveMenu(project);
  expect(listCodeInjectionDlls(project).map(m=>m.path)).toEqual([following]);
  const next=new NintendoDSRom(await exportModifiedRom(project,{forDsi:false}));
  expect(next.files.length).toBe(rom.files.length);expect(next.arm9).toEqual(rom.arm9);expect(next.arm9OverlayTable).toEqual(rom.arm9OverlayTable);
  for(const file of files){expect(next.filenames.idOf(file.path)).toBeUndefined();expect(next.files[rom.fileId(file.path)]).toHaveLength(0);}
  for(const[id,data]of untouched)expect(next.files[id]).toEqual(data);
  project.originalRomBytes=next.data;project.fileSystem=undefined;
  expect(getSaveMenuStatus(project)).toMatchObject({installed:false,dependencyPresent:true});
  expect(source).toEqual(rom.data);
 });
 it("can revive the same DLL slot before export without leaving a tombstone",async()=>{
  const {project,rom,dll}=fixture("W2");await uninstallSaveMenu(project);
  project.codeInjection!.pmc={overlayId:344,overlayPath:"overlay/overlay_0344.bin",version:"13.2.4",gameId:"W2"};
  stageCodeInjectionDll(project,"SaveMenuW2.dll",dll);
  expect(project.fileSystem!.tombstones![rom.fileId("patches/SaveMenuW2.dll")]).toBeUndefined();
  expect(listCodeInjectionDlls(project).filter(m=>m.path==="patches/SaveMenuW2.dll")).toHaveLength(1);
 });
 it.each(["DLL","native entry"])("rejects an altered %s without publishing partial removal",async damage=>{
  const {project,rom}=fixture("W2"),id=rom.fileId("patches/SaveMenuW2.dll");
  if(damage==="DLL"){const bytes=rom.files[id].slice();bytes[32]^=1;project.fileSystem={replacements:{[id]:bytes}};}
  else project.overlays[162]=new Uint8Array(16);
  const before=structuredClone(project);
  await expect(uninstallSaveMenu(project)).rejects.toThrow(/unrecognized|changed/);
  expect(project).toEqual(before);
 });
 it("does not require the follower or artwork dependencies to be intact to remove the menu",async()=>{
  const {project,rom,following}=fixture("W2");project.fileSystem={replacements:{[rom.fileId(following)]:new Uint8Array()},tombstones:{[rom.fileId(following)]:following}};
  expect(getSaveMenuStatus(project).dependencyPresent).toBe(false);await uninstallSaveMenu(project);
  expect(getSaveMenuStatus(project).installed).toBe(false);
 });
 it("shows a red enabled uninstall action for an existing installation",()=>{
  const {project}=fixture("W2"),root={innerHTML:"",querySelector:()=>null,querySelectorAll:()=>[]};
  renderCodeInjectionEditor(project,root as unknown as HTMLElement,()=>{});
  expect(root.innerHTML).toMatch(/class="btn -default -remove" id="uninstall-save-menu-btn"[^>]*>Uninstall Interactive Save Menu/);
  expect(root.innerHTML).not.toMatch(/id="uninstall-save-menu-btn"[^>]*disabled/);
 });
 it("runs removal through the dedicated button and reports that export/restart is needed",async()=>{
  const {project}=fixture("W2");let click:(event:Event)=>Promise<void>=async()=>{};
  const button={disabled:false,addEventListener:(_event:string,fn:typeof click)=>{click=fn;}},note={textContent:""};
  const root={innerHTML:"",querySelector:(selector:string)=>selector==="#uninstall-save-menu-btn"?button:selector==="#save-menu-note"?note:null,querySelectorAll:()=>[]};
  const remove=vi.spyOn(saveMenu,"uninstallSaveMenu").mockResolvedValue(),dirty=vi.fn();renderCodeInjectionEditor(project,root as unknown as HTMLElement,dirty);
  expect(remove).not.toHaveBeenCalled();await click({currentTarget:button}as unknown as Event);
  expect(remove).toHaveBeenCalledWith(project);expect(dirty).toHaveBeenCalledOnce();expect(note.textContent).toContain("Export and restart");
 });
});
