import manifest from "../assets/codeinjection/partyQuickActionsManifest.json";
import previous from "../../runtime/party-quick-actions/previous.json";
import previous11 from "../../runtime/party-quick-actions/previous-0.1.1.json";
import previous12 from "../../runtime/party-quick-actions/previous-0.1.2.json";
import previous13 from "../../runtime/party-quick-actions/previous-0.1.3.json";
import previous14 from "../../runtime/party-quick-actions/previous-0.1.4.json";
import { readU32, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { addRomFile, getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { recordGenericChange } from "./actionChangelog";
import { getInfiniteCandyStatus, installInfiniteCandy } from "./infiniteCandyModel";
import { adoptExistingPmcInstall, getPmcInstallStatus, installPmcBytes, listCodeInjectionDlls, loadBundledPmcBytes, stageCodeInjectionDll } from "./pmcModel";
import { createNarcStore, type ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
type Version = "B2" | "W2";
export const PARTY_QUICK_ACTIONS_VERSION = manifest.version;
export const PARTY_QUICK_ACTIONS_MAX_SAVE_FLAG = 3059;
export type PartyQuickActionsOptions = { hideFlag?: number | null };
export type PartyQuickActionsStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  enabled: boolean;
  updateAvailable: boolean;
  candyInstalled: boolean;
  candyCompatible: boolean;
  hideFlag: number | null;
  dllPath?: string;
  message: string;
};
const urls = { W2: new URL("../assets/codeinjection/PartyQuickActionsW2.dll", import.meta.url), B2: new URL("../assets/codeinjection/PartyQuickActionsB2.dll", import.meta.url) };
const archiveUrl = new URL("../assets/codeinjection/partyQuickActions.narc", import.meta.url);
const bundles = [manifest, previous, previous11, previous12, previous13, previous14];
const hex = (b: Uint8Array) => Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
const hash = async (b: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))));
function fingerprint(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x1000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function matchesModule(module: RpmModule, version: Version, bundle: typeof manifest) {
  const profile = bundle.games[version];
  const hooks = module.relocations.filter(({ target }) => target.module !== "base")
    .map(({ target }) => `${target.module}:${target.address}:${target.type}`).sort();
  const expected = profile.signatures.filter(s => s.patchSize)
    .map(s => `${s.module}:${s.address}:${s.label.endsWith("Return") ? "FULL_COPY" : "THUMB_BRANCH_LINK"}`).sort();
  return module.metadata.PMCGameID === version && module.metadata.PMCVersion === bundle.version
    && module.metadata.PMCModulePriority === 4 && !module.baseAddress
    && module.bssSize === profile.bssSize && fingerprint(module.code) === profile.codeFingerprint
    && hooks.join("|") === expected.join("|");
}
function recognized(module: RpmModule, version: Version) {
  return bundles.some(bundle => matchesModule(module, version, bundle));
}

function bytesAt(project: ProjectState, rom: NintendoDSRom, path: string) {
  const addition = Object.keys(project.fileSystem?.additions ?? {})
    .find(name => name.toLowerCase() === path.toLowerCase());
  if (addition) return project.fileSystem!.additions![addition];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}
function loadCandyArchives(project: ProjectState, rom: NintendoDSRom) {
  for (const [name, path] of [["items", "a/0/2/4"], ["message_texts", "a/0/0/2"]] as const) {
    if (project.narcs[name]) continue;
    const id = rom.filenames.idOf(path);
    if (id === undefined) throw new Error(`Required Infinite Rare Candy archive is missing: ${path}.`);
    project.narcs[name] = createNarcStore(name, path, id, new NARC(getRomFileBytes(project, rom, id)));
  }
}

export function parsePartyToolbarHideFlag(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:\d+|0x[\da-f]+)$/iu.test(text)) throw new Error("Enter a save flag in decimal or hexadecimal, or leave it blank.");
  const flag = Number(text);
  validateHideFlag(flag);
  return flag;
}
function validateHideFlag(flag: number | null) {
  if (flag !== null && (!Number.isInteger(flag) || flag < 1 || flag > PARTY_QUICK_ACTIONS_MAX_SAVE_FLAG))
    throw new Error(`Toolbar hide flag must be a saved flag from 1 to ${PARTY_QUICK_ACTIONS_MAX_SAVE_FLAG}, or blank.`);
}
function configuration(bytes: Uint8Array) {
  const archive = new NARC(bytes), header = archive.files[0];
  const legacy = header?.length === 20 && readU32(header, 4) === 1 && readU32(header, 8) === 20;
  const current = header?.length === 24 && readU32(header, 4) === 2 && readU32(header, 8) === 24;
  const flag = current ? readU32(header, 16) : 0;
  if (!bundles.some(bundle => archive.files.length === bundle.graphicsFingerprints.length + 1) || !header || (!legacy && !current)
      || readU32(header, 0) !== 0x51415050 || readU32(header, 12) > 1 || flag > PARTY_QUICK_ACTIONS_MAX_SAVE_FLAG
      || readU32(header, current ? 20 : 16) !== (0x51415050 ^ readU32(header, 12) ^ flag)) {
    throw new Error("Unrecognized Party toolbar archive. Restore its private graphics archive.");
  }
  if (!bundles.some(bundle => archive.files.length === bundle.graphicsFingerprints.length + 1 && archive.files.slice(1).every((file, index) => fingerprint(file) === bundle.graphicsFingerprints[index]))) {
    throw new Error("Party toolbar graphics are altered or incomplete. Restore the private graphics archive.");
  }
  return { enabled: !!readU32(header, 12), hideFlag: flag || null };
}

export function getPartyQuickActionsStatus(p: ProjectState): PartyQuickActionsStatus {
  const state: PartyQuickActionsStatus = { supported: false, compatible: false, installed: false, enabled: false, updateAvailable: false, candyInstalled: false, candyCompatible: false, hideFlag: null, message: "Party toolbar supports English Black 2 and White 2 revision 0." };
  const v = p.session.baseVersion;
  if (p.session.baseRom !== "BW2" || (v !== "B2" && v !== "W2") || !p.originalRomBytes)
    return state;
  try {
    const r = new NintendoDSRom(p.originalRomBytes, { fileData: "view" }), profile = manifest.games[v];
    if (r.idCode !== profile.idCode || r.data[0x1e])
      return state;
    state.supported = true;
    for (const entry of listCodeInjectionDlls(p)) {
      const b = bytesAt(p, r, entry.path);
      let rpm: RpmModule | undefined;
      try {
        if (b)
          rpm = parseRpm(b, { allowedMagics: ["DLXF"] });
      }
      catch { }
      if (rpm && recognized(rpm, v) && entry.target === "patches") {
        if (state.installed)
          throw new Error("Duplicate Party toolbar modules. Remove the duplicate before installing.");
        state.installed = true;
        state.dllPath = entry.path;
        state.updateAvailable = !matchesModule(rpm, v, manifest);
      }
      else if (/^PartyQuickActions[WB]2\.dll$/iu.test(entry.fileName) || rpm?.relocations.some(({ target, sourceSymbolIndex }) => {
        const size = target.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0 : target.type === "THUMB_BRANCH" ? 12 : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : 4;
        return profile.signatures.filter(s => s.patchSize).some(s => s.module === target.module && target.address < s.address + s.patchSize && target.address + size > s.address);
      }))
        throw new Error(`Conflicting Party toolbar hooks in ${entry.path}. Remove that conflicting module or use a compatible version.`);
    }
    const archive = bytesAt(p, r, manifest.archivePath);
    if (archive) {
      Object.assign(state, configuration(archive));
      if (state.installed && new NARC(archive).files.slice(1).some((file, index) => fingerprint(file) !== manifest.graphicsFingerprints[index])) state.updateAvailable = true;
    }
    else if (state.installed)
      throw new Error("Party toolbar graphics archive is missing.");
    const overlays = loadOverlayTable(p.patches?.arm9OverlayTable ?? r.arm9OverlayTable, (_id, fileId) => getRomFileBytes(p, r, fileId), new Set([12, 165]));
    const arm = p.arm9.length ? p.arm9 : decompressCode(r.arm9);
    for (const s of profile.signatures) {
      const o = overlays.get(Number(s.module)), base = s.module === "ARM9" ? r.arm9RamAddress : o?.ramAddress;
      const data = s.module === "ARM9" ? [arm] : [o?.data, p.overlays[Number(s.module)] ?? o?.data];
      const offset = base === undefined ? -1 : s.address - base;
      if (data.some(b => !b || offset < 0 || hex(b.subarray(offset, offset + s.expectedHex.length / 2)) !== s.expectedHex))
        throw new Error(`Unrecognized ${s.label} in ${s.module} at 0x${s.address.toString(16)}. Restore the native hook or use a compatible build.`);
    }
    state.compatible = true;
    // Status reads can lazily decode item text without changing the project.
    const dependencyProject = { ...p, narcs: { ...p.narcs }, texts: { ...p.texts, banks: { ...p.texts.banks } } };
    loadCandyArchives(dependencyProject, r);
    const candy = getInfiniteCandyStatus(dependencyProject);
    state.candyInstalled = candy.installed;
    state.candyCompatible = candy.supported && candy.compatible;
    if (state.installed && !candy.installed) state.updateAvailable = true;
    state.message = !state.candyCompatible ? `Requires Infinite Rare Candy: ${candy.message}` : state.updateAvailable ? "Party toolbar update available." : state.installed ? (state.enabled ? "Party toolbar enabled. Candy requires Infinite Candy in Key Items; tap a status again to clear it." : "Party toolbar disabled.") : "Native hooks match. Installs Infinite Rare Candy and PMC when needed.";
  }
  catch (e) {
    state.message = (e as Error).message;
  }
  return state;
}
function stageArchive(project: ProjectState, rom: NintendoDSRom, bytes: Uint8Array) {
  const addition = Object.keys(project.fileSystem?.additions ?? {})
    .find(name => name.toLowerCase() === manifest.archivePath.toLowerCase());
  const id = rom.filenames.idOf(manifest.archivePath);
  if (addition) {
    project.fileSystem!.additions![addition] = bytes;
  } else if (id !== undefined) {
    project.fileSystem ??= { replacements: {} };
    project.fileSystem.replacements[id] = bytes;
  } else {
    addRomFile(project, manifest.archivePath, bytes);
  }
}

export async function installPartyQuickActions(p: ProjectState, options: PartyQuickActionsOptions = {}) {
  if (options.hideFlag !== undefined) validateHideFlag(options.hideFlag);
  const romBytes = p.originalRomBytes ?? await loadActiveRomBytes();
  if (!romBytes)
    throw new Error("Reload the ROM before installing the Party toolbar.");
  const input = { ...p, originalRomBytes: romBytes }, s = getPartyQuickActionsStatus(input);
  if (!s.supported || !s.compatible || !s.candyCompatible)
    throw new Error(s.message);
  const v = p.session.baseVersion as Version, r = new NintendoDSRom(romBytes, { fileData: "view" }), profile = manifest.games[v];
  const [dr, ar] = await Promise.all([fetch(urls[v]), fetch(archiveUrl)]);
  if (!dr.ok || !ar.ok)
    throw new Error("Could not load the bundled Party toolbar.");
  const [dll, archive] = await Promise.all([dr.arrayBuffer().then(b => new Uint8Array(b)), ar.arrayBuffer().then(b => new Uint8Array(b))]);
  if (await hash(dll) !== profile.sha256 || await hash(archive) !== manifest.archiveSha256 || !recognized(parseRpm(dll, { allowedMagics: ["DLXF"] }), v) || !configuration(archive).enabled)
    throw new Error("Party toolbar bundle failed its integrity check.");
  const configuredArchive = new NARC(archive), hideFlag = (options.hideFlag === undefined ? s.hideFlag : options.hideFlag) ?? 0;
  writeU32(configuredArchive.files[0], 16, hideFlag);
  writeU32(configuredArchive.files[0], 20, 0x51415050 ^ 1 ^ hideFlag);
  // Commit only after the PMC, module and private archive have all staged successfully.
  const staged: ProjectState = { ...input, arm9: p.arm9.slice(), overlays: Object.fromEntries(Object.entries(p.overlays).map(([id, b]) => [id, b?.slice()])), narcs: structuredClone(p.narcs), texts: structuredClone(p.texts), fileSystem: structuredClone(p.fileSystem), codeInjection: structuredClone(p.codeInjection), patches: structuredClone(p.patches), actionChangelog: structuredClone(p.actionChangelog) };
  adoptExistingPmcInstall(staged, romBytes);
  if (!getPmcInstallStatus(staged).installed)
    installPmcBytes(staged, await loadBundledPmcBytes(v), romBytes);
  loadCandyArchives(staged, r);
  if (!s.candyInstalled) await installInfiniteCandy(staged);
  const result = stageCodeInjectionDll(staged, s.dllPath?.split("/").pop() ?? profile.fileName, dll, "patches", romBytes);
  stageArchive(staged, r, configuredArchive.save());
  recordGenericChange(staged, "code_injection", `Party toolbar installed with Infinite Rare Candy: Candy, confirmed Heal Team, HP adjustment, confirmed XP edging, L/A navigation and five status toggles.${hideFlag ? ` Hidden when save flag 0x${hideFlag.toString(16).toUpperCase()} is set.` : ""}`, "Party Toolbar", { key: "code-injection:party-quick-actions" });
  Object.assign(p, { originalRomBytes: romBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty, overlays: staged.overlays, narcs: staged.narcs, texts: staged.texts, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection, patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
}
export function disablePartyQuickActions(project: ProjectState) {
  const status = getPartyQuickActionsStatus(project);
  if (!status.installed || !status.compatible || !project.originalRomBytes) throw new Error(status.message);
  const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  const archive = new NARC(bytesAt(project, rom, manifest.archivePath)!);
  writeU32(archive.files[0], 12, 0);
  const current = readU32(archive.files[0], 4) === 2;
  writeU32(archive.files[0], current ? 20 : 16, 0x51415050 ^ (current ? readU32(archive.files[0], 16) : 0));
  stageArchive(project, rom, archive.save());
  recordGenericChange(project, "code_injection", "Party toolbar disabled.", "Party Toolbar", { key: "code-injection:party-quick-actions" });
}
