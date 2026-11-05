import { loadPokemonBattleSpriteAnimation } from "../pokeweb/pokemonBattleSpriteAnimation";
import { getPokemonCardFrontSpriteImage } from "../pokeweb/pokemonCardSpriteModel";
import { professorIntroScreenAnchor, type ProfessorIntroPreview } from "../pokeweb/professorIntroPreview";
import type { ProjectState } from "../pokeweb/projectStore";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import { createPokemonBattleSpriteRenderer } from "./pokemonBattleSpriteRenderer";

/** A single resting frame; the editor does not start an animation loop. */
export function drawProfessorIntroPreview(canvas: HTMLCanvasElement, project: ProjectState, scene: ProfessorIntroPreview, speciesId: number): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The intro preview canvas is unavailable.");
  const surface = (image: RgbaImageData) => {
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
    return source;
  };
  const animation = loadPokemonBattleSpriteAnimation(project, speciesId, "front");
  let pokemon: HTMLCanvasElement;
  let origin: [number, number];
  if (animation) {
    const renderer = createPokemonBattleSpriteRenderer(animation);
    renderer.render(0);
    pokemon = renderer.canvas;
    origin = animation.origin;
  } else {
    const image = getPokemonCardFrontSpriteImage(project, speciesId);
    if (!image) throw new Error("Load Pokémon Sprites to preview this Pokémon.");
    pokemon = surface(image);
    origin = [image.width / 2, image.height];
  }
  canvas.width = 256;
  canvas.height = 192;
  context.imageSmoothingEnabled = false;
  context.drawImage(surface(scene.background), 0, 0);
  const [professorX, professorY] = professorIntroScreenAnchor(8, 5.628, 0);
  context.drawImage(surface(scene.professor), professorX + scene.professor.x, professorY + scene.professor.y);
  const [pokemonX, pokemonY] = professorIntroScreenAnchor(-5, -11.5, 1);
  context.save();
  context.translate(pokemonX, pokemonY);
  // The intro mirrors the front sprite, matching its native negative X scale.
  context.scale(-1, 1);
  context.drawImage(pokemon, -origin[0], -origin[1]);
  context.restore();
}
