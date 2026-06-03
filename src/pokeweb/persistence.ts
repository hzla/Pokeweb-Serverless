import type { ProjectState } from "./projectStore";
import { materializeProjectEdits } from "./projectMaterialize";
import { decompressCode } from "../nds/codeCompression";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { MOVE_EFFECT_HANDLER_TABLE_LENGTH, moveEffectHandlerOverlayId, moveEffectHandlerTableOffset } from "./moveEffectHandlerModel";
import { typeChartTableLength, typeChartTableOffset } from "./typeChartModel";

const DB_NAME = "pokeweb-serverless";
const DB_VERSION = 2;
const PROJECT_STORE_NAME = "projects";
const ROM_STORE_NAME = "roms";
const ACTIVE_PROJECT_KEY = "active";
const ACTIVE_ROM_KEY = "active";

export async function saveActiveProject(project: ProjectState): Promise<void> {
  if (project.originalRomBytes) {
    await saveActiveRomBytes(project.originalRomBytes);
    delete project.originalRomBytes;
  }
  materializeProjectEdits(project);
  const snapshot = persistableProject(project, await hasActiveRomBytes());
  const db = await openDb();
  await requestToPromise(db.transaction(PROJECT_STORE_NAME, "readwrite").objectStore(PROJECT_STORE_NAME).put(snapshot, ACTIVE_PROJECT_KEY));
  db.close();
}

export async function loadActiveProject(): Promise<ProjectState | undefined> {
  const db = await openDb();
  const project = await requestToPromise<ProjectState | undefined>(
    db.transaction(PROJECT_STORE_NAME, "readonly").objectStore(PROJECT_STORE_NAME).get(ACTIVE_PROJECT_KEY),
  );
  db.close();
  let migratedOriginalRomBytes = false;
  if (project?.originalRomBytes) {
    await saveActiveRomBytes(project.originalRomBytes);
    delete project.originalRomBytes;
    migratedOriginalRomBytes = true;
  }
  if (project) await hydratePersistedProject(project);
  if (project && migratedOriginalRomBytes) await saveActiveProject(project);
  return project;
}

export async function clearActiveProject(): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([PROJECT_STORE_NAME, ROM_STORE_NAME], "readwrite");
  await Promise.all([
    requestToPromise(transaction.objectStore(PROJECT_STORE_NAME).delete(ACTIVE_PROJECT_KEY)),
    requestToPromise(transaction.objectStore(ROM_STORE_NAME).delete(ACTIVE_ROM_KEY)),
  ]);
  db.close();
}

export async function saveActiveRomBytes(bytes: Uint8Array): Promise<void> {
  const compactBytes = compactRomBytes(bytes);
  const db = await openDb();
  await requestToPromise(db.transaction(ROM_STORE_NAME, "readwrite").objectStore(ROM_STORE_NAME).put(compactBytes, ACTIVE_ROM_KEY));
  db.close();
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

export async function hasActiveRomBytes(): Promise<boolean> {
  const db = await openDb();
  const count = await requestToPromise<number>(db.transaction(ROM_STORE_NAME, "readonly").objectStore(ROM_STORE_NAME).count(ACTIVE_ROM_KEY));
  db.close();
  return count > 0;
}

export function debounceProjectSave(delayMs = 350): (project: ProjectState) => void {
  let timer: number | undefined;
  return (project: ProjectState) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void saveActiveProject(project);
    }, delayMs);
  };
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

function persistableProject(project: ProjectState, compactRawFiles: boolean): ProjectState {
  const snapshot = structuredClone(project);
  delete snapshot.originalRomBytes;
  delete snapshot.headers;
  delete snapshot.grottoOdds;
  delete snapshot.texts.messageTexts;
  delete snapshot.texts.storyTexts;
  if (compactRawFiles && !snapshot.tms?.dirty && !snapshot.arm9Dirty) snapshot.arm9 = new Uint8Array();
  if (compactRawFiles) {
    const dirtyPatchOverlayIds = new Set(snapshot.patches?.dirtyOverlayIds ?? []);
    snapshot.overlays = Object.fromEntries(
      Object.entries(snapshot.overlays).filter(([overlayId]) => dirtyPatchOverlayIds.has(Number(overlayId))),
    );
  }
  for (const store of Object.values(snapshot.narcs)) {
    if (!store) continue;
    store.records = new Map();
    if (compactRawFiles) {
      store.rawFiles = store.rawFiles.map((file, index) => (store.dirty.has(index) ? file : new Uint8Array()));
    }
  }
  return snapshot;
}

async function hydratePersistedProject(project: ProjectState): Promise<void> {
  const romBytes = await loadActiveRomBytes();
  if (!romBytes) return;
  const rom = new NintendoDSRom(romBytes);
  if (project.arm9.length === 0) project.arm9 = decompressCode(rom.arm9);

  for (const store of Object.values(project.narcs)) {
    if (!store || store.fileId < 0) continue;
    const hasMissingFiles = store.rawFiles.length === 0 || store.rawFiles.some((file) => file.length === 0);
    if (!hasMissingFiles && store.filenames) continue;
    const narc = new NARC(rom.files[store.fileId]);
    if (hasMissingFiles) store.rawFiles = narc.files.map((file, index) => (store.rawFiles[index]?.length ? store.rawFiles[index] : file));
    store.filenames ??= narc.filenames;
    store.fileCount = store.rawFiles.length;
  }

  const overlayIds: number[] = [];
  const moveEffectOverlayId = moveEffectHandlerOverlayId(project);
  if (project.narcs.grotto_odds || project.overlays[36]?.length === 0) overlayIds.push(36);
  if (project.narcs.move_effects_table || project.overlays[moveEffectOverlayId]?.length === 0) overlayIds.push(moveEffectOverlayId);
  if (project.narcs.type_chart || project.overlays[167]?.length === 0) overlayIds.push(167);
  for (const overlayId of project.patches?.dirtyOverlayIds ?? []) {
    if (!project.overlays[overlayId] || project.overlays[overlayId]?.length === 0) overlayIds.push(overlayId);
  }
  if (overlayIds.length > 0) {
    const overlays = rom.loadArm9Overlays([...new Set(overlayIds)]);
    for (const [id, overlay] of overlays) project.overlays[id] = overlay.data;
  }

  hydrateOverlayBackedStore(project, "grotto_odds", 36);
  hydrateOverlayBackedStore(project, "move_effects_table", moveEffectOverlayId);
  hydrateOverlayBackedStore(project, "type_chart", 167);
}

function hydrateOverlayBackedStore(project: ProjectState, name: "grotto_odds" | "move_effects_table" | "type_chart", overlayId: number): void {
  const store = project.narcs[name];
  const overlay = project.overlays[overlayId];
  if (!store || !overlay || (store.rawFiles[0]?.length ?? 0) > 0) return;
  const offset = overlayTableOffset(project, name, overlay);
  const length = name === "grotto_odds" ? 200 : name === "type_chart" ? typeChartTableLength(project) : MOVE_EFFECT_HANDLER_TABLE_LENGTH;
  store.rawFiles = [overlay.slice(offset, offset + length)];
}

function overlayTableOffset(project: ProjectState, name: "grotto_odds" | "move_effects_table" | "type_chart", overlay: Uint8Array): number {
  if (name === "grotto_odds") return project.session.baseVersion === "B2" ? 0x00055218 : 0x00055218 - 12;
  if (name === "type_chart") return typeChartTableOffset(project, overlay);
  return moveEffectHandlerTableOffset(project);
}
