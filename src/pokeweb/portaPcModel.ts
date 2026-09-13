import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import {
  canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc,
  listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll,
  type CodeInjectionDllInstallResult,
} from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";

const LAYOUTS = {
  W2: {
    idCode: "IRDO", fileName: "PortaPCW2.dll",
    url: new URL("../assets/codeinjection/PortaPCW2.dll", import.meta.url),
    grid: 0x0218151c, rail: 0x02181aa0, keys: 0x0203df28, heap: 0x02180500, script: 0x021536ac,
  },
  B2: {
    idCode: "IREO", fileName: "PortaPCB2.dll",
    url: new URL("../assets/codeinjection/PortaPCB2.dll", import.meta.url),
    grid: 0x021814dc, rail: 0x02181a60, keys: 0x0203defc, heap: 0x021804c0, script: 0x0215366c,
  },
} as const;
type Version = keyof typeof LAYOUTS;
type Layout = typeof LAYOUTS[Version];
type Signature = { module: string; address: number; hex: string };
const KNOWN_NAMES = new Set(["portapcw2.dll", "portapcb2.dll", "01_buttonscript.dll", "buttonscript.dll"]);

// Mask only the three relocatable native BL instructions. Check the relocation
// destinations separately so both stripped builds and the original unstripped
// ButtonScript DLL can be identified without trusting filenames.
const CODE_HEX = "00280fd10fb400000000074901420fbc08d0201c00000000031c281c03490022000000001cb0f8bd080000006a270000";
const LEGACY_CODE_HEX = "07b4000000000749014207bc08d0201c00000000031c281c03490022000000001cb0f8bd080000006a270000";

export type PortaPcStatus = {
  supported: boolean;
  compatible: boolean;
  installed: boolean;
  updateAvailable: boolean;
  pmcInstalled: boolean;
  canUninstall: boolean;
  dllPath?: string;
  message: string;
};

export function getPortaPcStatus(project: ProjectState): PortaPcStatus {
  const status: PortaPcStatus = {
    supported: false, compatible: false, installed: false, updateAvailable: false,
    pmcInstalled: getPmcInstallStatus(project).installed, canUninstall: false,
    message: "Porta PC supports US Black 2 (IREO) and White 2 (IRDO).",
  };
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "W2" && version !== "B2")) return status;
  const layout = LAYOUTS[version];
  let rom: NintendoDSRom | undefined;
  try {
    if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes);
  } catch {
    return { ...status, supported: true, message: "Reload the ROM to check Porta PC compatibility." };
  }
  if ((rom?.idCode ?? project.romInfo.idCode) !== layout.idCode) return status;
  status.supported = true;

  const signatures = hookSignatures(layout);
  const installed = new Map<string, "current" | "legacy">();
  const conflicts: string[] = [];
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
      // An unrelated older DLL format does not establish a hook conflict.
    }
    const kind = rpm && identifyRuntime(rpm, version);
    if (kind) installed.set(entry.path, kind);
    else if (KNOWN_NAMES.has(entry.fileName.toLowerCase()) || (rpm && overlapsHooks(rpm, signatures))) conflicts.push(entry.path);
  }
  status.installed = installed.size > 0;
  status.dllPath = [...installed.keys()][0];
  status.updateAvailable = [...installed.values()].includes("legacy");
  status.canUninstall = installed.size === 1 && canRemoveStagedCodeInjectionDll(project, status.dllPath!);
  if (installed.size > 1 || conflicts.length) {
    status.message = installed.size > 1 ? "Multiple Porta PC DLLs are present. Remove the duplicate before installing."
      : `Conflicting field hooks or an unrecognized Porta PC DLL: ${conflicts.join(", ")}.`;
    return status;
  }
  if (rom) {
    try {
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([12, 36]));
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      for (const signature of signatures) {
        const overlay = overlays.get(Number(signature.module));
        const base = signature.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress;
        const data = signature.module === "ARM9" ? [arm9]
          : [overlay?.data, project.overlays[Number(signature.module)] ?? overlay?.data];
        const offset = base === undefined ? -1 : signature.address - base;
        if (data.some((bytes) => !bytes || offset < 0 || toHex(bytes.subarray(offset, offset + signature.hex.length / 2)) !== signature.hex)) {
          status.message = `Porta PC requires the original field code in ${signature.module === "ARM9" ? "ARM9" : `overlay ${signature.module}`} at 0x${signature.address.toString(16)}.`;
          return status;
        }
      }
    } catch {
      status.message = "Could not read the field code to check Porta PC compatibility.";
      return status;
    }
  }
  status.compatible = true;
  status.message = status.updateAvailable
    ? "The original ButtonScript patch is installed. Replace it in place to support rail maps and preserve other field events when Start is pressed."
    : status.installed ? "Porta PC is included in this project. Press Start while exploring to use the PC."
      : rom ? "The field hooks match. PMC will be installed automatically if needed."
        : "The field hooks will be checked during installation.";
  return status;
}

export async function installPortaPc(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  let status = getPortaPcStatus(project);
  if (!status.supported) throw new Error(status.message);
  project.originalRomBytes ??= await loadActiveRomBytes();
  if (!project.originalRomBytes) throw new Error("Reload the ROM before installing Porta PC.");
  status = getPortaPcStatus(project);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const layout = LAYOUTS[version];
  const fileName = status.dllPath?.split("/").pop() ?? layout.fileName;
  if (status.installed && !status.updateAvailable) {
    return { path: status.dllPath!, fileName, target: "patches", gameId: version, version: "1.0.0" };
  }
  const response = await fetch(layout.url);
  if (!response.ok) throw new Error(`Could not load Porta PC (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (identifyRuntime(parseRpm(bytes, { allowedMagics: ["DLXF"] }), version) !== "current") {
    throw new Error("The bundled Porta PC DLL does not match the verified runtime.");
  }
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  // Keep an existing ButtonScript file's name and ID instead of adding a second
  // patch that would compete for the same field epilogues.
  const result = stageCodeInjectionDll(project, fileName, bytes);
  recordGenericChange(project, "code_injection", `Porta PC ${status.updateAvailable ? "updated" : "installed"}: press Start in the overworld to access the PC.`, "Porta PC", {
    key: "code-injection:porta-pc",
  });
  return result;
}

export function uninstallPortaPc(project: ProjectState): void {
  const status = getPortaPcStatus(project);
  if (!status.canUninstall || !status.dllPath) throw new Error("Only a Porta PC DLL staged in this project can be removed.");
  removeStagedCodeInjectionDll(project, status.dllPath);
  recordGenericChange(project, "code_injection", "Porta PC removed from the staged ROM changes.", "Porta PC", { key: "code-injection:porta-pc" });
}

function hookSignatures(layout: Layout): Signature[] {
  return [
    { module: "36", address: layout.grid, hex: "f8b59cb00c1c161c0021051c3160181c" },
    { module: "36", address: layout.grid + 0x368, hex: "002800d100201cb0f8bdc046" },
    { module: "36", address: layout.rail, hex: "f8b59cb0051c0c1c0ca8291c221c06ae" },
    { module: "36", address: layout.rail + 0x242, hex: "002800d100201cb0f8bd" },
    { module: "36", address: layout.heap, hex: "00887047" },
    { module: "12", address: layout.script, hex: "38b50d1c141c00210091191c2a1c231c00f0d2f838bd0000" },
    { module: "ARM9", address: layout.keys, hex: "08b5fff7ebf9fff7efff08bd" },
  ];
}

function identifyRuntime(rpm: RpmModule, version: Version): "current" | "legacy" | undefined {
  const layout = LAYOUTS[version];
  const original = rpm.code.length === 44;
  if (rpm.baseAddress !== 0 || rpm.bssSize !== 0 || rpm.relocations.length !== (original ? 4 : 5) || rpm.symbols.some((s) => s.attributes & 2)) return;
  if (rpm.metadata.PMCGameID !== undefined && rpm.metadata.PMCGameID !== version) return;
  if (!original && (rpm.metadata.PMCGameID !== version || rpm.metadata.PMCVersion !== "1.0.0" || rpm.metadata.PMCModulePriority !== 4)) return;
  const sites = original ? [2, 16, 28] : [6, 20, 32];
  const expected = [layout.keys, layout.heap, layout.script].map((address, i) => `base:${sites[i]}:${address}:global`);
  expected.push(`36:${layout.grid + 0x36e}:0:local`);
  if (!original) expected.push(`36:${layout.rail + 0x248}:0:local`);
  const actual = rpm.relocations.map(({ target, sourceSymbolIndex }) => {
    const source = rpm.symbols[sourceSymbolIndex];
    if (target.type !== "THUMB_BRANCH_LINK" || source?.type !== "FUNCTION_THM") return "invalid";
    return `${target.module}:${target.address}:${source.address}:${source.attributes & 4 ? "global" : "local"}`;
  });
  if (actual.sort().join("|") !== expected.sort().join("|")) return;
  const code = rpm.code.slice();
  for (const offset of sites) code.fill(0, offset, offset + 4);
  if (toHex(code) === (original ? LEGACY_CODE_HEX : CODE_HEX)) return original ? "legacy" : "current";
}

function overlapsHooks(rpm: RpmModule, signatures: Signature[]): boolean {
  return rpm.relocations.some(({ target, sourceSymbolIndex }) => {
    const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
      : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
    return signatures.some(({ module, address, hex }) => target.module === module
      && target.address < address + hex.length / 2 && target.address + size > address);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
