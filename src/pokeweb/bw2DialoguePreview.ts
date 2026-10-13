import { readAscii, readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";
import { decompressNitro } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";

export type DialogueGlyph = { left: number; width: number; advance: number; pixels: Uint8Array };
export type DialogueFont = { width: number; height: number; maxAdvance: number; glyphs: ReadonlyMap<number, DialogueGlyph>; fallback: DialogueGlyph };
export type DialogueAssets = { font: DialogueFont; frame: Uint8Array[]; framePalette: NitroPaletteData; fontPalette: NitroPaletteData; arrow: Uint8Array; arrowPalette: NitroPaletteData };
export type DialogueVariables = Record<number, { length: number; label: string }>;
export type DialoguePage = { glyphs: { code: number; x: number; y: number; placeholder?: boolean }[]; widths: number[]; end: string };
export type DialogueLayout = { pages: DialoguePage[]; warnings: string[]; variables: { slot: number; length: number; label: string }[] };
export const DIALOGUE_WIDTH = 256, DIALOGUE_HEIGHT = 48, DIALOGUE_LINE_WIDTH = 232;

/** BW2's GFTR cells carry three width bytes before the packed 2bpp bitmap.
 * Character-map bodies use absolute next-body offsets, including direct,
 * table and sparse mappings. No game glyphs are shipped with this reader. */
export function parseBw2DialogueFont(bytes: Uint8Array): DialogueFont {
  const range = (at: number, length: number) => { if (at < 0 || length < 0 || at + length > bytes.length) throw new Error("Dialogue font data is truncated."); };
  range(0, 44);
  if (readAscii(bytes, 0, 4) !== "RTFN" || readAscii(bytes, 16, 4) !== "FNIF") throw new Error("Unsupported dialogue font format.");
  const glyphAt = readU32(bytes, 32), mapAt = readU32(bytes, 40);
  range(glyphAt - 8, 16);
  if (readAscii(bytes, glyphAt - 8, 4) !== "PLGC" || bytes[glyphAt + 6] !== 2) throw new Error("Unsupported dialogue glyph format.");
  const width = bytes[glyphAt], height = bytes[glyphAt + 1], cellSize = readU16(bytes, glyphAt + 2);
  const size = readU32(bytes, glyphAt - 4), count = Math.floor((size - 16) / cellSize);
  if (!width || width > 32 || !height || height > 32 || cellSize < 3 + Math.ceil(width * height / 4) || !count || count > 65536) throw new Error("Invalid dialogue font geometry.");
  range(glyphAt + 8, count * cellSize);
  const cells: DialogueGlyph[] = [];
  for (let index = 0; index < count; index++) {
    const at = glyphAt + 8 + index * cellSize, pixels = new Uint8Array(width * height);
    for (let dot = 0; dot < pixels.length; dot++) pixels[dot] = (bytes[at + 3 + (dot >>> 2)] >>> (6 - (dot % 4) * 2)) & 3;
    cells.push({ left: bytes[at] << 24 >> 24, width: bytes[at + 1], advance: bytes[at + 2], pixels });
  }
  const glyphs = new Map<number, DialogueGlyph>(), seen = new Set<number>();
  let at = mapAt;
  while (at) {
    range(at - 8, 20);
    if (seen.has(at) || readAscii(bytes, at - 8, 4) !== "PAMC") throw new Error("Invalid dialogue character map.");
    seen.add(at);
    const end = at - 8 + readU32(bytes, at - 4); range(at, end - at);
    const first = readU16(bytes, at), last = readU16(bytes, at + 2), method = readU16(bytes, at + 4);
    const assign = (code: number, index: number) => { if (index === 0xffff) return; if (!cells[index]) throw new Error("Dialogue character map references an invalid glyph."); if (!glyphs.has(code)) glyphs.set(code, cells[index]); };
    const u16 = (offset: number) => { if (offset + 2 > end) throw new Error("Truncated dialogue character map."); return readU16(bytes, offset); };
    if (last < first) throw new Error("Invalid dialogue character range.");
    if (method === 0) { const start = u16(at + 12); for (let code = first; code <= last; code++) assign(code, start + code - first); }
    else if (method === 1) for (let code = first; code <= last; code++) assign(code, u16(at + 12 + (code - first) * 2));
    else if (method === 2) { const length = u16(at + 12); for (let i = 0; i < length; i++) assign(u16(at + 14 + i * 4), u16(at + 16 + i * 4)); }
    else throw new Error("Unsupported dialogue character mapping.");
    const next = readU32(bytes, at + 8);
    // The converted retail GFTR's final catch-all map points one block-header
    // beyond EOF. It covers the entire 16-bit range and has no further body.
    at = end === bytes.length && first === 0 && last === 0xffff && method === 2 && next === end + 8 ? 0 : next;
  }
  return { width, height, glyphs, maxAdvance: Math.max(...cells.map((glyph) => glyph.advance)), fallback: glyphs.get(63) ?? cells[0] };
}

function characterTiles(bytes: Uint8Array): Uint8Array[] {
  if (readAscii(bytes, 0, 4) !== "RGCN" || readAscii(bytes, 16, 4) !== "RAHC" || readU32(bytes, 28) !== 3) throw new Error("Unsupported dialogue graphics.");
  const size = readU32(bytes, 40), at = 24 + readU32(bytes, 44);
  if (at + size > bytes.length || size % 32) throw new Error("Truncated dialogue tiles.");
  return Array.from({ length: size / 32 }, (_, index) => Uint8Array.from({ length: 64 }, (_, dot) => (bytes[at + index * 32 + (dot >>> 1)] >>> ((dot % 2) * 4)) & 15));
}
const expand = (bytes: Uint8Array) => [0x10, 0x11, 0x30].includes(bytes[0]) ? decompressNitro(bytes) : bytes;
export function decodeBw2DialogueAssets(font: readonly Uint8Array[], frame: readonly Uint8Array[]): DialogueAssets {
  if (!font[0] || !font[6] || !frame[0] || !frame[5] || !frame[4] || !frame[11]) throw new Error("The ROM is missing dialogue graphics.");
  const tiles = characterTiles(expand(frame[5]));
  if (tiles.length < 6) throw new Error("Incomplete dialogue frame tiles.");
  return { font: parseBw2DialogueFont(expand(font[0])), frame: tiles, framePalette: parseNitroPalette(expand(frame[0])), fontPalette: parseNitroPalette(expand(font[6])), arrow: characterTiles(expand(frame[11]))[0], arrowPalette: parseNitroPalette(expand(frame[4])) };
}

type Cached = { fontId: number; frameId: number; fontEdit?: Uint8Array; frameEdit?: Uint8Array; assets: DialogueAssets };
const cache = new WeakMap<ProjectState, Cached>();
const pending = new WeakMap<ProjectState, Promise<DialogueAssets>>();
/** Read current file replacements before the matched export-base ROM. Retain
 * only copied font/frame resources, never a view into the full ROM buffer. */
export async function loadBw2DialogueAssets(project: ProjectState): Promise<DialogueAssets> {
  const previous = cache.get(project);
  if (previous && previous.fontEdit === project.fileSystem?.replacements[previous.fontId] && previous.frameEdit === project.fileSystem?.replacements[previous.frameId]) return previous.assets;
  if (pending.has(project)) return pending.get(project)!;
  const promise = (async () => {
    const { activeRomMatchesProject, loadActiveRomBytes } = await import("./persistence");
    if (!project.originalRomBytes && !await activeRomMatchesProject(project)) throw new Error("Reconnect this project's source ROM to preview its dialogue graphics.");
    const bytes = project.originalRomBytes ?? await loadActiveRomBytes();
    if (!bytes) throw new Error("Dialogue source ROM is unavailable.");
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    if (rom.idCode !== project.romInfo.idCode || bytes.length !== project.romInfo.size) throw new Error("Dialogue resources do not match this project.");
    const fontId = rom.fileId("a/0/2/3"), frameId = rom.fileId("a/0/0/5");
    const fontEdit = project.fileSystem?.replacements[fontId], frameEdit = project.fileSystem?.replacements[frameId];
    const font = new NARC((fontEdit ?? rom.files[fontId]).slice()), frame = new NARC((frameEdit ?? rom.files[frameId]).slice());
    const assets = decodeBw2DialogueAssets(font.files, frame.files);
    cache.set(project, { fontId, frameId, fontEdit, frameEdit, assets }); return assets;
  })();
  pending.set(project, promise);
  try { return await promise; } finally { pending.delete(project); }
}

/** The native printer advances fixed 16px rows and never wraps horizontally.
 * A page/scroll control consumes an immediately following newline. */
export function layoutBw2Dialogue(text: string, font: DialogueFont, variables: DialogueVariables = {}): DialogueLayout {
  const pages: DialoguePage[] = [], warnings = new Set<string>(), used = new Map<number, { slot: number; length: number; label: string }>();
  let glyphs: DialoguePage["glyphs"] = [], widths = [0, 0], x = 0, row = 0, skipNewline = false, count = 0, changed = false;
  const put = (code: number, placeholder = false) => {
    if (++count > 12000) throw new Error("Dialogue preview exceeds the 12,000-glyph limit.");
    if (!font.glyphs.has(code)) warnings.add(`Unsupported glyph U+${code.toString(16).toUpperCase().padStart(4, "0")}; shown as ?.`);
    glyphs.push({ code, x, y: row * 16, placeholder });
    changed = true;
    x += placeholder ? font.maxAdvance : (font.glyphs.get(code) ?? font.fallback).advance;
    widths[row] = Math.max(widths[row] ?? 0, x);
  };
  const finish = (end: string) => { pages.push({ glyphs: [...glyphs], widths: [...widths], end }); };
  const control = (kind: "clear" | "scroll") => {
    if (glyphs.length) finish(kind === "clear" ? "\\r · clear page" : "\\f · scroll one line");
    if (kind === "clear") { glyphs = []; widths = [0, 0]; row = 0; }
    else { glyphs = glyphs.filter((glyph) => glyph.y >= 16).map((glyph) => ({ ...glyph, y: glyph.y - 16 })); widths = [widths[1] ?? 0, 0]; row = 1; }
    x = 0; skipNewline = true;
    changed = false;
  };
  const newline = () => { if (skipNewline) { skipNewline = false; return; } x = 0; row++; };
  for (let at = 0; at < text.length;) {
    if (text.startsWith("\\r", at) || text.startsWith("\\f", at)) { control(text[at + 1] === "r" ? "clear" : "scroll"); at += 2; continue; }
    if (text.startsWith("\\n", at) || text[at] === "\n") { newline(); at += text[at] === "\\" ? 2 : 1; continue; }
    if (text.startsWith("VAR(", at)) {
      const match = /^VAR\(([^)]*)\)/.exec(text.slice(at));
      if (!match) throw new Error("Unclosed VAR in dialogue preview.");
      const args = match[1].split(",").map((value) => Number(value.trim())), tag = args[0], group = tag >>> 8;
      if (args.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) throw new Error("Invalid VAR control in dialogue preview.");
      if (group === 1 || group === 2) {
        const slot = args[1] ?? 0, limit = variables[slot] ?? { length: 64, label: "unknown word buffer (conservative bound)" };
        const length = Math.max(1, Math.min(64, limit.length)); used.set(slot, { slot, length, label: limit.label });
        skipNewline = false; for (let i = 0; i < length; i++) put(87, true);
      } else if (tag === 0xbe00 || tag === 0xbe01) control(tag === 0xbe01 ? "clear" : "scroll");
      else if (group === 190 && (tag & 255) >= 2 && (tag & 255) <= 9) { /* Printing waits/callbacks do not add glyphs. */ }
      else if (tag === 0xbd04 || tag === 0xbd05) { x = tag === 0xbd04 ? x + (args[1] ?? 0) : (args[1] ?? 0); }
      else warnings.add(`Control 0x${tag.toString(16)} is not simulated in this preview.`);
      at += match[0].length; continue;
    }
    const escaped = /^\\x([\da-fA-F]{4})/.exec(text.slice(at));
    skipNewline = false;
    if (escaped) { const code = parseInt(escaped[1], 16); if (code === 0xffff) break; if (code === 0xfffe) newline(); else put(code); at += 6; }
    else { put(text.charCodeAt(at)); at++; }
  }
  if (changed || !pages.length) finish("End");
  for (const [index, page] of pages.entries()) page.widths.forEach((width, line) => {
    if (width > DIALOGUE_LINE_WIDTH) warnings.add(`Page ${index + 1}, line ${line + 1}: ${width}px exceeds ${DIALOGUE_LINE_WIDTH}px by ${width - DIALOGUE_LINE_WIDTH}px.`);
    if (line > 1 && width) warnings.add(`Page ${index + 1}: line ${line + 1} is below the two-line dialogue box. Insert \\r or \\f.`);
  });
  return { pages, warnings: [...warnings], variables: [...used.values()] };
}

export function renderBw2DialoguePage(assets: DialogueAssets, page: DialoguePage): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(DIALOGUE_WIDTH * DIALOGUE_HEIGHT * 4);
  const pixel = (x: number, y: number, color: readonly number[]) => { if (x < 0 || y < 0 || x >= DIALOGUE_WIDTH || y >= DIALOGUE_HEIGHT) return; rgba.set(color, (y * DIALOGUE_WIDTH + x) * 4); };
  for (let y = 0; y < DIALOGUE_HEIGHT; y++) for (let x = 0; x < DIALOGUE_WIDTH; x++) pixel(x, y, assets.fontPalette[15]);
  const tile = (index: number, x: number, y: number, flipX = false, flipY = false) => {
    for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) { const value = assets.frame[index][(flipY ? 7 - yy : yy) * 8 + (flipX ? 7 - xx : xx)]; pixel(x + xx, y + yy, value ? assets.framePalette[value] : [0, 0, 0, 0]); }
  };
  tile(1, 0, 0); tile(1, 248, 0, true); tile(1, 0, 40, false, true); tile(1, 248, 40, true, true);
  for (let x = 8; x < 248; x += 8) { tile(3, x, 0); tile(3, x, 40, false, true); }
  for (let y = 8; y < 40; y += 8) { tile(4, 0, y); tile(4, 248, y, true); }
  for (const positioned of page.glyphs) {
    const glyph = assets.font.glyphs.get(positioned.code) ?? assets.font.fallback;
    for (let y = 0; y < assets.font.height; y++) for (let x = 0; x < glyph.width; x++) {
      const value = glyph.pixels[y * assets.font.width + x], dx = 16 + positioned.x + glyph.left + x, dy = 8 + positioned.y + y;
      if (value && dx >= 8 && dx < 248 && dy >= 8 && dy < 40) pixel(dx, dy, assets.fontPalette[value]);
    }
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const value = assets.arrow[y * 8 + x]; if (value) pixel(240 + x, 32 + y, assets.arrowPalette[value]); }
  return rgba;
}
