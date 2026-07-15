import { describe, expect, it } from "vitest";
import { compileGifToPwan } from "../pokeweb/pwanCompiler";
import { getPokemonCardFrontSpriteImage } from "../pokeweb/pokemonCardSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";

const SINGLE_PIXEL_GIF_BASE64 = "R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICRAEAOw==";

describe("pokemonCardSpriteModel", () => {
  it("uses the first PWAN front frame without requiring a native sprite entry", () => {
    const compiled = compileGifToPwan(new Uint8Array(Buffer.from(SINGLE_PIXEL_GIF_BASE64, "base64")));
    const project = {
      narcs: {},
      pwanAnimations: {
        overrides: [{
          speciesId: 900,
          assetIndex: 1378,
          front: {
            sourceFileName: "kleavor-front.pwan",
            sourceGifBytes: new Uint8Array(),
            pwanBytes: compiled.pwanBytes,
            visibleHeight: compiled.visibleHeight,
            frameCount: compiled.frameCount,
            uniqueFrameCount: compiled.uniqueFrameCount,
            timelineCount: compiled.timelineCount,
            totalTicks: compiled.totalTicks,
            paletteBgr555: compiled.paletteBgr555,
          },
          nativePaletteSource: "front",
          carrierTemplate: "w2u-gen6-placeholder",
        }],
      },
    } as unknown as ProjectState;

    const image = getPokemonCardFrontSpriteImage(project, 900);

    expect(image).toBeDefined();
    expect(image).toMatchObject({ width: 96, height: 96 });
    const opaquePixels = Array.from({ length: 96 * 96 }, (_value, index) => image!.pixels[index * 4 + 3]).filter(Boolean);
    expect(opaquePixels).toHaveLength(1);
    expect(image!.pixels[(95 * 96 + 47) * 4 + 3]).toBe(255);
  });
});
