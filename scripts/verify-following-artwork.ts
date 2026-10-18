import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { buildFollowerCatalog, decodeFollowerRegistry, encodeFollowerRegistry, followerCrc32, encodeFollowerFrames, followerKey,
  readFollowerStockAppearances, encodeFollowerLandAnchors, validateFollowerLandAnchors, followerBillboardDrawMode, followerAnimationSelector } from "../src/pokeweb/followingPokemonModel";
import { prepareFollowerWorkspace, followerRom, followerProfile, readFollowingFile, readFollowerWorkspace,
  readFollowerAsset, replaceFollowerAssets, installFollowerAlpha, readFollowerAlphaInstall,
  followerArtworkPending, followerBundledArtworkPending, followerBillboardRepairPending, followerArtworkReplacementAvailable, FOLLOWER_MANIFEST_PATH, FOLLOWER_DESCRIPTOR_PATH,
  FOLLOWER_RESOURCE_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_NATIVE_PATH, FOLLOWER_INSTALL_PATH, FOLLOWER_LAND_ANCHORS_PATH, FOLLOWER_SURF_REGISTRY_PATH, type FollowerAssetWorkspace } from "../src/pokeweb/followingPokemonProject";
import { encodeFollowerPositioningNarc, FOLLOWER_POSITIONING_PATH } from "../src/pokeweb/followingPokemonPositioning";
import gen5Manifest from "../src/assets/following/gen5-followers.json";

const [input, ...flags] = process.argv.slice(2), riding = flags.includes("--riding");
if (!input) throw new Error("Pass a clean stock Black 2 or White 2 ROM; --riding tests the full package.");
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), basename(input), { selectedNarcs: [] });
const rom = await followerRom(project), profile = await followerProfile(project, rom);
assert.ok(profile === "stock" || profile === "black2");
assert.equal(await followerArtworkReplacementAvailable(project, rom), true);
const originalResources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!.slice();
const originalDescriptors = readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!.slice();
const nativeFiles = new NARC(originalResources).files;
const legacy = buildFollowerCatalog(new NARC(readFollowingFile(project, rom, "a/0/1/6")!).files,
  readFollowerStockAppearances(readFollowingFile(project, rom, "a/2/0/8")!), new NARC(originalDescriptors).files[0], nativeFiles);
const bundle = new NARC(new Uint8Array(await readFile(new URL("../src/assets/following/gen5-followers.narc", import.meta.url))));
const byKey = new Map(gen5Manifest.appearances.map(entry => [`${entry.species}:${entry.form}:${entry.gender}:${Number(entry.shiny)}`, entry]));
function complete(workspace: FollowerAssetWorkspace, files: Uint8Array[], customKey?: string): void {
  assert.equal(new Set(workspace.registry.entries.map(entry => entry.key.species)).size, 649);
  const gen5 = workspace.registry.entries.filter(entry => entry.key.species >= 494);
  assert.equal(gen5.length, 624);
  for (const entry of gen5) {
    assert.equal(entry.placeholder, false, followerKey(entry.key));
    if (followerKey(entry.key) !== customKey) assert.deepEqual(files[entry.resourceId], bundle.files[byKey.get(followerKey(entry.key))!.member]);
  }
}
const prepared = await prepareFollowerWorkspace(project, rom);
assert.ok(prepared.bundledResources);
const previewFiles = [...nativeFiles, ...bundle.files];
complete(prepared, previewFiles);
for (const species of [494, 550, 649]) {
  const entry = prepared.registry.entries.find(entry => entry.key.species === species)!;
  assert.deepEqual(readFollowerAsset(project, rom, prepared, entry), previewFiles[entry.resourceId]);
}
assert.deepEqual(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH), originalResources);
assert.deepEqual(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH), originalDescriptors);
assert.equal(await readFollowerAlphaInstall(project, rom), undefined);
// A historical workspace must migrate before installation without losing edits.
const oldWorkspace = structuredClone(prepared); oldWorkspace.registry = legacy; delete oldWorkspace.bundledResources;
const chosen = oldWorkspace.registry.entries.find(entry => entry.key.species >= 494 && !entry.key.shiny && entry.placeholderReason?.includes("Bulbasaur"))!;
assert.ok(chosen);
chosen.directionalGaps = [1, 2, 3, 4]; chosen.riderAdjustments = [[1, 0], [0, 1], [-1, 0], [0, -1]];
project.fileSystem!.additions![FOLLOWER_MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(oldWorkspace));
async function artwork(size: 32 | 64) {
  const rgba = new Uint8Array(size * size * 4); rgba.set([255, 0, 0, 255], (3 * size + 3) * 4);
  const template = new Uint8Array(await readFile(new URL(`../src/assets/following/template-${size}-8.btx`, import.meta.url)));
  return encodeFollowerFrames(Array.from({ length: 8 }, () => ({ width: size, height: size, rgba })), template);
}
const art32 = await artwork(32), art64 = await artwork(64), key = followerKey(chosen.key);
const legacyImport = replaceFollowerAssets(project, rom, [{ key: chosen.key, bytes: art32, profile: "pokemon-asymmetric", source: "png", label: "Regression artwork" }]);
const migrated = await prepareFollowerWorkspace(project, rom);
complete(migrated, previewFiles, key);
assert.deepEqual(migrated.imports, legacyImport.imports);
assert.deepEqual(migrated.registry.entries.find(entry => followerKey(entry.key) === key)!.directionalGaps, [1, 2, 3, 4]);
assert.deepEqual(readFollowerAsset(project, rom, migrated, migrated.registry.entries.find(entry => followerKey(entry.key) === key)!), art32);
const state = await installFollowerAlpha(project, rom, { riding });
assert.equal(state.variant, riding ? "full" : "base");
assert.equal(followerArtworkPending(project, rom), false);
const installedWorkspace = readFollowerWorkspace(project, rom)!;
assert.equal(installedWorkspace.bundledResources, undefined);
complete(installedWorkspace, new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!).files, key);
// Earlier imports stored correct 32×32 pixels but selected the native 16×16
// frame. Model an owned affected export: matching BTX must still be repairable.
const cropDescriptors = new NARC(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!);
const customEntry = installedWorkspace.registry.entries.find(entry => followerKey(entry.key) === key)!;
const cropAt = 4 + customEntry.descriptorRow * 28 + 7;
assert.equal(cropDescriptors.files[0][cropAt], 0);
cropDescriptors.files[0][cropAt] = 1;
const croppedBytes = cropDescriptors.save(), beforeRepairResources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!.slice();
project.fileSystem!.replacements[rom.filenames.idOf(FOLLOWER_DESCRIPTOR_PATH)!] = croppedBytes;
project.fileSystem!.additions![FOLLOWER_INSTALL_PATH] = new TextEncoder().encode(JSON.stringify({ ...state, descriptorsSha256: sha(croppedBytes) }));
assert.equal(followerArtworkPending(project, rom), false);
assert.equal(followerBillboardRepairPending(project, rom), true);
await installFollowerAlpha(project, rom);
assert.equal(followerBillboardRepairPending(project, rom), false);
assert.deepEqual(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH), beforeRepairResources);
assert.equal(new NARC(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!).files[0][cropAt], 0);
const cropRepairedFiles = project.fileSystem;
await installFollowerAlpha(project, rom); assert.equal(project.fileSystem, cropRepairedFiles);
// Model a recognized old installation that still points Gen 5 fallback rows
// into retail resources, with valid ownership/config checksums.
function bindingFiles(registryBytes: Uint8Array): Record<string, Uint8Array> {
  const registry = decodeFollowerRegistry(registryBytes);
  const anchors = riding ? encodeFollowerLandAnchors(registry, new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!).files, registryBytes) : undefined;
  const surf = riding ? readFollowingFile(project, rom, FOLLOWER_SURF_REGISTRY_PATH) : undefined;
  const positioning = encodeFollowerPositioningNarc(registry, registryBytes, anchors, surf);
  return { [FOLLOWER_POSITIONING_PATH]: positioning, ...(anchors ? { [FOLLOWER_LAND_ANCHORS_PATH]: anchors } : {}) };
}
const oldInstalled = decodeFollowerRegistry(readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
const oldDescriptors = new NARC(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!);
const descriptorView = new DataView(oldDescriptors.files[0].buffer, oldDescriptors.files[0].byteOffset, oldDescriptors.files[0].byteLength);
const legacyByKey = new Map(legacy.entries.map(entry => [followerKey(entry.key), entry]));
for (const entry of oldInstalled.entries) {
  if (entry.key.species < 494 || followerKey(entry.key) === key) continue;
  const original = legacyByKey.get(followerKey(entry.key))!;
  entry.resourceId = original.resourceId; entry.size = original.size; entry.animationProfile = original.animationProfile;
  entry.placeholder = original.placeholder; entry.placeholderReason = original.placeholderReason;
  descriptorView.setUint16(4 + entry.descriptorRow * 28 + 16, entry.resourceId, true);
  oldDescriptors.files[0][4 + entry.descriptorRow * 28 + 7] = followerBillboardDrawMode(entry.size);
}
const oldRegistryBytes = encodeFollowerRegistry(oldInstalled), oldDescriptorBytes = oldDescriptors.save();
const oldConfig = readFollowingFile(project, rom, FOLLOWER_NATIVE_PATH)!.slice(), configView = new DataView(oldConfig.buffer);
configView.setUint32(12, oldRegistryBytes.length, true); configView.setUint32(24, followerCrc32(oldRegistryBytes), true);
const oldBindings = bindingFiles(oldRegistryBytes);
const oldReceipt = { ...state, positioningSha256: sha(oldBindings[FOLLOWER_POSITIONING_PATH]), ...(riding ? { landAnchorsSha256: sha(oldBindings[FOLLOWER_LAND_ANCHORS_PATH]) } : {}), configCrc32: followerCrc32(oldConfig), registrySha256: sha(oldRegistryBytes), descriptorsSha256: sha(oldDescriptorBytes) };
for (const [path, data] of Object.entries({ ...oldBindings, [FOLLOWER_RUNTIME_REGISTRY_PATH]: oldRegistryBytes, [FOLLOWER_DESCRIPTOR_PATH]: oldDescriptorBytes,
  [FOLLOWER_NATIVE_PATH]: oldConfig, [FOLLOWER_INSTALL_PATH]: new TextEncoder().encode(JSON.stringify(oldReceipt)) })) {
  const id = rom.filenames.idOf(path);
  if (id === undefined) project.fileSystem!.additions![path] = data;
  else project.fileSystem!.replacements[id] = data;
}
assert.equal((await readFollowerAlphaInstall(project, rom))?.version, state.version);
assert.equal(followerBundledArtworkPending(project, rom), true);
await installFollowerAlpha(project, rom);
assert.equal(followerBundledArtworkPending(project, rom), false);
const repairedFiles = new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!).files;
// Unflagged native Gen 5 art was already real; default fallback rows are replaced.
for (const entry of decodeFollowerRegistry(readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!).entries) {
  if (entry.key.species < 494 || followerKey(entry.key) === key) continue;
  const original = legacyByKey.get(followerKey(entry.key))!;
  assert.equal(entry.placeholder, false);
  if (original.placeholder) assert.deepEqual(repairedFiles[entry.resourceId], bundle.files[byKey.get(followerKey(entry.key))!.member]);
}
// Restore the all-bundled fixture for subsequent stale-preview assertions.
for (const entry of oldInstalled.entries) {
  if (entry.key.species < 494 || followerKey(entry.key) === key) continue;
  entry.placeholder = true; entry.placeholderReason = "Legacy Gen 5 placeholder";
}
const allLegacyBytes = encodeFollowerRegistry(oldInstalled);
configView.setUint32(12, allLegacyBytes.length, true); configView.setUint32(24, followerCrc32(allLegacyBytes), true);
const allLegacyBindings = bindingFiles(allLegacyBytes);
const allLegacyReceipt = { ...(await readFollowerAlphaInstall(project, rom))!, positioningSha256: sha(allLegacyBindings[FOLLOWER_POSITIONING_PATH]), ...(riding ? { landAnchorsSha256: sha(allLegacyBindings[FOLLOWER_LAND_ANCHORS_PATH]) } : {}), configCrc32: followerCrc32(oldConfig), registrySha256: sha(allLegacyBytes) };
project.fileSystem!.additions![FOLLOWER_RUNTIME_REGISTRY_PATH] = allLegacyBytes;
project.fileSystem!.additions![FOLLOWER_NATIVE_PATH] = oldConfig;
project.fileSystem!.additions![FOLLOWER_INSTALL_PATH] = new TextEncoder().encode(JSON.stringify(allLegacyReceipt));
Object.assign(project.fileSystem!.additions!, allLegacyBindings);
await installFollowerAlpha(project, rom);
complete(readFollowerWorkspace(project, rom)!, new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!).files, key);
const unchangedFiles = project.fileSystem;
await installFollowerAlpha(project, rom); assert.equal(project.fileSystem, unchangedFiles);
const exported = await exportModifiedRom(project);
const reopened = await loadProjectFromRomBytes(exported, "artwork-installed.nds", { selectedNarcs: [] });
const reopenedRom = await followerRom(reopened);
assert.equal((await readFollowerAlphaInstall(reopened, reopenedRom))?.moduleSha256, state.moduleSha256);
// Old serialized editor placeholders must not shadow the completed runtime.
const manifestId = reopenedRom.filenames.idOf(FOLLOWER_MANIFEST_PATH)!;
reopened.fileSystem = { ...reopened.fileSystem, replacements: { ...reopened.fileSystem?.replacements,
  [manifestId]: new TextEncoder().encode(JSON.stringify(legacyImport)) } };
const repairedPreview = readFollowerWorkspace(reopened, reopenedRom)!;
complete(repairedPreview, new NARC(readFollowingFile(reopened, reopenedRom, FOLLOWER_RESOURCE_PATH)!).files, key);
assert.deepEqual(readFollowerAsset(reopened, reopenedRom, repairedPreview, repairedPreview.registry.entries.find(entry => followerKey(entry.key) === key)!), art32);
const beforeArtArm9 = sha(reopened.arm9);
// Exercise both directions of a layout change, at both supported frame sizes.
// Six-frame right uses mirrored left; eight-frame right must use its own poses.
for (const size of [32, 64] as const) for (const count of [8, 6] as const) {
  const desc = new NARC(originalDescriptors).files[0], row = size === 32 ? 378 : 616;
  const source = new DataView(desc.buffer, desc.byteOffset, desc.byteLength).getUint16(4 + row * 28 + 16, true);
  const template = count === 6 ? nativeFiles[source] : new Uint8Array(await readFile(new URL(`../src/assets/following/template-${size}-8.btx`, import.meta.url)));
  const rgba = new Uint8Array(size * size * 4); rgba.set([255, 0, 0, 255], (3 * size + 3) * 4);
  const art = encodeFollowerFrames(Array.from({length: count}, () => ({width: size, height: size, rgba})), template);
  const profile = count === 6 ? "pokemon-mirrored" : "pokemon-asymmetric";
  replaceFollowerAssets(reopened, reopenedRom, [{key: chosen.key, bytes: art, profile, source: "png", label: `${size}-pixel ${count}-pose regression`}]);
  await installFollowerAlpha(reopened, reopenedRom);
  const active = decodeFollowerRegistry(readFollowingFile(reopened, reopenedRom, FOLLOWER_RUNTIME_REGISTRY_PATH)!).entries.find(entry => followerKey(entry.key) === key)!;
  const member = new NARC(readFollowingFile(reopened, reopenedRom, FOLLOWER_DESCRIPTOR_PATH)!).files[0], at = 4 + active.descriptorRow * 28;
  assert.equal(member[at + 9], count === 6 ? 13 : 14);
  assert.equal(active.animationProfile, profile);
  // A recognized old export can have correct pixels and size, but the other
  // layout's animation selector. Repair it without replacing any BTX bytes.
  member[at + 9] = count === 6 ? 14 : 13;
  const archive = new NARC(readFollowingFile(reopened, reopenedRom, FOLLOWER_DESCRIPTOR_PATH)!); archive.files[0] = member;
  const wrong = archive.save(), resourceBefore = readFollowingFile(reopened, reopenedRom, FOLLOWER_RESOURCE_PATH)!.slice();
  const receipt = (await readFollowerAlphaInstall(reopened, reopenedRom))!;
  reopened.fileSystem!.replacements[reopenedRom.filenames.idOf(FOLLOWER_DESCRIPTOR_PATH)!] = wrong;
  reopened.fileSystem!.replacements[reopenedRom.filenames.idOf(FOLLOWER_INSTALL_PATH)!] = new TextEncoder().encode(JSON.stringify({...receipt, descriptorsSha256: sha(wrong)}));
  assert.equal(followerArtworkPending(reopened, reopenedRom), false);
  assert.equal(followerBillboardRepairPending(reopened, reopenedRom), true);
  await installFollowerAlpha(reopened, reopenedRom);
  assert.equal(followerBillboardRepairPending(reopened, reopenedRom), false);
  assert.deepEqual(readFollowingFile(reopened, reopenedRom, FOLLOWER_RESOURCE_PATH), resourceBefore);
}
replaceFollowerAssets(reopened, reopenedRom, [{ key: chosen.key, bytes: art64, profile: "pokemon-asymmetric", source: "png", label: "64-pixel regression artwork" }]);
assert.equal(followerArtworkPending(reopened, reopenedRom), true);
await installFollowerAlpha(reopened, reopenedRom);
assert.equal(followerArtworkPending(reopened, reopenedRom), false);
assert.equal(sha(reopened.arm9), beforeArtArm9);
const finalBytes = await exportModifiedRom(reopened), finalRom = new NintendoDSRom(finalBytes, { fileData: "view" });
const finalProject = await loadProjectFromRomBytes(finalBytes, "artwork-replaced.nds", { selectedNarcs: [] });
assert.equal((await readFollowerAlphaInstall(finalProject))?.moduleSha256, state.moduleSha256);
const registryBytes = finalRom.getFileByName(FOLLOWER_RUNTIME_REGISTRY_PATH), installed = decodeFollowerRegistry(registryBytes);
const result = installed.entries.find(entry => followerKey(entry.key) === key)!;
const resultFiles = new NARC(finalRom.getFileByName(FOLLOWER_RESOURCE_PATH)).files;
assert.equal(result.size, 64); assert.deepEqual(resultFiles[result.resourceId], art64);
assert.equal(result.placeholder, false);
const descriptors = new NARC(finalRom.getFileByName(FOLLOWER_DESCRIPTOR_PATH)).files[0], view = new DataView(descriptors.buffer, descriptors.byteOffset, descriptors.byteLength);
for (const entry of installed.entries) {
  assert.equal(descriptors[4 + entry.descriptorRow * 28 + 7], followerBillboardDrawMode(entry.size), followerKey(entry.key));
  assert.equal(descriptors[4 + entry.descriptorRow * 28 + 9], followerAnimationSelector(entry.animationProfile), followerKey(entry.key));
}
assert.deepEqual(descriptors.subarray(4, 4 + 1008 * 28), new NARC(originalDescriptors).files[0].subarray(4));
assert.equal(view.getUint16(4 + result.descriptorRow * 28 + 16, true), result.resourceId);
assert.equal(descriptors[4 + result.descriptorRow * 28 + 7], 2);
if (riding) validateFollowerLandAnchors(finalRom.getFileByName(FOLLOWER_LAND_ANCHORS_PATH), registryBytes, installed.descriptorCount);
for (let i = 0; i < nativeFiles.length; ++i) assert.deepEqual(resultFiles[i], nativeFiles[i]);
// Export normalizes native NARC container headers; member payloads are invariant.
for (const path of ["a/0/1/6", "a/2/0/8", "a/0/0/3"])
  assert.deepEqual(new NARC(finalRom.getFileByName(path)).files.map(sha), new NARC(readFollowingFile(project, rom, path)!).files.map(sha));
for (const path of [FOLLOWER_RESOURCE_PATH, FOLLOWER_DESCRIPTOR_PATH, "a/0/1/6"]) assert.equal(finalRom.filenames.idOf(path), rom.filenames.idOf(path));
const report = { profile, variant: state.variant, version: state.version, species: 649, bundledGen5Appearances: 624,
  nativeBulbasaurSubstitutions: legacy.entries.filter(entry => entry.placeholderReason?.includes("Bulbasaur")).length,
  preparedBulbasaurSubstitutions: prepared.registry.entries.filter(entry => entry.placeholderReason?.includes("Bulbasaur")).length,
  legacyWorkspaceMigration: true, legacyInstalledCatalogRepair: true, customImportsAndPositioningPreserved: true, stalePreviewReconciled: true,
  custom32And64PixelArtworkInstalled: true, cropped32PixelFrameRepaired: true, allOwnedFrameModesVerified: true,
  sixAndEightPoseLayoutChangesAndRepairsVerified: true,
  nativeResourcesAndFileIdsPreserved: true, unchangedFieldDll: true,
  exportReopen: true, emulatorRun: false };
await mkdir("runtime/following-pokemon/build", { recursive: true });
await writeFile(`runtime/following-pokemon/build/artwork-${profile}-${state.variant}.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
