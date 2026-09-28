import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import {
  detectBlack2UpgradeDlls, detectWhite2UpgradeDlls, getPmcInstallStatus,
  installBundledPmc, listCodeInjectionDlls, stageCodeInjectionDll,
  type CodeInjectionDllInstallResult,
} from "./pmcModel";
import { type ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

export const LEVEL_CAP_WORK_VARIABLE = 16415;

const LAYOUTS = {
  B2: {
    idCode: "IREO", fileName: "HardLevelCapsB2.dll",
    url: new URL("../assets/codeinjection/HardLevelCapsB2.dll", import.meta.url),
    hooks: [
      { overlay: 36, address: 0x021bd4f4, bytes: "f8b582b0051ca868", type: "THUMB_BRANCH" },
      { overlay: 165, address: 0x021a23e8, bytes: "f0b587b0171c1a04", type: "THUMB_BRANCH" },
      { overlay: 36, address: 0x021bd370, bytes: "00f06af9", type: "THUMB_BRANCH_LINK" },
      { overlay: 36, address: 0x021bd6a0, bytes: "5ff63cfb", type: "THUMB_BRANCH_LINK" },
      { overlay: 167, address: 0x021af070, bytes: "64f6befb", type: "THUMB_BRANCH_LINK" },
    ],
  },
  W2: {
    idCode: "IRDO", fileName: "HardLevelCapsW2.dll",
    url: new URL("../assets/codeinjection/HardLevelCapsW2.dll", import.meta.url),
    hooks: [
      { overlay: 36, address: 0x021bd52c, bytes: "f8b582b0051ca868", type: "THUMB_BRANCH" },
      { overlay: 165, address: 0x021a2428, bytes: "f0b587b0171c1a04", type: "THUMB_BRANCH" },
      { overlay: 36, address: 0x021bd3a8, bytes: "00f06af9", type: "THUMB_BRANCH_LINK" },
      { overlay: 36, address: 0x021bd6d8, bytes: "5ff636fb", type: "THUMB_BRANCH_LINK" },
      { overlay: 167, address: 0x021af0b0, bytes: "64f69efb", type: "THUMB_BRANCH_LINK" },
    ],
  },
} as const;
type Version = keyof typeof LAYOUTS;
type Layout = typeof LAYOUTS[Version];

export type LevelCapsStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  message: string;
};

export function getLevelCapsStatus(project: ProjectState): LevelCapsStatus {
  const unsupported = (message: string): LevelCapsStatus => ({ supported: false, compatible: false, installed: false, message });
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) {
    return unsupported("Hard Level Caps supports US Black 2 and White 2 only.");
  }
  const layout = LAYOUTS[version];
  if (project.romInfo.idCode !== layout.idCode) {
    return unsupported("Hard Level Caps requires a US Black 2 or White 2 ROM.");
  }
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return unsupported("This build is for the stock BW2 battle and Day Care code, not the upgrade patches.");
  }
  const modules = listCodeInjectionDlls(project).filter((module) => module.target === "patches");
  const ownPath = `patches/${layout.fileName}`;
  const installed = modules.some((module) => module.path.toLowerCase() === ownPath.toLowerCase());
  if (!project.originalRomBytes) {
    return { supported: true, compatible: false, installed, message: "Reload the ROM to verify the battle, Day Care, and item hooks." };
  }
  try {
    const rom = new NintendoDSRom(project.originalRomBytes);
    if (rom.idCode !== layout.idCode) throw new Error("ROM version differs from the project.");
    const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_id, fileId) => getRomFileBytes(project, rom, fileId), new Set([36, 165, 167]));
    for (const hook of layout.hooks) {
      const overlay = overlays.get(hook.overlay);
      const bytes = project.overlays[hook.overlay] ?? overlay?.data;
      if (!overlay || !bytes || toHex(bytes.subarray(hook.address - overlay.ramAddress,
        hook.address - overlay.ramAddress + hook.bytes.length / 2)) !== hook.bytes) {
        return { supported: true, compatible: false, installed, message: "The battle, Day Care, or item code differs from the audited US BW2 ROM." };
      }
    }
    for (const module of modules) {
      const bytes = codeInjectionModuleBytes(project, rom, module.path);
      if (!bytes) continue;
      let rpm: RpmModule;
      try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
      if (module.path.toLowerCase() === ownPath.toLowerCase()) {
        if (!isOwnRuntime(rpm, version)) {
          return { supported: true, compatible: false, installed, message: "An unrecognized DLL uses the Hard Level Caps filename." };
        }
      } else if (overlapsHooks(rpm, layout)) {
        return { supported: true, compatible: false, installed, message: `The ${module.fileName} DLL already changes a Hard Level Caps hook.` };
      }
    }
  } catch {
    return { supported: true, compatible: false, installed, message: "Could not verify the stock BW2 hook locations." };
  }
  return {
    supported: true, compatible: true, installed,
    message: installed ? "Hard Level Caps is staged. Export the ROM to apply it."
      : "Installs PMC and the version matched battle, Day Care, and item cap hooks.",
  };
}

export async function installLevelCaps(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Hard Level Caps.");
  const status = getLevelCapsStatus(project);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const layout = LAYOUTS[version];
  const response = await fetch(layout.url);
  if (!response.ok) throw new Error(`Could not load Hard Level Caps (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isOwnRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), version)) {
    throw new Error("The bundled Hard Level Caps DLL does not match its BW2 hook contract.");
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, layout.fileName, bytes);
  recordGenericChange(project, "code_injection", "Hard Level Caps installed; script work variable 16415 sets the cap (0 means 100).", "Hard Level Caps", {
    key: "code-injection:hard-level-caps",
  });
  return result;
}

function isOwnRuntime(rpm: RpmModule, version: Version): boolean {
  const layout = LAYOUTS[version];
  const targets = rpm.relocations.filter(({ target }) => target.module !== "base")
    .map(({ target }) => `${target.type}:${target.module}:${target.address}`).sort();
  const expected = layout.hooks.map((hook) => `${hook.type}:${hook.overlay}:${hook.address}`).sort();
  return rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === "1.0.0"
    && rpm.metadata.PMCModulePriority === 4 && rpm.bssSize === 0 && rpm.relocations.length === 27
    && targets.join("|") === expected.join("|");
}

function overlapsHooks(rpm: RpmModule, layout: Layout): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return layout.hooks.some((hook) => target.module === String(hook.overlay)
      && target.address < hook.address + hook.bytes.length / 2 && target.address + size > hook.address);
  });
}

function codeInjectionModuleBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const stagedPath = Object.keys(project.fileSystem?.additions ?? {}).find((entry) => entry.toLowerCase() === path.toLowerCase());
  if (stagedPath) return project.fileSystem?.additions?.[stagedPath];
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
