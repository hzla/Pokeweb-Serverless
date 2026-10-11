import { readU16, readU32, writeU16, writeU32 } from '../../src/nds/binary';
import { decodeW2AnimFrame, W2ANIM_TEX4, W2ANIM_TICKS, type W2AnimArchive, type W2AnimEntry } from '../../src/pokeweb/w2animCodec';
import { w2animLinearToEditor } from '../../src/pokeweb/w2animAnimationModel';
import { validatePwan } from '../../src/pokeweb/pwanCompiler';

export const SPRITE_PRIORITIES = [
  'gen6-sprite-work/downloads', 'gen7-sprite-work/downloads', 'smogon-megas',
  'aranousqui20-newmegas', 'Aronousqui20', 'ghasty-megas', 'diego-gifs',
  'retromc', 'selenaff', 'skidmarc25', 'snivy101', 'essentials_gifs',
] as const;
export type SpriteRow = { speciesId: number; formIndex: number; assetIndex: number; flags: number };
export type SpriteSource = { path: string; relative: string; group: string; priority: number; side: 'front' | 'back'; key: string };
export const spriteKey = (name: string): string => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseSpriteConfig(bytes: Uint8Array): SpriteRow[] {
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'PWNC' || readU16(bytes, 4) !== 3) throw new Error('Expected PWNC v3 config');
  const count = readU16(bytes, 6), at = readU32(bytes, 12);
  if (at < 16 || at + count * 5 > bytes.length) throw new Error('Truncated sprite config');
  const seen = new Set<string>();
  return Array.from({length: count}, (_, n) => {
    const p = at + n * 5, speciesId = readU16(bytes, p), formIndex = bytes[p + 2]! & 31;
    const key = `${speciesId}:${formIndex}`;
    if (seen.has(key)) throw new Error(`Duplicate sprite config key ${key}`);
    seen.add(key);
    return {speciesId, formIndex, assetIndex: readU16(bytes, p + 3), flags: bytes[p + 2]! >>> 5 & 3};
  });
}

/** Exact keys only: never allow a form to fall back to the unqualified base sprite. */
export function selectSpriteSource(sources: SpriteSource[], aliases: string[], side: 'front' | 'back'): SpriteSource | undefined {
  const keys = aliases.map(spriteKey);
  return sources.filter(source => source.side === side && keys.includes(source.key))
    .sort((a, b) => a.priority - b.priority || keys.indexOf(a.key) - keys.indexOf(b.key) || a.relative.localeCompare(b.relative))[0];
}

export function nativeSpriteBlock(row: SpriteRow, personal: Uint8Array): number {
  let block = row.speciesId >= 722 && row.speciesId <= 809 ? 950 + row.speciesId - 722
    : row.speciesId >= 810 && row.speciesId <= 1023 ? 1200 + row.speciesId - 810 : row.speciesId;
  if (personal.length < 34) throw new Error('Truncated personal record');
  if (row.formIndex && row.formIndex < personal[0x20]! && !(personal[0x21]! & 0x80)) block = 724 + readU16(personal, 0x1e) + row.formIndex - 1;
  return block;
}

export function readNclrPalette(bytes: Uint8Array): Uint16Array {
  for (let at = 16; at + 24 <= bytes.length; at += 4) {
    if (new TextDecoder().decode(bytes.subarray(at, at + 4)) !== 'TTLP') continue;
    const p = at + 8 + readU32(bytes, at + 20);
    if (p < at + 24 || p + 32 > bytes.length) throw new Error('Truncated native sprite palette');
    return Uint16Array.from({length: 16}, (_, n) => readU16(bytes, p + n * 2));
  }
  throw new Error('Native sprite palette has no TTLP block');
}

/** Lossless authoring representation of the previous ROM's stream, not a GIF recompile. */
export function extractRomPwan(archive: W2AnimArchive, entry: W2AnimEntry, nativePalette: Uint16Array): Uint8Array {
  const mani = archive.manis.get(entry.maniOffset)!;
  if (!(mani.flags & W2ANIM_TEX4) || !(mani.flags & W2ANIM_TICKS) || mani.width !== 96 || mani.height !== 96) throw new Error('Baseline is not tick-based 96x96 TEX4');
  const palette = mani.normalPalette ?? nativePalette, timelineAt = 72, framesAt = timelineAt + mani.sequence.length * 4;
  const bytes = new Uint8Array(framesAt + mani.frames.length * 4608);
  bytes.set(new TextEncoder().encode('PWAN'));
  [1, 96, 96, 4, mani.frames.length, mani.sequence.length].forEach((v, n) => writeU16(bytes, 4 + n * 2, v));
  [mani.sequence.reduce((sum, step) => sum + step.duration, 0), 4608, 16, 40, timelineAt, framesAt].forEach((v, n) => writeU32(bytes, 16 + n * 4, v));
  palette.forEach((v, n) => writeU16(bytes, 40 + n * 2, v));
  mani.sequence.forEach((step, n) => {writeU16(bytes, timelineAt + n * 4, step.frame); writeU16(bytes, timelineAt + n * 4 + 2, step.duration);});
  mani.frames.forEach((_, n) => bytes.set(w2animLinearToEditor(decodeW2AnimFrame(archive, mani, n)), framesAt + n * 4608));
  validatePwan(bytes);
  return bytes;
}
