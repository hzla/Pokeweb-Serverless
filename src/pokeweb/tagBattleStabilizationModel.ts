import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import {
  canRemoveStagedCodeInjectionDll,
  getPmcInstallStatus,
  installBundledPmc,
  listCodeInjectionDlls,
  removeStagedCodeInjectionDll,
  stageCodeInjectionDll,
  type CodeInjectionDllInstallResult,
} from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

export const TAG_BATTLE_STABILIZATION_FILENAME = "TagBattleStabilizationW2.dll";
const DLL_URL = new URL("../assets/codeinjection/TagBattleStabilizationW2.dll", import.meta.url);
const KNOWN_FILENAMES = new Set([TAG_BATTLE_STABILIZATION_FILENAME.toLowerCase(), "cascadetagai.dll"]);

// US White 2 call sites and the native AI entry points called by the DLL.
// Script data and AI commands may be customized independently of these sites.
const SIGNATURES = [
  { overlayId: 167, address: 0x021b1848, hex: "cdf7fafe291cf831" },
  { overlayId: 167, address: 0x021b5b92, hex: "c9f7adfd002843d1" },
  { overlayId: 167, address: 0x021b18e8, hex: "cdf76aff4f208000" },
  { overlayId: 170, address: 0x0217f640, hex: "f0b583b0061c02930f1c0192089d2548" },
  { overlayId: 170, address: 0x0217f6f0, hex: "f8b584b0009096f671f9051c98300068" },
  { overlayId: 170, address: 0x0217f7c0, hex: "38b5051c96f60af9041ca4300068cbf6" },
];

// Recognize the tested runtime even under its original one-off filename or a
// user-supplied name. A matching filename alone must not authorize overwriting.
const RUNTIME_CODE_HEX =
  "37b50025034c2560069c0094024ca0473ebdc0467c00000041f6170210b5" +
  "074c2268002a02d00123824205d1044b20609847031e00d12060180010bd" +
  "7c000000f1f6170210b5034b98470022024b1a6010bdc046c1f717027c000000";
const RUNTIME_RELOCATIONS = [
  "base:14:OFFSET:5c:VALUE", "base:3c:OFFSET:5c:VALUE", "base:58:OFFSET:5c:VALUE",
  "167:21b1848:THUMB_BRANCH_LINK:0:FUNCTION_THM",
  "167:21b18e8:THUMB_BRANCH_LINK:44:FUNCTION_THM",
  "167:21b5b92:THUMB_BRANCH_LINK:1c:FUNCTION_THM",
].sort().join("|");

export type TagBattleStabilizationStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  pmcInstalled: boolean;
  canUninstall: boolean;
  dllPath?: string;
  message: string;
};

export function getTagBattleStabilizationStatus(project: ProjectState): TagBattleStabilizationStatus {
  const status: TagBattleStabilizationStatus = {
    supported: false, compatible: false, installed: false,
    pmcInstalled: getPmcInstallStatus(project).installed, canUninstall: false,
    message: "Tag Battle Stabilization currently supports US White 2 (IRDO) only.",
  };
  if (project.session.baseRom !== "BW2" || project.session.baseVersion !== "W2") return status;
  let rom: NintendoDSRom | undefined;
  try {
    if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes);
  } catch {
    return { ...status, supported: true, message: "Reload the ROM to check Tag Battle Stabilization compatibility." };
  }
  if ((rom?.idCode ?? project.romInfo.idCode) !== "IRDO") return status;
  status.supported = true;

  const conflicts: string[] = [];
  const installedPaths = new Set<string>();
  for (const entry of listCodeInjectionDlls(project)) {
    if (entry.target !== "patches") continue;
    const addedPath = Object.keys(project.fileSystem?.additions ?? {}).find((path) => path.toLowerCase() === entry.path.toLowerCase());
    const fileId = rom?.filenames.idOf(entry.path);
    const bytes = addedPath ? project.fileSystem!.additions![addedPath]
      : rom && fileId !== undefined ? getRomFileBytes(project, rom, fileId) : undefined;
    let rpm: RpmModule | undefined;
    try {
      if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    } catch {
      // Unrelated, older DLL formats are not evidence of an AI hook conflict.
    }
    if (rpm && isStabilizationRuntime(rpm)) {
      installedPaths.add(entry.path);
    } else if (KNOWN_FILENAMES.has(entry.fileName.toLowerCase()) || (rpm && touchesAiHooks(rpm))) {
      conflicts.push(entry.path);
    }
  }
  status.installed = installedPaths.size > 0;
  status.dllPath = [...installedPaths][0];
  status.canUninstall = installedPaths.size === 1 && canRemoveStagedCodeInjectionDll(project, status.dllPath!);
  if (conflicts.length || installedPaths.size > 1) {
    status.message = installedPaths.size > 1
      ? "Multiple Tag Battle Stabilization DLLs are present. Remove the duplicate before installing."
      : `Conflicting AI hooks or an unrecognized stabilization DLL: ${conflicts.join(", ")}.`;
    return status;
  }
  if (rom) {
    try {
      const overlays = loadOverlayTable(
        project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_overlayId, fileId) => getRomFileBytes(project, rom!, fileId), new Set([167, 170]),
      );
      for (const signature of SIGNATURES) {
        const overlay = overlays.get(signature.overlayId);
        const offset = overlay ? signature.address - overlay.ramAddress : -1;
        // Check raw file replacements as well as the editor overlay cache so a
        // cached original cannot hide a conflicting imported overlay.
        const candidates = [overlay?.data, project.overlays[signature.overlayId] ?? overlay?.data];
        if (candidates.some((data) => !data || offset < 0 || toHex(data.subarray(offset, offset + signature.hex.length / 2)) !== signature.hex)) {
          status.message = `AI code differs or is missing in overlay ${signature.overlayId} at 0x${signature.address.toString(16)}. This ROM is incompatible with the bundled patch.`;
          return status;
        }
      }
    } catch {
      status.message = "Could not read the battle AI overlays to check compatibility.";
      return status;
    }
  }
  status.compatible = true;
  status.message = status.installed
    ? "Tag Battle Stabilization is already included in this project."
    : rom ? "The battle AI hooks match the supported White 2 layout."
      : "The battle AI hooks will be checked during installation.";
  return status;
}

export async function installTagBattleStabilization(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Tag Battle Stabilization.");
  const status = getTagBattleStabilizationStatus(project);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  if (status.installed && status.dllPath) {
    return { path: status.dllPath, fileName: status.dllPath.split("/").pop()!, target: "patches", gameId: "W2", version: "1.0.0" };
  }
  const response = await fetch(DLL_URL);
  if (!response.ok) throw new Error(`Could not load Tag Battle Stabilization (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isStabilizationRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }))) {
    throw new Error("The bundled Tag Battle Stabilization DLL does not match the verified runtime.");
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, TAG_BATTLE_STABILIZATION_FILENAME, bytes);
  recordGenericChange(project, "code_injection", "Tag Battle Stabilization installed for tag battles exceeding six opposing Pokemon.", "Tag Battle Stabilization", {
    key: "code-injection:tag-battle-stabilization",
  });
  return result;
}

export function uninstallTagBattleStabilization(project: ProjectState): void {
  const status = getTagBattleStabilizationStatus(project);
  if (!status.canUninstall || !status.dllPath) throw new Error("Only a Tag Battle Stabilization DLL staged in this project can be removed.");
  removeStagedCodeInjectionDll(project, status.dllPath);
  recordGenericChange(project, "code_injection", "Tag Battle Stabilization removed from the staged ROM changes.", "Tag Battle Stabilization", {
    key: "code-injection:tag-battle-stabilization",
  });
}

function isStabilizationRuntime(rpm: RpmModule): boolean {
  return rpm.bssSize === 4 && rpm.baseAddress === 0 && rpm.metadata.PMCGameID === "W2"
    && rpm.metadata.PMCModulePriority === 4 && rpm.metadata.PMCVersion === "1.0.0"
    && !rpm.symbols.some((symbol) => symbol.attributes & 2)
    && toHex(rpm.code) === RUNTIME_CODE_HEX
    && rpm.relocations.map(({ target, sourceSymbolIndex }) => {
      const symbol = rpm.symbols[sourceSymbolIndex];
      return `${target.module}:${target.address.toString(16)}:${target.type}:${symbol?.address.toString(16)}:${symbol?.type}`;
    }).sort().join("|") === RUNTIME_RELOCATIONS;
}

function touchesAiHooks(rpm: RpmModule): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return SIGNATURES.some(({ overlayId, address, hex }) => target.module === String(overlayId)
      && target.address < address + hex.length / 2 && target.address + size > address);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
