import { describe, expect, it } from "vitest";
import {
  MOVE_PREVIEW_BACKGROUND_INDEX,
  MOVE_PREVIEW_PLATFORM_INDEX,
  MOVE_PREVIEW_SPECIES_ID,
  selectMovePreviewBattleVariant,
} from "../pokeweb/moveAnimationBattleEnvironment";

describe("move animation battle environment", () => {
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
    expect(selectMovePreviewBattleVariant(variants, 6)?.resourceId).toBe(15);
    expect(selectMovePreviewBattleVariant(variants, 99)).toBeUndefined();
  });
});
