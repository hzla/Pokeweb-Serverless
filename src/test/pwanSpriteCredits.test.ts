import { describe, expect, it } from 'vitest';
import { gen6SpriteCredits, joinSpriteCredits, resolveSpriteCredit } from '../../scripts/lib/pwan-sprite-credits';

describe('sprite source credits', () => {
  it('uses completed CSV animator credits only for the linked side', () => {
    const csv = ',,Front,Back,Front-shiny,Back-shiny,Animator,QC\n650,Chespin,https://example.invalid/front,,,,Artist,\n651,Quilladin,https://example.invalid/front,,,,Other (reserved),';
    const credits = gen6SpriteCredits(csv);
    expect(resolveSpriteCredit({group: 'gen6-sprite-work/downloads', relative: 'gen6-sprite-work/downloads/chespin/chespin-front.gif', side: 'front'}, undefined, credits).credits).toBe('Smogon Sprite Project; Artist');
    expect(credits.has('chespin:back')).toBe(false);
    expect(credits.has('quilladin:front')).toBe(false);
  });
  it('retains Gen 7 tracker names only for the exact documented source', () => {
    const tracker = {credits: 'Smogon Sprite Project; Animator', runtimeNotes: 'Imported from gen7-sprite-work/downloads/rowlet; PWAN asset index 1'};
    const source = {group: 'gen7-sprite-work/downloads', relative: 'gen7-sprite-work/downloads/rowlet-front.gif', side: 'front' as const};
    expect(resolveSpriteCredit(source, tracker).credits).toBe(tracker.credits);
    expect(resolveSpriteCredit({...source, relative: source.relative.replace('rowlet', 'rowletother')}, tracker).credits).toBe('Smogon Sprite Project');
  });
  it('does not transfer old mixed credits to new source collections', () => {
    const tracker = {credits: 'Old Artist; Smogon Sprite Project; Other Artist'};
    expect(resolveSpriteCredit({group: 'retromc', relative: 'retromc/example-front.gif', side: 'front'}, tracker).credits).toBe('RetroNC');
    expect(resolveSpriteCredit({group: 'smogon-megas', relative: 'smogon-megas/example-front.gif', side: 'front'}, tracker).credits).toBe('Smogon Sprite Project');
    expect(() => resolveSpriteCredit({group: 'unknown', relative: 'unknown/file.gif', side: 'front'})).toThrow('Unreviewed');
  });
  it('deduplicates front and back attributions without changing artist text', () => {
    expect(joinSpriteCredits(['Smogon Sprite Project; Animator, Other (back)', 'Smogon Sprite Project; Animator, Other (back)', 'RetroNC'])).toBe('Smogon Sprite Project; Animator, Other (back); RetroNC');
  });
});
