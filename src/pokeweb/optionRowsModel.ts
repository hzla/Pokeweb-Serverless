import manifest from "../assets/codeinjection/optionRowsManifest.json";
import { loadOverlayTable } from "../nds/code";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { canRemoveStagedCodeInjectionDll, listCodeInjectionDlls, removeStagedCodeInjectionDll, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";
import { decodeGen5TextBank, encodeGen5TextBank } from "./text";

/**
 * Shared extra rows for the retail Options screen.
 *
 * PokewebOptionRows{B,W,B2,W2}.dll owns the seven Options call sites and draws
 * up to two On/Off rows below the native five. Each row stores "Off" in one
 * reserved CONFIG bit. Its row table ("PWOR") is written here, from what is
 * installed: Following Pokemon (Black 2 / White 2) and Autorun.
 *
 * Following Pokemon ships its own single-row Options module on the same call
 * sites. When both features are installed, that module is replaced by the
 * Following package's inert stub and its row moves into this module, so the
 * two never hook the same code. See runtime/option-rows/README.md.
 */

export type OptionRowId = "following" | "autorun";
export type OptionRowsVersion = keyof typeof manifest.games;

const ROW_ORDER: readonly OptionRowId[] = ["following", "autorun"];
const ROW_SETTINGS: Record<OptionRowId, { bit: number; gate: number }> = {
  following: { bit: 11, gate: 1 },
  autorun: { bit: 12, gate: 0 },
};
const DLL_URLS: Record<OptionRowsVersion, URL> = {
  B: new URL("../assets/codeinjection/PokewebOptionRowsB.dll", import.meta.url),
  W: new URL("../assets/codeinjection/PokewebOptionRowsW.dll", import.meta.url),
  B2: new URL("../assets/codeinjection/PokewebOptionRowsB2.dll", import.meta.url),
  W2: new URL("../assets/codeinjection/PokewebOptionRowsW2.dll", import.meta.url),
};
const TABLE_MAGIC = [0x50, 0x57, 0x4f, 0x52]; // "PWOR"
const TABLE_ROW_BYTES = 12;
const MAX_ROWS = 2;

export const OPTIONS_TEXT_PATH = "a/0/0/2";
/** Retail blank text of the reserved Options entries Autorun uses. */
const AUTORUN_TEXT_IDS = [manifest.textIds.autorun.label, manifest.textIds.autorun.help] as const;
const AUTORUN_TEXT = ["AUTORUN", "With the Running Shoes, you run without\\nholding B. Hold B to walk."] as const;
const RETAIL_BLANKS: Record<"BW" | "BW2", Record<number, string>> = {
  BW: { 19: "", 29: "" },
  BW2: { 19: "    ", 29: " ".repeat(23) },
};

export function optionRowsVersion(project: ProjectState): OptionRowsVersion | undefined {
  const version = project.session.baseVersion;
  return version === "B" || version === "W" || version === "B2" || version === "W2" ? version : undefined;
}

export function optionRowsDllPath(version: OptionRowsVersion): string {
  return `patches/${manifest.games[version].fileName}`;
}

/** Following Pokemon's own Options module (stock White 2, White2Upgrade and Black 2 profiles). */
export function followingOptionsDllPath(version: OptionRowsVersion): string | undefined {
  return version === "B2" ? "patches/PokewebFollowingOptionsB2.dll" : version === "W2" ? "patches/PokewebFollowingOptionsW2.dll" : undefined;
}

export function isOptionRowsModulePath(path: string): boolean {
  return /^patches\/PokewebOptionRows(?:B|W|B2|W2)\.dll$/iu.test(path);
}

/** The Following package's removed-module stub for its Options slot (priority 3). */
export function followingOptionsStub(version: "B2" | "W2"): Uint8Array {
  return writeRpm({
    code: Uint8Array.of(0x70, 0x47, 0, 0), bssSize: 0, baseAddress: 0, symbols: [], relocations: [],
    metadata: { PMCGameID: version, PMCVersion: "following-removed", PMCModulePriority: 3 },
  }, { ident: "DLXF" });
}

export type OptionRowsState = {
  supported: boolean;
  installed: boolean;
  rows: OptionRowId[];
  /** Following Pokemon's own Options module is active (not delegated to this module). */
  followingModuleActive: boolean;
};

export function readOptionRowsState(project: ProjectState): OptionRowsState {
  const version = optionRowsVersion(project);
  const rom = openRom(project);
  if (!version || !rom) return { supported: !!version, installed: false, rows: [], followingModuleActive: false };
  const bytes = moduleBytes(project, rom, optionRowsDllPath(version));
  const rows = bytes ? readTable(bytes) : [];
  const followingPath = followingOptionsDllPath(version);
  const following = followingPath ? moduleBytes(project, rom, followingPath) : undefined;
  return { supported: true, installed: !!bytes, rows, followingModuleActive: !!following && hasHooks(following) };
}

/** True when Following's Options slot holds the stub because its row lives in the shared module. */
export function followingOptionsDelegated(project: ProjectState): boolean {
  const state = readOptionRowsState(project);
  return state.rows.includes("following") && !state.followingModuleActive;
}

/** Throws unless every Options call site still holds the retail call. */
export function assertOptionRowsCompatible(project: ProjectState): void {
  const version = optionRowsVersion(project);
  if (!version) throw new Error("Options rows support US Black, White, Black 2 and White 2.");
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM before changing the Options screen.");
  const profile = manifest.games[version];
  if (rom.idCode !== profile.idCode) throw new Error(`The loaded ROM is ${rom.idCode}, not the supported ${profile.idCode}.`);
  const overlay = loadOverlayTable(project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable, (_id, file) => getRomFileBytes(project, rom, file), new Set([profile.optionsOverlay])).get(profile.optionsOverlay);
  if (!overlay) throw new Error(`Options overlay ${profile.optionsOverlay} is missing.`);
  for (const buffer of [overlay.data, project.overlays[profile.optionsOverlay] ?? overlay.data]) {
    for (const [name, hook] of Object.entries(profile.hooks)) {
      const offset = Number.parseInt(hook.address, 16) - overlay.ramAddress;
      if (hex(buffer.subarray(offset, offset + 4)) !== hook.bytes) throw new Error(`The Options ${name} call at ${hook.address} has been changed by another patch.`);
    }
  }
  const sites = Object.values(profile.hooks).map((hook) => Number.parseInt(hook.address, 16));
  const followingPath = followingOptionsDllPath(version)?.toLowerCase();
  for (const entry of listCodeInjectionDlls(project)) {
    const path = entry.path.toLowerCase();
    if (isOptionRowsModulePath(entry.path) || path === followingPath) continue;
    const bytes = moduleBytes(project, rom, entry.path);
    const rpm = bytes ? readRpm(bytes) : undefined;
    if (rpm?.relocations.some(({ target }) => target.module === String(profile.optionsOverlay) && sites.some((site) => (target.address & ~1) < site + 4 && (target.address & ~1) + 4 > site))) {
      throw new Error(`${entry.fileName} already changes the Options screen.`);
    }
  }
}

/**
 * Make the shared module match the rows that should exist. Unspecified rows
 * keep their current state; Following's row also counts as present while its
 * own Options module is active. Runs inside an installer's staged project.
 */
export async function reconcileOptionRows(project: ProjectState, want: Partial<Record<OptionRowId, boolean>>, options: { dllOverride?: Uint8Array } = {}): Promise<OptionRowId[]> {
  const version = optionRowsVersion(project);
  if (!version) return [];
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM before changing the Options screen.");
  const state = readOptionRowsState(project);
  const present = (id: OptionRowId) => want[id] ?? (id === "following" ? state.followingModuleActive || state.rows.includes(id) : state.rows.includes(id));
  const rows = ROW_ORDER.filter((id) => present(id) && (id !== "following" || followingOptionsDllPath(version)));
  const path = optionRowsDllPath(version);
  const followingPath = followingOptionsDllPath(version);
  const sharedNeeded = rows.includes("autorun") || (rows.includes("following") && !state.followingModuleActive);
  if (!sharedNeeded) {
    if (state.installed) {
      if (canRemoveStagedCodeInjectionDll(project, path)) removeStagedCodeInjectionDll(project, path);
      else stageCodeInjectionDll(project, manifest.games[version].fileName, configureOptionRowsDll(await loadBundledDll(version, options.dllOverride), []), "patches", project.originalRomBytes);
    }
    return rows.includes("following") ? ["following"] : [];
  }
  assertOptionRowsCompatible(project);
  if (rows.includes("following") && state.followingModuleActive && followingPath && (version === "B2" || version === "W2")) {
    stageCodeInjectionDll(project, followingPath.slice("patches/".length), followingOptionsStub(version), "patches", project.originalRomBytes);
  }
  const bytes = configureOptionRowsDll(await loadBundledDll(version, options.dllOverride), rows);
  stageCodeInjectionDll(project, manifest.games[version].fileName, bytes, "patches", project.originalRomBytes);
  return rows;
}

/** Write the row table into a copy of the module. */
export function configureOptionRowsDll(bytes: Uint8Array, rows: readonly OptionRowId[]): Uint8Array {
  if (rows.length > MAX_ROWS) throw new Error("The Options screen has room for two extra rows.");
  const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
  const at = tableOffset(rpm.code);
  const code = rpm.code.slice();
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  view.setUint32(at + 8, rows.length, true);
  for (let i = 0; i < MAX_ROWS; i++) {
    const base = at + 12 + i * TABLE_ROW_BYTES;
    const id = rows[i];
    const text = id ? manifest.textIds[id] : undefined;
    const values = id && text ? [ROW_SETTINGS[id].bit, ROW_SETTINGS[id].gate, text.label, text.on, text.off, text.help] : [0, 0, 0, 0, 0, 0];
    values.forEach((value, index) => view.setUint16(base + index * 2, value, true));
  }
  return writeRpm({ ...rpm, code }, { ident: "DLXF" });
}

export function readTable(bytes: Uint8Array): OptionRowId[] {
  const rpm = readRpm(bytes);
  if (!rpm) return [];
  let at: number;
  try { at = tableOffset(rpm.code); } catch { return []; }
  const view = new DataView(rpm.code.buffer, rpm.code.byteOffset, rpm.code.byteLength);
  const count = Math.min(view.getUint32(at + 8, true), MAX_ROWS);
  const rows: OptionRowId[] = [];
  for (let i = 0; i < count; i++) {
    const bit = view.getUint16(at + 12 + i * TABLE_ROW_BYTES, true);
    const id = ROW_ORDER.find((row) => ROW_SETTINGS[row].bit === bit);
    if (id) rows.push(id);
  }
  return rows;
}

/** Write Autorun's label and help text into the reserved Options entries (or restore them). */
export function stageAutorunOptionsText(project: ProjectState, install: boolean): void {
  const rom = openRom(project);
  if (!rom) throw new Error("Reload the ROM before changing the Options text.");
  const member = project.session.baseRom === "BW" ? 29 : 32;
  const source = optionsTextSource(project, rom, member);
  if (!source) throw new Error("The Options text archive is missing.");
  const archive = new NARC(source);
  if (archive.files.length <= member) throw new Error("Options text archive is incomplete.");
  const entries = decodeGen5TextBank(archive.files[member]);
  const blanks = RETAIL_BLANKS[project.session.baseRom === "BW" ? "BW" : "BW2"];
  AUTORUN_TEXT_IDS.forEach((id, index) => {
    if (id >= entries.length) throw new Error("Reserved Options text entries are missing.");
    const current = entries[id][1];
    if (install) {
      if (current !== AUTORUN_TEXT[index] && current.trim()) throw new Error(`Reserved Options text entry ${id} is already in use.`);
      entries[id] = [entries[id][0], AUTORUN_TEXT[index], entries[id][2]];
    } else if (current === AUTORUN_TEXT[index]) {
      entries[id] = [entries[id][0], blanks[id] ?? "", entries[id][2]];
    }
  });
  archive.files[member] = encodeGen5TextBank(entries);
  const bytes = archive.save();
  stageFile(project, rom, OPTIONS_TEXT_PATH, bytes);
  const store = project.narcs.message_texts;
  if (store && store.sourcePath === OPTIONS_TEXT_PATH && store.container !== "file") {
    store.rawFiles = [...store.rawFiles];
    store.rawFiles[member] = archive.files[member];
    store.dirty = new Set([...store.dirty, member]);
    store.records.delete(member);
  }
}

export function autorunOptionsTextInstalled(project: ProjectState): boolean {
  const rom = openRom(project);
  if (!rom) return false;
  const member = project.session.baseRom === "BW" ? 29 : 32;
  const source = optionsTextSource(project, rom, member);
  if (!source) return false;
  try {
    const entries = decodeGen5TextBank(new NARC(source).files[member]);
    return AUTORUN_TEXT_IDS.every((id, index) => entries[id]?.[1] === AUTORUN_TEXT[index]);
  } catch {
    return false;
  }
}

function optionsTextSource(project: ProjectState, rom: NintendoDSRom, member: number): Uint8Array | undefined {
  const bytes = readFile(project, rom, OPTIONS_TEXT_PATH);
  if (!bytes) return undefined;
  const store = project.narcs.message_texts;
  if (!store || store.sourcePath !== OPTIONS_TEXT_PATH || store.container === "file" || !store.dirty.has(member) || !store.rawFiles[member]) return bytes;
  const archive = new NARC(bytes);
  archive.files[member] = store.rawFiles[member];
  return archive.save();
}

function tableOffset(code: Uint8Array): number {
  let found = -1;
  for (let i = 0; i + 4 <= code.length; i += 4) {
    if (TABLE_MAGIC.every((byte, index) => code[i + index] === byte)) {
      if (found >= 0) throw new Error("The Options rows module has more than one row table.");
      found = i;
    }
  }
  if (found < 0 || found + 12 + MAX_ROWS * TABLE_ROW_BYTES > code.length) throw new Error("The Options rows module has no row table.");
  return found;
}

function hasHooks(bytes: Uint8Array): boolean {
  const rpm = readRpm(bytes);
  return !!rpm && rpm.relocations.some((relocation) => relocation.target.module !== "base");
}

async function loadBundledDll(version: OptionRowsVersion, override?: Uint8Array): Promise<Uint8Array> {
  if (override) return override;
  const response = await fetch(DLL_URLS[version]);
  if (!response.ok) throw new Error(`Could not load the bundled Options rows module (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== manifest.games[version].sha256) throw new Error("The bundled Options rows module failed its integrity check.");
  return bytes;
}

function openRom(project: ProjectState): NintendoDSRom | undefined {
  if (!project.originalRomBytes) return undefined;
  try { return new NintendoDSRom(project.originalRomBytes, { fileData: "view" }); } catch { return undefined; }
}

function readFile(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const added = Object.keys(project.fileSystem?.additions ?? {}).find((candidate) => candidate.toLowerCase() === path.toLowerCase());
  if (added) return project.fileSystem!.additions![added];
  const id = rom.filenames.idOf(path);
  if (id === undefined || project.fileSystem?.tombstones?.[id] === path) return undefined;
  return getRomFileBytes(project, rom, id);
}

function moduleBytes(project: ProjectState, rom: NintendoDSRom, path: string): Uint8Array | undefined {
  if (!listCodeInjectionDlls(project).some((entry) => entry.path.toLowerCase() === path.toLowerCase())) return undefined;
  return readFile(project, rom, path);
}

function stageFile(project: ProjectState, rom: NintendoDSRom, path: string, bytes: Uint8Array): void {
  const replacements = { ...project.fileSystem?.replacements }, additions = { ...project.fileSystem?.additions }, tombstones = { ...project.fileSystem?.tombstones };
  const id = rom.filenames.idOf(path);
  if (id === undefined) additions[path] = bytes;
  else { replacements[id] = bytes; delete additions[path]; delete tombstones[id]; }
  project.fileSystem = { ...project.fileSystem, replacements, additions, tombstones };
}

function readRpm(bytes: Uint8Array): RpmModule | undefined {
  try { return parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { return undefined; }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}
