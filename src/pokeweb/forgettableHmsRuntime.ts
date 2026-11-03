import { readU16, readU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { installCodeInjectionPatch } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls, stageCodeInjectionDll } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import { parseRpm, writeRpm, type RpmModule } from "./rpm";

/**
 * Black 2 / White 2 Forgettable HMs, delivered as a PMC module.
 *
 * The ROM's ARM9 is left untouched. A generated DLXF module replaces
 * `PML_MoveIsHM` with `return false` at load time through a THUMB_BRANCH hook,
 * so the patch is removed by deleting the DLL. See runtime/forgettable-hms/.
 */

export type ForgettableHmsVersion = "B2" | "W2";

export const BW2_ARM9_RAM_BASE = 0x02004000;
export const FORGETTABLE_HMS_RUNTIME_VERSION = "1.0.0";
export const FORGETTABLE_HMS_MODULE_PRIORITY = 4;
/** `movs r0, #0; bx lr` */
export const FORGETTABLE_HMS_RETURN_FALSE = [0x00, 0x20, 0x70, 0x47] as const;
/** First instructions of the retail function: `ldr r2, =table; movs r3, #0`. */
const PML_MOVE_IS_HM_ENTRY = [0x08, 0x4a, 0x00, 0x23] as const;
const PML_MOVE_IS_HM_SIZE = 0x28;
const HM_COUNT = 6;

/**
 * `PML_MoveIsHM(u16 move)`: walk the six-entry HM table and return 1 on a hit.
 * Same code shape as Black / White. The table displacement (byte 8), the
 * alignment padding (34-35) and the table literal (36-38) are wildcards; the
 * literal's table is validated separately.
 */
const PML_MOVE_IS_HM_PATTERN: ReadonlyArray<number | null> = [
  0x08, 0x4a, 0x00, 0x23, 0x59, 0x00, 0x51, 0x18, null, 0x31, 0x09, 0x88, 0x88, 0x42, 0x01, 0xd1,
  0x01, 0x20, 0x70, 0x47, 0x59, 0x1c, 0x09, 0x06, 0x0b, 0x0e, 0x06, 0x2b, 0xf2, 0xd3, 0x00, 0x20,
  0x70, 0x47, null, null, null, null, null, 0x02,
];

export function forgettableHmsDllFileName(version: ForgettableHmsVersion): string {
  return `ForgettableHms${version}.dll`;
}

export function forgettableHmsDllPath(version: ForgettableHmsVersion): string {
  return `patches/${forgettableHmsDllFileName(version)}`;
}

export type Bw2MoveIsHmMatch = {
  /** RAM address of PML_MoveIsHM (even; Thumb bit not set). */
  address: number;
  /** ARM9 file offset. */
  offset: number;
  /** "inline" means ARM9 already starts with an early `return false` edit. */
  state: "original" | "inline";
  hmMoves: number[];
};

/** Locate the BW2 HM check by code shape. Returns undefined unless exactly one function matches. */
export function findBw2MoveIsHm(arm9: Uint8Array, arm9RamAddress = BW2_ARM9_RAM_BASE): Bw2MoveIsHmMatch | undefined {
  const matches: Bw2MoveIsHmMatch[] = [];
  const startAlign = (4 - (arm9RamAddress & 3)) & 3;
  for (let offset = startAlign; offset + PML_MOVE_IS_HM_SIZE <= arm9.length; offset += 4) {
    const state = matchState(arm9, offset);
    if (!state) continue;
    const hmMoves = readHmTable(arm9, offset, arm9RamAddress);
    if (!hmMoves) continue;
    matches.push({ address: arm9RamAddress + offset, offset, state, hmMoves });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Undo an inline early-return edit so only the PMC hook alters PML_MoveIsHM. */
export function restoreInlineForgettableHmsEdit(arm9: Uint8Array, match: Bw2MoveIsHmMatch): Uint8Array {
  if (match.state !== "inline") return arm9;
  const restored = arm9.slice();
  restored.set(PML_MOVE_IS_HM_ENTRY, match.offset);
  return restored;
}

export function buildForgettableHmsDll(gameId: string, moveIsHmAddress: number): Uint8Array {
  if ((moveIsHmAddress & 3) !== 0) throw new Error("PML_MoveIsHM must be word aligned.");
  const rpm: RpmModule = {
    code: Uint8Array.from(FORGETTABLE_HMS_RETURN_FALSE),
    bssSize: 0,
    baseAddress: 0,
    symbols: [{ name: null, size: FORGETTABLE_HMS_RETURN_FALSE.length, address: 0, type: "FUNCTION_THM", attributes: 0 }],
    relocations: [{ target: { module: "ARM9", address: (moveIsHmAddress | 1) >>> 0, type: "THUMB_BRANCH" }, sourceSymbolIndex: 0 }],
    metadata: { PMCGameID: gameId, PMCModulePriority: FORGETTABLE_HMS_MODULE_PRIORITY, PMCVersion: FORGETTABLE_HMS_RUNTIME_VERSION },
  };
  return writeRpm(rpm, { ident: "DLXF" });
}

/** Return the hooked PML_MoveIsHM address when the bytes are this runtime. */
export function readForgettableHmsDll(bytes: Uint8Array): { gameId: string; moveIsHmAddress: number } | undefined {
  let rpm: RpmModule;
  try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { return undefined; }
  const relocation = rpm.relocations.length === 1 ? rpm.relocations[0]! : undefined;
  const symbol = relocation && rpm.symbols[relocation.sourceSymbolIndex];
  if (!relocation || !symbol || relocation.target.module !== "ARM9" || relocation.target.type !== "THUMB_BRANCH") return undefined;
  if (symbol.type !== "FUNCTION_THM" || symbol.address !== 0 || rpm.bssSize !== 0) return undefined;
  if (rpm.code.length !== FORGETTABLE_HMS_RETURN_FALSE.length || FORGETTABLE_HMS_RETURN_FALSE.some((byte, i) => rpm.code[i] !== byte)) return undefined;
  if (typeof rpm.metadata.PMCGameID !== "string") return undefined;
  return { gameId: rpm.metadata.PMCGameID, moveIsHmAddress: (relocation.target.address & ~1) >>> 0 };
}

export function pmcGameIdFor(version: ForgettableHmsVersion, romIdCode: string | undefined): string {
  return romIdCode === "IRDI" ? "W2I" : version;
}

/** True when the staged or ROM-resident runtime DLL is present and recognized. */
export function hasForgettableHmsDll(project: ProjectState, version: ForgettableHmsVersion): boolean {
  const path = forgettableHmsDllPath(version).toLowerCase();
  const module = listCodeInjectionDlls(project).find((entry) => entry.path.toLowerCase() === path);
  if (!module) return false;
  const bytes = codeInjectionModuleBytes(project, module.path);
  // A listed module without readable bytes (an older saved project) is trusted by path.
  return bytes === undefined || readForgettableHmsDll(bytes) !== undefined;
}

/** Name another installed DLL that already patches PML_MoveIsHM, if any. */
export function findForgettableHmsConflict(project: ProjectState, version: ForgettableHmsVersion, moveIsHmAddress: number): string | undefined {
  const ownPath = forgettableHmsDllPath(version).toLowerCase();
  const end = moveIsHmAddress + PML_MOVE_IS_HM_SIZE;
  for (const module of listCodeInjectionDlls(project)) {
    if (module.path.toLowerCase() === ownPath) continue;
    const bytes = codeInjectionModuleBytes(project, module.path);
    if (!bytes) continue;
    let rpm: RpmModule;
    try { rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] }); } catch { continue; }
    const overlaps = rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      if (target.module !== "ARM9" && target.module !== "0") return false;
      const start = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 8 : 4;
      return start < end && start + size > moveIsHmAddress;
    });
    if (overlaps) return module.fileName;
  }
  return undefined;
}

export type ForgettableHmsPmcState = "patched" | "unpatched" | "legacy" | "unsupported" | "unknown";

export type ForgettableHmsInstallResult = {
  status: "applied" | "already-applied";
  summary: string;
  moveIsHmAddress?: number;
  path?: string;
};

/** Code Injection status: "legacy" means an inline ARM9 edit that installing migrates. */
export function getForgettableHmsPmcStatus(project: ProjectState): ForgettableHmsPmcState {
  if (project.session.baseRom !== "BW2") return "unsupported";
  const version = project.session.baseVersion;
  if (version !== "B2" && version !== "W2") return "unsupported";
  if (hasForgettableHmsDll(project, version)) return "patched";
  if (project.arm9.length === 0) return "unknown";
  const match = findBw2MoveIsHm(project.arm9, projectArm9RamAddress(project));
  if (!match) return "unknown";
  return match.state === "inline" ? "legacy" : "unpatched";
}

/** Install through the shared transaction (PMC is installed first when missing). */
export function installForgettableHmsPmc(project: ProjectState): Promise<ForgettableHmsInstallResult> {
  return installCodeInjectionPatch(project, stageForgettableHmsPmc);
}

/** Stage the generated DLL into a project that already has PMC. Throws before changing anything it cannot verify. */
export function stageForgettableHmsPmc(project: ProjectState): ForgettableHmsInstallResult {
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) {
    throw new Error("Forgettable HMs (PMC) requires a Black 2 or White 2 project. Black / White uses the ARM9 patch on the Patches page.");
  }
  if (project.arm9.length === 0) throw new Error("Reload the ROM before installing Forgettable HMs.");
  if (hasForgettableHmsDll(project, version)) {
    markApplied(project);
    return { status: "already-applied", summary: "Forgettable HMs is already installed.", path: forgettableHmsDllPath(version) };
  }
  const match = findBw2MoveIsHm(project.arm9, projectArm9RamAddress(project));
  if (!match) {
    throw new Error("Could not find the Black 2 / White 2 HM check (PML_MoveIsHM) in ARM9. This ROM may already have a different patch or code layout.");
  }
  const conflict = findForgettableHmsConflict(project, version, match.address);
  if (conflict) throw new Error(`${conflict} already patches the HM check. Remove it before installing Forgettable HMs.`);

  if (match.state === "inline") {
    project.arm9 = restoreInlineForgettableHmsEdit(project.arm9, match);
    project.arm9Dirty = true;
  }
  const romBytes = project.originalRomBytes;
  const romIdCode = romBytes && romBytes.length >= 16 ? String.fromCharCode(...romBytes.subarray(12, 16)) : project.romInfo?.idCode;
  const module = stageCodeInjectionDll(project, forgettableHmsDllFileName(version),
    buildForgettableHmsDll(pmcGameIdFor(version, romIdCode), match.address), "patches", romBytes);
  markApplied(project);
  recordGenericChange(project, "code_injection", "Made HM moves forgettable with a PMC runtime.", "Forgettable HMs", {
    key: "code-injection:forgettable-hms",
  });
  const where = `PML_MoveIsHM at 0x${match.address.toString(16)}`;
  return {
    status: "applied",
    moveIsHmAddress: match.address,
    path: module.path,
    summary: match.state === "inline"
      ? `Migrated the inline ARM9 HM edit to ${module.fileName}, hooking ${where}.`
      : `${module.fileName} staged, hooking ${where}.`,
  };
}

function markApplied(project: ProjectState): void {
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.forgettableHms = true;
}

function projectArm9RamAddress(project: ProjectState): number {
  if (!project.originalRomBytes) return BW2_ARM9_RAM_BASE;
  try {
    // A zero header address (test fixtures, damaged headers) falls back to the retail base.
    return new NintendoDSRom(project.originalRomBytes, { fileData: "view" }).arm9RamAddress || BW2_ARM9_RAM_BASE;
  } catch {
    return BW2_ARM9_RAM_BASE;
  }
}

function matchState(arm9: Uint8Array, offset: number): Bw2MoveIsHmMatch["state"] | undefined {
  for (let i = 4; i < PML_MOVE_IS_HM_PATTERN.length; i += 1) {
    const expected = PML_MOVE_IS_HM_PATTERN[i];
    if (expected !== null && arm9[offset + i] !== expected) return undefined;
  }
  if (PML_MOVE_IS_HM_ENTRY.every((byte, i) => arm9[offset + i] === byte)) return "original";
  if (FORGETTABLE_HMS_RETURN_FALSE.every((byte, i) => arm9[offset + i] === byte)) return "inline";
  return undefined;
}

/** The table must live in ARM9 and hold six plausible move IDs. */
function readHmTable(arm9: Uint8Array, offset: number, arm9RamAddress: number): number[] | undefined {
  const literal = readU32(arm9, offset + 0x24);
  const table = literal + arm9[offset + 8]! - arm9RamAddress;
  if (table < 0 || (table & 1) !== 0 || table + HM_COUNT * 2 > arm9.length) return undefined;
  const moves = Array.from({ length: HM_COUNT }, (_, i) => readU16(arm9, table + i * 2));
  return moves.every((move) => move > 0 && move < 0x400) ? moves : undefined;
}

function codeInjectionModuleBytes(project: ProjectState, path: string): Uint8Array | undefined {
  const stagedPath = Object.keys(project.fileSystem?.additions ?? {}).find((entry) => entry.toLowerCase() === path.toLowerCase());
  if (stagedPath) return project.fileSystem?.additions?.[stagedPath];
  if (!project.originalRomBytes) return undefined;
  try {
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    const fileId = rom.filenames.idOf(path);
    return fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
  } catch {
    return undefined;
  }
}
