import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import type { NARC } from "../nds/narc";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { parsePokemonAnimation } from "../pokeweb/pokemonSpriteModel";
import { blank, blit } from "../customUi/raster";
import type { Image } from "../customUi/assets";
import { skinPreview } from "./skins";

/** Decode the native layers and controls; no substitute browser fonts or icons. */
export function nativePreview(native: NARC, theme = 0, gender = 0, design = 0, power = true, skin?:Uint8Array,hideCommunication=false,graphics?:NARC): Image {
  const f = native.files.slice();if(graphics){f[16]=graphics.files[0];f[17]=graphics.files[1];}
  const bgPalette = f[4 + gender].slice(), objPalette = f[14 + gender].slice();
  const ring = f[6], ringAt = 40 + (theme + gender * 6) * 32;
  bgPalette.set(f[7].subarray(ringAt, ringAt + 32), 40);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++)
    writeU16(bgPalette, 40 + (17 + i * 3 + j) * 2, readU16(ring, ringAt + j * 2));
  for (const bank of [0, 1, 2, 3, 4]) for (let j = 0; j < 3; j++) {
    writeU16(objPalette, 40 + (bank * 16 + 1 + j) * 2, readU16(ring, ringAt + 6 + j * 2));
    if (bank < 2) writeU16(objPalette, 40 + (bank * 16 + 4 + j) * 2, readU16(ring, ringAt + 12 + j * 2));
  }
  const image = blank(256, 192);
  for (const map of [12, power ? 11 : 10, 9]) {
    const layer = parseNitroBackground(map, f[map], f[8], bgPalette, { transparentIndexZero: map !== 12 });
    if (layer.warnings.length) throw new Error(layer.warnings.join("; "));
    blit(image, { width: layer.width, height: layer.height, pixels: layer.rgba }, { x: 0, y: 0, width: layer.width, height: layer.height });
  }
  if(skin){
    // Native BG1 uses EVA 21 (hardware-clamped to 16) and EVB 10; sprites remain above it.
    const decal=skinPreview(skin);
    for(let i=0;i<image.pixels.length;i+=4)if(decal.pixels[i+3])for(let c=0;c<3;c++)
      image.pixels[i+c]=Math.round(Math.min(31,Math.round(decal.pixels[i+c]*31/255)+Math.floor(Math.round(image.pixels[i+c]*31/255)*10/16))*255/31);
  }
  const cells = [f[17].slice(), f[29].slice()];
  for (const cell of cells) {
    writeU32(cell, 32, 0x10);
    const count=readU16(cell,24),start=24+readU32(cell,28),oam=start+count*16;
    // Lower OAM indices have display priority; the generic painter draws last on top.
    for(let i=0;i<count;i++) {
      const n=readU16(cell,start+i*16),at=oam+readU32(cell,start+i*16+4),saved=cell.slice(at,at+n*6);
      for(let j=0;j<n;j++)cell.set(saved.subarray((n-1-j)*6,(n-j)*6),at+j*6);
    }
  }
  const common = parsePokemonAnimation(f[18]).sequences, panel = parsePokemonAnimation(f[30]).sequences;
  function sprite(sequence: number, x: number, y: number, isPanel = false) {
    const frame = (isPanel ? panel : common)[sequence]?.frames[0];
    if (!frame) throw new Error(`Native C-Gear sequence ${sequence} is missing.`);
    const decoded = parseNitroCellImage("cgear", f[isPanel ? 19 + gender * 5 + design : 16], objPalette, cells[Number(isPanel)], frame.cellIndex, 256);
    if (decoded.warnings.length) throw new Error(decoded.warnings.join("; "));
    blit(image, { width: 256, height: 256, pixels: decoded.rgba }, { x: x + frame.x - 128, y: y + frame.y - 128, width: 256, height: 256 });
  }
  sprite(1, 48, 18); for(const x of [33,39,47,53])sprite(0,x,14); sprite(5, 208, 18); sprite(21, 128, 10);
  sprite(6, 200, 180); sprite(8, 215, 163); sprite(10, 228, 144);
  if(!hideCommunication)sprite(power ? 12 : 14, 35, 160); sprite(3, 128, 96); sprite(power ? 16 : 17, 128, 86);
  // Rings sit behind their pattern/label plates in native OAM order.
  if (power&&!hideCommunication) for (const [i, x, y] of [[0, 68, 60], [1, 128, 164], [2, 188, 60]]) {
    sprite(22 + i, x, y); sprite(i, x, y, true);
  }
  return image;
}
