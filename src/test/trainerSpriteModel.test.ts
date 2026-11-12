import { romFixtureExists } from "./romFixtures";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import {
  TRAINER_SPRITE_FILE_FORMATS,
  applyTrainerSpriteGifBuild,
  buildTrainerSpriteGifPreview,
  defaultTrainerSpriteGifConfig,
  getTrainerClassIdsSharingGraphic,
  getTrainerClassRigAtlas,
  getTrainerClassSpriteAnimation,
  getTrainerClassSpriteImage,
  readTrainerClassSpriteTable,
  trainerGraphicIndexForClass,
} from "../pokeweb/trainerSpriteModel";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { getTrainerCount, getTrainerRecord } from "../pokeweb/trainerModel";

describe("trainerSpriteModel", () => {
  it.skipIf(!romFixtureExists(new URL("../../../cleanwhite2.nds", import.meta.url)))("maps BW2 PWT, Boss Trainer, and Pokéstar classes to their unique or shared graphics", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
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
    expect(getTrainerClassSpriteAnimation(project, 235).graphicIndex).toBe(148);
    // PWT and Boss Trainer classes that borrow ordinary trainer art.
    expect(getTrainerClassSpriteAnimation(project, 104).graphicIndex).toBe(51);
    expect(getTrainerClassSpriteAnimation(project, 156).graphicIndex).toBe(87);
    expect(getTrainerClassSpriteAnimation(project, 228).graphicIndex).toBe(50);
    expect(readTrainerClassSpriteTable(project.arm9)).not.toBeNull();
    expect(getTrainerClassIdsSharingGraphic(project, 147)).toEqual(expect.arrayContaining([17, 147, 148]));
    expect(getTrainerClassIdsSharingGraphic(project, 195)).toEqual([186, 195, 235]);
  });

  it("reads the class -> sprite table from arm9 and falls back to vanilla BW2", () => {
    const vanilla = { session: { baseRom: "BW2" }, arm9: new Uint8Array(64), texts: { banks: {} } } as unknown as ProjectState;
    expect(readTrainerClassSpriteTable(vanilla.arm9)).toBeNull();
    expect([104, 156, 198, 228, 230, 235].map((classId) => trainerGraphicIndexForClass(vanilla, classId))).toEqual([51, 87, 155, 50, 46, 148]);

    // A modded table: same opening entries, class 104 remapped to graphic 7.
    const arm9 = new Uint8Array(0x40 + 236 * 4);
    for (let classId = 0; classId < 236; classId += 1) {
      arm9[0x40 + classId * 4] = classId < 16 ? classId : trainerGraphicIndexForClass(vanilla, classId);
      arm9[0x40 + classId * 4 + 1] = [0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0][classId] ?? 0;
    }
    arm9[0x40 + 104 * 4] = 7;
    const modded = { ...vanilla, arm9 } as ProjectState;
    expect(trainerGraphicIndexForClass(modded, 104)).toBe(7);
    expect(trainerGraphicIndexForClass(modded, 228)).toBe(50);
  });

  it("defaults trainer GIF imports to rotated poses and even sampling", () => {
    expect(defaultTrainerSpriteGifConfig()).toMatchObject({
      packingMode: "rotated-pose-blocks",
      strategy: "even",
    });
  });

  it.skipIf(!romFixtureExists(new URL("../../../cleanblack.nds", import.meta.url)))("renders the real BW multi-cell trainer timeline when the source fixture is available", () => {
    const archive = trainerSpriteFixture("BW");

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

  it.skipIf(!romFixtureExists(new URL("../../../cleanblack.nds", import.meta.url)) || !existsSync(new URL("../../node_modules/gifuct-js/demo/dog.gif", import.meta.url)))("builds, previews, and applies a complete native trainer bundle from a GIF", () => {
    const archive = trainerSpriteFixture("BW");
    const gifUrl = new URL("../../node_modules/gifuct-js/demo/dog.gif", import.meta.url);
    const project = fixtureProject(archive, "BW");
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

  it.skipIf(!romFixtureExists(new URL("../../../cleanwhite2.nds", import.meta.url)))("reports every BW2 trainer class affected by a shared graphic", () => {
    const archive = trainerSpriteFixture("BW2");
    const project = fixtureProject(archive, "BW2");

    expect(getTrainerClassIdsSharingGraphic(project, 40)).toEqual([40, 47, 101]);
    expect(getTrainerClassIdsSharingGraphic(project, 47)).toEqual([40, 47, 101]);
  });
});

function trainerSpriteFixture(baseRom: "BW" | "BW2"): NARC {
  const romUrl = new URL(baseRom === "BW" ? "../../../cleanblack.nds" : "../../../cleanwhite2.nds", import.meta.url);
  const rom = new NintendoDSRom(new Uint8Array(readFileSync(romUrl)), { fileData: "view" });
  return new NARC(rom.files[rom.fileId(baseRom === "BW" ? "a/0/7/2" : "a/0/7/1")]);
}

function fixtureProject(archive: NARC, baseRom: "BW" | "BW2"): ProjectState {
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
