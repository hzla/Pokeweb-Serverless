import { describe, expect, it } from 'vitest';
import { moveEffectStatus, previewAnimationId } from '../../scripts/lib/white2expansion-progress';
describe('integration tracker progress', () => {
  it.each([718, 904, 743, 757, 774, 851, 906])('does not mark unsupported dependencies complete: %s', id => {
    expect(moveEffectStatus(id,true,true,'Quality = "EFFECT_NO_SPECIAL_EFFECT"').completed).toBe(false);
  });
  it('distinguishes native data, registered mechanics, and unresolved special execution', () => {
    expect(moveEffectStatus(560,true,false,'present').completed).toBe(true);
    expect(moveEffectStatus(877,false,true,'present').completed).toBe(true);
    expect(moveEffectStatus(787,false,false,'Quality = "EFFECT_CHANCE_TO_DECREASE_STATS"').completed).toBe(true);
    expect(moveEffectStatus(606,false,false,'Quality = "EFFECT_OTHERS"').completed).toBe(false);
    expect(moveEffectStatus(900,false,false,'').completed).toBe(false);
    expect(moveEffectStatus(901,false,false,'Quality = "EFFECT_OTHERS"').completed).toBe(false);
  });
  it('preserves native animation aliases when no dedicated script is staged', () => {
    expect(previewAnimationId(606,'"Move Animation ID" = 369',new Set())).toBe(369);
    expect(previewAnimationId(560,'"Move Animation ID" = 0',new Set([560]))).toBe(560);
    expect(previewAnimationId(718,'"Move Animation ID" = 0',new Set())).toBeUndefined();
  });
});
