import type { PokemonBattleSpriteAnimation } from "../pokeweb/pokemonBattleSpriteAnimation";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";

export function createPokemonBattleSpriteRenderer(animation: PokemonBattleSpriteAnimation) {
  const canvas = document.createElement("canvas");
  canvas.width = animation.width;
  canvas.height = animation.height;
  const context = canvas.getContext("2d")!;
  const sources = new WeakMap<RgbaImageData, HTMLCanvasElement>();
  let key: string | undefined;
  return {
    canvas,
    render(tick: number): string {
      const frame = animation.frameAtTick(tick);
      if (key === frame.key) return key;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      for (const part of frame.parts) {
        let source = sources.get(part.image);
        if (!source) {
          source = document.createElement("canvas");
          source.width = part.image.width;
          source.height = part.image.height;
          source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(part.image.pixels), source.width, source.height), 0, 0);
          sources.set(part.image, source);
        }
        context.save();
        context.translate(...animation.origin);
        context.transform(...part.transform);
        context.drawImage(source, ...part.source, ...part.position, part.source[2], part.source[3]);
        context.restore();
      }
      key = frame.key;
      return key;
    },
  };
}
