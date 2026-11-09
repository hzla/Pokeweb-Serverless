import { readU32 } from "../nds/binary";
import { loadOverlayTable } from "../nds/code";
import { decompressCode, isCodeCompressed } from "../nds/codeCompression";
import type { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import type { NarcName } from "./constants";
import { moveEffectHandlerOverlayId } from "./moveEffectHandlerModel";
import type { ProjectState } from "./projectStore";
import { BW2_TUTOR_MOVE_OVERLAY_ID } from "./tutorMoveModel";
import { isRomFsTypeChartStore, typeChartOverlayId } from "./typeChartModel";

/**
 * Decompressed ARM9 overlay editing for the File System page.
 *
 * Edits go into the same working copy the Patches page and other overlay
 * editors use (`project.overlays` + `patches.dirtyOverlayIds`), so ROM export
 * recompresses the overlay and updates its overlay-table entry.
 */

export type OverlayInfo = {
  overlayId: number;
  fileId: number;
  ramAddress: number;
  ramSize: number;
  bssSize: number;
  /** Stored compressed in the loaded ROM. */
  compressed: boolean;
  /** Overlay-table "signed" flag (bit 1). Such overlays are exported decompressed. */
  signed: boolean;
  /** Set when another Pokeweb feature owns the whole overlay and hex edits are refused. */
  readOnlyReason?: string;
};

const ENTRY_SIZE = 32;

/** The overlay table export starts from (Patches can stage a modified one). */
export function projectOverlayTable(project: ProjectState, rom: Pick<NintendoDSRom, "arm9OverlayTable">): Uint8Array {
  return project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
}

export function listOverlayInfos(project: ProjectState, rom: Pick<NintendoDSRom, "arm9OverlayTable">): OverlayInfo[] {
  const table = projectOverlayTable(project, rom);
  const pmcId = project.codeInjection?.pmc?.overlayId;
  const infos: OverlayInfo[] = [];
  for (let offset = 0; offset + ENTRY_SIZE <= table.length; offset += ENTRY_SIZE) {
    const overlayId = readU32(table, offset), flags = readU32(table, offset + 28) >>> 24;
    infos.push({
      overlayId,
      ramAddress: readU32(table, offset + 4),
      ramSize: readU32(table, offset + 8),
      bssSize: readU32(table, offset + 12),
      fileId: readU32(table, offset + 24),
      compressed: Boolean(flags & 1),
      signed: Boolean(flags & 2),
      readOnlyReason: overlayId === pmcId ? "This overlay holds the PMC code-injection loader. Manage it from the Code Injection page." : undefined,
    });
  }
  return infos.sort((a, b) => a.overlayId - b.overlayId);
}

export function getOverlayInfo(project: ProjectState, rom: Pick<NintendoDSRom, "arm9OverlayTable">, overlayId: number): OverlayInfo | undefined {
  return listOverlayInfos(project, rom).find((info) => info.overlayId === overlayId);
}

/** Overlay ID whose stored image is ROM file `fileId`, if any. */
export function overlayIdForFile(project: ProjectState, rom: Pick<NintendoDSRom, "arm9OverlayTable">, fileId: number): number | undefined {
  return listOverlayInfos(project, rom).find((info) => info.fileId === fileId)?.overlayId;
}

/** True when export will write this overlay from the decompressed working copy. */
export function isOverlayStaged(project: ProjectState, overlayId: number): boolean {
  return (project.patches?.dirtyOverlayIds ?? []).includes(overlayId) || (project.starters?.dirtyOverlayIds ?? []).includes(overlayId);
}

/** Current decompressed bytes: the staged working copy, else the stored file decoded. */
export function getOverlayWorkingBytes(project: ProjectState, rom: NintendoDSRom, overlayId: number): Uint8Array {
  const existing = project.overlays[overlayId];
  if (existing?.length) return existing;
  const overlay = loadOverlayTable(projectOverlayTable(project, rom), (_id, fileId) => storedOverlayFile(project, rom, fileId), new Set([overlayId])).get(overlayId);
  if (!overlay) throw new Error(`Overlay ${overlayId} is not in this ROM's overlay table.`);
  return overlay.data;
}

/** Decompressed bytes of the overlay in the loaded ROM, ignoring every staged edit. */
export function getOriginalOverlayBytes(rom: NintendoDSRom, overlayId: number): Uint8Array {
  const overlay = rom.loadArm9Overlays([overlayId]).get(overlayId);
  if (!overlay) throw new Error(`Overlay ${overlayId} is not in the loaded ROM.`);
  return overlay.data;
}

/** Editor tables inside this overlay that export rewrites from their own editor. */
export function overlayTableOwners(project: ProjectState, overlayId: number): string[] {
  const owners: Array<[NarcName, number, string]> = [
    ["grotto_odds", 36, "Hidden Grotto odds"],
    ["tutor_moves", BW2_TUTOR_MOVE_OVERLAY_ID, "Move Tutor"],
    ["move_effects_table", moveEffectHandlerOverlayId(project), "move effect handler"],
    ["type_chart", typeChartOverlayId(project), "Type Chart"],
  ];
  return owners
    .filter(([name, id]) => id === overlayId && project.narcs[name] && !(name === "type_chart" && isRomFsTypeChartStore(project.narcs[name])))
    .map(([, , label]) => label);
}

/** Stage a full decompressed overlay image. Its length must match the RAM image. */
export function applyOverlayBytes(project: ProjectState, rom: NintendoDSRom, overlayId: number, bytes: Uint8Array): void {
  const info = getOverlayInfo(project, rom, overlayId);
  if (!info) throw new Error(`Overlay ${overlayId} is not in this ROM's overlay table.`);
  if (info.readOnlyReason) throw new Error(info.readOnlyReason);
  const current = getOverlayWorkingBytes(project, rom, overlayId);
  if (bytes.length !== current.length) {
    throw new Error(`Overlay ${overlayId} is ${current.length} bytes decompressed; the edit is ${bytes.length} bytes. Overlays cannot change size here.`);
  }
  const changed = countChangedBytes(current, bytes);
  project.overlays[overlayId] = bytes.slice();
  project.patches ??= { dirtyOverlayIds: [], applied: {} };
  if (!project.patches.dirtyOverlayIds.includes(overlayId)) project.patches.dirtyOverlayIds.push(overlayId);
  recordGenericChange(project, "file_system", `Overlay ${overlayId} hex edited (${changed} byte${changed === 1 ? "" : "s"} changed).`, `Overlay ${overlayId}`, {
    key: `overlay-hex:${overlayId}`,
  });
}

/** Import a compressed or decompressed overlay image from disk. */
export function importOverlayBytes(project: ProjectState, rom: NintendoDSRom, overlayId: number, bytes: Uint8Array): { compressed: boolean } {
  const current = getOverlayWorkingBytes(project, rom, overlayId);
  let image = bytes;
  let compressed = false;
  if (bytes.length !== current.length && isCodeCompressed(bytes)) {
    try {
      image = decompressCode(bytes);
      compressed = true;
    } catch (error) {
      throw new Error(`The file could not be decompressed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  applyOverlayBytes(project, rom, overlayId, image);
  return { compressed };
}

/**
 * Put the loaded ROM's original overlay back. This also undoes changes other
 * Pokeweb features made to the same overlay.
 */
export function restoreOriginalOverlay(project: ProjectState, rom: NintendoDSRom, overlayId: number): void {
  const info = getOverlayInfo(project, rom, overlayId);
  if (info?.readOnlyReason) throw new Error(info.readOnlyReason);
  project.overlays[overlayId] = getOriginalOverlayBytes(rom, overlayId).slice();
  if (project.patches) project.patches.dirtyOverlayIds = project.patches.dirtyOverlayIds.filter((id) => id !== overlayId);
  if (project.starters) project.starters.dirtyOverlayIds = project.starters.dirtyOverlayIds.filter((id) => id !== overlayId);
  recordGenericChange(project, "file_system", `Overlay ${overlayId} restored to the loaded ROM's original.`, `Overlay ${overlayId}`, {
    key: `overlay-hex:${overlayId}`,
  });
}

/** Number of bytes that differ from the loaded ROM (0 when nothing is staged). */
export function overlayChangedByteCount(project: ProjectState, rom: NintendoDSRom, overlayId: number): number {
  if (!isOverlayStaged(project, overlayId) || !project.overlays[overlayId]?.length) return 0;
  return countChangedBytes(getOriginalOverlayBytes(rom, overlayId), project.overlays[overlayId]);
}

/** The overlay's stored file, including a raw File System replacement. */
function storedOverlayFile(project: ProjectState, rom: NintendoDSRom, fileId: number): Uint8Array {
  return project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId] ?? new Uint8Array();
}

function countChangedBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}
