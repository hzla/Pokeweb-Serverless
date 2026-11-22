import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";

/**
 * The Edit tab's pencil, drawn like the settings cog (settingsCog.ts) in the field menu's icon style: a bright line,
 * a darker shade line on the side away from the light, a near-black fill and rim. The colours are the Bag's yellow.
 *   o  line    s  shade    x  fill and rim    .  clear
 */
const ART = [
  "...........................",
  ".....................xx....",
  "....................xoxx...",
  "...................xoxxxx..",
  "..................xoxxxxxx.",
  ".................xoxxxxxsx.",
  "................xosxxxxsx..",
  "...............xooosxxsx...",
  "..............xoxxoossx....",
  ".............xoxxxxosx.....",
  "............xoxxxxxsx......",
  "...........xoxxxxxsx.......",
  "..........xoxxxxxsx........",
  ".........xoxxxxxsx.........",
  "........xoxxxxxsx..........",
  ".......xoxxxxxsx...........",
  "......xoxxxxxsx............",
  ".....xooooosx..............",
  "....xoxxxsx................",
  "...xoxxsx..................",
  "..xoosx....................",
  ".xosx......................",
  "xox........................",
  "x..........................",
  "...........................",
  "...........................",
  "...........................",
];

const COLORS: Record<string, readonly [number, number, number]> = {
  o: [0xf8, 0xc8, 0x28],
  s: [0x90, 0x70, 0x08],
  x: [0x18, 0x18, 0x18],
};

export function editPencilImage(): RgbaImageData {
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
