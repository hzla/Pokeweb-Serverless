import { writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { parseBw2DialogueFont, type DialogueFont } from "./bw2DialoguePreview";
import { readItemSprite } from "./itemSpriteModel";
import { parseNitroPalette, type NitroPaletteData } from "./nitroBg";
import { parseNitroCellEffect } from "./nitroCell";
import { decompressNitro, type RgbaImageData } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";
import { tmTypePalette } from "./tmModel";
import { typeIconPalettes } from "./typeIconPalettes";

/**
 * Small Gen 5 UI graphics read from the ROM, shared by the Mastersheet Viewer and the Gen 5 editor theme:
 * - type icons and move category icons, from the menus' archive (a/0/8/2, APP_MENU_COMMON)
 * - TM discs coloured by type, from the item icons
 * - the field menu's Pokédex icon (a/0/7/0, ARCID_FIELD_MENU)
 * - a line of text in the game's own font (a/0/2/3)
 * Every image except text is trimmed to its pixels. Nothing is bundled: a ROM without one of these throws, and
 * callers fall back.
 */

const archives = new WeakMap<ProjectState, Map<string, Uint8Array[]>>();
/** ROM bytes for projects that don't carry them (the editor keeps the ROM in its own store until a page needs it). */
const loadedRoms = new WeakMap<ProjectState, Uint8Array>();
const loadingRoms = new WeakMap<ProjectState, Promise<boolean>>();

function romBytes(project: ProjectState): Uint8Array | undefined {
  return project.originalRomBytes ?? loadedRoms.get(project);
}

/** True once the project's ROM is available to draw from: its own bytes, or the editor's stored ROM if it matches. */
export function hasGen5RomBytes(project: ProjectState): boolean {
  return Boolean(romBytes(project));
}

export function ensureGen5RomBytes(project: ProjectState): Promise<boolean> {
  if (romBytes(project)) return Promise.resolve(true);
  let loading = loadingRoms.get(project);
  if (!loading) {
    loading = (async () => {
      try {
        const { activeRomMatchesProject, loadActiveRomBytes } = await import("./persistence");
        if (!(await activeRomMatchesProject(project))) return false;
        const bytes = await loadActiveRomBytes();
        if (!bytes || bytes.length !== project.romInfo.size) return false;
        loadedRoms.set(project, bytes);
        return true;
      } catch {
        return false;
      }
    })();
    loadingRoms.set(project, loading);
  }
  return loading;
}

function archive(project: ProjectState, path: string): Uint8Array[] {
  const bytes = romBytes(project);
  if (!bytes) throw new Error("The ROM isn't loaded.");
  let byPath = archives.get(project);
  if (!byPath) archives.set(project, byPath = new Map());
  let files = byPath.get(path);
  if (!files) {
    const rom = new NintendoDSRom(bytes);
    const id = rom.filenames.idOf(path);
    if (id === undefined) throw new Error(`The ROM has no ${path}.`);
    files = new NARC(getRomFileBytes(project, rom, id)).files.map(expandNitro);
    byPath.set(path, files);
  }
  return files;
}

/** A menu icon: one OBJ cell drawn with one palette of a shared palette file (BW2 maps OBJ characters 1D, 32K). */
function menuIcon(char: Uint8Array | undefined, palette: Uint8Array | undefined, cell: Uint8Array | undefined, animation: Uint8Array | undefined, paletteId: number, label: string): RgbaImageData {
  if (!char || !palette || !cell || !animation || 40 + 32 * (paletteId + 1) > palette.length) throw new Error(`The ROM has no ${label}.`);
  const colors = palette.slice();
  colors.set(palette.subarray(40 + paletteId * 32, 72 + paletteId * 32), 40);
  const mappedCell = cell.slice();
  // The NCER's mapping hint is zero; the menus load these under GX_OBJVRAMMODE_CHAR_1D_32K.
  writeU32(mappedCell, 32, 0x10);
  const frame = parseNitroCellEffect(`gen5-${label}`, 0, 0, 0, 0, char, colors, mappedCell, animation, { originCentered: false }).sequences[0]?.frames[0];
  if (!frame) throw new Error(`The ROM's ${label} couldn't be read.`);
  return trimImage({ width: frame.width, height: frame.height, pixels: new Uint8ClampedArray(frame.rgba) });
}

/** The type icon the menus draw (graphics 0x22 + type, palette file 0x21, cell 0x3c, animation 0x3f), 32 × 12. */
export function typeIconImage(project: ProjectState, type: number): RgbaImageData {
  const palettes = typeIconPalettes(project.arm9);
  if (!(type >= 0 && type < palettes.length)) throw new Error(`No icon for type ${type}.`);
  const files = archive(project, "a/0/8/2");
  return menuIcon(files[0x22 + type], files[0x21], files[0x3c], files[0x3f], palettes[type]!, `icon for type ${type}`);
}

/** Move category icons in the order the game numbers them: 0 physical, 1 special, 2 status. */
export const MOVE_CATEGORY_ICON_ORDER = ["Physical", "Special", "Status"] as const;

/** The move category icon (graphics 0x38 + category, palette per AppMenuCommon_GetCategoryIconPaletteIndex). */
export function categoryIconImage(project: ProjectState, category: number): RgbaImageData {
  const PALETTES = [0, 0, 1];
  if (!(category >= 0 && category < PALETTES.length)) throw new Error(`No icon for category ${category}.`);
  const files = archive(project, "a/0/8/2");
  return menuIcon(files[0x38 + category], files[0x21], files[0x3c], files[0x3f], PALETTES[category]!, `icon for category ${category}`);
}

/** TM01's disc graphic in the palette the game gives a TM of this type ("Fire"). */
export function tmDiscImage(project: ProjectState, type: string): RgbaImageData {
  const palette = tmTypePalette(type);
  if (palette === undefined) throw new Error(`No TM colour for ${type}.`);
  const bytes = romBytes(project);
  if (!bytes) throw new Error("The ROM isn't loaded.");
  return trimImage(readItemSprite(project, bytes, 328, palette));
}

/**
 * The touch-screen field menu's Pokédex icon, the pink variant (graphics 0x0e, cell 0x1e, animation 0x29, palette
 * file 2; field_menu.c's FIELD_MENU_ICON_FILES), optionally mirrored.
 */
export function pokedexIconImage(project: ProjectState, mirrored = false): RgbaImageData {
  const files = archive(project, "a/0/7/0");
  const char = files[0x0e], palette = files[2], cell = files[0x1e], animation = files[0x29];
  if (!char || !palette || !cell || !animation) throw new Error("The ROM's Pokédex icon is missing.");
  const mappedCell = cell.slice();
  writeU32(mappedCell, 32, 0x10);
  const frame = parseNitroCellEffect("gen5-pokedex-icon", 0, 0, 0, 0, char, palette, mappedCell, animation, { originCentered: false }).sequences[0]?.frames[0];
  if (!frame) throw new Error("The ROM's Pokédex icon couldn't be read.");
  const image = trimImage({ width: frame.width, height: frame.height, pixels: new Uint8ClampedArray(frame.rgba) });
  return mirrored ? mirrorImage(image) : image;
}

const fonts = new WeakMap<ProjectState, { font: DialogueFont; lightInk: NitroPaletteData }>();

/**
 * One line of text in the game's own font (a/0/2/3 file 0), in its light ink (file 7, the palette the menus use on
 * dark panels), at 1×. Characters the font lacks use its fallback glyph. The full line height is kept, so labels
 * drawn this way share a baseline.
 */
export function gameTextImage(project: ProjectState, text: string): RgbaImageData {
  let cached = fonts.get(project);
  if (!cached) {
    const files = archive(project, "a/0/2/3");
    if (!files[0] || !files[7]) throw new Error("The ROM has no game font.");
    cached = { font: parseBw2DialogueFont(files[0]), lightInk: parseNitroPalette(files[7]) };
    fonts.set(project, cached);
  }
  const { font, lightInk } = cached;
  const glyphs = [...text].map((char) => font.glyphs.get(char.codePointAt(0) ?? 0) ?? font.fallback);
  const width = Math.max(1, glyphs.reduce((sum, glyph) => sum + glyph.advance, 0));
  const height = font.height;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let x = 0;
  for (const glyph of glyphs) {
    for (let y = 0; y < height; y += 1) {
      for (let gx = 0; gx < glyph.width; gx += 1) {
        const value = glyph.pixels[y * font.width + gx]!;
        const px = x + glyph.left + gx;
        if (!value || px < 0 || px >= width) continue;
        pixels.set(lightInk[value] ?? [255, 255, 255, 255], (y * width + px) * 4);
      }
    }
    x += glyph.advance;
  }
  return { width, height, pixels };
}

/** Crop to the opaque pixels. */
export function trimImage(image: RgbaImageData): RgbaImageData {
  const { width, height, pixels } = image;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return image;
  const w = right - left + 1, h = bottom - top + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) out.set(pixels.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4);
  return { width: w, height: h, pixels: out };
}

/** Flip left to right. */
export function mirrorImage(image: RgbaImageData): RgbaImageData {
  const { width, height, pixels } = image;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out.set(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (y * width + width - 1 - x) * 4);
  }
  return { width, height, pixels: out };
}

/** The field menu's files are LZ-compressed; the menus' archive isn't. */
function expandNitro(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
}

// ---------- Object URLs for the editor ----------

const urls = new WeakMap<ProjectState, Map<string, Promise<string | undefined>>>();

/** A cached object URL for one of the images above, or undefined if the ROM doesn't have it. */
export function gen5UiImageUrl(project: ProjectState, key: string, draw: () => RgbaImageData): Promise<string | undefined> {
  let byKey = urls.get(project);
  if (!byKey) urls.set(project, byKey = new Map());
  let url = byKey.get(key);
  if (!url) {
    url = (async () => {
      try {
        return URL.createObjectURL(await pngBlob(draw()));
      } catch (error) {
        console.debug(`Gen 5 UI image "${key}" unavailable:`, error);
        return undefined;
      }
    })();
    byKey.set(key, url);
  }
  return url;
}

function pngBlob(image: RgbaImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))), "image/png"));
}
