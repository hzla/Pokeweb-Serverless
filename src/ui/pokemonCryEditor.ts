import { downloadBytes } from "../pokeweb/fileSystemModel";
import { getPokemonCryInfo, importPokemonCryArchive, type PokemonCryInfo } from "../pokeweb/pokemonCryModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { renderNitroWaveArchivePcm } from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type CryEditorOptions = {
  onDirty?: () => void;
};

type AudioContextConstructor = new () => AudioContext;

export function renderPokemonCryPanel(speciesId: number): string {
  return `
    <div class="expanded-card-content expanded-cry" data-pokemon-cry-panel="${speciesId}">
      <div class="pokemon-cry-editor">
        <div class="pokemon-cry-heading">
          <strong>Pokemon Cry</strong>
          <span class="pokemon-cry-description">Play or replace this Pokemon's native Nintendo DS sound archive.</span>
        </div>
        <div class="pokemon-cry-actions">
          <button class="btn -default pokemon-cry-play" type="button" disabled>Play Cry</button>
          <button class="btn -default pokemon-cry-export" type="button" disabled>Export SWAR</button>
          <label class="btn -default pokemon-cry-import-label -disabled">
            Import SWAR
            <input class="pokemon-cry-import" type="file" accept=".swar,application/octet-stream" hidden disabled>
          </label>
        </div>
        <div class="pokemon-cry-metadata" aria-live="polite">
          <span class="pokemon-cry-loading">Loading cry data…</span>
        </div>
        <div class="pokemon-cry-status" aria-live="polite"></div>
      </div>
    </div>
  `;
}

export async function installPokemonCryPanel(
  panel: HTMLElement,
  project: ProjectState,
  speciesId: number,
  options: CryEditorOptions = {},
): Promise<void> {
  if (panel.dataset.pokemonCryInstalled === "true") return;
  panel.dataset.pokemonCryInstalled = "true";
  const playButton = panel.querySelector<HTMLButtonElement>(".pokemon-cry-play");
  const exportButton = panel.querySelector<HTMLButtonElement>(".pokemon-cry-export");
  const importInput = panel.querySelector<HTMLInputElement>(".pokemon-cry-import");
  const importLabel = panel.querySelector<HTMLElement>(".pokemon-cry-import-label");
  const metadata = panel.querySelector<HTMLElement>(".pokemon-cry-metadata");
  const status = panel.querySelector<HTMLElement>(".pokemon-cry-status");
  if (!playButton || !exportButton || !importInput || !importLabel || !metadata || !status) return;

  let info: PokemonCryInfo | undefined;
  let audioContext: AudioContext | undefined;
  let audioSource: AudioBufferSourceNode | undefined;

  const setStatus = (message: string, error = false): void => {
    status.textContent = message;
    status.classList.toggle("-error", error);
  };
  const setReady = (next: PokemonCryInfo): void => {
    info = next;
    playButton.disabled = false;
    exportButton.disabled = false;
    importInput.disabled = false;
    importLabel.classList.remove("-disabled");
    metadata.innerHTML = `
      <span><strong>Cry ID</strong>${next.cryId}</span>
      <span><strong>Encoding</strong>${escapeHtml(next.format)}</span>
      <span><strong>Sample rate</strong>${next.sampleRate.toLocaleString()} Hz</span>
      <span><strong>Duration</strong>${formatDuration(next.duration)}</span>
      <span><strong>Archive size</strong>${formatBytes(next.bytes.length)}</span>
      <span><strong>Source</strong>${escapeHtml(next.sdatPath)}</span>
    `;
  };
  const stopPlayback = (): void => {
    audioSource?.stop();
    audioSource?.disconnect();
    audioSource = undefined;
    playButton.textContent = "Play Cry";
    playButton.classList.remove("-playing");
  };

  try {
    setReady(await getPokemonCryInfo(project, speciesId));
  } catch (error) {
    panel.dataset.pokemonCryInstalled = "error";
    metadata.innerHTML = `<span class="pokemon-cry-unavailable">${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`;
    return;
  }

  playButton.addEventListener("click", async () => {
    if (audioSource) {
      stopPlayback();
      setStatus("Playback stopped.");
      return;
    }
    if (!info) return;
    playButton.disabled = true;
    setStatus("Preparing cry audio…");
    try {
      const AudioContextImpl = (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext) as
        | AudioContextConstructor
        | undefined;
      if (!AudioContextImpl) throw new Error("This browser does not support Web Audio playback.");
      audioContext ??= new AudioContextImpl();
      if (audioContext.state === "suspended") await audioContext.resume();
      const pcm = renderNitroWaveArchivePcm(info.bytes);
      const buffer = audioContext.createBuffer(2, pcm.length, pcm.sampleRate);
      buffer.getChannelData(0).set(pcm.left);
      buffer.getChannelData(1).set(pcm.right);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.addEventListener("ended", () => {
        if (audioSource !== source) return;
        source.disconnect();
        audioSource = undefined;
        playButton.textContent = "Play Cry";
        playButton.classList.remove("-playing");
        setStatus("Playback finished.");
      });
      audioSource = source;
      source.start();
      playButton.textContent = "Stop";
      playButton.classList.add("-playing");
      setStatus(`Playing ${pokemonSpeciesLabel(project, speciesId)}'s cry.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      playButton.disabled = false;
    }
  });

  exportButton.addEventListener("click", () => {
    if (!info) return;
    const name = pokemonSpeciesLabel(project, speciesId);
    downloadBytes(info.bytes, `${fileSlug(name)}-${String(info.cryId).padStart(3, "0")}-cry.swar`);
    setStatus("Cry archive exported.");
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    stopPlayback();
    playButton.disabled = true;
    exportButton.disabled = true;
    importInput.disabled = true;
    importLabel.classList.add("-disabled");
    setStatus(`Importing ${file.name}…`);
    void file
      .arrayBuffer()
      .then((buffer) => importPokemonCryArchive(project, speciesId, new Uint8Array(buffer)))
      .then((next) => {
        setReady(next);
        options.onDirty?.();
        setStatus(`${file.name} imported. The updated cry will be included when the ROM is saved.`);
      })
      .catch((error) => {
        if (info) setReady(info);
        setStatus(error instanceof Error ? error.message : String(error), true);
      });
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "Unknown";
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function fileSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "pokemon";
}
