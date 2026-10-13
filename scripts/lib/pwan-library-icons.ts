import { PNG } from 'pngjs';
import { getPokemonIconPalettes, setPokemonIconImage, type PokemonIconPayload, type RgbaImageData } from '../../src/pokeweb/pokemonSpriteModel';
import type { ProjectState } from '../../src/pokeweb/projectStore';

/** Regional forms need their named source: sprite IDs can collide with direct Mega icon IDs. */
export function regionalPwanIconSource(row: { kind?: string; baseSpecies?: string; form?: number }): string | undefined {
  if (row.kind !== 'regional form' || !row.baseSpecies?.startsWith('SPECIES_') || !Number.isInteger(row.form) || Number(row.form) <= 0) return undefined;
  const stem = `${row.baseSpecies.slice(8)}_${row.form}`;
  return /^[A-Z0-9_]+$/u.test(stem) ? `essentials_pngs/Icons/${stem}.png` : undefined;
}

export function compilePwanLibraryIcon(sourcePng: Uint8Array, paletteFile: Uint8Array, template: Uint8Array): PokemonIconPayload {
  if (template.length < 0x30 + 0x400) throw new Error('The native icon template is truncated');
  const source = PNG.sync.read(Buffer.from(sourcePng));
  const image: RgbaImageData = { width: 32, height: 64, pixels: new Uint8ClampedArray(32 * 64 * 4) };
  if (source.width === 32 && source.height === 64) image.pixels.set(source.data);
  else {
    const horizontal = source.width >= 128 && source.height >= 64;
    const frameWidth = horizontal ? Math.floor(source.width / 2) : source.width;
    const frameHeight = source.height;
    const scale = Math.min(1, 32 / frameWidth, 32 / frameHeight);
    const width = Math.max(1, Math.round(frameWidth * scale)), height = Math.max(1, Math.round(frameHeight * scale));
    for (let frame = 0; frame < 2; frame++) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(frameWidth - 1, Math.floor(x / scale)) + (horizontal ? frame * frameWidth : 0);
        const sy = Math.min(frameHeight - 1, Math.floor(y / scale));
        const dest = ((frame * 32 + 32 - height + y) * 32 + Math.floor((32 - width) / 2) + x) * 4;
        image.pixels.set(source.data.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4), dest);
      }
    }
  }
  const rawFiles: Uint8Array[] = Array.from({ length: 10 }, () => new Uint8Array());
  rawFiles[0] = paletteFile; rawFiles[8] = template;
  const project = {
    session: { baseRom: 'BW2' }, texts: { banks: {} },
    narcs: { pokemon_icons: { rawFiles, dirty: new Set(), records: new Map() } },
  } as unknown as ProjectState;
  const palettes = getPokemonIconPalettes(project);
  const scores = palettes.map(palette => {
    let score = 0;
    for (let at = 0; at < image.pixels.length; at += 4) {
      if (image.pixels[at + 3]! < 128) continue;
      score += Math.min(...palette.slice(1).map(color =>
        (image.pixels[at]! - color.r) ** 2 + (image.pixels[at + 1]! - color.g) ** 2 + (image.pixels[at + 2]! - color.b) ** 2));
    }
    return score;
  });
  const paletteId = scores.indexOf(Math.min(...scores));
  const palette = palettes[paletteId]!;
  for (let at = 0; at < image.pixels.length; at += 4) {
    if (image.pixels[at + 3]! < 128) continue;
    let best = 1, distance = Infinity;
    for (let index = 1; index < palette.length; index++) {
      const color = palette[index]!;
      const next = (image.pixels[at]! - color.r) ** 2 + (image.pixels[at + 1]! - color.g) ** 2 + (image.pixels[at + 2]! - color.b) ** 2;
      if (next < distance) { best = index; distance = next; }
    }
    const color = palette[best]!;
    image.pixels.set([color.r, color.g, color.b, 255], at);
  }
  setPokemonIconImage(project, 0, 'male', paletteId, image);
  return { male: rawFiles[8]!, female: new Uint8Array(), malePaletteId: paletteId, femalePaletteId: paletteId };
}
