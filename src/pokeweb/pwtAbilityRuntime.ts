import { loadOverlayTable } from "../nds/code";
import { NintendoDSRom } from "../nds/rom";
import runtimes from "../../runtime/pwt-abilities/runtimes.json";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

export const PWT_ABILITY_SET_NARCS = ["pwt_sets_0", "pwt_sets_3", "pwt_sets_6", "pwt_sets_7"] as const;
export const PWT_SET_EV_MASK = 0x3f;

const OVERLAY = 12;
const VERSION = "1.0.0";
const profiles = {
  B2: { idCode: "IREO", shift: -0x40, clearCall: "16f782e9", readBinding: "29a90402" },
  W2: { idCode: "IRDO", shift: 0, clearCall: "16f778e9", readBinding: "55a90402" },
};

type Game = keyof typeof profiles;

function getGame(project: ProjectState): Game | undefined {
  const game = project.session.baseVersion;
  if (project.session.baseRom === "BW2" && (game === "B2" || game === "W2")
    && project.romInfo.idCode === profiles[game].idCode
    && (project.originalRomBytes?.[0x1e] ?? 0) === 0) return game;
  return undefined;
}

function fileName(game: Game): string {
  return `PwtAbilitySelection${game}.dll`;
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], byte => parseInt(byte, 16));
}

export function getPwtAbilityStatus(project: ProjectState): "unsupported" | "ready" | "installed" {
  const game = getGame(project);
  if (!game) return "unsupported";
  const path = `patches/${fileName(game)}`.toLowerCase();
  return listCodeInjectionDlls(project).some(entry => entry.path.toLowerCase() === path
    && entry.gameId === game && entry.version === VERSION) ? "installed" : "ready";
}

export function installPwtAbilitySelection(project: ProjectState) {
  return installCodeInjectionPatch(project, stagePwtAbilitySelection);
}

function stagePwtAbilitySelection(project: ProjectState) {
  const game = getGame(project);
  const bytes = project.originalRomBytes;
  if (!game || !bytes || bytes[0x1e] !== 0) throw new Error("PWT Ability Selection requires US Black 2 or White 2 revision 0.");
  const profile = profiles[game];
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  if (rom.idCode !== profile.idCode) throw new Error("Reload the matching US Black 2 or White 2 ROM.");

  const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
    (_, id) => getRomFileBytes(project, rom, id), new Set([OVERLAY])).get(OVERLAY);
  if (!overlay) throw new Error("The PWT party generation overlay is missing.");
  const data = project.overlays[OVERLAY] ?? overlay.data;
  const signatures = [
    { address: 0x021624d0, hex: `f8b588b00d1c161c00213c22041c0293${profile.clearCall}281c04a9321c00f081f9` },
    { address: 0x02162250, hex: "0ddd3c206043029a3818291c00f014fa" },
    { address: 0x021627f0, hex: `031c081c191c014b1847c046${profile.readBinding}` },
    { address: 0x02162688, hex: "f0b58bb00d1c061c281c171c" },
  ].map(({ address, hex }) => ({ address: address + profile.shift, bytes: hexBytes(hex) }));
  for (const signature of signatures) {
    const offset = signature.address - overlay.ramAddress;
    if (offset < 0 || signature.bytes.some((byte, index) => data[offset + index] !== byte)) {
      throw new Error(`Overlay 12 differs from the supported PWT code at 0x${signature.address.toString(16)}.`);
    }
  }

  const runtime = runtimes[game];
  const hooks = [0x021624ea, 0x0216225c].map(address => address + profile.shift);
  const dll = writeRpm({
    code: hexBytes(runtime.codeHex), bssSize: 0, baseAddress: 0,
    symbols: runtime.entries.map(address => ({ name: null, address, size: 0, type: "FUNCTION_THM", attributes: 0 })),
    relocations: hooks.map((address, sourceSymbolIndex) => ({
      target: { module: String(OVERLAY), address: address | 1, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex,
    })),
    metadata: { PMCGameID: game, PMCModulePriority: 4, PMCVersion: VERSION },
  }, { ident: "DLXF" });

  const name = fileName(game);
  const path = `patches/${name}`.toLowerCase();
  let installed = false;
  for (const entry of listCodeInjectionDlls(project)) {
    const staged = Object.entries(project.fileSystem?.additions ?? {}).find(([key]) => key.toLowerCase() === entry.path.toLowerCase())?.[1];
    const id = rom.filenames.idOf(entry.path);
    const current = staged ?? (id === undefined ? undefined : getRomFileBytes(project, rom, id));
    if (entry.path.toLowerCase() === path) {
      if (current?.length !== dll.length || !current.every((byte, index) => byte === dll[index])) {
        throw new Error(`${entry.path} already exists with different contents.`);
      }
      installed = true;
      continue;
    }
    if (!current) continue;
    let rpm: RpmModule;
    try { rpm = parseRpm(current, { allowedMagics: ["DLXF"] }); } catch { continue; }
    const conflicts = rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      if (target.module !== String(OVERLAY)) return false;
      const start = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
      return signatures.some(signature => start < signature.address + signature.bytes.length && start + size > signature.address);
    });
    if (conflicts) throw new Error(`PWT Ability Selection conflicts with ${entry.fileName}.`);
  }

  loadCodeInjectionNarcs(project, rom, [...PWT_ABILITY_SET_NARCS, "personal"]);
  if (!installed) {
    for (const narc of PWT_ABILITY_SET_NARCS) {
      const files = project.narcs[narc]!.rawFiles;
      const occupied = files.findIndex(record => record.length === 16 && (record[10] & ~PWT_SET_EV_MASK) !== 0);
      if (occupied !== -1) throw new Error(`PWT set ${narc}/${occupied} already uses the reserved ability bits.`);
    }
  }
  const result = stageCodeInjectionDll(project, name, dll, "patches", bytes);
  recordGenericChange(project, "code_injection", "Enabled ability selection for PWT sets.", "PWT Ability Selection", {
    key: "code-injection:pwt-ability-selection",
  });
  return result;
}
