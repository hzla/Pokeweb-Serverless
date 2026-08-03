import { describe, expect, it } from "vitest";
import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { compressCode, decompressCode, isCodeCompressed } from "../nds/codeCompression";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC, hasCtrMapIncompatibleFntb, hasEarlyFimgMagic } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom, materializeProjectEdits, prepareArm9Download } from "../pokeweb/exportRom";
import { addRomFile, importArm9Bytes } from "../pokeweb/fileSystemModel";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { parseHeaders, updateHeaderField } from "../pokeweb/headerModel";
import { compactRomBytes } from "../pokeweb/persistence";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { TYPE_CHART_FAIRY_TYPE_COUNT, TYPE_CHART_ROMFS_PATH, createRomFsTypeChartStore } from "../pokeweb/typeChartModel";

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

  it("can prioritize physical file placement without changing logical file IDs", () => {
    const source = makeRom([Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)]);
    const saved = new NintendoDSRom(source).save({ priorityFileIds: [2] });
    const parsed = new NintendoDSRom(saved);
    const fatOffset = readU32(saved, 0x48);

    expect(readU32(saved, fatOffset + 2 * 8)).toBeLessThan(readU32(saved, fatOffset));
    expect(parsed.files.map((file) => [...file])).toEqual([[1], [2], [3]]);
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

  it("aligns Frost's FNT file base when exporting an appended PMC overlay", async () => {
    const project = makeProject(makeRom([Uint8Array.of(1)], ["legacy-root.bin"]));
    const overlayPath = "overlay/overlay_0000.bin";
    project.fileSystem = { replacements: {}, additions: { [overlayPath]: Uint8Array.of(0xaa, 0xbb) } };
    project.codeInjection = {
      pmc: {
        overlayId: 0,
        overlayBaseAddress: 0x02100000,
        overlayPath,
      },
    };

    const exported = new NintendoDSRom(await exportModifiedRom(project));

    expect(exported.arm9OverlayTable.length / 32).toBe(1);
    expect(exported.filenames.firstId).toBe(1);
    expect(exported.filenames.files).toEqual([]);
    expect(exported.fileId(overlayPath)).toBe(1);
    expect([...exported.files[0]]).toEqual([1]);
  });

  it("exports standalone White2Upgrade type chart files as raw bytes", async () => {
    const chart = makeTypeChartBytes(TYPE_CHART_FAIRY_TYPE_COUNT);
    const romBytes = makeRom([chart], [TYPE_CHART_ROMFS_PATH]);
    const project = makeProject(romBytes);
    const store = createRomFsTypeChartStore(0, chart);
    store.rawFiles[0] = store.rawFiles[0].slice();
    store.rawFiles[0][17] = 2;
    store.dirty.add(0);
    project.session.fairy = true;
    project.narcs.type_chart = store;

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);

    expect(exportedRom.getFileByName(TYPE_CHART_ROMFS_PATH)[17]).toBe(2);
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

  it("can preserve original ROM length for browser emulator launches", () => {
    const source = makeRom([Uint8Array.of(1, 2, 3), Uint8Array.of(4)]);
    const padded = new Uint8Array(source.length + 0x2000);
    padded.set(source);

    const rom = new NintendoDSRom(padded);
    const saved = rom.save({ files: new Map([[1, Uint8Array.of(9, 8, 7, 6, 5)]]), preserveOriginalLength: true });
    const parsed = new NintendoDSRom(saved);

    expect(saved.length).toBe(padded.length);
    expect(readU32(saved, 0x80)).toBe(padded.length);
    expect([...parsed.files[1]]).toEqual([9, 8, 7, 6, 5]);
  });

  it("can pad compact ROMs back to a requested minimum length", () => {
    const source = makeRom([Uint8Array.of(1, 2, 3), Uint8Array.of(4)]);
    const targetLength = source.length + 0x4000;

    const rom = new NintendoDSRom(source);
    const saved = rom.save({ files: new Map([[1, Uint8Array.of(9, 8, 7, 6, 5)]]), minimumLength: targetLength });
    const parsed = new NintendoDSRom(saved);

    expect(saved.length).toBe(targetLength);
    expect(readU32(saved, 0x80)).toBe(targetLength);
    expect([...parsed.files[1]]).toEqual([9, 8, 7, 6, 5]);
  });

  it("does not synthesize a TWL extended region for legacy unit-code-2 ROMs", async () => {
    const source = makeRom([Uint8Array.of(1, 2, 3)]);
    source[0x12] = 2;
    writeU32(source, 0x1c0, 1);
    writeU32(source, 0x1cc, 1);
    writeU32(source, 0x1d0, 1);
    writeU32(source, 0x1dc, 0x100);
    writeU32(source, 0x210, 0);

    const exported = await exportModifiedRom(makeProject(source));

    expect(readU32(exported, 0x210)).toBe(0);
    expect(readU32(exported, 0x1c0)).toBe(1);
    expect(readU32(exported, 0x1d0)).toBe(1);
    expect(readU32(exported, 0x80)).toBe(exported.length);
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

  it("normalizes CTRMap-incompatible early-GMIF NARCs even when they were not edited", async () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7)];
    const malformed = makeEarlyFimgNarc(narc.save());
    expect(hasEarlyFimgMagic(malformed)).toBe(true);

    const romBytes = makeRom([malformed, Uint8Array.of(9)]);
    const project = makeProject(romBytes);
    addRomFile(project, "extra.narc", malformed);

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);
    const normalized = exportedRom.files[0];
    const fatbSize = readU32(normalized, 0x14);
    const fntbOffset = 0x10 + fatbSize;
    const fntbSize = readU32(normalized, fntbOffset + 4);
    const fimgOffset = fntbOffset + fntbSize;

    expect(hasEarlyFimgMagic(normalized)).toBe(false);
    expect(readAscii(normalized, fimgOffset, 4)).toBe("GMIF");
    expect(new NARC(normalized).files.map((file) => [...file])).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7],
    ]);
    expect([...exportedRom.files[1]]).toEqual([9]);
    expect(hasEarlyFimgMagic(exportedRom.getFileByName("extra.narc"))).toBe(false);
  });

  it("normalizes CTRMap-incompatible FNTB stubs during export", async () => {
    const narc = new NARC();
    narc.files = [Uint8Array.of(1, 2, 3)];
    narc.filenames = new Folder({ files: ["file_0"] });
    const malformed = makeCtrMapIncompatibleFntbNarc(narc.save());
    expect(hasCtrMapIncompatibleFntb(malformed)).toBe(true);

    const romBytes = makeRom([malformed]);
    const exported = await exportModifiedRom(makeProject(romBytes));
    const normalized = new NintendoDSRom(exported).files[0];
    const fatbSize = readU32(normalized, 0x14);
    const fntbOffset = 0x10 + fatbSize;

    expect(hasCtrMapIncompatibleFntb(normalized)).toBe(false);
    expect(readU16(normalized, fntbOffset + 14)).toBe(1);
    expect(new NARC(normalized).filenames.idOf("file_0")).toBe(0);
  });

  it("does not abort export when a suspicious NARC-like file cannot be parsed", async () => {
    const suspicious = makeUnparseableCtrMapIncompatibleNarcLikeFile();
    expect(hasCtrMapIncompatibleFntb(suspicious)).toBe(true);
    expect(() => new NARC(suspicious)).toThrow(/Unsupported NARC version/u);

    const romBytes = makeRom([suspicious, Uint8Array.of(7)]);
    const exported = await exportModifiedRom(makeProject(romBytes));
    const exportedRom = new NintendoDSRom(exported);

    expect(exported.length).toBeGreaterThan(0);
    expect([...exportedRom.files[0]]).toEqual([...suspicious]);
    expect([...exportedRom.files[1]]).toEqual([7]);
  });

  it("recompresses dirty ARM9 when the source ROM used ARM9 compression", async () => {
    const arm9 = makeArm9WithModuleParams();
    const compressedArm9 = compressCode(arm9, { isArm9: true });
    writeU32(compressedArm9, 0xfb0 + 0x14, 0x02004000 + compressedArm9.length);
    const romBytes = new NintendoDSRom(makeRom([])).save({ arm9: compressedArm9 });
    const project = makeProject(romBytes);
    project.arm9 = arm9.slice();
    project.arm9[0x5000] = 0x99;
    project.arm9Compressed = true;
    project.arm9Dirty = true;

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);
    const exportedArm9 = decompressCode(exportedRom.arm9);

    expect(isCodeCompressed(exportedRom.arm9)).toBe(true);
    expect(exportedArm9[0x5000]).toBe(0x99);
    expect(readU32(exportedRom.arm9, 0xfb0 + 0x14)).toBe(exportedRom.arm9RamAddress + exportedRom.arm9.length);
  });

  it("prepares current ARM9 edits as compressed or decompressed downloads", () => {
    const arm9 = makeArm9WithModuleParams();
    const rom = new NintendoDSRom(new NintendoDSRom(makeRom([])).save({ arm9 }));
    const project = makeProject(rom.data);
    project.arm9 = arm9.slice();
    project.arm9[0x5000] = 0x99;
    const originalStaticEnd = readU32(project.arm9, 0xfb0 + 0x14);

    const decompressed = prepareArm9Download(project, rom, false);
    const compressed = prepareArm9Download(project, rom, true);

    expect(isCodeCompressed(decompressed)).toBe(false);
    expect(decompressed[0x5000]).toBe(0x99);
    expect(readU32(decompressed, 0xfb0 + 0x14)).toBe(0);
    expect(isCodeCompressed(compressed)).toBe(true);
    expect(decompressCode(compressed)[0x5000]).toBe(0x99);
    expect(readU32(compressed, 0xfb0 + 0x14)).toBe(rom.arm9RamAddress + compressed.length);
    expect(project.arm9[0x5000]).toBe(0x99);
    expect(readU32(project.arm9, 0xfb0 + 0x14)).toBe(originalStaticEnd);
  });

  it("zeros the compressed static end when exporting dirty decompressed ARM9", async () => {
    const arm9 = makeArm9WithModuleParams();
    const romBytes = new NintendoDSRom(makeRom([])).save({ arm9 });
    const project = makeProject(romBytes);
    project.arm9 = arm9.slice();
    project.arm9Compressed = false;
    project.arm9Dirty = true;

    const exported = await exportModifiedRom(project);
    const exportedRom = new NintendoDSRom(exported);

    expect(isCodeCompressed(exportedRom.arm9)).toBe(false);
    expect(readU32(exportedRom.arm9, 0xfb0 + 0x14)).toBe(0);
  });

  it("imports a compressed ARM9 into the decompressed working model and exports a valid compressed ROM section", async () => {
    const sourceRomBytes = new NintendoDSRom(makeRom([])).save({ arm9: makeArm9WithModuleParams() });
    const sourceRom = new NintendoDSRom(sourceRomBytes);
    const project = makeProject(sourceRomBytes);
    const editedArm9 = makeArm9WithModuleParams();
    editedArm9[0x5000] = 0xa7;
    const importedBytes = compressCode(editedArm9, { isArm9: true });
    writeU32(importedBytes, 0xfb0 + 0x14, sourceRom.arm9RamAddress + importedBytes.length);

    const result = importArm9Bytes(project, sourceRom, importedBytes);

    expect(result).toMatchObject({ compressed: true, importedSize: importedBytes.length, decompressedSize: editedArm9.length });
    expect(project.arm9[0x5000]).toBe(0xa7);
    expect(project.arm9Compressed).toBe(true);
    expect(project.arm9Dirty).toBe(true);

    const exportedRom = new NintendoDSRom(await exportModifiedRom(project));
    expect(isCodeCompressed(exportedRom.arm9)).toBe(true);
    expect(decompressCode(exportedRom.arm9)[0x5000]).toBe(0xa7);
    expect(readU32(exportedRom.arm9, 0xfb0 + 0x14)).toBe(exportedRom.arm9RamAddress + exportedRom.arm9.length);
  });

  it("imports a decompressed ARM9, repairs stale compression metadata, and exports it decompressed", async () => {
    const sourceArm9 = makeArm9WithModuleParams();
    const compressedSource = compressCode(sourceArm9, { isArm9: true });
    const sourceRomBytes = new NintendoDSRom(makeRom([])).save({ arm9: compressedSource });
    const sourceRom = new NintendoDSRom(sourceRomBytes);
    const project = makeProject(sourceRomBytes);
    const importedBytes = makeArm9WithModuleParams();
    importedBytes[0x5000] = 0xb8;
    expect(readU32(importedBytes, 0xfb0 + 0x14)).not.toBe(0);

    const result = importArm9Bytes(project, sourceRom, importedBytes);

    expect(result).toMatchObject({ compressed: false, repairedCompressionMetadata: true });
    expect(project.arm9[0x5000]).toBe(0xb8);
    expect(readU32(project.arm9, 0xfb0 + 0x14)).toBe(0);
    expect(project.arm9Compressed).toBe(false);
    expect(project.arm9Dirty).toBe(true);

    const exportedRom = new NintendoDSRom(await exportModifiedRom(project));
    expect(isCodeCompressed(exportedRom.arm9)).toBe(false);
    expect(exportedRom.arm9[0x5000]).toBe(0xb8);
    expect(readU32(exportedRom.arm9, 0xfb0 + 0x14)).toBe(0);
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

function makeRom(files: Uint8Array[], fileNames = files.map((_file, index) => `file_${index}`)): Uint8Array {
  const fnt = saveFnt(new Folder({ files: fileNames, firstId: 0 }));
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

function makeTypeChartBytes(typeCount: number): Uint8Array {
  const chart = new Uint8Array(typeCount * typeCount);
  chart.fill(4);
  chart[5] = 2;
  chart[7] = 0;
  chart[typeCount] = 8;
  return chart;
}

function makeEarlyFimgNarc(bytes: Uint8Array): Uint8Array {
  const fatbSize = readU32(bytes, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  const fntbSize = readU32(bytes, fntbOffset + 4);
  const fimgOffset = fntbOffset + fntbSize;
  const malformed = concatBytes([bytes.subarray(0, fimgOffset + 8), Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd), bytes.subarray(fimgOffset + 8)]);
  writeU32(malformed, fntbOffset + 4, fntbSize + 4);
  writeU32(malformed, 8, malformed.length);
  return malformed;
}

function makeCtrMapIncompatibleFntbNarc(bytes: Uint8Array): Uint8Array {
  const fatbSize = readU32(bytes, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  const malformed = bytes.slice();
  writeU16(malformed, fntbOffset + 14, 0);
  return malformed;
}

function makeUnparseableCtrMapIncompatibleNarcLikeFile(): Uint8Array {
  const bytes = new Uint8Array(0x40);
  bytes.set([0x4e, 0x41, 0x52, 0x43], 0);
  writeU16(bytes, 4, 0xfeff);
  writeU16(bytes, 6, 2);
  writeU32(bytes, 8, bytes.length);
  writeU16(bytes, 0x0c, 0x10);
  writeU16(bytes, 0x0e, 3);
  bytes.set([0x42, 0x54, 0x41, 0x46], 0x10);
  writeU32(bytes, 0x14, 0x14);
  writeU32(bytes, 0x18, 1);
  bytes.set([0x42, 0x54, 0x4e, 0x46], 0x24);
  writeU32(bytes, 0x28, 0x10);
  writeU32(bytes, 0x2c, 8);
  writeU16(bytes, 0x30, 0);
  writeU16(bytes, 0x32, 0);
  return bytes;
}

function makeArm9WithModuleParams(): Uint8Array {
  const arm9 = new Uint8Array(0x6000);
  for (let offset = 0x4000; offset < arm9.length; offset += 1) arm9[offset] = 0x55;
  const moduleParamsOffset = 0xfb0;
  writeU32(arm9, moduleParamsOffset, 0x02009f00);
  writeU32(arm9, moduleParamsOffset + 4, 0x02009f00);
  writeU32(arm9, moduleParamsOffset + 8, 0x0200a000);
  writeU32(arm9, moduleParamsOffset + 0x0c, 0x0200a000);
  writeU32(arm9, moduleParamsOffset + 0x10, 0x02012000);
  writeU32(arm9, moduleParamsOffset + 0x14, 0x0200a000);
  arm9.set([0x21, 0x06, 0xc0, 0xde, 0xde, 0xc0, 0x06, 0x21], moduleParamsOffset + 0x1c);
  return arm9;
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
