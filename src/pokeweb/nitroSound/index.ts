import { Audio as NitroFsAudio, BufferReader } from "nitro-fs";
import { readAscii, readU16, readU32 } from "../../nds/binary";
import type { Folder } from "../../nds/fnt";
import { NintendoDSRom } from "../../nds/rom";
import { decompileMoveAnimationFile, parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "../moveAnimationModel";
import { loadActiveRomBytes } from "../persistence";
import type { ProjectState } from "../projectStore";

/*
 * Nitro SDAT parsing and sequence preview playback.
 *
 * This module is a TypeScript port/reimplementation of the SDAT pieces needed
 * by Pokeweb's move animation audio preview. It was written with reference to
 * VGMusicStudio's NDS SDAT engine by Kermalis, licensed under LGPLv3:
 * https://github.com/Kermalis/VGMusicStudio
 */

const DEFAULT_MAX_SECONDS = 12;
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_CALL_DEPTH = 8;
const TICKS_PER_BEAT = 48;
const MAX_SSEQ_COMMANDS_PER_TRACK = 80_000;
const MISSING_SWAR = 0xffff;
const NITRO_ARM7_CLOCK = 33_513_982;

export type NitroSdat = {
  sourcePath?: string;
  sourceFileId?: number;
  bytes: Uint8Array;
  nitroFsSdat?: InstanceType<typeof NitroFsAudio.SDAT>;
  sequenceInfos: NitroSequenceInfo[];
  bankInfos: NitroBankInfo[];
  waveArchiveInfos: NitroWaveArchiveInfo[];
  files: NitroFatEntry[];
  sequenceSymbols: string[];
  bankSymbols: string[];
  waveArchiveSymbols: string[];
};

export type NitroSequenceInfo = {
  id: number;
  fileId: number;
  bankId: number;
  volume: number;
  channelPriority: number;
  playerPriority: number;
  playerNum: number;
  symbol?: string;
};

export type NitroBankInfo = {
  id: number;
  fileId: number;
  swarIds: number[];
  symbol?: string;
};

export type NitroWaveArchiveInfo = {
  id: number;
  fileId: number;
  symbol?: string;
};

export type NitroFatEntry = {
  id: number;
  dataOffset: number;
  dataLength: number;
  data: Uint8Array;
};

export type NitroAudioRenderOptions = {
  maxSeconds?: number;
  sampleRate?: number;
};

export type NitroRenderedPcm = {
  sampleRate: number;
  length: number;
  duration: number;
  numberOfChannels: 2;
  left: Float32Array;
  right: Float32Array;
  capped: boolean;
};

export type MoveSoundEvent = {
  id: string;
  frame: number;
  label: string;
  command: "PlaySound";
  soundId: number;
  sequenceId: number;
  params: number[];
  line: string;
  sourceMoveId: number;
};

type NitroSseq = {
  data: Uint8Array;
};

type NitroSbnk = {
  instruments: NitroInstrument[];
  swars: Array<NitroSwar | undefined>;
};

type NitroInstrument = {
  type: NitroInstrumentType;
  defaultParam?: NitroInstrumentParam;
  drum?: {
    minNote: number;
    maxNote: number;
    subInstruments: NitroInstrumentData[];
  };
  keySplit?: {
    keyRegions: number[];
    subInstruments: NitroInstrumentData[];
  };
};

type NitroInstrumentData = {
  type: NitroInstrumentType;
  param: NitroInstrumentParam;
};

type NitroInstrumentParam = {
  info: [number, number];
  baseKey: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pan: number;
};

type NitroInstrumentType = "pcm" | "psg" | "noise" | "drum" | "keySplit" | "empty";

type NitroSwar = {
  waves: NitroSwav[];
};

type NitroSwav = {
  format: 0 | 1 | 2;
  doesLoop: boolean;
  sampleRate: number;
  timer: number;
  loopOffset: number;
  length: number;
  samples: Uint8Array;
  decoded?: {
    pcm: Float32Array;
    loopStart: number;
  };
};

type SequenceBundle = {
  sequenceInfo: NitroSequenceInfo;
  sseq: NitroSseq;
  bank: NitroSbnk;
};

type ScheduledNote = {
  startSeconds: number;
  durationSeconds: number;
  key: number;
  velocity: number;
  voice: number;
  volume: number;
  expression: number;
  trackPan: number;
  transpose: number;
  pitchBend: number;
  pitchBendRange: number;
  sequenceVolume: number;
  trackIndex: number;
};

type SseqTrackState = {
  index: number;
  offset: number;
  timeSeconds: number;
  tempo: number;
  voice: number;
  volume: number;
  expression: number;
  panpot: number;
  transpose: number;
  pitchBend: number;
  pitchBendRange: number;
  mono: boolean;
  stopped: boolean;
  callStack: number[];
  loopStack: Array<{ offset: number; remaining: number }>;
  argOverride: "none" | "rand" | "var";
  variableFlag: boolean;
  doCommandWork: boolean;
};

type RenderCacheKey = `${number}:${number}:${number}`;

const projectSdatCache = new WeakMap<ProjectState, Promise<NitroSdat>>();
const renderCache = new WeakMap<NitroSdat, Map<RenderCacheKey, Promise<NitroRenderedPcm>>>();

export async function loadNitroSdatFromProject(project: ProjectState): Promise<NitroSdat> {
  let cached = projectSdatCache.get(project);
  if (!cached) {
    cached = loadNitroSdatFromProjectUncached(project);
    projectSdatCache.set(project, cached);
  }
  return cached;
}

export function invalidateNitroSdatCache(project: ProjectState): void {
  projectSdatCache.delete(project);
}

async function loadNitroSdatFromProjectUncached(project: ProjectState): Promise<NitroSdat> {
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Original ROM bytes are not available; reload the ROM before previewing SDAT audio.");
  const rom = new NintendoDSRom(romBytes);
  const namedSdat = listNamedRomFiles(rom.filenames)
    .filter((file) => file.path.toLowerCase().endsWith(".sdat"))
    .sort((a, b) => scoreSdatPath(a.path) - scoreSdatPath(b.path) || a.path.localeCompare(b.path))[0];
  if (namedSdat) {
    const bytes = project.fileSystem?.replacements?.[namedSdat.id] ?? rom.files[namedSdat.id];
    if (!bytes) throw new Error(`Named SDAT file ${namedSdat.path} is missing from the ROM file table.`);
    const sdat = parseNitroSdat(bytes, namedSdat.path);
    sdat.sourceFileId = namedSdat.id;
    return sdat;
  }

  const scanned = rom.files.findIndex((file, fileId) => readAscii(project.fileSystem?.replacements?.[fileId] ?? file, 0, 4) === "SDAT");
  if (scanned >= 0) {
    const sdat = parseNitroSdat(project.fileSystem?.replacements?.[scanned] ?? rom.files[scanned], `file ${scanned}`);
    sdat.sourceFileId = scanned;
    return sdat;
  }
  throw new Error("Could not find an SDAT file in the loaded ROM.");
}

export function parseNitroSdat(bytes: Uint8Array, sourcePath?: string): NitroSdat {
  requireMagic(bytes, 0, "SDAT");
  const symbOffset = readU32(bytes, 0x10);
  const symbLength = readU32(bytes, 0x14);
  const infoOffset = readU32(bytes, 0x18);
  const fatOffset = readU32(bytes, 0x20);
  const sequenceSymbols: string[] = [];
  const bankSymbols: string[] = [];
  const waveArchiveSymbols: string[] = [];
  if (symbOffset && symbLength) {
    const symbols = parseSdatSymb(bytes, symbOffset);
    sequenceSymbols.push(...symbols.sequenceSymbols);
    bankSymbols.push(...symbols.bankSymbols);
    waveArchiveSymbols.push(...symbols.waveArchiveSymbols);
  }
  const info = parseSdatInfo(bytes, infoOffset, { sequenceSymbols, bankSymbols, waveArchiveSymbols });
  const files = parseSdatFat(bytes, fatOffset);
  return {
    sourcePath,
    bytes,
    sequenceInfos: info.sequenceInfos,
    bankInfos: info.bankInfos,
    waveArchiveInfos: info.waveArchiveInfos,
    files,
    sequenceSymbols,
    bankSymbols,
    waveArchiveSymbols,
  };
}

export function extractMoveSoundEvents(project: ProjectState, moveId: number, scriptText: string): MoveSoundEvent[] {
  const parsed = parseMoveAnimationScript(scriptText);
  const rootLabel = parsed.headerLabels[0] ?? parsed.labelOrder[0];
  if (!rootLabel) return [];
  const events: MoveSoundEvent[] = [];
  expandSoundScript(project, moveId, rootLabel, parsed.scripts.get(rootLabel) ?? [], 0, 0, DEFAULT_CALL_DEPTH, new Set(), events);
  return events;
}

export async function renderNitroSequencePreview(sdat: NitroSdat, sequenceId: number, options: NitroAudioRenderOptions = {}): Promise<AudioBuffer> {
  const pcm = await renderNitroSequencePcm(sdat, sequenceId, options);
  return pcmToAudioBuffer(pcm);
}

export function renderNitroSequencePcm(sdat: NitroSdat, sequenceId: number, options: NitroAudioRenderOptions = {}): Promise<NitroRenderedPcm> {
  const maxSeconds = Math.max(0.1, Math.min(60, options.maxSeconds ?? DEFAULT_MAX_SECONDS));
  const sampleRate = Math.max(8_000, Math.min(96_000, options.sampleRate ?? DEFAULT_SAMPLE_RATE));
  const key: RenderCacheKey = `${sequenceId}:${sampleRate}:${maxSeconds}`;
  let cache = renderCache.get(sdat);
  if (!cache) {
    cache = new Map();
    renderCache.set(sdat, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = Promise.resolve().then(() => renderNitroSequencePcmUncached(sdat, sequenceId, { maxSeconds, sampleRate }));
  cache.set(key, promise);
  return promise;
}

export type NitroWaveArchiveMetadata = {
  waveCount: number;
  format: "PCM8" | "PCM16" | "IMA-ADPCM";
  sampleRate: number;
  sampleCount: number;
  duration: number;
  loops: boolean;
};

export function getNitroWaveArchiveMetadata(bytes: Uint8Array, waveIndex = 0): NitroWaveArchiveMetadata {
  const archive = parseNitroSwar(bytes);
  const wave = archive.waves[waveIndex];
  if (!wave) throw new Error(`SWAR wave ${waveIndex} is missing.`);
  const decoded = decodeSwav(wave);
  return {
    waveCount: archive.waves.length,
    format: wave.format === 0 ? "PCM8" : wave.format === 1 ? "PCM16" : "IMA-ADPCM",
    sampleRate: wave.sampleRate,
    sampleCount: decoded.pcm.length,
    duration: decoded.pcm.length / wave.sampleRate,
    loops: wave.doesLoop,
  };
}

export function renderNitroWaveArchivePcm(bytes: Uint8Array, waveIndex = 0): NitroRenderedPcm {
  const archive = parseNitroSwar(bytes);
  const wave = archive.waves[waveIndex];
  if (!wave) throw new Error(`SWAR wave ${waveIndex} is missing.`);
  const decoded = decodeSwav(wave);
  const left = decoded.pcm.slice();
  const right = decoded.pcm.slice();
  normalizePcm(left, right);
  return {
    sampleRate: wave.sampleRate,
    length: left.length,
    duration: left.length / wave.sampleRate,
    numberOfChannels: 2,
    left,
    right,
    capped: false,
  };
}

export function decodeNitroAdpcm(data: Uint8Array): Int16Array {
  if (data.length < 4) return new Int16Array();
  const out = new Int16Array(Math.max(0, (data.length - 4) * 2));
  let lastSample = readI16(data, 0);
  let stepIndex = clamp(readU16(data, 2) & 0x7f, 0, 88);
  let dataOffset = 4;
  let secondNibble = false;
  for (let i = 0; i < out.length; i += 1) {
    const value = ((data[dataOffset] ?? 0) >> (secondNibble ? 4 : 0)) & 0x0f;
    const step = ADPCM_STEP_TABLE[stepIndex] ?? 7;
    const diff = Math.floor(step / 8) + Math.floor(step / 4) * (value & 1) + Math.floor(step / 2) * ((value >> 1) & 1) + step * ((value >> 2) & 1);
    lastSample = clamp(lastSample + (((value >> 3) & 1) ? -diff : diff), -0x8000, 0x7fff);
    stepIndex = clamp(stepIndex + (ADPCM_INDEX_TABLE[value & 7] ?? 0), 0, 88);
    out[i] = lastSample;
    if (secondNibble) dataOffset += 1;
    secondNibble = !secondNibble;
  }
  return out;
}

export function convertNitroPcm8(data: Uint8Array): Float32Array {
  const pcm = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) pcm[index] = readSignedByte(data[index] ?? 0) / 128;
  return pcm;
}

export function convertNitroPcm16(data: Uint8Array): Float32Array {
  const pcm = new Float32Array(Math.floor(data.length / 2));
  for (let index = 0; index < pcm.length; index += 1) pcm[index] = readI16(data, index * 2) / 32768;
  return pcm;
}

function expandSoundScript(
  project: ProjectState,
  moveId: number,
  label: string,
  commands: ParsedMoveAnimationCommand[],
  startFrame: number,
  depth: number,
  maxDepth: number,
  activeCalls: Set<string>,
  events: MoveSoundEvent[],
): number {
  let frame = startFrame;
  for (const command of commands) {
    if (command.name === "Wait") {
      frame += Math.max(0, command.params[0] ?? 0);
      continue;
    }
    if (command.name === "PlaySound") {
      const soundId = command.params[0] ?? 0;
      events.push({
        id: `${moveId}:${label}:${frame}:${events.length}:${soundId}`,
        frame,
        label,
        command: "PlaySound",
        soundId,
        sequenceId: soundId,
        params: command.params.slice(),
        line: command.line,
        sourceMoveId: moveId,
      });
      if (command.ends) break;
      continue;
    }
    if (command.name === "CallMoveAnimation") {
      const calledMoveId = command.params[0] ?? 0;
      const callKey = String(calledMoveId);
      if (depth < maxDepth && !activeCalls.has(callKey)) {
        try {
          const called = parseMoveAnimationScript(decompileMoveAnimationFile(project, calledMoveId));
          const calledLabel = called.headerLabels[0] ?? called.labelOrder[0];
          if (calledLabel) {
            activeCalls.add(callKey);
            frame = expandSoundScript(
              project,
              calledMoveId,
              calledLabel,
              called.scripts.get(calledLabel) ?? [],
              frame,
              depth + 1,
              maxDepth,
              activeCalls,
              events,
            );
            activeCalls.delete(callKey);
          }
        } catch {
          // The audio list mirrors preview behavior by keeping the current
          // script usable even when a called animation is absent.
        }
      }
      break;
    }
    if (command.ends) break;
  }
  return frame;
}

function renderNitroSequencePcmUncached(sdat: NitroSdat, sequenceId: number, options: Required<NitroAudioRenderOptions>): NitroRenderedPcm {
  return renderNitroSequencePcmWithNitroFs(sdat, sequenceId, options);
}

function renderNitroSequencePcmWithNitroFs(sdat: NitroSdat, sequenceId: number, options: Required<NitroAudioRenderOptions>): NitroRenderedPcm {
  if (!sdat.sequenceInfos[sequenceId]) throw new Error(`SDAT sequence ${sequenceId} is missing.`);
  const nitroFsSdat = getNitroFsSdat(sdat);
  const maxSamples = Math.max(1, Math.ceil(options.maxSeconds * options.sampleRate));
  const chunks: Array<[Float32Array, Float32Array]> = [];
  let emittedSamples = 0;
  const bufferLength = 2048;
  const renderer = new NitroFsAudio.SequenceRenderer({
    file: NitroFsAudio.SequenceRenderer.makeInfoSSEQ(nitroFsSdat, sequenceId),
    sampleRate: options.sampleRate,
    bufferLength,
    activeTracks: 0xffff,
    seed: 1,
    sink(buffer) {
      chunks.push([buffer[0].slice(), buffer[1].slice()]);
      emittedSamples += buffer[0].length;
    },
  });

  let hitCap = false;
  const maxTicks = Math.ceil(maxSamples / Math.max(1, renderer.samplesPerTick)) + 4096;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (emittedSamples + renderer.synth.pos >= maxSamples) {
      hitCap = true;
      break;
    }
    renderer.tick();
    if (!nitroFsRendererHasActiveTracks(renderer) && !nitroFsRendererHasPlayingNotes(renderer)) break;
  }
  if (emittedSamples + renderer.synth.pos >= maxSamples) hitCap = true;

  const partialLength = Math.min(renderer.synth.pos, Math.max(0, maxSamples - emittedSamples));
  const totalLength = Math.max(1, Math.min(maxSamples, emittedSamples + partialLength));
  const left = new Float32Array(totalLength);
  const right = new Float32Array(totalLength);
  let cursor = 0;
  for (const chunk of chunks) {
    if (cursor >= totalLength) break;
    const length = Math.min(chunk[0].length, totalLength - cursor);
    left.set(chunk[0].subarray(0, length), cursor);
    right.set(chunk[1].subarray(0, length), cursor);
    cursor += length;
  }
  if (cursor < totalLength && partialLength > 0) {
    const length = Math.min(partialLength, totalLength - cursor);
    left.set(renderer.synth.buffer[0].subarray(0, length), cursor);
    right.set(renderer.synth.buffer[1].subarray(0, length), cursor);
  }

  if (hitCap) applyFade(left, right, Math.max(0, totalLength - Math.floor(options.sampleRate * 0.08)), totalLength);
  normalizePcm(left, right);
  return {
    sampleRate: options.sampleRate,
    length: totalLength,
    duration: totalLength / options.sampleRate,
    numberOfChannels: 2,
    left,
    right,
    capped: hitCap,
  };
}

function getNitroFsSdat(sdat: NitroSdat): InstanceType<typeof NitroFsAudio.SDAT> {
  if (sdat.nitroFsSdat) return sdat.nitroFsSdat;
  try {
    sdat.nitroFsSdat = new NitroFsAudio.SDAT(BufferReader.new(arrayBufferFromBytes(sdat.bytes)));
    return sdat.nitroFsSdat;
  } catch (error) {
    throw new Error(`nitro-fs could not parse SDAT${sdat.sourcePath ? ` ${sdat.sourcePath}` : ""}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nitroFsRendererHasActiveTracks(renderer: InstanceType<typeof NitroFsAudio.SequenceRenderer>): boolean {
  return (renderer.tracks as unknown[]).some(Boolean);
}

function nitroFsRendererHasPlayingNotes(renderer: InstanceType<typeof NitroFsAudio.SequenceRenderer>): boolean {
  return renderer.synth.channels.some((channel) => (channel.playing as unknown[]).some(Boolean));
}

function loadSequenceBundle(sdat: NitroSdat, sequenceId: number): SequenceBundle {
  const sequenceInfo = sdat.sequenceInfos[sequenceId];
  if (!sequenceInfo) throw new Error(`SDAT sequence ${sequenceId} is missing.`);
  const sseqEntry = sdat.files[sequenceInfo.fileId];
  if (!sseqEntry) throw new Error(`SDAT sequence ${sequenceId} references missing file ${sequenceInfo.fileId}.`);
  const bankInfo = sdat.bankInfos[sequenceInfo.bankId];
  if (!bankInfo) throw new Error(`SDAT sequence ${sequenceId} references missing bank ${sequenceInfo.bankId}.`);
  const bankEntry = sdat.files[bankInfo.fileId];
  if (!bankEntry) throw new Error(`SDAT bank ${sequenceInfo.bankId} references missing file ${bankInfo.fileId}.`);
  const sseq = parseNitroSseq(sseqEntry.data);
  const bank = parseNitroSbnk(bankEntry.data);
  bank.swars = bankInfo.swarIds.map((swarId) => {
    if (swarId === MISSING_SWAR) return undefined;
    const waveInfo = sdat.waveArchiveInfos[swarId];
    if (!waveInfo) return undefined;
    const waveEntry = sdat.files[waveInfo.fileId];
    return waveEntry ? parseNitroSwar(waveEntry.data) : undefined;
  });
  return { sequenceInfo, sseq, bank };
}

function parseNitroSseq(bytes: Uint8Array): NitroSseq {
  requireMagic(bytes, 0, "SSEQ");
  requireMagic(bytes, 0x10, "DATA");
  const dataOffset = readU32(bytes, 0x18);
  if (dataOffset <= 0 || dataOffset > bytes.length) throw new Error("SSEQ DATA offset is out of range.");
  return { data: bytes.slice(dataOffset) };
}

function parseNitroSbnk(bytes: Uint8Array): NitroSbnk {
  requireMagic(bytes, 0, "SBNK");
  requireMagic(bytes, 0x10, "DATA");
  const instrumentCount = readU32(bytes, 0x38);
  const instruments: NitroInstrument[] = [];
  for (let index = 0; index < instrumentCount; index += 1) {
    const entryOffset = 0x3c + index * 4;
    const type = instrumentTypeFromByte(bytes[entryOffset] ?? 0);
    const dataOffset = readU16(bytes, entryOffset + 1);
    instruments.push(parseNitroInstrument(bytes, type, dataOffset));
  }
  return { instruments, swars: [] };
}

function parseNitroSwar(bytes: Uint8Array): NitroSwar {
  requireMagic(bytes, 0, "SWAR");
  requireMagic(bytes, 0x10, "DATA");
  const waveCount = readU32(bytes, 0x38);
  if (waveCount > Math.floor(Math.max(0, bytes.length - 0x3c) / 4)) throw new Error(`SWAR wave count ${waveCount} is out of range.`);
  const waves: NitroSwav[] = [];
  for (let index = 0; index < waveCount; index += 1) {
    const waveOffset = readU32(bytes, 0x3c + index * 4);
    waves.push(parseNitroSwav(bytes, waveOffset));
  }
  return { waves };
}

function parseNitroInstrument(bytes: Uint8Array, type: NitroInstrumentType, dataOffset: number): NitroInstrument {
  if (type === "empty" || dataOffset <= 0 || dataOffset >= bytes.length) return { type: "empty" };
  if (type === "pcm" || type === "psg" || type === "noise") return { type, defaultParam: parseInstrumentParam(bytes, dataOffset) };
  if (type === "drum") {
    const minNote = bytes[dataOffset] ?? 0;
    const maxNote = bytes[dataOffset + 1] ?? minNote;
    const subInstruments: NitroInstrumentData[] = [];
    let cursor = dataOffset + 2;
    for (let note = minNote; note <= maxNote && cursor + 12 <= bytes.length; note += 1) {
      const sub = parseInstrumentData(bytes, cursor);
      subInstruments.push(sub);
      cursor += 12;
    }
    return { type, drum: { minNote, maxNote, subInstruments } };
  }
  if (type === "keySplit") {
    const keyRegions = [...bytes.slice(dataOffset, dataOffset + 8)];
    const subCount = keyRegions.findIndex((region) => region === 0);
    const count = subCount === -1 ? keyRegions.length : subCount;
    const subInstruments: NitroInstrumentData[] = [];
    let cursor = dataOffset + 8;
    for (let index = 0; index < count && cursor + 12 <= bytes.length; index += 1) {
      const sub = parseInstrumentData(bytes, cursor);
      subInstruments.push(sub);
      cursor += 12;
    }
    return { type, keySplit: { keyRegions, subInstruments } };
  }
  return { type: "empty" };
}

function parseInstrumentData(bytes: Uint8Array, offset: number): NitroInstrumentData {
  const type = instrumentTypeFromByte(bytes[offset] ?? 0);
  return { type, param: parseInstrumentParam(bytes, offset + 2) };
}

function parseInstrumentParam(bytes: Uint8Array, offset: number): NitroInstrumentParam {
  return {
    info: [readU16(bytes, offset), readU16(bytes, offset + 2)],
    baseKey: bytes[offset + 4] ?? 60,
    attack: bytes[offset + 5] ?? 0x7f,
    decay: bytes[offset + 6] ?? 0,
    sustain: bytes[offset + 7] ?? 0x7f,
    release: bytes[offset + 8] ?? 0x20,
    pan: bytes[offset + 9] ?? 0x40,
  };
}

function parseNitroSwav(bytes: Uint8Array, offset: number): NitroSwav {
  if (offset <= 0 || offset + 12 > bytes.length) throw new Error(`SWAV offset ${offset} is out of range.`);
  const format = (bytes[offset] ?? 0) as 0 | 1 | 2;
  const doesLoop = (bytes[offset + 1] ?? 0) !== 0;
  const sampleRate = readU16(bytes, offset + 2);
  const timer = readU16(bytes, offset + 4);
  const loopOffset = readU16(bytes, offset + 6);
  const length = readU32(bytes, offset + 8);
  const sampleLength = loopOffset * 4 + length * 4;
  return {
    format,
    doesLoop,
    sampleRate: sampleRate || Math.round(NITRO_ARM7_CLOCK / Math.max(1, timer || 8006)),
    timer,
    loopOffset,
    length,
    samples: bytes.slice(offset + 12, Math.min(bytes.length, offset + 12 + sampleLength)),
  };
}

function scheduleSseqNotes(data: Uint8Array, sequenceVolume: number, maxSeconds: number): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  const queue: SseqTrackState[] = [makeTrackState(0, 0, 0)];
  const spawned = new Set<string>(["0:0:0"]);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const track = queue[queueIndex];
    let commandBudget = MAX_SSEQ_COMMANDS_PER_TRACK;
    while (!track.stopped && track.offset < data.length && commandBudget-- > 0 && track.timeSeconds <= maxSeconds + 1) {
      const commandOffset = track.offset;
      const command = data[track.offset++] ?? 0xff;
      if (command < 0x80) {
        const velocity = data[track.offset++] ?? 0x7f;
        const durationTicks = readSseqArg(data, track, "varLen");
        if (track.doCommandWork) {
          const key = clamp(command + track.transpose, 0, 0x7f);
          const durationSeconds = ticksToSeconds(durationTicks, track.tempo);
          notes.push({
            startSeconds: track.timeSeconds,
            durationSeconds: Math.max(durationSeconds, 0.02),
            key,
            velocity,
            voice: track.voice,
            volume: track.volume,
            expression: track.expression,
            trackPan: track.panpot,
            transpose: track.transpose,
            pitchBend: track.pitchBend,
            pitchBendRange: track.pitchBendRange,
            sequenceVolume,
            trackIndex: track.index,
          });
          if (track.mono) track.timeSeconds += durationSeconds;
        }
        resetConditionalTrackFlags(track);
        continue;
      }

      const group = command & 0xf0;
      if (group === 0x80) {
        const argument = readSseqArg(data, track, "varLen");
        if (track.doCommandWork) {
          if (command === 0x80) track.timeSeconds += ticksToSeconds(argument, track.tempo);
          else if (command === 0x81) track.voice = clamp(argument, 0, 0xff);
        }
        resetConditionalTrackFlags(track);
        continue;
      }

      if (group === 0x90) {
        if (command === 0x93) {
          const trackIndex = data[track.offset++] ?? 0;
          const targetOffset = readU24(data, track.offset);
          track.offset += 3;
          const spawnKey = `${trackIndex}:${targetOffset}:${Math.round(track.timeSeconds * 1000)}`;
          if (track.doCommandWork && !spawned.has(spawnKey)) {
            spawned.add(spawnKey);
            queue.push(makeTrackState(trackIndex, targetOffset, track.timeSeconds, track.tempo));
          }
        } else if (command === 0x94) {
          const targetOffset = readU24(data, track.offset);
          track.offset += 3;
          if (track.doCommandWork) track.offset = targetOffset;
        } else if (command === 0x95) {
          const targetOffset = readU24(data, track.offset);
          track.offset += 3;
          if (track.doCommandWork && track.callStack.length < 3) {
            track.callStack.push(track.offset);
            track.offset = targetOffset;
          }
        } else {
          track.stopped = true;
        }
        resetConditionalTrackFlags(track);
        continue;
      }

      if (group === 0xa0) {
        if (command === 0xa0) track.argOverride = "rand";
        else if (command === 0xa1) track.argOverride = "var";
        else if (command === 0xa2) track.doCommandWork = track.variableFlag;
        continue;
      }

      if (group === 0xb0) {
        track.offset += 1;
        readSseqArg(data, track, "short");
        resetConditionalTrackFlags(track);
        continue;
      }

      if (group === 0xc0 || group === 0xd0) {
        const argument = readSseqArg(data, track, "byte");
        if (track.doCommandWork) {
          if (command === 0xc0) track.panpot = clamp(argument - 0x40, -0x40, 0x3f);
          else if (command === 0xc1) track.volume = clamp(argument, 0, 0x7f);
          else if (command === 0xc2) {
            // Player volume is already represented by the sequence INFO volume.
          } else if (command === 0xc3) track.transpose = readSignedByte(argument);
          else if (command === 0xc4) track.pitchBend = readSignedByte(argument);
          else if (command === 0xc5) track.pitchBendRange = clamp(argument, 0, 0x7f);
          else if (command === 0xc7) track.mono = argument === 1;
          else if (command === 0xd4) track.loopStack.push({ offset: track.offset, remaining: argument });
          else if (command === 0xd5) track.expression = clamp(argument, 0, 0x7f);
        }
        resetConditionalTrackFlags(track);
        continue;
      }

      if (group === 0xe0) {
        const argument = readSseqArg(data, track, "short");
        if (track.doCommandWork && command === 0xe1) track.tempo = clamp(argument, 1, 1024);
        resetConditionalTrackFlags(track);
        continue;
      }

      if (group === 0xf0) {
        if (command === 0xfc) {
          const loop = track.loopStack[track.loopStack.length - 1];
          if (loop) {
            if (loop.remaining > 0) loop.remaining -= 1;
            if (loop.remaining === 0) track.loopStack.pop();
            else track.offset = loop.offset;
          }
        } else if (command === 0xfd) {
          const returnOffset = track.callStack.pop();
          if (returnOffset === undefined) track.stopped = true;
          else track.offset = returnOffset;
        } else if (command === 0xfe) {
          track.offset += 2;
        } else if (command === 0xff) {
          track.stopped = true;
        } else {
          track.stopped = true;
        }
        resetConditionalTrackFlags(track);
        continue;
      }

      track.stopped = true;
      void commandOffset;
    }
  }
  return notes;
}

function makeTrackState(index: number, offset: number, timeSeconds: number, tempo = 120): SseqTrackState {
  return {
    index,
    offset,
    timeSeconds,
    tempo,
    voice: 0,
    volume: 0x7f,
    expression: 0x7f,
    panpot: 0,
    transpose: 0,
    pitchBend: 0,
    pitchBendRange: 2,
    mono: true,
    stopped: false,
    callStack: [],
    loopStack: [],
    argOverride: "none",
    variableFlag: true,
    doCommandWork: true,
  };
}

function resetConditionalTrackFlags(track: SseqTrackState): void {
  track.argOverride = "none";
  track.doCommandWork = true;
}

function readSseqArg(data: Uint8Array, track: SseqTrackState, fallback: "byte" | "short" | "varLen"): number {
  const mode = track.argOverride === "rand" ? "rand" : track.argOverride === "var" ? "var" : fallback;
  if (mode === "byte") return data[track.offset++] ?? 0;
  if (mode === "short") {
    const value = readU16(data, track.offset);
    track.offset += 2;
    return value;
  }
  if (mode === "rand") {
    const min = readI16(data, track.offset);
    const max = readI16(data, track.offset + 2);
    track.offset += 4;
    return min + Math.floor((max - min + 1) / 2);
  }
  if (mode === "var") {
    track.offset += 1;
    return 0;
  }
  let value = 0;
  let read = 0;
  let byte = 0;
  do {
    byte = data[track.offset++] ?? 0;
    value = (value << 7) | (byte & 0x7f);
    read += 1;
  } while (read < 4 && (byte & 0x80) !== 0);
  return value;
}

function renderScheduledNote(bank: NitroSbnk, note: ScheduledNote, left: Float32Array, right: Float32Array, sampleRate: number, maxDuration: number): void {
  const instrumentData = getInstrumentData(bank, note.voice, note.key);
  if (!instrumentData) return;
  const startSample = Math.max(0, Math.floor(note.startSeconds * sampleRate));
  if (startSample >= left.length) return;
  const noteSamples = Math.max(1, Math.floor(note.durationSeconds * sampleRate));
  const releaseSamples = Math.min(Math.floor(sampleRate * 0.08), Math.max(32, Math.floor(noteSamples * 0.2)));
  const endSample = Math.min(left.length, startSample + noteSamples + releaseSamples);
  const baseGain =
    (note.velocity / 127) *
    (note.volume / 127) *
    (note.expression / 127) *
    (Math.max(0, note.sequenceVolume || 127) / 127) *
    0.45;
  const pan = clamp(instrumentData.param.pan - 0x40 + note.trackPan, -0x40, 0x3f);
  const leftGain = ((-pan + 0x40) / 0x80) * baseGain;
  const rightGain = ((pan + 0x40) / 0x80) * baseGain;
  if (instrumentData.type === "pcm") {
    const wave = bank.swars[instrumentData.param.info[1]]?.waves[instrumentData.param.info[0]];
    if (!wave) return;
    const decoded = decodeSwav(wave);
    const pitchSemitones = note.key - instrumentData.param.baseKey + (note.pitchBend * note.pitchBendRange) / 0x40;
    const step = (wave.sampleRate / sampleRate) * 2 ** (pitchSemitones / 12);
    let sourcePosition = 0;
    for (let outIndex = startSample; outIndex < endSample; outIndex += 1) {
      const sourceIndex = Math.floor(sourcePosition);
      if (sourceIndex >= decoded.pcm.length) {
        if (!wave.doesLoop || decoded.loopStart >= decoded.pcm.length) break;
        sourcePosition = decoded.loopStart + ((sourcePosition - decoded.loopStart) % Math.max(1, decoded.pcm.length - decoded.loopStart));
      }
      const sample = interpolate(decoded.pcm, sourcePosition) * envelopeAt(outIndex - startSample, noteSamples, releaseSamples, instrumentData.param);
      left[outIndex] += sample * leftGain;
      right[outIndex] += sample * rightGain;
      sourcePosition += step;
    }
    return;
  }

  const frequency = 440 * 2 ** ((note.key - 69) / 12);
  let noiseState = 0x7fff ^ ((note.trackIndex + 1) * 0x1111);
  for (let outIndex = startSample; outIndex < endSample; outIndex += 1) {
    const elapsed = (outIndex - startSample) / sampleRate;
    let sample: number;
    if (instrumentData.type === "noise") {
      noiseState = (noiseState & 1) !== 0 ? (noiseState >>> 1) ^ 0x6000 : noiseState >>> 1;
      sample = (noiseState & 1) === 0 ? 1 : -1;
    } else {
      const duty = clamp(instrumentData.param.info[0] & 7, 0, 7) / 8;
      sample = (elapsed * frequency) % 1 <= duty ? -0.8 : 0.8;
    }
    sample *= envelopeAt(outIndex - startSample, noteSamples, releaseSamples, instrumentData.param);
    left[outIndex] += sample * leftGain;
    right[outIndex] += sample * rightGain;
  }
  void maxDuration;
}

function getInstrumentData(bank: NitroSbnk, voice: number, key: number): NitroInstrumentData | undefined {
  const instrument = bank.instruments[voice];
  if (!instrument) return undefined;
  if ((instrument.type === "pcm" || instrument.type === "psg" || instrument.type === "noise") && instrument.defaultParam) {
    return { type: instrument.type, param: instrument.defaultParam };
  }
  if (instrument.type === "drum" && instrument.drum) {
    if (key < instrument.drum.minNote || key > instrument.drum.maxNote) return undefined;
    return instrument.drum.subInstruments[key - instrument.drum.minNote];
  }
  if (instrument.type === "keySplit" && instrument.keySplit) {
    const index = instrument.keySplit.keyRegions.findIndex((region) => region > 0 && key <= region);
    return instrument.keySplit.subInstruments[index === -1 ? instrument.keySplit.subInstruments.length - 1 : index];
  }
  return undefined;
}

function decodeSwav(wave: NitroSwav): { pcm: Float32Array; loopStart: number } {
  if (wave.decoded) return wave.decoded;
  if (wave.format === 0) {
    const pcm = convertNitroPcm8(wave.samples);
    wave.decoded = { pcm, loopStart: wave.loopOffset * 4 };
    return wave.decoded;
  }
  if (wave.format === 1) {
    const pcm = convertNitroPcm16(wave.samples);
    wave.decoded = { pcm, loopStart: Math.floor((wave.loopOffset * 4) / 2) };
    return wave.decoded;
  }
  const decoded = decodeNitroAdpcm(wave.samples);
  const pcm = new Float32Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) pcm[index] = decoded[index] / 32768;
  wave.decoded = { pcm, loopStart: Math.max(0, (wave.loopOffset * 4 - 4) * 2) };
  return wave.decoded;
}

function envelopeAt(sampleIndex: number, noteSamples: number, releaseSamples: number, param: NitroInstrumentParam): number {
  const attackSamples = Math.max(8, Math.floor((1 - clamp(param.attack, 0, 0x7f) / 0x7f) * 0.03 * DEFAULT_SAMPLE_RATE));
  const sustain = clamp(param.sustain, 0, 0x7f) / 0x7f;
  if (sampleIndex < attackSamples) return sampleIndex / attackSamples;
  if (sampleIndex < noteSamples) {
    const decaySamples = Math.max(1, Math.floor((param.decay / 0x7f) * 0.18 * DEFAULT_SAMPLE_RATE));
    const decayPosition = clamp((sampleIndex - attackSamples) / decaySamples, 0, 1);
    return 1 - (1 - sustain) * decayPosition;
  }
  const releasePosition = clamp((sampleIndex - noteSamples) / Math.max(1, releaseSamples), 0, 1);
  return sustain * (1 - releasePosition);
}

function pcmToAudioBuffer(pcm: NitroRenderedPcm): AudioBuffer {
  const AudioBufferCtor = globalThis.AudioBuffer;
  if (AudioBufferCtor) {
    const buffer = new AudioBufferCtor({ length: pcm.length, numberOfChannels: 2, sampleRate: pcm.sampleRate });
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    return buffer;
  }
  const OfflineAudioContextCtor = globalThis.OfflineAudioContext;
  if (OfflineAudioContextCtor) {
    const context = new OfflineAudioContextCtor(2, pcm.length, pcm.sampleRate);
    const buffer = context.createBuffer(2, pcm.length, pcm.sampleRate);
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    return buffer;
  }
  throw new Error("This browser does not provide AudioBuffer.");
}

function parseSdatSymb(bytes: Uint8Array, offset: number): Pick<NitroSdat, "sequenceSymbols" | "bankSymbols" | "waveArchiveSymbols"> {
  requireMagic(bytes, offset, "SYMB");
  const base = offset;
  const recordOffsets = Array.from({ length: 8 }, (_unused, index) => readU32(bytes, offset + 8 + index * 4));
  return {
    sequenceSymbols: parseSdatSymbolRecord(bytes, base, recordOffsets[0]),
    bankSymbols: parseSdatSymbolRecord(bytes, base, recordOffsets[2]),
    waveArchiveSymbols: parseSdatSymbolRecord(bytes, base, recordOffsets[3]),
  };
}

function parseSdatSymbolRecord(bytes: Uint8Array, base: number, recordOffset: number): string[] {
  if (!recordOffset) return [];
  const offset = base + recordOffset;
  const count = readU32(bytes, offset);
  const entries: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = readU32(bytes, offset + 4 + index * 4);
    entries.push(entryOffset ? readNullTerminatedAscii(bytes, base + entryOffset) : "");
  }
  return entries;
}

function parseSdatInfo(
  bytes: Uint8Array,
  offset: number,
  symbols: Pick<NitroSdat, "sequenceSymbols" | "bankSymbols" | "waveArchiveSymbols">,
): Pick<NitroSdat, "sequenceInfos" | "bankInfos" | "waveArchiveInfos"> {
  requireMagic(bytes, offset, "INFO");
  const base = offset;
  const recordOffsets = Array.from({ length: 8 }, (_unused, index) => readU32(bytes, offset + 8 + index * 4));
  const sequenceInfos = parseSdatInfoRecord(bytes, base, recordOffsets[0], (entryOffset, id) => ({
    id,
    fileId: readU16(bytes, entryOffset),
    bankId: readU16(bytes, entryOffset + 4),
    volume: bytes[entryOffset + 6] ?? 0x7f,
    channelPriority: bytes[entryOffset + 7] ?? 0,
    playerPriority: bytes[entryOffset + 8] ?? 0,
    playerNum: bytes[entryOffset + 9] ?? 0,
    symbol: symbols.sequenceSymbols[id],
  }));
  const bankInfos = parseSdatInfoRecord(bytes, base, recordOffsets[2], (entryOffset, id) => ({
    id,
    fileId: readU16(bytes, entryOffset),
    swarIds: [readU16(bytes, entryOffset + 4), readU16(bytes, entryOffset + 6), readU16(bytes, entryOffset + 8), readU16(bytes, entryOffset + 10)],
    symbol: symbols.bankSymbols[id],
  }));
  const waveArchiveInfos = parseSdatInfoRecord(bytes, base, recordOffsets[3], (entryOffset, id) => ({
    id,
    fileId: readU16(bytes, entryOffset),
    symbol: symbols.waveArchiveSymbols[id],
  }));
  return { sequenceInfos, bankInfos, waveArchiveInfos };
}

function parseSdatInfoRecord<T>(bytes: Uint8Array, base: number, recordOffset: number, read: (entryOffset: number, id: number) => T): T[] {
  if (!recordOffset) return [];
  const offset = base + recordOffset;
  const count = readU32(bytes, offset);
  const entries: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = readU32(bytes, offset + 4 + index * 4);
    if (entryOffset) entries[index] = read(base + entryOffset, index);
  }
  return entries;
}

function parseSdatFat(bytes: Uint8Array, offset: number): NitroFatEntry[] {
  requireMagic(bytes, offset, "FAT ");
  const count = readU32(bytes, offset + 8);
  const entries: NitroFatEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = offset + 12 + index * 16;
    const dataOffset = readU32(bytes, entryOffset);
    const dataLength = readU32(bytes, entryOffset + 4);
    entries.push({
      id: index,
      dataOffset,
      dataLength,
      data: bytes.slice(dataOffset, dataOffset + dataLength),
    });
  }
  return entries;
}

function listNamedRomFiles(folder: Folder, prefix = ""): Array<{ path: string; id: number }> {
  const files = folder.files.map((file, index) => ({ path: `${prefix}${file}`, id: folder.firstId + index }));
  for (const [name, child] of folder.folders) files.push(...listNamedRomFiles(child, `${prefix}${name}/`));
  return files;
}

function scoreSdatPath(path: string): number {
  const lower = path.toLowerCase();
  if (lower.includes("sound")) return 0;
  if (lower.includes("sdat")) return 1;
  return 2;
}

function requireMagic(bytes: Uint8Array, offset: number, magic: string): void {
  if (readAscii(bytes, offset, magic.length) !== magic) throw new Error(`Expected ${magic} magic at 0x${offset.toString(16)}.`);
}

function readNullTerminatedAscii(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return readAscii(bytes, offset, end - offset);
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function instrumentTypeFromByte(value: number): NitroInstrumentType {
  if (value === 0x01) return "pcm";
  if (value === 0x02) return "psg";
  if (value === 0x03) return "noise";
  if (value === 0x10) return "drum";
  if (value === 0x11) return "keySplit";
  return "empty";
}

function readU24(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16);
}

function readI16(data: Uint8Array, offset: number): number {
  const value = readU16(data, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readSignedByte(value: number): number {
  return value & 0x80 ? value - 0x100 : value;
}

function ticksToSeconds(ticks: number, tempo: number): number {
  return (Math.max(0, ticks) * 60) / (Math.max(1, tempo) * TICKS_PER_BEAT);
}

function interpolate(samples: Float32Array, position: number): number {
  const index = Math.floor(position);
  const next = Math.min(samples.length - 1, index + 1);
  const fraction = position - index;
  return (samples[index] ?? 0) * (1 - fraction) + (samples[next] ?? 0) * fraction;
}

function normalizePcm(left: Float32Array, right: Float32Array): void {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  if (peak <= 1) return;
  const gain = 0.98 / peak;
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= gain;
    right[index] *= gain;
  }
}

function applyFade(left: Float32Array, right: Float32Array, start: number, end: number): void {
  const length = Math.max(1, end - start);
  for (let index = start; index < end; index += 1) {
    const gain = 1 - (index - start) / length;
    left[index] *= gain;
    right[index] *= gain;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const ADPCM_INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8];
const ADPCM_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
  143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282,
  1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630,
  9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
