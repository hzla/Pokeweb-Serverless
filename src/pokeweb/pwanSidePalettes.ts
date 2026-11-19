import { readAscii, readU16, readU32, writeU16 } from "../nds/binary";
import { ensurePwanSidePreview, parseFullSizeMani } from "./animStreamsFullSize";
import { rgb555, rgbFrom555 } from "./naturePaletteData";
import type { RgbColor } from "./pokemonSpriteModel";
import type { PwanOverrideSide } from "./projectStore";
import { parsePwanHeader, pwanFramePixels, pwanPalette, pwanTimeline } from "./pwanCompiler";

/**
 * The colours an animated sprite side shows in game, as the palette editor edits them: 16 BGR555 entries for normal
 * and shiny Pokémon, index 0 transparent. A full-size side is edited in its stream's own numbering (the MANI's normal
 * and shiny palettes); a 96x96 side in its PWAN's, with shiny colours in `shinyPaletteBgr555` (written to the stream at
 * export; without them shiny Pokémon show the normal colours).
 */
export type PwanSidePalettes = { normal: Uint16Array; shiny: Uint16Array };

/** Indexed art for the palette editor's preview: one byte per pixel, 0 transparent. */
export type PwanSidePaletteFrame = { width: number; height: number; indices: Uint8Array };

/** The nearest colour the DS can show (5 bits per channel), as 8-bit RGB. */
export function roundToDsColor(color: RgbColor): RgbColor {
  return rgbFrom555(rgb555(color));
}

/** "#rrggbb" for a BGR555 colour, each channel widened the way the DS shows it. */
export function bgr555ToHex(value: number): string {
  const { r, g, b } = rgbFrom555(value);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Parses "#rgb" or "#rrggbb" (the # is optional) and rounds it to a BGR555 colour; undefined when it isn't a colour. */
export function hexToBgr555(text: string): number | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return undefined;
  const hex = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join("") : match[1]!;
  return rgb555({ r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) });
}

export function pwanSideIsFullSize(side: PwanOverrideSide): boolean {
  return Boolean(side.fullSizeMani);
}

export function pwanSidePalettes(side: PwanOverrideSide): PwanSidePalettes {
  if (side.fullSizeMani) {
    const paletteAt = readU32(side.fullSizeMani, 24);
    const read = (slot: number) => Uint16Array.from({ length: 16 }, (_, n) => readU16(side.fullSizeMani!, paletteAt + slot * 32 + n * 2));
    return { normal: read(0), shiny: read(1) };
  }
  const normal = pwanPalette(side.pwanBytes);
  const shiny = side.shinyPaletteBgr555?.length === 16 ? side.shinyPaletteBgr555.slice() : normal.slice();
  shiny[0] = normal[0]!;
  return { normal, shiny };
}

const sameColors = (a: Uint16Array, b: Uint16Array) => a.every((color, n) => n === 0 || color === b[n]);

function writePwanPalette(bytes: Uint8Array | undefined, palette: Uint16Array): Uint8Array | undefined {
  if (!bytes) return undefined;
  const out = bytes.slice(), at = parsePwanHeader(out).paletteOffset;
  palette.forEach((color, n) => writeU16(out, at + n * 2, color));
  return out;
}

function nearestColorIndex(color: number, palette: Uint16Array): number {
  const r = color & 31, g = (color >> 5) & 31, b = (color >> 10) & 31;
  let best = 1, bestDistance = Infinity;
  for (let n = 1; n < palette.length; n++) {
    const c = palette[n]!, dr = r - (c & 31), dg = g - ((c >> 5) & 31), db = b - ((c >> 10) & 31);
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) { best = n; bestDistance = distance; }
  }
  return best;
}

/**
 * The side with these colours (index 0 keeps its value). A full-size side writes both palettes into its stream and
 * moves its 96x96 preview along: each preview colour follows the stream colour nearest to it, when that one changed.
 * Returns a new side; the input is left as it was.
 */
export function withPwanSidePalettes(side: PwanOverrideSide, palettes: PwanSidePalettes): PwanOverrideSide {
  if (palettes.normal.length !== 16 || palettes.shiny.length !== 16) throw new Error("A sprite palette has 16 colors.");
  for (const color of [...palettes.normal, ...palettes.shiny]) {
    if (!Number.isInteger(color) || color < 0 || color > 0x7fff) throw new Error("Palette colors are 15-bit BGR555 values.");
  }
  const old = pwanSidePalettes(side);
  const normal = palettes.normal.slice(), shiny = palettes.shiny.slice();
  normal[0] = old.normal[0]!;
  shiny[0] = normal[0]!;
  if (side.fullSizeMani) {
    const mani = side.fullSizeMani.slice(), paletteAt = readU32(mani, 24);
    if (readAscii(mani, 0, 4) !== "MANI" || paletteAt + 64 > mani.length) throw new Error("The full-size stream is damaged.");
    normal.forEach((color, n) => writeU16(mani, paletteAt + n * 2, color));
    shiny.forEach((color, n) => writeU16(mani, paletteAt + 32 + n * 2, color));
    // Compile the old colours before calculating the palette's preview mapping.
    const previewSide = side.pwanBytes.length ? side : { ...side };
    const preview = pwanPalette(ensurePwanSidePreview(previewSide));
    const previewNormal = preview.slice(), previewShiny = preview.slice();
    for (let p = 1; p < 16; p++) {
      const k = nearestColorIndex(preview[p]!, old.normal);
      if (normal[k] !== old.normal[k]) previewNormal[p] = normal[k]!;
      previewShiny[p] = shiny[k] === normal[k] ? previewNormal[p]! : shiny[k]!;
    }
    return {
      ...withPreviewPalette(previewSide, previewNormal),
      fullSizeMani: mani,
      shinyPaletteBgr555: sameColors(previewShiny, previewNormal) ? undefined : previewShiny,
    };
  }
  return { ...withPreviewPalette(side, normal), shinyPaletteBgr555: sameColors(shiny, normal) ? undefined : shiny };
}

function withPreviewPalette(side: PwanOverrideSide, palette: Uint16Array): PwanOverrideSide {
  return {
    ...side,
    pwanBytes: writePwanPalette(side.pwanBytes, palette)!,
    scaleBasePwanBytes: writePwanPalette(side.scaleBasePwanBytes, palette),
    offsetBasePwanBytes: writePwanPalette(side.offsetBasePwanBytes, palette),
    paletteBgr555: palette.slice(),
  };
}

/**
 * The art the palette editor numbers its colours by, one frame per timeline step (steps that repeat a frame share it):
 * the stream's full-size frames for a full-size side, else the PWAN's.
 */
export function pwanSidePaletteFrames(side: PwanOverrideSide): PwanSidePaletteFrame[] {
  if (side.fullSizeMani) {
    const info = parseFullSizeMani(side.fullSizeMani);
    const unique = info.frames.map((texels) => {
      const indices = new Uint8Array(info.width * info.height);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const t = texels[y * 128 + x]!;
          indices[y * info.width + x] = t >> 5 ? t & 15 : 0;
        }
      }
      return { width: info.width, height: info.height, indices };
    });
    return info.sequence.map((step) => unique[step.frame]!);
  }
  const unique = new Map<number, PwanSidePaletteFrame>();
  return pwanTimeline(side.pwanBytes).map(({ frameIndex }) => {
    let frame = unique.get(frameIndex);
    if (!frame) {
      const pixels = pwanFramePixels(side.pwanBytes, frameIndex);
      const width = pixels[0]?.length ?? 0, height = pixels.length, indices = new Uint8Array(width * height);
      pixels.forEach((row, y) => row.forEach((index, x) => { indices[y * width + x] = index; }));
      frame = { width, height, indices };
      unique.set(frameIndex, frame);
    }
    return frame;
  });
}

/** How many pixels of the frame use each palette index. */
export function paletteIndexCounts(frame: PwanSidePaletteFrame): number[] {
  const counts = Array.from({ length: 16 }, () => 0);
  for (const index of frame.indices) counts[index & 15]!++;
  return counts;
}

/**
 * Whether two copies of a side's art hold the same pixels and timing, palettes aside: a PWAN (`fullSize` false) or a
 * full-size stream. Colour edits rewrite only the palettes, so this tells them from new art.
 */
export function sameArtIgnoringPalettes(a: Uint8Array, b: Uint8Array, fullSize = false): boolean {
  if (a === b) return true;
  if (a.length !== b.length || a.length < 32) return false;
  const paletteAt = readU32(a, fullSize ? 24 : 28), paletteEnd = paletteAt + (fullSize ? 64 : 32);
  if (readU32(b, fullSize ? 24 : 28) !== paletteAt) return false;
  for (let n = 0; n < a.length; n++) if ((n < paletteAt || n >= paletteEnd) && a[n] !== b[n]) return false;
  return true;
}
