import { describe, expect, it } from "vitest";
import { compressCode, decompressCode, isCodeCompressed } from "../nds/codeCompression";
import { readU32, writeU32 } from "../nds/binary";
import { recompressOverlayFiles } from "../nds/code";

describe("overlay recompression", () => {
  it("uses overlay file IDs and preserves all loaded metadata and caller buffers", () => {
    const table = new Uint8Array(32), data = new Uint8Array(0x800).fill(0x5a);
    [162, 0x021a0000, data.length, 0x80, 0x021a0020, 0x021a0040, 19, 0x80000000]
      .forEach((value, i) => writeU32(table, i * 4, value));
    const before = table.slice(), original = data.slice();
    const packed = recompressOverlayFiles(table, (id, fileId) => {
      expect(id).toBe(162); expect(fileId).toBe(19); return data;
    });
    expect(packed.files.size).toBe(1);
    expect(decompressCode(packed.files.get(19)!)).toEqual(data);
    expect(packed.table.subarray(0, 28)).toEqual(table.subarray(0, 28));
    expect(readU32(packed.table, 28) >>> 24).toBe(0x81);
    expect(readU32(packed.table, 28) & 0xffffff).toBe(packed.files.get(19)!.length);
    expect(table).toEqual(before); expect(data).toEqual(original);
  });
  it("preserves signed raw overlay images and their metadata", () => {
    const table = new Uint8Array(32), data = new Uint8Array(0x800).fill(0x5a);
    writeU32(table, 8, data.length); writeU32(table, 24, 19); writeU32(table, 28, 0x02000000 | data.length);
    const packed = recompressOverlayFiles(table, () => data);
    expect(packed.files.size).toBe(0); expect(packed.table).toEqual(table);
  });
  it("keeps compressed, incompressible, excluded and RPM loader images unchanged", () => {
    const raw = new Uint8Array(0x800).fill(0x71), encoded = compressCode(raw);
    const rpm = raw.slice(); rpm.set(new TextEncoder().encode("RPM0"));
    const files = [encoded, Uint8Array.from({ length: 32 }, (_, i) => i), rpm, raw];
    const table = new Uint8Array(4 * 32);
    for (let id = 0; id < 4; ++id) {
      writeU32(table, id * 32, id); writeU32(table, id * 32 + 24, id);
      writeU32(table, id * 32 + 8, id === 0 ? raw.length : files[id].length);
    }
    writeU32(table, 28, 0x01000000 | encoded.length);
    const packed = recompressOverlayFiles(table, (_, id) => files[id], new Set([3]));
    expect(packed.files.size).toBe(0); expect(packed.table).toEqual(table);
  });
});

describe("decompressCode", () => {
  it("returns uncompressed data unchanged", () => {
    const data = Uint8Array.of(1, 2, 3, 4, 5, 6);
    expect(decompressCode(data)).toBe(data);
  });

  it("round-trips compressed code data", () => {
    const data = new Uint8Array(0x2400);
    for (let offset = 0; offset < data.length; offset += 1) {
      data[offset] = offset % 32;
    }

    const compressed = compressCode(data);
    const decompressed = decompressCode(compressed);

    expect(isCodeCompressed(compressed)).toBe(true);
    expect([...decompressed]).toEqual([...data]);
    expect(compressed.length).toBeLessThan(data.length);
  });

  it("leaves the ARM9 prefix uncompressed", () => {
    const data = new Uint8Array(0x6000);
    for (let offset = 0; offset < data.length; offset += 1) {
      data[offset] = offset < 0x4000 ? offset & 0xff : 0x55;
    }

    const compressed = compressCode(data, { isArm9: true });
    const decompressed = decompressCode(compressed);

    expect([...compressed.slice(0, 0x4000)]).toEqual([...data.slice(0, 0x4000)]);
    expect([...decompressed]).toEqual([...data]);
  });
});
