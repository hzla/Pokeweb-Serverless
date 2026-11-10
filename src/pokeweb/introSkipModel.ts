import manifest from "../assets/codeinjection/introSkipManifest.json";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { canRemoveStagedCodeInjectionDll, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

/**
 * Skip Intro: a new game starts in the player's house in Aspertia City, in
 * control, without the Aspertia flyover, mom's call outside, the empty street
 * or the "I'm home!" scene.
 *
 * IntroSkipB2/W2.dll redirects five calls in overlay 35's new-game events
 * (one THUMB_BRANCH_LINK each). See runtime/intro-skip/README.md.
 */

export type IntroSkipVersion = keyof typeof manifest.games;
export const INTRO_SKIP_VERSION = manifest.version;
const UNSUPPORTED = "Skip Intro supports US Black 2 and White 2.";

const DLL_URLS: Record<IntroSkipVersion, URL> = {
  B2: new URL("../assets/codeinjection/IntroSkipB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/IntroSkipW2.dll", import.meta.url),
};
/** THUMB_BRANCH_LINK rewrites one 4-byte BL. */
const HOOK_BYTES = 4;
const HOOK_NAMES: Record<string, string> = {
  demo: "flyover",
  init: "new-game setup",
  hide: "player visibility",
  script: "intro script",
  spawn: "new-game spawn",
};

export type IntroSkipStatus = {
  supported: boolean;
  installed: boolean;
  compatible: boolean;
  updateAvailable: boolean;
  canUninstall: boolean;
  dllPath?: string;
  message: string;
};

export type IntroSkipInstallOptions = { dllOverride?: Uint8Array };

export function introSkipVersion(project: ProjectState): IntroSkipVersion | undefined {
  const version = project.session.baseVersion;
  return version === "B2" || version === "W2" ? version : undefined;
}

export function introSkipDllPath(version: IntroSkipVersion): string {
  return `patches/${manifest.games[version].fileName}`;
}

export function getIntroSkipStatus(project: ProjectState): IntroSkipStatus {
  const version = introSkipVersion(project);
  const state: IntroSkipStatus = { supported: false, installed: false, compatible: false, updateAvailable: false, canUninstall: false, message: "" };
  if (!version) return { ...state, message: UNSUPPORTED };
  state.supported = true;
  const path = introSkipDllPath(version);
  const module = listCodeInjectionDlls(project).find((entry) => entry.path.toLowerCase() === path.toLowerCase());
  const rom = openRom(project);
  if (module) {
    state.installed = true;
    state.dllPath = module.path;
    state.canUninstall = canRemoveStagedCodeInjectionDll(project, module.path);
    const bytes = rom ? moduleBytes(project, rom, module.path) : undefined;
    const rpm = bytes ? readRpm(bytes) : undefined;
    if (rpm && !isIntroSkipModule(rpm, version)) return { ...state, message: `${module.fileName} is not a recognized Skip Intro runtime.` };
    state.updateAvailable = rpm !== undefined && rpm.metadata.PMCVersion !== manifest.version;
  }
  if (!rom) return { ...state, compatible: state.installed, message: state.installed ? "Skip Intro is installed." : "Reload the ROM to check Skip Intro compatibility." };
  try {
    assertCompatible(project, rom, version);
  } catch (error) {
    return { ...state, message: (error as Error).message };
  }
  state.compatible = true;
  state.message = state.installed
    ? state.updateAvailable ? "An updated Skip Intro runtime is available." : "Skip Intro is installed."
    : "New-game event code matches. PMC is installed first if needed.";
  return state;
}

/** Install or update Skip Intro through the shared code-injection transaction. */
export function installIntroSkip(project: ProjectState, options: IntroSkipInstallOptions = {}): Promise<IntroSkipStatus> {
  return installCodeInjectionPatch(project, (staged) => stageIntroSkip(staged, options));
}

/** Stage the Skip Intro DLL into a project that already has PMC. */
export async function stageIntroSkip(project: ProjectState, options: IntroSkipInstallOptions = {}): Promise<IntroSkipStatus> {
  const version = introSkipVersion(project);
  if (!version) throw new Error(UNSUPPORTED);
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM before installing Skip Intro.");
  assertCompatible(project, rom, version);
  const bytes = options.dllOverride ?? await loadBundledDll(version);
  const rpm = readRpm(bytes);
  if (!rpm || !isIntroSkipModule(rpm, version)) throw new Error("The Skip Intro runtime failed its integrity check.");
  const result = stageCodeInjectionDll(project, manifest.games[version].fileName, bytes, "patches", project.originalRomBytes);
  recordGenericChange(project, "code_injection", "Skip Intro installed: a new game starts in the player's house, without the Aspertia flyover, mom's call or the \"I'm home!\" scene.", "Skip Intro", {
    key: "code-injection:intro-skip",
  });
  return { ...getIntroSkipStatus(project), dllPath: result.path };
}

/** Remove a staged Skip Intro install. */
export function uninstallIntroSkip(project: ProjectState): Promise<void> {
  return installCodeInjectionPatch(project, (staged) => {
    const version = introSkipVersion(staged);
    if (!version) throw new Error(UNSUPPORTED);
    const path = introSkipDllPath(version);
    if (!canRemoveStagedCodeInjectionDll(staged, path)) {
      throw new Error("Skip Intro is part of the loaded ROM and cannot be removed until NitroFS file deletion is supported.");
    }
    removeStagedCodeInjectionDll(staged, path);
    recordGenericChange(staged, "code_injection", "Skip Intro removed.", "Skip Intro", { key: "code-injection:intro-skip" });
  });
}

/** True for the bundled module shape: five THUMB_BRANCH_LINK hooks into overlay 35. */
export function isIntroSkipModule(rpm: RpmModule, version: IntroSkipVersion): boolean {
  const profile = manifest.games[version];
  if (rpm.metadata.PMCGameID !== version) return false;
  const external = rpm.relocations.filter((relocation) => relocation.target.module !== "base");
  const expected = Object.values(profile.hooks).map((hook) => Number.parseInt(hook.address, 16)).sort((a, b) => a - b);
  const actual = external.map((relocation) => relocation.target.address).sort((a, b) => a - b);
  return external.length === expected.length
    && external.every((relocation) => relocation.target.module === String(manifest.overlay) && relocation.target.type === "THUMB_BRANCH_LINK")
    && expected.every((address, index) => actual[index] === address);
}

function assertCompatible(project: ProjectState, rom: NintendoDSRom, version: IntroSkipVersion): void {
  const profile = manifest.games[version];
  if (rom.idCode !== profile.idCode) throw new Error(`The loaded ROM is ${rom.idCode}, not the supported ${profile.idCode}.`);
  if (project.originalRomBytes && project.originalRomBytes[0x1e] !== 0) throw new Error("Skip Intro requires the US revision-0 ROM.");
  const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_id, file) => getRomFileBytes(project, rom, file), new Set([manifest.overlay])).get(manifest.overlay);
  if (!overlay) throw new Error(`Overlay ${manifest.overlay} is missing.`);
  const buffers = [overlay.data, project.overlays[manifest.overlay] ?? overlay.data];
  for (const [name, hook] of Object.entries(profile.hooks)) {
    const offset = Number.parseInt(hook.address, 16) - overlay.ramAddress;
    if (buffers.some((buffer) => hex(buffer.subarray(offset, offset + hook.bytes.length / 2)) !== hook.bytes)) {
      throw new Error(`The ${HOOK_NAMES[name] ?? name} call at ${hook.address} has been changed by another patch.`);
    }
  }
  const ownPath = introSkipDllPath(version).toLowerCase();
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.path.toLowerCase() === ownPath) continue;
    const bytes = moduleBytes(project, rom, entry.path);
    const rpm = bytes ? readRpm(bytes) : undefined;
    if (!rpm) continue;
    for (const hook of Object.values(profile.hooks)) {
      const start = Number.parseInt(hook.address, 16);
      const overlaps = rpm.relocations.some(({ target, sourceSymbolIndex }) => {
        if (target.module !== String(manifest.overlay)) return false;
        const at = target.address & ~1;
        const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
          : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" || target.type === "ARM_BRANCH" ? 12 : 4;
        return at < start + HOOK_BYTES && at + size > start;
      });
      if (overlaps) throw new Error(`${entry.fileName} already patches the new-game code Skip Intro needs.`);
    }
  }
}

async function loadBundledDll(version: IntroSkipVersion): Promise<Uint8Array> {
  const response = await fetch(DLL_URLS[version]);
  if (!response.ok) throw new Error(`Could not load the bundled Skip Intro runtime (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== manifest.games[version].sha256) throw new Error("The bundled Skip Intro runtime failed its integrity check.");
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
