// Read-only input ROM; native game execution remains the user's emulator task.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { NintendoDSRom } from "../src/nds/rom";
import { writeRpm } from "../src/pokeweb/rpm";
import { checkFollowerCompatibility, installFollowerAlpha, readFollowerAlphaInstall, readFollowingFile, FOLLOWER_RESOURCE_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH } from "../src/pokeweb/followingPokemonProject";
import { decodeFollowerRegistry, followerPreview } from "../src/pokeweb/followingPokemonModel";
import { NARC } from "../src/nds/narc";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import laterManifest from "../src/assets/following/white2upgrade/later-followers.json";
import contract from "../runtime/following-pokemon/contract.json";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Expected original White2Upgrade ROM and exported follower ROM");
const a = new NintendoDSRom(new Uint8Array(await readFile(input)), {fileData:"view"});
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(output)), basename(output), {selectedNarcs:[]});
const b = new NintendoDSRom(project.originalRomBytes!, {fileData:"view"});
const state = await readFollowerAlphaInstall(project);
if (state?.profile !== "white2upgrade" || !state.enabled) throw new Error("Expansion profile receipt not recognized");
const report = await checkFollowerCompatibility(project);
if (!report.compatible) throw new Error(JSON.stringify(report));
const registry = decodeFollowerRegistry(readFollowingFile(project,b,FOLLOWER_RUNTIME_REGISTRY_PATH)!);
for(let species=1;species<=1023;species++) if(!registry.entries.some(e=>e.key.species===species)) throw new Error(`Unresolved species ${species}`);
const resources = new NARC(readFollowingFile(project,b,FOLLOWER_RESOURCE_PATH)!).files;
const seen = new Set<number>();
for(const entry of registry.entries.filter(e=>e.key.species>=494)) {
 if(seen.has(entry.resourceId))continue;seen.add(entry.resourceId);
 for(const direction of ["up","down","left","right"] as const)for(const tick of [0,10]) {
  const preview=followerPreview(resources[entry.resourceId],entry.animationProfile,direction,tick);
  for(let i=0;i<preview.rgba.length;i+=4)if(preview.rgba[i]>=248&&preview.rgba[i+1]<=8&&preview.rgba[i+2]>=248&&preview.rgba[i+3])throw new Error("Visible sentinel magenta in exported follower resource");
 }
}
for(const resource of laterManifest.resources) {
 const order=resource.size===64?[0,1,2,3,4,5]:[0,1,2,3,4,5,6,7];
 if(JSON.stringify(resource.sourceFrameIndices)!==JSON.stringify(order))throw new Error("Later-generation frame order regressed");
}
function files(folder:typeof a.filenames,prefix=""):Array<[string,number]> {
 return [...folder.files.map((n,i):[string,number]=>[prefix+n,folder.firstId+i]), ...folder.folders.flatMap(([n,f])=>files(f,prefix+n+"/"))];
}
let unchanged=0;
for(const [path,id] of files(a.filenames)) {
 if([FOLLOWER_RESOURCE_PATH,FOLLOWER_DESCRIPTOR_PATH].includes(path))continue;
 const target=b.filenames.idOf(path);if(target===undefined)throw new Error(`Lost original file ${path}`);
 const x=a.files[id],y=b.files[target];
 if(x.length!==y.length || x.some((v,i)=>v!==y[i])) {
  // Standard export may normalize malformed NARC containers; all member bytes must stay identical.
  if(new TextDecoder().decode(x.subarray(0,4))!=="NARC") throw new Error(`Changed unrelated file ${path}`);
  const aa=new NARC(x).files,bb=new NARC(y).files;
  const ownedOptions=new Map([[6,"FOLLOWERS"],[21,"ON"],[22,"OFF"],[30,"Choose whether Pokémon follow you."]]);
  const changed=aa.some((f,j)=>{
   if(path==="a/0/0/2"&&j===32){
    const before=decodeGen5TextBank(f).map(entry=>entry[1]),after=decodeGen5TextBank(bb[j]).map(entry=>entry[1]);
    return before.length!==after.length||before.some((text,id)=>ownedOptions.has(id)?after[id]!==ownedOptions.get(id):after[id]!==text);
   }
   return f.length!==bb[j].length||f.some((v,k)=>v!==bb[j][k]);
  });
  if(aa.length!==bb.length||changed)throw new Error(`Changed unrelated NARC member ${path}`);
 }
 unchanged++;
}
const originalFiles=project.fileSystem;
for(const mode of ["fingerprint","conflict"]) {
 const additions={...originalFiles?.additions};
 if(mode==="fingerprint") {
  const module=readFollowingFile(project,b,"patches/White2Upgrade.dll")!.slice();module[module.length-1]^=1;additions["patches/White2Upgrade.dll"]=module;
 } else {
  const hook=contract.hooks[0];
  additions["patches/ConflictingFollowerTest.dll"]=writeRpm({code:Uint8Array.of(0x70,0x47,0,0),bssSize:0,baseAddress:0,
   symbols:[{name:"conflict",size:4,address:0,type:"FUNCTION_THM",attributes:0}],
   relocations:[{sourceSymbolIndex:0,target:{module:hook.segment,address:hook.address,type:"FULL_COPY"}}],metadata:{PMCGameID:"W2"}},{ident:"DLXF"});
 }
 project.fileSystem={...originalFiles,additions};
 const before=JSON.stringify(project.fileSystem);
 const rejected=await checkFollowerCompatibility(project);if(rejected.compatible)throw new Error(`Accepted ${mode}`);
 let threw=false;try{await installFollowerAlpha(project);}catch{threw=true;}
 if(!threw||JSON.stringify(project.fileSystem)!==before)throw new Error(`Installation mutated project on ${mode}`);
 project.fileSystem=originalFiles;
}
console.log(`White2Upgrade: ${registry.entries.length} appearances cover species 1–1023; ${seen.size} imported resources decoded without visible sentinel magenta; ${unchanged} original file payloads preserved; runtime fingerprint and conflicting hook rejection passed.`);
