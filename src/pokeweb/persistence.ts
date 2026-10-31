import { hydrateMoveEffectsSource } from "./moveEffectsModel";
import { hydrateAbilityEffectsSource } from "./abilityEffectsModel";
import { hydrateTrainerFieldConditionsSources } from "./trainerFieldConditionsModel";
import { hydrateItemEffectsSource } from "./itemEffectsModel";
import type { ProjectState } from "./projectStore";
import { ProjectSaveQueue, createProjectSaveScheduler, type ProjectSaveScheduler } from "./projectSaveScheduler";
import { createProjectDocument, readProjectDocument, type ProjectDocument } from "./projectDocument";
import { openProjectSession, refreshProjectSessionIndexes } from "./projectSession";
import { cacheBw2ScriptRuntimeContext } from "./bw2ScriptOverlayContext";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { MOVE_EFFECT_HANDLER_TABLE_LENGTH, moveEffectHandlerOverlayId, moveEffectHandlerTableOffset } from "./moveEffectHandlerModel";
import { BW2_TUTOR_MOVE_OVERLAY_ID, BW2_TUTOR_MOVE_TABLE_LENGTH, tutorMoveTableOffset } from "./tutorMoveModel";
import { hydratePwanAnimationsFromRom } from "./pwanAnimationModel";
import { hydrateW2AnimFromRom } from "./w2animAnimationModel";
import { hydrateKoMoveLearnsetFromRom } from "./koMoveLearnsetModel";
import { hydrateTrainerLocationTables } from "./trainerLocationModel";
import { hydrateCascadePersonalSources } from "./cascadeWhitePersonalModel";
import { hydrateBattleLogInstallMetadata } from "./battleLogModel";
import { isRomFsTypeChartStore, typeChartOverlayId, typeChartTableLength, typeChartTableOffset } from "./typeChartModel";

const DB_NAME = "pokeweb-serverless";
const DB_VERSION = 2;
const PROJECT_STORE_NAME = "projects";
const ROM_STORE_NAME = "roms";
const ACTIVE_PROJECT_KEY = "active";
const ACTIVE_ROM_KEY = "active";
const ACTIVE_ROM_METADATA_KEY = "active-metadata";

export type ActiveRomMetadata = {
  fileName: string;
  fairy: boolean;
  selectedNarcs: string[];
  idCode?: string;
  sourceSize?: number;
  sourceSha256?: string;
};

const projectSaveQueue = new ProjectSaveQueue<ProjectState>(persistActiveProject);

export function saveActiveProject(project: ProjectState): Promise<void> {
  return projectSaveQueue.save(project);
}

async function persistActiveProject(project: ProjectState): Promise<void> {
  const source = project.originalRomBytes;
  if (source) {
    await saveActiveRomBytes(source, activeRomMetadataFromProject(project));
    if (project.originalRomBytes === source) delete project.originalRomBytes;
  }
  const compact = await activeRomMatchesProject(project);
  const db = await openDb();
  try {
    // No await between snapshot construction and put: IndexedDB serializes now.
    const snapshot = persistableProject(project, compact);
    const transaction = db.transaction(PROJECT_STORE_NAME, "readwrite");
    const complete = transactionToPromise(transaction);
    await Promise.all([
      requestToPromise(transaction.objectStore(PROJECT_STORE_NAME).put(snapshot, ACTIVE_PROJECT_KEY)), complete,
    ]);
  } finally { db.close(); }
}

export async function loadActiveProject(): Promise<ProjectState | undefined> {
  const db = await openDb();
  let stored: unknown;
  try {
    stored = await requestToPromise<unknown>(
      db.transaction(PROJECT_STORE_NAME, "readonly").objectStore(PROJECT_STORE_NAME).get(ACTIVE_PROJECT_KEY),
    );
  } finally { db.close(); }
  if (stored === undefined) return undefined;
  const { document, originalRomBytes } = readProjectDocument(stored);
  const project = openProjectSession(document);
  if (originalRomBytes) {
    await saveActiveRomBytes(originalRomBytes, activeRomMetadataFromProject(project));
  }
  await hydratePersistedProject(project, originalRomBytes);
  refreshProjectSessionIndexes(project);
  if (originalRomBytes) await saveActiveProject(project);
  return project;
}

export async function clearActiveProject(): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction([PROJECT_STORE_NAME, ROM_STORE_NAME], "readwrite");
    const complete = transactionToPromise(transaction);
    await Promise.all([
      requestToPromise(transaction.objectStore(PROJECT_STORE_NAME).delete(ACTIVE_PROJECT_KEY)),
      requestToPromise(transaction.objectStore(ROM_STORE_NAME).delete(ACTIVE_ROM_KEY)),
      requestToPromise(transaction.objectStore(ROM_STORE_NAME).delete(ACTIVE_ROM_METADATA_KEY)), complete,
    ]);
  } finally { db.close(); }
}

export async function saveActiveRomBytes(bytes: Uint8Array, metadata?: ActiveRomMetadata): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction(ROM_STORE_NAME, "readwrite");
    const complete = transactionToPromise(transaction);
    const store = transaction.objectStore(ROM_STORE_NAME);
    const requests = [requestToPromise(store.put(bytes, ACTIVE_ROM_KEY)), complete];
    if (metadata) requests.push(requestToPromise(store.put(metadata, ACTIVE_ROM_METADATA_KEY)));
    await Promise.all(requests);
  } finally { db.close(); }
}

/** Reattach a missing export base without discarding the saved project's edits. */
export async function reconnectActiveRom(project: ProjectState, bytes: Uint8Array, fileName: string): Promise<void> {
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  if (rom.idCode !== project.romInfo.idCode || rom.name !== project.romInfo.title ||
      bytes.length !== project.romInfo.size || fileName !== project.romInfo.fileName)
    throw new Error(`Choose the same source ROM, ${project.romInfo.fileName}, to keep this project's edits.`);
  if (project.romInfo.sourceSha256) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== project.romInfo.sourceSha256) throw new Error("The selected ROM differs from this project's source ROM.");
  }
  await saveActiveRomBytes(bytes, activeRomMetadataFromProject(project));
  await hydratePersistedProject(project, bytes);
  refreshProjectSessionIndexes(project);
}

export function compactRomBytes(bytes: Uint8Array): Uint8Array {
  return new NintendoDSRom(bytes).save();
}

export async function loadActiveRomBytes(): Promise<Uint8Array | undefined> {
  const db = await openDb();
  const bytes = await requestToPromise<Uint8Array | undefined>(db.transaction(ROM_STORE_NAME, "readonly").objectStore(ROM_STORE_NAME).get(ACTIVE_ROM_KEY));
  db.close();
  return bytes;
}

export async function loadActiveRomMetadata(): Promise<ActiveRomMetadata | undefined> {
  const db = await openDb();
  const metadata = await requestToPromise<ActiveRomMetadata | undefined>(db.transaction(ROM_STORE_NAME, "readonly").objectStore(ROM_STORE_NAME).get(ACTIVE_ROM_METADATA_KEY));
  db.close();
  return metadata;
}

export async function hasActiveRomBytes(): Promise<boolean> {
  const db = await openDb();
  const count = await requestToPromise<number>(db.transaction(ROM_STORE_NAME, "readonly").objectStore(ROM_STORE_NAME).count(ACTIVE_ROM_KEY));
  db.close();
  return count > 0;
}

/** A second tab may replace the origin-wide ROM cache while this project stays open. */
export async function activeRomMatchesProject(project: ProjectState): Promise<boolean> {
  const db = await openDb();
  try {
    const store = db.transaction(ROM_STORE_NAME, "readonly").objectStore(ROM_STORE_NAME);
    const [metadata, count] = await Promise.all([
      requestToPromise<ActiveRomMetadata | undefined>(store.get(ACTIVE_ROM_METADATA_KEY)),
      requestToPromise<number>(store.count(ACTIVE_ROM_KEY)),
    ]);
    return count > 0 && (!metadata || (
      metadata.fileName === project.romInfo.fileName &&
      (metadata.idCode === undefined || metadata.idCode === project.romInfo.idCode) &&
      (metadata.sourceSize === undefined || metadata.sourceSize === project.romInfo.size) &&
      (metadata.sourceSha256 === undefined || metadata.sourceSha256 === project.romInfo.sourceSha256)
    ));
  } finally {
    db.close();
  }
}

export function debounceProjectSave(
  delayMs = 350,
  callbacks: { onError?: (error: unknown, project: ProjectState) => void; onSaved?: (project: ProjectState) => void } = {},
): ProjectSaveScheduler<ProjectState> {
  return createProjectSaveScheduler(saveActiveProject, { delayMs, ...callbacks });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE_NAME)) db.createObjectStore(PROJECT_STORE_NAME);
      if (!db.objectStoreNames.contains(ROM_STORE_NAME)) db.createObjectStore(ROM_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Build only the persisted shape; the storage boundary owns serialization. */
export function persistableProject(project: ProjectState, compactRawFiles: boolean): ProjectDocument {
  return createProjectDocument(project, compactRawFiles);
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function hydratePersistedProject(project: ProjectState, availableSource?: Uint8Array): Promise<void> {
  if (!await activeRomMatchesProject(project)) return;
  const romBytes = availableSource ?? await loadActiveRomBytes();
  if (!romBytes) return;
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  // Recovery context belongs to an unavailable source. Rebuild it from the
  // verified source now, including for legacy saves that serialized caches.
  delete project.bw2ScriptRuntimeContext;
  const w2anim = hydrateW2AnimFromRom(project, rom);
  hydrateCascadePersonalSources(project, rom);
  hydrateKoMoveLearnsetFromRom(project, rom);
  hydrateTrainerLocationTables(project, rom);
  hydrateTrainerFieldConditionsSources(project, rom);
  hydrateItemEffectsSource(project, rom);
  hydrateAbilityEffectsSource(project, rom);
  hydrateMoveEffectsSource(project, rom);
  if (project.arm9.length === 0) project.arm9 = decompressCode(rom.arm9);
  hydrateBattleLogInstallMetadata(project, rom);
  if (!w2anim && !project.pwanAnimations?.dirty && !project.trainerPwanAnimations?.dirty &&
      (((project.pwanAnimations?.overrides.length ?? 0) === 0 || !project.pwanAnimations?.detectedArchive) ||
       ((project.trainerPwanAnimations?.overrides.length ?? 0) === 0 || !project.trainerPwanAnimations?.detectedArchive))) {
    hydratePwanAnimationsFromRom(project, rom);
  }

  for (const store of Object.values(project.narcs)) {
    if (!store || store.fileId < 0) continue;
    const hasMissingFiles = store.rawFiles.length === 0 || store.rawFiles.some((file) => file.length === 0);
    if (store.container === "file") {
      if (hasMissingFiles) store.rawFiles = [rom.files[store.fileId].slice()];
      store.fileCount = 1;
      continue;
    }
    if (isRomFsTypeChartStore(store)) {
      if (hasMissingFiles) store.rawFiles = [rom.files[store.fileId].slice()];
      store.fileCount = 1;
      continue;
    }
    if (!hasMissingFiles && store.filenames) continue;
    const narc = new NARC(rom.files[store.fileId]);
    if (hasMissingFiles) store.rawFiles = hydrateNarcRawFiles(store.rawFiles, store.dirty, store.fileCount, narc.files);
    store.filenames ??= narc.filenames;
    store.fileCount = store.rawFiles.length;
  }

  const overlayIds: number[] = [];
  if (project.session.baseRom === "BW2" && (project.narcs.items || project.narcs.personal)) overlayIds.push(167);
  const moveEffectOverlayId = moveEffectHandlerOverlayId(project);
  const chartOverlayId = typeChartOverlayId(project);
  if (project.narcs.grotto_odds || project.overlays[36]?.length === 0) overlayIds.push(36);
  if (project.narcs.tutor_moves || project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID]?.length === 0) overlayIds.push(BW2_TUTOR_MOVE_OVERLAY_ID);
  if (project.narcs.move_effects_table || project.overlays[moveEffectOverlayId]?.length === 0) overlayIds.push(moveEffectOverlayId);
  if ((project.narcs.type_chart && !isRomFsTypeChartStore(project.narcs.type_chart)) || project.overlays[chartOverlayId]?.length === 0) overlayIds.push(chartOverlayId);
  for (const overlayId of project.patches?.dirtyOverlayIds ?? []) {
    if (!project.overlays[overlayId] || project.overlays[overlayId]?.length === 0) overlayIds.push(overlayId);
  }
  hydrateMissingOverlays(project, rom, overlayIds);

  hydrateOverlayBackedStore(project, "grotto_odds", 36);
  hydrateOverlayBackedStore(project, "tutor_moves", BW2_TUTOR_MOVE_OVERLAY_ID);
  hydrateOverlayBackedStore(project, "move_effects_table", moveEffectOverlayId);
  hydrateOverlayBackedStore(project, "type_chart", chartOverlayId);
  if (project.narcs.scripts) cacheBw2ScriptRuntimeContext(project, rom);
}

export function hydrateMissingOverlays(project: ProjectState, rom: NintendoDSRom, overlayIds: number[]): void {
  // Overlay-backed tables can request overlays that already contain saved patches.
  const missingIds = [...new Set(overlayIds)].filter((id) => !project.overlays[id]?.length);
  if (missingIds.length === 0) return;
  for (const [id, overlay] of rom.loadArm9Overlays(missingIds)) project.overlays[id] = overlay.data;
}

export function hydrateNarcRawFiles(
  persistedFiles: Uint8Array[],
  dirtyFileIds: ReadonlySet<number>,
  persistedFileCount: number,
  originalFiles: Uint8Array[],
): Uint8Array[] {
  const fileCount = Math.max(persistedFileCount, persistedFiles.length, originalFiles.length);
  return Array.from({ length: fileCount }, (_unused, index) => {
    const persisted = persistedFiles[index];
    // The caller transfers ownership of deserialized and freshly parsed bytes.
    // NARC already owns each member; copying again doubles restore allocations.
    if (dirtyFileIds.has(index)) return persisted ?? new Uint8Array();
    if (persisted?.length) return persisted;
    return originalFiles[index] ?? new Uint8Array();
  });
}

function activeRomMetadataFromProject(project: ProjectState): ActiveRomMetadata {
  return {
    fileName: project.romInfo.fileName || `${project.session.romName || "cached-rom"}.nds`,
    fairy: project.session.fairy,
    selectedNarcs: Object.keys(project.narcs).filter((name) => Boolean(project.narcs[name as keyof ProjectState["narcs"]])),
    idCode: project.romInfo.idCode,
    sourceSize: project.romInfo.size,
    sourceSha256: project.romInfo.sourceSha256,
  };
}

function hydrateOverlayBackedStore(project: ProjectState, name: "grotto_odds" | "tutor_moves" | "move_effects_table" | "type_chart", overlayId: number): void {
  const store = project.narcs[name];
  const overlay = project.overlays[overlayId];
  if (isRomFsTypeChartStore(store)) return;
  if (!store || !overlay || (store.rawFiles[0]?.length ?? 0) > 0) return;
  const offset = overlayTableOffset(project, name, overlay);
  const length = name === "grotto_odds" ? 200 : name === "tutor_moves" ? BW2_TUTOR_MOVE_TABLE_LENGTH : name === "type_chart" ? typeChartTableLength(project) : MOVE_EFFECT_HANDLER_TABLE_LENGTH;
  store.rawFiles = [overlay.slice(offset, offset + length)];
}

function overlayTableOffset(project: ProjectState, name: "grotto_odds" | "tutor_moves" | "move_effects_table" | "type_chart", overlay: Uint8Array): number {
  if (name === "grotto_odds") return project.session.baseVersion === "B2" ? 0x00055218 : 0x00055218 - 12;
  if (name === "tutor_moves") return tutorMoveTableOffset(project.session.baseVersion);
  if (name === "type_chart") return typeChartTableOffset(project, overlay);
  return moveEffectHandlerTableOffset(project);
}
