import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { compressCode, isCodeCompressed } from "../nds/codeCompression";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";

describe("ROM file views", () => {
  it("keeps file copies as the default for existing mutable callers", () => {
    const source = makeRom();
    const before = source.slice();
    const rom = new NintendoDSRom(source);

    expect(rom.files.every((file) => file.buffer !== source.buffer)).toBe(true);
    rom.files[0][0] = 99;
    rom.arm9[0] = 88;
    expect(source).toEqual(before);
  });

  it("borrows only file data and respects the input view's byte offset", () => {
    const bytes = makeRom();
    const backing = new Uint8Array(bytes.length + 32).fill(0xee);
    backing.set(bytes, 16);
    const source = backing.subarray(16, 16 + bytes.length);
    const before = backing.slice();
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const fatOffset = readU32(source, 0x48);

    rom.files.forEach((file, index) => {
      const start = readU32(source, fatOffset + index * 8);
      const end = readU32(source, fatOffset + index * 8 + 4);
      expect(file.buffer).toBe(backing.buffer);
      expect(file.byteOffset).toBe(source.byteOffset + start);
      expect(file).toEqual(source.slice(start, end));
    });
    for (const section of [rom.arm9, rom.arm7, rom.arm9OverlayTable, rom.fntData, rom.banner]) {
      expect(section.buffer).not.toBe(backing.buffer);
      section.fill(0x77);
    }
    expect(backing).toEqual(before);
  });

  it("extracts editable NARC members without retaining or modifying the source buffer", () => {
    const source = makeRom();
    const before = source.slice();
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const archive = new NARC(rom.getFileByName("archive.narc"));

    expect(archive.files[0].buffer).not.toBe(source.buffer);
    expect(archive.files[0].buffer.byteLength).toBe(archive.files[0].byteLength);
    archive.files[0][0] = 99;
    expect(source).toEqual(before);
    expect(new NARC(rom.getFileByName("archive.narc")).files[0][0]).toBe(1);
  });

  it.each(["uncompressed", "compressed", "passthrough"] as const)("owns editable %s overlay data", (compression) => {
    const source = makeRom(compression);
    const before = source.slice();
    const rom = new NintendoDSRom(source, { fileData: "view" });
    const overlay = rom.loadArm9Overlays([7]).get(7)!;

    expect(isCodeCompressed(rom.files[0])).toBe(compression === "compressed");
    expect(overlay.data).toEqual(new Uint8Array(0x1000).fill(0x5a));
    expect(overlay.data.buffer).not.toBe(source.buffer);
    overlay.data[0] = 99;
    expect(source).toEqual(before);
  });

  it("rebuilds replacements identically in copy and view modes without changing the source", () => {
    const source = makeRom();
    const before = source.slice();
    const options = { files: new Map([[2, Uint8Array.of(9, 8, 7, 6)]]) };
    const copied = new NintendoDSRom(source).save(options);
    const viewed = new NintendoDSRom(source, { fileData: "view" }).save(options);

    expect(viewed).toEqual(copied);
    expect(source).toEqual(before);
    expect(new NintendoDSRom(viewed).getFileByName("other.bin")).toEqual(Uint8Array.of(9, 8, 7, 6));
  });
});

function makeRom(compression: "uncompressed" | "compressed" | "passthrough" = "uncompressed"): Uint8Array {
  const rom = new NintendoDSRom(new Uint8Array(0x4000));
  rom.arm9 = Uint8Array.of(10, 20, 30, 40);
  rom.arm7 = Uint8Array.of(50, 60);
  rom.banner = new Uint8Array(0x840);
  const payload = new Uint8Array(0x1000).fill(0x5a);
  const overlay = compression === "compressed" ? compressCode(payload) : payload;
  rom.arm9OverlayTable = new Uint8Array(32);
  writeU32(rom.arm9OverlayTable, 0, 7);
  writeU32(rom.arm9OverlayTable, 4, 0x02100000);
  writeU32(rom.arm9OverlayTable, 8, payload.length);
  writeU32(rom.arm9OverlayTable, 28, overlay.length | (compression === "uncompressed" ? 0 : 0x01000000));
  const archive = new NARC();
  archive.files = [Uint8Array.of(1, 2, 3)];
  rom.files = [overlay, archive.save(), Uint8Array.of(4, 5)];
  return rom.save({ filenames: new Folder({ firstId: 0, files: ["overlay.bin", "archive.narc", "other.bin"] }) });
}
