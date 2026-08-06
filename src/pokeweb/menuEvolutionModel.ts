import { readU16 } from "../nds/binary";
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

// The US B2/W2 party overlay loads message NARC member 178.  The Japanese
// source labels this resource as msg_pokelist, but its retail-US member index
// is not the source tree's 158.
export const MENU_EVOLUTION_MESSAGE_BANK_ID = 178;
export const MENU_EVOLUTION_CONFIG_VERSION = 1;
export const MENU_EVOLUTION_W2_FILENAME = "MenuEvolutionW2.dll";
export const MENU_EVOLUTION_B2_FILENAME = "MenuEvolutionB2.dll";
export const MENU_EVOLUTION_W2_PATH = `patches/${MENU_EVOLUTION_W2_FILENAME}`;
export const MENU_EVOLUTION_B2_PATH = `patches/${MENU_EVOLUTION_B2_FILENAME}`;

// Menu Evolution extends the retail three-operand GetPartyPokeParameter
// command. These read-only IDs are shared with the runtime public header.
export const MENU_EVOLUTION_GET_PARTY_PARAMETER_COMMAND = 0x010c;
export const MENU_EVOLUTION_COUNTER_PARAMETER_IDS = {
  kos: 0x0400,
  battlesBrought: 0x0401,
  battlesUsed: 0x0402,
} as const;

const MENU_EVOLUTION_CONFIG_MAGIC = new Uint8Array([0x4d, 0x45, 0x56, 0x4f, 0x4d, 0x53, 0x47, 0x00]);

type MenuEvolutionVersion = "B2" | "W2";

type HookSignature = {
  label: string;
  overlayId: number;
  address: number;
  expectedHex: string;
};

const MENU_EVOLUTION_LAYOUTS: Record<MenuEvolutionVersion, {
  displayName: string;
  idCode: string;
  dllFilename: string;
  dllPath: string;
  dllUrl: URL;
  counterDllPath: string;
  hooks: HookSignature[];
}> = {
  W2: {
    displayName: "White 2",
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
      { label: "Field-script battle counters", overlayId: 12, address: 0x0215701c, expectedHex: "f8b5061c0d1cfdf781fc041c" },
    ],
  },
  B2: {
    displayName: "Black 2",
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
      { label: "Field-script battle counters", overlayId: 12, address: 0x02156fdc, expectedHex: "f8b5061c0d1cfdf781fc041c" },
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
  pmcInstalled: boolean;
  dependencyInstalled: boolean;
  canUninstall: boolean;
  dllPath?: string;
  messageEntryId?: number;
};

export type MenuEvolutionInstallResult = {
  dllPath: string;
  messageBankId: number;
  messageEntryId: number;
};

function menuEvolutionLayout(version: string) {
  return version === "B2" || version === "W2" ? MENU_EVOLUTION_LAYOUTS[version] : undefined;
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
  return {
    ...compatibility,
    installed,
    pmcInstalled: getPmcInstallStatus(project).installed,
    dependencyInstalled: hasMenuEvolutionBattleCounterDependency(project),
    canUninstall: installed && canUninstallMenuEvolution(project),
    dllPath: layout?.dllPath,
    messageEntryId: project.codeInjection?.menuEvolution?.messageEntryId,
  };
}

export function detectMenuEvolutionCompatibility(
  project: ProjectState,
  romBytes: Uint8Array | undefined = project.originalRomBytes,
): MenuEvolutionCompatibilityReport {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (project.session.baseRom !== "BW2" || !layout) {
    return {
      supported: false,
      compatible: false,
      checked: false,
      passed: 0,
      checks: [],
      message: "Menu Evolution supports US Black 2 and White 2 only.",
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
      message: "The source ROM could not be parsed for Menu Evolution compatibility.",
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
    overlays = rom.loadArm9Overlays([...new Set(layout.hooks.map((hook) => hook.overlayId))]);
  } catch {
    overlays = new Map();
  }
  const checks = layout.hooks.map((signature) => {
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
  const passed = checks.filter((check) => check.matched).length;
  const compatible = passed === checks.length;
  return {
    supported: true,
    compatible,
    checked: true,
    passed,
    checks,
    message: compatible
      ? `All ${checks.length} Menu Evolution hook regions match the US ${layout.displayName} layout.`
      : `Menu Evolution compatibility failed (${passed}/${checks.length} hook regions matched).`,
  };
}

export async function installMenuEvolution(project: ProjectState): Promise<MenuEvolutionInstallResult> {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (project.session.baseRom !== "BW2" || !layout) {
    throw new Error("Menu Evolution supports US Black 2 and White 2 only.");
  }
  if (!hasMenuEvolutionBattleCounterDependency(project)) {
    throw new Error(`Install the battle log first; ${layout.counterDllPath} is required by Menu Evolution.`);
  }

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing Menu Evolution.");
  const compatibility = detectMenuEvolutionCompatibility(project, romBytes);
  if (!compatibility.compatible) throw new Error(compatibility.message);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);

  const messageEntryId = ensureEvolveMessage(project);
  const response = await fetch(layout.dllUrl);
  if (!response.ok) throw new Error(`Could not load the bundled Menu Evolution DLL (${response.status})`);
  const configuredDll = configureMenuEvolutionDll(new Uint8Array(await response.arrayBuffer()), messageEntryId);
  stageCodeInjectionDll(project, layout.dllFilename, configuredDll, "patches");

  project.codeInjection ??= {};
  project.codeInjection.menuEvolution = {
    messageBankId: MENU_EVOLUTION_MESSAGE_BANK_ID,
    messageEntryId,
  };
  recordGenericChange(
    project,
    "code_injection",
    `${layout.dllFilename} staged with message bank ${MENU_EVOLUTION_MESSAGE_BANK_ID}, entry ${messageEntryId}.`,
    "Menu Evolution",
    { key: "code-injection:menu-evolution" },
  );
  return { dllPath: layout.dllPath, messageBankId: MENU_EVOLUTION_MESSAGE_BANK_ID, messageEntryId };
}

export function uninstallMenuEvolution(project: ProjectState): void {
  const layout = menuEvolutionLayout(project.session.baseVersion);
  if (project.session.baseRom !== "BW2" || !layout) {
    throw new Error("Menu Evolution supports US Black 2 and White 2 only.");
  }
  if (!canUninstallMenuEvolution(project)) {
    throw new Error("A Menu Evolution DLL already built into the loaded ROM cannot be removed by this editor yet.");
  }
  removeStagedCodeInjectionDll(project, layout.dllPath);
  if (project.codeInjection) delete project.codeInjection.menuEvolution;
  recordGenericChange(
    project,
    "code_injection",
    "The staged Menu Evolution DLL was removed. Its harmless Evolve text entry was retained.",
    "Menu Evolution",
    { key: "code-injection:menu-evolution" },
  );
}

export function ensureEvolveMessage(project: ProjectState): number {
  const bank = getTextBank(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID);
  if (bank.length === 0) {
    throw new Error(`Message bank ${MENU_EVOLUTION_MESSAGE_BANK_ID} is unavailable or empty.`);
  }
  const existing = bank.find((entry) => parseTextEntryId(entry[0]).block === 0
    && entry[1].trim().toLowerCase() === "evolve");
  if (existing) return parseTextEntryId(existing[0]).entry;

  const nextEntryId = Math.max(...bank.map((entry) => parseTextEntryId(entry[0]).entry)) + 1;
  if (nextEntryId > 0xffff) {
    throw new Error(`Message bank ${MENU_EVOLUTION_MESSAGE_BANK_ID} has no available entry ID for Evolve.`);
  }
  addTextEntries(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID, 1);
  const appended = getTextBank(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID)
    .filter((entry) => parseTextEntryId(entry[0]).entry === nextEntryId);
  if (appended.length === 0) throw new Error("The Evolve message entry could not be appended.");
  appended.forEach((entry) => {
    entry[1] = "Evolve";
  });
  commitTextBank(project, "message_texts", MENU_EVOLUTION_MESSAGE_BANK_ID);
  return nextEntryId;
}

export function configureMenuEvolutionDll(bytes: Uint8Array, messageEntryId: number): Uint8Array {
  if (!Number.isInteger(messageEntryId) || messageEntryId < 0 || messageEntryId > 0xffff) {
    throw new Error(`Invalid Menu Evolution message entry ID: ${messageEntryId}`);
  }
  const matches = findAll(bytes, MENU_EVOLUTION_CONFIG_MAGIC);
  if (matches.length !== 1) {
    throw new Error(`The Menu Evolution DLL contains ${matches.length} configuration markers; expected exactly one.`);
  }
  const output = bytes.slice();
  const offset = matches[0]!;
  if (offset + 16 > output.length || readU16(output, offset + 8) !== MENU_EVOLUTION_CONFIG_VERSION) {
    throw new Error("The Menu Evolution DLL has an unsupported configuration layout.");
  }
  output[offset + 10] = messageEntryId & 0xff;
  output[offset + 11] = messageEntryId >>> 8;
  const complement = messageEntryId ^ 0xffff;
  output[offset + 12] = complement & 0xff;
  output[offset + 13] = complement >>> 8;
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
