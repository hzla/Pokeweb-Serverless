import { concatBytes, readAscii, readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { getRomFileBytes, replaceRomFile } from "./fileSystemModel";
import { invalidateNitroSdatCache, loadNitroSdatFromProject } from "./nitroSound";
import { loadActiveRomBytes } from "./persistence";
import {
  assertBundledBgmRuntimeCompatibility,
  configureBundledBgmRuntime,
  getPmcInstallStatus,
  installBundledPmc,
  readBgmRuntimeConfig,
  removeStagedCodeInjectionDll,
  stageCodeInjectionDll,
} from "./pmcModel";
import { getStreamedBgmConfigs, type ProjectState, type StreamedBgmConfig } from "./projectStore";

export const STREAMED_BGM_SAMPLE_RATE = 32_728 as const;
export const STREAMED_BGM_CHANNELS = 2 as const;
export const STREAMED_BGM_RUNTIME_VERSION = 3;
export const STREAMED_BGM_CONFIG_MAGIC = 0x53424750; // "PGBS" in little endian.
export const STREAMED_BGM_COMPRESSION_THRESHOLD = 0x0800_0000;

export type StreamedBgmEncoding = "pcm16" | "adpcm";

const SDAT_HEADER_SIZE = 0x40;
const STRM_HEADER_SIZE = 0x68;
const SDAT_FILE_ALIGNMENT = 0x20;
const SDAT_FIRST_FILE_ALIGNMENT = 0x80;
const ADPCM_BLOCK_SAMPLES = 960;
const ADPCM_INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8] as const;
const ADPCM_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253,
  279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166,
  1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428,
  4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289,
  16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
] as const;

export type StereoPcm = {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
};

export type EncodedStreamedBgm = {
  bytes: Uint8Array;
  encoding: StreamedBgmEncoding;
  sampleRate: typeof STREAMED_BGM_SAMPLE_RATE;
  channels: typeof STREAMED_BGM_CHANNELS;
  sampleCount: number;
  loopStartSample: number;
  loopEndSample: number;
};

export type SdatStreamedBgmInstall = {
  bytes: Uint8Array;
  targetSequenceId: number;
  streamId: number;
  streamFileId: number;
  shadowFileId: number;
  originalSequenceFileId: number;
};

export type SdatStreamedBgmConfig = Omit<SdatStreamedBgmInstall, "bytes">;

export type StreamedBgmInstallInput = {
  sourceName: string;
  pcm: StereoPcm;
  targetSequenceId: number;
  targetSequenceSymbol?: string;
  /** Explicit per-track storage format. Omit to retain the legacy automatic policy. */
  encoding?: StreamedBgmEncoding;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  shortcutEnabled: boolean;
};

export type StreamedBgmStatus =
  | { installed: false; supported: boolean; message: string }
  | { installed: true; supported: true; configs: StreamedBgmConfig[]; message: string };

type SdatParts = {
  header: Uint8Array;
  symb?: Uint8Array;
  info: Uint8Array;
  files: Uint8Array[];
};

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`${label} is outside the SDAT file.`);
  }
}

function requireMagic(bytes: Uint8Array, offset: number, magic: string): void {
  requireRange(bytes, offset, magic.length, magic);
  if (readAscii(bytes, offset, magic.length) !== magic) throw new Error(`Expected ${magic} at 0x${offset.toString(16)}.`);
}

function parseSdat(bytes: Uint8Array): SdatParts {
  requireMagic(bytes, 0, "SDAT");
  if (readU16(bytes, 4) !== 0xfeff || readU16(bytes, 6) !== 0x100 || readU16(bytes, 0x0c) !== SDAT_HEADER_SIZE) {
    throw new Error("The sound archive uses an unsupported SDAT header.");
  }
  const symbOffset = readU32(bytes, 0x10);
  const symbLength = readU32(bytes, 0x14);
  const infoOffset = readU32(bytes, 0x18);
  const infoLength = readU32(bytes, 0x1c);
  const fatOffset = readU32(bytes, 0x20);
  const fatLength = readU32(bytes, 0x24);
  const fileOffset = readU32(bytes, 0x28);
  const fileLength = readU32(bytes, 0x2c);
  if (symbOffset || symbLength) requireRange(bytes, symbOffset, symbLength, "SYMB block");
  requireRange(bytes, infoOffset, infoLength, "INFO block");
  requireRange(bytes, fatOffset, fatLength, "FAT block");
  requireRange(bytes, fileOffset, fileLength, "FILE block");
  requireMagic(bytes, infoOffset, "INFO");
  requireMagic(bytes, fatOffset, "FAT ");
  requireMagic(bytes, fileOffset, "FILE");
  if (readU32(bytes, infoOffset + 4) !== infoLength || readU32(bytes, fatOffset + 4) !== fatLength || readU32(bytes, fileOffset + 4) !== fileLength) {
    throw new Error("The SDAT block sizes do not match its header.");
  }
  const count = readU32(bytes, fatOffset + 8);
  if (fatLength !== 0x0c + count * 0x10 || readU32(bytes, fileOffset + 8) !== count) throw new Error("The SDAT FAT/FILE tables have an unsupported layout.");
  const files: Uint8Array[] = [];
  for (let id = 0; id < count; id += 1) {
    const entry = fatOffset + 0x0c + id * 0x10;
    const start = readU32(bytes, entry);
    const length = readU32(bytes, entry + 4);
    requireRange(bytes, start, length, `SDAT file ${id}`);
    if (start < fileOffset + 0x0c || start + length > fileOffset + fileLength) throw new Error(`SDAT file ${id} is outside the FILE block.`);
    files.push(bytes.subarray(start, start + length));
  }
  return {
    header: bytes.slice(0, SDAT_HEADER_SIZE),
    symb: symbOffset && symbLength ? bytes.slice(symbOffset, symbOffset + symbLength) : undefined,
    info: bytes.slice(infoOffset, infoOffset + infoLength),
    files,
  };
}

function infoTableOffset(info: Uint8Array, part: number): number {
  const offset = readU32(info, 8 + part * 4);
  if (offset < 0x28 || offset + 4 > info.length) throw new Error(`SDAT INFO table ${part} is malformed.`);
  return offset;
}

function infoRecordOffset(info: Uint8Array, part: number, id: number): number {
  const table = infoTableOffset(info, part);
  const count = readU32(info, table);
  if (!Number.isInteger(id) || id < 0 || id >= count) throw new Error(`SDAT INFO ${part} entry ${id} does not exist.`);
  const offset = readU32(info, table + 4 + id * 4);
  if (offset === 0 || offset >= info.length) throw new Error(`SDAT INFO ${part} entry ${id} is empty or malformed.`);
  return offset;
}

function replaceRange(bytes: Uint8Array, start: number, removeLength: number, insert: Uint8Array): Uint8Array {
  requireRange(bytes, start, removeLength, "SDAT edit range");
  return concatBytes([bytes.subarray(0, start), insert, bytes.subarray(start + removeLength)]);
}

function adjustInfoOffsets(info: Uint8Array, editOffset: number, delta: number): void {
  for (let part = 0; part < 8; part += 1) {
    const headerAt = 8 + part * 4;
    let table = readU32(info, headerAt);
    if (table >= editOffset) {
      table += delta;
      writeU32(info, headerAt, table);
    }
    const count = readU32(info, table);
    if (table + 4 + count * 4 > info.length) throw new Error(`SDAT INFO table ${part} is malformed after editing.`);
    for (let id = 0; id < count; id += 1) {
      const at = table + 4 + id * 4;
      const offset = readU32(info, at);
      if (offset >= editOffset) writeU32(info, at, offset + delta);
    }
  }
}

function appendStreamInfo(infoBytes: Uint8Array, fileId: number): { info: Uint8Array; streamId: number } {
  let info: Uint8Array = infoBytes.slice();
  const table = infoTableOffset(info, 7);
  const count = readU32(info, table);
  const slot = table + 4 + count * 4;
  info = replaceRange(info, slot, 0, new Uint8Array(4));
  adjustInfoOffsets(info, slot, 4);
  const recordOffset = info.length;
  const record = new Uint8Array(12);
  writeU16(record, 0, fileId);
  writeU16(record, 2, 0);
  record[4] = 127;
  record[5] = 64;
  record[6] = 0;
  record[7] = 0;
  info = concatBytes([info, record]);
  writeU32(info, table, count + 1);
  writeU32(info, table + 4 + count * 4, recordOffset);
  writeU32(info, 4, info.length);
  return { info, streamId: count };
}

function removeStreamInfo(infoBytes: Uint8Array, streamId: number, streamFileId: number): Uint8Array {
  const table = infoTableOffset(infoBytes, 7);
  const count = readU32(infoBytes, table);
  if (count < 2 || streamId !== count - 1) throw new Error("The installed streamed-BGM entry is no longer the final SDAT stream.");
  const slot = table + 4 + streamId * 4;
  const recordOffset = readU32(infoBytes, slot);
  if (recordOffset + 12 !== infoBytes.length || readU16(infoBytes, recordOffset) !== streamFileId) {
    throw new Error("The installed streamed-BGM INFO record no longer matches its configuration.");
  }
  let info: Uint8Array = replaceRange(infoBytes, recordOffset, 12, new Uint8Array());
  info = replaceRange(info, slot, 4, new Uint8Array());
  writeU32(info, table, count - 1);
  adjustInfoOffsets(info, slot, -4);
  writeU32(info, 4, info.length);
  return info;
}

function rebuildSdat(parts: SdatParts): Uint8Array {
  const header = parts.header.slice();
  const chunks: Array<{ offset: number; bytes: Uint8Array }> = [];
  let cursor = SDAT_HEADER_SIZE;
  let symbOffset = 0;
  if (parts.symb) {
    cursor = align(cursor, 4);
    symbOffset = cursor;
    chunks.push({ offset: cursor, bytes: parts.symb });
    cursor += parts.symb.length;
  }
  cursor = align(cursor, 4);
  const infoOffset = cursor;
  chunks.push({ offset: cursor, bytes: parts.info });
  cursor += parts.info.length;
  cursor = align(cursor, 4);
  const fatOffset = cursor;
  const fat = new Uint8Array(0x0c + parts.files.length * 0x10);
  fat.set(new TextEncoder().encode("FAT "), 0);
  writeU32(fat, 4, fat.length);
  writeU32(fat, 8, parts.files.length);
  chunks.push({ offset: cursor, bytes: fat });
  cursor += fat.length;
  cursor = align(cursor, 4);
  const fileOffset = cursor;
  const fileHeader = new Uint8Array(0x0c);
  fileHeader.set(new TextEncoder().encode("FILE"), 0);
  writeU32(fileHeader, 8, parts.files.length);
  chunks.push({ offset: cursor, bytes: fileHeader });
  cursor += fileHeader.length;
  cursor = align(cursor, SDAT_FIRST_FILE_ALIGNMENT);
  parts.files.forEach((file, id) => {
    cursor = align(cursor, SDAT_FILE_ALIGNMENT);
    writeU32(fat, 0x0c + id * 0x10, cursor);
    writeU32(fat, 0x10 + id * 0x10, file.length);
    chunks.push({ offset: cursor, bytes: file });
    cursor += file.length;
  });
  cursor = align(cursor, SDAT_FILE_ALIGNMENT);
  writeU32(fileHeader, 4, cursor - fileOffset);
  const out = new Uint8Array(cursor);
  out.set(header, 0);
  chunks.forEach((chunk) => out.set(chunk.bytes, chunk.offset));
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, SDAT_HEADER_SIZE);
  writeU16(out, 0x0e, parts.symb ? 4 : 3);
  writeU32(out, 0x10, symbOffset);
  writeU32(out, 0x14, parts.symb?.length ?? 0);
  writeU32(out, 0x18, infoOffset);
  writeU32(out, 0x1c, parts.info.length);
  writeU32(out, 0x20, fatOffset);
  writeU32(out, 0x24, fat.length);
  writeU32(out, 0x28, fileOffset);
  writeU32(out, 0x2c, cursor - fileOffset);
  return out;
}

export function createSilentShadowSseq(): Uint8Array {
  // A long rest followed by a jump back to the rest keeps the native BGM
  // handle alive without allocating a voice or producing samples.
  const events = new Uint8Array([0x80, 0xff, 0xff, 0x7f, 0x94, 0x00, 0x00, 0x00]);
  const out = new Uint8Array(0x1c + events.length);
  out.set(new TextEncoder().encode("SSEQ"), 0);
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 0x100);
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 1);
  out.set(new TextEncoder().encode("DATA"), 0x10);
  writeU32(out, 0x14, out.length - 0x10);
  writeU32(out, 0x18, 0x1c);
  out.set(events, 0x1c);
  return out;
}

export function resampleStereoPcm(source: StereoPcm, targetRate = STREAMED_BGM_SAMPLE_RATE): StereoPcm {
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0 || source.left.length !== source.right.length || source.left.length === 0) {
    throw new Error("The decoded audio has invalid channel or sample-rate data.");
  }
  if (source.sampleRate === targetRate) return { sampleRate: targetRate, left: source.left.slice(), right: source.right.slice() };
  const length = Math.max(1, Math.round(source.left.length * targetRate / source.sampleRate));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const scale = source.sampleRate / targetRate;
  for (let i = 0; i < length; i += 1) {
    const position = Math.min(source.left.length - 1, i * scale);
    const base = Math.floor(position);
    const next = Math.min(source.left.length - 1, base + 1);
    const fraction = position - base;
    left[i] = source.left[base]! + (source.left[next]! - source.left[base]!) * fraction;
    right[i] = source.right[base]! + (source.right[next]! - source.right[base]!) * fraction;
  }
  return { sampleRate: targetRate, left, right };
}

export function downmixToStereo(channels: Float32Array[], sampleRate: number): StereoPcm {
  const length = channels[0]?.length ?? 0;
  if (channels.length === 0 || length === 0 || channels.some((channel) => channel.length !== length)) {
    throw new Error("The decoded audio has invalid channel data.");
  }
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  if (channels.length === 1) {
    left.set(channels[0]!);
    right.set(channels[0]!);
  } else {
    let leftCount = 0;
    let rightCount = 0;
    channels.forEach((source, channel) => {
      const destination = channel % 2 === 0 ? left : right;
      for (let i = 0; i < source.length; i += 1) destination[i] += source[i]!;
      if (channel % 2 === 0) leftCount += 1;
      else rightCount += 1;
    });
    for (let i = 0; i < length; i += 1) {
      left[i] /= leftCount;
      right[i] /= rightCount;
    }
  }
  return resampleStereoPcm({ sampleRate, left, right });
}

function pcm16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function encodePcm16Strm(pcm: StereoPcm, loopStartSample = 0, loopEndSample = pcm.left.length): EncodedStreamedBgm {
  const resampled = pcm.sampleRate === STREAMED_BGM_SAMPLE_RATE ? pcm : resampleStereoPcm(pcm);
  const start = Math.round(loopStartSample * STREAMED_BGM_SAMPLE_RATE / pcm.sampleRate);
  const end = Math.round(loopEndSample * STREAMED_BGM_SAMPLE_RATE / pcm.sampleRate);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > resampled.left.length) {
    throw new Error("Loop points must describe a non-empty range inside the decoded audio.");
  }
  const channelLength = end * 2;
  const out = new Uint8Array(STRM_HEADER_SIZE + channelLength * 2);
  out.set(new TextEncoder().encode("STRM"), 0);
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 0x100);
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 2);
  out.set(new TextEncoder().encode("HEAD"), 0x10);
  writeU32(out, 0x14, 0x50);
  out[0x18] = 1; // PCM16
  out[0x19] = 1; // Loop
  out[0x1a] = 2;
  out[0x1b] = 0;
  writeU16(out, 0x1c, STREAMED_BGM_SAMPLE_RATE);
  // Match the retail BW2 STRM timer (0x0010 at 32,728 Hz). Flooring this
  // expression produces 0x000f and causes the native stream player to run at
  // the wrong cadence.
  writeU16(out, 0x1e, Math.round(16_756_991 / (STREAMED_BGM_SAMPLE_RATE * 32)));
  writeU32(out, 0x20, start);
  writeU32(out, 0x24, end);
  writeU32(out, 0x28, STRM_HEADER_SIZE);
  writeU32(out, 0x2c, 1);
  writeU32(out, 0x30, channelLength);
  writeU32(out, 0x34, end);
  writeU32(out, 0x38, channelLength);
  writeU32(out, 0x3c, end);
  out.set(new TextEncoder().encode("DATA"), 0x60);
  writeU32(out, 0x64, 8 + channelLength * 2);
  const writeChannel = (samples: Float32Array, offset: number) => {
    for (let i = 0; i < end; i += 1) writeU16(out, offset + i * 2, pcm16(samples[i]!) & 0xffff);
  };
  writeChannel(resampled.left, STRM_HEADER_SIZE);
  writeChannel(resampled.right, STRM_HEADER_SIZE + channelLength);
  return {
    bytes: out,
    encoding: "pcm16",
    sampleRate: STREAMED_BGM_SAMPLE_RATE,
    channels: STREAMED_BGM_CHANNELS,
    sampleCount: end,
    loopStartSample: start,
    loopEndSample: end,
  };
}

type AdpcmState = { sample: number; index: number };

function encodeAdpcmCode(target: number, state: AdpcmState): number {
  const step = ADPCM_STEP_TABLE[state.index]!;
  let difference = target - state.sample;
  let code = 0;
  if (difference < 0) {
    code = 8;
    difference = -difference;
  }
  let delta = step >> 3;
  if (difference >= step) {
    code |= 4;
    difference -= step;
    delta += step;
  }
  if (difference >= step >> 1) {
    code |= 2;
    difference -= step >> 1;
    delta += step >> 1;
  }
  if (difference >= step >> 2) {
    code |= 1;
    delta += step >> 2;
  }
  state.sample += (code & 8) !== 0 ? -delta : delta;
  state.sample = Math.max(-0x8000, Math.min(0x7fff, state.sample));
  state.index = Math.max(0, Math.min(ADPCM_STEP_TABLE.length - 1, state.index + ADPCM_INDEX_TABLE[code]!));
  return code;
}

function writeAdpcmBlock(out: Uint8Array, offset: number, samples: Float32Array, start: number, count: number, state: AdpcmState): void {
  writeU16(out, offset, state.sample & 0xffff);
  out[offset + 2] = state.index;
  out[offset + 3] = 0;
  for (let index = 0; index < count; index += 1) {
    const code = encodeAdpcmCode(pcm16(samples[start + index]!), state);
    const at = offset + 4 + (index >> 1);
    if ((index & 1) === 0) out[at] = code;
    else out[at] |= code << 4;
  }
}

export function estimateStreamedBgmBytes(encoding: StreamedBgmEncoding, sampleCount: number): number {
  const samples = Math.max(1, Math.floor(sampleCount));
  if (encoding === "pcm16") return STRM_HEADER_SIZE + samples * STREAMED_BGM_CHANNELS * 2;
  const blocks = Math.ceil(samples / ADPCM_BLOCK_SAMPLES);
  const fullBlockSize = 4 + Math.ceil(ADPCM_BLOCK_SAMPLES / 2);
  const lastSamples = samples - (blocks - 1) * ADPCM_BLOCK_SAMPLES;
  const lastBlockSize = 4 + Math.ceil(lastSamples / 2);
  return STRM_HEADER_SIZE + ((blocks - 1) * fullBlockSize + lastBlockSize) * STREAMED_BGM_CHANNELS;
}

export function chooseStreamedBgmEncoding(baseSdatBytes: number, sampleCount: number): StreamedBgmEncoding {
  const pcm16Bytes = estimateStreamedBgmBytes("pcm16", sampleCount);
  // This is a storage-size policy, not a native SDAT format or boot limit.
  // Keep smaller imports lossless and compress larger archives with the
  // native Nitro IMA-ADPCM decoder to reduce ROM/download size.
  return baseSdatBytes + pcm16Bytes + 0x1_0000 <= STREAMED_BGM_COMPRESSION_THRESHOLD ? "pcm16" : "adpcm";
}

export function streamedBgmEncodingLabel(encoding: StreamedBgmEncoding): string {
  return encoding === "pcm16" ? "Stereo PCM16" : "Stereo IMA ADPCM";
}

export function encodeAdpcmStrm(pcm: StereoPcm, loopStartSample = 0, loopEndSample = pcm.left.length): EncodedStreamedBgm {
  const resampled = pcm.sampleRate === STREAMED_BGM_SAMPLE_RATE ? pcm : resampleStereoPcm(pcm);
  const start = Math.round(loopStartSample * STREAMED_BGM_SAMPLE_RATE / pcm.sampleRate);
  const end = Math.round(loopEndSample * STREAMED_BGM_SAMPLE_RATE / pcm.sampleRate);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > resampled.left.length) {
    throw new Error("Loop points must describe a non-empty range inside the decoded audio.");
  }
  const numBlocks = Math.ceil(end / ADPCM_BLOCK_SAMPLES);
  const fullBlockSize = 4 + Math.ceil(ADPCM_BLOCK_SAMPLES / 2);
  const lastBlockSamples = end - (numBlocks - 1) * ADPCM_BLOCK_SAMPLES;
  const lastBlockSize = 4 + Math.ceil(lastBlockSamples / 2);
  const dataLength = ((numBlocks - 1) * fullBlockSize + lastBlockSize) * STREAMED_BGM_CHANNELS;
  const out = new Uint8Array(STRM_HEADER_SIZE + dataLength);
  out.set(new TextEncoder().encode("STRM"), 0);
  writeU16(out, 4, 0xfeff);
  writeU16(out, 6, 0x100);
  writeU32(out, 8, out.length);
  writeU16(out, 0x0c, 0x10);
  writeU16(out, 0x0e, 2);
  out.set(new TextEncoder().encode("HEAD"), 0x10);
  writeU32(out, 0x14, 0x50);
  out[0x18] = 2; // Nitro IMA ADPCM
  out[0x19] = 1;
  out[0x1a] = STREAMED_BGM_CHANNELS;
  writeU16(out, 0x1c, STREAMED_BGM_SAMPLE_RATE);
  writeU16(out, 0x1e, Math.round(16_756_991 / (STREAMED_BGM_SAMPLE_RATE * 32)));
  writeU32(out, 0x20, start);
  writeU32(out, 0x24, end);
  writeU32(out, 0x28, STRM_HEADER_SIZE);
  writeU32(out, 0x2c, numBlocks);
  writeU32(out, 0x30, fullBlockSize);
  writeU32(out, 0x34, ADPCM_BLOCK_SAMPLES);
  writeU32(out, 0x38, lastBlockSize);
  writeU32(out, 0x3c, lastBlockSamples);
  out.set(new TextEncoder().encode("DATA"), 0x60);
  writeU32(out, 0x64, 8 + dataLength);

  const states: [AdpcmState, AdpcmState] = [{ sample: 0, index: 0 }, { sample: 0, index: 0 }];
  let cursor = STRM_HEADER_SIZE;
  for (let block = 0; block < numBlocks; block += 1) {
    const blockStart = block * ADPCM_BLOCK_SAMPLES;
    const blockSamples = block === numBlocks - 1 ? lastBlockSamples : ADPCM_BLOCK_SAMPLES;
    const blockSize = block === numBlocks - 1 ? lastBlockSize : fullBlockSize;
    writeAdpcmBlock(out, cursor, resampled.left, blockStart, blockSamples, states[0]);
    writeAdpcmBlock(out, cursor + blockSize, resampled.right, blockStart, blockSamples, states[1]);
    cursor += blockSize * STREAMED_BGM_CHANNELS;
  }
  return {
    bytes: out,
    encoding: "adpcm",
    sampleRate: STREAMED_BGM_SAMPLE_RATE,
    channels: STREAMED_BGM_CHANNELS,
    sampleCount: end,
    loopStartSample: start,
    loopEndSample: end,
  };
}

export function installStreamedBgmInSdat(sdatBytes: Uint8Array, targetSequenceId: number, strmBytes: Uint8Array): SdatStreamedBgmInstall {
  const parts = parseSdat(sdatBytes);
  const mapping = appendMapping(parts, targetSequenceId, strmBytes);
  return { bytes: rebuildSdat(parts), ...mapping };
}

function appendMapping(parts: SdatParts, targetSequenceId: number, strmBytes: Uint8Array): SdatStreamedBgmConfig {
  requireMagic(strmBytes, 0, "STRM");
  if (targetSequenceId >= 0xffff || parts.files.length + 1 >= 0xffff
    || readU32(parts.info, infoTableOffset(parts.info, 7)) >= 0xffff) {
    throw new Error("The sound archive has exhausted its native 16-bit sequence, stream, or file IDs.");
  }
  const targetRecord = infoRecordOffset(parts.info, 0, targetSequenceId);
  const originalSequenceFileId = readU16(parts.info, targetRecord);
  if (!parts.files[originalSequenceFileId]) throw new Error("The selected sequence has no original SDAT file.");
  const shadowFileId = parts.files.length;
  const streamFileId = shadowFileId + 1;
  const appended = appendStreamInfo(parts.info, streamFileId);
  writeU16(appended.info, infoRecordOffset(appended.info, 0, targetSequenceId), shadowFileId);
  parts.info = appended.info;
  parts.files.push(createSilentShadowSseq(), strmBytes);
  return {
    targetSequenceId,
    streamId: appended.streamId,
    streamFileId,
    shadowFileId,
    originalSequenceFileId,
  };
}

export function removeStreamedBgmFromSdat(sdatBytes: Uint8Array, config: SdatStreamedBgmConfig): Uint8Array {
  const parts = parseSdat(sdatBytes);
  removeMapping(parts, config);
  return rebuildSdat(parts);
}

function validateMapping(parts: SdatParts, config: SdatStreamedBgmConfig): void {
  const shadow = parts.files[config.shadowFileId];
  const expected = createSilentShadowSseq();
  if (!shadow || shadow.length !== expected.length || shadow.some((byte, index) => byte !== expected[index])) {
    throw new Error("The installed silent sequence has changed; refusing to remove unverified audio data.");
  }
  const strm = parts.files[config.streamFileId];
  if (!strm) throw new Error("The installed stream file is missing.");
  requireMagic(strm, 0, "STRM");
  if (strm.length < STRM_HEADER_SIZE || readU32(strm, 8) !== strm.length) throw new Error("The installed stream header is malformed.");
  if (readU16(parts.info, infoRecordOffset(parts.info, 0, config.targetSequenceId)) !== config.shadowFileId
    || readU16(parts.info, infoRecordOffset(parts.info, 7, config.streamId)) !== config.streamFileId) {
    throw new Error("The installed music references have changed; refusing to overwrite unrelated sound edits.");
  }
  if (config.originalSequenceFileId >= config.shadowFileId || !parts.files[config.originalSequenceFileId]) {
    throw new Error("The original sequence file cannot be safely restored.");
  }
}

function removeMapping(parts: SdatParts, config: SdatStreamedBgmConfig): void {
  if (config.streamFileId !== parts.files.length - 1 || config.shadowFileId !== parts.files.length - 2) {
    throw new Error("The installed streamed-BGM files are no longer the final SDAT files.");
  }
  validateMapping(parts, config);
  const targetRecord = infoRecordOffset(parts.info, 0, config.targetSequenceId);
  if (readU16(parts.info, targetRecord) !== config.shadowFileId) throw new Error("The mapped BGM sequence was changed after streamed music was installed.");
  writeU16(parts.info, targetRecord, config.originalSequenceFileId);
  parts.info = removeStreamInfo(parts.info, config.streamId, config.streamFileId);
  parts.files.splice(parts.files.length - 2, 2);
}

/** Rebuild the verified owned tail once, so removing a middle mapping can
 * renumber later owned IDs without touching unrelated files or INFO entries. */
export function rebuildStreamedBgmMappings(
  sdatBytes: Uint8Array,
  existing: readonly SdatStreamedBgmConfig[],
  replacements: readonly { targetSequenceId: number; bytes: Uint8Array }[],
): { bytes: Uint8Array; mappings: SdatStreamedBgmConfig[] } {
  const parts = parseSdat(sdatBytes);
  const targets = new Set<number>();
  for (const mapping of existing) {
    if (targets.has(mapping.targetSequenceId)) throw new Error("Duplicate installed BGM target.");
    targets.add(mapping.targetSequenceId);
    validateMapping(parts, mapping);
  }
  // Refuse to remove files newly referenced by unrelated entries, including
  // bank, wave-archive, and sequence-archive INFO records.
  const owned = new Set(existing.flatMap((mapping) => [mapping.shadowFileId, mapping.streamFileId]));
  for (const part of [0, 1, 2, 3, 7]) {
    const table = infoTableOffset(parts.info, part);
    const count = readU32(parts.info, table);
    for (let id = 0; id < count; id += 1) {
      const at = readU32(parts.info, table + 4 + id * 4);
      if (!at) continue;
      const fileId = readU16(parts.info, at);
      if (!owned.has(fileId)) continue;
      if (!existing.some((mapping) => part === 0 && id === mapping.targetSequenceId && fileId === mapping.shadowFileId
        || part === 7 && id === mapping.streamId && fileId === mapping.streamFileId)) {
        throw new Error("Unrelated sound entries now reference replacement-owned files; removal is unsafe.");
      }
    }
  }
  for (const mapping of [...existing].sort((a, b) => b.streamId - a.streamId)) removeMapping(parts, mapping);
  targets.clear();
  const mappings = replacements.map((replacement) => {
    if (targets.has(replacement.targetSequenceId)) throw new Error("Duplicate replacement BGM target.");
    targets.add(replacement.targetSequenceId);
    return appendMapping(parts, replacement.targetSequenceId, replacement.bytes);
  });
  return { bytes: rebuildSdat(parts), mappings };
}

export async function decodeAudioFile(file: File): Promise<StereoPcm> {
  const AudioContextCtor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("This browser does not support MP3/WAV decoding through Web Audio.");
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.length === 0 || decoded.numberOfChannels === 0) throw new Error("The imported audio is empty.");
    return downmixToStereo(Array.from({ length: decoded.numberOfChannels }, (_value, channel) => decoded.getChannelData(channel)), decoded.sampleRate);
  } catch (error) {
    throw new Error(`Could not decode ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function sdatSequenceFileId(sdatBytes: Uint8Array, sequenceId: number): number {
  const parts = parseSdat(sdatBytes);
  return readU16(parts.info, infoRecordOffset(parts.info, 0, sequenceId));
}

export function sdatStreamCount(sdatBytes: Uint8Array): number {
  const parts = parseSdat(sdatBytes);
  return readU32(parts.info, infoTableOffset(parts.info, 7));
}

export function sdatStreamFileId(sdatBytes: Uint8Array, streamId: number): number {
  const parts = parseSdat(sdatBytes);
  return readU16(parts.info, infoRecordOffset(parts.info, 7, streamId));
}

function runtimeFileName(version: "B2" | "W2"): string {
  return `BgmToggle${version}.dll`;
}

function runtimePath(version: "B2" | "W2"): string {
  return `patches/${runtimeFileName(version)}`;
}

function requireSupportedProject(project: ProjectState, rom: NintendoDSRom): "B2" | "W2" {
  const version = project.session.baseVersion;
  const expectedId = version === "B2" ? "IREO" : version === "W2" ? "IRDO" : undefined;
  if (project.session.baseRom !== "BW2" || !expectedId || rom.idCode !== expectedId || project.romInfo.idCode !== expectedId) {
    throw new Error("Streamed BGM replacement supports only unmodified-region US Black 2 (IREO) and White 2 (IRDO) projects.");
  }
  return version as "B2" | "W2";
}

function findRuntimeBytes(project: ProjectState, rom: NintendoDSRom, version: "B2" | "W2"): Uint8Array | undefined {
  const path = runtimePath(version);
  const addition = Object.entries(project.fileSystem?.additions ?? {}).find(([candidate]) => candidate.toLowerCase() === path.toLowerCase())?.[1];
  if (addition) return addition;
  const fileId = rom.filenames.idOf(path);
  return fileId === undefined ? undefined : getRomFileBytes(project, rom, fileId);
}

function runtimeArchiveConfig(config: SdatStreamedBgmConfig): SdatStreamedBgmConfig {
  return {
    targetSequenceId: config.targetSequenceId,
    streamId: config.streamId,
    streamFileId: config.streamFileId,
    shadowFileId: config.shadowFileId,
    originalSequenceFileId: config.originalSequenceFileId,
  };
}

async function projectRom(project: ProjectState): Promise<{ bytes: Uint8Array; rom: NintendoDSRom; version: "B2" | "W2" }> {
  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) throw new Error("Reload the ROM before editing streamed background music.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  return { bytes, rom, version: requireSupportedProject(project, rom) };
}

function assertRomCapacity(project: ProjectState, rom: NintendoDSRom, oldSdatSize: number, newSdatSize: number, runtimeSize: number): void {
  const existing = rom.files.reduce((total, _file, fileId) => total + align(getRomFileBytes(project, rom, fileId).length, 0x200), 0)
    + Object.values(project.fileSystem?.additions ?? {}).reduce((total, file) => total + align(file.length, 0x200), 0);
  // Include the exporter rounding the NTR/TWL boundary up to 512 KiB.
  const fixed = rom.arm9.length + rom.arm7.length + rom.arm9OverlayTable.length + rom.arm7OverlayTable.length + rom.fntData.length + rom.banner.length + 0xa0_000;
  const pmcReserve = getPmcInstallStatus(project).installed ? 0 : 0x20_000;
  const projected = existing + fixed + pmcReserve - align(oldSdatSize, 0x200) + align(newSdatSize, 0x200) + align(runtimeSize, 0x200);
  if (projected > 0x2000_0000) throw new Error("The replacements would exceed this exporter's current 512 MiB safety limit.");
}

const musicEdits = new WeakSet<ProjectState>();

async function musicTransaction<T>(project: ProjectState, operation: (draft: ProjectState) => Promise<T>): Promise<T> {
  if (musicEdits.has(project)) throw new Error("Another music edit is still running. Wait for it to finish.");
  musicEdits.add(project);
  // Stage metadata/maps and any PMC ARM9/overlay edits privately. Large ROM
  // and SDAT byte arrays remain shared read-only until their replacements exist.
  const installingPmc = !getPmcInstallStatus(project).installed;
  const draft: ProjectState = {
    ...project,
    arm9: installingPmc ? project.arm9.slice() : project.arm9,
    overlays: installingPmc ? Object.fromEntries(Object.entries(project.overlays).map(([id, bytes]) => [id, bytes?.slice()])) : project.overlays,
    fileSystem: { replacements: { ...project.fileSystem?.replacements }, additions: { ...project.fileSystem?.additions } },
    codeInjection: structuredClone(project.codeInjection),
    actionChangelog: structuredClone(project.actionChangelog),
  };
  try {
    const result = await operation(draft);
    project.arm9 = draft.arm9;
    project.arm9Dirty = draft.arm9Dirty;
    project.overlays = draft.overlays;
    project.fileSystem = draft.fileSystem;
    project.codeInjection = draft.codeInjection;
    project.actionChangelog = draft.actionChangelog;
    invalidateNitroSdatCache(project);
    return result;
  } finally { musicEdits.delete(project); }
}

function commitMusicState(project: ProjectState, configs: StreamedBgmConfig[]): void {
  project.codeInjection ??= {};
  delete project.codeInjection.streamedBgm;
  if (configs.length) project.codeInjection.streamedBgms = configs;
  else delete project.codeInjection.streamedBgms;
}

/** Detect both legacy ABI 1 ROMs and variable-length ABI 2 tables without
 * changing project state before the caller's transaction has succeeded. */
async function readInstalledMusic(project: ProjectState, rom: NintendoDSRom, version: "B2" | "W2", sdatBytes: Uint8Array): Promise<{ configs: StreamedBgmConfig[]; shortcutEnabled: boolean }> {
  const runtime = findRuntimeBytes(project, rom, version);
  const runtimeConfig = runtime ? readBgmRuntimeConfig(runtime) : undefined;
  if (runtime && !runtimeConfig) throw new Error("The installed music runtime configuration is corrupt or unsupported.");
  const saved = getStreamedBgmConfigs(project);
  const mappings = runtimeConfig?.mappings ?? saved;
  if (runtimeConfig && saved.length && (saved.length !== mappings.length || saved.some((entry) => {
    const actual = mappings.find((mapping) => mapping.targetSequenceId === entry.targetSequenceId);
    return !actual || JSON.stringify(runtimeArchiveConfig(entry)) !== JSON.stringify(runtimeArchiveConfig(actual));
  }))) throw new Error("The project's music metadata disagrees with its runtime; reload the exported ROM before editing.");
  const parts = parseSdat(sdatBytes);
  const shortcutEnabled = runtimeConfig?.shortcutEnabled ?? saved[0]?.toggleEnabled ?? false;
  const configs: StreamedBgmConfig[] = [];
  for (const mapping of [...mappings].sort((a, b) => a.streamId - b.streamId)) {
    validateMapping(parts, mapping);
    const strm = parts.files[mapping.streamFileId]!;
    const previous = saved.find((entry) => entry.targetSequenceId === mapping.targetSequenceId);
    const audioSha256 = await sha256Hex(strm);
    if (previous && previous.audioSha256 !== audioSha256) throw new Error(`Installed audio for sequence ${mapping.targetSequenceId} has changed outside the Music editor.`);
    configs.push({
      ...runtimeArchiveConfig(mapping),
      runtimeVersion: previous?.runtimeVersion ?? (runtimeConfig?.abiVersion === 2 ? 3 : 2),
      targetSequenceSymbol: previous?.targetSequenceSymbol,
      sourceName: previous?.sourceName ?? "Imported ROM stream",
      encoding: strm[0x18] === 2 ? "adpcm" : "pcm16",
      sampleRate: STREAMED_BGM_SAMPLE_RATE,
      channels: STREAMED_BGM_CHANNELS,
      sampleCount: readU32(strm, 0x24),
      loopStartSample: readU32(strm, 0x20),
      loopEndSample: readU32(strm, 0x24),
      encodedBytes: strm.length,
      audioSha256,
      toggleEnabled: shortcutEnabled,
    });
  }
  return { configs, shortcutEnabled };
}

export async function installStreamedBgm(project: ProjectState, input: StreamedBgmInstallInput): Promise<StreamedBgmConfig> {
  return musicTransaction(project, (draft) => installStreamedBgmTransaction(draft, input));
}

async function installStreamedBgmTransaction(project: ProjectState, input: StreamedBgmInstallInput): Promise<StreamedBgmConfig> {
  const { bytes: romBytes, rom, version } = await projectRom(project);
  assertBundledBgmRuntimeCompatibility(project, romBytes);
  const sdat = await loadNitroSdatFromProject(project);
  if (sdat.sourceFileId === undefined) throw new Error("The active SDAT has no NitroFS file ID.");
  const targetSequence = sdat.sequenceInfos[input.targetSequenceId];
  if (!targetSequence) throw new Error(`BGM sequence ${input.targetSequenceId} does not exist.`);
  const targetSymbol = targetSequence.symbol ?? sdat.sequenceSymbols[input.targetSequenceId];
  if (!targetSymbol?.startsWith("SEQ_BGM_")) {
    throw new Error(`Sequence ${input.targetSequenceId}${targetSymbol ? ` (${targetSymbol})` : ""} is not a background-music sequence.`);
  }
  const startSeconds = input.loopStartSeconds ?? 0;
  const endSeconds = input.loopEndSeconds ?? input.pcm.left.length / input.pcm.sampleRate;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error("Loop start and end must describe a non-empty range inside the imported audio.");
  }
  const currentRuntime = findRuntimeBytes(project, rom, version);
  const { configs: current } = await readInstalledMusic(project, rom, version, sdat.bytes);
  const updating = current.find((mapping) => mapping.targetSequenceId === input.targetSequenceId);
  const loopStartSample = Math.round(startSeconds * input.pcm.sampleRate);
  const loopEndSample = Math.round(endSeconds * input.pcm.sampleRate);
  const resampledEndSample = Math.round(loopEndSample * STREAMED_BGM_SAMPLE_RATE / input.pcm.sampleRate);
  const encoding = input.encoding
    ?? chooseStreamedBgmEncoding(sdat.bytes.length - (updating?.encodedBytes ?? 0), resampledEndSample);
  const encoded = encoding === "pcm16"
    ? encodePcm16Strm(input.pcm, loopStartSample, loopEndSample)
    : encodeAdpcmStrm(input.pcm, loopStartSample, loopEndSample);
  const replacements = current.map((mapping) => ({
    targetSequenceId: mapping.targetSequenceId,
    bytes: mapping.targetSequenceId === input.targetSequenceId ? encoded.bytes : sdat.files[mapping.streamFileId]!.data,
  }));
  if (!updating) replacements.push({ targetSequenceId: input.targetSequenceId, bytes: encoded.bytes });
  const archive = rebuildStreamedBgmMappings(sdat.bytes, current, replacements);
  const mapping = archive.mappings.find((entry) => entry.targetSequenceId === input.targetSequenceId)!;
  const runtime = await configureBundledBgmRuntime(version, { shortcutEnabled: input.shortcutEnabled, mappings: archive.mappings });
  assertRomCapacity(project, rom, sdat.bytes.length, archive.bytes.length, runtime.length - (currentRuntime?.length ?? 0));
  const audioHash = await sha256Hex(encoded.bytes);
  const state: StreamedBgmConfig = {
    runtimeVersion: STREAMED_BGM_RUNTIME_VERSION,
    ...mapping,
    targetSequenceSymbol: targetSymbol,
    sourceName: input.sourceName,
    encoding: encoded.encoding,
    sampleRate: STREAMED_BGM_SAMPLE_RATE,
    channels: STREAMED_BGM_CHANNELS,
    sampleCount: encoded.sampleCount,
    loopStartSample: encoded.loopStartSample,
    loopEndSample: encoded.loopEndSample,
    encodedBytes: encoded.bytes.length,
    audioSha256: audioHash,
    toggleEnabled: input.shortcutEnabled,
  };
  const states = archive.mappings.map((entry) => ({
    ...(entry.targetSequenceId === input.targetSequenceId ? state : current.find((old) => old.targetSequenceId === entry.targetSequenceId)!),
    ...entry, runtimeVersion: STREAMED_BGM_RUNTIME_VERSION, toggleEnabled: input.shortcutEnabled,
  }));

  // Validation, conversion, archive construction, runtime configuration, and
  // hashing all complete before any project edit is committed.
  if (!getPmcInstallStatus(project).installed) await installBundledPmc(project);
  stageCodeInjectionDll(project, runtimeFileName(version), runtime, "patches", romBytes);
  replaceRomFile(project, rom, sdat.sourceFileId, archive.bytes);
  commitMusicState(project, states);
  invalidateNitroSdatCache(project);
  recordGenericChange(project, "code_injection", `Sequence ${mapping.targetSequenceId} redirected to streamed audio from ${input.sourceName}; ${states.length} replacement(s) installed.`, "Streamed BGM Replacement", {
    key: `code-injection:streamed-bgm:${mapping.targetSequenceId}`,
  });
  return state;
}

/** Omit the target to remove all replacements; the shortcut is preserved. */
export async function removeStreamedBgm(project: ProjectState, targetSequenceId?: number): Promise<void> {
  return musicTransaction(project, (draft) => removeStreamedBgmTransaction(draft, targetSequenceId));
}

async function removeStreamedBgmTransaction(project: ProjectState, targetSequenceId?: number): Promise<void> {
  const { bytes: romBytes, rom, version } = await projectRom(project);
  assertBundledBgmRuntimeCompatibility(project, romBytes);
  const sdat = await loadNitroSdatFromProject(project);
  if (sdat.sourceFileId === undefined) throw new Error("The active SDAT has no NitroFS file ID.");
  const { configs, shortcutEnabled } = await readInstalledMusic(project, rom, version, sdat.bytes);
  if (!configs.length || (targetSequenceId !== undefined && !configs.some((mapping) => mapping.targetSequenceId === targetSequenceId))) {
    throw new Error("No configured streamed-BGM replacement was found for that target.");
  }
  const retained = targetSequenceId === undefined ? [] : configs.filter((mapping) => mapping.targetSequenceId !== targetSequenceId);
  const archive = rebuildStreamedBgmMappings(sdat.bytes, configs, retained.map((mapping) => ({
    targetSequenceId: mapping.targetSequenceId, bytes: sdat.files[mapping.streamFileId]!.data,
  })));
  let disabledRuntime: Uint8Array | undefined;
  if (retained.length || shortcutEnabled || rom.filenames.idOf(runtimePath(version)) !== undefined) {
    disabledRuntime = await configureBundledBgmRuntime(version, {
      shortcutEnabled,
      mappings: archive.mappings,
    });
  }

  if (disabledRuntime) stageCodeInjectionDll(project, runtimeFileName(version), disabledRuntime, "patches", romBytes);
  else {
    const path = runtimePath(version);
    const staged = Object.keys(project.fileSystem?.additions ?? {}).find((candidate) => candidate.toLowerCase() === path.toLowerCase());
    if (staged) removeStagedCodeInjectionDll(project, staged);
  }
  replaceRomFile(project, rom, sdat.sourceFileId, archive.bytes);
  commitMusicState(project, archive.mappings.map((mapping) => ({
    ...retained.find((entry) => entry.targetSequenceId === mapping.targetSequenceId)!, ...mapping,
    runtimeVersion: STREAMED_BGM_RUNTIME_VERSION,
  })));
  invalidateNitroSdatCache(project);
  recordGenericChange(project, "code_injection", `${targetSequenceId === undefined ? "All replaced sequences" : `Sequence ${targetSequenceId}`} restored to original SDAT files; ${retained.length} replacement(s) remain.`, "Streamed BGM Replacement", {
    key: "code-injection:streamed-bgm",
  });
}

/** Refresh only the DLL, retaining imported audio, its loop, and the shortcut setting. */
export async function updateStreamedBgmRuntime(project: ProjectState): Promise<void> {
  return musicTransaction(project, async (draft) => {
    const { bytes, rom, version } = await projectRom(draft);
    assertBundledBgmRuntimeCompatibility(draft, bytes);
    const sdat = await loadNitroSdatFromProject(draft);
    const { configs, shortcutEnabled } = await readInstalledMusic(draft, rom, version, sdat.bytes);
    if (!configs.length) throw new Error("Install a music replacement before updating its runtime.");
    const runtime = await configureBundledBgmRuntime(version, { shortcutEnabled, mappings: configs });
    stageCodeInjectionDll(draft, runtimeFileName(version), runtime, "patches", bytes);
    commitMusicState(draft, configs.map((entry) => ({ ...entry, runtimeVersion: STREAMED_BGM_RUNTIME_VERSION })));
    recordGenericChange(draft, "code_injection", "Updated the streamed-music runtime without changing any audio or loops.", "Music Runtime Update", {
      key: "code-injection:streamed-bgm-runtime",
    });
  });
}

export async function detectStreamedBgmStatus(project: ProjectState): Promise<StreamedBgmStatus> {
  if (project.session.baseRom !== "BW2" || (project.session.baseVersion !== "B2" && project.session.baseVersion !== "W2")) {
    return { installed: false, supported: false, message: "Streamed BGM replacement supports US Black 2 and White 2." };
  }
  const { rom, version } = await projectRom(project);
  const sdat = await loadNitroSdatFromProject(project);
  const { configs } = await readInstalledMusic(project, rom, version, sdat.bytes);
  if (!configs.length) return { installed: false, supported: true, message: "No streamed-BGM replacement is installed." };
  for (const config of configs) config.targetSequenceSymbol = sdat.sequenceSymbols[config.targetSequenceId] ?? config.targetSequenceSymbol;
  commitMusicState(project, configs);
  return { installed: true, supported: true, configs, message: `${configs.length} sequence(s) mapped to native SDAT streams.` };
}
