import manifest from "../assets/codeinjection/autorunManifest.json";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { canRemoveStagedCodeInjectionDll, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import { assertOptionRowsCompatible, autorunOptionsTextInstalled, readOptionRowsState, reconcileOptionRows, stageAutorunOptionsText } from "./optionRowsModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

/**
 * Autorun: with the Running Shoes, moving runs and holding B walks.
 *
 * AutorunB/W/B2/W2.dll replaces the field player's grid and rail movement
 * wrappers (one THUMB_BRANCH each in the field overlay) and inverts B there.
 * The in-game Options row (the shared PokewebOptionRows module) stores
 * "Autorun off" in reserved CONFIG bit 12, so existing saves start with
 * Autorun on. See runtime/autorun/README.md.
 */

export type AutorunVersion = keyof typeof manifest.games;
export const AUTORUN_VERSION = manifest.version;
export const AUTORUN_CONFIG_BIT = manifest.configBit;

const DLL_URLS: Record<AutorunVersion, URL> = {
  B: new URL("../assets/codeinjection/AutorunB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/AutorunW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/AutorunB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/AutorunW2.dll", import.meta.url),
};
/** THUMB_BRANCH writes 12 bytes; each hooked wrapper is exactly that long. */
const HOOK_BYTES = 12;

export type AutorunStatus = {
  supported: boolean;
  installed: boolean;
  compatible: boolean;
  updateAvailable: boolean;
  canUninstall: boolean;
  /** The Options row (shared with Following Pokemon on Black 2 / White 2) is present. */
  optionsRow: boolean;
  /** Following Pokemon's row shares the Options module. */
  sharedWithFollowing: boolean;
  dllPath?: string;
  message: string;
};

export type AutorunInstallOptions = { dllOverride?: Uint8Array; rowsDllOverride?: Uint8Array };

export function autorunVersion(project: ProjectState): AutorunVersion | undefined {
  const version = project.session.baseVersion;
  return version === "B" || version === "W" || version === "B2" || version === "W2" ? version : undefined;
}

export function autorunDllPath(version: AutorunVersion): string {
  return `patches/${manifest.games[version].fileName}`;
}

export function getAutorunStatus(project: ProjectState): AutorunStatus {
  const version = autorunVersion(project);
  const state: AutorunStatus = { supported: false, installed: false, compatible: false, updateAvailable: false, canUninstall: false, optionsRow: false, sharedWithFollowing: false, message: "" };
  if (!version) return { ...state, message: "Autorun supports US Black, White, Black 2 and White 2." };
  state.supported = true;
  const path = autorunDllPath(version);
  const module = listCodeInjectionDlls(project).find((entry) => entry.path.toLowerCase() === path.toLowerCase());
  const rom = openRom(project);
  const rows = readOptionRowsState(project);
  state.optionsRow = rows.rows.includes("autorun") && autorunOptionsTextInstalled(project);
  state.sharedWithFollowing = rows.rows.includes("following") && rows.rows.includes("autorun");
  if (module) {
    state.installed = true;
    state.dllPath = module.path;
    state.canUninstall = canRemoveStagedCodeInjectionDll(project, module.path);
    const bytes = rom ? moduleBytes(project, rom, module.path) : undefined;
    const rpm = bytes ? readRpm(bytes) : undefined;
    if (rpm && !isAutorunModule(rpm, version)) return { ...state, message: `${module.fileName} is not a recognized Autorun runtime.` };
    state.updateAvailable = (rpm !== undefined && rpm.metadata.PMCVersion !== manifest.version) || !state.optionsRow;
  }
  if (!rom) return { ...state, compatible: state.installed, message: state.installed ? "Autorun is installed." : "Reload the ROM to check Autorun compatibility." };
  try {
    assertCompatible(project, rom, version);
    if (!state.optionsRow) assertOptionRowsCompatible(project);
  } catch (error) {
    return { ...state, message: (error as Error).message };
  }
  state.compatible = true;
  state.message = state.installed
    ? state.updateAvailable ? "An updated Autorun runtime is available." : "Autorun is installed."
    : "Field movement and Options hooks match. PMC is installed first if needed.";
  return state;
}

/** Install or update Autorun through the shared code-injection transaction. */
export function installAutorun(project: ProjectState, options: AutorunInstallOptions = {}): Promise<AutorunStatus> {
  return installCodeInjectionPatch(project, (staged) => stageAutorun(staged, options));
}

/** Stage the Autorun DLL into a project that already has PMC. */
export async function stageAutorun(project: ProjectState, options: AutorunInstallOptions = {}): Promise<AutorunStatus> {
  const version = autorunVersion(project);
  if (!version) throw new Error("Autorun supports US Black, White, Black 2 and White 2.");
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM before installing Autorun.");
  assertCompatible(project, rom, version);
  const bytes = options.dllOverride ?? await loadBundledDll(version);
  const rpm = readRpm(bytes);
  if (!rpm || !isAutorunModule(rpm, version)) throw new Error("The Autorun runtime failed its integrity check.");
  const result = stageCodeInjectionDll(project, manifest.games[version].fileName, bytes, "patches", project.originalRomBytes);
  stageAutorunOptionsText(project, true);
  const rows = await reconcileOptionRows(project, { autorun: true }, { dllOverride: options.rowsDllOverride });
  recordGenericChange(project, "code_injection", `Autorun installed: with the Running Shoes, moving runs and holding B walks. The Options screen has an Autorun On/Off row${rows.includes("following") ? " below Following Pokémon's" : ""}.`, "Autorun", {
    key: "code-injection:autorun",
  });
  const status = getAutorunStatus(project);
  return { ...status, dllPath: result.path };
}

/** Remove a staged Autorun install, its Options row and text. */
export function uninstallAutorun(project: ProjectState): Promise<void> {
  return installCodeInjectionPatch(project, async (staged) => {
    const version = autorunVersion(staged);
    if (!version) throw new Error("Autorun supports US Black, White, Black 2 and White 2.");
    const path = autorunDllPath(version);
    if (!canRemoveStagedCodeInjectionDll(staged, path)) {
      throw new Error("Autorun is part of the loaded ROM and cannot be removed until NitroFS file deletion is supported.");
    }
    removeStagedCodeInjectionDll(staged, path);
    await reconcileOptionRows(staged, { autorun: false });
    stageAutorunOptionsText(staged, false);
    recordGenericChange(staged, "code_injection", "Autorun removed.", "Autorun", { key: "code-injection:autorun" });
  });
}

/** True for the bundled module shape: two THUMB_BRANCH hooks into the field overlay. */
export function isAutorunModule(rpm: RpmModule, version: AutorunVersion): boolean {
  const profile = manifest.games[version];
  if (rpm.metadata.PMCGameID !== version) return false;
  const external = rpm.relocations.filter((relocation) => relocation.target.module !== "base");
  const expected = Object.values(profile.hooks).map((hook) => Number.parseInt(hook.address, 16)).sort();
  const actual = external.map((relocation) => relocation.target.address).sort();
  return external.length === expected.length
    && external.every((relocation) => relocation.target.module === String(profile.fieldOverlay) && relocation.target.type === "THUMB_BRANCH")
    && expected.every((address, index) => actual[index] === address);
}

function assertCompatible(project: ProjectState, rom: NintendoDSRom, version: AutorunVersion): void {
  const profile = manifest.games[version];
  if (rom.idCode !== profile.idCode) throw new Error(`The loaded ROM is ${rom.idCode}, not the supported ${profile.idCode}.`);
  if (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0) throw new Error("Autorun requires the US revision-0 ROM.");
  const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_id, file) => getRomFileBytes(project, rom, file), new Set([profile.fieldOverlay])).get(profile.fieldOverlay);
  if (!overlay) throw new Error(`Field overlay ${profile.fieldOverlay} is missing.`);
  const buffers = [overlay.data, project.overlays[profile.fieldOverlay] ?? overlay.data];
  for (const [name, hook] of Object.entries(profile.hooks)) {
    const offset = Number.parseInt(hook.address, 16) - overlay.ramAddress;
    if (buffers.some((buffer) => hex(buffer.subarray(offset, offset + hook.bytes.length / 2)) !== hook.bytes)) {
      throw new Error(`The field ${name === "grid" ? "grid" : "rail"} movement code at ${hook.address} has been changed by another patch.`);
    }
  }
  const ownPath = autorunDllPath(version).toLowerCase();
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path.toLowerCase() === ownPath) continue;
    const bytes = moduleBytes(project, rom, entry.path);
    const rpm = bytes ? readRpm(bytes) : undefined;
    if (!rpm) continue;
    for (const hook of Object.values(profile.hooks)) {
      const start = Number.parseInt(hook.address, 16);
      const overlaps = rpm.relocations.some(({ target, sourceSymbolIndex }) => {
        if (target.module !== String(profile.fieldOverlay)) return false;
        const at = target.address & ~1;
        const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
          : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? HOOK_BYTES : 4;
        return at < start + HOOK_BYTES && at + size > start;
      });
      if (overlaps) throw new Error(`${entry.fileName} already patches the field movement code Autorun needs.`);
    }
  }
}

async function loadBundledDll(version: AutorunVersion): Promise<Uint8Array> {
  const response = await fetch(DLL_URLS[version]);
  if (!response.ok) throw new Error(`Could not load the bundled Autorun runtime (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== manifest.games[version].sha256) throw new Error("The bundled Autorun runtime failed its integrity check.");
  return bytes;
}

function openRom(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return undefined;
  try { return new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); } catch { return undefined; }
}

function moduleBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const staged = Object.keys(project.fileSystem?.additions ?? {}).find((candidate) => candidate.toLowerCase() === path.toLowerCase());
  if (staged) return project.fileSystem!.additions![staged];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}

function readRpm(bytes: Uint8Array): RpmModule | undefined {
  try { return parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { return undefined; }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}
