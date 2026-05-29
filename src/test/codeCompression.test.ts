import { describe, expect, it } from "vitest";
import { compressCode, decompressCode, isCodeCompressed } from "../nds/codeCompression";

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
