import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom, materializeProjectEdits } from "../pokeweb/exportRom";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { parseHeaders, updateHeaderField } from "../pokeweb/headerModel";
import { compactRomBytes } from "../pokeweb/persistence";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("ROM export", () => {
  it("rebuilds FAT entries with 0x200-aligned replacement files", () => {
    const source = makeRom([Uint8Array.of(1, 2, 3), Uint8Array.of(4)]);
    const rom = new NintendoDSRom(source);

    const saved = rom.save({ files: new Map([[1, Uint8Array.of(9, 8, 7, 6, 5)]]) });
    const parsed = new NintendoDSRom(saved);
    const fatOffset = readU32(saved, 0x48);
    const file0Start = readU32(saved, fatOffset);
    const file1Start = readU32(saved, fatOffset + 8);

    expect(file0Start % 0x200).toBe(0);
    expect(file1Start % 0x200).toBe(0);
    expect([...parsed.files[0]]).toEqual([1, 2, 3]);
    expect([...parsed.files[1]]).toEqual([9, 8, 7, 6, 5]);
  });

  it("appends new named ROM files without shifting existing file IDs", () => {
    const source = makeRom([Uint8Array.of(1), Uint8Array.of(2)]);
    const rom = new NintendoDSRom(source);

    const saved = rom.save({ addedFiles: [{ path: "lib/Patch.dll", bytes: Uint8Array.of(0xaa, 0xbb) }] });
    const parsed = new NintendoDSRom(saved);

    expect([...parsed.files[0]]).toEqual([1]);
    expect([...parsed.files[1]]).toEqual([2]);
    expect(parsed.fileId("lib/Patch.dll")).toBe(2);
    expect([...parsed.getFileByName("lib/Patch.dll")]).toEqual([0xaa, 0xbb]);
  });

  it("compacts padded ROM bytes while preserving readable files", () => {
    const source = makeRom([Uint8Array.of(1, 2, 3), Uint8Array.of(4)]);
    const padded = new Uint8Array(source.length + 0x2000);
    padded.set(source);

    const compact = compactRomBytes(padded);
    const parsed = new NintendoDSRom(compact);

    expect(compact.length).toBeLessThan(padded.length);
    expect([...parsed.files[0]]).toEqual([1, 2, 3]);
    expect([...parsed.files[1]]).toEqual([4]);
  });

  it("materializes aggregate header edits before NARC rebuild", async () => {
    const formats = getNarcFormats("BW2");
    const headerFormat = formats.headers;
    if (!headerFormat) throw new Error("Missing header format");

    const headerNarc = new NARC();
    headerNarc.files = [packRows(headerFormat, [{ matrix_id: 12, location_name_id: 1 }])];
    const romBytes = makeRom([headerNarc.save()]);
    const project = makeHeaderProject(romBytes, headerNarc.files[0], formats, headerFormat);
    project.headers = parseHeaders(project);
    updateHeaderField(project, 1, "matrix_id", "99");
    updateHeaderField(project, 1, "location_name", "Striaton City");

    materializeProjectEdits(project);
    const materialized = project.narcs.headers?.rawFiles[0];
    expect(materialized?.[4]).toBe(99);
    expect(materialized?.[26]).toBe(2);

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);
    const exportedNarc = new NARC(exportedRom.files[0]);
    expect(exportedNarc.files[0][4]).toBe(99);
    expect(exportedNarc.files[0][26]).toBe(2);
  });
});

function makeHeaderProject(originalRomBytes: Uint8Array, headersBytes: Uint8Array, formats: ProjectState["formats"], headerFormat: FieldSpec[]): ProjectState {
  const headersStore: NarcStore = {
    name: "headers",
    fileId: 0,
    sourcePath: "a/0/1/2",
    fileCount: 1,
    rawFiles: [headersBytes],
    records: new Map(),
    dirty: new Set(),
  };
  return {
    originalRomBytes,
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { headers: 0 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: originalRomBytes.length },
    arm9: Uint8Array.of(1, 2, 3, 4),
    overlays: {},
    narcs: { headers: headersStore },
    texts: { banks: { locations: ["Nuvema Town", "Accumula Town", "Striaton City"] } },
    formats: { headers: headerFormat, ...formats },
    trpokInfo: [],
  };
}

function makeRom(files: Uint8Array[]): Uint8Array {
  const fnt = saveFnt(new Folder({ files: files.map((_file, index) => `file_${index}`), firstId: 0 }));
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

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor((row[field] ?? 0) / 2 ** (8 * i)) & 0xff;
      offset += size;
    }
  });
  return out;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
