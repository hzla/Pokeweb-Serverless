import {
  getItemRecord,
  getMoveRecord,
  itemMatchesSearch,
  moveMatchesSearch,
  updateMoveEffectId,
  updateItemField,
  updateItemPackedField,
  updateMoveField,
  type FieldUpdateResult,
} from "../pokeweb/moveItemModel";
import { buildMoveAnimationPreview, loadMoveBackground, loadMoveSpaArchive } from "../pokeweb/moveAnimationPreviewModel";
import { loadBattleBackgroundCatalog, type BattleBackgroundVariant } from "../pokeweb/battleBackgroundModel";
import { loadBattlePlatformCatalog, type BattlePlatformVariant } from "../pokeweb/battlePlatformModel";
import { getMoveAnimationDisplayCommandName } from "../pokeweb/moveAnimationCommandNames";
import { summarizeMoveAnimationCommandLine } from "../pokeweb/moveAnimationCommandSummary";
import { compileMoveAnimation, decompileMoveAnimationBytes, formatMoveAnimationScriptParameters, updateMoveAnimationScript, type MoveAnimationParamDisplayMode } from "../pokeweb/moveAnimationModel";
import { getMoveAnimationParamSemanticHelp } from "../pokeweb/moveAnimationParamSemantics";
import {
  loadMoveAnimationBattleEnvironment,
  MOVE_PREVIEW_BACKGROUND_INDEX,
  MOVE_PREVIEW_PLATFORM_INDEX,
  type MoveAnimationBattleEnvironmentSelection,
} from "../pokeweb/moveAnimationBattleEnvironment";
import { updateMoveDescription, updateMoveTextName } from "../pokeweb/moveTextModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";
import { installMoveAnimationAudioPreview, type MoveAnimationAudioPreviewController } from "./moveAnimationAudioPreview";
import { installMoveAnimationPreview, renderMoveBackgroundPreviewCanvas, type MoveAnimationPreviewController } from "./moveAnimationPreview";
import { installMoveAnimationCodeEditor, type MoveAnimationCommandReference } from "./moveAnimationCodeEditor";
import { installMoveAnimationDocsPanel, type MoveAnimationDocsPanelController } from "./moveAnimationDocsPanel";
import { installMoveSpaEditor, type MoveSpaEditorController } from "./moveSpaEditor";

export type MoveAnimationEditorOptions = {
  onDirty?: () => void;
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>;
};

type MoveOptions = MoveAnimationEditorOptions & {
  onOpenMoveAnimation?: (moveId: number) => void;
  autofills: Record<string, string[]>;
  renderExpanded: (moveId: number) => string;
  renderTextPanel?: (moveId: number) => string;
};

type ItemOptions = {
  onDirty?: () => void;
  renderExpanded: (itemId: number) => string;
};

type SelectedBattleVariant = {
  tableIndex: number;
  seasonIndex: number;
};

const MOVE_ANIMATION_SWAP_SIDES_STORAGE_KEY = "pokeweb.moveAnimation.swapSides";
const MOVE_ANIMATION_AUDIO_STORAGE_KEY = "pokeweb.moveAnimation.audioEnabled";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function attachMoveInteractions(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  const activeCategories = new Set<string>();
  const activeTypes = new Set<string>();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");

  const runFilter = () => {
    filterMoves(root, project, searchInput?.value ?? "", activeCategories, activeTypes);
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.querySelectorAll<HTMLButtonElement>(".cat-filters [data-mcat]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeCategories, button.dataset.mcat ?? "");
      button.classList.toggle("-active", activeCategories.has(button.dataset.mcat ?? ""));
      button.setAttribute("aria-pressed", String(activeCategories.has(button.dataset.mcat ?? "")));
      runFilter();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".type-filters [data-ptype]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeTypes, button.dataset.ptype ?? "");
      button.classList.toggle("-active", activeTypes.has(button.dataset.ptype ?? ""));
      button.setAttribute("aria-pressed", String(activeTypes.has(button.dataset.ptype ?? "")));
      runFilter();
    });
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".move-card");
    const moveId = Number(card?.dataset.index);
    if (!card || !Number.isInteger(moveId)) return;

    const category = target.closest<HTMLElement>(".move-cat img");
    if (category?.dataset.value) {
      try {
        const result = updateMoveField(project, moveId, "category", category.dataset.value);
        syncMoveRow(card, result, "category");
        options.onDirty?.();
      } catch {
        category.classList.add("invalid");
      }
      return;
    }

    const prop = target.closest<HTMLElement>(".move-prop");
    if (prop?.dataset.fieldName) {
      const next = !prop.classList.contains("-active");
      updateMoveField(project, moveId, prop.dataset.fieldName, next);
      prop.classList.toggle("-active", next);
      options.onDirty?.();
      return;
    }

    const animationRowToggle = target.closest<HTMLButtonElement>(".move-animation-row-toggle");
    if (animationRowToggle) {
      options.onOpenMoveAnimation?.(moveId);
      return;
    }

    const icon = target.closest<HTMLElement>(".expand-action");
    if (!icon) return;
    const expandKind = icon.dataset.expand;
    if (expandKind === "move-text") {
      if (!card.querySelector(".expanded-move-texts") && options.renderTextPanel) {
        card.insertAdjacentHTML("beforeend", options.renderTextPanel(moveId));
        installMoveTextFields(card, project, options);
      }
      togglePanel(card, ".expanded-move-texts", icon);
      stripeRows(root);
      return;
    }
    if (!card.querySelector(".expanded-move")) {
      card.insertAdjacentHTML("beforeend", options.renderExpanded(moveId));
      installMoveEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-move", icon);
    stripeRows(root);
  });

  installMoveEditableFields(root, project, options);
  runFilter();
}

export function renderMoveAnimationEditor(script: string): string {
  return `
    <div class="move-animation-toolbar">
      <button class="script-btn move-animation-apply" type="button">Apply Script</button>
      <button class="script-btn move-animation-revert" type="button">Revert</button>
      <button class="script-btn move-animation-preview-btn" type="button">Refresh Preview</button>
      <button class="script-btn move-animation-import-bin" type="button">Import Binary</button>
      <button class="script-btn move-animation-export-bin" type="button">Export Binary</button>
      <label class="move-animation-param-mode">
        <input class="move-animation-param-mode-toggle" type="checkbox">
        <span>Numeric Params</span>
      </label>
      <input class="move-animation-import-bin-file" type="file" accept=".bin,.dat,application/octet-stream" hidden>
      <div class="move-animation-status"></div>
    </div>
    <textarea class="move-animation-source" hidden>${escapeHtml(script)}</textarea>
    <div class="move-animation-workspace">
      <div class="move-animation-script-pane">
        <div class="move-animation-text"></div>
      </div>
      <div class="move-animation-side-pane">
        <div class="move-animation-side-tabs" role="tablist" aria-label="Move animation side panel">
          <button class="move-animation-side-tab -active" id="move-animation-preview-tab" type="button" role="tab" aria-selected="true" aria-controls="move-animation-preview-panel" data-move-animation-side-tab="preview">Preview</button>
          <button class="move-animation-side-tab" id="move-animation-spa-tab" type="button" role="tab" aria-selected="false" aria-controls="move-animation-spa-panel" data-move-animation-side-tab="spa" tabindex="-1">SPA Editor</button>
          <button class="move-animation-side-tab" id="move-animation-audio-tab" type="button" role="tab" aria-selected="false" aria-controls="move-animation-audio-panel" data-move-animation-side-tab="audio" tabindex="-1">Audio</button>
          <button class="move-animation-side-tab -utility-start" id="move-animation-docs-tab" type="button" role="tab" aria-selected="false" aria-controls="move-animation-docs-panel" data-move-animation-side-tab="docs" tabindex="-1">Docs</button>
        </div>
        <div class="move-animation-side-tab-panels">
          <section class="move-animation-side-tab-panel -active" id="move-animation-preview-panel" role="tabpanel" aria-labelledby="move-animation-preview-tab" data-move-animation-side-panel="preview">
            <div class="move-animation-preview-host show-flex">
              <div class="move-animation-preview-loading">Building preview...</div>
            </div>
          </section>
          <section class="move-animation-side-tab-panel" id="move-animation-spa-panel" role="tabpanel" aria-labelledby="move-animation-spa-tab" data-move-animation-side-panel="spa" hidden>
            <div class="move-animation-spa-pane" aria-label="SPA particle editor">
              <div class="move-animation-spa-placeholder">
                <h4>SPA Particle Editor</h4>
                <p>Particle resource editing will live here.</p>
                <div class="move-animation-spa-placeholder-grid">
                  <div>
                    <strong>Archives</strong>
                    <span>Referenced SPA files</span>
                  </div>
                  <div>
                    <strong>Emitters</strong>
                    <span>Particle timing and spawn controls</span>
                  </div>
                  <div>
                    <strong>Textures</strong>
                    <span>Palette and image previews</span>
                  </div>
                  <div>
                    <strong>Preview Sync</strong>
                    <span>Live updates beside the script</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section class="move-animation-side-tab-panel" id="move-animation-docs-panel" role="tabpanel" aria-labelledby="move-animation-docs-tab" data-move-animation-side-panel="docs" hidden>
            <div class="move-animation-docs-pane" aria-label="Move animation documentation"></div>
          </section>
          <section class="move-animation-side-tab-panel" id="move-animation-audio-panel" role="tabpanel" aria-labelledby="move-animation-audio-tab" data-move-animation-side-panel="audio" hidden>
            <div class="move-animation-audio-pane" aria-label="Move animation audio preview"></div>
          </section>
        </div>
      </div>
    </div>
  `;
}

export function installMoveAnimationEditor(panel: HTMLElement, project: ProjectState, moveId: number, options: MoveAnimationEditorOptions): void {
  const editorHost = panel.querySelector<HTMLElement>(".move-animation-text");
  const source = panel.querySelector<HTMLTextAreaElement>(".move-animation-source");
  const status = panel.querySelector<HTMLElement>(".move-animation-status");
  const previewHost = panel.querySelector<HTMLElement>(".move-animation-preview-host");
  const spaEditorHost = panel.querySelector<HTMLElement>(".move-animation-spa-pane");
  const docsHost = panel.querySelector<HTMLElement>(".move-animation-docs-pane");
  const audioPreviewHost = panel.querySelector<HTMLElement>(".move-animation-audio-pane");
  const commandReference = document.querySelector<HTMLElement>("#move-command-reference");
  const testButton = document.querySelector<HTMLButtonElement>(".move-animation-test-btn");
  const pageRoot = panel.closest<HTMLElement>(".move-animation-page")?.parentElement;
  const backgroundSelect = pageRoot?.querySelector<HTMLSelectElement>("#move-animation-background-select") ?? undefined;
  const platformSelect = pageRoot?.querySelector<HTMLSelectElement>("#move-animation-platform-select") ?? undefined;
  const swapSidesInput = pageRoot?.querySelector<HTMLInputElement>("#move-animation-swap-sides") ?? undefined;
  const savedSwappedSides = loadMoveAnimationSwapSidesPreference();
  let audioEnabled = loadMoveAnimationAudioPreference();
  if (swapSidesInput) swapSidesInput.checked = savedSwappedSides;
  let battleEnvironmentSelection: MoveAnimationBattleEnvironmentSelection = {
    backgroundIndex: MOVE_PREVIEW_BACKGROUND_INDEX,
    backgroundSeasonIndex: 0,
    platformIndex: MOVE_PREVIEW_PLATFORM_INDEX,
    platformSeasonIndex: 0,
    swappedSides: savedSwappedSides,
  };
  let audioPreview: MoveAnimationAudioPreviewController | undefined;
  let docsPanel: MoveAnimationDocsPanelController | undefined;
  let audioTabLoaded = false;
  let activeSideTab: "preview" | "docs" | "spa" | "audio" = "preview";
  const activateSideTab = (nextTab: "preview" | "docs" | "spa" | "audio") => {
    activeSideTab = nextTab;
    if (nextTab !== "audio") audioPreview?.stop();
    previewController?.setAudioSuppressed(nextTab !== "preview");
    panel.querySelectorAll<HTMLButtonElement>("[data-move-animation-side-tab]").forEach((button) => {
      const active = button.dataset.moveAnimationSideTab === nextTab;
      button.classList.toggle("-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    panel.querySelectorAll<HTMLElement>("[data-move-animation-side-panel]").forEach((tabPanel) => {
      const active = tabPanel.dataset.moveAnimationSidePanel === nextTab;
      tabPanel.classList.toggle("-active", active);
      tabPanel.hidden = !active;
    });
  };
  const editor = editorHost
    ? installMoveAnimationCodeEditor(editorHost, source?.value ?? "", {
        onCommandSelected: (reference) => renderCommandReference(commandReference, reference, project),
      })
    : undefined;
  let previewController: MoveAnimationPreviewController | undefined;
  let previewRequestId = 0;
  let previewDirty = false;
  let previewRefreshTimer = 0;
  let previewPhaseIndex = 0;
  const destroyPreview = (): void => {
    previewController?.destroy();
    previewController = undefined;
    previewHost?.classList.remove("show-flex");
  };
  const closePreview = () => {
    previewRequestId += 1;
    window.clearTimeout(previewRefreshTimer);
    destroyPreview();
  };
  const schedulePreviewRefresh = (): void => {
    previewDirty = true;
    if (activeSideTab !== "preview") return;
    window.clearTimeout(previewRefreshTimer);
    previewRefreshTimer = window.setTimeout(() => {
      void buildPreview(false, { reveal: false });
    }, 150);
  };
  const spaEditor: MoveSpaEditorController | undefined = spaEditorHost
    ? installMoveSpaEditor(spaEditorHost, project, editor?.getValue() ?? source?.value ?? "", { onDirty: options.onDirty, onPreviewChange: schedulePreviewRefresh })
    : undefined;
  docsPanel = docsHost ? installMoveAnimationDocsPanel(docsHost) : undefined;
  audioPreview = audioPreviewHost
    ? installMoveAnimationAudioPreview(audioPreviewHost, project, moveId, () => editor?.getValue() ?? source?.value ?? "")
    : undefined;
  let lastGood = editor?.getValue() ?? "";
  let paramDisplayMode: MoveAnimationParamDisplayMode = "semantic";
  const setEditorScriptForDisplayMode = (scriptText: string): void => {
    if (!editor) return;
    editor.setValue(paramDisplayMode === "numeric" ? formatMoveAnimationScriptParameters(scriptText, "numeric") : formatMoveAnimationScriptParameters(scriptText, "semantic"));
  };
  const refreshScriptDependents = async (): Promise<void> => {
    await spaEditor?.ensureReferences(editor?.getValue() ?? source?.value ?? "");
  };
  const buildPreview = async (initialPlaying: boolean, buildOptions: { reveal?: boolean } = {}) => {
    if (!editor || !previewHost) return;
    const requestId = ++previewRequestId;
    window.clearTimeout(previewRefreshTimer);
    if (buildOptions.reveal ?? true) activateSideTab("preview");
    destroyPreview();
    previewHost.classList.add("show-flex");
    previewHost.innerHTML = `<div class="move-animation-preview-loading">Building preview...</div>`;
    if (status) {
      status.textContent = "Loading preview";
      status.classList.remove("-error");
    }
    try {
      const scriptText = editor.getValue();
      await spaEditor?.ensureReferences(scriptText);
      const preview = await buildMoveAnimationPreview(project, moveId, scriptText, {
        phaseIndex: previewPhaseIndex,
        loadSpaArchive: async (_project, spaId) => spaEditor?.getArchiveOverride(spaId) ?? loadMoveSpaArchive(project, spaId),
      });
      previewPhaseIndex = preview.phaseIndex ?? 0;
      try {
        preview.battleEnvironment = await loadMoveAnimationBattleEnvironment(project, { ...battleEnvironmentSelection });
      } catch (error) {
        preview.warnings.push({ message: `Battle scene: ${error instanceof Error ? error.message : String(error)}` });
      }
      const nextPreviewController = await installMoveAnimationPreview(previewHost, preview, {
        initialPlaying,
        onPhaseChange: (phaseIndex) => {
          previewPhaseIndex = phaseIndex;
          void buildPreview(true, { reveal: false });
        },
        audio: {
          project,
          initialEnabled: audioEnabled,
          onEnabledChange: (enabled) => {
            audioEnabled = enabled;
            saveMoveAnimationAudioPreference(enabled);
          },
        },
      });
      if (requestId !== previewRequestId) {
        nextPreviewController.destroy();
        return;
      }
      previewController = nextPreviewController;
      previewDirty = false;
      editor.setInvalid(false);
      if (status) {
        status.textContent = "Preview ready";
        status.classList.remove("-error");
      }
    } catch (error) {
      if (requestId !== previewRequestId) return;
      previewHost.innerHTML = `<div class="move-animation-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
      editor.setInvalid(true);
      if (status) {
        status.textContent = "Preview failed";
        status.classList.add("-error");
      }
    }
  };
  panel.addEventListener("move-animation-preview-close", closePreview);
  panel.querySelectorAll<HTMLButtonElement>("[data-move-animation-side-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.moveAnimationSideTab;
      if (nextTab !== "preview" && nextTab !== "docs" && nextTab !== "spa" && nextTab !== "audio") return;
      activateSideTab(nextTab);
      if (nextTab === "docs") docsPanel?.refresh();
      if (nextTab === "preview" && previewDirty) void buildPreview(false, { reveal: false });
      if (nextTab === "spa") void spaEditor?.ensureReferences(editor?.getValue() ?? source?.value ?? "");
      if (nextTab === "audio" && !audioTabLoaded) {
        audioTabLoaded = true;
        void audioPreview?.refresh();
      }
    });
  });
  const refreshEnvironmentPreview = (): void => {
    previewDirty = true;
    if (activeSideTab === "preview") void buildPreview(false, { reveal: false });
  };
  backgroundSelect?.addEventListener("change", () => {
    const variant = parseSelectedBattleVariant(backgroundSelect.value);
    if (!variant) return;
    battleEnvironmentSelection = {
      ...battleEnvironmentSelection,
      backgroundIndex: variant.tableIndex,
      backgroundSeasonIndex: variant.seasonIndex,
    };
    refreshEnvironmentPreview();
  });
  platformSelect?.addEventListener("change", () => {
    const variant = parseSelectedBattleVariant(platformSelect.value);
    if (!variant) return;
    battleEnvironmentSelection = {
      ...battleEnvironmentSelection,
      platformIndex: variant.tableIndex,
      platformSeasonIndex: variant.seasonIndex,
    };
    refreshEnvironmentPreview();
  });
  swapSidesInput?.addEventListener("change", () => {
    battleEnvironmentSelection = {
      ...battleEnvironmentSelection,
      swappedSides: swapSidesInput.checked,
    };
    saveMoveAnimationSwapSidesPreference(swapSidesInput.checked);
    refreshEnvironmentPreview();
  });
  void loadMoveAnimationEnvironmentSelectors(project, backgroundSelect, platformSelect, battleEnvironmentSelection)
    .then((selection) => {
      battleEnvironmentSelection = { ...selection, swappedSides: battleEnvironmentSelection.swappedSides };
    });
  void buildPreview(false);
  panel.querySelector<HTMLButtonElement>(".move-animation-apply")?.addEventListener("click", () => {
    if (!editor) return;
    try {
      const scriptText = editor.getValue();
      updateMoveAnimationScript(project, moveId, scriptText);
      lastGood = scriptText;
      if (status) {
        status.textContent = "Applied";
        status.classList.remove("-error");
      }
      editor.setInvalid(false);
      options.onDirty?.();
      if (activeSideTab === "preview") void buildPreview(false, { reveal: false });
      else previewDirty = true;
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("-error");
      }
      editor.setInvalid(true);
    }
  });
  panel.querySelector<HTMLButtonElement>(".move-animation-revert")?.addEventListener("click", () => {
    if (!editor) return;
    setEditorScriptForDisplayMode(lastGood);
    editor.setInvalid(false);
    schedulePreviewRefresh();
    if (status) {
      status.textContent = "";
      status.classList.remove("-error");
    }
  });
  panel.querySelector<HTMLButtonElement>(".move-animation-preview-btn")?.addEventListener("click", async () => {
    await buildPreview(false);
  });
  panel.querySelector<HTMLInputElement>(".move-animation-param-mode-toggle")?.addEventListener("change", async (event) => {
    if (!editor) return;
    const input = event.currentTarget as HTMLInputElement;
    const previousMode = paramDisplayMode;
    const nextMode: MoveAnimationParamDisplayMode = input.checked ? "numeric" : "semantic";
    try {
      const currentText = editor.getValue();
      paramDisplayMode = nextMode;
      setEditorScriptForDisplayMode(currentText);
      editor.setInvalid(false);
      await refreshScriptDependents();
      if (status) {
        status.textContent = nextMode === "numeric" ? "Showing numeric parameters" : "Showing semantic parameters";
        status.classList.remove("-error");
      }
    } catch (error) {
      paramDisplayMode = previousMode;
      input.checked = previousMode === "numeric";
      editor.setInvalid(true);
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("-error");
      }
    }
  });
  testButton?.addEventListener("click", async () => {
    if (!editor || !options.onTestMove) return;
    const previousText = testButton.textContent ?? "Test in Game";
    try {
      testButton.disabled = true;
      testButton.textContent = "Building...";
      if (status) {
        status.textContent = "Building test";
        status.classList.remove("-error");
      }
      await options.onTestMove(moveId, editor.getValue());
      editor.setInvalid(false);
      if (status) {
        status.textContent = "Test launched";
        status.classList.remove("-error");
      }
    } catch (error) {
      editor.setInvalid(true);
      window.alert(error instanceof Error ? error.message : String(error));
      if (status) {
        status.textContent = "Test failed";
        status.classList.add("-error");
      }
    } finally {
      testButton.disabled = false;
      testButton.textContent = previousText;
    }
  });
  const importBinaryInput = panel.querySelector<HTMLInputElement>(".move-animation-import-bin-file");
  panel.querySelector<HTMLButtonElement>(".move-animation-import-bin")?.addEventListener("click", () => {
    importBinaryInput?.click();
  });
  importBinaryInput?.addEventListener("change", async () => {
    if (!editor) return;
    const file = importBinaryInput.files?.[0];
    importBinaryInput.value = "";
    if (!file) return;
    try {
	      const scriptText = decompileMoveAnimationBytes(new Uint8Array(await file.arrayBuffer()));
	      setEditorScriptForDisplayMode(scriptText);
	      editor.setInvalid(false);
      await spaEditor?.ensureReferences(editor.getValue());
      schedulePreviewRefresh();
      if (status) {
        status.textContent = `Imported ${file.name}; Apply Script to save`;
        status.classList.remove("-error");
      }
    } catch (error) {
      editor.setInvalid(true);
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("-error");
      }
    }
  });
  panel.querySelector<HTMLButtonElement>(".move-animation-export-bin")?.addEventListener("click", () => {
    if (!editor) return;
    try {
      const bytes = compileMoveAnimation(project, moveId, editor.getValue());
      downloadBytes(bytes, `move_${moveId}_animation.bin`);
      editor.setInvalid(false);
      if (status) {
        status.textContent = "Exported binary";
        status.classList.remove("-error");
      }
    } catch (error) {
      editor.setInvalid(true);
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("-error");
      }
    }
  });
}

function installMoveTextFields(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  root.querySelectorAll<HTMLInputElement>(".move-text-name-input").forEach((input) => {
    if (input.dataset.moveTextNameInstalled === "true") return;
    input.dataset.moveTextNameInstalled = "true";
    let initialValue = input.value.trim();
    const commit = () => {
      const card = input.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      updateMoveTextName(project, moveId, input.value);
      refreshMoveTextPanel(card, project, moveId, options);
      syncMoveNameInRow(card, project, moveId);
      return true;
    };
    input.addEventListener("focus", () => {
      initialValue = input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("change", () => {
      if (input.value.trim() === initialValue) return;
      try {
        if (commit()) {
          input.classList.remove("invalid");
          options.onDirty?.();
        }
      } catch (error) {
        input.value = initialValue;
        input.classList.add("invalid");
        setMoveTextStatus(input, error instanceof Error ? error.message : String(error), true);
      }
    });
  });

  root.querySelectorAll<HTMLTextAreaElement>(".move-text-description-input").forEach((textarea) => {
    if (textarea.dataset.moveTextDescriptionInstalled === "true") return;
    textarea.dataset.moveTextDescriptionInstalled = "true";
    let initialValue = textarea.value;
    const commit = () => {
      const card = textarea.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      updateMoveDescription(project, moveId, textarea.value);
      refreshMoveTextPanel(card, project, moveId, options);
      return true;
    };
    textarea.addEventListener("focus", () => {
      initialValue = textarea.value;
    });
    textarea.addEventListener("change", () => {
      if (textarea.value === initialValue) return;
      try {
        if (commit()) {
          textarea.classList.remove("invalid");
          options.onDirty?.();
        }
      } catch (error) {
        textarea.value = initialValue;
        textarea.classList.add("invalid");
        setMoveTextStatus(textarea, error instanceof Error ? error.message : String(error), true);
      }
    });
  });
}

function refreshMoveTextPanel(card: HTMLElement, project: ProjectState, moveId: number, options: MoveOptions): void {
  const panel = card.querySelector<HTMLElement>(".expanded-move-texts");
  if (!panel || !options.renderTextPanel) return;
  const wasOpen = panel.classList.contains("show-flex");
  panel.outerHTML = options.renderTextPanel(moveId);
  const nextPanel = card.querySelector<HTMLElement>(".expanded-move-texts");
  if (nextPanel && wasOpen) nextPanel.classList.add("show-flex");
  if (nextPanel) installMoveTextFields(nextPanel, project, options);
}

function setMoveTextStatus(field: HTMLElement, message: string, error = false): void {
  const panel = field.closest<HTMLElement>(".expanded-move-texts");
  const status = panel?.querySelector<HTMLElement>(".move-text-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("-error", error);
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderCommandReference(host: HTMLElement | null, reference: MoveAnimationCommandReference, project: ProjectState): void {
  if (!host) return;
  const doc = reference.doc;
  const displayName = doc.currentPokewebName || getMoveAnimationDisplayCommandName(doc.name);
  const referenceName =
    doc.name !== displayName ? `<div class="move-command-reference-subtitle">Reference name: <code>${escapeHtml(doc.name)}</code></div>` : "";
  const backgroundId = parseLoadBackgroundId(reference);
  const previewId = backgroundId === undefined ? "" : `move-bg-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  host.innerHTML = `
    <div class="move-command-reference-kicker">${escapeHtml(doc.hex)} / ${escapeHtml(doc.category)}</div>
    <div class="move-command-reference-title">${escapeHtml(displayName)}</div>
    ${referenceName}
	    <p>${escapeHtml(doc.description)}</p>
	    ${renderCommandSemanticSummary(reference, displayName)}
	    ${renderCommandParamList(doc, displayName)}
	    ${renderCommandBoundaryNote(doc)}
	    ${renderCommandNotes(doc)}
	    ${backgroundId === undefined ? "" : renderBackgroundReferencePreview(backgroundId, previewId)}
	  `;
  if (backgroundId !== undefined) void hydrateBackgroundReferencePreview(host, project, backgroundId, previewId);
}

function renderCommandSemanticSummary(reference: MoveAnimationCommandReference, commandName: string): string {
  const summary = summarizeMoveAnimationCommandLine(commandName, reference.lineText);
  if (!summary) return "";
  return `
    <div class="move-command-reference-summary">
      <div>Selected Command</div>
      <p>${escapeHtml(summary)}</p>
    </div>
  `;
}

function renderCommandBoundaryNote(doc: MoveAnimationCommandReference["doc"]): string {
  if (doc.name === "LoadSPA") {
    return `<div class="move-command-reference-notes"><div>Script vs SPA</div><ul><li>Script loads the SPA archive. Textures, emitter color, alpha, scale, child particles, and behaviors still live inside the SPA file.</li></ul></div>`;
  }
  if (doc.name.startsWith("DoSPA")) {
    return `<div class="move-command-reference-notes"><div>Script vs SPA</div><ul><li>Script chooses the SPA, resource, placement, and timing. The visible particle shape, texture, tint curves, scale curves, opacity curves, and nested child particles require SPA edits.</li></ul></div>`;
  }
  if (doc.category === "Background") {
    return `<div class="move-command-reference-notes"><div>Script vs SPA</div><ul><li>This is a pure VM background command. Particle texture or emitter changes are not involved unless a separate SPA is spawned at the same time.</li></ul></div>`;
  }
  if (doc.category === "Sound") {
    return `<div class="move-command-reference-notes"><div>Script vs SPA</div><ul><li>Sound playback is script-side. SPA files only matter if you are matching the sound timing to particle lifetime.</li></ul></div>`;
  }
  return "";
}

function parseLoadBackgroundId(reference: MoveAnimationCommandReference): number | undefined {
  if (reference.clickedName !== "LoadBackground") return undefined;
  const match = /^\s*LoadBackground\s+([-+]?(?:0x[0-9a-f]+|\d+))/iu.exec(reference.lineText);
  if (!match) return undefined;
  const value = match[1].toLowerCase().startsWith("0x") ? Number.parseInt(match[1].slice(2), 16) : Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function renderBackgroundReferencePreview(backgroundId: number, previewId: string): string {
  return `
    <div class="move-command-background-preview" data-preview-id="${escapeHtml(previewId)}">
      <div class="move-command-background-preview-title">Background ${backgroundId}</div>
      <canvas aria-label="Background ${backgroundId} preview"></canvas>
      <small>Loading background preview...</small>
    </div>
  `;
}

async function hydrateBackgroundReferencePreview(host: HTMLElement, project: ProjectState, backgroundId: number, previewId: string): Promise<void> {
  const preview = host.querySelector<HTMLElement>(`.move-command-background-preview[data-preview-id="${CSS.escape(previewId)}"]`);
  const canvas = preview?.querySelector<HTMLCanvasElement>("canvas");
  const status = preview?.querySelector<HTMLElement>("small");
  if (!preview || !canvas || !status) return;
  try {
    const background = await loadMoveBackground(project, backgroundId);
    if (!host.contains(preview)) return;
    renderMoveBackgroundPreviewCanvas(canvas, background);
    status.textContent = `${background.width}x${background.height}${background.hasTransparency ? " / transparent index 0" : ""}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    preview.classList.add("-error");
  }
}

function renderCommandParamList(doc: MoveAnimationCommandReference["doc"], commandName: string): string {
  if (doc.params.length === 0) return `<div class="move-command-reference-empty">Parameters: none.</div>`;
  return `
    <div class="move-command-reference-params">
      ${doc.params
        .map(
          (param) => `
            <div class="move-command-reference-param">
              <div><span>#${param.index}</span> <code>${escapeHtml(param.currentArg)}</code>${param.name !== param.currentArg ? `<small>${escapeHtml(param.name)}</small>` : ""}</div>
              <p>${escapeHtml(param.description)}</p>
              ${renderCommandParamSemanticHelp(commandName, param.index)}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCommandParamSemanticHelp(commandName: string, paramIndex: number): string {
  const help = getMoveAnimationParamSemanticHelp(commandName, paramIndex);
  if (!help) return "";
  if (help.kind === "fx32") {
    if (help.unit === "world") {
      return `<small class="move-command-reference-semantic">Accepts FX32 world units such as <code>1px</code>, <code>0.5px</code>, and <code>2px</code>; raw <code>4096</code> remains valid.</small>`;
    }
    if (help.unit === "frame") {
      return `<small class="move-command-reference-semantic">Accepts FX32 frame counts such as <code>1f</code>, <code>10f</code>, and <code>30f</code>; raw <code>4096</code> remains valid.</small>`;
    }
    return `<small class="move-command-reference-semantic">Accepts FX32 multipliers such as <code>1x</code>, <code>0.5x</code>, and <code>2x</code>.</small>`;
  }
  const values = help.values ?? [];
  if (!values.length) return "";
  return `<small class="move-command-reference-semantic">Values: ${values.map((value) => `<code>${escapeHtml(value.name)} (${value.value})</code>`).join(" ")}</small>`;
}

function renderCommandNotes(doc: MoveAnimationCommandReference["doc"]): string {
  if (doc.notes.length === 0) return "";
  return `<div class="move-command-reference-notes"><div>Notes</div><ul>${doc.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>`;
}

export function attachItemInteractions(root: HTMLElement, project: ProjectState, options: ItemOptions): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterItems(root, project, searchInput?.value ?? "");
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".item-card");
    const itemId = Number(card?.dataset.index);
    const icon = target.closest<HTMLElement>(".expand-action");
    if (!card || !Number.isInteger(itemId) || !icon) return;
    if (!card.querySelector(".expanded-item")) {
      card.insertAdjacentHTML("beforeend", options.renderExpanded(itemId));
      installItemEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-item", icon);
    stripeRows(root);
  });

  installItemEditableFields(root, project, options);
  runFilter();
}

function filterMoves(root: HTMLElement, project: ProjectState, searchText: string, categories: Set<string>, types: Set<string>): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#moves .move-card").forEach((card) => {
    const moveId = Number(card.dataset.index);
    const show = Number.isInteger(moveId) ? moveMatchesSearch(getMoveRecord(project, moveId), searchText, categories, types) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function filterItems(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#items .item-card").forEach((card) => {
    const itemId = Number(card.dataset.index);
    const show = Number.isInteger(itemId) ? itemMatchesSearch(getItemRecord(project, itemId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installMoveEditableFields(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='move']").forEach((field) => {
    if (field.dataset.moveEditInstalled === "true") return;
    field.dataset.moveEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);
    installEditableHandlers(field, () => {
      const card = field.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(moveId) || !fieldName) return false;
      const result = updateMoveField(project, moveId, fieldName, field.textContent?.trim() ?? "");
      field.textContent = String(result.value);
      syncMoveRow(card, result, fieldName);
      return true;
    }, () => initialValue, (value) => {
      initialValue = value;
    }, options.onDirty);
  });

  root.querySelectorAll<HTMLInputElement>(".move-effect-id-input").forEach((input) => {
    if (input.dataset.moveEffectIdInstalled === "true") return;
    input.dataset.moveEffectIdInstalled = "true";
    let initialValue = input.value.trim();
    const commit = () => {
      const card = input.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      const result = updateMoveEffectId(project, moveId, input.value.trim());
      input.value = String(result.rawValue);
      syncMoveRow(card, result, "effect");
      return true;
    };
    input.addEventListener("focus", () => {
      initialValue = input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("change", () => {
      const nextValue = input.value.trim();
      if (nextValue === initialValue) return;
      try {
        if (commit()) {
          input.classList.remove("invalid");
          initialValue = input.value.trim();
          options.onDirty?.();
        }
      } catch {
        input.value = initialValue;
        input.classList.add("invalid");
      }
    });
  });
}

function installItemEditableFields(root: HTMLElement, project: ProjectState, options: ItemOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='item']").forEach((field) => {
    if (field.dataset.itemEditInstalled === "true") return;
    field.dataset.itemEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installEditableHandlers(field, () => {
      const card = field.closest<HTMLElement>(".item-card");
      const itemId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(itemId) || !fieldName) return false;
      const result = updateItemField(project, itemId, fieldName, field.textContent?.trim() ?? "");
      field.textContent = String(result.value);
      return true;
    }, () => initialValue, (value) => {
      initialValue = value;
    }, options.onDirty);
  });

  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='item-part']").forEach((field) => {
    if (field.dataset.itemPartEditInstalled === "true") return;
    field.dataset.itemPartEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installEditableHandlers(field, () => {
      const card = field.closest<HTMLElement>(".item-card");
      const itemId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      const partKey = field.dataset.partKey;
      if (!card || !Number.isInteger(itemId) || !fieldName || !partKey) return false;
      const result = updateItemPackedField(project, itemId, fieldName, partKey, field.textContent?.trim() ?? "");
      syncItemPackedEditor(card, fieldName, result.rawValue);
      return true;
    }, () => initialValue, (value) => {
      initialValue = value;
    }, options.onDirty);
  });

  root.querySelectorAll<HTMLInputElement>(".item-flag-checkbox").forEach((checkbox) => {
    if (checkbox.dataset.itemFlagInstalled === "true") return;
    checkbox.dataset.itemFlagInstalled = "true";
    checkbox.addEventListener("change", () => {
      const card = checkbox.closest<HTMLElement>(".item-card");
      const itemId = Number(card?.dataset.index);
      const fieldName = checkbox.dataset.fieldName;
      const partKey = checkbox.dataset.partKey;
      if (!card || !Number.isInteger(itemId) || !fieldName || !partKey) return;
      try {
        const result = updateItemPackedField(project, itemId, fieldName, partKey, checkbox.checked);
        syncItemPackedEditor(card, fieldName, result.rawValue);
        checkbox.classList.remove("invalid");
        options.onDirty?.();
      } catch {
        checkbox.checked = !checkbox.checked;
        checkbox.classList.add("invalid");
      }
    });
  });
}

function installEditableHandlers(
  field: HTMLElement,
  commit: () => boolean,
  getInitial: () => string,
  setInitial: (value: string) => void,
  onDirty?: () => void,
): void {
  field.addEventListener("mousedown", () => setInitial(field.textContent?.trim() ?? ""));
  field.addEventListener("click", () => selectText(field));
  field.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    }
  });
  field.addEventListener("focusout", () => {
    const nextValue = field.textContent?.trim() ?? "";
    field.textContent = nextValue;
    if (nextValue === getInitial()) return;
    try {
      if (commit()) {
        field.classList.remove("invalid");
        field.style.border = "";
        onDirty?.();
      }
    } catch {
      field.textContent = getInitial();
      field.classList.add("invalid");
      field.style.border = "1px solid red";
    }
  });
}

function syncMoveRow(card: HTMLElement, result: FieldUpdateResult, fieldName: string): void {
  if (fieldName === "type") {
    const typeField = card.querySelector<HTMLElement>("[data-field-name='type']");
    if (typeField) {
      [...typeField.classList].filter((name) => name.startsWith("-")).forEach((name) => typeField.classList.remove(name));
      typeField.classList.add(`-${String(result.value).toLowerCase()}`, "-active");
      typeField.textContent = String(result.value);
    }
  }
  if (fieldName === "category") {
    card.querySelectorAll<HTMLImageElement>(".move-cat img").forEach((image) => {
      const active = image.dataset.value === String(result.value).toLowerCase();
      image.classList.toggle("chosen", active);
      image.classList.toggle("unchosen", !active);
    });
  }
  if (fieldName === "effect") {
    const effectName = card.querySelector<HTMLElement>("[contenteditable='true'][data-field-name='effect']");
    if (effectName) effectName.textContent = String(result.value);
    const effectId = card.querySelector<HTMLInputElement>(".move-effect-id-input");
    if (effectId) effectId.value = String(result.rawValue);
  }
}

function syncMoveNameInRow(card: HTMLElement, project: ProjectState, moveId: number): void {
  const main = card.querySelector<HTMLElement>(":scope > .expanded-field-main");
  const nameField = main?.querySelector<HTMLElement>(".move-name");
  if (!nameField) return;
  const move = getMoveRecord(project, moveId);
  nameField.textContent = `${move.id} - ${String(move.readable.name ?? `Move ${move.id}`)}`;
}

function syncItemPackedEditor(card: HTMLElement, fieldName: string, rawValue: number): void {
  const editor = card.querySelector<HTMLElement>(`.item-flag-editor[data-field-name="${CSS.escape(fieldName)}"]`);
  if (editor) editor.dataset.rawValue = String(rawValue);
}

function togglePanel(card: HTMLElement, selector: string, icon: HTMLElement): void {
  const target = card.querySelector<HTMLElement>(selector);
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    icon.classList.add("-active");
    scrollRowBelowStickyHeader(card);
  }
}

function installAutocomplete(field: HTMLElement, autofills: Record<string, string[]>): void {
  const key = field.dataset.autofill;
  if (!key || field.parentElement?.hasAttribute("data-autocomplete")) return;
  const values = autofills[key] ?? [];
  if (values.length === 0) return;
  const host = document.createElement("span");
  host.setAttribute("data-autocomplete", "");
  field.before(host);
  host.append(field);
  const suggestions = document.createElement("div");
  suggestions.className = "suggestions";
  suggestions.hidden = true;
  host.append(suggestions);
  const render = () => {
    const query = field.textContent?.trim().toLowerCase() ?? "";
    if (!query) {
      suggestions.hidden = true;
      return;
    }
    const matches = values.filter((value) => value.toLowerCase().includes(query)).slice(0, 12);
    suggestions.innerHTML = matches.map((value) => `<div>${escapeHtml(value)}</div>`).join("");
    suggestions.hidden = matches.length === 0;
  };
  field.addEventListener("input", render);
  field.addEventListener("focus", render);
  field.addEventListener("blur", () => window.setTimeout(() => (suggestions.hidden = true), 150));
  suggestions.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.parentElement !== suggestions) return;
    event.preventDefault();
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    field.blur();
  });
}

function toggleSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
