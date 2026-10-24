import { describe, expect, it } from 'vitest';
import { NITRO_TEXTURE_IDENTITY, readNitroTextureAnimation } from '../pokeweb/nitroAnimation';
import { readNitroTexturePatterns, sampleTexturePattern } from '../pokeweb/mapTextureAnimation';
import { writeNitroTextureSrt, writeNitroTexturePattern } from '../pokeweb/nitroMaterialAnimationWriter';
describe('native material animation resources', () => {
  it('round-trips constant, signed sampled, wide FX32 and packed rotation channels', () => {
    const samples = Array.from({ length: 16 }, (_, f) => ({ ...NITRO_TEXTURE_IDENTITY, scaleS: 1.5, sin: f / 32, cos: 1 - f / 32, transS: f - 9, transT: f ? -f / 16 : 0 }));
    const bytes = writeNitroTextureSrt(16, [{ name: 'water', samples }, { name: 'waves', samples }]), clip = readNitroTextureAnimation(bytes);
    expect(clip.frameCount).toBe(16);
    for (let f = 0; f < 16; f++) {
      expect(clip.sample(f).get('water')).toEqual(samples[f]);
      expect(clip.sample(f).get('waves')).toEqual(samples[f]);
    }
    expect(clip.sample(100).get('water')).toEqual(samples[15]);
    expect(writeNitroTextureSrt(16, [{ name: 'water', samples }, { name: 'waves', samples }])).toEqual(bytes);
    expect(() => writeNitroTextureSrt(17, [{ name: 'water', samples }])).toThrow(/length/);
  });
  it('encodes independently selected textures and palettes with held keys and a looping boundary', () => {
    const bytes = writeNitroTexturePattern(12, [{ name: 'foam', keys: [{ frame: 0, textureName: 'water', paletteName: 'blue' }, { frame: 3, textureName: 'water', paletteName: 'green' }, { frame: 9, textureName: 'foam', paletteName: 'blue' }] }]);
    const clip = readNitroTexturePatterns(bytes)[0], keys = clip.tracks[0].keys;
    expect(clip.frameCount).toBe(12);
    expect(sampleTexturePattern(keys, 2, 12)).toMatchObject({ textureName: 'water', paletteName: 'blue' });
    expect(sampleTexturePattern(keys, 3, 12)).toMatchObject({ textureName: 'water', paletteName: 'green' });
    expect(sampleTexturePattern(keys, 11, 12)).toMatchObject({ textureName: 'foam', paletteName: 'blue' });
    expect(sampleTexturePattern(keys, 12, 12)).toMatchObject({ textureName: 'water', paletteName: 'blue' });
    expect(() => writeNitroTexturePattern(12, [{ name: 'bad', keys: [{ frame: 12, textureName: 'water', paletteName: 'blue' }] }])).toThrow(/keyframes/);
  });
});
