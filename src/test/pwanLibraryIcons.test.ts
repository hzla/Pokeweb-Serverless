import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { compilePwanLibraryIcon, regionalPwanIconSource } from '../../scripts/lib/pwan-library-icons';
import { getPokemonIconImage } from '../pokeweb/pokemonSpriteModel';
import type { ProjectState } from '../pokeweb/projectStore';

describe('named regional PWAN library icons', () => {
  it('chooses the regional source independently of overlapping personal and sprite IDs', () => {
    expect(regionalPwanIconSource({ kind: 'regional form', baseSpecies: 'SPECIES_SAMUROTT', form: 1 })).toBe('essentials_pngs/Icons/SAMUROTT_1.png');
    expect(regionalPwanIconSource({ kind: 'mega form', baseSpecies: 'SPECIES_GARCHOMP', form: 2 })).toBeUndefined();
  });
  it('converts both horizontal source frames into a native two-frame icon with transparent margins', () => {
    const png = new PNG({ width: 128, height: 64 });
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) {
      png.data.set([255, 0, 0, 255], (y * 128 + x) * 4);
      png.data.set([0, 0, 255, 255], (y * 128 + x + 64) * 4);
    }
    const palettes = new Uint8Array(0x28 + 3 * 32);
    const view = new DataView(palettes.buffer);
    view.setUint16(0x2a, 0x001f, true); view.setUint16(0x2c, 0x7c00, true);
    const icon = compilePwanLibraryIcon(PNG.sync.write(png), palettes, new Uint8Array(0x430));
    expect(icon.malePaletteId).toBe(0);
    const rawFiles: Uint8Array[] = Array.from({ length: 10 }, () => new Uint8Array());
    rawFiles[0] = palettes; rawFiles[8] = icon.male;
    const project = { session: { baseRom: 'BW2' }, narcs: { pokemon_icons: { rawFiles } } } as unknown as ProjectState;
    const image = getPokemonIconImage(project, 0, 'male', 0);
    const pixel = (x: number, y: number) => Array.from(image.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    expect(pixel(16, 16)).toEqual([255, 0, 0, 255]);
    expect(pixel(16, 48)).toEqual([0, 0, 255, 255]);
    expect(pixel(0, 0)[3]).toBe(0);
    expect(pixel(0, 32)[3]).toBe(0);
    expect(icon.female).toHaveLength(0);
  });
});
