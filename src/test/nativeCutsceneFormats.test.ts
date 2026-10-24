import { describe, expect, it } from "vitest";
import { nitroIdentityPose, readNitroJointAnimation } from "../pokeweb/nitroAnimation";
import { readNitroMaterialAnimation, readNitroVisibility } from "../pokeweb/nitroSceneAnimation";
import { writeNativeObjectPositions } from "../pokeweb/nativeObjectMovement";

function resource(stamp: string, block: string, signature: string) {
  const bytes = new Uint8Array(512), v = new DataView(bytes.buffer), base = 100;
  const text = (at: number, s: string) => bytes.set(new TextEncoder().encode(s), at);
  const u16 = (at: number, n: number) => v.setUint16(at, n, true), u32 = (at: number, n: number) => v.setUint32(at, n, true);
  const dictionary = (at: number, stride: number) => { bytes[at + 1] = 1; u16(at + 6, 16); u16(at + 16, stride); u16(at + 18, stride + 4); text(at + 20 + stride, "part"); return at + 20; };
  text(0, stamp); u32(8, bytes.length); u16(14, 1); u32(16, 20); text(20, block); u32(24, bytes.length - 20);
  u32(dictionary(28, 4), base - 20); text(base, signature); u16(base + 4, 5);
  return { bytes, v, base, text, u16, u32, dictionary };
}
describe("native material and visibility animation", () => {
  it("interpolates color components independently and reads 5-bit alpha", () => {
    const f = resource("BMA0", "MAT0", "M\0AM"), at = f.dictionary(f.base + 8, 20);
    [0x40040000 | 200, 0x200003e0, 0x20000000, 0x20000000, 0x2000000f].forEach((n, i) => f.u32(at + i * 4, n));
    [31, 0x7c00, 0x03e0].forEach((n, i) => f.u16(300 + i * 2, n));
    const animation = readNitroMaterialAnimation(f.bytes);
    expect(animation.sample(1).get("part")!.diffuse).toEqual([.5, 0, .5]);
    expect(animation.sample(4).get("part")!.diffuse).toEqual([0, 1, 0]);
    expect(animation.sample(1).get("part")!.alpha).toBe(15 / 31);
    expect(animation.sample(0).get("part")!.ambient).toEqual([0, 1, 0]);
  });
  it("decodes visibility bits in frame/joint order and guards the joint binding", () => {
    const f = resource("BVA0", "VIS0", "V\0AV"); f.u16(106, 3); f.u16(108, 16); f.u32(112, 0b101 | 0b010 << 3 | 0b111 << 6);
    const animation = readNitroVisibility(f.bytes, 3);
    expect([0, 1, 2].map(node => animation.sample(0, node))).toEqual([true, false, true]);
    expect([0, 1, 2].map(node => animation.sample(1, node))).toEqual([false, true, false]);
    expect(animation.sample(2, 2)).toBe(true);
    expect(() => readNitroVisibility(f.bytes, 2)).toThrow(/missing joints/);
    f.u16(108, 12); expect(() => readNitroVisibility(f.bytes, 3)).toThrow(/size/);
  });
});
describe("native object movement writing", () => {
  function fixture() {
    const f = resource("BCA0", "JNT0", "J\0AC"); f.u16(106, 2); f.u32(112, 200); f.u32(116, 220); f.u16(120, 28); f.u16(122, 56);
    f.u32(128, 0x270); f.u32(132, 0x40040000); f.u32(136, 300); f.u32(140, 0); f.u32(144, 0); f.u32(156, 0x01000484);
    [1, 3, 5].forEach((n, i) => f.v.setInt32(400 + i * 4, n * 4096, true));
    const bases = [nitroIdentityPose(), nitroIdentityPose()]; bases[1].translation = [1, 2, 3];
    return { ...f, bases };
  }
  it("edits a stepped joint translation while preserving other joints, rotations and scales", () => {
    const f = fixture(), beforeBytes = f.bytes.slice(), before = readNitroJointAnimation(f.bytes, f.bases);
    const positions = Array.from({ length: 5 }, (_, frame) => before.sample(frame)[0].translation); positions[2] = [7, 8, 9];
    const bytes = writeNativeObjectPositions(f.bytes, f.bases, 0, positions), after = readNitroJointAnimation(bytes, f.bases);
    for (let frame = 0; frame < 5; frame++) {
      expect(after.sample(frame)[0].translation).toEqual(positions[frame]);
      expect(after.sample(frame)[0].rotation).toEqual(before.sample(frame)[0].rotation);
      expect(after.sample(frame)[0].scale).toEqual(before.sample(frame)[0].scale);
      expect(after.sample(frame)[1]).toEqual(before.sample(frame)[1]);
    }
    expect(f.bytes).toEqual(beforeBytes);
    const second = writeNativeObjectPositions(bytes, f.bases, 0, positions);
    expect(readNitroJointAnimation(second, f.bases).sample(2)[0].translation).toEqual([7, 8, 9]);
  });
  it("rejects overflowing fixed-point coordinates and incompatible durations before mutation", () => {
    const f = fixture(), before = f.bytes.slice();
    expect(() => writeNativeObjectPositions(f.bytes, f.bases, 0, [[0, 0, 0]])).toThrow(/duration/);
    expect(() => writeNativeObjectPositions(f.bytes, f.bases, 0, Array.from({ length: 5 }, () => [524288, 0, 0]))).toThrow(/range/);
    expect(f.bytes).toEqual(before);
  });
});
