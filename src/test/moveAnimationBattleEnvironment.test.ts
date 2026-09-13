import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOVE_PREVIEW_BACKGROUND_INDEX,
  MOVE_PREVIEW_PLATFORM_INDEX,
  MOVE_PREVIEW_SPECIES_ID,
  selectMovePreviewBattleVariant,
  loadMoveAnimationActorSprites,
} from "../pokeweb/moveAnimationBattleEnvironment";
import * as spriteModel from "../pokeweb/pokemonSpriteModel";
import * as animationModel from "../pokeweb/pokemonBattleSpriteAnimation";
import type { ProjectState } from "../pokeweb/projectStore";

afterEach(() => vi.restoreAllMocks());

describe("move animation battle environment", () => {
  it("loads separate Pokemon and changes views without changing identities when sides swap", () => {
    const project = {} as ProjectState;
    vi.spyOn(spriteModel, "resolvePokemonSpriteId").mockImplementation((_project, id) => id);
    const image = vi.spyOn(spriteModel, "getPokemonSpriteImage").mockImplementation((_project, id, variant) => ({ width: 1, height: 1, pixels: new Uint8ClampedArray([id, variant.side === "back" ? 1 : 2, 0, 255]) }));
    const animation = vi.spyOn(animationModel, "loadPokemonBattleSpriteAnimation").mockReturnValue(undefined);
    const normal = loadMoveAnimationActorSprites(project, { userSpeciesId: 25, targetSpeciesId: 4 });
    expect([...normal.userSprite.pixels]).toEqual([25, 1, 0, 255]);
    expect([...normal.targetSprite.pixels]).toEqual([4, 2, 0, 255]);
    expect(animation).toHaveBeenCalledWith(project, 25, "back");
    expect(animation).toHaveBeenCalledWith(project, 4, "front");
    const swapped = loadMoveAnimationActorSprites(project, { userSpeciesId: 25, targetSpeciesId: 4, swappedSides: true });
    expect([...swapped.userSprite.pixels]).toEqual([4, 1, 0, 255]);
    expect([...swapped.targetSprite.pixels]).toEqual([25, 2, 0, 255]);
    expect(image).toHaveBeenCalledTimes(4);
  });

  it("uses PWAN's actual first image without requiring a native still", () => {
    const image = { width: 1, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255]) };
    vi.spyOn(animationModel, "loadPokemonBattleSpriteAnimation").mockReturnValue({ kind: "pwan", width: 1, height: 1, origin: [0, 0], frameAtTick: () => ({ key: "0", parts: [{ image, source: [0, 0, 1, 1], position: [0, 0], transform: [1, 0, 0, 1, 0, 0] }] }) });
    const native = vi.spyOn(spriteModel, "getPokemonSpriteImage");
    const result = loadMoveAnimationActorSprites({} as ProjectState);
    expect(result.userSprite).toBe(image);
    expect(result.targetSprite).toBe(image);
    expect(native).not.toHaveBeenCalled();
  });

  it("uses Background 01, Platform 06, and Bulbasaur for the stock preview", () => {
    expect(MOVE_PREVIEW_BACKGROUND_INDEX).toBe(1);
    expect(MOVE_PREVIEW_PLATFORM_INDEX).toBe(6);
    expect(MOVE_PREVIEW_SPECIES_ID).toBe(1);
  });

  it("prefers the Spring model and falls back to another available season", () => {
    const variants = [
      { tableIndex: 1, seasonIndex: 2, resourceId: 12 },
      { tableIndex: 1, seasonIndex: 0, resourceId: 10 },
      { tableIndex: 6, seasonIndex: 3, resourceId: 15 },
    ];

    expect(selectMovePreviewBattleVariant(variants, 1)?.resourceId).toBe(10);
    expect(selectMovePreviewBattleVariant(variants, 1, 2)?.resourceId).toBe(12);
    expect(selectMovePreviewBattleVariant(variants, 6)?.resourceId).toBe(15);
    expect(selectMovePreviewBattleVariant(variants, 99)).toBeUndefined();
  });
});
