import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { makePaddedRom } from "./fixtures/projectRom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { activeRomMatchesProject, loadActiveProject, loadActiveRomBytes, loadActiveRomMetadata, reconnectActiveRom, saveActiveProject, saveActiveRomBytes } from "../pokeweb/persistence";

const selectedNarcs = ["personal"] as const;
let stores: Record<string, Map<IDBValidKey, unknown>>;

beforeEach(() => {
  stores = { projects: new Map(), roms: new Map() };
  // Only the storage boundary is substituted; parsing, snapshotting,
  // hydration, and export use their real implementations.
  const db = {
    transaction: (name: string) => {
      const transaction = {
      objectStore: () => ({
        put: (value: unknown, key: IDBValidKey) => {
          stores[name].set(key, structuredClone(value));
          return successfulRequest(key);
        },
        get: (key: IDBValidKey) => successfulRequest(structuredClone(stores[name].get(key))),
        count: (key: IDBValidKey) => successfulRequest(Number(stores[name].has(key))),
      }),
      } as unknown as IDBTransaction;
      setTimeout(() => transaction.oncomplete?.(new Event("complete")), 0);
      return transaction;
    },
    close: () => {},
  };
  vi.stubGlobal("indexedDB", { open: () => successfulRequest(db) });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ROM import and persistence without rebuilding", () => {
  it("retains the exact padded US Black 2 input and hash without rebuilding or copying for hashing", async () => {
    const source = makePaddedRom("IREO");
    const original = source.slice();
    const save = vi.spyOn(NintendoDSRom.prototype, "save");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");

    const project = await loadProjectFromRomBytes(source, "padded.nds", { selectedNarcs: [...selectedNarcs] });

    expect(save).not.toHaveBeenCalled();
    expect(project.originalRomBytes).toBe(source);
    expect(source).toEqual(original);
    expect(project.romInfo.size).toBe(source.length);
    expect(project.romInfo.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(digest).toHaveBeenCalledTimes(1);
    expect((digest.mock.calls[0][1] as Uint8Array).buffer).toBe(source.buffer);
  });

  it.each(["IRDO", "IRAO", "IRBO", "IREP"])("skips hashing unrelated ROM %s", async (idCode) => {
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(new Error("Hashing must be skipped"));
    const source = makePaddedRom(idCode);

    const project = await loadProjectFromRomBytes(source, "unrelated.nds", { selectedNarcs: [...selectedNarcs] });

    expect(digest).not.toHaveBeenCalled();
    expect(project.romInfo.sourceSha256).toBeUndefined();
    expect(project.originalRomBytes).toBe(source);
    expect(project.narcs.personal!.rawFiles[0][0]).toBe(45);
  });

  it("hashes only the supplied US Black 2 view, without copying its backing buffer", async () => {
    const rom = makePaddedRom("IREO");
    const backing = new Uint8Array(rom.length + 96).fill(0x5a);
    const source = backing.subarray(32, 32 + rom.length);
    source.set(rom);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");

    const project = await loadProjectFromRomBytes(source, "offset.nds", { selectedNarcs: [...selectedNarcs] });

    expect(project.romInfo.sourceSha256).toBe(createHash("sha256").update(rom).digest("hex"));
    expect(digest).toHaveBeenCalledTimes(1);
    const hashed = digest.mock.calls[0][1] as Uint8Array;
    expect(hashed.buffer).toBe(backing.buffer);
    expect(hashed.byteOffset).toBe(source.byteOffset);
    expect(hashed.byteLength).toBe(source.byteLength);
  });

  it("still accepts shared-buffer input for US Black 2 hashing", async () => {
    const rom = makePaddedRom("IREO");
    const source = new Uint8Array(new SharedArrayBuffer(rom.length + 96), 32, rom.length);
    source.set(rom);

    const project = await loadProjectFromRomBytes(source, "shared.nds", { selectedNarcs: [...selectedNarcs] });

    expect(project.romInfo.sourceSha256).toBe(createHash("sha256").update(rom).digest("hex"));
  });

  it("stores source bytes and metadata unchanged without rebuilding", async () => {
    const source = makePaddedRom();
    const metadata = { fileName: "padded.nds", fairy: false, selectedNarcs: ["personal"] };
    const save = vi.spyOn(NintendoDSRom.prototype, "save");

    await saveActiveRomBytes(source, metadata);

    expect(save).not.toHaveBeenCalled();
    expect(await loadActiveRomBytes()).toEqual(source);
    expect(await loadActiveRomMetadata()).toEqual(metadata);
  });

  it("migrates legacy embedded-source saves without losing edits or trusting serialized runtime caches", async () => {
    const source = makePaddedRom();
    const legacy = await loadProjectFromRomBytes(source, "legacy.nds", { selectedNarcs: [...selectedNarcs] });
    legacy.narcs.personal!.rawFiles[1][0] = 99;
    legacy.narcs.personal!.dirty.add(1);
    legacy.bw2ScriptRuntimeContext = { fieldRamAddress: 0, fieldBytes: Uint8Array.of(6), overlays: {} };
    stores.projects.set("active", structuredClone(legacy));
    const restored = (await loadActiveProject())!;
    expect(await loadActiveRomBytes()).toEqual(source);
    expect(restored.originalRomBytes).toBeUndefined();
    expect(restored.bw2ScriptRuntimeContext).toBeUndefined();
    expect(restored.narcs.personal!.rawFiles[1][0]).toBe(99);
    expect(stores.projects.get("active")).toMatchObject({ format: "pokeweb.project", version: 1 });
    const exported = new NintendoDSRom(await exportModifiedRom(restored));
    expect(new NARC(exported.getFileByName("a/0/1/6")).files[1][0]).toBe(99);
  });

  it("reattaches a missing ROM without discarding saved edits", async () => {
    const source = makePaddedRom("IRDO");
    const project = await loadProjectFromRomBytes(source, "cleanwhite2.nds", { selectedNarcs: [...selectedNarcs] });
    project.narcs.personal!.rawFiles[1][0] = 99;
    project.narcs.personal!.dirty.add(1);
    await saveActiveProject(project);
    stores.roms.delete("active");
    expect(await loadActiveRomBytes()).toBeUndefined();
    expect(await activeRomMatchesProject(project)).toBe(false);
    const stranded = (await loadActiveProject())!;
    expect(stranded.arm9).toHaveLength(0);

    await expect(reconnectActiveRom(stranded, makePaddedRom("IREO"), "cleanwhite2.nds")).rejects.toThrow(/same source ROM/);
    await expect(reconnectActiveRom(stranded, source, "other.nds")).rejects.toThrow(/same source ROM/);
    expect(await loadActiveRomBytes()).toBeUndefined();
    await reconnectActiveRom(stranded, source, "cleanwhite2.nds");
    expect(await loadActiveRomBytes()).toEqual(source);
    expect(await activeRomMatchesProject(stranded)).toBe(true);
    expect(stranded.arm9.length).toBeGreaterThan(0);
    expect(stranded.narcs.personal!.rawFiles[0][0]).toBe(45);
    expect(stranded.narcs.personal!.rawFiles[1][0]).toBe(99);
    expect(stranded.narcs.personal!.dirty.has(1)).toBe(true);
    const exported = new NintendoDSRom(await exportModifiedRom(stranded));
    expect(new NARC(exported.getFileByName("a/0/1/6")).files[1][0]).toBe(99);
  });

  it("rejects a changed source ROM when an exact fingerprint was saved", async () => {
    const source = makePaddedRom("IREO");
    const project = await loadProjectFromRomBytes(source, "cleanblack2.nds", { selectedNarcs: [...selectedNarcs] });
    await saveActiveProject(project);
    stores.roms.delete("active");
    const changed = source.slice();
    changed[changed.length - 1] ^= 1;
    await expect(reconnectActiveRom(project, changed, "cleanblack2.nds")).rejects.toThrow(/differs/);
    expect(await loadActiveRomBytes()).toBeUndefined();
  });

  it("does not hydrate a saved project from a different tab's ROM", async () => {
    const source = makePaddedRom("IRDO");
    const project = await loadProjectFromRomBytes(source, "cleanwhite2.nds", { selectedNarcs: [...selectedNarcs] });
    await saveActiveProject(project);
    await saveActiveRomBytes(makePaddedRom("IREO"), { fileName: "cleanwhite2.nds", fairy: false, selectedNarcs: [], idCode: "IREO", sourceSize: source.length });
    expect(await activeRomMatchesProject(project)).toBe(false);
    await saveActiveRomBytes(makePaddedRom("IREO"), { fileName: "cleanblack2.nds", fairy: false, selectedNarcs: [] });
    expect(await activeRomMatchesProject(project)).toBe(false);
    const restored = (await loadActiveProject())!;
    expect(restored.arm9).toHaveLength(0);
    await reconnectActiveRom(restored, source, "cleanwhite2.nds");
    expect(await activeRomMatchesProject(restored)).toBe(true);
    expect(restored.arm9.length).toBeGreaterThan(0);
  });

  it("keeps source-derived data in the project snapshot when another tab replaces the ROM cache", async () => {
    const source = makePaddedRom("IRDO");
    const project = await loadProjectFromRomBytes(source, "cleanwhite2.nds", { selectedNarcs: [...selectedNarcs] });
    await saveActiveProject(project);
    await saveActiveRomBytes(makePaddedRom("IREO"), { fileName: "cleanblack2.nds", fairy: false, selectedNarcs: [] });

    await saveActiveProject(project);
    const snapshot = (await loadActiveProject())!;
    expect(snapshot.arm9.length).toBeGreaterThan(0);
    expect(snapshot.narcs.personal!.rawFiles[0][0]).toBe(45);
  });

  it("keeps retained archives, trainer sources, and editable ARM9 independent of the source ROM", async () => {
    const source = makePaddedRom();
    const before = source.slice();
    const project = await loadProjectFromRomBytes(source, "sources.nds", { selectedNarcs: [...selectedNarcs] });

    const retained = [
      project.arm9,
      project.narcs.personal!.rawFiles[0],
      project.koMoveLearnsetSource!.bytes,
      project.trainerLocationTables!.stadium!.bytes,
      project.trainerLocationTables!.royalUnova!.bytes,
      project.trainerLocationTables!.runtime![12].bytes,
    ];
    for (const bytes of retained) {
      expect(bytes.buffer).not.toBe(source.buffer);
      expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
      bytes[0] ^= 0xff;
    }
    expect(source).toEqual(before);
  });

  it("copies standalone Gen 4 files when they become editable project data", async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const header = new Uint8Array(0x4000);
    header.set(new TextEncoder().encode("CPUE"), 12);
    const rom = new NintendoDSRom(header);
    rom.arm9 = new Uint8Array(0xe601c + 24); // One retail Platinum map-header row.
    const source = rom.save({ addedFiles: [
      { path: "msgdata/pl_msg.narc", bytes: new NARC().save() },
      { path: "fielddata/maptable/mapname.bin", bytes: new Uint8Array(16) },
    ] });
    const before = source.slice();
    const project = await loadProjectFromRomBytes(source, "platinum.nds", { selectedNarcs: ["headers"] });
    const bytes = project.narcs.headers!.rawFiles[0];

    expect(digest).not.toHaveBeenCalled();
    expect(project.romInfo.sourceSha256).toBeUndefined();
    expect(bytes.buffer).not.toBe(source.buffer);
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    bytes[0] = 99;
    expect(source).toEqual(before);
  });

  it.each([
    { label: "padded", alreadyCompacted: false, idCode: "IRDO" },
    { label: "previously compacted", alreadyCompacted: true, idCode: "IRDO" },
    { label: "padded", alreadyCompacted: false, idCode: "IREO" },
    { label: "previously compacted", alreadyCompacted: true, idCode: "IREO" },
  ])("restores and exports edits from a $label $idCode export base", async ({ alreadyCompacted, idCode }) => {
    const padded = makePaddedRom(idCode);
    const source = alreadyCompacted ? new NintendoDSRom(padded).save() : padded;
    const original = source.slice();
    const project = await loadProjectFromRomBytes(source, "source.nds", { selectedNarcs: [...selectedNarcs] });
    const personal = project.narcs.personal!;
    const personalFileId = personal.fileId;
    personal.rawFiles[1][0] = 99;
    personal.dirty.add(1);
    const save = vi.spyOn(NintendoDSRom.prototype, "save");

    await saveActiveProject(project);
    expect(project.originalRomBytes).toBeUndefined();
    expect(await loadActiveRomBytes()).toEqual(original);
    const restored = (await loadActiveProject())!;
    expect(restored.romInfo.sourceSha256).toBe(idCode === "IREO" ? createHash("sha256").update(original).digest("hex") : undefined);
    expect(restored.narcs.personal!.rawFiles[0][0]).toBe(45);
    expect(restored.narcs.personal!.rawFiles[1][0]).toBe(99);
    expect(restored.narcs.personal!.dirty.has(1)).toBe(true);
    for (const bytes of [
      restored.arm9,
      restored.narcs.personal!.rawFiles[0],
      restored.koMoveLearnsetSource!.bytes,
      restored.trainerLocationTables!.stadium!.bytes,
      restored.trainerLocationTables!.royalUnova!.bytes,
      restored.trainerLocationTables!.runtime![12].bytes,
    ]) {
      // A small view into the stored ROM would retain (and clone) its entire buffer.
      expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    }
    expect(save).not.toHaveBeenCalled();

    const exported = await exportModifiedRom(restored);
    expect(save).toHaveBeenCalledTimes(1);
    const rom = new NintendoDSRom(exported);
    expect(rom.fileId("a/0/1/6")).toBe(personalFileId);
    expect(new NARC(rom.files[personalFileId]).files.map((bytes) => bytes[0])).toEqual([45, 99]);
    expect(rom.getFileByName("unchanged.bin")).toEqual(Uint8Array.of(7, 8, 9));
    expect(exported.length).toBeLessThan(padded.length);
    expect(source).toEqual(original);
    const reloaded = await loadProjectFromRomBytes(exported, "exported.nds", { selectedNarcs: [...selectedNarcs] });
    expect(reloaded.narcs.personal!.rawFiles[1][0]).toBe(99);
  });
});

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request = { result } as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.(new Event("success")));
  return request;
}
