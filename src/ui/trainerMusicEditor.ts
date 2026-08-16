import { downloadBytes } from "../pokeweb/fileSystemModel";
import {
  encodeNitroPcmWav,
  renderNitroSequenceLoopPcm,
  renderNitroSequencePcm,
  type NitroRenderedPcm,
} from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  assignTrainerBattleTheme,
  loadTrainerBattleMusicModel,
  trainerBattleMusicTrackLabel,
  type TrainerBattleMusicAssignment,
  type TrainerBattleMusicModel,
} from "../pokeweb/trainerBattleMusicModel";
import {
  assignTrainerEyeTheme,
  buildTrainerMusicNativeZip,
  loadTrainerMusicModel,
  trainerMusicExportBaseName,
  trainerMusicTrackLabel,
  type TrainerMusicClassAssignment,
  type TrainerMusicModel,
} from "../pokeweb/trainerMusicModel";
import { escapeHtml } from "./dom";

type TrainerMusicEditorOptions = {
  onDirty?: () => void;
};

type TrainerMusicEditorController = {
  destroy: () => void;
};

type AudioContextConstructor = new () => AudioContext;
type TrainerMusicTab = "approach" | "battle";

const PREVIEW_SECONDS = 15;
const PREVIEW_SAMPLE_RATE = 24_000;
const WAV_SAMPLE_RATE = 48_000;

let activeController: TrainerMusicEditorController | undefined;
let renderGeneration = 0;

export async function renderTrainerMusicEditor(
  project: ProjectState,
  root: HTMLElement,
  options: TrainerMusicEditorOptions = {},
): Promise<void> {
  stopTrainerMusicEditorPlayback();
  const generation = ++renderGeneration;
  root.innerHTML = renderLoadingState();
  try {
    const model = await loadTrainerMusicModel(project);
    const battleModel = await loadTrainerBattleMusicModel(project, model.sdat);
    if (generation !== renderGeneration || !root.isConnected) return;
    activeController = installTrainerMusicEditor(project, root, model, battleModel, options);
  } catch (error) {
    if (generation !== renderGeneration || !root.isConnected) return;
    root.innerHTML = renderLoadError(error instanceof Error ? error.message : String(error));
  }
}

export function stopTrainerMusicEditorPlayback(): void {
  renderGeneration += 1;
  activeController?.destroy();
  activeController = undefined;
}

export function filterTrainerMusicAssignments(
  model: TrainerMusicModel,
  query: string,
): TrainerMusicClassAssignment[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return model.assignments;
  return model.assignments.filter((assignment) => {
    const sequenceId = assignment.effectiveSequenceId;
    const sequence = sequenceId === undefined ? undefined : model.sdat.sequenceInfos[sequenceId];
    const haystack = [
      assignment.trainerClassId,
      `Class ${assignment.trainerClassId}`,
      assignment.trainerClassName,
      sequenceId,
      trainerMusicTrackLabel(model, sequenceId),
      sequence?.symbol,
    ]
      .filter((value) => value !== undefined)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function filterTrainerBattleMusicAssignments(
  model: TrainerBattleMusicModel,
  query: string,
): TrainerBattleMusicAssignment[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return model.assignments;
  return model.assignments.filter((assignment) => {
    const sequenceId = assignment.currentSequenceId;
    const sequence = sequenceId === undefined ? undefined : model.sdat.sequenceInfos[sequenceId];
    return [
      assignment.groupIndex === undefined ? "Fallback" : `Group ${assignment.groupIndex}`,
      assignment.name,
      assignment.scope,
      sequenceId,
      trainerBattleMusicTrackLabel(model, sequenceId),
      sequence?.symbol,
    ]
      .filter((value) => value !== undefined)
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

function installTrainerMusicEditor(
  project: ProjectState,
  root: HTMLElement,
  model: TrainerMusicModel,
  battleModel: TrainerBattleMusicModel,
  options: TrainerMusicEditorOptions,
): TrainerMusicEditorController {
  let destroyed = false;
  let activeTab: TrainerMusicTab = "approach";
  const queries: Record<TrainerMusicTab, string> = { approach: "", battle: "" };
  const selectedSequenceIds: Record<TrainerMusicTab, number | undefined> = {
    approach: model.assignments.find((assignment) => assignment.effectiveSequenceId !== undefined)?.effectiveSequenceId ?? model.themes[0]?.sequenceId,
    battle: battleModel.assignments.find((assignment) => assignment.currentSequenceId !== undefined)?.currentSequenceId ?? battleModel.themes[0]?.sequenceId,
  };
  let audioContext: AudioContext | undefined;
  let currentSource: AudioBufferSourceNode | undefined;
  let playingSequenceId: number | undefined;
  let playSerial = 0;
  let exportSerial = 0;
  let statusMessage = model.assignmentError ? "Playback and export are available, but approach-theme reassignment is disabled for this ARM9." : "Ready.";
  let statusError = false;

  root.innerHTML = renderEditorShell(model, battleModel);
  const inspector = root.querySelector<HTMLElement>(".trainer-music-inspector");
  const tableBody = root.querySelector<HTMLTableSectionElement>(".trainer-music-table-body");
  const resultCount = root.querySelector<HTMLElement>(".trainer-music-result-count");
  const searchInput = root.querySelector<HTMLInputElement>(".trainer-music-search");
  const warningSlot = root.querySelector<HTMLElement>(".trainer-music-warning-slot");
  const tableHead = root.querySelector<HTMLTableRowElement>(".trainer-music-table-head");
  if (!inspector || !tableBody || !resultCount || !searchInput || !warningSlot || !tableHead) throw new Error("Trainer Music editor shell is incomplete.");

  const currentSequenceId = (): number | undefined => selectedSequenceIds[activeTab];
  const trackLabel = (sequenceId: number | undefined): string =>
    activeTab === "approach" ? trainerMusicTrackLabel(model, sequenceId) : trainerBattleMusicTrackLabel(battleModel, sequenceId);

  const setStatus = (message: string, error = false): void => {
    statusMessage = message;
    statusError = error;
    const status = root.querySelector<HTMLElement>(".trainer-music-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("-error", error);
  };

  const updatePlayButtons = (): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-trainer-music-play]").forEach((button) => {
      const sequenceId = Number(button.dataset.trainerMusicPlay);
      const playing = sequenceId === playingSequenceId;
      button.textContent = playing ? button.dataset.stopLabel || "Stop" : button.dataset.playLabel || "Play";
      button.classList.toggle("-playing", playing);
    });
  };

  const stopPlayback = (message?: string): void => {
    playSerial += 1;
    const source = currentSource;
    currentSource = undefined;
    playingSequenceId = undefined;
    if (source) {
      try {
        source.stop();
      } catch {
        // Stopping an already-ended source is harmless.
      }
      source.disconnect();
    }
    updatePlayButtons();
    if (message) setStatus(message);
  };

  const ensureAudioContext = (): AudioContext => {
    if (audioContext) return audioContext;
    const AudioContextImpl = (window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext) as
      | AudioContextConstructor
      | undefined;
    if (!AudioContextImpl) throw new Error("This browser does not support Web Audio playback.");
    audioContext = new AudioContextImpl();
    return audioContext;
  };

  const renderInspector = (): void => {
    const sequenceId = currentSequenceId();
    inspector.innerHTML = renderSelectedTrack(model, battleModel, activeTab, sequenceId, statusMessage, statusError);
    inspector.querySelector<HTMLButtonElement>("[data-trainer-music-play]")?.addEventListener("click", () => {
      if (sequenceId !== undefined) void playSequence(sequenceId);
    });
    inspector.querySelector<HTMLButtonElement>(".trainer-music-export-wav")?.addEventListener("click", () => void exportWav());
    inspector.querySelector<HTMLButtonElement>(".trainer-music-export-native")?.addEventListener("click", () => void exportNative());
    updatePlayButtons();
  };

  const selectSequence = (sequenceId: number): void => {
    if (currentSource && playingSequenceId !== sequenceId) stopPlayback("Playback stopped.");
    selectedSequenceIds[activeTab] = sequenceId;
    renderInspector();
    renderRows();
  };

  const playSequence = async (sequenceId: number): Promise<void> => {
    if (playingSequenceId === sequenceId && currentSource) {
      stopPlayback("Playback stopped.");
      return;
    }
    stopPlayback();
    const serial = ++playSerial;
    try {
      const context = ensureAudioContext();
      if (context.state === "suspended") await context.resume();
      setStatus(`Rendering ${trackLabel(sequenceId)} preview…`);
      const pcm = await renderNitroSequencePcm(model.sdat, sequenceId, {
        maxSeconds: PREVIEW_SECONDS,
        sampleRate: PREVIEW_SAMPLE_RATE,
        cache: false,
      });
      if (destroyed || serial !== playSerial) return;
      if (!hasAudibleSamples(pcm)) throw new Error(`Sequence ${sequenceId} rendered silent audio.`);
      const buffer = context.createBuffer(2, pcm.length, pcm.sampleRate);
      buffer.getChannelData(0).set(pcm.left);
      buffer.getChannelData(1).set(pcm.right);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      currentSource = source;
      playingSequenceId = sequenceId;
      source.addEventListener("ended", () => {
        if (currentSource !== source) return;
        source.disconnect();
        currentSource = undefined;
        playingSequenceId = undefined;
        updatePlayButtons();
        setStatus(pcm.capped ? `Preview stopped at the ${PREVIEW_SECONDS}-second limit.` : "Playback finished.");
      });
      source.start();
      updatePlayButtons();
      setStatus(`Playing ${trackLabel(sequenceId)}.`);
    } catch (error) {
      if (destroyed || serial !== playSerial) return;
      stopPlayback();
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  };

  const exportWav = async (): Promise<void> => {
    const sequenceId = currentSequenceId();
    if (sequenceId === undefined) return;
    const displayName = trackLabel(sequenceId);
    const serial = ++exportSerial;
    setExportButtonsDisabled(true);
    setStatus("Finding and rendering the complete musical loop…");
    try {
      await nextPaint();
      const pcm = await renderNitroSequenceLoopPcm(model.sdat, sequenceId, {
        sampleRate: WAV_SAMPLE_RATE,
      });
      if (destroyed || serial !== exportSerial) return;
      downloadBytes(encodeNitroPcmWav(pcm), `${trainerMusicExportBaseName(model, sequenceId, displayName)}.wav`);
      const coverage = pcm.loop ? "intro plus one complete loop" : "complete non-looping sequence";
      setStatus(`WAV exported (${formatAudioDuration(pcm.duration)}, ${coverage}).`);
    } catch (error) {
      if (!destroyed && serial === exportSerial) setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (!destroyed && serial === exportSerial) setExportButtonsDisabled(false);
    }
  };

  const exportNative = async (): Promise<void> => {
    const sequenceId = currentSequenceId();
    if (sequenceId === undefined) return;
    const displayName = trackLabel(sequenceId);
    const serial = ++exportSerial;
    setExportButtonsDisabled(true);
    setStatus("Collecting native SSEQ, SBNK, and SWAR assets…");
    try {
      await nextPaint();
      const bytes = buildTrainerMusicNativeZip(model, sequenceId, displayName);
      if (destroyed || serial !== exportSerial) return;
      downloadBytes(bytes, `${trainerMusicExportBaseName(model, sequenceId, displayName)}-native.zip`);
      setStatus("Native asset ZIP exported.");
    } catch (error) {
      if (!destroyed && serial === exportSerial) setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (!destroyed && serial === exportSerial) setExportButtonsDisabled(false);
    }
  };

  const setExportButtonsDisabled = (disabled: boolean): void => {
    root.querySelectorAll<HTMLButtonElement>(".trainer-music-export-wav, .trainer-music-export-native").forEach((button) => {
      button.disabled = disabled;
    });
  };

  const renderRows = (): void => {
    if (activeTab === "approach") {
      const assignments = filterTrainerMusicAssignments(model, queries.approach);
      tableBody.innerHTML = assignments.map((assignment) => renderAssignmentRow(model, assignment, currentSequenceId())).join("");
      resultCount.textContent = `${assignments.length} of ${model.assignments.length} classes`;
    } else {
      const assignments = filterTrainerBattleMusicAssignments(battleModel, queries.battle);
      tableBody.innerHTML = assignments.map((assignment) => renderBattleAssignmentRow(battleModel, assignment, currentSequenceId())).join("");
      resultCount.textContent = `${assignments.length} of ${battleModel.assignments.length} groups`;
    }
    tableBody.querySelectorAll<HTMLButtonElement>("[data-trainer-music-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const sequenceId = Number(button.dataset.trainerMusicSelect);
        if (Number.isInteger(sequenceId)) selectSequence(sequenceId);
      });
    });
    tableBody.querySelectorAll<HTMLButtonElement>("[data-trainer-music-play]").forEach((button) => {
      button.addEventListener("click", () => {
        const sequenceId = Number(button.dataset.trainerMusicPlay);
        if (!Number.isInteger(sequenceId)) return;
        selectedSequenceIds[activeTab] = sequenceId;
        renderInspector();
        renderRows();
        void playSequence(sequenceId);
      });
    });
    tableBody.querySelectorAll<HTMLSelectElement>("[data-trainer-music-assignment]").forEach((select) => {
      select.addEventListener("change", () => {
        const trainerClassId = Number(select.dataset.trainerMusicAssignment);
        const sequenceId = Number(select.value);
        const assignment = model.assignments[trainerClassId];
        if (!assignment || !Number.isInteger(sequenceId)) return;
        stopPlayback();
        try {
          assignTrainerEyeTheme(project, model, assignment, sequenceId);
          selectedSequenceIds.approach = sequenceId;
          options.onDirty?.();
          renderInspector();
          renderRows();
          setStatus(`${assignment.trainerClassName} now uses ${trainerMusicTrackLabel(model, sequenceId)}.`);
        } catch (error) {
          renderRows();
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      });
    });
    tableBody.querySelectorAll<HTMLSelectElement>("[data-trainer-battle-assignment]").forEach((select) => {
      select.addEventListener("change", () => {
        const assignmentKey = select.dataset.trainerBattleAssignment;
        const sequenceId = Number(select.value);
        const assignment = battleModel.assignments.find((candidate) => candidate.key === assignmentKey);
        if (!assignment || !Number.isInteger(sequenceId)) return;
        stopPlayback();
        try {
          assignTrainerBattleTheme(project, battleModel, assignment, sequenceId);
          selectedSequenceIds.battle = sequenceId;
          options.onDirty?.();
          renderInspector();
          renderRows();
          setStatus(`${assignment.name} now uses ${trainerBattleMusicTrackLabel(battleModel, sequenceId)}.`);
        } catch (error) {
          renderRows();
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      });
    });
    updatePlayButtons();
  };

  searchInput.addEventListener("input", () => {
    queries[activeTab] = searchInput.value;
    renderRows();
  });

  const renderTabChrome = (): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-trainer-music-tab]").forEach((button) => {
      const selected = button.dataset.trainerMusicTab === activeTab;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    const error = activeTab === "approach" ? model.assignmentError : battleModel.assignmentError;
    warningSlot.innerHTML = error
      ? `<div class="trainer-music-warning"><strong>Reassignment unavailable</strong><span>${escapeHtml(error)}</span></div>`
      : "";
    const searchLabel = root.querySelector<HTMLElement>(".trainer-music-search-label");
    if (searchLabel) searchLabel.textContent = activeTab === "approach" ? "Find a trainer class or theme" : "Find a battle group or theme";
    searchInput.placeholder = activeTab === "approach" ? "Search classes, IDs, or themes…" : "Search groups, scope, or themes…";
    searchInput.value = queries[activeTab];
    tableHead.innerHTML = activeTab === "approach"
      ? "<th>Class</th><th>Approach theme</th><th>Preview</th><th>Assignment</th>"
      : "<th>Battle group</th><th>Battle theme</th><th>Preview</th><th>Assignment</th>";
  };

  root.querySelectorAll<HTMLButtonElement>("[data-trainer-music-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.trainerMusicTab;
      if ((nextTab !== "approach" && nextTab !== "battle") || nextTab === activeTab) return;
      stopPlayback();
      activeTab = nextTab;
      const error = activeTab === "approach" ? model.assignmentError : battleModel.assignmentError;
      statusMessage = error ? "Playback and export are available, but reassignment is disabled for this ROM layout." : "Ready.";
      statusError = false;
      renderTabChrome();
      renderInspector();
      renderRows();
    });
  });

  renderTabChrome();
  renderInspector();
  renderRows();

  return {
    destroy: () => {
      destroyed = true;
      exportSerial += 1;
      stopPlayback();
      void audioContext?.close();
      audioContext = undefined;
    },
  };
}

function renderEditorShell(model: TrainerMusicModel, battleModel: TrainerBattleMusicModel): string {
  const editableCount = model.assignments.filter((assignment) => assignment.editable).length;
  const editableBattleCount = battleModel.assignments.filter((assignment) => assignment.editable).length;
  return `
    <div class="trainer-music-page">
      <header class="trainer-music-page-header">
        <div>
          <div class="trainer-music-kicker">Gen 5 sound editor</div>
          <h1>Trainer Music</h1>
          <p>Preview, export, and reassign both trainer approach themes and the music used when trainer battles begin.</p>
        </div>
        <div class="trainer-music-page-summary">
          <span><strong>${model.themes.length}</strong> Eye themes</span>
          <span><strong>${editableCount}</strong> editable classes</span>
          <span><strong>${battleModel.themes.length}</strong> battle tracks</span>
          <span><strong>${editableBattleCount}</strong> battle groups</span>
        </div>
      </header>
      <div class="trainer-music-tabs" role="tablist" aria-label="Trainer music type">
        <button class="trainer-music-tab -active" type="button" role="tab" aria-selected="true" data-trainer-music-tab="approach">Approach Themes</button>
        <button class="trainer-music-tab" type="button" role="tab" aria-selected="false" data-trainer-music-tab="battle">Battle Themes</button>
      </div>
      <div class="trainer-music-warning-slot"></div>
      <div class="trainer-music-layout">
        <aside class="trainer-music-inspector"></aside>
        <section class="trainer-music-assignments">
          <div class="trainer-music-table-toolbar">
            <label>
              <span class="trainer-music-search-label">Find a trainer class or theme</span>
              <input class="trainer-music-search" type="search" placeholder="Search classes, IDs, or themes…" autocomplete="off">
            </label>
            <span class="trainer-music-result-count"></span>
          </div>
          <div class="trainer-music-table-wrap">
            <table class="trainer-music-table">
              <thead><tr class="trainer-music-table-head"><th>Class</th><th>Approach theme</th><th>Preview</th><th>Assignment</th></tr></thead>
              <tbody class="trainer-music-table-body"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderSelectedTrack(
  model: TrainerMusicModel,
  battleModel: TrainerBattleMusicModel,
  activeTab: TrainerMusicTab,
  sequenceId: number | undefined,
  status: string,
  statusError: boolean,
): string {
  if (sequenceId === undefined) {
    return `<div class="trainer-music-card"><h2>Selected theme</h2><p>No playable ${activeTab === "approach" ? "Trainer Eye" : "trainer battle"} themes were found.</p></div>`;
  }
  const sequence = model.sdat.sequenceInfos[sequenceId];
  const symbol = sequence?.symbol || model.sdat.sequenceSymbols[sequenceId] || `Sequence ${sequenceId}`;
  const bank = sequence ? model.sdat.bankInfos[sequence.bankId] : undefined;
  const waveArchiveCount = bank?.swarIds.filter((id, index, ids) => id !== 0xffff && ids.indexOf(id) === index).length ?? 0;
  const supported = (activeTab === "approach" ? model.themes : battleModel.themes).some((theme) => theme.sequenceId === sequenceId);
  const label = activeTab === "approach" ? trainerMusicTrackLabel(model, sequenceId) : trainerBattleMusicTrackLabel(battleModel, sequenceId);
  const disabled = sequence ? "" : " disabled";
  const tableNote = activeTab === "battle"
    ? "Battle assignments follow the game's battle-intro groups, so one change can affect several trainer types. The fallback row covers ordinary trainers without a dedicated group. Encounter animations are not modified."
    : model.project.session.baseRom === "BW"
      ? "Black and White store a sparse class mapping. Classes without a record use Eye 01 at runtime and remain read-only here."
      : "Black 2 and White 2 store one approach-theme record for each trainer class, so every displayed row can be reassigned.";
  return `
    <div class="trainer-music-card trainer-music-selected-card">
      <div class="trainer-music-card-heading">
        <div>
          <span>Selected ${activeTab === "approach" ? "approach" : "battle"} theme</span>
          <h2>${escapeHtml(label)}</h2>
        </div>
        <span class="trainer-music-badge ${supported ? "-supported" : "-unsupported"}">${supported ? "Assignable" : "Unsupported"}</span>
      </div>
      <dl class="trainer-music-metadata">
        <div><dt>Sequence</dt><dd>${sequenceId}</dd></div>
        <div><dt>Symbol</dt><dd><code>${escapeHtml(symbol)}</code></dd></div>
        <div><dt>Bank</dt><dd>${sequence ? sequence.bankId : "Unavailable"}</dd></div>
        <div><dt>Wave archives</dt><dd>${waveArchiveCount}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(model.sdat.sourcePath || "ROM SDAT")}</dd></div>
      </dl>
      <div class="trainer-music-primary-actions">
        <button class="btn -default trainer-music-preview-selected" type="button" data-trainer-music-play="${sequenceId}" data-play-label="Play ${PREVIEW_SECONDS}s preview" data-stop-label="Stop preview"${disabled}>Play ${PREVIEW_SECONDS}s preview</button>
      </div>
      <div class="trainer-music-export-actions">
        <button class="btn -default trainer-music-export-wav" type="button"${disabled}>Export Complete Loop WAV</button>
        <button class="btn -default trainer-music-export-native" type="button"${disabled}>Export Native ZIP</button>
      </div>
      <div class="trainer-music-status${statusError ? " -error" : ""}" aria-live="polite">${escapeHtml(status)}</div>
    </div>
    <div class="trainer-music-card trainer-music-help-card">
      <h3>About this table</h3>
      <p>${tableNote}</p>
      <p>WAV export includes the intro and one complete musical loop at 48 kHz. Native ZIPs include the selected theme's SSEQ, SBNK, referenced SWAR files, and metadata.</p>
    </div>
  `;
}

function renderAssignmentRow(
  model: TrainerMusicModel,
  assignment: TrainerMusicClassAssignment,
  selectedSequenceId: number | undefined,
): string {
  const sequenceId = assignment.effectiveSequenceId;
  const selected = sequenceId !== undefined && sequenceId === selectedSequenceId;
  const available = sequenceId !== undefined && Boolean(model.sdat.sequenceInfos[sequenceId]);
  const themeLabel = trainerMusicTrackLabel(model, sequenceId);
  const fallback = assignment.fallback
    ? `<span class="trainer-music-badge -fallback" title="${escapeHtml(assignment.readOnlyReason || "Uses the Black/White fallback")}">Fallback</span>`
    : "";
  const themeControl = sequenceId === undefined
    ? `<span class="trainer-music-unavailable">Unavailable</span>`
    : `<button class="trainer-music-track-link" type="button" data-trainer-music-select="${sequenceId}">${escapeHtml(themeLabel)}</button>`;
  const preview = available
    ? `<button class="btn -default trainer-music-row-play" type="button" data-trainer-music-play="${sequenceId}" data-play-label="Play" data-stop-label="Stop">Play</button>`
    : `<button class="btn -default trainer-music-row-play" type="button" disabled>Play</button>`;
  return `
    <tr class="${selected ? "-selected" : ""} ${assignment.editable ? "" : "-readonly"}">
      <td>
        <div class="trainer-music-class-name"><strong>${escapeHtml(assignment.trainerClassName)}</strong>${fallback}</div>
        <span class="trainer-music-class-id">Class ${assignment.trainerClassId}</span>
      </td>
      <td>${themeControl}</td>
      <td>${preview}</td>
      <td>${renderAssignmentControl(model, assignment)}</td>
    </tr>
  `;
}

function renderAssignmentControl(model: TrainerMusicModel, assignment: TrainerMusicClassAssignment): string {
  if (!assignment.editable) {
    return `<span class="trainer-music-readonly" title="${escapeHtml(assignment.readOnlyReason || "This assignment is read-only")}">Read-only</span>`;
  }
  const supported = model.themes.some((theme) => theme.sequenceId === assignment.currentSequenceId);
  const unsupportedOption =
    assignment.currentSequenceId !== undefined && !supported
      ? `<option value="${assignment.currentSequenceId}" selected>${escapeHtml(trainerMusicTrackLabel(model, assignment.currentSequenceId))}</option>`
      : "";
  return `
    <select class="trainer-music-assignment-select" data-trainer-music-assignment="${assignment.trainerClassId}" aria-label="Approach theme for ${escapeHtml(assignment.trainerClassName)}">
      ${unsupportedOption}
      ${model.themes
        .map(
          (theme) =>
            `<option value="${theme.sequenceId}"${theme.sequenceId === assignment.currentSequenceId ? " selected" : ""}>${escapeHtml(theme.displayName)} · ${theme.sequenceId}</option>`,
        )
        .join("")}
    </select>
  `;
}

function renderBattleAssignmentRow(
  model: TrainerBattleMusicModel,
  assignment: TrainerBattleMusicAssignment,
  selectedSequenceId: number | undefined,
): string {
  const sequenceId = assignment.currentSequenceId;
  const selected = sequenceId !== undefined && sequenceId === selectedSequenceId;
  const available = sequenceId !== undefined && Boolean(model.sdat.sequenceInfos[sequenceId]);
  const themeLabel = trainerBattleMusicTrackLabel(model, sequenceId);
  const fallback = assignment.fallback
    ? `<span class="trainer-music-badge -fallback">Fallback</span>`
    : "";
  const themeControl = sequenceId === undefined
    ? `<span class="trainer-music-unavailable">Unavailable</span>`
    : `<button class="trainer-music-track-link" type="button" data-trainer-music-select="${sequenceId}">${escapeHtml(themeLabel)}</button>`;
  const preview = available
    ? `<button class="btn -default trainer-music-row-play" type="button" data-trainer-music-play="${sequenceId}" data-play-label="Play" data-stop-label="Stop">Play</button>`
    : `<button class="btn -default trainer-music-row-play" type="button" disabled>Play</button>`;
  return `
    <tr class="${selected ? "-selected" : ""} ${assignment.editable ? "" : "-readonly"}">
      <td>
        <div class="trainer-music-class-name"><strong>${escapeHtml(assignment.name)}</strong>${fallback}</div>
        <span class="trainer-music-class-id">${assignment.groupIndex === undefined ? "Default fallback" : `Group ${assignment.groupIndex}`}</span>
        <span class="trainer-music-group-scope">${escapeHtml(assignment.scope)}</span>
      </td>
      <td>${themeControl}</td>
      <td>${preview}</td>
      <td>${renderBattleAssignmentControl(model, assignment)}</td>
    </tr>
  `;
}

function renderBattleAssignmentControl(model: TrainerBattleMusicModel, assignment: TrainerBattleMusicAssignment): string {
  if (!assignment.editable) {
    return `<span class="trainer-music-readonly" title="${escapeHtml(assignment.readOnlyReason || "This assignment is read-only")}">Read-only</span>`;
  }
  const supported = model.themes.some((theme) => theme.sequenceId === assignment.currentSequenceId);
  const unsupportedOption =
    assignment.currentSequenceId !== undefined && !supported
      ? `<option value="${assignment.currentSequenceId}" selected>${escapeHtml(trainerBattleMusicTrackLabel(model, assignment.currentSequenceId))}</option>`
      : "";
  return `
    <select class="trainer-music-assignment-select" data-trainer-battle-assignment="${escapeHtml(assignment.key)}" aria-label="Battle theme for ${escapeHtml(assignment.name)}"${model.themes.length === 0 ? " disabled" : ""}>
      ${unsupportedOption}
      ${model.themes
        .map(
          (theme) =>
            `<option value="${theme.sequenceId}"${theme.sequenceId === assignment.currentSequenceId ? " selected" : ""}>${escapeHtml(theme.displayName)} · ${theme.sequenceId}</option>`,
        )
        .join("")}
    </select>
  `;
}

function renderLoadingState(): string {
  return `
    <div class="trainer-music-page trainer-music-state">
      <div class="trainer-music-state-card"><div class="trainer-music-kicker">Gen 5 sound editor</div><h1>Trainer Music</h1><p>Loading the ROM sound archive and trainer-class assignments…</p></div>
    </div>
  `;
}

function renderLoadError(message: string): string {
  return `
    <div class="trainer-music-page trainer-music-state">
      <div class="trainer-music-state-card -error"><div class="trainer-music-kicker">Trainer Music unavailable</div><h1>Could not load sound data</h1><p>${escapeHtml(message)}</p><p>Reload the original ROM if this saved project no longer includes its SDAT.</p></div>
    </div>
  `;
}

function hasAudibleSamples(pcm: NitroRenderedPcm): boolean {
  const stride = Math.max(1, Math.floor(pcm.length / 2048));
  for (let index = 0; index < pcm.length; index += stride) {
    if (Math.abs(pcm.left[index]) > 0.0001 || Math.abs(pcm.right[index]) > 0.0001) return true;
  }
  return false;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function formatAudioDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}
