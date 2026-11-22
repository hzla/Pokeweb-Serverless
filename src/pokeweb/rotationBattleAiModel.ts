import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/rotationBattleAiManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { withProjectMutationLock } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import {
  canRemoveStagedCodeInjectionDll,
  listCodeInjectionDlls,
  removeStagedCodeInjectionDll,
  stageCodeInjectionDll,
} from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

const TITLE = "Rotation Battle AI";
const CHANGE_KEY = "code-injection:rotation-battle-ai";
const URLS = {
  B: new URL("../assets/codeinjection/RotationBattleAIB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/RotationBattleAIW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/RotationBattleAIB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/RotationBattleAIW2.dll", import.meta.url),
};
type Game = keyof typeof URLS;
type Status = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  canUninstall: boolean;
  path?: string;
  message: string;
};

function gameOf(project: ProjectState): Game | undefined {
  const game = project.session.baseVersion;
  if (project.session.baseRom === "BW" && (game === "B" || game === "W")) return game;
  if (project.session.baseRom === "BW2" && (game === "B2" || game === "W2")) return game;
  return undefined;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function isRotationAi(rpm: RpmModule, game: Game): boolean {
  const { hooks } = manifest.games[game];
  if (rpm.metadata.PMCGameID !== game || rpm.metadata.PokewebRotationAI !== 1 ||
      rpm.metadata.PMCVersion !== manifest.version || rpm.metadata.PMCModulePriority !== 4 ||
      rpm.baseAddress !== 0 || rpm.symbols.some(symbol => symbol.attributes & 2)) return false;
  const external = rpm.relocations.filter(relocation => relocation.target.module !== "base");
  return external.length === hooks.length && hooks.every(hook => external.some(({ target, sourceSymbolIndex }) =>
    target.module === String(hook.overlay) && target.address === hook.address && target.type === hook.type &&
    rpm.symbols[sourceSymbolIndex]?.type === "FUNCTION_THM"));
}

function overlapsNativeCode(rpm: RpmModule, game: Game): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    if (target.module === "base") return false;
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
    return manifest.games[game].signatures.some(signature =>
      target.module === String(signature.overlay) && target.address < signature.address + signature.hex.length / 2 &&
      target.address + size > signature.address);
  });
}

export function getRotationBattleAiStatus(project: ProjectState): Status {
  const state: Status = {
    supported: false, compatible: false, installed: false, canUninstall: false,
    message: "Requires US revision-0 Black, White, Black 2, or White 2.",
  };
  const game = gameOf(project);
  if (!game) return state;
  const profile = manifest.games[game];

  try {
    const raw = project.originalRomBytes;
    const rom = raw ? new NintendoDSRom(raw, { fileData: "view" }) : undefined;
    if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode || (raw && raw[0x1e] !== 0)) return state;
    state.supported = true;
    const additions = project.fileSystem?.additions ?? {};
    for (const entry of listCodeInjectionDlls(project)) {
      const added = Object.keys(additions).find(path => path.toLowerCase() === entry.path.toLowerCase());
      const id = rom?.filenames.idOf(entry.path);
      const bytes = added ? additions[added] : rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
      let rpm: RpmModule | undefined;
      try {
        if (bytes) rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
      } catch {
        // A reserved filename still conflicts if its module cannot be read.
      }
      if (rpm && isRotationAi(rpm, game) && entry.target === "patches") {
        if (state.path) throw new Error("Multiple Rotation Battle AI modules are installed.");
        state.path = entry.path;
        state.installed = true;
        state.canUninstall = canRemoveStagedCodeInjectionDll(project, entry.path);
        continue;
      }
      if (entry.fileName.toLowerCase() === profile.fileName.toLowerCase() || (rpm && overlapsNativeCode(rpm, game))) {
        throw new Error(`Conflicting battle AI module: ${entry.path}.`);
      }
    }

    if (!rom) {
      // The install transaction loads the source ROM before checking signatures.
      state.compatible = true;
      state.message = state.installed ? "Included in this project." : "ROM compatibility is checked during installation.";
      return state;
    }

    const overlays = loadOverlayTable(
      project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_overlay, id) => getRomFileBytes(project, rom, id),
      new Set(profile.signatures.map(signature => signature.overlay)),
    );
    for (const signature of profile.signatures) {
      const overlay = overlays.get(signature.overlay);
      const at = overlay ? signature.address - overlay.ramAddress : -1;
      if (at < 0 || !overlay || [overlay.data, project.overlays[signature.overlay] ?? overlay.data].some(data =>
        hex(data.subarray(at, at + signature.hex.length / 2)) !== signature.hex)) {
        throw new Error(`Battle AI code differs at 0x${signature.address.toString(16)} in overlay ${signature.overlay}.`);
      }
    }

    state.compatible = true;
    state.message = state.installed ? "Included in this project." : "Ready to install.";
  } catch (error) {
    state.message = error instanceof Error ? error.message : String(error);
  }
  return state;
}

/** Stage within the Code Injection editor's install transaction. */
export async function stageRotationBattleAi(project: ProjectState): Promise<void> {
  const state = getRotationBattleAiStatus(project);
  const game = gameOf(project);
  if (!game || !state.compatible) throw new Error(state.message);
  if (state.installed) return;

  const profile = manifest.games[game];
  const response = await fetch(URLS[game]);
  if (!response.ok) throw new Error(`Could not load Rotation Battle AI (${response.status}).`);
  const data = await response.arrayBuffer();
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
  const bytes = new Uint8Array(data);
  if (digest !== profile.sha256 || !isRotationAi(parseRpm(bytes, { allowedMagics: ["DLXF"] }), game)) {
    throw new Error("The bundled Rotation Battle AI module failed its integrity check.");
  }
  stageCodeInjectionDll(project, profile.fileName, bytes);
  recordGenericChange(project, "code_injection", "Rotation Battle AI installed.", TITLE, { key: CHANGE_KEY });
}

export async function uninstallRotationBattleAi(project: ProjectState): Promise<void> {
  await withProjectMutationLock(project, () => {
    const state = getRotationBattleAiStatus(project);
    if (!state.path || !state.canUninstall) throw new Error("Only a staged Rotation Battle AI module can be removed.");
    removeStagedCodeInjectionDll(project, state.path);
    recordGenericChange(project, "code_injection", "Rotation Battle AI removed from staged changes.", TITLE, { key: CHANGE_KEY });
  });
}
