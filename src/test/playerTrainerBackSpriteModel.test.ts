import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import {
  ensurePlayerTrainerBackSpriteStore,
  getPlayerTrainerBackSpritePreview,
} from "../pokeweb/playerTrainerBackSpriteModel";

describe("playerTrainerBackSpriteModel", () => {
  for (const romName of ["cleanblack2.nds", "cleanwhite2.nds"]) {
    it(`previews both playable appearances without modifying ${romName}`, async () => {
      const romUrl = new URL(`../../../${romName}`, import.meta.url);
      if (!existsSync(romUrl)) return;
      const bytes = new Uint8Array(readFileSync(romUrl));
      const project = await loadProjectFromRomBytes(bytes, romName, { selectedNarcs: ["trainer_back_sprites"] });
      expect(await ensurePlayerTrainerBackSpriteStore(project)).toBe(true);
      const store = project.narcs.trainer_back_sprites!;
      const original = store.rawFiles.slice(0, 16).map((file) => file.slice());

      for (const appearance of [0, 1]) {
        const preview = getPlayerTrainerBackSpritePreview(project, appearance);
        expect(preview.appearanceIndex).toBe(appearance);
        expect(preview.animation.totalTicks).toBe(preview.animation.frames.length);
        expect(preview.animation.totalTicks).toBe(100);
        expect(preview.animation.outerSequenceIndex).toBe(1);
        expect(preview.animation.outerKeyFrameCount).toBe(21);
        expect(preview.animation.frames.some((frame) => frame.rgba.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
        const first = preview.animation.frames[0];
        const middle = preview.animation.frames[50];
        expect(first.x !== middle.x || first.y !== middle.y || !Buffer.from(first.rgba).equals(Buffer.from(middle.rgba))).toBe(true);
        expect(preview.staticGraphic.width).toBeGreaterThan(0);
        expect(preview.rigAtlas.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
        expect(preview.palette.length).toBeGreaterThanOrEqual(16);
      }

      expect(store.dirty.size).toBe(0);
      expect(store.rawFiles.slice(0, 16)).toEqual(original);
      const reopened = await loadProjectFromRomBytes(bytes, romName, { selectedNarcs: ["trainer_back_sprites"] });
      expect(getPlayerTrainerBackSpritePreview(reopened, 0).animation.totalTicks).toBe(getPlayerTrainerBackSpritePreview(project, 0).animation.totalTicks);
      expect(reopened.narcs.trainer_back_sprites!.dirty.size).toBe(0);
    });
  }

  it("reports invalid appearances and missing native files", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), "cleanwhite2.nds", { selectedNarcs: ["trainer_back_sprites"] });
    expect(() => getPlayerTrainerBackSpritePreview(project, 2)).toThrow("Unsupported player appearance");
    project.narcs.trainer_back_sprites!.rawFiles[1] = new Uint8Array();
    expect(() => getPlayerTrainerBackSpritePreview(project, 0)).toThrow("missing one or more");
    project.narcs.trainer_back_sprites!.rawFiles[1] = new Uint8Array([1, 2, 3, 4]);
    expect(() => getPlayerTrainerBackSpritePreview(project, 0)).toThrow("unsupported stamp");
    delete project.narcs.trainer_back_sprites;
    expect(() => getPlayerTrainerBackSpritePreview(project, 0)).toThrow("archive is not loaded");
  });

  it("lazily loads the archive for a preview without marking it dirty", async () => {
    const romUrl = new URL("../../../cleanwhite2.nds", import.meta.url);
    if (!existsSync(romUrl)) return;
    const bytes = new Uint8Array(readFileSync(romUrl));
    const project = await loadProjectFromRomBytes(bytes, "cleanwhite2.nds", { selectedNarcs: [] });
    delete project.narcs.trainer_back_sprites;
    expect(await ensurePlayerTrainerBackSpriteStore(project)).toBe(true);
    expect(getPlayerTrainerBackSpritePreview(project, 1).animation.totalTicks).toBe(100);
    expect(project.narcs.trainer_back_sprites!.dirty.size).toBe(0);
  });
});
