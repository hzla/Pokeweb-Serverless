import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { compileFramesToFullSizeStream, parseFullSizeMani } from "../pokeweb/animStreamsFullSize";
import { buildAnimStreamsFile, pokemonStreamEntries } from "../pokeweb/animStreamsModel";
import type { AnimationAnalysisFrame } from "../pokeweb/gifAnimationFrames";
import type { ProjectState, PwanAnimationOverride, PwanOverrideSide } from "../pokeweb/projectStore";
import { compilePwanAnimationFrames, pwanPalette } from "../pokeweb/pwanCompiler";
import {
  bgr555ToHex, hexToBgr555, paletteIndexCounts, pwanSidePaletteFrames, pwanSidePalettes, roundToDsColor, sameArtIgnoringPalettes,
  withPwanSidePalettes,
} from "../pokeweb/pwanSidePalettes";
import { parseW2Anim, W2ANIM_OWN_PALETTES } from "../pokeweb/w2animCodec";

const PALETTE = Array.from({ length: 16 }, (_, n) => n * 0x421);

/** A 96x96 PWAN whose one frame uses colour 1 in its top half and colour 2 below. */
function makePwan(palette = PALETTE): Uint8Array {
  const paletteAt = 0x30, timelineAt = paletteAt + 32, framesAt = timelineAt + 4;
  const out = new Uint8Array(framesAt + 4608);
  out.set(new TextEncoder().encode("PWAN"));
  [1, 96, 96, 4, 1, 1].forEach((value, n) => writeU16(out, 4 + n * 2, value));
  [4, 4608, 16, paletteAt, timelineAt, framesAt].forEach((value, n) => writeU32(out, 16 + n * 4, value));
  palette.forEach((color, n) => writeU16(out, paletteAt + n * 2, color));
  writeU16(out, timelineAt, 0); writeU16(out, timelineAt + 2, 4);
  out.fill(0x11, framesAt, framesAt + 2304);
  out.fill(0x22, framesAt + 2304, framesAt + 4608);
  return out;
}

function side(pwanBytes: Uint8Array, extra: Partial<PwanOverrideSide> = {}): PwanOverrideSide {
  return { sourceFileName: "test.pwan", sourceGifBytes: new Uint8Array(), pwanBytes, frameCount: 1, uniqueFrameCount: 1, timelineCount: 1,
    totalTicks: 4, paletteBgr555: pwanPalette(pwanBytes), ...extra };
}

function frame(width: number, height: number, bands: Array<[r: number, g: number, b: number]>): AnimationAnalysisFrame {
  const pixels = new Uint8ClampedArray(width * height * 4), band = Math.ceil(height / bands.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...bands[Math.floor(y / band)]!, 255], (y * width + x) * 4);
  return { index: 0, width, height, delayMs: 100, pixels };
}

describe("DS colours", () => {
  it("rounds 8-bit colours to the nearest 5-bit colour and back", () => {
    expect(roundToDsColor({ r: 255, g: 130, b: 3 })).toEqual({ r: 255, g: 132, b: 0 });
    expect(hexToBgr555("#ff8400")).toBe(31 | (16 << 5));
    expect(hexToBgr555("f80")).toBe(31 | (17 << 5));
    expect(hexToBgr555("orange")).toBeUndefined();
    expect(bgr555ToHex(31 | (16 << 5))).toBe("#ff8400");
  });
});

describe("96x96 side palettes", () => {
  it("edits the PWAN's colours, and keeps shiny colours only when they differ", () => {
    const original = side(makePwan(), { offsetBasePwanBytes: makePwan() });
    const { normal, shiny } = pwanSidePalettes(original);
    expect(Array.from(shiny)).toEqual(Array.from(normal));
    normal[1] = 0x7c00; normal[0] = 0x1234;
    // Shiny colours that were the normal ones follow them (the editor links the two until shiny is changed).
    const edited = withPwanSidePalettes(original, { normal, shiny: normal });
    expect(pwanPalette(edited.pwanBytes)[1]).toBe(0x7c00);
    expect(pwanPalette(edited.offsetBasePwanBytes!)[1]).toBe(0x7c00);
    expect(edited.paletteBgr555[0]).toBe(0); // index 0 is transparent and keeps its value
    expect(edited.shinyPaletteBgr555).toBeUndefined();
    expect(pwanPalette(original.pwanBytes)[1]).toBe(PALETTE[1]); // the input is not changed

    const shinyColors = pwanSidePalettes(edited).normal;
    shinyColors[2] = 0x03e0;
    const withShiny = withPwanSidePalettes(edited, { normal: pwanSidePalettes(edited).normal, shiny: shinyColors });
    expect(withShiny.shinyPaletteBgr555?.[2]).toBe(0x03e0);
    expect(pwanSidePalettes(withShiny).shiny[2]).toBe(0x03e0);
  });

  it("tells recoloured art from new art", () => {
    const original = makePwan();
    const recoloured = withPwanSidePalettes(side(original), { normal: Uint16Array.from(PALETTE, (c, n) => (n === 1 ? 0x7fff : c)), shiny: Uint16Array.from(PALETTE) }).pwanBytes;
    expect(sameArtIgnoringPalettes(original, recoloured)).toBe(true);
    const redrawn = original.slice();
    redrawn[redrawn.length - 1] ^= 0x01;
    expect(sameArtIgnoringPalettes(original, redrawn)).toBe(false);
  });

  it("shows which pixels use each colour", () => {
    const frames = pwanSidePaletteFrames(side(makePwan()));
    const art = frames[0]!;
    expect([art.width, art.height, frames.length]).toEqual([96, 96, 1]);
    const counts = paletteIndexCounts(art);
    expect([counts[1], counts[2]]).toEqual([96 * 48, 96 * 48]);
  });

  it("streams its own shiny colours at export", () => {
    const pwan = makePwan();
    const shiny = Uint16Array.from(PALETTE, (color, n) => (n === 1 ? 0x001f : color));
    const nclr = () => { const out = new Uint8Array(0x28 + 32); PALETTE.forEach((c, n) => writeU16(out, 0x28 + n * 2, c)); return out; };
    const rawFiles = Array.from({ length: 40 * 20 }, (_, n) => (n === 38 || n === 39 ? nclr() : new Uint8Array()));
    const project = { session: { baseVersion: "B2" }, narcs: { pokemon_sprites: { rawFiles } } } as unknown as ProjectState;
    const overrides: PwanAnimationOverride[] = [{ speciesId: 1, front: side(pwan, { shinyPaletteBgr555: shiny }), nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" }];
    const archive = parseW2Anim(buildAnimStreamsFile(pokemonStreamEntries(project, overrides)));
    const mani = archive.manis.values().next().value!;
    // The carrier's palettes match the PWAN, so without shiny colours it would stream through the native palette.
    expect(mani.flags & W2ANIM_OWN_PALETTES).toBe(W2ANIM_OWN_PALETTES);
    expect(mani.normalPalette?.[1]).toBe(PALETTE[1]);
    expect(mani.shinyPalette?.[1]).toBe(0x001f);
  });
});

describe("full-size side palettes", () => {
  it("writes the stream's normal and shiny colours and moves the 96x96 preview along", () => {
    const art = frame(120, 110, [[248, 0, 0], [0, 248, 0]]);
    const full = compileFramesToFullSizeStream([art], { side: "front" });
    const original = side(full.preview.pwanBytes, { fullSizeMani: full.mani });
    const palettes = pwanSidePalettes(original);
    const red = Array.from(palettes.normal).indexOf(31, 1);
    expect(red).toBeGreaterThan(0);
    const shown = pwanSidePaletteFrames(original)[0]!;
    expect([shown.width, shown.height]).toEqual([120, 110]);
    expect(shown.indices[0]).toBe(red); // the top band is red

    palettes.normal[red] = 31 << 10; // blue
    palettes.shiny[red] = 31 << 5 | 31; // yellow
    const edited = withPwanSidePalettes(original, palettes);
    const info = parseFullSizeMani(edited.fullSizeMani!);
    expect(info.palette[red]).toBe(31 << 10);
    expect(pwanSidePalettes(edited).shiny[red]).toBe(31 << 5 | 31);
    // The preview's red became blue, and its shiny colours carry the yellow.
    const preview = pwanPalette(edited.pwanBytes);
    expect(Array.from(preview)).toContain(31 << 10);
    expect(Array.from(preview)).not.toContain(31);
    expect(Array.from(edited.shinyPaletteBgr555 ?? [])).toContain(31 << 5 | 31);
    expect(parseFullSizeMani(original.fullSizeMani!).palette[red]).toBe(31); // the input is not changed
  });

  it("rejects colours outside 15 bits", () => {
    const pwan = compilePwanAnimationFrames([frame(40, 40, [[248, 0, 0]])]).pwanBytes;
    const { normal, shiny } = pwanSidePalettes(side(pwan));
    normal[1] = 0x8000;
    expect(() => withPwanSidePalettes(side(pwan), { normal, shiny })).toThrow(/15-bit/u);
  });
});
