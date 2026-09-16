import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NitroReader, nitroIdentity, nitroIdentityPose, nitroScale, nitroTranslation, nitroTransform,
  nitroTextureUv, NITRO_TEXTURE_IDENTITY, readNitroJointAnimation, readNitroTextureAnimation,
} from "../pokeweb/nitroAnimation";
import { compileNitroAnimatedModel, nitroJointMatrices, nitroWeightedMatrices, readNitroBasePose } from "../pokeweb/nitroAnimatedModel";
import { advanceTitleFrame } from "../pokeweb/titleScreenScene";

function fixture(stamp = "BCA0", block = "JNT0", signature = "J\0AC") {
  const bytes = new Uint8Array(18000), view = new DataView(bytes.buffer), base = 96;
  const u16 = (o: number, v: number) => view.setUint16(o, v, true);
  const u32 = (o: number, v: number) => view.setUint32(o, v, true);
  const text = (o: number, v: string) => bytes.set(new TextEncoder().encode(v), o);
  const dictionary = (o: number, stride: number) => { bytes[o + 1] = 1; u16(o + 6, 16); u16(o + 16, stride); u16(o + 18, 4 + stride); };
  text(0, stamp); u32(8, bytes.length); u16(14, 1); u32(16, 20); text(20, block); u32(24, bytes.length - 20);
  dictionary(28, 4); u32(48, base - 20); text(base, signature); u16(base + 4, 12);
  u16(base + 6, 1); u32(base + 12, 400 - base); u32(base + 16, 420 - base); u16(base + 20, 32);
  return { bytes, view, base, u16, u32, text, dictionary };
}

describe("Nitro joint animation", () => {
  it("interpolates step-4 translations and reads each of the three trailing frames", () => {
    const f = fixture();
    f.u32(128, 0x40 | 0x200 | 0x10 | 0x20); // animated X; zero Y/Z; identity R/S
    f.u32(132, 0xa0080000); f.u32(136, 512 - f.base); f.u32(140, 0); f.u32(144, 0);
    [0, 4, 0, 1, 2, 3].forEach((v, i) => f.view.setInt16(512 + i * 2, v * 4096, true));
    const anim = readNitroJointAnimation(f.bytes, [nitroIdentityPose()]);
    expect(Array.from({ length: 12 }, (_, frame) => anim.sample(frame)[0].translation[0])).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3]);
    expect(anim.sample(100)[0].translation[0]).toBe(3);
  });

  it("keeps all 13 interpolation-boundary bits on the 7781-frame title", () => {
    const f = fixture(); f.u16(f.base + 4, 7781);
    f.u32(128, 0x40 | 0x200 | 0x10 | 0x20);
    f.u32(132, 0x60000000 | 7780 << 16); f.u32(136, 512 - f.base);
    f.view.setInt16(512 + 3889 * 2, 4096, true); f.view.setInt16(512 + 3890 * 2, 12288, true);
    const anim = readNitroJointAnimation(f.bytes, [nitroIdentityPose()]);
    expect(anim.sample(7779)[0].translation[0]).toBe(2);
    expect(anim.sample(7780)[0].translation[0]).toBe(3);
  });

  it("binds tracks by node ID and distinguishes base pose from identity", () => {
    const f = fixture(), bases = [nitroIdentityPose(), nitroIdentityPose(), nitroIdentityPose()];
    bases[2].translation = [4, 5, 6]; bases[2].scale = [2, 3, 4]; bases[2].inverseScale = [.5, 1 / 3, .25];
    f.u32(128, 2 << 24 | 0x484);
    expect(readNitroJointAnimation(f.bytes, bases).sample(2)).toEqual(bases);
    f.u32(128, 2 << 24 | 1);
    expect(readNitroJointAnimation(f.bytes, bases).sample(2)[2]).toEqual(nitroIdentityPose());
  });

  it("decodes compressed pivot and basis rotations in the DS matrix convention", () => {
    const f = fixture(); f.u32(128, 0x302); f.u16(132, 0x8000);
    f.u16(400, 0x28); f.u16(402, 0); f.u16(404, 4096); // positive 90-degree Z rotation
    expect(nitroTransform(readNitroJointAnimation(f.bytes, [nitroIdentityPose()]).sample(0)[0].rotation, [1, 0, 0], true)).toEqual([0, 1, 0]);
    f.u16(132, 0);
    [0, 4095, 0, -4095, 0].forEach((v, i) => f.view.setInt16(420 + i * 2, v << 3, true));
    expect(nitroTransform(readNitroJointAnimation(f.bytes, [nitroIdentityPose()]).sample(0)[0].rotation, [1, 0, 0], true)).toEqual([0, 1, 0]);
  });

  it("samples paired scale/inverse-scale values independently", () => {
    const f = fixture(); f.u32(128, 2 | 0x40 | 0x1000 | 0x2000);
    f.u32(132, 0x600a0000); f.u32(136, 512 - f.base);
    f.u32(140, 4096); f.u32(144, 4096); f.u32(148, 4096); f.u32(152, 4096);
    [[1, 1], [2, .5], [4, .25], [4, .25], [4, .25], [4, .25], [4, .25]].flat().forEach((v, i) => f.view.setInt16(512 + i * 2, v * 4096, true));
    const pose = readNitroJointAnimation(f.bytes, [nitroIdentityPose()]).sample(1)[0];
    expect(pose.scale).toEqual([1.5, 1, 1]); expect(pose.inverseScale).toEqual([.75, 1, 1]);
  });

  it("rejects missing joint bindings and truncated sample arrays", () => {
    const f = fixture(); f.u32(128, 2 << 24 | 1);
    expect(() => readNitroJointAnimation(f.bytes, [nitroIdentityPose()])).toThrow(/unknown/);
    f.u32(128, 0x40 | 0x200 | 0x10 | 0x20); f.u32(136, f.bytes.length - 2);
    expect(() => readNitroJointAnimation(f.bytes, [nitroIdentityPose()])).toThrow(/Truncated/);
  });
});

describe("native geometry transforms", () => {
  it("preserves native node translations and reads inverse scale", () => {
    const b = new Uint8Array(40), v = new DataView(b.buffer); v.setUint16(0, 2, true);
    [24, 0, 0, 8, 4, 2, .125, .25, .5].forEach((n, i) => v.setInt32(4 + i * 4, n * 4096, true));
    const pose = readNitroBasePose(new NitroReader(b), 0);
    expect(pose.translation).toEqual([24, 0, 0]); expect(pose.scale).toEqual([8, 4, 2]); expect(pose.inverseScale).toEqual([.125, .25, .5]);
  });

  it("applies Maya segment scale compensation after translation without scaling normals", () => {
    const parent = { position: nitroScale([8, 4, 2]), normal: nitroIdentity() }, pose = nitroIdentityPose();
    pose.translation = [2, 3, 4]; pose.scale = [.5, .5, .5];
    const result = nitroJointMatrices(parent, pose, [.125, .25, .5]);
    expect(nitroTransform(result.position, [2, 2, 2])).toEqual([17, 13, 9]);
    expect(nitroTransform(result.normal, [1, 0, 0], true)).toEqual([1, 0, 0]);
  });

  it("uses inverse bind matrices before mixing skin weights", () => {
    const result = nitroWeightedMatrices([
      { matrix: { position: nitroTranslation([10, 0, 0]), normal: nitroIdentity() }, inverse: { position: nitroTranslation([-8, 0, 0]), normal: nitroIdentity() }, weight: .75 },
      { matrix: { position: nitroTranslation([0, 20, 0]), normal: nitroIdentity() }, inverse: { position: nitroTranslation([0, -8, 0]), normal: nitroIdentity() }, weight: .25 },
    ]);
    expect(nitroTransform(result.position, [1, 1, 1])).toEqual([2.5, 4, 1]);
  });
});

describe("texture animation and timeline", () => {
  it("reads named NSBTA tracks including packed sin/cos and sampled translations", () => {
    const f = fixture("BTA0", "SRT0", "M\0AT"); f.dictionary(104, 40); f.text(164, "mist");
    [4096, 4096, 4096 << 16, 0, 0].forEach((v, i) => { f.u32(124 + i * 8, 0x20000000); f.u32(128 + i * 8, v); });
    f.u32(148, 0x90000008); f.u32(152, 512 - f.base);
    [0, 1, 2, 3, 4, 5].forEach((v, i) => f.view.setInt16(512 + i * 2, v * 4096, true));
    const anim = readNitroTextureAnimation(f.bytes);
    expect(anim.sample(2).get("mist")).toEqual({ ...NITRO_TEXTURE_IDENTITY, transS: .5 });
    expect(anim.sample(11).get("mist")!.transS).toBe(5);
    expect(nitroTextureUv(16, 8, 32, 16, anim.sample(2).get("mist")!)).toEqual([0, .5]);
  });

  it("rotates non-square textures around their centre with Maya's T convention", () => {
    expect(nitroTextureUv(32, 8, 32, 16, { ...NITRO_TEXTURE_IDENTITY, sin: 1, cos: 0 })).toEqual([.5, 0]);
    expect(nitroTextureUv(4, 12, 32, 16, NITRO_TEXTURE_IDENTITY)).toEqual([.125, .75]);
  });

  it("wraps the inclusive idle interval and handles delayed animation frames", () => {
    expect(advanceTitleFrame(7780, 1, 7300, 7780)).toBe(7300);
    expect(advanceTitleFrame(7300, 962, 7300, 7780)).toBe(7300);
    expect(advanceTitleFrame(7780, 2, 0, 7780)).toBe(1);
  });
});

// Optional local integration coverage; no copyrighted resources are bundled with tests.
// Set BW2_TITLE_RESOURCE_DIR to an extracted title-resource directory to opt in.
const reference = process.env.BW2_TITLE_RESOURCE_DIR ?? "";
describe.skipIf(!reference || !existsSync(resolve(reference, "title_w_01.nsbmd")))("original BW2 title resources", () => {
  it.each(["b", "w"])("assembles %s Kyurem at native scale, keeps its eyes attached, and animates in place", (version) => {
    const read = (part: string, extension: string) => new Uint8Array(readFileSync(resolve(reference, `title_${version}_${part}.${extension}`)));
    for (const part of ["01", "02", "03"]) {
      const bytes = read(part, "nsbmd"), before = bytes.slice();
      const model = compileNitroAnimatedModel(bytes, read(part, "nsbca"), part === "03" ? read(part, "nsbta") : undefined);
      expect(model.frameCount).toBe(7781); model.sample(7300);
      const buffers = model.primitives.map((p) => p.positions), initial = buffers.map((p) => p.slice()), initialUvs = model.primitives.map((p) => p.uvs!.slice());
      if (part === "01") {
        const eye = model.primitives.find((p) => p.material.name.includes("eye"))!;
        const ys = Array.from(eye.positions).filter((_, i) => i % 3 === 1), xs = Array.from(eye.positions).filter((_, i) => i % 3 === 0);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(6);
        expect(Math.min(...ys)).toBeGreaterThan(version === "w" ? 38 : 27);
        expect(Math.max(...ys)).toBeLessThan(version === "w" ? 44 : 32);
      }
      model.sample(7420);
      expect(model.primitives.every((p, i) => p.positions === buffers[i] && p.positions.every(Number.isFinite))).toBe(true);
      expect(model.primitives.some((p, i) => p.positions.some((v, j) => v !== initial[i][j]) || p.uvs!.some((v, j) => v !== initialUvs[i][j]))).toBe(true);
      model.sample(7300);
      model.primitives.forEach((p, i) => expect(p.positions).toEqual(initial[i]));
      expect(bytes).toEqual(before);
    }
  });
});
