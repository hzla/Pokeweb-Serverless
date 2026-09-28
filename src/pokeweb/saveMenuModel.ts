import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
import compatibility from "../../runtime/save-menu/compatibility.json";

type Version = "W2" | "B2";
const TARGETS = compatibility as Record<Version, (typeof compatibility)["W2"]>;
const DLL_VERSION = "0.2.3";
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
        : `Installs the animated save card, Unova map, and Continue zoom for compatible ${version}; PMC is installed if needed.` };
}

export async function installSaveMenu(project: ProjectState): Promise<void> {
  const status = getSaveMenuStatus(project);
  if (!status.supported || (status.installed && !status.updateAvailable)) throw new Error(status.message);
  const version = versionOf(project);
  if (!version) throw new Error(status.message);
  const target = TARGETS[version];
  const path = dllPath(version);
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reload the ROM before installing the save menu.");
  const rom = new NintendoDSRom(source);
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
  const member = (archivePath: string, index: number): Uint8Array => {
    const id = rom.filenames.idOf(archivePath);
    if (id === undefined) throw new Error(`Required save-menu archive is missing: ${archivePath}.`);
    const bytes = new NARC(getRomFileBytes(project, rom, id)).files[index];
    if (!bytes) throw new Error(`Required save-menu data is missing from ${archivePath}.`);
    return bytes;
  };
  const locationNames = member("a/0/0/2", 109);
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
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path === path && status.updateAvailable) continue;
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
      return r.target.module === "162" && start < target.hook + 16 && target.hook < start + hookSize(rpm, r);
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
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  stageCodeInjectionDll(project, `SaveMenu${version}.dll`, dll, "patches", source);
  recordGenericChange(project, "code_injection", `${version} animated save menu ${status.updateAvailable ? "updated" : "staged"}.`, "Save Menu", {
    key: "code-injection:save-menu",
  });
}
