// File-level migration check. No emulator is launched.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { followerCrc32 } from "../src/pokeweb/followingPokemonModel";
import runtimeManifest from "../src/assets/following/runtime.json";
import { checkFollowerCompatibility, installFollowerAlpha, readFollowerAlphaInstall, setFollowerAlphaEnabled, followerRomSha256, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_INSTALL_PATH, FOLLOWER_RUNTIME_VERSION } from "../src/pokeweb/followingPokemonProject";
const [inputPath, previousModule] = process.argv.slice(2);
if (!inputPath || !previousModule) throw new Error("Expected clean IRDO ROM and a recognized previously released follower DLL");
globalThis.fetch=(async(input:RequestInfo|URL)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.protocol!=="file:")throw new Error(`Expected local asset ${url}`);
 return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(inputPath)),basename(inputPath),{selectedNarcs:[]});
// Failed asset fetch and binary conflicts must not stage even PMC or a receipt.
const fetchAssets=globalThis.fetch;
const beforeArm9=project.arm9.slice(), beforeFiles=structuredClone(project.fileSystem), beforePatches=structuredClone(project.patches);
for (const badAsset of ["PokewebFollowingFieldW2.dll","PokewebFollowingEventsW2.dll","interactions.bin","interaction-emotes.narc"]) {
 globalThis.fetch=(async(input:RequestInfo|URL)=>String(input).includes(badAsset) ? new Response(Uint8Array.of(0)) : fetchAssets(input)) as typeof fetch;
 await assert.rejects(()=>installFollowerAlpha(project),/fingerprint mismatch/);
 assert.deepEqual(project.arm9,beforeArm9);assert.deepEqual(project.fileSystem,beforeFiles);assert.deepEqual(project.patches,beforePatches);
}
globalThis.fetch=fetchAssets;
const {default:contract}=await import("../runtime/following-pokemon/contract.json");
const site=contract.hooks.find(h=>h.id==="follower-grid-event")!;
const {NintendoDSRom}=await import("../src/nds/rom");const {loadOverlayTable}=await import("../src/nds/code");
const source=new NintendoDSRom(project.originalRomBytes!,{fileData:"view"});
const residentSite=contract.hooks.find(h=>h.id==="event-opcode-fetch")!;
project.arm9[residentSite.address-source.arm9RamAddress]^=1;
assert.equal((await checkFollowerCompatibility(project)).compatible,false);
await assert.rejects(()=>installFollowerAlpha(project),/modified|conflict/);
assert.deepEqual(project.fileSystem,beforeFiles);
project.arm9[residentSite.address-source.arm9RamAddress]^=1;
const overlay=loadOverlayTable(source.arm9OverlayTable,(_id,fileId)=>source.files[fileId],new Set([36])).get(36)!;
const originalOverlay=project.overlays[36];project.overlays[36]=overlay.data.slice();project.overlays[36][site.address-overlay.ramAddress]^=1;
assert.equal((await checkFollowerCompatibility(project)).compatible,false);
await assert.rejects(()=>installFollowerAlpha(project),/modified|conflict/);
assert.deepEqual(project.fileSystem,beforeFiles);
if(originalOverlay)project.overlays[36]=originalOverlay;else delete project.overlays[36];
await installFollowerAlpha(project);await setFollowerAlphaEnabled(project,false);
const current=(await readFollowerAlphaInstall(project))!,oldModule=new Uint8Array(await readFile(previousModule));
stageCodeInjectionDll(project,"PokewebFollowingFieldW2.dll",oldModule);
const files=project.fileSystem!.additions!;
const hash=await followerRomSha256(oldModule),version=runtimeManifest.previousVersions.find(entry=>entry.fieldSha256===hash);
if (!version) throw new Error("Unrecognized previous module fingerprint");
const interactionsSha256="interactionsSha256" in version ? version.interactionsSha256 : undefined;
const emotesSha256="emotesSha256" in version ? version.emotesSha256 : undefined;
const old={...current,eventsSha256:undefined,eventsAbi:undefined,interactionsSha256,emotesSha256,version:version.version,moduleSha256:hash,effectsSha256:version.effectsSha256??undefined};
delete files[FOLLOWER_EVENTS_DLL_PATH];
project.codeInjection!.modules=project.codeInjection!.modules!.filter(module=>module.fileName!=="PokewebFollowingEventsW2.dll");
files[FOLLOWER_INSTALL_PATH]=new TextEncoder().encode(JSON.stringify(old));
if (!interactionsSha256) delete files[FOLLOWER_INTERACTIONS_PATH];
if (!emotesSha256) delete files[FOLLOWER_EMOTES_PATH];
if (!version.effectsSha256) delete files[FOLLOWER_EFFECTS_PATH];
files["following/user-art.bin"]=Uint8Array.of(1,2,3);
assert.equal((await readFollowerAlphaInstall(project))!.version,version.version);
// Updating a conversation alpha must also protect its existing interaction data.
for (const path of [FOLLOWER_INTERACTIONS_PATH,FOLLOWER_EMOTES_PATH]) {
 const data=files[path];if (!data) continue;
 data[100]^=1;
 const snapshot=structuredClone(project.fileSystem),arm9=project.arm9.slice();
 await assert.rejects(()=>installFollowerAlpha(project),/interaction assets have changed/);
 assert.deepEqual(project.fileSystem,snapshot);assert.deepEqual(project.arm9,arm9);
 data[100]^=1;
}
const reopened=await loadProjectFromRomBytes(await exportModifiedRom(project),"old-follower.nds",{selectedNarcs:[]});
const upgraded=await installFollowerAlpha(reopened);
assert.equal(upgraded.version,FOLLOWER_RUNTIME_VERSION);assert.equal(upgraded.enabled,false);
assert.equal(upgraded.configCrc32,followerCrc32(files[FOLLOWER_NATIVE_PATH]));
assert.deepEqual(Object.keys(reopened.fileSystem!.additions!).sort(),[FOLLOWER_EVENTS_DLL_PATH,...(version.effectsSha256?[]:[FOLLOWER_EFFECTS_PATH]),...(interactionsSha256?[]:[FOLLOWER_INTERACTIONS_PATH]),...(emotesSha256?[]:[FOLLOWER_EMOTES_PATH])].sort());
const restored=await loadProjectFromRomBytes(await exportModifiedRom(reopened),"upgraded-follower.nds",{selectedNarcs:[]});
assert.deepEqual(await readFollowerAlphaInstall(restored),upgraded);
const restoredRom=new NintendoDSRom(restored.originalRomBytes!,{fileData:"view"});
assert.deepEqual(restoredRom.files[restoredRom.filenames.idOf("following/user-art.bin")!],Uint8Array.of(1,2,3));
assert.equal(restored.codeInjection!.modules!.filter(x=>x.fileName==="PokewebFollowingFieldW2.dll").length,1);
assert.equal(restored.codeInjection!.modules!.filter(x=>x.fileName==="PokewebFollowingEventsW2.dll").length,1);
console.log(`${version.version} export/reopen/update to current version passed; disabled setting and config retained, one field and one resident module, effects archive owned without duplicates.`);
