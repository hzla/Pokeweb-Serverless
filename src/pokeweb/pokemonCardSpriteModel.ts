import { findPwanOverrideForSpecies } from "./pwanAnimationModel";
import { pwanFrameRgbaImage } from "./pwanCompiler";
import { getPokemonSpriteImage, resolvePokemonSpriteId, type RgbaImageData } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";

export function getPokemonCardFrontSpriteImage(project: ProjectState, speciesId: number): RgbaImageData | undefined {
  const pwanFront = findPwanOverrideForSpecies(project, speciesId)?.front;
  if (pwanFront) {
    try {
      return pwanFrameRgbaImage(pwanFront.pwanBytes);
    } catch {
      // Keep native and bundled sprites available for malformed legacy PWAN data.
    }
  }

  if (!project.narcs.pokemon_sprites) return undefined;
  const spriteId = resolvePokemonSpriteId(project, speciesId, 0);
  return getPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "front", gender: "male" }, "normal");
}
