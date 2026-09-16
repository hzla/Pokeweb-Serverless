import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { decodeGlbPng } from "../pokeweb/glbMaterialImport";
import { buildNitroTexturePreviews, readNitroResources } from "../pokeweb/map3dModel";
import { nitroBlocks, readDictionary, writeDictionary, writeNitroFile } from "../pokeweb/nitroResourceWriter";
import { appendNitroTextures, encodeNitroTexture, type ImportTexture } from "../pokeweb/nitroTextureWriter";

function emptyTextureFile() {
  const header = new Uint8Array(16); header.set(new TextEncoder().encode("BTX0")); writeU16(header, 4, 0xfeff); writeU16(header, 6, 1); writeU16(header, 12, 16);
  const block = new Uint8Array(96); block.set(new TextEncoder().encode("TEX0")); writeU32(block, 4, block.length);
  writeU16(block, 14, 60); writeU16(block, 30, 60); writeU32(block, 52, 76);
  for (const offset of [20, 36, 40, 56]) writeU32(block, offset, 96);
  block.set(writeDictionary([], 8), 60); block.set(writeDictionary([], 4), 76);
  return writeNitroFile(header, [block]);
}
function image(name: string, alpha = false): ImportTexture {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) rgba.set([i % 2 ? 255 : 0, i % 2 ? 0 : 255, 0, alpha ? Math.round((i % 8) * 255 / 7) : i === 0 ? 0 : 255], i * 4);
  return { name, width: 8, height: 8, rgba };
}

describe("native resource dictionaries and imported textures", () => {
  it("builds native lookup trees that resolve every material name to its original index", () => {
    const names = ["bc_build_a", "bc_build_b", "h_kage", "bc_m2", "bc_m1", "abcdefghijklmnop", "A", "AA", "pw_t123456789012"];
    const dict = writeDictionary(names.map((name, i) => ({ name, data: Uint8Array.of(i, 0, 0, 0) })), 4);
    expect(readDictionary(dict, 0).map(e => e.name)).toEqual(names);
    const bit = (name: string, i: number) => ((name.charCodeAt(i >>> 3) || 0) >>> (i & 7)) & 1;
    function lookup(name: string) {
      let parent = 0, current = dict[9];
      for (let steps = 0; steps < 129; steps++) {
        const a = 8 + parent * 4, b = 8 + current * 4;
        if (dict[a] <= dict[b]) return dict[b + 3];
        parent = current; current = dict[b + (bit(name, dict[b]) ? 2 : 1)];
      }
      throw new Error("Dictionary lookup loop");
    }
    names.forEach((name, i) => expect(lookup(name)).toBe(i));
    expect(() => writeDictionary([{ name: "x", data: new Uint8Array(4) }, { name: "x", data: new Uint8Array(4) }], 4)).toThrow(/unique/);
  });
  it("decodes real PNG filters and rejects dimensions that cannot be used by DS textures", () => {
    const source = image("test", true), png = new PNG({ width: 8, height: 8 }); png.data = Buffer.from(source.rgba);
    for (const filterType of [0, 1, 2, 3, 4]) {
      const decoded = decodeGlbPng(PNG.sync.write(png, { filterType }));
      expect(decoded.rgba).toEqual(source.rgba);
    }
    const invalid = PNG.sync.write(png); invalid.writeUInt32BE(7, 16);
    expect(() => decodeGlbPng(invalid)).toThrow(/powers of two/);
    expect(() => decodeGlbPng(invalid.subarray(0, 16))).toThrow(/PNG/);
  });
  it("round trips RGB555 colors and transparent pixels through a native texture pack", () => {
    const source = image("pixel_test"), encoded = encodeNitroTexture(source);
    expect((encoded.params >>> 26) & 7).toBe(3);
    const bytes = appendNitroTextures(emptyTextureFile(), [encoded]);
    const decoded = buildNitroTexturePreviews(readNitroResources(bytes))[0].image!;
    // Transparent palette entry zero deliberately discards invisible RGB.
    expect(decoded.rgba.slice(4)).toEqual(source.rgba.slice(4)); expect(decoded.rgba[3]).toBe(0);
    const second = appendNitroTextures(bytes, [encodeNitroTexture(image("second", true))]);
    const after = buildNitroTexturePreviews(readNitroResources(second));
    expect(after[0].image!.rgba).toEqual(decoded.rgba);
    for (let i = 0; i < 64; i++) { const a = i % 8, a5 = (a << 2) | (a >>> 1); expect(after[1].image!.rgba[i * 4 + 3]).toBe((a5 << 3) | (a5 >>> 2)); }
    expect(appendNitroTextures(bytes, [encoded])).toEqual(bytes);
  });
  it("quantizes large palettes and enforces valid dimensions", () => {
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 1024; i++) rgba.set([(i & 31) * 255 / 31, (i >>> 5) * 255 / 31, 127, 255], i * 4);
    const result = encodeNitroTexture({ name: "gradient", width: 32, height: 32, rgba });
    expect(result.quantized).toBe(true); expect(result.palette.length).toBeLessThanOrEqual(512);
    expect(() => encodeNitroTexture({ name: "bad", width: 7, height: 8, rgba: new Uint8Array(224) })).toThrow(/power-of-two/);
  });
  it("binds appended palettes at the same addresses on hardware as in the file", () => {
    // A short cloud palette followed by a paving palette previously made the
    // floor read white/black cloud colors. Exercise both one import and append.
    const cloud = encodeNitroTexture(image("cloud", true));
    const paving = encodeNitroTexture(image("paving"));
    const sign = encodeNitroTexture({ ...image("sign"), rgba: new Uint8Array(image("sign").rgba.map((v, i) => i % 4 === 2 ? 255 : v)) });
    const indexedImage = image("indexed");
    for (let i = 0; i < 64; i++) indexedImage.rgba.set([(i % 32) * 255 / 31, 0, 0, 255], i * 4);
    const indexed = encodeNitroTexture(indexedImage), images = [cloud, paving, sign, indexed];
    expect((indexed.params >>> 26) & 7).toBe(4);
    expect(cloud.palette.length).toBe(8);
    const first = appendNitroTextures(emptyTextureFile(), [cloud]);
    const bytes = appendNitroTextures(first, [paving, sign, indexed]);
    expect(bytes).toEqual(appendNitroTextures(emptyTextureFile(), images));
    const block = nitroBlocks(bytes)[0], paletteStart = readU32(block, 56);
    const entries = readDictionary(block, readU16(block, 52));
    for (const encoded of images) {
      const entry = entries.find(e => e.name === encoded.name)!;
      const storedOffset = readU16(entry.data, 0), flags = readU16(entry.data, 2);
      const format = (encoded.params >>> 26) & 7;
      // NNS_G3dBindMdlPltt halves non-4-color offsets; TEXPLTT_BASE then
      // addresses 16-byte units for A3I5 / 16-color / 256-color textures.
      const register = flags & 1 ? storedOffset : storedOffset >>> 1;
      const hardwareAddress = register << (format === 2 ? 3 : 4);
      expect(hardwareAddress).toBe(storedOffset * 8);
      expect(block.slice(paletteStart + hardwareAddress, paletteStart + hardwareAddress + encoded.palette.length)).toEqual(encoded.palette);
    }
    expect(appendNitroTextures(bytes, images)).toEqual(bytes);
  });
});
