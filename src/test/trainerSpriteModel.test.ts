import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import {
  TRAINER_SPRITE_FILE_FORMATS,
  applyTrainerSpriteGifBuild,
  buildTrainerSpriteGifPreview,
  defaultTrainerSpriteGifConfig,
  getTrainerClassIdsSharingGraphic,
  getTrainerClassRigAtlas,
  getTrainerClassSpriteAnimation,
  getTrainerClassSpriteImage,
} from "../pokeweb/trainerSpriteModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { getTrainerCount, getTrainerRecord } from "../pokeweb/trainerModel";

describe("trainerSpriteModel", () => {
  it("maps BW2 PWT, Boss Trainer, and Pokéstar classes to their unique or shared graphics", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "cleanwhite2.nds", {
      selectedNarcs: ["trdata", "trpok", "trainer_sprites"],
    });
    const class112Names = Array.from({ length: getTrainerCount(project) }, (_unused, trainerId) => getTrainerRecord(project, trainerId))
      .filter((trainer) => Number(trainer.raw.class) === 112)
      .map((trainer) => String(trainer.readable.name));
    const animation = getTrainerClassSpriteAnimation(project, 112);

    expect(class112Names).toContain("Elesa");
    expect(animation.graphicIndex).toBe(94);
    expect(animation.frames.some((frame) => frame.rgba.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    expect(getTrainerClassSpriteAnimation(project, 147).graphicIndex).toBe(17);
    expect(getTrainerClassSpriteAnimation(project, 155).graphicIndex).toBe(87);
    expect(getTrainerClassSpriteAnimation(project, 165).graphicIndex).toBe(92);
    expect(getTrainerClassSpriteAnimation(project, 167).graphicIndex).toBe(129);
    expect(getTrainerClassSpriteAnimation(project, 195).graphicIndex).toBe(148);
    expect(getTrainerClassSpriteAnimation(project, 196).graphicIndex).toBe(73);
    expect(getTrainerClassSpriteAnimation(project, 197).graphicIndex).toBe(97);
    expect(getTrainerClassSpriteAnimation(project, 211).graphicIndex).toBe(169);
    expect(getTrainerClassSpriteAnimation(project, 226).graphicIndex).toBe(184);
    expect(getTrainerClassSpriteAnimation(project, 227).graphicIndex).toBe(185);
    expect(getTrainerClassSpriteAnimation(project, 234).graphicIndex).toBe(187);
    expect(getTrainerClassSpriteAnimation(project, 235).graphicIndex).toBe(186);
    expect(getTrainerClassIdsSharingGraphic(project, 147)).toEqual(expect.arrayContaining([17, 147, 148]));
    expect(getTrainerClassIdsSharingGraphic(project, 195)).toEqual(expect.arrayContaining([186, 195]));
  });

  it("defaults trainer GIF imports to rotated poses and even sampling", () => {
    expect(defaultTrainerSpriteGifConfig()).toMatchObject({
      packingMode: "rotated-pose-blocks",
      strategy: "even",
    });
  });

  it("renders the real BW multi-cell trainer timeline when the source fixture is available", () => {
    const archiveUrl = new URL("../../../reference_repos/pokemon_wb_git/resource/trgra/trfgra.narc", import.meta.url);
    if (!existsSync(archiveUrl)) return;

    const archive = new NARC(new Uint8Array(readFileSync(archiveUrl)));
    const project = {
      session: { baseRom: "BW", baseVersion: "W", romName: "fixture.nds", fairy: false, fileIds: {}, blacklist: [] },
      narcs: { trainer_sprites: createNarcStore("trainer_sprites", "a/0/7/2", 0, archive) },
    } as unknown as ProjectState;

    const animation = getTrainerClassSpriteAnimation(project, 0);
    const image = getTrainerClassSpriteImage(project, 0);
    const rigAtlas = getTrainerClassRigAtlas(project, 0);

    expect(TRAINER_SPRITE_FILE_FORMATS).toEqual(["NCGR", "NCBR", "NCER", "NANR", "NMCR", "NMAR", "NCEC", "NCLR"]);
    expect(animation.graphicIndex).toBe(0);
    expect(animation.totalTicks).toBe(animation.frames.length);
    expect(animation.totalTicks).toBeGreaterThan(1);
    expect(animation.cellSequenceCount).toBeGreaterThan(0);
    expect(animation.multiCellCount).toBeGreaterThan(0);
    expect(animation.frames.some((frame) => frame.rgba.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    expect(image.width).toBeGreaterThan(1);
    expect(image.height).toBeGreaterThan(1);
    expect(rigAtlas).toMatchObject({ width: 256, height: 128 });
  });

  it("builds, previews, and applies a complete native trainer bundle from a GIF", () => {
    const archiveUrl = new URL("../../../reference_repos/pokemon_wb_git/resource/trgra/trfgra.narc", import.meta.url);
    const gifUrl = new URL("../../node_modules/gifuct-js/demo/dog.gif", import.meta.url);
    if (!existsSync(archiveUrl) || !existsSync(gifUrl)) return;
    const project = fixtureProject(archiveUrl, "BW");
    const config = { ...defaultTrainerSpriteGifConfig(), strategy: "even" as const, maxUniqueFrames: 12, sourceFramePercent: 35 };

    const build = buildTrainerSpriteGifPreview(project, 0, new Uint8Array(readFileSync(gifUrl)), config);

    expect(build.files).toHaveLength(8);
    expect(build.files.every((file) => file.length > 0)).toBe(true);
    expect(build.animation.frames.length).toBeGreaterThan(0);
    expect(build.animation.frames.some((frame) => frame.rgba.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    expect(build.palette).toHaveLength(16);
    expect(build.rigAtlas).toMatchObject({ width: 256, height: 128 });
    expect(build.report.uniqueTileCount).toBeLessThanOrEqual(512);
    expect(build.report.sourceLoopKind).toBe("infinite");

    applyTrainerSpriteGifBuild(project, build);
    expect([...project.narcs.trainer_sprites!.dirty].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(getTrainerClassSpriteAnimation(project, 0).totalTicks).toBe(build.animation.totalTicks);
  });

  it("reports every BW2 trainer class affected by a shared graphic", () => {
    const archiveUrl = new URL("../../../reference_repos/pokemon_wb_git/resource/trgra/trfgra.narc", import.meta.url);
    if (!existsSync(archiveUrl)) return;
    const project = fixtureProject(archiveUrl, "BW2");

    expect(getTrainerClassIdsSharingGraphic(project, 40)).toEqual([40, 47, 101]);
    expect(getTrainerClassIdsSharingGraphic(project, 47)).toEqual([40, 47, 101]);
  });
});

function fixtureProject(archiveUrl: URL, baseRom: "BW" | "BW2"): ProjectState {
  const archive = new NARC(new Uint8Array(readFileSync(archiveUrl)));
  return {
    session: { baseRom, baseVersion: baseRom === "BW2" ? "W2" : "W", romName: "fixture.nds", fairy: false, fileIds: {}, blacklist: [] },
    narcs: { trainer_sprites: createNarcStore("trainer_sprites", baseRom === "BW2" ? "a/0/7/1" : "a/0/7/2", 0, archive) },
    texts: { banks: { tr_classes: Array.from({ length: 107 }, (_unused, index) => `Class ${index}`) } },
    arm9: new Uint8Array(),
    overlays: {},
    romInfo: { title: "Fixture", idCode: "IRAO", fileName: "fixture.nds", size: 0 },
    formats: {},
    trpokInfo: [],
  } as ProjectState;
}
