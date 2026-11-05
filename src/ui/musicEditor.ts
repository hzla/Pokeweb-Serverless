import {
  encodeNitroPcmWav,
  loadNitroSdatFromProject,
  renderNitroSequencePcm,
  type NitroRenderedPcm,
  type NitroSdat,
} from "../pokeweb/nitroSound";
import { detectBundledBgmToggleDll } from "../pokeweb/pmcModel";
import {
  getNativeStreamReplacementConfigs,
  getStandaloneStreamConfigs,
  getStreamedBgmConfigs,
  type NativeStreamReplacementConfig,
  type ProjectState,
  type StandaloneStreamConfig,
  type StreamedBgmConfig,
} from "../pokeweb/projectStore";
import {
  buildMusicReference,
  filterMusicReference,
  MUSIC_REFERENCE_CATEGORIES,
  type MusicReferenceEntry,
  type MusicReferenceFilter,
} from "../pokeweb/musicReference";
import {
  decodeAudioFile,
  decodeNativeSdatStreamPcm,
  detectStreamedBgmStatus,
  installNativeStreamReplacement,
  installStandaloneStream,
  installStreamedBgm,
  listNativeSdatStreams,
  removeNativeStreamReplacement,
  removeLastStandaloneStream,
  removeStreamedBgm,
  streamedBgmEncodingLabel,
  updateStreamedBgmRuntime,
  type NativeSdatStream,
  type StreamedBgmEncoding,
  type StereoPcm,
} from "../pokeweb/streamedBgmModel";
import { escapeHtml } from "./dom";
import { renderRuntimeReleaseTimestamp } from "./runtimeReleaseTimestamp";
import "../styles/moveData.css";

type StreamedBgmDraft = {
  activeTab: MusicEditorTab;
  sequences?: Array<{ id: number; symbol: string }>;
  nativeStreams?: NativeSdatStream[];
  hydrating?: boolean;
  pcm?: StereoPcm;
  sourceName?: string;
  previewUrl?: string;
  currentTrackPreviewUrl?: string;
  targetSequenceId: number;
  encoding: StreamedBgmEncoding;
  trimStartSeconds: number;
  loopStartSeconds: number;
  loopEndSeconds?: number;
  shortcutEnabled: boolean;
  message?: string;
  referenceSearch?: string;
  referenceCategory?: MusicReferenceFilter;
  nativePcm?: StereoPcm;
  nativeSourceName?: string;
  nativePreviewUrl?: string;
  nativeCurrentTrackPreviewUrl?: string;
  nativeStreamId: number;
  nativeEncoding: StreamedBgmEncoding;
  nativeLoop: boolean;
  nativeTrimStartSeconds: number;
  nativeLoopStartSeconds: number;
  nativeLoopEndSeconds?: number;
  nativeMessage?: string;
  nativeReferenceSearch?: string;
  nativeReferenceCategory?: NativeStreamReferenceCategory;
  nativeInitialized?: boolean;
  standalonePcm?: StereoPcm;
  standaloneSourceName?: string;
  standaloneName: string;
  standalonePreviewUrl?: string;
  standaloneEncoding: StreamedBgmEncoding;
  standaloneLoop: boolean;
  standaloneTrimStartSeconds: number;
  standaloneTrimEndSeconds?: number;
  standaloneLoopStartSeconds: number;
  standaloneMessage?: string;
  standaloneSelection?: number | "new";
  toolsOpen?: boolean;
  bgmFilter?: MusicReferenceFilter | "replaced";
  busy?: boolean;
};

const MUSIC_EDITOR_TABS = ["bgm", "streamed", "standalone"] as const;
export type MusicEditorTab = typeof MUSIC_EDITOR_TABS[number];
const MUSIC_EDITOR_TAB_LABELS: Record<MusicEditorTab, string> = {
  bgm: "Music",
  streamed: "Streams",
  standalone: "New songs",
};

export function renderMusicEditorTabs(activeTab: MusicEditorTab, availableTabs: readonly MusicEditorTab[] = MUSIC_EDITOR_TABS): string {
  return availableTabs.map((tab) => `<button type="button" id="music-editor-tab-${tab}" class="uv-tab" role="tab" aria-controls="music-detail" aria-selected="${activeTab === tab}" tabindex="${activeTab === tab ? "0" : "-1"}" data-music-editor-tab="${tab}">${MUSIC_EDITOR_TAB_LABELS[tab]}</button>`).join("");
}

export function nextMusicEditorTab(current: MusicEditorTab, key: string, availableTabs: readonly MusicEditorTab[] = MUSIC_EDITOR_TABS): MusicEditorTab | undefined {
  const index = availableTabs.indexOf(current);
  if (index < 0 || !availableTabs.length) return undefined;
  if (key === "ArrowRight") return availableTabs[(index + 1) % availableTabs.length];
  if (key === "ArrowLeft") return availableTabs[(index + availableTabs.length - 1) % availableTabs.length];
  if (key === "Home") return availableTabs[0];
  if (key === "End") return availableTabs[availableTabs.length - 1];
  return undefined;
}

export const NATIVE_STREAM_REFERENCE_CATEGORIES = {
  title: "Title & opening",
  custom: "Custom replacements",
  other: "Other streams",
} as const;

export type NativeStreamReferenceCategory = keyof typeof NATIVE_STREAM_REFERENCE_CATEGORIES | "all";

export type NativeStreamReferenceEntry = {
  stream: NativeSdatStream;
  category: Exclude<NativeStreamReferenceCategory, "all">;
  title: string;
  description: string;
  managedSequenceId?: number;
  managedStandalone?: boolean;
};

const streamedBgmDrafts = new WeakMap<ProjectState, StreamedBgmDraft>();
const CURRENT_TRACK_PREVIEW_SECONDS = 15;

function createPcmPreviewUrl(pcm: Pick<StereoPcm, "sampleRate" | "left" | "right">): string {
  const length = Math.min(pcm.left.length, pcm.right.length);
  const rendered: NitroRenderedPcm = {
    sampleRate: pcm.sampleRate,
    length,
    duration: length / pcm.sampleRate,
    numberOfChannels: 2,
    left: pcm.left.subarray(0, length),
    right: pcm.right.subarray(0, length),
    capped: false,
  };
  const wav = encodeNitroPcmWav(rendered);
  const buffer = new ArrayBuffer(wav.byteLength);
  new Uint8Array(buffer).set(wav);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

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
    <option value="adpcm" ${selected === "adpcm" ? "selected" : ""}>ADPCM, ~75% smaller</option>
    <option value="pcm16" ${selected === "pcm16" ? "selected" : ""}>Maximum quality (PCM16)</option>`;
}

export function buildNativeStreamReference(
  streams: readonly NativeSdatStream[],
  mappings: readonly StreamedBgmConfig[],
  standalone: readonly StandaloneStreamConfig[] = [],
): NativeStreamReferenceEntry[] {
  return streams.map((stream) => {
    const mapping = mappings.find((entry) => entry.streamId === stream.id);
    if (mapping) {
      return {
        stream,
        category: "custom",
        title: `Sequence ${mapping.targetSequenceId}`,
        description: `${mapping.targetSequenceSymbol ?? "Unnamed BGM"} · ${mapping.sourceName}`,
        managedSequenceId: mapping.targetSequenceId,
      };
    }
    const custom = standalone.find((entry) => entry.streamId === stream.id);
    if (custom) return {
      stream, category: "custom", title: custom.name,
      description: `Standalone song · ${custom.sourceName}`,
      managedStandalone: true,
    };
    if (stream.symbol === "STRM_TITLE") {
      return {
        stream,
        category: "title",
        title: "Title screen",
        description: "Opening/title presentation music. This is played directly as a native stream, not as a SEQ_BGM sequence.",
      };
    }
    return {
      stream,
      category: "other",
      title: stream.symbol,
      description: "Native streamed audio found in this ROM's SDAT.",
    };
  });
}

export function filterNativeStreamReference(
  entries: readonly NativeStreamReferenceEntry[],
  search: string,
  category: NativeStreamReferenceCategory,
): NativeStreamReferenceEntry[] {
  const query = search.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (!query) return true;
    return [entry.title, entry.description, entry.stream.id, entry.stream.symbol, entry.stream.fileId, entry.managedSequenceId]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
  });
}

export function renderNativeStreamReferenceRows(entries: readonly NativeStreamReferenceEntry[], selectedId: number): string {
  if (!entries.length) return `<tr><td colspan="3" class="music-reference-empty">No matching streams in this category.</td></tr>`;
  return entries.map((entry) => `<tr>
    <th scope="row"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(NATIVE_STREAM_REFERENCE_CATEGORIES[entry.category])}</small></th>
    <td>${entry.managedSequenceId === undefined && !entry.managedStandalone
      ? `<button type="button" class="music-reference-id" data-native-stream-reference-id="${entry.stream.id}" aria-pressed="${entry.stream.id === selectedId}" aria-label="Select stream ${entry.stream.id}, ${escapeHtml(entry.title)}"><strong>${entry.stream.id}</strong></button>`
      : `<strong>${entry.stream.id}</strong><small>${entry.managedStandalone ? "Managed as a standalone song" : `Managed by BGM sequence ${entry.managedSequenceId}`}</small>`}
      <code>${escapeHtml(entry.stream.symbol)}</code></td>
    <td>${escapeHtml(entry.description)}<small>${entry.stream.channels} ch · ${entry.stream.sampleRate.toLocaleString()} Hz · ${entry.stream.encoding.toUpperCase()} · ${(entry.stream.encodedBytes / 0x10_0000).toFixed(2)} MiB</small></td>
  </tr>`).join("");
}

function getStreamedBgmDraft(project: ProjectState): StreamedBgmDraft {
  let draft = streamedBgmDrafts.get(project);
  if (!draft) {
    const installed = getStreamedBgmConfigs(project)[0];
    const nativeInstalled = getNativeStreamReplacementConfigs(project)[0];
    draft = {
      activeTab: "bgm",
      targetSequenceId: installed?.targetSequenceId ?? 0,
      encoding: installed?.encoding ?? (installed ? "pcm16" : "adpcm"),
      trimStartSeconds: installed?.sourceTrimStartSeconds ?? 0,
      loopStartSeconds: installed ? installed.loopStartSample / installed.sampleRate : 0,
      loopEndSeconds: installed?.sourceTrimEndSeconds ?? (installed ? installed.loopEndSample / installed.sampleRate : undefined),
      shortcutEnabled: installed?.toggleEnabled ?? detectBundledBgmToggleDll(project) === "patched",
      nativeStreamId: nativeInstalled?.streamId ?? 0,
      nativeEncoding: nativeInstalled?.encoding ?? "adpcm",
      nativeLoop: nativeInstalled?.loop ?? false,
      nativeTrimStartSeconds: nativeInstalled?.sourceTrimStartSeconds ?? 0,
      nativeLoopStartSeconds: nativeInstalled ? nativeInstalled.loopStartSample / nativeInstalled.sampleRate : 0,
      nativeLoopEndSeconds: nativeInstalled?.sourceTrimEndSeconds ?? (nativeInstalled ? nativeInstalled.loopEndSample / nativeInstalled.sampleRate : undefined),
      standaloneName: "",
      standaloneEncoding: "adpcm",
      standaloneLoop: true,
      standaloneTrimStartSeconds: 0,
      standaloneLoopStartSeconds: 0,
    };
    streamedBgmDrafts.set(project, draft);
  }
  return draft;
}

function hydrateSequenceList(project: ProjectState, root: HTMLElement, onDirty: () => void, draft: StreamedBgmDraft): void {
  if (draft.hydrating || draft.sequences || (project.session.baseRom !== "BW" && project.session.baseRom !== "BW2")) return;
  draft.hydrating = true;
  const hadStreamedState = Boolean(project.codeInjection?.streamedBgms);
  void Promise.all([loadNitroSdatFromProject(project), detectStreamedBgmStatus(project)])
    .then(([sdat, detected]) => {
      draft.sequences = listMusicEditorSequences(sdat);
      draft.nativeStreams = listNativeSdatStreams(sdat.bytes);
      const installed = getStreamedBgmConfigs(project)[0];
      if (installed) {
        draft.shortcutEnabled = installed.toggleEnabled;
        if (!hadStreamedState) {
          draft.targetSequenceId = installed.targetSequenceId;
          draft.encoding = installed.encoding ?? "pcm16";
          draft.trimStartSeconds = installed.sourceTrimStartSeconds ?? 0;
          draft.loopStartSeconds = installed.loopStartSample / installed.sampleRate;
          draft.loopEndSeconds = installed.sourceTrimEndSeconds ?? installed.loopEndSample / installed.sampleRate;
        }
      }
      if (!draft.sequences.some((entry) => entry.id === draft.targetSequenceId)) {
        draft.targetSequenceId = (draft.sequences.find((entry) => !/DUMMY|SILENCE/u.test(entry.symbol)) ?? draft.sequences[0])?.id ?? 0;
        draft.encoding = "adpcm";
      }
      if (!draft.nativeInitialized) {
        const nativeInstalled = getNativeStreamReplacementConfigs(project).find((entry) => entry.streamId === draft.nativeStreamId);
        const nativeStream = draft.nativeStreams.find((entry) => entry.id === draft.nativeStreamId)
          ?? draft.nativeStreams.find((entry) => !getStreamedBgmConfigs(project).some((mapping) => mapping.streamId === entry.id));
        if (nativeStream) draft.nativeStreamId = nativeStream.id;
        draft.nativeEncoding = nativeInstalled?.encoding ?? "adpcm";
        draft.nativeLoop = nativeInstalled?.loop ?? nativeStream?.loop ?? false;
        draft.nativeTrimStartSeconds = nativeInstalled?.sourceTrimStartSeconds ?? 0;
        draft.nativeLoopStartSeconds = nativeInstalled
          ? nativeInstalled.loopStartSample / nativeInstalled.sampleRate
          : (nativeStream?.loopStartSample ?? 0) / Math.max(1, nativeStream?.sampleRate ?? 1);
        draft.nativeLoopEndSeconds = nativeInstalled
          ? nativeInstalled.sourceTrimEndSeconds ?? nativeInstalled.loopEndSample / nativeInstalled.sampleRate
          : nativeStream ? nativeStream.sampleCount / Math.max(1, nativeStream.sampleRate) : undefined;
        draft.nativeInitialized = true;
      }
      draft.message = undefined;
      if (!hadStreamedState && detected.installed) onDirty();
    })
    .catch((error) => {
      draft.message = error instanceof Error ? error.message : String(error);
      draft.sequences = [];
      draft.nativeStreams = [];
    })
    .finally(() => {
      draft.hydrating = false;
      if (root.isConnected) renderMusicEditor(project, root, onDirty);
    });
}

type BgmFilter = MusicReferenceFilter | "replaced";
type BgmTrackInfo = { names: string[]; categories: Set<string>; haystack: string };

/** Friendly names for each BGM sequence, from the BW2 reference (BW1 shows symbols only). */
function bgmTrackInfo(sequences: ReadonlyArray<{ id: number; symbol: string }>, bw1: boolean): Map<number, BgmTrackInfo> {
  const info = new Map<number, BgmTrackInfo>();
  for (const sequence of sequences) info.set(sequence.id, { names: [], categories: new Set(), haystack: `${sequence.id} ${sequence.symbol}` });
  if (!bw1) {
    for (const entry of buildMusicReference(sequences)) {
      for (const track of entry.tracks) {
        const item = info.get(track.id);
        if (!item) continue;
        const name = track.label ? `${entry.title} · ${track.label}` : entry.title;
        if (!item.names.includes(name)) item.names.push(name);
        item.categories.add(entry.category);
        item.haystack += ` ${name} ${entry.description}`;
      }
    }
  }
  for (const item of info.values()) item.haystack = item.haystack.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLocaleLowerCase();
  return info;
}

function bgmTrackTitle(info: BgmTrackInfo | undefined, symbol: string): string {
  if (!info?.names.length) return symbol;
  return info.names.length > 1 ? `${info.names[0]} +${info.names.length - 1}` : info.names[0]!;
}

function matchesQuery(haystack: string, search: string): boolean {
  const query = search.trim().normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLocaleLowerCase();
  return !query || query.split(/\s+/u).every((term) => haystack.includes(term));
}

function megabytes(bytes: number): string {
  return `${(bytes / 0x10_0000).toFixed(2)} MiB`;
}

function seconds(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "" : value.toFixed(3);
}

export function renderMusicEditor(project: ProjectState, root: HTMLElement, onDirty: () => void): void {
  const draft = getStreamedBgmDraft(project);
  hydrateSequenceList(project, root, onDirty, draft);

  const configs = getStreamedBgmConfigs(project);
  const nativeConfigs = getNativeStreamReplacementConfigs(project);
  const standalone = getStandaloneStreamConfigs(project);
  const bw1 = project.session.baseRom === "BW" && (project.session.baseVersion === "B" || project.session.baseVersion === "W");
  const supported = bw1 || (project.session.baseRom === "BW2" && (project.session.baseVersion === "B2" || project.session.baseVersion === "W2"));
  if (!supported) {
    root.innerHTML = `<div class="music-data" id="music-data"><section class="md-detail mu-detail"><div class="mu-empty">Music replacement supports US Black, White, Black 2 and White 2.</div></section></div>`;
    return;
  }
  const managedStreamIds = new Set([...configs.map((entry) => entry.streamId), ...standalone.map((entry) => entry.streamId)]);
  const hasEditableNativeStream = Boolean(draft.nativeStreams?.some((entry) => !managedStreamIds.has(entry.id)));
  const availableTabs: readonly MusicEditorTab[] = bw1 && !hasEditableNativeStream ? ["bgm", "standalone"] : MUSIC_EDITOR_TABS;
  if (!availableTabs.includes(draft.activeTab)) draft.activeTab = "bgm";
  const totalBytes = [...configs, ...nativeConfigs, ...standalone].reduce((total, entry) => total + entry.encodedBytes, 0);

  root.innerHTML = `
    <div class="music-data" id="music-data">
      <aside class="md-list mu-list" aria-label="Music">
        <div class="md-tabs mu-modes" role="tablist" aria-label="Music editor sections">${renderMusicEditorTabs(draft.activeTab, availableTabs)}</div>
        <div class="md-filters" data-music-filters>${renderListFilters(draft, bw1)}</div>
        <div class="md-rows" id="music-list" role="listbox" aria-label="Tracks" tabindex="0">${renderListRows(project, draft, bw1)}</div>
        <div class="md-list-foot">${configs.length + nativeConfigs.length + standalone.length ? `${configs.length + nativeConfigs.length} replaced · ${standalone.length} new · ${megabytes(totalBytes)}` : "No custom music yet"}</div>
        ${draft.activeTab === "bgm" ? renderBgmTools(project, draft, configs, bw1) : ""}
      </aside>
      <section class="md-detail mu-detail" id="music-detail">${renderDetail(project, draft, configs, nativeConfigs, standalone)}</section>
    </div>
  `;

  installMusicEditorInteractions(project, root, onDirty, draft);
  if (draft.busy || draft.hydrating) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("#music-detail input, #music-detail button, #music-detail select, .md-tools input, .md-tools button").forEach((element) => { element.disabled = true; });
  }
}

function renderListFilters(draft: StreamedBgmDraft, bw1: boolean): string {
  if (draft.activeTab === "standalone") return "";
  if (draft.activeTab === "streamed") {
    const category = draft.nativeReferenceCategory ?? "all";
    return `
      <input class="md-search" id="music-list-search" type="search" placeholder="Search streams" autocomplete="off" spellcheck="false" aria-label="Search streams" value="${escapeHtml(draft.nativeReferenceSearch ?? "")}">
      <select id="music-list-category" aria-label="Show">
        <option value="all"${category === "all" ? " selected" : ""}>All streams</option>
        ${Object.entries(NATIVE_STREAM_REFERENCE_CATEGORIES).map(([value, label]) => `<option value="${value}"${category === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>`;
  }
  const filter: BgmFilter = draft.bgmFilter ?? "all";
  return `
    <input class="md-search" id="music-list-search" type="search" placeholder="Search tracks" autocomplete="off" spellcheck="false" aria-label="Search music" value="${escapeHtml(draft.referenceSearch ?? "")}">
    <select id="music-list-category" aria-label="Show">
      <option value="all"${filter === "all" ? " selected" : ""}>All tracks</option>
      <option value="replaced"${filter === "replaced" ? " selected" : ""}>Replaced</option>
      ${bw1 ? "" : Object.entries(MUSIC_REFERENCE_CATEGORIES).map(([value, label]) => `<option value="${value}"${filter === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>`;
}

function renderListRows(project: ProjectState, draft: StreamedBgmDraft, bw1: boolean): string {
  if (draft.hydrating && !draft.sequences) return `<div class="mu-list-empty">Loading the sound archive…</div>`;
  if (draft.activeTab === "streamed") {
    const entries = buildNativeStreamReference(draft.nativeStreams ?? [], getStreamedBgmConfigs(project), getStandaloneStreamConfigs(project));
    const matches = filterNativeStreamReference(entries, draft.nativeReferenceSearch ?? "", draft.nativeReferenceCategory ?? "all");
    const replaced = new Set(getNativeStreamReplacementConfigs(project).map((entry) => entry.streamId));
    if (!matches.length) return `<div class="mu-list-empty">No matching streams.</div>`;
    return matches.map((entry) => {
      const managed = entry.managedSequenceId !== undefined || entry.managedStandalone;
      const flag = entry.managedSequenceId !== undefined ? `BGM ${entry.managedSequenceId}` : entry.managedStandalone ? "New song" : replaced.has(entry.stream.id) ? "Replaced" : "";
      return `<div class="md-row mu-row${managed ? " -managed" : ""}" data-music-row="${entry.stream.id}" role="option" aria-selected="${entry.stream.id === draft.nativeStreamId && !managed}"${managed ? ` aria-disabled="true" title="${escapeHtml(entry.managedStandalone ? "Edited on the New songs tab" : `Edited as BGM ${entry.managedSequenceId}`)}"` : ""}>
        <span class="md-row-id">${entry.stream.id}</span>
        <span class="md-row-name">${escapeHtml(entry.title)}<small>${escapeHtml(entry.stream.symbol)}</small></span>
        <span class="mu-flag${replaced.has(entry.stream.id) ? " -replaced" : ""}">${escapeHtml(flag)}</span>
      </div>`;
    }).join("");
  }
  if (draft.activeTab === "standalone") {
    const tracks = getStandaloneStreamConfigs(project);
    const selected = draft.standaloneSelection ?? "new";
    return `<div class="md-row mu-row -new" data-music-row="new" role="option" aria-selected="${selected === "new"}"><span class="md-row-id">+</span><span class="md-row-name">New song</span><span></span></div>
      ${tracks.map((track) => `<div class="md-row mu-row" data-music-row="${track.streamId}" role="option" aria-selected="${selected === track.streamId}">
        <span class="md-row-id">${track.streamId}</span>
        <span class="md-row-name">${escapeHtml(track.name)}<small>${escapeHtml(track.sourceName)}</small></span>
        <span class="mu-flag">${megabytes(track.encodedBytes)}</span>
      </div>`).join("")}`;
  }
  const sequences = draft.sequences ?? [];
  const info = bgmTrackInfo(sequences, bw1);
  const replaced = new Set(getStreamedBgmConfigs(project).map((entry) => entry.targetSequenceId));
  const filter: BgmFilter = draft.bgmFilter ?? "all";
  const rows = sequences.filter((sequence) => {
    const item = info.get(sequence.id);
    if (filter === "replaced" && !replaced.has(sequence.id)) return false;
    if (filter !== "all" && filter !== "replaced" && !item?.categories.has(filter)) return false;
    return matchesQuery(item?.haystack ?? "", draft.referenceSearch ?? "");
  });
  if (!rows.length) return `<div class="mu-list-empty">No matching tracks.</div>`;
  return rows.map((sequence) => {
    const item = info.get(sequence.id);
    const named = Boolean(item?.names.length);
    return `<div class="md-row mu-row" data-music-row="${sequence.id}" role="option" aria-selected="${sequence.id === draft.targetSequenceId}" title="${escapeHtml(item?.names.join("\n") || sequence.symbol)}">
      <span class="md-row-id">${sequence.id}</span>
      <span class="md-row-name">${escapeHtml(bgmTrackTitle(item, sequence.symbol))}${named ? `<small>${escapeHtml(sequence.symbol)}</small>` : ""}</span>
      <span class="mu-flag${replaced.has(sequence.id) ? " -replaced" : ""}">${replaced.has(sequence.id) ? "Replaced" : ""}</span>
    </div>`;
  }).join("");
}

function renderBgmTools(project: ProjectState, draft: StreamedBgmDraft, configs: readonly StreamedBgmConfig[], bw1: boolean): string {
  const runtimeEnabled = configs.length || (bw1 && getStandaloneStreamConfigs(project).length);
  return `<details class="md-tools mu-tools" ${draft.toolsOpen ? "open" : ""}>
    <summary>Settings</summary>
    <div class="mu-tools-body">
      <label class="mu-check"><input id="streamed-bgm-shortcut" type="checkbox" ${draft.shortcutEnabled ? "checked" : ""}> L + R + Select mutes music</label>
      <div class="runtime-update-action"><button class="btn sm -default" id="update-streamed-bgm-runtime-btn" type="button" ${runtimeEnabled ? "" : "disabled"}>Update music runtime</button>${renderRuntimeReleaseTimestamp("music")}</div>
      ${configs.length > 1 ? `<button class="btn sm -default" id="remove-all-streamed-bgm-btn" type="button">Remove all replacements</button>` : ""}
    </div>
  </details>`;
}

function renderAudioImport(prefix: string, fileId: string, pcm: StereoPcm | undefined, sourceName: string | undefined, previewId: string | undefined, previewUrl: string | undefined, enabled: boolean): string {
  return `
    <div class="mu-file">
      <label class="btn sm -default file-btn">${pcm ? "Choose another file" : "Choose MP3 or WAV"}<input id="${fileId}" type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" ${enabled ? "" : "disabled"}></label>
      <span class="mu-file-name">${pcm && sourceName ? `${escapeHtml(sourceName)} · ${(pcm.left.length / pcm.sampleRate).toFixed(1)} s` : ""}</span>
    </div>
    ${previewUrl ? `<audio class="mu-audio" ${previewId ? `id="${previewId}"` : ""} controls preload="metadata" src="${escapeHtml(previewUrl)}" data-${prefix}-preview></audio>` : ""}`;
}

function renderTimingFields(ids: { trimStart: string; trimEnd: string; loopStart: string; loop?: string }, values: { trimStart: number; trimEnd?: number; loopStart: number; loop?: boolean }, enabled: boolean, encoding: { id: string; value: StreamedBgmEncoding }): string {
  const disabled = enabled ? "" : "disabled";
  return `
    <div class="mu-fields">
      <label class="mu-field"><span>Keep from (s)</span><input id="${ids.trimStart}" type="number" min="0" step="0.001" value="${seconds(values.trimStart)}" ${disabled}></label>
      <label class="mu-field"><span>Keep until (s)</span><input id="${ids.trimEnd}" type="number" min="0" step="0.001" value="${seconds(values.trimEnd)}" placeholder="End" ${disabled}></label>
      <label class="mu-field"><span>Loop from (s)</span><input id="${ids.loopStart}" type="number" min="0" step="0.001" value="${seconds(values.loopStart)}" ${enabled && values.loop !== false ? "" : "disabled"}></label>
      <label class="mu-field"><span>Quality</span><select id="${encoding.id}" ${disabled}>${renderStreamedBgmEncodingOptions(encoding.value)}</select></label>
      ${ids.loop ? `<label class="mu-check"><input id="${ids.loop}" type="checkbox" ${values.loop ? "checked" : ""} ${disabled}> Loop</label>` : ""}
    </div>`;
}

function renderDetail(
  project: ProjectState,
  draft: StreamedBgmDraft,
  configs: readonly StreamedBgmConfig[],
  nativeConfigs: readonly NativeStreamReplacementConfig[],
  standalone: readonly StandaloneStreamConfig[],
): string {
  if (draft.activeTab === "streamed") return renderStreamDetail(draft, configs, nativeConfigs, standalone);
  if (draft.activeTab === "standalone") return renderStandaloneDetail(draft, standalone);
  const bw1 = project.session.baseRom === "BW";
  const sequence = draft.sequences?.find((entry) => entry.id === draft.targetSequenceId);
  if (!sequence) return `<div class="mu-empty">${draft.hydrating ? "Loading the sound archive…" : escapeHtml(draft.message ?? "Pick a track.")}</div>`;
  const info = bgmTrackInfo(draft.sequences ?? [], bw1).get(sequence.id);
  const config = configs.find((entry) => entry.targetSequenceId === sequence.id);
  const legacyTarget = config && !config.targetSequenceSymbol?.startsWith("SEQ_BGM_");
  return `
    <header class="mu-head">
      <div class="td-title"><h1>${escapeHtml(info?.names[0] ?? sequence.symbol)}</h1><span class="td-num">#${sequence.id}</span></div>
      ${info?.names.length ? `<div class="fd-subtitle">${escapeHtml([sequence.symbol, ...info.names.slice(1)].join(" · "))}</div>` : ""}
    </header>
    <input type="hidden" id="streamed-bgm-target" value="${sequence.id}">
    <section class="mu-section">
      <div class="mu-section-title">Now playing in game</div>
      ${config ? `<div class="mu-installed"><strong>${escapeHtml(config.sourceName)}</strong><span>${megabytes(config.encodedBytes)} · ${escapeHtml(streamedBgmEncodingLabel(config.encoding ?? "pcm16"))} · loop ${(config.loopStartSample / config.sampleRate).toFixed(2)}–${(config.loopEndSample / config.sampleRate).toFixed(2)} s</span>
        <button class="btn sm -default" id="remove-streamed-bgm-btn" type="button">Restore original</button></div>` : `<div class="mu-original">Original track</div>`}
      <div class="mu-current">
        <button class="btn sm -default" id="preview-current-bgm-btn" type="button">Listen (15 s)</button>
        ${draft.currentTrackPreviewUrl ? `<audio class="mu-audio" id="current-bgm-preview" controls preload="metadata" src="${escapeHtml(draft.currentTrackPreviewUrl)}"></audio>` : ""}
      </div>
    </section>
    <section class="mu-section">
      <div class="mu-section-title">${config ? "Replace again" : "Replace with"}</div>
      ${renderAudioImport("bgm", "streamed-bgm-file", draft.pcm, draft.sourceName, "streamed-bgm-preview", draft.previewUrl, true)}
      ${renderTimingFields({ trimStart: "streamed-bgm-trim-start", trimEnd: "streamed-bgm-loop-end", loopStart: "streamed-bgm-loop-start" },
        { trimStart: draft.trimStartSeconds, trimEnd: draft.loopEndSeconds ?? (draft.pcm ? draft.pcm.left.length / draft.pcm.sampleRate : undefined), loopStart: draft.loopStartSeconds }, true,
        { id: "streamed-bgm-encoding", value: draft.encoding })}
      <div class="mu-actions"><button class="btn -primary" id="install-streamed-bgm-btn" type="button" ${draft.pcm ? "" : "disabled"}>${config ? "Update replacement" : "Replace track"}</button></div>
    </section>
    <div class="mu-note" id="streamed-bgm-note" role="status">${escapeHtml(draft.message ?? (legacyTarget ? `This older replacement targets non-BGM sequence ${config!.targetSequenceId}; import the audio again to reconfigure it.` : ""))}</div>`;
}

function renderStreamDetail(
  draft: StreamedBgmDraft,
  configs: readonly StreamedBgmConfig[],
  nativeConfigs: readonly NativeStreamReplacementConfig[],
  standalone: readonly StandaloneStreamConfig[],
): string {
  const managed = new Set([...configs.map((entry) => entry.streamId), ...standalone.map((entry) => entry.streamId)]);
  const stream = draft.nativeStreams?.find((entry) => entry.id === draft.nativeStreamId && !managed.has(entry.id));
  if (!stream) return `<div class="mu-empty">${draft.hydrating ? "Loading the sound archive…" : "Pick a stream."}</div>`;
  const entry = buildNativeStreamReference([stream], configs, standalone)[0]!;
  const config = nativeConfigs.find((item) => item.streamId === stream.id);
  const end = draft.nativeLoopEndSeconds ?? (draft.nativePcm ? draft.nativePcm.left.length / draft.nativePcm.sampleRate : undefined);
  return `
    <header class="mu-head">
      <div class="td-title"><h1>${escapeHtml(entry.title)}</h1><span class="td-num">#${stream.id}</span></div>
      <div class="fd-subtitle">${escapeHtml(stream.symbol)} · ${stream.channels} ch · ${stream.sampleRate.toLocaleString()} Hz · ${stream.encoding.toUpperCase()} · ${megabytes(stream.encodedBytes)}</div>
    </header>
    <input type="hidden" id="native-stream-target" value="${stream.id}">
    <section class="mu-section">
      <div class="mu-section-title">Now playing in game</div>
      ${config ? `<div class="mu-installed"><strong>${escapeHtml(config.sourceName)}</strong><span>${megabytes(config.encodedBytes)} · ${escapeHtml(streamedBgmEncodingLabel(config.encoding))}${config.loop ? ` · loop ${(config.loopStartSample / config.sampleRate).toFixed(2)}–${(config.loopEndSample / config.sampleRate).toFixed(2)} s` : ""}</span>
        <button class="btn sm -default" id="remove-native-stream-btn" type="button">Restore original</button></div>` : `<div class="mu-original">Original stream</div>`}
      <div class="mu-current">
        <button class="btn sm -default" id="preview-current-native-stream-btn" type="button">Listen (15 s)</button>
        ${draft.nativeCurrentTrackPreviewUrl ? `<audio class="mu-audio" id="current-native-stream-preview" controls preload="metadata" src="${escapeHtml(draft.nativeCurrentTrackPreviewUrl)}"></audio>` : ""}
      </div>
    </section>
    <section class="mu-section">
      <div class="mu-section-title">${config ? "Replace again" : "Replace with"}</div>
      ${renderAudioImport("native", "native-stream-file", draft.nativePcm, draft.nativeSourceName, "native-stream-preview", draft.nativePreviewUrl, true)}
      ${renderTimingFields({ trimStart: "native-stream-trim-start", trimEnd: "native-stream-loop-end", loopStart: "native-stream-loop-start", loop: "native-stream-loop" },
        { trimStart: draft.nativeTrimStartSeconds, trimEnd: end, loopStart: draft.nativeLoopStartSeconds, loop: draft.nativeLoop }, true,
        { id: "native-stream-encoding", value: draft.nativeEncoding })}
      <div class="mu-actions"><button class="btn -primary" id="install-native-stream-btn" type="button" ${draft.nativePcm ? "" : "disabled"}>${config ? "Update replacement" : "Replace stream"}</button></div>
    </section>
    <div class="mu-note" id="native-stream-note" role="status">${escapeHtml(draft.nativeMessage ?? "")}</div>`;
}

function renderStandaloneDetail(draft: StreamedBgmDraft, tracks: readonly StandaloneStreamConfig[]): string {
  const selection = draft.standaloneSelection ?? "new";
  const track = selection === "new" ? undefined : tracks.find((entry) => entry.streamId === selection);
  if (track) {
    const newest = tracks.reduce((max, entry) => Math.max(max, entry.streamId), -1) === track.streamId;
    return `
      <header class="mu-head">
        <div class="td-title"><h1>${escapeHtml(track.name)}</h1><span class="td-num">#${track.streamId}</span></div>
        <div class="fd-subtitle">${escapeHtml(track.sourceName)} · ${megabytes(track.encodedBytes)} · ${escapeHtml(streamedBgmEncodingLabel(track.encoding))}${track.loop ? ` · loop ${(track.loopStartSample / track.sampleRate).toFixed(2)}–${(track.loopEndSample / track.sampleRate).toFixed(2)} s` : ""}</div>
      </header>
      <section class="mu-section">
        <div class="mu-section-title">Stream ID</div>
        <div class="mu-original">Play stream <strong>${track.streamId}</strong> from scripts or code to use this song.</div>
        ${newest ? `<div class="mu-actions"><button class="btn sm -default" id="remove-last-standalone-stream-btn" type="button">Remove song</button></div>` : `<div class="mu-original">Only the newest song can be removed.</div>`}
      </section>
      <div class="mu-note" id="standalone-stream-note" role="status">${escapeHtml(draft.standaloneMessage ?? "")}</div>`;
  }
  return `
    <header class="mu-head">
      <div class="td-title"><h1>New song</h1></div>
      <div class="fd-subtitle">Adds a stream without replacing any game music.</div>
    </header>
    <section class="mu-section">
      <label class="mu-field -wide"><span>Name</span><input id="standalone-stream-name" type="text" maxlength="80" value="${escapeHtml(draft.standaloneName)}"></label>
      ${renderAudioImport("standalone", "standalone-stream-file", draft.standalonePcm, draft.standaloneSourceName, undefined, draft.standalonePreviewUrl, true)}
      ${renderTimingFields({ trimStart: "standalone-stream-trim-start", trimEnd: "standalone-stream-trim-end", loopStart: "standalone-stream-loop-start", loop: "standalone-stream-loop" },
        { trimStart: draft.standaloneTrimStartSeconds, trimEnd: draft.standaloneTrimEndSeconds ?? (draft.standalonePcm ? draft.standalonePcm.left.length / draft.standalonePcm.sampleRate : undefined), loopStart: draft.standaloneLoopStartSeconds, loop: draft.standaloneLoop }, true,
        { id: "standalone-stream-encoding", value: draft.standaloneEncoding })}
      <div class="mu-actions"><button class="btn -primary" id="add-standalone-stream-btn" type="button" ${draft.standalonePcm ? "" : "disabled"}>Add song</button></div>
    </section>
    <div class="mu-note" id="standalone-stream-note" role="status">${escapeHtml(draft.standaloneMessage ?? "")}</div>`;
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

export function filterBw1MusicSequences(sequences: readonly { id: number; symbol: string }[], search: string): Array<{ id: number; symbol: string }> {
  const query = search.trim().toLocaleLowerCase();
  return sequences.filter((entry) => !query || String(entry.id).includes(query) || entry.symbol.toLocaleLowerCase().includes(query));
}

function installMusicEditorInteractions(project: ProjectState, root: HTMLElement, onDirty: () => void, draft: StreamedBgmDraft): void {
  const bw1 = project.session.baseRom === "BW";
  const rerender = () => renderMusicEditor(project, root, onDirty);
  const list = root.querySelector<HTMLElement>("#music-list");

  // ---------- Sections and list ----------
  const editorTabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-music-editor-tab]"));
  const availableTabs = editorTabs.map((button) => button.dataset.musicEditorTab as MusicEditorTab);
  editorTabs.forEach((button) => {
    const tab = button.dataset.musicEditorTab as MusicEditorTab;
    button.addEventListener("click", () => {
      if (draft.activeTab === tab) return;
      draft.activeTab = tab;
      rerender();
    });
    button.addEventListener("keydown", (event) => {
      const next = nextMusicEditorTab(tab, event.key, availableTabs);
      if (!next) return;
      event.preventDefault();
      draft.activeTab = next;
      rerender();
      root.querySelector<HTMLButtonElement>(`[data-music-editor-tab="${next}"]`)?.focus();
    });
  });

  const refreshRows = () => {
    if (list) list.innerHTML = renderListRows(project, draft, bw1);
  };
  const listSearch = root.querySelector<HTMLInputElement>("#music-list-search");
  const listCategory = root.querySelector<HTMLSelectElement>("#music-list-category");
  let searchTimer: number | undefined;
  listSearch?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (draft.activeTab === "streamed") draft.nativeReferenceSearch = listSearch.value;
      else draft.referenceSearch = listSearch.value;
      refreshRows();
    }, 120);
  });
  listCategory?.addEventListener("change", () => {
    if (draft.activeTab === "streamed") draft.nativeReferenceCategory = listCategory.value as NativeStreamReferenceCategory;
    else draft.bgmFilter = listCategory.value as BgmFilter;
    refreshRows();
  });

  const selectBgm = (id: number) => {
    if (id === draft.targetSequenceId) return;
    draft.targetSequenceId = id;
    const installed = getStreamedBgmConfigs(project).find((entry) => entry.targetSequenceId === id);
    draft.encoding = installed?.encoding ?? (installed ? "pcm16" : draft.encoding);
    if (draft.currentTrackPreviewUrl) URL.revokeObjectURL(draft.currentTrackPreviewUrl);
    draft.currentTrackPreviewUrl = undefined;
    draft.message = undefined;
  };
  const selectRow = (row: HTMLElement) => {
    if (row.getAttribute("aria-disabled") === "true" || draft.busy) return;
    const value = row.dataset.musicRow;
    if (value === undefined) return;
    if (draft.activeTab === "streamed") applyNativeTarget(Number(value));
    else if (draft.activeTab === "standalone") {
      draft.standaloneSelection = value === "new" ? "new" : Number(value);
      draft.standaloneMessage = undefined;
    } else selectBgm(Number(value));
    rerender();
    root.querySelector<HTMLElement>(`#music-list [aria-selected="true"]`)?.scrollIntoView({ block: "nearest" });
  };
  list?.addEventListener("click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-music-row]");
    if (row) selectRow(row);
  });
  list?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-music-row]:not([aria-disabled='true'])")];
    const index = rows.findIndex((row) => row.getAttribute("aria-selected") === "true");
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      selectRow(next);
      root.querySelector<HTMLElement>("#music-list")?.focus();
    }
  });
  if (!root.querySelector("#music-list [aria-selected='true']")) {
    // Keep the selection visible after filters hide it.
  } else {
    root.querySelector<HTMLElement>("#music-list [aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }

  const tools = root.querySelector<HTMLDetailsElement>(".mu-tools");
  tools?.addEventListener("toggle", () => { draft.toolsOpen = tools.open; });

  // ---------- Shared helpers ----------
  const disableAll = () => root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("#music-detail input, #music-detail button, #music-detail select, .md-tools input, .md-tools button").forEach((element) => { element.disabled = true; });
  const runEdit = async (operation: () => Promise<void>, messageTarget: "sequence" | "native" | "standalone" = "sequence") => {
    if (draft.busy) return;
    draft.busy = true;
    disableAll();
    try {
      await operation();
      draft.nativeStreams = listNativeSdatStreams((await loadNitroSdatFromProject(project)).bytes);
      onDirty();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (messageTarget === "native") draft.nativeMessage = message;
      else if (messageTarget === "standalone") draft.standaloneMessage = message;
      else draft.message = message;
    } finally {
      draft.busy = false;
      rerender();
    }
  };
  const runPreview = async (operation: () => Promise<void>, messageTarget: "sequence" | "native") => {
    if (draft.busy) return;
    draft.busy = true;
    disableAll();
    try {
      await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (messageTarget === "native") draft.nativeMessage = message;
      else draft.message = message;
    } finally {
      draft.busy = false;
      rerender();
    }
  };
  const constrainImportedPreview = (audio: HTMLAudioElement | null, startInput: HTMLInputElement | null, endInput: HTMLInputElement | null, update: () => void) => {
    if (!audio) return;
    const bounds = () => {
      update();
      const start = Math.max(0, Number(startInput?.value) || 0);
      const parsedEnd = Number(endInput?.value);
      const end = Number.isFinite(parsedEnd) && parsedEnd > 0 ? Math.min(parsedEnd, audio.duration || parsedEnd) : audio.duration;
      return { start, end };
    };
    audio.addEventListener("play", () => {
      const { start, end } = bounds();
      if (audio.currentTime < start || audio.currentTime >= end) audio.currentTime = start;
    });
    audio.addEventListener("timeupdate", () => {
      const { start, end } = bounds();
      if (Number.isFinite(end) && audio.currentTime >= end) {
        audio.pause();
        audio.currentTime = start;
      }
    });
  };

  // ---------- BGM ----------
  const fileInput = root.querySelector<HTMLInputElement>("#streamed-bgm-file");
  const encodingSelect = root.querySelector<HTMLSelectElement>("#streamed-bgm-encoding");
  const trimStartInput = root.querySelector<HTMLInputElement>("#streamed-bgm-trim-start");
  const loopStartInput = root.querySelector<HTMLInputElement>("#streamed-bgm-loop-start");
  const loopEndInput = root.querySelector<HTMLInputElement>("#streamed-bgm-loop-end");
  const shortcutInput = root.querySelector<HTMLInputElement>("#streamed-bgm-shortcut");
  const installButton = root.querySelector<HTMLButtonElement>("#install-streamed-bgm-btn");
  const note = root.querySelector<HTMLDivElement>("#streamed-bgm-note");
  const updateInputs = () => {
    const trimStart = Number(trimStartInput?.value);
    if (trimStartInput && Number.isFinite(trimStart)) draft.trimStartSeconds = trimStart;
    const loopStart = Number(loopStartInput?.value);
    if (loopStartInput && Number.isFinite(loopStart)) draft.loopStartSeconds = loopStart;
    if (loopEndInput) {
      const loopEndText = loopEndInput.value.trim();
      draft.loopEndSeconds = loopEndText ? Number(loopEndText) : undefined;
    }
    if (shortcutInput) draft.shortcutEnabled = shortcutInput.checked;
    if (encodingSelect?.value === "adpcm" || encodingSelect?.value === "pcm16") draft.encoding = encodingSelect.value;
  };
  encodingSelect?.addEventListener("change", updateInputs);
  trimStartInput?.addEventListener("input", updateInputs);
  loopStartInput?.addEventListener("input", updateInputs);
  loopEndInput?.addEventListener("input", updateInputs);
  shortcutInput?.addEventListener("change", updateInputs);
  constrainImportedPreview(root.querySelector<HTMLAudioElement>("#streamed-bgm-preview"), trimStartInput, loopEndInput, updateInputs);

  root.querySelector<HTMLButtonElement>("#update-streamed-bgm-runtime-btn")?.addEventListener("click", async () => {
    await runEdit(async () => {
      await updateStreamedBgmRuntime(project);
      draft.message = "Music runtime updated. Fresh-boot the exported ROM to use it.";
    });
  });

  const currentBgmPreviewButton = root.querySelector<HTMLButtonElement>("#preview-current-bgm-btn");
  currentBgmPreviewButton?.addEventListener("click", () => {
    void runPreview(async () => {
      updateInputs();
      const sequence = draft.sequences?.find((entry) => entry.id === draft.targetSequenceId);
      if (!sequence) throw new Error("Pick a track first.");
      currentBgmPreviewButton.textContent = "Rendering…";
      const sdat = await loadNitroSdatFromProject(project);
      const mapping = getStreamedBgmConfigs(project).find((entry) => entry.targetSequenceId === sequence.id);
      const pcm = mapping
        ? decodeNativeSdatStreamPcm(sdat.bytes, mapping.streamId, CURRENT_TRACK_PREVIEW_SECONDS)
        : await renderNitroSequencePcm(sdat, sequence.id, { maxSeconds: CURRENT_TRACK_PREVIEW_SECONDS, sampleRate: 24_000, cache: false });
      if (draft.currentTrackPreviewUrl) URL.revokeObjectURL(draft.currentTrackPreviewUrl);
      draft.currentTrackPreviewUrl = createPcmPreviewUrl(pcm);
      draft.message = undefined;
    }, "sequence");
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await runEdit(async () => {
      updateInputs();
      if (note) note.textContent = `Decoding ${file.name}…`;
      const pcm = await decodeAudioFile(file);
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      draft.pcm = pcm;
      draft.sourceName = file.name;
      draft.previewUrl = URL.createObjectURL(file);
      draft.trimStartSeconds = 0;
      draft.loopStartSeconds = 0;
      draft.loopEndSeconds = pcm.left.length / pcm.sampleRate;
      draft.message = undefined;
    });
  });

  installButton?.addEventListener("click", async () => {
    await runEdit(async () => {
      updateInputs();
      if (!draft.pcm || !draft.sourceName) throw new Error("Choose an MP3 or WAV file first.");
      const sequence = draft.sequences?.find((entry) => entry.id === draft.targetSequenceId);
      if (!sequence) throw new Error("Pick a track first.");
      installButton.textContent = "Installing…";
      if (note) note.textContent = "Encoding and rebuilding the sound archive…";
      await installStreamedBgm(project, {
        sourceName: draft.sourceName,
        pcm: draft.pcm,
        targetSequenceId: sequence.id,
        targetSequenceSymbol: sequence.symbol,
        encoding: draft.encoding,
        trimStartSeconds: draft.trimStartSeconds,
        trimEndSeconds: draft.loopEndSeconds,
        loopStartSeconds: draft.loopStartSeconds,
        shortcutEnabled: draft.shortcutEnabled,
      });
      if (draft.currentTrackPreviewUrl) URL.revokeObjectURL(draft.currentTrackPreviewUrl);
      draft.currentTrackPreviewUrl = undefined;
      draft.message = `${draft.sourceName} now plays as ${sequence.id}.`;
    });
  });

  const remove = (id?: number) => runEdit(async () => {
    if (note) note.textContent = "Restoring the original track…";
    await removeStreamedBgm(project, id);
    if (draft.currentTrackPreviewUrl) URL.revokeObjectURL(draft.currentTrackPreviewUrl);
    draft.currentTrackPreviewUrl = undefined;
    draft.message = id === undefined ? "All replacements removed." : "Original track restored.";
  });
  root.querySelector<HTMLButtonElement>("#remove-streamed-bgm-btn")?.addEventListener("click", () => { void remove(draft.targetSequenceId); });
  root.querySelector("#remove-all-streamed-bgm-btn")?.addEventListener("click", () => {
    if (globalThis.confirm("Remove every music replacement and restore the original tracks?")) void remove();
  });

  // ---------- Streams ----------
  const nativeFile = root.querySelector<HTMLInputElement>("#native-stream-file");
  const nativeEncoding = root.querySelector<HTMLSelectElement>("#native-stream-encoding");
  const nativeLoop = root.querySelector<HTMLInputElement>("#native-stream-loop");
  const nativeTrimStart = root.querySelector<HTMLInputElement>("#native-stream-trim-start");
  const nativeLoopStart = root.querySelector<HTMLInputElement>("#native-stream-loop-start");
  const nativeLoopEnd = root.querySelector<HTMLInputElement>("#native-stream-loop-end");
  const nativeInstall = root.querySelector<HTMLButtonElement>("#install-native-stream-btn");
  const nativeNote = root.querySelector<HTMLElement>("#native-stream-note");
  function applyNativeTarget(streamId: number): void {
    const stream = draft.nativeStreams?.find((entry) => entry.id === streamId);
    if (!stream || getStandaloneStreamConfigs(project).some((entry) => entry.streamId === streamId)) return;
    const changed = draft.nativeStreamId !== streamId;
    const installed = getNativeStreamReplacementConfigs(project).find((entry) => entry.streamId === streamId);
    draft.nativeStreamId = streamId;
    draft.nativeEncoding = installed?.encoding ?? "adpcm";
    draft.nativeLoop = installed?.loop ?? stream.loop;
    draft.nativeTrimStartSeconds = installed?.sourceTrimStartSeconds ?? 0;
    draft.nativeLoopStartSeconds = installed ? installed.loopStartSample / installed.sampleRate : stream.loopStartSample / Math.max(1, stream.sampleRate);
    draft.nativeLoopEndSeconds = installed
      ? installed.sourceTrimEndSeconds ?? installed.loopEndSample / installed.sampleRate
      : stream.sampleCount / Math.max(1, stream.sampleRate);
    if (changed && draft.nativeCurrentTrackPreviewUrl) {
      URL.revokeObjectURL(draft.nativeCurrentTrackPreviewUrl);
      draft.nativeCurrentTrackPreviewUrl = undefined;
    }
    draft.nativeMessage = undefined;
  }
  const updateNativeInputs = () => {
    if (nativeEncoding?.value === "adpcm" || nativeEncoding?.value === "pcm16") draft.nativeEncoding = nativeEncoding.value;
    if (nativeLoop) draft.nativeLoop = nativeLoop.checked;
    const trimStart = Number(nativeTrimStart?.value);
    if (nativeTrimStart && Number.isFinite(trimStart)) draft.nativeTrimStartSeconds = trimStart;
    const start = Number(nativeLoopStart?.value);
    if (nativeLoopStart && Number.isFinite(start)) draft.nativeLoopStartSeconds = start;
    if (nativeLoopEnd) {
      const end = nativeLoopEnd.value.trim();
      draft.nativeLoopEndSeconds = end ? Number(end) : undefined;
    }
    if (nativeLoopStart) nativeLoopStart.disabled = !draft.nativeLoop;
  };
  nativeEncoding?.addEventListener("change", updateNativeInputs);
  nativeLoop?.addEventListener("change", updateNativeInputs);
  nativeTrimStart?.addEventListener("input", updateNativeInputs);
  nativeLoopStart?.addEventListener("input", updateNativeInputs);
  nativeLoopEnd?.addEventListener("input", updateNativeInputs);
  constrainImportedPreview(root.querySelector<HTMLAudioElement>("#native-stream-preview"), nativeTrimStart, nativeLoopEnd, updateNativeInputs);

  const currentNativePreviewButton = root.querySelector<HTMLButtonElement>("#preview-current-native-stream-btn");
  currentNativePreviewButton?.addEventListener("click", () => {
    void runPreview(async () => {
      currentNativePreviewButton.textContent = "Decoding…";
      const sdat = await loadNitroSdatFromProject(project);
      const pcm = decodeNativeSdatStreamPcm(sdat.bytes, draft.nativeStreamId, CURRENT_TRACK_PREVIEW_SECONDS);
      if (draft.nativeCurrentTrackPreviewUrl) URL.revokeObjectURL(draft.nativeCurrentTrackPreviewUrl);
      draft.nativeCurrentTrackPreviewUrl = createPcmPreviewUrl(pcm);
      draft.nativeMessage = undefined;
    }, "native");
  });

  nativeFile?.addEventListener("change", async () => {
    const file = nativeFile.files?.[0];
    if (!file) return;
    await runEdit(async () => {
      updateNativeInputs();
      if (nativeNote) nativeNote.textContent = `Decoding ${file.name}…`;
      const pcm = await decodeAudioFile(file);
      if (draft.nativePreviewUrl) URL.revokeObjectURL(draft.nativePreviewUrl);
      draft.nativePcm = pcm;
      draft.nativeSourceName = file.name;
      draft.nativePreviewUrl = URL.createObjectURL(file);
      draft.nativeTrimStartSeconds = 0;
      draft.nativeLoopStartSeconds = 0;
      draft.nativeLoopEndSeconds = pcm.left.length / pcm.sampleRate;
      draft.nativeMessage = undefined;
    }, "native");
  });

  nativeInstall?.addEventListener("click", async () => {
    await runEdit(async () => {
      updateNativeInputs();
      if (!draft.nativePcm || !draft.nativeSourceName) throw new Error("Choose an MP3 or WAV file first.");
      nativeInstall.textContent = "Replacing…";
      if (nativeNote) nativeNote.textContent = "Encoding and rebuilding the sound archive…";
      await installNativeStreamReplacement(project, {
        sourceName: draft.nativeSourceName,
        pcm: draft.nativePcm,
        streamId: draft.nativeStreamId,
        encoding: draft.nativeEncoding,
        loop: draft.nativeLoop,
        trimStartSeconds: draft.nativeTrimStartSeconds,
        trimEndSeconds: draft.nativeLoopEndSeconds,
        loopStartSeconds: draft.nativeLoopStartSeconds,
      });
      if (draft.nativeCurrentTrackPreviewUrl) URL.revokeObjectURL(draft.nativeCurrentTrackPreviewUrl);
      draft.nativeCurrentTrackPreviewUrl = undefined;
      draft.nativeMessage = `${draft.nativeSourceName} now plays as stream ${draft.nativeStreamId}.`;
    }, "native");
  });

  root.querySelector<HTMLButtonElement>("#remove-native-stream-btn")?.addEventListener("click", async () => {
    await runEdit(async () => {
      if (nativeNote) nativeNote.textContent = "Restoring the original stream…";
      await removeNativeStreamReplacement(project, draft.nativeStreamId);
      if (draft.nativeCurrentTrackPreviewUrl) URL.revokeObjectURL(draft.nativeCurrentTrackPreviewUrl);
      draft.nativeCurrentTrackPreviewUrl = undefined;
      draft.nativeMessage = "Original stream restored.";
      const stream = listNativeSdatStreams((await loadNitroSdatFromProject(project)).bytes).find((entry) => entry.id === draft.nativeStreamId);
      if (stream) {
        draft.nativeLoop = stream.loop;
        draft.nativeTrimStartSeconds = 0;
        draft.nativeLoopStartSeconds = stream.loopStartSample / Math.max(1, stream.sampleRate);
        draft.nativeLoopEndSeconds = stream.sampleCount / Math.max(1, stream.sampleRate);
      }
    }, "native");
  });

  // ---------- New songs ----------
  const standaloneName = root.querySelector<HTMLInputElement>("#standalone-stream-name");
  const standaloneFile = root.querySelector<HTMLInputElement>("#standalone-stream-file");
  const standaloneEncoding = root.querySelector<HTMLSelectElement>("#standalone-stream-encoding");
  const standaloneLoop = root.querySelector<HTMLInputElement>("#standalone-stream-loop");
  const standaloneTrimStart = root.querySelector<HTMLInputElement>("#standalone-stream-trim-start");
  const standaloneTrimEnd = root.querySelector<HTMLInputElement>("#standalone-stream-trim-end");
  const standaloneLoopStart = root.querySelector<HTMLInputElement>("#standalone-stream-loop-start");
  const standaloneNote = root.querySelector<HTMLElement>("#standalone-stream-note");
  const syncStandaloneInputs = () => {
    if (standaloneName) draft.standaloneName = standaloneName.value;
    if (standaloneEncoding) draft.standaloneEncoding = standaloneEncoding.value === "pcm16" ? "pcm16" : "adpcm";
    if (standaloneLoop) draft.standaloneLoop = standaloneLoop.checked;
    if (standaloneTrimStart) draft.standaloneTrimStartSeconds = Number(standaloneTrimStart.value || 0);
    if (standaloneTrimEnd) draft.standaloneTrimEndSeconds = standaloneTrimEnd.value ? Number(standaloneTrimEnd.value) : undefined;
    if (standaloneLoopStart) draft.standaloneLoopStartSeconds = Number(standaloneLoopStart.value || 0);
  };
  [standaloneName, standaloneEncoding, standaloneTrimStart, standaloneTrimEnd, standaloneLoopStart].forEach((input) => input?.addEventListener("input", syncStandaloneInputs));
  standaloneLoop?.addEventListener("change", () => {
    syncStandaloneInputs();
    if (standaloneLoopStart) standaloneLoopStart.disabled = !draft.standaloneLoop;
  });
  standaloneFile?.addEventListener("change", async () => {
    const file = standaloneFile.files?.[0];
    if (!file) return;
    await runEdit(async () => {
      syncStandaloneInputs();
      if (standaloneNote) standaloneNote.textContent = `Decoding ${file.name}…`;
      const pcm = await decodeAudioFile(file);
      if (draft.standalonePreviewUrl) URL.revokeObjectURL(draft.standalonePreviewUrl);
      draft.standalonePcm = pcm;
      draft.standaloneSourceName = file.name;
      draft.standalonePreviewUrl = URL.createObjectURL(file);
      if (!draft.standaloneName) draft.standaloneName = file.name.replace(/\.[^.]+$/u, "");
      draft.standaloneTrimStartSeconds = 0;
      draft.standaloneTrimEndSeconds = pcm.left.length / pcm.sampleRate;
      draft.standaloneLoopStartSeconds = 0;
      draft.standaloneMessage = undefined;
    }, "standalone");
  });
  root.querySelector<HTMLButtonElement>("#add-standalone-stream-btn")?.addEventListener("click", async () => {
    await runEdit(async () => {
      syncStandaloneInputs();
      if (!draft.standalonePcm || !draft.standaloneSourceName) throw new Error("Choose an MP3 or WAV file first.");
      if (standaloneNote) standaloneNote.textContent = "Encoding and adding the song…";
      const installed = await installStandaloneStream(project, {
        name: draft.standaloneName, sourceName: draft.standaloneSourceName, pcm: draft.standalonePcm,
        encoding: draft.standaloneEncoding, loop: draft.standaloneLoop,
        trimStartSeconds: draft.standaloneTrimStartSeconds, trimEndSeconds: draft.standaloneTrimEndSeconds,
        loopStartSeconds: draft.standaloneLoopStartSeconds,
      });
      draft.standaloneSelection = installed.streamId;
      draft.standaloneMessage = `${installed.name} added as stream ${installed.streamId}.`;
    }, "standalone");
  });
  root.querySelector<HTMLButtonElement>("#remove-last-standalone-stream-btn")?.addEventListener("click", async () => {
    await runEdit(async () => {
      await removeLastStandaloneStream(project);
      draft.standaloneSelection = "new";
      draft.standaloneMessage = "Song removed.";
    }, "standalone");
  });
}
