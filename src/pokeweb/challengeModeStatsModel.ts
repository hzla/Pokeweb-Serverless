import { readAscii, readU32, writeU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { withProjectMutationLock } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";
import { parseRpm, type RpmModule } from "./rpm";

const profiles = {
  B2: {
    idCode: "IREO",
    setterBranch: 0xfb63,
    recalcBranch: 0xfa5a,
    recalcAddress: 0x0201db10,
    originalHash: "90f6105a8dfbb563563b1c9b44a87ab59b9652485d6b1bc8d306be386d20d77a",
    patchedHash: "1ecb5ebbf3d87645c97a905e54c6058be7b450e8732030c6572919045a98857d",
  },
  W2: {
    idCode: "IRDO",
    setterBranch: 0xfb79,
    recalcBranch: 0xfa70,
    recalcAddress: 0x0201db3c,
    originalHash: "a3dc44ae29bf5fd4df0efb4285017b314a8a59c8e00b43d132efe1a25e59edce",
    patchedHash: "c52d78314fbc97cf13224fbb637579dd731f3dbf039dd5da06d14bc54c9af8fd",
  },
} as const;

type Profile = (typeof profiles)[keyof typeof profiles];
type PatchStatus = { state: "unsupported" | "unavailable" | "ready" | "installed"; message?: string };

const ARM9_BASE = 0x02004000;
const ADJUST_ADDRESS = 0x020185d0;
const ADJUST_SIZE = 0xac;
const PATCH_OFFSET = 0x02018646 - ARM9_BASE;
const RECALC_SIZE = 0x294;
const RECALC_HASH = "babbe79c65d1735aea83cc137e9ec868683c928caa9c8d33a4bb50473f1de6cb";

function getProfile(project: ProjectState): Profile | undefined {
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) return;
  const profile = profiles[version];
  return project.romInfo.idCode === profile.idCode ? profile : undefined;
}

function checkModuleConflicts(project: ProjectState, bytes: Uint8Array, profile: Profile): void {
  const modules = listCodeInjectionDlls(project);
  if (modules.length === 0) return;
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  for (const entry of modules) {
    const fileId = rom.filenames.idOf(entry.path);
    const dll = project.fileSystem?.additions?.[entry.path]
      ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
    let rpm: RpmModule | undefined;
    try { if (dll) rpm = parseRpm(dll, { allowedMagics: ["DLXF"] }); } catch { /* Report unreadable modules below. */ }
    if (!rpm) throw new Error(`Cannot check ${entry.path} for overlapping code changes.`);
    if (rpm.relocations.some(({ target, sourceSymbolIndex }) => {
      if (target.module !== "ARM9" && target.module !== "0") return false;
      const address = target.address & ~1;
      const size = target.type === "FULL_COPY" ? rpm!.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12
        : target.type === "ARM_BRANCH" ? 8 : 4;
      return (address < ADJUST_ADDRESS + ADJUST_SIZE && address + size > ADJUST_ADDRESS)
        || (address < profile.recalcAddress + RECALC_SIZE && address + size > profile.recalcAddress);
    })) throw new Error(`Challenge Mode Stat Fix overlaps ${entry.path}.`);
  }
}

export function getChallengeModeStatsStatus(project: ProjectState): PatchStatus {
  const profile = getProfile(project);
  const romBytes = project.originalRomBytes;
  if (!profile || (romBytes && (romBytes[0x1e] !== 0 || readAscii(romBytes, 0x0c, 4) !== profile.idCode))) {
    return { state: "unsupported", message: "Requires US Black 2 or White 2 revision 0." };
  }
  if (!romBytes || project.arm9.length === 0) {
    return { state: "unavailable", message: "Load ROM data to check compatibility." };
  }
  try {
    if (readU32(romBytes, 0x28) !== ARM9_BASE) throw new Error("The ARM9 load address is incompatible.");
    const start = ADJUST_ADDRESS - ARM9_BASE;
    const adjustHash = sha256Hex(project.arm9.subarray(start, start + ADJUST_SIZE));
    if (adjustHash !== profile.originalHash && adjustHash !== profile.patchedHash) {
      throw new Error("The opponent level adjustment routine differs from the supported layout.");
    }
    const recalcStart = profile.recalcAddress - ARM9_BASE;
    if (sha256Hex(project.arm9.subarray(recalcStart, recalcStart + RECALC_SIZE)) !== RECALC_HASH) {
      throw new Error("The native stat recalculation routine differs from the supported layout.");
    }
    checkModuleConflicts(project, romBytes, profile);
    return { state: adjustHash === profile.patchedHash ? "installed" : "ready" };
  } catch (error) {
    return { state: "unavailable", message: error instanceof Error ? error.message : String(error) };
  }
}

export function applyChallengeModeStatsFix(project: ProjectState): Promise<RomPatchApplyResult> {
  return withProjectMutationLock(project, () => {
    const profile = getProfile(project);
    const { state, message } = getChallengeModeStatsStatus(project);
    const patchId = "challengeModeStats";
    if (state === "installed") return { patchId, status: "already-applied", offset: PATCH_OFFSET };
    if (!profile || state !== "ready") throw new Error(message ?? "Challenge Mode Stat Fix is incompatible with this ROM.");
    // The native getter returns a byte-sized level and the zone delta is at
    // most seven levels. Their signed sum fits without the retail s16 casts.
    const instructions = [
      0x19c2, 0x2a00, 0xdc00, 0x2201, // Sum the level and delta, clamp to one.
      0x1c30, 0x219e, 0xf004, profile.setterBranch, // Set the party Pokémon's adjusted level.
      0x1c30, 0xf005, profile.recalcBranch, 0x46c0, // Recalculate from the stored level, then resume the loop.
    ];
    const arm9 = project.arm9.slice();
    instructions.forEach((instruction, index) => writeU16(arm9, PATCH_OFFSET + index * 2, instruction));
    project.arm9 = arm9;
    project.arm9Dirty = true;
    recordGenericChange(project, "patches", "Recalculated opponent stats from their adjusted difficulty levels.", "Challenge Mode Stat Fix", {
      key: "patch:challenge-mode-stats",
    });
    return { patchId, status: "applied", offset: PATCH_OFFSET, summary: "Stat fix staged. Export the ROM to apply it." };
  });
}
