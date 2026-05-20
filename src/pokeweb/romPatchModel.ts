import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { loadActiveRomBytes } from "./persistence";
import type { ProjectState } from "./projectStore";

export type RomPatchId = "removeDustCloudGems" | "removeDustCloudItems";

export type RomPatchApplyResult = {
  patchId: RomPatchId;
  status: "applied" | "already-applied";
  overlayId: number;
  offset: number;
};

export type OverlayPatchResult = {
  status: "applied" | "already-applied";
  overlay: Uint8Array;
  offset: number;
};

type DustCloudPatchConfig = {
  overlayId: number;
  gameLabel: string;
};

const DUST_CLOUD_PATCH_CONFIG: Record<ProjectState["session"]["baseRom"], DustCloudPatchConfig> = {
  BW: { overlayId: 21, gameLabel: "Pokemon Black / White" },
  BW2: { overlayId: 36, gameLabel: "Pokemon Black 2 / White 2" },
};

const GEM_RETURN_THEN_EVERSTONE = [
  0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
] as const;

export async function removeDustCloudGemRewards(project: ProjectState): Promise<RomPatchApplyResult> {
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = await ensureOverlay(project, config.overlayId);
  const patched = applyRemoveDustCloudGemRewardsToOverlay(overlay);

  if (!patched) {
    throw new Error(
      `Could not find the ${config.gameLabel} dust-cloud gem reward signature. This ROM may already have a different patch or code layout in overlay ${config.overlayId}.`,
    );
  }
  if (patched.status === "already-applied") {
    project.patches ??= { dirtyOverlayIds: [], applied: {} };
    project.patches.applied ??= {};
    project.patches.applied.removeDustCloudGems = true;
    return { patchId: "removeDustCloudGems", status: "already-applied", overlayId: config.overlayId, offset: patched.offset };
  }

  project.overlays[config.overlayId] = patched.overlay;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.removeDustCloudGems = true;
  if (!project.patches.dirtyOverlayIds.includes(config.overlayId)) project.patches.dirtyOverlayIds.push(config.overlayId);

  recordGenericChange(project, "patches", "Removed gem rewards from cave dust clouds.", "Dust Clouds", {
    key: "patch:removeDustCloudGems",
  });

  return { patchId: "removeDustCloudGems", status: "applied", overlayId: config.overlayId, offset: patched.offset };
}

export async function removeDustCloudItemRewards(project: ProjectState): Promise<RomPatchApplyResult> {
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = await ensureOverlay(project, config.overlayId);
  const patched = applyRemoveDustCloudItemRewardsToOverlay(overlay);

  if (!patched) {
    throw new Error(
      `Could not find the ${config.gameLabel} dust-cloud item/encounter signature. This ROM may already have a different patch or code layout in overlay ${config.overlayId}.`,
    );
  }
  if (patched.status === "already-applied") {
    project.patches ??= { dirtyOverlayIds: [], applied: {} };
    project.patches.applied ??= {};
    project.patches.applied.removeDustCloudItems = true;
    return { patchId: "removeDustCloudItems", status: "already-applied", overlayId: config.overlayId, offset: patched.offset };
  }

  project.overlays[config.overlayId] = patched.overlay;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.removeDustCloudItems = true;
  if (!project.patches.dirtyOverlayIds.includes(config.overlayId)) project.patches.dirtyOverlayIds.push(config.overlayId);

  recordGenericChange(project, "patches", "Removed item rewards from cave dust clouds.", "Dust Clouds", {
    key: "patch:removeDustCloudItems",
  });

  return { patchId: "removeDustCloudItems", status: "applied", overlayId: config.overlayId, offset: patched.offset };
}

export function applyRemoveDustCloudGemRewardsToOverlay(overlay: Uint8Array): OverlayPatchResult | undefined {
  const match = findDustCloudGemBranch(overlay);
  if (!match) return undefined;
  if (match.applied) return { status: "already-applied", overlay, offset: match.offset };

  const next = overlay.slice();
  next[match.offset + 1] = 0xe0;
  return { status: "applied", overlay: next, offset: match.offset };
}

export function applyRemoveDustCloudItemRewardsToOverlay(overlay: Uint8Array): OverlayPatchResult | undefined {
  const match = findDustCloudItemBranch(overlay);
  if (!match) return undefined;
  if (match.applied) return { status: "already-applied", overlay, offset: match.offset };

  const next = overlay.slice();
  next[match.offset + 1] = 0xbf;
  return { status: "applied", overlay: next, offset: match.offset };
}

export function detectDustCloudGemPatch(project: ProjectState): "patched" | "unpatched" | "unknown" {
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = project.overlays[config.overlayId];
  if (!overlay) return project.patches?.applied?.removeDustCloudGems ? "patched" : "unknown";
  const match = findDustCloudGemBranch(overlay);
  if (!match) return "unknown";
  return match.applied ? "patched" : "unpatched";
}

export function detectDustCloudItemPatch(project: ProjectState): "patched" | "unpatched" | "unknown" {
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = project.overlays[config.overlayId];
  if (!overlay) return project.patches?.applied?.removeDustCloudItems ? "patched" : "unknown";
  const match = findDustCloudItemBranch(overlay);
  if (!match) return "unknown";
  return match.applied ? "patched" : "unpatched";
}

export function getDirtyPatchOverlayIds(project: ProjectState): number[] {
  return project.patches?.dirtyOverlayIds ?? [];
}

async function ensureOverlay(project: ProjectState, overlayId: number): Promise<Uint8Array> {
  const existing = project.overlays[overlayId];
  if (existing && existing.length > 0) return existing;

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before applying direct ROM patches.");

  const rom = new NintendoDSRom(romBytes);
  const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId);
  if (!overlay) throw new Error(`Could not load overlay ${overlayId} from this ROM.`);
  project.overlays[overlayId] = overlay.data;
  return overlay.data;
}

function findDustCloudGemBranch(overlay: Uint8Array): { offset: number; applied: boolean } | undefined {
  const matches: Array<{ offset: number; applied: boolean }> = [];

  for (let offset = 2; offset + GEM_RETURN_THEN_EVERSTONE.length + 4 < overlay.length; offset += 1) {
    if (overlay[offset] !== 0x0d) continue;
    if (overlay[offset + 1] !== 0xd2 && overlay[offset + 1] !== 0xe0) continue;
    if (overlay[offset - 1] !== 0x42) continue;

    const gemReturnOffset = findSequence(overlay, GEM_RETURN_THEN_EVERSTONE, offset + 2, offset + 48);
    if (gemReturnOffset === undefined) continue;
    matches.push({ offset, applied: overlay[offset + 1] === 0xe0 });
  }

  if (matches.length !== 1) return undefined;
  return matches[0];
}

function findDustCloudItemBranch(overlay: Uint8Array): { offset: number; applied: boolean } | undefined {
  const matches: Array<{ offset: number; applied: boolean }> = [];

  for (let offset = 0; offset + 14 <= overlay.length; offset += 1) {
    if (overlay[offset] !== 0x04 || overlay[offset + 1] !== 0x28) continue;
    if (overlay[offset + 3] !== 0xd1) continue;
    if (overlay[offset + 4] !== 0x19 || overlay[offset + 5] !== 0x20) continue;
    if (overlay[offset + 6] !== 0x00 || overlay[offset + 7] !== 0x01) continue;
    if (overlay[offset + 8] !== 0x81 || overlay[offset + 9] !== 0x42) continue;
    if (overlay[offset + 10] !== 0x00) continue;
    if (overlay[offset + 11] !== 0xd2 && overlay[offset + 11] !== 0xbf) continue;
    if (overlay[offset + 13] !== 0xe0) continue;
    if (!hasBridgeItemDecisionBefore(overlay, offset)) continue;

    matches.push({ offset: offset + 10, applied: overlay[offset + 11] === 0xbf });
  }

  if (matches.length !== 1) return undefined;
  return matches[0];
}

function hasBridgeItemDecisionBefore(overlay: Uint8Array, caveOffset: number): boolean {
  const start = Math.max(0, caveOffset - 48);
  for (let offset = start; offset + 8 <= caveOffset; offset += 1) {
    if (overlay[offset] !== 0x07 || overlay[offset + 1] !== 0x28) continue;
    if (overlay[offset + 3] !== 0xd1) continue;
    if (overlay[offset + 4] !== 0xc8 || overlay[offset + 5] !== 0x29) continue;
    if (overlay[offset + 6] !== 0x00 || overlay[offset + 7] !== 0xd2) continue;
    return true;
  }
  return false;
}

function findSequence(data: Uint8Array, sequence: readonly number[], start: number, end: number): number | undefined {
  const max = Math.min(end, data.length - sequence.length);
  for (let offset = start; offset <= max; offset += 1) {
    let ok = true;
    for (let index = 0; index < sequence.length; index += 1) {
      if (data[offset + index] !== sequence[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return offset;
  }
  return undefined;
}
