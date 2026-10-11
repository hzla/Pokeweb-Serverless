import { describe, expect, it } from "vitest";
import { Folder, addFilePath } from "../nds/fnt";
import { NintendoDSRom } from "../nds/rom";
import { detectAnimationAssets } from "../pokeweb/animationAssetModel";
import { PWAN_ARCHIVE_PATH, findPwanOverrideForSpecies, pwanOverrideSideFromCompileResult, upsertPwanOverrideSide } from "../pokeweb/pwanAnimationModel";
import { compilePwanAnimationFrames } from "../pokeweb/pwanCompiler";
import { hydrateW2AnimFromRom, materializeW2AnimAnimations } from "../pokeweb/w2animAnimationModel";
import { W2ANIM_PATH, parseW2Anim } from "../pokeweb/w2animCodec";
import type { ProjectState } from "../pokeweb/projectStore";
import { streamFixture } from "./w2animFixture";

function sourceProject(paths: string[]): { project: ProjectState; rom: NintendoDSRom } {
  const header = new Uint8Array(0x4000); header.set(new TextEncoder().encode("IRDO"), 12);
  const rom = new NintendoDSRom(header);
  rom.arm9 = Uint8Array.of(0); rom.arm7 = Uint8Array.of(0);
  rom.banner = new Uint8Array(0x840);
  let filenames = new Folder();
  rom.files = paths.map((path, id) => {
    filenames = addFilePath(filenames, path, id);
    return path === W2ANIM_PATH ? streamFixture() : Uint8Array.of(1, 2, 3, 4);
  });
  const bytes = rom.save({ filenames });
  return { rom: new NintendoDSRom(bytes, { fileData: "view" }), project: {
    originalRomBytes: bytes, session: { baseVersion: "W2", baseRom: "BW2" },
    romInfo: { idCode: "IRDO" }, narcs: {}, texts: { banks: {} }, arm9: Uint8Array.of(0), overlays: {},
  } as unknown as ProjectState };
}

describe("ROM animation backend detection", () => {
  it.each([
    [[], { pwan: false, w2anim: false, active: "native" }],
    [[PWAN_ARCHIVE_PATH], { pwan: true, w2anim: false, active: "pwan" }],
    [[W2ANIM_PATH], { pwan: false, w2anim: true, active: "w2anim" }],
    [[PWAN_ARCHIVE_PATH, W2ANIM_PATH], { pwan: true, w2anim: true, active: "w2anim" }],
  ] as const)("detects source files %j without hydrating or modifying them", (paths, expected) => {
    const { project } = sourceProject([...paths]), before = structuredClone(project);
    expect(detectAnimationAssets(project)).toEqual(expected);
    expect(detectAnimationAssets(project)).toEqual(expected);
    expect(project).toEqual(before);
  });

  it("detects staged PWAN assets without misidentifying an empty authoring canvas", () => {
    const { project } = sourceProject([]);
    project.pwanAnimations = { overrides: [] };
    expect(detectAnimationAssets(project).active).toBe("native");
    project.fileSystem = { additions: { [PWAN_ARCHIVE_PATH]: Uint8Array.of(1) }, replacements: {} };
    expect(detectAnimationAssets(project).active).toBe("pwan");
  });

  it("exports a GIF edit only to W2AS when a dormant PWAN archive is also present", async () => {
    const { project, rom } = sourceProject([PWAN_ARCHIVE_PATH, W2ANIM_PATH]);
    hydrateW2AnimFromRom(project, rom);
    findPwanOverrideForSpecies(project, 1);
    const compiled = compilePwanAnimationFrames([{ index: 0, width: 1, height: 1, delayMs: 100,
      pixels: Uint8ClampedArray.of(240, 8, 80, 255) }]);
    const side = pwanOverrideSideFromCompileResult({ fileName: "fixture.gif", gifBytes: Uint8Array.of(1) }, compiled);
    // The fixture stream owns its palettes; provide only the native carrier files it needs.
    const native = new Uint8Array(48 + 16384); native.set(new TextEncoder().encode("RAHC"), 16);
    new DataView(native.buffer).setUint32(40, 16384, true); new DataView(native.buffer).setUint32(44, 24, true);
    const palette = new Uint8Array(72); palette.set(new TextEncoder().encode("TTLP"), 16);
    new DataView(palette.buffer).setUint32(36, 16, true);
    const rawFiles = Array.from({ length: 40 }, () => new Uint8Array());
    rawFiles[22] = native; rawFiles[23] = native.slice(); rawFiles[38] = palette; rawFiles[39] = palette.slice();
    project.narcs.pokemon_sprites = { rawFiles, fileCount: 40, records: new Map(), dirty: new Set() } as any;
    upsertPwanOverrideSide(project, { speciesId: 1, side: "front", sideData: side });
    await materializeW2AnimAnimations(project, rom);
    expect(project.fileSystem!.replacements[0]).toBeUndefined();
    expect(Object.keys(project.fileSystem!.additions ?? {})).toEqual([]);
    const output = new NintendoDSRom(rom.save({ files: new Map([[1, project.fileSystem!.replacements[1]!]]) }));
    expect(output.getFileByName(PWAN_ARCHIVE_PATH)).toEqual(rom.files[0]);
    const source = parseW2Anim(output.getFileByName(W2ANIM_PATH)!);
    expect(source.manis.get(source.entries[0]!.maniOffset)!.normalPalette).toEqual(compiled.paletteBgr555);
    expect(project.codeInjection?.modules).toBeUndefined();
  });
});
