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
import { buttonFont, buttonItems, buttonNative } from "./cgearButtonsFixture";
import { ensureCGearButtons, hasUnappliedButtons, recoverCGearButtons } from "../pokeweb/cgearButtonsModel";
import { newButton } from "../cgearButtons/document";
import { buttonGraphics } from "../cgearButtons/nativeGraphics";
import { fingerprint } from "../cgearButtons/compiler";
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
    const font = new NARC();font.files=[new Uint8Array(4),buttonFont()];
    const scripts=new NARC();scripts.files=Array.from({length:1245},()=>new Uint8Array());
    scripts.files[1244]=new Uint8Array(readFileSync(new URL("./fixtures/cgear-pc-script.bin",import.meta.url)));
    r.files.push(buttonNative().save(),font.save(),buttonItems().save(),scripts.save());
    const a=new Folder(),two=new Folder(),zero=new Folder(),eight=new Folder({files:["7"],firstId:344});
    zero.folders.push(["2",new Folder({files:["3","4"],firstId:345})]);
    zero.folders.push(["5",new Folder({files:["6"],firstId:347})]);
    two.folders.push(["8",eight]);a.folders.push(["2",two],["0",zero]);r.filenames.folders.push(["a",a]);
    bytes = r.save({filenames:r.filenames});
  }
  const r = new NintendoDSRom(bytes);
  return {originalRomBytes:bytes,session:{romName:"test",baseVersion:v,baseRom:"BW2",fairy:false,fileIds:{},blacklist:[]},
    romInfo:{title:"test",idCode:r.idCode,fileName:"test.nds",size:bytes.length},arm9:r.arm9,overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],codeInjection:detectPmcInstallFromRom(r)};
}
describe.each(["W2","B2"] as const)("C-Gear Quick Actions %s", v => {
  it.each([1,2] as const)('updates graphics version %s and restores native graphics on disable',async version=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const arc=new NARC(p.fileSystem!.additions![manifest.archivePath]),backup=new NARC(arc.files[14]);
    const old=buttonGraphics(backup,undefined,true,true,version),metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));
    if(version===1)delete metadata.nativeGraphics.version;else metadata.nativeGraphics.version=version;
    metadata.nativeGraphics.packedFingerprint=fingerprint(old.save());
    arc.files[13]=new TextEncoder().encode(JSON.stringify(metadata));p.fileSystem!.additions![manifest.archivePath]=arc.save();
    const rom=new NintendoDSRom(p.originalRomBytes!),id=rom.fileId('a/2/8/7'),native=new NARC(p.fileSystem!.replacements[id]);
    native.files[16]=old.files[0];native.files[17]=old.files[1];p.fileSystem!.replacements[id]=native.save();
    expect(getCGearQuickActionsStatus(p).compatible).toBe(true);const doc=structuredClone(p.cgearButtons!.document);
    await installCGearQuickActions(p);expect(p.cgearButtons!.document).toEqual(doc);
    const updated=new NARC(p.fileSystem!.replacements[id]);expect(updated.files[16]).not.toEqual(old.files[0]);
    disableCGearQuickActions(p);const restored=new NARC(p.fileSystem!.replacements[id]);
    expect(restored.files[16]).toEqual(backup.files[0]);expect(restored.files[17]).toEqual(backup.files[1]);
  });
  it('rejects an unknown PC script atomically and allows a design without PC',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const rom=new NintendoDSRom(p.originalRomBytes!),id=rom.fileId(manifest.pcScript.archive),arc=new NARC(rom.files[id]);
    arc.files[manifest.pcScript.member][30]^=1;p.fileSystem!.replacements[id]=arc.save();
    const before=structuredClone(p.fileSystem),applied=structuredClone(p.cgearButtons!.applied);
    await expect(installCGearQuickActions(p)).rejects.toThrow(/PC storage script.*unrecognized/);
    expect(p.fileSystem).toEqual(before);expect(p.cgearButtons!.applied).toEqual(applied);
    p.cgearButtons!.document.buttons=p.cgearButtons!.document.buttons.filter(b=>b.action!=="pc");
    await installCGearQuickActions(p);expect(getCGearQuickActionsStatus(p).enabled).toBe(true);
  });
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
  it("recovers eight buttons and separates unapplied drafts from working ROM data",async()=>{
    const p=makeProject(v);assets();const state=ensureCGearButtons(p);
    while(state.document.buttons.length<8)state.document.buttons.push(newButton(state.document));
    await installCGearQuickActions(p);p.cgearButtons!.document.buttons[0].label="TOOLONGTOWORK";
    const applied=structuredClone(p.cgearButtons!.applied),before=structuredClone(p.fileSystem);
    await expect(installCGearQuickActions(p)).rejects.toThrow(/28 foreground/);
    expect(p.fileSystem).toEqual(before);expect(p.cgearButtons!.applied).toEqual(applied);
    const reopened=makeProject(v,await exportModifiedRom(p));expect(getCGearQuickActionsStatus(reopened).compatible).toBe(true);
    expect(reopened.cgearButtons!.document.buttons[0].label).toBe("TOOLONGTOWORK");expect(reopened.cgearButtons!.applied).toEqual(applied);
    expect(hasUnappliedButtons(reopened)).toBe(true);
  });
  it("exports an uninstalled draft without installing a native runtime",async()=>{
    const p=makeProject(v);ensureCGearButtons(p).document.buttons[0].label="DRAFT";
    const reopened=makeProject(v,await exportModifiedRom(p));
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:false,enabled:false,compatible:true});
    expect(reopened.cgearButtons!.document.buttons[0].label).toBe("DRAFT");expect(reopened.cgearButtons!.applied).toBeUndefined();
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
    const archive=new NARC(p.fileSystem!.additions![manifest.archivePath]);expect(archive.files[12][512]).toBe(0xd9);
    expect(getCGearQuickActionsStatus(p).compatible).toBe(true);
    archive.files[12][512]^=1;p.fileSystem!.additions![manifest.archivePath]=archive.save();
    expect(getCGearQuickActionsStatus(p).message).toMatch(/integrity check/u);
  });
  it("preserves skin edits while packing and restoring only the owned sprite members",async()=>{
    const p=makeProject(v),r=new NintendoDSRom(p.originalRomBytes!),id=r.fileId("a/2/8/7"),native=new NARC(r.files[id]);
    const original=native.files.map(b=>b.slice());
    native.files[4][41]^=3;native.files[10][0]^=1;
    p.fileSystem={replacements:{[id]:native.save()}};assets();await installCGearQuickActions(p);
    // A skin change made after installation must also survive subsequent updates.
    const installed=new NARC(p.fileSystem.replacements[id]);installed.files[4][42]^=7;
    p.fileSystem.replacements[id]=installed.save();await installCGearQuickActions(p);
    disableCGearQuickActions(p);
    const restored=new NARC(p.fileSystem.replacements[id]);
    expect(restored.files[16]).toEqual(original[16]);expect(restored.files[17]).toEqual(original[17]);
    for(let i=0;i<native.files.length;i++)if(i!==16&&i!==17)expect(restored.files[i]).toEqual(installed.files[i]);
    await installCGearQuickActions(p);removeCGearQuickActions(p);
    const removed=new NARC(p.fileSystem.replacements[id]);
    expect(removed.files[16]).toEqual(original[16]);expect(removed.files[17]).toEqual(original[17]);
    expect(removed.files[4]).toEqual(installed.files[4]);
  });
  it("rejects an unknown edit to owned sprite data without replacing it",async()=>{
    const p=makeProject(v),r=new NintendoDSRom(p.originalRomBytes!),id=r.fileId("a/2/8/7");assets();await installCGearQuickActions(p);
    const native=new NARC(p.fileSystem!.replacements[id]);native.files[16][12]^=1;
    p.fileSystem!.replacements[id]=native.save();const before=structuredClone(p.fileSystem);
    await expect(installCGearQuickActions(p)).rejects.toThrow(/graphics changed after installation/u);
    expect(p.fileSystem).toEqual(before);
  });
});
