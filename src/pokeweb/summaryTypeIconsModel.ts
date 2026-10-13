import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import manifest from "../assets/codeinjection/summaryTypeIconsManifest.json";
import { recordGenericChange } from "./actionChangelog";
import { ensureFileSystemState, getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installPmcBytes,
  listCodeInjectionDlls, loadBundledPmcBytes, removeStagedCodeInjectionDll, stageCodeInjectionDll,
  type CodeInjectionDllInstallResult } from "./pmcModel";
import { parseRpm, type RpmModule } from "./rpm";
import type { ProjectState } from "./projectStore";

type Version = "B2" | "W2";
export const SUMMARY_TYPE_ICONS_VERSION = manifest.version;
const urls = { B2: new URL("../assets/codeinjection/SummaryTypeIconsB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/SummaryTypeIconsW2.dll", import.meta.url) };
const archiveUrl = new URL("../assets/codeinjection/summaryTypeIcons.narc", import.meta.url);
const hex = (b: Uint8Array) => Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
function fingerprint(code: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const value of code) h = Math.imul(h ^ value, 0x1000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
function recognized(rpm: RpmModule, v: Version): boolean {
  const p = manifest.games[v];
  if (rpm.baseAddress !== 0 || rpm.bssSize !== p.bssSize || rpm.metadata.PMCGameID !== v
    || rpm.metadata.PMCVersion !== manifest.version || rpm.metadata.PMCModulePriority !== 4
    || rpm.symbols.some(s => s.attributes & 2) || fingerprint(rpm.code) !== p.codeFingerprint) return false;
  const actual = rpm.relocations.filter(r => r.target.module !== "base").map(r => {
    const size = r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size : 4;
    return `${r.target.module}:${r.target.address}:${r.target.type}:${size}`;
  }).sort();
  const expected = p.signatures.filter(s => s.patchSize).map(s =>
    `${s.module}:${s.address}:${s.patchSize === 40 || s.label === "Summary VBlank thunk" ? "FULL_COPY" : "THUMB_BRANCH_LINK"}:${s.patchSize}`).sort();
  return actual.join("|") === expected.join("|");
}
function bytesAt(project: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(p => p.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const id = rom?.filenames.idOf(path);
  return id !== undefined ? getRomFileBytes(project, rom!, id) : undefined;
}
export type SummaryTypeIconsStatus = { supported: boolean; compatible: boolean; installed: boolean;
  canUninstall: boolean; dllPath?: string; message: string };
export function getSummaryTypeIconsStatus(project: ProjectState): SummaryTypeIconsStatus {
  const state: SummaryTypeIconsStatus = { supported: false, compatible: false, installed: false, canUninstall: false,
    message: "Summary Type Icons supports English US Black 2 and White 2, revision 0." };
  const v = project.session.baseVersion;
  if ((v !== "B2" && v !== "W2") || project.session.baseRom !== "BW2") return state;
  let rom: NintendoDSRom | undefined;
  try { if (project.originalRomBytes) rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); }
  catch { return { ...state, message: "Reload the ROM to check Summary compatibility." }; }
  const profile = manifest.games[v];
  if ((rom?.idCode ?? project.romInfo.idCode) !== profile.idCode || rom && rom.data[0x1e] !== 0) return state;
  state.supported = true;
  const found: string[] = [];
  for (const entry of listCodeInjectionDlls(project)) {
    let rpm: RpmModule | undefined;
    try { const data = bytesAt(project, rom, entry.path); if (data) rpm = parseRpm(data, { allowedMagics: ["DLXF"] }); } catch { /* Reserved names fail closed below. */ }
    if (entry.target === "patches" && rpm && recognized(rpm, v)) found.push(entry.path);
    else {
      const overlap = rpm?.relocations.some(({ target, sourceSymbolIndex }) => {
        const size = target.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0
          : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : 4;
        return profile.signatures.some(s => target.module === s.module && target.address < s.address + s.expectedHex.length / 2
          && target.address + size > s.address);
      });
      if (overlap || /^SummaryTypeIcons[WB]2\.dll$/iu.test(entry.fileName)) return { ...state,
        message: `Conflicting Summary code in ${entry.path}. Remove or update that module before installing these icons.` };
    }
  }
  if (found.length > 1) return { ...state, installed: true, message: "Multiple Summary Type Icons modules are present." };
  state.installed = found.length === 1; state.dllPath = found[0];
  state.canUninstall = Boolean(state.dllPath && canRemoveStagedCodeInjectionDll(project, state.dllPath));
  const art = bytesAt(project, rom, manifest.archivePath);
  if (art && sha256Hex(art) !== manifest.archiveSha256) return { ...state,
    message: "The Summary Type Icons resource path contains unrecognized artwork. Restore or move that file before installing." };
  if (!rom) return { ...state, message: "Reload the ROM to verify Summary hooks before installing." };
  try {
    const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
      (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([207])).get(207);
    const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
    for (const s of profile.signatures) {
      const base = s.module === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress;
      const candidates = s.module === "ARM9" ? [arm9] : [overlay?.data, project.overlays[207] ?? overlay?.data];
      const at = base === undefined ? -1 : s.address - base;
      if (candidates.some(b => !b || at < 0 || hex(b.subarray(at, at + s.expectedHex.length / 2)) !== s.expectedHex))
        return { ...state, message: `Unrecognized Summary code at 0x${s.address.toString(16)} (${s.module}).` };
    }
  } catch { return { ...state, message: "The Summary overlay could not be read." }; }
  state.compatible = true;
  state.message = state.installed && !art ? "Summary Type Icons artwork is missing. Reinstall the patch."
    : state.installed ? "Summary Type Icons installed on the information page only; Type row first."
    : "Decorated badges use native type colors on the information page only. Other screens retain their original icons.";
  return state;
}
async function bundled(url: URL, expected: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load Summary Type Icons (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256Hex(bytes) !== expected) throw new Error("Bundled Summary Type Icons failed its integrity check.");
  return bytes;
}
export async function installSummaryTypeIcons(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  const romBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!romBytes) throw new Error("Reload the ROM before installing Summary Type Icons.");
  const input = { ...project, originalRomBytes: romBytes }, status = getSummaryTypeIconsStatus(input);
  if (!status.compatible) throw new Error(status.message);
  const v = project.session.baseVersion as Version;
  const dll = await bundled(urls[v], manifest.games[v].sha256);
  if (!recognized(parseRpm(dll, { allowedMagics: ["DLXF"] }), v)) throw new Error("Invalid Summary Type Icons module.");
  const archive = await bundled(archiveUrl, manifest.archiveSha256);
  const staged: ProjectState = { ...input, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, bytes]) => [id, bytes?.slice()])),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  adoptExistingPmcInstall(staged, romBytes);
  if (!getPmcInstallStatus(staged).installed) installPmcBytes(staged, await loadBundledPmcBytes(v), romBytes);
  const rom = new NintendoDSRom(romBytes, { fileData: "view" }), fs = ensureFileSystemState(staged);
  const id = rom.filenames.idOf(manifest.archivePath);
  if (id === undefined) fs.additions![manifest.archivePath] = archive;
  else fs.replacements[id] = archive;
  const result = stageCodeInjectionDll(staged, status.dllPath?.split("/").pop() ?? manifest.games[v].fileName, dll, "patches", romBytes);
  recordGenericChange(staged, "code_injection", "Summary Type Icons installed with native colors and the Type row first.",
    "Summary Type Icons", { key: "code-injection:summary-type-icons" });
  Object.assign(project, { originalRomBytes: romBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, fileSystem: staged.fileSystem, codeInjection: staged.codeInjection,
    patches: staged.patches, actionChangelog: staged.actionChangelog });
  return result;
}
export function uninstallSummaryTypeIcons(project: ProjectState): void {
  const state = getSummaryTypeIconsStatus(project);
  if (!state.canUninstall || !state.dllPath) throw new Error("Only a Summary Type Icons module staged in this project can be removed.");
  removeStagedCodeInjectionDll(project, state.dllPath);
  // Keep any imported archive; remove only this install's known staged addition.
  const art = project.fileSystem?.additions?.[manifest.archivePath];
  if (art && sha256Hex(art) === manifest.archiveSha256) delete project.fileSystem!.additions![manifest.archivePath];
  recordGenericChange(project, "code_injection", "Staged Summary Type Icons removed.", "Summary Type Icons",
    { key: "code-injection:summary-type-icons" });
}
