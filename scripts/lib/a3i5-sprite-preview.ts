import { analyzePalette, type AnimationAnalysisFrame } from '../../src/pokeweb/gifAnimationFrames';
import { applyPwanColorPreset, normalizePwanSourceFrames, prepareRgb555PaletteFrames, type PwanColorPreset } from '../../src/pokeweb/pwanCompiler';

/** Comparison-only texture data. This is neither PWAN nor a packaged w2anim MANI. */
export type A3i5SpritePreview = {
  format: 'a3i5-sprite-preview-v1';
  width: 96;
  height: 96;
  stride: 128;
  palette: number[];
  visibleColors: number;
  sourceColors: number;
  colorPreset: PwanColorPreset;
  strategy: string;
  timeline: {frame: number; ticks: number}[];
  frameCount: number;
  totalTicks: number;
  frameBytes: 12288;
  frames: Uint8Array;
};

export const a3i5SourceColorCount = (frames: AnimationAnalysisFrame[]): number => analyzePalette(frames).opaqueColorCount;
export const shouldMakeA3i5Preview = (sourceColors: number): boolean => sourceColors > 16;

export function compileA3i5SpritePreview(source: AnimationAnalysisFrame[], options: {colorPreset?: PwanColorPreset; timingScale?: number; groundShift?: number} = {}): A3i5SpritePreview {
  if (!source.length) throw new Error('No A3I5 source frames');
  const colorPreset = options.colorPreset ?? 'none', timingScale = options.timingScale ?? 1, groundShift = options.groundShift ?? 0;
  if (!Number.isFinite(timingScale) || timingScale <= 0 || !Number.isInteger(groundShift) || Math.abs(groundShift) > 96) throw new Error('Invalid A3I5 placement/timing');
  const prepared = prepareRgb555PaletteFrames(applyPwanColorPreset(normalizePwanSourceFrames(source), colorPreset), 32);
  const palette = prepared.palette.map(c => (c.r >>> 3) | (c.g >>> 3) << 5 | (c.b >>> 3) << 10);
  const indexByColor = new Map(prepared.palette.map((c,n) => [`${c.r},${c.g},${c.b}`,n]));
  const unique: Uint8Array[] = [], byPixels = new Map<string,number>(), timeline: A3i5SpritePreview['timeline'] = [];
  for (const frame of prepared.frames) {
    const pixels = new Uint8Array(128 * 96);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const at = (y * 96 + x) * 4, targetY = y + groundShift;
      if (targetY < 0 || targetY >= 96 || frame.pixels[at + 3]! < 128) continue;
      const index = indexByColor.get(`${frame.pixels[at]},${frame.pixels[at+1]},${frame.pixels[at+2]}`);
      if (index === undefined) throw new Error('A3I5 pixel is outside selected palette');
      // Alpha supplies transparency, so palette index zero is a real visible color.
      pixels[targetY * 128 + x] = 0xe0 | index;
    }
    // Exact key, no probabilistic deduplication or dropped poses.
    const key = Array.from(pixels, b => String.fromCharCode(b)).join('');
    let index = byPixels.get(key);
    if (index === undefined) {index = unique.length; byPixels.set(key,index); unique.push(pixels);}
    const ticks = Math.max(1, Math.min(0xffff, Math.round(frame.delayMs * 60 / 1000) * timingScale));
    if (!Number.isInteger(ticks)) throw new Error('A3I5 timing multiplier must produce whole ticks');
    const previous = timeline.at(-1);
    if (source.length > 192 && previous?.frame === index && previous.ticks + ticks <= 0xffff) previous.ticks += ticks;
    else timeline.push({frame:index,ticks});
  }
  while (palette.length < 32) palette.push(0);
  const frames = new Uint8Array(unique.length * 12288);
  unique.forEach((bytes,n) => frames.set(bytes,n * 12288));
  const result: A3i5SpritePreview = {format:'a3i5-sprite-preview-v1',width:96,height:96,stride:128,palette,visibleColors:prepared.palette.length,sourceColors:a3i5SourceColorCount(source),colorPreset,strategy:prepared.strategy,timeline,frameCount:unique.length,totalTicks:timeline.reduce((n,s)=>n+s.ticks,0),frameBytes:12288,frames};
  validateA3i5SpritePreview(result);
  return result;
}

export function validateA3i5SpritePreview(value: A3i5SpritePreview): void {
  if (value.format !== 'a3i5-sprite-preview-v1' || value.width !== 96 || value.height !== 96 || value.stride !== 128 || value.frameBytes !== 12288) throw new Error('Invalid A3I5 preview geometry');
  if (value.palette.length !== 32 || value.palette.some(c=>!Number.isInteger(c)||c<0||c>0x7fff) || !Number.isInteger(value.visibleColors) || value.visibleColors < 0 || value.visibleColors > 32) throw new Error('Invalid A3I5 palette');
  if (!Number.isInteger(value.frameCount) || value.frameCount < 1 || value.frames.length !== value.frameCount * value.frameBytes) throw new Error('Invalid A3I5 frame bounds');
  if (!value.timeline.length || value.timeline.some(s=>!Number.isInteger(s.frame)||s.frame<0||s.frame>=value.frameCount||!Number.isInteger(s.ticks)||s.ticks<1||s.ticks>0xffff) || value.totalTicks !== value.timeline.reduce((n,s)=>n+s.ticks,0)) throw new Error('Invalid A3I5 timeline');
  for (let at = 0; at < value.frames.length; at++) {
    const texel = value.frames[at]!;
    if ((at % 128 >= 96 && texel) || (texel >>> 5 && (texel & 31) >= value.visibleColors)) throw new Error('Invalid A3I5 texel/padding');
  }
}
