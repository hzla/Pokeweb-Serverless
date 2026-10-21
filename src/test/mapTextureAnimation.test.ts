import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readMapTexturePatterns, readNitroTexturePatterns, sampleTexturePattern } from "../pokeweb/mapTextureAnimation";
import { Map3dTexturePreview } from "../ui/map3dTexturePreview";
import { NITRO_TEXTURE_IDENTITY } from "../pokeweb/nitroAnimation";
import type { Map3dPrimitive } from "../pokeweb/map3dModel";

function patternFixture() {
  const bytes = new Uint8Array(100), v = new DataView(bytes.buffer);
  const u32 = (o: number, n: number) => v.setUint32(o, n, true);
  // Two independent groups share a timing table. All three arrays are padded.
  u32(0, 1); u32(4, 16); u32(8, 80); u32(12, 100);
  u32(16, 5);
  [0, 4, 9, 0, 6].forEach((f, i) => v.setUint16(20 + i * 2, f, true));
  bytes.set([2, 0, 1, 3, 4], 32); // First group starts on texture 2, not 0.
  bytes.set([0, 1, 0, 2, 3], 40);
  u32(48, 2); bytes.set([0, 3], 52); u32(56, 12);
  bytes.set(new TextEncoder().encode("BTX0"), 80);
  return { bytes, u32, v };
}

describe("Gen 5 texture patterns", () => {
  it("reads padded arrays and separates multiple groups with independently indexed palettes", () => {
    const groups = readMapTexturePatterns(patternFixture().bytes);
    expect(groups).toHaveLength(2);
    expect(groups[0].keys).toEqual([
      { frame: 0, textureIndex: 2, paletteIndex: 0 },
      { frame: 4, textureIndex: 0, paletteIndex: 1 },
      { frame: 9, textureIndex: 1, paletteIndex: 0 },
    ]);
    expect(groups[1].keys).toEqual([{ frame: 0, textureIndex: 3, paletteIndex: 2 }, { frame: 6, textureIndex: 4, paletteIndex: 3 }]);
    expect(sampleTexturePattern(groups[0].keys, 3, 12).textureIndex).toBe(2);
    expect(sampleTexturePattern(groups[0].keys, 4, 12).textureIndex).toBe(0);
    expect(sampleTexturePattern(groups[0].keys, 12, 12).textureIndex).toBe(2);
    expect(sampleTexturePattern(groups[1].keys, 7, 12).textureIndex).toBe(4);
  });

  it("rejects truncated archives, invalid group starts, and out-of-order keys", () => {
    const f = patternFixture();
    expect(() => readMapTexturePatterns(f.bytes.subarray(0, 90))).toThrow(/Truncated/);
    f.bytes[53] = 0; expect(() => readMapTexturePatterns(f.bytes)).toThrow(/boundaries/);
    f.bytes[53] = 3; f.v.setUint16(24, 2, true);
    expect(() => readMapTexturePatterns(f.bytes)).toThrow(/keyframes/);
  });
});

function nitroPatternFixture() {
  const bytes = new Uint8Array(320), v = new DataView(bytes.buffer);
  const text = (o: number, s: string) => bytes.set(new TextEncoder().encode(s), o);
  const u16 = (o: number, n: number) => v.setUint16(o, n, true), u32 = (o: number, n: number) => v.setUint32(o, n, true);
  const dict = (o: number, stride: number, name: string) => {
    bytes[o + 1] = 1; u16(o + 6, 16); u16(o + 16, stride); u16(o + 18, 4 + stride); text(o + 20 + stride, name);
  };
  text(0, "BTP0"); u32(8, bytes.length); u16(14, 1); u32(16, 20); text(20, "PAT0"); u32(24, 300);
  dict(28, 4, "fountain"); u32(48, 80 - 20);
  text(80, "M\0PT"); u16(84, 12); bytes[86] = 1; bytes[87] = 2; u16(88, 120); u16(90, 136);
  dict(92, 8, "water"); u16(112, 2); u16(118, 80);
  u16(160, 0); bytes[162] = 0; bytes[163] = 0;
  u16(164, 6); bytes[166] = 0; bytes[167] = 1;
  text(200, "still_water"); text(216, "blue"); text(232, "green");
  return { bytes, u16 };
}

describe("prop NSBTP", () => {
  it("supports palette-only swaps on one texture and holds keys until the next boundary", () => {
    const clip = readNitroTexturePatterns(nitroPatternFixture().bytes)[0];
    expect(clip.name).toBe("fountain"); expect(clip.frameCount).toBe(12);
    expect(sampleTexturePattern(clip.tracks[0].keys, 5, 12)).toMatchObject({ textureName: "still_water", paletteName: "blue" });
    expect(sampleTexturePattern(clip.tracks[0].keys, 6, 12)).toMatchObject({ textureName: "still_water", paletteName: "green" });
  });
  it("rejects pattern keyframes outside the clip", () => {
    const f = nitroPatternFixture(); f.u16(164, 12);
    expect(() => readNitroTexturePatterns(f.bytes)).toThrow(/keyframes/);
  });
});

function previewFixture() {
  const original = new THREE.Texture(), next = new THREE.Texture();
  const geometry = new THREE.BufferGeometry();
  const source: Map3dPrimitive = {
    positions: new Float32Array([0, 0, 0]), uvs: new Float32Array([.25, .75]), indices: new Uint16Array(),
    material: { name: "water", alpha: 1, diffuse: [1, 1, 1] },
    textureAnimation: {
      frameCount: 30, rawUvs: new Float32Array([.25, .75]),
      sample: frame => ({ srt: { ...NITRO_TEXTURE_IDENTITY, transS: (frame % 30) / 30 }, texture: { name: "frame", width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) } }),
    },
  };
  geometry.setAttribute("uv", new THREE.BufferAttribute(source.uvs!, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: original }));
  const preview = new Map3dTexturePreview(); preview.add(mesh, source, () => next);
  return { preview, source, mesh, original, next };
}

describe("map texture preview playback", () => {
  it("plays at 30 frames per second, pauses without catching up, seeks, and restarts", () => {
    const { preview, mesh } = previewFixture();
    preview.update(100); preview.update(600); expect(preview.frame).toBe(15);
    expect(mesh.geometry.getAttribute("uv").getX(0)).toBeCloseTo(-.25);
    preview.setPlaying(false); preview.update(1000); preview.update(3000); expect(preview.frame).toBe(15);
    preview.seek(6); expect(mesh.geometry.getAttribute("uv").getX(0)).toBeCloseTo(.05);
    preview.setPlaying(true); preview.update(10000); preview.update(10100); expect(preview.frame).toBe(9);
    preview.seek(0); expect(mesh.geometry.getAttribute("uv").getX(0)).toBe(.25);
  });

  it("restores static UVs and texture when disabled without modifying shared scene/export data", () => {
    const { preview, source, mesh, original, next } = previewFixture();
    preview.seek(10); expect(mesh.material.map).toBe(next);
    expect(source.uvs).toEqual(new Float32Array([.25, .75])); expect(source.material.texture).toBeUndefined();
    preview.setEnabled(false);
    expect(mesh.material.map).toBe(original); expect(mesh.geometry.getAttribute("uv").getX(0)).toBe(.25);
    preview.update(5000); preview.update(6000); expect(preview.frame).toBe(10);
    preview.setEnabled(true); expect(mesh.material.map).toBe(next);
  });

  it("removes detached building bindings and resets the clock and duration on map reload", () => {
    const { preview, mesh } = previewFixture(), group = new THREE.Group(); group.add(mesh);
    expect(preview.count).toBe(1); expect(preview.frameCount).toBe(30);
    preview.removeGroup(group); expect(preview.count).toBe(0); expect(preview.frameCount).toBe(1);
    preview.seek(40); preview.clear(); expect(preview.frame).toBe(0);
  });

  it("releases cached animation textures on map unload, including frames no longer bound", () => {
    const { preview, next } = previewFixture(); let disposed = 0;
    next.addEventListener("dispose", () => disposed++);
    preview.seek(5); preview.setEnabled(false); preview.clear();
    expect(disposed).toBe(1);
  });
});
