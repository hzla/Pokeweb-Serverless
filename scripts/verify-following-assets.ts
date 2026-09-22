import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import contract from "../runtime/following-pokemon/contract.json";
import { buildFollowerCatalog, encodeFollowerRegistry, decodeFollowerRegistry, readFollowerStockAppearances, followerPreview, followerKey } from "../src/pokeweb/followingPokemonModel";
import { buildGen5FollowerArchives } from "../src/pokeweb/followingPokemonProject";
const filename=process.argv[2];
if(!filename) throw new Error("Usage: vite-node scripts/verify-following-assets.ts ROM.nds");
const bytes=new Uint8Array(readFileSync(filename));
if(createHash("sha256").update(bytes).digest("hex")!==contract.target.sha256) throw new Error("Wrong clean-ROM SHA-256.");
const rom=new NintendoDSRom(bytes,{fileData:"view"});
const archive=(name:string)=>new NARC(rom.files[rom.filenames.idOf(name)!]);
const personal=archive("a/0/1/6"),descriptors=archive("a/0/4/7"),resources=archive("a/0/4/8");
const appearances=readFollowerStockAppearances(rom.files[rom.filenames.idOf("a/2/0/8")!]);
const registry=buildFollowerCatalog(personal.files,appearances,descriptors.files[0],resources.files);
const binary=encodeFollowerRegistry(registry),roundtrip=decodeFollowerRegistry(binary);
if(roundtrip.entries.length!==registry.entries.length)throw new Error("Registry round trip failed.");
const unique=new Set<string>();
for(const entry of registry.entries){
  const key=`${entry.resourceId}:${entry.animationProfile}`;
  if(unique.has(key))continue;unique.add(key);
  for(const direction of ["up","down","left","right"] as const)for(const tick of [0,5,10,15])
    followerPreview(resources.files[entry.resourceId],entry.animationProfile,direction,tick);
}
const gen5Bundle=new Uint8Array(readFileSync(new URL("../src/assets/following/gen5-followers.narc",import.meta.url)));
const gen5Manifest=JSON.parse(readFileSync(new URL("../src/assets/following/gen5-followers.json",import.meta.url),"utf8")) as {resources:Array<{size:number;sourceFrameIndices:number[];paletteRepairs:number[]}>};
for(const item of gen5Manifest.resources){
  const expected=item.size===64?[0,1,2,3,4,5]:[0,1,2,3,4,5,6,7];
  if(item.sourceFrameIndices.length!==expected.length||item.sourceFrameIndices.some((value,index)=>value!==expected[index]))throw new Error("Gen 5 up/down source-frame order regressed.");
  if(!Array.isArray(item.paletteRepairs)||item.paletteRepairs.some((value,index)=>!Number.isInteger(value)||value<1||value>15||(index>0&&value<=item.paletteRepairs[index-1])))throw new Error("Invalid Gen 5 palette-repair metadata.");
}
const expanded=buildGen5FollowerArchives(rom.files[rom.filenames.idOf("a/0/1/6")!],rom.files[rom.filenames.idOf("a/2/0/8")!],
  rom.files[rom.filenames.idOf("a/0/4/7")!],rom.files[rom.filenames.idOf("a/0/4/8")!],gen5Bundle);
const expandedDescriptors=new NARC(expanded.descriptors),expandedResources=new NARC(expanded.resources),decodedExpanded=decodeFollowerRegistry(expanded.registryBytes);
if(expandedDescriptors.files.length!==1||new DataView(expandedDescriptors.files[0].buffer,expandedDescriptors.files[0].byteOffset).getUint32(0,true)!==expanded.registry.descriptorCount)
  throw new Error("Expanded descriptor archive count mismatch.");
if(expandedResources.files.length!==expanded.registry.resourceCount||decodedExpanded.entries.length!==expanded.registry.entries.length)
  throw new Error("Expanded resource/registry count mismatch.");
const gen5=expanded.registry.entries.filter(entry=>entry.key.species>=494);
if(gen5.length!==624||gen5.some(entry=>entry.placeholder))throw new Error("Bundled Gen 5 appearance coverage is incomplete.");
for(const entry of gen5)for(const direction of ["up","down","left","right"] as const)for(const tick of [0,10]){
  const preview=followerPreview(expandedResources.files[entry.resourceId],entry.animationProfile,direction,tick);
  for(let pixel=0;pixel<preview.rgba.length;pixel+=4)if(preview.rgba[pixel]>=248&&preview.rgba[pixel+1]<=8&&preview.rgba[pixel+2]>=248&&preview.rgba[pixel+3])
    throw new Error(`Visible sentinel magenta in Gen 5 appearance ${followerKey(entry.key)}.`);
}
const output=path.resolve("runtime/following-pokemon/build");mkdirSync(output,{recursive:true});
writeFileSync(path.join(output,"catalog.json"),JSON.stringify(registry,null,2)+"\n");
writeFileSync(path.join(output,"registry.bin"),binary);
const report={species:new Set(registry.entries.map(e=>e.key.species)).size,appearances:registry.entries.length,
  placeholders:registry.entries.filter(e=>e.placeholder).length,exactAppearances:registry.entries.filter(e=>!e.placeholder).length,
  uniqueResources:unique.size,registryBytes:binary.length,descriptorBytes:4+registry.descriptorCount*28,
  formSubstitutions:registry.entries.filter(e=>e.placeholderReason?.includes("Form artwork")).map(e=>followerKey(e.key)),
  gen5Appearances:gen5.length,gen5Placeholders:gen5.filter(entry=>entry.placeholder).length,
  gen5PaletteRepairResources:gen5Manifest.resources.filter(item=>item.paletteRepairs.length).length,
  gen5PaletteRepairEntries:gen5Manifest.resources.reduce((sum,item)=>sum+item.paletteRepairs.length,0),
  expandedDescriptors:expanded.registry.descriptorCount,expandedResources:expanded.registry.resourceCount,
  runtimeTested:false};
writeFileSync(path.join(output,"asset-verification.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,formSubstitutions:report.formSubstitutions.length},null,2));
