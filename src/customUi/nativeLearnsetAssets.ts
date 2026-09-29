import { readU16 } from "../nds/binary";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { parsePokemonAnimation, parsePokemonCellBank } from "../pokeweb/pokemonSpriteModel";
import { expand555, type NativeLearnsetArt } from "./assets";

/** Decode the tutor's actor resources without scaling or losing their native origin. */
export function nativeLearnsetArt(tutor: Uint8Array[], common: Uint8Array[], fontPalette: Uint8Array, typeNames: string[]): NativeLearnsetArt {
  const result: NativeLearnsetArt = {
    palette: Array.from({ length: 16 }, (_, i) => `#${expand555(readU16(fontPalette, 40 + i * 2)).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`),
    typeNames, sprites: {}, cursor: [],
  };
  function bank(char: Uint8Array, palette: Uint8Array, cell: Uint8Array, animation: Uint8Array) {
    const cells = parsePokemonCellBank(cell).cells, sequences = parsePokemonAnimation(animation).sequences;
    return (name: string, sequence: number, frameIndex = 0) => {
      const frame = sequences[sequence]?.frames[frameIndex];
      if (!frame) throw new Error(`Native learnset sprite ${name} is missing its animation frame.`);
      const oams = cells[frame.cellIndex]?.oams.filter(o => !o.disable);
      if (!oams?.length || frame.rotation || frame.xScale !== 1 || frame.yScale !== 1 || oams.some(o => o.rotateScale)) throw new Error(`Native learnset sprite ${name} has unsupported cell transforms.`);
      const x = Math.min(...oams.map(o => o.x)), y = Math.min(...oams.map(o => o.y));
      const width = Math.max(...oams.map(o => o.x + o.width)) - x, height = Math.max(...oams.map(o => o.y + o.height)) - y;
      if (x < -128 || y < -128 || x + width > 128 || y + height > 128) throw new Error(`Native learnset sprite ${name} exceeds its cell canvas.`);
      // The tutor's NCERs specify 1D 64-byte mapping. Preserve it. Crop from
      // OAM extents, since NCER max bounds can be inclusive (31 versus 32).
      const decoded = parseNitroCellImage(name, char, palette, cell, frame.cellIndex);
      if (decoded.warnings.length) throw new Error(`Native learnset sprite ${name}: ${decoded.warnings.join("; ")}`);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        const start = ((128 + y + row) * 256 + 128 + x) * 4;
        pixels.set(decoded.rgba.subarray(start, start + width * 4), row * width * 4);
      }
      result.sprites[name] = { width, height, pixels, x: x + frame.x, y: y + frame.y };
      return frame.duration;
    };
  }
  const cursor = bank(tutor[17], tutor[5], tutor[7], tutor[8]);
  for (const [i, frame] of parsePokemonAnimation(tutor[8]).sequences[0].frames.entries()) {
    if (frame.duration > 0) result.cursor.push({ sprite: `cursor-${i}`, duration: cursor(`cursor-${i}`, 0, i) });
  }
  const type = bank(tutor[23], common[33], tutor[24], tutor[25]);
  for (let i = 0; i < parsePokemonAnimation(tutor[25]).sequences.length; i++) type(`type-${i}`, i);
  const category = bank(tutor[26], common[33], tutor[27], tutor[28]);
  for (let i = 0; i < 3; i++) category(`category-${i}`, i);
  const footer = bank(common[20], common[19], common[22], common[25]);
  footer("back", 1); footer("down", 2); footer("up", 3);
  return result;
}
