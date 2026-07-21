import type { MoveAnimationTimelineEvent } from "../pokeweb/moveAnimationPreviewModel";
import { loadNitroSdatFromProject, renderNitroSequencePcm, type NitroRenderedPcm, type NitroSdat } from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";

const FRAMES_PER_SECOND = 30;
const AUDIO_SAMPLE_RATE = 32_768;
const MAX_SOUND_SECONDS = 8;
const MIN_SOUND_SECONDS = 1;
const SOUND_TAIL_SECONDS = 0.75;

export type MoveAnimationSoundCue = {
  id: string;
  frame: number;
  sequenceId: number;
  player: number;
  pan: number;
  pitch: number;
  volume: number;
};

export type MoveAnimationTimelineAudioStatus = {
  cueCount: number;
  loadedSequenceCount: number;
  failedSequenceCount: number;
};

export type MoveAnimationTimelineAudioController = {
  enable: () => Promise<MoveAnimationTimelineAudioStatus>;
  disable: () => void;
  startAtFrame: (frame: number, speed: number) => void;
  advance: (previousFrame: number, nextFrame: number, speed: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  stop: () => void;
  destroy: () => void;
};

type ActiveSound = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  cue: MoveAnimationSoundCue;
  pitchRate: number;
};

export function extractMoveAnimationSoundCues(timeline: MoveAnimationTimelineEvent[]): MoveAnimationSoundCue[] {
  return timeline
    .filter((event) => event.command === "PlaySound")
    .map((event) => ({
      id: event.id,
      frame: event.frame,
      sequenceId: event.params[0] ?? 0,
      player: event.params[1] ?? 5,
      pan: event.params[2] ?? 0,
      pitch: event.params[4] ?? 0,
      volume: event.params[5] ?? 127,
    }))
    .sort((left, right) => left.frame - right.frame);
}

export function moveAnimationSoundPitchRate(pitch: number): number {
  if (!Number.isFinite(pitch)) return 1;
  return Math.max(0.125, Math.min(8, 2 ** (pitch / 1200)));
}

export function moveAnimationSoundGain(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume / 127));
}

export function moveAnimationSoundCuesCrossed(
  cues: MoveAnimationSoundCue[],
  previousFrame: number,
  nextFrame: number,
): MoveAnimationSoundCue[] {
  if (nextFrame <= previousFrame) return [];
  return cues.filter((cue) => cue.frame > previousFrame && cue.frame <= nextFrame);
}

export function createMoveAnimationTimelineAudio(
  project: ProjectState,
  timeline: MoveAnimationTimelineEvent[],
): MoveAnimationTimelineAudioController {
  const cues = extractMoveAnimationSoundCues(timeline);
  const timelineEndFrame = Math.max(0, ...timeline.map((event) => event.frame));
  let audioContext: AudioContext | undefined;
  let sdatPromise: Promise<NitroSdat> | undefined;
  let enablePromise: Promise<MoveAnimationTimelineAudioStatus> | undefined;
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let playbackSpeed = 1;
  const buffers = new Map<number, AudioBuffer>();
  const activeSounds = new Set<ActiveSound>();

  const ensureAudioContext = (): AudioContext => {
    if (audioContext) return audioContext;
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio playback.");
    audioContext = new AudioContextCtor();
    return audioContext;
  };

  const stop = (): void => {
    for (const active of activeSounds) {
      active.source.onended = null;
      try {
        active.source.stop();
      } catch {
        // Stopping an already-ended buffer source is harmless.
      }
      active.source.disconnect();
      active.gain.disconnect();
    }
    activeSounds.clear();
  };

  const startCue = (cue: MoveAnimationSoundCue, elapsedFrames = 0): void => {
    if (!enabled || disposed || !audioContext) return;
    const buffer = buffers.get(cue.sequenceId);
    if (!buffer) return;
    const pitchRate = moveAnimationSoundPitchRate(cue.pitch);
    const offsetSeconds = Math.max(0, elapsedFrames / FRAMES_PER_SECOND) * pitchRate;
    if (offsetSeconds >= buffer.duration) return;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackSpeed * pitchRate;
    gain.gain.value = moveAnimationSoundGain(cue.volume);
    source.connect(gain);
    gain.connect(audioContext.destination);
    const active: ActiveSound = { source, gain, cue, pitchRate };
    activeSounds.add(active);
    source.onended = () => {
      activeSounds.delete(active);
      source.disconnect();
      gain.disconnect();
    };
    source.start(0, offsetSeconds);
  };

  const startAtFrame = (frame: number, speed: number): void => {
    stop();
    playbackSpeed = validPlaybackSpeed(speed);
    if (!enabled || buffers.size === 0) return;
    if (audioContext?.state === "suspended") void audioContext.resume().catch(() => undefined);
    for (const cue of cues) {
      if (cue.frame > frame) break;
      startCue(cue, frame - cue.frame);
    }
  };

  const enable = (): Promise<MoveAnimationTimelineAudioStatus> => {
    enabled = true;
    const context = ensureAudioContext();
    // Resume while this call still has the checkbox click's user activation.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    if (enablePromise) return enablePromise;
    const currentGeneration = generation;
    enablePromise = (async () => {
      if (cues.length === 0) return { cueCount: 0, loadedSequenceCount: 0, failedSequenceCount: 0 };
      sdatPromise ??= loadNitroSdatFromProject(project);
      const sdat = await sdatPromise;
      const sequenceIds = [...new Set(cues.map((cue) => cue.sequenceId))];
      let failedSequenceCount = 0;
      for (const sequenceId of sequenceIds) {
        if (buffers.has(sequenceId)) continue;
        try {
          if (!sdat.sequenceInfos[sequenceId]) throw new Error(`SDAT sequence ${sequenceId} is missing.`);
          const pcm = await renderNitroSequencePcm(sdat, sequenceId, {
            maxSeconds: soundRenderSeconds(cues, sequenceId, timelineEndFrame),
            sampleRate: AUDIO_SAMPLE_RATE,
          });
          if (!hasAudibleSamples(pcm)) throw new Error(`SDAT sequence ${sequenceId} rendered silent audio.`);
          if (disposed || currentGeneration !== generation) break;
          buffers.set(sequenceId, makeAudioBuffer(context, pcm));
        } catch {
          failedSequenceCount += 1;
        }
      }
      if (failedSequenceCount === sequenceIds.length && sequenceIds.length > 0) {
        throw new Error("None of this animation's sound sequences could be rendered.");
      }
      return {
        cueCount: cues.length,
        loadedSequenceCount: buffers.size,
        failedSequenceCount,
      };
    })();
    return enablePromise;
  };

  return {
    enable,
    disable: () => {
      enabled = false;
      stop();
    },
    startAtFrame,
    advance: (previousFrame, nextFrame, speed) => {
      if (!enabled || buffers.size === 0) return;
      playbackSpeed = validPlaybackSpeed(speed);
      for (const cue of moveAnimationSoundCuesCrossed(cues, previousFrame, nextFrame)) {
        startCue(cue, nextFrame - cue.frame);
      }
    },
    setPlaybackSpeed: (speed) => {
      playbackSpeed = validPlaybackSpeed(speed);
      for (const active of activeSounds) active.source.playbackRate.value = playbackSpeed * active.pitchRate;
    },
    stop,
    destroy: () => {
      disposed = true;
      enabled = false;
      generation += 1;
      stop();
      void audioContext?.close();
      audioContext = undefined;
    },
  };
}

function validPlaybackSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function soundRenderSeconds(cues: MoveAnimationSoundCue[], sequenceId: number, timelineEndFrame: number): number {
  const firstFrame = cues.find((cue) => cue.sequenceId === sequenceId)?.frame ?? timelineEndFrame;
  return Math.max(
    MIN_SOUND_SECONDS,
    Math.min(MAX_SOUND_SECONDS, (Math.max(firstFrame, timelineEndFrame) - firstFrame) / FRAMES_PER_SECOND + SOUND_TAIL_SECONDS),
  );
}

function makeAudioBuffer(context: AudioContext, pcm: NitroRenderedPcm): AudioBuffer {
  const buffer = context.createBuffer(2, pcm.length, pcm.sampleRate);
  buffer.getChannelData(0).set(pcm.left);
  buffer.getChannelData(1).set(pcm.right);
  return buffer;
}

function hasAudibleSamples(pcm: NitroRenderedPcm): boolean {
  const stride = Math.max(1, Math.floor(pcm.length / 2048));
  for (let index = 0; index < pcm.length; index += stride) {
    if (Math.abs(pcm.left[index]) > 0.0001 || Math.abs(pcm.right[index]) > 0.0001) return true;
  }
  return false;
}
