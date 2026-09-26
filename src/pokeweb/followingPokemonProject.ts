import upgradeRuntimeManifest from "../assets/following/white2upgrade/runtime.json";
import laterManifest from "../assets/following/white2upgrade/later-followers.json";
import upgradeContract from "../../runtime/following-pokemon/upgrade-contract.json";
import interactionManifest from "../assets/following/interactions.json";
import italyInteractionManifest from "../assets/following/white2italy/interactions.json";
import { validateFollowerInteractions } from "./followingPokemonInteractions";
import { FOLLOWER_DIALOGUE_NARC_PATH, decodeFollowerDialogueNarc, encodeFollowerDialogueNarc, type FollowerDialogueRule } from "./followingPokemonDialogues";
import { FOLLOWER_ITEM_NARC_PATH, decodeFollowerItemNarc, encodeFollowerItemNarc, type FollowerItemRule } from "./followingPokemonItems";
import stockRuntimeManifest from "../assets/following/runtime.json";
import black2RuntimeManifest from "../assets/following/black2/runtime.json";
import italyRuntimeManifest from "../assets/following/white2italy/runtime.json";
import gen5Manifest from "../assets/following/gen5-followers.json";
import effectsManifest from "../assets/following/effects.json";
import surfManifest from "../assets/following/surf-mounts.json";
import landRiderManifest from "../assets/following/land-riders.json";
import upgradeSurfManifest from "../assets/following/white2upgrade/surf-mounts.json";
import contract from "../../runtime/following-pokemon/contract.json";
import black2Contract from "../../runtime/following-pokemon/black2-contract.json";
import italyContract from "../../runtime/following-pokemon/italy-contract.json";
import bw2PmcContract from "../../runtime/following-pokemon/bw2-pmc-contract.json";
import italyPmcContract from "../../runtime/following-pokemon/italy-pmc-contract.json";
import { loadOverlayTable } from "../nds/code";
import { NARC } from "../nds/narc";
import { decodeGen5TextBank, encodeGen5TextBank } from "./text";
import { NintendoDSRom } from "../nds/rom";
import { readU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { refreshDecodedTextState } from "./loader";
import type { ProjectState } from "./projectStore";
import { getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { buildFollowerCatalog, deriveFollowerGrounding, deriveFollowerSpacing, encodeFollowerLandAnchors, validateFollowerLandAnchors, followerSideGap, decodeFollowerRegistry, encodeFollowerRegistry, followerCrc32, followerKey, readFollowerStockAppearances, validateFollowerRegistry, validateFollowerResource,
  type FollowerAppearanceKey, type FollowerAssetEntry, type FollowerRegistry } from "./followingPokemonModel";
import { FOLLOWER_POSITIONING_PATH, encodeFollowerPositioningNarc, decodeFollowerPositioningNarc,
  validateSurfAdjustments, type FollowerRiderAdjustments, type FollowerSurfAdjustments } from "./followingPokemonPositioning";

export const FOLLOWER_MANIFEST_PATH = "following/assets.json";
export const FOLLOWER_REGISTRY_PATH = "following/registry.bin";
export const FOLLOWER_RUNTIME_REGISTRY_PATH = "following/runtime-registry.bin";
export const FOLLOWER_CORE_DLL_PATH = "patches/PokewebFollowingCoreW2.dll";
export const FOLLOWER_CORE_B2_DLL_PATH = "patches/PokewebFollowingCoreB2.dll";
export const FOLLOWER_DESCRIPTOR_PATH = "a/0/4/7";
export const FOLLOWER_RESOURCE_PATH = "a/0/4/8";
export const FOLLOWER_SURF_RESOURCE_PATH = "following/surf-mounts.narc";
export const FOLLOWER_SURF_REGISTRY_PATH = "following/surf-registry.bin";
export const FOLLOWER_LAND_RIDER_PATH = "following/land-riders.narc";
export const FOLLOWER_LAND_ANCHORS_PATH = "following/land-anchors.bin";
export type FollowerAssetWorkspace = {
  schemaVersion: 1;
  targetSha256: string;
  registry: FollowerRegistry;
  imports: Record<string, { path: string; crc32: number }>;
  surfAdjustments?: FollowerSurfAdjustments;
};
export type FollowerCompatibility = { compatible: boolean; message: string; checks: Array<{ name: string; passed: boolean }>; installation?: FollowerAlphaInstall };
type FollowerFiles = Pick<NintendoDSRom, "filenames" | "files">;
/** Detached source files needed by the follower editor; never retains the full ROM. */
export type FollowerRom = FollowerFiles & Pick<NintendoDSRom, "idCode" | "arm9RamAddress" | "arm9OverlayTable"> & {
  revision: number;
};
const romHashes = new WeakMap<Uint8Array, Promise<string>>();
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export async function followerRomSha256(bytes: Uint8Array): Promise<string> {
  // Small mutable patch buffers must be rehashed when checking ownership.
  if (bytes.length < 16 * 1024 * 1024) return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
  let promise = romHashes.get(bytes);
  if (!promise) { promise = crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>).then(hash => toHex(new Uint8Array(hash))); romHashes.set(bytes, promise); }
  return promise;
}
export async function followerRom(project: ProjectState, sourceBytes?: Uint8Array): Promise<FollowerRom> {
  const bytes = sourceBytes ?? project.originalRomBytes ?? await loadActiveRomBytes();
  if (!bytes) throw new Error("Reload the project's ROM before preparing follower assets.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const needed = new Set<number>();
  for (const path of ["a/0/0/2", "a/0/1/6", "a/2/0/8", FOLLOWER_DESCRIPTOR_PATH, FOLLOWER_RESOURCE_PATH]) {
    const id = rom.filenames.idOf(path);
    if (id !== undefined) needed.add(id);
  }
  const collect = (folder: typeof rom.filenames, prefix = "") => {
    folder.files.forEach((name, index) => {
      const path = prefix + name;
      if (path.startsWith("following/") || (/^(patches|lib)\//u.test(path) && /\.dll$/iu.test(name))) needed.add(folder.firstId + index);
    });
    folder.folders.forEach(([name, child]) => collect(child, `${prefix}${name}/`));
  };
  collect(rom.filenames);
  const overlayIds = new Set([...contract.hooks, ...contract.nativeAdapters, ...black2Contract.hooks, ...black2Contract.nativeAdapters, ...italyContract.hooks, ...italyContract.nativeAdapters, ...upgradeContract.nativeAdapters]
    .filter(site => site.segment !== "ARM9").map(site => Number(site.segment)));
  const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  for (let at = 0; at + 32 <= table.length; at += 32) {
    if (overlayIds.has(readU32(table, at))) needed.add(readU32(table, at + 24));
  }
  const source: FollowerRom = {
    filenames: rom.filenames,
    files: rom.files.map((file, id) => needed.has(id) ? file.slice() : new Uint8Array()),
    idCode: rom.idCode,
    revision: bytes[30],
    arm9RamAddress: rom.arm9RamAddress,
    arm9OverlayTable: rom.arm9OverlayTable,
  };
  return source;
}
export function readFollowingFile(project: ProjectState, rom: FollowerFiles, path: string): Uint8Array | undefined {
  const added = project.fileSystem?.additions?.[path];
  if (added) return added;
  const id = rom.filenames.idOf(path);
  if (id !== undefined && project.fileSystem?.tombstones?.[id] === path) return undefined;
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}
export type FollowerProfile = "stock" | "black2" | "white2upgrade" | "white2italy";
export type FollowerVariant = "base" | "full";
const FOLLOWER_OPTIONS_TEXT_PATH = "a/0/0/2";
const FOLLOWER_OPTIONS_MEMBER = 32;
const FOLLOWER_OPTIONS_IDS = [6, 21, 22, 30] as const;
function followerOptionsSource(project: ProjectState, rom: FollowerRom): Uint8Array | undefined {
  const bytes = readFollowingFile(project, rom, FOLLOWER_OPTIONS_TEXT_PATH);
  if (!bytes) return undefined;
  const store = project.narcs.message_texts;
  if (!store || store.sourcePath !== FOLLOWER_OPTIONS_TEXT_PATH || store.container === "file" || !store.dirty.size) return bytes;
  const archive = new NARC(bytes);
  for (const id of store.dirty) if (id < archive.files.length && store.rawFiles[id]) archive.files[id] = store.rawFiles[id];
  return archive.save();
}
function stageFollowerOptionsStore(project: ProjectState, bytes: Uint8Array): void {
  const store = project.narcs.message_texts;
  if (!store || store.sourcePath !== FOLLOWER_OPTIONS_TEXT_PATH || store.container === "file") return;
  store.rawFiles = [...store.rawFiles];
  store.rawFiles[FOLLOWER_OPTIONS_MEMBER] = new NARC(bytes).files[FOLLOWER_OPTIONS_MEMBER];
  store.dirty = new Set([...store.dirty, FOLLOWER_OPTIONS_MEMBER]);
  store.records.delete(FOLLOWER_OPTIONS_MEMBER);
}
function followerOptionsWords(profile: FollowerProfile): readonly string[] {
  return profile === "white2italy"
    ? ["SEGUACI", "SÌ", "NO", "Scegli se mostrare i Pokémon che ti seguono."]
    : ["FOLLOWERS", "ON", "OFF", "Choose whether Pokémon follow you."];
}
function followerOptionsText(archiveBytes: Uint8Array, profile: FollowerProfile, original?: readonly string[], remove = false): { bytes: Uint8Array; original: string[] } {
  const archive = new NARC(archiveBytes);
  if (archive.files.length <= FOLLOWER_OPTIONS_MEMBER) throw new Error("Options text archive is incomplete.");
  const entries = decodeGen5TextBank(archive.files[FOLLOWER_OPTIONS_MEMBER]);
  const replacement = followerOptionsWords(profile);
  if (FOLLOWER_OPTIONS_IDS.some(id => id >= entries.length)) throw new Error("Reserved Options text entries are missing.");
  const previous = FOLLOWER_OPTIONS_IDS.map(id => entries[id][1]);
  if (remove) {
    if (!original || original.length !== FOLLOWER_OPTIONS_IDS.length) throw new Error("Original Options text receipt is missing.");
    FOLLOWER_OPTIONS_IDS.forEach((id, index) => { if (entries[id][1] === replacement[index]) entries[id] = [entries[id][0], original[index], entries[id][2]]; });
  } else {
    FOLLOWER_OPTIONS_IDS.forEach((id, index) => {
      if (entries[id][1] !== replacement[index] && entries[id][1].trim()) throw new Error(`Reserved Options text entry ${id} is in use.`);
      entries[id] = [entries[id][0], replacement[index], entries[id][2]];
    });
  }
  archive.files[FOLLOWER_OPTIONS_MEMBER] = encodeGen5TextBank(entries);
  return { bytes: archive.save(), original: original ? [...original] : previous };
}
export async function followerProfile(project: ProjectState, rom?: FollowerRom): Promise<FollowerProfile> {
  rom ??= await followerRom(project);
  if (project.session.baseVersion === "B2" || rom.idCode === "IREO") return "black2";
  if (rom.idCode === "IRDI") return "white2italy";
  return readFollowingFile(project, rom, "patches/White2Upgrade.dll") ? "white2upgrade" : "stock";
}
type FollowerRuntimeManifest = {
  version: string; fieldSha256: string; eventsSha256: string; eventsAbi: number; coreSha256: string; coreAbi: number;
  variants?: Record<FollowerVariant, { fieldSha256: string; eventsSha256: string; eventsAbi: number }>;
  previousVersions: Array<{ version: string; fieldSha256: string; eventsSha256?: string; eventsAbi?: number; coreSha256?: string; coreAbi?: number;
    registrySha256?: string; descriptorsSha256?: string; resourcesSha256?: string; effectsSha256?: string | null; interactionsSha256?: string; emotesSha256?: string }>;
};
function runtimeFor(profile: FollowerProfile): FollowerRuntimeManifest { return profile === "white2upgrade" ? upgradeRuntimeManifest : profile === "black2" ? black2RuntimeManifest : profile === "white2italy" ? italyRuntimeManifest : stockRuntimeManifest; }
function interactionFor(profile: FollowerProfile): typeof interactionManifest { return profile === "white2italy" ? italyInteractionManifest : interactionManifest; }
function targetFor(profile: FollowerProfile): string { return profile === "white2upgrade" ? upgradeContract.sourceRomSha256 : profile === "black2" ? black2Contract.target.sha256 : profile === "white2italy" ? italyContract.target.sha256 : contract.target.sha256; }
function binaryContractFor(profile: FollowerProfile): typeof contract { return profile === "black2" ? black2Contract as typeof contract : profile === "white2italy" ? italyContract as typeof contract : contract; }
export function followerModuleHookConflicts(rpm: RpmModule, hooks: readonly { segment: string; address: number; patchBytes: number }[]): boolean {
  for (const relocation of rpm.relocations) {
    const target = relocation.target;
    if (target.module === "base") continue;
    const symbol = rpm.symbols[relocation.sourceSymbolIndex];
    const length = target.type === "FULL_COPY" ? symbol?.size : target.type === "THUMB_BRANCH" ? 8 : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : 4;
    if (!length || hooks.some(hook => hook.segment === target.module && target.address < hook.address + hook.patchBytes && target.address + length > hook.address)) return true;
  }
  return false;
}
type FollowerModulePaths = { field: string; events: string; core: string; fieldName: string; eventsName: string; coreName: string };
function modulePathsFor(profile: FollowerProfile): FollowerModulePaths {
  const suffix = profile === "black2" ? "B2" : profile === "white2italy" ? "W2I" : "W2";
  return { field: `patches/PokewebFollowingField${suffix}.dll`, events: `patches/PokewebFollowingEvents${suffix}.dll`, core: `patches/PokewebFollowingCore${suffix}.dll`,
    fieldName: `PokewebFollowingField${suffix}.dll`, eventsName: `PokewebFollowingEvents${suffix}.dll`, coreName: `PokewebFollowingCore${suffix}.dll` };
}
export async function followerRuntimeVersion(project: ProjectState, rom?: FollowerRom): Promise<string> { return runtimeFor(await followerProfile(project, rom)).version; }
export async function checkFollowerCompatibility(project: ProjectState, rom?: FollowerRom, requestedVariant?: FollowerVariant): Promise<FollowerCompatibility> {
  const checks: FollowerCompatibility["checks"] = [];
  rom ??= await followerRom(project);
  const profile = await followerProfile(project, rom), runtimeManifest = runtimeFor(profile);
  const modulePaths = modulePathsFor(profile);
  const white2 = project.session.baseVersion === "W2" && rom.idCode === "IRDO";
  const white2italy = project.session.baseVersion === "W2" && rom.idCode === "IRDI";
  const black2 = project.session.baseVersion === "B2" && rom.idCode === "IREO";
  if ((!white2 && !white2italy && !black2) || rom.revision !== 0)
    return { compatible: false, message: "Following Pokémon requires an audited revision-0 Black 2, White 2, or Italian White 2 ROM.", checks };
  if (profile === "white2upgrade" && !white2) return { compatible: false, message: "The expansion follower profile is available only for White 2.", checks };
  checks.push({ name: `${rom.idCode} revision 0`, passed: true });
  const binaryContract = binaryContractFor(profile);
  if (!getPmcInstallStatus(project).installed) {
    const pmcSites = rom.idCode === "IRDI" ? [...italyPmcContract.hooks, ...italyPmcContract.imports]
      : [...bw2PmcContract.profiles[rom.idCode as "IRDO" | "IREO"].hooks, ...bw2PmcContract.profiles[rom.idCode as "IRDO" | "IREO"].imports];
    for (const site of pmcSites) {
      const at = site.address - rom.arm9RamAddress;
      checks.push({ name: `PMC ${site.id}`, passed: at >= 0 && toHex(project.arm9.subarray(at, at + site.expectedHex.length / 2)) === site.expectedHex });
    }
  }
  // A whole-ROM fingerprint changes for harmless text, script, or file-order edits.
  // The binary contract and the archives we actually extend define compatibility.
  const installed = await readFollowerAlphaInstall(project, rom);
  const variant = requestedVariant ?? (installed?.variant ?? (installed ? "full" : "base"));
  const mountSite = (id: string) => id.startsWith("mounted-surf-") || id.startsWith("land-mount-") || id.startsWith("land-rider-") || id.startsWith("surf-");
  const hooks = variant === "full" ? binaryContract.hooks : binaryContract.hooks.filter(site => !mountSite(site.id));
  if (profile === "white2upgrade") {
    for (const required of upgradeContract.requiredModules) {
      const module = readFollowingFile(project, rom, required.path);
      checks.push({ name: `Audited White2Upgrade runtime: ${required.path}`, passed: !!module && await followerRomSha256(module) === required.sha256 });
    }
    const personal = readFollowingFile(project, rom, "a/0/1/6");
    checks.push({ name: "Expanded personal archive through species 1023", passed: !!personal && new NARC(personal).files.length > 1023 });
  }
  const binarySites = [...hooks, ...binaryContract.nativeAdapters.filter(site => variant === "full" || !mountSite(site.id)), ...(profile === "white2upgrade" ? upgradeContract.nativeAdapters.filter(site => variant === "full" || !mountSite(site.id)) : [])];
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId),
    new Set(binarySites.filter(site => site.segment !== "ARM9").map(site => Number(site.segment))));
  for (const hook of binarySites) {
    const overlay = overlays.get(Number(hook.segment));
    const data = hook.segment === "ARM9" ? project.arm9 : project.overlays[Number(hook.segment)] ?? overlay?.data;
    const base = hook.segment === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress;
    const at = hook.address - (base ?? 0);
    checks.push({ name: hook.id, passed: !!data && at >= 0 && toHex(data.subarray(at, at + hook.expectedHex.length / 2)) === hook.expectedHex });
  }
  try {
    const archive = new NARC(readFollowingFile(project, rom, FOLLOWER_OPTIONS_TEXT_PATH)!);
    const entries = decodeGen5TextBank(archive.files[FOLLOWER_OPTIONS_MEMBER]);
    const words = followerOptionsWords(profile);
    checks.push({ name: "Reserved Options text entries", passed: FOLLOWER_OPTIONS_IDS.every((id, index) =>
      id < entries.length && (!entries[id][1].trim() || (!!installed && entries[id][1] === words[index]))) });
  } catch { checks.push({ name: "Reserved Options text entries", passed: false }); }
  if (!installed) {
    try {
      const descriptor = new NARC(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!).files;
      const resources = new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!).files;
      const personal = new NARC(readFollowingFile(project, rom, "a/0/1/6")!).files;
      const appearances = readFollowerStockAppearances(readFollowingFile(project, rom, "a/2/0/8")!);
      const rows = binaryContract.registry.stockRows;
      if (descriptor.length !== 1 || descriptor[0].length !== 4 + rows * 28 || readU32(descriptor[0], 0) !== rows ||
          resources.length !== binaryContract.resources.stockMembers || personal.length <= (profile === "white2upgrade" ? 1023 : 649))
        throw new Error("Unexpected stock follower archive layout");
      buildFollowerCatalog(personal, appearances, descriptor[0], resources, profile === "white2upgrade" ? 1023 : 649);
      checks.push({ name: "Stock follower archive layout", passed: true });
    } catch { checks.push({ name: "Stock follower archive layout", passed: false }); }
  }
  for (const module of listCodeInjectionDlls(project)) {
    const data = readFollowingFile(project, rom, module.path);
    if (!data) { checks.push({ name: `Unreadable patch ${module.path}`, passed: false }); continue; }
    if (module.path === modulePaths.field && [runtimeManifest.fieldSha256, runtimeManifest.variants?.base.fieldSha256, await followerRomSha256(removedModule(profile)), ...runtimeManifest.previousVersions.map(version => version.fieldSha256)].includes(await followerRomSha256(data))) continue;
    if (module.path === modulePaths.events && [runtimeManifest.eventsSha256, runtimeManifest.variants?.base.eventsSha256, await followerRomSha256(removedModule(profile, 1)), ...runtimeManifest.previousVersions.flatMap(version => "eventsSha256" in version ? [version.eventsSha256] : [])].includes(await followerRomSha256(data))) continue;
    if (module.path === modulePaths.core && [runtimeManifest.coreSha256, await followerRomSha256(removedModule(profile, 2)), ...runtimeManifest.previousVersions.flatMap(version => "coreSha256" in version ? [version.coreSha256] : [])].includes(await followerRomSha256(data))) continue;
    try {
      const rpm = parseRpm(data, { allowedMagics: ["DLXF"] });
      // Only hook write spans are owned. Native-adapter signatures can cover
      // whole functions or tables that another DLL legitimately extends.
      if (followerModuleHookConflicts(rpm, hooks)) checks.push({ name: `Hook conflict: ${module.path}`, passed: false });
    } catch { checks.push({ name: `Cannot audit patch ${module.path}`, passed: false }); }
  }
  const compatible = checks.every(c => c.passed);
  return { compatible, checks, installation: installed, message: compatible ? `Binary adapters and follower archives match. ${profile === "white2upgrade" ? "White2Upgrade Gen 6–9" : profile === "black2" ? "Black 2 Gen 5" : profile === "white2italy" ? "Italian White 2 Gen 5" : "White 2 Gen 5"} follower alpha available; emulator acceptance remains separate.` : "A required follower binary site, archive layout, or patch hook is incompatible." };
}
export function readFollowerWorkspace(project: ProjectState, rom: FollowerFiles): FollowerAssetWorkspace | undefined {
  const bytes = readFollowingFile(project, rom, FOLLOWER_MANIFEST_PATH);
  if (!bytes) return;
  const value = JSON.parse(new TextDecoder().decode(bytes)) as FollowerAssetWorkspace;
  if (value.schemaVersion !== 1 || ![contract.target.sha256, black2Contract.target.sha256, italyContract.target.sha256, upgradeContract.sourceRomSha256].includes(value.targetSha256) || !value.imports || typeof value.imports !== "object") throw new Error("Unsupported follower asset workspace.");
  validateFollowerRegistry(value.registry);
  for (const [key, item] of Object.entries(value.imports)) {
    if (!value.registry.entries.some(e => followerKey(e.key) === key) || item.path !== `following/asset-${key.replaceAll(":", "-")}.btx` || !Number.isInteger(item.crc32)) throw new Error("Invalid follower import reference.");
  }
  return value;
}
function commitWorkspace(project: ProjectState, rom: FollowerFiles, workspace: FollowerAssetWorkspace, resources: Record<string, Uint8Array>, description: string): void {
  // Validate and serialize everything before publishing the new filesystem maps.
  const registryBytes = encodeFollowerRegistry(workspace.registry);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(workspace, null, 2) + "\n");
  const replacements = { ...project.fileSystem?.replacements }, additions = { ...project.fileSystem?.additions };
  for (const [path, bytes] of Object.entries({ ...resources, [FOLLOWER_MANIFEST_PATH]: manifestBytes, [FOLLOWER_REGISTRY_PATH]: registryBytes })) {
    const id = rom.filenames.idOf(path);
    if (id === undefined) additions[path] = bytes; else { replacements[id] = bytes; delete additions[path]; }
  }
  project.fileSystem = { ...project.fileSystem, replacements, additions };
  recordGenericChange(project, "following_pokemon", description, "Following Pokémon", { key: "following-assets" });
}
export async function prepareFollowerWorkspace(project: ProjectState, rom?: FollowerRom): Promise<FollowerAssetWorkspace> {
  rom ??= await followerRom(project);
  const existing = readFollowerWorkspace(project, rom);
  if (existing) return existing;
  const compatibility = await checkFollowerCompatibility(project, rom);
  if (!compatibility.compatible) throw new Error(compatibility.message);
  const archive = (path: string) => {
    const id = rom.filenames.idOf(path); if (id === undefined) throw new Error(`Missing ${path}`);
    return getRomFileBytes(project, rom, id);
  };
  const profile = await followerProfile(project, rom);
  if (compatibility.installation) {
    // Exported installs already extend the retail archives. Seed a new editor
    // workspace from the checked installed catalog, including any prior art.
    const registryBytes = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
    if (!registryBytes) throw new Error("Installed follower catalog is missing.");
    const registry = decodeFollowerRegistry(registryBytes);
    const resources = new NARC(archive(FOLLOWER_RESOURCE_PATH)).files;
    const descriptors = new NARC(archive(FOLLOWER_DESCRIPTOR_PATH)).files;
    if (resources.length !== registry.resourceCount || descriptors.length !== 1 ||
        new DataView(descriptors[0].buffer, descriptors[0].byteOffset, descriptors[0].byteLength).getUint32(0, true) !== registry.descriptorCount)
      throw new Error("Installed follower artwork does not match its catalog.");
    const workspace: FollowerAssetWorkspace = { schemaVersion: 1, targetSha256: targetFor(profile), registry, imports: {} };
    commitWorkspace(project, rom, workspace, {}, `Prepared ${registry.entries.length} installed follower appearances for editing.`);
    return workspace;
  }
  const resources = new NARC(archive("a/0/4/8")).files;
  const descriptors = new NARC(archive("a/0/4/7")).files;
  if (descriptors.length !== 1 || resources.length !== 975) throw new Error("Unsupported overworld archive layout.");
  const registry = buildFollowerCatalog(new NARC(archive("a/0/1/6")).files, readFollowerStockAppearances(archive("a/2/0/8")), descriptors[0], resources, profile === "white2upgrade" ? 1023 : 649);
  const workspace: FollowerAssetWorkspace = { schemaVersion: 1, targetSha256: targetFor(profile), registry, imports: {} };
  commitWorkspace(project, rom, workspace, {}, `Prepared ${registry.entries.length} follower appearances with explicit missing-art placeholders.`);
  return workspace;
}
export function replaceFollowerAssets(project: ProjectState, rom: FollowerFiles,
  updates: readonly { key: FollowerAppearanceKey; bytes: Uint8Array; profile: FollowerAssetEntry["animationProfile"]; source: FollowerAssetEntry["source"]; label: string; placeholder?: boolean; placeholderReason?: string }[]): FollowerAssetWorkspace {
  const current = readFollowerWorkspace(project, rom);
  if (!current) throw new Error("Prepare the asset workspace first.");
  if (!updates.length) return current;
  const workspace = structuredClone(current), resources: Record<string, Uint8Array> = {}, seen = new Set<string>();
  for (const update of updates) {
    const key = followerKey(update.key);
    if (seen.has(key)) throw new Error(`Duplicate import ${key}`); seen.add(key);
    const entry = workspace.registry.entries.find(e => followerKey(e.key) === key);
    if (!entry) throw new Error(`Appearance ${key} is not valid in this catalog.`);
    const shape = validateFollowerResource(update.bytes, update.profile), path = `following/asset-${key.replaceAll(":", "-")}.btx`;
    const bytes = update.bytes.slice();
    if (!workspace.imports[key]) entry.resourceId = workspace.registry.resourceCount++;
    Object.assign(entry, { sideGap: followerSideGap(bytes, update.profile), size: shape.size, animationProfile: update.profile, placeholder: update.placeholder ?? false, placeholderReason: update.placeholderReason, source: update.source, sourceLabel: update.label });
    workspace.imports[key] = { path, crc32: followerCrc32(bytes) }; resources[path] = bytes;
  }
  commitWorkspace(project, rom, workspace, resources, `Replaced ${updates.length} follower appearance${updates.length === 1 ? "" : "s"}.`);
  return workspace;
}
/** Author positions without recompiling a DLL. An installed current runtime
 * receives the updated ROM archive and receipt in the same staged edit. */
export async function updateFollowerPositioning(project: ProjectState, rom: FollowerRom, update:
  { landKey: string; gaps: [number, number, number, number]; rider: FollowerRiderAdjustments } |
  { surfKey: string; rider: FollowerRiderAdjustments }): Promise<FollowerAssetWorkspace> {
  const current = readFollowerWorkspace(project, rom);
  if (!current) throw new Error("Prepare the asset workspace first.");
  const workspace = structuredClone(current);
  if ("landKey" in update) {
    const entry = workspace.registry.entries.find(candidate => followerKey(candidate.key) === update.landKey);
    if (!entry) throw new Error("Follower appearance is missing.");
    entry.directionalGaps = update.gaps;
    entry.riderAdjustments = update.rider;
  } else {
    workspace.surfAdjustments ??= {};
    workspace.surfAdjustments[update.surfKey] = update.rider;
  }
  validateFollowerRegistry(workspace.registry);
  const profile = await followerProfile(project, rom);
  const surfRegistry = readFollowingFile(project, rom, FOLLOWER_SURF_REGISTRY_PATH) ??
    new Uint8Array(await (await fetch(profile === "white2upgrade" ? upgradeSurfRegistryUrl : surfRegistryUrl)).arrayBuffer());
  validateSurfAdjustments(surfRegistry, workspace.surfAdjustments ?? {});
  const installed = await readFollowerAlphaInstall(project, rom);
  const staged = structuredClone({ ...project, originalRomBytes: undefined }) as ProjectState;
  commitWorkspace(staged, rom, workspace, {}, "Updated follower appearance positioning.");
  if (installed && !installed.removed && installed.version === runtimeFor(profile).version) {
    const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
    const riding = (installed.variant ?? "full") === "full";
    const anchors = riding ? readFollowingFile(project, rom, FOLLOWER_LAND_ANCHORS_PATH) : undefined;
    if (!registry || (riding && !anchors)) throw new Error("Installed follower positioning sources are missing.");
    const decoded = decodeFollowerRegistry(registry);
    const authored = new Map(workspace.registry.entries.map(entry => [followerKey(entry.key), entry]));
    for (const entry of decoded.entries) {
      const source = authored.get(followerKey(entry.key));
      if (source?.directionalGaps) entry.directionalGaps = source.directionalGaps;
      if (source?.riderAdjustments) entry.riderAdjustments = source.riderAdjustments;
    }
    const positioning = encodeFollowerPositioningNarc(decoded, registry, anchors, riding ? surfRegistry : undefined, riding ? workspace.surfAdjustments : undefined);
    decodeFollowerPositioningNarc(positioning, registry, riding ? surfRegistry : undefined);
    const state = { ...installed, positioningSha256: await followerRomSha256(positioning) };
    stageFollowingFiles(staged, rom, { [FOLLOWER_POSITIONING_PATH]: positioning,
      [FOLLOWER_INSTALL_PATH]: new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n") });
  }
  project.fileSystem = staged.fileSystem; project.actionChangelog = staged.actionChangelog;
  return workspace;
}
export function readFollowerAsset(project: ProjectState, rom: FollowerFiles, workspace: FollowerAssetWorkspace, entry: FollowerAssetEntry, stockResources?: readonly Uint8Array[]): Uint8Array {
  const imported = workspace.imports[followerKey(entry.key)];
  if (imported) {
    const bytes = readFollowingFile(project, rom, imported.path);
    if (!bytes || followerCrc32(bytes) !== imported.crc32) throw new Error("Follower asset is missing or was edited outside its manifest.");
    validateFollowerResource(bytes, entry.animationProfile); return bytes;
  }
  const id = rom.filenames.idOf("a/0/4/8");
  if (id === undefined) throw new Error("Missing native model resources.");
  const bytes = (stockResources ?? new NARC(getRomFileBytes(project, rom, id)).files)[entry.resourceId];
  if (!bytes) throw new Error("Missing follower source resource.");
  return bytes;
}

export const FOLLOWER_DLL_PATH = "patches/PokewebFollowingFieldW2.dll";
export const FOLLOWER_NATIVE_PATH = "following/native.bin";
export const FOLLOWER_INSTALL_PATH = "following/install.json";
export const FOLLOWER_INTERACTIONS_PATH = "following/interactions.bin";
export { FOLLOWER_DIALOGUE_NARC_PATH, FOLLOWER_ITEM_NARC_PATH };
export const FOLLOWER_EMOTES_PATH = "following/emotes.narc";
export const FOLLOWER_EFFECTS_PATH = "following/effects.narc";
export const FOLLOWER_LANGUAGE_PATH = "following/language.bin";
function validateFollowerLanguageData(bytes: Uint8Array): void {
  if (bytes.length < 48 || bytes.length > 400 || (bytes.length - 16) % 2 ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) !== 0x474c5746)
    throw new Error("Invalid follower language record.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 1 || view.getUint32(8, true) !== bytes.length ||
      view.getUint32(12, true) !== followerCrc32(bytes.subarray(16)) || view.getUint16(bytes.length - 2, true) !== 0xffff)
    throw new Error("Invalid follower language record checksum or text.");
}
export async function readFollowerItemRules(project: ProjectState, rom?: FollowerRom): Promise<FollowerItemRule[]> {
  rom ??= await followerRom(project);
  const bytes = readFollowingFile(project, rom, FOLLOWER_ITEM_NARC_PATH);
  return bytes ? decodeFollowerItemNarc(bytes) : [];
}
export async function writeFollowerItemRules(project: ProjectState, rules: FollowerItemRule[], rom?: FollowerRom): Promise<void> {
  rom ??= await followerRom(project);
  const current = await readFollowerAlphaInstall(project, rom);
  const bytes = encodeFollowerItemNarc(rules);
  const files: Record<string, Uint8Array> = { [FOLLOWER_ITEM_NARC_PATH]: bytes };
  if (current) {
    const state = { ...current, itemsSha256: await followerRomSha256(bytes) };
    files[FOLLOWER_INSTALL_PATH] = new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n");
  }
  stageFollowingFiles(project, rom, files);
  recordGenericChange(project, "following_pokemon", `${current && !current.removed ? "Updated" : "Staged"} ${rules.length} one-time follower ${rules.length === 1 ? "gift" : "gifts"}.`, "Following Pokémon", { key: "following-gifts" });
}
export async function readFollowerDialogueRules(project: ProjectState, rom?: FollowerRom): Promise<FollowerDialogueRule[]> {
  rom ??= await followerRom(project);
  const bytes = readFollowingFile(project, rom, FOLLOWER_DIALOGUE_NARC_PATH);
  return bytes ? decodeFollowerDialogueNarc(bytes) : [];
}
export async function writeFollowerDialogueRules(project: ProjectState, rules: FollowerDialogueRule[], rom?: FollowerRom): Promise<void> {
  rom ??= await followerRom(project);
  const current = await readFollowerAlphaInstall(project, rom);
  const bytes = encodeFollowerDialogueNarc(rules);
  const files: Record<string, Uint8Array> = { [FOLLOWER_DIALOGUE_NARC_PATH]: bytes };
  if (current) {
    const state = { ...current, dialoguesSha256: await followerRomSha256(bytes) };
    files[FOLLOWER_INSTALL_PATH] = new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n");
  }
  stageFollowingFiles(project, rom, files);
  recordGenericChange(project, "following_pokemon", `${current && !current.removed ? "Updated" : "Staged"} ${rules.length} conditional follower dialogue ${rules.length === 1 ? "rule" : "rules"}.`, "Following Pokémon", { key: "following-dialogues" });
}

// NitroFS deletion is not available for reopened projects. A deterministic inert
// module removes every follower hook without renumbering unrelated ROM files.
const removedModule = (profile: FollowerProfile = "stock", priority = 4) => writeRpm({ code: Uint8Array.of(0x70,0x47,0,0), bssSize: 0, baseAddress: 0, symbols: [], relocations: [],
  metadata: { PMCGameID: profile === "black2" ? "B2" : profile === "white2italy" ? "W2I" : "W2", PMCVersion: "following-removed", PMCModulePriority: priority } }, { ident: "DLXF" });
export const FOLLOWER_EVENTS_DLL_PATH = "patches/PokewebFollowingEventsW2.dll";
export const FOLLOWER_DLL_B2_PATH = "patches/PokewebFollowingFieldB2.dll";
export const FOLLOWER_EVENTS_B2_DLL_PATH = "patches/PokewebFollowingEventsB2.dll";
export const FOLLOWER_RUNTIME_VERSION = stockRuntimeManifest.version;
export type FollowerAlphaInstall = { schemaVersion: 1 | 2; variant?: FollowerVariant; profile?: FollowerProfile; version: string; enabled: boolean; targetSha256: string; moduleSha256: string; configCrc32: number; removed?: boolean; effectsSha256?: string; interactionsSha256?: string; emotesSha256?: string; dialoguesSha256?: string; itemsSha256?: string; languageSha256?: string; eventsSha256?: string; eventsAbi?: number; coreSha256?: string; coreAbi?: number; registrySha256?: string; descriptorsSha256?: string; resourcesSha256?: string; surfSha256?: string; surfRegistrySha256?: string; landRiderSha256?: string; landAnchorsSha256?: string; positioningSha256?: string; optionsTextSha256?: string; optionsOriginalText?: string[] };
const upgradeFieldUrl = new URL("../assets/following/white2upgrade/PokewebFollowingFieldW2.dll", import.meta.url);
const upgradeEventsUrl = new URL("../assets/following/white2upgrade/PokewebFollowingEventsW2.dll", import.meta.url);
const upgradeCoreUrl = new URL("../assets/following/white2upgrade/PokewebFollowingCoreW2.dll", import.meta.url);
const laterResourcesUrl = new URL("../assets/following/white2upgrade/later-followers.narc", import.meta.url);
const black2FieldUrl = new URL("../assets/following/black2/PokewebFollowingFieldB2.dll", import.meta.url);
const black2EventsUrl = new URL("../assets/following/black2/PokewebFollowingEventsB2.dll", import.meta.url);
const black2CoreUrl = new URL("../assets/following/black2/PokewebFollowingCoreB2.dll", import.meta.url);
const italyFieldUrl = new URL("../assets/following/white2italy/PokewebFollowingFieldW2I.dll", import.meta.url);
const italyEventsUrl = new URL("../assets/following/white2italy/PokewebFollowingEventsW2I.dll", import.meta.url);
const italyCoreUrl = new URL("../assets/following/white2italy/PokewebFollowingCoreW2I.dll", import.meta.url);
const italyLanguageUrl = new URL("../assets/following/white2italy/language.bin", import.meta.url);
const fieldModuleUrl = new URL("../assets/following/PokewebFollowingFieldW2.dll", import.meta.url);
const eventsModuleUrl = new URL("../assets/following/PokewebFollowingEventsW2.dll", import.meta.url);
const baseModules = {
  stock: [new URL("../assets/following/PokewebFollowingFieldW2Base.dll", import.meta.url), new URL("../assets/following/PokewebFollowingEventsW2Base.dll", import.meta.url)],
  black2: [new URL("../assets/following/black2/PokewebFollowingFieldB2Base.dll", import.meta.url), new URL("../assets/following/black2/PokewebFollowingEventsB2Base.dll", import.meta.url)],
  white2italy: [new URL("../assets/following/white2italy/PokewebFollowingFieldW2IBase.dll", import.meta.url), new URL("../assets/following/white2italy/PokewebFollowingEventsW2IBase.dll", import.meta.url)],
  white2upgrade: [new URL("../assets/following/white2upgrade/PokewebFollowingFieldW2Base.dll", import.meta.url), new URL("../assets/following/white2upgrade/PokewebFollowingEventsW2Base.dll", import.meta.url)],
} as const;
const coreModuleUrl = new URL("../assets/following/PokewebFollowingCoreW2.dll", import.meta.url);
const gen5ResourcesUrl = new URL("../assets/following/gen5-followers.narc", import.meta.url);
const interactionsUrl = new URL("../assets/following/interactions.bin", import.meta.url);
const italyInteractionsUrl = new URL("../assets/following/white2italy/interactions.bin", import.meta.url);
const emotesUrl = new URL("../assets/following/interaction-emotes.narc", import.meta.url);
const dialoguesUrl = new URL("../assets/following/contextual-dialogues.narc", import.meta.url);
const itemsUrl = new URL("../assets/following/contextual-items.narc", import.meta.url);
const effectsUrl = new URL("../assets/following/hgss-effects.narc", import.meta.url);
const surfResourcesUrl = new URL("../assets/following/surf-mounts.narc", import.meta.url);
const surfRegistryUrl = new URL("../assets/following/surf-registry.bin", import.meta.url);
const landRiderUrl = new URL("../assets/following/land-riders.narc", import.meta.url);
const upgradeSurfResourcesUrl = new URL("../assets/following/white2upgrade/surf-mounts.narc", import.meta.url);
const upgradeSurfRegistryUrl = new URL("../assets/following/white2upgrade/surf-registry.bin", import.meta.url);

export function validateFollowerSurfAssets(registry: Uint8Array, archive: Uint8Array, profile: FollowerProfile = "stock"): void {
  const manifest = profile === "white2upgrade" ? upgradeSurfManifest : surfManifest;
  const maxSpecies = profile === "white2upgrade" ? 1023 : 649;
  const view = new DataView(registry.buffer, registry.byteOffset, registry.byteLength);
  if (registry.length < 24 || view.getUint32(0, true) !== 0x4d535746 || view.getUint16(4, true) !== 2 ||
      view.getUint16(6, true) !== 8 || view.getUint16(8, true) !== manifest.entries.length || view.getUint16(8, true) > 4095 ||
      view.getUint16(10, true) !== maxSpecies || registry.length !== 16 + view.getUint16(8, true) * 8)
    throw new Error("Invalid Surf appearance registry.");
  const members = new NARC(archive).files;
  if (view.getUint32(12, true) !== members.length || members.length !== view.getUint16(8, true) * 16 || members.length > 65535)
    throw new Error("Surf resource count does not match its registry.");
  let previous = "";
  const used = new Set<number>(), bases = new Set<string>();
  for (let i = 0; i < view.getUint16(8, true); i++) {
    const at = 16 + i * 8, species = view.getUint16(at, true), form = registry[at + 2], gender = registry[at + 3], shiny = registry[at + 4];
    const first = view.getUint16(at + 6, true), size = registry[at + 5];
    const key = `${species.toString().padStart(4, "0")}:${form.toString().padStart(3, "0")}:${gender.toString().padStart(3, "0")}:${shiny}`;
    if (species < 1 || species > maxSpecies || key <= previous || ![0, 1, 2, 255].includes(gender) || shiny > 1 ||
        ![32, 64].includes(size) || first % 16 !== 0 || first + 16 > members.length || used.has(first))
      throw new Error("Invalid Surf appearance entry.");
    if (form === 0 && gender === 255) bases.add(`${species}:${shiny}`);
    for (let frame = first; frame < first + 16; frame++)
      if (members[frame]?.length < 48 || String.fromCharCode(...members[frame].subarray(0, 4)) !== "BTX0")
        throw new Error("Invalid Surf texture member.");
    used.add(first); previous = key;
  }
  if (used.size !== view.getUint16(8, true) ||
      Array.from({ length: 649 }, (_, i) => i + 1).some(species => !bases.has(`${species}:0`) || !bases.has(`${species}:1`)) ||
      (profile === "white2upgrade" && Array.from({ length: 374 }, (_, i) => i + 650)
        .some(species => !upgradeSurfManifest.missingLaterBaseSpecies.includes(species) && !bases.has(`${species}:0`))))
    throw new Error("Incomplete Surf appearance registry.");
}

export function encodeFollowerNativeConfig(registry: Uint8Array, descriptorCount: number, resourceCount: number, enabled = true): Uint8Array {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x544e5746, true); view.setUint32(4, enabled ? 1 : 0, true); view.setUint32(8, 2, true);
  view.setUint32(12, registry.length, true); view.setUint32(16, descriptorCount, true); view.setUint32(20, resourceCount, true);
  view.setUint32(24, followerCrc32(registry), true); return bytes;
}

type Gen5ResourceManifest = typeof gen5Manifest;
export function buildGen5FollowerArchives(personalBytes: Uint8Array, appearanceBytes: Uint8Array, descriptorBytes: Uint8Array,
  resourceBytes: Uint8Array, gen5Bytes: Uint8Array, manifest: Gen5ResourceManifest = gen5Manifest, laterBytes?: Uint8Array) {
  const descriptors = new NARC(descriptorBytes), resources = new NARC(resourceBytes), imported = new NARC(gen5Bytes);
  if (descriptors.files.length !== 1 || resources.files.length !== 975 || imported.files.length !== manifest.resources.length)
    throw new Error("Unsupported follower archive layout.");
  const personal = new NARC(personalBytes).files;
  const registry = buildFollowerCatalog(personal, readFollowerStockAppearances(appearanceBytes), descriptors.files[0], resources.files, laterBytes ? 1023 : 649);
  const later = laterBytes ? new NARC(laterBytes) : undefined;
  if (later && later.files.length !== laterManifest.resources.length) throw new Error("Invalid later-generation resource count.");
  const laterByKey = new Map(laterManifest.appearances.map(item => [followerKey({ ...item, gender: item.gender as 0|1|2 }), item]));
  const byKey = new Map(manifest.appearances.map(item => [`${item.species}:${item.form}:${item.gender}:${Number(item.shiny)}`, item]));
  for (const entry of registry.entries) {
    if (entry.key.species < 494) continue;
    if (entry.key.species >= 650 && later) {
      const source = laterByKey.get(followerKey(entry.key));
      if (!source) throw new Error(`Unsupported expanded appearance ${followerKey(entry.key)}; regenerate the bundle for this personal data.`);
      validateFollowerResource(later.files[source.member], source.profile as "pokemon-mirrored" | "pokemon-asymmetric");
      Object.assign(entry, { resourceId: resources.files.length + imported.files.length + source.member, size: source.size,
        animationProfile: source.profile, placeholder: source.placeholder, placeholderReason: source.placeholderReason ?? undefined,
        source: laterManifest.resources[source.member].source === "fan-png" ? "png" : "hg-engine", sourceLabel: `Bundled Gen 6–9 ${laterManifest.resources[source.member].sourcePath}` });
      continue;
    }
    const exact = byKey.get(followerKey(entry.key));
    const source = exact ?? (later ? byKey.get(followerKey({ ...entry.key, form: 0 })) : undefined);
    if (!source) throw new Error(`Missing bundled Gen 5 follower ${followerKey(entry.key)}.`);
    validateFollowerResource(imported.files[source.member], source.profile as "pokemon-mirrored" | "pokemon-asymmetric");
    Object.assign(entry, { resourceId: resources.files.length + source.member, size: source.size,
      animationProfile: source.profile, placeholder: !exact, placeholderReason: exact ? undefined : "Expanded form uses the Gen 5 base-form artwork.",
      source: "hg-engine", sourceLabel: `Bundled Gen 5 overworld ${manifest.resources[source.member].gfx}` });
  }
  resources.files.push(...imported.files.map(file => file.slice()), ...(later?.files.map(file => file.slice()) ?? []));
  registry.resourceCount = resources.files.length;
  registry.descriptorCount = 1008 + registry.entries.length;
  const stock = descriptors.files[0], expanded = new Uint8Array(4 + registry.descriptorCount * 28);
  expanded.set(stock); new DataView(expanded.buffer).setUint32(0, registry.descriptorCount, true);
  for (const entry of registry.entries) {
    const custom = entry.key.species >= 494;
    const sourceRow = custom ? entry.size === 64 ? 616 : 377 : entry.sourceDescriptorRow!;
    const sourceAt = 4 + sourceRow * 28, at = 4 + entry.descriptorRow * 28;
    expanded.set(stock.subarray(sourceAt, sourceAt + 28), at);
    const view = new DataView(expanded.buffer); view.setUint16(at, 0x3000 + entry.descriptorRow - 1008, true); view.setUint16(at + 16, entry.resourceId, true);
    expanded[at + 4] = 1; // Follower-owned descriptor: enable the native ground-shadow effect.
    entry.offsets = [13, 14, 15].map(offset => (expanded[at + offset] << 24) >> 24) as [number, number, number];
  }
  deriveFollowerGrounding(registry, resources.files, personal);
  // The registry carries the follower-only artwork offset. Descriptor Y also
  // positions the native shadow, so leave the copied retail zero in that row.
  descriptors.files[0] = expanded; deriveFollowerSpacing(registry, resources.files); validateFollowerRegistry(registry);
  const registryBytes = encodeFollowerRegistry(registry, Boolean(laterBytes));
  return { registry, registryBytes, descriptors: descriptors.save(), resources: resources.save(),
    config: encodeFollowerNativeConfig(registryBytes, registry.descriptorCount, registry.resourceCount) };
}
export async function readFollowerAlphaInstall(project: ProjectState, rom?: FollowerRom): Promise<FollowerAlphaInstall | undefined> {
  rom ??= await followerRom(project);
  const bytes = readFollowingFile(project, rom, FOLLOWER_INSTALL_PATH);
  if (!bytes) return;
  const state = JSON.parse(new TextDecoder().decode(bytes)) as FollowerAlphaInstall;
  const profile = await followerProfile(project, rom), runtimeManifest = runtimeFor(profile), activeInteractions = interactionFor(profile);
  const variant = state.variant ?? "full";
  const fingerprint = runtimeManifest.variants?.[variant] ?? (variant === "full" ? runtimeManifest : undefined);
  const modulePaths = modulePathsFor(profile);
  const dll = readFollowingFile(project, rom, modulePaths.field), config = readFollowingFile(project, rom, FOLLOWER_NATIVE_PATH);
  if ((state.profile ?? "stock") !== profile) throw new Error("Follower installation belongs to a different ROM profile.");
  const current = !!fingerprint && state.version === runtimeManifest.version && state.moduleSha256 === (state.removed ? await followerRomSha256(removedModule(profile)) : fingerprint.fieldSha256);
  const removedHash = state.removed ? await followerRomSha256(removedModule(profile)) : undefined;
  const previous = variant === "full" ? runtimeManifest.previousVersions.find(version => version.version === state.version && (state.removed ? removedHash : version.fieldSha256) === state.moduleSha256) : undefined;
  const extendedPrevious = !current && previous && "coreSha256" in previous ? previous : undefined;
  const extended = current || !!extendedPrevious;
  if ((state.schemaVersion !== 1 && state.schemaVersion !== 2) || (state.schemaVersion === 2 && !state.variant) || !fingerprint || (!current && !previous) || state.targetSha256 !== targetFor(profile) || typeof state.enabled !== "boolean" || (state.removed && state.enabled) ||
      !dll || await followerRomSha256(dll) !== state.moduleSha256 || !config || followerCrc32(config) !== state.configCrc32)
    throw new Error("Follower installation files have changed. Refusing to overwrite owned data.");
  if (extended) {
    const events = readFollowingFile(project, rom, modulePaths.events);
    const expected = state.removed ? await followerRomSha256(removedModule(profile, 1)) : current ? fingerprint.eventsSha256 : extendedPrevious!.eventsSha256;
    const expectedEventsAbi = current ? fingerprint.eventsAbi : extendedPrevious!.eventsAbi;
    if (state.eventsAbi !== expectedEventsAbi || state.eventsSha256 !== expected || !events || await followerRomSha256(events) !== expected)
      throw new Error("Follower event module has changed or is missing. Refusing to overwrite owned data.");
    const core = readFollowingFile(project, rom, modulePaths.core), expectedCore = state.removed ? await followerRomSha256(removedModule(profile, 2)) : current ? runtimeManifest.coreSha256 : extendedPrevious!.coreSha256;
    const expectedCoreAbi = current ? runtimeManifest.coreAbi : extendedPrevious!.coreAbi;
    const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
    const descriptor = readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH), resources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH);
    if (state.coreAbi !== expectedCoreAbi || state.coreSha256 !== expectedCore || !core || await followerRomSha256(core) !== expectedCore)
      throw new Error("Follower core module has changed or is missing. Refusing to overwrite owned data.");
    if (!registry || !descriptor || !resources || await followerRomSha256(registry) !== state.registrySha256 ||
        await followerRomSha256(descriptor) !== state.descriptorsSha256 || await followerRomSha256(resources) !== state.resourcesSha256)
      throw new Error("Follower runtime assets have changed or are missing. Refusing to overwrite owned data.");
    if (extendedPrevious && "registrySha256" in extendedPrevious && (state.registrySha256 !== extendedPrevious.registrySha256 || state.descriptorsSha256 !== extendedPrevious.descriptorsSha256 || state.resourcesSha256 !== extendedPrevious.resourcesSha256))
      throw new Error("Follower runtime asset version does not match its installation receipt.");
  } else {
    const previousEvents = previous && "eventsSha256" in previous ? previous.eventsSha256 : undefined;
    if (previousEvents) {
      const events = readFollowingFile(project, rom, modulePaths.events);
      if (state.eventsAbi !== previous!.eventsAbi || state.eventsSha256 !== previousEvents || !events || await followerRomSha256(events) !== previousEvents)
        throw new Error("Follower event module has changed or is missing. Refusing to overwrite owned data.");
    } else if (state.eventsSha256 !== undefined || state.eventsAbi !== undefined) throw new Error("Unexpected event-module ownership in a legacy follower installation.");
    if (state.coreSha256 !== undefined || state.coreAbi !== undefined || state.registrySha256 !== undefined || state.descriptorsSha256 !== undefined || state.resourcesSha256 !== undefined)
      throw new Error("Unexpected extended-resource ownership in a legacy follower installation.");
  }
  const expectedEffects = current ? effectsManifest.sha256 : previous?.effectsSha256;
  if (expectedEffects) {
    const effects = readFollowingFile(project, rom, FOLLOWER_EFFECTS_PATH);
    if (state.effectsSha256 !== expectedEffects || !effects || await followerRomSha256(effects) !== state.effectsSha256)
      throw new Error("Follower effect assets have changed. Refusing to overwrite owned data.");
  }
  const expectedInteractions = current ? activeInteractions.dataSha256 : previous && "interactionsSha256" in previous ? previous.interactionsSha256 : undefined;
  const expectedEmotes = current ? activeInteractions.emotesSha256 : previous && "emotesSha256" in previous ? previous.emotesSha256 : undefined;
  if (expectedInteractions || expectedEmotes) {
    const data = readFollowingFile(project, rom, FOLLOWER_INTERACTIONS_PATH), emotes = readFollowingFile(project, rom, FOLLOWER_EMOTES_PATH);
    if (!data || !emotes || state.interactionsSha256 !== expectedInteractions || state.emotesSha256 !== expectedEmotes ||
        await followerRomSha256(data) !== state.interactionsSha256 || await followerRomSha256(emotes) !== state.emotesSha256)
      throw new Error("Follower interaction assets have changed. Refusing to overwrite owned data.");
    if (data.length > 8192) throw new Error("Follower conversations exceed the 8 KiB runtime buffer.");
    validateFollowerInteractions(data, emotes);
  }
  if (current || state.dialoguesSha256 !== undefined) {
    const dialogueBytes = readFollowingFile(project, rom, FOLLOWER_DIALOGUE_NARC_PATH);
    if (!dialogueBytes || !state.dialoguesSha256 || await followerRomSha256(dialogueBytes) !== state.dialoguesSha256) throw new Error("Follower contextual dialogue archive has changed or is missing. Refusing to overwrite owned data.");
    decodeFollowerDialogueNarc(dialogueBytes);
  }
  if (state.itemsSha256 !== undefined) {
    const itemBytes = readFollowingFile(project, rom, FOLLOWER_ITEM_NARC_PATH);
    if (!itemBytes || !state.itemsSha256 || await followerRomSha256(itemBytes) !== state.itemsSha256) throw new Error("Follower gift archive has changed or is missing. Refusing to overwrite owned data.");
    decodeFollowerItemNarc(itemBytes);
  }
  if (profile === "white2italy") {
    const language = readFollowingFile(project, rom, FOLLOWER_LANGUAGE_PATH);
    if (!state.languageSha256 || !language || await followerRomSha256(language) !== state.languageSha256)
      throw new Error("Italian follower language data has changed or is missing. Refusing to overwrite owned data.");
    validateFollowerLanguageData(language);
  }
  if ((current && variant === "full") || state.surfSha256) {
    const activeSurfManifest = profile === "white2upgrade" ? upgradeSurfManifest : surfManifest;
    const resource = readFollowingFile(project, rom, FOLLOWER_SURF_RESOURCE_PATH);
    const registry = readFollowingFile(project, rom, FOLLOWER_SURF_REGISTRY_PATH);
    if (!resource || !registry || !state.surfSha256 || !state.surfRegistrySha256 ||
        (current && (state.surfSha256 !== activeSurfManifest.sha256 || state.surfRegistrySha256 !== activeSurfManifest.registrySha256)) ||
        await followerRomSha256(resource) !== state.surfSha256 || await followerRomSha256(registry) !== state.surfRegistrySha256)
      throw new Error("Follower Surf assets have changed or are missing. Refusing to overwrite owned data.");
    if (current) validateFollowerSurfAssets(registry, resource, profile);
    else if (new DataView(registry.buffer, registry.byteOffset, registry.byteLength).getUint16(4, true) === 2)
      validateFollowerSurfAssets(registry, resource, profile);
    else if (profile === "stock") {
      const old = new DataView(registry.buffer, registry.byteOffset, registry.byteLength);
      if (registry.length !== 24 || old.getUint32(0, true) !== 0x4d535746 || old.getUint16(4, true) !== 1 ||
          old.getUint16(8, true) !== 1 || old.getUint16(16, true) !== 493 || new NARC(resource).files.length !== 16)
        throw new Error("Invalid prior Surf asset layout.");
    }
  }
  if ((current && variant === "full") || state.landRiderSha256 !== undefined) {
    const rider = readFollowingFile(project, rom, FOLLOWER_LAND_RIDER_PATH);
    const anchors = readFollowingFile(project, rom, FOLLOWER_LAND_ANCHORS_PATH);
    const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
    const descriptor = readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH);
    if (!rider || !anchors || !registry || !descriptor || !state.landRiderSha256 || !state.landAnchorsSha256 ||
        await followerRomSha256(rider) !== state.landRiderSha256 || await followerRomSha256(anchors) !== state.landAnchorsSha256 ||
        (current && state.landRiderSha256 !== landRiderManifest.sha256))
      throw new Error("Follower land mount assets have changed or are missing.");
    const files = new NARC(rider).files;
    if ((current ? files.length !== landRiderManifest.members : files.length !== 8 && files.length !== landRiderManifest.members) ||
        files.some(file => file.length < 48 || String.fromCharCode(...file.subarray(0, 4)) !== "BTX0"))
      throw new Error("Invalid land rider resource archive.");
    const descriptorMember = new NARC(descriptor).files[0];
    validateFollowerLandAnchors(anchors, registry, new DataView(descriptorMember.buffer, descriptorMember.byteOffset, descriptorMember.byteLength).getUint32(0, true));
  }
  if (current || state.positioningSha256 !== undefined) {
    const positioning = readFollowingFile(project, rom, FOLLOWER_POSITIONING_PATH);
    const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
    const surfRegistry = readFollowingFile(project, rom, FOLLOWER_SURF_REGISTRY_PATH);
    if (!positioning || !registry || (variant === "full" && !surfRegistry) || !state.positioningSha256 ||
        await followerRomSha256(positioning) !== state.positioningSha256)
      throw new Error("Follower positioning archive has changed or is missing.");
    decodeFollowerPositioningNarc(positioning, registry, variant === "full" ? surfRegistry : undefined);
  }
  const view = new DataView(config.buffer, config.byteOffset, config.byteLength);
  if (extended) {
    const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!;
    const descriptorArchive = new NARC(readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!);
    const resourceArchive = new NARC(readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!);
    const descriptorMember = descriptorArchive.files[0], descriptorCount = descriptorMember && descriptorMember.length >= 4 ? new DataView(descriptorMember.buffer, descriptorMember.byteOffset, descriptorMember.byteLength).getUint32(0, true) : 0;
    if (config.length !== 32 || view.getUint32(0, true) !== 0x544e5746 || view.getUint32(4, true) !== Number(state.enabled) || view.getUint32(8, true) !== 2 ||
        view.getUint32(12, true) !== registry.length || view.getUint32(16, true) !== descriptorCount || view.getUint32(20, true) !== resourceArchive.files.length ||
        descriptorArchive.files.length !== 1 || descriptorMember.length !== 4 + descriptorCount * 28 || view.getUint32(24, true) !== followerCrc32(registry) || view.getUint32(28, true) !== 0)
      throw new Error("Invalid follower runtime configuration.");
  } else if (config.length !== 4976 || view.getUint32(0, true) !== 0x544e5746 || view.getUint32(4, true) !== Number(state.enabled) || view.getUint32(8, true) !== 620 || view.getUint32(12, true) !== followerCrc32(config.subarray(16))) throw new Error("Invalid follower runtime configuration.");
  return state;
}
function stageFollowingFiles(project: ProjectState, rom: FollowerFiles, files: Record<string, Uint8Array>): void {
  const replacements = { ...project.fileSystem?.replacements }, additions = { ...project.fileSystem?.additions }, tombstones = { ...project.fileSystem?.tombstones };
  for (const [path, bytes] of Object.entries(files)) {
    const id = rom.filenames.idOf(path);
    if (id === undefined) additions[path] = bytes; else { replacements[id] = bytes; delete additions[path]; delete tombstones[id]; }
  }
  project.fileSystem = { ...project.fileSystem, replacements, additions, tombstones };
}
function stripFollowerMountFiles(project: ProjectState, rom: FollowerFiles): void {
  const replacements = { ...project.fileSystem?.replacements }, additions = { ...project.fileSystem?.additions }, tombstones = { ...project.fileSystem?.tombstones };
  for (const path of [FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH, FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH]) {
    const id = rom.filenames.idOf(path);
    if (id === undefined) { delete additions[path]; continue; }
    replacements[id] = new Uint8Array(); delete additions[path]; tombstones[id] = path;
  }
  project.fileSystem = { ...project.fileSystem, replacements, additions, tombstones };
}
export function followerArtworkPending(project: ProjectState, rom: FollowerFiles): boolean {
  const workspace = readFollowerWorkspace(project, rom);
  if (!workspace || !Object.keys(workspace.imports).length) return false;
  const registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
  const resources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH);
  if (!registry || !resources) return true;
  const entries = decodeFollowerRegistry(registry).entries;
  const files = new NARC(resources).files;
  for (const [key, imported] of Object.entries(workspace.imports)) {
    const entry = entries.find(candidate => followerKey(candidate.key) === key);
    const authored = readFollowingFile(project, rom, imported.path);
    if (!entry || !authored || followerCrc32(authored) !== imported.crc32) throw new Error(`Invalid follower replacement ${key}.`);
    const installed = files[entry.resourceId];
    if (!installed || installed.length !== authored.length || installed.some((byte, index) => byte !== authored[index])) return true;
  }
  return false;
}
export async function installFollowerAlpha(project: ProjectState, rom?: FollowerRom, options?: { riding?: boolean }): Promise<FollowerAlphaInstall> {
  const sourceRomBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!sourceRomBytes) throw new Error("Reload the project's ROM before installing the follower.");
  rom ??= await followerRom(project, sourceRomBytes);
  const profile = await followerProfile(project, rom), runtimeManifest = runtimeFor(profile), activeInteractions = interactionFor(profile);
  const modulePaths = modulePathsFor(profile);
  const existing = await readFollowerAlphaInstall(project, rom);
  const variant: FollowerVariant = (options?.riding ?? (existing ? (existing.variant ?? "full") === "full" : false)) ? "full" : "base";
  if (existing && !existing.removed && variant !== (existing.variant ?? "full"))
    throw new Error("Remove the follower runtime before changing the riding option.");
  const report = await checkFollowerCompatibility(project, rom, variant);
  if (!report.compatible) throw new Error(report.message);
  const fingerprint = runtimeManifest.variants?.[variant];
  if (!fingerprint) throw new Error(`Bundled ${variant} follower package is unavailable.`);
  const pendingArtwork = profile === "stock" && followerArtworkPending(project, rom);
  if (existing?.version === runtimeManifest.version && existing.moduleSha256 === fingerprint.fieldSha256 && !existing.removed && !pendingArtwork) { if (!existing.enabled) return setFollowerAlphaEnabled(project, true, rom); return existing; }
  const authoredDialogues = readFollowingFile(project, rom, FOLLOWER_DIALOGUE_NARC_PATH);
  const authoredItems = readFollowingFile(project, rom, FOLLOWER_ITEM_NARC_PATH);
  const optionsSource = followerOptionsSource(project, rom);
  if (!optionsSource) throw new Error("Options text archive is missing.");
  const optionsText = followerOptionsText(optionsSource, profile, existing?.optionsOriginalText);
  // Contextual archives may be authored before the runtime is installed. They are
  // validated below and become owned by this installation transaction.
  const newOwned = existing?.version === runtimeManifest.version || existing?.coreSha256 ? [] : existing ? [modulePaths.core, FOLLOWER_RUNTIME_REGISTRY_PATH] : [modulePaths.field, modulePaths.events, modulePaths.core, FOLLOWER_NATIVE_PATH, FOLLOWER_RUNTIME_REGISTRY_PATH, FOLLOWER_EFFECTS_PATH, FOLLOWER_INTERACTIONS_PATH, FOLLOWER_EMOTES_PATH, ...(profile === "white2italy" ? [FOLLOWER_LANGUAGE_PATH] : [])];
  if (variant === "full" && !existing?.surfSha256) newOwned.push(FOLLOWER_SURF_RESOURCE_PATH, FOLLOWER_SURF_REGISTRY_PATH);
  if (variant === "full" && !existing?.landRiderSha256) newOwned.push(FOLLOWER_LAND_RIDER_PATH, FOLLOWER_LAND_ANCHORS_PATH);
  if (!existing?.positioningSha256) newOwned.push(FOLLOWER_POSITIONING_PATH);
  for (const path of newOwned)
    if (readFollowingFile(project, rom, path)) throw new Error(`Unowned follower file already exists: ${path}`);
  const [response, eventsResponse, coreResponse, gen5Response, effectsResponse, dataResponse, emoteResponse, dialoguesResponse, itemsResponse] = await Promise.all([
    fetch(variant === "base" ? baseModules[profile][0] : profile === "white2upgrade" ? upgradeFieldUrl : profile === "black2" ? black2FieldUrl : profile === "white2italy" ? italyFieldUrl : fieldModuleUrl),
    fetch(variant === "base" ? baseModules[profile][1] : profile === "white2upgrade" ? upgradeEventsUrl : profile === "black2" ? black2EventsUrl : profile === "white2italy" ? italyEventsUrl : eventsModuleUrl),
    fetch(profile === "white2upgrade" ? upgradeCoreUrl : profile === "black2" ? black2CoreUrl : profile === "white2italy" ? italyCoreUrl : coreModuleUrl),
    fetch(gen5ResourcesUrl), fetch(effectsUrl), fetch(profile === "white2italy" ? italyInteractionsUrl : interactionsUrl), fetch(emotesUrl), fetch(dialoguesUrl), fetch(itemsUrl)]);
  if (!response.ok || !eventsResponse.ok || !coreResponse.ok || !gen5Response.ok) throw new Error("Could not load the follower runtime package.");
  const dll = new Uint8Array(await response.arrayBuffer());
  if (await followerRomSha256(dll) !== fingerprint.fieldSha256) throw new Error("Follower module fingerprint mismatch.");
  const eventsDll = new Uint8Array(await eventsResponse.arrayBuffer());
  if (await followerRomSha256(eventsDll) !== fingerprint.eventsSha256 || (variant === "full" && fingerprint.eventsAbi !== binaryContractFor(profile).eventsAbi) || (variant === "base" && fingerprint.eventsAbi !== 4)) throw new Error("Follower event module fingerprint mismatch.");
  const coreDll = new Uint8Array(await coreResponse.arrayBuffer());
  if (await followerRomSha256(coreDll) !== runtimeManifest.coreSha256 || runtimeManifest.coreAbi !== 2) throw new Error("Follower core module fingerprint mismatch.");
  if (!effectsResponse.ok) throw new Error("Could not load the follower effects.");
  const effects = new Uint8Array(await effectsResponse.arrayBuffer());
  if (effects.length !== effectsManifest.bytes || await followerRomSha256(effects) !== effectsManifest.sha256) throw new Error("Follower effects fingerprint mismatch.");
  if (!dataResponse.ok || !emoteResponse.ok || !dialoguesResponse.ok || !itemsResponse.ok) throw new Error("Could not load follower conversation assets.");
  const data = new Uint8Array(await dataResponse.arrayBuffer()), emotes = new Uint8Array(await emoteResponse.arrayBuffer());
  const bundledDialogues = new Uint8Array(await dialoguesResponse.arrayBuffer()), bundledItems = new Uint8Array(await itemsResponse.arrayBuffer());
  const dialogues = (authoredDialogues ?? bundledDialogues).slice(), items = (authoredItems ?? bundledItems).slice();
  const language = profile === "white2italy" ? existing?.version === runtimeManifest.version ? readFollowingFile(project, rom, FOLLOWER_LANGUAGE_PATH)?.slice() : new Uint8Array(await (await fetch(italyLanguageUrl)).arrayBuffer()) : undefined;
  const activeSurfManifest = profile === "white2upgrade" ? upgradeSurfManifest : surfManifest;
  const surfResources = variant === "full" ? new Uint8Array(await (await fetch(profile === "white2upgrade" ? upgradeSurfResourcesUrl : surfResourcesUrl)).arrayBuffer()) : undefined;
  const surfRegistry = variant === "full" ? new Uint8Array(await (await fetch(profile === "white2upgrade" ? upgradeSurfRegistryUrl : surfRegistryUrl)).arrayBuffer()) : undefined;
  const landRider = variant === "full" ? new Uint8Array(await (await fetch(landRiderUrl)).arrayBuffer()) : undefined;
  if (landRider && (await followerRomSha256(landRider) !== landRiderManifest.sha256 || new NARC(landRider).files.length !== landRiderManifest.members))
    throw new Error("Bundled land rider fingerprint mismatch.");
  if (surfResources && surfRegistry) {
    if (await followerRomSha256(surfResources) !== activeSurfManifest.sha256 || await followerRomSha256(surfRegistry) !== activeSurfManifest.registrySha256)
      throw new Error("Bundled Surf asset fingerprint mismatch.");
    validateFollowerSurfAssets(surfRegistry, surfResources, profile);
  }
  if (profile === "white2italy") {
    if (!language) throw new Error("Italian follower language data is missing.");
    validateFollowerLanguageData(language);
  }
  const gen5Bytes = new Uint8Array(await gen5Response.arrayBuffer());
  if (await followerRomSha256(data) !== activeInteractions.dataSha256 || await followerRomSha256(emotes) !== activeInteractions.emotesSha256)
    throw new Error("Follower conversation asset fingerprint mismatch.");
  if (data.length > 8192) throw new Error("Follower conversations exceed the 8 KiB runtime buffer.");
  validateFollowerInteractions(data, emotes);
  decodeFollowerDialogueNarc(dialogues); decodeFollowerItemNarc(items);
  if (await followerRomSha256(gen5Bytes) !== gen5Manifest.archiveSha256) throw new Error("Gen 5 follower bundle fingerprint mismatch.");
  let assetWorkspace: FollowerAssetWorkspace | undefined;
  let registry: Uint8Array, descriptors: Uint8Array, resources: Uint8Array, config: Uint8Array;
  if (existing?.version === runtimeManifest.version) {
    registry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!.slice();
    descriptors = readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!.slice();
    resources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!.slice();
    config = readFollowingFile(project, rom, FOLLOWER_NATIVE_PATH)!.slice();
    new DataView(config.buffer).setUint32(4, 1, true);
  } else if (existing?.coreSha256) {
    // Recompute only spacing from the installed artwork, including replacements.
    const decoded = decodeFollowerRegistry(readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!);
    descriptors = readFollowingFile(project, rom, FOLLOWER_DESCRIPTOR_PATH)!.slice();
    resources = readFollowingFile(project, rom, FOLLOWER_RESOURCE_PATH)!.slice();
    const resourceFiles = new NARC(resources).files;
    deriveFollowerSpacing(decoded, resourceFiles);
    deriveFollowerGrounding(decoded, resourceFiles, new NARC(readFollowingFile(project, rom, "a/0/1/6")!).files);
    const descriptorArchive = new NARC(descriptors);
    for (const entry of decoded.entries) descriptorArchive.files[0][4 + entry.descriptorRow * 28 + 14] = 0;
    descriptors = descriptorArchive.save();
    const savedWorkspace = readFollowerWorkspace(project, rom);
    if (savedWorkspace) {
      assetWorkspace = structuredClone(savedWorkspace);
      const gaps = new Map(decoded.entries.map(e => [followerKey(e.key), e.sideGap]));
      const heights = new Map(decoded.entries.map(e => [followerKey(e.key), e.offsets[1]]));
      for (const e of assetWorkspace.registry.entries) {
        if (gaps.has(followerKey(e.key))) e.sideGap = gaps.get(followerKey(e.key));
        if (heights.has(followerKey(e.key))) e.offsets[1] = heights.get(followerKey(e.key))!;
      }
    }
    registry = encodeFollowerRegistry(decoded, profile === "white2upgrade");
    // Preserve hashed diagnostic records verbatim through this data migration.
    const previous = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH)!;
    const zoneBytes = decoded.zones.length * 8;
    registry.set(previous.subarray(previous.length - zoneBytes), registry.length - zoneBytes);
    new DataView(registry.buffer).setUint32(24, 0, true);
    new DataView(registry.buffer).setUint32(24, followerCrc32(registry), true);
    config = encodeFollowerNativeConfig(registry, decoded.descriptorCount, decoded.resourceCount);
    if (!existing.enabled && !existing.removed) new DataView(config.buffer).setUint32(4, 0, true);
  } else {
    const archive = (path: string) => { const value = readFollowingFile(project, rom, path); if (!value) throw new Error(`Missing ${path}`); return value; };
    const laterBytes = profile === "white2upgrade" ? new Uint8Array(await (await fetch(laterResourcesUrl)).arrayBuffer()) : undefined;
    if (laterBytes && await followerRomSha256(laterBytes) !== laterManifest.archiveSha256) throw new Error("Later-generation follower bundle fingerprint mismatch.");
    const built = buildGen5FollowerArchives(archive("a/0/1/6"), archive("a/2/0/8"), archive(FOLLOWER_DESCRIPTOR_PATH), archive(FOLLOWER_RESOURCE_PATH), gen5Bytes, gen5Manifest, laterBytes);
    ({ registryBytes: registry, descriptors, resources, config } = built);
    if (profile === "white2upgrade" && !readFollowingFile(project, rom, FOLLOWER_MANIFEST_PATH))
      assetWorkspace = { schemaVersion: 1, targetSha256: targetFor(profile), registry: built.registry, imports: {} };
    if (existing && !existing.enabled) new DataView(config.buffer).setUint32(4, 0, true);
  }
  if (pendingArtwork) {
    const workspace = readFollowerWorkspace(project, rom)!;
    const decoded = decodeFollowerRegistry(registry), resourceArchive = new NARC(resources), descriptorArchive = new NARC(descriptors);
    for (const [key, imported] of Object.entries(workspace.imports)) {
      const target = decoded.entries.find(entry => followerKey(entry.key) === key);
      const authored = workspace.registry.entries.find(entry => followerKey(entry.key) === key);
      const bytes = readFollowingFile(project, rom, imported.path);
      if (!target || !authored || !bytes || followerCrc32(bytes) !== imported.crc32) throw new Error(`Invalid follower replacement ${key}.`);
      validateFollowerResource(bytes, authored.animationProfile);
      const installed = resourceArchive.files[target.resourceId];
      if (installed?.length === bytes.length && installed.every((byte, index) => byte === bytes[index])) continue;
      const resourceId = resourceArchive.files.length;
      if (resourceId > 65534) throw new Error("Follower resource archive is full.");
      resourceArchive.files.push(bytes.slice());
      target.resourceId = resourceId; target.size = authored.size; target.animationProfile = authored.animationProfile;
      target.placeholder = authored.placeholder; target.placeholderReason = authored.placeholderReason;
      target.source = authored.source; target.sourceLabel = authored.sourceLabel;
      const row = 4 + target.descriptorRow * 28;
      const view = new DataView(descriptorArchive.files[0].buffer, descriptorArchive.files[0].byteOffset, descriptorArchive.files[0].byteLength);
      view.setUint16(row + 16, resourceId, true);
      descriptorArchive.files[0][row + 7] = authored.size === 64 ? 2 : 1;
    }
    decoded.resourceCount = resourceArchive.files.length;
    deriveFollowerSpacing(decoded, resourceArchive.files);
    deriveFollowerGrounding(decoded, resourceArchive.files, new NARC(readFollowingFile(project, rom, "a/0/1/6")!).files);
    for (const entry of decoded.entries) descriptorArchive.files[0][4 + entry.descriptorRow * 28 + 14] = 0;
    resources = resourceArchive.save(); descriptors = descriptorArchive.save();
    const previous = registry, zoneBytes = decoded.zones.length * 8;
    registry = encodeFollowerRegistry(decoded);
    registry.set(previous.subarray(previous.length - zoneBytes), registry.length - zoneBytes);
    new DataView(registry.buffer).setUint32(24, 0, true);
    new DataView(registry.buffer).setUint32(24, followerCrc32(registry), true);
    config = encodeFollowerNativeConfig(registry, decoded.descriptorCount, decoded.resourceCount);
  }
  const landAnchors = variant === "full" ? encodeFollowerLandAnchors(decodeFollowerRegistry(registry), new NARC(resources).files, registry) : undefined;
  if (landAnchors) {
    const descriptorMember = new NARC(descriptors).files[0];
    validateFollowerLandAnchors(landAnchors, registry, new DataView(descriptorMember.buffer, descriptorMember.byteOffset, descriptorMember.byteLength).getUint32(0, true));
  }
  let positioning: Uint8Array | undefined;
  {
    const positioningRegistry = decodeFollowerRegistry(registry);
    if (existing?.positioningSha256) {
      const previousRegistry = readFollowingFile(project, rom, FOLLOWER_RUNTIME_REGISTRY_PATH);
      const previousBytes = readFollowingFile(project, rom, FOLLOWER_POSITIONING_PATH);
      if (!previousRegistry || !previousBytes) throw new Error("Installed walking gaps are missing.");
      const previousSurf = (existing.variant ?? "full") === "full" ? readFollowingFile(project, rom, FOLLOWER_SURF_REGISTRY_PATH) : undefined;
      const previous = decodeFollowerPositioningNarc(previousBytes, previousRegistry, previousSurf);
      const previousGaps = new Map(decodeFollowerRegistry(previousRegistry).entries.map(entry => [followerKey(entry.key),
        previous.land.slice((entry.descriptorRow - 1008) * 12, (entry.descriptorRow - 1008) * 12 + 4)]));
      for (const entry of positioningRegistry.entries) {
        const gaps = previousGaps.get(followerKey(entry.key));
        if (gaps?.length === 4) entry.directionalGaps = Array.from(gaps) as [number, number, number, number];
      }
    }
    const authoredPositions = assetWorkspace ?? readFollowerWorkspace(project, rom);
    if (authoredPositions) {
      const authored = new Map(authoredPositions.registry.entries.map(entry => [followerKey(entry.key), entry]));
      for (const entry of positioningRegistry.entries) {
        const source = authored.get(followerKey(entry.key));
        if (source?.directionalGaps) entry.directionalGaps = source.directionalGaps;
        if (source?.riderAdjustments) entry.riderAdjustments = source.riderAdjustments;
      }
    }
    positioning = encodeFollowerPositioningNarc(positioningRegistry, registry, landAnchors, surfRegistry, variant === "full" ? authoredPositions?.surfAdjustments : undefined);
    decodeFollowerPositioningNarc(positioning, registry, surfRegistry);
  }
  const state: FollowerAlphaInstall = { schemaVersion: 2, variant, profile, version: runtimeManifest.version, enabled: new DataView(config.buffer).getUint32(4, true) === 1, targetSha256: targetFor(profile),
    moduleSha256: fingerprint.fieldSha256, eventsSha256: fingerprint.eventsSha256, eventsAbi: fingerprint.eventsAbi, coreSha256: runtimeManifest.coreSha256, coreAbi: runtimeManifest.coreAbi,
    configCrc32: followerCrc32(config), registrySha256: await followerRomSha256(registry), descriptorsSha256: await followerRomSha256(descriptors), resourcesSha256: await followerRomSha256(resources),
    effectsSha256: effectsManifest.sha256, interactionsSha256: activeInteractions.dataSha256, emotesSha256: activeInteractions.emotesSha256, dialoguesSha256: await followerRomSha256(dialogues), itemsSha256: await followerRomSha256(items),
    optionsTextSha256: await followerRomSha256(optionsText.bytes), optionsOriginalText: optionsText.original };
  if (language) state.languageSha256 = await followerRomSha256(language);
  if (surfResources && surfRegistry) { state.surfSha256 = activeSurfManifest.sha256; state.surfRegistrySha256 = activeSurfManifest.registrySha256; }
  if (landRider && landAnchors) { state.landRiderSha256 = landRiderManifest.sha256; state.landAnchorsSha256 = await followerRomSha256(landAnchors); }
  if (positioning) state.positioningSha256 = await followerRomSha256(positioning);
  // Stage PMC and all owned files privately; publish only after every operation succeeds.
  const staged = structuredClone({ ...project, originalRomBytes: undefined }) as ProjectState;
  staged.originalRomBytes = sourceRomBytes;
  if (!getPmcInstallStatus(staged).installed) await installBundledPmc(staged);
  if (variant === "base" && existing?.removed && (existing.variant ?? "full") === "full") stripFollowerMountFiles(staged, rom);
  stageCodeInjectionDll(staged, modulePaths.fieldName, dll);
  stageCodeInjectionDll(staged, modulePaths.eventsName, eventsDll);
  stageCodeInjectionDll(staged, modulePaths.coreName, coreDll);
  stageFollowingFiles(staged, rom, { [FOLLOWER_OPTIONS_TEXT_PATH]: optionsText.bytes, [FOLLOWER_NATIVE_PATH]: config, [FOLLOWER_RUNTIME_REGISTRY_PATH]: registry, [FOLLOWER_DESCRIPTOR_PATH]: descriptors, [FOLLOWER_RESOURCE_PATH]: resources,
    [FOLLOWER_EFFECTS_PATH]: effects, [FOLLOWER_INTERACTIONS_PATH]: data, [FOLLOWER_EMOTES_PATH]: emotes, [FOLLOWER_DIALOGUE_NARC_PATH]: dialogues,
    [FOLLOWER_ITEM_NARC_PATH]: items, ...(language ? { [FOLLOWER_LANGUAGE_PATH]: language } : {}),
    ...(positioning ? { [FOLLOWER_POSITIONING_PATH]: positioning } : {}),
    ...(surfResources && surfRegistry ? { [FOLLOWER_SURF_RESOURCE_PATH]: surfResources, [FOLLOWER_SURF_REGISTRY_PATH]: surfRegistry } : {}),
    ...(landRider && landAnchors ? { [FOLLOWER_LAND_RIDER_PATH]: landRider, [FOLLOWER_LAND_ANCHORS_PATH]: landAnchors } : {}),
    [FOLLOWER_INSTALL_PATH]: new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n") });
  stageFollowerOptionsStore(staged, optionsText.bytes);
  if (assetWorkspace) stageFollowingFiles(staged, rom, {
    [FOLLOWER_MANIFEST_PATH]: new TextEncoder().encode(JSON.stringify(assetWorkspace, null, 2) + "\n"),
    [FOLLOWER_REGISTRY_PATH]: encodeFollowerRegistry(assetWorkspace.registry),
  });
  recordGenericChange(staged, "following_pokemon", `${existing ? "Updated" : "Installed"} automatic walking follower ${state.version} ${profile === "white2upgrade" ? "for White2Upgrade with Gen 6–9 artwork and explicit placeholders" : `for stock ${profile === "black2" ? "Black 2" : profile === "white2italy" ? "Italian White 2" : "White 2"} with bundled Gen 5 overworld sprites`}.`, "Following Pokémon", { key: "following-runtime" });
  project.arm9 = staged.arm9; project.arm9Dirty = staged.arm9Dirty; project.overlays = staged.overlays; project.patches = staged.patches;
  project.fileSystem = staged.fileSystem; project.codeInjection = staged.codeInjection; project.actionChangelog = staged.actionChangelog;
  project.narcs = staged.narcs; refreshDecodedTextState(project);
  return state;
}
export async function setFollowerAlphaEnabled(project: ProjectState, enabled: boolean, rom?: FollowerRom): Promise<FollowerAlphaInstall> {
  rom ??= await followerRom(project);
  const current = await readFollowerAlphaInstall(project, rom);
  if (!current || current.removed) throw new Error("Install the following runtime first.");
  if (current.enabled === enabled) return current;
  if (enabled) { const report = await checkFollowerCompatibility(project, rom); if (!report.compatible) throw new Error(report.message); }
  const config = readFollowingFile(project, rom, FOLLOWER_NATIVE_PATH)!.slice();
  new DataView(config.buffer).setUint32(4, Number(enabled), true);
  const state = { ...current, enabled, configCrc32: followerCrc32(config) };
  stageFollowingFiles(project, rom, { [FOLLOWER_NATIVE_PATH]: config, [FOLLOWER_INSTALL_PATH]: new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n") });
  recordGenericChange(project, "following_pokemon", `${enabled ? "Enabled" : "Disabled"} automatic following; imported assets retained.`, "Following Pokémon", { key: "following-runtime" });
  return state;
}

/** Remove all follower hooks; retain artwork/data and shared PMC installation. */
export async function removeFollowerAlpha(project: ProjectState, rom?: FollowerRom): Promise<void> {
  const sourceRomBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!sourceRomBytes) throw new Error("Reload the project's ROM before removing the follower.");
  rom ??= await followerRom(project, sourceRomBytes);
  const profile = await followerProfile(project, rom), runtimeManifest = runtimeFor(profile), modulePaths = modulePathsFor(profile);
  const current = await readFollowerAlphaInstall(project, rom);
  if (!current || current.removed) return;
  // Upgrade legacy packages first in private state, so ownership is unambiguous.
  const staged = structuredClone({ ...project, originalRomBytes: undefined }) as ProjectState;
  staged.originalRomBytes = sourceRomBytes;
  if (current.version !== runtimeManifest.version) await installFollowerAlpha(staged, rom);
  const owned = (await readFollowerAlphaInstall(staged, rom))!;
  const config = readFollowingFile(staged, rom, FOLLOWER_NATIVE_PATH)!.slice();
  new DataView(config.buffer).setUint32(4, 0, true);
  const stub = removedModule(profile);
  const eventsStub = removedModule(profile, 1);
  const coreStub = removedModule(profile, 2);
  const state = { ...owned, enabled: false, removed: true, moduleSha256: await followerRomSha256(stub), eventsSha256: await followerRomSha256(eventsStub), coreSha256: await followerRomSha256(coreStub), configCrc32: followerCrc32(config) };
  const optionsSource = followerOptionsSource(staged, rom);
  const optionsText = optionsSource && owned.optionsOriginalText ? followerOptionsText(optionsSource, profile, owned.optionsOriginalText, true).bytes : undefined;
  if (optionsText) state.optionsTextSha256 = await followerRomSha256(optionsText);
  stageCodeInjectionDll(staged, modulePaths.fieldName, stub);
  stageCodeInjectionDll(staged, modulePaths.eventsName, eventsStub);
  stageCodeInjectionDll(staged, modulePaths.coreName, coreStub);
  stageFollowingFiles(staged, rom, { ...(optionsText ? { [FOLLOWER_OPTIONS_TEXT_PATH]: optionsText } : {}), [FOLLOWER_NATIVE_PATH]: config, [FOLLOWER_INSTALL_PATH]: new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n") });
  if (optionsText) stageFollowerOptionsStore(staged, optionsText);
  recordGenericChange(staged, "following_pokemon", "Removed follower runtime hooks; assets and shared PMC retained.", "Following Pokémon", { key: "following-runtime" });
  project.fileSystem = staged.fileSystem; project.codeInjection = staged.codeInjection; project.actionChangelog = staged.actionChangelog;
  project.narcs = staged.narcs; refreshDecodedTextState(project);
}
