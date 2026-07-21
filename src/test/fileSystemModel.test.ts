import { describe, expect, it } from "vitest";
import { writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { BATTLE_LOG_ANCESTRY_PATH } from "../pokeweb/battleLogModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import {
  addRomFile,
  buildFileSystemSnapshot,
  fileSystemReplacementMap,
  insertNarcFiles,
  replaceNarcFile,
  replaceRomFile,
} from "../pokeweb/fileSystemModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";

describe("file system model", () => {
  it("builds a ROM tree with named files, unnamed FAT entries, and expanded NARCs", () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1), Uint8Array.of(2)];
    narc.filenames = new Folder({ files: ["first.bin", "second.bin"] });
    const romBytes = makeRom([narc.save(), Uint8Array.of(9)], new Folder({ files: ["archive.narc"] }));
    const project = makeProject(romBytes);

    const snapshot = buildFileSystemSnapshot(project, romBytes);
    const archive = snapshot.roots.find((node) => node.name === "archive.narc");
    const unnamed = snapshot.roots.find((node) => node.name === "_unnamed");

    expect(archive?.children?.map((node) => node.name)).toEqual(["first.bin", "second.bin"]);
    expect(unnamed?.children?.[0].name).toBe("file_1.bin");
  });

  it("exports low-level ROM file replacements", async () => {
    const romBytes = makeRom([Uint8Array.of(1), Uint8Array.of(2)], new Folder({ files: ["a.bin", "b.bin"] }));
    const project = makeProject(romBytes);
    replaceRomFile(project, new NintendoDSRom(romBytes), 1, Uint8Array.of(8, 7, 6));

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);

    expect([...rom.files[0]]).toEqual([1]);
    expect([...rom.files[1]]).toEqual([8, 7, 6]);
  });

  it("exports added ROM files and shows them in the filesystem tree", async () => {
    const romBytes = makeRom([Uint8Array.of(1)], new Folder({ files: ["a.bin"] }));
    const project = makeProject(romBytes);
    addRomFile(project, "patches/Test.dll", Uint8Array.of(0xde, 0xad));

    const snapshot = buildFileSystemSnapshot(project, romBytes);
    expect(snapshot.pathRefs.get("patches/Test.dll")).toMatchObject({ kind: "addedRomFile" });

    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    expect(rom.fileId("patches/Test.dll")).toBe(1);
    expect([...rom.getFileByName("patches/Test.dll")]).toEqual([0xde, 0xad]);
    expect([...rom.files[0]]).toEqual([1]);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "file_system" && entry.text === "ROM file added: patches/Test.dll.")).toBe(true);
  });

  it("appends the battle-log ancestry archive without shifting existing ROM file IDs", async () => {
    const filenames = new Folder({
      files: ["root.bin"],
      folders: [["a", new Folder({ files: ["trainer.narc"], firstId: 1 })]],
    });
    const romBytes = makeRom([Uint8Array.of(1), Uint8Array.of(2)], filenames);
    const project = makeProject(romBytes);
    addRomFile(project, BATTLE_LOG_ANCESTRY_PATH, Uint8Array.of(3));

    const rom = new NintendoDSRom(await exportModifiedRom(project));

    expect(BATTLE_LOG_ANCESTRY_PATH).toBe("battlelog/ancestry.narc");
    expect(rom.fileId("root.bin")).toBe(0);
    expect(rom.fileId("a/trainer.narc")).toBe(1);
    expect(rom.fileId(BATTLE_LOG_ANCESTRY_PATH)).toBe(2);
    expect([...rom.files[0]]).toEqual([1]);
    expect([...rom.files[1]]).toEqual([2]);
    expect([...rom.files[2]]).toEqual([3]);
  });

  it("replaces, inserts, and appends NARC subfiles", () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1), Uint8Array.of(2)];
    narc.filenames = new Folder({ files: ["one.bin", "two.bin"] });
    const romBytes = makeRom([narc.save()], new Folder({ files: ["archive.narc"] }));
    const project = makeProject(romBytes);
    const rom = new NintendoDSRom(romBytes);

    replaceNarcFile(project, rom, 0, 1, Uint8Array.of(9));
    insertNarcFiles(project, rom, 0, 1, [{ name: "before.bin", bytes: Uint8Array.of(7) }], "before");
    insertNarcFiles(project, rom, 0, 0, [{ name: "after.bin", bytes: Uint8Array.of(6) }], "after");
    insertNarcFiles(project, rom, 0, 0, [{ name: "tail.bin", bytes: Uint8Array.of(5) }], "append");

    const replacement = fileSystemReplacementMap(project).get(0);
    if (!replacement) throw new Error("Missing NARC replacement");
    const parsed = new NARC(replacement);

    expect(parsed.files.map((file) => [...file])).toEqual([[1], [6], [7], [9], [5]]);
    expect(parsed.filenames.idOf("after.bin")).toBe(1);
    expect(parsed.filenames.idOf("before.bin")).toBe(2);
    expect(parsed.filenames.idOf("tail.bin")).toBe(4);
  });

  it("updates loaded NARC stores for insertion and clears decoded cache", () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1), Uint8Array.of(2)];
    narc.filenames = new Folder({ files: ["one.bin", "two.bin"] });
    const romBytes = makeRom([narc.save()], new Folder({ files: ["archive.narc"] }));
    const project = makeProject(romBytes);
    project.narcs.headers = createNarcStore("headers", "archive.narc", 0, narc);
    project.narcs.headers.records.set(1, { id: 1, bytes: Uint8Array.of(2), raw: { byteLength: 1 } });

    insertNarcFiles(project, new NintendoDSRom(romBytes), 0, 0, [{ name: "new.bin", bytes: Uint8Array.of(3) }], "after");

    const store = project.narcs.headers;
    expect(store?.rawFiles.map((file) => [...file])).toEqual([[1], [3], [2]]);
    expect(store?.fileCount).toBe(3);
    expect(store?.dirty.size).toBe(3);
    expect(store?.records.size).toBe(0);
  });

  it("rejects invalid raw replacements for loaded Pokeweb NARCs", () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1)];
    const romBytes = makeRom([narc.save()], new Folder({ files: ["archive.narc"] }));
    const project = makeProject(romBytes);
    project.narcs.headers = createNarcStore("headers", "archive.narc", 0, narc);

    expect(() => replaceRomFile(project, new NintendoDSRom(romBytes), 0, Uint8Array.of(1, 2, 3))).toThrow(/valid NARC/u);
  });
});

function makeProject(originalRomBytes: Uint8Array): ProjectState {
  return {
    originalRomBytes,
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: originalRomBytes.length },
    arm9: Uint8Array.of(1, 2, 3, 4),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeRom(files: Uint8Array[], filenames: Folder): Uint8Array {
  const fnt = saveFnt(filenames);
  const out = new Uint8Array(0x6000 + files.reduce((sum, file) => sum + 0x200 + file.length, 0));
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x54, 0x45, 0x53, 0x54], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x54, 0);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  let cursor = 0x5400;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x5200 + index * 8, cursor);
    out.set(file, cursor);
    cursor += file.length;
    writeU32(out, 0x5200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
