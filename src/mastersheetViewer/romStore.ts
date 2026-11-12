/**
 * Remembers the ROM a player opened in the Mastersheet Viewer, so a refresh reopens it instead of asking again.
 * The file is kept in this browser's IndexedDB as a Blob (the browser stores it on disk; it isn't read into
 * memory until it's reopened). One ROM is kept at a time; opening another replaces it.
 */

export type StoredRom = { name: string; file: Blob; cacheKey: string; savedAt: number };

const DB_NAME = "pokeweb-mastersheet-viewer";
const STORE = "roms";
const KEY = "last";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("IndexedDB request failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB request was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function saveLastRom(rom: Omit<StoredRom, "savedAt">): Promise<void> {
  await run<IDBValidKey>("readwrite", (store) => store.put({ ...rom, savedAt: Date.now() } satisfies StoredRom, KEY));
}

export async function loadLastRom(): Promise<StoredRom | undefined> {
  try {
    const value = await run<StoredRom | undefined>("readonly", (store) => store.get(KEY));
    return value && value.file instanceof Blob && typeof value.name === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function clearLastRom(): Promise<void> {
  try {
    await run<undefined>("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or storage is blocked: either way there's nothing to reopen.
  }
}
