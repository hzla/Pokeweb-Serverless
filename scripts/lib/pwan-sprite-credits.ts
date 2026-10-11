import { parseCsv } from '../../src/pokeweb/gen6SpritePipeline';
import { spriteKey } from './pwan-sprite-refresh';

export type SpriteCredit = { credits: string; creditBasis: string };
export type SpriteCreditTracker = { credits?: string; runtimeNotes?: string };
export type SpriteCreditSource = { group: string; relative: string; side: 'front' | 'back' };

/** Only completed CSV contributions with a link for the imported side qualify. */
export function gen6SpriteCredits(csv: string): Map<string, SpriteCredit> {
  const credits = new Map<string, SpriteCredit>();
  for (const row of parseCsv(csv)) {
    if (!/^\d+$/.test(row[0]?.trim() ?? '')) continue;
    const artist = row[6]?.trim();
    if (!artist || /reserved/i.test(artist)) continue;
    for (const [side, column] of [['front', 2], ['back', 3]] as const) {
      if (!/^https?:\/\//i.test(row[column]?.trim() ?? '')) continue;
      credits.set(`${spriteKey(row[1] ?? '')}:${side}`, {
        credits: `Smogon Sprite Project; ${artist}`,
        creditBasis: 'Gen 6 sprite CSV: completed animator entry and matching side link',
      });
    }
  }
  return credits;
}

export function resolveSpriteCredit(
  source: SpriteCreditSource,
  tracker?: SpriteCreditTracker,
  csvCredits = new Map<string, SpriteCredit>(),
): SpriteCredit {
  if (source.group === 'gen6-sprite-work/downloads') {
    const stem = source.relative.split('/').at(-1)!.replace(/-(front|back)\.gif$/i, '');
    return csvCredits.get(`${spriteKey(stem)}:${source.side}`) ?? {
      credits: 'Smogon Sprite Project', creditBasis: 'Selected source collection; individual animator not verified',
    };
  }
  if (source.group === 'gen7-sprite-work/downloads') {
    const stem = source.relative.replace(/-(front|back)\.gif$/i, '');
    // Preserve named contributors only when the tracker documents this exact
    // source stem. Old mixed-source credits must not follow replaced artwork.
    if (tracker?.credits && /Smogon/i.test(tracker.credits) &&
        tracker.runtimeNotes?.includes(`Imported from ${stem};`)) {
      return { credits: tracker.credits, creditBasis: 'Tracker credits for the exact selected Gen 7 GIF stem' };
    }
    return { credits: 'Smogon Sprite Project', creditBasis: 'Selected source collection; individual animator not verified' };
  }
  const artists: Record<string, string> = {
    'smogon-megas': 'Smogon Sprite Project',
    'aranousqui20-newmegas': 'Aronousqui20', 'Aronousqui20': 'Aronousqui20',
    'ghasty-megas': 'Ghasty001', 'diego-gifs': 'diegotoon20', 'retromc': 'RetroNC',
    'selenaff': 'selenaff', 'skidmarc25': 'skidmarc25', 'snivy101': 'snivy101',
    'essentials_gifs': 'Smogon/Sprites Animados Contributors',
  };
  const credits = artists[source.group];
  if (!credits) throw new Error(`Unreviewed sprite credit group: ${source.group}`);
  return { credits, creditBasis: 'Selected source collection attribution' };
}

export function joinSpriteCredits(credits: string[]): string {
  return [...new Set(credits.flatMap(value => value.split(';').map(part => part.trim()).filter(Boolean)))].join('; ');
}
