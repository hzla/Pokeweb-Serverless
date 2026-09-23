// Builds a manual-test ROM; Italian builds only carry forward an Italian alpha save.
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { installFollowerAlpha, followerRomSha256, followerProfile } from "../src/pokeweb/followingPokemonProject";
import { getTestBattleConfig, loadTestBattleSave, toDesmumeDsv } from "../src/pokeweb/testBattle";
const [inputPath, outputPath="runtime/following-pokemon/build/manual-test"] = process.argv.slice(2);
if (!inputPath) throw new Error("Expected an audited Black 2, White 2, Italian White 2, or White2Upgrade ROM path and optional output directory");
globalThis.fetch=(async(input:RequestInfo|URL)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.protocol!=="file:")throw new Error(`Expected local asset ${url}`);
 return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project=await loadProjectFromRomBytes(new Uint8Array(await readFile(inputPath)),basename(inputPath),{selectedNarcs:[]});
const profile=await followerProfile(project);
const explicitSave=process.argv[4];
if(profile==="white2italy"&&explicitSave)throw new Error("Italian builds accept only the existing Italian alpha save family; copy a save manually if needed.");
const state=await installFollowerAlpha(project);
await installFollowerAlpha(project); // Idempotent installation must not duplicate modules.
// This batch command only installs the follower. Discard read-only editor stores
// so unrelated automatic form-name repairs do not become part of the test patch.
project.narcs = {};
const rom=await exportModifiedRom(project);
const prefix=profile === "white2upgrade" ? "White2Upgrade-Following" : profile === "black2" ? "Black2-Following" : profile === "white2italy" ? "White2Italy-Following" : "White2-Following";
const output=resolve(outputPath),name=`${prefix}-${state.version}`;
await mkdir(output,{recursive:true});
await writeFile(join(output,name+".nds"),rom);
if(profile!=="white2italy"){
 const save=await loadTestBattleSave(getTestBattleConfig("BW2"));
 await writeFile(join(output,name+".sav"),save.rawSaveBytes,{flag:"wx"}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="EEXIST")throw error;});
 await writeFile(join(output,name+".dsv"),toDesmumeDsv(save.rawSaveBytes),{flag:"wx"}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="EEXIST")throw error;});
}
await writeFile(join(output,"build.json"),JSON.stringify({version:state.version,profile,rom:name+".nds",sha256:await followerRomSha256(rom),moduleSha256:state.moduleSha256,eventsSha256:state.eventsSha256,eventsAbi:state.eventsAbi,coreSha256:state.coreSha256,coreAbi:state.coreAbi,registrySha256:state.registrySha256,descriptorsSha256:state.descriptorsSha256,resourcesSha256:state.resourcesSha256,effectsSha256:state.effectsSha256,interactionsSha256:state.interactionsSha256,emotesSha256:state.emotesSha256,dialoguesSha256:state.dialoguesSha256,itemsSha256:state.itemsSha256,languageSha256:state.languageSha256,gameEmulatorValidation:"Pending human testing"},null,2)+"\n");
// Deliver versioned alphas beside the workspace (Repos/ in this checkout).
const deliveryDirectory=fileURLToPath(new URL("../../../",import.meta.url));
const deliveryPath=join(deliveryDirectory,name+".nds");
if (resolve(deliveryPath)!==join(output,name+".nds")) {
 const source=join(output,name+".nds");
 // APFS clone avoids a second multi-hundred-megabyte allocation for the
 // versioned local test copy. Other platforms use an ordinary copy.
 if(process.platform==="darwin") await promisify(execFile)("cp",["-c",source,deliveryPath]).catch(()=>copyFile(source,deliveryPath));
 else await copyFile(source,deliveryPath);
}
const parseVersion=(value:string)=>{const match=/^(\d+)\.(\d+)\.(\d+)-alpha$/.exec(value);return match?match.slice(1).map(Number):undefined;};
const compareVersion=(a:number[],b:number[])=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
const currentVersion=parseVersion(state.version)!;
const priorSaves=(await readdir(deliveryDirectory)).flatMap(file=>{
 const match=/^((?:Black2|White2(?:Italy|Upgrade)?)-Following)-(\d+\.\d+\.\d+-alpha)\.sav$/.exec(file),version=match && match[1] === prefix && parseVersion(match[2]);
 return version&&compareVersion(version,currentVersion)<0?[{file,version}]:[];
}).sort((a,b)=>compareVersion(a.version,b.version));
const deliverySave=join(deliveryDirectory,name+".sav");
const previousSave=priorSaves.at(-1)?.file;
// Keep save families separate: an expansion build must not inherit the stock alpha save.
const saveSource=explicitSave?resolve(explicitSave):previousSave?join(deliveryDirectory,previousSave):profile==="white2italy"?undefined:join(output,name+".sav");
let saveMessage=`Save preserved: ${deliverySave}`;
if(saveSource)await writeFile(deliverySave,await readFile(saveSource),{flag:"wx"}).then(()=>{
 saveMessage=`Alpha save copy: ${deliverySave} (from ${saveSource})`;
}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="EEXIST")throw error;});
else saveMessage="No Italian save was copied; existing saves are unchanged.";
console.log(`Manual-test ROM: ${join(output,name+".nds")}\nNo emulator was started.`);
console.log(`Alpha delivery copy: ${deliveryPath}\n${saveMessage}`);
