import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import type { BrushVertex } from "../pokeweb/mapBrushGeometry";
import { cutRect, nativeTreeAt, surroundingGround } from "../pokeweb/mapNativeErase";

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
});
