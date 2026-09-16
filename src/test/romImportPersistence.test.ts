import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { writeU32 } from "../nds/binary";
import { KO_MOVE_LEARNSET_PATH } from "../pokeweb/koMoveLearnsetModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { loadActiveProject, loadActiveRomBytes, loadActiveRomMetadata, saveActiveProject, saveActiveRomBytes } from "../pokeweb/persistence";

const selectedNarcs = ["personal"] as const;
let stores: Record<string, Map<IDBValidKey, unknown>>;

beforeEach(() => {
  stores = { projects: new Map(), roms: new Map() };
  // Only the storage boundary is substituted; parsing, snapshotting,
  // hydration, and export use their real implementations.
  const db = {
    transaction: (name: string) => ({
      objectStore: () => ({
        put: (value: unknown, key: IDBValidKey) => {
          stores[name].set(key, structuredClone(value));
          return successfulRequest(key);
        },
        get: (key: IDBValidKey) => successfulRequest(structuredClone(stores[name].get(key))),
        count: (key: IDBValidKey) => successfulRequest(Number(stores[name].has(key))),
      }),
    }),
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

function makePaddedRom(idCode = "IRDO"): Uint8Array {
  const header = new Uint8Array(0x4000);
  header.set(new TextEncoder().encode(idCode), 12);
  const rom = new NintendoDSRom(header);
  rom.arm9 = new Uint8Array(64);
  const emptyNarc = new NARC().save();
  const headers = new NARC();
  headers.files = [new Uint8Array(48)];
  const personal = new NARC();
  personal.files = [45, 60].map((hp) => {
    const bytes = new Uint8Array(0x4c);
    bytes[0] = hp;
    return bytes;
  });
  // Two small retained overlay sources exercise hydration from borrowed ROM files.
  rom.arm9OverlayTable = new Uint8Array(64);
  [89, 12].forEach((id, index) => {
    writeU32(rom.arm9OverlayTable, index * 32, id);
    writeU32(rom.arm9OverlayTable, index * 32 + 4, 0x02100000);
    writeU32(rom.arm9OverlayTable, index * 32 + 8, 64);
    writeU32(rom.arm9OverlayTable, index * 32 + 24, 7 + index);
  });
  const compact = rom.save({ addedFiles: [
    { path: "unchanged.bin", bytes: Uint8Array.of(7, 8, 9) },
    { path: "a/0/0/2", bytes: emptyNarc },
    { path: "a/0/0/3", bytes: emptyNarc },
    { path: "a/0/1/2", bytes: headers.save() },
    { path: "a/0/1/6", bytes: personal.save() },
    { path: "a/2/0/6", bytes: headers.save() },
    { path: KO_MOVE_LEARNSET_PATH, bytes: emptyNarc },
    { path: "overlay/overlay_0089.bin", bytes: new Uint8Array(64) },
    { path: "overlay/overlay_0012.bin", bytes: new Uint8Array(64) },
  ] });
  const padded = new Uint8Array(compact.length + 0x4000).fill(0xff);
  padded.set(compact);
  return padded;
}
