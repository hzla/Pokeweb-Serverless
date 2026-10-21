import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/cgearQuickActionsManifest.json";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { detectPmcInstallFromRom, listCodeInjectionDlls, stageCodeInjectionDll, configureBundledBgmRuntime, readBgmRuntimeConfig, removeStagedCodeInjectionDll, canRemoveStagedCodeInjectionDll } from "../pokeweb/pmcModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { parseRpm, writeRpm } from "../pokeweb/rpm";
import { buttonFont, buttonItems, buttonNative } from "./cgearButtonsFixture";
import { ensureCGearButtons, hasUnappliedButtons, recoverCGearButtons } from "../pokeweb/cgearButtonsModel";
import { newButton } from "../cgearButtons/document";
import { buttonGraphics } from "../cgearButtons/nativeGraphics";
import { fingerprint } from "../cgearButtons/compiler";
import { ensureSystemShops, hydrateSystemShops } from "../pokeweb/systemShopsModel";
import { tmTestShop } from "../systemShops/document";
import { recover as recoverShops, ARCHIVE as SHOP_ARCHIVE } from "../systemShops/compiler";
import { encodeGen5TextBank } from "../pokeweb/text";
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
    const iconPointer=new DataView(r.arm9.buffer).getUint32(0x202672c-(v==='B2'?44:0)-r.arm9RamAddress,true)-r.arm9RamAddress;
    for(let item=0;item<639;item++){writeU16(r.arm9,iconPointer+item*4,0);writeU16(r.arm9,iconPointer+item*4+2,1);}
    const icons=new NARC(),iconArt=new Uint8Array(560),iconPalette=new Uint8Array(72);
    iconArt.set(new TextEncoder().encode('RGCN'));writeU32(iconArt,40,512);iconArt.fill(0x11,48);iconPalette.set(new TextEncoder().encode('RLCN'));icons.files=[iconArt,iconPalette];
    const pocketPointer=new DataView(r.arm9.buffer).getUint32(0x20088f8-r.arm9RamAddress,true)-r.arm9RamAddress;
    r.arm9.fill(0,pocketPointer,pocketPointer+639);r.arm9[pocketPointer+450]=4;
    for(let id=328;id<=425;id++)r.arm9[pocketPointer+id]=2;
    const font = new NARC();font.files=[new Uint8Array(4),buttonFont()];
    const scripts=new NARC();scripts.files=Array.from({length:1248},()=>new Uint8Array());
    scripts.files[1244]=new Uint8Array(readFileSync(new URL("./fixtures/cgear-pc-script.bin",import.meta.url)));
    scripts.files[1247]=new Uint8Array(readFileSync(new URL("./fixtures/cgear-shop-script.bin",import.meta.url)));
    const stock=new NARC(),counts=new NARC();stock.files=Array.from({length:6},()=>new Uint8Array([4,0,17,0]));counts.files=[new Uint8Array(6).fill(2)];
    const names=new NARC(),messages=new NARC();names.files=Array.from({length:65},()=>new Uint8Array());messages.files=Array.from({length:614},()=>new Uint8Array());
    names.files[64]=encodeGen5TextBank(Array.from({length:639},(_,i)=>[`0_${i}`,i===93?'Heart Scale':`Item ${i}`,0]));
    messages.files[613]=encodeGen5TextBank(Array.from({length:35},(_,i)=>[`0_${i}`,`Text ${i}`,0]));
    r.files.push(buttonNative().save(),stock.save(),counts.save(),font.save(),buttonItems().save(),icons.save(),scripts.save(),names.save(),messages.save());
    const a=new Folder(),two=new Folder(),zero=new Folder(),eight=new Folder({files:["7","2","3"],firstId:344});
    zero.folders.push(["2",new Folder({files:["3","4","5"],firstId:347})]);
    zero.folders.push(["5",new Folder({files:["6"],firstId:350})]);
    zero.folders.push(["0",new Folder({files:["2","3"],firstId:351})]);
    two.folders.push(["8",eight]);a.folders.push(["2",two],["0",zero]);r.filenames.folders.push(["a",a]);
    bytes = r.save({filenames:r.filenames});
  }
  const r = new NintendoDSRom(bytes);
  return {originalRomBytes:bytes,session:{romName:"test",baseVersion:v,baseRom:"BW2",fairy:false,fileIds:{},blacklist:[]},
    romInfo:{title:"test",idCode:r.idCode,fileName:"test.nds",size:bytes.length},arm9:r.arm9,overlays:{},narcs:{},texts:{banks:{}},formats:{},trpokInfo:[],codeInjection:detectPmcInstallFromRom(r)};
}
// Actual pre-dial archives contain eight cell/animation sequences.
function legacyControls(arc:NARC){
  const cells=arc.files[2],anim=arc.files[3],c=new Uint8Array(240),a=new Uint8Array(272);
  c.set(cells.subarray(0,176));c.set(cells.subarray(192,256),176);writeU16(c,24,8);writeU32(c,8,c.length);writeU32(c,20,c.length-16);
  a.set(anim.subarray(0,176));a.set(anim.subarray(192,256),176);a.set(anim.subarray(264,296),240);
  writeU16(a,24,8);writeU16(a,26,8);writeU32(a,32,152);writeU32(a,36,216);writeU32(a,8,a.length);writeU32(a,20,a.length-16);
  arc.files[2]=c;arc.files[3]=a;arc.files[0][47]=0;
  const metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));delete metadata.nativeGraphics.skinDial;arc.files[13]=new TextEncoder().encode(JSON.stringify(metadata));
  writeU32(arc.files[0],24,fingerprint(new Uint8Array(arc.files.slice(1,12).flatMap(b=>Array.from(b)))));
}
describe.each(["W2","B2"] as const)("C-Gear Quick Actions %s", v => {
  it.each(['0.5.4','0.5.5'])('upgrades %s and preserves an optional System Shop through apply, export, disable and re-enable',async previousVersion=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const path=`patches/CGearQuickActions${v}.dll`;
    p.fileSystem!.additions![path]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-v${previousVersion}/CGearQuickActions${v}.dll`,import.meta.url)));
    if(previousVersion==='0.5.5')p.fileSystem!.additions![SHOP_ARCHIVE]=new Uint8Array(readFileSync(new URL('./fixtures/cgear-quick-actions-v0.5.5/shops.narc',import.meta.url)));
    expect(getCGearQuickActionsStatus(p)).toMatchObject({installed:true,compatible:true,updateAvailable:true});
    const d=ensureCGearButtons(p).document,b=newButton(d,"systemShop");b.flag={id:42,when:"clear"};d.buttons.push(b);
    expect(d.buttons).toHaveLength(7);await installCGearQuickActions(p);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,updateAvailable:false});
    const reopened=makeProject(v,await exportModifiedRom(p));
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:true,compatible:true,enabled:true});
    expect(reopened.cgearButtons!.document).toEqual(d);
    disableCGearQuickActions(reopened);await installCGearQuickActions(reopened);
    expect(reopened.cgearButtons!.applied).toEqual(d);
  });
  it('applies custom currency shops atomically and preserves drafts through ROM export/reopening',async()=>{
    const p=makeProject(v);assets();const buttons=ensureCGearButtons(p).document;buttons.buttons.push(newButton(buttons,'systemShop'));
    const state=ensureSystemShops(p);state.document.shops.push(tmTestShop(state.document));
    await installCGearQuickActions(p,{applySystemShops:true});
    expect(state.applied).toBeUndefined(); // Staging replaces the state only on success.
    expect(p.systemShops!.applied).toEqual(p.systemShops!.document);
    p.systemShops!.document.shops[0].inventory[0].cost=25;
    const applied=structuredClone(p.systemShops!.applied);
    await installCGearQuickActions(p);
    expect(p.systemShops!.applied).toEqual(applied);
    const exported=await exportModifiedRom(p),reopened=makeProject(v,exported),rom=new NintendoDSRom(exported);
    await installCGearQuickActions(reopened);
    hydrateSystemShops(reopened,rom);
    expect(reopened.systemShops).toEqual(p.systemShops);
    expect(recoverShops(rom.files[rom.fileId(SHOP_ARCHIVE)]).applied).toEqual(applied);
    const before={fs:structuredClone(p.fileSystem),arm:p.arm9.slice(),applied:structuredClone(p.systemShops!.applied)};
    p.systemShops!.document.shops[0].currency=450;
    await expect(installCGearQuickActions(p,{applySystemShops:true})).rejects.toThrow(/stackable/);
    expect(p.fileSystem).toEqual(before.fs);expect(p.arm9).toEqual(before.arm);expect(p.systemShops!.applied).toEqual(before.applied);
    p.systemShops!.document.shops[0].currency=93;
    await installCGearQuickActions(p,{applySystemShops:true});
    expect(p.systemShops!.applied!.shops[0].inventory[0].cost).toBe(25);
    disableCGearQuickActions(p);await installCGearQuickActions(p);
    expect(p.systemShops!.applied!.shops[0].inventory[0].cost).toBe(25);
    const archive=p.fileSystem!.additions![SHOP_ARCHIVE];archive[archive.length-1]^=1;
    expect(getCGearQuickActionsStatus(p).compatible).toBe(false);
    const damaged=archive.slice();
    await expect(installCGearQuickActions(p)).rejects.toThrow();
    expect(p.fileSystem!.additions![SHOP_ARCHIVE]).toEqual(damaged);
  });
  it('accepts authored general-store stock and prices without replacing them',async()=>{
    const p=makeProject(v);assets();const r=new NintendoDSRom(p.originalRomBytes!);
    const stockId=r.fileId('a/2/8/2'),itemsId=r.fileId('a/0/2/4');
    const stock=new NARC(r.files[stockId]),items=new NARC(r.files[itemsId]);
    writeU16(stock.files[0],0,18);writeU16(items.files[18],0,73);
    p.fileSystem={replacements:{[stockId]:stock.save(),[itemsId]:items.save()},additions:{}};
    const before=structuredClone(p.fileSystem.replacements);
    const d=ensureCGearButtons(p).document;d.buttons.push(newButton(d,'systemShop'));
    await installCGearQuickActions(p);
    for(const id of [stockId,itemsId])expect(p.fileSystem!.replacements[id]).toEqual(before[id]);
  });
  it.each(['script','counts','item','native'] as const)('rejects incompatible shop %s atomically',async(kind)=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const r=new NintendoDSRom(p.originalRomBytes!),d=ensureCGearButtons(p).document;d.buttons.push(newButton(d,'systemShop'));
    if(kind==='native'){
      const s=manifest.games[v].signatures.find(s=>s.label==='Native Buy state machine and cleanup')!,o=r.loadArm9Overlays([36]).get(36)!;
      p.overlays[36]=o.data.slice();p.overlays[36]![s.address-o.ramAddress]^=1;
    }else{
      const id=r.fileId(kind==='script'?'a/0/5/6':kind==='counts'?'a/2/8/3':'a/2/8/2'),a=new NARC(r.files[id]);
      if(kind==='script')a.files[1247][24]^=1;else if(kind==='counts')a.files[0][0]=255;else writeU16(a.files[0],0,65535);
      p.fileSystem!.replacements[id]=a.save();
    }
    const before={fs:structuredClone(p.fileSystem),applied:structuredClone(p.cgearButtons!.applied),arm:p.arm9.slice()};
    await expect(installCGearQuickActions(p)).rejects.toThrow();
    expect(p.fileSystem).toEqual(before.fs);expect(p.cgearButtons!.applied).toEqual(before.applied);expect(p.arm9).toEqual(before.arm);
  });
  it('upgrades 0.3.6 graphics and shares mute without changing music mappings or shortcut preference',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const mapping={targetSequenceId:1,streamId:2,originalSequenceFileId:3,shadowFileId:4,streamFileId:5};
    stageCodeInjectionDll(p,`BgmToggle${v}.dll`,await configureBundledBgmRuntime(v,{shortcutEnabled:false,mappings:[mapping]}));
    const arc=new NARC(p.fileSystem!.additions![manifest.archivePath]);legacyControls(arc);const backup=new NARC(arc.files[14]),oldGraphics=buttonGraphics(backup,undefined,true,true,3),metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));metadata.nativeGraphics.version=3;delete metadata.nativeGraphics.muteControl;metadata.nativeGraphics.packedFingerprint=fingerprint(oldGraphics.save());arc.files[13]=new TextEncoder().encode(JSON.stringify(metadata));arc.files[0][46]=0;const h=arc.files[0];writeU32(h,28,fingerprint(new Uint8Array([...h.subarray(0,28),...h.subarray(32)])));const old=arc.save();
    p.fileSystem!.additions![manifest.archivePath]=old;
    p.fileSystem!.additions![`patches/CGearQuickActions${v}.dll`]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-v0.3.6/CGearQuickActions${v}.dll`,import.meta.url)));
    p.cgearButtons=recoverCGearButtons(old);const design=structuredClone(p.cgearButtons.document);
    const r=new NintendoDSRom(p.originalRomBytes!),id=r.fileId('a/2/8/7'),native=new NARC(p.fileSystem!.replacements[id]),prior=buttonGraphics(backup,undefined,true,true,3);
    native.files[16]=prior.files[0];native.files[17]=prior.files[1];p.fileSystem!.replacements[id]=native.save();
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,updateAvailable:true});
    await installCGearQuickActions(p);expect(p.cgearButtons.document).toEqual(design);
    const music=p.fileSystem!.additions![`patches/BgmToggle${v}.dll`];
    expect(readBgmRuntimeConfig(music)).toMatchObject({shortcutEnabled:false,mappings:[mapping]});
    const rpm=parseRpm(music,{allowedMagics:['DLXF']});expect(rpm.symbols.some(s=>s.nameHash===0x55872599&&(s.attributes&1))).toBe(true);
    expect(new NARC(p.fileSystem!.additions![manifest.archivePath]).files[0][46]).toBe(1);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:true,updateAvailable:false});
    expect(canRemoveStagedCodeInjectionDll(p,`patches/BgmToggle${v}.dll`)).toBe(false);
    expect(()=>removeStagedCodeInjectionDll(p,`patches/BgmToggle${v}.dll`)).toThrow(/shared music runtime/);
    disableCGearQuickActions(p);expect(p.fileSystem!.additions![`patches/BgmToggle${v}.dll`]).toEqual(music);
  });
  it('updates the previous runtime and persists an authored Pokéradar button through export',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const path=`patches/CGearQuickActions${v}.dll`;
    p.fileSystem!.additions![path]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-v0.3.5/CGearQuickActions${v}.dll`,import.meta.url)));
    expect(getCGearQuickActionsStatus(p)).toMatchObject({ installed:true,compatible:true,updateAvailable:true });
    const d=ensureCGearButtons(p).document;d.buttons.push(newButton(d,"pokeradar"));
    await installCGearQuickActions(p);
    expect(getCGearQuickActionsStatus(p)).toMatchObject({ installed:true,compatible:true,updateAvailable:false });
    const reopened=makeProject(v,await exportModifiedRom(p));
    expect(reopened.cgearButtons).toBeUndefined(); // Recovery is lazy for this small fixture loader.
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({ installed:true,compatible:true,updateAvailable:false });
    expect(reopened.cgearButtons!.document).toEqual(d);
  });

  it('rejects incompatible native phenomenon code and overlapping hooks atomically',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const signature=manifest.games[v].signatures.find(s=>s.label==='QaPhenomenonInterval')!;
    const rom=new NintendoDSRom(p.originalRomBytes!),overlay=rom.loadArm9Overlays([36]).get(36)!;
    p.overlays[36]=overlay.data.slice();p.overlays[36]![signature.address-overlay.ramAddress]^=1;
    const before=structuredClone(p.fileSystem);
    expect(getCGearQuickActionsStatus(p).compatible).toBe(false);
    await expect(installCGearQuickActions(p)).rejects.toThrow();expect(p.fileSystem).toEqual(before);
    delete p.overlays[36];
    const own=p.fileSystem!.additions![`patches/CGearQuickActions${v}.dll`],other=parseRpm(own,{allowedMagics:['DLXF']});
    other.relocations=other.relocations.filter(r=>r.target.module==='36'&&r.target.address===signature.address);
    stageCodeInjectionDll(p,'OtherPhenomenon.dll',writeRpm(other,{ident:'DLXF'}));
    expect(getCGearQuickActionsStatus(p)).toMatchObject({compatible:false,message:expect.stringContaining('Conflicting')});
  });
  it('updates the 0.5.3 runtime to HM02 Fly and retains its design through export',async()=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const path=`patches/CGearQuickActions${v}.dll`;
    p.fileSystem!.additions![path]=new Uint8Array(readFileSync(new URL(`./fixtures/cgear-quick-actions-v0.5.3/CGearQuickActions${v}.dll`,import.meta.url)));
    expect(getCGearQuickActionsStatus(p)).toMatchObject({installed:true,compatible:true,updateAvailable:true});
    const button=ensureCGearButtons(p).document.buttons[3];button.action="mapFlyHm";button.flag={id:200,when:"clear"};
    await installCGearQuickActions(p);
    const reopened=makeProject(v,await exportModifiedRom(p));
    expect(getCGearQuickActionsStatus(reopened)).toMatchObject({installed:true,compatible:true,enabled:true,updateAvailable:false});
    expect(reopened.cgearButtons!.applied!.buttons[3]).toMatchObject({id:4,action:"mapFlyHm",flag:{id:200,when:"clear"}});
    const rom=new NintendoDSRom(reopened.originalRomBytes!),arc=new NARC(rom.files[rom.fileId(manifest.archivePath)]);
    expect(arc.files[0][32+3*16+2]).toBe(19);expect(arc.files[0][32+3*16+4]).toBe(421&255);
  });
  it.each([1,2,3,4,5] as const)('updates graphics version %s and restores native graphics on disable',async version=>{
    const p=makeProject(v);assets();await installCGearQuickActions(p);
    const arc=new NARC(p.fileSystem!.additions![manifest.archivePath]);legacyControls(arc);const backup=new NARC(arc.files[14]);
    const old=buttonGraphics(backup,undefined,true,true,version),metadata=JSON.parse(new TextDecoder().decode(arc.files[13]));
    if(version<4){delete metadata.nativeGraphics.muteControl;arc.files[0][46]=0;}const h=arc.files[0];writeU32(h,28,fingerprint(new Uint8Array([...h.subarray(0,28),...h.subarray(32)])));if(version===1)delete metadata.nativeGraphics.version;else metadata.nativeGraphics.version=version;
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
