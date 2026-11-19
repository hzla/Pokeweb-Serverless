import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readGen5MapBin } from "../pokeweb/gen5MapImportFormats";
import { nativeFaces, type BrushVertex } from "../pokeweb/mapBrushGeometry";
import { permission } from "../pokeweb/mapBrushStroke";
import { cutRect, eraseNativeArt, nativeLedgesAt, nativeTreeAt, surroundingGround } from "../pokeweb/mapNativeErase";
import { romFixtureExists } from "./romFixtures";

const texcoord = (u: number, v: number) => (((u * 16) & 0xffff) | (((v * 16) & 0xffff) << 16)) >>> 0;
/** A flat quad in the ground plane, its texture repeating once per 16 units. */
const quad = (x0: number, z0: number, x1: number, z1: number, y = 2): BrushVertex[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ position: [x, y, z] as const, texcoord: texcoord(x, z), normal: 0x1ff << 10 }));
const u = (vertex: BrushVertex) => ((vertex.texcoord! << 16) >> 16) / 16;

describe("native art erasing", () => {
  it("cuts a tile out of a long face and keeps the rest with interpolated texture coordinates", () => {
    const pieces = cutRect(quad(0, 0, 64, 16), { x0: 16, x1: 32, z0: 0, z1: 16 });
    expect(pieces).toHaveLength(2);
    const spans = pieces.map(face => [Math.min(...face.map(v => v.position[0])), Math.max(...face.map(v => v.position[0]))]).sort((a, b) => a[0] - b[0]);
    expect(spans).toEqual([[0, 16], [32, 64]]);
    for (const face of pieces) for (const vertex of face) {
      expect(u(vertex)).toBe(vertex.position[0]);
      expect(vertex.normal).toBe(0x1ff << 10);
    }
  });

  it("cuts a hole from the middle of a rectangle and removes faces inside it", () => {
    const pieces = cutRect(quad(0, 0, 48, 48), { x0: 16, x1: 32, z0: 16, z1: 32 });
    const area = pieces.reduce((total, face) => {
      const b = [Math.min(...face.map(v => v.position[0])), Math.max(...face.map(v => v.position[0])), Math.min(...face.map(v => v.position[2])), Math.max(...face.map(v => v.position[2]))];
      return total + (b[1] - b[0]) * (b[3] - b[2]);
    }, 0);
    expect(area).toBe(48 * 48 - 16 * 16);
    expect(cutRect(quad(16, 16, 32, 32), { x0: 0, x1: 48, z0: 0, z1: 48 })).toEqual([]);
    const outside = quad(64, 0, 80, 16);
    expect(cutRect(outside, { x0: 0, x1: 48, z0: 0, z1: 48 })[0]).toBe(outside);
  });

  it("cuts vertical tree cards along their length", () => {
    const card = [[0, 3], [96, 3], [96, 56], [0, 56]].map(([x, y]) => ({ position: [x, y, 16] as const, texcoord: texcoord(x, 0) }));
    const pieces = cutRect(card, { x0: 32, x1: 64, z0: 0, z1: 32 });
    expect(pieces.map(face => Math.min(...face.map(v => v.position[0]))).sort((a, b) => a - b)).toEqual([0, 64]);
    expect(pieces.every(face => face.some(v => v.position[1] === 56))).toBe(true);
  });

  it("finds a forest tree as a cell of the strip that covers it", () => {
    const strip = { face: quad(-32, -256, 0, -128, 3), size: 32 };
    expect(nativeTreeAt([strip], { x0: -16, x1: 0, z0: -176, z1: -160 })).toEqual({ x0: -32, x1: 0, z0: -192, z1: -160 });
    expect(nativeTreeAt([strip], { x0: 16, x1: 32, z0: -176, z1: -160 })).toBeUndefined();
    const large = { face: quad(0, 0, 144, 48, 3), size: 48 };
    expect(nativeTreeAt([large], { x0: 112, x1: 128, z0: 16, z1: 32 })).toEqual({ x0: 96, x1: 144, z0: 0, z1: 48 });
  });

  it("restores erased tiles from the most common plain ground around them", () => {
    const per = new Uint8Array(8 + 1024 * 8);
    const set = (x: number, z: number, tileClass: number, flags: number) => { writeU16(per, 8 + (z * 32 + x) * 8, tileClass); writeU16(per, 10 + (z * 32 + x) * 8, flags); };
    for (let z = 4; z <= 7; z++) for (let x = 4; x <= 7; x++) set(x, z, 3, 0x80);
    set(4, 4, 31, 0x80);
    for (const [x, z] of [[5, 5], [6, 5], [5, 6], [6, 6]]) set(x, z, 1, 0x81);
    expect(surroundingGround(per, new Set([5 * 32 + 5, 5 * 32 + 6, 6 * 32 + 5, 6 * 32 + 6]))).toEqual({ tileClass: 3, flags: 0x80 });
  });

  it("finds whole native ledges and reaches half a tile across them, but not into another ledge", () => {
    const per = new Uint8Array(8 + 1024 * 8);
    const set = (x: number, z: number, tileClass: number) => writeU16(per, 8 + (z * 32 + x) * 8, tileClass);
    for (let x = 4; x <= 7; x++) set(x, 10, 117); // a down ledge along x
    for (let x = 4; x <= 7; x++) set(x, 11, 117); // a second row right below it
    for (let z = 20; z <= 22; z++) set(9, z, 114); // a right ledge along z
    const down = nativeLedgesAt(per, new Set([10 * 32 + 6]));
    expect(down.ledges).toBe(1);
    expect([...down.tiles].sort((a, b) => a - b)).toEqual([4, 5, 6, 7].map(x => 10 * 32 + x));
    // Up into plain ground by half a tile, not down into the next ledge row.
    expect(down.rects[0]).toEqual({ x0: -192, x1: -176, z0: -104, z1: -80 });
    const right = nativeLedgesAt(per, new Set([22 * 32 + 9, 0]));
    expect(right.ledges).toBe(1);
    expect(right.tiles.size).toBe(3);
    expect(right.rects[0]).toEqual({ x0: -120, x1: -88, z0: 64, z1: 80 });
    expect(nativeLedgesAt(per, new Set([0])).ledges).toBe(0);
  });
});

const romPath = resolve(process.cwd(), "../cleanwhite2.nds");

describe.skipIf(!romFixtureExists(romPath))("native ledge erasing on White 2", () => {
  const chunk = (id: number) => {
    const rom = new NintendoDSRom(new Uint8Array(readFileSync(romPath)), { fileData: "view" });
    return readGen5MapBin(new NARC(rom.getFileByName("a/0/0/8")).files[id]!);
  };
  const isLedge = (per: Uint8Array, index: number) => { const c = permission(per, index).tileClass; return c >= 114 && c <= 117; };
  const ledgeVertices = (model: Uint8Array) => nativeFaces(model, ["dansa01a"], "test").flatMap(part => part.faces).flat();

  it.each([
    ["a down ledge on map 8", 8, 6, 16],
    ["an up ledge on map 65, whose lip leans into the next row", 65, 11, 21],
  ])("erases %s whole and leaves the map's other ledge", (_, id, x, z) => {
    const map = chunk(id), per = map.files[1]!;
    const before = ledgeVertices(map.files[0]!);
    const art = eraseNativeArt(map.files[0]!, new Set([z * 32 + x + 1]), per);
    expect(art.ledges).toBe(1);
    expect([...art.ledgeTiles].every(index => Math.floor(index / 32) === z)).toBe(true);
    const row = { z0: (z - 16) * 16 - 8, z1: (z - 15) * 16 + 8 };
    const inRow = (v: BrushVertex) => v.position[2] > row.z0 && v.position[2] < row.z1 && v.position[0] >= (x - 16) * 16 - 1 && v.position[0] <= (x - 16 + art.ledgeTiles.size) * 16 + 1;
    expect(before.some(inRow)).toBe(true);
    const after = ledgeVertices(art.file);
    expect(after.some(inRow)).toBe(false);
    // The map's other ledge keeps its art.
    expect(after.length).toBeGreaterThan(0);
    expect([...Array(1024).keys()].filter(index => isLedge(per, index) && !art.ledgeTiles.has(index)).length).toBeGreaterThan(0);
  });
});
