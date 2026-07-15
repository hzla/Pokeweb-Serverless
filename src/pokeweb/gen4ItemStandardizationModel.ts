import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { parseGen4EventFile } from "./gen4EventModel";
import { loadActiveRomBytes } from "./persistence";
import type { RawRecord, ProjectState } from "./projectStore";
import type { RomPatchApplyResult } from "./romPatchModel";

export const PLATINUM_ITEM_SCRIPT_FILE_ID = 404;
export const PLATINUM_ITEM_OVERLAY_ID = 9;
export const PLATINUM_ITEM_OVERLAY_OFFSET = 0x8e2a;
export const PLATINUM_ITEM_SCRIPT_BASE = 7000;

const SCRIPT_HEADER_END = 0xfd13;
const SET_VAR_COMMAND = 0x0028;
const JUMP_COMMAND = 0x0016;
const ITEM_VARIABLE = 0x8008;
const QUANTITY_VARIABLE = 0x8009;
const STANDARD_ITEM_QUANTITY = 1;
const STANDARD_WRAPPER_LENGTH = 18;
const ITEM_SCRIPT_RANGE_MAX = 8000;

export type PlatinumItemStandardizationState = "patched" | "unpatched" | "unsupported" | "unknown";

export type PlatinumItemScriptInspection = {
  state: "patched" | "unpatched";
  scriptStarts: number[];
  itemIds: number[];
  sharedRoutineStart: number;
};

type PlannedEventEdit = {
  id: number;
  raw: RawRecord;
  changedReferences: number;
};

export function detectPlatinumItemStandardization(project: ProjectState): PlatinumItemStandardizationState {
  if (project.session.baseVersion !== "Pt") return "unsupported";
  const source = project.narcs.scripts?.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID];
  const itemCount = project.texts.banks.items?.length ?? 0;
  if (!source || itemCount <= 0) return "unknown";

  try {
    return inspectPlatinumItemScripts(source, itemCount).state;
  } catch {
    return "unknown";
  }
}

export async function applyPlatinumItemStandardization(project: ProjectState): Promise<RomPatchApplyResult> {
  if (project.session.baseVersion !== "Pt") {
    throw new Error("Ground-item ID standardization is available for Pokémon Platinum only.");
  }

  const scripts = project.narcs.scripts;
  const events = project.narcs.overworlds;
  if (!scripts) throw new Error("The Platinum scripts NARC is not loaded.");
  if (!events) throw new Error("The Platinum event NARC is not loaded.");

  const source = scripts.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID];
  if (!source) throw new Error(`Platinum item script file ${PLATINUM_ITEM_SCRIPT_FILE_ID} is missing.`);
  const itemCount = project.texts.banks.items?.length ?? 0;
  if (itemCount <= 0) throw new Error("Platinum item text bank 392 is unavailable, so the canonical item count cannot be determined.");

  const inspection = inspectPlatinumItemScripts(source, itemCount);
  if (inspection.state === "patched") {
    project.patches ??= { dirtyOverlayIds: [], applied: {} };
    project.patches.applied ??= {};
    project.patches.applied.itemStandardization = true;
    return {
      patchId: "itemStandardization",
      status: "already-applied",
      summary: "Ground-item script IDs already follow Platinum item IDs.",
    };
  }

  const rebuiltScripts = buildStandardizedPlatinumItemScripts(source, itemCount, inspection);
  const eventEdits = planEventEdits(project, inspection.itemIds);
  const sourceOverlay = await loadOverlayForPreflight(project, PLATINUM_ITEM_OVERLAY_ID);
  if (sourceOverlay.length < PLATINUM_ITEM_OVERLAY_OFFSET + 2) {
    throw new Error(`Platinum overlay ${PLATINUM_ITEM_OVERLAY_ID} is too short for the special Griseous Orb reference.`);
  }
  const oldOverlayReference = readU16(sourceOverlay, PLATINUM_ITEM_OVERLAY_OFFSET);
  const newOverlayReference = remapPlatinumItemScriptReference(oldOverlayReference, inspection.itemIds, "overlay 9 Griseous Orb reference");
  const rebuiltOverlay = sourceOverlay.slice();
  writeU16(rebuiltOverlay, PLATINUM_ITEM_OVERLAY_OFFSET, newOverlayReference);

  scripts.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID] = rebuiltScripts;
  scripts.records.delete(PLATINUM_ITEM_SCRIPT_FILE_ID);
  scripts.dirty.add(PLATINUM_ITEM_SCRIPT_FILE_ID);

  for (const edit of eventEdits) {
    const existing = events.records.get(edit.id);
    if (existing) {
      existing.raw = edit.raw;
      existing.readable = undefined;
    } else {
      events.records.set(edit.id, { id: edit.id, bytes: events.rawFiles[edit.id], raw: edit.raw });
    }
    events.dirty.add(edit.id);
  }

  project.overlays[PLATINUM_ITEM_OVERLAY_ID] = rebuiltOverlay;
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  project.patches.applied ??= {};
  project.patches.applied.itemStandardization = true;
  if (!project.patches.dirtyOverlayIds.includes(PLATINUM_ITEM_OVERLAY_ID)) {
    project.patches.dirtyOverlayIds.push(PLATINUM_ITEM_OVERLAY_ID);
  }

  const changedReferences = eventEdits.reduce((sum, edit) => sum + edit.changedReferences, 0);
  recordGenericChange(
    project,
    "patches",
    `Standardized ${itemCount} Platinum ground-item scripts, updated ${changedReferences} event reference${changedReferences === 1 ? "" : "s"} across ${eventEdits.length} event file${eventEdits.length === 1 ? "" : "s"}, and updated overlay 9.`,
    "Ground Item IDs",
    { key: "patch:itemStandardization" },
  );

  return {
    patchId: "itemStandardization",
    status: "applied",
    overlayId: PLATINUM_ITEM_OVERLAY_ID,
    offset: PLATINUM_ITEM_OVERLAY_OFFSET,
    summary: `Standardized ${itemCount} ground-item scripts and updated ${changedReferences} placed-item reference${changedReferences === 1 ? "" : "s"}.`,
  };
}

export function inspectPlatinumItemScripts(source: Uint8Array, itemCount: number): PlatinumItemScriptInspection {
  if (!Number.isInteger(itemCount) || itemCount <= 0 || itemCount > 0xffff) throw new Error(`Invalid Platinum item count: ${itemCount}.`);
  const scriptStarts = readScriptStarts(source);
  if (scriptStarts.length < 2) throw new Error("The Platinum item script file does not contain item wrappers and a shared routine.");

  const sharedRoutineStart = scriptStarts[scriptStarts.length - 1];
  const headerLength = scriptStarts.length * 4 + 2;
  for (let index = 1; index < scriptStarts.length; index += 1) {
    if (scriptStarts[index] <= scriptStarts[index - 1]) throw new Error("The Platinum item script pointers are not strictly increasing.");
  }
  if (scriptStarts[0] < headerLength) throw new Error("The Platinum item script pointers overlap the pointer table.");
  if (sharedRoutineStart >= source.length) throw new Error("The shared Platinum give-item routine points outside the script file.");

  const itemIds = scriptStarts.slice(0, -1).map((start, index) =>
    readItemWrapper(source, start, scriptStarts[index + 1], sharedRoutineStart, index),
  );
  const invalidItemIndex = itemIds.findIndex((itemId) => itemId < 0 || itemId >= itemCount);
  if (invalidItemIndex >= 0) {
    throw new Error(`Platinum item wrapper ${invalidItemIndex} uses item ID ${itemIds[invalidItemIndex]}, outside text bank 392.`);
  }
  const canonical = itemIds.length === itemCount && itemIds.every((itemId, index) => itemId === index);
  if (!canonical && itemIds.length >= itemCount) {
    throw new Error(`The item script file has ${itemIds.length} wrappers but does not use canonical item IDs.`);
  }

  return {
    state: canonical ? "patched" : "unpatched",
    scriptStarts,
    itemIds,
    sharedRoutineStart,
  };
}

export function buildStandardizedPlatinumItemScripts(
  source: Uint8Array,
  itemCount: number,
  inspection = inspectPlatinumItemScripts(source, itemCount),
): Uint8Array {
  if (inspection.state === "patched") return source;
  const sharedRoutine = source.slice(inspection.sharedRoutineStart);
  if (sharedRoutine.length === 0) throw new Error("The Platinum shared give-item routine is empty.");

  const scriptCount = itemCount + 1;
  const headerLength = scriptCount * 4 + 2;
  const sharedRoutineStart = headerLength + itemCount * STANDARD_WRAPPER_LENGTH;
  const out = new Uint8Array(sharedRoutineStart + sharedRoutine.length);

  for (let index = 0; index < scriptCount; index += 1) {
    const target = index === itemCount ? sharedRoutineStart : headerLength + index * STANDARD_WRAPPER_LENGTH;
    writeU32(out, index * 4, target - (index * 4 + 4));
  }
  writeU16(out, scriptCount * 4, SCRIPT_HEADER_END);

  for (let itemId = 0; itemId < itemCount; itemId += 1) {
    const start = headerLength + itemId * STANDARD_WRAPPER_LENGTH;
    writeU16(out, start, SET_VAR_COMMAND);
    writeU16(out, start + 2, ITEM_VARIABLE);
    writeU16(out, start + 4, itemId);
    writeU16(out, start + 6, SET_VAR_COMMAND);
    writeU16(out, start + 8, QUANTITY_VARIABLE);
    writeU16(out, start + 10, STANDARD_ITEM_QUANTITY);
    writeU16(out, start + 12, JUMP_COMMAND);
    writeU32(out, start + 14, sharedRoutineStart - (start + STANDARD_WRAPPER_LENGTH));
  }

  out.set(sharedRoutine, sharedRoutineStart);
  return out;
}

export function remapPlatinumItemScriptReference(scriptNumber: number, legacyItemIds: readonly number[], subject = "ground-item script"): number {
  const index = scriptNumber - PLATINUM_ITEM_SCRIPT_BASE;
  if (!Number.isInteger(index) || index < 0 || index >= legacyItemIds.length) {
    throw new Error(`${subject} ${scriptNumber} does not map to one of the ${legacyItemIds.length} legacy Platinum item scripts.`);
  }
  const itemId = legacyItemIds[index];
  const remapped = PLATINUM_ITEM_SCRIPT_BASE + itemId;
  if (!Number.isInteger(itemId) || itemId < 0 || remapped > 0xffff) throw new Error(`${subject} ${scriptNumber} maps to an invalid item ID.`);
  return remapped;
}

function readScriptStarts(source: Uint8Array): number[] {
  const starts: number[] = [];
  let offset = 0;
  while (offset + 2 <= source.length) {
    if (readU16(source, offset) === SCRIPT_HEADER_END) return starts;
    if (offset + 4 > source.length) break;
    const relative = readU32(source, offset) | 0;
    const target = offset + 4 + relative;
    if (target < 0 || target >= source.length) throw new Error(`Platinum item script pointer ${starts.length} points outside the file.`);
    starts.push(target);
    offset += 4;
  }
  throw new Error("The Platinum item script pointer table has no 0xFD13 terminator.");
}

function readItemWrapper(source: Uint8Array, start: number, nextStart: number, sharedRoutineStart: number, index: number): number {
  if (start + STANDARD_WRAPPER_LENGTH > nextStart || start + STANDARD_WRAPPER_LENGTH > source.length) {
    throw new Error(`Platinum item wrapper ${index} is truncated.`);
  }
  if (readU16(source, start) !== SET_VAR_COMMAND || readU16(source, start + 2) !== ITEM_VARIABLE) {
    throw new Error(`Platinum item wrapper ${index} does not set variable 0x8008 first.`);
  }
  if (readU16(source, start + 6) !== SET_VAR_COMMAND || readU16(source, start + 8) !== QUANTITY_VARIABLE) {
    throw new Error(`Platinum item wrapper ${index} does not set variable 0x8009 second.`);
  }
  if (readU16(source, start + 10) !== STANDARD_ITEM_QUANTITY) {
    throw new Error(`Platinum item wrapper ${index} uses a customized quantity.`);
  }
  if (readU16(source, start + 12) !== JUMP_COMMAND) {
    throw new Error(`Platinum item wrapper ${index} does not jump to the shared give-item routine.`);
  }
  const jumpTarget = start + STANDARD_WRAPPER_LENGTH + (readU32(source, start + 14) | 0);
  if (jumpTarget !== sharedRoutineStart) {
    throw new Error(`Platinum item wrapper ${index} jumps to an unexpected routine.`);
  }
  return readU16(source, start + 4);
}

function planEventEdits(project: ProjectState, legacyItemIds: readonly number[]): PlannedEventEdit[] {
  const store = project.narcs.overworlds;
  if (!store) throw new Error("The Platinum event NARC is not loaded.");
  const edits: PlannedEventEdit[] = [];

  store.rawFiles.forEach((bytes, id) => {
    const cachedRaw = store.records.get(id)?.raw;
    const raw = cachedRaw ? { ...cachedRaw } : parseGen4EventFile(bytes);
    const count = Math.max(0, Number(raw.overworld_count ?? 0));
    let changedReferences = 0;
    for (let index = 0; index < count; index += 1) {
      const type = Number(raw[`overworld_${index}_type`] ?? 0);
      const scriptNumber = Number(raw[`overworld_${index}_script_number`] ?? 0);
      const inItemRange = scriptNumber >= PLATINUM_ITEM_SCRIPT_BASE && scriptNumber <= ITEM_SCRIPT_RANGE_MAX;
      if (type !== 3 && !inItemRange) continue;
      const remapped = remapPlatinumItemScriptReference(scriptNumber, legacyItemIds, `event file ${id}, overworld ${index}`);
      if (remapped === scriptNumber) continue;
      raw[`overworld_${index}_script_number`] = remapped;
      changedReferences += 1;
    }
    if (changedReferences > 0) edits.push({ id, raw, changedReferences });
  });

  return edits;
}

async function loadOverlayForPreflight(project: ProjectState, overlayId: number): Promise<Uint8Array> {
  const current = project.overlays[overlayId];
  if (current && current.length > 0) return current.slice();

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Reload the Platinum ROM before applying item standardization.");
  const overlay = new NintendoDSRom(romBytes).loadArm9Overlays([overlayId]).get(overlayId);
  if (!overlay) throw new Error(`Could not load Platinum overlay ${overlayId}.`);
  return overlay.data.slice();
}
