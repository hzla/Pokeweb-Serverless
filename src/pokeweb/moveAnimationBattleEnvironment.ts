import { decodeBattleModelScene, type BattleModelScene } from "./battleModelScene";
import { loadBattleEnvironmentArchives, parseBattleBackgroundVariants } from "./battleBackgroundModel";
import { parseBattlePlatformVariants } from "./battlePlatformModel";
import { getPokemonSpriteImage, resolvePokemonSpriteId, type RgbaImageData } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";
import { loadPokemonBattleSpriteAnimation, type PokemonBattleSpriteAnimation } from "./pokemonBattleSpriteAnimation";

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
  userSpeciesId?: number;
  targetSpeciesId?: number;
  background: BattleModelScene;
  platform: BattleModelScene;
  userSprite: RgbaImageData;
  targetSprite: RgbaImageData;
  userAnimation?: PokemonBattleSpriteAnimation;
  targetAnimation?: PokemonBattleSpriteAnimation;
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
  userSpeciesId?: number;
  targetSpeciesId?: number;
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

  return {
    backgroundIndex: backgroundVariant.tableIndex,
    backgroundSeasonIndex: backgroundVariant.seasonIndex,
    platformIndex: platformVariant.tableIndex,
    platformSeasonIndex: platformVariant.seasonIndex,
    swappedSides: selection.swappedSides ?? false,
    speciesId: selection.userSpeciesId ?? MOVE_PREVIEW_SPECIES_ID,
    userSpeciesId: selection.userSpeciesId ?? MOVE_PREVIEW_SPECIES_ID,
    targetSpeciesId: selection.targetSpeciesId ?? MOVE_PREVIEW_SPECIES_ID,
    background: decodeBattleModelScene(backgroundBytes, backgroundVariant.resourceId),
    platform: decodeBattleModelScene(platformBytes, platformVariant.resourceId),
    ...loadMoveAnimationActorSprites(project, selection),
  };
}

export function loadMoveAnimationActorSprites(
  project: ProjectState,
  selection: MoveAnimationBattleEnvironmentSelection = {},
): Pick<MoveAnimationBattleEnvironment, "userSprite" | "targetSprite" | "userAnimation" | "targetAnimation"> {
  const user = selection.userSpeciesId ?? MOVE_PREVIEW_SPECIES_ID;
  const target = selection.targetSpeciesId ?? MOVE_PREVIEW_SPECIES_ID;
  const load = (speciesId: number, side: "front" | "back") => {
    const animation = loadPokemonBattleSpriteAnimation(project, speciesId, side);
    const image = animation?.kind === "pwan"
      ? animation.frameAtTick(0).parts[0]!.image
      : getPokemonSpriteImage(project, resolvePokemonSpriteId(project, speciesId), { kind: "sprite", side, gender: "male" }, "normal");
    return { animation, image };
  };
  // The renderer's source slots are physical near/back and far/front. It
  // assigns them to logical user/target roles when swappedSides is enabled.
  const near = load(selection.swappedSides ? target : user, "back");
  const far = load(selection.swappedSides ? user : target, "front");
  return { userSprite: near.image, targetSprite: far.image, userAnimation: near.animation, targetAnimation: far.animation };
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
