import { readAscii, readU32, writeU32 } from "../nds/binary";
import type { Folder } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";
import {
  cloneRpm,
  createCodeOnlyRpm,
  createSymbolOnlyRpm,
  findRpmSymbol,
  parseRpm,
  setRpmBaseAddress,
  updateRpmCodeImageForBase,
  writeRelocationDataByType,
  writeRpm,
  type RpmModule,
} from "./rpm";

export type PmcInstallStatus =
  | { installed: false; supported: boolean; message: string }
  | { installed: true; supported: boolean; overlayId: number; overlayBaseAddress?: number; version?: string; gameId?: string; message: string };

export type PmcInstallResult = {
  overlayId: number;
  overlayBaseAddress: number;
  version?: string;
  gameId?: string;
  symbolPath: string;
};

export type CodeInjectionDllTarget = "patches" | "lib";

export type CodeInjectionDllInstallResult = {
  path: string;
  fileName: string;
  target: CodeInjectionDllTarget;
  version?: string;
  gameId?: string;
};

export const PMC_OVERLAY_SIZE = 0x3000;
export const PMC_OVERLAY_RESERVED_SIZE = 0x8000;
export const PMC_OVERLAY_ID_PATH = "codeinjection/pmc_overlay.txt";
export const PMC_RPM_UID = "PMC.rpm";
export const PMC_PATCHES_KEEP_PATH = "patches/.pokeweb_keep";
export const PMC_SYMBOL_PATH = "codeinjection/RPMSYM-PMC.rpm";
export const WHITE2UPGRADE_DLL_FILENAMES = new Set(["white2upgrade.dll"]);

const PMC_B2_URL = new URL("../assets/codeinjection/PMC_B2.rpm", import.meta.url);
const PMC_W2_URL = new URL("../assets/codeinjection/PMC_W2.rpm", import.meta.url);
const DOUBLE_BATTLE_FIX_B2_URL = new URL("../assets/codeinjection/DoubleBattleFixB2.dll", import.meta.url);
const DOUBLE_BATTLE_FIX_W2_URL = new URL("../assets/codeinjection/DoubleBattleFixW2.dll", import.meta.url);
const MAIN_MENU_SKIP_B2_URL = new URL("../assets/codeinjection/MainMenuSkipB2.dll", import.meta.url);
const MAIN_MENU_SKIP_W2_URL = new URL("../assets/codeinjection/MainMenuSkipW2.dll", import.meta.url);

const DOUBLE_BATTLE_FIX_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "DoubleBattleFixB2.dll",
  W2: "DoubleBattleFixW2.dll",
};

const MAIN_MENU_SKIP_FILENAMES: Record<"B2" | "W2", string> = {
  B2: "MainMenuSkipB2.dll",
  W2: "MainMenuSkipW2.dll",
};

export async function installBundledPmc(project: ProjectState): Promise<PmcInstallResult> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before installing PMC.");
  const response = await fetch(project.session.baseVersion === "B2" ? PMC_B2_URL : PMC_W2_URL);
  if (!response.ok) throw new Error(`Could not load bundled PMC binary (${response.status})`);
  return installPmcBytes(project, new Uint8Array(await response.arrayBuffer()), romBytes);
}

export function installPmcBytes(project: ProjectState, rpmBytes: Uint8Array, romBytes: Uint8Array): PmcInstallResult {
  if (project.session.baseRom !== "BW2") throw new Error("Bundled PMC installation is only available for Black 2 / White 2 ROMs.");
  const rom = new NintendoDSRom(romBytes);
  const rpm = cloneRpm(parseRpm(rpmBytes));
  const gameId = stringMeta(rpm, "PMCGameID");
  const version = stringMeta(rpm, "PMCVersion");
  if (gameId && gameId !== project.session.baseVersion) throw new Error(`This PMC binary is for ${gameId}, but the loaded ROM is ${project.session.baseVersion}.`);

  const existingOverlayId = readPmcOverlayId(project, rom);
  const overlayId = existingOverlayId ?? rom.arm9OverlayTable.length / 32;
  const existingEntry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  const previousMaxOverlayEnd = maxOverlayEnd(rom.arm9OverlayTable);
  const activeArm9 = project.arm9.length > 0 ? project.arm9 : rom.arm9;
  const arm9ReservedEnd = align(rom.arm9RamAddress + activeArm9.length, 0x20);
  const overlayBaseAddress = existingEntry
    ? readU32(rom.arm9OverlayTable, existingEntry + 4)
    : Math.max(previousMaxOverlayEnd, arm9ReservedEnd);
  const heapStart = Math.max(previousMaxOverlayEnd, arm9ReservedEnd, overlayBaseAddress + PMC_OVERLAY_RESERVED_SIZE);
  const overlayPath = overlayPathForId(overlayId);

  const heapSymbol =
    findRpmSymbol(rpm, (symbol) => symbol.name === "FULL_COPY_ARM9_0x0207B41C_ResizeMemoryForOvl344") ??
    findRpmSymbol(rpm, (symbol) => Boolean(symbol.name?.endsWith("AdjustHeapStart")));
  if (!heapSymbol) throw new Error("Could not find PMC heap-start patch symbol.");
  writeU32(rpm.code, heapSymbol.address, heapStart);

  setRpmBaseAddress(rpm, overlayBaseAddress);
  updateRpmCodeImageForBase(rpm);
  rpm.metadata.SymbolFile = "RPMSYM-PMC.rpm";
  applyExternalRelocations(project, rom, rpm);

  const symbolRpm = createSymbolOnlyRpm(rpm);
  const codeRpm = createCodeOnlyRpm(rpm);
  const symbolBytes = writeRpm(symbolRpm);
  const codeBytes = writeRpm(codeRpm, { writeBss: true });
  const overlayBytes = buildPmcOverlay(overlayBaseAddress, codeBytes);

  stageRomPath(project, rom, PMC_OVERLAY_ID_PATH, asciiBytes(String(overlayId)));
  stageRomPath(project, rom, PMC_SYMBOL_PATH, symbolBytes);
  stageRomPath(project, rom, overlayPath, overlayBytes);
  stagePatchesKeepPath(project, rom);

  project.codeInjection ??= {};
  project.codeInjection.pmc = {
    overlayId,
    overlayBaseAddress,
    overlayPath,
    version,
    gameId,
    symbolPath: PMC_SYMBOL_PATH,
  };

  recordGenericChange(project, "code_injection", `PMC installed into overlay ${overlayId}${version ? ` (${version})` : ""}.`, "PMC", {
    key: "code-injection:pmc",
  });

  return { overlayId, overlayBaseAddress, version, gameId, symbolPath: PMC_SYMBOL_PATH };
}

export async function stageBundledDoubleBattleFixDll(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2") {
    throw new Error("The bundled single-NPC double battle fix currently requires the BW2 PMC runtime.");
  }
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled double battle fix is available for ${project.session.baseVersion}.`);
  }

  const url = project.session.baseVersion === "B2" ? DOUBLE_BATTLE_FIX_B2_URL : DOUBLE_BATTLE_FIX_W2_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled double battle fix (${response.status})`);

  const fileName = DOUBLE_BATTLE_FIX_FILENAMES[project.session.baseVersion];
  const result = stageCodeInjectionDll(project, fileName, new Uint8Array(await response.arrayBuffer()), "patches");
  recordGenericChange(project, "code_injection", `${fileName} staged for single-NPC double trainer battles.`, "Double Battle Fix", {
    key: "code-injection:double-battle-fix",
  });
  return result;
}

export async function stageBundledMainMenuSkipDll(project: ProjectState): Promise<CodeInjectionDllInstallResult> {
  if (project.session.baseRom !== "BW2") {
    throw new Error("The bundled main menu skip patch currently requires the BW2 PMC runtime.");
  }
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled main menu skip patch is available for ${project.session.baseVersion}.`);
  }

  const url = project.session.baseVersion === "B2" ? MAIN_MENU_SKIP_B2_URL : MAIN_MENU_SKIP_W2_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled main menu skip patch (${response.status})`);

  const fileName = MAIN_MENU_SKIP_FILENAMES[project.session.baseVersion];
  const result = stageCodeInjectionDll(project, fileName, new Uint8Array(await response.arrayBuffer()), "patches");
  recordGenericChange(project, "code_injection", `${fileName} staged for Test Battle startup skipping.`, "Main Menu Skip", {
    key: "code-injection:main-menu-skip",
  });
  return result;
}

export async function prepareBw2TestBattleCodeInjection(project: ProjectState): Promise<CodeInjectionDllInstallResult | undefined> {
  if (project.session.baseRom !== "BW2") return undefined;
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error(`No bundled main menu skip patch is available for ${project.session.baseVersion}.`);
  }
  if (detectWhite2UpgradeDlls(project)) return undefined;
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  return stageBundledMainMenuSkipDll(project);
}

export function getPmcInstallStatus(project: ProjectState): PmcInstallStatus {
  if (project.session.baseRom !== "BW2") {
    return { installed: false, supported: false, message: "PMC is only supported for Black 2 / White 2 projects." };
  }
  const stagedOverlayId = parseOverlayIdBytes(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH]);
  const state = project.codeInjection?.pmc;
  const overlayId = state?.overlayId ?? stagedOverlayId;
  if (overlayId === undefined) return { installed: false, supported: true, message: "PMC is not installed in this project." };
  return {
    installed: true,
    supported: true,
    overlayId,
    overlayBaseAddress: state?.overlayBaseAddress,
    version: state?.version,
    gameId: state?.gameId,
    message: `PMC is staged on overlay ${overlayId}.`,
  };
}

export function stageCodeInjectionDll(
  project: ProjectState,
  fileName: string,
  bytes: Uint8Array,
  target: CodeInjectionDllTarget = "patches",
): CodeInjectionDllInstallResult {
  const status = getPmcInstallStatus(project);
  if (!status.installed) throw new Error("Install PMC before adding patch DLLs.");
  const safeName = sanitizeDllFilename(fileName);
  validateCodeInjectionDll(bytes);

  let version: string | undefined;
  let gameId: string | undefined;
  try {
    const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    version = stringMeta(rpm, "PMCVersion");
    gameId = stringMeta(rpm, "PMCGameID");
    if (gameId && gameId !== project.session.baseVersion) {
      throw new Error(`This DLL is for ${gameId}, but the loaded ROM is ${project.session.baseVersion}.`);
    }
  } catch (error) {
    if (error instanceof Error && /This DLL is for/u.test(error.message)) throw error;
  }

  const path = `${target}/${safeName}`;
  const existingRomFileId = (() => {
    if (!project.originalRomBytes) return undefined;
    try {
      return new NintendoDSRom(project.originalRomBytes).filenames.idOf(path);
    } catch {
      return undefined;
    }
  })();
  if (existingRomFileId === undefined) addRomFile(project, path, bytes);
  else setRomFileReplacement(project, existingRomFileId, bytes);
  project.codeInjection ??= {};
  const modules = (project.codeInjection.modules ??= []);
  const index = modules.findIndex((module) => module.path === path);
  const entry = { path, target, fileName: safeName, version, gameId };
  if (index === -1) modules.push(entry);
  else modules[index] = entry;
  return entry;
}

export function listCodeInjectionDlls(project: ProjectState): NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> {
  const fromState = project.codeInjection?.modules ?? [];
  const seen = new Set<string>();
  const modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> = [];
  for (const module of fromState) {
    seen.add(module.path);
    modules.push(module);
  }
  for (const path of Object.keys(project.fileSystem?.additions ?? {}).sort((a, b) => a.localeCompare(b))) {
    addDllModuleFromPath(path, seen, modules);
  }
  if (project.originalRomBytes) {
    try {
      const rom = new NintendoDSRom(project.originalRomBytes);
      for (const module of detectCodeInjectionDllsFromRom(rom)) addDllModule(module, seen, modules);
    } catch {
      // Older saved projects may not include parseable ROM bytes; staged DLLs above still cover active edits.
    }
  }
  return modules;
}

export function detectWhite2UpgradeDlls(project: ProjectState): boolean {
  if (project.session.baseRom !== "BW2") return false;
  return listCodeInjectionDlls(project).some((module) => isWhite2UpgradeDllPath(module.path));
}

export function detectBundledDoubleBattleFixDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2") return "unsupported";
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  const fileName = DOUBLE_BATTLE_FIX_FILENAMES[project.session.baseVersion];
  const path = `patches/${fileName}`;
  return listCodeInjectionDlls(project).some((module) => module.path === path) ? "patched" : "unpatched";
}

export function detectBundledMainMenuSkipDll(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseRom !== "BW2") return "unsupported";
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  const fileName = MAIN_MENU_SKIP_FILENAMES[project.session.baseVersion];
  const path = `patches/${fileName}`;
  return listCodeInjectionDlls(project).some((module) => module.path === path) ? "patched" : "unpatched";
}

export function validateCodeInjectionDll(bytes: Uint8Array): void {
  const magic = bytes.length >= 4 ? readAscii(bytes, 0, 4) : "";
  if (magic !== "DLXF") {
    if (magic.startsWith("MZ")) throw new Error("This looks like a Windows DLL. Pokeweb needs a Gen V/libRPM DLL built for PMC.");
    if (magic === "RPM0") throw new Error("This is an RPM module, not an installed DLL. Convert it to a DLXF .dll with the RPM tooling first.");
    throw new Error("This file is not a Gen V/libRPM DLL. Expected DLXF magic.");
  }
}

export function detectPmcInstallFromRom(rom: NintendoDSRom): NonNullable<ProjectState["codeInjection"]> | undefined {
  const modules = detectCodeInjectionDllsFromRom(rom);
  const overlayId = parseOverlayIdBytes(getRomPathBytes(rom, PMC_OVERLAY_ID_PATH));
  if (overlayId === undefined) return modules.length > 0 ? { modules } : undefined;
  const entry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
  const symbolBytes = getRomPathBytes(rom, PMC_SYMBOL_PATH);
  let version: string | undefined;
  let gameId: string | undefined;
  if (symbolBytes) {
    try {
      const rpm = parseRpm(symbolBytes);
      version = stringMeta(rpm, "PMCVersion");
      gameId = stringMeta(rpm, "PMCGameID");
    } catch {
      // A hand-edited ROM may have a missing or older symbol RPM; the overlay marker is still useful status.
    }
  }
  return {
    pmc: {
      overlayId,
      overlayBaseAddress: entry === undefined ? undefined : readU32(rom.arm9OverlayTable, entry + 4),
      overlayPath: overlayPathForId(overlayId),
      symbolPath: PMC_SYMBOL_PATH,
      version,
      gameId,
    },
    modules: modules.length > 0 ? modules : undefined,
  };
}

export function buildCodeInjectionOverlayTable(
  project: ProjectState,
  rom: NintendoDSRom,
  baseTable: Uint8Array,
  resolveFileId?: (path: string) => number | undefined,
): Uint8Array | undefined {
  const pmc = project.codeInjection?.pmc;
  if (!pmc) return undefined;
  if (pmc.overlayBaseAddress === undefined) return undefined;
  const overlayBytes = project.fileSystem?.additions?.[pmc.overlayPath] ?? getRomPathBytes(rom, pmc.overlayPath);
  if (!overlayBytes) return undefined;
  const fileId = resolveFileId?.(pmc.overlayPath) ?? fileIdForPathWithAdditions(project, rom, pmc.overlayPath);
  const existingEntry = findOverlayEntry(baseTable, pmc.overlayId);
  const table = existingEntry === undefined ? appendOverlayEntry(baseTable) : baseTable.slice();
  const offset = existingEntry ?? table.length - 32;
  writeU32(table, offset, pmc.overlayId);
  writeU32(table, offset + 4, pmc.overlayBaseAddress);
  writeU32(table, offset + 8, PMC_OVERLAY_RESERVED_SIZE);
  writeU32(table, offset + 12, 0);
  writeU32(table, offset + 16, pmc.overlayBaseAddress);
  writeU32(table, offset + 20, pmc.overlayBaseAddress);
  writeU32(table, offset + 24, fileId);
  writeU32(table, offset + 28, 0);
  return table;
}

export function codeInjectionInsertedFiles(project: ProjectState, rom: NintendoDSRom): Array<{ fileId: number; path: string; bytes: Uint8Array }> {
  void project;
  void rom;
  // New overlay data must be appended, not inserted at overlayId. Inserting
  // before the named filesystem shifts baked archive file IDs used by battle
  // effects and corrupts otherwise untouched animations.
  return [];
}

function applyExternalRelocations(project: ProjectState, rom: NintendoDSRom, rpm: RpmModule): void {
  const arm9 = project.arm9.length > 0 ? project.arm9 : rom.arm9.slice();
  for (const relocation of rpm.relocations) {
    if (relocation.target.module === "base") continue;
    if (relocation.target.module === "ARM9") {
      writeRelocationDataByType(rpm, relocation, arm9, relocation.target.address & 0xfffffffe, rom.arm9RamAddress);
      continue;
    }
    const overlayId = Number(relocation.target.module);
    if (!Number.isInteger(overlayId)) throw new Error(`Unsupported PMC relocation target module: ${relocation.target.module}`);
    const entry = findOverlayEntry(rom.arm9OverlayTable, overlayId);
    const overlay = project.overlays[overlayId];
    if (entry === undefined || !overlay) throw new Error(`PMC relocation target overlay ${overlayId} is not loaded.`);
    writeRelocationDataByType(rpm, relocation, overlay, relocation.target.address & 0xfffffffe, readU32(rom.arm9OverlayTable, entry + 4));
  }
  project.arm9 = arm9;
  project.arm9Dirty = true;
}

function buildPmcOverlay(overlayBaseAddress: number, codeRpmBytes: Uint8Array): Uint8Array {
  const codeLength = align(codeRpmBytes.length, 0x10);
  const entrySize = PMC_RPM_UID.length + 1 + 12;
  const patchDataLength = 0x10 + entrySize + 8;
  const patchTableOffset = (PMC_OVERLAY_SIZE - patchDataLength) & ~0xf;
  if (codeLength > patchTableOffset) throw new Error(`Bundled PMC code RPM does not fit in the ${hex(PMC_OVERLAY_SIZE)} overlay.`);

  const overlay = new Uint8Array(PMC_OVERLAY_SIZE);
  overlay.set(codeRpmBytes, 0);
  let offset = patchTableOffset;
  writeU32(overlay, offset, 1);
  offset += 4;
  writeU32(overlay, offset, patchTableOffset + 8);
  offset += 4;
  overlay.set(asciiBytes(PMC_RPM_UID), offset);
  offset += PMC_RPM_UID.length;
  overlay[offset++] = 0;
  writeU32(overlay, offset, 0);
  writeU32(overlay, offset + 4, codeRpmBytes.length);
  writeU32(overlay, offset + 8, 0);

  const headerOffset = PMC_OVERLAY_SIZE - 0x10;
  overlay.set(asciiBytes("OVL0"), headerOffset);
  writeU32(overlay, headerOffset + 4, overlayBaseAddress);
  writeU32(overlay, headerOffset + 8, patchTableOffset);
  return overlay;
}

function stageRomPath(project: ProjectState, rom: NintendoDSRom, path: string, bytes: Uint8Array): void {
  const existingId = rom.filenames.idOf(path);
  if (existingId === undefined) addRomFile(project, path, bytes);
  else setRomFileReplacement(project, existingId, bytes);
}

function stagePatchesKeepPath(project: ProjectState, rom: NintendoDSRom): void {
  const bytes = asciiBytes("pokeweb");
  const existingId = rom.filenames.idOf(PMC_PATCHES_KEEP_PATH);
  if (existingId !== undefined) {
    setRomFileReplacement(project, existingId, bytes);
    return;
  }

  if (romFolderHasFiles(rom.filenames, "patches")) {
    delete project.fileSystem?.additions?.[PMC_PATCHES_KEEP_PATH];
    return;
  }

  addRomFile(project, PMC_PATCHES_KEEP_PATH, bytes);
}

export function pruneRedundantPatchesKeepAddition(project: ProjectState, rom: NintendoDSRom): void {
  const additions = project.fileSystem?.additions;
  if (!additions || !(PMC_PATCHES_KEEP_PATH in additions)) return;
  if (rom.filenames.idOf(PMC_PATCHES_KEEP_PATH) !== undefined || romFolderHasFiles(rom.filenames, "patches")) {
    delete additions[PMC_PATCHES_KEEP_PATH];
  }
}

function findRomFolder(root: Folder, path: string): Folder | undefined {
  let folder: Folder | undefined = root;
  for (const part of path.split("/").filter(Boolean)) {
    folder = folder?.folders.find(([name]) => name === part)?.[1];
    if (!folder) return undefined;
  }
  return folder;
}

function romFolderHasFiles(root: Folder, path: string): boolean {
  return (findRomFolder(root, path)?.files.length ?? 0) > 0;
}

function readPmcOverlayId(project: ProjectState, rom: NintendoDSRom): number | undefined {
  return project.codeInjection?.pmc?.overlayId ?? parseOverlayIdBytes(project.fileSystem?.additions?.[PMC_OVERLAY_ID_PATH]) ?? parseOverlayIdBytes(getRomPathBytes(rom, PMC_OVERLAY_ID_PATH));
}

function parseOverlayIdBytes(bytes: Uint8Array | undefined): number | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  const value = Number.parseInt(new TextDecoder().decode(bytes).trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getRomPathBytes(rom: NintendoDSRom, path: string): Uint8Array | undefined {
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : rom.files[fileId];
}

function fileIdForPathWithAdditions(project: ProjectState, rom: NintendoDSRom, path: string): number {
  const existingId = rom.filenames.idOf(path);
  if (existingId !== undefined) return existingId;
  const inserted = codeInjectionInsertedFiles(project, rom).find((file) => file.path === path);
  if (inserted) return inserted.fileId;
  const additions = Object.keys(project.fileSystem?.additions ?? {}).sort((a, b) => a.localeCompare(b));
  const index = additions.indexOf(path);
  if (index === -1) throw new Error(`ROM addition is missing: ${path}`);
  return rom.files.length + index;
}

function findOverlayEntry(table: Uint8Array, overlayId: number): number | undefined {
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    if (readU32(table, offset) === overlayId) return offset;
  }
  return undefined;
}

function maxOverlayEnd(table: Uint8Array): number {
  let max = 0;
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    const address = readU32(table, offset + 4);
    if ((address & 0xfff00000) > 0x02300000) continue;
    max = Math.max(max, address + readU32(table, offset + 8));
  }
  return align(max, 16);
}

function appendOverlayEntry(table: Uint8Array): Uint8Array {
  const out = new Uint8Array(table.length + 32);
  out.set(table);
  return out;
}

function overlayPathForId(overlayId: number): string {
  return `overlay/overlay_${String(overlayId).padStart(4, "0")}.bin`;
}

function addDllModuleFromPath(
  path: string,
  seen: Set<string>,
  modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>,
): void {
  const match = /^(patches|lib)\/(.+\.dll)$/iu.exec(path);
  if (!match || seen.has(path)) return;
  seen.add(path);
  modules.push({ path, target: match[1].toLowerCase() as CodeInjectionDllTarget, fileName: basename(match[2]) });
}

function addDllModule(
  module: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>[number],
  seen: Set<string>,
  modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]>,
): void {
  if (seen.has(module.path)) return;
  seen.add(module.path);
  modules.push(module);
}

function detectCodeInjectionDllsFromRom(rom: NintendoDSRom): NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> {
  const seen = new Set<string>();
  const modules: NonNullable<NonNullable<ProjectState["codeInjection"]>["modules"]> = [];
  for (const file of listNamedRomFiles(rom.filenames).sort((a, b) => a.path.localeCompare(b.path))) {
    const bytes = rom.files[file.id];
    if (!bytes || readAscii(bytes, 0, 4) !== "DLXF") continue;
    addDllModuleFromPath(file.path, seen, modules);
  }
  return modules;
}

function isWhite2UpgradeDllPath(path: string): boolean {
  const fileName = basename(path).toLowerCase();
  return WHITE2UPGRADE_DLL_FILENAMES.has(fileName) || /^w2u.*\.dll$/iu.test(fileName);
}

function listNamedRomFiles(root: Folder, parent = ""): Array<{ id: number; path: string }> {
  const files = root.files.map((name, index) => ({ id: root.firstId + index, path: parent ? `${parent}/${name}` : name }));
  for (const [name, folder] of root.folders) files.push(...listNamedRomFiles(folder, parent ? `${parent}/${name}` : name));
  return files;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function stringMeta(rpm: RpmModule, key: string): string | undefined {
  const value = rpm.metadata[key];
  return value === undefined ? undefined : String(value);
}

function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function sanitizeDllFilename(fileName: string): string {
  const baseName = fileName
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[^\w .-]/gu, "_")
    .replace(/^\.+/u, "") ?? "";
  const withName = baseName || "Patch.dll";
  return /\.dll$/iu.test(withName) ? withName : `${withName}.dll`;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}
