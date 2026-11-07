import { describe, expect, it } from "vitest";
import { readU32, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { exportFrostCompatibleRom, frostReaderOverflowWarning } from "../pokeweb/frostCompatibility";
import { makeTwlRom, verifyAllDigests } from "./fixtures/dsiRom";

describe("Frost overlay recompression", () => {
  it("rebuilds DSi integrity while preserving loaded overlay data and DSi programs", () => {
    const base = new NintendoDSRom(makeTwlRom("IREO"));
    const image = new Uint8Array(0x100).fill(0x5a);
    const table = new Uint8Array(344 * 32);
    for (let id = 0; id < 344; id++) {
      writeU32(table, id * 32, id);
      writeU32(table, id * 32 + 4, 0x021a0000);
      writeU32(table, id * 32 + 8, image.length);
      writeU32(table, id * 32 + 12, 0x80);
      writeU32(table, id * 32 + 24, id);
      writeU32(table, id * 32 + 28, 0x00000000);
    }
    const source = base.save({ arm9OverlayTable: table,
      insertedFiles: Array.from({ length: 344 }, () => ({ fileId: 0, bytes: image })) });
    const original = new NintendoDSRom(source), before = source.slice();
    const exported = exportFrostCompatibleRom(source);
    const frost = new NintendoDSRom(exported);
    expect(readU32(frost.arm9OverlayTable, 162 * 32 + 28) >>> 24).toBe(1);
    expect(frost.loadArm9Overlays([162]).get(162)?.data).toEqual(image);
    for (const field of [0x1c0, 0x1d0]) {
      const oldAt = readU32(source, field), newAt = readU32(exported, field);
      const size = readU32(source, field + 12);
      expect(exported.subarray(newAt, newAt + size)).toEqual(source.subarray(oldAt, oldAt + size));
    }
    expect(frost.arm9).toEqual(original.arm9);
    expect(frost.getFileByName("file.bin")).toEqual(original.getFileByName("file.bin"));
    verifyAllDigests(exported);
    expect(source).toEqual(before);
  });
});

describe("Frost's capped ROM tail", () => {
  it("identifies the reported snew layout without requiring a changed DSi header", () => {
    const length = 0x132ec400, table = 0x12c46800;
    expect(Math.min(length, 0x12000000) - table).toBe(-12871680);
    const warning = frostReaderOverflowWarning(length, table);
    expect(warning?.code).toBe("frost-reader-overflow");
    expect(warning?.message).toContain("Arithmetic operation resulted in an overflow");
    expect(warning?.message).toContain("retains its DSi data");
  });

  it.each([0, 0x11000000, 0x11ffffff, 0x12000000, 0x14000000])("does not warn at a nonnegative or absent tail offset %i", (table) => {
    expect(frostReaderOverflowWarning(0x132ec400, table)).toBeUndefined();
  });

  it("checks the table location rather than treating every large ROM as incompatible", () => {
    expect(frostReaderOverflowWarning(0x20000000, 0x11000000)).toBeUndefined();
    expect(frostReaderOverflowWarning(0x20000000, 0x12000001)?.code).toBe("frost-reader-overflow");
    expect(frostReaderOverflowWarning(0x12000000, 0x12000001)).toBeUndefined();
  });
});
