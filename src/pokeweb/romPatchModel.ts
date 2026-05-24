import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { BW2_NARCS, TYPES, type NarcName } from "./constants";
import { applyFairyTypeGeneralPatch } from "./generalPatchModel";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, type NarcStore, type ProjectState } from "./projectStore";

export type RomPatchId = "removeDustCloudGems" | "removeDustCloudItems" | "fairyType";

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

export type AddFairyTypeSupportOptions = {
  updateModernFairyTypings?: boolean;
};

export type FairyModernTypingResult = {
  changed: boolean;
  pokemonChanged: number;
  movesChanged: number;
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

export function detectFairyTypePatch(project: ProjectState): "patched" | "unpatched" | "unsupported" {
  if (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2") return "unsupported";
  return project.patches?.applied?.fairyType || project.session.fairy ? "patched" : "unpatched";
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
