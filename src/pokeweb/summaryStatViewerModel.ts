import { readU16, readU32, writeU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import manifest from "../assets/codeinjection/summaryStatViewerManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installPmcBytes,
  listCodeInjectionDlls, loadBundledPmcBytes, removeStagedCodeInjectionDll, stageCodeInjectionDll,
  type CodeInjectionDllInstallResult } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

export interface SummaryStatViewerOptions { includeEvs: boolean }
export const SUMMARY_STAT_VIEWER_VERSION = manifest.version;
export type SummaryStatViewerStatus = {
  supported: boolean; compatible: boolean; installed: boolean; canUninstall: boolean;
  pmcInstalled: boolean; options: SummaryStatViewerOptions; dllPath?: string; message: string;
  installedVersion?: string; updateAvailable: boolean;
};
type Version = "B2" | "W2";
const urls = { B2: new URL("../assets/codeinjection/SummaryStatViewerB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/SummaryStatViewerW2.dll", import.meta.url) };
const magic = new Uint8Array([83, 83, 86, 67, 70, 71, 49, 0]);
const hex = (b: Uint8Array) => Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
const hash = async (b: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))));
function configOffset(code: Uint8Array): number {
  const found: number[] = [];
  for (let i = 0; i <= code.length - 20; i++) if (magic.every((v, j) => code[i + j] === v)) found.push(i);
  if (found.length !== 1) throw new Error("Summary viewer configuration is missing or ambiguous.");
  const p = found[0];
  if (readU16(code, p + 8) !== 1 || readU16(code, p + 10) !== 20 || readU32(code, p + 12) > 1
    || readU32(code, p + 16) !== (readU32(code, p + 12) ^ 0x53535631)) throw new Error("Unsupported Summary viewer configuration.");
  return p;
}
function fingerprint(code: Uint8Array): string {
  const offset = configOffset(code); let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ (i >= offset + 12 && i < offset + 20 ? 0 : code[i]), 0x1000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
function recognized(rpm: RpmModule, version: Version): boolean {
  const current = manifest.games[version];
  const legacy = manifest.previousVersions.find(p => p.version === rpm.metadata.PMCVersion)?.games[version];
  const profile = rpm.metadata.PMCVersion === manifest.version ? current : legacy;
  try {
    if (!profile || rpm.baseAddress !== 0 || rpm.bssSize !== profile.bssSize || rpm.metadata.PMCGameID !== version
      || rpm.metadata.PMCModulePriority !== 4
      || rpm.symbols.some(s => s.attributes & 2) || fingerprint(rpm.code) !== profile.codeFingerprint) return false;
    const hooks = rpm.metadata.PMCVersion === manifest.version ? current.signatures.filter(s => s.patchSize) : legacy!.hooks;
    const expected = hooks.map(s => `${s.module}:${s.address}:THUMB_BRANCH_LINK`).sort();
    const actual = rpm.relocations.filter(r => r.target.module !== "base").map(r => `${r.target.module}:${r.target.address}:${r.target.type}`).sort();
    return actual.join("|") === expected.join("|");
  } catch { return false; }
}
export function configureSummaryStatViewerDll(bytes: Uint8Array, options: SummaryStatViewerOptions): Uint8Array {
  if (typeof options.includeEvs !== "boolean") throw new Error("Include EV view must be a boolean.");
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const version = rpm.metadata.PMCGameID;
  if ((version !== "W2" && version !== "B2") || !recognized(rpm, version)) throw new Error("Unrecognized Summary viewer DLL; it cannot be updated safely.");
  const at = configOffset(rpm.code), flags = Number(options.includeEvs);
  writeU32(rpm.code, at + 12, flags); writeU32(rpm.code, at + 16, flags ^ 0x53535631);
  return writeRpm(rpm, { ident: "DLXF" });
}
function bytesAt(project: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const id = rom?.filenames.idOf(path);
  return id !== undefined ? getRomFileBytes(project, rom!, id) : undefined;
}
export function getSummaryStatViewerStatus(project: ProjectState): SummaryStatViewerStatus {
  const state: SummaryStatViewerStatus = { supported: false, compatible: false, installed: false, canUninstall: false,
    pmcInstalled: getPmcInstallStatus(project).installed, options: { includeEvs: true }, updateAvailable: false,
    message: "Summary IV/EV Viewer supports English US Black 2 (IREO) and White 2 (IRDO)." };
  const v = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (v !== "B2" && v !== "W2")) return state;
  let rom: NintendoDSRom | undefined;
  try { if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); }
  catch { return { ...state, message: "Reload the ROM to check Summary compatibility." }; }
  const profile = manifest.games[v];
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode) return state;
  state.supported = true;
  const found: string[] = [];
  for (const entry of listCodeInjectionDlls(project)) {
    let rpm: RpmModule | undefined;
    try { const data = bytesAt(project, rom, entry.path); if (data) rpm = parseRpm(data, { allowedMagics: ["DLXF"] }); } catch { /* Reserved names below still fail closed. */ }
    if (entry.target === "patches" && rpm && recognized(rpm, v)) {
      found.push(entry.path); state.options = { includeEvs: Boolean(readU32(rpm.code, configOffset(rpm.code) + 12)) };
      state.installedVersion = String(rpm.metadata.PMCVersion);
      state.updateAvailable = state.installedVersion !== manifest.version;
    } else {
      const overlap = rpm?.relocations.some(({ target, sourceSymbolIndex }) => {
        const size = target.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0
          : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
        return profile.signatures.some(s => target.module === s.module && target.address < s.address + s.expectedHex.length / 2 && target.address + size > s.address);
      });
      if (overlap || /^SummaryStatViewer[WB]2\.dll$/iu.test(entry.fileName)) return { ...state,
        message: `Conflicting Summary code in ${entry.path}. Remove or update that module before installing this viewer.` };
    }
  }
  if (found.length > 1) return { ...state, installed: true, message: "Multiple Summary viewer DLLs are present. Remove the duplicate before updating." };
  state.installed = found.length === 1; state.dllPath = found[0];
  state.canUninstall = Boolean(state.dllPath && canRemoveStagedCodeInjectionDll(project, state.dllPath));
  if (rom) {
    try {
      const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([207])).get(207);
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      for (const signature of profile.signatures) {
        const base = signature.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress;
        const data = signature.module === "ARM9" ? [arm9] : [overlay?.data, project.overlays[207] ?? overlay?.data];
        const offset = base === undefined ? -1 : signature.address - base;
        if (data.some(d => !d || offset < 0 || hex(d.subarray(offset, offset + signature.expectedHex.length / 2)) !== signature.expectedHex)) {
          return { ...state, message: `Unrecognized Summary code in ${signature.module === "ARM9" ? "ARM9" : "overlay 207"} at 0x${signature.address.toString(16)}. Restore this hook or use a compatible build.` };
        }
      }
    } catch { return { ...state, message: "The Summary overlay could not be read. Reload the ROM before installing." }; }
  }
  state.compatible = true;
  state.message = state.installed ? `Summary viewer installed (${state.options.includeEvs ? "IVs and EVs" : "IVs only"}).`
    : "Uses native Summary controls. PMC is installed automatically when needed; other gameplay patches are not required.";
  if (state.updateAvailable) state.message += ` Version ${manifest.version} is available; update for native title lettering and restored Stats tab flashing.`;
  return state;
}
export async function installSummaryStatViewer(project: ProjectState, options: SummaryStatViewerOptions = { includeEvs: true }): Promise<CodeInjectionDllInstallResult> {
  const romBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!romBytes) throw new Error("Reload the ROM before installing the Summary viewer.");
  const input = { ...project, originalRomBytes: romBytes };
  const status = getSummaryStatViewerStatus(input);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const v = project.session.baseVersion as Version, profile = manifest.games[v];
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const fileId = rom.filenames.idOf("a/0/7/7");
  if (fileId === undefined) throw new Error("Summary graphics archive a/0/7/7 is missing.");
  const archive = new NARC(getRomFileBytes(project, rom, fileId));
  for (const resource of profile.resources) {
    const data = archive.files[resource.member];
    if (!data || await hash(data) !== resource.sha256) throw new Error(`Unrecognized Summary graphics member ${resource.member}. Restore the native title/footer graphics before installing.`);
  }
  const response = await fetch(urls[v]);
  if (!response.ok) throw new Error(`Could not load Summary viewer (${response.status}).`);
  const bundled = new Uint8Array(await response.arrayBuffer());
  if (await hash(bundled) !== profile.sha256) throw new Error("Bundled Summary viewer failed its integrity check.");
  const configured = configureSummaryStatViewerDll(bundled, options);
  // Stage on copies of the mutable PMC/install domains. The 512 MB input ROM
  // and unrelated project data remain shared read-only inputs.
  const staged: ProjectState = { ...input, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, data]) => [id, data?.slice()])),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  adoptExistingPmcInstall(staged, romBytes);
  if (!getPmcInstallStatus(staged).installed) installPmcBytes(staged, await loadBundledPmcBytes(v), romBytes);
  const result = stageCodeInjectionDll(staged, status.dllPath?.split("/").pop() ?? profile.fileName, configured, "patches", romBytes);
  recordGenericChange(staged, "code_injection", `Summary IV/EV Viewer ${status.installed ? "updated" : "installed"}; ${options.includeEvs ? "IV and EV" : "IV-only"} views.`, "Summary IV/EV Viewer", { key: "code-injection:summary-stat-viewer" });
  Object.assign(project, { originalRomBytes: romBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
}
export function uninstallSummaryStatViewer(project: ProjectState): void {
  const status = getSummaryStatViewerStatus(project);
  if (!status.canUninstall || !status.dllPath) throw new Error("Only a Summary viewer staged in this project can be removed. A DLL built into the loaded ROM cannot yet be deleted.");
  removeStagedCodeInjectionDll(project, status.dllPath);
  recordGenericChange(project, "code_injection", "Staged Summary IV/EV Viewer removed.", "Summary IV/EV Viewer", { key: "code-injection:summary-stat-viewer" });
}
