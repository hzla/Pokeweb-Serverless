import bw1ManifestData from "../assets/codeinjection/menuEvolutionBw1Manifest.json";
import { readU16 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { getRomFileBytes } from "./fileSystemModel";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { loadActiveRomBytes } from "./persistence";
import {
  canRemoveStagedCodeInjectionDll,
  getPmcInstallStatus,
  installBundledPmc,
  listCodeInjectionDlls,
  removeStagedCodeInjectionDll,
  stageCodeInjectionDll,
} from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";
import { ensureKoMoveLearnsetNarc, hasKoMoveLearnset, hydrateKoMoveLearnsetFromRom } from "./koMoveLearnsetModel";
import { getBattleLogInstallStatus } from "./battleLogModel";
import { parseRpm, type RpmModule } from "./rpm";

// The US B2/W2 party overlay loads message NARC member 178.  The Japanese
// source labels this resource as msg_pokelist, but its retail-US member index
// is not the source tree's 158.
export const MENU_EVOLUTION_MESSAGE_BANK_ID = 178;
export const MENU_EVOLUTION_CONFIG_VERSION = 2;
export const MENU_EVOLUTION_W2_FILENAME = "MenuEvolutionW2.dll";
export const MENU_EVOLUTION_B2_FILENAME = "MenuEvolutionB2.dll";
export const MENU_EVOLUTION_W2_PATH = `patches/${MENU_EVOLUTION_W2_FILENAME}`;
export const MENU_EVOLUTION_B2_PATH = `patches/${MENU_EVOLUTION_B2_FILENAME}`;
export const MENU_EVOLUTION_RUNTIME_VERSION = 5;
export const MENU_EVOLUTION_BUNDLED_DLL_VERSION = "1.3.1";
export const MENU_EVOLUTION_TITLE = "Enhanced Party Menu and Battle Log Integration";

// Menu Evolution extends the retail three-operand GetPartyPokeParameter
// command. These read-only IDs are shared with the runtime public header.
export const MENU_EVOLUTION_GET_PARTY_PARAMETER_COMMAND = 0x0110;
export const MENU_EVOLUTION_COUNTER_PARAMETER_IDS = {
  kos: 0x0400,
  battlesBrought: 0x0401,
  battlesUsed: 0x0402,
} as const;

const MENU_EVOLUTION_CONFIG_MAGIC = new Uint8Array([0x4d, 0x45, 0x56, 0x4f, 0x4d, 0x53, 0x47, 0x00]);

type MenuEvolutionVersion = "B" | "W" | "B2" | "W2";
type Bw1Profile = {
  idCode: string; revision: number; dsAccepted: boolean; version: string; runtimeVersion: number;
  messageBankId: number; dllFilename: string; dllPath: string; counterDllPath: string;
  requiredBattleLogRuntimeVersion: number; sha256: string; codeFingerprint: string; bssSize: number;
  symbols: Pick<RpmModule["symbols"][number], "address" | "type" | "attributes">[];
  relocations: { module: string; address: number; type: string; symbol: number }[];
  hooks: HookSignature[];
  api: { label: string; entry: number; segment: string; expectedHex: string }[];
};
const bw1Profiles = bw1ManifestData.games as Record<"B" | "W", Bw1Profile>;
const bw1Accepted = () => bw1Profiles.B.dsAccepted && bw1Profiles.W.dsAccepted;
const isBw1 = (v: string): v is "B" | "W" => v === "B" || v === "W";

type HookSignature = {
  label: string;
  overlayId: number;
  address: number;
  expectedHex: string;
  patchType?: string;
};

const MENU_EVOLUTION_LAYOUTS: Record<MenuEvolutionVersion, {
  displayName: string;
  idCode: string;
  dllFilename: string;
  dllPath: string;
  dllUrl: URL;
  counterDllPath: string;
  hooks: HookSignature[];
  messageBankId: number;
  version: string;
  runtimeVersion: number;
  requiredBattleLogRuntimeVersion: number;
}> = {
  B: { ...bw1Profiles.B, displayName: "Black", dllUrl: new URL("../assets/codeinjection/MenuEvolutionB.dll", import.meta.url) },
  W: { ...bw1Profiles.W, displayName: "White", dllUrl: new URL("../assets/codeinjection/MenuEvolutionW.dll", import.meta.url) },
  W2: {
    displayName: "White 2", messageBankId: 178, version: MENU_EVOLUTION_BUNDLED_DLL_VERSION, runtimeVersion: MENU_EVOLUTION_RUNTIME_VERSION, requiredBattleLogRuntimeVersion: 11,
    idCode: "IRDO",
    dllFilename: MENU_EVOLUTION_W2_FILENAME,
    dllPath: MENU_EVOLUTION_W2_PATH,
    dllUrl: new URL("../assets/codeinjection/MenuEvolutionW2.dll", import.meta.url),
    counterDllPath: "patches/White2UpgradeBattleCounters.dll",
    hooks: [
      { label: "Party command construction", overlayId: 165, address: 0x0219bb3e, expectedHex: "04f029f808b0f8bd000008b5" },
      { label: "Party command text", overlayId: 165, address: 0x0219fe04, expectedHex: "00f024f86861019840881028" },
      { label: "Party command selection", overlayId: 165, address: 0x0219cf24, expectedHex: "00f07ef838bd000038b5051c" },
      { label: "Field evolution handoff", overlayId: 12, address: 0x0215c3a6, expectedHex: "c4f605fa061c0b480c4b0090" },
      { label: "Field evolution return", overlayId: 12, address: 0x0215c3e4, expectedHex: "10b5041ca0690068baf674fb206f0328" },
      { label: "Post-battle KO evolution", overlayId: 166, address: 0x0219cfa4, expectedHex: "00f0dcf96868311c406a83f693f8301c" },
      { label: "Post-battle evolution resolver", overlayId: 166, address: 0x0219d2aa, expectedHex: "83f683fa0690208f0590608f40106087" },
      { label: "Field-script battle counters", overlayId: 12, address: 0x0215701c, expectedHex: "f8b5061c0d1cfdf781fc041c" },
      { label: "Relearn field-event allocation", overlayId: 12, address: 0x0215b4d4, expectedHex: "1c4a7c23bbf6ecfb061cbbf6" },
      { label: "Relearn field-event callback", overlayId: 12, address: 0x0215b548, expectedHex: "4db51502f0b583b00f1c051c3868141c0d285ed8" },
      { label: "Relearn app-unload wait", overlayId: 12, address: 0x0215b6e4, expectedHex: "a0690068bbf6f4f9002824d10d2021e06368" },
      { label: "Native reminder parameter layout", overlayId: 12, address: 0x021577f4, expectedHex: "041c266067600020a0600698e560206101206076" },
      { label: "Native reminder entry point", overlayId: 12, address: 0x0215784c, expectedHex: "02010000e8b91902" },
      { label: "Native reminder callbacks", overlayId: 258, address: 0x0219b9e8, expectedHex: "0199190275991902519a1902" },
    ],
  },
  B2: {
    displayName: "Black 2", messageBankId: 178, version: MENU_EVOLUTION_BUNDLED_DLL_VERSION, runtimeVersion: MENU_EVOLUTION_RUNTIME_VERSION, requiredBattleLogRuntimeVersion: 11,
    idCode: "IREO",
    dllFilename: MENU_EVOLUTION_B2_FILENAME,
    dllPath: MENU_EVOLUTION_B2_PATH,
    dllUrl: new URL("../assets/codeinjection/MenuEvolutionB2.dll", import.meta.url),
    counterDllPath: "patches/Black2UpgradeBattleCounters.dll",
    hooks: [
      { label: "Party command construction", overlayId: 165, address: 0x0219bafe, expectedHex: "04f029f808b0f8bd000008b5" },
      { label: "Party command text", overlayId: 165, address: 0x0219fdc4, expectedHex: "00f024f86861019840881028" },
      { label: "Party command selection", overlayId: 165, address: 0x0219cee4, expectedHex: "00f07ef838bd000038b5051c" },
      { label: "Field evolution handoff", overlayId: 12, address: 0x0215c366, expectedHex: "c4f60ffa061c0b480c4b0090" },
      { label: "Field evolution return", overlayId: 12, address: 0x0215c3a4, expectedHex: "10b5041ca0690068baf694fb206f0328" },
      { label: "Post-battle KO evolution", overlayId: 166, address: 0x0219cf64, expectedHex: "00f0dcf96868311c406a83f69df8301c" },
      { label: "Post-battle evolution resolver", overlayId: 166, address: 0x0219d26a, expectedHex: "83f68dfa0690208f0590608f40106087" },
      { label: "Field-script battle counters", overlayId: 12, address: 0x02156fdc, expectedHex: "f8b5061c0d1cfdf781fc041c" },
      { label: "Relearn field-event allocation", overlayId: 12, address: 0x0215b494, expectedHex: "1c4a7c23bbf60cfc061cbbf6" },
      { label: "Relearn field-event callback", overlayId: 12, address: 0x0215b508, expectedHex: "0db51502f0b583b00f1c051c3868141c0d285ed8" },
      { label: "Relearn app-unload wait", overlayId: 12, address: 0x0215b6a4, expectedHex: "a0690068bbf614fa002824d10d2021e06368" },
      { label: "Native reminder parameter layout", overlayId: 12, address: 0x021577b4, expectedHex: "041c266067600020a0600698e560206101206076" },
      { label: "Native reminder entry point", overlayId: 12, address: 0x0215780c, expectedHex: "02010000a8b91902" },
      { label: "Native reminder callbacks", overlayId: 258, address: 0x0219b9a8, expectedHex: "c198190235991902119a1902" },
    ],
  },
};

export type MenuEvolutionCompatibilityCheck = {
  label: string;
  overlayId: number;
  address: number;
  matched: boolean;
  message: string;
};

export type MenuEvolutionCompatibilityReport = {
  supported: boolean;
  compatible: boolean;
  checked: boolean;
  passed: number;
  checks: MenuEvolutionCompatibilityCheck[];
  message: string;
};

export type MenuEvolutionInstallStatus = MenuEvolutionCompatibilityReport & {
  installed: boolean;
  upToDate: boolean;
  updateAvailable: boolean;
  pmcInstalled: boolean;
  dependencyInstalled: boolean;
  canUninstall: boolean;
  dllPath?: string;
  messageEntryId?: number;
  relearnMessageEntryId?: number;
};

export type MenuEvolutionInstallResult = {
  dllPath: string;
  messageBankId: number;
  messageEntryId: number;
  relearnMessageEntryId: number;
  koLearnsetPath: string;
  koLearnsetMembers: number;
};

function menuEvolutionLayout(version: string) {
  return version === "B" || version === "W" || version === "B2" || version === "W2" ? MENU_EVOLUTION_LAYOUTS[version] : undefined;
}

export function menuEvolutionDisplayName(version: string): string | undefined {
  return menuEvolutionLayout(version)?.displayName;
}

export function hasMenuEvolutionBattleCounterDependency(project: ProjectState): boolean {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (!layout) return false;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === layout.counterDllPath.toLowerCase());
}

export function isMenuEvolutionInstalled(project: ProjectState): boolean {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (!layout) return false;
  return listCodeInjectionDlls(project).some((module) => module.path.toLowerCase() === layout.dllPath.toLowerCase());
}

export function canUninstallMenuEvolution(project: ProjectState): boolean {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  return Boolean(layout && canRemoveStagedCodeInjectionDll(project, layout.dllPath));
}

export function getMenuEvolutionInstallStatus(project: ProjectState): MenuEvolutionInstallStatus {
  const compatibility = detectMenuEvolutionCompatibility(project);
  const layout = menuEvolutionLayout(project.session.baseVersion);
  const installed = isMenuEvolutionInstalled(project);
  const installedModule = layout
    ? listCodeInjectionDlls(project).find((module) => module.path.toLowerCase() === layout.dllPath.toLowerCase())
    : undefined;
  const upToDate = Boolean(installed && layout
    && (installedModule?.version === layout.version
      || installedMenuEvolutionVersion(project, layout) === layout.version)
    && hasKoMoveLearnset(project)
    && (!isBw1(project.session.baseVersion) || isRecognizedInstalledBw1(project, layout)));
  const configuredIds = installed && layout ? installedMessageIds(project, layout) : undefined;
  return {
    ...compatibility,
    installed,
    upToDate,
    updateAvailable: installed && !upToDate,
    pmcInstalled: getPmcInstallStatus(project).installed,
    dependencyInstalled: hasMenuEvolutionBattleCounterDependency(project),
    canUninstall: installed && canUninstallMenuEvolution(project),
    dllPath: layout?.dllPath,
    messageEntryId: configuredIds?.[0] ?? project.codeInjection?.menuEvolution?.messageEntryId,
    relearnMessageEntryId: configuredIds?.[1] ?? project.codeInjection?.menuEvolution?.relearnMessageEntryId,
  };
}

export function isKoMoveEditorAvailable(project: ProjectState): boolean {
  const menuStatus = getMenuEvolutionInstallStatus(project);
  if (!menuStatus.upToDate || !menuStatus.dependencyInstalled) return false;
  return getBattleLogInstallStatus(project).upToDate && getBattleLogInstallStatus(project).bundledRuntimeVersion >= (menuEvolutionLayout(project.session.baseVersion)?.requiredBattleLogRuntimeVersion ?? Infinity);
}

function installedMenuEvolutionVersion(
  project: ProjectState,
  layout: NonNullable<ReturnType<typeof menuEvolutionLayout>>,
): string | undefined {
  const additionPath = Object.keys(project.fileSystem?.additions ?? {}).find(
    (path) => path.toLowerCase() === layout.dllPath.toLowerCase(),
  );
  let bytes = additionPath ? project.fileSystem?.additions?.[additionPath] : undefined;
  if (!bytes && project.originalRomBytes) {
    try {
      const rom = new NintendoDSRom(project.originalRomBytes);
      const fileId = rom.filenames.idOf(layout.dllPath);
      if (fileId !== undefined) bytes = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
    } catch {
      return undefined;
    }
  }
  if (!bytes) return undefined;
  try {
    const metadata = parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata;
    return metadata.PMCGameID === project.session.baseVersion && typeof metadata.PMCVersion === "string"
      ? metadata.PMCVersion
      : undefined;
  } catch {
    return undefined;
  }
}

export function detectMenuEvolutionCompatibility(
  project: ProjectState,
  romBytes: Uint8Array | undefined = project.originalRomBytes,
): MenuEvolutionCompatibilityReport {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (!layout || (project.session.baseRom !== "BW2" && project.session.baseRom !== "BW") || (isBw1(project.session.baseVersion) !== (project.session.baseRom === "BW"))) {
    return {
      supported: false,
      compatible: false,
      checked: false,
      passed: 0,
      checks: [],
      message: `${MENU_EVOLUTION_TITLE} supports verified US Black, White, Black 2 and White 2 profiles.`,
    };
  }
  if (isBw1(project.session.baseVersion) && !bw1Accepted()) return {
    supported: false, compatible: false, checked: false, passed: 0, checks: [],
    message: "BW1 Enhanced Party Menu candidates await DS gameplay and visual acceptance in both Black and White.",
  };
  if (!romBytes) {
    return {
      supported: true,
      compatible: true,
      checked: false,
      passed: 0,
      checks: [],
      message: `${layout.displayName} detected; hook bytes will be checked during installation.`,
    };
  }

  let rom: NintendoDSRom;
  try {
    rom = new NintendoDSRom(romBytes);
  } catch {
    return {
      supported: true,
      compatible: false,
      checked: true,
      passed: 0,
      checks: [],
      message: `The source ROM could not be parsed for ${MENU_EVOLUTION_TITLE} compatibility.`,
    };
  }
  if (rom.idCode !== layout.idCode || (isBw1(project.session.baseVersion) && romBytes[0x1e] !== bw1Profiles[project.session.baseVersion].revision)) {
    return {
      supported: false,
      compatible: false,
      checked: true,
      passed: 0,
      checks: [],
      message: `Expected US ${layout.displayName} (${layout.idCode}), but the source ROM is ${rom.idCode || "unknown"}.`,
    };
  }

  let overlays: Map<number, { data: Uint8Array; ramAddress: number }>;
  try {
    const apiOverlays = isBw1(project.session.baseVersion)
      ? bw1Profiles[project.session.baseVersion].api.filter(api => api.segment !== "ARM9").map(api => Number(api.segment)) : [];
    overlays = rom.loadArm9Overlays([...new Set([...layout.hooks.map((hook) => hook.overlayId), ...apiOverlays])]);
  } catch {
    overlays = new Map();
  }
  const checks: MenuEvolutionCompatibilityCheck[] = layout.hooks.map((signature) => {
    const original = overlays.get(signature.overlayId);
    const data = project.overlays[signature.overlayId] ?? original?.data;
    const offset = original ? signature.address - original.ramAddress : -1;
    const expected = hexToBytes(signature.expectedHex);
    const actual = data && offset >= 0 && offset + expected.length <= data.length
      ? data.subarray(offset, offset + expected.length)
      : undefined;
    const matched = Boolean(actual && bytesEqual(actual, expected));
    return {
      label: signature.label,
      overlayId: signature.overlayId,
      address: signature.address,
      matched,
      message: matched
        ? `Overlay ${signature.overlayId} matches at ${hexAddress(signature.address)}.`
        : `Overlay ${signature.overlayId} differs or is missing at ${hexAddress(signature.address)}.`,
    };
  });
  if (isBw1(project.session.baseVersion)) {
    const profile = bw1Profiles[project.session.baseVersion];
    for (const api of profile.api) {
      const ov = api.segment === "ARM9" ? undefined : overlays.get(Number(api.segment));
      const data = api.segment === "ARM9" ? (project.arm9.length ? project.arm9 : decompressCode(rom.arm9)) : project.overlays[Number(api.segment)] ?? ov?.data;
      const offset = (api.entry & ~1) - (api.segment === "ARM9" ? rom.arm9RamAddress : ov?.ramAddress ?? 0);
      const expected = hexToBytes(api.expectedHex);
      const matched = Boolean(data && offset >= 0 && bytesEqual(data.subarray(offset, offset + expected.length), expected));
      checks.push({ label: api.label, overlayId: api.segment === "ARM9" ? 0 : Number(api.segment), address: api.entry & ~1, matched, message: `${api.label} ${matched ? "matches" : "differs from"} the verified native binding.` });
    }
    const own = listCodeInjectionDlls(project).filter(m => m.path.toLowerCase() === layout.dllPath.toLowerCase());
    if (own.length > 1) checks.push({ label: "Duplicate companion", overlayId: 0, address: 0, matched: false, message: "Duplicate Enhanced Party Menu DLL paths." });
    for (const module of listCodeInjectionDlls(project)) {
      const bytes = companionBytes(project, rom, module.path);
      if (!bytes) continue;
      if (module.path.toLowerCase() === layout.dllPath.toLowerCase()) {
        const matched = recognizedBw1Dll(bytes, profile);
        checks.push({ label: "Installed companion", overlayId: 0, address: 0, matched, message: matched ? "Recognized BW1 companion." : "Unrecognized or altered BW1 companion." });
        continue;
      }
      try {
        const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
        for (const r of rpm.relocations.filter(r => r.target.module !== "base")) {
          const size = r.target.type === "THUMB_BRANCH" ? 12 : r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0 : 4;
          const conflict = profile.hooks.find(h => String(h.overlayId) === r.target.module && h.address < r.target.address + size && r.target.address < h.address + (h.patchType === "THUMB_BRANCH" ? 12 : 4));
          if (conflict) checks.push({ label: "Conflicting companion", overlayId: conflict.overlayId, address: conflict.address, matched: false, message: `${module.path} overlaps ${conflict.label}.` });
        }
      } catch { /* Other non-DLXF files cannot install PMC hooks. */ }
    }
  }
  const passed = checks.filter((check) => check.matched).length;
  const compatible = passed === checks.length;
  return {
    supported: true,
    compatible,
    checked: true,
    passed,
    checks,
    message: compatible
      ? `All ${checks.length} companion hook regions match the US ${layout.displayName} layout.`
      : `${MENU_EVOLUTION_TITLE} compatibility failed (${passed}/${checks.length} hook regions matched).`,
  };
}

export async function installMenuEvolution(project: ProjectState): Promise<MenuEvolutionInstallResult> {
  const staged: ProjectState = { ...project, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, bytes]) => [id, bytes?.slice()])),
    narcs: structuredClone(project.narcs), texts: structuredClone(project.texts),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog),
    koMoveLearnsetSource: structuredClone(project.koMoveLearnsetSource) };
  const result = await installMenuEvolutionStaged(staged);
  Object.assign(project, { arm9: staged.arm9, arm9Dirty: staged.arm9Dirty, overlays: staged.overlays,
    narcs: staged.narcs, texts: staged.texts, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog, koMoveLearnsetSource: staged.koMoveLearnsetSource });
  return result;
}
async function installMenuEvolutionStaged(project: ProjectState): Promise<MenuEvolutionInstallResult> {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (!layout || (project.session.baseRom !== "BW2" && project.session.baseRom !== "BW") || (isBw1(project.session.baseVersion) !== (project.session.baseRom === "BW"))) {
    throw new Error(`${MENU_EVOLUTION_TITLE} supports verified US Black, White, Black 2 and White 2 profiles.`);
  }
  if (isBw1(project.session.baseVersion) && !bw1Accepted()) throw new Error("BW1 Enhanced Party Menu candidates await DS gameplay and visual acceptance in both Black and White.");
  if (!hasMenuEvolutionBattleCounterDependency(project)) {
    throw new Error(`Install the battle log first; ${layout.counterDllPath} is required by ${MENU_EVOLUTION_TITLE}.`);
  }
  const battleLogStatus = getBattleLogInstallStatus(project);
  if (!battleLogStatus.upToDate || battleLogStatus.bundledRuntimeVersion < layout.requiredBattleLogRuntimeVersion) {
    throw new Error(`Update the battle log before installing ${MENU_EVOLUTION_TITLE}; immediate KO moves require runtime version ${layout.requiredBattleLogRuntimeVersion}.`);
  }

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error(`Reload the ROM before installing ${MENU_EVOLUTION_TITLE}.`);
  const compatibility = detectMenuEvolutionCompatibility(project, romBytes);
  if (!compatibility.compatible) throw new Error(compatibility.message);
  // Autosave releases project.originalRomBytes; use the resolved IndexedDB
  // source here instead of treating an installed KO archive as a new file.
  hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(romBytes));
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);

  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const previous = companionBytes(project, rom, layout.dllPath);
  const config = previous ? readMessageIds(previous) : undefined;
  const saved = project.codeInjection?.menuEvolution;
  const bank = getTextBank(project, "message_texts", layout.messageBankId);
  const reuse = (id: number | undefined, fallback: () => number) => id !== undefined && bank.some(e => parseTextEntryId(e[0]).block === 0 && parseTextEntryId(e[0]).entry === id) ? id : fallback();
  const messageEntryId = reuse(config?.[0] ?? (saved?.messageBankId === layout.messageBankId ? saved.messageEntryId : undefined), () => ensureEvolveMessage(project));
  const relearnMessageEntryId = reuse(config?.[1] ?? (saved?.messageBankId === layout.messageBankId ? saved.relearnMessageEntryId : undefined), () => ensureRelearnMessage(project));
  const response = await fetch(layout.dllUrl);
  if (!response.ok) throw new Error(`Could not load the bundled ${MENU_EVOLUTION_TITLE} DLL (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (isBw1(project.session.baseVersion)) {
    const profile = bw1Profiles[project.session.baseVersion];
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("");
    if (hash !== profile.sha256 || !recognizedBw1Dll(bytes, profile)) throw new Error("Bundled BW1 Enhanced Party Menu integrity check failed.");
  }
  const configuredDll = configureMenuEvolutionDll(bytes, messageEntryId, relearnMessageEntryId);
  stageCodeInjectionDll(project, layout.dllFilename, configuredDll, "patches", romBytes);
  const koLearnset = ensureKoMoveLearnsetNarc(project);

  project.codeInjection ??= {};
  project.codeInjection.menuEvolution = {
    messageBankId: layout.messageBankId,
    messageEntryId,
    relearnMessageEntryId,
    koLearnsetPath: koLearnset.path,
    runtimeVersion: layout.runtimeVersion,
  };
  recordGenericChange(
    project,
    "code_injection",
    `${layout.dllFilename} staged with EVOLVE and RELEARN, post-battle KO evolution, mid-battle KO moves, message bank ${layout.messageBankId}, entries ${messageEntryId}/${relearnMessageEntryId}, and ${koLearnset.members} KO learnset members.`,
    MENU_EVOLUTION_TITLE,
    { key: "code-injection:menu-evolution" },
  );
  return {
    dllPath: layout.dllPath,
    messageBankId: layout.messageBankId,
    messageEntryId,
    relearnMessageEntryId,
    koLearnsetPath: koLearnset.path,
    koLearnsetMembers: koLearnset.members,
  };
}

export function uninstallMenuEvolution(project: ProjectState): void {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (!layout || (project.session.baseRom !== "BW2" && project.session.baseRom !== "BW") || (isBw1(project.session.baseVersion) !== (project.session.baseRom === "BW"))) {
    throw new Error(`${MENU_EVOLUTION_TITLE} supports verified US Black, White, Black 2 and White 2 profiles.`);
  }
  if (!canUninstallMenuEvolution(project)) {
    throw new Error("An enhanced party-menu DLL already built into the loaded ROM cannot be removed by this editor yet.");
  }
  removeStagedCodeInjectionDll(project, layout.dllPath);
  if (project.codeInjection && !isBw1(project.session.baseVersion)) delete project.codeInjection.menuEvolution;
  recordGenericChange(
    project,
    "code_injection",
    "The staged enhanced party-menu DLL was removed. Its harmless EVOLVE and RELEARN text entries were retained.",
    MENU_EVOLUTION_TITLE,
    { key: "code-injection:menu-evolution" },
  );
}

export function ensureEvolveMessage(project: ProjectState): number {
  return ensurePartyCommandMessage(project, "EVOLVE");
}

export function ensureRelearnMessage(project: ProjectState): number {
  return ensurePartyCommandMessage(project, "RELEARN");
}

function ensurePartyCommandMessage(project: ProjectState, label: "EVOLVE" | "RELEARN"): number {
  const bankId = menuEvolutionLayout(project.session.baseVersion)?.messageBankId ?? MENU_EVOLUTION_MESSAGE_BANK_ID;
  const bank = getTextBank(project, "message_texts", bankId);
  if (bank.length === 0) {
    throw new Error(`Message bank ${bankId} is unavailable or empty.`);
  }
  const existing = bank.find((entry) => parseTextEntryId(entry[0]).block === 0
    && entry[1].trim().toUpperCase() === label);
  if (existing) {
    if (existing[1] !== label) {
      existing[1] = label;
      commitTextBank(project, "message_texts", bankId);
    }
    return parseTextEntryId(existing[0]).entry;
  }

  const nextEntryId = Math.max(...bank.map((entry) => parseTextEntryId(entry[0]).entry)) + 1;
  if (nextEntryId >= 0xffff) {
    throw new Error(`Message bank ${bankId} has no available entry ID for ${label}.`);
  }
  addTextEntries(project, "message_texts", bankId, 1);
  const appended = getTextBank(project, "message_texts", bankId)
    .filter((entry) => parseTextEntryId(entry[0]).entry === nextEntryId);
  if (appended.length === 0) throw new Error(`The ${label} message entry could not be appended.`);
  appended.forEach((entry) => {
    entry[1] = label;
  });
  commitTextBank(project, "message_texts", bankId);
  return nextEntryId;
}

export function configureMenuEvolutionDll(bytes: Uint8Array, messageEntryId: number, relearnMessageEntryId: number): Uint8Array {
  for (const id of [messageEntryId, relearnMessageEntryId]) {
    if (!Number.isInteger(id) || id < 0 || id >= 0xffff) {
      throw new Error(`Invalid Menu Evolution message entry ID: ${id}`);
    }
  }
  const matches = findAll(bytes, MENU_EVOLUTION_CONFIG_MAGIC);
  if (matches.length !== 1) {
    throw new Error(`The Menu Evolution DLL contains ${matches.length} configuration markers; expected exactly one.`);
  }
  const output = bytes.slice();
  const offset = matches[0]!;
  if (offset + 20 > output.length || readU16(output, offset + 8) !== MENU_EVOLUTION_CONFIG_VERSION) {
    throw new Error("The Menu Evolution DLL has an unsupported configuration layout.");
  }
  for (const [field, id] of [[10, messageEntryId], [14, relearnMessageEntryId]] as const) {
    output[offset + field] = id & 0xff;
    output[offset + field + 1] = id >>> 8;
    const complement = id ^ 0xffff;
    output[offset + field + 2] = complement & 0xff;
    output[offset + field + 3] = complement >>> 8;
  }
  return output;
}

function findAll(haystack: Uint8Array, needle: Uint8Array): number[] {
  const matches: number[] = [];
  for (let offset = 0; offset + needle.length <= haystack.length; offset += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) matches.push(offset);
  }
  return matches;
}

function hexToBytes(hex: string): Uint8Array {
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hexAddress(address: number): string {
  return `0x${address.toString(16).padStart(8, "0")}`;
}

function companionBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const addition = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === path.toLowerCase());
  if (addition) return project.fileSystem?.additions?.[addition];
  const id = rom.filenames.idOf(path);
  return id === undefined ? undefined : getRomFileBytes(project, rom, id);
}
function isRecognizedInstalledBw1(project: ProjectState, layout: NonNullable<ReturnType<typeof menuEvolutionLayout>>): boolean {
  if (!isBw1(project.session.baseVersion)) return false;
  const addition = Object.keys(project.fileSystem?.additions ?? {}).find(path => path.toLowerCase() === layout.dllPath.toLowerCase());
  if (addition) return recognizedBw1Dll(project.fileSystem!.additions![addition]!, bw1Profiles[project.session.baseVersion]);
  if (!project.originalRomBytes) return project.codeInjection?.menuEvolution?.runtimeVersion === layout.runtimeVersion;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    const bytes = companionBytes(project, rom, layout.dllPath);
    return Boolean(bytes && recognizedBw1Dll(bytes, bw1Profiles[project.session.baseVersion]));
  } catch { return false; }
}
function readMessageIds(bytes: Uint8Array): [number, number] | undefined {
  const offsets = findAll(bytes, MENU_EVOLUTION_CONFIG_MAGIC);
  if (offsets.length !== 1) return;
  const at = offsets[0]!;
  if (at + 20 > bytes.length || readU16(bytes, at + 8) !== 2) return;
  const ids: [number, number] = [readU16(bytes, at + 10), readU16(bytes, at + 14)];
  return ids.every((id, i) => id < 0xffff && (id ^ readU16(bytes, at + 12 + i * 4)) === 0xffff) ? ids : undefined;
}
function installedMessageIds(project: ProjectState, layout: NonNullable<ReturnType<typeof menuEvolutionLayout>>): [number, number] | undefined {
  const addition = Object.keys(project.fileSystem?.additions ?? {}).find(path => path.toLowerCase() === layout.dllPath.toLowerCase());
  if (addition) return readMessageIds(project.fileSystem!.additions![addition]!);
  if (!project.originalRomBytes) return;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    const bytes = companionBytes(project, rom, layout.dllPath);
    return bytes ? readMessageIds(bytes) : undefined;
  } catch { return; }
}
function recognizedBw1Dll(bytes: Uint8Array, profile: Bw1Profile): boolean {
  try {
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PMCGameID !== (profile.idCode === "IRBO" ? "B" : "W") || rpm.metadata.PMCModulePriority !== 4 || rpm.metadata.PMCVersion !== profile.version || rpm.bssSize !== profile.bssSize) return false;
    if (rpm.symbols.length !== profile.symbols.length || rpm.symbols.some((s, i) => s.name !== null || s.address !== profile.symbols[i]!.address || s.type !== profile.symbols[i]!.type || s.attributes !== profile.symbols[i]!.attributes)) return false;
    const actualRelocations = rpm.relocations.map(r => `${r.target.module}:${r.target.address}:${r.target.type}:${r.sourceSymbolIndex}`).sort();
    const expectedRelocations = profile.relocations.map(r => `${r.module}:${r.address}:${r.type}:${r.symbol}`).sort();
    if (actualRelocations.length !== expectedRelocations.length || actualRelocations.some((r, i) => r !== expectedRelocations[i])) return false;
    const markers = findAll(rpm.code, MENU_EVOLUTION_CONFIG_MAGIC); if (markers.length !== 1) return false;
    const at = markers[0]!; if (readU16(rpm.code, at + 8) !== 2) return false;
    let hash = 0x811c9dc5;
    for (let i = 0; i < rpm.code.length; ++i) hash = Math.imul(hash ^ (i >= at + 10 && i < at + 18 ? 0 : rpm.code[i]!), 0x1000193) >>> 0;
    return hash.toString(16).padStart(8, "0") === profile.codeFingerprint;
  } catch { return false; }
}
