export type TrainerPaletteSample = {
  frame: number;
  pwanFrame: number;
  paletteAddress: number;
  fade: number;
  target: number;
  flags: number;
  colors: number[];
};

// Validate the rendered palette, not just the CPU fade counter: the original
// bug advanced the native fade correctly while rebinding the renderer to an
// unfaded private palette whenever the GIF advanced a frame.
export function verifyTrainerIntroPalette(
  samples: TrainerPaletteSample[],
  expected: ArrayLike<number>,
  nativePaletteAddress = 0x1000,
): { darkFrame: number; fullFrame: number; shadeCount: number; gifFramesDuringFade: number } {
  const palette = Array.from(expected, (color) => color & 0x7fff);
  if (palette.length !== 16 || palette.every((color) => color === 0)) throw new Error("Expected a non-black 16-color PWAN palette");
  if (samples.some((sample) => sample.paletteAddress !== nativePaletteAddress)) {
    throw new Error("Trainer palette left its native MCSS slot during the intro");
  }
  const dark = samples.findIndex((sample) => sample.fade === 16 && sample.target === 16 && sample.colors.length === 16 && sample.colors.every((color) => color === 0));
  if (dark < 0) throw new Error("Native trainer silhouette was not observed");
  const shadedPalettes = Array.from({ length: 17 }, (_, amount) => palette.map((color) =>
    [0, 5, 10].reduce((value, shift) => value | (((color >> shift & 31) * amount >> 4) << shift), 0)));
  let previousShade = 0;
  let fullFrame = -1;
  const shades = new Set<number>();
  const gifFrames = new Set<number>();
  for (const sample of samples.slice(dark)) {
    const shade = shadedPalettes.findIndex((colors) => colors.length === sample.colors.length && colors.every((color, i) => color === sample.colors[i]));
    if (shade < 0) throw new Error(`Trainer palette does not match a native black-to-color blend at frame ${sample.frame}`);
    if (shade < previousShade) throw new Error(`Trainer palette flickered darker at frame ${sample.frame}`);
    if (fullFrame < 0) gifFrames.add(sample.pwanFrame);
    if (shade === 16 && fullFrame < 0) fullFrame = sample.frame;
    shades.add(shade);
    previousShade = shade;
  }
  if (fullFrame < 0 || shades.size < 3) throw new Error("Native trainer fade did not progress through intermediate shades to the imported palette");
  return { darkFrame: samples[dark]!.frame, fullFrame, shadeCount: shades.size, gifFramesDuringFade: gifFrames.size };
}
