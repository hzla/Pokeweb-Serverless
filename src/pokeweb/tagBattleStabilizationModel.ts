import manifest from "../assets/codeinjection/tagBattleStabilizationManifest.json";
import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
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

type Game = keyof typeof manifest.games;
type Profile = (typeof manifest.games)[Game];
const DLL_URLS: Record<Game, URL> = {
  B: new URL("../assets/codeinjection/TagBattleStabilizationB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/TagBattleStabilizationW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/TagBattleStabilizationB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/TagBattleStabilizationW2.dll", import.meta.url),
};
const KNOWN_FILENAMES = new Set([
  ...Object.values(manifest.games).map(profile => profile.fileName.toLowerCase()), "cascadetagai.dll",
]);

const OWNER_RELOCATIONS = [
  "base:14:OFFSET:5c:VALUE", "base:3c:OFFSET:5c:VALUE", "base:58:OFFSET:5c:VALUE",
];
const WRAPPER_OFFSETS = [0, 0x1c, 0x44];

function gameForProject(project: ProjectState): Game | undefined {
  const { baseRom, baseVersion } = project.session;
  if (baseRom === "BW" && (baseVersion === "B" || baseVersion === "W")) return baseVersion;
  if (baseRom === "BW2" && (baseVersion === "B2" || baseVersion === "W2")) return baseVersion;
  return undefined;
}

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
    message: "Tag Battle Stabilization requires US revision-0 Black, White, Black 2, or White 2.",
  };
  const game = gameForProject(project);
  if (!game) return status;
  const profile = manifest.games[game];
  const signatures = [...profile.calls, ...profile.entries];
  let rom: NintendoDSRom | undefined;
  try {
    if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
  } catch {
    return { ...status, supported: true, message: "Reload the ROM to check Tag Battle Stabilization compatibility." };
  }
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode) return status;
  // Retain the original White 2 signature-based compatibility for edited headers.
  if (rom && game !== "W2" && rom.data[0x1e] !== 0) return status;
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
    if (rpm && isStabilizationRuntime(rpm, game, profile)) {
      installedPaths.add(entry.path);
    } else if (KNOWN_FILENAMES.has(entry.fileName.toLowerCase()) || (rpm && touchesAiHooks(rpm, signatures))) {
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
        (_overlayId, fileId) => getRomFileBytes(project, rom!, fileId), new Set(signatures.map(signature => signature.overlayId)),
      );
      for (const signature of signatures) {
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
    : rom ? "The battle AI hooks match the supported ROM layout."
      : "The battle AI hooks will be checked during installation.";
  return status;
}

export async function installTagBattleStabilization(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Tag Battle Stabilization.");
  const game = gameForProject(project);
  const status = getTagBattleStabilizationStatus(project);
  if (!game || !status.supported || !status.compatible) throw new Error(status.message);
  if (status.installed && status.dllPath) {
    return { path: status.dllPath, fileName: status.dllPath.split("/").pop()!, target: "patches", gameId: game, version: manifest.version };
  }
  const profile = manifest.games[game];
  const response = await fetch(DLL_URLS[game]);
  if (!response.ok) throw new Error(`Could not load Tag Battle Stabilization (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isStabilizationRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), game, profile)) {
    throw new Error("The bundled Tag Battle Stabilization DLL does not match the verified runtime.");
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const result = stageCodeInjectionDll(project, profile.fileName, bytes);
  recordGenericChange(project, "code_injection", "Tag Battle Stabilization installed.", "Tag Battle Stabilization", {
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

// Match by binary identity even under a renamed file or the original Cascade name.
function isStabilizationRuntime(rpm: RpmModule, game: Game, profile: Profile): boolean {
  if (rpm.bssSize !== 4 || rpm.baseAddress !== 0 || rpm.metadata.PMCGameID !== game
    || rpm.metadata.PMCModulePriority !== 4 || rpm.metadata.PMCVersion !== manifest.version
    || rpm.symbols.some(symbol => symbol.attributes & 2) || sha256Hex(rpm.code) !== profile.codeSha256) return false;
  const expectedRelocations = [
    ...OWNER_RELOCATIONS,
    ...profile.calls.map(({ overlayId, address }, index) =>
      `${overlayId}:${address.toString(16)}:THUMB_BRANCH_LINK:${WRAPPER_OFFSETS[index].toString(16)}:FUNCTION_THM`),
  ].sort().join("|");
  return rpm.relocations.map(({ target, sourceSymbolIndex }) => {
    const symbol = rpm.symbols[sourceSymbolIndex];
    return `${target.module}:${target.address.toString(16)}:${target.type}:${symbol?.address.toString(16)}:${symbol?.type}`;
  }).sort().join("|") === expectedRelocations;
}

function touchesAiHooks(rpm: RpmModule, signatures: Profile["calls"]): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return signatures.some(({ overlayId, address, hex }) => target.module === String(overlayId)
      && target.address < address + hex.length / 2 && target.address + size > address);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
