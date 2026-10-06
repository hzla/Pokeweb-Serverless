import { readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";

export const W2ANIM_PATH = "w2anim/streams.bin";
export const W2ANIM_OWN_PALETTES = 1, W2ANIM_TEX4 = 2, W2ANIM_TICKS = 4, W2ANIM_CARRIER = 1;
export type W2AnimEntry = { arc: number; flags: number; sheetFile: number; maniOffset: number; shinyNclrFile: number };
export type W2AnimSequence = { frame: number; duration: number };
export type W2AnimMani = {
  offset: number; end: number; flags: number; width: number; height: number;
  sequence: W2AnimSequence[]; frames: Array<{ offset: number; size: number }>;
  normalPalette?: Uint16Array; shinyPalette?: Uint16Array;
};
export type W2AnimArchive = { bytes: Uint8Array; entries: W2AnimEntry[]; manis: Map<number, W2AnimMani> };
export const w2animKey = (entry: Pick<W2AnimEntry, "arc" | "sheetFile">): string => `${entry.arc}:${entry.sheetFile}`;
const align4 = (n: number): number => Math.ceil(n / 4) * 4;

function span(bytes: Uint8Array, start: number, size: number, limit = bytes.length): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || size > limit || start > limit - size)
    throw new Error("w2anim stream has an out-of-bounds span");
}

/** Bounded Nitro LZ10/LZ11 decoder. Never writes beyond the declared frame. */
export function decodeW2AnimLz(bytes: Uint8Array, expectedBytes: number): Uint8Array {
  span(bytes, 0, 4);
  const kind = bytes[0];
  if (kind !== 0x10 && kind !== 0x11) throw new Error("w2anim frame is not LZ10/LZ11");
  let size = bytes[1]! | bytes[2]! << 8 | bytes[3]! << 16, input = 4;
  if (!size && kind === 0x11) { span(bytes, 4, 4); size = readU32(bytes, 4); input = 8; }
  if (size !== expectedBytes || !size || size > 16384) throw new Error("w2anim decompressed frame size mismatch");
  const out = new Uint8Array(size);
  let output = 0;
  const take = (): number => { span(bytes, input, 1); return bytes[input++]!; };
  while (output < size) {
    const flags = take();
    for (let bit = 7; bit >= 0 && output < size; bit--) {
      if (!(flags & (1 << bit))) { out[output++] = take(); continue; }
      const a = take(), b = take();
      let length: number, distance: number;
      if (kind === 0x10) { length = (a >> 4) + 3; distance = ((a & 15) << 8 | b) + 1; }
      else if ((a >> 4) === 0) {
        const c = take(); length = ((a & 15) << 4 | b >> 4) + 0x11; distance = ((b & 15) << 8 | c) + 1;
      } else if ((a >> 4) === 1) {
        const c = take(), d = take();
        length = ((a & 15) << 12 | b << 4 | c >> 4) + 0x111; distance = ((c & 15) << 8 | d) + 1;
      } else { length = (a >> 4) + 1; distance = ((a & 15) << 8 | b) + 1; }
      if (distance > output || length > size - output) throw new Error("w2anim LZ backreference exceeds frame bounds");
      for (let i = 0; i < length; i++) { out[output] = out[output - distance]!; output++; }
    }
  }
  return out;
}

/** Lossless greedy LZ10, with a 4 KiB window and 18-byte matches. */
export function encodeW2AnimLz10(bytes: Uint8Array): Uint8Array {
  if (!bytes.length || bytes.length > 0xffffff) throw new Error("Invalid LZ10 input size");
  const out = [0x10, bytes.length & 255, bytes.length >> 8 & 255, bytes.length >> 16 & 255];
  const positions = new Map<number, number[]>();
  const keyAt = (pos: number): number => bytes[pos]! | bytes[pos + 1]! << 8 | bytes[pos + 2]! << 16;
  const remember = (pos: number): void => {
    if (pos + 2 >= bytes.length) return;
    const key = keyAt(pos), list = positions.get(key) ?? [];
    list.push(pos);
    while (list.length && list[0]! < pos - 4096) list.shift();
    positions.set(key, list);
  };
  let pos = 0;
  while (pos < bytes.length) {
    const flagAt = out.length; out.push(0);
    for (let bit = 7; bit >= 0 && pos < bytes.length; bit--) {
      let length = 0, distance = 0;
      const candidates = pos + 2 < bytes.length ? positions.get(keyAt(pos)) : undefined;
      if (candidates) for (let i = candidates.length - 1; i >= 0; i--) {
        const from = candidates[i]!, delta = pos - from;
        if (delta > 4096) break;
        let n = 3;
        while (n < 18 && pos + n < bytes.length && bytes[from + n] === bytes[pos + n]) n++;
        if (n > length) { length = n; distance = delta; if (n === 18) break; }
      }
      if (length >= 3) {
        out[flagAt] = out[flagAt]! | 1 << bit;
        out.push((length - 3) << 4 | (distance - 1) >> 8, (distance - 1) & 255);
      } else { length = 1; out.push(bytes[pos]!); }
      for (let i = 0; i < length; i++) remember(pos + i);
      pos += length;
    }
  }
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}

export function parseW2Anim(bytes: Uint8Array): W2AnimArchive {
  span(bytes, 0, 16);
  if (readAscii(bytes, 0, 4) !== "W2AS" || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== 0)
    throw new Error("Unsupported w2anim archive; expected W2AS v1");
  const count = readU32(bytes, 8), index = readU32(bytes, 12);
  if (count > 65535 || index < 16 || index % 4) throw new Error("Invalid w2anim index");
  span(bytes, index, count * 16);
  const entries: W2AnimEntry[] = [], offsets = new Set<number>();
  for (let i = 0; i < count; i++) {
    const p = index + i * 16;
    const entry = { arc: readU16(bytes, p), flags: readU16(bytes, p + 2), sheetFile: readU32(bytes, p + 4),
      maniOffset: readU32(bytes, p + 8), shinyNclrFile: readU32(bytes, p + 12) };
    if (entry.flags & ~W2ANIM_CARRIER || entry.maniOffset < index + count * 16 || entry.maniOffset % 4)
      throw new Error("Invalid w2anim index entry");
    const previous = entries.at(-1);
    if (previous && (entry.arc < previous.arc || (entry.arc === previous.arc && entry.sheetFile <= previous.sheetFile)))
      throw new Error("w2anim index has duplicate or unsorted keys");
    entries.push(entry); offsets.add(entry.maniOffset);
  }
  const sorted = [...offsets].sort((a, b) => a - b), manis = new Map<number, W2AnimMani>();
  for (let i = 0; i < sorted.length; i++) {
    const offset = sorted[i]!, end = sorted[i + 1] ?? bytes.length;
    span(bytes, offset, 28, end);
    if (readAscii(bytes, offset, 4) !== "MANI" || readU16(bytes, offset + 4) !== 2)
      throw new Error("Unsupported w2anim manifest; expected MANI v2");
    const flags = readU16(bytes, offset + 6), width = readU16(bytes, offset + 8), height = readU16(bytes, offset + 10);
    const seqCount = readU16(bytes, offset + 12), uniqueCount = readU16(bytes, offset + 14);
    const seqAt = readU32(bytes, offset + 16), frameAt = readU32(bytes, offset + 20), paletteAt = readU32(bytes, offset + 24);
    if (flags & ~7 || !width || !height || height > 128 || width > (flags & W2ANIM_TEX4 ? 256 : 128) ||
        (flags & W2ANIM_TEX4 && width % 2) || !seqCount || !uniqueCount)
      throw new Error("Invalid w2anim dimensions, flags or counts");
    const occupied: Array<[number, number]> = [[0, 28]];
    const reserve = (at: number, size: number): void => {
      if (at % 4) throw new Error("Unaligned w2anim manifest offset");
      span(bytes, offset + at, size, end);
      if (occupied.some(([start, finish]) => at < finish && at + size > start)) throw new Error("Overlapping w2anim manifest regions");
      occupied.push([at, at + size]);
    };
    reserve(seqAt, seqCount * 4); reserve(frameAt, uniqueCount * 8);
    if (flags & W2ANIM_OWN_PALETTES) reserve(paletteAt, 64);
    else if (paletteAt) throw new Error("Unexpected w2anim palette offset");
    const sequence: W2AnimSequence[] = [];
    for (let n = 0; n < seqCount; n++) {
      const frame = readU16(bytes, offset + seqAt + n * 4), duration = readU16(bytes, offset + seqAt + n * 4 + 2);
      if (frame >= uniqueCount || !duration) throw new Error("Invalid w2anim timeline entry");
      sequence.push({ frame, duration });
    }
    const frames: W2AnimMani["frames"] = [], shared = new Set<string>();
    const frameBytes = height * (flags & W2ANIM_TEX4 ? width / 2 : 128);
    for (let n = 0; n < uniqueCount; n++) {
      const at = readU32(bytes, offset + frameAt + n * 8), size = readU32(bytes, offset + frameAt + n * 8 + 4);
      const key = `${at}:${size}`;
      if (!shared.has(key)) { reserve(at, size); decodeW2AnimLz(bytes.subarray(offset + at, offset + at + size), frameBytes); shared.add(key); }
      frames.push({ offset: offset + at, size });
    }
    const palette = (at: number): Uint16Array => Uint16Array.from({ length: 16 }, (_, n) => readU16(bytes, offset + at + n * 2));
    manis.set(offset, { offset, end, flags, width, height, sequence, frames,
      normalPalette: flags & W2ANIM_OWN_PALETTES ? palette(paletteAt) : undefined,
      shinyPalette: flags & W2ANIM_OWN_PALETTES ? palette(paletteAt + 32) : undefined });
  }
  return { bytes, entries, manis };
}

export function decodeW2AnimFrame(archive: W2AnimArchive, mani: W2AnimMani, frame: number): Uint8Array {
  const record = mani.frames[frame];
  if (!record) throw new Error("Missing w2anim frame");
  return decodeW2AnimLz(archive.bytes.subarray(record.offset, record.offset + record.size),
    mani.height * (mani.flags & W2ANIM_TEX4 ? mani.width / 2 : 128));
}

export function encodeW2AnimMani(input: { frames: Uint8Array[]; sequence: W2AnimSequence[];
  normalPalette?: Uint16Array; shinyPalette?: Uint16Array; ticks?: boolean }): Uint8Array {
  if (!input.sequence.length || input.sequence.length > 65535) throw new Error("Invalid w2anim timeline length");
  const unique: Uint8Array[] = [], keys = new Map<string, number>();
  const sequence = input.sequence.map(({ frame, duration }) => {
    const pixels = input.frames[frame];
    if (!pixels || pixels.length !== 4608 || !Number.isInteger(duration) || duration < 1 || duration > 65535)
      throw new Error("w2anim edits require 96x96 TEX4 frames and nonzero u16 durations");
    const key = Array.from(pixels).join(","); // Exact deduplication, not a collision-prone hash.
    let index = keys.get(key);
    if (index === undefined) { index = unique.length; keys.set(key, index); unique.push(pixels); }
    return { frame: index, duration };
  });
  if (unique.length > 65535) throw new Error("Too many w2anim frames");
  const own = Boolean(input.normalPalette || input.shinyPalette);
  if (own && (input.normalPalette?.length !== 16 || input.shinyPalette?.length !== 16)) throw new Error("Both w2anim palettes must contain 16 colors");
  const blobs = unique.map(encodeW2AnimLz10), framesAt = 28 + sequence.length * 4;
  const paletteAt = framesAt + unique.length * 8, dataAt = paletteAt + (own ? 64 : 0);
  const out = new Uint8Array(dataAt + blobs.reduce((total, blob) => total + align4(blob.length), 0));
  out.set(new TextEncoder().encode("MANI")); writeU16(out, 4, 2);
  writeU16(out, 6, W2ANIM_TEX4 | (input.ticks === false ? 0 : W2ANIM_TICKS) | (own ? W2ANIM_OWN_PALETTES : 0));
  writeU16(out, 8, 96); writeU16(out, 10, 96); writeU16(out, 12, sequence.length); writeU16(out, 14, unique.length);
  writeU32(out, 16, 28); writeU32(out, 20, framesAt); writeU32(out, 24, own ? paletteAt : 0);
  sequence.forEach((step, n) => { writeU16(out, 28 + n * 4, step.frame); writeU16(out, 30 + n * 4, step.duration); });
  if (own) [input.normalPalette!, input.shinyPalette!].forEach((pal, side) => pal.forEach((color, n) => writeU16(out, paletteAt + side * 32 + n * 2, color)));
  let cursor = dataAt;
  blobs.forEach((blob, n) => { writeU32(out, framesAt + n * 8, cursor); writeU32(out, framesAt + n * 8 + 4, blob.length); out.set(blob, cursor); cursor += align4(blob.length); });
  return out;
}

/** Rebuild only the index. Unedited MANI payloads and shared references remain exact. */
export function materializeW2AnimArchive(source: W2AnimArchive, updates: Map<string, { entry: W2AnimEntry; mani: Uint8Array } | null>): Uint8Array {
  if (!updates.size) return source.bytes;
  const entries = new Map(source.entries.map(entry => [w2animKey(entry), entry]));
  for (const [key, update] of updates) { if (update) entries.set(key, update.entry); else entries.delete(key); }
  const sorted = [...entries.values()].sort((a, b) => a.arc - b.arc || a.sheetFile - b.sheetFile);
  const payloads: Uint8Array[] = [], offsets = new Map<number | Uint8Array, number>();
  let cursor = 16 + sorted.length * 16;
  const resolved = sorted.map(entry => {
    const edit = updates.get(w2animKey(entry)), key = edit ? edit.mani : entry.maniOffset;
    let offset = offsets.get(key);
    if (offset === undefined) {
      const mani = source.manis.get(entry.maniOffset);
      const bytes = edit ? edit.mani : source.bytes.subarray(entry.maniOffset, mani!.end);
      offset = cursor; offsets.set(key, offset); payloads.push(bytes); cursor += align4(bytes.length);
    }
    return { ...entry, maniOffset: offset };
  });
  const out = new Uint8Array(cursor); out.set(new TextEncoder().encode("W2AS")); writeU16(out, 4, 1); writeU32(out, 8, sorted.length); writeU32(out, 12, 16);
  resolved.forEach((entry, n) => { const p = 16 + n * 16; writeU16(out, p, entry.arc); writeU16(out, p + 2, entry.flags);
    writeU32(out, p + 4, entry.sheetFile); writeU32(out, p + 8, entry.maniOffset); writeU32(out, p + 12, entry.shinyNclrFile); });
  cursor = 16 + sorted.length * 16;
  for (const payload of payloads) { out.set(payload, cursor); cursor += align4(payload.length); }
  parseW2Anim(out); // Validate the complete result before exposing it to project state.
  return out;
}
