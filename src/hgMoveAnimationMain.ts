import "./styles.css";
import "./styles/hgMoveAnimation.css";

import { formatBytes } from "./ui/dom";
import { buildHgMoveAnimationTestBattleDownloads } from "./pokeweb/hgTestBattle";
import { openTestBattleEmulator } from "./pokeweb/testBattleEmulatorLauncher";
import {
  HG_MOVE_ANIMATION_ADAPTER,
  archiveForKind,
  hasArchiveKind,
  loadGen4MoveAnimationProject,
  type Gen4MoveAnimationAdapter,
  type Gen4MoveAnimationArchiveKind,
  type Gen4MoveAnimationProject,
  type Gen4MoveAnimationScriptArchiveKind,
} from "./pokeweb/gen4MoveAnimationAdapter";
import {
  type HgMoveAnimationRom,
} from "./pokeweb/hgMoveAnimationModel";
import { HG_CALLFUNCTION_BY_ID, HG_MOVE_ANIMATION_HELPER_BY_NAME, HG_PRIMITIVE_COMMAND_BY_NAME, type HgColorParameterGroup } from "./pokeweb/hgMoveAnimationDocs";
import {
  DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO,
  type HgMoveAnimationPreviewScenario,
} from "./pokeweb/hgMoveAnimationPreviewModel";
import type { MoveAnimationPreview } from "./pokeweb/moveAnimationPreviewModel";
import { installHgMoveAnimationCodeEditor, type HgCommandReference, type HgMoveAnimationCodeEditor } from "./ui/hgMoveAnimationCodeEditor";
import { installMoveAnimationPreview, type MoveAnimationPreviewController } from "./ui/moveAnimationPreview";
import { installMoveSpaEditorWithSource, type MoveSpaEditorController } from "./ui/moveSpaEditor";

const app = document.querySelector<HTMLElement>("#hg-app");
if (!app) throw new Error("Missing HG app root");
const appRoot = app;
const HG_ROM_CACHE_DB = "pokeweb-hg-move-animation";
const HG_ROM_CACHE_VERSION = 1;
const HG_ROM_CACHE_STORE = "roms";
const HG_ROM_CACHE_KEY = "latest";
const HG_EDITOR_PREFS_KEY = "pokeweb-hg-move-animation-editor-prefs";

type CachedHgRom = {
  fileName: string;
  bytes: Uint8Array;
};

type UiState = {
  project?: Gen4MoveAnimationProject;
  adapter?: Gen4MoveAnimationAdapter;
  fileName?: string;
  romBytes?: Uint8Array;
  activeKind: Gen4MoveAnimationArchiveKind;
  selectedFileId: number;
  selectedFileIds: Partial<Record<Gen4MoveAnimationArchiveKind, number>>;
  sidebarScrollTop: Partial<Record<Gen4MoveAnimationArchiveKind, number>>;
  filter: string;
  favoriteOnly: boolean;
  favorites: Partial<Record<Gen4MoveAnimationArchiveKind, Set<number>>>;
  editorText: string;
  editorDirty: boolean;
  editorTab: "readable" | "hgEngine";
  scenario: HgMoveAnimationPreviewScenario;
  status: { text: string; kind?: "ok" | "error" };
};

const state: UiState = {
  activeKind: "move",
  selectedFileId: 0,
  selectedFileIds: {},
  sidebarScrollTop: {},
  filter: "",
  favoriteOnly: false,
  favorites: {},
  editorText: "",
  editorDirty: false,
  editorTab: "readable",
  scenario: { ...DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO },
  status: { text: "" },
};

function defaultPreviewScenario(adapter?: Gen4MoveAnimationAdapter): HgMoveAnimationPreviewScenario {
  return {
    ...DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO,
    playerAttack: adapter?.id === "platinum" ? false : DEFAULT_HG_MOVE_ANIMATION_PREVIEW_SCENARIO.playerAttack,
  };
}

let currentPreview: MoveAnimationPreview | undefined;
let currentPreviewInitialPlaying = true;
let scriptEditor: HgMoveAnimationCodeEditor | undefined;
let spaEditor: MoveSpaEditorController | undefined;
let activeCommandReference: HgCommandReference | undefined;
let previewController: MoveAnimationPreviewController | undefined;
let previewRequest = 0;
let romLoadGeneration = 0;
let renderedSidebarKind: Gen4MoveAnimationArchiveKind | undefined;

render();
void restoreLatestRom();

function render(): void {
  captureSidebarScroll();
  appRoot.className = "hg-app";
  if (!state.project) {
    renderUpload();
    return;
  }
  renderWorkspace();
}

function renderUpload(): void {
  renderedSidebarKind = undefined;
  appRoot.innerHTML = `
    <section class="hg-upload">
      <div class="hg-upload__panel">
        <div>
          <h1>Gen 4 Move Animation Editor</h1>
          <p>Load a HeartGold, HG-engine, or Pokemon Platinum ROM. The editor will detect the supported move animation archives automatically.</p>
        </div>
        <label class="hg-dropzone">
          <span>Choose a .nds ROM</span>
          <input id="rom-file" type="file" accept=".nds" />
        </label>
        <div id="upload-status" class="hg-status">${state.status.text}</div>
      </div>
    </section>
  `;
  appRoot.querySelector<HTMLInputElement>("#rom-file")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = (input.files ?? [])[0];
    if (file) void loadRomFile(file);
  });
}

function renderWorkspace(): void {
  scriptEditor?.destroy();
  scriptEditor = undefined;
  spaEditor = undefined;
  const project = requireProject();
  const adapter = requireAdapter();
  normalizeActiveKind();
  const archive = archiveForKind(project, state.activeKind);
  const selected = clampFileId(state.selectedFileId);
  state.selectedFileId = selected;
  if (isScriptArchiveKind(state.activeKind) && !state.editorText) loadSelectedScript();
  const selectedName = state.activeKind === "move" ? moveListName(project, selected) : "";

  appRoot.innerHTML = `
    <section class="hg-shell">
      <header class="hg-header">
        <div>
          <h1>${escapeHtml(adapter.title)}</h1>
          <p>${project.romInfo.title || "Nintendo DS ROM"} (${project.romInfo.idCode}) - ${formatBytes(project.romInfo.size)} - ${state.fileName ?? "loaded ROM"}</p>
        </div>
        ${renderHeaderActions()}
      </header>
      <div class="hg-workspace">
        <aside class="hg-sidebar">
          <div class="hg-tabs">
            ${adapter.archiveKinds.map((kind) => `<button class="hg-tab ${state.activeKind === kind ? "-active" : ""}" data-kind="${kind}">${escapeHtml(adapter.archiveLabel(kind))} ${escapeHtml(adapter.archiveTitle(kind))}</button>`).join("")}
          </div>
          <div class="hg-filter">
            <input id="filter" value="${escapeAttr(state.filter)}" placeholder="Filter file IDs" />
            <label class="hg-favorites-filter">
              <input id="favorite-only" type="checkbox" ${state.favoriteOnly ? "checked" : ""} />
              Favorites only
            </label>
          </div>
          <div class="hg-list">${renderFileList()}</div>
        </aside>
        <section class="hg-editor">
          ${state.activeKind === "spa" ? renderSpaPane(archive.narc.files[selected]?.length ?? 0, selected) : renderScriptPane(archive.narc.files[selected]?.length ?? 0, selected, selectedName)}
          <div class="hg-footer ${state.status.kind ? `-${state.status.kind}` : ""}">${escapeHtml(state.status.text)}</div>
        </section>
      </div>
    </section>
  `;

  renderedSidebarKind = state.activeKind;
  bindWorkspaceEvents();
  restoreSidebarScroll();
  if (state.activeKind === "spa") mountSpaEditor();
  else if (adapter.supportsPreview) void mountCurrentPreview();
}

function captureSidebarScroll(): void {
  const list = appRoot.querySelector<HTMLElement>(".hg-list");
  if (!list) return;
  state.sidebarScrollTop[renderedSidebarKind ?? state.activeKind] = list.scrollTop;
}

function restoreSidebarScroll(): void {
  const list = appRoot.querySelector<HTMLElement>(".hg-list");
  if (!list) return;
  list.scrollTop = state.sidebarScrollTop[state.activeKind] ?? 0;
}

function renderHeaderActions(): string {
  const archiveFileName = archiveFileNameForKind(state.activeKind);
  return `
    <div class="hg-header__actions">
      <button id="load-new-rom" class="hg-btn">Load New ROM</button>
      ${state.activeKind === "spa" ? `<button id="append-spa" class="hg-btn">Append SPA</button><input id="append-spa-file" type="file" accept=".spa,application/octet-stream" multiple hidden />` : ""}
      <button id="export-bin" class="hg-btn">Export ${state.activeKind === "spa" ? ".spa" : ".bin"}</button>
      <button id="export-narc" class="hg-btn">Export ${archiveFileName}</button>
      <button id="export-rom" class="hg-btn -primary">Export ROM</button>
    </div>
  `;
}

function renderScriptPane(byteLength: number, selected: number, selectedName: string): string {
  const adapter = requireAdapter();
  const scriptKindLabel = state.activeKind === "move" ? "Move animation" : "Sub-animation";
  return `
    <div class="hg-toolbar">
      <div class="hg-toolbar__meta">${scriptKindLabel} ${String(selected).padStart(3, "0")}${selectedName ? ` - ${escapeHtml(selectedName)}` : ""} - ${formatBytes(byteLength)}${state.editorDirty ? " - unsaved edits" : ""}</div>
      <div class="hg-header__actions">
        <button id="reset-script" class="hg-btn">Reload</button>
        ${adapter.supportsPreview ? `<button id="preview-script" class="hg-btn">Preview</button>` : ""}
        ${adapter.supportsTestBattle ? `<button id="test-script" class="hg-btn">Test</button>` : ""}
        <button id="compile-script" class="hg-btn -primary">Compile & Save</button>
      </div>
    </div>
    ${adapter.supportsPreview ? `<div class="hg-scenario">
      <label>Side
        <select id="scenario-side">
          <option value="player" ${state.scenario.attackerSide === "player" ? "selected" : ""}>Player</option>
          <option value="opponent" ${state.scenario.attackerSide === "opponent" ? "selected" : ""}>Opponent</option>
        </select>
      </label>
      <label>Turn
        <select id="scenario-checkturn">
          <option value="0" ${state.scenario.checkturn === 0 ? "selected" : ""}>First branch</option>
          <option value="1" ${state.scenario.checkturn === 1 ? "selected" : ""}>Second branch</option>
        </select>
      </label>
      <label>Weather <input id="scenario-weather" type="number" min="0" max="4" step="1" value="${state.scenario.weatherIndex}" /></label>
      <label><input id="scenario-contest" type="checkbox" ${state.scenario.contest ? "checked" : ""} /> Contest</label>
      <label><input id="scenario-player-attack" type="checkbox" ${state.scenario.playerAttack ? "checked" : ""} /> ${adapter.id === "platinum" ? "Friendly fire" : "Player attack"}</label>
    </div>` : ""}
    <div class="hg-editor-layout">
      <div class="hg-script-editor-shell">
        <div class="hg-script-tabs" role="tablist" aria-label="Script view">
          <button class="hg-script-tab ${state.editorTab === "readable" ? "-active" : ""}" data-script-tab="readable" role="tab">Readable</button>
          <button class="hg-script-tab ${state.editorTab === "hgEngine" ? "-active" : ""}" data-script-tab="hgEngine" role="tab">${escapeHtml(adapter.scriptEngineLabel)}</button>
          ${state.editorTab === "hgEngine" ? `<button id="copy-hg-script" class="hg-btn -compact">Copy</button>` : ""}
        </div>
        <div id="script-editor" class="hg-code-editor ${state.editorTab === "hgEngine" ? "-readonly" : ""}"></div>
      </div>
      <aside id="hg-command-info" class="hg-command-info">${renderCommandInfo()}</aside>
    </div>
    ${adapter.supportsPreview ? `<section class="hg-preview-panel">
      <div class="hg-preview-panel__header">
        <strong>Animation preview</strong>
        <span>${currentPreview ? `${currentPreview.frameCount} frames - ${currentPreview.spaIds.length} SPA file(s)` : "Compile the current editor text to preview this script."}</span>
      </div>
      ${
        currentPreview?.warnings.length
          ? `<div class="move-animation-preview-warnings">${currentPreview.warnings.map((warning) => escapeHtml(warning.message)).join("<br>")}</div>`
          : ""
      }
      <div id="hg-preview-host" class="hg-preview-host"></div>
    </section>` : ""}
  `;
}

function renderSpaPane(byteLength: number, selected: number): string {
  const adapter = requireAdapter();
  return `
    <div class="hg-toolbar">
      <div class="hg-toolbar__meta">SPA particle file ${String(selected).padStart(3, "0")} - ${formatBytes(byteLength)}${archiveForKind(requireProject(), "spa").dirty.has(selected) ? " - edited" : ""} - ${escapeHtml(adapter.particleArchivePath)}</div>
      <div class="hg-header__actions">
        <button id="reload-spa" class="hg-btn">Reload Editor</button>
      </div>
    </div>
    <div id="hg-spa-editor" class="hg-spa-panel"></div>
  `;
}

function renderFileList(): string {
  const project = requireProject();
  const archive = archiveForKind(project, state.activeKind);
  const selected = clampFileId(state.selectedFileId);
  return archive.narc.files
    .map((bytes, id) => ({ id, bytes, name: moveListName(project, id), favorite: isFavorite(state.activeKind, id) }))
    .filter((file) => (!state.favoriteOnly || file.favorite) && fileMatchesFilter(file.id, file.name, state.filter))
    .map(
      (file) => `
        <div class="hg-file-row ${file.id === selected ? "-active" : ""}">
          <button class="hg-favorite ${file.favorite ? "-active" : ""}" data-favorite-id="${file.id}" aria-pressed="${file.favorite}" title="${file.favorite ? "Remove from favorites" : "Add to favorites"}">${file.favorite ? "★" : "☆"}</button>
          <button class="hg-file" data-file-id="${file.id}">
            <span class="hg-file__main">
              <strong>${String(file.id).padStart(3, "0")}</strong>
              ${state.activeKind === "move" && file.name ? `<em>${escapeHtml(file.name)}</em>` : ""}
            </span>
            <small>${formatBytes(file.bytes.length)}</small>
            ${archive.dirty.has(file.id) ? '<span class="hg-file__dirty">edited</span>' : ""}
          </button>
        </div>
      `,
    )
    .join("");
}

function refreshFileList(): void {
  const list = appRoot.querySelector<HTMLElement>(".hg-list");
  if (!list) return;
  list.innerHTML = renderFileList();
  bindFileListEvents();
}

function bindWorkspaceEvents(): void {
  appRoot.querySelectorAll<HTMLButtonElement>(".hg-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind as Gen4MoveAnimationArchiveKind;
      if (!hasArchiveKind(requireAdapter(), kind)) return;
      if (state.activeKind === kind) return;
      captureSidebarScroll();
      state.selectedFileIds[state.activeKind] = state.selectedFileId;
      state.activeKind = kind;
      state.selectedFileId = state.selectedFileIds[kind] ?? 0;
      state.filter = "";
      state.editorText = "";
      state.editorDirty = false;
      state.editorTab = "readable";
      clearPreview();
      state.status = { text: "" };
      persistEditorPrefs();
      render();
    });
  });

  appRoot.querySelector<HTMLInputElement>("#filter")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    state.filter = input.value;
    refreshFileList();
  });

  appRoot.querySelector<HTMLInputElement>("#favorite-only")?.addEventListener("change", (event) => {
    state.favoriteOnly = (event.currentTarget as HTMLInputElement).checked;
    persistEditorPrefs();
    refreshFileList();
  });

  appRoot.querySelector<HTMLButtonElement>("#load-new-rom")?.addEventListener("click", () => {
    resetToRomUpload();
  });

  bindFileListEvents();
  if (state.activeKind === "spa") bindSpaEvents();
  else bindEditorEvents();
}

function bindFileListEvents(): void {
  appRoot.querySelectorAll<HTMLButtonElement>(".hg-file").forEach((button) => {
    button.addEventListener("click", () => {
      const fileId = Number(button.dataset.fileId ?? 0);
      selectFile(fileId);
    });
  });
  appRoot.querySelectorAll<HTMLButtonElement>(".hg-favorite").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const fileId = Number(button.dataset.favoriteId ?? 0);
      toggleFavorite(state.activeKind, fileId);
      persistEditorPrefs();
      refreshFileList();
    });
  });
}

function bindEditorEvents(): void {
  mountScriptEditor();

  appRoot.querySelectorAll<HTMLButtonElement>("[data-script-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.scriptTab === "hgEngine" ? "hgEngine" : "readable";
      if (state.editorTab === tab) return;
      if (state.editorTab === "readable" && scriptEditor) state.editorText = scriptEditor.getValue();
      state.editorTab = tab;
      activeCommandReference = undefined;
      render();
    });
  });

  appRoot.querySelector<HTMLButtonElement>("#copy-hg-script")?.addEventListener("click", () => {
    void copyHgEngineScript();
  });

  appRoot.querySelector<HTMLButtonElement>("#reset-script")?.addEventListener("click", () => {
    loadSelectedScript();
    state.status = { text: "Reloaded script from the current binary.", kind: "ok" };
    render();
  });

  appRoot.querySelector<HTMLButtonElement>("#compile-script")?.addEventListener("click", () => {
    compileAndSave();
  });

  appRoot.querySelector<HTMLButtonElement>("#preview-script")?.addEventListener("click", () => {
    void previewScript({ initialPlaying: true });
  });

  appRoot.querySelector<HTMLButtonElement>("#test-script")?.addEventListener("click", () => {
    void launchHgTestBattle();
  });

  appRoot.querySelector<HTMLSelectElement>("#scenario-side")?.addEventListener("change", (event) => {
    state.scenario.attackerSide = (event.currentTarget as HTMLSelectElement).value === "opponent" ? "opponent" : "player";
    clearPreview();
    render();
  });
  appRoot.querySelector<HTMLSelectElement>("#scenario-checkturn")?.addEventListener("change", (event) => {
    state.scenario.checkturn = (event.currentTarget as HTMLSelectElement).value === "1" ? 1 : 0;
    clearPreview();
    render();
  });
  appRoot.querySelector<HTMLInputElement>("#scenario-weather")?.addEventListener("input", (event) => {
    state.scenario.weatherIndex = Math.max(0, Math.min(4, Math.round(Number((event.currentTarget as HTMLInputElement).value) || 0)));
    clearPreview();
  });
  appRoot.querySelector<HTMLInputElement>("#scenario-contest")?.addEventListener("change", (event) => {
    state.scenario.contest = (event.currentTarget as HTMLInputElement).checked;
    clearPreview();
    render();
  });
  appRoot.querySelector<HTMLInputElement>("#scenario-player-attack")?.addEventListener("change", (event) => {
    state.scenario.playerAttack = (event.currentTarget as HTMLInputElement).checked;
    clearPreview();
    render();
  });

  appRoot.querySelector<HTMLButtonElement>("#export-bin")?.addEventListener("click", () => {
    exportSelectedBin();
  });
  appRoot.querySelector<HTMLButtonElement>("#export-narc")?.addEventListener("click", () => {
    exportActiveNarc();
  });
  appRoot.querySelector<HTMLButtonElement>("#export-rom")?.addEventListener("click", () => {
    exportRom();
  });

  appRoot.querySelector<HTMLElement>("#hg-command-info")?.addEventListener("change", (event) => {
    handleCommandInfoChange(event);
  });
}

function bindSpaEvents(): void {
  appRoot.querySelector<HTMLButtonElement>("#reload-spa")?.addEventListener("click", () => {
    mountSpaEditor();
    state.status = { text: `Reloaded SPA editor for file ${state.selectedFileId}.`, kind: "ok" };
    const footer = appRoot.querySelector<HTMLElement>(".hg-footer");
    if (footer) {
      footer.textContent = state.status.text;
      footer.className = "hg-footer -ok";
    }
  });
  appRoot.querySelector<HTMLButtonElement>("#append-spa")?.addEventListener("click", () => {
    appRoot.querySelector<HTMLInputElement>("#append-spa-file")?.click();
  });
  appRoot.querySelector<HTMLInputElement>("#append-spa-file")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) void appendSpaFiles(files);
  });
  appRoot.querySelector<HTMLButtonElement>("#export-bin")?.addEventListener("click", () => {
    exportSelectedBin();
  });
  appRoot.querySelector<HTMLButtonElement>("#export-narc")?.addEventListener("click", () => {
    exportActiveNarc();
  });
  appRoot.querySelector<HTMLButtonElement>("#export-rom")?.addEventListener("click", () => {
    exportRom();
  });
}

function mountSpaEditor(): void {
  const host = appRoot.querySelector<HTMLElement>("#hg-spa-editor");
  const project = state.project;
  const adapter = state.adapter;
  if (!host || !project || !adapter) return;
  const fileId = clampFileId(state.selectedFileId);
  spaEditor = installMoveSpaEditorWithSource(
    host,
    "",
    {
      loadArchive: (spaId) => adapter.loadSpaArchive(project, spaId),
      updateArchive: (spaId, archive) => adapter.updateSpaArchive(project, spaId, archive),
      exportArchive: (spaId, archive) => adapter.exportSpaFile(project, spaId, archive),
      referencedSpaIds: () => [],
      emptyLabel: "Choose a SPA file from the list to edit particle resources.",
      loadingLabel: `Loading ${adapter.archiveTitle("spa")} file...`,
      selectorLabel: `${adapter.archiveLabel("spa")} SPA file`,
    },
    {
      onDirty: () => {
        refreshFileList();
        refreshToolbarMeta();
      },
    },
  );
  void spaEditor.setSpaIds([fileId], fileId);
}

function mountScriptEditor(): void {
  const host = appRoot.querySelector<HTMLElement>("#script-editor");
  if (!host) return;
  const adapter = requireAdapter();
  scriptEditor?.destroy();
  const readOnly = state.editorTab === "hgEngine";
  scriptEditor = installHgMoveAnimationCodeEditor(host, readOnly ? hgEngineScriptForEditor() : state.editorText, {
    onChange: (text) => {
      if (readOnly) return;
      state.editorText = text;
      state.editorDirty = true;
      clearPreview();
      refreshToolbarMeta();
    },
    onCommandSelected: (reference) => {
      activeCommandReference = reference;
      const panel = appRoot.querySelector<HTMLElement>("#hg-command-info");
      if (panel) panel.innerHTML = renderCommandInfo(reference);
    },
    readOnly,
    commandDefinitions: adapter.commandDefinitions,
    readableCommandAliases: adapter.readableCommandAliases,
    helperByName: adapter.id === "hg" ? HG_MOVE_ANIMATION_HELPER_BY_NAME : new Map(),
    constants: adapter.id === "hg" ? undefined : new Set(),
  });
}

function hgEngineScriptForEditor(): string {
  if (!isScriptArchiveKind(state.activeKind)) return "";
  const adapter = requireAdapter();
  try {
    const bytes = adapter.compileScript(state.editorText, state.activeKind, state.selectedFileId);
    return adapter.decompileEngineScript(bytes, state.activeKind, state.selectedFileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `@ ${adapter.scriptEngineUnavailableComment}\n@ ${message}\n`;
  }
}

async function copyHgEngineScript(): Promise<void> {
  try {
    const text = hgEngineScriptForEditor();
    if (!navigator.clipboard) throw new Error("Clipboard API is not available in this browser context.");
    await navigator.clipboard.writeText(text);
    state.status = { text: `Copied ${requireAdapter().scriptEngineLabel} script to clipboard.`, kind: "ok" };
    const footer = appRoot.querySelector<HTMLElement>(".hg-footer");
    if (footer) {
      footer.textContent = state.status.text;
      footer.className = "hg-footer -ok";
    }
  } catch (error) {
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    const footer = appRoot.querySelector<HTMLElement>(".hg-footer");
    if (footer) {
      footer.textContent = state.status.text;
      footer.className = "hg-footer -error";
    }
  }
}

function refreshToolbarMeta(): void {
  const project = state.project;
  const adapter = state.adapter;
  const archive = project ? archiveForKind(project, state.activeKind) : undefined;
  const selected = project ? clampFileId(state.selectedFileId) : state.selectedFileId;
  const selectedName = project && state.activeKind === "move" ? moveListName(project, selected) : "";
  const meta = appRoot.querySelector<HTMLElement>(".hg-toolbar__meta");
  if (!meta || !archive) return;
  if (state.activeKind === "spa") {
    meta.textContent = `SPA particle file ${String(selected).padStart(3, "0")} - ${formatBytes(archive.narc.files[selected]?.length ?? 0)}${archive.dirty.has(selected) ? " - edited" : ""}${adapter ? ` - ${adapter.particleArchivePath}` : ""}`;
    return;
  }
  meta.textContent = `${state.activeKind === "move" ? "Move animation" : "Sub-animation"} ${String(selected).padStart(3, "0")}${selectedName ? ` - ${selectedName}` : ""} - ${formatBytes(archive.narc.files[selected]?.length ?? 0)}${state.editorDirty ? " - unsaved edits" : ""}`;
}

function renderCommandInfo(reference?: HgCommandReference): string {
  const adapter = state.adapter ?? HG_MOVE_ANIMATION_ADAPTER;
  if (!reference) {
    return `
      <div class="hg-command-info__empty">
        <strong>Command info</strong>
        <p>Place the cursor on a script command to inspect what it does and what each parameter means.</p>
      </div>
    `;
  }
  if (reference.helper) {
    return `
      <div class="hg-command-info__header">
        <span>Helper macro</span>
        <strong>${escapeHtml(reference.helper.name)}</strong>
      </div>
      <p>${escapeHtml(reference.helper.description)}</p>
      <dl class="hg-command-info__params">
        ${renderParamRows(reference.helper.params, reference.params, reference.helper.name)}
      </dl>
      ${renderColorControls(reference)}
      <div class="hg-command-info__note">Expands to ${escapeHtml(reference.helper.expandsTo)}.</div>
      <code>${escapeHtml(reference.lineText.trim())}</code>
    `;
  }
  if (!reference.definition) {
    return `
      <div class="hg-command-info__header">
        <span>Unknown</span>
        <strong>${escapeHtml(reference.name)}</strong>
      </div>
      <p>This name is not in the ${escapeHtml(adapter.scriptEngineLabel)} command table${adapter.id === "hg" ? " or helper macro list" : ""}. It may fail to compile unless it is defined elsewhere.</p>
      <code>${escapeHtml(reference.lineText.trim())}</code>
    `;
  }
  const definition = reference.definition;
  const opcode = `0x${definition.opcode.toString(16).toUpperCase().padStart(2, "0")}`;
  return `
    <div class="hg-command-info__header">
      <span>Opcode ${opcode}</span>
      <strong>${escapeHtml(definition.name)}</strong>
    </div>
    <p>${escapeHtml(commandDescription(definition.name, adapter))}</p>
    <dl class="hg-command-info__params">
      ${renderParamRows(definition.params, reference.params, definition.name, adapter)}
    </dl>
    ${definition.branchParams?.length ? `<div class="hg-command-info__note">Branch parameter(s): ${definition.branchParams.map((index) => definition.params[index] ?? `param${index}`).join(", ")}.</div>` : ""}
    ${definition.variable ? `<div class="hg-command-info__note">Variable length: parameter ${definition.variable.countParam + 1} controls up to ${definition.variable.maxVariableParams} trailing value(s).</div>` : ""}
    ${renderCommandExtra(definition.name, reference.params, adapter)}
    ${renderColorControls(reference)}
    <code>${escapeHtml(reference.lineText.trim())}</code>
  `;
}

function renderParamRows(names: string[], values: string[], commandName: string, adapter = state.adapter ?? HG_MOVE_ANIMATION_ADAPTER): string {
  if (names.length === 0) return `<div class="hg-command-info__note">No parameters.</div>`;
  return names
    .map((name, index) => {
      const value = values[index] ?? "";
      return `
        <div>
          <dt>${escapeHtml(name)}</dt>
          <dd>
            <strong>${value ? escapeHtml(value) : "missing"}</strong>
            <span>${escapeHtml(paramDescription(commandName, name, index, adapter))}</span>
          </dd>
        </div>
      `;
    })
    .join("");
}

function commandDescription(name: string, adapter = state.adapter ?? HG_MOVE_ANIMATION_ADAPTER): string {
  if (adapter.id === "platinum") return platinumCommandDescription(name);
  const lower = name.toLowerCase();
  const primitiveNote = HG_PRIMITIVE_COMMAND_BY_NAME.get(lower);
  if (primitiveNote) return `${primitiveNote.inferredName}: ${primitiveNote.description}`;
  const descriptions: Record<string, string> = {
    wait: "Advances script time by a fixed number of frames.",
    waitstate: "Waits for active animation state work to settle before continuing.",
    loop: "Starts or updates the loop counter used by doloop.",
    doloop: "Branches back to the current loop body until the loop counter finishes.",
    end: "Stops the current animation script.",
    call: "Calls another script label and returns when that label runs return.",
    return: "Returns from a call.",
    checkturn: "Chooses one of two labels based on the preview turn scenario.",
    changebg: "Loads and applies an HG move effect background.",
    changebgparam: "Loads an HG move effect background with additional layer parameters.",
    resetbg: "Clears the move effect background and restores the battle backdrop.",
    playse: "Plays a sound effect.",
    playsepan: "Plays a sound effect with stereo panning.",
    playsepanmod: "Plays a panned sound effect and interpolates pan over time.",
    repeatse: "Repeats a sound effect on an interval.",
    waitse: "Waits for sound effect timing.",
    stopse: "Stops a sound effect.",
    callfunction: "Invokes one of the HG animation engine helper functions with variable parameters.",
    addparticle: "Spawns a loaded SPA particle resource at a target.",
    addparticle2: "Spawns a loaded SPA particle resource with an extra mode parameter.",
    addsequentialparticle: "Spawns a sequence of SPA particle resources.",
    addparticlebasedonbattler: "Spawns a particle effect whose position is based on battler side.",
    waitparticle: "Waits until active particle effects complete.",
    loadparticle: "Loads a SPA file into a particle slot.",
    unloadparticle: "Unloads a particle slot.",
    initspriteresource: "Initializes sprite resource handling for later sprite helper commands.",
    loadspriteresource: "Loads a sprite resource bank entry.",
    loadspritemaybe: "Loads or binds a sprite-related resource tuple.",
    unloadspriteresource: "Releases sprite resources initialized for helper effects.",
    resetsprite: "Resets a sprite resource slot.",
    jumpifside: "Branches based on attacker side.",
    jumpbasedonweather: "Branches based on the selected weather scenario.",
    jumpifcontest: "Branches when contest mode is active.",
    jumpifplayerattack: "Branches when the player is the attacker.",
    changepermanentbg: "Requests a battlefield background change; currently previewed as a marker.",
  };
  return descriptions[lower] ?? "HG primitive animation command.";
}

function paramDescription(commandName: string, paramName: string, index: number, adapter = state.adapter ?? HG_MOVE_ANIMATION_ADAPTER): string {
  if (adapter.id === "platinum") return platinumParamDescription(commandName, paramName, index);
  const lowerCommand = commandName.toLowerCase();
  const lower = paramName.toLowerCase();
  const researchedParam = HG_PRIMITIVE_COMMAND_BY_NAME.get(lowerCommand)?.params?.[index];
  if (researchedParam) return researchedParam.description;
  if (lower.includes("address")) return "Label to branch or call.";
  if (lower === "time") return "Frame count.";
  if (lower === "slot" || lower === "num0" && lowerCommand.includes("particle")) return "Particle slot index.";
  if (lower === "file" || lower === "spafile") return "File id inside the referenced NARC.";
  if (lower === "id") return "Sound or resource id.";
  if (lower === "pan") return "Stereo pan value.";
  if (lower === "func" || lower === "function") return "HG animation helper function id.";
  if (lower === "count" || lower.includes("count")) return "Number of following variable parameters.";
  if (lower === "priority") return "Particle draw priority or layer selector.";
  if (lower === "target") return "Particle target selector.";
  if (lower === "position") return "Particle starting position mode.";
  if (lower === "axis") return "Particle movement axis mode.";
  if (lower === "field") return "Particle field-effect bit mask.";
  if (lower === "camera") return "Particle camera behavior mode.";
  if (lower === "exmode") return "Secondary particle operator mode.";
  if (lower === "reverse") return "Direction or side mirroring flag.";
  if (lower === "bg") return "Background id.";
  if (lower === "terrain") return "Terrain or battlefield background argument.";
  if (lower === "r" || lower === "g" || lower === "b" || lower === "red" || lower === "green" || lower === "blue") return "RGB555 color channel; normal channel values are 0 through 31, but existing raw values are preserved.";
  if (lowerCommand === "loadparticle" && index === 1) return "SPA file id from /a/0/2/9.";
  if (lowerCommand.startsWith("addparticle") && index === 1) return "Resource id inside the loaded SPA.";
  if (lowerCommand.startsWith("addparticle") && index === 2) return "Target constant, usually ANIM_TARGET_USER or ANIM_TARGET_DEFENDER.";
  return "Raw numeric parameter.";
}

function platinumCommandDescription(name: string): string {
  const lower = name.toLowerCase();
  const descriptions: Record<string, string> = {
    delay: "Advances script time by a fixed number of frames.",
    waitforanimtasks: "Waits for active animation tasks to finish.",
    beginloop: "Starts a counted script loop.",
    endloop: "Ends a counted script loop.",
    end: "Stops the current animation script.",
    playsoundeffect: "Plays a sound effect by numeric sequence id.",
    call: "Calls another script label and returns when that label runs Return.",
    return: "Returns from a Call.",
    setvar: "Stores a raw numeric value in one of Platinum's script variables.",
    jump: "Branches to another script label.",
    jumpifequal: "Branches when a script variable equals a value.",
    jumpifbattlerside: "Branches based on the selected battler's side.",
    jumpifweather: "Branches to one of five labels based on field weather.",
    jumpifcontest: "Branches when the animation runs in contest mode.",
    jumpiffriendlyfire: "Branches when attacker and defender are on the same side.",
    loadparticlesystem: "Loads a particle SPA member into a particle system slot.",
    unloadparticlesystem: "Unloads a particle system slot.",
    createemitter: "Creates a particle emitter from a loaded particle system.",
    waitforallemitters: "Waits for particle emitters to finish.",
    callfunc: "Invokes one of Platinum's battle animation helper functions with variable numeric parameters.",
    setextraparams: "Stores a variable-length parameter block consumed by the following particle or helper command.",
    addspritewithfunc: "Creates a sprite and invokes a sprite callback function with variable numeric parameters.",
  };
  if (lower.startsWith("nop")) return "No-op command retained for byte-faithful script editing.";
  return descriptions[lower] ?? "Platinum battle animation command. V1 accepts numeric operands only.";
}

function platinumParamDescription(commandName: string, paramName: string, index: number): string {
  const lowerCommand = commandName.toLowerCase();
  const lower = paramName.toLowerCase();
  if (lower.includes("addr")) return "Label to branch or call.";
  if (lower === "frames" || lower.includes("frame")) return "Frame count.";
  if (lower === "count" || lower.includes("count")) return "Number of following variable parameters.";
  if (lower === "funcid") return lowerCommand === "addspritewithfunc" ? "Sprite callback function id." : "Battle animation function id.";
  if (lower === "particlesystem") return "Particle system slot index.";
  if (lower === "narcmemberid" || lower === "narcmemberindex") return "File id inside the referenced Platinum NARC.";
  if (lower === "resourceid") return "Resource id inside the loaded SPA.";
  if (lower === "callbackid") return "Particle callback id.";
  if (lower === "seqid") return "Sound effect sequence id.";
  if (lower === "pan" || lower.includes("pan")) return "Stereo pan value.";
  if (lower.includes("battler")) return "Battler role or side selector.";
  if (lower.includes("sprite")) return "Sprite manager or sprite id.";
  if (lower.includes("bg")) return "Battle background id or switch parameter.";
  if (lower.startsWith("arg")) return "Raw numeric argument.";
  if (lowerCommand === "jumpifequal" && index < 2) return index === 0 ? "Script variable id." : "Value to compare.";
  return "Raw numeric parameter.";
}

function renderCommandExtra(name: string, params: string[], adapter = state.adapter ?? HG_MOVE_ANIMATION_ADAPTER): string {
  if (adapter.id !== "hg") return name.toLowerCase() === "callfunc" ? `<div class="hg-command-info__note">Function id ${escapeHtml(params[0] ?? "missing")} is passed to Platinum's battle animation script function table.</div>` : "";
  if (name.toLowerCase() !== "callfunction" && name.toLowerCase() !== "cmd36" && name.toLowerCase() !== "cmd37") return "";
  const first = parseNumberLike(params[0]);
  const helper = first === undefined ? undefined : functionIdDescription(first);
  return helper ? `<div class="hg-command-info__note">${escapeHtml(helper)}</div>` : "";
}

function functionIdDescription(id: number): string | undefined {
  const documented = HG_CALLFUNCTION_BY_ID.get(id);
  if (documented) return documented.description;
  const descriptions: Record<number, string> = {
    33: "Function 33: screen tint or fade helper.",
    34: "Function 34: Pokemon sprite tint helper.",
    36: "Function 36: actor shake helper.",
    57: "Function 57: actor slide or movement helper.",
    68: "Function 68: screen shake helper.",
    78: "Function 78: particle resource setup helper.",
  };
  return descriptions[id];
}

function renderColorControls(reference: HgCommandReference): string {
  const groups = colorGroupsForReference(reference);
  if (groups.length === 0) return "";
  return `
    <div class="hg-command-info__colors">
      <strong>Color picker</strong>
      ${groups
        .map(
          (group, index) => `
            <label>
              <span>${escapeHtml(group.label)}</span>
              <input class="hg-color-input" type="color" value="${colorHexForGroup(reference.params, group)}" data-color-index="${index}" />
            </label>
          `,
        )
        .join("")}
      <small>The picker writes normal RGB555 channels (0-31). Existing larger raw values are preserved until changed.</small>
    </div>
  `;
}

function colorGroupsForReference(reference: HgCommandReference): HgColorParameterGroup[] {
  if (reference.helper?.colorParams) return [...reference.helper.colorParams];
  if (reference.name.toLowerCase() !== "callfunction") return [];
  const functionId = parseIntegerExpression(reference.params[0]);
  return functionId === undefined ? [] : [...(HG_CALLFUNCTION_BY_ID.get(functionId)?.colorParams ?? [])];
}

function handleCommandInfoChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("hg-color-input")) return;
  const reference = activeCommandReference;
  if (!reference || !scriptEditor) return;
  if (state.editorTab !== "readable") return;
  const group = colorGroupsForReference(reference)[Number(target.dataset.colorIndex ?? -1)];
  if (!group) return;
  const nextParams = paramsWithColor(reference.params, group, target.value);
  scriptEditor.replaceCommandParams(reference, nextParams);
  state.editorText = scriptEditor.getValue();
  state.editorDirty = true;
  clearPreview();
  refreshToolbarMeta();
}

function paramsWithColor(params: string[], group: HgColorParameterGroup, hex: string): string[] {
  const next = params.slice();
  const [red, green, blue] = hexToRgb5(hex);
  if (group.kind === "rgb555Triplet") {
    next[group.indices[0]] = String(red);
    next[group.indices[1]] = String(green);
    next[group.indices[2]] = String(blue);
  } else {
    next[group.index] = String(red | (green << 5) | (blue << 10));
  }
  return next;
}

function colorHexForGroup(params: string[], group: HgColorParameterGroup): string {
  if (group.kind === "rgb555Triplet") {
    return rgb5ToHex(parseIntegerExpression(params[group.indices[0]]) ?? 0, parseIntegerExpression(params[group.indices[1]]) ?? 0, parseIntegerExpression(params[group.indices[2]]) ?? 0);
  }
  const packed = parseIntegerExpression(params[group.index]) ?? 0;
  return rgb5ToHex(packed & 0x1f, (packed >> 5) & 0x1f, (packed >> 10) & 0x1f);
}

function rgb5ToHex(red: number, green: number, blue: number): string {
  const to8 = (value: number): string => Math.round((Math.max(0, Math.min(31, value)) * 255) / 31)
    .toString(16)
    .padStart(2, "0");
  return `#${to8(red)}${to8(green)}${to8(blue)}`;
}

function hexToRgb5(hex: string): [number, number, number] {
  const normalized = /^#?([0-9a-f]{6})$/iu.exec(hex)?.[1] ?? "000000";
  const to5 = (offset: number): number => Math.round((Number.parseInt(normalized.slice(offset, offset + 2), 16) * 31) / 255);
  return [to5(0), to5(2), to5(4)];
}

function parseNumberLike(value: string | undefined): number | undefined {
  return parseIntegerExpression(value);
}

function parseIntegerExpression(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^["']|["']$/gu, "").trim();
  if (normalized.toLowerCase() === "nan") return undefined;
  try {
    const parser = new UiIntegerExpressionParser(normalized);
    const parsed = parser.parse();
    return Number.isFinite(parsed) ? parsed | 0 : undefined;
  } catch {
    return undefined;
  }
}

class UiIntegerExpressionParser {
  private readonly tokens: string[];
  private cursor = 0;

  constructor(input: string) {
    this.tokens = input.match(/0x[0-9a-f]+|\d+|<<|[|()+-]/giu) ?? [];
    if (this.tokens.join("").toLowerCase() !== input.replace(/\s+/gu, "").toLowerCase()) throw new Error("Unsupported expression");
  }

  parse(): number {
    const value = this.parseOr();
    if (this.cursor !== this.tokens.length) throw new Error("Trailing expression token");
    return value;
  }

  private parseOr(): number {
    let value = this.parseShift();
    while (this.peek() === "|") {
      this.cursor += 1;
      value = (value | this.parseShift()) | 0;
    }
    return value;
  }

  private parseShift(): number {
    let value = this.parseUnary();
    while (this.peek() === "<<") {
      this.cursor += 1;
      value = (value << this.parseUnary()) | 0;
    }
    return value;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token === "+" || token === "-") {
      this.cursor += 1;
      const value = this.parseUnary();
      return token === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.cursor++];
    if (!token) throw new Error("Missing expression value");
    if (token === "(") {
      const value = this.parseOr();
      if (this.tokens[this.cursor++] !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    return token.toLowerCase().startsWith("0x") ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token, 10);
  }

  private peek(): string | undefined {
    return this.tokens[this.cursor];
  }
}

async function loadRomFile(file: File): Promise<void> {
  const generation = ++romLoadGeneration;
  try {
    state.status = { text: "Reading ROM..." };
    renderUpload();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== romLoadGeneration) return;
    loadRomBytes(bytes, file.name, "Loaded");
    void saveLatestRom(file.name, bytes);
  } catch (error) {
    if (generation !== romLoadGeneration) return;
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    renderUpload();
  }
}

function loadRomBytes(bytes: Uint8Array, fileName: string, verb: "Loaded" | "Restored"): void {
  const { adapter, project } = loadGen4MoveAnimationProject(bytes);
  state.adapter = adapter;
  const prefs = loadEditorPrefs(fileName, project);
  state.project = project;
  state.fileName = fileName;
  state.romBytes = bytes.slice();
  state.activeKind = prefs.activeKind;
  state.selectedFileIds = prefs.selectedFileIds;
  state.selectedFileId = state.selectedFileIds[state.activeKind] ?? 0;
  state.filter = "";
  state.favoriteOnly = prefs.favoriteOnly;
  state.favorites = prefs.favorites;
  state.editorText = "";
  state.editorDirty = false;
  state.editorTab = "readable";
  state.scenario = defaultPreviewScenario(adapter);
  state.status = {
    text: adapter.loadStatus(project, verb),
    kind: "ok",
  };
  state.selectedFileId = clampFileId(state.selectedFileId);
  state.selectedFileIds[state.activeKind] = state.selectedFileId;
  clearPreview();
  loadSelectedScript();
  render();
  if (adapter.supportsPreview && isScriptArchiveKind(state.activeKind)) void previewScript({ initialPlaying: false, statusText: `${verb} preview at frame 0.` });
}

async function restoreLatestRom(): Promise<void> {
  const generation = romLoadGeneration;
  try {
    const cached = await loadLatestRom();
    if (!cached || state.project || generation !== romLoadGeneration) return;
    state.status = { text: `Restoring ${cached.fileName} from browser storage...` };
    renderUpload();
    loadRomBytes(cached.bytes, cached.fileName, "Restored");
  } catch (error) {
    if (state.project || generation !== romLoadGeneration) return;
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    renderUpload();
  }
}

function resetToRomUpload(): void {
  romLoadGeneration += 1;
  clearPreview();
  scriptEditor?.destroy();
  scriptEditor = undefined;
  spaEditor = undefined;
  activeCommandReference = undefined;
  renderedSidebarKind = undefined;
  state.project = undefined;
  state.adapter = undefined;
  state.fileName = undefined;
  state.romBytes = undefined;
  state.activeKind = "move";
  state.selectedFileId = 0;
  state.selectedFileIds = {};
  state.sidebarScrollTop = {};
  state.filter = "";
  state.favoriteOnly = false;
  state.favorites = {};
  state.editorText = "";
  state.editorDirty = false;
  state.editorTab = "readable";
  state.scenario = defaultPreviewScenario();
  state.status = { text: "Choose a HeartGold, HG-engine, or Pokemon Platinum ROM to load." };
  render();
}

function selectFile(fileId: number): void {
  state.selectedFileId = fileId;
  state.selectedFileIds[state.activeKind] = fileId;
  state.editorText = "";
  state.editorDirty = false;
  state.editorTab = "readable";
  clearPreview();
  state.status = { text: "" };
  persistEditorPrefs();
  if (isScriptArchiveKind(state.activeKind)) loadSelectedScript();
  render();
  if (requireAdapter().supportsPreview && isScriptArchiveKind(state.activeKind)) void previewScript({ initialPlaying: false, statusText: "Loaded preview at frame 0." });
}

async function previewScript(options: { initialPlaying: boolean; statusText?: string } = { initialPlaying: true }): Promise<void> {
  let token = previewRequest;
  try {
    clearPreview();
    token = previewRequest;
    if (!requireAdapter().supportsPreview) throw new Error("Preview support is not available for this game yet.");
    const adapter = requireAdapter();
    state.status = { text: `Building ${adapter.id === "platinum" ? "Platinum" : "HG"} animation preview...` };
    render();
    if (!isScriptArchiveKind(state.activeKind)) throw new Error("SPA files do not have script previews.");
    const preview = await adapter.buildPreview(requireProject(), state.activeKind, state.selectedFileId, state.editorText, state.scenario);
    if (token !== previewRequest) return;
    currentPreview = preview;
    currentPreviewInitialPlaying = options.initialPlaying;
    state.status = {
      text: options.statusText ?? `Preview ready: ${preview.frameCount} frames, ${preview.timeline.length} timeline event(s), ${preview.warnings.length} warning(s).`,
      kind: preview.warnings.length > 0 ? undefined : "ok",
    };
    render();
  } catch (error) {
    if (token !== previewRequest) return;
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    render();
  }
}

async function mountCurrentPreview(): Promise<void> {
  const preview = currentPreview;
  if (!preview) return;
  const host = appRoot.querySelector<HTMLElement>("#hg-preview-host");
  if (!host) return;
  previewController?.destroy();
  previewController = await installMoveAnimationPreview(host, preview, { initialPlaying: currentPreviewInitialPlaying });
}

function clearPreview(): void {
  previewRequest += 1;
  currentPreview = undefined;
  currentPreviewInitialPlaying = true;
  previewController?.destroy();
  previewController = undefined;
}

function loadSelectedScript(): void {
  if (!isScriptArchiveKind(state.activeKind)) return;
  const project = requireProject();
  const adapter = requireAdapter();
  const archive = archiveForKind(project, state.activeKind);
  const fileId = clampFileId(state.selectedFileId);
  const bytes = archive.narc.files[fileId];
  if (!bytes) {
    state.editorText = "";
    state.editorDirty = false;
    state.status = { text: `Animation file ${fileId} is empty or missing.`, kind: "error" };
    return;
  }
  state.editorText = adapter.decompileScript(project, state.activeKind, fileId);
  state.editorDirty = false;
}

function compileAndSave(): void {
  try {
    if (!isScriptArchiveKind(state.activeKind)) throw new Error("SPA files are saved from the SPA editor.");
    const adapter = requireAdapter();
    const bytes = adapter.updateScript(requireProject(), state.activeKind, state.selectedFileId, state.editorText);
    state.editorDirty = false;
    state.status = { text: `Compiled ${formatBytes(bytes.length)} into ${adapter.archiveLabel(state.activeKind)} file ${state.selectedFileId}.`, kind: "ok" };
    render();
  } catch (error) {
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    render();
  }
}

function exportSelectedBin(): void {
  try {
    const adapter = requireAdapter();
    const bytes = state.activeKind === "spa"
      ? adapter.exportSpaFile(requireProject(), state.selectedFileId, spaEditor?.getArchiveOverride(state.selectedFileId))
      : adapter.compileScript(state.editorText, state.activeKind, state.selectedFileId);
    download(bytes, `${archiveLabelForKind(state.activeKind)}_${String(state.selectedFileId).padStart(3, "0")}.${state.activeKind === "spa" ? "spa" : "bin"}`);
    state.status = { text: `Exported selected binary (${formatBytes(bytes.length)}).`, kind: "ok" };
    render();
  } catch (error) {
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    render();
  }
}

function exportActiveNarc(): void {
  const bytes = requireAdapter().exportArchive(requireProject(), state.activeKind);
  download(bytes, archiveFileNameForKind(state.activeKind));
}

function exportRom(): void {
  const bytes = requireAdapter().exportRom(requireProject());
  const baseName = state.fileName?.replace(/\.nds$/iu, "") || "move-animation";
  download(bytes, `${baseName}-edited.nds`);
}

async function launchHgTestBattle(): Promise<void> {
  const project = state.project;
  if (!project) {
    state.status = { text: "Reload the HeartGold ROM before launching a test.", kind: "error" };
    render();
    return;
  }
  if (state.activeKind !== "move") {
    state.status = { text: "Select a move animation before launching a HeartGold test.", kind: "error" };
    render();
    return;
  }

  const emulator = openTestBattleEmulator();
  const baseName = state.fileName?.replace(/\.nds$/iu, "") || "heartgold";
  try {
    state.status = { text: "Building HeartGold test battle..." };
    render();
    const { romBytes, saveBytes, saveName } = await buildHgMoveAnimationTestBattleDownloads(project as HgMoveAnimationRom, state.selectedFileId, state.editorText, favoriteMoveIdsForTest());
    await emulator.launch({
      romName: `${baseName}-hg-test.nds`,
      saveName: saveName ?? "testani.dsv",
      trainerId: state.selectedFileId,
      testLabel: "HeartGold animation test",
      romBytes: romBytes.slice(),
      saveBytes,
    });
    state.status = { text: "HeartGold test launched.", kind: "ok" };
    render();
  } catch (error) {
    emulator.close();
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    render();
  }
}

async function appendSpaFiles(files: File[]): Promise<void> {
  try {
    const adapter = requireAdapter();
    state.status = { text: `Appending ${files.length} SPA file${files.length === 1 ? "" : "s"}...` };
    const bytes = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
    const appended = adapter.appendSpaFiles(requireProject(), bytes);
    if (!appended.length) throw new Error("No SPA files were appended.");
    state.selectedFileId = appended[0];
    state.status = { text: `Appended SPA file${appended.length === 1 ? "" : "s"} ${appended.join(", ")} to ${adapter.archiveLabel("spa")}.`, kind: "ok" };
    render();
  } catch (error) {
    state.status = { text: error instanceof Error ? error.message : String(error), kind: "error" };
    render();
  }
}

function requireProject(): Gen4MoveAnimationProject {
  if (!state.project) throw new Error("No ROM is loaded");
  return state.project;
}

function requireAdapter(): Gen4MoveAnimationAdapter {
  if (!state.adapter) throw new Error("No ROM is loaded");
  return state.adapter;
}

function normalizeActiveKind(): void {
  const adapter = requireAdapter();
  if (!hasArchiveKind(adapter, state.activeKind)) {
    state.activeKind = adapter.archiveKinds[0];
    state.selectedFileId = state.selectedFileIds[state.activeKind] ?? 0;
  }
}

function clampFileId(fileId: number): number {
  const archive = archiveForKind(requireProject(), state.activeKind);
  if (archive.narc.files.length === 0) return 0;
  return Math.max(0, Math.min(archive.narc.files.length - 1, fileId));
}

function moveListName(project: Gen4MoveAnimationProject, fileId: number): string {
  if (state.activeKind !== "move") return "";
  return requireAdapter().moveName(project, fileId);
}

type StoredHgEditorPrefs = {
  activeKind?: unknown;
  selectedFileIds?: Partial<Record<Gen4MoveAnimationArchiveKind, unknown>>;
  favoriteOnly?: unknown;
  favorites?: Partial<Record<Gen4MoveAnimationArchiveKind, unknown>>;
};

type HgEditorPrefs = {
  activeKind: Gen4MoveAnimationArchiveKind;
  selectedFileIds: Partial<Record<Gen4MoveAnimationArchiveKind, number>>;
  favoriteOnly: boolean;
  favorites: Partial<Record<Gen4MoveAnimationArchiveKind, Set<number>>>;
};

function loadEditorPrefs(fileName: string, project: Gen4MoveAnimationProject): HgEditorPrefs {
  const adapter = requireAdapter();
  const stored = readEditorPrefsMap()[editorPrefsKey(fileName, project)] ?? {};
  const activeKind = isArchiveKind(stored.activeKind) && hasArchiveKind(adapter, stored.activeKind) ? stored.activeKind : "move";
  const selectedFileIds: Partial<Record<Gen4MoveAnimationArchiveKind, number>> = {};
  for (const kind of adapter.archiveKinds) {
    const raw = stored.selectedFileIds?.[kind];
    const parsed = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    selectedFileIds[kind] = clampFileIdForKind(project, kind, parsed ?? 0);
  }
  return {
    activeKind,
    selectedFileIds,
    favoriteOnly: stored.favoriteOnly === true,
    favorites: deserializeFavorites(project, stored.favorites),
  };
}

function persistEditorPrefs(): void {
  const project = state.project;
  const fileName = state.fileName;
  const adapter = state.adapter;
  if (!project || !fileName || !adapter) return;
  try {
    state.selectedFileIds[state.activeKind] = state.selectedFileId;
    const prefsMap = readEditorPrefsMap();
    prefsMap[editorPrefsKey(fileName, project)] = {
      activeKind: state.activeKind,
      selectedFileIds: { ...state.selectedFileIds },
      favoriteOnly: state.favoriteOnly,
      favorites: serializeFavorites(state.favorites),
    };
    localStorage.setItem(HG_EDITOR_PREFS_KEY, JSON.stringify(prefsMap));
  } catch (error) {
    console.warn("Failed to persist HG editor preferences", error);
  }
}

function readEditorPrefsMap(): Record<string, StoredHgEditorPrefs> {
  try {
    const raw = localStorage.getItem(HG_EDITOR_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, StoredHgEditorPrefs> : {};
  } catch {
    return {};
  }
}

function editorPrefsKey(fileName: string, project: Gen4MoveAnimationProject): string {
  return `${state.adapter?.id ?? "gen4"}:${project.romInfo.idCode}:${fileName}`;
}

function isArchiveKind(value: unknown): value is Gen4MoveAnimationArchiveKind {
  return value === "move" || value === "sub" || value === "spa";
}

function clampFileIdForKind(project: Gen4MoveAnimationProject, kind: Gen4MoveAnimationArchiveKind, fileId: number): number {
  const archive = archiveForKind(project, kind);
  if (archive.narc.files.length === 0) return 0;
  return Math.max(0, Math.min(archive.narc.files.length - 1, Math.trunc(fileId)));
}

function deserializeFavorites(
  project: Gen4MoveAnimationProject,
  stored: StoredHgEditorPrefs["favorites"],
): Partial<Record<Gen4MoveAnimationArchiveKind, Set<number>>> {
  const favorites: Partial<Record<Gen4MoveAnimationArchiveKind, Set<number>>> = {};
  for (const kind of requireAdapter().archiveKinds) {
    const values = Array.isArray(stored?.[kind]) ? stored[kind] : [];
    favorites[kind] = new Set(
      values
        .filter((value): value is number => typeof value === "number" && Number.isInteger(value))
        .map((value) => clampFileIdForKind(project, kind, value)),
    );
  }
  return favorites;
}

function serializeFavorites(favorites: Partial<Record<Gen4MoveAnimationArchiveKind, Set<number>>>): Partial<Record<Gen4MoveAnimationArchiveKind, number[]>> {
  return Object.fromEntries(requireAdapter().archiveKinds.map((kind) => [kind, [...(favorites[kind] ?? new Set<number>())].sort((a, b) => a - b)]));
}

function favoriteSet(kind: Gen4MoveAnimationArchiveKind): Set<number> {
  state.favorites[kind] ??= new Set<number>();
  return state.favorites[kind];
}

function isFavorite(kind: Gen4MoveAnimationArchiveKind, fileId: number): boolean {
  return state.favorites[kind]?.has(fileId) ?? false;
}

function toggleFavorite(kind: Gen4MoveAnimationArchiveKind, fileId: number): void {
  const favorites = favoriteSet(kind);
  if (favorites.has(fileId)) favorites.delete(fileId);
  else favorites.add(fileId);
}

function favoriteMoveIdsForTest(): number[] {
  return [...(state.favorites.move ?? new Set<number>())].sort((a, b) => a - b);
}

function isScriptArchiveKind(kind: Gen4MoveAnimationArchiveKind): kind is Gen4MoveAnimationScriptArchiveKind {
  return kind === "move" || kind === "sub";
}

function archiveLabelForKind(kind: Gen4MoveAnimationArchiveKind): string {
  return requireAdapter().archiveLabel(kind);
}

function archiveFileNameForKind(kind: Gen4MoveAnimationArchiveKind): string {
  const adapter = requireAdapter();
  if (adapter.id === "platinum" && kind === "move") return "we.arc";
  if (adapter.id === "platinum" && kind === "spa") return "waza_particle.narc";
  return `${adapter.archiveLabel(kind)}.narc`;
}

function fileMatchesFilter(fileId: number, name: string, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return String(fileId).includes(query) || name.toLowerCase().includes(query);
}

function download(bytes: Uint8Array, filename: string): void {
  const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([blobBytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function saveLatestRom(fileName: string, bytes: Uint8Array): Promise<void> {
  if (!("indexedDB" in window)) return;
  try {
    const db = await openHgRomCache();
    const record = {
      fileName,
      bytes: bytes.slice(),
      savedAt: Date.now(),
    };
    await idbRequest(db.transaction(HG_ROM_CACHE_STORE, "readwrite").objectStore(HG_ROM_CACHE_STORE).put(record, HG_ROM_CACHE_KEY));
    db.close();
  } catch (error) {
    console.warn("Failed to cache latest HG ROM", error);
  }
}

async function loadLatestRom(): Promise<CachedHgRom | undefined> {
  if (!("indexedDB" in window)) return undefined;
  const db = await openHgRomCache();
  const record = await idbRequest<{ fileName?: unknown; bytes?: unknown } | undefined>(
    db.transaction(HG_ROM_CACHE_STORE, "readonly").objectStore(HG_ROM_CACHE_STORE).get(HG_ROM_CACHE_KEY),
  );
  db.close();
  if (!record || typeof record.fileName !== "string") return undefined;
  const bytes = cachedBytesToUint8Array(record.bytes);
  return bytes ? { fileName: record.fileName, bytes } : undefined;
}

function cachedBytesToUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return undefined;
}

function openHgRomCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HG_ROM_CACHE_DB, HG_ROM_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HG_ROM_CACHE_STORE)) db.createObjectStore(HG_ROM_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open browser ROM cache."));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#096;");
}
