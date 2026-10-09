import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/cgearQuickActionsManifest.json";
import { writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { detectPmcInstallFromRom, listCodeInjectionDlls, stageCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
type Version = "W2" | "B2";
afterEach(() => vi.unstubAllGlobals());
function assets() {
  vi.stubGlobal("fetch", vi.fn(async (input: URL) => new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${input.pathname.split("/").pop()}`, import.meta.url))))));
}
function makeProject(v: Version, bytes?: Uint8Array): ProjectState {
  if (!bytes) {
    const r = new NintendoDSRom(new Uint8Array(0x200));r.data.set(new TextEncoder().encode(manifest.games[v].idCode),12);
    r.arm9RamAddress = 0x02004000;writeU32(r.data,0x28,r.arm9RamAddress);r.arm9 = new Uint8Array(0xa0000);r.arm7 = new Uint8Array(4);
    r.files = Array.from({length:344}, () => new Uint8Array(4));r.filenames = new Folder();r.arm9OverlayTable = new Uint8Array(344*32);
    for(let id=0;id<344;id++) {writeU32(r.arm9OverlayTable,id*32,id);writeU32(r.arm9OverlayTable,id*32+24,id);}
    for(const mod of [12,36,79]) {
      const signatures = manifest.games[v].signatures.filter(s => s.module===String(mod));
      const base = Math.min(...signatures.map(s=>s.address)) & ~255;
      r.files[mod] = new Uint8Array(Math.max(...signatures.map(s=>s.address+s.expectedHex.length/2))-base);
      writeU32(r.arm9OverlayTable,mod*32+4,base);writeU32(r.arm9OverlayTable,mod*32+8,r.files[mod].length);
      for(const s of signatures) r.files[mod].set(Buffer.from(s.expectedHex,"hex"),s.address-base);
    }
    for(const s of manifest.games[v].signatures.filter(s=>s.module==="ARM9")) r.arm9.set(Buffer.from(s.expectedHex,"hex"),s.address-r.arm9RamAddress);
    const arc=new NARC();arc.files=Array.from({length:31},()=>new Uint8Array(4));
    for(const member of [17,29]) {const b=new Uint8Array(48);b.set(new TextEncoder().encode("RECN"));writeU32(b,28,24);arc.files[member]=b;}
    arc.files[14]=new Uint8Array(552);arc.files[15]=new Uint8Array(552);
    for(let i=19;i<29;i++){arc.files[i]=new Uint8Array(688);arc.files[i].set(new TextEncoder().encode('RGCN'));}
    r.files.push(arc.save());const a=new Folder(),two=new Folder(),eight=new Folder({files:["7"],firstId:344});
    two.folders.push(["8",eight]);a.folders.push(["2",two]);r.filenames.folders.push(["a",a]);
    bytes = r.save({filenames:r.filenames});
  }
  const r = new NintendoDSRom(bytes);
  return {originalRomBytes:bytes,session:{romName:"test",baseVersion:v,baseRom:"BW2",fairy:false,fileIds:{},blacklist:[]},
    romInfo:{title:"test",idCode:r.idCode,fileName:"test.nds",size:bytes.length},arm9:r.arm9,overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],codeInjection:detectPmcInstallFromRom(r)};
}
describe.each(["W2","B2"] as const)("C-Gear Quick Actions %s", v => {
  it('persists the PC hide flag through updates, disabling, and ROM reopening',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p,{pcHideFlag:1509});
    expect(getCGearQuickActionsStatus(p).pcHideFlag).toBe(1509);
    await installCGearQuickActions(p);disableCGearQuickActions(p);
    const reopened=makeProject(v,await exportModifiedRom(p));
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({pcHideFlag:1509,enabled:false});
    await installCGearQuickActions(reopened);expect(getCGearQuickActionsStatus(reopened).pcHideFlag).toBe(1509);
    const before=structuredClone(reopened.fileSystem);
    for(const flag of [0,3060,0x4000,1.5,NaN]) {
      await expect(installCGearQuickActions(reopened,{pcHideFlag:flag})).rejects.toThrow(/saved flag/u);
      expect(reopened.fileSystem).toEqual(before);
    }
  });
  it("installs atomically, preserves native overlays, disables, and restores after export", async () => {
    const p = makeProject(v);assets();const original = new NintendoDSRom(p.originalRomBytes!);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,installed:false});
    const result = await installCGearQuickActions(p);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,installed:true,enabled:true,canRemove:true});
    await installCGearQuickActions(p);expect(listCodeInjectionDlls(p).filter(e=>e.fileName===result.fileName)).toHaveLength(1);
    disableCGearQuickActions(p);expect(getCGearQuickActionsStatus(p).enabled).toBe(false);
    const exported = new NintendoDSRom(await exportModifiedRom(p));
    for(const id of [12,36,79]) expect(exported.loadArm9Overlays([id]).get(id)!.data).toEqual(original.loadArm9Overlays([id]).get(id)!.data);
    const reopened = makeProject(v,exported.data);
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:true,enabled:false,compatible:true,canRemove:false});
    await installCGearQuickActions(reopened);expect(getCGearQuickActionsStatus(reopened).enabled).toBe(true);
    expect(reopened.fileSystem!.replacements[exported.fileId(result.path)]).toBeDefined();
    expect(reopened.fileSystem!.replacements[exported.fileId(manifest.archivePath)]).toBeDefined();
    expect(Object.keys(reopened.fileSystem!.additions ?? {})).toHaveLength(0);
  });
  it("removes a staged installation and rejects conflicting hooks", async () => {
    const p = makeProject(v);assets();await installCGearQuickActions(p);removeCGearQuickActions(p);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,installed:false});
    expect(p.fileSystem!.additions![manifest.archivePath]).toBeUndefined();
    const rpm = parseRpm(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/CGearQuickActions${v}.dll`,import.meta.url))),{allowedMagics:["DLXF"]});
    rpm.code[0]^=1;stageCodeInjectionDll(p,"OtherCgear.dll",writeRpm(rpm,{ident:"DLXF"}));
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:false});
    await expect(installCGearQuickActions(p)).rejects.toThrow(/OtherCgear/u);
  });
  it("failed bundle retrieval leaves previous installation unchanged", async () => {
    const p = makeProject(v);assets();await installCGearQuickActions(p);disableCGearQuickActions(p);
    const before = structuredClone({arm:p.arm9,files:p.fileSystem,modules:p.codeInjection,changes:p.actionChangelog});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([1,2]))));
    await expect(installCGearQuickActions(p)).rejects.toThrow();
    expect({arm:p.arm9,files:p.fileSystem,modules:p.codeInjection,changes:p.actionChangelog}).toEqual(before);
  });
  it("rejects modified native code with its exact location", async () => {
    const p = makeProject(v), s=manifest.games[v].signatures.find(s=>s.module==="ARM9")!;
    p.arm9[s.address-0x02004000]^=1;
    expect(getCGearQuickActionsStatus(p).message).toContain(`0x${s.address.toString(16)}`);
    await expect(installCGearQuickActions(p)).rejects.toThrow(/Unrecognized/u);
  });
  it("rejects palette conflicts before staging any files",async()=>{
    const p=makeProject(v),r=new NintendoDSRom(p.originalRomBytes!),id=r.fileId("a/2/8/7"),arc=new NARC(r.files[id]);
    arc.files[14][40+7*32]=1;p.fileSystem={replacements:{[id]:arc.save()}};
    expect(getCGearQuickActionsStatus(p).message).toMatch(/palette banks 7/u);
    await expect(installCGearQuickActions(p)).rejects.toThrow(/palette banks/u);
    expect(listCodeInjectionDlls(p)).toHaveLength(0);
  });
  it('uses the loaded ROM patterns and detects corrupted private pattern data',async()=>{
    const p=makeProject(v),r=new NintendoDSRom(p.originalRomBytes!),id=r.fileId('a/2/8/7'),native=new NARC(r.files[id]);
    native.files[20][176]=0xd9;p.fileSystem={replacements:{[id]:native.save()}};assets();await installCGearQuickActions(p);
    const archive=new NARC(p.fileSystem!.additions![manifest.archivePath]);expect(archive.files[8][512]).toBe(0xd9);
    expect(getCGearQuickActionsStatus(p).compatible).toBe(true);
    archive.files[8][512]^=1;p.fileSystem!.additions![manifest.archivePath]=archive.save();
    expect(getCGearQuickActionsStatus(p).message).toMatch(/pattern data failed/u);
  });
});
