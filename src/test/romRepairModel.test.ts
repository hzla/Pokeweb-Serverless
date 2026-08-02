import { describe, expect, it } from "vitest";
import { concatBytes, readU32, writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import {
  NARC,
  hasCtrMapIncompatibleFntb,
  hasEarlyFimgMagic,
  hasTinkeIncompatibleNamelessFntb,
} from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { repairNarcBytes, repairRomNarcs } from "../pokeweb/romRepairModel";

describe("ROM repair", () => {
  it("repairs NARCs whose payload was shifted after the GMIF header", () => {
    const source = new NARC();
    source.files = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7), Uint8Array.of(8)];
    const malformed = makeFimgTrailingGapNarc(source.save(), Uint8Array.of(0, 0, 0, 0));

    const parsedBefore = new NARC(malformed);
    expect(parsedBefore.files.map((file) => [...file])).not.toEqual(source.files.map((file) => [...file]));

    const repaired = repairNarcBytes(malformed);
    expect(repaired.changed).toBe(true);
    expect(repaired.reasons).toContain("fimg_trailing_gap");
    expect(new NARC(repaired.bytes).files.map((file) => [...file])).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7],
      [8],
    ]);
  });

  it("scans a ROM and rewrites only malformed NARCs", () => {
    const clean = new NARC();
    clean.files = [Uint8Array.of(1, 2, 3)];

    const early = new NARC();
    early.files = [Uint8Array.of(4, 5, 6), Uint8Array.of(7)];
    const earlyMalformed = makeEarlyFimgNarc(early.save());

    const fntb = new NARC();
    fntb.files = [Uint8Array.of(8, 9)];
    fntb.filenames = new Folder({ files: ["file_0"] });
    const fntbMalformed = makeCtrMapIncompatibleFntbNarc(fntb.save());

    const shifted = new NARC();
    shifted.files = [Uint8Array.of(10, 11, 12), Uint8Array.of(13, 14)];
    const shiftedMalformed = makeFimgTrailingGapNarc(shifted.save(), Uint8Array.of(0, 0, 0, 0));

    const romBytes = makeRom([clean.save(), earlyMalformed, fntbMalformed, shiftedMalformed, Uint8Array.of(0xaa)], [
      "clean.narc",
      "early.narc",
      "fntb.narc",
      "shifted.narc",
      "plain.bin",
    ]);

    const result = repairRomNarcs(romBytes);
    const repairedRom = new NintendoDSRom(result.bytes);

    expect(result.scannedNarcs).toBe(4);
    expect(result.repairedNarcs).toBe(3);
    expect(result.entries.map((entry) => entry.path)).toEqual(["early.narc", "fntb.narc", "shifted.narc"]);
    expect(hasEarlyFimgMagic(repairedRom.getFileByName("early.narc"))).toBe(false);
    expect(hasCtrMapIncompatibleFntb(repairedRom.getFileByName("fntb.narc"))).toBe(false);
    expect(new NARC(repairedRom.getFileByName("shifted.narc")).files.map((file) => [...file])).toEqual([
      [10, 11, 12],
      [13, 14],
    ]);
    expect([...repairedRom.getFileByName("plain.bin")]).toEqual([0xaa]);
  });

  it("repairs false TWL extended headers from previously exported legacy ROMs", () => {
    const source = makeRom([Uint8Array.of(1, 2, 3, 4)]);
    source[0x12] = 2;
    writeU32(source, 0x210, 0);

    const malformed = new Uint8Array(source.length + 0x8000);
    malformed.set(source);
    malformed.fill(0xff, source.length);
    writeU32(malformed, 0x58, 0x4c00);
    writeU32(malformed, 0x5c, 0);
    writeU32(malformed, 0x1c0, source.length + 0x200);
    writeU32(malformed, 0x1cc, 1);
    writeU32(malformed, 0x1d0, source.length + 0x400);
    writeU32(malformed, 0x1dc, 0x01010100);
    writeU32(malformed, 0x210, malformed.length);

    const result = repairRomNarcs(malformed);

    expect(result.headerRepair?.reasons).toEqual(["false_twl_extension"]);
    expect(result.bytes.length).toBe(source.length);
    expect(readU32(result.bytes, 0x80)).toBe(source.length);
    expect(readU32(result.bytes, 0x58)).toBe(0);
    expect(readU32(result.bytes, 0x5c)).toBe(0);
    expect(readU32(result.bytes, 0x210)).toBe(0);
    expect([...new NintendoDSRom(result.bytes).files[0]]).toEqual([1, 2, 3, 4]);
  });

  it("repairs legacy nameless BTNF tables and Frost-incompatible Pokemon form padding", () => {
    const nameless = new NARC();
    nameless.files = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)];
    const tinkeMalformed = makeTinkeIncompatibleNamelessFntbNarc(nameless.save());

    const spriteFiles: Uint8Array[] = Array.from({ length: 15100 }, () => new Uint8Array());
    for (let slot = 0; slot < 5; slot += 1) spriteFiles[15060 + slot] = makeRlcn(slot);
    for (let slot = 0; slot < 20; slot += 1) spriteFiles[15080 + slot] = Uint8Array.of(0x80 + slot, slot);
    spriteFiles[15098] = makeRlcn(18);
    spriteFiles[15099] = makeRlcn(19);
    const sprites = new NARC();
    sprites.files = spriteFiles;
    const frostAndTinkeMalformed = makeTinkeIncompatibleNamelessFntbNarc(sprites.save());

    const result = repairRomNarcs(
      makeRom([tinkeMalformed, frostAndTinkeMalformed], ["legacy.narc", "a/0/0/4"]),
    );
    const repairedRom = new NintendoDSRom(result.bytes);
    const repairedSprites = new NARC(repairedRom.files[1]);

    expect(result.repairedNarcs).toBe(2);
    expect(result.entries[0]).toMatchObject({
      path: "legacy.narc",
      reasons: ["tinke_incompatible_nameless_fntb"],
    });
    expect(result.entries[1]).toMatchObject({
      path: "a/0/0/4",
      reasons: ["tinke_incompatible_nameless_fntb", "frost_incompatible_sprite_padding"],
    });
    expect(hasTinkeIncompatibleNamelessFntb(repairedRom.files[0])).toBe(false);
    expect(hasTinkeIncompatibleNamelessFntb(repairedRom.files[1])).toBe(false);
    expect(repairedSprites.files.slice(15065, 15080)).toEqual(spriteFiles.slice(15085, 15100));
    expect(repairedSprites.files.slice(15060, 15065)).toEqual(spriteFiles.slice(15060, 15065));
  });
});

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

function makeTinkeIncompatibleNamelessFntbNarc(bytes: Uint8Array): Uint8Array {
  const fatbSize = readU32(bytes, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  const fntbSize = readU32(bytes, fntbOffset + 4);
  const fimgOffset = fntbOffset + fntbSize;
  const nameTable = saveFnt(new Folder());
  const paddedNameTable = new Uint8Array(12);
  paddedNameTable.fill(0xff);
  paddedNameTable.set(nameTable);
  const fntb = new Uint8Array(8 + paddedNameTable.length);
  fntb.set([0x42, 0x54, 0x4e, 0x46]);
  writeU32(fntb, 4, fntb.length);
  fntb.set(paddedNameTable, 8);

  const malformed = concatBytes([bytes.subarray(0, fntbOffset), fntb, bytes.subarray(fimgOffset)]);
  writeU32(malformed, 8, malformed.length);
  return malformed;
}

function makeRlcn(seed: number): Uint8Array {
  const out = new Uint8Array(72);
  out.set([0x52, 0x4c, 0x43, 0x4e, seed]);
  return out;
}

function makeFimgTrailingGapNarc(bytes: Uint8Array, gapBytes: Uint8Array): Uint8Array {
  const fatbSize = readU32(bytes, 0x14);
  const fntbOffset = 0x10 + fatbSize;
  const fntbSize = readU32(bytes, fntbOffset + 4);
  const rawOffset = fntbOffset + fntbSize + 8;
  const malformed = concatBytes([bytes.subarray(0, rawOffset), gapBytes, bytes.subarray(rawOffset)]);
  writeU32(malformed, 8, readU32(bytes, 8) + gapBytes.length);
  return malformed;
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
