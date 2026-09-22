// Verify an actual exported alpha ROM can be reopened/toggled without duplicate files.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { installFollowerAlpha, readFollowerAlphaInstall, setFollowerAlphaEnabled, removeFollowerAlpha, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH } from "../src/pokeweb/followingPokemonProject";
const path = process.argv[2];
if (!path) throw new Error("Expected an exported walking-alpha ROM");
const input = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(input, basename(path), { selectedNarcs: [] });
if (!(await readFollowerAlphaInstall(project))?.enabled) throw new Error("Exported install was not recognized");
await installFollowerAlpha(project);
await setFollowerAlphaEnabled(project, false);
const disabled = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const config = disabled.files[disabled.filenames.idOf(FOLLOWER_NATIVE_PATH)!];
if (new DataView(config.buffer, config.byteOffset, config.byteLength).getUint32(4, true) !== 0) throw new Error("Disabled export still enabled");
await setFollowerAlphaEnabled(project, true);
const restored = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const original = new NintendoDSRom(input, { fileData: "view" });
for (const file of [FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH]) {
 const a = original.files[original.filenames.idOf(file)!], b = restored.files[restored.filenames.idOf(file)!];
 if (a.length !== b.length || a.some((value, i) => value !== b[i])) throw new Error(`Reenable changed ${file}`);
}
if (Object.keys(project.fileSystem?.additions ?? {}).length) throw new Error("Reopened installation added duplicate files");
console.log("Actual ROM export/reopen/reinstall/disable/reenable passed; owned DLL/config/effects restored exactly, no duplicate files.");

globalThis.fetch=(async(input:RequestInfo|URL)=>new Response(new Uint8Array(await readFile(new URL(input instanceof Request?input.url:String(input)))))) as typeof fetch;
await removeFollowerAlpha(project);
const removedBytes=await exportModifiedRom(project);
const removed=await loadProjectFromRomBytes(removedBytes,"removed.nds",{selectedNarcs:[]});
if(!(await readFollowerAlphaInstall(removed))?.removed) throw new Error("Removed runtime not recognized after reopen");
const removedRom=new NintendoDSRom(removedBytes,{fileData:"view"});
const {parseRpm}=await import("../src/pokeweb/rpm");
for(const path of [FOLLOWER_DLL_PATH,FOLLOWER_EVENTS_DLL_PATH,FOLLOWER_CORE_DLL_PATH]) if(parseRpm(removedRom.files[removedRom.filenames.idOf(path)!],{allowedMagics:["DLXF"]}).relocations.length)throw new Error("Removed module still has hooks");
await removeFollowerAlpha(removed); // idempotent, with retained imported data
await installFollowerAlpha(removed);
const reinstalled=await loadProjectFromRomBytes(await exportModifiedRom(removed),"reinstalled.nds",{selectedNarcs:[]});
if(!(await readFollowerAlphaInstall(reinstalled))?.enabled)throw new Error("Reinstall failed");
console.log("Removal/export/reopen/reinstall passed: no follower hooks after removal; owned resources retained and reusable.");
