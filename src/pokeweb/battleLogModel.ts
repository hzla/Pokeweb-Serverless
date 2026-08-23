import { readU16 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, clearRomFileReplacement, setRomFileReplacement } from "./fileSystemModel";
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

export const BATTLE_LOG_DLL_FILENAME = "White2UpgradeBattleLog.dll";
export const BATTLE_LOG_DLL_PATH = `patches/${BATTLE_LOG_DLL_FILENAME}`;
export const BATTLE_LOG_COUNTER_DLL_FILENAME = "White2UpgradeBattleCounters.dll";
export const BATTLE_LOG_COUNTER_DLL_PATH = `patches/${BATTLE_LOG_COUNTER_DLL_FILENAME}`;
export const BATTLE_LOG_SUMMARY_DLL_FILENAME = "White2UpgradeBattleLogSummary.dll";
export const BATTLE_LOG_SUMMARY_DLL_PATH = `patches/${BATTLE_LOG_SUMMARY_DLL_FILENAME}`;
export const BLACK2_BATTLE_LOG_DLL_FILENAME = "Black2UpgradeBattleLog.dll";
export const BLACK2_BATTLE_LOG_DLL_PATH = `patches/${BLACK2_BATTLE_LOG_DLL_FILENAME}`;
export const BLACK2_BATTLE_LOG_COUNTER_DLL_FILENAME = "Black2UpgradeBattleCounters.dll";
export const BLACK2_BATTLE_LOG_COUNTER_DLL_PATH = `patches/${BLACK2_BATTLE_LOG_COUNTER_DLL_FILENAME}`;
export const BLACK2_BATTLE_LOG_SUMMARY_DLL_FILENAME = "Black2UpgradeBattleLogSummary.dll";
export const BLACK2_BATTLE_LOG_SUMMARY_DLL_PATH = `patches/${BLACK2_BATTLE_LOG_SUMMARY_DLL_FILENAME}`;
export const BLACK1_BATTLE_LOG_DLL_FILENAME = "Black1BattleLog.dll";
export const BLACK1_BATTLE_LOG_DLL_PATH = `patches/${BLACK1_BATTLE_LOG_DLL_FILENAME}`;
export const BLACK1_BATTLE_LOG_COUNTER_DLL_FILENAME = "Black1BattleCounters.dll";
export const BLACK1_BATTLE_LOG_COUNTER_DLL_PATH = `patches/${BLACK1_BATTLE_LOG_COUNTER_DLL_FILENAME}`;
export const BLACK1_BATTLE_LOG_SUMMARY_DLL_FILENAME = "Black1BattleLogSummary.dll";
export const BLACK1_BATTLE_LOG_SUMMARY_DLL_PATH = `patches/${BLACK1_BATTLE_LOG_SUMMARY_DLL_FILENAME}`;
export const WHITE1_BATTLE_LOG_DLL_FILENAME = "White1BattleLog.dll";
export const WHITE1_BATTLE_LOG_DLL_PATH = `patches/${WHITE1_BATTLE_LOG_DLL_FILENAME}`;
export const WHITE1_BATTLE_LOG_COUNTER_DLL_FILENAME = "White1BattleCounters.dll";
export const WHITE1_BATTLE_LOG_COUNTER_DLL_PATH = `patches/${WHITE1_BATTLE_LOG_COUNTER_DLL_FILENAME}`;
export const WHITE1_BATTLE_LOG_SUMMARY_DLL_FILENAME = "White1BattleLogSummary.dll";
export const WHITE1_BATTLE_LOG_SUMMARY_DLL_PATH = `patches/${WHITE1_BATTLE_LOG_SUMMARY_DLL_FILENAME}`;
export const BATTLE_LOG_ANCESTRY_PATH = "battlelog/ancestry.narc";
export const BATTLE_LOG_EVOLUTION_PATH = "a/0/1/9";
export const BATTLE_LOG_CAPACITY = 600;
/** Version 3 records allied NPC partner KOs without crediting a player PK5. */
export const BATTLE_LOG_RUNTIME_VERSION = 3;

const SPECIES_COUNT = 1024;
const EVOLUTION_SLOT_SIZE = 6;
const EVOLUTION_MEMBER_SIZES = new Set([42, 48]);
const ANCESTRY_VERSION = 1;
const MAX_ANCESTORS = 32;
const LEGACY_BATTLE_LOG_ANCESTRY_PATH = "battle_log_ancestry.narc";
const GEN5_ARM9_RAM_ADDRESS = 0x02004000;

export type SupportedBattleLogVersion = "B" | "W" | "B2" | "W2";

type HookSignature = {
  label: string;
  overlayId: number;
  address: number;
  expectedHex: string;
};

type RuntimeFingerprint = {
  length: number;
  fnv1a: number;
};

const BATTLE_LOG_LAYOUTS: Record<SupportedBattleLogVersion, {
  displayName: string;
  idCode: string;
  dllFilename: string;
  dllPath: string;
  dllUrl: URL;
  counterDllFilename: string;
  counterDllPath: string;
  counterDllUrl: URL;
  summaryDllFilename: string;
  summaryDllPath: string;
  summaryDllUrl: URL;
  runtimeFingerprints: {
    battle: RuntimeFingerprint;
    counters: RuntimeFingerprint;
    summary: RuntimeFingerprint;
  };
  wifiAddress: number;
  wifiOriginalHex: string;
  wifiDisabledHex: string;
  hooks: HookSignature[];
}> = {
  W2: {
    displayName: "White 2",
    idCode: "IRDO",
    dllFilename: BATTLE_LOG_DLL_FILENAME,
    dllPath: BATTLE_LOG_DLL_PATH,
    dllUrl: new URL("../assets/codeinjection/White2UpgradeBattleLog.dll", import.meta.url),
    counterDllFilename: BATTLE_LOG_COUNTER_DLL_FILENAME,
    counterDllPath: BATTLE_LOG_COUNTER_DLL_PATH,
    counterDllUrl: new URL("../assets/codeinjection/White2UpgradeBattleCounters.dll", import.meta.url),
    summaryDllFilename: BATTLE_LOG_SUMMARY_DLL_FILENAME,
    summaryDllPath: BATTLE_LOG_SUMMARY_DLL_PATH,
    summaryDllUrl: new URL("../assets/codeinjection/White2UpgradeBattleLogSummary.dll", import.meta.url),
    runtimeFingerprints: {
      battle: { length: 2432, fnv1a: 0x7316e56f },
      counters: { length: 560, fnv1a: 0x5c161190 },
      summary: { length: 896, fnv1a: 0x45f45047 },
    },
    wifiAddress: 0x02009f0c,
    wifiOriginalHex: "014a024b1847c046c40700004c890702",
    wifiDisabledHex: "7047024b1847c046c40700004c890702",
    hooks: [
      { label: "Pal Pad save-shadow guard", overlayId: 0, address: 0x02009f0c, expectedHex: "014a024b1847c046c40700004c890702" },
      { label: "Battle result finalization", overlayId: 167, address: 0x0219ca88, expectedHex: "024a8358072b00d18150704744040000" },
      { label: "Faint detection", overlayId: 167, address: 0x021a8a64, expectedHex: "f8b582b00f1c041c381c12f007f9061c3c482518a85d0028" },
      { label: "Resolved move targets", overlayId: 167, address: 0x021ae36c, expectedHex: "f0b585b0041c039260681f1c02910a9dedf720fd04903869" },
      { label: "Individual PK5 counter RPC", overlayId: 167, address: 0x021bb3a8, expectedHex: "08b50d21fff722ff002801d1012008bd002008bd38b5051c" },
      { label: "Summary frag value", overlayId: 207, address: 0x021b6f32, expectedHex: "0721002265f63dff0004020c0220009001200190381c0021" },
      { label: "Summary frag formatting", overlayId: 207, address: 0x021b6f48, expectedHex: "002105236df6fcfa4120009001200190112080010290e169" },
    ],
  },
  B2: {
    displayName: "Black 2",
    idCode: "IREO",
    dllFilename: BLACK2_BATTLE_LOG_DLL_FILENAME,
    dllPath: BLACK2_BATTLE_LOG_DLL_PATH,
    dllUrl: new URL("../assets/codeinjection/Black2UpgradeBattleLog.dll", import.meta.url),
    counterDllFilename: BLACK2_BATTLE_LOG_COUNTER_DLL_FILENAME,
    counterDllPath: BLACK2_BATTLE_LOG_COUNTER_DLL_PATH,
    counterDllUrl: new URL("../assets/codeinjection/Black2UpgradeBattleCounters.dll", import.meta.url),
    summaryDllFilename: BLACK2_BATTLE_LOG_SUMMARY_DLL_FILENAME,
    summaryDllPath: BLACK2_BATTLE_LOG_SUMMARY_DLL_PATH,
    summaryDllUrl: new URL("../assets/codeinjection/Black2UpgradeBattleLogSummary.dll", import.meta.url),
    runtimeFingerprints: {
      battle: { length: 2544, fnv1a: 0xd9edf49c },
      counters: { length: 672, fnv1a: 0x38fe5fb1 },
      summary: { length: 1008, fnv1a: 0x6d26cc5f },
    },
    wifiAddress: 0x02009f0c,
    wifiOriginalHex: "014a024b1847c046c407000020890702",
    wifiDisabledHex: "7047024b1847c046c407000020890702",
    hooks: [
      { label: "Pal Pad save-shadow guard", overlayId: 0, address: 0x02009f0c, expectedHex: "014a024b1847c046c407000020890702" },
      { label: "Battle result finalization", overlayId: 167, address: 0x0219ca48, expectedHex: "024a8358072b00d18150704744040000" },
      { label: "Faint detection", overlayId: 167, address: 0x021a8a24, expectedHex: "f8b582b00f1c041c381c12f007f9061c3c482518a85d0028" },
      { label: "Resolved move targets", overlayId: 167, address: 0x021ae32c, expectedHex: "f0b585b0041c039260681f1c02910a9dedf720fd04903869" },
      { label: "Individual PK5 counter RPC", overlayId: 167, address: 0x021bb368, expectedHex: "08b50d21fff722ff002801d1012008bd002008bd38b5051c" },
      { label: "Summary frag value", overlayId: 207, address: 0x021b6ef2, expectedHex: "0721002265f647ff0004020c0220009001200190381c0021" },
      { label: "Summary frag formatting", overlayId: 207, address: 0x021b6f08, expectedHex: "002105236df606fb4120009001200190112080010290e169" },
    ],
  },
  W: {
    displayName: "White",
    idCode: "IRAO",
    dllFilename: WHITE1_BATTLE_LOG_DLL_FILENAME,
    dllPath: WHITE1_BATTLE_LOG_DLL_PATH,
    dllUrl: new URL("../assets/codeinjection/White1BattleLog.dll", import.meta.url),
    counterDllFilename: WHITE1_BATTLE_LOG_COUNTER_DLL_FILENAME,
    counterDllPath: WHITE1_BATTLE_LOG_COUNTER_DLL_PATH,
    counterDllUrl: new URL("../assets/codeinjection/White1BattleCounters.dll", import.meta.url),
    summaryDllFilename: WHITE1_BATTLE_LOG_SUMMARY_DLL_FILENAME,
    summaryDllPath: WHITE1_BATTLE_LOG_SUMMARY_DLL_PATH,
    summaryDllUrl: new URL("../assets/codeinjection/White1BattleLogSummary.dll", import.meta.url),
    runtimeFingerprints: {
      battle: { length: 2400, fnv1a: 0xcc96adea },
      counters: { length: 608, fnv1a: 0xe807d97f },
      summary: { length: 944, fnv1a: 0x38e5e842 },
    },
    wifiAddress: 0x020097f0,
    wifiOriginalHex: "014a024b1847c046c40700005c2d0802",
    wifiDisabledHex: "7047024b1847c046c40700005c2d0802",
    hooks: [
      { label: "Pal Pad save-shadow guard", overlayId: 0, address: 0x020097f0, expectedHex: "014a024b1847c046c40700005c2d0802" },
      { label: "Battle result finalization", overlayId: 93, address: 0x021b918c, expectedHex: "024a8358072b00d18150704744040000" },
      { label: "Faint detection", overlayId: 93, address: 0x021c4f84, expectedHex: "f8b582b00f1c041c381c10f067fa061c3c482518a85d0028" },
      { label: "Resolved move targets", overlayId: 93, address: 0x021ca814, expectedHex: "f0b585b0041c039260681f1c02910a9dedf7c0fe04903869" },
      { label: "Individual PK5 counter RPC", overlayId: 93, address: 0x021d5b88, expectedHex: "08b50d21fff722ff002801d1012008bd002008bd38b5051c" },
      { label: "Summary frag value", overlayId: 131, address: 0x021d80ea, expectedHex: "072100223ff6d9fe0004020c0220009001200190" },
      { label: "Summary frag formatting", overlayId: 131, address: 0x021d8100, expectedHex: "0021052346f65cff412000900120019011208001" },
    ],
  },
  B: {
    displayName: "Black",
    idCode: "IRBO",
    dllFilename: BLACK1_BATTLE_LOG_DLL_FILENAME,
    dllPath: BLACK1_BATTLE_LOG_DLL_PATH,
    dllUrl: new URL("../assets/codeinjection/Black1BattleLog.dll", import.meta.url),
    counterDllFilename: BLACK1_BATTLE_LOG_COUNTER_DLL_FILENAME,
    counterDllPath: BLACK1_BATTLE_LOG_COUNTER_DLL_PATH,
    counterDllUrl: new URL("../assets/codeinjection/Black1BattleCounters.dll", import.meta.url),
    summaryDllFilename: BLACK1_BATTLE_LOG_SUMMARY_DLL_FILENAME,
    summaryDllPath: BLACK1_BATTLE_LOG_SUMMARY_DLL_PATH,
    summaryDllUrl: new URL("../assets/codeinjection/Black1BattleLogSummary.dll", import.meta.url),
    runtimeFingerprints: {
      battle: { length: 2400, fnv1a: 0xf45a813b },
      counters: { length: 608, fnv1a: 0xa57eca34 },
      summary: { length: 944, fnv1a: 0x6bf2476a },
    },
    wifiAddress: 0x020097f0,
    wifiOriginalHex: "014a024b1847c046c4070000442d0802",
    wifiDisabledHex: "7047024b1847c046c4070000442d0802",
    hooks: [
      { label: "Pal Pad save-shadow guard", overlayId: 0, address: 0x020097f0, expectedHex: "014a024b1847c046c4070000442d0802" },
      { label: "Battle result finalization", overlayId: 93, address: 0x021b916c, expectedHex: "024a8358072b00d18150704744040000" },
      { label: "Faint detection", overlayId: 93, address: 0x021c4f64, expectedHex: "f8b582b00f1c041c381c10f067fa061c3c482518a85d0028" },
      { label: "Resolved move targets", overlayId: 93, address: 0x021ca7f4, expectedHex: "f0b585b0041c039260681f1c02910a9dedf7c0fe" },
      { label: "Individual PK5 counter RPC", overlayId: 93, address: 0x021d5b68, expectedHex: "08b50d21fff722ff002801d1012008bd002008bd38b5051c" },
      { label: "Summary frag value", overlayId: 131, address: 0x021d80ca, expectedHex: "072100223ff6dbfe0004020c0220009001200190" },
      { label: "Summary frag formatting", overlayId: 131, address: 0x021d80e0, expectedHex: "0021052346f65eff412000900120019011208001" },
    ],
  },
};

function battleLogLayout(version: string) {
  return version === "B" || version === "W" || version === "B2" || version === "W2" ? BATTLE_LOG_LAYOUTS[version] : undefined;
}

export function battleLogDisplayName(version: string): string | undefined {
  return battleLogLayout(version)?.displayName;
}

export type BattleLogCompatibilityCheck = {
  label: string;
  overlayId: number;
  address: number;
  matched: boolean;
  message: string;
};

export type BattleLogCompatibilityReport = {
  supported: boolean;
  compatible: boolean;
  checked: boolean;
  passed: number;
  checks: BattleLogCompatibilityCheck[];
  message: string;
};

export type BattleLogInstallStatus = BattleLogCompatibilityReport & {
  installed: boolean;
  upToDate: boolean;
  updateAvailable: boolean;
  runtimeVersion?: number;
  bundledRuntimeVersion: number;
  pmcInstalled: boolean;
  dllInstalled: boolean;
  counterDllInstalled: boolean;
  summaryDllInstalled: boolean;
  ancestryInstalled: boolean;
  saveGuardInstalled: boolean;
};

export type BattleLogInstallResult = {
  dllPath: string;
  counterDllPath: string;
  summaryDllPath: string;
  ancestryPath: string;
  ancestryBytes: number;
  evolutionMembers: number;
};

export function canUninstallBattleLog(project: ProjectState): boolean {
  const layout = battleLogLayout(project.session.baseVersion);
  return Boolean(layout
    && !hasMenuEvolutionCompanion(project)
    && canRemoveStagedCodeInjectionDll(project, layout.dllPath)
    && canRemoveStagedCodeInjectionDll(project, layout.counterDllPath)
    && canRemoveStagedCodeInjectionDll(project, layout.summaryDllPath));
}

export function getBattleLogInstallStatus(project: ProjectState): BattleLogInstallStatus {
  const compatibility = detectBattleLogCompatibility(project);
  const modules = listCodeInjectionDlls(project);
  const layout = battleLogLayout(project.session.baseVersion);
  const dllInstalled = Boolean(layout && modules.some((module) => module.path.toLowerCase() === layout.dllPath.toLowerCase()));
  const counterDllInstalled = Boolean(layout && modules.some((module) => module.path.toLowerCase() === layout.counterDllPath.toLowerCase()));
  const summaryDllInstalled = Boolean(layout && modules.some((module) => module.path.toLowerCase() === layout.summaryDllPath.toLowerCase()));
  const ancestryInstalled = project.codeInjection?.battleLog?.ancestryPath === BATTLE_LOG_ANCESTRY_PATH
    || hasRomPath(project, BATTLE_LOG_ANCESTRY_PATH);
  const saveGuardInstalled = Boolean(layout && isWifiListSyncDisabled(project, project.session.baseVersion as SupportedBattleLogVersion));
  const installed = dllInstalled && counterDllInstalled && summaryDllInstalled && ancestryInstalled && saveGuardInstalled;
  const runtimeVersion = project.codeInjection?.battleLog?.runtimeVersion;
  const upToDate = Boolean(installed && layout && isCurrentBattleLogRuntime(project, layout));
  const updateAvailable = installed && !upToDate;
  return {
    ...compatibility,
    message: updateAvailable
      ? `${compatibility.message} An older or unrecognized battle-log runtime is installed and can be updated in place.`
      : compatibility.message,
    installed,
    upToDate,
    updateAvailable,
    runtimeVersion: upToDate ? Math.max(runtimeVersion ?? 0, BATTLE_LOG_RUNTIME_VERSION) : runtimeVersion,
    bundledRuntimeVersion: BATTLE_LOG_RUNTIME_VERSION,
    pmcInstalled: getPmcInstallStatus(project).installed,
    dllInstalled,
    counterDllInstalled,
    summaryDllInstalled,
    ancestryInstalled,
    saveGuardInstalled,
  };
}

export function detectBattleLogCompatibility(
  project: ProjectState,
  romBytes: Uint8Array | undefined = project.originalRomBytes,
): BattleLogCompatibilityReport {
  const layout = battleLogLayout(project.session.baseVersion);
  if ((project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") || !layout) {
    return {
      supported: false,
      compatible: false,
      checked: false,
      passed: 0,
      checks: [],
      message: "The battle log supports US Black, White, Black 2, White 2, and the corresponding Upgrade ROMs.",
    };
  }
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
      message: "The source ROM could not be parsed for battle-log compatibility.",
    };
  }
  if (rom.idCode !== layout.idCode) {
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
    overlays = rom.loadArm9Overlays([...new Set(layout.hooks.filter((hook) => hook.overlayId !== 0).map((hook) => hook.overlayId))]);
  } catch {
    overlays = new Map();
  }
  const checks = layout.hooks.map((signature) => {
    const original = signature.overlayId === 0 ? undefined : overlays.get(signature.overlayId);
    const data = signature.overlayId === 0
      ? (project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9))
      : project.overlays[signature.overlayId] ?? original?.data;
    const offset = signature.overlayId === 0
      ? signature.address - rom.arm9RamAddress
      : original ? signature.address - original.ramAddress : -1;
    const expected = hexToBytes(signature.expectedHex);
    const actual = data && offset >= 0 && offset + expected.length <= data.length
      ? data.subarray(offset, offset + expected.length)
      : undefined;
    const disabled = signature.overlayId === 0 && signature.address === layout.wifiAddress
      ? hexToBytes(layout.wifiDisabledHex)
      : undefined;
    const matched = Boolean(actual && (bytesEqual(actual, expected) || Boolean(disabled && bytesEqual(actual, disabled))));
    return {
      label: signature.label,
      overlayId: signature.overlayId,
      address: signature.address,
      matched,
      message: matched
        ? `${signature.overlayId === 0 ? "ARM9" : `Overlay ${signature.overlayId}`} matches at ${hexAddress(signature.address)}.`
        : `${signature.overlayId === 0 ? "ARM9" : `Overlay ${signature.overlayId}`} differs or is missing at ${hexAddress(signature.address)}.`,
    };
  });
  const passed = checks.filter((check) => check.matched).length;
  const compatible = passed === checks.length;
  return {
    supported: true,
    compatible,
    checked: true,
    passed,
    checks,
    message: compatible
      ? `All ${checks.length} battle-log hook regions match the US ${layout.displayName} layout.`
      : `Battle-log compatibility failed (${passed}/${checks.length} hook regions matched).`,
  };
}

export async function installBattleLog(project: ProjectState): Promise<BattleLogInstallResult> {
  const layout = battleLogLayout(project.session.baseVersion);
  if ((project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") || !layout) {
    throw new Error("The battle log supports US Black, White, Black 2, White 2, and the corresponding Upgrade ROMs.");
  }
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing the battle log.");

  const compatibility = detectBattleLogCompatibility(project, romBytes);
  if (!compatibility.compatible) throw new Error(compatibility.message);
  const rom = new NintendoDSRom(romBytes);

  const pmcStatus = getPmcInstallStatus(project);
  // Refresh BW1's bundled PMC even when an earlier browser session already
  // staged overlay 237. The initial BW1 release omitted GFLAppInit from its
  // bootstrap, and merely reinstalling the battle-log DLLs would otherwise
  // leave that broken overlay in the persistent project.
  if (project.session.baseRom === "BW" || !pmcStatus.installed) await installBundledPmc(project);
  disableWifiListSync(project, rom, project.session.baseVersion as SupportedBattleLogVersion);
  const [battleResponse, counterResponse, summaryResponse] = await Promise.all([
    fetch(layout.dllUrl),
    fetch(layout.counterDllUrl),
    fetch(layout.summaryDllUrl),
  ]);
  if (!battleResponse.ok) throw new Error(`Could not load the bundled battle-log battle DLL (${battleResponse.status})`);
  if (!counterResponse.ok) throw new Error(`Could not load the bundled battle-log counter DLL (${counterResponse.status})`);
  if (!summaryResponse.ok) throw new Error(`Could not load the bundled battle-log summary DLL (${summaryResponse.status})`);
  stageCodeInjectionDll(project, layout.dllFilename, new Uint8Array(await battleResponse.arrayBuffer()), "patches", romBytes);
  stageCodeInjectionDll(project, layout.counterDllFilename, new Uint8Array(await counterResponse.arrayBuffer()), "patches", romBytes);
  stageCodeInjectionDll(project, layout.summaryDllFilename, new Uint8Array(await summaryResponse.arrayBuffer()), "patches", romBytes);

  const evolutionMembers = currentEvolutionMembers(project, rom);
  const ancestryBytes = buildBattleLogAncestryNarc(evolutionMembers);
  // Older installer builds staged this at the NitroFS root. A root file must
  // be inserted before the root's subdirectories, which shifts existing file
  // IDs and breaks consumers that cached the original IDs. Remove an
  // unexported legacy addition before staging the append-only directory path.
  if (project.fileSystem?.additions) delete project.fileSystem.additions[LEGACY_BATTLE_LOG_ANCESTRY_PATH];
  const ancestryFileId = rom.filenames.idOf(BATTLE_LOG_ANCESTRY_PATH);
  stageRomPath(project, rom, BATTLE_LOG_ANCESTRY_PATH, ancestryBytes);
  project.codeInjection ??= {};
  project.codeInjection.battleLog = {
    ancestryPath: BATTLE_LOG_ANCESTRY_PATH,
    ancestryFileId,
    runtimeVersion: BATTLE_LOG_RUNTIME_VERSION,
  };

  recordGenericChange(
    project,
    "code_injection",
    `Battle-log runtime v${BATTLE_LOG_RUNTIME_VERSION} staged with AI-partner KO attribution, split safe-byte PK5 counters, ${evolutionMembers.length} evolution mappings, a ${BATTLE_LOG_CAPACITY}-record capacity, and Wi-Fi save blocks 29–31 retired.`,
    "Battle Log",
    { key: "code-injection:battle-log" },
  );
  return {
    dllPath: layout.dllPath,
    counterDllPath: layout.counterDllPath,
    summaryDllPath: layout.summaryDllPath,
    ancestryPath: BATTLE_LOG_ANCESTRY_PATH,
    ancestryBytes: ancestryBytes.length,
    evolutionMembers: evolutionMembers.length,
  };
}

export function uninstallBattleLog(project: ProjectState): void {
  const layout = battleLogLayout(project.session.baseVersion);
  if ((project.session.baseRom !== "BW" && project.session.baseRom !== "BW2") || !layout) {
    throw new Error("The battle log supports US Black, White, Black 2, White 2, and the corresponding Upgrade ROMs.");
  }
  if (hasMenuEvolutionCompanion(project)) {
    throw new Error("Uninstall Menu Evolution before uninstalling its required battle-counter DLL.");
  }
  if (!canUninstallBattleLog(project)) {
    throw new Error("Battle-log DLLs already built into the loaded ROM cannot be removed by this editor yet.");
  }

  const version = project.session.baseVersion as SupportedBattleLogVersion;
  project.arm9 = restoreBattleLogWifiListSync(project.arm9, GEN5_ARM9_RAM_ADDRESS, version);
  project.arm9Dirty = true;
  removeStagedCodeInjectionDll(project, layout.dllPath);
  removeStagedCodeInjectionDll(project, layout.counterDllPath);
  removeStagedCodeInjectionDll(project, layout.summaryDllPath);

  const ancestry = project.codeInjection?.battleLog;
  if (ancestry?.ancestryFileId !== undefined) clearRomFileReplacement(project, ancestry.ancestryFileId);
  else if (project.fileSystem?.additions) delete project.fileSystem.additions[BATTLE_LOG_ANCESTRY_PATH];
  if (project.codeInjection) delete project.codeInjection.battleLog;

  recordGenericChange(
    project,
    "code_injection",
    "Split battle-log runtime DLLs removed and the Pal Pad/Wi-Fi save routine restored; existing battle-log save records were preserved.",
    "Battle Log",
    { key: "code-injection:battle-log" },
  );
}

function hasMenuEvolutionCompanion(project: ProjectState): boolean {
  if (project.codeInjection?.menuEvolution) return true;
  return listCodeInjectionDlls(project).some((module) => {
    const path = module.path.toLowerCase();
    return path === "patches/menuevolutionb2.dll" || path === "patches/menuevolutionw2.dll";
  });
}

function disableWifiListSync(project: ProjectState, rom: NintendoDSRom, version: SupportedBattleLogVersion): void {
  const arm9 = project.arm9.length > 0 ? project.arm9 : decompressCode(rom.arm9);
  project.arm9 = patchBattleLogWifiListSync(arm9, rom.arm9RamAddress, version);
  project.arm9Dirty = true;
}

function isWifiListSyncDisabled(project: ProjectState, version: SupportedBattleLogVersion): boolean {
  let arm9 = project.arm9;
  let arm9RamAddress = GEN5_ARM9_RAM_ADDRESS;
  try {
    if (project.originalRomBytes) {
      const rom = new NintendoDSRom(project.originalRomBytes);
      arm9RamAddress = rom.arm9RamAddress;
      if (arm9.length === 0) arm9 = decompressCode(rom.arm9);
    }
    if (arm9.length === 0) return false;
    const layout = BATTLE_LOG_LAYOUTS[version];
    const offset = layout.wifiAddress - arm9RamAddress;
    const disabled = hexToBytes(layout.wifiDisabledHex);
    return offset >= 0
      && offset + disabled.length <= arm9.length
      && bytesEqual(arm9.subarray(offset, offset + disabled.length), disabled);
  } catch {
    return false;
  }
}

export function patchBattleLogWifiListSync(
  arm9: Uint8Array,
  arm9RamAddress: number,
  version: SupportedBattleLogVersion = "W2",
): Uint8Array {
  const output = arm9.slice();
  const layout = BATTLE_LOG_LAYOUTS[version];
  const offset = layout.wifiAddress - arm9RamAddress;
  const original = hexToBytes(layout.wifiOriginalHex);
  const disabled = hexToBytes(layout.wifiDisabledHex);
  if (offset < 0 || offset + original.length > output.length) {
    throw new Error(`The ${layout.displayName} Wi-Fi List copy routine is outside ARM9.`);
  }
  const current = output.subarray(offset, offset + original.length);
  if (!bytesEqual(current, original) && !bytesEqual(current, disabled)) {
    throw new Error(`The ${layout.displayName} Wi-Fi List copy routine changed after compatibility checking.`);
  }

  // `bx lr` retires the incompatible Pal Pad/Wi-Fi List shadow copy. The
  // remainder of the original routine is intentionally left untouched.
  output[offset] = 0x70;
  output[offset + 1] = 0x47;
  return output;
}

export function restoreBattleLogWifiListSync(
  arm9: Uint8Array,
  arm9RamAddress: number,
  version: SupportedBattleLogVersion = "W2",
): Uint8Array {
  const output = arm9.slice();
  const layout = BATTLE_LOG_LAYOUTS[version];
  const offset = layout.wifiAddress - arm9RamAddress;
  const original = hexToBytes(layout.wifiOriginalHex);
  const disabled = hexToBytes(layout.wifiDisabledHex);
  if (offset < 0 || offset + original.length > output.length) {
    throw new Error(`The ${layout.displayName} Wi-Fi List copy routine is outside ARM9.`);
  }
  const current = output.subarray(offset, offset + original.length);
  if (!bytesEqual(current, original) && !bytesEqual(current, disabled)) {
    throw new Error(`The ${layout.displayName} Wi-Fi List copy routine changed after battle-log installation.`);
  }
  output.set(original, offset);
  return output;
}

export function buildBattleLogAncestryNarc(evolutionMembers: Uint8Array[]): Uint8Array {
  validateEvolutionMembers(evolutionMembers);
  const parents = Array.from({ length: SPECIES_COUNT }, () => new Set<number>());
  evolutionMembers.slice(0, SPECIES_COUNT).forEach((member, source) => {
    for (let offset = 0; offset < member.length; offset += EVOLUTION_SLOT_SIZE) {
      const method = readU16(member, offset);
      const target = readU16(member, offset + 4);
      if (method !== 0 && target !== 0 && target < SPECIES_COUNT) parents[target]!.add(source);
    }
  });

  const ancestry = (species: number): number[] => {
    const family = new Set<number>([species]);
    const pending = [species];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const parent of [...parents[current]!].sort((left, right) => right - left)) {
        if (family.has(parent)) continue;
        family.add(parent);
        pending.push(parent);
      }
    }
    const result = [...family].sort((left, right) => left - right);
    if (result.length > MAX_ANCESTORS) {
      throw new Error(`Species ${species} has ${result.length} ancestors; the battle-log limit is ${MAX_ANCESTORS}.`);
    }
    return result;
  };

  const narc = new NARC();
  narc.files = Array.from({ length: SPECIES_COUNT }, (_value, species) => {
    const family = ancestry(species);
    const member = new Uint8Array(2 + family.length * 2);
    member[0] = ANCESTRY_VERSION;
    member[1] = family.length;
    family.forEach((ancestor, index) => {
      member[2 + index * 2] = ancestor & 0xff;
      member[3 + index * 2] = ancestor >>> 8;
    });
    return member;
  });
  const bytes = narc.save();
  const reparsed = new NARC(bytes);
  if (reparsed.files.length !== SPECIES_COUNT) throw new Error("Generated battle-log ancestry NARC failed validation.");
  return bytes;
}

function validateEvolutionMembers(members: Uint8Array[]): void {
  if (members.length === 0) throw new Error("The evolution NARC has no members.");
  const memberSize = members[0]!.length;
  if (!EVOLUTION_MEMBER_SIZES.has(memberSize)) {
    throw new Error(`Evolution member 0 is ${memberSize} bytes; expected 42 or 48.`);
  }
  members.forEach((member, index) => {
    if (member.length !== memberSize) {
      throw new Error(`Evolution member ${index} is ${member.length} bytes; expected ${memberSize}.`);
    }
  });
}

function currentEvolutionMembers(project: ProjectState, rom: NintendoDSRom): Uint8Array[] {
  const store = project.narcs.evolutions;
  if (store) return store.rawFiles;
  const fileId = rom.filenames.idOf(BATTLE_LOG_EVOLUTION_PATH);
  if (fileId === undefined) throw new Error(`The ROM does not contain ${BATTLE_LOG_EVOLUTION_PATH}.`);
  const bytes = project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  if (!bytes) throw new Error("The evolution NARC could not be loaded.");
  return new NARC(bytes).files;
}

function stageRomPath(project: ProjectState, rom: NintendoDSRom, path: string, bytes: Uint8Array): void {
  const fileId = rom.filenames.idOf(path);
  if (fileId === undefined) addRomFile(project, path, bytes);
  else setRomFileReplacement(project, fileId, bytes);
}

function hasRomPath(project: ProjectState, path: string): boolean {
  if (project.fileSystem?.additions?.[path]) return true;
  if (!project.originalRomBytes) return false;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes);
    const fileId = rom.filenames.idOf(path);
    return fileId !== undefined && Boolean(project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId]);
  } catch {
    return false;
  }
}

function isCurrentBattleLogRuntime(
  project: ProjectState,
  layout: (typeof BATTLE_LOG_LAYOUTS)[SupportedBattleLogVersion],
): boolean {
  const markedVersion = project.codeInjection?.battleLog?.runtimeVersion;
  // Do not offer to replace a project written by a newer Pokeweb release.
  if (markedVersion !== undefined && markedVersion > BATTLE_LOG_RUNTIME_VERSION) return true;

  const artifacts = [
    [layout.dllPath, layout.runtimeFingerprints.battle],
    [layout.counterDllPath, layout.runtimeFingerprints.counters],
    [layout.summaryDllPath, layout.runtimeFingerprints.summary],
  ] as const;
  let matchedArtifacts = 0;
  for (const [path, expected] of artifacts) {
    const bytes = effectiveRomPathBytes(project, path);
    if (!bytes) continue;
    if (!matchesRuntimeFingerprint(bytes, expected)) return false;
    matchedArtifacts += 1;
  }
  if (matchedArtifacts === artifacts.length) return true;
  return markedVersion === BATTLE_LOG_RUNTIME_VERSION;
}

function effectiveRomPathBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const normalized = path.toLowerCase();
  const additionPath = Object.keys(project.fileSystem?.additions ?? {}).find(
    (candidate) => candidate.toLowerCase() === normalized,
  );
  if (additionPath) return project.fileSystem?.additions?.[additionPath];
  if (!project.originalRomBytes) return undefined;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes);
    const fileId = rom.filenames.idOf(path);
    if (fileId === undefined) return undefined;
    return project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId];
  } catch {
    return undefined;
  }
}

function matchesRuntimeFingerprint(bytes: Uint8Array, expected: RuntimeFingerprint): boolean {
  if (bytes.length !== expected.length) return false;
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === expected.fnv1a;
}

function hexToBytes(hex: string): Uint8Array {
  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
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
