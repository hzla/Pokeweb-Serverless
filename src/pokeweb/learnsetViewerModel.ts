import manifestData from "../assets/codeinjection/learnsetViewerManifest.json";
import infoMessages from "../../runtime/learnset-viewer/info_messages.json";
import { configureCustomUi, readCustomUiConfig } from "../customUi/runtimeConfig";
import { readU16, writeU16 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import { adoptExistingPmcInstall, canRemoveStagedCodeInjectionDll, getPmcInstallStatus, installBundledPmc, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, type RpmModule } from "./rpm";
import { addTextEntries, commitTextBank, getTextBank, parseTextEntryId } from "./textModel";

export const LEARNSET_VIEWER_VERSION = "1.5.0";
export const LEARNSET_INFO_MESSAGES = infoMessages;
const URLS = {
  W2: [new URL("../assets/codeinjection/LearnsetMenuW2.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerW2.dll", import.meta.url)],
  B2: [new URL("../assets/codeinjection/LearnsetMenuB2.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerB2.dll", import.meta.url)],
  B: [new URL("../assets/codeinjection/LearnsetMenuB.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerB.dll", import.meta.url)],
  W: [new URL("../assets/codeinjection/LearnsetMenuW.dll", import.meta.url), new URL("../assets/codeinjection/LearnsetViewerW.dll", import.meta.url)],
};
type Version = keyof typeof URLS;
type Group = "Menu" | "Viewer";
type ModuleBuild = { fileName: string; sha256: string; codeFingerprint: string; bssSize: number;
  symbols: Pick<RpmModule["symbols"][number], "address" | "type" | "attributes">[];
  relocations: { module: string; address: number; type: string; symbol: number }[] };
type Profile = {
  idCode: string; revision?: number; dsAccepted?: boolean; version?: string;
  partyOverlay?: number; dispatchOverlay?: number; tutorOverlay?: number; graphicsArchive?: string;
  menuBankId?: number; viewerBankId?: number;
  hooks: { label: string; overlayId: number; address: number; expectedHex: string; patchType: string; patchSize: number }[];
  apis?: { label?: string; reference?: string; entry: number; segment: string | number; expectedHex: string }[];
  resources: { archive?: string; member: number; sha256: string }[];
  modules?: Record<Group, ModuleBuild>; previousBuilds?: Record<string, Record<Group, ModuleBuild>>;
};
const manifest = manifestData as { version: string; games: Record<Version, Profile> };
const isVersion = (v: unknown): v is Version => v === "B" || v === "W" || v === "B2" || v === "W2";
const isBw1 = (v: Version) => v === "B" || v === "W";
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
function infoConfigOffset(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode("LSVINF1\0");
  const offsets: number[] = [];
  for (let i = 0; i + marker.length <= bytes.length; ++i) if (marker.every((v, j) => bytes[i + j] === v)) offsets.push(i);
  if (offsets.length !== 1) throw new Error("Learnset viewer must contain one info configuration marker.");
  const at = offsets[0]!;
  if (at + 12 + infoMessages.length * 4 > bytes.length || readU16(bytes, at + 8) !== 1 || readU16(bytes, at + 10) !== infoMessages.length) throw new Error("Unsupported Learnset info configuration.");
  return at;
}
export function configureLearnsetInfoDll(bytes: Uint8Array, ids: readonly number[]): Uint8Array {
  const at = infoConfigOffset(bytes), output = bytes.slice();
  if (ids.length !== infoMessages.length) throw new Error("Incorrect Learnset info message count.");
  ids.forEach((id, i) => {
    if (!Number.isInteger(id) || id < 0 || id >= 0xffff) throw new Error("Invalid Learnset info message ID.");
    writeU16(output, at + 12 + i * 4, id); writeU16(output, at + 14 + i * 4, id ^ 0xffff);
  });
  return output;
}
function validInfoConfiguration(bytes: Uint8Array): boolean {
  try {
    const at = infoConfigOffset(bytes);
    return infoMessages.every((_, i) => {
      const id = readU16(bytes, at + 12 + i * 4);
      return id !== 0xffff && (id ^ readU16(bytes, at + 14 + i * 4)) === 0xffff;
    });
  } catch { return false; }
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
function codeFingerprint(code: Uint8Array): string {
  const ranges: [number, number][] = [];
  const config = configOffset(code); ranges.push([config + 10, config + 22]);
  const customMarker = new TextEncoder().encode("PWUICFG1");
  const custom = Array.from({ length: Math.max(0, code.length - 19) }, (_, i) => i)
    .filter(i => customMarker.every((b, j) => code[i + j] === b));
  if (custom.length !== 1 || readU16(code, custom[0]! + 8) !== 1) throw new Error("Unrecognized shared UI configuration.");
  ranges.push([custom[0]! + 10, custom[0]! + 18]);
  const infoMarker = new TextEncoder().encode("LSVINF1\0");
  if (code.some((b, i) => b === infoMarker[0] && infoMarker.every((v, j) => code[i + j] === v))) {
    const info = infoConfigOffset(code); ranges.push([info + 12, info + 12 + infoMessages.length * 4]);
  }
  let value = 0x811c9dc5;
  for (let i = 0; i < code.length; ++i) value = Math.imul(value ^ (ranges.some(([start, end]) => i >= start && i < end) ? 0 : code[i]!), 0x1000193) >>> 0;
  return value.toString(16).padStart(8, "0");
}
function matchesBuild(rpm: RpmModule, build: ModuleBuild): boolean {
  try {
    return rpm.baseAddress === 0 && rpm.bssSize === build.bssSize && codeFingerprint(rpm.code) === build.codeFingerprint
      && rpm.symbols.length === build.symbols.length && build.symbols.every((s, i) => {
        const actual = rpm.symbols[i]!; return actual.address === s.address && actual.type === s.type && actual.attributes === s.attributes;
      }) && rpm.relocations.length === build.relocations.length && build.relocations.every(r => rpm.relocations.filter(a =>
        a.target.module === r.module && a.target.address === r.address && a.target.type === r.type && a.sourceSymbolIndex === r.symbol).length === 1);
  } catch { return false; }
}
function recognizedModule(rpm: RpmModule, version: Version, group: Group): boolean {
  const profile = manifest.games[version];
  const build = rpm.metadata.PMCVersion === profile.version ? profile.modules?.[group] : profile.previousBuilds?.[String(rpm.metadata.PMCVersion)]?.[group];
  return !!build && rpm.metadata.PMCGameID === version && rpm.metadata.PMCModulePriority === 4 && matchesBuild(rpm, build);
}
function validModule(rpm: RpmModule, version: Version, group: Group) {
  const profile = manifest.games[version];
  const overlays = group === "Menu" ? [profile.dispatchOverlay ?? 12, profile.partyOverlay ?? 165] : [profile.tutorOverlay ?? 258];
  const hooks = externalHooks(rpm);
  const expected = profile.hooks.filter(h => h.patchSize && overlays.includes(h.overlayId));
  return (!isBw1(version) || recognizedModule(rpm, version, group))
    && rpm.metadata.PMCGameID === version && rpm.metadata.PMCVersion === (profile.version ?? LEARNSET_VIEWER_VERSION)
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
  if (!isVersion(version) || project.session.baseRom !== (isBw1(version) ? "BW" : "BW2")) return status;
  const layout = manifest.games[version];
  let rom: NintendoDSRom | undefined;
  try { if (bytes) rom = new NintendoDSRom(bytes); } catch { return { ...status, message: "Reload the ROM to verify Learnset Viewer compatibility." }; }
  if ((rom?.idCode ?? project.romInfo.idCode) !== layout.idCode) return status;
  if (rom && rom.data[0x1e] !== (layout.revision ?? 0)) return { ...status, message: "Learnset Viewer requires English US revision 0." };
  if (isBw1(version) && (!manifest.games.B.dsAccepted || !manifest.games.W.dsAccepted)) return { ...status,
    message: "BW1 Learnset Viewer is awaiting DS gameplay and visual acceptance in Black and White." };
  status.supported = true;
  const paths = learnsetViewerPaths(version);
  const allModules = listCodeInjectionDlls(project);
  if (isBw1(version) && paths.some(path => allModules.filter(m => m.path.toLowerCase() === path.toLowerCase()).length > 1)) return { ...status,
    message: "Duplicate Learnset companions are installed. Remove the duplicate before installing." };
  const installed = allModules.filter(m => paths.includes(m.path));
  status.installed = installed.length === 2;
  const sharedMenu = moduleBytes(project, rom, paths[0]);
  if (sharedMenu && readCustomUiConfig(sharedMenu)?.learnsetEnabled === false) status.installed = false;
  status.partial = installed.length === 1;
  status.canUninstall = installed.length > 0 && installed.every(m => canRemoveStagedCodeInjectionDll(project, m.path));
  if (sharedMenu && readCustomUiConfig(sharedMenu)?.enabled) status.canUninstall = false;
  const pmc = getPmcInstallStatus(project);
  if (pmc.installed && pmc.overlayId !== (isBw1(version) ? 237 : 344)) return { ...status,
    message: "Unsupported PMC loader placement. Reload the original ROM and reinstall Learnset Viewer; updating the DLLs cannot repair this previously exported loader." };
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
      if (isBw1(version) && !recognizedModule(rpm, version, group)) return { ...status,
        message: `Unrecognized Learnset companion: ${module.path}. Restore its verified DLL before updating.` };
      const ids = readConfiguration(data);
      if (!validModule(rpm, version, group) || !ids || (group === "Viewer" && !validInfoConfiguration(data))) status.updateAvailable = true;
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
        (_id, fileId) => getRomFileBytes(project, rom!, fileId), new Set([layout.dispatchOverlay ?? 12, layout.partyOverlay ?? 165, layout.tutorOverlay ?? 258]));
      for (const signature of layout.hooks) {
        const overlay = overlays.get(signature.overlayId);
        const offset = overlay ? signature.address - overlay.ramAddress : -1;
        const data = project.overlays[signature.overlayId] ?? overlay?.data;
        if (!data || offset < 0 || hex(data.subarray(offset, offset + signature.expectedHex.length / 2)) !== signature.expectedHex) {
          return { ...status, message: `Learnset Viewer compatibility failed: ${signature.label}, overlay ${signature.overlayId}, 0x${signature.address.toString(16)}.` };
        }
      }
      const arm9 = project.arm9.length ? project.arm9 : decompressCode(rom.arm9);
      for (const signature of layout.apis ?? []) {
        const overlay = signature.segment === "ARM9" ? undefined : overlays.get(Number(signature.segment));
        const data = signature.segment === "ARM9" ? arm9 : project.overlays[Number(signature.segment)] ?? overlay?.data;
        const offset = (signature.entry & ~1) - (signature.segment === "ARM9" ? rom.arm9RamAddress : overlay?.ramAddress ?? 0);
        if (!data || offset < 0 || hex(data.subarray(offset, offset + signature.expectedHex.length / 2)) !== signature.expectedHex) return { ...status,
          message: `Learnset Viewer compatibility failed: native ${signature.label ?? signature.reference}, ${signature.segment}, 0x${signature.entry.toString(16)}.` };
      }
    } catch { return { ...status, message: "Could not read the party/tutor overlays for Learnset Viewer." }; }
  }
  status.compatible = true;
  status.message = status.partial ? "Only one companion is installed. Install to repair the pair before exporting."
    : status.updateAvailable ? "An update or configuration repair is available."
      : status.installed ? "LEARNSET is installed. Browse level-up moves, base stats, abilities, and evolution requirements without changing your Pokemon."
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
  const staged: ProjectState = { ...project, originalRomBytes: romBytes, arm9: project.arm9.slice(),
    overlays: Object.fromEntries(Object.entries(project.overlays).map(([id, data]) => [id, data?.slice()])),
    narcs: structuredClone(project.narcs), texts: structuredClone(project.texts),
    fileSystem: structuredClone(project.fileSystem), codeInjection: structuredClone(project.codeInjection),
    patches: structuredClone(project.patches), actionChangelog: structuredClone(project.actionChangelog) };
  const status = getLearnsetViewerStatus(staged, romBytes);
  if (!status.supported || !status.compatible) throw new Error(status.message);
  const version = project.session.baseVersion as Version;
  const profile = manifest.games[version];
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  const paths = learnsetViewerPaths(version);
  const priorMenu = moduleBytes(staged, rom, paths[0]);
  const priorViewer = moduleBytes(staged, rom, paths[1]);
  const custom = priorMenu && readCustomUiConfig(priorMenu);
  const archives = new Map<string, NARC>();
  for (const resource of profile.resources) {
    const path = resource.archive ?? profile.graphicsArchive ?? "a/1/2/5";
    if (!archives.has(path)) {
      const id = rom.filenames.idOf(path);
      if (id === undefined) throw new Error(`Learnset graphics archive ${path} is missing.`);
      archives.set(path, new NARC(getRomFileBytes(staged, rom, id)));
    }
    const data = archives.get(path)!.files[resource.member];
    if (!data || await sha256(data) !== resource.sha256) throw new Error(`Unsupported tutor graphics member ${resource.member}; the LEARNSET divider cannot be safely adjusted.`);
  }
  // Fetch and validate both before touching text, PMC, or staged files.
  const modules = await Promise.all(URLS[version].map(async (url, i) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load Learnset companion (${response.status}).`);
    const data = new Uint8Array(await response.arrayBuffer());
    const expectedHash = profile.modules?.[i === 0 ? "Menu" : "Viewer"].sha256;
    if (expectedHash && await sha256(data) !== expectedHash) throw new Error("The bundled Learnset companion failed its integrity check.");
    if (!validModule(parseRpm(data, { allowedMagics: ["DLXF"] }), version, i === 0 ? "Menu" : "Viewer")) throw new Error("The bundled Learnset companion failed verification.");
    configOffset(data);
    if (i === 1) infoConfigOffset(data);
    return data;
  }));
  const menuBank = profile.menuBankId ?? 178, viewerBank = profile.viewerBankId ?? 401;
  for (const bankId of [menuBank, viewerBank]) if (!getTextBank(staged, "message_texts", bankId).length) throw new Error(`Message bank ${bankId} is unavailable.`);
  if (!getPmcInstallStatus(staged).installed) {
    adoptExistingPmcInstall(staged, romBytes);
    if (!getPmcInstallStatus(staged).installed) await installBundledPmc(staged);
  }
  const hasId = (bank: number, id: number) => getTextBank(staged, "message_texts", bank).some(e => {
    const parsed = parseTextEntryId(e[0]); return parsed.block === 0 && parsed.entry === id;
  });
  const saved = staged.codeInjection?.learnsetViewer;
  const savedForProfile = saved?.menuBankId === menuBank && saved.viewerBankId === viewerBank ? saved : undefined;
  const oldIds = priorMenu && readConfiguration(priorMenu) || priorViewer && readConfiguration(priorViewer) || savedForProfile?.messageIds;
  const reuse = (id: number | undefined, bank: number, value: string) => id !== undefined && hasId(bank, id) ? id : ensureMessage(staged, bank, value);
  const ids = { menu: reuse(oldIds?.menu, menuBank, "LEARNSET"), empty: reuse(oldIds?.empty, viewerBank, "No level-up moves."), error: reuse(oldIds?.error, viewerBank, "Learnset unavailable.") };
  let oldInfo: number[] | undefined = savedForProfile?.infoMessageIds;
  if (priorViewer && validInfoConfiguration(priorViewer)) {
    const at = infoConfigOffset(priorViewer); oldInfo = infoMessages.map((_, i) => readU16(priorViewer, at + 12 + i * 4));
  }
  const infoMessageIds = infoMessages.map(([, text], i) => reuse(oldInfo?.[i], viewerBank, text!));
  paths.forEach((path, i) => {
    let configured = configureLearnsetViewerDll(modules[i]!, ids);
    if (custom?.enabled && custom.validMenu) configured = configureCustomUi(configured, true, custom.menu, true);
    stageCodeInjectionDll(staged, path.split("/").pop()!, i === 1 ? configureLearnsetInfoDll(configured, infoMessageIds) : configured, "patches", romBytes);
  });
  staged.codeInjection ??= {};
  staged.codeInjection.learnsetViewer = { runtimeVersion: profile.version ?? LEARNSET_VIEWER_VERSION, menuBankId: menuBank, viewerBankId: viewerBank, messageIds: ids, infoMessageIds };
  recordGenericChange(staged, "code_injection", "Learnset Viewer installed: level-up list, base stats, abilities, and evolution information; read-only, no KO learnset moves.", "Learnset Viewer", { key: "code-injection:learnset-viewer" });
  Object.assign(project, { originalRomBytes: romBytes, arm9: staged.arm9, arm9Dirty: staged.arm9Dirty,
    overlays: staged.overlays, narcs: staged.narcs, texts: staged.texts, fileSystem: staged.fileSystem,
    codeInjection: staged.codeInjection, patches: staged.patches, actionChangelog: staged.actionChangelog });
  return ids;
}
export function uninstallLearnsetViewer(project: ProjectState): void {
  if (project.customUi?.installation?.enabled) throw new Error("Custom UI shares these runtime modules. Disable Custom UI before removing the shared runtime.");
  const status = getLearnsetViewerStatus(project);
  if (!status.canUninstall) throw new Error("Only staged Learnset companions can be removed. DLLs built into the loaded ROM cannot yet be deleted.");
  const paths = learnsetViewerPaths(project.session.baseVersion as Version);
  for (const path of paths) if (canRemoveStagedCodeInjectionDll(project, path)) removeStagedCodeInjectionDll(project, path);
  // Retain private ID assignments alongside retained text so reinstall also
  // preserves user-edited messages that no longer match the default strings.
  recordGenericChange(project, "code_injection", "Staged Learnset companions removed; private text entries retained for reinstall.", "Learnset Viewer", { key: "code-injection:learnset-viewer" });
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256(bytes: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))); }
