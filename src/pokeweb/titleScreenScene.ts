import { compileNitroAnimatedModel } from "./nitroAnimatedModel";
import type { TitleScreenDocument } from "./titleScreenModel";

export const TITLE_IDLE_START = 7300;
export const TITLE_LAST_FRAME = 7780;

export function compileTitleScene(document: TitleScreenDocument) {
  const get = (id: string) => {
    const asset = document.assets.find((a) => a.id === id);
    if (!asset) throw new Error(`Missing title asset: ${id}.`);
    return asset.bytes;
  };
  const models = ["01", "02", "03"].map((id) => compileNitroAnimatedModel(get(`model-${id}`), get(`model-${id}-animation`), id === "03" ? get(`model-${id}-texture-animation`) : undefined));
  const frameCount = Math.min(document.camera.frameCount, ...models.map((m) => m.frameCount));
  if (frameCount < 1) throw new Error("The title scene has no animation frames.");
  return { models, frameCount, sample: (frame: number) => models.forEach((m) => m.sample(Math.min(frameCount - 1, Math.max(0, Math.floor(frame))))) };
}
export type TitleScene = ReturnType<typeof compileTitleScene>;

export function advanceTitleFrame(frame: number, advance: number, start: number, end: number): number {
  return start + ((frame - start + advance) % (end - start + 1) + end - start + 1) % (end - start + 1);
}
