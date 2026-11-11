import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import {
  ANIM_STREAMS_FILENAMES,
  buildAnimStreamsFile,
  buildAnimStreamsIndex,
  detectAnimStreamsCompatibility,
  legacyPwanRuntimePaths,
  maniToPwan,
  pokemonStreamEntries,
  pwanToMani,
  trainerStreamEntries,
} from "../pokeweb/animStreamsModel";
import type { ProjectState, PwanAnimationOverride, PwanOverrideSide } from "../pokeweb/projectStore";
import { parseW2Anim, W2ANIM_MORPH, W2ANIM_OWN_PALETTES, W2ANIM_TICKS, W2ANIM_TRAINER_CARRIER } from "../pokeweb/w2animCodec";
import { adjustFullSizeMani, compileFramesToFullSizeStream, fullSizePreviewPwan, parseFullSizeMani } from "../pokeweb/animStreamsFullSize";
import type { AnimationAnalysisFrame } from "../pokeweb/gifAnimationFrames";
import manifest from "../assets/codeinjection/animStreamsManifest.json";
import { isW2AnimProject } from "../pokeweb/w2animAnimationModel";
import { getTrainerPwanRuntimeStatus } from "../pokeweb/trainerPwanAnimationModel";

/** A PWAN in the compiler's layout: 0x30 header, palette, timeline, 4608-byte frames. */
function makePwan(frames: number[], timeline: Array<[frame: number, ticks: number]>, palette = Array.from({ length: 16 }, (_, n) => n * 0x421)): Uint8Array {
  const paletteAt = 0x30, timelineAt = paletteAt + 32, framesAt = timelineAt + timeline.length * 4;
  const out = new Uint8Array(framesAt + frames.length * 4608);
  out.set(new TextEncoder().encode("PWAN"));
  [1, 96, 96, 4, frames.length, timeline.length].forEach((value, n) => writeU16(out, 4 + n * 2, value));
  [timeline.reduce((total, [, ticks]) => total + ticks, 0), 4608, 16, paletteAt, timelineAt, framesAt].forEach((value, n) => writeU32(out, 16 + n * 4, value));
  palette.forEach((color, n) => writeU16(out, paletteAt + n * 2, color));
  timeline.forEach(([frame, ticks], n) => { writeU16(out, timelineAt + n * 4, frame); writeU16(out, timelineAt + n * 4 + 2, ticks); });
  frames.forEach((seed, n) => { for (let i = 0; i < 4608; i++) out[framesAt + n * 4608 + i] = (i * seed + (i >> 6)) & 0xff; });
  return out;
}

function side(pwanBytes: Uint8Array): PwanOverrideSide {
  return { sourceFileName: "test.pwan", sourceGifBytes: new Uint8Array(), pwanBytes, frameCount: 1, uniqueFrameCount: 1, timelineCount: 1,
    totalTicks: 1, paletteBgr555: new Uint16Array(16) };
}

function nclr(palette: number[]): Uint8Array {
  const out = new Uint8Array(0x28 + 32);
  palette.forEach((color, n) => writeU16(out, 0x28 + n * 2, color));
  return out;
}

function spriteProject(files: Record<number, Uint8Array>, count = 40 * 20): ProjectState {
  const rawFiles = Array.from({ length: count }, (_, n) => files[n] ?? new Uint8Array());
  return { session: { baseVersion: "B2" }, narcs: { pokemon_sprites: { rawFiles } } } as unknown as ProjectState;
}

describe("animStreamsModel", () => {
  it("converts PWAN to a deduplicated MANI and back without loss", () => {
    const pwan = makePwan([3, 5, 7], [[0, 4], [1, 6], [0, 4], [2, 2]]);
    const mani = pwanToMani(pwan);
    const archive = parseW2Anim(buildAnimStreamsFile([{ arc: 4, flags: 0, sheetFile: 22, shinyNclrFile: 39, mani }]));
    const parsed = archive.manis.get(archive.entries[0]!.maniOffset)!;
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.sequence).toEqual([{ frame: 0, duration: 4 }, { frame: 1, duration: 6 }, { frame: 0, duration: 4 }, { frame: 2, duration: 2 }]);
    expect(parsed.flags & W2ANIM_TICKS).toBeTruthy();
    expect(maniToPwan(archive, parsed, Uint16Array.from({ length: 16 }, (_, n) => n * 0x421))).toEqual(pwan);
  });

  it("writes sorted entries that share one MANI and rejects duplicate keys", () => {
    const a = pwanToMani(makePwan([1], [[0, 1]])), b = pwanToMani(makePwan([2], [[0, 1]]));
    const bytes = buildAnimStreamsFile([
      { arc: 71, flags: W2ANIM_TRAINER_CARRIER, sheetFile: 9, shinyNclrFile: 800, mani: b },
      { arc: 4, flags: 0, sheetFile: 23, shinyNclrFile: 39, mani: a },
      { arc: 4, flags: 0, sheetFile: 22, shinyNclrFile: 39, mani: a },
    ]);
    const archive = parseW2Anim(bytes);
    expect(archive.entries.map((e) => [e.arc, e.sheetFile])).toEqual([[4, 22], [4, 23], [71, 9]]);
    expect(archive.entries[0]!.maniOffset).toBe(archive.entries[1]!.maniOffset);
    expect(archive.manis.size).toBe(2);
    expect(() => buildAnimStreamsFile([
      { arc: 4, flags: 0, sheetFile: 22, shinyNclrFile: 39, mani: a },
      { arc: 4, flags: 0, sheetFile: 22, shinyNclrFile: 39, mani: b },
    ])).toThrow(/arc 4 file 22/u);
  });

  it("streams through the native palette when the carrier's palettes are the PWAN's, else with its own", () => {
    const palette = Array.from({ length: 16 }, (_, n) => n * 0x421);
    const other = palette.map((color, n) => (n ? color ^ 0x1f : color));
    const pwan = makePwan([1], [[0, 1]], palette);
    // Block 1: carrier palettes match (normal and shiny). Block 2: the shiny palette is retail's.
    const project = spriteProject({ [38]: nclr(palette), [39]: nclr(palette), [58]: nclr(palette), [59]: nclr(other), [43]: new Uint8Array([1]) });
    const overrides: PwanAnimationOverride[] = [
      { speciesId: 1, front: side(pwan), back: side(pwan), nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" },
      { speciesId: 2, front: side(pwan), nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" },
    ];
    const entries = pokemonStreamEntries(project, overrides);
    // Block 1 front and back; block 2 front and its female sheet (file 43), which shares the MANI.
    expect(entries.map((e) => e.sheetFile)).toEqual([22, 31, 42, 43]);
    const archive = parseW2Anim(buildAnimStreamsFile(entries));
    const flags = (sheet: number) => archive.manis.get(archive.entries.find((e) => e.sheetFile === sheet)!.maniOffset)!.flags;
    expect(flags(22) & W2ANIM_OWN_PALETTES).toBe(0);
    expect(flags(42) & W2ANIM_OWN_PALETTES).toBe(W2ANIM_OWN_PALETTES);
    expect(archive.entries.find((e) => e.sheetFile === 43)!.maniOffset).toBe(archive.entries.find((e) => e.sheetFile === 42)!.maniOffset);
  });

  it("streams trainers into Pokeweb's trainer carrier with their own palette", () => {
    const pwan = makePwan([1], [[0, 1]]);
    const [entry] = trainerStreamEntries([{ graphicIndex: 12, animation: side(pwan) }], 120);
    expect(entry).toMatchObject({ arc: 71, flags: W2ANIM_TRAINER_CARRIER, sheetFile: 97, shinyNclrFile: 960 });
    const archive = parseW2Anim(buildAnimStreamsFile([entry!]));
    expect(archive.manis.values().next().value!.normalPalette).toBeDefined();
  });

  it("indexes species, form, sides and asset in PWNC rows", () => {
    const pwan = makePwan([1], [[0, 1]]);
    const index = buildAnimStreamsIndex([
      { speciesId: 6, formIndex: 2, assetIndex: 700, back: side(pwan), nativePaletteSource: "back", carrierTemplate: "w2u-gen6-placeholder" },
      { speciesId: 3, front: side(pwan), nativePaletteSource: "front", carrierTemplate: "w2u-gen6-placeholder" },
    ]);
    expect(new TextDecoder().decode(index.subarray(0, 4))).toBe("PWNC");
    expect([...index.subarray(16)]).toEqual([3, 0, 0x20, 3, 0, 6, 0, 0x42, 700 & 255, 700 >> 8]);
  });

  it("ships a runtime for each game matching its manifest, with all its hooks", () => {
    // Black 2 / White 2 add the evolution morph's four hooks.
    for (const [game, hooks] of [["B", 12], ["W", 12], ["W2", 16], ["B2", 16]] as const) {
      const bytes = readFileSync(new URL(`../assets/codeinjection/${ANIM_STREAMS_FILENAMES[game]}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.games[game].sha256);
      expect(manifest.games[game].hooks).toHaveLength(hooks);
      expect(new Set(manifest.games[game].hooks.map((hook) => hook.address)).size).toBe(hooks);
    }
  });

  it("streams Black / White trainers from their own trainer archive", () => {
    const [entry] = trainerStreamEntries([{ graphicIndex: 3, animation: side(makePwan([1], [[0, 1]])) }], 90, 72);
    expect(entry).toMatchObject({ arc: 72, sheetFile: 25, shinyNclrFile: 720 });
  });

  it("keeps a Black / White ROM's streams Pokeweb's and offers trainers the shared runtime", () => {
    const project = {
      session: { baseVersion: "B", baseRom: "BW" }, romInfo: { idCode: "IRBO" }, arm9: new Uint8Array(), overlays: {}, narcs: {},
      fileSystem: { replacements: {}, additions: {} },
    } as unknown as ProjectState;
    expect(getTrainerPwanRuntimeStatus(project)).toMatchObject({ supported: true, installed: false });
    project.fileSystem!.additions!["w2anim/streams.bin"] = new Uint8Array(4);
    project.fileSystem!.additions!["patches/PokewebAnimStreamsB.dll"] = readFileSync(new URL("../assets/codeinjection/PokewebAnimStreamsB.dll", import.meta.url));
    expect(isW2AnimProject(project)).toBe(false);
    expect(getTrainerPwanRuntimeStatus(project)).toMatchObject({ supported: true, installed: true });
  });

  it("treats the PWAN runtimes as its own and other DLLs on its hook sites as conflicts", () => {
    const trainer = readFileSync(new URL("../assets/codeinjection/PokewebPwanTrainerB2.dll", import.meta.url));
    const project = {
      session: { baseVersion: "B2", baseRom: "BW2" }, romInfo: { idCode: "IREO" }, arm9: new Uint8Array(), overlays: {}, narcs: {},
      fileSystem: { replacements: {}, additions: { "patches/PokewebPwanTrainerB2.dll": trainer } },
    } as unknown as ProjectState;
    expect(legacyPwanRuntimePaths(project)).toEqual(["patches/PokewebPwanTrainerB2.dll"]);
    expect(detectAnimStreamsCompatibility(project).checks.some((check) => /already hooks/u.test(check.message))).toBe(false);
    project.fileSystem!.additions = { "patches/SomeoneElsesTrainerHook.dll": trainer };
    const conflicts = detectAnimStreamsCompatibility(project).checks.filter((check) => /already hooks/u.test(check.message));
    expect(conflicts.map((check) => check.id)).toContain("HOOK_UPDATE_BATTLE");
  });
});

describe("full-size streams", () => {
  const frame = (index: number, width: number, height: number, art: { x: number; y: number; w: number; h: number; color: number[] }): AnimationAnalysisFrame => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = art.y; y < art.y + art.h; y++) for (let x = art.x; x < art.x + art.w; x++) pixels.set([...art.color, 255], (y * width + x) * 4);
    return { index, width, height, delayMs: 100, pixels };
  };

  it("keeps art larger than 96x96 at its size, stands a front on the ground point and round-trips", () => {
    const frames = [frame(0, 140, 120, { x: 10, y: 5, w: 120, h: 110, color: [248, 0, 0] }), frame(1, 140, 120, { x: 12, y: 5, w: 118, h: 110, color: [0, 248, 0] })];
    const full = compileFramesToFullSizeStream(frames, { side: "front" });
    expect([full.width, full.height, full.uniqueFrameCount]).toEqual([120, 110, 2]);
    // The box's left from the canvas centre; its bottom on the ground point, sunk by at most 8 px when taller than 94.
    expect([full.x0, full.y0]).toEqual([10 - 70, -110 + 8]);
    const info = parseFullSizeMani(full.mani);
    expect(info.sequence).toEqual([{ frame: 0, duration: 6 }, { frame: 1, duration: 6 }]);
    expect(info.frames[0]![0]! >> 5).toBe(7);
    expect(info.frames[1]![0]).toBe(0); // the second frame starts 2 px to the right: transparent
    const archive = parseW2Anim(buildAnimStreamsFile([{ arc: 4, flags: 0, sheetFile: 22, shinyNclrFile: 39, mani: full.mani }]));
    expect(archive.manis.values().next().value!.flags).toBe(W2ANIM_OWN_PALETTES | W2ANIM_TICKS | W2ANIM_MORPH);
    expect(fullSizePreviewPwan(full.mani).uniqueFrameCount).toBe(2);
  });

  it("scales art over 128 down and places a back where a PWAN back stands", () => {
    const full = compileFramesToFullSizeStream([frame(0, 200, 100, { x: 0, y: 0, w: 200, h: 100, color: [0, 0, 248] })], { side: "back", offsetX: 3, offsetY: -2 });
    expect([full.width, full.height]).toEqual([128, 64]);
    expect(full.warnings.some((w) => /scaled/u.test(w))).toBe(true);
    expect([full.x0, full.y0]).toEqual([-64 + 3, -64 + 7 - 2]); // the canvas is scaled with the art
  });

  it("moves and retimes a full-size stream", () => {
    const full = compileFramesToFullSizeStream([frame(0, 100, 100, { x: 0, y: 0, w: 100, h: 100, color: [248, 248, 0] })], { side: "front" });
    const moved = parseFullSizeMani(adjustFullSizeMani(full.mani, { dx: 5, dy: -4, durationScale: 2 }));
    expect([moved.x0, moved.y0]).toEqual([full.x0 + 5, full.y0 - 4]);
    expect(moved.sequence[0]!.duration).toBe(12);
  });
});
