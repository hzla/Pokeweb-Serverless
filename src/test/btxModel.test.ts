import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { decodeBtxImage, decodeBtxImages, decodeBtxParams16, parseBtx } from "../pokeweb/btxModel";

describe("btxModel", () => {
  it("decodes HGSS-overworld BTX texture dictionaries", () => {
    const btx = makeHgssBtx();
    const parsed = parseBtx(btx);

    expect(parsed.mode).toBe("hgss_overworld");
    expect(parsed.textures).toEqual([
      expect.objectContaining({
        index: 0,
        name: "walk_down",
        imageOffsetBytes: 0,
        format: 3,
        width: 8,
        height: 8,
      }),
    ]);
    expect(parsed.palettes).toEqual([expect.objectContaining({ index: 0, name: "normal", paletteOffsetBytes: 0 })]);
  });

  it("decodes linear 4bpp overworld frames to RGBA", () => {
    const image = decodeBtxImage(makeHgssBtx());

    expect(image.layout).toBe("linear");
    expect(image.width).toBe(8);
    expect(image.height).toBe(8);
    expect(pixel(image.rgba, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(image.rgba, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(image.rgba, 2)).toEqual([0, 255, 0, 255]);
    expect(pixel(image.rgba, 3)).toEqual([0, 0, 255, 255]);
  });

  it("decodes all texture entries for a selected palette", () => {
    const images = decodeBtxImages(makeHgssBtx(), 0);

    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("walk_down");
  });

  it("decodes BTX 16-bit texture params", () => {
    expect(decodeBtxParams16((1 << 13) | (3 << 10) | (1 << 7) | (2 << 4))).toEqual({
      format: 3,
      width: 32,
      height: 16,
      color0Transparent: true,
    });
  });
});

function makeHgssBtx(): Uint8Array {
  const tex0Offset = 0x14;
  const texInfoOffset = 0x40;
  const texDataOffset = 0x80;
  const palInfoOffset = 0xa8;
  const palDataOffset = 0xe0;
  const textureBytes = make4bppTexture();
  const paletteBytes = makePalette();
  const out = new Uint8Array(tex0Offset + palDataOffset + paletteBytes.length);

  writeAscii(out, 0, "BTX0");
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 0x0100);
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  writeU32(out, 0x10, tex0Offset);

  writeAscii(out, tex0Offset, "TEX0");
  writeU32(out, tex0Offset + 4, out.length - tex0Offset);
  writeU16(out, tex0Offset + 0x0c, textureBytes.length / 8);
  writeU16(out, tex0Offset + 0x0e, texInfoOffset);
  writeU32(out, tex0Offset + 0x14, texDataOffset);
  writeU32(out, tex0Offset + 0x30, paletteBytes.length / 8);
  writeU32(out, tex0Offset + 0x34, palInfoOffset);
  writeU32(out, tex0Offset + 0x38, palDataOffset);

  const texInfo = tex0Offset + texInfoOffset;
  out[texInfo + 1] = 1;
  writeU16(out, texInfo + 6, 12);
  const texProps = texInfo + 16;
  writeU16(out, texProps, 0);
  writeU16(out, texProps + 2, 3 << 10);
  out[texProps + 4] = 8;
  writeName(out, texProps + 8, "walk_down");

  const palInfo = tex0Offset + palInfoOffset;
  out[palInfo + 1] = 1;
  const palProps = palInfo + 0x0c;
  const palNames = palProps + 4 + 8;
  const palOffsets = palNames - 4;
  writeU32(out, palOffsets, 0);
  writeName(out, palNames, "normal");

  out.set(textureBytes, tex0Offset + texDataOffset);
  out.set(paletteBytes, tex0Offset + palDataOffset);
  return out;
}

function make4bppTexture(): Uint8Array {
  const out = new Uint8Array(32);
  for (let index = 0; index < 64; index += 2) {
    out[index / 2] = (index & 0x0f) | (((index + 1) & 0x0f) << 4);
  }
  return out;
}

function makePalette(): Uint8Array {
  const out = new Uint8Array(32);
  writeU16(out, 0, 0);
  writeU16(out, 2, 0x001f);
  writeU16(out, 4, 0x03e0);
  writeU16(out, 6, 0x7c00);
  return out;
}

function pixel(rgba: Uint8Array, index: number): number[] {
  return [...rgba.slice(index * 4, index * 4 + 4)];
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}

function writeName(out: Uint8Array, offset: number, value: string): void {
  writeAscii(out, offset, value);
}
