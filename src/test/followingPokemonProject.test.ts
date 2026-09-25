import interactionManifest from "../assets/following/interactions.json";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../nds/rom";
import { Folder } from "../nds/fnt";
import type { ProjectState } from "../pokeweb/projectStore";
import { stageCodeInjectionDll } from "../pokeweb/pmcModel";
import { FOLLOWER_MANIFEST_PATH, FOLLOWER_REGISTRY_PATH, readFollowerWorkspace, replaceFollowerAssets, readFollowerAsset, checkFollowerCompatibility, type FollowerAssetWorkspace } from "../pokeweb/followingPokemonProject";
import { deriveFollowerGrounding, encodeFollowerFrames, followerGroundingPixels, followerKey } from "../pokeweb/followingPokemonModel";
import contract from "../../runtime/following-pokemon/contract.json";
const bytes=new Uint8Array(readFileSync(new URL("../assets/following/template-32-8.btx",import.meta.url)));
const italianFieldDll=new Uint8Array(readFileSync(new URL("../assets/following/white2italy/PokewebFollowingFieldW2I.dll",import.meta.url)));
describe("persisted Italian follower installation",()=>{
  it("accepts W2I modules using the loaded IRDI identity after ROM bytes leave project state",()=>{
    const project={session:{baseRom:"BW2",baseVersion:"W2"},romInfo:{idCode:"IRDI"},codeInjection:{pmc:{overlayId:344,gameId:"W2I"}},fileSystem:{additions:{},replacements:{}}} as unknown as ProjectState;
    expect(project.originalRomBytes).toBeUndefined();
    expect(stageCodeInjectionDll(project,"PokewebFollowingFieldW2I.dll",italianFieldDll).gameId).toBe("W2I");
    project.romInfo.idCode="IRDO";
    expect(()=>stageCodeInjectionDll(project,"PokewebFollowingFieldW2I.dll",italianFieldDll)).toThrow(/loaded ROM is W2/);
  });
});
function fixture(){
  const workspace: FollowerAssetWorkspace={schemaVersion:1,targetSha256:contract.target.sha256,imports:{},registry:{runtimeAbi:1,descriptorCount:1009,resourceCount:975,zones:[],entries:[{
    key:{species:1,form:0,gender:0,shiny:true},descriptorRow:1008,resourceId:400,size:32,animationProfile:"pokemon-mirrored",offsets:[0,0,0],placeholder:true,placeholderReason:"Missing shiny",source:"stock",
  }]}};
  const project={originalRomBytes:new Uint8Array(512),romInfo:{title:"test",idCode:"TEST",fileName:"test.nds",size:512},arm9:new Uint8Array(),overlays:{},texts:{banks:{}},formats:{},trpokInfo:[],session:{romName:"test",baseVersion:"W2",baseRom:"BW2",fairy:false,fileIds:{},blacklist:[]},narcs:{},fileSystem:{replacements:{},additions:{[FOLLOWER_MANIFEST_PATH]:new TextEncoder().encode(JSON.stringify(workspace)),"unrelated.bin":Uint8Array.of(9)}}} as unknown as ProjectState;
  const rom=new NintendoDSRom(new Uint8Array(512));return {project,rom,workspace};
}
describe("follower asset transactions",()=>{
  it("grounds opaque feet while retaining Flying-form and explicit sprite heights",()=>{
    const template=new Uint8Array(readFileSync(new URL("../assets/following/template-32-8.btx",import.meta.url)));
    const rgba=new Uint8Array(32*32*4);rgba.set([255,0,0,255],(29*32+16)*4);
    const artwork=encodeFollowerFrames(Array.from({length:8},()=>({width:32,height:32,rgba})),template);
    expect(followerGroundingPixels(artwork,"pokemon-asymmetric")).toBe(2);
    const base=new Uint8Array(33),flyingForm=new Uint8Array(33);base[28]=2;base[32]=2;flyingForm[6]=2;
    const make=(form:number,row:number,vertical=0)=>({key:{species:1,form,gender:0 as const,shiny:false},descriptorRow:row,resourceId:0,size:32 as const,
      animationProfile:"pokemon-asymmetric" as const,offsets:[0,vertical,0] as [number,number,number],placeholder:false,source:"stock" as const});
    const registry={runtimeAbi:1,descriptorCount:1012,resourceCount:1,zones:[],entries:[make(0,1008),make(1,1009),make(0,1010,-7),make(0,1011,-2)]};
    deriveFollowerGrounding(registry,[artwork],[new Uint8Array(33),base,flyingForm]);
    expect(registry.entries.map(entry=>entry.offsets[1])).toEqual([-5,0,-7,-5]);
    deriveFollowerGrounding(registry,[artwork],[new Uint8Array(33),base,flyingForm]);
    expect(registry.entries.map(entry=>entry.offsets[1])).toEqual([-5,0,-7,-5]);
  });
  it("validates a whole batch before any project mutation",()=>{
    const {project,rom,workspace}=fixture(),before=structuredClone(project);
    expect(()=>replaceFollowerAssets(project,rom,[{key:workspace.registry.entries[0].key,bytes,profile:"pokemon-asymmetric",source:"png",label:"valid"},
      {key:{species:25,form:0,gender:0,shiny:false},bytes,profile:"pokemon-asymmetric",source:"png",label:"invalid"}])).toThrow(/not valid/);
    expect(project).toEqual(before);
  });
  it("replaces only owned data, retains placeholder labels, and is idempotent",()=>{
    const {project,rom,workspace}=fixture();const key=workspace.registry.entries[0].key;
    const update={key,bytes,profile:"pokemon-asymmetric" as const,source:"png" as const,label:"art.png",placeholder:true,placeholderReason:"Form substitution"};
    const result=replaceFollowerAssets(project,rom,[update]);
    expect(result.registry.resourceCount).toBe(976);expect(result.registry.entries[0].resourceId).toBe(975);
    expect(result.registry.entries[0].placeholder).toBe(true);
    expect(readFollowerAsset(project,rom,result,result.registry.entries[0])).toEqual(bytes);
    expect(project.fileSystem!.additions!["unrelated.bin"]).toEqual(Uint8Array.of(9));
    const again=replaceFollowerAssets(project,rom,[update]);expect(again).toEqual(result);
    expect(project.fileSystem!.additions![FOLLOWER_REGISTRY_PATH]).toBeDefined();
    expect(project.actionChangelog?.entries).toHaveLength(1);
    expect(readFollowerWorkspace(project,rom)).toEqual(result);
  });
  it("updates existing NitroFS files without creating duplicate paths",()=>{
    const {project,rom,workspace}=fixture();rom.filenames=new Folder({files:['assets.json'],firstId:0});
    rom.filenames=new Folder({folders:[['following',rom.filenames]]});
    rom.files=[project.fileSystem!.additions![FOLLOWER_MANIFEST_PATH]];
    delete project.fileSystem!.additions![FOLLOWER_MANIFEST_PATH];
    replaceFollowerAssets(project,rom,[{key:workspace.registry.entries[0].key,bytes,profile:"pokemon-asymmetric",source:"png",label:"art"}]);
    expect(project.fileSystem!.additions![FOLLOWER_MANIFEST_PATH]).toBeUndefined();
    expect(project.fileSystem!.replacements[0]).toBeDefined();
  });
  it("reopens data-only ROM exports and updates imported artwork without duplicate files",async()=>{
    const {project,rom,workspace}=fixture();const key=workspace.registry.entries[0].key;
    const update={key,bytes,profile:"pokemon-asymmetric" as const,source:"png" as const,label:"art"};
    const prepared=replaceFollowerAssets(project,rom,[update]);
    const output=await exportModifiedRom(project);
    const reopened=new NintendoDSRom(output), restored: ProjectState={...project,fileSystem:undefined,actionChangelog:undefined,originalRomBytes:output};
    const fromRom=readFollowerWorkspace(restored,reopened)!;
    expect(fromRom).toEqual(prepared);
    expect(readFollowerAsset(restored,reopened,fromRom,fromRom.registry.entries[0])).toEqual(bytes);
    replaceFollowerAssets(restored,reopened,[update]);
    expect(Object.keys(restored.fileSystem?.additions??{})).toHaveLength(0);
    expect(Object.keys(restored.fileSystem?.replacements??{})).toHaveLength(3);
  });
  it("detects independently modified owned assets and rejects invalid source manifests",()=>{
    const {project,rom,workspace}=fixture();const key=workspace.registry.entries[0].key;
    const result=replaceFollowerAssets(project,rom,[{key,bytes,profile:"pokemon-asymmetric",source:"png",label:"art"}]);
    project.fileSystem!.additions![result.imports[followerKey(key)].path][100]^=1;
    expect(()=>readFollowerAsset(project,rom,result,result.registry.entries[0])).toThrow(/edited outside/);
    const bad=structuredClone(result);bad.imports[followerKey(key)].path='unrelated.bin';
    project.fileSystem!.additions![FOLLOWER_MANIFEST_PATH]=new TextEncoder().encode(JSON.stringify(bad));
    expect(()=>readFollowerWorkspace(project,rom)).toThrow(/reference/);
  });
  it("rejects unsupported game regions and revisions before changing state",async()=>{
    const {project}=fixture();project.originalRomBytes=new Uint8Array(512);project.originalRomBytes.set(new TextEncoder().encode('IRDP'),12);
    const before=structuredClone(project);expect((await checkFollowerCompatibility(project)).compatible).toBe(false);expect(project).toEqual(before);
    project.originalRomBytes.set(new TextEncoder().encode('IRDO'),12);project.originalRomBytes[30]=1;
    expect((await checkFollowerCompatibility(project)).compatible).toBe(false);
  });
});

import { encodeFollowerNativeConfig, followerRomSha256, readFollowerAlphaInstall, setFollowerAlphaEnabled, readFollowerDialogueRules, writeFollowerDialogueRules, readFollowerItemRules, writeFollowerItemRules, FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_INSTALL_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH } from "../pokeweb/followingPokemonProject";
import { encodeFollowerRegistry, decodeFollowerRegistry, encodeFollowerLandAnchors, followerCrc32 } from "../pokeweb/followingPokemonModel";
import runtimeManifest from "../assets/following/runtime.json";
import effectsManifest from "../assets/following/effects.json";
import { NARC } from "../nds/narc";
import { repairNarcBytes } from "../pokeweb/romRepairModel";
function nativeConfig() {
  const registry=encodeFollowerRegistry({runtimeAbi:1,descriptorCount:1009,resourceCount:975,zones:[],entries:[{
    key:{species:1,form:0,gender:0,shiny:false},descriptorRow:1008,resourceId:400,size:32,animationProfile:"pokemon-mirrored",offsets:[0,0,0],placeholder:false,source:"stock",sourceDescriptorRow:377,
  }]});
  return {registry,config:encodeFollowerNativeConfig(registry,1009,975)};
}
describe("walking alpha ownership",()=>{
  it("stages contextual rules before installation without creating an ownership receipt", async()=>{
    const {project}=fixture();
    await writeFollowerDialogueRules(project,[{zone:42,type:10,text:"{nickname} likes {location}!"}]);
    await writeFollowerItemRules(project,[{slot:0,itemId:1,quantity:1,itemName:"Potion",zone:42,text:"{nickname} found a {item}!"}]);
    expect(await readFollowerDialogueRules(project)).toEqual([{zone:42,type:10,text:"{nickname} likes {location}!"}]);
    expect(await readFollowerItemRules(project)).toEqual([{slot:0,itemId:1,quantity:1,itemName:"Potion",zone:42,text:"{nickname} found a {item}!"}]);
    expect(project.fileSystem!.additions![FOLLOWER_DIALOGUE_NARC_PATH]).toBeDefined();
    expect(project.fileSystem!.additions![FOLLOWER_ITEM_NARC_PATH]).toBeDefined();
    expect(project.fileSystem!.additions![FOLLOWER_INSTALL_PATH]).toBeUndefined();
  });
  it("keeps the effect archive byte-identical through ROM export normalization",()=>{
    const effects=new Uint8Array(readFileSync(new URL('../assets/following/hgss-effects.narc',import.meta.url)));
    expect(repairNarcBytes(effects).changed).toBe(false);
    expect(new NARC(effects).files.map(file=>file.length)).toEqual(effectsManifest.members.map(member=>member.bytes));
    expect(followerCrc32(effects)).toBe(effectsManifest.crc32);
  });
  it("writes the native mapping contract and rejects out-of-range object codes",()=>{
    const {config,registry}=nativeConfig(), view=new DataView(config.buffer);
    expect(config.length).toBe(32);expect(view.getUint32(0,true)).toBe(0x544e5746);
    expect(view.getUint32(8,true)).toBe(2);expect(view.getUint32(12,true)).toBe(registry.length);
    expect(view.getUint32(16,true)).toBe(1009);expect(view.getUint32(20,true)).toBe(975);
    expect(view.getUint32(24,true)).toBe(followerCrc32(registry));
  });
  it("toggles only fingerprinted owned config and retains unrelated artwork",async()=>{
    const {project}=fixture(),{config,registry}=nativeConfig(),descriptorArchive=new NARC(),resourceArchive=new NARC();
    descriptorArchive.files=[new Uint8Array(4+1009*28)];new DataView(descriptorArchive.files[0].buffer).setUint32(0,1009,true);
    resourceArchive.files=Array.from({length:975},()=>new Uint8Array());
    const fixtureFrame=()=>{const rgba=new Uint8Array(32*32*4);rgba.set([255,0,0,255],(16*32+16)*4);return {width:32,height:32,rgba};};
    resourceArchive.files[400]=encodeFollowerFrames(Array.from({length:6},fixtureFrame),new Uint8Array(readFileSync(new URL('../assets/following/template-32-6.btx',import.meta.url))));
    const descriptor=descriptorArchive.save(),resources=resourceArchive.save();
    const surf=new Uint8Array(readFileSync(new URL('../assets/following/surf-mounts.narc',import.meta.url)));
    const surfRegistry=new Uint8Array(readFileSync(new URL('../assets/following/surf-registry.bin',import.meta.url)));
    const rider=new Uint8Array(readFileSync(new URL('../assets/following/land-riders.narc',import.meta.url)));
    const anchors=encodeFollowerLandAnchors(decodeFollowerRegistry(registry),resourceArchive.files,registry);
    const dialogues=new Uint8Array(readFileSync(new URL('../assets/following/contextual-dialogues.narc',import.meta.url)));
    const state={schemaVersion:1,version:runtimeManifest.version,enabled:true,targetSha256:contract.target.sha256,moduleSha256:runtimeManifest.fieldSha256,eventsSha256:runtimeManifest.eventsSha256,eventsAbi:runtimeManifest.eventsAbi,coreSha256:runtimeManifest.coreSha256,coreAbi:runtimeManifest.coreAbi,configCrc32:followerCrc32(config),registrySha256:await followerRomSha256(registry),descriptorsSha256:await followerRomSha256(descriptor),resourcesSha256:await followerRomSha256(resources),effectsSha256:effectsManifest.sha256,interactionsSha256:interactionManifest.dataSha256,emotesSha256:interactionManifest.emotesSha256,dialoguesSha256:await followerRomSha256(dialogues),surfSha256:await followerRomSha256(surf),surfRegistrySha256:await followerRomSha256(surfRegistry),landRiderSha256:await followerRomSha256(rider),landAnchorsSha256:await followerRomSha256(anchors)};
    Object.assign(project.fileSystem!.additions!,{
      [FOLLOWER_DLL_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/PokewebFollowingFieldW2.dll',import.meta.url))),
      [FOLLOWER_EVENTS_DLL_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/PokewebFollowingEventsW2.dll',import.meta.url))),
      [FOLLOWER_CORE_DLL_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/PokewebFollowingCoreW2.dll',import.meta.url))),
      [FOLLOWER_RUNTIME_REGISTRY_PATH]:registry,[FOLLOWER_DESCRIPTOR_PATH]:descriptor,[FOLLOWER_RESOURCE_PATH]:resources,
      [FOLLOWER_INTERACTIONS_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/interactions.bin',import.meta.url))),
      [FOLLOWER_EMOTES_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/interaction-emotes.narc',import.meta.url))), [FOLLOWER_DIALOGUE_NARC_PATH]:dialogues,
      [FOLLOWER_NATIVE_PATH]:config,[FOLLOWER_INSTALL_PATH]:new TextEncoder().encode(JSON.stringify(state)),
      [FOLLOWER_LAND_RIDER_PATH]:rider,[FOLLOWER_LAND_ANCHORS_PATH]:anchors,
      [FOLLOWER_SURF_RESOURCE_PATH]:surf,[FOLLOWER_SURF_REGISTRY_PATH]:surfRegistry,
      [FOLLOWER_EFFECTS_PATH]:new Uint8Array(readFileSync(new URL('../assets/following/hgss-effects.narc',import.meta.url))),
    });
    expect((await readFollowerAlphaInstall(project))?.enabled).toBe(true);
    await writeFollowerDialogueRules(project,[{zone:42,type:10,text:"{nickname} likes {location}!"}]);
    expect(await readFollowerDialogueRules(project)).toEqual([{zone:42,type:10,text:"{nickname} likes {location}!"}]);
    await setFollowerAlphaEnabled(project,false);expect((await readFollowerAlphaInstall(project))?.enabled).toBe(false);
    expect(new DataView(project.fileSystem!.additions![FOLLOWER_NATIVE_PATH].buffer).getUint32(4,true)).toBe(0);
    expect(project.fileSystem!.additions!['unrelated.bin']).toEqual(Uint8Array.of(9));
    await expect(setFollowerAlphaEnabled(project,true)).rejects.toThrow(/audited revision-0/); // synthetic fixture is not a compatible ROM
    const effects=project.fileSystem!.additions![FOLLOWER_EFFECTS_PATH];effects[100]^=1;
    await expect(setFollowerAlphaEnabled(project,false)).rejects.toThrow(/effect assets have changed/);
    effects[100]^=1;
    const events=project.fileSystem!.additions![FOLLOWER_EVENTS_DLL_PATH];events[32]^=1;
    const fingerprints=()=>Object.entries(project.fileSystem!.additions!).map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]).sort(([a],[b])=>a.localeCompare(b));
    const beforeEvents=fingerprints();
    await expect(setFollowerAlphaEnabled(project,false)).rejects.toThrow(/event module has changed/);expect(fingerprints()).toEqual(beforeEvents);
    events[32]^=1;
    project.fileSystem!.additions![FOLLOWER_NATIVE_PATH]=config.slice();project.fileSystem!.additions![FOLLOWER_NATIVE_PATH][18]^=1;
    const before=fingerprints();
    await expect(setFollowerAlphaEnabled(project,false)).rejects.toThrow(/changed/);expect(fingerprints()).toEqual(before);
  });
});

import { validateFollowerInteractions } from "../pokeweb/followingPokemonInteractions";
import { decodeFollowerDialogueNarc, encodeFollowerDialogueNarc } from "../pokeweb/followingPokemonDialogues";
describe("conversation packages",()=>{
  it("validates references and survives export normalization",()=>{
    const data=new Uint8Array(readFileSync(new URL('../assets/following/interactions.bin',import.meta.url)));
    const emotes=new Uint8Array(readFileSync(new URL('../assets/following/interaction-emotes.narc',import.meta.url)));
    expect(()=>validateFollowerInteractions(data,emotes)).not.toThrow();
    expect(repairNarcBytes(emotes).changed).toBe(false);
    expect(new NARC(emotes).files).toHaveLength(14);
    for(const at of [0,4,8,12,16,24,data.length-1]){const bad=data.slice();bad[at]^=128;expect(()=>validateFollowerInteractions(bad,emotes)).toThrow();}
    const bad=data.slice();new DataView(bad.buffer).setUint32(24,0xfffffffc,true);new DataView(bad.buffer).setUint32(12,followerCrc32(bad.subarray(16)),true);
    expect(()=>validateFollowerInteractions(bad,emotes)).toThrow();
    emotes[100]^=1;expect(()=>validateFollowerInteractions(data,emotes)).toThrow();
  });
  it("round-trips ordered zone, species and type dialogue rules through a follower-owned NARC",()=>{
    const archive=encodeFollowerDialogueNarc([{zone:42,type:10,text:"{nickname} likes {location}!"},{zone:42,species:644,form:0,text:"{nickname} crackles."}]);
    expect(new NARC(archive).files).toHaveLength(1);
    expect(decodeFollowerDialogueNarc(archive)).toEqual([{zone:42,type:10,text:"{nickname} likes {location}!"},{zone:42,species:644,form:0,text:"{nickname} crackles."}]);
    const corrupt=archive.slice();corrupt[64]^=1;expect(()=>decodeFollowerDialogueNarc(corrupt)).toThrow();
  });
  it("uses archive size rather than an arbitrary dialogue-rule count",()=>{
    const rules=Array.from({length:167},(_,zone)=>({zone,text:"X"}));
    expect(decodeFollowerDialogueNarc(encodeFollowerDialogueNarc(rules))).toEqual(rules);
    expect(()=>encodeFollowerDialogueNarc([...rules,{zone:0,text:"X"}])).toThrow(/4 KiB/);
  });
});
