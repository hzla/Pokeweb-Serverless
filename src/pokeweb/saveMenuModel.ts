import { writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { getPmcInstallStatus, listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

const TARGET_SHA = "6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9";
const SKIP_SHA = "cd1da75cfb740ee1e5b9d3abacd23bf8209e3b6f536cbdd7bc336995518ca67f";
const HOOK = 0x0219d9e4;
const HOOK_BYTES = "38b519251c1c2d016159201c8a000849";
const DLL_PATH = "patches/SaveMenuW2.dll";
const DLL_VERSION = "0.1.9";
const SKIP_PATH = "patches/MainMenuSkip(1).dll";
const DLL_URL = new URL("../assets/codeinjection/SaveMenuW2.dll", import.meta.url);

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
  const supported = project.session.baseRom === "BW2" && project.session.baseVersion === "W2" && getPmcInstallStatus(project).installed;
  const module = listCodeInjectionDlls(project).find(entry => entry.path === DLL_PATH);
  const installed = Boolean(module);
  const updateAvailable = installed && module?.version !== DLL_VERSION;
  return { supported, installed, updateAvailable, message: !supported ? "Requires the inspected White 2 Following Pokemon 0.7.16 alpha ROM with PMC."
    : updateAvailable ? "A newer save menu with the Continue map zoom is available. Update it, then export a new ROM."
      : installed ? "Save menu module is staged. Export a new ROM to use it."
        : "Installs the animated save card, Unova map, and Continue zoom for the inspected 0.7.16 alpha ROM." };
}

export async function installSaveMenu(project: ProjectState): Promise<void> {
  const status = getSaveMenuStatus(project);
  if (!status.supported || (status.installed && !status.updateAvailable)) throw new Error(status.message);
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source || await sha256(source) !== TARGET_SHA) throw new Error("The loaded ROM differs from the inspected Following Pokemon 0.7.16 alpha build.");
  const rom = new NintendoDSRom(source);
  if (rom.idCode !== "IRDO") throw new Error("The loaded ROM is not English White 2.");
  const skipId = rom.filenames.idOf(SKIP_PATH);
  if (skipId === undefined) throw new Error("Main Menu Skip is missing from the inspected ROM.");
  const originalSkip = rom.files[skipId];
  const skip = patchBytes(project, rom, SKIP_PATH);
  if (!originalSkip || !skip || await sha256(originalSkip) !== SKIP_SHA || skip.length !== 320) {
    throw new Error("Main Menu Skip differs from the inspected build.");
  }
  const disabled = originalSkip.slice();
  writeU32(disabled, 280, 0);
  const skipHash = await sha256(skip);
  if (skipHash !== SKIP_SHA && skipHash !== await sha256(disabled)) {
    throw new Error("Main Menu Skip differs from the inspected build.");
  }
  const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([162]));
  const overlay = overlays.get(162);
  const hookOffset = overlay ? HOOK - overlay.ramAddress : -1;
  const hookBytes = project.overlays[162] ?? overlay?.data;
  if (!hookBytes || hookOffset < 0 || hex(hookBytes.subarray(hookOffset, hookOffset + 16)) !== HOOK_BYTES) {
    throw new Error("The native save-menu hook has changed.");
  }
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path === DLL_PATH && status.updateAvailable) continue;
    const bytes = patchBytes(project, rom, entry.path);
    if (!bytes) throw new Error(`Cannot inspect ${entry.path}.`);
    let rpm: RpmModule;
    try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); }
    catch { throw new Error(`Cannot inspect ${entry.path} for save-menu hook conflicts.`); }
    if (rpm.relocations.some(r => {
      const start = r.target.address & ~1;
      return r.target.module === "162" && start < HOOK + 16 && HOOK < start + hookSize(rpm, r);
    })) throw new Error(`Save-menu hook conflicts with ${entry.path}.`);
  }
  const response = await fetch(DLL_URL);
  if (!response.ok) throw new Error(`Could not load bundled save-menu DLL (${response.status}).`);
  const dll = new Uint8Array(await response.arrayBuffer());
  const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
  const hooks = rpm.relocations.filter(r => r.target.module !== "base");
  if (hooks.length !== 1 || hooks[0]?.target.module !== "162" || hooks[0]?.target.address !== HOOK
    || hooks[0]?.target.type !== "FULL_COPY" || hookSize(rpm, hooks[0]) !== 16) {
    throw new Error("Bundled save-menu DLL has an unexpected hook.");
  }
  if (parseRpm(disabled, { allowedMagics: ["DLXF"] }).relocations.some(r => r.target.module !== "base")) {
    throw new Error("Main Menu Skip could not be disabled.");
  }
  stageCodeInjectionDll(project, "SaveMenuW2.dll", dll, "patches", source);
  setRomFileReplacement(project, skipId, disabled);
  recordGenericChange(project, "code_injection", `White 2 animated save menu ${status.updateAvailable ? "updated" : "staged"} for the inspected Following Pokemon alpha ROM.`, "Save Menu", {
    key: "code-injection:save-menu",
  });
}
