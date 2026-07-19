import { decodeBattleModelScene, type BattleModelScene } from "./battleModelScene";
import { loadBattleEnvironmentArchives, parseBattleBackgroundVariants } from "./battleBackgroundModel";
import { parseBattlePlatformVariants } from "./battlePlatformModel";
import { getPokemonSpriteImage, resolvePokemonSpriteId, type RgbaImageData } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";

export const MOVE_PREVIEW_BACKGROUND_INDEX = 1;
export const MOVE_PREVIEW_PLATFORM_INDEX = 6;
export const MOVE_PREVIEW_SPECIES_ID = 1;

export type MoveAnimationBattleEnvironment = {
  backgroundIndex: number;
  backgroundSeasonIndex: number;
  platformIndex: number;
  platformSeasonIndex: number;
  swappedSides: boolean;
  speciesId: number;
  background: BattleModelScene;
  platform: BattleModelScene;
  userSprite: RgbaImageData;
  targetSprite: RgbaImageData;
};

type BattleVariant = {
  tableIndex: number;
  seasonIndex: number;
  resourceId: number;
};

export type MoveAnimationBattleEnvironmentSelection = {
  backgroundIndex?: number;
  backgroundSeasonIndex?: number;
  platformIndex?: number;
  platformSeasonIndex?: number;
  swappedSides?: boolean;
};

export async function loadMoveAnimationBattleEnvironment(
  project: ProjectState,
  selection: MoveAnimationBattleEnvironmentSelection = {},
): Promise<MoveAnimationBattleEnvironment> {
  const { rom, graphics, table } = await loadBattleEnvironmentArchives(project);
  const backgroundRows = table.narc.files[1];
  const platformRows = table.narc.files[2];
  if (!backgroundRows || !platformRows) throw new Error("The battle lookup archive is missing its background or platform table.");

  const backgroundIndex = selection.backgroundIndex ?? MOVE_PREVIEW_BACKGROUND_INDEX;
  const platformIndex = selection.platformIndex ?? MOVE_PREVIEW_PLATFORM_INDEX;
  const backgroundVariant = selectMovePreviewBattleVariant(
    parseBattleBackgroundVariants(backgroundRows, graphics.files, rom.idCode),
    backgroundIndex,
    selection.backgroundSeasonIndex,
  );
  const platformVariant = selectMovePreviewBattleVariant(
    parseBattlePlatformVariants(platformRows, graphics.files, rom.idCode),
    platformIndex,
    selection.platformSeasonIndex,
  );
  if (!backgroundVariant) throw new Error(`Battle background ${backgroundIndex} is unavailable.`);
  if (!platformVariant) throw new Error(`Battle platform ${platformIndex} is unavailable.`);

  const backgroundBytes = graphics.files[backgroundVariant.resourceId];
  const platformBytes = graphics.files[platformVariant.resourceId];
  if (!backgroundBytes || !platformBytes) throw new Error("The selected battle preview model is missing from the graphics archive.");

  const spriteId = resolvePokemonSpriteId(project, MOVE_PREVIEW_SPECIES_ID);
  return {
    backgroundIndex: backgroundVariant.tableIndex,
    backgroundSeasonIndex: backgroundVariant.seasonIndex,
    platformIndex: platformVariant.tableIndex,
    platformSeasonIndex: platformVariant.seasonIndex,
    swappedSides: selection.swappedSides ?? false,
    speciesId: MOVE_PREVIEW_SPECIES_ID,
    background: decodeBattleModelScene(backgroundBytes, backgroundVariant.resourceId),
    platform: decodeBattleModelScene(platformBytes, platformVariant.resourceId),
    userSprite: getPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "back", gender: "male" }, "normal"),
    targetSprite: getPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "front", gender: "male" }, "normal"),
  };
}

export function selectMovePreviewBattleVariant<T extends BattleVariant>(
  variants: T[],
  tableIndex: number,
  seasonIndex = 0,
): T | undefined {
  return variants.find((variant) => variant.tableIndex === tableIndex && variant.seasonIndex === seasonIndex)
    ?? variants.find((variant) => variant.tableIndex === tableIndex && variant.seasonIndex === 0)
    ?? variants.find((variant) => variant.tableIndex === tableIndex);
}
