import { readU16, writeU32 } from "../nds/binary";
import { parseNitroBackground } from "../pokeweb/nitroBg";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { parsePokemonAnimation, parsePokemonCellBank } from "../pokeweb/pokemonSpriteModel";
import { blank, blit } from "./raster";
import { expand555, type Image } from "./assets";
import { SUMMARY_ART_KEYS } from "./summaryCatalog";

export type SummaryArt = {
  layers: Record<string, Image>;
  sprites: Record<string, Image & { x: number; y: number }>;
  palette: string[]; platePalette: string[]; hpPalette: string[]; typeNames: string[];
};
const colors = (b: Uint8Array) => Array.from({ length: (b.length - 40) / 2 }, (_, i) => `#${expand555(readU16(b, 40 + i * 2)).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`);
function background(files: Uint8Array[], index: number, chars: number, palette: number, transparent = true): Image {
  const b = parseNitroBackground(index, files[index], files[chars], files[palette], { transparentIndexZero: transparent });
  if (b.warnings.length) throw new Error(`Summary graphics: ${b.warnings.join("; ")}`);
  return { width: b.width, height: b.height, pixels: b.rgba };
}
/** Keep the scroll and panel layers separate: hardware blends in RGB555 space. */
export function summaryLayers(files: Uint8Array[], key: string, black2: boolean): Record<string, Image> {
  if (!SUMMARY_ART_KEYS.includes(key)) throw new Error("Unknown Summary artwork.");
  if (files.length < 181) throw new Error("The Summary graphics archive is not a recognized layout.");
  const [, page, physical] = key.split(":"), top = physical === "top", pal = (top ? 2 : 0) + Number(black2), chars = top ? 12 : 10;
  const plate = top ? { info: 66, stats: 75, moves: 76, ribbons: 69 } : { info: 65, stats: 74, moves: 74, ribbons: 68 };
  const layers: Record<string, Image> = { grid: background(files, top ? 73 : 72, chars, pal, false), plate: background(files, plate[page as keyof typeof plate], chars, pal) };
  if (top) layers.title = background(files, ({ info: 67, stats: 77, moves: 78, ribbons: 71 })[page as "info"], 11, pal);
  return layers;
}
export function composeSummary(layers: Record<string, Image>, frame: number): Image {
  const result = blank(256, 192), { grid, plate, title } = layers, offset = Math.floor(Math.max(0, frame) / 4);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
    const at = (y * 256 + x) * 4, g = (((y + offset) % grid.height) * grid.width + (x + offset) % grid.width) * 4, p = (y * plate.width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const back = grid.pixels[g + c] >> 3, front = plate.pixels[p + c] >> 3;
      const value = plate.pixels[p + 3] ? Math.min(31, (front * 13 + back * 16) >> 4) : back;
      result.pixels[at + c] = Math.round(value * 255 / 31);
    }
    result.pixels[at + 3] = 255;
  }
  if (title) blit(result, title, { x: 0, y: 0, width: title.width, height: title.height });
  return result;
}
export function summaryArtwork(files: Uint8Array[], key: string, black2: boolean): Image | undefined {
  return SUMMARY_ART_KEYS.includes(key) ? composeSummary(summaryLayers(files, key, black2), 0) : undefined;
}
export function nativeSummaryArt(files: Uint8Array[], common: Uint8Array[], font: Uint8Array, black2: boolean, typeNames: string[]): SummaryArt {
  const art: SummaryArt = { layers: {}, sprites: {}, palette: colors(font), platePalette: colors(files[7]), hpPalette: colors(common[0]), typeNames };
  for (const key of SUMMARY_ART_KEYS) for (const [layer, image] of Object.entries(summaryLayers(files, key, black2))) art.layers[`${key}:${layer}`] = image;
  art.layers.footer = background(common, 29, 28, 27);
  // The Summary palette installs two additional shadows for nature modifiers.
  art.palette[9] = "#ce949c"; art.palette[10] = "#9494d6";
  function bank(char: Uint8Array, palette: Uint8Array, sourceCell: Uint8Array, animation: Uint8Array, mapping?: number) {
    const cell = sourceCell.slice(); if (mapping !== undefined) writeU32(cell, 32, mapping);
    const cells = parsePokemonCellBank(cell).cells, sequences = parsePokemonAnimation(animation).sequences;
    return (name: string, sequence: number, paletteId?: number) => {
      const frame = sequences[sequence]?.frames[0], oams = frame && cells[frame.cellIndex]?.oams.filter(o => !o.disable);
      if (!frame || !oams?.length || frame.rotation || frame.xScale !== 1 || frame.yScale !== 1 || oams.some(o => o.rotateScale)) throw new Error(`Unsupported native Summary cell: ${name}.`);
      const pal = palette.slice(); if (paletteId !== undefined) pal.set(palette.subarray(40 + paletteId * 32, 72 + paletteId * 32), 40);
      const x = Math.min(...oams.map(o => o.x)), y = Math.min(...oams.map(o => o.y));
      const width = Math.max(...oams.map(o => o.x + o.width)) - x, height = Math.max(...oams.map(o => o.y + o.height)) - y;
      // The cell decoder centers the origin in its canvas. Summary move plates
      // extend to x=136, beyond the default canvas's positive limit of 128.
      // Include every OAM extent before cropping so edges cannot be clipped or
      // read back from the beginning of the next canvas row.
      const halfSize = Math.max(128, -x, -y, x + width, y + height);
      const decoded = parseNitroCellImage(name, char, pal, cell, frame.cellIndex, halfSize * 2), image = blank(width, height);
      if (decoded.warnings.length) throw new Error(`Summary ${name}: ${decoded.warnings.join("; ")}`);
      for (let row = 0; row < height; row++) { const start = ((halfSize + y + row) * decoded.width + halfSize + x) * 4; image.pixels.set(decoded.rgba.subarray(start, start + width * 4), row * width * 4); }
      art.sprites[name] = { ...image, x: x + frame.x, y: y + frame.y };
    };
  }
  const plate = bank(files[17], files[7], files[83], files[134]);
  for (let i = 0; i < 4; i++) { plate(`move-${i}`, i); plate(`move-selected-${i}`, i + 5); }
  const pages = bank(files[13], files[5], files[80], files[131]);
  for (let i = 0; i < 9; i++) pages(`page-${i}`, i);
  const footer = bank(common[20], common[19], common[23], common[26]);
  for (const [name, seq] of [["exit", 0], ["back", 1], ["down", 2], ["up", 3], ["check", 6]] as const) footer(name, seq);
  bank(common[2], common[1], common[5], common[8], 0x10)("hp-frame", 0);
  const typePalette = [0, 0, 1, 1, 0, 0, 2, 1, 0, 0, 1, 2, 0, 1, 1, 2, 0];
  for (let i = 0; i < typePalette.length; i++) bank(common[34 + i], common[33], common[59], common[62], 0x10)(`type-${i}`, 0, typePalette[i]);
  for (let i = 0; i < 3; i++) bank(common[56 + i], common[33], common[59], common[62], 0x10)(`category-${i}`, 0, 0);
  for (let i = 0; i < 25; i++) bank(common[112 + i], common[87 + i], common[137], common[140], 0x10)(`ball-${i}`, 0);
  const marks = bank(common[146], common[143], common[149], common[152]);
  for (let i = 0; i < 12; i++) marks(`mark-${i}`, i);
  return art;
}
