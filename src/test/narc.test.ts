import { describe, expect, it } from "vitest";
import { concatBytes, readAscii, readU32, writeU32 } from "../nds/binary";
import { Folder } from "../nds/fnt";
import { NARC } from "../nds/narc";

describe("NARC", () => {
  it("round-trips flat archives", () => {
    const source = new NARC();
    source.files = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5), Uint8Array.of(6)];
    source.filenames = new Folder({ files: ["file_0", "file_1", "file_2"] });

    const parsed = new NARC(source.save());

    expect(parsed.files.map((file) => [...file])).toEqual([
      [1, 2, 3],
      [4, 5],
      [6],
    ]);
    expect(parsed.filenames.idOf("file_1")).toBe(1);
  });

  it("writes validated NARC block magic including GMIF", () => {
    const source = new NARC();
    source.files = [Uint8Array.of(1), Uint8Array.of(2, 3, 4, 5, 6)];

    const saved = source.save();
    const fatbSize = readU32(saved, 0x14);
    const fntbOffset = 0x10 + fatbSize;
    const fntbSize = readU32(saved, fntbOffset + 4);
    const fimgOffset = fntbOffset + fntbSize;

    expect(readAscii(saved, 0, 4)).toBe("NARC");
    expect(readAscii(saved, 0x10, 4)).toBe("BTAF");
    expect(readAscii(saved, fntbOffset, 4)).toBe("BTNF");
    expect(readAscii(saved, fimgOffset, 4)).toBe("GMIF");
    expect(() => new NARC(saved)).not.toThrow();
  });

  it("loads archives with CTRMap-style early GMIF magic", () => {
    const source = new NARC();
    source.files = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7)];

    const saved = source.save();
    const fatbSize = readU32(saved, 0x14);
    const fntbOffset = 0x10 + fatbSize;
    const fntbSize = readU32(saved, fntbOffset + 4);
    const fimgOffset = fntbOffset + fntbSize;
    expect(readAscii(saved, fimgOffset, 4)).toBe("GMIF");

    const ctrMapStyle = concatBytes([saved.subarray(0, fimgOffset + 8), Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd), saved.subarray(fimgOffset + 8)]);
    writeU32(ctrMapStyle, fntbOffset + 4, fntbSize + 4);
    writeU32(ctrMapStyle, 8, ctrMapStyle.length);

    const parsed = new NARC(ctrMapStyle);

    expect(parsed.files.map((file) => [...file])).toEqual([
      [1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });
});
