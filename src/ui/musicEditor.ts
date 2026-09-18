import { loadNitroSdatFromProject, type NitroSdat } from "../pokeweb/nitroSound";
import { detectBundledBgmToggleDll } from "../pokeweb/pmcModel";
import { getStreamedBgmConfigs, type ProjectState, type StreamedBgmConfig } from "../pokeweb/projectStore";
import {
  buildMusicReference,
  filterMusicReference,
  MUSIC_REFERENCE_CATEGORIES,
  type MusicReferenceEntry,
  type MusicReferenceFilter,
} from "../pokeweb/musicReference";
import {
  decodeAudioFile,
  detectStreamedBgmStatus,
  installStreamedBgm,
  removeStreamedBgm,
  streamedBgmEncodingLabel,
  updateStreamedBgmRuntime,
  type StreamedBgmEncoding,
  type StereoPcm,
} from "../pokeweb/streamedBgmModel";
import { escapeHtml } from "./dom";

type StreamedBgmDraft = {
  sequences?: Array<{ id: number; symbol: string }>;
  hydrating?: boolean;
  pcm?: StereoPcm;
  sourceName?: string;
  previewUrl?: string;
  targetSequenceId: number;
  encoding: StreamedBgmEncoding;
  loopStartSeconds: number;
  loopEndSeconds?: number;
  shortcutEnabled: boolean;
  message?: string;
  referenceSearch?: string;
  referenceCategory?: MusicReferenceFilter;
  busy?: boolean;
};

const streamedBgmDrafts = new WeakMap<ProjectState, StreamedBgmDraft>();

export function listMusicEditorSequences(
  sdat: Pick<NitroSdat, "sequenceInfos" | "sequenceSymbols">,
): Array<{ id: number; symbol: string }> {
  const sequences: Array<{ id: number; symbol: string }> = [];
  for (let index = 0; index < sdat.sequenceInfos.length; index += 1) {
    const entry = sdat.sequenceInfos[index];
    if (!entry) continue;
    const symbol = entry.symbol ?? sdat.sequenceSymbols[entry.id] ?? `SEQ_${entry.id}`;
    if (!symbol.startsWith("SEQ_BGM_")) continue;
    sequences.push({
      id: entry.id,
      symbol,
    });
  }
  return sequences;
}

export function renderStreamedBgmEncodingOptions(selected: StreamedBgmEncoding): string {
  return `
    <option value="adpcm" ${selected === "adpcm" ? "selected" : ""}>Recommended — Stereo IMA ADPCM (~75% smaller)</option>
    <option value="pcm16" ${selected === "pcm16" ? "selected" : ""}>Maximum quality — Stereo PCM16</option>`;
}

function getStreamedBgmDraft(project: ProjectState): StreamedBgmDraft {
  let draft = streamedBgmDrafts.get(project);
  if (!draft) {
    const installed = getStreamedBgmConfigs(project)[0];
    draft = {
      targetSequenceId: installed?.targetSequenceId ?? 0,
      encoding: installed?.encoding ?? (installed ? "pcm16" : "adpcm"),
      loopStartSeconds: installed ? installed.loopStartSample / installed.sampleRate : 0,
      loopEndSeconds: installed ? installed.loopEndSample / installed.sampleRate : undefined,
      shortcutEnabled: installed?.toggleEnabled ?? detectBundledBgmToggleDll(project) === "patched",
    };
    streamedBgmDrafts.set(project, draft);
  }
  return draft;
}

function hydrateSequenceList(project: ProjectState, root: HTMLElement, onDirty: () => void, draft: StreamedBgmDraft): void {
  if (draft.hydrating || draft.sequences || project.session.baseRom !== "BW2") return;
  draft.hydrating = true;
  const hadStreamedState = Boolean(project.codeInjection?.streamedBgms);
  void Promise.all([loadNitroSdatFromProject(project), detectStreamedBgmStatus(project)])
    .then(([sdat, detected]) => {
      draft.sequences = listMusicEditorSequences(sdat);
      const installed = getStreamedBgmConfigs(project)[0];
      if (installed) {
        draft.shortcutEnabled = installed.toggleEnabled;
        if (!hadStreamedState) {
          draft.targetSequenceId = installed.targetSequenceId;
          draft.encoding = installed.encoding ?? "pcm16";
          draft.loopStartSeconds = installed.loopStartSample / installed.sampleRate;
          draft.loopEndSeconds = installed.loopEndSample / installed.sampleRate;
        }
      }
      if (!draft.sequences.some((entry) => entry.id === draft.targetSequenceId)) {
        draft.targetSequenceId = draft.sequences[0]?.id ?? 0;
        draft.encoding = "adpcm";
      }
      draft.message = undefined;
      if (!hadStreamedState && detected.installed) onDirty();
    })
    .catch((error) => {
      draft.message = error instanceof Error ? error.message : String(error);
      draft.sequences = [];
    })
    .finally(() => {
      draft.hydrating = false;
      if (root.isConnected) renderMusicEditor(project, root, onDirty);
    });
}

export function renderMusicEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const draft = getStreamedBgmDraft(project);
  hydrateSequenceList(project, root, onDirty, draft);

  const configs = getStreamedBgmConfigs(project);
  const config = configs.find((entry) => entry.targetSequenceId === draft.targetSequenceId);
  const configTargetIsBgm = !config || Boolean(config.targetSequenceSymbol?.startsWith("SEQ_BGM_"));
  const supported = project.session.baseRom === "BW2" && (project.session.baseVersion === "B2" || project.session.baseVersion === "W2");
  const duration = draft.pcm ? draft.pcm.left.length / draft.pcm.sampleRate : undefined;
  const loopEnd = draft.loopEndSeconds ?? duration;
  const plannedEncoding = draft.encoding;
  const selectedSequence = draft.sequences?.find((entry) => entry.id === draft.targetSequenceId);

  root.innerHTML = `
    <section class="music-editor-page">
      <aside class="music-editor-sidebar">
        <div class="music-editor-kicker">Gen 5 sound editor</div>
        <h1>Music</h1>
        <p>Import mixed audio tracks for Black 2 or White 2 background music. Each sequence can have its own replacement.</p>
        <div class="music-editor-sidebar__summary">
          <span>Installed replacements</span>
          <strong>${configs.length} track${configs.length === 1 ? "" : "s"}</strong>
          <small>${configs.length ? `${(configs.reduce((total, entry) => total + entry.encodedBytes, 0) / 0x10_0000).toFixed(2)} MiB of audio · one shared playback buffer` : "The original SDAT is unchanged."}</small>
        </div>
      </aside>
      <main class="music-editor-main">
        <section class="code-injection-panel music-editor-panel music-editor-primary-panel">
          <h2>Streamed BGM Replacement</h2>
          <div class="code-injection-actions streamed-bgm-controls">
            <label>Target BGM sequence
              <input id="streamed-bgm-target" type="text" list="streamed-bgm-sequences" value="${draft.targetSequenceId}${selectedSequence ? ` — ${escapeHtml(selectedSequence.symbol)}` : ""}" ${supported ? "" : "disabled"} />
            </label>
            <datalist id="streamed-bgm-sequences">
              ${(draft.sequences ?? []).map((entry) => `<option value="${entry.id} — ${escapeHtml(entry.symbol)}"></option>`).join("")}
            </datalist>
            <label>MP3 or WAV
              <input id="streamed-bgm-file" type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" ${supported ? "" : "disabled"} />
            </label>
            ${draft.previewUrl ? `<audio id="streamed-bgm-preview" controls preload="metadata" src="${escapeHtml(draft.previewUrl)}"></audio>` : ""}
            <label>Storage encoding
              <select id="streamed-bgm-encoding" ${supported ? "" : "disabled"}>
                ${renderStreamedBgmEncodingOptions(plannedEncoding)}
              </select>
              <small class="streamed-bgm-encoding-help">Saved separately for this target. Both formats play at 32,728 Hz through BW2's native stream player.</small>
            </label>
            <div class="streamed-bgm-loop-grid">
              <label>Loop start (seconds)<input id="streamed-bgm-loop-start" type="number" min="0" step="0.001" value="${draft.loopStartSeconds.toFixed(3)}" ${supported ? "" : "disabled"} /></label>
              <label>Loop end (seconds)<input id="streamed-bgm-loop-end" type="number" min="0" step="0.001" value="${loopEnd?.toFixed(3) ?? ""}" placeholder="Full track" ${supported ? "" : "disabled"} /></label>
            </div>
            <label class="streamed-bgm-shortcut"><input id="streamed-bgm-shortcut" type="checkbox" ${draft.shortcutEnabled ? "checked" : ""} ${supported ? "" : "disabled"} /> Enable L + R + Select music mute (global; saved on import)</label>
            <div class="music-editor-buttons">
              <button class="btn -primary" id="install-streamed-bgm-btn" type="button" ${supported && draft.pcm ? "" : "disabled"}>${config ? "Update Selected Replacement" : "Add Replacement"}</button>
              <button class="btn" id="update-streamed-bgm-runtime-btn" type="button" ${supported && configs.length ? "" : "disabled"}>Update Music Runtime</button>
              <button class="btn -default" id="remove-streamed-bgm-btn" type="button" ${config ? "" : "disabled"}>Remove Selected Replacement</button>
            </div>
            <div class="code-injection-note" id="streamed-bgm-note">${escapeHtml(draft.message ?? (config ? (configTargetIsBgm ? `${config.sourceName} is installed. Removing it restores only the verified replacement data.` : `This older installation targets non-BGM sequence ${config.targetSequenceId} (${config.targetSequenceSymbol ?? "unknown"}). Choose a SEQ_BGM target, import the audio again, and reconfigure it before testing.`) : draft.hydrating ? "Loading SDAT background-music sequence names…" : "Choose a SEQ_BGM target and import MP3 or WAV audio. Full-track looping is the default."))}</div>
          </div>
        </section>
        <section class="code-injection-panel music-editor-panel music-editor-installed-panel" aria-labelledby="installed-music-title">
          <h2 id="installed-music-title">Installed replacements (${configs.length})</h2>
          <p>Select a target to import new audio for it, or remove it individually. Other replacements are retained. Size estimates exclude small archive/runtime overhead.</p>
          <div class="music-reference-scroll" tabindex="0" role="region" aria-label="Installed music replacements">
            <table class="music-reference-table">
              <thead><tr><th scope="col">Target / source</th><th scope="col">Loop / encoded size</th><th scope="col">Actions</th></tr></thead>
              <tbody>${renderInstalledMusicRows(configs)}</tbody>
            </table>
          </div>
          ${configs.length > 1 ? `<button class="btn -default" id="remove-all-streamed-bgm-btn" type="button">Remove All Replacements</button>` : ""}
        </section>
        ${renderMusicReferencePanel(draft, supported)}
      </main>
    </section>
  `;

  installMusicEditorInteractions(project, root, onDirty, draft);
  if (draft.busy || draft.hydrating) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach((element) => { element.disabled = true; });
  }
}

export function renderInstalledMusicRows(configs: readonly StreamedBgmConfig[]): string {
  if (!configs.length) return `<tr><td colspan="3">No replacements installed.</td></tr>`;
  return [...configs].sort((a, b) => a.targetSequenceId - b.targetSequenceId).map((config) => `<tr>
    <th scope="row"><strong>${config.targetSequenceId} · ${escapeHtml(config.targetSequenceSymbol ?? "Unnamed sequence")}</strong><small>${escapeHtml(config.sourceName)}</small></th>
    <td>${(config.loopStartSample / config.sampleRate).toFixed(3)}–${(config.loopEndSample / config.sampleRate).toFixed(3)} s<small>${(config.encodedBytes / 0x10_0000).toFixed(2)} MiB · ${streamedBgmEncodingLabel(config.encoding ?? "pcm16")}</small></td>
    <td><button class="btn" type="button" data-music-select="${config.targetSequenceId}" aria-label="Select replacement ${config.targetSequenceId}">Select</button>
      <button class="btn -default" type="button" data-music-remove="${config.targetSequenceId}" aria-label="Remove replacement ${config.targetSequenceId}">Remove</button></td>
  </tr>`).join("");
}

export function renderMusicReferenceRows(entries: readonly MusicReferenceEntry[], selectedId: number): string {
  if (!entries.length) return `<tr><td colspan="3" class="music-reference-empty">No matching tracks. Try a location, trainer, numeric ID, or sequence symbol.</td></tr>`;
  return entries.map((entry) => `
    <tr>
      <th scope="row"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(MUSIC_REFERENCE_CATEGORIES[entry.category])}</small></th>
      <td><div class="music-reference-tracks">${entry.tracks.map((track) => `
        <div>
          <button type="button" class="music-reference-id" data-music-reference-id="${track.id}" aria-pressed="${track.id === selectedId}" aria-label="Use ${track.id} for ${escapeHtml(entry.title)}${track.label ? ` — ${escapeHtml(track.label)}` : ""}" title="Select ${escapeHtml(track.symbol)}">
            <strong>${track.id}</strong>${track.label ? ` <span>${escapeHtml(track.label)}</span>` : ""}
          </button>
          <code>${escapeHtml(track.symbol)}</code>
        </div>`).join("")}</div></td>
      <td>${escapeHtml(entry.description)}</td>
    </tr>`).join("");
}

function renderMusicReferencePanel(draft: StreamedBgmDraft, supported: boolean): string {
  if (!supported) return "";
  const entries = buildMusicReference(draft.sequences ?? []);
  const selectedCategory = draft.referenceCategory ?? "cities";
  const matches = filterMusicReference(entries, draft.referenceSearch ?? "", selectedCategory);
  const categoryLabel = selectedCategory === "all" ? "All tracks" : MUSIC_REFERENCE_CATEGORIES[selectedCategory];
  return `
    <section class="code-injection-panel music-editor-panel music-reference-panel" aria-labelledby="music-reference-title">
      <h2 id="music-reference-title">Music ID reference</h2>
      <p>Find overworld and battle tracks by name. Click an ID to set the replacement target above; this does not install anything.</p>
      <div class="music-reference-tabs" role="tablist" aria-label="Music categories">
        <button type="button" class="music-reference-tab ${selectedCategory === "all" ? "-active" : ""}" role="tab" aria-selected="${selectedCategory === "all"}" aria-controls="music-reference-table-panel" data-music-reference-category="all">All tracks</button>
        ${Object.entries(MUSIC_REFERENCE_CATEGORIES).map(([value, label]) => `<button type="button" class="music-reference-tab ${selectedCategory === value ? "-active" : ""}" role="tab" aria-selected="${selectedCategory === value}" aria-controls="music-reference-table-panel" data-music-reference-category="${value}">${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="music-reference-filters">
        <label>Search tracks
          <input id="music-reference-search" type="search" placeholder="Try Pokémon Center, Route 19, Hugh, or 1128" value="${escapeHtml(draft.referenceSearch ?? "")}" />
        </label>
      </div>
      <p class="music-reference-caution">Default BW2 uses; ROM hacks and scripted events can change these. IDs come from this ROM's SDAT. Shared IDs affect every location or battle using that sequence. Seasonal, version, low-HP and victory tracks are separate targets; add a replacement for each ID you want to change.</p>
      <p id="music-reference-status" role="status">${draft.hydrating ? "Loading music IDs…" : `${matches.length} ${categoryLabel.toLocaleLowerCase()} reference groups`}</p>
      <div id="music-reference-table-panel" class="music-reference-scroll" tabindex="0" role="tabpanel" aria-label="${escapeHtml(categoryLabel)} music ID reference table">
        <table class="music-reference-table">
          <caption>Black 2 / White 2 · ${escapeHtml(categoryLabel)} sequence IDs</caption>
          <thead><tr><th scope="col">Location / battle</th><th scope="col">ID · click to select</th><th scope="col">Used for / notes</th></tr></thead>
          <tbody id="music-reference-rows">${draft.hydrating ? `<tr><td colspan="3" class="music-reference-empty">Loading SDAT sequence names…</td></tr>` : renderMusicReferenceRows(matches, draft.targetSequenceId)}</tbody>
        </table>
      </div>
    </section>`;
}

function installMusicEditorInteractions(project: ProjectState, root: HTMLElement, onDirty: () => void, draft: StreamedBgmDraft): void {
  const runEdit = async (operation: () => Promise<void>) => {
    if (draft.busy) return;
    draft.busy = true;
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach((element) => { element.disabled = true; });
    try {
      await operation();
      onDirty();
    } catch (error) {
      draft.message = error instanceof Error ? error.message : String(error);
    } finally {
      draft.busy = false;
      renderMusicEditor(project, root, onDirty);
    }
  };
  const updateRuntimeButton = root.querySelector<HTMLButtonElement>("#update-streamed-bgm-runtime-btn");
  updateRuntimeButton?.addEventListener("click", async () => {
    await runEdit(async () => {
      await updateStreamedBgmRuntime(project);
      draft.message = "Music runtime updated. All audio, loops, and mute settings were preserved. Fresh-boot the exported ROM to use it.";
    });
  });
  const fileInput = root.querySelector<HTMLInputElement>("#streamed-bgm-file");
  const targetInput = root.querySelector<HTMLInputElement>("#streamed-bgm-target");
  const encodingSelect = root.querySelector<HTMLSelectElement>("#streamed-bgm-encoding");
  const loopStartInput = root.querySelector<HTMLInputElement>("#streamed-bgm-loop-start");
  const loopEndInput = root.querySelector<HTMLInputElement>("#streamed-bgm-loop-end");
  const shortcutInput = root.querySelector<HTMLInputElement>("#streamed-bgm-shortcut");
  const installButton = root.querySelector<HTMLButtonElement>("#install-streamed-bgm-btn");
  const removeButton = root.querySelector<HTMLButtonElement>("#remove-streamed-bgm-btn");
  const note = root.querySelector<HTMLDivElement>("#streamed-bgm-note");
  const referenceEntries = buildMusicReference(draft.sequences ?? []);
  const referenceSearch = root.querySelector<HTMLInputElement>("#music-reference-search");
  const referenceTabs = root.querySelectorAll<HTMLButtonElement>("[data-music-reference-category]");
  const referenceRows = root.querySelector<HTMLTableSectionElement>("#music-reference-rows");
  const referenceStatus = root.querySelector<HTMLElement>("#music-reference-status");
  const referenceTablePanel = root.querySelector<HTMLElement>("#music-reference-table-panel");

  const selectedReferenceCategory = () => draft.referenceCategory ?? "cities";
  const refreshReferenceTabs = () => {
    const selected = selectedReferenceCategory();
    referenceTabs.forEach((tab) => {
      const active = tab.dataset.musicReferenceCategory === selected;
      tab.classList.toggle("-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    const categoryLabel = selected === "all" ? "All tracks" : MUSIC_REFERENCE_CATEGORIES[selected];
    if (referenceTablePanel) referenceTablePanel.setAttribute("aria-label", `${categoryLabel} music ID reference table`);
  };

  const refreshReferenceSelection = () => {
    referenceRows?.querySelectorAll<HTMLButtonElement>("[data-music-reference-id]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.musicReferenceId) === draft.targetSequenceId));
    });
  };
  const filterReference = () => {
    draft.referenceSearch = referenceSearch?.value ?? "";
    const category = selectedReferenceCategory();
    const matches = filterMusicReference(referenceEntries, draft.referenceSearch, category);
    if (referenceRows) referenceRows.innerHTML = renderMusicReferenceRows(matches, draft.targetSequenceId);
    const categoryLabel = category === "all" ? "All tracks" : MUSIC_REFERENCE_CATEGORIES[category];
    if (referenceStatus) referenceStatus.textContent = `${matches.length} ${categoryLabel.toLocaleLowerCase()} reference groups`;
  };
  referenceSearch?.addEventListener("input", filterReference);
  referenceTabs.forEach((tab) => tab.addEventListener("click", () => {
    const category = tab.dataset.musicReferenceCategory;
    if (!category) return;
    draft.referenceCategory = category as MusicReferenceFilter;
    refreshReferenceTabs();
    filterReference();
  }));
  referenceRows?.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-music-reference-id]");
    if (!button || !referenceRows.contains(button) || !targetInput || targetInput.disabled) return;
    const sequence = draft.sequences?.find((item) => item.id === Number(button.dataset.musicReferenceId));
    if (!sequence) return;
    targetInput.value = `${sequence.id} — ${sequence.symbol}`;
    updateInputs();
    if (referenceStatus) referenceStatus.textContent = `Selected ${sequence.id} — ${sequence.symbol}. Import audio and use Add / Update Selected Replacement above to apply it.`;
  });

  const updateInputs = () => {
    const target = Number.parseInt(targetInput?.value ?? "", 10);
    const targetChanged = Number.isInteger(target) && target !== draft.targetSequenceId;
    if (Number.isInteger(target)) draft.targetSequenceId = target;
    refreshReferenceSelection();
    const loopStart = Number(loopStartInput?.value);
    if (Number.isFinite(loopStart)) draft.loopStartSeconds = loopStart;
    const loopEndText = loopEndInput?.value.trim() ?? "";
    draft.loopEndSeconds = loopEndText ? Number(loopEndText) : undefined;
    draft.shortcutEnabled = shortcutInput?.checked ?? false;
    const installed = getStreamedBgmConfigs(project).find((entry) => entry.targetSequenceId === draft.targetSequenceId);
    if (targetChanged) {
      draft.encoding = installed?.encoding ?? (installed ? "pcm16" : "adpcm");
      if (encodingSelect) encodingSelect.value = draft.encoding;
    } else if (encodingSelect?.value === "adpcm" || encodingSelect?.value === "pcm16") {
      draft.encoding = encodingSelect.value;
    }
    if (installButton) installButton.textContent = installed ? "Update Selected Replacement" : "Add Replacement";
    if (removeButton) removeButton.disabled = !installed;
  };

  targetInput?.addEventListener("input", updateInputs);
  targetInput?.addEventListener("change", updateInputs);
  encodingSelect?.addEventListener("change", updateInputs);
  loopStartInput?.addEventListener("input", updateInputs);
  loopEndInput?.addEventListener("input", updateInputs);
  shortcutInput?.addEventListener("change", updateInputs);

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await runEdit(async () => {
      updateInputs();
      fileInput.disabled = true;
      if (note) note.textContent = `Decoding and resampling ${file.name}…`;
      const pcm = await decodeAudioFile(file);
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      draft.pcm = pcm;
      draft.sourceName = file.name;
      draft.previewUrl = URL.createObjectURL(file);
      draft.loopStartSeconds = 0;
      draft.loopEndSeconds = pcm.left.length / pcm.sampleRate;
      draft.message = `${file.name} decoded to ${pcm.left.length.toLocaleString()} stereo samples.`;
    });
  });

  installButton?.addEventListener("click", async () => {
    await runEdit(async () => {
      updateInputs();
      if (!draft.pcm || !draft.sourceName) throw new Error("Import an MP3 or WAV file first.");
      const sequence = draft.sequences?.find((entry) => entry.id === draft.targetSequenceId);
      if (!sequence) throw new Error("Choose a valid target sequence from the SDAT list.");
      installButton.disabled = true;
      installButton.textContent = "Installing…";
      if (note) note.textContent = "Encoding the native stream, rebuilding SDAT, configuring the runtime, and validating ROM capacity.";
      await installStreamedBgm(project, {
        sourceName: draft.sourceName,
        pcm: draft.pcm,
        targetSequenceId: sequence.id,
        targetSequenceSymbol: sequence.symbol,
        encoding: draft.encoding,
        loopStartSeconds: draft.loopStartSeconds,
        loopEndSeconds: draft.loopEndSeconds,
        shortcutEnabled: draft.shortcutEnabled,
      });
      draft.message = `${draft.sourceName} is staged for sequence ${sequence.id} (${sequence.symbol}).`;
    });
  });

  const remove = (id?: number) => runEdit(async () => {
    if (note) note.textContent = "Verifying replacement data and restoring original sequence references…";
    await removeStreamedBgm(project, id);
    draft.message = id === undefined ? "All replacements removed; the mute shortcut was preserved." : `Replacement ${id} removed. Other tracks and the mute shortcut were preserved.`;
  });
  removeButton?.addEventListener("click", () => { void remove(draft.targetSequenceId); });
  root.querySelectorAll<HTMLButtonElement>("[data-music-remove]").forEach((button) => {
    button.addEventListener("click", () => { void remove(Number(button.dataset.musicRemove)); });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-music-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.musicSelect);
      const sequence = draft.sequences?.find((entry) => entry.id === id);
      if (!targetInput) return;
      targetInput.value = `${id}${sequence ? ` — ${sequence.symbol}` : ""}`;
      updateInputs();
      targetInput.focus();
    });
  });
  root.querySelector("#remove-all-streamed-bgm-btn")?.addEventListener("click", () => {
    if (globalThis.confirm("Remove all custom music replacements and restore their original tracks?")) void remove();
  });
}
