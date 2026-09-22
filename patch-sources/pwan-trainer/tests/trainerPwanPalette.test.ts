import { describe, expect, it } from "vitest";
import { verifyTrainerIntroPalette, type TrainerPaletteSample } from "../../scripts/lib/trainer-pwan-palette";

const palette = [0, ...Array.from({ length: 15 }, () => 0x7fff)];
const sample = (level: number, frame = level, pwanFrame = level % 4): TrainerPaletteSample => ({
  frame, pwanFrame, paletteAddress: 0x1000, fade: 16 - level, target: level === 0 ? 16 : 0, flags: 0,
  colors: [0, ...Array.from({ length: 15 }, () => {
    const channel = 31 * level >> 4;
    return channel | channel << 5 | channel << 10;
  })],
});

describe("trainer PWAN native intro palette regression", () => {
  it("accepts all native fade steps across GIF frame changes", () => {
    expect(verifyTrainerIntroPalette(Array.from({ length: 17 }, (_, i) => sample(i)), palette)).toEqual({
      darkFrame: 0, fullFrame: 16, shadeCount: 17, gifFramesDuringFade: 4,
    });
  });

  it("accepts a native fade while the GIF holds a single frame", () => {
    expect(verifyTrainerIntroPalette(Array.from({ length: 17 }, (_, i) => sample(i, i, 0)), palette).gifFramesDuringFade).toBe(1);
  });

  it("rejects the reported switch from faded native colors to a private full-bright palette", () => {
    expect(() => verifyTrainerIntroPalette([sample(0), { ...sample(16), paletteAddress: 0x1800 }, sample(8)], palette)).toThrow(/native MCSS slot/u);
  });

  it("rejects full-bright GIF uploads that interrupt an otherwise native fade", () => {
    expect(() => verifyTrainerIntroPalette([sample(0, 0), sample(4, 1), sample(16, 2), sample(5, 3), sample(16, 4)], palette)).toThrow(/flickered darker/u);
  });

  it("rejects a bypassed fade, a stuck dark palette, and wrong final colors", () => {
    expect(() => verifyTrainerIntroPalette([sample(16)], palette)).toThrow(/silhouette/u);
    expect(() => verifyTrainerIntroPalette([sample(0), sample(8)], palette)).toThrow(/did not progress/u);
    expect(() => verifyTrainerIntroPalette([sample(0), { ...sample(8), colors: [0, 0x001f, ...palette.slice(2)] }], palette)).toThrow(/does not match/u);
  });
});
