import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { HmacSha1, sha1 } from "../nds/sha1";
import { encryptNdsSecureArea } from "../nds/key1";
import { exportModifiedRom } from "../pokeweb/exportRom";
import type { ProjectState } from "../pokeweb/projectStore";
import { bytes, FIXTURE_KEY, fixtureDigest, makeTwlRom, verifyAllDigests } from "./fixtures/dsiRom";

describe("DSi digest hashing", () => {
  it("matches Node SHA-1 and HMAC across padding, block, and key boundaries with reused scratch buffers", () => {
    for (const keyLength of [0, 1, 20, 64, 65, 120]) {
      const key = bytes(keyLength), hash = new HmacSha1(key);
      for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1024, 16391]) {
        const data = bytes(length);
        expect(sha1(data)).toEqual(new Uint8Array(createHash("sha1").update(data).digest()));
        const expected = new Uint8Array(createHmac("sha1", key).update(data).digest());
        expect(hash.digest(data)).toEqual(expected);
        const out = new Uint8Array(28).fill(0xa5);
        hash.digest(data, out, 4);
        expect(out.subarray(4, 24)).toEqual(expected);
        expect(out.subarray(0, 4)).toEqual(new Uint8Array(4).fill(0xa5));
        expect(out.subarray(24)).toEqual(new Uint8Array(4).fill(0xa5));
      }
    }
  });

  it("supports output inside the same input buffer", () => {
    const hash = new HmacSha1(FIXTURE_KEY);
    for (const length of [0, 1, 55, 56, 63, 64, 65, 128, 1024]) expect(hash.digest(bytes(length))).toEqual(fixtureDigest(bytes(length)));
    const data = bytes(1024), expected = fixtureDigest(data);
    hash.digest(data, data, 8);
    expect(data.subarray(8, 28)).toEqual(expected);
  });
});

describe("DSi integrity export", () => {
  it.each(["IREO", "IRDO"])("rebuilds and authenticates every %s sector through growing/shrinking and repeated exports", (gameCode) => {
    const source = makeTwlRom(gameCode), before = source.slice();
    const originalTwl = source.slice(0x80000);
    const cryptoMetadata = source.slice(0x300, 0x328);
    const twlHashMetadata = source.slice(0x33c, 0x3b4);
    let current: Uint8Array = source;
    for (const length of [0x90000, 0x110000, 5, 5]) {
      current = new NintendoDSRom(current).save({ files: new Map([[0, bytes(length)]]),
        addedFiles: length === 0x90000 ? [{ path: "patches/Test.dll", bytes: Uint8Array.of(5, 6, 7) }] : undefined });
      const rom = new NintendoDSRom(current);
      const boundary = readU16(current, 0x92) * 0x80000;
      expect(current.subarray(boundary)).toEqual(originalTwl);
      expect(readU32(current, 0x1c0)).toBe(boundary + 0x3000);
      expect(readU32(current, 0x1d0)).toBe(boundary + 0x3600);
      expect(readU32(current, 0x220)).toBe(boundary + 0x3020);
      expect(readU32(current, 0x1e8)).toBe(boundary + 0x3000);
      expect(readU32(current, 0x1ec)).toBe(0x800);
      expect(current.slice(0x300, 0x328)).toEqual(cryptoMetadata);
      expect(current.slice(0x33c, 0x3b4)).toEqual(twlHashMetadata);
      expect(rom.files[0]).toEqual(bytes(length));
      expect(rom.getFileByName("patches/Test.dll")).toEqual(Uint8Array.of(5, 6, 7));
      verifyAllDigests(current);
    }
    expect(source).toEqual(before);
  });

  it("authenticates changed ARM9/overlay bytes and retains optional trailing padding", () => {
    const source = makeTwlRom("IREO"), rom = new NintendoDSRom(source);
    const arm9 = rom.arm9.slice(); arm9[30] ^= 0xff;
    const overlayTable = bytes(32);
    const out = rom.save({ arm9, arm9OverlayTable: overlayTable, minimumLength: 0x180000 });
    expect(new NintendoDSRom(out).arm9).toEqual(arm9);
    expect(new NintendoDSRom(out).arm9OverlayTable).toEqual(overlayTable);
    expect(out.length).toBe(0x180000);
    verifyAllDigests(out);
    verifyAllDigests(new NintendoDSRom(out).save({ preserveOriginalLength: true }));
  });

  it("recognizes intact DSi data when the optional total-size header field is zero", () => {
    const source = makeTwlRom("IRDO");
    writeU32(source, 0x210, 0);
    const out = new NintendoDSRom(source).save();
    expect(out.subarray(readU16(out, 0x92) * 0x80000)).toEqual(source.subarray(0x80000));
    expect(readU32(out, 0x210)).toBe(out.length);
    verifyAllDigests(out);
  });

  it("rejects missing, unauthenticated, or overlapping integrity data without mutating the source", () => {
    for (const corrupt of [
      (data: Uint8Array) => writeU32(data, 0x1f8, data.length + 0x200),
      (data: Uint8Array) => { data[0x6400] ^= 1; },
      (data: Uint8Array) => { data[0x6000] ^= 1; },
      (data: Uint8Array) => writeU32(data, 0x200, 0),
      (data: Uint8Array) => writeU32(data, 0x1ec, 0x400),
      (data: Uint8Array) => writeU16(data, 0x92, 0),
    ]) {
      const source = makeTwlRom("IREO"); corrupt(source);
      const before = source.slice();
      expect(() => new NintendoDSRom(source).save()).toThrow("Cannot rebuild DSi integrity tables");
      expect(source).toEqual(before);
    }
  });

  it("hashes native ciphertext for decrypted secure-area edits without encrypting the exported ARM9", () => {
    const source = makeTwlRom("IRDO");
    writeU32(source, 0x4000, 0xe7ffdeff); writeU32(source, 0x4004, 0xe7ffdeff);
    const ciphertext = encryptNdsSecureArea(source.subarray(0x4000, 0x4800), readU32(source, 0x0c));
    expect(createHash("sha256").update(ciphertext).digest("hex")).toBe("bd46375e5e9a90a3f57a5b87716c94055b8173c442a65e06909a3dd79def6e66");
    let out = new NintendoDSRom(source).save({ files: new Map([[0, bytes(0x90000)]]) });
    expect(out.slice(0x4000, 0x4800)).toEqual(source.slice(0x4000, 0x4800));
    verifyAllDigests(out, ciphertext);
    out = new NintendoDSRom(out).save();
    verifyAllDigests(out, ciphertext);
    const rom = new NintendoDSRom(out), arm9 = rom.arm9.slice(); arm9[30] ^= 1;
    const changedCiphertext = encryptNdsSecureArea(arm9.subarray(0, 0x800), readU32(out, 0x0c));
    expect(createHash("sha256").update(changedCiphertext).digest("hex")).toBe("047d666352db4cfc7fa122204bc96c90e158472bdc29c3a00b0188dad2453350");
    out = rom.save({ arm9 });
    expect(out.slice(0x4000, 0x4800)).toEqual(arm9.subarray(0, 0x800));
    verifyAllDigests(out, changedCiphertext);
  });

  it("rejects incomplete DSi data by default and allows an explicit DS-only opt-out", () => {
    const source = makeTwlRom("IRDO");
    writeU32(source, 0x1f8, source.length + 0x200);
    const before = source.slice();
    const out = new NintendoDSRom(source).save({ forDsi: false, files: new Map([[0, bytes(0x1000)]]) });
    expect(new NintendoDSRom(out).files[0]).toEqual(bytes(0x1000));
    expect(source).toEqual(before);
    expect(() => new NintendoDSRom(source).save()).toThrow("Cannot rebuild DSi integrity tables");
  });

  it("rejects stripped DSi programs and requires the original source after a DS-only export", () => {
    const source = makeTwlRom("IREO");
    const ordinary = new NintendoDSRom(source).save({ forDsi: false });
    expect(() => new NintendoDSRom(ordinary).save()).toThrow("original ROM");
    expect(() => new NintendoDSRom(ordinary).save({ forDsi: true })).toThrow("original ROM");
    writeU32(source, 0x1cc, 0);
    expect(() => new NintendoDSRom(source).save()).toThrow("complete DSi programs");
    writeU32(source, 0x1dc, 0);
    expect(new NintendoDSRom(source).save().length).toBeGreaterThan(0);
  });

  it("locates moved digest keys in compatible hacks and rejects unauthenticated keys", () => {
    const source = makeTwlRom("IREO");
    source.fill(0, 0x4900, 0x4940);
    source.set(FIXTURE_KEY, 0x4c00);
    // Regenerate sector/block metadata after moving the source fixture's key.
    source.set(fixtureDigest(source.subarray(0x4800, 0x4c00)), 0x6028);
    source.set(fixtureDigest(source.subarray(0x4c00, 0x5000)), 0x603c);
    source.set(fixtureDigest(source.subarray(0x6000, 0x6280)), 0x6400);
    source.set(fixtureDigest(source.subarray(0x6400, 0x6414)), 0x328);
    const out = new NintendoDSRom(source).save();
    verifyAllDigests(out);
    source.fill(0, 0x4c00, 0x4c40);
    expect(() => new NintendoDSRom(source).save()).toThrow("native digest configuration");
  });

  it("automatically preserves DSi support for ordinary project exports", async () => {
    const source = makeTwlRom("IRDO"), rom = new NintendoDSRom(source);
    const project: ProjectState = {
      originalRomBytes: source,
      session: { romName: "fixture", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
      romInfo: { title: rom.name, idCode: rom.idCode, fileName: "fixture.nds", size: source.length },
      arm9: rom.arm9, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
      fileSystem: { replacements: { 0: bytes(0x1800) } },
    };
    const out = await exportModifiedRom(project);
    expect(new NintendoDSRom(out).files[0]).toEqual(bytes(0x1800));
    verifyAllDigests(out);
    expect(project.originalRomBytes).toBe(source);
    const repeated = new NintendoDSRom(out).save();
    expect(repeated).toEqual(out);
  });
});
