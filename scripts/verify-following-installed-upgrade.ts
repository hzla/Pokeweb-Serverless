// Verifies migration from a real exported follower alpha. No emulator is run.
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeFollowerRegistry, deriveFollowerSpacing } from "../src/pokeweb/followingPokemonModel";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { installFollowerAlpha, readFollowerAlphaInstall, followerRuntimeVersion, followerProfile, readFollowingFile, readFollowerDialogueRules, writeFollowerDialogueRules, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH } from "../src/pokeweb/followingPokemonProject";

const inputPath=process.argv[2];
if(!inputPath)throw new Error("Expected a previously exported follower alpha ROM");
globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.protocol!=="file:")throw new Error(`Expected local asset ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const input=new Uint8Array(await readFile(inputPath));
const project=await loadProjectFromRomBytes(input,basename(inputPath),{selectedNarcs:[]});
const profile=await followerProfile(project);
const currentVersion=await followerRuntimeVersion(project);
const before=await readFollowerAlphaInstall(project);
if(!before||before.version===currentVersion)throw new Error("Expected a recognized previous follower alpha");
const authoredDialogue=[{zone:427,species:151,text:"{player}'s {nickname} Aspertia City Test"}];
await writeFollowerDialogueRules(project,authoredDialogue);
assert.deepEqual(await readFollowerDialogueRules(project),authoredDialogue);
const rom=new NintendoDSRom(input,{fileData:"view"});
const previousRegistry=readFollowingFile(project,rom,FOLLOWER_RUNTIME_REGISTRY_PATH)!;
const previousDescriptors=readFollowingFile(project,rom,FOLLOWER_DESCRIPTOR_PATH)!;
const previousResources=readFollowingFile(project,rom,FOLLOWER_RESOURCE_PATH)!;
const upgraded=await installFollowerAlpha(project);
if(before.coreSha256) {
  const compact=readFollowingFile(project,rom,FOLLOWER_RUNTIME_REGISTRY_PATH)!;
  const expected=decodeFollowerRegistry(previousRegistry);
  deriveFollowerSpacing(expected,new NARC(previousResources).files);
  assert.deepEqual(decodeFollowerRegistry(compact),expected);
  assert.ok(compact.length<=previousRegistry.length);
  assert.deepEqual(readFollowingFile(project,rom,FOLLOWER_DESCRIPTOR_PATH),previousDescriptors);
  assert.deepEqual(readFollowingFile(project,rom,FOLLOWER_RESOURCE_PATH),previousResources);
}
assert.equal(upgraded.version,currentVersion);
assert.equal(upgraded.enabled,before.enabled);
assert.deepEqual(await readFollowerDialogueRules(project),authoredDialogue);
const exported=await exportModifiedRom(project);
const reopened=await loadProjectFromRomBytes(exported,"upgraded-follower.nds",{selectedNarcs:[]});
assert.deepEqual(await readFollowerAlphaInstall(reopened),upgraded);
assert.deepEqual(await readFollowerDialogueRules(reopened),authoredDialogue);
for(const name of ["Field","Events","Core"].map(part=>`PokewebFollowing${part}${profile==="black2"?"B2":"W2"}.dll`))
  assert.equal(reopened.codeInjection!.modules!.filter(module=>module.fileName===name).length,1);
console.log(`${before.version} installed ROM upgraded to ${upgraded.version}; enabled state and authored zone-427 Mew dialogue retained, three runtime modules present once, export/reopen recognized.`);
