import {
  extractMoveSoundEvents,
  loadNitroSdatFromProject,
  renderNitroSequencePcm,
  type MoveSoundEvent,
  type NitroRenderedPcm,
  type NitroSdat,
} from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

export type MoveAnimationAudioPreviewController = {
  refresh: () => Promise<void>;
  stop: () => void;
  destroy: () => void;
};

const PLAY_SOUND_PARAM_NAMES = ["se_no", "player", "pan", "wait", "pitch", "vol", "mod_depth", "mod_speed", "dummy"];

export function installMoveAnimationAudioPreview(
  host: HTMLElement,
  project: ProjectState,
  moveId: number,
  getScriptText: () => string,
): MoveAnimationAudioPreviewController {
  let audioContext: AudioContext | undefined;
  let currentSource: AudioBufferSourceNode | undefined;
  let currentGain: GainNode | undefined;
  let sdatPromise: Promise<NitroSdat> | undefined;
  let refreshSerial = 0;
  const audioBuffers = new Map<number, Promise<NitroRenderedPcm>>();

  const stop = (fade = true) => {
    if (!currentSource) return;
    const source = currentSource;
    const gain = currentGain;
    currentSource = undefined;
    currentGain = undefined;
    try {
      if (fade && audioContext && gain) {
        const now = audioContext.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);
        source.stop(now + 0.07);
      } else {
        source.stop();
      }
    } catch {
      // Stopping an already-ended buffer source is harmless.
    }
  };

  const ensureAudioContext = (): AudioContext => {
    if (audioContext) return audioContext;
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio playback.");
    audioContext = new AudioContextCtor();
    return audioContext;
  };

  const ensureSdat = (): Promise<NitroSdat> => {
    sdatPromise ??= loadNitroSdatFromProject(project);
    return sdatPromise;
  };

  const refresh = async (): Promise<void> => {
    const serial = ++refreshSerial;
    stop();
    renderShell("Refreshing sound events...");
    const list = host.querySelector<HTMLElement>(".move-animation-audio-list");
    const status = host.querySelector<HTMLElement>(".move-animation-audio-status");
    if (!list || !status) return;

    let events: MoveSoundEvent[];
    try {
      events = extractMoveSoundEvents(project, moveId, getScriptText());
    } catch (error) {
      if (serial !== refreshSerial) return;
      status.textContent = "Could not parse script audio";
      status.classList.add("-error");
      list.innerHTML = `<div class="move-animation-audio-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
      return;
    }

    if (events.length === 0) {
      if (serial !== refreshSerial) return;
      status.textContent = "No PlaySound commands";
      status.classList.remove("-error");
      list.innerHTML = `<div class="move-animation-audio-empty">No PlaySound commands found in this animation.</div>`;
      return;
    }

    let sdat: NitroSdat | undefined;
    let sdatError: string | undefined;
    try {
      sdat = await ensureSdat();
    } catch (error) {
      sdatError = error instanceof Error ? error.message : String(error);
    }
    if (serial !== refreshSerial) return;

    status.textContent = sdatError ? "SDAT unavailable" : `${events.length} sound event${events.length === 1 ? "" : "s"}`;
    status.classList.toggle("-error", Boolean(sdatError));
    list.innerHTML = events.map((event, index) => renderEventRow(event, index, sdat, sdatError)).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-audio-play-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.audioPlayIndex);
        const event = events[index];
        if (event) void playEvent(event, button.closest<HTMLElement>(".move-animation-audio-row"));
      });
    });
  };

  const playEvent = async (event: MoveSoundEvent, row: HTMLElement | null): Promise<void> => {
    const rowStatus = row?.querySelector<HTMLElement>(".move-animation-audio-row-status");
    const setRowStatus = (message: string, error = false) => {
      if (!rowStatus) return;
      rowStatus.textContent = message;
      rowStatus.classList.toggle("-error", error);
    };
    try {
      stop();
      setRowStatus("Rendering...");
      const sdat = await ensureSdat();
      const sequenceInfo = sdat.sequenceInfos[event.sequenceId];
      if (!sequenceInfo) throw new Error(`SDAT sequence ${event.sequenceId} is missing.`);
      let pcmPromise = audioBuffers.get(event.sequenceId);
      if (!pcmPromise) {
        pcmPromise = renderNitroSequencePcm(sdat, event.sequenceId, { maxSeconds: 12 });
        audioBuffers.set(event.sequenceId, pcmPromise);
      }
      const pcm = await pcmPromise;
      if (!hasAudibleSamples(pcm)) throw new Error(`SDAT sequence ${event.sequenceId} rendered silent audio.`);
      const context = ensureAudioContext();
      if (context.state === "suspended") await context.resume();
      const buffer = context.createBuffer(2, pcm.length, pcm.sampleRate);
      buffer.getChannelData(0).set(pcm.left);
      buffer.getChannelData(1).set(pcm.right);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      currentSource = source;
      currentGain = gain;
      source.onended = () => {
        if (currentSource === source) {
          currentSource = undefined;
          currentGain = undefined;
        }
        setRowStatus(pcm.capped ? "Stopped at 12s cap" : "Ready");
      };
      source.start();
      setRowStatus("Playing");
    } catch (error) {
      setRowStatus(error instanceof Error ? error.message : String(error), true);
    }
  };

  const renderShell = (message: string): void => {
    host.innerHTML = `
      <div class="move-animation-audio-toolbar">
        <button class="script-btn move-animation-audio-refresh" type="button">Refresh</button>
        <button class="script-btn move-animation-audio-stop" type="button">Stop</button>
        <div class="move-animation-audio-status">${escapeHtml(message)}</div>
      </div>
      <div class="move-animation-audio-list"></div>
    `;
    host.querySelector<HTMLButtonElement>(".move-animation-audio-refresh")?.addEventListener("click", () => {
      void refresh();
    });
    host.querySelector<HTMLButtonElement>(".move-animation-audio-stop")?.addEventListener("click", () => stop());
  };

  renderShell("Open the Audio tab to scan PlaySound commands.");

  return {
    refresh,
    stop: () => stop(),
    destroy: () => {
      refreshSerial += 1;
      stop(false);
      void audioContext?.close();
      audioContext = undefined;
    },
  };
}

function renderEventRow(event: MoveSoundEvent, index: number, sdat: NitroSdat | undefined, sdatError: string | undefined): string {
  const sequenceInfo = sdat?.sequenceInfos[event.sequenceId];
  const symbol = sequenceInfo?.symbol || sdat?.sequenceSymbols[event.sequenceId] || "";
  const disabledReason = sdatError ?? (!sequenceInfo && sdat ? `SDAT sequence ${event.sequenceId} is missing.` : "");
  return `
    <div class="move-animation-audio-row${disabledReason ? " -error" : ""}">
      <div class="move-animation-audio-row-main">
        <button class="script-btn move-animation-audio-play" type="button" data-audio-play-index="${index}"${disabledReason ? " disabled" : ""}>Play</button>
        <div class="move-animation-audio-row-title">
          <strong>Frame ${event.frame}</strong>
          <span>Sound ${event.soundId}${symbol ? ` / ${escapeHtml(symbol)}` : ""}</span>
        </div>
      </div>
      <div class="move-animation-audio-row-meta">
        <code>${escapeHtml(formatPlaySoundParams(event.params))}</code>
      </div>
      <div class="move-animation-audio-row-status${disabledReason ? " -error" : ""}">${escapeHtml(disabledReason || "Ready")}</div>
    </div>
  `;
}

function formatPlaySoundParams(params: number[]): string {
  return params.map((value, index) => `${PLAY_SOUND_PARAM_NAMES[index] ?? `param_${index}`}: ${value}`).join(", ");
}

function hasAudibleSamples(pcm: NitroRenderedPcm): boolean {
  const stride = Math.max(1, Math.floor(pcm.length / 2048));
  for (let index = 0; index < pcm.length; index += stride) {
    if (Math.abs(pcm.left[index]) > 0.0001 || Math.abs(pcm.right[index]) > 0.0001) return true;
  }
  return false;
}
