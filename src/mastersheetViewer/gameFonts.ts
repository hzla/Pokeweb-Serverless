import { parseBw2DialogueFont } from "../pokeweb/bw2DialoguePreview";
import { ensureGen5RomBytes, gen5RomArchive } from "../pokeweb/gen5UiImages";
import { buildPixelTtf, emboldenGlyph, type PixelGlyph } from "../pokeweb/pixelFontTtf";
import type { ProjectState } from "../pokeweb/projectStore";

/**
 * The viewer's text is set in the game's own fonts, read from the ROM (a/0/2/3) and turned into web fonts in the
 * browser: the main text font, and the small one the game uses for numbers and labels. One glyph pixel is one CSS
 * pixel at 16px, so text sizes are whole multiples of 16px. Each font gets a bold, made the way pixel fonts usually
 * are, by thickening every stroke a pixel to the right; weights up to 650 use the regular face.
 * Only the letter's ink is used: the game's drop shadow is left to CSS.
 */
const FACES = [
  { file: 0, family: "Gen5 Text" },
  { file: 1, family: "Gen5 Small" },
] as const;

export const GAME_FONT_PIXELS_PER_EM = 16;

let installed: Promise<boolean> | undefined;

export function installGameFonts(project: ProjectState): Promise<boolean> {
  installed ??= (async () => {
    try {
      if (!(await ensureGen5RomBytes(project))) return false;
      const files = gen5RomArchive(project, "a/0/2/3");
      const faces: FontFace[] = [];
      for (const { file, family } of FACES) {
        const bytes = files[file];
        if (!bytes) return false;
        const font = parseBw2DialogueFont(bytes);
        const glyphs: PixelGlyph[] = [];
        for (const [code, glyph] of font.glyphs) {
          const pixels = new Uint8Array(glyph.width * font.height);
          for (let y = 0; y < font.height; y++) {
            for (let x = 0; x < glyph.width; x++) pixels[y * glyph.width + x] = glyph.pixels[y * font.width + x] === 1 ? 1 : 0;
          }
          glyphs.push({ code, advance: glyph.advance, left: glyph.left, width: glyph.width, height: font.height, pixels });
        }
        const ascent = baselineOf(glyphs, font.height);
        const spec = { family, ascent, descent: font.height - ascent, pixelsPerEm: GAME_FONT_PIXELS_PER_EM };
        faces.push(new FontFace(family, buildPixelTtf({ ...spec, style: "Regular", glyphs }), { weight: "100 650" }));
        faces.push(new FontFace(family, buildPixelTtf({ ...spec, style: "Bold", bold: true, glyphs: glyphs.map(emboldenGlyph) }), { weight: "651 1000" }));
      }
      await Promise.all(faces.map((face) => face.load()));
      for (const face of faces) document.fonts.add(face);
      document.documentElement.classList.add("msv-game-fonts");
      return true;
    } catch (error) {
      console.warn("The game's fonts couldn't be read; the viewer keeps its own.", error);
      return false;
    }
  })();
  return installed;
}

/** The baseline sits under capital H's lowest ink. */
function baselineOf(glyphs: readonly PixelGlyph[], height: number): number {
  const h = glyphs.find((glyph) => glyph.code === 0x48);
  if (!h) return height - 3;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < h.width; x++) if (h.pixels[y * h.width + x]) return y + 1;
  }
  return height - 3;
}
