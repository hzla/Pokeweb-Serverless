import { readU32, writeU32 } from "../nds/binary";
import { setArm9CompressedStaticEnd } from "../nds/arm9ModuleParams";
import { compressCode, isCodeCompressed } from "../nds/codeCompression";
import { addFilePath, cloneFolder, type Folder, shiftFileIdsAtOrAfter } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NarcName } from "./constants";
import { loadActiveRomBytes } from "./persistence";
import { materializeMap3dAreaEdits } from "./map3dModel";
import { repairLegacyMoveAnimationArchives } from "./moveAnimationModel";
import { materializeProjectEdits } from "./projectMaterialize";
import { fileSystemAddedFiles, fileSystemReplacementMap } from "./fileSystemModel";
import { buildCodeInjectionOverlayTable, codeInjectionInsertedFiles, pruneRedundantPatchesKeepAddition } from "./pmcModel";
import { materializePwanAnimations } from "./pwanAnimationModel";
import { getDirtyStarterOverlayIds } from "./starterModel";
import { getDirtyPatchOverlayIds } from "./romPatchModel";
import { moveEffectHandlerOverlayId, moveEffectHandlerTableOffset } from "./moveEffectHandlerModel";
import { isRomFsTypeChartStore, typeChartTableOffset } from "./typeChartModel";
import { repairNarcBytes } from "./romRepairModel";
import type { ProjectState } from "./projectStore";

export { materializeProjectEdits } from "./projectMaterialize";

export type ExportModifiedRomOptions = {
  minimumRomLength?: number;
  preserveOriginalLength?: boolean;
};

type PlannedRomAdditions = {
  insertedFiles: Array<{ fileId: number; path: string; bytes: Uint8Array }>;
  addedFiles: Array<{ path: string; bytes: Uint8Array }>;
  pathFileIds: Map<string, number>;
};

export async function exportModifiedRom(project: ProjectState, options: ExportModifiedRomOptions = {}): Promise<Uint8Array> {
  const originalRomBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!originalRomBytes) throw new Error("This saved project does not include the original ROM bytes. Please load the ROM again before exporting.");

  const rom = new NintendoDSRom(originalRomBytes);
  materializeProjectEdits(project);
  repairLegacyMoveAnimationArchives(project);
  await materializePwanAnimations(project, rom);
  pruneRedundantPatchesKeepAddition(project, rom);

  const fileReplacements = new Map<number, Uint8Array>();

  for (const store of Object.values(project.narcs)) {
    if (!store || store.fileId < 0 || store.dirty.size === 0) continue;
    if (isRomFsTypeChartStore(store)) {
      fileReplacements.set(store.fileId, store.rawFiles[0] ?? new Uint8Array());
      continue;
    }
    const source = new NARC(rom.files[store.fileId]);
    source.files = store.rawFiles;
    if (store.filenames) source.filenames = store.filenames;
    fileReplacements.set(store.fileId, source.save());
  }
  const storeFileIds = new Set(Object.values(project.narcs).map((store) => store?.fileId).filter((fileId): fileId is number => fileId !== undefined && fileId >= 0));
  for (const [fileId, bytes] of fileSystemReplacementMap(project)) {
    if (!storeFileIds.has(fileId)) fileReplacements.set(fileId, bytes);
  }
  materializeMap3dAreaEdits(project, rom, fileReplacements);
  normalizeMalformedNarcs(rom, fileReplacements);
  const codeInjectionInsertions = codeInjectionInsertedFiles(project, rom).map((file) => ({ ...file, bytes: normalizeMalformedNarcBytes(file.bytes) }));
  const plannedAdditions = planRomAdditions(
    rom,
    fileSystemAddedFiles(project)
      .filter((file) => !codeInjectionInsertions.some((inserted) => inserted.path === file.path))
      .map((file) => ({ ...file, bytes: normalizeMalformedNarcBytes(file.bytes) })),
  );
  const insertedFiles = [...codeInjectionInsertions, ...plannedAdditions.insertedFiles].sort((a, b) => a.fileId - b.fileId);

  const baseOverlayTable = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
  const patchedOverlayTable = patchOverlayFiles(project, rom, fileReplacements, baseOverlayTable);
  const shiftedOverlayTable = shiftOverlayTableFileIds(patchedOverlayTable ?? baseOverlayTable, insertedFiles);
  const arm9OverlayTable =
    buildCodeInjectionOverlayTable(project, rom, shiftedOverlayTable, (path) => resolvePlannedRomPathFileId(rom, plannedAdditions, insertedFiles, path)) ??
    (patchedOverlayTable || insertedFiles.length > 0 || project.patches?.arm9OverlayTable ? shiftedOverlayTable : undefined);
  const shouldAlignFntFirstFile = codeInjectionInsertions.length > 0;
  const arm9 = project.tms?.dirty || project.arm9Dirty ? prepareArm9ForExport(project, rom) : undefined;
  const out = rom.save({
    arm9,
    arm9OverlayTable,
    alignFntFirstFileToArm9OverlayCount: shouldAlignFntFirstFile,
    files: fileReplacements,
    insertedFiles,
    addedFiles: plannedAdditions.addedFiles,
    minimumLength: options.minimumRomLength,
    preserveOriginalLength: options.preserveOriginalLength,
  });
  return out;
}

function prepareArm9ForExport(project: ProjectState, rom: NintendoDSRom): Uint8Array {
  const shouldCompress = project.arm9Compressed ?? isCodeCompressed(rom.arm9);
  const arm9 = project.arm9.slice();
  if (!shouldCompress) {
    setArm9CompressedStaticEnd(arm9, 0);
    return arm9;
  }

  const compressed = compressCode(arm9, { isArm9: true });
  if (!isCodeCompressed(compressed)) {
    setArm9CompressedStaticEnd(arm9, 0);
    return arm9;
  }
  setArm9CompressedStaticEnd(compressed, rom.arm9RamAddress + compressed.length);
  return compressed;
}

function normalizeMalformedNarcs(rom: NintendoDSRom, fileReplacements: Map<number, Uint8Array>): void {
  for (let fileId = 0; fileId < rom.files.length; fileId += 1) {
    if (!fileReplacements.has(fileId)) normalizeMalformedNarc(fileReplacements, fileId, rom.files[fileId]);
  }
  for (const [fileId, bytes] of [...fileReplacements]) {
    normalizeMalformedNarc(fileReplacements, fileId, bytes);
  }
}

function normalizeMalformedNarc(fileReplacements: Map<number, Uint8Array>, fileId: number, bytes: Uint8Array): void {
  const repair = repairNarcBytes(bytes);
  if (repair.changed) fileReplacements.set(fileId, repair.bytes);
}

function normalizeMalformedNarcBytes(bytes: Uint8Array): Uint8Array {
  return repairNarcBytes(bytes).bytes;
}

function planRomAdditions(rom: NintendoDSRom, additions: Array<{ path: string; bytes: Uint8Array }>): PlannedRomAdditions {
  let filenames = cloneFolder(rom.filenames);
  let fileCount = rom.files.length;
  const insertedFiles: PlannedRomAdditions["insertedFiles"] = [];
  const addedFiles: PlannedRomAdditions["addedFiles"] = [];
  const pathFileIds = new Map<string, number>();

  for (const file of additions) {
    if (shouldInsertIntoExistingPatchesFolder(filenames, file.path, fileCount)) {
      const folder = findRomFolder(filenames, "patches");
      if (!folder) throw new Error(`Cannot find patches folder for ${file.path}`);
      const fileId = folder.firstId + folder.files.length;
      filenames = shiftFileIdsAtOrAfter(filenames, fileId, 1);
      filenames = addFilePath(filenames, file.path, fileId);
      shiftPlannedPathFileIdsAtOrAfter(pathFileIds, fileId);
      insertedFiles.push({ ...file, fileId });
      pathFileIds.set(file.path, fileId);
      fileCount += 1;
      continue;
    }

    const fileId = fileCount;
    filenames = addFilePath(filenames, file.path, fileId);
    addedFiles.push(file);
    pathFileIds.set(file.path, fileId);
    fileCount += 1;
  }

  return { insertedFiles, addedFiles, pathFileIds };
}

function shiftPlannedPathFileIdsAtOrAfter(pathFileIds: Map<string, number>, fileId: number): void {
  for (const [path, existingId] of pathFileIds) {
    if (existingId >= fileId) pathFileIds.set(path, existingId + 1);
  }
}

function shouldInsertIntoExistingPatchesFolder(filenames: Folder, path: string, fileCount: number): boolean {
  if (parentRomPath(path) !== "patches") return false;
  if (filenames.idOf(path) !== undefined) return false;
  const folder = findRomFolder(filenames, "patches");
  if (!folder || folder.files.length === 0) return false;
  return folder.firstId + folder.files.length < fileCount;
}

function resolvePlannedRomPathFileId(
  rom: NintendoDSRom,
  additions: PlannedRomAdditions,
  insertedFiles: Array<{ fileId: number }>,
  path: string,
): number | undefined {
  const addedId = additions.pathFileIds.get(path);
  if (addedId !== undefined) return addedId;
  const existingId = rom.filenames.idOf(path);
  return existingId === undefined ? undefined : shiftFileIdForInsertions(existingId, insertedFiles);
}

function shiftFileIdForInsertions(fileId: number, insertedFiles: Array<{ fileId: number }>): number {
  let shifted = fileId;
  for (const inserted of [...insertedFiles].sort((a, b) => a.fileId - b.fileId)) {
    if (shifted >= inserted.fileId) shifted += 1;
  }
  return shifted;
}

function shiftOverlayTableFileIds(table: Uint8Array, insertedFiles: Array<{ fileId: number }>): Uint8Array {
  if (insertedFiles.length === 0) return table;
  const out = table.slice();
  for (let offset = 0; offset + 32 <= out.length; offset += 32) {
    writeU32(out, offset + 24, shiftFileIdForInsertions(readU32(out, offset + 24), insertedFiles));
  }
  return out;
}

function findRomFolder(root: Folder, path: string): Folder | undefined {
  let folder: Folder | undefined = root;
  for (const part of path.split("/").filter(Boolean)) {
    folder = folder?.folders.find(([name]) => name === part)?.[1];
    if (!folder) return undefined;
  }
  return folder;
}

function parentRomPath(path: string): string {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

function patchOverlayFiles(project: ProjectState, rom: NintendoDSRom, fileReplacements: Map<number, Uint8Array>, baseTable: Uint8Array): Uint8Array | undefined {
  const overlayReplacements = new Map<number, Uint8Array>();
  patchOverlayBackedStore(project, "grotto_odds", 36, overlayReplacements);
  patchOverlayBackedStore(project, "move_effects_table", moveEffectHandlerOverlayId(project), overlayReplacements);
  patchOverlayBackedStore(project, "type_chart", 167, overlayReplacements);
  for (const overlayId of getDirtyStarterOverlayIds(project)) {
    const overlay = project.overlays[overlayId];
    if (overlay) overlayReplacements.set(overlayId, overlay);
  }
  for (const overlayId of getDirtyPatchOverlayIds(project)) {
    const overlay = project.overlays[overlayId];
    if (overlay) overlayReplacements.set(overlayId, overlay);
  }
  if (overlayReplacements.size === 0) return undefined;

  const table = baseTable.slice();
  for (let offset = 0; offset + 32 <= table.length; offset += 32) {
    const overlayId = readU32(table, offset);
    const data = overlayReplacements.get(overlayId);
    if (!data) continue;
    const fileId = readU32(table, offset + 24);
    const compressedSizeFlags = readU32(table, offset + 28);
    const flags = compressedSizeFlags >>> 24;
    fileReplacements.set(fileId, data);
    writeU32(table, offset + 8, data.length);
    writeU32(table, offset + 28, (flags & ~1) << 24);
  }
  return table;
}

function patchOverlayBackedStore(project: ProjectState, name: NarcName, overlayId: number, overlayReplacements: Map<number, Uint8Array>): void {
  const store = project.narcs[name];
  const overlay = project.overlays[overlayId];
  if (!store || !overlay || store.dirty.size === 0) return;
  if (isRomFsTypeChartStore(store)) return;
  const match = /^overlay\d+:(.+)$/u.exec(store.sourcePath);
  if (!match) return;
  const offset = overlayTableOffset(project, name, overlay);
  if (offset === undefined) return;
  const out = overlay.slice();
  out.set(store.rawFiles[0] ?? new Uint8Array(), offset);
  project.overlays[overlayId] = out;
  overlayReplacements.set(overlayId, out);
}

function overlayTableOffset(project: ProjectState, name: NarcName, overlay: Uint8Array): number | undefined {
  if (name === "grotto_odds") return project.session.baseVersion === "B2" ? 0x00055218 : 0x00055218 - 12;
  if (name === "move_effects_table") return moveEffectHandlerTableOffset(project);
  if (name === "type_chart") return typeChartTableOffset(project, overlay);
  return undefined;
}
