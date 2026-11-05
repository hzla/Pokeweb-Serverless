import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { parseNitroBackground, parseNitroPalette } from "../pokeweb/nitroBg";
import { parsePokemonCellBank } from "../pokeweb/pokemonSpriteModel";
import { parseNitroCellImage } from "../pokeweb/nitroCell";
import { NativeFont, rgb555, type Image } from "../customUi/assets";
import { blank, blit, fill } from "../customUi/raster";
import { defaults, type Design } from "./document";

export const ICONS = [9, 13, 7, 12, 10, 6];
export const CELLS = [25, 29, 23, 28, 26, 22];
export type Resources = { files: Uint8Array[]; font: NativeFont; hudFont?: NativeFont; labels: string[]; game: "B2" | "W2" };
export type PreviewOptions = { gender: "male" | "female"; focus: number; pressed: boolean; trainer: string };
export function block(bytes: Uint8Array, stamp: string): number {
  for (let at = 16; at + 8 <= bytes.length;) {
    const length = readU32(bytes, at + 4);
    if (length < 8 || at + length > bytes.length) break;
    if (readAscii(bytes, at, 4) === stamp) return at;
    at += length;
  }
  throw new Error(`Native graphics are missing ${stamp}.`);
}
export function crop(image: Image, x: number, y: number, width: number, height: number): Image {
  const result = blank(width, height);
  for (let row = 0; row < height; row++) result.pixels.set(image.pixels.subarray(((row + y) * image.width + x) * 4, ((row + y) * image.width + x + width) * 4), row * width * 4);
  return result;
}
export function iconMembers(id: number, gender: "male" | "female"): [number, number] {
  if (gender === "female" && id === 2) return [14, 30];
  if (gender === "female" && id === 3) return [8, 24];
  return [ICONS[id - 1], CELLS[id - 1]];
}
/** Palette entries referenced by the fixed controls cannot be recolored. */
export function fixedPaletteColors(files: Uint8Array[]): Set<number> {
  const pinned = new Set<number>();
  for (const [character, cells] of [[5, 21], [11, 27]]) {
    const bytes = files[character], at = block(bytes, "RAHC") + 32;
    for (const cell of parsePokemonCellBank(files[cells]).cells) for (const oam of cell.oams) {
      for (let ty = 0; ty < oam.height / 8; ty++) for (let tx = 0; tx < oam.width / 8; tx++) {
        const tile = tilePixels(bytes, at, oam.characterName + ty * oam.width / 8 + tx);
        for (const index of tile) if (index) pinned.add(oam.palette * 16 + index);
      }
    }
  }
  return pinned;
}
export function iconImage(files: Uint8Array[], id: number, gender: "male" | "female", selected: boolean): Image {
  const [character, cell] = iconMembers(id, gender), normalized = new Uint8Array(files[cell]);
  // The field menu loads these cells in 1D 32-byte OBJ mapping.
  new DataView(normalized.buffer).setUint32(32, 0x10, true);
  const parsed = parseNitroCellImage("menu-icon", files[character], files[2], normalized, selected ? 1 : 0);
  const bounds = parsePokemonCellBank(files[cell]).cells[selected ? 1 : 0];
  return crop({ width: 256, height: 256, pixels: parsed.rgba }, 128 + bounds.minX, 128 + bounds.minY, 32, 32);
}
function tilePixels(bytes: Uint8Array, start: number, tile: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => bytes[start + tile * 32 + (i >> 1)] >> (i % 2 * 4) & 15);
}
const key = (tile: Uint8Array) => String.fromCharCode(...tile);
function colorDistance(a: number, b: number): number { return (a % 32 - b % 32) ** 2 + ((a >> 5 & 31) - (b >> 5 & 31)) ** 2 + ((a >> 10 & 31) - (b >> 10 & 31)) ** 2; }
function indexImage(image: Image, palette: number[]): { pixels: Uint8Array; quantized: boolean } {
  let quantized = false;
  const pixels = new Uint8Array(image.width * image.height), cache = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    if (image.pixels[i * 4 + 3] < 128) continue;
    const rgb = (image.pixels[i * 4] >> 3) | ((image.pixels[i * 4 + 1] >> 3) << 5) | ((image.pixels[i * 4 + 2] >> 3) << 10);
    let value = cache.get(rgb);
    if (value === undefined) {
      let score = Infinity; value = 1;
      for (let n = 1; n < 16; n++) { const distance = colorDistance(rgb, palette[n]); if (distance < score) { score = distance; value = n; } }
      if (palette[value] !== rgb) quantized = true;
      cache.set(rgb, value);
    }
    pixels[i] = value;
  }
  return { pixels, quantized };
}
export function compileGraphics(source: Uint8Array[], design: Design, game: "B2" | "W2"): { files: Uint8Array[]; quantized: boolean } {
  if (source.length < 43) throw new Error("The native menu archive is incomplete.");
  const files = source.map(b => new Uint8Array(b));
  let quantized = false;
  const colorsAt = block(files[2], "TTLP") + 24;
  const pinnedColors = fixedPaletteColors(source);
  for (const [address, color] of Object.entries(design.colors)) {
    const index = Number(address.split(":")[1]);
    if (pinnedColors.has(index)) throw new Error("This palette color is shared with a fixed control.");
    writeU16(files[2], colorsAt + index * 2, rgb555(color));
  }
  for (const [name, image] of Object.entries(design.images).filter(([name]) => name.startsWith("icon:"))) {
    const [, id, gender, state] = name.split(":"), [member, cell] = iconMembers(Number(id), gender as "male" | "female");
    const selected = state === "selected", bank = parsePokemonCellBank(files[cell]).cells[selected ? 1 : 0].oams[0].palette, paletteAt = colorsAt + bank * 32;
    const indexed = indexImage(image, Array.from({ length: 16 }, (_, i) => readU16(files[2], paletteAt + i * 2)));
    quantized ||= indexed.quantized;
    const bytes = files[member], offset = block(bytes, "RAHC") + 32 + (selected ? 512 : 0);
    if (offset + 512 > bytes.length) throw new Error("The icon sheet cannot hold a native 32×32 frame.");
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) for (let p = 0; p < 32; p++) {
      const pixel = (ty * 8 + (p >> 2)) * 32 + tx * 8 + (p % 4) * 2;
      bytes[offset + (ty * 4 + tx) * 32 + p] = indexed.pixels[pixel] | indexed.pixels[pixel + 1] << 4;
    }
  }
  const positions = defaults().buttons, moved = design.buttons.some((b, i) => b.x !== positions[i].x || b.y !== positions[i].y);
  if (!moved && !Object.keys(design.images).some(k => k.startsWith("body:"))) return { files, quantized };
  const ncgr = files[3], dataAt = block(ncgr, "RAHC") + 32, tileCount = readU32(ncgr, block(ncgr, "RAHC") + 24) / 32;
  const tiles = Array.from({ length: tileCount }, (_, i) => tilePixels(ncgr, dataAt, i));
  const nscr = files[18], mapAt = block(nscr, "NRCS") + 20;
  const original = Array.from({ length: (nscr.length - mapAt) / 2 }, (_, i) => readU16(nscr, mapAt + i * 2)), mapped = [...original];
  const blankTile = tiles.findIndex(t => t.every(n => n === 0));
  if (blankTile < 0) throw new Error("The native panel has no transparent tile.");
  for (const p of positions) for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) mapped[(p.y / 8 + y) * 32 + p.x / 8 + x] = blankTile;
  const pinned = new Set<number>();
  // Other menu modes and the background retain their original tile references.
  for (const member of [16, 18, 19, 20]) { const at = block(source[member], "NRCS") + 20; for (let i = at; i + 2 <= source[member].length; i += 2) pinned.add(readU16(source[member], i) & 1023); }
  for (const value of mapped) pinned.add(value & 1023);
  const palettes = files[game === "B2" ? 1 : 0], paletteAt = block(palettes, "TTLP") + 24;
  const wanted: { square: number; bank: number; tile: Uint8Array }[] = [];
  for (const b of design.buttons) {
    const p = positions[b.id - 1], image = design.images[`body:${b.id}`];
    const indexed = new Map<number, Uint8Array>();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) {
      const value = original[(p.y / 8 + y) * 32 + p.x / 8 + x], square = (b.y / 8 + y) * 32 + b.x / 8 + x;
      if (!image) { mapped[square] = value; pinned.add(value & 1023); continue; }
      const bank = value >> 12;
      if (!indexed.has(bank)) { const result = indexImage(image, Array.from({ length: 16 }, (_, i) => readU16(palettes, paletteAt + (bank * 16 + i) * 2))); indexed.set(bank, result.pixels); quantized ||= result.quantized; }
      const pixels = indexed.get(bank)!;
      wanted.push({ square, bank, tile: Uint8Array.from({ length: 64 }, (_, i) => pixels[(y * 8 + (i >> 3)) * 128 + x * 8 + i % 8]) });
    }
  }
  const lookup = new Map(tiles.map((t, i) => [key(t), i]));
  for (const w of wanted) { const found = lookup.get(key(w.tile)); if (found !== undefined) pinned.add(found); }
  const free = tiles.map((_, i) => i).filter(i => !pinned.has(i));
  for (const w of wanted) {
    const k = key(w.tile); let tile = lookup.get(k);
    if (tile === undefined) {
      tile = free.shift(); if (tile === undefined) throw new Error(`Artwork exceeds the native ${tileCount}-tile panel budget. Simplify the imported image.`);
      lookup.delete(key(tiles[tile])); tiles[tile] = w.tile; lookup.set(k, tile);
      for (let p = 0; p < 32; p++) ncgr[dataAt + tile * 32 + p] = w.tile[p * 2] | w.tile[p * 2 + 1] << 4;
    }
    mapped[w.square] = tile | w.bank << 12;
  }
  mapped.forEach((entry, i) => writeU16(nscr, mapAt + i * 2, entry));
  // Mode 6 also uses map 18. Give it an unedited copy before changing the normal menu.
  files[source.length] = new Uint8Array(source[18]);
  return { files, quantized };
}
export function bodyImage(files: Uint8Array[], id: number, game: "B2" | "W2"): Image {
  const image = parseNitroBackground(18, files[18], files[3], files[game === "B2" ? 1 : 0], { transparentIndexZero: true });
  const b = defaults().buttons[id - 1];
  return crop({ width: image.width, height: image.height, pixels: image.rgba }, b.x, b.y, 128, 40);
}
function nativeText(target: Image, font: NativeFont, value: string, x: number, y: number, foreground = [255, 255, 255]): void {
  for (const c of value) {
    const glyph = font.glyph(c); if (!glyph) continue;
    for (let gy = 0; gy < glyph.height; gy++) for (let gx = 0; gx < glyph.width; gx++) {
      const level = glyph.pixels[gy * glyph.width + gx], px = x + gx, py = y + gy;
      if (level && px >= 0 && py >= 0 && px < target.width && py < target.height) target.pixels.set([...(level === 1 ? foreground : [82, 82, 90]), 255], (py * target.width + px) * 4);
    }
    x += glyph.advance;
  }
}
export function compose(resources: Resources, design: Design, options: PreviewOptions): Image {
  const compiled = compileGraphics(resources.files, design, resources.game), f = compiled.files, theme = resources.game === "B2" ? 1 : 0;
  const bg = parseNitroBackground(16, f[16], f[3], f[theme]), target: Image = { width: 256, height: 192, pixels: bg.rgba.slice() };
  const footer = parseNitroBackground(17, f[17], f[4], f[1], { transparentIndexZero: true });
  blit(target, { width: footer.width, height: footer.height, pixels: footer.rgba }, { x: 0, y: 0, width: 256, height: 192 });
  const panel = parseNitroBackground(18, f[18], f[3], f[theme], { transparentIndexZero: true });
  blit(target, { width: 256, height: 192, pixels: panel.rgba.slice(0, 256 * 192 * 4) }, { x: 0, y: 0, width: 256, height: 192 });
  // These fixed controls are context; the editor never writes their resources.
  fill(target, { x: 0, y: 0, width: 256, height: 12 }, "#181818");
  nativeText(target, resources.hudFont ?? resources.font, "12:00", 6, 0);
  const indicators = blank(176, 16); nativeText(indicators, resources.font, "IR   ONLINE   WIRELESS", 0, 0, [96, 96, 96]);
  blit(target, indicators, { x: 80, y: 2, width: 176, height: 5 });
  nativeText(target, resources.font, "×", 230, 172, [255, 40, 40]);
  for (const b of design.buttons) {
    const selected = options.focus === b.id, icon = iconImage(f, b.id, options.gender, selected);
    if (selected) {
      const cells = new Uint8Array(f[31]); new DataView(cells.buffer).setUint32(32, 0x10, true);
      const highlight = parseNitroCellImage("menu-focus", f[15], f[2], cells, 0);
      const frame = crop({ width: 256, height: 256, pixels: highlight.rgba }, 64, 108, 128, 40);
      blit(target, frame, { x: b.x, y: b.y, width: 128, height: 40 });
    }
    blit(target, icon, { x: b.iconX - 28, y: b.iconY - 16 + (options.pressed && selected ? 1 : 0), width: 32, height: 32 });
    nativeText(target, resources.font, b.label ?? (b.id === 4 ? options.trainer : resources.labels[b.id]), b.labelX, b.labelY);
  }
  return target;
}
export function iconPalette(files: Uint8Array[]): string[] {
  return parseNitroPalette(files[2]).map(c => `#${c.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`);
}
