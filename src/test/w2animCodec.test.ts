import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decompressNitro, compressLz11Literal } from "../pokeweb/pokemonSpriteModel";
import { decodeW2AnimFrame, decodeW2AnimLz, encodeW2AnimLz10, encodeW2AnimMani, materializeW2AnimArchive, parseW2Anim, w2animKey } from "../pokeweb/w2animCodec";

import { streamFixture } from "./w2animFixture";

describe("w2anim codec", () => {
  it("retains exact untouched bytes, shared manifests, palettes and timings", () => {
    const bytes = streamFixture(), source = parseW2Anim(bytes);
    expect(materializeW2AnimArchive(source, new Map())).toBe(bytes);
    expect(source.entries[0]!.maniOffset).toBe(source.entries[1]!.maniOffset);
    expect(source.manis.size).toBe(2);
    expect(source.manis.get(64)!.sequence.map(step => step.duration)).toEqual([3, 7, 5]);
  });

  it("edits one shared stream without changing the untouched trainer payload", () => {
    const source = parseW2Anim(streamFixture()), trainer = source.manis.get(source.entries[2]!.maniOffset)!;
    const mani = encodeW2AnimMani({ frames: [new Uint8Array(4608).fill(0x77)], sequence: [{ frame: 0, duration: 9 }] });
    const updates = new Map(source.entries.slice(0, 2).map(entry => [w2animKey(entry), { entry, mani }]));
    const output = parseW2Anim(materializeW2AnimArchive(source, updates));
    expect(output.entries[0]!.maniOffset).toBe(output.entries[1]!.maniOffset);
    const moved = output.manis.get(output.entries[2]!.maniOffset)!;
    expect(output.bytes.subarray(moved.offset, moved.end)).toEqual(source.bytes.subarray(trainer.offset, trainer.end));
    const edited = output.manis.get(output.entries[0]!.maniOffset)!;
    expect(decodeW2AnimFrame(output, edited, 0)).toEqual(new Uint8Array(4608).fill(0x77));
  });

  it("deduplicates identical pixels independently of source frame IDs", () => {
    const frame = new Uint8Array(4608).fill(0x66);
    const source = parseW2Anim(streamFixture());
    const mani = encodeW2AnimMani({ frames: [frame, frame.slice()], sequence: [{ frame: 0, duration: 1 }, { frame: 1, duration: 2 }] });
    const entry = source.entries[0]!;
    const output = parseW2Anim(materializeW2AnimArchive(source, new Map([[w2animKey(entry), { entry, mani }]])));
    const actual = output.manis.get(output.entries[0]!.maniOffset)!;
    expect(actual.frames.length).toBe(1); expect(actual.sequence).toEqual([{ frame: 0, duration: 1 }, { frame: 0, duration: 2 }]);
  });

  it("edited LZ10 is independently decodable by the existing Nitro decoder", () => {
    const frames = [new Uint8Array(4608), Uint8Array.from({ length: 4608 }, (_, n) => (n * 43 + (n >> 3)) & 255)];
    for (const frame of frames) {
      const encoded = encodeW2AnimLz10(frame);
      expect(encoded[0]).toBe(0x10); expect(encoded.length % 4).toBe(0);
      expect(decompressNitro(encoded)).toEqual(frame);
      expect(decodeW2AnimLz(encoded, 4608)).toEqual(frame);
    }
  });

  it("imports bounded LZ11 and rejects truncated/invalid backreferences", () => {
    const frame = new Uint8Array(4608).fill(0x24);
    expect(decodeW2AnimLz(compressLz11Literal(frame), 4608)).toEqual(frame);
    for (const invalid of [Uint8Array.of(0x10, 3, 0, 0, 0x80, 0, 0), Uint8Array.of(0x10, 3, 0, 0, 0, 1)])
      expect(() => decodeW2AnimLz(invalid, 3)).toThrow();
    expect(() => decodeW2AnimLz(encodeW2AnimLz10(frame), 4096)).toThrow(/size mismatch/);
  });

  it.each(["index-bounds", "duplicate", "version", "flags", "timeline", "overlap", "frame-bounds"])("rejects malformed %s before import", mutation => {
    const bytes = streamFixture();
    if (mutation === "index-bounds") writeU32(bytes, 8, 65535);
    if (mutation === "duplicate") writeU32(bytes, 36, 22);
    if (mutation === "version") writeU16(bytes, 68, 3);
    if (mutation === "flags") writeU16(bytes, 70, 128);
    if (mutation === "timeline") writeU16(bytes, 64 + readU32(bytes, 80) + 2, 0);
    if (mutation === "overlap") writeU32(bytes, 84, 28);
    if (mutation === "frame-bounds") writeU32(bytes, 64 + readU32(bytes, 84), 0xfffffff0);
    expect(() => parseW2Anim(bytes)).toThrow();
  });
});
