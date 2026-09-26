// Verify an actual exported alpha ROM can be reopened/toggled without duplicate files.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { decodeFollowerRegistry, encodeFollowerFrames, followerKey, validateFollowerLandAnchors } from "../src/pokeweb/followingPokemonModel";
import { installFollowerAlpha, readFollowerAlphaInstall, setFollowerAlphaEnabled, removeFollowerAlpha, followerProfile, followerRom, followerArtworkPending, prepareFollowerWorkspace, replaceFollowerAssets, updateFollowerPositioning, readFollowingFile, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH, FOLLOWER_DLL_PATH, FOLLOWER_EVENTS_DLL_PATH, FOLLOWER_CORE_DLL_PATH, FOLLOWER_DLL_B2_PATH, FOLLOWER_EVENTS_B2_DLL_PATH, FOLLOWER_CORE_B2_DLL_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_LANGUAGE_PATH } from "../src/pokeweb/followingPokemonProject";
import { FOLLOWER_POSITIONING_PATH, decodeFollowerPositioningNarc } from "../src/pokeweb/followingPokemonPositioning";
import { decodeGen5TextBank } from "../src/pokeweb/text";
function optionsEntries(rom: NintendoDSRom) {
 const archive = new NARC(rom.files[rom.filenames.idOf("a/0/0/2")!]);
 return decodeGen5TextBank(archive.files[32]).map(entry => entry[1]);
}
const optionsIds = [6, 21, 22, 30];
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
const installedOptions = optionsEntries(original);
const expectedOptions = profile === "white2italy" ? ["SEGUACI", "SÌ", "NO", "Scegli se mostrare i Pokémon che ti seguono."] : ["FOLLOWERS", "ON", "OFF", "Choose whether Pokémon follow you."];
if (optionsIds.some((id, index) => installedOptions[id] !== expectedOptions[index])) throw new Error("Installed Options row text is missing");
if (optionsEntries(disabled).some((entry, id) => entry !== installedOptions[id]) ||
 optionsEntries(restored).some((entry, id) => entry !== installedOptions[id])) throw new Error("ROM-wide enable switch changed the Options text");
const followerRows = decodeFollowerRegistry(original.files[original.filenames.idOf(FOLLOWER_RUNTIME_REGISTRY_PATH)!]).entries;
const descriptorMember = new NARC(original.files[original.filenames.idOf(FOLLOWER_DESCRIPTOR_PATH)!]).files[0];
if(followerRows.some(entry => descriptorMember[4 + entry.descriptorRow * 28 + 4] !== 1))
 throw new Error("An installed follower descriptor does not enable the native ground shadow");
for (const file of [...modules, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH,
  FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_POSITIONING_PATH,
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
const removedOptions=optionsEntries(removedRom);
if(optionsIds.some(id=>removedOptions[id].trim()))throw new Error("Removal did not restore reserved Options text");
if(removedOptions.some((entry,id)=>!optionsIds.includes(id)&&entry!==installedOptions[id]))throw new Error("Removal changed an unrelated Options text entry");
const {parseRpm}=await import("../src/pokeweb/rpm");
for(const path of modules) if(parseRpm(removedRom.files[removedRom.filenames.idOf(path)!],{allowedMagics:["DLXF"]}).relocations.length)throw new Error("Removed module still has hooks");
await removeFollowerAlpha(removed); // idempotent, with retained imported data
await installFollowerAlpha(removed);
const reinstalled=await loadProjectFromRomBytes(await exportModifiedRom(removed),"reinstalled.nds",{selectedNarcs:[]});
if(!(await readFollowerAlphaInstall(reinstalled))?.enabled)throw new Error("Reinstall failed");
console.log("Removal/export/reopen/reinstall passed: no follower hooks after removal; owned resources retained and reusable.");
const activeRom = await followerRom(reinstalled);
const positionedWorkspace = await prepareFollowerWorkspace(reinstalled, activeRom);
const positionedEntry = positionedWorkspace.registry.entries[0];
if (!positionedEntry) throw new Error("Installed follower catalog is empty");
await updateFollowerPositioning(reinstalled, activeRom, { landKey: followerKey(positionedEntry.key), gaps: [1, 2, 3, 4], rider: [[0, 0], [0, 0], [0, 0], [0, 0]] });
const surfList = readFollowingFile(reinstalled, activeRom, FOLLOWER_SURF_REGISTRY_PATH)!;
const surfSpecies = surfList[16] | surfList[17] << 8;
await updateFollowerPositioning(reinstalled, activeRom, { surfKey: `${surfSpecies}:${surfList[18]}:${surfList[19]}:${surfList[20]}`,
 rider: [[1, -1], [0, 0], [0, 0], [0, 0]] });
const positionedBytes = await exportModifiedRom(reinstalled);
const positioned = await loadProjectFromRomBytes(positionedBytes, "positioned.nds", { selectedNarcs: [] });
const positionedRom = await followerRom(positioned);
if (!(await readFollowerAlphaInstall(positioned))?.enabled) throw new Error("Positioned installation did not reopen");
const registry = readFollowingFile(positioned, positionedRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!;
const surfRegistry = readFollowingFile(positioned, positionedRom, FOLLOWER_SURF_REGISTRY_PATH)!;
const positioning = readFollowingFile(positioned, positionedRom, FOLLOWER_POSITIONING_PATH)!;
const rows = decodeFollowerPositioningNarc(positioning, registry, surfRegistry);
const row = (positionedEntry.descriptorRow - 1008) * 12;
if (rows.land.subarray(row, row + 4).some((value, index) => value !== index + 1) ||
 rows.surf[0] !== 1 || rows.surf[1] !== 255) throw new Error("Authored land/Surf positioning was not retained");
console.log("Appearance positioning edit/export/reopen passed for land and Surf rows.");
if (profile === "stock") {
 const workspace = positionedWorkspace;
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
