import { createHmac } from "node:crypto";
import { expect } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../../nds/binary";
import { Folder, saveFnt } from "../../nds/fnt";

export const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => i * 37 + 11);
// Synthetic test key, unrelated to the platform's native key.
export const FIXTURE_KEY = Uint8Array.from({ length: 64 }, (_, i) => i * i * 13 + i * 7 + 23);
export const fixtureDigest = (data: Uint8Array) => new Uint8Array(createHmac("sha1", FIXTURE_KEY).update(data).digest());

export function makeTwlRom(gameCode: string): Uint8Array {
  const source = new Uint8Array(0x83800);
  source.set(bytes(0x2000), 0x4000);
  source.set(FIXTURE_KEY, 0x4900);
  source.set(bytes(0x3800), 0x80000);
  source.set(new TextEncoder().encode(gameCode), 0x0c);
  source[0x12] = 2; source[0x1c] = 3;
  writeU32(source, 0x84, 0x4000);
  for (const [field, value] of [[0x20, 0x4000], [0x28, 0x02004000], [0x2c, 0x1000],
    [0x30, 0x5000], [0x3c, 0x100], [0x40, 0x5200], [0x48, 0x5400], [0x4c, 8],
    [0x1c0, 0x83000], [0x1cc, 0x600], [0x1d0, 0x83600], [0x1dc, 0x180],
    [0x1e0, 0x4000], [0x1e4, 0x2000], [0x1e8, 0x83000], [0x1ec, 0x800],
    [0x1f0, 0x6000], [0x1f4, 0x280], [0x1f8, 0x6400], [0x1fc, 20],
    [0x200, 0x400], [0x204, 32], [0x210, source.length], [0x220, 0x83020], [0x224, 0x40]]) writeU32(source, field, value);
  writeU16(source, 0x90, 1); writeU16(source, 0x92, 1);
  const fnt = saveFnt(new Folder({ files: ["file.bin"], firstId: 0 }));
  source.set(fnt, 0x5200); writeU32(source, 0x44, fnt.length);
  writeU32(source, 0x5400, 0x5600); writeU32(source, 0x5404, 0x5e00);
  let at = 0x6000;
  for (const [start, size] of [[0x4000, 0x2000], [0x83000, 0x800]]) {
    for (let offset = start; offset < start + size; offset += 0x400) { source.set(fixtureDigest(source.subarray(offset, offset + 0x400)), at); at += 20; }
  }
  source.set(fixtureDigest(source.subarray(0x6000, 0x6280)), 0x6400);
  source.set(fixtureDigest(source.subarray(0x6400, 0x6414)), 0x328);
  return source;
}


export function verifyAllDigests(rom: Uint8Array, secureCiphertext?: Uint8Array): void {
  const sectorSize = readU32(rom, 0x200), blockSize = readU32(rom, 0x204) * 20;
  const sectorAt = readU32(rom, 0x1f0), sectorLength = readU32(rom, 0x1f4);
  const blockAt = readU32(rom, 0x1f8), blockLength = readU32(rom, 0x1fc);
  expect(blockAt + blockLength).toBeLessThanOrEqual(readU16(rom, 0x92) * 0x80000);
  let entry = sectorAt;
  for (const [offsetField, sizeField] of [[0x1e0, 0x1e4], [0x1e8, 0x1ec]]) {
    const start = readU32(rom, offsetField), length = readU32(rom, sizeField);
    for (let offset = start; offset < start + length; offset += sectorSize) {
      const data = secureCiphertext && offset >= 0x4000 && offset < 0x4800
        ? secureCiphertext.subarray(offset - 0x4000, offset - 0x4000 + sectorSize) : rom.subarray(offset, offset + sectorSize);
      expect(rom.slice(entry, entry + 20)).toEqual(fixtureDigest(data)); entry += 20;
    }
  }
  expect(rom.subarray(entry, sectorAt + sectorLength).every((value) => value === 0)).toBe(true);
  for (let at = 0; at < sectorLength; at += blockSize) {
    expect(rom.slice(blockAt + at / (blockSize / 20), blockAt + at / (blockSize / 20) + 20))
      .toEqual(fixtureDigest(rom.subarray(sectorAt + at, sectorAt + at + blockSize)));
  }
  expect(rom.slice(0x328, 0x33c)).toEqual(fixtureDigest(rom.subarray(blockAt, blockAt + blockLength)));
}
