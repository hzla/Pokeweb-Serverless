// Verify an actual exported alpha ROM can be reopened/toggled without duplicate files.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { decodeFollowerRegistry, encodeFollowerFrames, validateFollowerLandAnchors } from "../src/pokeweb/followingPokemonModel";
import { installFollowerAlpha, readFollowerAlphaInstall, setFollowerAlphaEnabled, removeFollowerAlpha, followerProfile, followerRom, followerArtworkPending, prepareFollowerWorkspace, replaceFollowerAssets, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH, FOLLOWER_DLL_B2_PATH, FOLLOWER_EVENTS_B2_DLL_PATH, FOLLOWER_CORE_B2_DLL_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_LANGUAGE_PATH } from "../src/pokeweb/followingPokemonProject";
const path = process.argv[2];
if (!path) throw new Error("Expected an exported walking-alpha ROM");
const input = new Uint8Array(await readFile(path));
const project = await loadProjectFromRomBytes(input, basename(path), { selectedNarcs: [] });
const profile = await followerProfile(project);
const modules = profile === "black2" ? [FOLLOWER_DLL_B2_PATH, FOLLOWER_EVENTS_B2_DLL_PATH, FOLLOWER_CORE_B2_DLL_PATH]
  : profile === "white2italy" ? ["patches/PokewebFollowingFieldW2I.dll", "patches/PokewebFollowingEventsW2I.dll", "patches/PokewebFollowingCoreW2I.dll"]
  : [FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH];
if (!(await readFollowerAlphaInstall(project))?.enabled) throw new Error("Exported install was not recognized");
await installFollowerAlpha(project);
await setFollowerAlphaEnabled(project, false);
const disabled = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const config = disabled.files[disabled.filenames.idOf(FOLLOWER_NATIVE_PATH)!];
if (new DataView(config.buffer, config.byteOffset, config.byteLength).getUint32(4, true) !== 0) throw new Error("Disabled export still enabled");
await setFollowerAlphaEnabled(project, true);
const restored = new NintendoDSRom(await exportModifiedRom(project), { fileData: "view" });
const original = new NintendoDSRom(input, { fileData: "view" });
const followerRows = decodeFollowerRegistry(original.files[original.filenames.idOf(FOLLOWER_RUNTIME_REGISTRY_PATH)!]).entries;
const descriptorMember = new NARC(original.files[original.filenames.idOf(FOLLOWER_DESCRIPTOR_PATH)!]).files[0];
if(followerRows.some(entry => descriptorMember[4 + entry.descriptorRow * 28 + 4] !== 1))
 throw new Error("An installed follower descriptor does not enable the native ground shadow");
for (const file of [...modules, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH,
  FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH,
  ...(profile === "white2italy" ? [FOLLOWER_LANGUAGE_PATH] : [])]) {
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
for(const path of modules) if(parseRpm(removedRom.files[removedRom.filenames.idOf(path)!],{allowedMagics:["DLXF"]}).relocations.length)throw new Error("Removed module still has hooks");
await removeFollowerAlpha(removed); // idempotent, with retained imported data
await installFollowerAlpha(removed);
const reinstalled=await loadProjectFromRomBytes(await exportModifiedRom(removed),"reinstalled.nds",{selectedNarcs:[]});
if(!(await readFollowerAlphaInstall(reinstalled))?.enabled)throw new Error("Reinstall failed");
console.log("Removal/export/reopen/reinstall passed: no follower hooks after removal; owned resources retained and reusable.");
if (profile === "stock") {
 const activeRom = await followerRom(reinstalled);
 const workspace = await prepareFollowerWorkspace(reinstalled, activeRom);
 const entry = workspace.registry.entries.find(candidate => candidate.size === 32);
 if (!entry) throw new Error("Stock catalog has no 32-pixel appearance to replace");
 const rgba = new Uint8Array(32 * 32 * 4);
 rgba.set([255, 0, 0, 255], (2 * 32 + 2) * 4);
 const template = new Uint8Array(await readFile(new URL("../src/assets/following/template-32-8.btx", import.meta.url)));
 const art = encodeFollowerFrames(Array.from({ length: 8 }, () => ({ width: 32, height: 32, rgba })), template);
 replaceFollowerAssets(reinstalled, activeRom, [{ key: entry.key, bytes: art, profile: "pokemon-asymmetric", source: "png", label: "test art" }]);
 if (!followerArtworkPending(reinstalled, activeRom)) throw new Error("New stock artwork was not marked pending");
 await installFollowerAlpha(reinstalled, activeRom);
 if (followerArtworkPending(reinstalled, activeRom)) throw new Error("Stock artwork remained pending after installation");
 const artRomBytes = await exportModifiedRom(reinstalled);
 const artRom = new NintendoDSRom(artRomBytes, { fileData: "view" });
 const artRegistry = artRom.files[artRom.filenames.idOf(FOLLOWER_RUNTIME_REGISTRY_PATH)!];
 const artDescriptor = new NARC(artRom.files[artRom.filenames.idOf(FOLLOWER_DESCRIPTOR_PATH)!]).files[0];
 validateFollowerLandAnchors(artRom.files[artRom.filenames.idOf(FOLLOWER_LAND_ANCHORS_PATH)!], artRegistry,
  new DataView(artDescriptor.buffer, artDescriptor.byteOffset, artDescriptor.byteLength).getUint32(0, true));
 const artProject = await loadProjectFromRomBytes(artRomBytes, "replaced-art.nds", { selectedNarcs: [] });
 if (!(await readFollowerAlphaInstall(artProject))?.enabled) throw new Error("Art replacement receipt failed after reopen");
 console.log("Stock artwork replacement/recomputed land anchors/export/reopen passed.");
}
