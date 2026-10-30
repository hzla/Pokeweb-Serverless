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
import { getInstalledInfiniteCandyItemId } from "./infiniteCandyModel";
import { configureLevelCapsRuntime, getLevelCapsRuntime, inspectLevelCapsRuntime } from "./levelCapsRuntime";

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
  updateAvailable?: boolean;
  candyItemId?: number;
};

export function getLevelCapsStatus(project: ProjectState): LevelCapsStatus {
  const unsupported = (message: string): LevelCapsStatus => ({ supported: false, compatible: false, installed: false, message });
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) {
    return unsupported("Hard Level Caps supports US Black 2 and White 2 only.");
  }
  const layout = LAYOUTS[version];
  const candyItemId = getInstalledInfiniteCandyItemId(project);
  if (project.romInfo.idCode !== layout.idCode) {
    return unsupported("Hard Level Caps requires a US Black 2 or White 2 ROM.");
  }
  if (detectWhite2UpgradeDlls(project) || detectBlack2UpgradeDlls(project)) {
    return unsupported("This build is for the stock BW2 battle and Day Care code, not the upgrade patches.");
  }
  const modules = listCodeInjectionDlls(project).filter((module) => module.target === "patches");
  const ownPath = `patches/${layout.fileName}`;
  if (modules.filter(module => module.path.toLowerCase() === ownPath.toLowerCase()).length > 1) {
    return { supported: true, compatible: false, installed: true, message: "Multiple Hard Level Caps DLLs are present." };
  }
  const installed = modules.some((module) => module.path.toLowerCase() === ownPath.toLowerCase());
  if (project.originalRomBytes && modules.some(module => module.fileName.toLowerCase() === `infinitecandy${version}.dll`.toLowerCase()) && candyItemId === undefined) {
    return { supported: true, compatible: false, installed, message: "The installed Infinite Candy DLL is unrecognized." };
  }
  const runtime = getLevelCapsRuntime(project);
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
      if (!bytes) {
        if (module.path.toLowerCase() === ownPath.toLowerCase()) return { supported: true, compatible: false, installed, message: "The Hard Level Caps DLL is missing." };
        continue;
      }
      let rpm: RpmModule;
      try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); }
      catch {
        if (module.path.toLowerCase() === ownPath.toLowerCase()) return { supported: true, compatible: false, installed, message: "An unrecognized DLL uses the Hard Level Caps filename." };
        continue;
      }
      if (module.path.toLowerCase() === ownPath.toLowerCase()) {
        if (!inspectLevelCapsRuntime(rpm, version)) {
          return { supported: true, compatible: false, installed, message: "An unrecognized DLL uses the Hard Level Caps filename." };
        }
      } else if (overlapsHooks(rpm, layout)) {
        return { supported: true, compatible: false, installed, message: `The ${module.fileName} DLL already changes a Hard Level Caps hook.` };
      }
    }
  } catch {
    return { supported: true, compatible: false, installed, message: "Could not verify the stock BW2 hook locations." };
  }
  const updateAvailable = Boolean(runtime && (runtime.legacy || (candyItemId !== undefined && runtime.itemId !== candyItemId)));
  return {
    supported: true, compatible: true, installed, updateAvailable, candyItemId: candyItemId ?? runtime?.itemId ?? 622,
    message: updateAvailable ? candyItemId !== undefined && runtime?.itemId !== candyItemId
      ? "Update Hard Level Caps to match the installed Infinite Candy item." : "A Hard Level Caps update is available."
      : installed ? "Hard Level Caps is staged. Export the ROM to apply it."
      : "Installs PMC and the version matched battle, Day Care, and item cap hooks.",
  };
}

async function stageLevelCaps(project: ProjectState, itemId: number, fileName: string): Promise<CodeInjectionDllInstallResult> {
  const version = project.session.baseVersion as Version, layout = LAYOUTS[version];
  const response = await fetch(layout.url);
  if (!response.ok) throw new Error(`Could not load Hard Level Caps (${response.status}).`);
  const bytes = configureLevelCapsRuntime(new Uint8Array(await response.arrayBuffer()), version, itemId);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, fileName, bytes);
  recordGenericChange(project, "code_injection", `Hard Level Caps installed for Infinite Candy item ${itemId}; script work variable 16415 sets the cap (0 means 100).`, "Hard Level Caps", {
    key: "code-injection:hard-level-caps",
  });
  return result;
}

/** Synchronize an existing cap runtime while the Candy installer is staging its atomic changes. */
export async function synchronizeLevelCapsForCandy(project: ProjectState, itemId: number): Promise<void> {
  const version = project.session.baseVersion;
  if (version !== "B2" && version !== "W2") return;
  const entry = listCodeInjectionDlls(project).find(m => m.target === "patches" && m.fileName.toLowerCase() === `hardlevelcaps${version}.dll`.toLowerCase());
  if (!entry) return;
  const runtime = getLevelCapsRuntime(project);
  if (!runtime) throw new Error("The installed Hard Level Caps DLL is unrecognized.");
  const status = getLevelCapsStatus(project);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  if (runtime.itemId === itemId) return;
  await stageLevelCaps(project, itemId, runtime.fileName);
}

export async function installLevelCaps(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  const staged: ProjectState = { ...project, arm9: project.arm9.slice(), overlays: structuredClone(project.overlays),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  staged.originalRomBytes ??= await loadActiveRomBytes();
  if (!staged.originalRomBytes) throw new Error("Reload the ROM before installing Hard Level Caps.");
  const status = getLevelCapsStatus(staged);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = staged.session.baseVersion as Version;
  const runtime = getLevelCapsRuntime(staged);
  const result = await stageLevelCaps(staged, getInstalledInfiniteCandyItemId(staged) ?? runtime?.itemId ?? 622, runtime?.fileName ?? LAYOUTS[version].fileName);
  Object.assign(project, { originalRomBytes: staged.originalRomBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
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
