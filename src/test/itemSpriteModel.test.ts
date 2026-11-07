import { describe, expect, it } from "vitest";
import { prepareItemSprite } from "../pokeweb/itemSpriteModel";
import { itemSpriteTableFromPointers } from "../pokeweb/itemSpriteTable";
import { writeU32 } from "../nds/binary";

describe("item sprite preparation", () => {
  it("positions pixels on the 32px canvas and preserves transparency", () => {
    const input = { width: 2, height: 2, pixels: Uint8ClampedArray.from([
      255, 0, 0, 255, 0, 0, 0, 0,
      0, 255, 0, 255, 0, 0, 255, 255,
    ]) };
    const result = prepareItemSprite(input, 4, 6);
    const pixel = (x: number, y: number) => [...result.image.pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(pixel(4, 6)).toEqual([255, 0, 0, 255]);
    expect(pixel(5, 6)).toEqual([0, 0, 0, 0]);
    expect(pixel(4, 7)).toEqual([0, 255, 0, 255]);
    expect(pixel(5, 7)).toEqual([0, 0, 255, 255]);
    expect(result.indices[6 * 32 + 4]).not.toBe(0);
  });
  it("keys an opaque background, clips offsets, and limits colors", () => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 1024; ++i) pixels.set([i % 256, (i * 37) % 256, (i * 83) % 256, 255], i * 4);
    const result = prepareItemSprite({ width: 32, height: 32, pixels }, -1, 0, true);
    expect(result.colors.length).toBeLessThanOrEqual(15);
    expect(result.image.pixels[31 * 4 + 3]).toBe(0);
    expect(result.indices.every(value => value <= 15)).toBe(true);
  });
  it("supports fully transparent images and rejects invalid dimensions", () => {
    const result = prepareItemSprite({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }, 0, 0);
    expect(result.colors).toHaveLength(0);
    expect(result.indices.every(value => value === 0)).toBe(true);
    expect(() => prepareItemSprite({ width: 2, height: 2, pixels: new Uint8ClampedArray(4) }, 0, 0)).toThrow(/Invalid source image/);
  });
});

describe("item sprite table pointers", () => {
  it("follows both checked pointers and rejects conflicting addresses", () => {
    const arm = new Uint8Array(0x30000), site = 0x20ef4, table = 0x26000;
    writeU32(arm, site, 0x02000000 + table); writeU32(arm, site + 0x88, 0x02000000 + table);
    expect(itemSpriteTableFromPointers(arm, "B")).toBe(table);
    writeU32(arm, site + 0x88, 0x02000000 + table + 4);
    expect(itemSpriteTableFromPointers(arm, "B")).toBeUndefined();
  });
});
