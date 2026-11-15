import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { readNitroTextureAnimation, type NitroTextureSrt } from "./nitroAnimation";
import { ensure, nitroBlocks, readDictionary, writeDictionary, writeNitroFile } from "./nitroResourceWriter";

/**
 * Map texture transform animations (a/0/6/8): one NSBTA per area, one track per terrain material name, all tracks
 * sharing the file's frame count. The game binds tracks to a chunk's materials by name, so a brush copies a donor
 * area's track (Floccesy's swaying "lav" flowers, say) into the destination area's file to animate its art.
 */
type SrtLayout = { blocks: Uint8Array[]; block: number; anim: number; frameCount: number; tracks: { name: string; data: Uint8Array }[] };

function srtLayout(file: Uint8Array): SrtLayout {
  const blocks = nitroBlocks(file), block = blocks.findIndex(b => String.fromCharCode(...b.subarray(0, 4)) === "SRT0");
  ensure(block >= 0, "A map texture animation is missing its SRT0 block.");
  const srt = blocks[block], anims = readDictionary(srt, 8);
  ensure(anims.length === 1, "A map texture animation must hold one animation.");
  const anim = readU32(anims[0].data, 0);
  ensure(String.fromCharCode(...srt.subarray(anim, anim + 4)) === "M\0AT", "Invalid map texture animation header.");
  return { blocks, block, anim, frameCount: readU16(srt, anim + 4), tracks: readDictionary(srt, anim + 8) };
}

export function srtTrackNames(file: Uint8Array) {
  return srtLayout(file).tracks.map(track => track.name);
}

const CONSTANT = 0x20000000, FX16 = 0x10000000;

/** The smallest whole loop inside a track (a sway can repeat several times in one file). */
function trackPeriod(samples: readonly NitroTextureSrt[]) {
  const same = (a: NitroTextureSrt, b: NitroTextureSrt) => (Object.keys(a) as (keyof NitroTextureSrt)[]).every(key => Math.abs(a[key] - b[key]) < 1e-4);
  for (let period = 1; period < samples.length; period++) {
    if (samples.length % period === 0 && samples.every((sample, i) => same(sample, samples[(i + period) % samples.length]))) return period;
  }
  return samples.length;
}

/**
 * Encode one track over `frameCount` frames. A donor loop of another length is stretched to a whole number of loops,
 * so the motion stays smooth where the file wraps; constant channels stay constant.
 */
function encodeTrack(samples: readonly NitroTextureSrt[], frameCount: number, dataAt: number) {
  const period = trackPeriod(samples), loops = Math.max(1, Math.round(frameCount / period));
  const at = (frame: number): NitroTextureSrt => {
    const source = (frame * period * loops / frameCount) % samples.length, lo = Math.floor(source), t = source - lo;
    const a = samples[lo], b = samples[(lo + 1) % samples.length];
    return Object.fromEntries((Object.keys(a) as (keyof NitroTextureSrt)[]).map(key => [key, a[key] * (1 - t) + b[key] * t])) as NitroTextureSrt;
  };
  // A file far shorter than the loop would turn a gentle sway into a flicker; hold the first pose instead.
  const frames = Array.from({ length: frameCount }, (_, frame) => frameCount * 2 < period ? samples[0] : at(frame));
  const fx = (value: number) => Math.round(value * 4096);
  const entry = new Uint8Array(40), data: Uint8Array[] = [];
  let offset = dataAt;
  const channels: (keyof NitroTextureSrt | ["sin", "cos"])[] = ["scaleS", "scaleT", ["sin", "cos"], "transS", "transT"];
  channels.forEach((channel, i) => {
    const values = frames.map(frame => Array.isArray(channel) ? channel.map(key => fx(frame[key])) : [fx(frame[channel])]);
    if (values.every(value => value.every((n, j) => n === values[0][j]))) {
      writeU32(entry, i * 8, (CONSTANT | (Array.isArray(channel) ? 0 : FX16) | frameCount) >>> 0);
      writeU32(entry, i * 8 + 4, Array.isArray(channel) ? ((values[0][0] & 0xffff) | (values[0][1] << 16)) >>> 0 : values[0][0] >>> 0);
      return;
    }
    // Every frame stored: 16-bit pairs for rotation, 16-bit values for scale and translation.
    const bytes = new Uint8Array(values.length * values[0].length * 2);
    values.flat().forEach((value, k) => {
      ensure(value >= -32768 && value <= 32767, "A texture animation value is out of range.");
      writeU16(bytes, k * 2, value & 0xffff);
    });
    writeU32(entry, i * 8, ((Array.isArray(channel) ? 0 : FX16) | frameCount) >>> 0);
    writeU32(entry, i * 8 + 4, offset);
    const padded = new Uint8Array((bytes.length + 3) & ~3);
    padded.set(bytes);
    data.push(padded);
    offset += padded.length;
  });
  return { entry, data: concatBytes(data) };
}

/**
 * Add the donor's tracks for `names` to a map texture animation, keeping every existing track byte-for-byte (only
 * their data offsets move past the larger dictionary). Names the target already animates are left alone.
 */
export function appendSrtTracks(target: Uint8Array, donor: Uint8Array, names: readonly string[]) {
  const layout = srtLayout(target), existing = new Set(layout.tracks.map(track => track.name));
  const wanted = [...new Set(names)].filter(name => !existing.has(name));
  if (!wanted.length) return target;
  const source = readNitroTextureAnimation(donor), donorNames = new Set(srtTrackNames(donor));
  ensure(wanted.every(name => donorNames.has(name)), "The donor area does not animate this art.");
  ensure(layout.tracks.length + wanted.length <= 255, "This area's texture animation has no room for more tracks.");
  const donorFrames = Array.from({ length: source.frameCount }, (_, frame) => source.sample(frame));
  const srt = layout.blocks[layout.block], { anim, frameCount } = layout;
  const oldDictionary = readU16(srt, anim + 8 + 2), dataStart = anim + 8 + oldDictionary;
  const oldData = srt.subarray(dataStart);
  // The new dictionary's size does not depend on the entry contents, so size it with placeholders first.
  const placeholder = writeDictionary([...layout.tracks, ...wanted.map(name => ({ name, data: new Uint8Array(40) }))], 40);
  const delta = placeholder.length - oldDictionary;
  ensure(delta % 4 === 0, "Unaligned texture animation dictionary.");
  const shifted = layout.tracks.map(({ name, data }) => {
    const entry = data.slice();
    for (let i = 0; i < 5; i++) if (!(readU32(entry, i * 8) & CONSTANT)) writeU32(entry, i * 8 + 4, readU32(entry, i * 8 + 4) + delta);
    return { name, data: entry };
  });
  let next = 8 + placeholder.length + ((oldData.length + 3) & ~3);
  const added = wanted.map(name => {
    const encoded = encodeTrack(donorFrames.map(frame => frame.get(name)!), frameCount, next);
    next += encoded.data.length;
    return { name, ...encoded };
  });
  const dictionary = writeDictionary([...shifted, ...added.map(({ name, entry }) => ({ name, data: entry }))], 40);
  const paddedOld = new Uint8Array((oldData.length + 3) & ~3);
  paddedOld.set(oldData);
  const block = concatBytes([srt.subarray(0, anim + 8), dictionary, paddedOld, ...added.map(track => track.data)]);
  writeU32(block, 4, block.length);
  const blocks = layout.blocks.slice();
  blocks[layout.block] = block;
  return writeNitroFile(target, blocks);
}
