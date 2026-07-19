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
  platformIndex: number;
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

export async function loadMoveAnimationBattleEnvironment(project: ProjectState): Promise<MoveAnimationBattleEnvironment> {
  const { rom, graphics, table } = await loadBattleEnvironmentArchives(project);
  const backgroundRows = table.narc.files[1];
  const platformRows = table.narc.files[2];
  if (!backgroundRows || !platformRows) throw new Error("The battle lookup archive is missing its background or platform table.");

  const backgroundVariant = selectMovePreviewBattleVariant(
    parseBattleBackgroundVariants(backgroundRows, graphics.files, rom.idCode),
    MOVE_PREVIEW_BACKGROUND_INDEX,
  );
  const platformVariant = selectMovePreviewBattleVariant(
    parseBattlePlatformVariants(platformRows, graphics.files, rom.idCode),
    MOVE_PREVIEW_PLATFORM_INDEX,
  );
  if (!backgroundVariant) throw new Error(`Battle background ${MOVE_PREVIEW_BACKGROUND_INDEX} is unavailable.`);
  if (!platformVariant) throw new Error(`Battle platform ${MOVE_PREVIEW_PLATFORM_INDEX} is unavailable.`);

  const backgroundBytes = graphics.files[backgroundVariant.resourceId];
  const platformBytes = graphics.files[platformVariant.resourceId];
  if (!backgroundBytes || !platformBytes) throw new Error("The selected battle preview model is missing from the graphics archive.");

  const spriteId = resolvePokemonSpriteId(project, MOVE_PREVIEW_SPECIES_ID);
  return {
    backgroundIndex: MOVE_PREVIEW_BACKGROUND_INDEX,
    platformIndex: MOVE_PREVIEW_PLATFORM_INDEX,
    speciesId: MOVE_PREVIEW_SPECIES_ID,
    background: decodeBattleModelScene(backgroundBytes, backgroundVariant.resourceId),
    platform: decodeBattleModelScene(platformBytes, platformVariant.resourceId),
    userSprite: getPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "back", gender: "male" }, "normal"),
    targetSprite: getPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "front", gender: "male" }, "normal"),
  };
}

export function selectMovePreviewBattleVariant<T extends BattleVariant>(variants: T[], tableIndex: number): T | undefined {
  return variants.find((variant) => variant.tableIndex === tableIndex && variant.seasonIndex === 0)
    ?? variants.find((variant) => variant.tableIndex === tableIndex);
}
