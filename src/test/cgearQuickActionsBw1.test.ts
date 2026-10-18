import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/cgearQuickActionsBw1Manifest.json";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { detectPmcInstallFromRom, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import { buttonAssets, ensureCGearButtons, hasUnappliedButtons, validateButtonArchive } from "../pokeweb/cgearButtonsModel";
import { actionsFor, newButton } from "../cgearButtons/document";
import { compile, preview } from "../cgearButtons/compiler";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { buttonFont, buttonItems } from "./cgearButtonsFixture";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { bw1PoseColours } from "../cgearButtons/bw1Graphics";
afterEach(()=>vi.unstubAllGlobals());
it("matches decoded BW1 OAM artwork across native shapes and appearance states",()=>{
 const bytes=new Uint8Array(readFileSync(new URL("../assets/codeinjection/cgearQuickActionsBw1.narc",import.meta.url))),arc=new NARC(bytes);
 const cells=arc.files[2].slice();writeU32(cells,32,16);
 // The general decoder paints later pieces on top; DS OAM gives earlier pieces
 // priority. Reverse each cell's records to compare the actual hardware order.
 for(let i=0;i<8;i++){const start=208+i*36,records=Array.from({length:6},(_,n)=>cells.slice(start+n*6,start+n*6+6)).reverse();records.forEach((r,n)=>cells.set(r,start+n*6));}
 for(let design=0;design<10;design++)for(let pose=0;pose<4;pose++)for(const index of [0,5,9]){
  const fixed=index===9,data=fixed?arc.files[16]:arc.files[4+index].slice();
  if(!fixed)data.set(arc.files[12].subarray(design*512,(design+1)*512));
  const chr=new Uint8Array(48+data.length);chr.set(new TextEncoder().encode("RGCN"));chr.set(new TextEncoder().encode("RAHC"),16);writeU16(chr,12,16);writeU16(chr,14,1);writeU32(chr,20,chr.length-16);writeU32(chr,28,3);writeU32(chr,32,16);writeU32(chr,40,data.length);writeU32(chr,44,24);chr.set(data,48);
  const palette=arc.files[1].slice(),bank=fixed?8:index;
  const colours=bw1PoseColours(Uint16Array.from({length:16},(_,j)=>readU16(palette,40+bank*32+j*2)),pose);colours.forEach((c,j)=>writeU16(palette,40+bank*32+j*2,c));
  const decoded=parseNitroCellImage("bw1",chr,palette,cells,index,128);expect(decoded.warnings).toEqual([]);
  const image=preview(bytes,index,pose,design%5,0,Math.floor(design/5));
  const cropped=new Uint8ClampedArray(image.pixels.length),left=48,top=fixed?48:32;
  for(let y=0;y<image.height;y++)cropped.set(decoded.rgba.subarray(((y+top)*128+left)*4,((y+top)*128+left+image.width)*4),y*image.width*4);
  // Compare native five-bit channels; the shared decoder expands them with << 3.
  const difference=cropped.findIndex((c,i)=>i%4===3?c!==image.pixels[i]:(c>>3)!==(image.pixels[i]>>3));
  expect(difference,JSON.stringify({index,design,pose,difference})).toBe(-1);
 }
 expect(()=>preview(bytes,8)).toThrow(/no BW1 button/);
 const arrow=preview(bytes,9);expect([...arrow.pixels].filter((_,i)=>i%4===3&&arrow.pixels[i])).toHaveLength(18);
});
function assets(){vi.stubGlobal("fetch",vi.fn(async(input:URL)=>new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${input.pathname.split("/").pop()}`,import.meta.url))))));}
function project(game:"B"|"W",bytes?:Uint8Array):ProjectState{
 if(!bytes){
  const profile=manifest.games[game],rom=new NintendoDSRom(new Uint8Array(0x200));rom.data.set(new TextEncoder().encode(profile.idCode),12);
  rom.arm9RamAddress=0x2004000;writeU32(rom.data,0x28,rom.arm9RamAddress);rom.arm9=new Uint8Array(0xa0000);rom.arm7=new Uint8Array(4);
  rom.files=Array.from({length:237},()=>new Uint8Array(4));rom.filenames=new Folder();rom.arm9OverlayTable=new Uint8Array(237*32);
  for(let id=0;id<237;id++){writeU32(rom.arm9OverlayTable,id*32,id);writeU32(rom.arm9OverlayTable,id*32+24,id);}
  for(const id of [10,21,29]){
   const rows=profile.signatures.filter(s=>s.module===String(id)),base=Math.min(...rows.map(s=>s.address))&~255;
   rom.files[id]=new Uint8Array(Math.max(...rows.map(s=>s.address+s.expectedHex.length/2))-base);
   writeU32(rom.arm9OverlayTable,id*32+4,base);writeU32(rom.arm9OverlayTable,id*32+8,rom.files[id].length);
   for(const row of rows)rom.files[id].set(Buffer.from(row.expectedHex,"hex"),row.address-base);
  }
  for(const row of profile.signatures.filter(s=>s.module==="ARM9"))rom.arm9.set(Buffer.from(row.expectedHex,"hex"),row.address-rom.arm9RamAddress);
  // Independent PMC bootstrap contract, unrelated to the C-Gear hooks.
  for(const [address,data]of [[0x200512a,"00f097f9"],[game==="B"?0x2034b7c:0x2034b94,"b81101eb"],[game==="B"?0x2034a50:0x2034a68,"181201eb"],[game==="B"?0x2078ea8:0x2078ec0,"ed000000"]]as const)rom.arm9.set(Buffer.from(data,"hex"),address-rom.arm9RamAddress);
  rom.arm9[(game==="B"?0x2078d77:0x2078d8f)-rom.arm9RamAddress]=10;
  const bundle=new NARC(new Uint8Array(readFileSync(new URL("../assets/codeinjection/cgearQuickActionsBw1.narc",import.meta.url))));
  const font=new NARC();font.files=[new Uint8Array(4),buttonFont()];
  const scripts=new NARC();scripts.files=Array.from({length:869},()=>new Uint8Array());scripts.files[868]=new Uint8Array(readFileSync(new URL("./fixtures/cgear-pc-bw1-script.bin",import.meta.url)));
  const files:[[string,Uint8Array],[string,Uint8Array],[string,Uint8Array],[string,Uint8Array]]=[["a/0/3/0",bundle.files[14]],["a/0/2/3",font.save()],["a/0/2/4",buttonItems().save()],["a/0/5/7",scripts.save()]];
  for(const [path,data]of files){const id=rom.files.length;rom.files.push(data);rom.filenames=addFilePath(rom.filenames,path,id);}
  bytes=rom.save({filenames:rom.filenames});
 }
 const rom=new NintendoDSRom(bytes);
 return {originalRomBytes:bytes,session:{baseRom:"BW",baseVersion:game,romName:"bw1-test.nds",fileIds:{},blacklist:[]},romInfo:{idCode:rom.idCode,fileName:"bw1-test.nds"},arm9:rom.arm9.slice(),overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],codeInjection:detectPmcInstallFromRom(rom)}as unknown as ProjectState;
}
describe.each(["B","W"]as const)("BW1 C-Gear %s",game=>{
 it("offers six defaults and only native BW1 action routes",()=>{
  const p=project(game),state=ensureCGearButtons(p);expect(state.document.buttons.map(b=>b.label)).toEqual(["REPEL","PC","BIKE","MAP","PARTY","BAG"]);
  expect(state.document.hideCommunicationButtons).toBe(true);expect(state.document.skins?.entries).toEqual([]);
  for(const id of ["xtransceiver","medals","splicers","revealGlass"])expect(actionsFor("BW").map(a=>a.id)).not.toContain(id);
  const data=compile(state.document,buttonAssets(p,new NintendoDSRom(p.originalRomBytes!)));expect(data.archive).toBeDefined();expect(validateButtonArchive(data.archive!)).toBe(true);
  for(const i of [0,1,2,3,4,5,9])expect(preview(data.archive!,i).pixels.some(v=>v)).toBe(true);
 });
 it("installs PMC and the matching runtime atomically, retaining native resources",async()=>{
  const p=project(game),rom=new NintendoDSRom(p.originalRomBytes!);assets();expect(getCGearQuickActionsStatus(p)).toMatchObject({supported:true,compatible:true,installed:false});
  await installCGearQuickActions(p);expect(getCGearQuickActionsStatus(p)).toMatchObject({installed:true,enabled:true,canRemove:true});
  expect(listCodeInjectionDlls(p).map(d=>d.fileName)).toContain(`CGearQuickActions${game}.dll`);
  expect(p.fileSystem!.replacements[rom.fileId("a/0/3/0")]).toBeUndefined();
  await installCGearQuickActions(p);expect(listCodeInjectionDlls(p).filter(d=>d.fileName.startsWith("CGearQuickActions"))).toHaveLength(1);
  disableCGearQuickActions(p);expect(getCGearQuickActionsStatus(p).enabled).toBe(false);
  removeCGearQuickActions(p);expect(getCGearQuickActionsStatus(p).installed).toBe(false);
 });
 it("exports an uninstalled draft and installs it after reopening",async()=>{
  const p=project(game);ensureCGearButtons(p).document.buttons[0].label="DRAFT";
  const reopened=project(game,await exportModifiedRom(p));
  expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:false,enabled:false,compatible:true});
  expect(reopened.cgearButtons!.document.buttons[0].label).toBe("DRAFT");
  expect(reopened.cgearButtons!.applied).toBeUndefined();
  assets();await installCGearQuickActions(reopened);
  expect(reopened.cgearButtons!.applied?.buttons[0].label).toBe("DRAFT");
 });
 it("recovers eight buttons, flags, IDs and an unapplied draft after export",async()=>{
  const p=project(game);assets();const doc=ensureCGearButtons(p).document;
  while(doc.buttons.length<8)doc.buttons.push(newButton(doc,"pokeradar"));doc.buttons[0].flag={id:2911,when:"set"};
  expect(compile(doc,buttonAssets(p,new NintendoDSRom(p.originalRomBytes!))).budget).toEqual({bytes:15680,capacity:16384,oam:63});
  await installCGearQuickActions(p,{pcHideFlag:0x5ec});const applied=structuredClone(p.cgearButtons!.applied);
  p.cgearButtons!.document.buttons[0].label="DRAFT";
  const reopened=project(game,await exportModifiedRom(p));expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:true,enabled:true,compatible:true,canRemove:false,pcHideFlag:0x5ec});
  expect(reopened.cgearButtons!.document.buttons[0].label).toBe("DRAFT");expect(reopened.cgearButtons!.applied).toEqual(applied);expect(hasUnappliedButtons(reopened)).toBe(true);
  disableCGearQuickActions(reopened);await installCGearQuickActions(reopened);expect(getCGearQuickActionsStatus(reopened).enabled).toBe(true);
 });
 it("rejects invalid flags, incompatible actions, visible communication controls and excess buttons",async()=>{
  const p=project(game);assets();await installCGearQuickActions(p);const state=p.cgearButtons!,before=structuredClone(p.fileSystem),applied=structuredClone(state.applied);
  for(const flag of [0,2912,3059,1.5,NaN]){state.document.buttons[0].flag={id:flag,when:"set"};await expect(installCGearQuickActions(p)).rejects.toThrow(/saved flag/);expect(p.fileSystem).toEqual(before);}
  delete state.document.buttons[0].flag;state.document.buttons[0].action="medals";await expect(installCGearQuickActions(p)).rejects.toThrow(/no usable native/);
  state.document.buttons[0].action="repel";state.document.hideCommunicationButtons=false;await expect(installCGearQuickActions(p)).rejects.toThrow(/keep them hidden/);
  state.document.hideCommunicationButtons=true;while(state.document.buttons.length<9)state.document.buttons.push(newButton(state.document));await expect(installCGearQuickActions(p)).rejects.toThrow(/eight buttons/);
  expect(p.fileSystem).toEqual(before);expect(p.cgearButtons!.applied).toEqual(applied);
 });
 it("preserves the working installation after failed retrieval, conflicts, or corrupt archives",async()=>{
  const p=project(game);assets();await installCGearQuickActions(p);const before=structuredClone(p.fileSystem);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([1,2]))));await expect(installCGearQuickActions(p)).rejects.toThrow(/integrity/);expect(p.fileSystem).toEqual(before);assets();
  const rpm=parseRpm(p.fileSystem!.additions![`patches/CGearQuickActions${game}.dll`],{allowedMagics:["DLXF"]});rpm.code[0]^=1;stageCodeInjectionDll(p,"ConflictingCgear.dll",writeRpm(rpm,{ident:"DLXF"}));
  expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:false,message:expect.stringContaining("Conflicting")});
  const q=project(game);await installCGearQuickActions(q);const arc=new NARC(q.fileSystem!.additions![manifest.archivePath]);arc.files[16][0]^=1;q.fileSystem!.additions![manifest.archivePath]=arc.save();expect(getCGearQuickActionsStatus(q)).toMatchObject({compatible:false,message:expect.stringContaining("integrity")});
 });
 it.each(["0.1.0","0.1.1","0.1.2"])("upgrades the exact %s runtime while preserving authored source and IDs",async version=>{
  const p=project(game);assets();await installCGearQuickActions(p);
  p.fileSystem!.additions![`patches/CGearQuickActions${game}.dll`]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-bw1-v${version}/${game}.dll`,import.meta.url)));
  p.fileSystem!.additions![manifest.archivePath]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-bw1-v${version}/ui.narc`,import.meta.url)));
  delete p.cgearButtons;
  expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,installed:true,updateAvailable:true});
  const doc=structuredClone(ensureCGearButtons(p).document);
  await installCGearQuickActions(p);
  expect(p.cgearButtons!.document).toEqual(doc);expect(p.cgearButtons!.applied).toEqual(doc);
  expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,updateAvailable:false});
 });
 it("installs HM02 Fly and retains its action, stable ID and visibility flag through export",async()=>{
  const p=project(game);assets();const b=ensureCGearButtons(p).document.buttons[3];b.action="mapFlyHm";b.flag={id:200,when:"clear"};
  await installCGearQuickActions(p);const reopened=project(game,await exportModifiedRom(p));
  expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:true,enabled:true,compatible:true});
  expect(reopened.cgearButtons!.applied!.buttons[3]).toMatchObject({id:4,action:"mapFlyHm",flag:{id:200,when:"clear"}});
  const rom=new NintendoDSRom(reopened.originalRomBytes!),arc=new NARC(rom.files[rom.fileId(manifest.archivePath)]);
  expect(arc.files[0][32+3*16+2]).toBe(19);expect(readU16(arc.files[0],32+3*16+4)).toBe(421);
 });
});
