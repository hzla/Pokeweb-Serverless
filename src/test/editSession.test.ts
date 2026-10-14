import { describe, expect, it, vi } from "vitest";
import { makeEditProject } from "./fixtures/editProject";
import { projectEditSession } from "../pokeweb/editSession";
import { getMoveRecord, getItemRecord, prepareMoveField, updateMoveField, updateItemField, updateItemPackedField } from "../pokeweb/moveItemModel";
import { undoActionChange } from "../pokeweb/actionUndo";
import { persistableProject } from "../pokeweb/persistence";

describe("project edit commits", () => {
  it("prepares privately and preserves live record and unrelated buffer identities", () => {
    const project = makeEditProject(), session = projectEditSession(project);
    const record = getMoveRecord(project, 1), originalRaw = record.raw;
    const unrelated = project.narcs.items!.rawFiles;
    const prepared = prepareMoveField(project, 1, "power", "90");
    expect(record.raw.power).toBe(40);
    expect(project.narcs.moves!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
    const observer = vi.fn(); session.subscribe(observer);
    expect(session.commit(prepared)).toEqual({ value: 90, rawValue: 90 });
    expect(record.raw).toBe(originalRaw);
    expect(record.raw.power).toBe(90);
    expect(project.narcs.items!.rawFiles).toBe(unrelated);
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0]).toEqual({ revision: 1, targets: [{ name: "moves", id: 1 }], copiedBytes: 0 });
  });

  it("does not publish anything when any prepared target is invalid", () => {
    const project = makeEditProject(), record = getMoveRecord(project, 1), session = projectEditSession(project);
    expect(() => session.commit({ result: undefined, records: [{ name: "moves", id: 1, raw: { power: 99 } }],
      binaries: [{ name: "items", id: 999, bytes: Uint8Array.of(9) }] })).toThrow(/Missing edit target/);
    expect(record.raw.power).toBe(40);
    expect(project.narcs.moves!.dirty.size).toBe(0);
    expect(session.revision).toBe(0);
  });

  it("rejects invalid inputs without mutating authored data or scheduling commits", () => {
    const project = makeEditProject(), record = getMoveRecord(project, 1), observer = vi.fn();
    projectEditSession(project).subscribe(observer);
    const before = { ...record.raw };
    expect(() => updateMoveField(project, 1, "power", "256")).toThrow();
    expect(() => updateMoveField(project, 1, "type", "Unknown")).toThrow();
    expect(() => updateMoveField(project, 1, "animation", "999")).toThrow();
    expect(record.raw).toEqual(before);
    expect(project.actionChangelog).toBeUndefined();
    expect(observer).not.toHaveBeenCalled();
  });

  it("normalizes no-ops without revisions, dirty flags, or changelog entries", () => {
    const project = makeEditProject(), session = projectEditSession(project), observer = vi.fn();
    session.subscribe(observer);
    updateMoveField(project, 1, "power", " 040 ");
    updateMoveField(project, 1, "type", "normal");
    updateItemField(project, 1, "market_value", "0300");
    updateItemPackedField(project, 1, "type_attribute", "important_item", false);
    expect(session.revision).toBe(0);
    expect(project.narcs.moves!.revision).toBeUndefined();
    expect(project.narcs.items!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
    expect(observer).not.toHaveBeenCalled();
  });

  it("deduplicates store revisions and emits one event for a multi-record commit", () => {
    const project = makeEditProject(), session = projectEditSession(project), observer = vi.fn();
    getMoveRecord(project, 0); getMoveRecord(project, 1); session.subscribe(observer);
    session.commit({ result: true, records: [{ name: "moves", id: 0, raw: { power: 10 } },
      { name: "moves", id: 1, raw: { power: 90 } }, { name: "moves", id: 1, raw: { pp: 20 } }] });
    expect(project.narcs.moves!.revision).toBe(1);
    expect([...project.narcs.moves!.dirty]).toEqual([0, 1]);
    expect(observer).toHaveBeenCalledOnce();
  });

  it("preserves packed bits and derived values", () => {
    const project = makeEditProject();
    updateMoveField(project, 1, "min_hits", "2");
    updateMoveField(project, 1, "sound_move", true);
    updateMoveField(project, 1, "magnitude_1", "-3");
    const move = getMoveRecord(project, 1);
    expect(move.raw.hits).toBe(0x32);
    expect(move.readable.contact).toBe(1);
    expect(move.readable.sound_move).toBe(1);
    expect(move.raw.magnitude_1).toBe(253);
    updateItemPackedField(project, 1, "type_attribute", "field_pocket", "7");
    updateItemPackedField(project, 1, "type_attribute", "important_item", true);
    expect(getItemRecord(project, 1).raw.type_attribute).toBe((7 << 7) | (1 << 5));
  });

  it("commits animation replacement and its changelog once without dirtying moves", () => {
    const project = makeEditProject(), session = projectEditSession(project), observer = vi.fn();
    const store = project.narcs.move_animations!, source = store.rawFiles[2];
    store.records.set(1, { id: 1, bytes: store.rawFiles[1], raw: {}, readable: {} });
    session.subscribe(observer);
    updateMoveField(project, 1, "animation", "2");
    expect(store.rawFiles[1]).toEqual(source);
    expect(store.rawFiles[1]).not.toBe(source);
    expect(store.records.has(1)).toBe(false);
    expect(project.narcs.moves!.dirty.size).toBe(0);
    expect(store.revision).toBe(1);
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0].targets).toEqual([{ name: "move_animations", id: 1 }]);
    expect(observer.mock.calls[0][0].copiedBytes).toBe(source.byteLength);
    const replacement = store.rawFiles[1];
    updateMoveField(project, 1, "animation", "2");
    expect(store.rawFiles[1]).toBe(replacement);
    expect(observer).toHaveBeenCalledOnce();
  });

  it("routes expanded animation slots through the existing layout rules", () => {
    const project = makeEditProject();
    project.narcs.moves!.rawFiles[673] = project.narcs.moves!.rawFiles[1].slice();
    project.narcs.moves!.fileCount = 674;
    updateMoveField(project, 673, "animation", "2");
    expect(project.narcs.battle_animations!.rawFiles[112]).toEqual(Uint8Array.of(2));
    expect(project.narcs.battle_animations!.dirty.has(112)).toBe(true);
  });

  it("preserves existing changelog undo through the commit boundary", () => {
    const project = makeEditProject(), session = projectEditSession(project);
    updateMoveField(project, 1, "power", "90");
    const entry = project.actionChangelog!.entries.find(entry => entry.key === "move:1:power")!;
    undoActionChange(project, entry);
    expect(getMoveRecord(project, 1).raw.power).toBe(40);
    expect(session.revision).toBe(2);
    expect(project.actionChangelog!.entries.some(entry => entry.key === "move:1:power")).toBe(false);
  });

  it("isolates project subscriptions and supports cleanup", () => {
    const a = makeEditProject(), b = makeEditProject(), observer = vi.fn();
    const unsubscribe = projectEditSession(a).subscribe(observer);
    updateMoveField(b, 1, "power", "90");
    expect(observer).not.toHaveBeenCalled();
    unsubscribe(); updateMoveField(a, 1, "power", "90");
    expect(observer).not.toHaveBeenCalled();
    expect(Object.keys(a)).not.toContain("editSession");
  });
});

describe("compact snapshot construction", () => {
  it("omits caches before serialization and shares only retained buffers", () => {
    const project = makeEditProject();
    project.originalRomBytes = new Uint8Array(1024 * 1024);
    project.arm9 = new Uint8Array(1024);
    project.overlays = { 36: new Uint8Array(1024), 167: Uint8Array.of(7) };
    project.patches = { dirtyOverlayIds: [167] };
    updateMoveField(project, 1, "power", "90");
    const clone = vi.spyOn(globalThis, "structuredClone").mockImplementation(() => { throw new Error("Unexpected copy"); });
    try {
      const snapshot = persistableProject(project, true);
      expect(snapshot).not.toHaveProperty("originalRomBytes");
      expect(snapshot.arm9.byteLength).toBe(0);
      expect(snapshot.overlays[36]).toBeUndefined();
      expect(snapshot.overlays[167]).toBe(project.overlays[167]);
      expect(snapshot.narcs.moves).not.toHaveProperty("records");
      expect(snapshot.narcs.moves!.rawFiles[0].byteLength).toBe(0);
      expect(snapshot.narcs.moves!.rawFiles[1]).toBe(project.narcs.moves!.rawFiles[1]);
      expect(project.narcs.moves!.records.size).toBe(1);
      expect(project.originalRomBytes.byteLength).toBe(1024 * 1024);
    } finally { clone.mockRestore(); }
  });

  it("retains recovery data and intentionally empty dirty entries", () => {
    const project = makeEditProject();
    project.narcs.moves!.rawFiles[0] = new Uint8Array();
    project.narcs.moves!.dirty.add(0);
    const recovery = persistableProject(project, false), compact = persistableProject(project, true);
    expect(recovery.narcs.items!.rawFiles).toBe(project.narcs.items!.rawFiles);
    expect(compact.narcs.moves!.dirty.has(0)).toBe(true);
    expect(compact.narcs.moves!.rawFiles[0]).toBe(project.narcs.moves!.rawFiles[0]);
  });
});
