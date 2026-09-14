import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { NintendoDSRom } from '../../src/nds/rom';
import { NARC } from '../../src/nds/narc';
import { parseNitroBackground, renderNitroBackgroundImage } from '../../src/pokeweb/nitroBg';
import { parseNitroCellEffect } from '../../src/pokeweb/nitroCell';
import { readU16, writeU16 } from '../../src/nds/binary';
const rom = new NintendoDSRom(new Uint8Array(readFileSync(process.argv[2]!)));
const files = new NARC(rom.files[rom.filenames.idOf('a/1/2/5')!]!).files;
const output = new URL('./build/', import.meta.url);
mkdirSync(output, { recursive: true });
function png(name: string, width: number, height: number, rgba: Uint8ClampedArray) {
  const image = new PNG({ width, height }); image.data = Buffer.from(rgba);
  writeFileSync(new URL(name + '.png', output), PNG.sync.write(image));
}
const bg = parseNitroBackground(2, files[2]!, files[1]!, files[0]!);
png('background', bg.width, bg.height, renderNitroBackgroundImage(bg));
const adjusted = files[2]!.slice();
const screenOffset = 36;
for (let y = 8; y < 21; ++y) {
  const row = screenOffset + y * 64;
  writeU16(adjusted, row + 44, readU16(adjusted, row + 38));
  writeU16(adjusted, row + 42, readU16(adjusted, row + 36));
  for (let x = 18; x <= 20; ++x) writeU16(adjusted, row + x * 2, readU16(adjusted, row + 34));
}
const after = parseNitroBackground(2, adjusted, files[1]!, files[0]!);
png('background-learnset', after.width, after.height, renderNitroBackgroundImage(after));
const cell = parseNitroCellEffect('cursor', 17, 5, 7, 8, files[17]!, files[5]!, files[7]!, files[8]!);
for (const seq of cell.sequences) {
 const f = seq.frames[0]; if (f) png('cursor-' + seq.index, f.width, f.height, f.rgba);
}
console.log(bg.width, bg.height, cell.width, cell.height, cell.warnings);
