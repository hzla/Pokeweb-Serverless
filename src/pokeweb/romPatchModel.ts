import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { BW2_NARCS, TYPES, isGen5BaseRom, type Gen5BaseRom, type NarcName } from "./constants";
import { applyFairyTypeGeneralPatch } from "./generalPatchModel";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, type NarcStore, type ProjectState } from "./projectStore";
import { applyTrainerNaturePatchToArm9, detectTrainerNaturePatchState, type TrainerNaturePatchState } from "./trainerNaturePatch";
import { installMoveExpansion, type MoveExpansionInstallOptions } from "./moveExpansionPatch";

export { detectMoveExpansionPatch } from "./moveExpansionPatch";

export type RomPatchId =
  | "removeDustCloudGems"
  | "removeDustCloudItems"
  | "forgettableHms"
  | "fairyType"
  | "specifyTrainerNatures"
  | "moveExpansion"
  | "itemStandardization";

export type RomPatchApplyResult = {
  patchId: RomPatchId;
  status: "applied" | "already-applied";
  overlayId?: number;
  offset?: number;
  summary?: string;
};

export type OverlayPatchResult = {
  status: "applied" | "already-applied";
  overlay: Uint8Array;
  offset: number;
};

export type Arm9PatchResult = {
  status: "applied" | "already-applied";
  arm9: Uint8Array;
  offset: number;
};

export type AddFairyTypeSupportOptions = {
  updateModernFairyTypings?: boolean;
};

export type AddMoveExpansionOptions = MoveExpansionInstallOptions;

export type FairyModernTypingResult = {
  changed: boolean;
  pokemonChanged: number;
  movesChanged: number;
};

type DustCloudPatchConfig = {
  overlayId: number;
  gameLabel: string;
};

const DUST_CLOUD_PATCH_CONFIG: Record<Gen5BaseRom, DustCloudPatchConfig> = {
  BW: { overlayId: 21, gameLabel: "Pokemon Black / White" },
  BW2: { overlayId: 36, gameLabel: "Pokemon Black 2 / White 2" },
};

const GEM_RETURN_THEN_EVERSTONE = [
  0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
] as const;

const HM_FORGET_PROTECTION_CHECK_PREFIX = [
  0x08, 0x4a, 0x00, 0x23, 0x59, 0x00, 0x51, 0x18, 0xb8, 0x31, 0x09, 0x88, 0x88, 0x42, 0x01, 0xd1,
  0x01, 0x20, 0x70, 0x47, 0x59, 0x1c, 0x09, 0x06, 0x0b, 0x0e, 0x06, 0x2b, 0xf2, 0xd3, 0x00, 0x20,
  0x70, 0x47, 0xc0, 0x46,
] as const;

const HM_FORGET_PROTECTION_CHECKS = [
  [...HM_FORGET_PROTECTION_CHECK_PREFIX, 0xb8, 0xea, 0x09, 0x02],
  [...HM_FORGET_PROTECTION_CHECK_PREFIX, 0xa0, 0xea, 0x09, 0x02],
] as const;

const HM_FORGET_EARLY_RETURN = [0x00, 0x20, 0x70, 0x47] as const;

const HM_FORGET_GUIDE_PATCH = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x70, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
] as const;

const TYPE_IDS = {
  Normal: TYPES.indexOf("Normal"),
  Flying: TYPES.indexOf("Flying"),
  Steel: TYPES.indexOf("Steel"),
  Water: TYPES.indexOf("Water"),
  Grass: TYPES.indexOf("Grass"),
  Psychic: TYPES.indexOf("Psychic"),
  Fairy: TYPES.indexOf("Fairy"),
} as const;

const MODERN_FAIRY_POKEMON_TYPINGS: Array<{ id: number; type1: number; type2: number }> = [
  { id: 35, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 36, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 39, type1: TYPE_IDS.Normal, type2: TYPE_IDS.Fairy },
  { id: 40, type1: TYPE_IDS.Normal, type2: TYPE_IDS.Fairy },
  { id: 122, type1: TYPE_IDS.Psychic, type2: TYPE_IDS.Fairy },
  { id: 173, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 174, type1: TYPE_IDS.Normal, type2: TYPE_IDS.Fairy },
  { id: 175, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 176, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Flying },
  { id: 183, type1: TYPE_IDS.Water, type2: TYPE_IDS.Fairy },
  { id: 184, type1: TYPE_IDS.Water, type2: TYPE_IDS.Fairy },
  { id: 209, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 210, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Fairy },
  { id: 280, type1: TYPE_IDS.Psychic, type2: TYPE_IDS.Fairy },
  { id: 281, type1: TYPE_IDS.Psychic, type2: TYPE_IDS.Fairy },
  { id: 282, type1: TYPE_IDS.Psychic, type2: TYPE_IDS.Fairy },
  { id: 298, type1: TYPE_IDS.Normal, type2: TYPE_IDS.Fairy },
  { id: 303, type1: TYPE_IDS.Steel, type2: TYPE_IDS.Fairy },
  { id: 439, type1: TYPE_IDS.Psychic, type2: TYPE_IDS.Fairy },
  { id: 468, type1: TYPE_IDS.Fairy, type2: TYPE_IDS.Flying },
  { id: 546, type1: TYPE_IDS.Grass, type2: TYPE_IDS.Fairy },
  { id: 547, type1: TYPE_IDS.Grass, type2: TYPE_IDS.Fairy },
];

const MODERN_FAIRY_MOVE_IDS = [186, 204, 236] as const;
const PERSONAL_TYPE_1_OFFSET = 6;
const PERSONAL_TYPE_2_OFFSET = 7;
const MOVE_TYPE_OFFSET = 0;

export async function removeDustCloudGemRewards(project: ProjectState): Promise<RomPatchApplyResult> {
  const config = dustCloudPatchConfig(project);
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
  const config = dustCloudPatchConfig(project);
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

export async function makeHmsForgettable(project: ProjectState): Promise<RomPatchApplyResult> {
  if (project.session.baseRom !== "BW") {
    throw new Error("Forgettable HMs is currently available for Black / White only.");
  }

  const patched = applyForgettableHmsToArm9(project.arm9);
  if (!patched) {
    throw new Error("Could not find the Black / White HM protection signature in ARM9. This ROM may already have a different patch or code layout.");
  }
  if (patched.status === "already-applied") {
    project.patches ??= { dirtyOverlayIds: [], applied: {} };
    project.patches.applied ??= {};
    project.patches.applied.forgettableHms = true;
    return { patchId: "forgettableHms", status: "already-applied", offset: patched.offset, summary: `Patch already present in ARM9 at 0x${patched.offset.toString(16)}.` };
  }

  project.arm9 = patched.arm9;
  project.arm9Dirty = true;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.forgettableHms = true;

  recordGenericChange(project, "patches", "Made HM moves forgettable.", "HMs", {
    key: "patch:forgettableHms",
  });

  return { patchId: "forgettableHms", status: "applied", offset: patched.offset, summary: `Made HM moves forgettable in ARM9 at 0x${patched.offset.toString(16)}.` };
}

export async function addFairyTypeSupport(project: ProjectState, options: AddFairyTypeSupportOptions = {}): Promise<RomPatchApplyResult> {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error("Fairy Type Support is currently available for Black 2 and White 2 only.");
  }

  const supportAlreadyApplied = Boolean(project.patches?.applied?.fairyType);
  const supportSummary = supportAlreadyApplied ? undefined : await applyFairyTypeGeneralPatch(project);
  const typingSummary = options.updateModernFairyTypings ? await applyModernFairyTypings(project) : undefined;

  const changed = Boolean(supportSummary?.changed || typingSummary?.changed);
  if (!changed) {
    const alreadyText =
      options.updateModernFairyTypings && project.patches?.applied?.fairyModernTypings
        ? "Fairy Type Support and modern Fairy typings are already applied."
        : "Fairy Type Support is already applied.";
    return { patchId: "fairyType", status: "already-applied", summary: alreadyText };
  }

  const parts: string[] = [];
  if (supportSummary?.changed) {
    const overlayText = supportSummary.overlayIds.length > 0 ? `overlays ${supportSummary.overlayIds.join(", ")}` : "ROM code";
    parts.push(`Updated ${overlayText}, ARM9, the overlay table, and ${supportSummary.narcFileIds.length} data archives`);
  }
  if (typingSummary?.changed) {
    parts.push(
      typingSummary.pokemonChanged > 0 || typingSummary.movesChanged > 0
        ? `updated ${typingSummary.pokemonChanged} Pokémon and ${typingSummary.movesChanged} moves with modern Fairy typings`
        : "marked modern Fairy typings as applied",
    );
  }

  return {
    patchId: "fairyType",
    status: "applied",
    summary: `${capitalizeFirst(parts.join("; "))}.`,
  };
}

export async function specifyTrainerNatures(project: ProjectState): Promise<RomPatchApplyResult> {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error("Specify Trainer Pokémon Natures is currently available for Black 2 and White 2 only.");
  }
  if (project.arm9.length === 0) {
    throw new Error("Reload the ROM before applying the trainer nature ARM9 patch.");
  }

  const patched = applyTrainerNaturePatchToArm9(project.arm9, project.session.baseVersion, getProjectArm9RamAddress(project));
  if (!patched) {
    throw new Error("Could not find the Black 2 / White 2 trainer Pokémon setup signatures in ARM9. This ROM may already have a different trainer code patch or code layout.");
  }

  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.specifyTrainerNatures = true;

  if (patched.status === "already-applied") {
    return {
      patchId: "specifyTrainerNatures",
      status: "already-applied",
      offset: patched.offset,
      summary: `Trainer nature helper is already installed at 0x${patched.hookAddress.toString(16)}.`,
    };
  }

  project.arm9 = patched.arm9;
  project.arm9Dirty = true;

  recordGenericChange(project, "patches", "Enabled explicit trainer Pokémon natures.", "Trainer Pokémon Natures", {
    key: "patch:specifyTrainerNatures",
  });

  return {
    patchId: "specifyTrainerNatures",
    status: "applied",
    offset: patched.offset,
    summary: `Enabled explicit trainer Pokémon natures with an ARM9 helper at 0x${patched.hookAddress.toString(16)}.`,
  };
}

export async function addMoveExpansion(
  project: ProjectState,
  options: AddMoveExpansionOptions = {},
): Promise<RomPatchApplyResult> {
  const result = await installMoveExpansion(project, options);
  const mappedFairyText =
    result.fairyMovesMappedToNormal > 0
      ? ` ${result.fairyMovesMappedToNormal} Fairy-type definitions were safely mapped to Normal because Fairy Type Support is not installed.`
      : "";
  const bundledAnimationText = result.bundledAnimationsIncluded
    ? ` The optional Gen 6-7 animation bundle is installed with ${result.bundledAnimationsInstalled} scripts; this run appended ${result.particleFilesInstalled} prerequisite particle files and rewrote ${result.particleReferencesRemapped} particle references for their allocated IDs.`
    : "";
  const summary = result.changed
    ? `Expanded move data and animations to 1,000 entries, installed the Frost-compatible routing hook, and added ${result.importedMovesAdded} selectable White2Upgrade move definitions.${mappedFairyText}${bundledAnimationText}`
    : `Move Expansion, its routing hook, and the coordinated text and animation tables are already installed.${bundledAnimationText}`;
  return {
    patchId: "moveExpansion",
    status: result.changed ? "applied" : "already-applied",
    overlayId: result.overlayId,
    offset: result.helperOffset,
    summary,
  };
}

export async function applyModernFairyTypings(project: ProjectState): Promise<FairyModernTypingResult> {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") {
    throw new Error("Modern Fairy typings are currently available for Black 2 and White 2 only.");
  }

  const personalStore = await ensureNarcStore(project, "personal");
  const movesStore = await ensureNarcStore(project, "moves");
  let pokemonChanged = 0;
  let movesChanged = 0;

  for (const typing of MODERN_FAIRY_POKEMON_TYPINGS) {
    const changedType1 = setRecordByte(personalStore, typing.id, PERSONAL_TYPE_1_OFFSET, typing.type1, "type_1");
    const changedType2 = setRecordByte(personalStore, typing.id, PERSONAL_TYPE_2_OFFSET, typing.type2, "type_2");
    if (changedType1 || changedType2) pokemonChanged += 1;
  }

  for (const moveId of MODERN_FAIRY_MOVE_IDS) {
    if (setRecordByte(movesStore, moveId, MOVE_TYPE_OFFSET, TYPE_IDS.Fairy, "type")) movesChanged += 1;
  }

  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  const flagChanged = !project.patches.applied.fairyModernTypings;
  project.patches.applied.fairyModernTypings = true;

  const changed = pokemonChanged > 0 || movesChanged > 0 || flagChanged;
  if (pokemonChanged > 0 || movesChanged > 0) {
    recordGenericChange(
      project,
      "patches",
      `Updated ${pokemonChanged} Pokémon and ${movesChanged} moves with modern Fairy typings.`,
      "Fairy Type Support",
      { key: "patch:fairyModernTypings" },
    );
  }

  return { changed, pokemonChanged, movesChanged };
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

export function applyForgettableHmsToArm9(arm9: Uint8Array): Arm9PatchResult | undefined {
  const match = findHmForgetProtectionCheck(arm9);
  if (!match) return undefined;
  if (match.applied) return { status: "already-applied", arm9, offset: match.offset };

  const next = arm9.slice();
  next.set(HM_FORGET_EARLY_RETURN, match.offset);
  return { status: "applied", arm9: next, offset: match.offset };
}

export function detectDustCloudGemPatch(project: ProjectState): "patched" | "unpatched" | "unknown" {
  if (!isGen5BaseRom(project.session.baseRom)) return "unknown";
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = project.overlays[config.overlayId];
  if (!overlay) return project.patches?.applied?.removeDustCloudGems ? "patched" : "unknown";
  const match = findDustCloudGemBranch(overlay);
  if (!match) return "unknown";
  return match.applied ? "patched" : "unpatched";
}

export function detectDustCloudItemPatch(project: ProjectState): "patched" | "unpatched" | "unknown" {
  if (!isGen5BaseRom(project.session.baseRom)) return "unknown";
  const config = DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
  const overlay = project.overlays[config.overlayId];
  if (!overlay) return project.patches?.applied?.removeDustCloudItems ? "patched" : "unknown";
  const match = findDustCloudItemBranch(overlay);
  if (!match) return "unknown";
  return match.applied ? "patched" : "unpatched";
}

function dustCloudPatchConfig(project: ProjectState): DustCloudPatchConfig {
  if (!isGen5BaseRom(project.session.baseRom)) throw new Error("Dust cloud patches are currently only supported for Gen 5 ROMs.");
  return DUST_CLOUD_PATCH_CONFIG[project.session.baseRom];
}

export function detectForgettableHmPatch(project: ProjectState): "patched" | "unpatched" | "unsupported" | "unknown" {
  if (project.session.baseRom !== "BW") return "unsupported";
  if (project.arm9.length === 0) return project.patches?.applied?.forgettableHms ? "patched" : "unknown";
  const match = findHmForgetProtectionCheck(project.arm9);
  if (!match) return project.patches?.applied?.forgettableHms ? "patched" : "unknown";
  return match.applied ? "patched" : "unpatched";
}

export function detectFairyTypePatch(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  return project.patches?.applied?.fairyType || project.session.fairy ? "patched" : "unpatched";
}

export function detectSpecifyTrainerNaturesPatch(project: ProjectState): TrainerNaturePatchState {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  if (project.arm9.length === 0) return project.patches?.applied?.specifyTrainerNatures ? "patched" : "unknown";
  return detectTrainerNaturePatchState(project.arm9, project.session.baseVersion, getProjectArm9RamAddress(project));
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

function getProjectArm9RamAddress(project: ProjectState): number | undefined {
  if (!project.originalRomBytes) return undefined;
  try {
    return new NintendoDSRom(project.originalRomBytes).arm9RamAddress;
  } catch {
    return undefined;
  }
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

function findHmForgetProtectionCheck(arm9: Uint8Array): { offset: number; applied: boolean } | undefined {
  const matches: Array<{ offset: number; applied: boolean }> = [];
  const signatureLength = HM_FORGET_PROTECTION_CHECKS[0].length;

  for (let offset = 0; offset + signatureLength <= arm9.length; offset += 1) {
    if (matchesAnyHmProtectionCheck(arm9, offset)) {
      matches.push({ offset, applied: false });
      continue;
    }
    if (matchesSequence(arm9, HM_FORGET_GUIDE_PATCH, offset) || matchesEarlyReturnHmPatch(arm9, offset)) {
      matches.push({ offset, applied: true });
    }
  }

  if (matches.length !== 1) return undefined;
  return matches[0];
}

function matchesEarlyReturnHmPatch(arm9: Uint8Array, offset: number): boolean {
  if (!matchesSequence(arm9, HM_FORGET_EARLY_RETURN, offset)) return false;
  for (const signature of HM_FORGET_PROTECTION_CHECKS) {
    let matches = true;
    for (let index = HM_FORGET_EARLY_RETURN.length; index < signature.length; index += 1) {
      if (arm9[offset + index] !== signature[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function matchesAnyHmProtectionCheck(arm9: Uint8Array, offset: number): boolean {
  return HM_FORGET_PROTECTION_CHECKS.some((signature) => matchesSequence(arm9, signature, offset));
}

function findSequence(data: Uint8Array, sequence: readonly number[], start: number, end: number): number | undefined {
  const max = Math.min(end, data.length - sequence.length);
  for (let offset = start; offset <= max; offset += 1) {
    if (matchesSequence(data, sequence, offset)) return offset;
  }
  return undefined;
}

function matchesSequence(data: Uint8Array, sequence: readonly number[], offset: number): boolean {
  if (offset + sequence.length > data.length) return false;
  for (let index = 0; index < sequence.length; index += 1) {
    if (data[offset + index] !== sequence[index]) return false;
  }
  return true;
}

async function ensureNarcStore(project: ProjectState, name: Extract<NarcName, "personal" | "moves">): Promise<NarcStore> {
  const existing = project.narcs[name];
  if (existing) return existing;

  const definition = BW2_NARCS.find((entry) => entry.name === name);
  if (!definition) throw new Error(`Missing NARC definition for ${name}.`);

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the ROM before applying Fairy typing updates.");

  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.fileId(definition.path);
  const sourceBytes = project.fileSystem?.replacements[fileId] ?? rom.files[fileId];
  const store = createNarcStore(name, definition.path, fileId, new NARC(sourceBytes));
  project.session.fileIds[name] = fileId;
  project.narcs[name] = store;
  return store;
}

function setRecordByte(store: NarcStore, recordId: number, offset: number, value: number, field: string): boolean {
  const original = store.rawFiles[recordId];
  if (!original) throw new Error(`Could not update ${store.name} record ${recordId}; the record does not exist.`);
  if (offset >= original.length) throw new Error(`Could not update ${store.name} record ${recordId}; the record is too short.`);

  const record = store.records.get(recordId);
  const changed = original[offset] !== value;
  const out = changed ? original.slice() : original;
  if (changed) {
    out[offset] = value;
    store.rawFiles[recordId] = out;
    store.dirty.add(recordId);
  }

  if (record) {
    record.bytes = out;
    if (record.raw) record.raw[field] = value;
    if (record.readable) record.readable[field] = TYPES[value] ?? value;
  }
  return changed;
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
