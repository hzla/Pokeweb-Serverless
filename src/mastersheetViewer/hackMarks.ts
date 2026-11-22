import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";

/**
 * The red marks for what a hack added or changed: "NEW!" as the BW2 start menu draws it beside new items (ov162
 * startmenu.c, a/0/3/4), and "CHANGED!" lettered the same way. The ROM only holds the NEW! cell, so both are built
 * here from its letter style: 2-pixel strokes eight pixels tall, shaded dark to bright to dark from top to bottom,
 * a dark outline all round, two outline columns between letters. N, E, W and ! are the game's own; C, H, A, G and
 * D follow them. Shown still, at 2× like the menu icons.
 *
 * In the letters, # takes its row's shade, b c d e set a shade (the game's diagonals and bar ends), . is clear.
 */
const GLYPHS: Record<string, readonly string[]> = {
  N: ["##...##", "##b..##", "###b.##", "####b##", "##b####", "##.b###", "##..b##", "##...##"],
  E: ["######", "######", "##....", "####dc", "####dc", "##....", "######", "######"],
  W: ["##....##", "##....##", "##.##.##", "##b##b##", "########", "##cbbc##", "##b..b##", "##....##"],
  "!": ["##", "##", "##", "##", "##", "..", "##", "##"],
  C: [".#####", "######", "##....", "##....", "##....", "##....", "######", ".#####"],
  H: ["##..##", "##..##", "##..##", "######", "######", "##..##", "##..##", "##..##"],
  A: [".####.", "######", "##..##", "######", "######", "##..##", "##..##", "##..##"],
  G: [".#####", "######", "##....", "##.###", "##.###", "##..##", "######", ".#####"],
  D: ["#####.", "######", "##..##", "##..##", "##..##", "##..##", "######", "#####."],
};

const OUTLINE = [0x48, 0x20, 0x20] as const;
const SHADES = { b: [0xb0, 0x28, 0x28], c: [0xd8, 0x30, 0x30], d: [0xe8, 0x40, 0x40], e: [0xf8, 0x50, 0x50] } as const;
const ROW_SHADES = ["b", "c", "d", "e", "e", "d", "c", "b"] as const;
const LETTER_GAP = 2;

export type HackMark = "new" | "changed";

export function hackMarkImage(mark: HackMark): RgbaImageData {
  const letters = [...(mark === "new" ? "NEW!" : "CHANGED!")].map((letter) => GLYPHS[letter]!);
  const inner = letters.reduce((sum, glyph) => sum + glyph[0]!.length, 0) + LETTER_GAP * (letters.length - 1);
  const width = inner + 2, height = 10;
  const fill: Array<keyof typeof SHADES | undefined> = new Array(width * height);
  let x0 = 1;
  for (const glyph of letters) {
    glyph.forEach((row, y) => [...row].forEach((code, x) => {
      if (code !== ".") fill[(y + 1) * width + x0 + x] = code === "#" ? ROW_SHADES[y]! : (code as keyof typeof SHADES);
    }));
    x0 += glyph[0]!.length + LETTER_GAP;
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shade = fill[y * width + x];
      let color: readonly number[] | undefined = shade && SHADES[shade];
      // The outline is every clear pixel touching a letter, diagonals included.
      if (!color) {
        for (let dy = -1; dy <= 1 && !color; dy++) {
          for (let dx = -1; dx <= 1 && !color; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && fill[ny * width + nx]) color = OUTLINE;
          }
        }
      }
      if (color) pixels.set([...color, 255], (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}
