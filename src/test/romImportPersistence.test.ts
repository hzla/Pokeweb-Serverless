import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
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
  it("retains the exact padded input and source hash without rebuilding during import", async () => {
    const source = makePaddedRom();
    const original = source.slice();
    const save = vi.spyOn(NintendoDSRom.prototype, "save");

    const project = await loadProjectFromRomBytes(source, "padded.nds", { selectedNarcs: [...selectedNarcs] });

    expect(save).not.toHaveBeenCalled();
    expect(project.originalRomBytes).toBe(source);
    expect(source).toEqual(original);
    expect(project.romInfo.size).toBe(source.length);
    expect(project.romInfo.sourceSha256).toBe(createHash("sha256").update(source).digest("hex"));
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

  it.each([
    { label: "padded", alreadyCompacted: false },
    { label: "previously compacted", alreadyCompacted: true },
  ])("restores and exports edits from a $label export base", async ({ alreadyCompacted }) => {
    const padded = makePaddedRom();
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
    expect(restored.narcs.personal!.rawFiles[0][0]).toBe(45);
    expect(restored.narcs.personal!.rawFiles[1][0]).toBe(99);
    expect(restored.narcs.personal!.dirty.has(1)).toBe(true);
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

function makePaddedRom(): Uint8Array {
  const header = new Uint8Array(0x4000);
  header.set(new TextEncoder().encode("IRDO"), 12);
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
  const compact = rom.save({ addedFiles: [
    { path: "unchanged.bin", bytes: Uint8Array.of(7, 8, 9) },
    { path: "a/0/0/2", bytes: emptyNarc },
    { path: "a/0/0/3", bytes: emptyNarc },
    { path: "a/0/1/2", bytes: headers.save() },
    { path: "a/0/1/6", bytes: personal.save() },
  ] });
  const padded = new Uint8Array(compact.length + 0x4000).fill(0xff);
  padded.set(compact);
  return padded;
}
