import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { invalidateMoveSpaArchiveCache } from "./moveAnimationPreviewModel";
import { loadActiveRomBytes } from "./persistence";
import { parseSpaArchive, serializeSpaArchive, type SpaArchive } from "./nitroSpa";
import { createNarcStore, markDirty, type NarcStore, type ProjectState } from "./projectStore";

const MOVE_SPA_PATH = "a/0/0/6";

export async function ensureMoveSpaStore(project: ProjectState): Promise<NarcStore> {
  const loaded = project.narcs.move_spas;
  if (loaded) return loaded;

  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are unavailable. Reload the ROM before saving SPA edits.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.fileId(MOVE_SPA_PATH);
  const store = createNarcStore("move_spas", MOVE_SPA_PATH, fileId, new NARC(rom.files[fileId]));
  project.narcs.move_spas = store;
  project.session.fileIds.move_spas = fileId;
  return store;
}

export async function updateMoveSpaArchive(project: ProjectState, spaId: number, archive: SpaArchive): Promise<Uint8Array> {
  const bytes = serializeSpaArchive(archive);
  const reparsed = parseSpaArchive(bytes);
  const store = await ensureMoveSpaStore(project);
  ensureMoveSpaSlot(store, spaId);
  store.rawFiles[spaId] = bytes;
  store.records.delete(spaId);
  markDirty(project, "move_spas", spaId);
  archive.rawHeader = reparsed.rawHeader;
  archive.resourceCount = reparsed.resourceCount;
  archive.textureCount = reparsed.textureCount;
  archive.resources = reparsed.resources;
  archive.textures = reparsed.textures;
  archive.warnings = reparsed.warnings;
  invalidateMoveSpaArchiveCache(project, spaId);
  return bytes;
}

export async function copyMoveSpaArchive(project: ProjectState, targetSpaId: number, sourceSpaId: number): Promise<Uint8Array> {
  const store = await ensureMoveSpaStore(project);
  if (!Number.isInteger(sourceSpaId) || sourceSpaId < 0 || sourceSpaId >= store.rawFiles.length) {
    throw new Error(`Move SPA ${sourceSpaId} does not exist in move_spas`);
  }
  ensureMoveSpaSlot(store, targetSpaId);
  const source = store.rawFiles[sourceSpaId];
  if (!source) throw new Error(`Move SPA ${sourceSpaId} does not exist in move_spas`);
  const bytes = source.slice();
  store.rawFiles[targetSpaId] = bytes;
  store.records.delete(targetSpaId);
  markDirty(project, "move_spas", targetSpaId);
  invalidateMoveSpaArchiveCache(project, targetSpaId);
  recordGenericChange(project, "move_spas", `Move SPA ${targetSpaId} copied from SPA ${sourceSpaId}.`, `SPA ${targetSpaId}`, {
    key: `move-spa-copy:${targetSpaId}`,
  });
  return bytes;
}

function ensureMoveSpaSlot(store: NarcStore, spaId: number): void {
  if (!Number.isInteger(spaId) || spaId < 0) throw new Error("Move SPA ID must be a non-negative integer");
  while (store.rawFiles.length <= spaId) store.rawFiles.push(new Uint8Array());
  store.fileCount = store.rawFiles.length;
}

export async function exportMoveSpaArchive(project: ProjectState, spaId: number, archiveOverride?: SpaArchive): Promise<Uint8Array> {
  if (archiveOverride) return serializeSpaArchive(archiveOverride);
  const store = await ensureMoveSpaStore(project);
  const bytes = store.rawFiles[spaId];
  if (!bytes) throw new Error(`Move SPA ${spaId} does not exist in move_spas`);
  return bytes.slice();
}
