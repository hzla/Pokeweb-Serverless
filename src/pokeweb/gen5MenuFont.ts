/**
 * Gen 5 theme: the capitals of Black 2 / White 2's main text font (a/0/2/3 file 0, extracted from a clean White 2 ROM)
 * and its light ink (file 7), baked in for the homepage. The homepage only shows when no ROM is loaded, so its menu
 * labels can't be drawn from the user's ROM. Only the characters menu labels need are included: capitals, digits and
 * a little punctuation. Anything else falls back to "?".
 */

/** [character, left offset, width, advance, 2 bits per pixel row-major over `width` × FONT_HEIGHT, base64]. */
type BakedGlyph = [string, number, number, number, string];

const FONT_HEIGHT = 15;
/** Ink by pixel value: 1 the letter, 2 its shadow, 3 unused here. */
const INK: ReadonlyArray<readonly [number, number, number, number]> = [[0, 0, 0, 0], [248, 248, 248, 255], [88, 88, 88, 255], [248, 40, 24, 255]];
const GLYPHS: readonly BakedGlyph[] = [
  [" ", 4, 0, 4, ""],
  ["A", 0, 6, 6, "AAAAVJKaCZmQCVmVqZmQCZmQCgoAAAA="],
  ["B", 0, 6, 6, "AAAAVZKaCZmQVZqaCZmQCVmlqgIAAAA="],
  ["C", 0, 6, 6, "AAAAVJKaCZmgCZAACZCQCWmlqAIAAAA="],
  ["D", 0, 6, 6, "AAAAVZKaCZmQCZmQCZmQCVmlqgIAAAA="],
  ["E", 0, 6, 6, "AAAAVZmqCZAAVZmqCZAACVCVqgoAAAA="],
  ["F", 0, 6, 6, "AAAAVZmqCZAACVAlqZIACZAACgAAAAA="],
  ["G", 0, 6, 6, "AAAAVJKaCZmgCZCUiZmQCWmlqAIAAAA="],
  ["H", 0, 6, 6, "AAAACZmQCZmQVZmaCZmQCZmQCgoAAAA="],
  ["I", 1, 4, 6, "AACVpiQkJCQkJCSVqgAA"],
  ["J", 0, 6, 6, "AAAAAAmQAAmQAAmQAJmQCWmlqAIAAAA="],
  ["K", 0, 6, 6, "AAAACZmUWVIpmZAJaZIkiZmQCgoAAAA="],
  ["L", 0, 6, 6, "AAAACZAACZAACZAACZAACVCVqgoAAAA="],
  ["M", 0, 6, 6, "AAAACZmQCVmWZVmWmZmZmZmZqgoAAAA="],
  ["N", 0, 6, 6, "AAAACZmQJVmSmZmZaZmUiZmQCgoAAAA="],
  ["O", 0, 6, 6, "AAAAVJKaCZmQCZmQCZmQCWmlqAIAAAA="],
  ["P", 0, 6, 6, "AAAAVZKaCZmQCVmlqZIACZAACgAAAAA="],
  ["Q", 0, 6, 6, "AAAAVJKaCZmQCZmQCZmZaWqZqAoAAAA="],
  ["R", 0, 6, 6, "AAAAVZKaCZmQCVmlaZKYCZmQCgoAAAA="],
  ["S", 0, 6, 6, "AAAAVJKaCZmgJoAloJmQCWmlqAIAAAA="],
  ["T", 0, 6, 6, "AAAAVampkAAJkAAJkAAJkAAJoAAAAAA="],
  ["U", 0, 6, 6, "AAAACZmQCZmQCZmQCZmQCWmlqAIAAAA="],
  ["V", 0, 6, 6, "AAAACZmQCZmQZkomZIIpkAAJoAAAAAA="],
  ["W", 0, 6, 6, "AAAACZmQCZmQCZmQKZmZZZmaCgoAAAA="],
  ["X", 0, 6, 6, "AAAACZmQZkommAIJZEImqZmQCgoAAAA="],
  ["Y", 0, 6, 6, "AAAACZmQCWmmZIIpkAAJkAAJoAAAAAA="],
  ["Z", 0, 6, 6, "AAAAVamaQAokkAIJpEACKVCVqgoAAAA="],
  ["É", 0, 6, 6, "QAIJIFCVqZoACVCVqZoACVCVqgoAAAA="],
  ["0", 0, 6, 6, "AAAAVJKaCZmQCZmQCZmQCWmlqAIAAAA="],
  ["1", 1, 3, 5, "AECWJkmSJEmSKAAA"],
  ["2", 0, 6, 6, "AAAAVJKaCgmQQAopkEAKKVCVqgoAAAA="],
  ["3", 0, 6, 6, "AAAAVJKaCamQUAqaAJmQCWmlqAIAAAA="],
  ["4", 0, 6, 6, "AAAAUEImZEImZJIkSVKVagokgAIAAAA="],
  ["5", 0, 6, 6, "AAAAVZmqCZAAVaKaAJmQCWmlqAIAAAA="],
  ["6", 0, 6, 6, "AAAAVJKaCZoAVZKaCZmQCWmlqAIAAAA="],
  ["7", 0, 6, 6, "AAAAVamaAAmkQAIkkAIJkAAJoAAAAAA="],
  ["8", 0, 6, 6, "AAAAVJKaCZmQVpqaCZmQCWmlqAIAAAA="],
  ["9", 0, 6, 6, "AAAAVJKaCZmQCWmVqAmQCWmlqAIAAAA="],
  [".", 1, 3, 5, "AAAAAAAAAFCWKgAA"],
  [",", 1, 3, 5, "AAAAAAAAAFCWZqoA"],
  ["-", 0, 5, 5, "AAAAAAAAAAAAAFWqCgAAAAAAAA=="],
  ["/", 0, 6, 6, "AAAAAACQAAmkQAIpkEAKJJACCaAAAAA="],
  ["&", 0, 6, 6, "AAAAAAAAlJAmSUIJmZmmSWKZqAoAAAA="],
  ["!", 2, 2, 5, "AJmZmQqZCgA="],
  ["?", 0, 6, 6, "AAAAVJKaCamQQAopkAAKkAAJoAAAAAA="],
  ["'", 1, 3, 5, "AFCWZqoAAAAAAAAA"],
  ["(", 1, 4, 5, "AJCkJCkJCQkJJiSYoAAA"],
  [")", 1, 4, 5, "AAkmJJiQkJCQpCQpCgAA"],
  ["+", 0, 6, 6, "AAAAAAAAkAAJkFCVmgoJkAAKAAAAAAA="],
  [":", 1, 3, 5, "AAAAZakCAFCWKgAA"],
];

type Glyph = { left: number; width: number; advance: number; pixels: Uint8Array };
let glyphs: Map<string, Glyph> | undefined;

function glyphTable(): Map<string, Glyph> {
  if (!glyphs) {
    glyphs = new Map();
    for (const [char, left, width, advance, rows] of GLYPHS) {
      const packed = Uint8Array.from(atob(rows), (c) => c.charCodeAt(0));
      const pixels = new Uint8Array(width * FONT_HEIGHT);
      for (let i = 0; i < pixels.length; i += 1) pixels[i] = (packed[i >> 2]! >> ((i & 3) * 2)) & 3;
      glyphs.set(char, { left, width, advance, pixels });
    }
  }
  return glyphs;
}

/** One line of capitals in the game's font and light ink, at 1×. */
export function menuLabelImage(text: string): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } {
  const table = glyphTable();
  const line = [...text.toUpperCase()].map((char) => table.get(char) ?? table.get("?")!);
  const width = Math.max(1, line.reduce((sum, glyph) => sum + glyph.advance, 0));
  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * FONT_HEIGHT * 4));
  let x = 0;
  for (const glyph of line) {
    for (let y = 0; y < FONT_HEIGHT; y += 1) {
      for (let gx = 0; gx < glyph.width; gx += 1) {
        const value = glyph.pixels[y * glyph.width + gx]!;
        const px = x + glyph.left + gx;
        if (value && px >= 0 && px < width) pixels.set(INK[value]!, (y * width + px) * 4);
      }
    }
    x += glyph.advance;
  }
  return { width, height: FONT_HEIGHT, pixels };
}

const urls = new Map<string, Promise<{ url: string; width: number; height: number } | undefined>>();

/** A cached PNG object URL for a menu label, with its size at 1×. */
export function menuLabelUrl(text: string): Promise<{ url: string; width: number; height: number } | undefined> {
  let entry = urls.get(text);
  if (!entry) {
    entry = (async () => {
      try {
        const image = menuLabelImage(text);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")!.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        return blob ? { url: URL.createObjectURL(blob), width: image.width, height: image.height } : undefined;
      } catch {
        return undefined;
      }
    })();
    urls.set(text, entry);
  }
  return entry;
}
