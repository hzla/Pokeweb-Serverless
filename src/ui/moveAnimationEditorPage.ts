import { getMoveCount, getMoveRecord, titleize } from "../pokeweb/moveItemModel";
import { buildMoveAnimationPreview, loadMoveBackground, loadMoveSpaArchive, type MoveAnimationTimelineEvent } from "../pokeweb/moveAnimationPreviewModel";
import { loadBattleBackgroundCatalog, type BattleBackgroundVariant } from "../pokeweb/battleBackgroundModel";
import { loadBattlePlatformCatalog, type BattlePlatformVariant } from "../pokeweb/battlePlatformModel";
import { getMoveAnimationDisplayCommandName } from "../pokeweb/moveAnimationCommandNames";
import { summarizeMoveAnimationCommandLine } from "../pokeweb/moveAnimationCommandSummary";
import {
  compileMoveAnimation,
  decompileMoveAnimation,
  decompileMoveAnimationBytes,
  EMPTY_MOVE_ANIMATION_SCRIPT,
  formatMoveAnimationScriptParameters,
  getMoveAnimationParticleIds,
  getMoveAnimationTargetInfo,
  hasMoveAnimationScript,
  moveAnimationScriptCommandLines,
  remapMoveAnimationParticleIds,
  updateMoveAnimationScript,
  type MoveAnimationParamDisplayMode,
} from "../pokeweb/moveAnimationModel";
import {
  formatFx32Value,
  formatMoveAnimationParam,
  getMoveAnimationEnumCompletions,
  getMoveAnimationParamSemantic,
  parseMoveAnimationEditorParam,
} from "../pokeweb/moveAnimationParamSemantics";
import { copyMoveSpaArchive } from "../pokeweb/moveSpaModel";
import {
  loadMoveAnimationBattleEnvironment,
  MOVE_PREVIEW_BACKGROUND_INDEX,
  MOVE_PREVIEW_PLATFORM_INDEX,
  MOVE_PREVIEW_SPECIES_ID,
  type MoveAnimationBattleEnvironmentSelection,
} from "../pokeweb/moveAnimationBattleEnvironment";
import { pokemonPersonalDisplayIds, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { installMoveAnimationAudioPreview, type MoveAnimationAudioPreviewController } from "./moveAnimationAudioPreview";
import { installMoveAnimationPreview, renderMoveBackgroundPreviewCanvas, type MoveAnimationPreviewController } from "./moveAnimationPreview";
import {
  describeMoveAnimationLine,
  formatMoveAnimationLine,
  getMoveAnimationCommandLineColor,
  installMoveAnimationCodeEditor,
  type MoveAnimationCodeEditor,
  type MoveAnimationCommandDoc,
  type MoveAnimationLineInfo,
} from "./moveAnimationCodeEditor";
import { installMoveAnimationDocsPanel, type MoveAnimationDocsPanelController } from "./moveAnimationDocsPanel";
import { installMoveSpaEditor, type MoveSpaEditorController } from "./moveSpaEditor";
import { installPicker } from "./trainerInteractions";
import "../styles/moveAnimationData.css";

/**
 * Move animation editor: a move list beside the script, a command inspector under it,
 * and a live preview. Particles and sounds get their own tabs.
 */

type SelectedBattleVariant = {
  tableIndex: number;
  seasonIndex: number;
};


const MOVE_ANIMATION_SWAP_SIDES_STORAGE_KEY = "pokeweb.moveAnimation.swapSides";
const MOVE_ANIMATION_AUDIO_STORAGE_KEY = "pokeweb.moveAnimation.audioEnabled";
const MOVE_ANIMATION_POKEMON_STORAGE_KEYS = {
  user: "pokeweb.moveAnimation.userSpeciesId",
  target: "pokeweb.moveAnimation.targetSpeciesId",
};

function initializePreviewPokemonSelect(select: HTMLSelectElement | undefined, role: "user" | "target"): number {
  if (!select) return MOVE_PREVIEW_SPECIES_ID;
  try {
    const saved = localStorage.getItem(MOVE_ANIMATION_POKEMON_STORAGE_KEYS[role]);
    if (saved && Array.from(select.options).some(option => option.value === saved)) select.value = saved;
  } catch {
    // Storage can be unavailable; the ROM's default selection still works.
  }
  return Number(select.value) || MOVE_PREVIEW_SPECIES_ID;
}

function loadMoveAnimationSwapSidesPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(MOVE_ANIMATION_SWAP_SIDES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveMoveAnimationSwapSidesPreference(swappedSides: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MOVE_ANIMATION_SWAP_SIDES_STORAGE_KEY, String(swappedSides));
  } catch {
    // The preview still works when browser storage is unavailable.
  }
}

function loadMoveAnimationAudioPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(MOVE_ANIMATION_AUDIO_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveMoveAnimationAudioPreference(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MOVE_ANIMATION_AUDIO_STORAGE_KEY, String(enabled));
  } catch {
    // The preview still works when browser storage is unavailable.
  }
}

async function loadMoveAnimationEnvironmentSelectors(
  project: ProjectState,
  backgroundSelect: HTMLSelectElement | undefined,
  platformSelect: HTMLSelectElement | undefined,
  initialSelection: MoveAnimationBattleEnvironmentSelection,
): Promise<MoveAnimationBattleEnvironmentSelection> {
  if (!backgroundSelect && !platformSelect) return initialSelection;
  const [backgroundResult, platformResult] = await Promise.allSettled([
    loadBattleBackgroundCatalog(project),
    loadBattlePlatformCatalog(project),
  ]);
  if (backgroundResult.status === "fulfilled") {
    const backgroundCatalog = backgroundResult.value;
    const selectedBackground = populateBackgroundSelect(backgroundSelect, backgroundCatalog.variants, initialSelection);
    if (selectedBackground) {
      initialSelection = {
        ...initialSelection,
        backgroundIndex: selectedBackground.tableIndex,
        backgroundSeasonIndex: selectedBackground.seasonIndex,
      };
    }
  } else {
    markBattleEnvironmentSelectUnavailable(backgroundSelect, errorMessage(backgroundResult.reason));
  }
  if (platformResult.status === "fulfilled") {
    const platformCatalog = platformResult.value;
    const selectedPlatform = populatePlatformSelect(platformSelect, platformCatalog.variants, initialSelection);
    if (selectedPlatform) {
      initialSelection = {
        ...initialSelection,
        platformIndex: selectedPlatform.tableIndex,
        platformSeasonIndex: selectedPlatform.seasonIndex,
      };
    }
  } else {
    markBattleEnvironmentSelectUnavailable(platformSelect, errorMessage(platformResult.reason));
  }
  return initialSelection;
}

function populateBackgroundSelect(
  select: HTMLSelectElement | undefined,
  variants: BattleBackgroundVariant[],
  selection: MoveAnimationBattleEnvironmentSelection,
): BattleBackgroundVariant | undefined {
  const selected = selectEnvironmentVariant(variants, selection.backgroundIndex, selection.backgroundSeasonIndex);
  if (!select || !selected) return selected;
  select.innerHTML = variants.map((variant) => {
    const entry = String(variant.tableIndex).padStart(2, "0");
    const label = variant.variantCount > 1 ? `Background ${entry} · ${variant.seasonName}` : `Background ${entry}`;
    const value = battleVariantValue(variant);
    return `<option value="${value}" ${value === battleVariantValue(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  select.disabled = false;
  return selected;
}

function populatePlatformSelect(
  select: HTMLSelectElement | undefined,
  variants: BattlePlatformVariant[],
  selection: MoveAnimationBattleEnvironmentSelection,
): BattlePlatformVariant | undefined {
  const selected = selectEnvironmentVariant(variants, selection.platformIndex, selection.platformSeasonIndex);
  if (!select || !selected) return selected;
  select.innerHTML = variants.map((variant) => {
    const entry = String(variant.tableIndex).padStart(2, "0");
    const label = variant.variantCount > 1 ? `Platform ${entry} · ${variant.seasonName}` : `Platform ${entry}`;
    const value = battleVariantValue(variant);
    return `<option value="${value}" ${value === battleVariantValue(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  select.disabled = false;
  return selected;
}

function selectEnvironmentVariant<T extends SelectedBattleVariant>(
  variants: T[],
  tableIndex: number | undefined,
  seasonIndex: number | undefined,
): T | undefined {
  return variants.find((variant) => variant.tableIndex === tableIndex && variant.seasonIndex === seasonIndex)
    ?? variants.find((variant) => variant.tableIndex === tableIndex && variant.seasonIndex === 0)
    ?? variants.find((variant) => variant.tableIndex === tableIndex)
    ?? variants[0];
}

function battleVariantValue(variant: SelectedBattleVariant & { resourceId: number }): string {
  return `${variant.tableIndex}:${variant.seasonIndex}:${variant.resourceId}`;
}

function parseSelectedBattleVariant(value: string): SelectedBattleVariant | undefined {
  const [tableIndex, seasonIndex] = value.split(":").map(Number);
  if (!Number.isSafeInteger(tableIndex) || !Number.isSafeInteger(seasonIndex)) return undefined;
  return { tableIndex, seasonIndex };
}

function markBattleEnvironmentSelectUnavailable(select: HTMLSelectElement | undefined, message: string): void {
  if (!select) return;
  select.innerHTML = "<option>Unavailable</option>";
  select.disabled = true;
  select.title = message;
}

// ---------- Page ----------

export type MoveAnimationPageOptions = {
  onDirty?: () => void;
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>;
  /** Called when another move is picked from the list (the page swaps the detail itself). */
  onSelect?: (moveId: number) => void;
};

type BodyTab = "script" | "particles" | "sounds";

type PageState = {
  search: string;
  editedOnly: boolean;
  tab: BodyTab;
  rawNumbers: boolean;
};

type DetailSession = {
  isDirty: () => boolean;
  destroy: () => void;
};

const pageStates = new WeakMap<ProjectState, PageState>();
const sessions = new WeakMap<HTMLElement, DetailSession>();

export function renderMoveAnimationPage(project: ProjectState, root: HTMLElement, moveId: number, options: MoveAnimationPageOptions = {}): void {
  sessions.get(root)?.destroy();
  sessions.delete(root);
  const state = pageStates.get(project) ?? { search: "", editedOnly: false, tab: "script", rawNumbers: false };
  pageStates.set(project, state);
  const moveCount = getMoveCount(project);
  root.innerHTML = `
    <div class="move-anim-data" id="move-anim-data">
      <aside class="md-list">
        <div class="md-filters">
          <input class="md-search" type="search" placeholder="Search moves" autocomplete="off" spellcheck="false" aria-label="Search moves" value="${escapeHtml(state.search)}">
          <div class="md-chips">
            <button class="btn sm" type="button" data-ma-edited-only aria-pressed="${state.editedOnly}">Edited only</button>
          </div>
        </div>
        <div class="md-rows" role="listbox" aria-label="Moves" tabindex="0">${renderMoveRows(project)}</div>
        <div class="md-list-foot" data-ma-count></div>
      </aside>
      <section class="md-detail ma-detail" id="moves" data-ma-detail></section>
    </div>
  `;
  const page = root.querySelector<HTMLElement>("#move-anim-data")!;
  const list = page.querySelector<HTMLElement>(".md-rows")!;
  const detail = page.querySelector<HTMLElement>("[data-ma-detail]")!;
  const search = page.querySelector<HTMLInputElement>(".md-search")!;
  const editedToggle = page.querySelector<HTMLButtonElement>("[data-ma-edited-only]")!;
  const count = page.querySelector<HTMLElement>("[data-ma-count]")!;
  let currentId = Number.isSafeInteger(moveId) && moveId >= 0 && moveId < moveCount ? moveId : 0;

  const applyFilter = () => {
    const query = state.search.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll<HTMLElement>("[data-ma-row]").forEach((row) => {
      const id = Number(row.dataset.maRow);
      const visible = (!state.editedOnly || row.classList.contains("-edited"))
        && (!query || String(id) === query || (row.dataset.name ?? "").includes(query));
      row.hidden = !visible;
      if (visible) shown += 1;
    });
    count.textContent = shown === moveCount ? `${moveCount} moves` : `${shown} of ${moveCount} moves`;
  };
  const markSelected = (scroll: boolean) => {
    list.querySelectorAll<HTMLElement>("[data-ma-row]").forEach((row) => {
      const active = Number(row.dataset.maRow) === currentId;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
      if (active && scroll) revealRow(list, row);
    });
  };
  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-ma-row="${id}"]`);
    if (row) row.classList.toggle("-edited", moveAnimationEdited(project, id));
  };
  const open = (id: number, scroll = false) => {
    sessions.get(root)?.destroy();
    currentId = id;
    markSelected(scroll);
    const session = installMoveAnimationDetail(project, detail, id, state, {
      ...options,
      onDirty: () => {
        refreshRow(id);
        options.onDirty?.();
      },
    });
    sessions.set(root, session);
  };
  const select = (id: number, scroll = false) => {
    if (id === currentId) return;
    const session = sessions.get(root);
    if (session?.isDirty() && !window.confirm(`Discard unsaved changes to ${moveName(project, currentId)}?`)) return;
    open(id, scroll);
    options.onSelect?.(id);
  };

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-ma-row]");
    if (row) select(Number(row.dataset.maRow));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-ma-row]")].filter((row) => !row.hidden);
    const index = rows.findIndex((row) => Number(row.dataset.maRow) === currentId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.maRow), true);
  });
  search.addEventListener("input", () => {
    state.search = search.value;
    applyFilter();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const first = [...list.querySelectorAll<HTMLElement>("[data-ma-row]")].find((row) => !row.hidden);
    if (first) select(Number(first.dataset.maRow), true);
  });
  editedToggle.addEventListener("click", () => {
    state.editedOnly = !state.editedOnly;
    editedToggle.setAttribute("aria-pressed", String(state.editedOnly));
    applyFilter();
  });

  applyFilter();
  open(currentId, true);
}

function renderMoveRows(project: ProjectState): string {
  const rows: string[] = [];
  for (let id = 0; id < getMoveCount(project); id += 1) {
    const move = getMoveRecord(project, id);
    const name = moveName(project, id);
    const type = String(move.readable.type ?? "");
    rows.push(`<div class="md-row${moveAnimationEdited(project, id) ? " -edited" : ""}" data-ma-row="${id}" data-name="${escapeHtml(name.toLowerCase())}" role="option" aria-selected="false">
      <span class="md-row-id">${id}</span>
      <span class="md-row-name">${escapeHtml(name)}<span class="ma-edit-mark" title="Animation edited"></span></span>
      <span class="type-plate sm -${escapeHtml(type.toLowerCase())}">${escapeHtml(type)}</span>
    </div>`);
  }
  return rows.join("");
}

function moveName(project: ProjectState, moveId: number): string {
  return titleize(String(getMoveRecord(project, moveId).readable.name ?? `Move ${moveId}`));
}

const EDIT_KEY = /^move-(?:animation|animation-copy|spa-copy):(\d+)$/u;

function moveAnimationEdited(project: ProjectState, moveId: number): boolean {
  return (project.actionChangelog?.entries ?? []).some((entry) => {
    const match = EDIT_KEY.exec(entry.key);
    return match !== null && Number(match[1]) === moveId;
  });
}

function revealRow(list: HTMLElement, row: HTMLElement): void {
  const top = row.offsetTop - list.offsetTop;
  if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = Math.max(0, top - list.clientHeight / 2 + row.offsetHeight / 2);
  }
}

// ---------- Detail ----------

function renderDetailShell(project: ProjectState, moveId: number, state: PageState, canTest: boolean, recoveryNotice?: string): string {
  const target = getMoveAnimationTargetInfo(project, moveId);
  const source = target ? `${target.white2UpgradeLayout ? "W2U" : "Retail"} ${target.sourcePath} #${target.index}` : "";
  const pokemonOptions = pokemonPersonalDisplayIds(project).filter((id) => id > 0)
    .map((id) => `<option value="${id}" ${id === 1 ? "selected" : ""}>${escapeHtml(pokemonSpeciesLabel(project, id) || `Pokémon ${id}`)}</option>`).join("");
  const tab = (id: BodyTab, label: string) => `<button class="uv-tab" type="button" role="tab" aria-selected="${state.tab === id}" tabindex="${state.tab === id ? 0 : -1}" data-ma-tab="${id}">${label}</button>`;
  return `
    <header class="ma-head">
      <div class="ma-ident">
        <div class="ma-title">
          <h1>${escapeHtml(moveName(project, moveId))}</h1>
          <span class="ma-num">#${moveId}</span>
          <span class="ma-dirty" hidden>Unsaved changes</span>
        </div>
        ${source ? `<div class="ma-source">Animation file ${escapeHtml(source)}</div>` : ""}
      </div>
      <div class="ma-actions">
        <span class="ma-status" role="status" aria-live="polite"></span>
        <button class="btn sm -ghost" type="button" data-ma-action="revert" disabled>Revert</button>
        <button class="btn sm -primary" type="button" data-ma-action="apply" title="Apply (${shortcutLabel()}+S)" disabled>Apply</button>
        <details class="ma-more">
          <summary class="btn sm -default" aria-label="More actions" title="More actions">More</summary>
          <div class="ma-more-pop" role="menu">
            <button type="button" role="menuitem" data-ma-action="test" ${canTest ? "" : "disabled"}>Test in game</button>
            <button type="button" role="menuitem" data-ma-action="copy">Copy from another move…</button>
            <hr>
            <button type="button" role="menuitem" data-ma-action="import">Import binary…</button>
            <button type="button" role="menuitem" data-ma-action="export">Export binary</button>
            <hr>
            <label class="ma-more-check"><input type="checkbox" data-ma-raw ${state.rawNumbers ? "checked" : ""}> Show raw numbers</label>
          </div>
        </details>
        <input type="file" accept=".bin,.dat,application/octet-stream" data-ma-import-file hidden>
      </div>
    </header>
    <div class="ma-copy" hidden>
      <span>Copy animation from</span>
      <select data-ma-copy-source>${renderDonorOptions(project, moveId)}</select>
      <button class="btn sm -default" type="button" data-ma-action="copy-script" disabled>Script only</button>
      <button class="btn sm -default" type="button" data-ma-action="copy-script-spa" title="Also clone the donor's particle file into this move's slot" disabled>Script + particles</button>
      <button class="btn sm -ghost" type="button" data-ma-action="copy-cancel">Cancel</button>
    </div>
    ${recoveryNotice ? `<div class="ma-notice" role="status">${escapeHtml(recoveryNotice)}</div>` : ""}
    <div class="ma-tabbar">
      <nav class="md-tabs ma-tabs" role="tablist" aria-label="Animation editor">
        ${tab("script", "Script")}${tab("particles", "Particles")}${tab("sounds", "Sounds")}
      </nav>
      <button class="btn sm -ghost ma-docs-toggle" type="button" aria-pressed="false" data-ma-action="docs">Docs</button>
    </div>
    <div class="ma-body">
      <section class="ma-panel ma-script" data-ma-panel="script" ${state.tab === "script" ? "" : "hidden"}>
        <div class="ma-code-col">
          <div class="move-animation-text ma-code"></div>
          <div class="ma-inspector" aria-label="Command inspector"></div>
        </div>
        <div class="ma-preview-col">
          <details class="ma-scene">
            <summary><span class="ma-scene-key">Scene</span><span class="ma-scene-value" data-ma-scene-summary>Loading…</span></summary>
            <div class="ma-scene-pop">
              <label><span>Background</span><select id="move-animation-background-select" disabled><option>Loading…</option></select></label>
              <label><span>Platform</span><select id="move-animation-platform-select" disabled><option>Loading…</option></select></label>
              <label><span>User</span><select id="move-animation-user-pokemon-select" data-ma-picker="User Pokémon">${pokemonOptions}</select></label>
              <label><span>Target</span><select id="move-animation-target-pokemon-select" data-ma-picker="Target Pokémon">${pokemonOptions}</select></label>
              <label class="ma-check"><input id="move-animation-swap-sides" type="checkbox"> Swap user and target sides</label>
            </div>
          </details>
          <div class="ma-preview-error" hidden></div>
          <div class="move-animation-preview-host show-flex"><div class="move-animation-preview-loading">Building preview…</div></div>
        </div>
      </section>
      <section class="ma-panel ma-particles" data-ma-panel="particles" ${state.tab === "particles" ? "" : "hidden"}>
        <div class="move-animation-spa-pane"></div>
        <aside class="ma-field-help move-command-reference" id="move-command-reference">
          <div class="move-command-reference-empty">Click a field name for an explanation.</div>
        </aside>
      </section>
      <section class="ma-panel ma-sounds" data-ma-panel="sounds" ${state.tab === "sounds" ? "" : "hidden"}>
        <div class="move-animation-audio-pane"></div>
      </section>
      <aside class="ma-docs" hidden aria-label="Documentation">
        <button class="btn sm -ghost ma-docs-close" type="button" data-ma-action="docs" aria-label="Close docs">Close</button>
        <div class="move-animation-docs-pane"></div>
      </aside>
    </div>
  `;
}

function renderDonorOptions(project: ProjectState, targetMoveId: number): string {
  const options = ['<option value="">Choose a move</option>'];
  for (let id = 0; id < getMoveCount(project); id += 1) {
    if (id === targetMoveId) continue;
    options.push(`<option value="${id}">${escapeHtml(moveName(project, id))}</option>`);
  }
  return options.join("");
}

function shortcutLabel(): string {
  return /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl";
}

function installMoveAnimationDetail(project: ProjectState, detail: HTMLElement, moveId: number, state: PageState, options: MoveAnimationPageOptions): DetailSession {
  const abort = new AbortController();
  const signal = abort.signal;
  if (!hasMoveAnimationScript(project, moveId)) {
    detail.innerHTML = `<div class="ma-empty">Move animation files were not loaded for this ROM.</div>`;
    return { isDirty: () => false, destroy: () => abort.abort() };
  }
  let script = EMPTY_MOVE_ANIMATION_SCRIPT;
  let recoveryNotice: string | undefined;
  try {
    script = decompileMoveAnimation(project, moveId);
  } catch (error) {
    recoveryNotice = `${errorText(error)}. A new empty script is ready.`;
  }
  let paramDisplayMode: MoveAnimationParamDisplayMode = state.rawNumbers ? "numeric" : "semantic";
  if (paramDisplayMode === "numeric") {
    try { script = formatMoveAnimationScriptParameters(script, "numeric"); } catch { paramDisplayMode = "semantic"; }
  }
  detail.innerHTML = renderDetailShell(project, moveId, state, Boolean(options.onTestMove), recoveryNotice);

  const q = <T extends Element>(selector: string) => detail.querySelector<T>(selector) ?? undefined;
  const status = q<HTMLElement>(".ma-status");
  const dirtyPill = q<HTMLElement>(".ma-dirty");
  const applyButton = q<HTMLButtonElement>('[data-ma-action="apply"]');
  const revertButton = q<HTMLButtonElement>('[data-ma-action="revert"]');
  const moreMenu = q<HTMLDetailsElement>(".ma-more");
  const copyBar = q<HTMLElement>(".ma-copy");
  const copySource = q<HTMLSelectElement>("[data-ma-copy-source]");
  const editorHost = q<HTMLElement>(".ma-code");
  const inspectorHost = q<HTMLElement>(".ma-inspector");
  const previewHost = q<HTMLElement>(".move-animation-preview-host");
  const previewError = q<HTMLElement>(".ma-preview-error");
  const sceneMenu = q<HTMLDetailsElement>(".ma-scene");
  const sceneSummary = q<HTMLElement>("[data-ma-scene-summary]");
  const spaHost = q<HTMLElement>(".move-animation-spa-pane");
  const audioHost = q<HTMLElement>(".move-animation-audio-pane");
  const docsDrawer = q<HTMLElement>(".ma-docs");
  const docsHost = q<HTMLElement>(".move-animation-docs-pane");
  const backgroundSelect = q<HTMLSelectElement>("#move-animation-background-select");
  const platformSelect = q<HTMLSelectElement>("#move-animation-platform-select");
  const userPokemonSelect = q<HTMLSelectElement>("#move-animation-user-pokemon-select");
  const targetPokemonSelect = q<HTMLSelectElement>("#move-animation-target-pokemon-select");
  const swapSidesInput = q<HTMLInputElement>("#move-animation-swap-sides");
  const importInput = q<HTMLInputElement>("[data-ma-import-file]");

  const setStatus = (message: string, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("-error", error);
    status.title = message;
  };

  // ----- Environment -----
  const savedSwappedSides = loadMoveAnimationSwapSidesPreference();
  let audioEnabled = loadMoveAnimationAudioPreference();
  if (swapSidesInput) swapSidesInput.checked = savedSwappedSides;
  let environment: MoveAnimationBattleEnvironmentSelection = {
    backgroundIndex: MOVE_PREVIEW_BACKGROUND_INDEX,
    backgroundSeasonIndex: 0,
    platformIndex: MOVE_PREVIEW_PLATFORM_INDEX,
    platformSeasonIndex: 0,
    swappedSides: savedSwappedSides,
    userSpeciesId: initializePreviewPokemonSelect(userPokemonSelect, "user"),
    targetSpeciesId: initializePreviewPokemonSelect(targetPokemonSelect, "target"),
  };
  const refreshSceneSummary = () => {
    if (!sceneSummary) return;
    const text = (select: HTMLSelectElement | undefined) => select?.selectedOptions[0]?.textContent?.trim() ?? "";
    const parts = [text(backgroundSelect), text(platformSelect)].filter((part) => part && !part.startsWith("Loading"));
    const user = text(userPokemonSelect);
    const target = text(targetPokemonSelect);
    sceneSummary.textContent = [...parts, `${user} → ${target}${swapSidesInput?.checked ? " (swapped)" : ""}`].join(" · ");
  };
  detail.querySelectorAll<HTMLSelectElement>("select[data-ma-picker]").forEach((select) => installSearchableSelect(select, select.dataset.maPicker ?? "Pokémon", signal));
  refreshSceneSummary();

  // ----- Code editor + inspector -----
  let lastGood = script;
  let spaDirty = false;
  let inspectedLine: MoveAnimationLineInfo | undefined;
  const isDirty = () => (editor ? editor.getValue() !== lastGood : false) || spaDirty;
  const refreshDirty = () => {
    const dirty = isDirty();
    if (dirtyPill) dirtyPill.hidden = !dirty;
    if (applyButton) applyButton.disabled = !dirty;
    if (revertButton) revertButton.disabled = !dirty;
  };
  const editor: MoveAnimationCodeEditor | undefined = editorHost
    ? installMoveAnimationCodeEditor(editorHost, script, {
        onChange: () => {
          refreshDirty();
          schedulePreviewRefresh();
        },
        onCursorLine: (info) => {
          const editingInspector = inspectorHost?.contains(document.activeElement) ?? false;
          if (editingInspector && inspectedLine?.lineNumber === info.lineNumber) {
            inspectedLine = info;
            return;
          }
          inspectedLine = info;
          if (inspectorHost) renderInspector(inspectorHost, project, info);
        },
      })
    : undefined;
  const writeParam = (index: number, token: string) => {
    if (!editor || !inspectedLine?.definition) return;
    const count = inspectedLine.definition.params.length;
    const params = inspectedLine.params.slice(0, count);
    while (params.length < count) params.push("0");
    params[index] = token;
    editor.replaceLine(inspectedLine.lineNumber, formatMoveAnimationLine(inspectedLine, params));
  };
  inspectorHost?.addEventListener("input", (event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const info = inspectedLine;
    if (!info?.definition) return;
    if (control.dataset.maColor !== undefined && control instanceof HTMLInputElement) {
      const channels = colorChannels(info);
      if (!channels) return;
      const [red, green, blue] = hexToRgb5(control.value);
      const count = info.definition.params.length;
      const params = info.params.slice(0, count);
      while (params.length < count) params.push("0");
      params[channels.red] = String(red);
      params[channels.green] = String(green);
      params[channels.blue] = String(blue);
      editor?.replaceLine(info.lineNumber, formatMoveAnimationLine(info, params));
      for (const [index, value] of [[channels.red, red], [channels.green, green], [channels.blue, blue]] as const) {
        const field = inspectorHost.querySelector<HTMLInputElement>(`[data-param-index="${index}"]`);
        if (field) field.value = String(value);
      }
      return;
    }
    const index = Number(control.dataset.paramIndex);
    if (!Number.isInteger(index)) return;
    const token = tokenForControl(info, index, control, paramDisplayMode);
    if (token === undefined) {
      control.classList.add("invalid");
      return;
    }
    control.classList.remove("invalid");
    writeParam(index, token);
  }, { signal });
  inspectorHost?.addEventListener("focusout", () => {
    // Re-sync once the user leaves the form, so formatted tokens (e.g. 1.5x) show up.
    window.setTimeout(() => {
      if (!inspectorHost.contains(document.activeElement) && inspectedLine) renderInspector(inspectorHost, project, inspectedLine, true);
    }, 0);
  }, { signal });
  inspectorHost?.addEventListener("click", (event) => {
    const step = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-insp-step]");
    if (step) editor?.stepCommand(Number(step.dataset.inspStep) as -1 | 1);
  }, { signal });
  inspectorHost?.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details instanceof HTMLDetailsElement && details.classList.contains("ma-insp-ref")) inspectorReferenceOpen = details.open;
    if (details instanceof HTMLDetailsElement && details.open && inspectedLine) void hydrateInspectorReference(inspectorHost, project, inspectedLine);
  }, { capture: true, signal });

  // ----- Preview -----
  let previewController: MoveAnimationPreviewController | undefined;
  let previewRequestId = 0;
  let previewTimer = 0;
  let previewStale = false;
  let previewPhaseIndex = 0;
  const activeTab = () => state.tab;
  const showPreviewError = (message: string | undefined) => {
    if (!previewError) return;
    previewError.hidden = !message;
    previewError.textContent = message ?? "";
  };
  const buildPreview = async (initialPlaying: boolean, keepOnError: boolean) => {
    if (!editor || !previewHost) return;
    const requestId = ++previewRequestId;
    window.clearTimeout(previewTimer);
    previewStale = false;
    try {
      const scriptText = editor.getValue();
      await spaEditor?.ensureReferences(scriptText);
      const preview = await buildMoveAnimationPreview(project, moveId, scriptText, {
        phaseIndex: previewPhaseIndex,
        loadSpaArchive: async (_project, spaId) => spaEditor?.getArchiveOverride(spaId) ?? loadMoveSpaArchive(project, spaId),
      });
      previewPhaseIndex = preview.phaseIndex ?? 0;
      try {
        preview.battleEnvironment = await loadMoveAnimationBattleEnvironment(project, { ...environment });
      } catch (error) {
        preview.warnings.push({ message: `Battle scene: ${errorText(error)}` });
      }
      if (requestId !== previewRequestId || signal.aborted) return;
      previewController?.destroy();
      previewController = undefined;
      const controller = await installMoveAnimationPreview(previewHost, preview, {
        initialPlaying,
        onPhaseChange: (phaseIndex) => {
          previewPhaseIndex = phaseIndex;
          void buildPreview(true, false);
        },
        onTimelineSelect: (event) => revealTimelineEvent(event),
        audio: {
          project,
          initialEnabled: audioEnabled,
          onEnabledChange: (enabled) => {
            audioEnabled = enabled;
            saveMoveAnimationAudioPreference(enabled);
          },
        },
      });
      if (requestId !== previewRequestId || signal.aborted) {
        controller.destroy();
        return;
      }
      previewController = controller;
      previewController.setAudioSuppressed(activeTab() !== "script");
      editor.setInvalid(false);
      showPreviewError(undefined);
    } catch (error) {
      if (requestId !== previewRequestId || signal.aborted) return;
      editor.setInvalid(true);
      if (keepOnError && previewController) {
        showPreviewError(errorText(error));
        return;
      }
      previewController?.destroy();
      previewController = undefined;
      showPreviewError(undefined);
      previewHost.innerHTML = `<div class="move-animation-error">${escapeHtml(errorText(error))}</div>`;
    }
  };
  function schedulePreviewRefresh(): void {
    previewStale = true;
    if (activeTab() !== "script") return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void buildPreview(false, true), 400);
  }
  const revealTimelineEvent = (event: MoveAnimationTimelineEvent) => {
    if (!editor || event.commandIndex === undefined) return;
    if (event.sourceMoveId !== undefined && event.sourceMoveId !== moveId) return;
    const text = editor.getValue();
    let lineNumber: number | undefined;
    try {
      lineNumber = moveAnimationScriptCommandLines(text).get(event.label)?.[event.commandIndex];
    } catch {
      return;
    }
    if (lineNumber === undefined) return;
    const line = describeMoveAnimationLine(text.split(/\r?\n/u)[lineNumber - 1] ?? "", lineNumber);
    if (line.definition?.name !== event.command) return;
    editor.focusLine(lineNumber);
  };

  // ----- Particles, sounds, docs -----
  const spaEditor: MoveSpaEditorController | undefined = spaHost
    ? installMoveSpaEditor(spaHost, project, script, {
        layout: "split",
        onDirty: options.onDirty,
        onPreviewChange: schedulePreviewRefresh,
        onDirtyChange: (dirty) => {
          spaDirty = dirty;
          refreshDirty();
        },
      })
    : undefined;
  let audioPreview: MoveAnimationAudioPreviewController | undefined;
  let docsPanel: MoveAnimationDocsPanelController | undefined;

  const setTab = (tab: BodyTab) => {
    state.tab = tab;
    detail.querySelectorAll<HTMLButtonElement>("[data-ma-tab]").forEach((button) => {
      const active = button.dataset.maTab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    detail.querySelectorAll<HTMLElement>("[data-ma-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.maPanel !== tab;
    });
    if (tab !== "sounds") audioPreview?.stop();
    if (tab !== "script") previewController?.pause();
    previewController?.setAudioSuppressed(tab !== "script");
    if (tab === "script" && previewStale) void buildPreview(false, true);
    if (tab === "particles") void spaEditor?.ensureReferences(editor?.getValue() ?? script);
    if (tab === "sounds") {
      audioPreview ??= audioHost ? installMoveAnimationAudioPreview(audioHost, project, moveId, () => editor?.getValue() ?? script) : undefined;
      void audioPreview?.refresh();
    }
  };
  const toggleDocs = (open = docsDrawer?.hidden ?? false) => {
    if (!docsDrawer) return;
    docsDrawer.hidden = !open;
    detail.querySelector(".ma-docs-toggle")?.setAttribute("aria-pressed", String(open));
    if (open && docsHost) {
      docsPanel ??= installMoveAnimationDocsPanel(docsHost);
      docsHost.querySelector<HTMLInputElement>("[data-move-doc-search]")?.focus();
    }
  };

  detail.querySelectorAll<HTMLButtonElement>("[data-ma-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.maTab as BodyTab), { signal });
  });

  // ----- Environment controls -----
  const refreshEnvironment = () => {
    refreshSceneSummary();
    previewStale = true;
    if (activeTab() === "script") void buildPreview(false, true);
  };
  backgroundSelect?.addEventListener("change", () => {
    const variant = parseSelectedBattleVariant(backgroundSelect.value);
    if (!variant) return;
    environment = { ...environment, backgroundIndex: variant.tableIndex, backgroundSeasonIndex: variant.seasonIndex };
    refreshEnvironment();
  }, { signal });
  platformSelect?.addEventListener("change", () => {
    const variant = parseSelectedBattleVariant(platformSelect.value);
    if (!variant) return;
    environment = { ...environment, platformIndex: variant.tableIndex, platformSeasonIndex: variant.seasonIndex };
    refreshEnvironment();
  }, { signal });
  swapSidesInput?.addEventListener("change", () => {
    environment = { ...environment, swappedSides: swapSidesInput.checked };
    saveMoveAnimationSwapSidesPreference(swapSidesInput.checked);
    refreshEnvironment();
  }, { signal });
  for (const [role, select] of [["user", userPokemonSelect], ["target", targetPokemonSelect]] as const) {
    select?.addEventListener("change", () => {
      const speciesId = Number(select.value);
      if (!Number.isSafeInteger(speciesId) || speciesId <= 0) return;
      environment = { ...environment, [role === "user" ? "userSpeciesId" : "targetSpeciesId"]: speciesId };
      try { localStorage.setItem(MOVE_ANIMATION_POKEMON_STORAGE_KEYS[role], String(speciesId)); } catch { /* Preview-only preference. */ }
      refreshEnvironment();
    }, { signal });
  }
  void loadMoveAnimationEnvironmentSelectors(project, backgroundSelect, platformSelect, environment).then((selection) => {
    environment = {
      ...environment,
      backgroundIndex: selection.backgroundIndex,
      backgroundSeasonIndex: selection.backgroundSeasonIndex,
      platformIndex: selection.platformIndex,
      platformSeasonIndex: selection.platformSeasonIndex,
    };
    refreshSceneSummary();
  });

  // ----- Actions -----
  const apply = async () => {
    if (!editor || !isDirty()) return;
    try {
      const scriptText = editor.getValue();
      if (scriptText !== lastGood) {
        updateMoveAnimationScript(project, moveId, scriptText);
        lastGood = scriptText;
      }
      const savedSpa = spaDirty ? await spaEditor?.saveDirty() : 0;
      detail.querySelector(".ma-notice")?.remove();
      editor.setInvalid(false);
      options.onDirty?.();
      setStatus(savedSpa ? `Applied script and ${savedSpa} particle file${savedSpa === 1 ? "" : "s"}` : "Applied");
    } catch (error) {
      editor.setInvalid(true);
      setStatus(errorText(error), true);
    }
    refreshDirty();
  };
  const revert = async () => {
    if (!editor) return;
    editor.setValue(lastGood);
    editor.setInvalid(false);
    await spaEditor?.discardEdits();
    setStatus("Reverted");
    refreshDirty();
    schedulePreviewRefresh();
  };
  const setCopyBusy = (busy: boolean) => {
    const hasDonor = (copySource?.value ?? "") !== "";
    if (copySource) copySource.disabled = busy;
    detail.querySelectorAll<HTMLButtonElement>('[data-ma-action^="copy-script"]').forEach((button) => { button.disabled = busy || !hasDonor; });
  };
  const copyFromMove = async (includePrimarySpa: boolean) => {
    if (!editor || !copySource || copySource.value === "") return;
    const donorMoveId = Number(copySource.value);
    if (!Number.isSafeInteger(donorMoveId) || donorMoveId < 0 || donorMoveId === moveId) return;
    const donorLabel = moveName(project, donorMoveId);
    if (isDirty() && !window.confirm(`Replace the unsaved script with ${donorLabel}'s animation?`)) return;
    setCopyBusy(true);
    setStatus(`Copying ${donorLabel}…`);
    try {
      let scriptText = decompileMoveAnimation(project, donorMoveId);
      let spaStatus = "";
      if (includePrimarySpa) {
        const donorSpaIds = getMoveAnimationParticleIds(scriptText);
        if (donorSpaIds.length === 0) throw new Error(`${donorLabel} does not use a particle file`);
        const sourceSpaId = donorSpaIds.includes(donorMoveId) ? donorMoveId : donorSpaIds[0];
        const remapped = remapMoveAnimationParticleIds(compileMoveAnimation(project, moveId, scriptText), new Map([[sourceSpaId, moveId]]));
        scriptText = decompileMoveAnimationBytes(remapped.bytes);
        await copyMoveSpaArchive(project, moveId, sourceSpaId);
        spaStatus = ` and particle file ${sourceSpaId}`;
        if (donorSpaIds.length > 1) spaStatus += ` (${donorSpaIds.length - 1} more stay shared)`;
      }
      updateMoveAnimationScript(project, moveId, scriptText);
      const shown = paramDisplayMode === "numeric" ? formatMoveAnimationScriptParameters(scriptText, "numeric") : formatMoveAnimationScriptParameters(scriptText, "semantic");
      editor.setValue(shown);
      lastGood = shown;
      editor.setInvalid(false);
      detail.querySelector(".ma-notice")?.remove();
      await spaEditor?.ensureReferences(shown);
      options.onDirty?.();
      refreshDirty();
      schedulePreviewRefresh();
      if (copyBar) copyBar.hidden = true;
      setStatus(`Copied ${donorLabel}'s script${spaStatus}`);
    } catch (error) {
      setStatus(errorText(error), true);
    } finally {
      setCopyBusy(false);
    }
  };
  const testInGame = async (button: HTMLButtonElement) => {
    if (!editor || !options.onTestMove) return;
    try {
      button.disabled = true;
      setStatus("Building test…");
      await options.onTestMove(moveId, editor.getValue());
      editor.setInvalid(false);
      setStatus("Test launched");
    } catch (error) {
      editor.setInvalid(true);
      setStatus(`Test failed: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  };
  const setRawNumbers = async (raw: boolean, input: HTMLInputElement) => {
    if (!editor) return;
    const nextMode: MoveAnimationParamDisplayMode = raw ? "numeric" : "semantic";
    try {
      const dirtyBefore = isDirty();
      editor.setValue(formatMoveAnimationScriptParameters(editor.getValue(), nextMode));
      try { lastGood = formatMoveAnimationScriptParameters(lastGood, nextMode); } catch { /* lastGood stays as written */ }
      if (!dirtyBefore && editor.getValue() !== lastGood) lastGood = editor.getValue();
      paramDisplayMode = nextMode;
      state.rawNumbers = raw;
      editor.setInvalid(false);
      refreshDirty();
      if (inspectedLine && inspectorHost) renderInspector(inspectorHost, project, inspectedLine, true);
    } catch (error) {
      input.checked = !raw;
      setStatus(errorText(error), true);
    }
  };

  detail.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ma-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.maAction;
    if (button.closest(".ma-more-pop") && moreMenu) moreMenu.open = false;
    if (action === "apply") void apply();
    else if (action === "revert") void revert();
    else if (action === "docs") toggleDocs();
    else if (action === "test") void testInGame(button);
    else if (action === "copy" && copyBar) {
      copyBar.hidden = false;
      copyBar.querySelector<HTMLElement>("[contenteditable]")?.focus();
    } else if (action === "copy-cancel" && copyBar) copyBar.hidden = true;
    else if (action === "copy-script") void copyFromMove(false);
    else if (action === "copy-script-spa") void copyFromMove(true);
    else if (action === "import") importInput?.click();
    else if (action === "export" && editor) {
      try {
        downloadBytes(compileMoveAnimation(project, moveId, editor.getValue()), `move_${moveId}_animation.bin`);
        editor.setInvalid(false);
        setStatus("Exported binary");
      } catch (error) {
        editor.setInvalid(true);
        setStatus(errorText(error), true);
      }
    }
  }, { signal });
  copySource?.addEventListener("change", () => setCopyBusy(false), { signal });
  if (copySource) installSearchableSelect(copySource, "Donor move", signal);
  detail.querySelector<HTMLInputElement>("[data-ma-raw]")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void setRawNumbers(input.checked, input);
  }, { signal });
  importInput?.addEventListener("change", async () => {
    if (!editor) return;
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
      const scriptText = decompileMoveAnimationBytes(new Uint8Array(await file.arrayBuffer()));
      editor.setValue(formatMoveAnimationScriptParameters(scriptText, paramDisplayMode));
      editor.setInvalid(false);
      detail.querySelector(".ma-notice")?.remove();
      await spaEditor?.ensureReferences(editor.getValue());
      setStatus(`Imported ${file.name}. Apply to keep it.`);
    } catch (error) {
      editor.setInvalid(true);
      setStatus(errorText(error), true);
    }
  }, { signal });

  // Popovers close on outside clicks.
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (moreMenu?.open && !moreMenu.contains(target)) moreMenu.open = false;
    if (sceneMenu?.open && !sceneMenu.contains(target)) sceneMenu.open = false;
  }, { signal });
  // Shortcuts: Ctrl/Cmd+S applies, Space plays or pauses the preview, Escape closes the docs drawer.
  document.addEventListener("keydown", (event) => {
    if (!detail.isConnected) {
      abort.abort();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void apply();
      return;
    }
    if (event.key === "Escape" && docsDrawer && !docsDrawer.hidden) {
      toggleDocs(false);
      return;
    }
    if (event.key === " " && activeTab() === "script" && !isTypingTarget(event.target)) {
      event.preventDefault();
      previewController?.togglePlaying();
    }
  }, { signal });

  refreshDirty();
  setTab(state.tab);
  void buildPreview(false, false);

  return {
    isDirty,
    destroy: () => {
      abort.abort();
      window.clearTimeout(previewTimer);
      previewRequestId += 1;
      previewController?.destroy();
      audioPreview?.destroy();
      editor?.destroy();
    },
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, select, textarea, button, .cm-editor, summary") !== null;
}

/** Puts a type-to-search field in front of a select; the select stays the source of truth and still fires change. */
function installSearchableSelect(select: HTMLSelectElement, label: string, signal: AbortSignal): void {
  const options = [...select.options].filter((option) => option.value !== "");
  const values = options.map((option) => `${option.textContent?.trim() ?? option.value} (${option.value})`);
  const field = document.createElement("div");
  field.className = "ma-picker-field";
  field.contentEditable = "true";
  field.spellcheck = false;
  field.setAttribute("role", "combobox");
  field.setAttribute("aria-label", label);
  select.hidden = true;
  select.after(field);
  const currentLabel = () => (select.value === "" ? "" : select.selectedOptions[0]?.textContent?.trim() ?? "");
  field.textContent = currentLabel();
  if (select.value === "") field.dataset.placeholder = select.options[0]?.textContent ?? "";
  const picker = installPicker(field, values);
  field.addEventListener("focus", () => {
    window.setTimeout(() => {
      if (document.activeElement !== field) return;
      const range = document.createRange();
      range.selectNodeContents(field);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
    picker?.open();
  }, { signal });
  field.addEventListener("keydown", (event) => {
    if (picker?.handleKey(event)) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      if (event.key === "Escape") field.textContent = currentLabel();
      field.blur();
    }
  }, { signal });
  field.addEventListener("blur", () => {
    picker?.close();
    const committed = field.dataset.commitValue;
    delete field.dataset.commitValue;
    delete field.dataset.commitLabel;
    const query = (field.textContent ?? "").trim().toLowerCase();
    const idMatch = committed ? /\((\d+)\)$/u.exec(committed) : /^#?(\d+)$/u.exec(query);
    const match = idMatch
      ? options.find((option) => option.value === idMatch[1])
      : query && query !== currentLabel().toLowerCase()
        ? options.find((option) => (option.textContent ?? "").toLowerCase().includes(query))
        : undefined;
    if (match && match.value !== select.value) {
      select.value = match.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    field.textContent = currentLabel();
  }, { signal });
}

// ---------- Inspector ----------

let inspectorReferenceOpen = false;

function renderInspector(host: HTMLElement, project: ProjectState, info: MoveAnimationLineInfo, keepScroll = false): void {
  const scroll = host.scrollTop;
  host.innerHTML = renderInspectorHtml(info);
  if (keepScroll) host.scrollTop = scroll;
  if (inspectorReferenceOpen && info.definition) void hydrateInspectorReference(host, project, info);
}

function renderInspectorHtml(info: MoveAnimationLineInfo): string {
  const steps = `<div class="ma-insp-steps"><button class="btn sm -ghost" type="button" data-insp-step="-1" title="Previous command" aria-label="Previous command">‹</button><button class="btn sm -ghost" type="button" data-insp-step="1" title="Next command" aria-label="Next command">›</button></div>`;
  if (info.kind !== "command" || !info.definition) {
    const message = info.kind === "label"
      ? `Label <code>${escapeHtml(info.text.trim())}</code> starts a script block.`
      : info.kind === "directive"
        ? "Header line: lists which script block runs for each animation slot."
        : info.kind === "unknown"
          ? `<code>${escapeHtml(info.commandName ?? info.text.trim())}</code> is not a known command.`
          : "Put the cursor on a command to edit its parameters here.";
    return `<div class="ma-insp-head">${steps}<div class="ma-insp-title"><span class="ma-insp-muted">Line ${info.lineNumber}</span></div></div><p class="ma-insp-empty">${message}</p>`;
  }
  const definition = info.definition;
  const doc = info.doc;
  const displayName = doc?.currentPokewebName || getMoveAnimationDisplayCommandName(definition.name);
  const summary = summarizeMoveAnimationCommandLine(displayName, info.text);
  const channels = colorChannels(info);
  const color = channels ? getMoveAnimationCommandLineColor(info.text) : undefined;
  const params = definition.params.map((param, index) => renderParamControl(info, index, doc?.params[index]?.name ?? param.name, doc?.params[index]?.description || param.description)).join("");
  const notes = doc ? renderCommandBoundaryNote(doc) + renderCommandNotes(doc) : "";
  const showReference = Boolean(notes) || definition.name === "LoadBackground";
  return `
    <div class="ma-insp-head">
      ${steps}
      <div class="ma-insp-title">
        <strong>${escapeHtml(displayName)}</strong>
        <span class="ma-insp-muted">${escapeHtml(definition.category)} · ${escapeHtml(doc?.hex ?? `0x${definition.opcode.toString(16)}`)} · line ${info.lineNumber}</span>
      </div>
    </div>
    ${doc?.description ? `<p class="ma-insp-desc" title="${escapeHtml(doc.description)}">${escapeHtml(doc.description)}</p>` : ""}
    ${summary ? `<p class="ma-insp-summary">${escapeHtml(summary)}</p>` : ""}
    ${definition.params.length ? `<div class="ma-insp-params">${params}${color ? `<label class="ma-param -color"><span class="ma-param-name">Color</span><input type="color" data-ma-color value="${escapeHtml(color)}"><span class="ma-param-help">Sets the R, G and B values together.</span></label>` : ""}</div>` : `<p class="ma-insp-empty">No parameters.</p>`}
    ${showReference ? `<details class="ma-insp-ref"${inspectorReferenceOpen ? " open" : ""}><summary>Notes</summary>${notes}<div class="ma-insp-ref-extra"></div></details>` : ""}
  `;
}

function renderParamControl(info: MoveAnimationLineInfo, index: number, name: string, description: string): string {
  const definition = info.definition!;
  const commandName = definition.name;
  const token = info.params[index];
  const value = token === undefined ? undefined : parseMoveAnimationEditorParam(commandName, index, token);
  const semantic = getMoveAnimationParamSemantic(commandName, index);
  const help = `<span class="ma-param-help" title="${escapeHtml(description)}">${escapeHtml(description)}</span>`;
  const label = `<span class="ma-param-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
  const invalid = token !== undefined && value === undefined ? " invalid" : "";
  const enumValues = getMoveAnimationEnumCompletions(commandName, index);
  if (enumValues.length) {
    const known = enumValues.some((entry) => entry.value === value);
    const optionsHtml = [
      ...(known || value === undefined ? [] : [`<option value="${value}" selected>${value}</option>`]),
      ...enumValues.map((entry) => `<option value="${entry.value}" ${entry.value === value ? "selected" : ""} title="${escapeHtml(entry.description ?? "")}">${escapeHtml(entry.name)} (${entry.value})</option>`),
    ].join("");
    return `<label class="ma-param">${label}<select class="${invalid.trim()}" data-param-index="${index}">${value === undefined ? `<option value="" selected>—</option>` : ""}${optionsHtml}</select>${help}</label>`;
  }
  if (semantic?.kind === "fx32") {
    const unit = semantic.unit ?? "multiplier";
    const suffix = unit === "world" ? "px" : unit === "frame" ? "f" : "×";
    const shown = value === undefined ? "" : String(Number((value / FX32_ONE).toFixed(4)));
    return `<label class="ma-param">${label}<span class="ma-unit-input"><input class="${invalid.trim()}" type="number" step="0.0625" data-param-index="${index}" value="${escapeHtml(shown)}"><span>${suffix}</span></span>${help}</label>`;
  }
  return `<label class="ma-param">${label}<input class="${invalid.trim()}" type="number" step="1" data-param-index="${index}" value="${value === undefined ? escapeHtml(token ?? "") : value}">${help}</label>`;
}

const FX32_ONE = 4096;

function tokenForControl(info: MoveAnimationLineInfo, index: number, control: HTMLInputElement | HTMLSelectElement, mode: MoveAnimationParamDisplayMode): string | undefined {
  const commandName = info.definition!.name;
  if (control.value.trim() === "") return undefined;
  const number = Number(control.value);
  if (!Number.isFinite(number)) return undefined;
  const semantic = getMoveAnimationParamSemantic(commandName, index);
  if (control instanceof HTMLSelectElement) {
    return mode === "numeric" ? String(number) : formatMoveAnimationParam(commandName, index, number);
  }
  if (semantic?.kind === "fx32") {
    const raw = Math.round(number * FX32_ONE);
    return mode === "numeric" ? String(raw) : formatFx32Value(raw, semantic.unit);
  }
  return String(Math.trunc(number));
}

function colorChannels(info: MoveAnimationLineInfo): { red: number; green: number; blue: number } | undefined {
  const params = info.doc?.params ?? [];
  const find = (name: string) => params.find((param) => param.name.toLowerCase() === name)?.index;
  const red = find("r");
  const green = find("g");
  const blue = find("b");
  return red === undefined || green === undefined || blue === undefined ? undefined : { red, green, blue };
}

function hexToRgb5(value: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/iu.exec(value)?.[1] ?? "ffffff";
  return [0, 2, 4].map((offset) => Math.round((Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) * 31)) as [number, number, number];
}

async function hydrateInspectorReference(host: HTMLElement, project: ProjectState, info: MoveAnimationLineInfo): Promise<void> {
  const extra = host.querySelector<HTMLElement>(".ma-insp-ref[open] .ma-insp-ref-extra");
  if (!extra || extra.dataset.loaded === "true" || info.definition?.name !== "LoadBackground") return;
  extra.dataset.loaded = "true";
  const backgroundId = info.params[0] === undefined ? undefined : parseMoveAnimationEditorParam(info.definition.name, 0, info.params[0]);
  if (backgroundId === undefined || backgroundId < 0) return;
  extra.innerHTML = `<div class="move-command-background-preview"><div class="move-command-background-preview-title">Background ${backgroundId}</div><canvas aria-label="Background ${backgroundId} preview"></canvas><small>Loading…</small></div>`;
  const canvas = extra.querySelector("canvas")!;
  const note = extra.querySelector("small")!;
  try {
    const background = await loadMoveBackground(project, backgroundId);
    if (!extra.isConnected) return;
    renderMoveBackgroundPreviewCanvas(canvas, background);
    note.textContent = `${background.width}×${background.height}${background.hasTransparency ? " · index 0 transparent" : ""}`;
  } catch (error) {
    note.textContent = errorText(error);
  }
}

function renderCommandBoundaryNote(doc: MoveAnimationCommandDoc): string {
  if (doc.name === "LoadSPA") return `<p class="ma-insp-note">Loads the particle file. Textures, colors, scale and child particles are edited on the Particles tab.</p>`;
  if (doc.name.startsWith("DoSPA")) return `<p class="ma-insp-note">The script picks the particle, placement and timing. Its look (texture, tint, scale, fade) is edited on the Particles tab.</p>`;
  return "";
}

function renderCommandNotes(doc: MoveAnimationCommandDoc): string {
  if (doc.notes.length === 0) return "";
  return `<ul class="ma-insp-notes">${doc.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(error: unknown): string {
  return errorText(error);
}
