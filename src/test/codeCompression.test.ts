import { describe, expect, it } from "vitest";
import { decompressCode } from "../nds/codeCompression";

describe("decompressCode", () => {
  it("returns uncompressed data unchanged", () => {
    const data = Uint8Array.of(1, 2, 3, 4, 5, 6);
    expect(decompressCode(data)).toBe(data);
  });
});
