import { readAscii, readU16 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { sha256Hex } from "../nds/sha256";
import { recordGenericChange } from "./actionChangelog";
import { withProjectMutationLock } from "./codeInjectionInstall";
import { getRomFileBytes } from "./fileSystemModel";
import { getOverlayInfo, getOverlayWorkingBytes, isOverlayStaged } from "./overlayEditModel";
import { listCodeInjectionDlls } from "./pmcModel";
import type { ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";
import { parseRpm } from "./rpm";

const KEY_SYSTEM_OVERLAY = 332;
const MENU_ROUTINES_LENGTH = 0x134;
const branches = [
  { offset: 0x46, displacement: 0x06 }, // Skip drawing the lock for Challenge Mode.
  { offset: 0xde, displacement: 0x02 }, // Accept Challenge Mode and use the normal difficulty setter.
];

const profiles = {
  B2: {
    gameCode: "IREO",
    ramAddress: 0x021beee0,
    menuOffset: 0x5a00,
    menuHash: "5ac53d4f54c25c15f482f865b53ae9abffa6030940a7766a6a80ae1d35cccdf6",
  },
  W2: {
    gameCode: "IRDO",
    ramAddress: 0x021bef20,
    menuOffset: 0x5a04,
    menuHash: "07bce5f5d967c6d1ca80e6d3a94b6a5e2d3f4f5e8ede84deb332d36048efd068",
  },
} as const;
type Profile = (typeof profiles)[keyof typeof profiles];
type PatchStatus = { state: "unsupported" | "unavailable" | "ready" | "installed"; message?: string };

function getProfile(project: ProjectState): Profile | undefined {
  const version = project.session.baseVersion;
  if (project.session.baseRom !== "BW2" || (version !== "B2" && version !== "W2")) return;
  const profile = profiles[version];
  const bytes = project.originalRomBytes;
  if (project.romInfo.idCode !== profile.gameCode
    || (bytes && (bytes[0x1e] !== 0 || readAscii(bytes, 0x0c, 4) !== profile.gameCode))) return;
  return profile;
}

function inspectOverlay(project: ProjectState, rom: NintendoDSRom, profile: Profile) {
  const info = getOverlayInfo(project, rom, KEY_SYSTEM_OVERLAY);
  if (!info || info.ramAddress !== profile.ramAddress) throw new Error("The Unova Link overlay layout differs from the supported ROM.");
  if (info.readOnlyReason) throw new Error(info.readOnlyReason);
  // Honor an unstaged raw file replacement ahead of a cached overlay image.
  const rawReplacement = !isOverlayStaged(project, KEY_SYSTEM_OVERLAY) && project.fileSystem?.replacements?.[info.fileId];
  const overlay = getOverlayWorkingBytes(rawReplacement ? { ...project, overlays: {} } : project, rom, KEY_SYSTEM_OVERLAY);
  const start = profile.menuOffset;
  const end = start + MENU_ROUTINES_LENGTH;
  if (overlay.length < end) throw new Error("The Set Difficulty menu is missing.");
  const normalized = overlay.slice(start, end);
  let installed = true;
  for (const { offset, displacement } of branches) {
    const branch = readU16(normalized, offset);
    if (branch !== (0xe000 | displacement)) installed = false;
    else normalized[offset + 1] = 0xd1;
  }
  if (sha256Hex(normalized) !== profile.menuHash) throw new Error("The Set Difficulty menu has incompatible code changes.");

  for (const entry of listCodeInjectionDlls(project)) {
    const fileId = rom.filenames.idOf(entry.path);
    const bytes = project.fileSystem?.additions?.[entry.path]
      ?? (fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId));
    if (!bytes) throw new Error(`Could not check ${entry.fileName} for overlapping code changes.`);
    const module = parseRpm(bytes, { allowedMagics: ["DLXF"] });
    if (module.relocations.some(({ target, sourceSymbolIndex }) => {
      if (target.module.replace(/^OVL_/i, "") !== String(KEY_SYSTEM_OVERLAY)) return false;
      const address = (target.address & ~1) - info.ramAddress;
      const length = target.type === "FULL_COPY" ? module.symbols[sourceSymbolIndex]?.size ?? 0
        : target.type === "THUMB_BRANCH_SAFESTACK" ? 16 : target.type === "THUMB_BRANCH" ? 12 : target.type === "ARM_BRANCH" ? 8 : 4;
      return address < end && address + length > start;
    })) throw new Error(`${entry.fileName} also patches the Set Difficulty menu.`);
  }
  return { overlay, installed };
}

export function getEarlyChallengeModeStatus(project: ProjectState): PatchStatus {
  const profile = getProfile(project);
  if (!profile) return { state: "unsupported", message: "Requires US Black 2 or White 2 revision 0." };
  if (!project.originalRomBytes) return { state: "unavailable", message: "Load ROM data to check compatibility." };
  try {
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    return { state: inspectOverlay(project, rom, profile).installed ? "installed" : "ready" };
  } catch (error) {
    return { state: "unavailable", message: error instanceof Error ? error.message : String(error) };
  }
}

export function applyEarlyChallengeMode(project: ProjectState): Promise<RomPatchApplyResult> {
  return withProjectMutationLock(project, () => {
    const profile = getProfile(project);
    if (!profile) throw new Error("Requires US Black 2 or White 2 revision 0.");
    if (!project.originalRomBytes) throw new Error("Load ROM data before applying this patch.");
    const rom = new NintendoDSRom(project.originalRomBytes, { fileData: "view" });
    const { overlay, installed } = inspectOverlay(project, rom, profile);
    const patchId = "earlyChallengeMode";
    const overlayId = KEY_SYSTEM_OVERLAY;
    if (installed) return { patchId, status: "already-applied", overlayId };

    const patched = overlay.slice();
    for (const { offset } of branches) patched[profile.menuOffset + offset + 1] = 0xe0;
    project.overlays[overlayId] = patched;
    const patches = project.patches ??= { dirtyOverlayIds: [], applied: {} };
    if (!patches.dirtyOverlayIds.includes(overlayId)) patches.dirtyOverlayIds.push(overlayId);
    recordGenericChange(project, "patches", "Enabled selection of Challenge Mode in Unova Link from the start.", "Early Challenge Mode", {
      key: "patch:early-challenge-mode",
    });
    return { patchId, status: "applied", overlayId, summary: "Unlock staged. Export the ROM to apply it." };
  });
}
