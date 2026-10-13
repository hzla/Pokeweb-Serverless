import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { parseNitroSdat } from "./nitroSound";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { getPmcInstallStatus, adoptExistingPmcInstall, installPmcBytes, loadBundledPmcBytes, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import { getStandaloneStreamConfigs, type ProjectState } from "./projectStore";
import { listNativeSdatStreams } from "./streamedBgmModel";
import { parseRpm, type RpmModule } from "./rpm";
import manifest from "../assets/codeinjection/save-menu-compatibility.json";

type Version = "W2" | "B2";
const TARGETS = manifest.games;
export const SAVE_MENU_VERSION = "0.3.7";
const DLL_VERSION = SAVE_MENU_VERSION;
export const SAVE_MENU_SETTINGS_PATH = "ui/save-menu/settings.bin";
export type SaveMenuSettings = NonNullable<NonNullable<ProjectState["codeInjection"]>["saveMenuSettings"]>;
const DEFAULT_SETTINGS: SaveMenuSettings = { music: "relic-song", bpm: 150, stepsPerBeat: 2 };
export function getSaveMenuSettings(project: ProjectState): SaveMenuSettings {
  return project.codeInjection?.saveMenuSettings ?? DEFAULT_SETTINGS;
}
export function encodeSaveMenuSettings(settings: SaveMenuSettings): Uint8Array {
  if (!Number.isInteger(settings.bpm) || settings.bpm < 30 || settings.bpm > 300
    || ![1, 2, 4].includes(settings.stepsPerBeat)
    || (settings.music === "stream" && (!Number.isInteger(settings.streamId) || settings.streamId! < 0 || settings.streamId! >= 0xffff))) {
    throw new Error("Choose a valid song and animation tempo (30–300 BPM, 1/2/4 pose changes per beat).");
  }
  const bytes = new Uint8Array(16);
  bytes.set([0x53, 0x4d, 0x4e, 0x55], 0); // SMNU
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, settings.music === "stream" ? 1 : 0, true);
  view.setUint16(8, settings.music === "stream" ? settings.streamId! : 0x0446, true);
  view.setUint16(10, settings.bpm, true);
  view.setUint16(12, settings.stepsPerBeat, true);
  view.setUint16(14, 48 / settings.stepsPerBeat, true);
  return bytes;
}
export function decodeSaveMenuSettings(bytes: Uint8Array): SaveMenuSettings {
  if (bytes.length !== 16 || bytes[0] !== 0x53 || bytes[1] !== 0x4d || bytes[2] !== 0x4e || bytes[3] !== 0x55) {
    throw new Error("Save-menu settings are malformed.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== 1) throw new Error("Save-menu settings use an unsupported version.");
  const mode = view.getUint16(6, true), soundId = view.getUint16(8, true);
  const bpm = view.getUint16(10, true), stepsPerBeat = view.getUint16(12, true);
  if (mode > 1 || bpm < 30 || bpm > 300 || ![1, 2, 4].includes(stepsPerBeat)
    || view.getUint16(14, true) !== 48 / stepsPerBeat) throw new Error("Save-menu settings contain an invalid cadence.");
  return { music: mode ? "stream" : "relic-song", ...(mode ? { streamId: soundId } : {}), bpm, stepsPerBeat: stepsPerBeat as 1 | 2 | 4 };
}
const MAP_URL = new URL("../assets/codeinjection/save-menu-map.lz", import.meta.url);
const DLL_URLS: Record<Version, URL> = {
  W2: new URL("../assets/codeinjection/SaveMenuW2.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/SaveMenuB2.dll", import.meta.url),
};
const dllPath = (version: Version) => `patches/SaveMenu${version}.dll`;
const versionOf = (project: ProjectState): Version | undefined => {
  const version = project.session.baseVersion;
  return project.session.baseRom === "BW2" && (version === "W2" || version === "B2") ? version : undefined;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
function hookSize(rpm: RpmModule, r: RpmModule["relocations"][number]): number {
  return r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0
    : ["OFFSET", "OFFSET_REL31", "THUMB_BRANCH_LINK", "ARM_BRANCH_LINK", "ARM_BRANCH"].includes(r.target.type) ? 4 : 32;
}
function patchBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const staged = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === path.toLowerCase());
  if (staged) return project.fileSystem?.additions?.[staged];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}

export function getSaveMenuStatus(project: ProjectState): { supported: boolean; installed: boolean; updateAvailable: boolean; message: string } {
  const version = versionOf(project);
  const supported = Boolean(version && (!project.romInfo?.idCode || project.romInfo.idCode === TARGETS[version].gameCode));
  const module = listCodeInjectionDlls(project).find(entry => entry.path === (version ? dllPath(version) : ""));
  const installed = Boolean(module);
  const updateAvailable = installed && module?.version !== DLL_VERSION;
  return { supported, installed, updateAvailable, message: !supported ? "Requires an English Black 2 or White 2 ROM with a compatible menu layout."
    : updateAvailable ? "A newer Black 2/White 2 save menu is available. Update it, then export a new ROM."
      : installed ? "Save menu module is staged. Export a new ROM to use it."
        : `Installs the animated save card, configurable menu music, Unova map, party recall, and Continue jump for compatible ${version}; PMC is installed if needed.` };
}

export async function installSaveMenu(project: ProjectState, settings: SaveMenuSettings = getSaveMenuSettings(project)): Promise<void> {
  const status = getSaveMenuStatus(project);
  if (!status.supported) throw new Error(status.message);
  const version = versionOf(project);
  if (!version) throw new Error(status.message);
  const target = TARGETS[version];
  const path = dllPath(version);
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reload the ROM before installing the save menu.");
  const rom = new NintendoDSRom(source, { fileData: "view" });
  if (rom.idCode !== target.gameCode) throw new Error(`The loaded ROM is not English ${version}.`);
  const arm9 = project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9);
  for (const site of [...target.functions, ...target.inputGlobals]) {
    const address = site.address & ~1;
    const offset = address - rom.arm9RamAddress;
    const expected = site.bytes;
    if (offset < 0 || hex(arm9.subarray(offset, offset + expected.length / 2)) !== expected) {
      throw new Error(`The ${version} native menu code changed at 0x${address.toString(16)}.`);
    }
  }
  for (const [assetPath, digest] of Object.entries(target.artSha256)) {
    const id = rom.filenames.idOf(assetPath);
    if (id === undefined || await sha256(getRomFileBytes(project, rom, id)) !== digest) {
      throw new Error(`The save-menu artwork differs at ${assetPath}; this ROM needs a rebuilt asset bundle.`);
    }
  }
  for (const requiredPath of target.requiredPaths) {
    if (rom.filenames.idOf(requiredPath) === undefined) throw new Error(`Required save-menu archive is missing: ${requiredPath}.`);
  }
  const song = target.soundSequence;
  const soundId = rom.filenames.idOf(song.path)!;
  const sdat = parseNitroSdat(getRomFileBytes(project, rom, soundId), song.path);
  const settingsBytes = encodeSaveMenuSettings(settings);
  if (settings.music === "relic-song") {
    const sequence = sdat.sequenceInfos[song.id];
    const sequenceFile = sequence && sdat.files[sequence.fileId];
    if (!sequence || !sequenceFile || sequence.symbol !== song.symbol || sequence.bankId !== song.bankId
      || await sha256(sequenceFile.data) !== song.sha256) {
      throw new Error("The ROM's Relic Song sequence differs from the supported save-menu soundtrack.");
    }
  } else {
    const selected = getStandaloneStreamConfigs(project).find(entry => entry.streamId === settings.streamId);
    const stream = listNativeSdatStreams(getRomFileBytes(project, rom, soundId)).find(entry => entry.id === settings.streamId);
    const file = selected && sdat.files[selected.streamFileId];
    if (!selected || !stream || stream.fileId !== selected.streamFileId || !file
      || await sha256(file.data) !== selected.audioSha256) {
      throw new Error("The selected standalone stream is missing or changed. Reopen Music and select a valid track.");
    }
  }
  const member = (archivePath: string, index: number): Uint8Array => {
    const id = rom.filenames.idOf(archivePath);
    if (id === undefined) throw new Error(`Required save-menu archive is missing: ${archivePath}.`);
    const bytes = new NARC(getRomFileBytes(project, rom, id)).files[index];
    if (!bytes) throw new Error(`Required save-menu data is missing from ${archivePath}.`);
    return bytes;
  };
  const locationNames = member("a/0/0/2", 109);
  for (const asset of target.artMembers) {
    if (await sha256(member(asset.path, asset.member)) !== asset.sha256) throw new Error(`The native save-menu artwork differs at ${asset.path}, member ${asset.member}; this ROM needs a rebuilt asset bundle.`);
  }
  const headers = member("a/0/1/2", 0);
  const points = member("a/0/8/5", 0);
  if (headers.length < 615 * 48 || points.length < 85 * 54) throw new Error("The map header or marker table is too short.");
  const headerNames = new Uint8Array(615 * 2);
  for (let i = 0; i < 615; i += 1) headerNames.set(headers.subarray(i * 48 + 26, i * 48 + 28), i * 2);
  const markerPoints = new Uint8Array(85 * 8);
  for (let i = 0; i < 85; i += 1) markerPoints.set(points.subarray(i * 54, i * 54 + 8), i * 8);
  for (const [name, bytes] of Object.entries({ locationNames, mapHeaderNames: headerNames, mapPoints: markerPoints })) {
    if (await sha256(bytes) !== target.mapDataSha256[name as keyof typeof target.mapDataSha256]) {
      throw new Error(`The embedded save-menu map data differs at ${name}; this ROM needs a rebuilt map bundle.`);
    }
  }
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([162]));
  const overlay = overlays.get(162);
  const hookOffset = overlay ? target.hook - overlay.ramAddress : -1;
  const hookBytes = project.overlays[162] ?? overlay?.data;
  if (!hookBytes || hookOffset < 0 || hex(hookBytes.subarray(hookOffset, hookOffset + 16)) !== target.hookBytes) {
    throw new Error("The native save-menu hook has changed.");
  }
  for (const site of target.overlaySignatures) {
    const offset = site.address - overlay!.ramAddress;
    if (offset < 0 || hex(hookBytes.subarray(offset, offset + site.bytes.length / 2)) !== site.bytes) {
      throw new Error(`The native Continue/C-Gear prompt code changed at 0x${site.address.toString(16)}. Remove the conflicting menu modification or use a compatible build.`);
    }
  }
  let ownsMap = false;
  const claimedRanges = [
    { module: "162", address: target.hook, bytes: 16 },
    ...target.overlaySignatures.map(site => ({ module: "162", address: site.address, bytes: site.bytes.length / 2 })),
    ...[...target.functions, ...target.inputGlobals].map(site => ({ module: "ARM9", address: site.address & ~1, bytes: site.bytes.length / 2 })),
  ];
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path.toLowerCase() === path.toLowerCase()) {
      const bytes = patchBytes(project, rom, entry.path);
      const digest = bytes && await sha256(bytes);
      if (!digest || !manifest.modules[version].recognizedSha256.includes(digest)) throw new Error(`Unrecognized save-menu module at ${entry.path}. Restore a recognized 0.2.3 or 0.3.x installation before updating.`);
      ownsMap = /^0\.3\./u.test(entry.version ?? "");
      continue;
    }
    if (/\/SaveMenu[WB]2\.dll$/iu.test(entry.path)) {
      throw new Error(`${entry.path} targets the other BW2 game or is already installed.`);
    }
    const bytes = patchBytes(project, rom, entry.path);
    if (!bytes) throw new Error(`Cannot inspect ${entry.path}.`);
    let rpm: RpmModule;
    try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); }
    catch { throw new Error(`Cannot inspect ${entry.path} for save-menu hook conflicts.`); }
    if (/\/MainMenuSkip[^/]*\.dll$/iu.test(entry.path) && rpm.relocations.some(r => r.target.module !== "base")) {
      throw new Error(`${entry.path} is active and would bypass the save menu. Remove that debug patch before installing.`);
    }
    if (rpm.relocations.some(r => {
      const start = r.target.address & ~1;
      // White2Upgrade extends these two native icon lookups for added forms.
      // Our menu calls their public entry points and benefits from those hooks.
      const upgradeIconAddress = version === "W2" ? [0x02020fc0, 0x02021060] : [0x02020f94, 0x02021034];
      if (/\/White2Upgrade\.dll$/iu.test(entry.path) && r.target.module === "ARM9"
        && r.target.type === "THUMB_BRANCH" && upgradeIconAddress.includes(start)) return false;
      return claimedRanges.some(range => (r.target.module === range.module || range.module === "ARM9" && r.target.module === "0")
        && start < range.address + range.bytes && range.address < start + hookSize(rpm, r));
    })) throw new Error(`Save-menu hook conflicts with ${entry.path}.`);
  }
  const response = await fetch(DLL_URLS[version]);
  if (!response.ok) throw new Error(`Could not load bundled save-menu DLL (${response.status}).`);
  const dll = new Uint8Array(await response.arrayBuffer());
  const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
  const hooks = rpm.relocations.filter(r => r.target.module !== "base");
  if (hooks.length !== 1 || hooks[0]?.target.module !== "162" || hooks[0]?.target.address !== target.hook
    || hooks[0]?.target.type !== "FULL_COPY" || hookSize(rpm, hooks[0]) !== 16) {
    throw new Error("Bundled save-menu DLL has an unexpected hook.");
  }
  if (await sha256(dll) !== manifest.modules[version].sha256 || rpm.metadata.PMCVersion !== DLL_VERSION || rpm.metadata.PMCGameID !== version) {
    throw new Error("Bundled save-menu DLL failed its version or integrity check.");
  }
  const mapResponse = await fetch(MAP_URL);
  if (!mapResponse.ok) throw new Error(`Could not load bundled save-menu map (${mapResponse.status}).`);
  const map = new Uint8Array(await mapResponse.arrayBuffer());
  if (map.length !== manifest.map.bytes || await sha256(map) !== manifest.map.sha256) throw new Error("Bundled save-menu map failed its integrity check.");
  const currentMap = patchBytes(project, rom, manifest.map.path);
  if (currentMap && await sha256(currentMap) !== manifest.map.sha256 && !ownsMap) {
    throw new Error(`Save-menu asset path conflicts with an existing file: ${manifest.map.path}.`);
  }
  const currentSettings = patchBytes(project, rom, SAVE_MENU_SETTINGS_PATH);
  if (currentSettings) {
    try { decodeSaveMenuSettings(currentSettings); }
    catch { throw new Error(`Save-menu settings path conflicts with an existing file: ${SAVE_MENU_SETTINGS_PATH}.`); }
  }
  const staged: ProjectState = { ...project, originalRomBytes: source, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, bytes]) => [id, bytes?.slice()])),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  adoptExistingPmcInstall(staged, source);
  if (!getPmcInstallStatus(staged).installed) installPmcBytes(staged, await loadBundledPmcBytes(version), source);
  const mapId = rom.filenames.idOf(manifest.map.path);
  if (mapId === undefined) addRomFile(staged, manifest.map.path, map);
  else {
    const added = Object.keys(staged.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === manifest.map.path.toLowerCase());
    if (added) delete staged.fileSystem!.additions![added];
    setRomFileReplacement(staged, mapId, map);
  }
  const settingsId = rom.filenames.idOf(SAVE_MENU_SETTINGS_PATH);
  if (settingsId === undefined) addRomFile(staged, SAVE_MENU_SETTINGS_PATH, settingsBytes);
  else {
    const added = Object.keys(staged.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === SAVE_MENU_SETTINGS_PATH);
    if (added) delete staged.fileSystem!.additions![added];
    setRomFileReplacement(staged, settingsId, settingsBytes);
  }
  stageCodeInjectionDll(staged, `SaveMenu${version}.dll`, dll, "patches", source);
  staged.codeInjection ??= {};
  staged.codeInjection.saveMenuSettings = settings;
  recordGenericChange(staged, "code_injection", `${version} animated save menu ${status.installed ? "updated" : "staged"}; party recall and Continue jump.`, "Save Menu", {
    key: "code-injection:save-menu",
  });
  Object.assign(project, { originalRomBytes: source, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog });

}
