import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";

/**
 * The settings tab's cog, drawn the way the field menu draws its icons: a bright one-pixel line with a darker shade
 * line inside it on the side away from the light (lower right, and upper left inside the hole), a near-black fill and
 * a near-black rim. The colours are the field menu's Options green. It is not in the ROM, so it is drawn here.
 *   o  line    s  shade    x  fill and rim    .  clear
 */
const ART = [
  "..........xxxxxxx..........",
  "..........xooooox..........",
  "..........xoxxsox..........",
  ".....xxxx.xoxxsox.xxxx.....",
  "....xxooxxxoxxsoxxxooxx....",
  "...xxoxsoxoxxxxsoxoxsoxx...",
  "...xoxxxsoxxxxxxsoxxxsox...",
  "...xosxxxxxxxxxxxxxxxsox...",
  "...xxosxxxxxxxxxxxxxsoxx...",
  "....xxoxxxxxooosxxxsoxx....",
  "xxxxxoxxxxxo...osxxxsoxxxxx",
  "xooooxxxxxo.....osxxxsoooox",
  "xoxxxxxxxo.......osxxxxxsox",
  "xoxxxxxxxo.......osxxxxxsox",
  "xosssxxxxo.......osxxxsssox",
  "xoooosxxxso.....osxxxsoooox",
  "xxxxxosxxxso...osxxxsoxxxxx",
  "....xxoxxxxsooosxxxsoxx....",
  "...xxoxxxxxxsssxxxxxsoxx...",
  "...xoxxxxsxxxxxxxsxxxsox...",
  "...xosxxsosxxxxxsosxxsox...",
  "...xxossoxosxxxsoxossoxx...",
  "....xxooxxxoxxsoxxxooxx....",
  ".....xxxx.xoxxsox.xxxx.....",
  "..........xosssox..........",
  "..........xooooox..........",
  "..........xxxxxxx..........",
];

const COLORS: Record<string, readonly [number, number, number]> = {
  o: [0x18, 0xd8, 0x78],
  s: [0x18, 0x78, 0x48],
  x: [0x18, 0x18, 0x18],
};

export function settingsCogImage(): RgbaImageData {
  const height = ART.length, width = ART[0]!.length;
  const pixels = new Uint8ClampedArray(width * height * 4);
  ART.forEach((row, y) => {
    [...row].forEach((code, x) => {
      const color = COLORS[code];
      if (color) pixels.set([...color, 255], (y * width + x) * 4);
    });
  });
  return { width, height, pixels };
}
