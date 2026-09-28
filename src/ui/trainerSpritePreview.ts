import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import type { TrainerSpriteAnimationFrame } from "../pokeweb/trainerSpriteModel";

export type AnimationBounds = { minX: number; minY: number; width: number; height: number };
export const TRAINER_ANIMATION_TICK_MS = 1000 / 60;

export function wrapTick(tick: number, totalTicks: number): number {
  if (totalTicks <= 0) return 0;
  return ((Math.round(tick) % totalTicks) + totalTicks) % totalTicks;
}

export function animationFrameLabel(tick: number, totalTicks: number): string {
  return `Tick ${wrapTick(tick, totalTicks) + 1} / ${Math.max(1, totalTicks)}`;
}

export function frameCanvas(frame: TrainerSpriteAnimationFrame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  return canvas;
}

export function animationBounds(frames: TrainerSpriteAnimationFrame[]): AnimationBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const frame of frames) {
    if (!frame.rgba.some((value, index) => index % 4 === 3 && value > 0)) continue;
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { minX: 0, minY: 0, width: 1, height: 1 };
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function drawTrainerFrame(
  canvas: HTMLCanvasElement | null,
  frames: TrainerSpriteAnimationFrame[],
  frameCanvases: HTMLCanvasElement[],
  bounds: AnimationBounds,
  tick: number,
): void {
  const frame = frames[wrapTick(tick, frames.length)] ?? frames[0];
  const source = frameCanvases[frame?.index ?? 0];
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !frame || !source) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#242638";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height, 24);
  const scale = Math.max(1, Math.min(3, Math.floor(Math.min((canvas.width - 40) / bounds.width, (canvas.height - 40) / bounds.height))));
  const originX = Math.round((canvas.width - bounds.width * scale) / 2 - bounds.minX * scale);
  const originY = Math.round((canvas.height - bounds.height * scale) / 2 - bounds.minY * scale);
  ctx.drawImage(source, originX + frame.x * scale, originY + frame.y * scale, frame.width * scale, frame.height * scale);
}

export function drawTrainerAtlas(canvas: HTMLCanvasElement | null, image: RgbaImageData): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#242638";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height, 16);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, step: number): void {
  ctx.strokeStyle = "rgb(255 255 255 / 10%)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}
