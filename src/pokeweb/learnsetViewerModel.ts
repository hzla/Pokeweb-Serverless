import manifest from "../assets/codeinjection/learnsetViewerManifest.json";
import { readU16, writeU16 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

export const LEARNSET_VIEWER_VERSION = "1.0.3";
const URLS = {
  W2: [new URL("../assets/codeinjection/LearnsetMenuW2.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerW2.dll", import.meta.url)],
  B2: [new URL("../assets/codeinjection/LearnsetMenuB2.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerB2.dll", import.meta.url)],
};
type Version = keyof typeof URLS;
const MAGIC = [0x4c, 0x53, 0x56, 0x4d, 0x53, 0x47, 0x31, 0];
export type LearnsetMessageIds = { menu: number; empty: number; error: number };
export type LearnsetViewerStatus = {
  supported: boolean; compatible: boolean; checked: boolean; installed: boolean; partial: boolean;
  updateAvailable: boolean; canUninstall: boolean; pmcInstalled: boolean; message: string;
  messageIds?: LearnsetMessageIds;
};
export function learnsetViewerPaths(version: Version): string[] {
  return [`patches/LearnsetMenu${version}.dll`, `patches/LearnsetViewer${version}.dll`];
}
function configOffset(bytes: Uint8Array): number {
  const offsets: number[] = [];
  for (let i = 0; i + MAGIC.length <= bytes.length; ++i) if (MAGIC.every((byte, j) => bytes[i + j] === byte)) offsets.push(i);
  if (offsets.length !== 1) throw new Error("Learnset DLL must contain exactly one configuration marker.");
  const offset = offsets[0]!;
  if (offset + 24 > bytes.length || readU16(bytes, offset + 8) !== 1) throw new Error("Unsupported Learnset DLL configuration.");
  return offset;
}
export function configureLearnsetViewerDll(bytes: Uint8Array, ids: LearnsetMessageIds): Uint8Array {
  const offset = configOffset(bytes);
  const output = bytes.slice();
  for (const [i, value] of [ids.menu, ids.empty, ids.error].entries()) {
    if (!Number.isInteger(value) || value < 0 || value >= 0xffff) throw new Error("Invalid Learnset message ID.");
    writeU16(output, offset + 10 + i * 4, value);
    writeU16(output, offset + 12 + i * 4, value ^ 0xffff);
  }
  return output;
}
function readConfiguration(bytes: Uint8Array): LearnsetMessageIds | undefined {
  try {
    const offset = configOffset(bytes);
    const values = [0, 1, 2].map(i => readU16(bytes, offset + 10 + 4 * i));
    if (values.some((value, i) => value === 0xffff || (value ^ readU16(bytes, offset + 12 + 4 * i)) !== 0xffff)) return;
    return { menu: values[0]!, empty: values[1]!, error: values[2]! };
  } catch { return; }
}
function moduleBytes(project: ProjectState, rom: NintendoDSRom | undefined, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find(key => key.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const id = rom?.filenames.idOf(path);
  return rom && id !== undefined ? getRomFileBytes(project, rom, id) : undefined;
}
function externalHooks(rpm: RpmModule) { return rpm.relocations.filter(r => r.target.module !== "base"); }
function hookSize(rpm: RpmModule, r: RpmModule["relocations"][number]) {
  return r.target.type === "FULL_COPY" ? rpm.symbols[r.sourceSymbolIndex]?.size ?? 0
    : r.target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : r.target.type === "THUMB_BRANCH" ? 12 : 4;
}
function validModule(rpm: RpmModule, version: Version, group: "Menu" | "Viewer") {
  const overlays = group === "Menu" ? [12, 165] : [258];
  const hooks = externalHooks(rpm);
  const expected = manifest.games[version].hooks.filter(h => h.patchSize && overlays.includes(h.overlayId));
  return rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === LEARNSET_VIEWER_VERSION
    && rpm.metadata.PMCModulePriority === 4 && hooks.length === expected.length
    && !rpm.symbols.some(s => s.attributes & 2)
    && expected.every(h => hooks.filter(r => h.overlayId === Number(r.target.module) && h.address === r.target.address
      && h.patchType === r.target.type && h.patchSize === hookSize(rpm, r)).length === 1);
}
export function getLearnsetViewerStatus(project: ProjectState, bytes = project.originalRomBytes): LearnsetViewerStatus {
  const status: LearnsetViewerStatus = { supported: false, compatible: false, checked: false, installed: false, partial: false,
    updateAvailable: false, canUninstall: false, pmcInstalled: getPmcInstallStatus(project).installed,
    message: "Learnset Viewer supports US White 2 and Black 2 (vanilla or Upgrade)." };
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "W2" && version !== "B2")) return status;
  const layout = manifest.games[version];
  let rom: NintendoDSRom | undefined;
  try { if (bytes) rom = new NintendoDSRom(bytes); } catch { return { ...status, message: "Reload the ROM to verify Learnset Viewer compatibility." }; }
  if ((rom?.idCode ?? project.romInfo.idCode) !== layout.idCode) return status;
  status.supported = true;
  const paths = learnsetViewerPaths(version);
  const installed = listCodeInjectionDlls(project).filter(m => paths.includes(m.path));
  status.installed = installed.length === 2;
  status.partial = installed.length === 1;
  status.canUninstall = installed.length > 0 && installed.every(m => canRemoveStagedCodeInjectionDll(project, m.path));
  for (const module of listCodeInjectionDlls(project)) {
    if (module.target !== "patches") continue;
    const data = moduleBytes(project, rom, module.path);
    if (!data) continue;
    let rpm: RpmModule;
    try { rpm = parseRpm(data, { allowedMagics: ["DLXF"] }); } catch {
      if (paths.includes(module.path)) return { ...status, message: `Invalid Learnset module: ${module.path}.` };
      continue;
    }
    if (paths.includes(module.path)) {
      const group = module.path === paths[0] ? "Menu" : "Viewer";
      const ids = readConfiguration(data);
      if (!validModule(rpm, version, group) || !ids) status.updateAvailable = true;
      if (ids && status.messageIds && (ids.menu !== status.messageIds.menu || ids.empty !== status.messageIds.empty || ids.error !== status.messageIds.error)) status.updateAvailable = true;
      status.messageIds ??= ids;
      continue;
    }
    // Includes staged AND built-in patches; compare byte ranges, not names.
    if (externalHooks(rpm).some(r => layout.hooks.some(h => String(h.overlayId) === r.target.module
      && r.target.address < h.address + h.expectedHex.length / 2 && r.target.address + hookSize(rpm, r) > h.address))) {
      return { ...status, message: `Learnset Viewer conflicts with ${module.path}. Its tutor/party hook regions are already modified.` };
    }
  }
  if (rom) {
    status.checked = true;
    try {
      const overlays = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable,
        (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([12, 165, 258]));
      for (const signature of layout.hooks) {
        const overlay = overlays.get(signature.overlayId);
        const offset = overlay ? signature.address - overlay.ramAddress : -1;
        const data = project.overlays[signature.overlayId] ?? overlay?.data;
        if (!data || offset < 0 || hex(data.subarray(offset, offset + signature.expectedHex.length / 2)) !== signature.expectedHex) {
          return { ...status, message: `Learnset Viewer compatibility failed: ${signature.label}, overlay ${signature.overlayId}, 0x${signature.address.toString(16)}.` };
        }
      }
    } catch { return { ...status, message: "Could not read the party/tutor overlays for Learnset Viewer." }; }
  }
  status.compatible = true;
  status.message = status.partial ? "Only one companion is installed. Install to repair the pair before exporting."
    : status.updateAvailable ? "An update or configuration repair is available."
      : status.installed ? "LEARNSET is installed. Browse all level-up moves without teaching them."
        : "Adds a read-only LEARNSET command when the overworld party menu has room. PMC is the only dependency.";
  return status;
}
function ensureMessage(project: ProjectState, bankId: number, value: string): number {
  const bank = getTextBank(project, "message_texts", bankId);
  if (!bank.length) throw new Error(`Message bank ${bankId} is unavailable.`);
  const existing = bank.find(e => parseTextEntryId(e[0]).block === 0 && e[1] === value);
  if (existing) return parseTextEntryId(existing[0]).entry;
  const id = Math.max(...bank.map(e => parseTextEntryId(e[0]).entry)) + 1;
  if (id >= 0xffff) throw new Error(`Message bank ${bankId} is full.`);
  addTextEntries(project, "message_texts", bankId, 1);
  for (const entry of getTextBank(project, "message_texts", bankId)) if (parseTextEntryId(entry[0]).entry === id) entry[1] = value;
  commitTextBank(project, "message_texts", bankId);
  return id;
}
export async function installLearnsetViewer(project: ProjectState): Promise<LearnsetMessageIds> {
  const romBytes = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!romBytes) throw new Error("Reload the ROM before installing Learnset Viewer.");
  const status = getLearnsetViewerStatus(project, romBytes);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const rom = new NintendoDSRom(romBytes);
  const id = rom.filenames.idOf("a/1/2/5");
  if (id === undefined) throw new Error("Tutor graphics archive is missing.");
  const archive = new NARC(getRomFileBytes(project, rom, id));
  for (const resource of manifest.games[version].resources) {
    const data = archive.files[resource.member];
    if (!data || await sha256(data) !== resource.sha256) throw new Error(`Unsupported tutor graphics member ${resource.member}; the LEARNSET divider cannot be safely adjusted.`);
  }
  // Fetch and validate both before touching text, PMC, or staged files.
  const modules = await Promise.all(URLS[version].map(async (url, i) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load Learnset companion (${response.status}).`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (!validModule(parseRpm(data, { allowedMagics: ["DLXF"] }), version, i === 0 ? "Menu" : "Viewer")) throw new Error("The bundled Learnset companion failed verification.");
    configOffset(data);
    return data;
  }));
  for (const bankId of [178, 401]) if (!getTextBank(project, "message_texts", bankId).length) throw new Error(`Message bank ${bankId} is unavailable.`);
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  const ids = { menu: ensureMessage(project, 178, "LEARNSET"), empty: ensureMessage(project, 401, "No level-up moves."), error: ensureMessage(project, 401, "Learnset unavailable.") };
  learnsetViewerPaths(version).forEach((path, i) => stageCodeInjectionDll(project, path.split("/").pop()!, configureLearnsetViewerDll(modules[i]!, ids), "patches", romBytes));
  project.codeInjection ??= {};
  project.codeInjection.learnsetViewer = { runtimeVersion: LEARNSET_VIEWER_VERSION, menuBankId: 178, viewerBankId: 401, messageIds: ids };
  recordGenericChange(project, "code_injection", "Learnset Viewer installed: full level-up list, level-prefixed names, base max PP; no teaching or KO moves.", "Learnset Viewer", { key: "code-injection:learnset-viewer" });
  return ids;
}
export function uninstallLearnsetViewer(project: ProjectState): void {
  const status = getLearnsetViewerStatus(project);
  if (!status.canUninstall) throw new Error("Only staged Learnset companions can be removed. DLLs built into the loaded ROM cannot yet be deleted.");
  const paths = learnsetViewerPaths(project.session.baseVersion as Version);
  for (const path of paths) if (canRemoveStagedCodeInjectionDll(project, path)) removeStagedCodeInjectionDll(project, path);
  if (project.codeInjection) delete project.codeInjection.learnsetViewer;
  recordGenericChange(project, "code_injection", "Staged Learnset companions removed; private text entries retained for reinstall.", "Learnset Viewer", { key: "code-injection:learnset-viewer" });
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256(bytes: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))); }
