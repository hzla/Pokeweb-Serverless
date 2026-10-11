import { describe, expect, it } from 'vitest';
import { compileA3i5SpritePreview, shouldMakeA3i5Preview, validateA3i5SpritePreview } from '../../scripts/lib/a3i5-sprite-preview';
import type { AnimationAnalysisFrame } from '../pokeweb/gifAnimationFrames';
import { compilePwanAnimationFrames, parsePwanHeader } from '../pokeweb/pwanCompiler';

function sample(colors: number): AnimationAnalysisFrame[] {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  for(let n=0;n<colors;n++) pixels.set([(n%32)*8, (Math.floor(n/32)*8)+(n%4)*32, (n%8)*24,255],n*4);
  return [{index:0,width:96,height:96,pixels,delayMs:100}];
}
describe('comparison-only 32-color A3I5', () => {
  it('only opts in original GIFs with more than 16 visible colors', () => {
    expect(shouldMakeA3i5Preview(15)).toBe(false);
    expect(shouldMakeA3i5Preview(16)).toBe(false);
    expect(shouldMakeA3i5Preview(17)).toBe(true);
  });
  it('preserves all 32 RGB555 colors, including visible palette index zero', () => {
    const result=compileA3i5SpritePreview(sample(32));
    expect(result.visibleColors).toBe(32);
    expect(result.strategy).toBe('exact');
    expect(new Set(result.frames.subarray(0,32)).size).toBe(32);
    expect(result.frames[0]).toBe(0xe0);
    expect(result.frames[32]).toBe(0);
    expect(result.palette).toHaveLength(32);
  });
  it('reduces larger source palettes to at most 32 actual RGB555 colors', () => {
    const result=compileA3i5SpritePreview(sample(65));
    expect(result.sourceColors).toBe(65);
    expect(result.visibleColors).toBe(32);
    expect(result.strategy).toBe('weighted-median-cut');
    expect(new Set(result.palette).size).toBe(32);
  });
  it('does not enlarge or change the existing PWAN format', () => {
    const result=compilePwanAnimationFrames(sample(32));
    expect(parsePwanHeader(result.pwanBytes).paletteColors).toBe(16);
    expect(result.conversion.visibleColorCount).toBe(15);
  });
  it('applies the same placement and timing without blurring or mutating source', () => {
    const source=sample(32), original=source[0]!.pixels.slice();
    const result=compileA3i5SpritePreview(source,{groundShift:3,timingScale:2});
    expect(result.frames.subarray(0,128*3).some(Boolean)).toBe(false);
    expect(result.frames[128*3]).toBe(0xe0);
    expect(result.timeline).toEqual([{frame:0,ticks:12}]);
    expect(source[0]!.pixels).toEqual(original);
    const graded=compileA3i5SpritePreview(source,{colorPreset:'gen5'});
    expect(graded.colorPreset).toBe('gen5');
    expect(graded.palette).not.toEqual(result.palette);
  });
  it('bounds-checks frame data, palette, timeline, and transparent row padding', () => {
    const valid=compileA3i5SpritePreview(sample(32));
    expect(()=>validateA3i5SpritePreview({...valid,frames:valid.frames.subarray(1)})).toThrow('bounds');
    expect(()=>validateA3i5SpritePreview({...valid,palette:[0]})).toThrow('palette');
    expect(()=>validateA3i5SpritePreview({...valid,timeline:[{frame:1,ticks:6}]})).toThrow('timeline');
    const corrupted=valid.frames.slice();corrupted[100]=0xe0;
    expect(()=>validateA3i5SpritePreview({...valid,frames:corrupted})).toThrow('padding');
  });
});
