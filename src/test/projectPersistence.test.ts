import { afterEach, describe, expect, it, vi } from "vitest";
import { loadActiveProject, saveActiveProject, saveActiveRomBytes } from "../pokeweb/persistence";
import { createProjectDocument, type ProjectDocument } from "../pokeweb/projectDocument";
import { updateMoveField, getMoveRecord } from "../pokeweb/moveItemModel";
import { makeEditProject } from "./fixtures/editProject";

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const data: Record<string, Map<IDBValidKey, unknown>> = { projects: new Map(), roms: new Map() };
  const writes: Array<{ transaction: IDBTransaction; complete: () => void; abort: () => void }> = [];
  let manual = true;
  const request = <T>(result: T): IDBRequest<T> => {
    const value = { result } as IDBRequest<T>;
    queueMicrotask(() => value.onsuccess?.(new Event("success")));
    return value;
  };
  const db = {
    close() {},
    transaction(_names: string | string[], mode?: string) {
      const pending: Array<() => void> = [];
      const transaction = {
        objectStore(name: string) {
          return {
            get: (key: IDBValidKey) => request(structuredClone(data[name].get(key))),
            count: (key: IDBValidKey) => request(Number(data[name].has(key))),
            put(value: unknown, key: IDBValidKey) {
              const snapshot = structuredClone(value);
              pending.push(() => data[name].set(key, snapshot));
              return request(key);
            },
          };
        },
      } as unknown as IDBTransaction;
      const complete = () => { pending.forEach(apply => apply()); transaction.oncomplete?.(new Event("complete")); };
      const abort = () => transaction.onabort?.(new Event("abort"));
      if (mode === "readwrite") { writes.push({ transaction, complete, abort }); if (!manual) setTimeout(complete, 0); }
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", { open: () => request(db) });
  return { data, writes, automatic: () => { manual = false; } };
}

describe("durable project persistence", () => {
  it("does not report success after put until the transaction commits", async () => {
    const db = storage(); let saved = false;
    const writing = saveActiveRomBytes(Uint8Array.of(1)).then(() => { saved = true; });
    await vi.waitFor(() => expect(db.writes).toHaveLength(1));
    expect(saved).toBe(false); expect(db.data.roms.has("active")).toBe(false);
    db.writes[0].complete(); await writing;
    expect(saved).toBe(true); expect(db.data.roms.get("active")).toEqual(Uint8Array.of(1));
  });

  it("rejects a transaction abort even after its requests succeed", async () => {
    const db = storage(), writing = saveActiveRomBytes(Uint8Array.of(1));
    const rejected = expect(writing).rejects.toThrow(/aborted/);
    await vi.waitFor(() => expect(db.writes).toHaveLength(1));
    db.writes[0].abort(); await rejected;
    expect(db.data.roms.has("active")).toBe(false);
  });

  it("retains source bytes when their write fails and can retry", async () => {
    const db = storage(), project = makeEditProject(), source = Uint8Array.of(1, 2, 3);
    project.originalRomBytes = source;
    const writing = saveActiveProject(project), rejected = expect(writing).rejects.toThrow(/aborted/);
    await vi.waitFor(() => expect(db.writes).toHaveLength(1));
    db.writes[0].abort(); await rejected;
    expect(project.originalRomBytes).toBe(source);
    db.automatic(); await saveActiveProject(project);
    expect(project.originalRomBytes).toBeUndefined();
    expect(db.data.roms.get("active")).toEqual(source);
    expect(db.data.projects.has("active")).toBe(true);
  });

  it("retains field edits after a project abort and retries the latest values", async () => {
    const db = storage(), project = makeEditProject();
    updateMoveField(project, 1, "power", "90");
    const writing = saveActiveProject(project), rejected = expect(writing).rejects.toThrow(/aborted/);
    await vi.waitFor(() => expect(db.writes).toHaveLength(1));
    db.writes[0].abort(); await rejected;
    expect(getMoveRecord(project, 1).raw.power).toBe(90);
    expect(project.narcs.moves!.dirty.has(1)).toBe(true);
    updateMoveField(project, 1, "power", "91");
    db.automatic(); await saveActiveProject(project);
    const restored = db.data.projects.get("active") as ProjectDocument;
    expect(restored.narcs.moves!.rawFiles[1]).toEqual(project.narcs.moves!.rawFiles[1]);
    expect(restored.narcs.moves).not.toHaveProperty("records");
    const reopened = (await loadActiveProject())!;
    expect(getMoveRecord(reopened, 1).raw.power).toBe(91);
    expect(reopened.narcs.moves!.dirty.has(1)).toBe(true);
  });

  it("refuses unsupported documents without overwriting stored edits or the source", async () => {
    const db = storage();
    const future = { ...createProjectDocument(makeEditProject(), false), version: 99 };
    db.data.projects.set("active", future);
    db.data.roms.set("active", Uint8Array.of(1));
    await expect(loadActiveProject()).rejects.toThrow(/version 99 is not supported/);
    expect(db.writes).toHaveLength(0);
    expect(db.data.projects.get("active")).toBe(future);
    expect(db.data.roms.get("active")).toEqual(Uint8Array.of(1));
  });

  it("opens legacy projects without eagerly rewriting or retaining their caches", async () => {
    const db = storage(), legacy = makeEditProject();
    updateMoveField(legacy, 1, "power", "92");
    db.data.projects.set("active", legacy);
    const reopened = (await loadActiveProject())!;
    expect(db.writes).toHaveLength(0);
    expect(reopened.narcs.moves!.records.size).toBe(0);
    expect(getMoveRecord(reopened, 1).raw.power).toBe(92);
    db.automatic(); await saveActiveProject(reopened);
    const saved = db.data.projects.get("active") as ProjectDocument;
    expect(saved.format).toBe("pokeweb.project");
    expect(saved.version).toBe(1);
    expect(saved.narcs.moves).not.toHaveProperty("records");
  });
});
