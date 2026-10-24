import { NITRO_TEXTURE_IDENTITY, nitroTextureUv } from '../pokeweb/nitroAnimation';
import { describe, it, expect } from 'vitest';
import { convertMapCutsceneAssets, stagePoint } from '../pokeweb/cutsceneMapAssets';
import { readNitroResources, buildModelPrimitives, type Map3dSceneData, type Map3dPrimitive } from '../pokeweb/map3dModel';
import { compileNitroAnimatedModel } from '../pokeweb/nitroAnimatedModel';
const primitive: Map3dPrimitive = { material: { name: 'ground', diffuse: [1, 1, 1], alpha: 1, texture: { name: 'grass', width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).map((_, i) => [0, 255, 0, 255][i % 4]) }, repeatS: true, repeatT: true }, positions: new Float32Array([0, 0, 0, 16, 0, 0, 16, 0, 16, 0, 0, 16]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
function map() {
  return { zoneId: 370, season: 'spring', chunks: [{ chunkId: 85, matrixX: 21, matrixY: 5, worldX: 11008, worldZ: 2816, primitives: [primitive] }], buildings: [{ chunkId: 85, chunkOrigin: { matrixX: 21, matrixY: 5 }, worldX: 11040, worldY: 16, worldZ: 2816, rotationY: 90, primitives: [primitive] }], warnings: [] } as unknown as Map3dSceneData;
}
describe('map stage native assets', () => {
  it('bakes matrix translation, tile scale and placed prop rotation into a self-contained native model', () => {
    const source = map(), before = primitive.positions.slice(), result = convertMapCutsceneAssets(source), resources = readNitroResources(result.models[0]);
    expect(result.manifest).toMatchObject({ models: 1, buildings: 1, textures: 1, triangles: 4, origin: [11008, 0, 2816] });
    expect(stagePoint([11040, 16, 2816], result.manifest)).toEqual([2, 1, 0]);
    expect(resources.textures).toHaveLength(1);
    expect(resources.palettes).toHaveLength(1);
    const parts = buildModelPrimitives(resources, []), positions = parts.flatMap(p => Array.from(p.positions));
    expect(positions).toContain(3);
    const animated = compileNitroAnimatedModel(result.models[0]);
    animated.sample(0);
    expect(animated.primitives.reduce((n, p) => n + p.indices.length, 0)).toBe(12);
    expect(primitive.positions).toEqual(before);
    expect(primitive.material.texture?.name).toBe('grass');
    expect(convertMapCutsceneAssets(source).models).toEqual(result.models);
  });
  it('rejects incomplete maps and retains immutable source material data', () => {
    const broken = map();
    broken.warnings = ['missing prop'];
    expect(() => convertMapCutsceneAssets(broken)).toThrow(/complete assets/);
    const data = map();
    data.chunks[0].primitives = [{ ...primitive, textureAnimation: { frameCount: 8, sample: () => ({ texture: primitive.material.texture }) } }];
    expect(convertMapCutsceneAssets(data).manifest.animatedMaterials).toBe(1);
    expect(() => convertMapCutsceneAssets({ ...data, chunks: [] })).toThrow(/no terrain/);
  });
  it('keeps differently animated materials separate and exports scrolling, texture swaps and source loops', () => {
    const data = map(), raw = primitive.uvs!.slice(), originalUvs = new Float32Array(raw.map(n => n + .25));
    const red = { name: 'red', width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).map((_, i) => [255, 0, 0, 255][i % 4]) };
    const animation = (phase: number) => ({ frameCount: 4, rawUvs: raw, sample: (frame: number) => ({ srt: { ...NITRO_TEXTURE_IDENTITY, transS: ((frame + phase) % 4) / 8 }, texture: frame % 4 < 2 ? primitive.material.texture : red }) });
    data.chunks[0].primitives = [0, 1].map(phase => ({ ...primitive, uvs: originalUvs, textureAnimation: animation(phase) }));
    const result = convertMapCutsceneAssets(data, 12), group = result.groups[0];
    expect(result.manifest).toMatchObject({ animatedMaterials: 2, srtTracks: 2, patternTracks: 2, textures: 2 });
    expect(group.map(b => String.fromCharCode(...b.subarray(0, 4)))).toEqual(['BMD0', 'BTA0', 'BTP0']);
    const native = compileNitroAnimatedModel(group[0], undefined, group[1], { patternBytes: group[2], sceneFrames: 12 });
    for (const f of [0, 1, 2, 3, 4, 7, 8, 11]) {
      native.sample(f);
      for (let phase = 0; phase < 2; phase++) {
        const p = native.primitives[phase], expected = nitroTextureUv(raw[0], raw[1], 1, 1, animation(phase).sample(f).srt);
        expect(p.uvs![0]).toBeCloseTo(expected[0], 5);
        expect(p.uvs![1]).toBeCloseTo(expected[1], 5);
        expect(p.material.texture!.rgba[0]).toBe(f % 4 < 2 ? 0 : 255);
      }
    }
    expect(data.chunks[0].primitives[0].uvs).toEqual(originalUvs);
    expect(raw).toEqual(primitive.uvs);
    expect(convertMapCutsceneAssets(data, 12).groups).toEqual(result.groups);
  });
});
