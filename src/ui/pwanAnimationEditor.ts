import type { ProjectState, PwanAnimationOverride, PwanOverrideSide, PwanPaletteSource } from "../pokeweb/projectStore";
import {
  buildPwanOverrideAsync,
  buildPwanOverrideSideAsync,
  ensurePwanAnimationState,
  ensurePwanOverrideBackNcecY,
  ensurePwanOverrideSideVisibleHeight,
  findPwanOverrideForSpecies,
  formatPwanFrameScale,
  getPwanRuntimeStatus,
  listPwanSpeciesTargets,
  normalizePwanFrameScale,
  normalizePwanFrameScaleMode,
  normalizePwanOffset,
  normalizePwanOutlineThreshold,
  pwanAssetIndex,
  pwanAssetPath,
  removePwanOverride,
  resolvePwanSpeciesTarget,
  upsertPwanOverride,
  upsertPwanOverrideSide,
  PWAN_FRAME_SCALE_STEP,
  PWAN_MAX_FRAME_SCALE,
  PWAN_MAX_OUTLINE_THRESHOLD,
  PWAN_MAX_OFFSET,
  PWAN_MIN_FRAME_SCALE,
  PWAN_MIN_OUTLINE_THRESHOLD,
  PWAN_MIN_OFFSET,
  type PwanFrameScaleMode,
  type PwanSide,
} from "../pokeweb/pwanAnimationModel";
import {
  importPwanLibraryEntry,
  listLoadedPwanLibraryEntries,
  loadPwanLibrary,
  type LoadedPwanLibrary,
  type PwanLibraryEntry,
} from "../pokeweb/pwanLibraryModel";
import {
  PWAN_HEIGHT,
  PWAN_WIDTH,
  parsePwanHeader,
  pwanFramePixels,
  pwanFramesPerSecond,
  pwanTimeline,
  pwanToGifBytes,
  replacePwanFramePixels,
  replacePwanFramesPixels,
  scalePwanFrames,
  scalePwanTimelineToFps,
  shiftPwanFrames,
} from "../pokeweb/pwanCompiler";
import {
  getPokemonAnimation,
  getPokemonMultiCellAnimation,
  getPokemonMultiCells,
  getPokemonSpriteImage,
  getRigCells,
  pokemonAnimationPlayerStateAtTick,
  pokemonAnimationSequenceTotalTicks,
  resolvePokemonSpriteId,
  type PokemonAnimation,
  type PokemonAnimationFrame,
  type PokemonAnimationSide,
  type PokemonMultiCell,
  type PokemonMultiCellNode,
  type PokemonSpriteVariant,
  type RigCell,
  type RigCellsFile,
  type RgbaImageData,
} from "../pokeweb/pokemonSpriteModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import { formatBytes, escapeHtml } from "./dom";

type PwanAnimationEditorOptions = {
  onDirty?: () => void;
  onRefresh?: () => void;
  activeSpeciesId?: number;
  onNavigateSpecies?: (speciesId: number) => void;
  onBack?: () => void;
};

type PwanImportFormOptions = PwanAnimationEditorOptions & {
  title?: string;
  defaultSpeciesId?: number;
  defaultPaletteSource?: PwanPaletteSource;
  showImportStatus?: boolean;
  showPaletteField?: boolean;
  showSpeciesField?: boolean;
  submitLabel?: string;
  workingLabel?: string;
};

const pwanGifPreviewUrls = new WeakMap<HTMLImageElement, string>();
const pwanOverlaySettings: { enabled: boolean; speciesId?: number } = { enabled: false };
const pwanLibraryUiState: {
  status: "idle" | "loading" | "ready" | "error";
  library?: LoadedPwanLibrary;
  selectedEntryId?: string;
  message?: string;
  messageError?: boolean;
  importing?: boolean;
} = { status: "idle" };
const PWAN_OVERLAY_ALPHA = 0.45;

export function renderPwanAnimationEditor(project: ProjectState, root: HTMLElement, options: PwanAnimationEditorOptions = {}): void {
  const state = ensurePwanAnimationState(project);
  const status = getPwanRuntimeStatus(project);
  const speciesOptions = renderSpeciesOptions(project);
  const activeSpeciesId = normalizeSpeciesId(project, options.activeSpeciesId);
  root.innerHTML = `
    <section class="pwan-page ${activeSpeciesId === undefined ? "" : "-species"}">
      <div class="pwan-toolbar">
        <div>
          <h1>Animated Sprites</h1>
          <div class="pwan-subtitle">${
            activeSpeciesId === undefined
              ? project.session.baseVersion === "B2"
                ? "PWAN GIF overrides for stock US Black 2"
                : "PWAN GIF overrides for stock US White 2"
              : `#${activeSpeciesId} ${escapeHtml(speciesLabel(project, activeSpeciesId))}`
          }</div>
        </div>
      </div>

      ${
        status.supported && status.installed
          ? activeSpeciesId === undefined
            ? renderEditorForm(project, speciesOptions)
            : renderSpeciesEditor(project, activeSpeciesId)
          : `<div class="pwan-warning">${escapeHtml(status.message)}</div>`
      }

      ${
        activeSpeciesId === undefined
          ? `<div class="pwan-overrides">
              <div class="pwan-section-title">
                <h2>Overrides</h2>
                <span>${state.overrides.length} active</span>
              </div>
              ${state.overrides.length === 0 ? `<div class="pwan-empty">No animated species overrides saved yet.</div>` : state.overrides.map((override) => renderOverride(project, override)).join("")}
            </div>`
          : ""
      }
    </section>
  `;

  if (activeSpeciesId === undefined) installGlobalPwanEvents(project, root, options);
  else installSpeciesPwanEvents(project, root, activeSpeciesId, options);
}

function renderSpeciesEditor(project: ProjectState, speciesId: number): string {
  const override = findPwanOverrideForSpecies(project, speciesId);
  if (override?.front) ensurePwanOverrideSideVisibleHeight(override.front);
  if (override?.back) ensurePwanOverrideBackNcecY(override);
  return `
    <div class="pwan-species-layout">
      <aside class="pwan-species-sidebar">
        <button class="btn -default pwan-back-button" id="pwan-back-to-pokemon" type="button">Pokemon</button>
        <div class="pwan-panel pwan-species-picker">
          <label>
            <span>Pokemon</span>
            <select id="pwan-species-select">
              ${renderSpeciesSelectOptions(project, speciesId)}
            </select>
          </label>
          ${renderSpeciesSideSummary(override)}
          ${renderOverlayControls(project)}
          ${renderDetectedArchiveSummary(project)}
        </div>
        ${renderPwanLibraryPanel(project)}
      </aside>
      <main class="pwan-species-main">
        <div class="pwan-species-header">
          <div>
            <h2>#${speciesId} ${escapeHtml(speciesLabel(project, speciesId))}</h2>
            <span>${override ? renderSideBadges(override) : "No PWAN sides imported"}</span>
          </div>
        </div>
        <div class="pwan-side-grid">
          ${renderSpeciesSidePanel(project, speciesId, "front", override?.front)}
          ${renderSpeciesSidePanel(project, speciesId, "back", override?.back)}
        </div>
      </main>
    </div>
  `;
}

function installGlobalPwanEvents(project: ProjectState, root: HTMLElement, options: PwanAnimationEditorOptions): void {
  installPwanImportFormEvents(project, root, options);

  root.querySelectorAll<HTMLButtonElement>("[data-pwan-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const speciesId = Number(button.dataset.pwanRemove);
      removePwanOverride(project, speciesId);
      options.onDirty?.();
      options.onRefresh?.();
    });
  });
}

export function renderPwanImportPanel(project: ProjectState, options: PwanImportFormOptions = {}): string {
  return renderPwanImportForm(project, renderSpeciesOptions(project), options);
}

export function installPwanImportFormEvents(project: ProjectState, root: HTMLElement, options: PwanImportFormOptions = {}): void {
  const submitLabel = options.submitLabel ?? "Save Override";
  const workingLabel = options.workingLabel ?? "Compiling...";
  installPwanGifPreview(root.querySelector<HTMLInputElement>("#pwan-front-gif"), root.querySelector<HTMLImageElement>("#pwan-front-gif-preview"));
  installPwanGifPreview(root.querySelector<HTMLInputElement>("#pwan-back-gif"), root.querySelector<HTMLImageElement>("#pwan-back-gif-preview"));
  root.querySelector<HTMLButtonElement>("#pwan-save-override")?.addEventListener("click", async () => {
    const button = root.querySelector<HTMLButtonElement>("#pwan-save-override");
    const message = root.querySelector<HTMLElement>("#pwan-form-status");
    try {
      if (button) {
        button.disabled = true;
        button.textContent = workingLabel;
      }
      setStatus(message, "Compiling GIFs...");
      const speciesId = Number(root.querySelector<HTMLInputElement>("#pwan-species-id")?.value ?? 0);
      const frontFile = root.querySelector<HTMLInputElement>("#pwan-front-gif")?.files?.[0];
      const backFile = root.querySelector<HTMLInputElement>("#pwan-back-gif")?.files?.[0];
      const paletteSource = root.querySelector<HTMLInputElement | HTMLSelectElement>("#pwan-palette-source")?.value;
      const nativePaletteSource = (paletteSource ?? "back") as PwanPaletteSource;
      if (!frontFile || !backFile) throw new Error("Choose both a front GIF and a back GIF before saving an override.");
      const target = resolvePwanSpeciesTarget(project, speciesId);
      const override = await buildPwanOverrideAsync({
        speciesId: target.speciesId,
        formIndex: target.formIndex,
        assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
        frontFileName: frontFile.name,
        frontGifBytes: new Uint8Array(await frontFile.arrayBuffer()),
        backFileName: backFile.name,
        backGifBytes: new Uint8Array(await backFile.arrayBuffer()),
        nativePaletteSource,
      });
      upsertPwanOverride(project, override);
      options.onDirty?.();
      setStatus(message, `Saved ${speciesLabel(project, speciesId)}. Export will stage PWAN assets and patch native carriers.`);
      options.onRefresh?.();
    } catch (error) {
      setStatus(message, error instanceof Error ? error.message : String(error), true);
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = submitLabel;
      }
    }
  });
}

function installPwanGifPreview(input: HTMLInputElement | null, preview: HTMLImageElement | null): void {
  if (!input || !preview) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) {
      clearPwanGifPreview(preview);
      return;
    }
    setPwanGifPreview(preview, file);
  });
}

function setPwanGifPreview(preview: HTMLImageElement | null, file: File): void {
  if (!preview) return;
  const previousUrl = pwanGifPreviewUrls.get(preview);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  const url = URL.createObjectURL(file);
  pwanGifPreviewUrls.set(preview, url);
  preview.src = url;
  preview.alt = `${file.name} preview`;
  preview.hidden = false;
}

function clearPwanGifPreview(preview: HTMLImageElement | null): void {
  if (!preview) return;
  const previousUrl = pwanGifPreviewUrls.get(preview);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  preview.hidden = true;
  preview.removeAttribute("src");
  pwanGifPreviewUrls.delete(preview);
}

function installPwanLivePreviews(project: ProjectState, root: HTMLElement, speciesId: number, options: PwanAnimationEditorOptions): void {
  const override = findPwanOverrideForSpecies(project, speciesId);
  if (!override) return;
  for (const side of ["front", "back"] as const) {
    const canvas = root.querySelector<HTMLCanvasElement>(`canvas[data-pwan-preview='${side}']`);
    const data = override[side];
    if (canvas && data) startPwanPreview(project, speciesId, side, canvas, data, options);
  }
}

type PwanPreviewFrame = {
  image: HTMLCanvasElement;
  frameIndex: number;
  ticks: number;
};

type PwanComparisonOverlay =
  | {
      kind: "pwan";
      frames: PwanPreviewFrame[];
      totalTicks: number;
    }
  | {
      kind: "native";
      preview: NativePokemonAnimationPreview;
    };

type NativePokemonAnimationPreview = {
  spriteId: number;
  side: PokemonAnimationSide;
  animation: PokemonAnimation;
  multiCellAnimation?: PokemonAnimation;
  multiCells: PokemonMultiCell[];
  rigCells: RigCellsFile;
  rig: HTMLCanvasElement;
  totalTicks: number;
};

type PwanSideDraft = {
  base: PwanOverrideSide;
  side: PwanOverrideSide;
  framesPerSecond: number;
  scale: number;
  scaleMode: PwanFrameScaleMode;
  outlineThreshold: number;
  offsetX: number;
  offsetY: number;
  pixelDirty: boolean;
  dirty: boolean;
};

type PwanPixelTool = "pick" | "draw" | "erase" | "lasso";
type PwanPixelPoint = { x: number; y: number };
type PwanPixelEditorState = {
  tool: PwanPixelTool;
  colorIndex: number;
  lassoFromIndex: number;
  lassoToIndex: number;
  lassoPoints: PwanPixelPoint[];
  lassoDraftPoints: PwanPixelPoint[];
  drawingLasso: boolean;
};

function startPwanPreview(project: ProjectState, speciesId: number, previewSide: PwanSide, canvas: HTMLCanvasElement, side: PwanOverrideSide, options: PwanAnimationEditorOptions): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const panel = canvas.closest<HTMLElement>("[data-pwan-side-panel]");
  const draft: PwanSideDraft = {
    base: clonePwanSide(side),
    side: clonePwanSide(side),
    framesPerSecond: normalizePwanFps(side.framesPerSecond ?? pwanFramesPerSecond(side.pwanBytes)),
    scale: normalizePwanFrameScale(side.scale ?? 1),
    scaleMode: normalizePwanFrameScaleMode(side.scaleMode),
    outlineThreshold: normalizePwanOutlineThreshold(side.outlineThreshold ?? 48),
    offsetX: normalizePwanOffset(side.offsetX ?? 0),
    offsetY: normalizePwanOffset(side.offsetY ?? 0),
    pixelDirty: false,
    dirty: false,
  };
  const pixelEditor: PwanPixelEditorState = {
    tool: "pick",
    colorIndex: firstVisiblePaletteIndex(side.paletteBgr555),
    lassoFromIndex: firstVisiblePaletteIndex(side.paletteBgr555),
    lassoToIndex: firstVisiblePaletteIndex(side.paletteBgr555),
    lassoPoints: [],
    lassoDraftPoints: [],
    drawingLasso: false,
  };
  let frames = buildPwanPreviewFrames(draft.side);
  let frameIndex = 0;
  let playbackTick = 0;
  let playing = frames.length > 1;
  let playbackTimer: number | undefined;
  const overlay = buildComparisonOverlay(project, previewSide);
  const range = panel?.querySelector<HTMLInputElement>(`[data-pwan-frame-slider='${previewSide}']`) ?? undefined;
  const frameLabel = panel?.querySelector<HTMLElement>(`[data-pwan-frame-label='${previewSide}']`) ?? undefined;
  const playButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-play='${previewSide}']`) ?? undefined;
  const fpsInput = panel?.querySelector<HTMLInputElement>(`[data-pwan-fps='${previewSide}']`) ?? undefined;
  const scaleLabel = panel?.querySelector<HTMLElement>(`[data-pwan-scale-label='${previewSide}']`) ?? undefined;
  const outlineThresholdInput = panel?.querySelector<HTMLInputElement>(`[data-pwan-outline-threshold='${previewSide}']`) ?? undefined;
  const outlineThresholdLabel = panel?.querySelector<HTMLElement>(`[data-pwan-outline-threshold-label='${previewSide}']`) ?? undefined;
  const outlineThresholdField = panel?.querySelector<HTMLElement>(`[data-pwan-outline-threshold-field='${previewSide}']`) ?? undefined;
  const offsetXLabel = panel?.querySelector<HTMLElement>(`[data-pwan-offset-x-label='${previewSide}']`) ?? undefined;
  const offsetYLabel = panel?.querySelector<HTMLElement>(`[data-pwan-offset-y-label='${previewSide}']`) ?? undefined;
  const applyButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-apply='${previewSide}']`) ?? undefined;
  const gifButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-download-gif='${previewSide}']`) ?? undefined;
  const pngButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-download-png='${previewSide}']`) ?? undefined;
  const status = panel?.querySelector<HTMLElement>(`#pwan-${previewSide}-status`) ?? undefined;
  const pixelSelectedSwatch = panel?.querySelector<HTMLElement>(`[data-pwan-pixel-selected='${previewSide}']`) ?? undefined;
  const pixelSelectedLabel = panel?.querySelector<HTMLElement>(`[data-pwan-pixel-selected-label='${previewSide}']`) ?? undefined;
  const pixelPositionLabel = panel?.querySelector<HTMLElement>(`[data-pwan-pixel-position='${previewSide}']`) ?? undefined;
  const lassoFromSelect = panel?.querySelector<HTMLSelectElement>(`[data-pwan-lasso-from='${previewSide}']`) ?? undefined;
  const lassoToSelect = panel?.querySelector<HTMLSelectElement>(`[data-pwan-lasso-to='${previewSide}']`) ?? undefined;
  const lassoApplyButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-lasso-apply='${previewSide}']`) ?? undefined;
  const lassoClearButton = panel?.querySelector<HTMLButtonElement>(`[data-pwan-lasso-clear='${previewSide}']`) ?? undefined;

  const stopPlayback = () => {
    if (playbackTimer !== undefined) window.clearTimeout(playbackTimer);
    playbackTimer = undefined;
  };
  const schedulePlayback = () => {
    stopPlayback();
    if (!playing || frames.length <= 1 || !canvas.isConnected) return;
    const currentTicks = Math.max(1, frames[frameIndex]?.ticks ?? 1);
    playbackTimer = window.setTimeout(() => {
      playbackTick += currentTicks;
      frameIndex = pwanPreviewFrameIndexAtTick(frames, playbackTick);
      draw();
      syncControls();
      schedulePlayback();
    }, currentTicks * 1000 / 60);
  };
  const draw = () => {
    if (frames.length === 0) return;
    frameIndex = clampFrameIndex(frameIndex, frames.length);
    const frame = frames[frameIndex]!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame.image, 0, 0, canvas.width, canvas.height);
    drawComparisonOverlay(ctx, overlay, playbackTick);
    drawPwanPixelEditorOverlay(ctx, pixelEditor);
  };
  const syncControls = () => {
    const disabled = frames.length === 0;
    if (range) {
      range.disabled = disabled || frames.length <= 1;
      range.max = String(Math.max(0, frames.length - 1));
      range.value = String(clampFrameIndex(frameIndex, frames.length));
    }
    if (frameLabel) {
      const frame = frames[clampFrameIndex(frameIndex, frames.length)];
      frameLabel.textContent = frames.length ? `${frameIndex + 1} / ${frames.length}${frame ? ` · source ${frame.frameIndex}` : ""}` : "No frames";
    }
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-step='${previewSide}']`).forEach((button) => {
      button.disabled = disabled || frames.length <= 1;
    });
    if (playButton) {
      playButton.disabled = disabled || frames.length <= 1;
      playButton.title = playing ? "Pause" : "Play";
      playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
      const icon = playButton.querySelector<HTMLElement>(".animation-icon");
      icon?.classList.toggle("-play", !playing);
      icon?.classList.toggle("-pause", playing);
    }
    if (fpsInput && document.activeElement !== fpsInput) fpsInput.value = formatPwanFps(draft.framesPerSecond);
    const frameScale = normalizePwanFrameScale(draft.scale);
    if (scaleLabel) scaleLabel.textContent = formatPwanFrameScale(frameScale);
    const scaleMode = normalizePwanFrameScaleMode(draft.scaleMode);
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-scale-mode-option='${previewSide}']`).forEach((button) => {
      const selected = normalizePwanFrameScaleMode(button.dataset.pwanScaleMode) === scaleMode;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = disabled;
    });
    const outlineThreshold = normalizePwanOutlineThreshold(draft.outlineThreshold);
    if (outlineThresholdInput && document.activeElement !== outlineThresholdInput) outlineThresholdInput.value = String(outlineThreshold);
    if (outlineThresholdLabel) outlineThresholdLabel.textContent = String(outlineThreshold);
    if (outlineThresholdField) {
      const visible = scaleMode === "outlineFill";
      outlineThresholdField.classList.toggle("-hidden", !visible);
      outlineThresholdField.setAttribute("aria-hidden", String(!visible));
      if (outlineThresholdInput) outlineThresholdInput.disabled = disabled || !visible;
    }
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-scale-nudge='${previewSide}']`).forEach((button) => {
      const delta = Number(button.dataset.pwanScaleDelta ?? 0);
      button.disabled = disabled || (delta < 0 ? frameScale <= PWAN_MIN_FRAME_SCALE : frameScale >= PWAN_MAX_FRAME_SCALE);
    });
    const offsetX = normalizePwanOffset(draft.offsetX);
    const offsetY = normalizePwanOffset(draft.offsetY);
    if (offsetXLabel) offsetXLabel.textContent = `${offsetX}px`;
    if (offsetYLabel) offsetYLabel.textContent = `${offsetY}px`;
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-offset-nudge='${previewSide}']`).forEach((button) => {
      const axis = button.dataset.pwanOffsetAxis === "y" ? "y" : "x";
      const delta = Number(button.dataset.pwanOffsetDelta ?? 0);
      const value = axis === "x" ? offsetX : offsetY;
      button.disabled = disabled || (delta < 0 ? value <= PWAN_MIN_OFFSET : value >= PWAN_MAX_OFFSET);
    });
    if (applyButton) {
      applyButton.disabled = !draft.dirty;
      applyButton.textContent = draft.dirty ? "Apply" : "Applied";
    }
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-pixel-tool='${previewSide}']`).forEach((button) => {
      const selected = button.dataset.pwanPixelToolName === pixelEditor.tool;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = disabled;
    });
    panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-pixel-color='${previewSide}']`).forEach((button) => {
      const index = Number(button.dataset.pwanPixelColorIndex ?? 0);
      const selected = index === pixelEditor.colorIndex;
      button.classList.toggle("-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = disabled;
    });
    if (pixelSelectedSwatch) {
      pixelSelectedSwatch.style.background = pwanPaletteSwatchBackground(draft.side.paletteBgr555[pixelEditor.colorIndex] ?? 0, pixelEditor.colorIndex);
      pixelSelectedSwatch.classList.toggle("-transparent", pixelEditor.colorIndex === 0);
    }
    if (pixelSelectedLabel) pixelSelectedLabel.textContent = pwanPaletteColorLabel(draft.side.paletteBgr555, pixelEditor.colorIndex);
    if (lassoFromSelect && document.activeElement !== lassoFromSelect) lassoFromSelect.value = String(pixelEditor.lassoFromIndex);
    if (lassoToSelect && document.activeElement !== lassoToSelect) lassoToSelect.value = String(pixelEditor.lassoToIndex);
    if (lassoApplyButton) lassoApplyButton.disabled = disabled || pixelEditor.lassoPoints.length < 3 || pixelEditor.lassoFromIndex === pixelEditor.lassoToIndex;
    if (lassoClearButton) lassoClearButton.disabled = disabled || (pixelEditor.lassoPoints.length === 0 && pixelEditor.lassoDraftPoints.length === 0);
    canvas.classList.toggle("-pixel-tool", !disabled && pixelEditor.tool !== "pick");
    canvas.classList.toggle("-lasso-tool", !disabled && pixelEditor.tool === "lasso");
  };
  const reloadFrames = () => {
    frames = buildPwanPreviewFrames(draft.side);
    frameIndex = clampFrameIndex(frameIndex, frames.length);
    playbackTick = pwanPreviewFrameStartTick(frames, frameIndex);
  };
  const rebuildDraft = () => {
    const baseBytes = draft.base.scaleBasePwanBytes ?? draft.base.offsetBasePwanBytes ?? draft.base.pwanBytes;
    const timed = scalePwanTimelineToFps(baseBytes, draft.framesPerSecond);
    const frameScale = normalizePwanFrameScale(draft.scale);
    const scaleMode = normalizePwanFrameScaleMode(draft.scaleMode);
    const outlineThreshold = normalizePwanOutlineThreshold(draft.outlineThreshold);
    const scaled = scalePwanFrames(timed.pwanBytes, frameScale, { mode: scaleMode, outlineThreshold });
    const shifted = shiftPwanFrames(scaled.pwanBytes, draft.offsetX, draft.offsetY);
    draft.side = {
      ...draft.base,
      pwanBytes: shifted.pwanBytes,
      scaleBasePwanBytes: frameScale === 1 && !draft.base.scaleBasePwanBytes ? undefined : timed.pwanBytes,
      offsetBasePwanBytes: draft.offsetX === 0 && draft.offsetY === 0 && frameScale === 1 ? undefined : scaled.pwanBytes,
      visibleHeight: shifted.visibleHeight,
      totalTicks: timed.totalTicks,
      framesPerSecond: timed.framesPerSecond,
      speedScale: draft.base.framesPerSecond ? timed.framesPerSecond / draft.base.framesPerSecond : draft.base.speedScale,
      scale: frameScale,
      scaleMode,
      outlineThreshold,
      offsetX: draft.offsetX,
      offsetY: draft.offsetY,
    };
    draft.dirty = draft.pixelDirty || !pwanDraftMatchesBase(draft);
    reloadFrames();
    draw();
    syncControls();
    if (playing) schedulePlayback();
  };
  const updateDraftFromInputs = () => {
    draft.framesPerSecond = normalizePwanFps(Number(fpsInput?.value ?? draft.framesPerSecond));
    rebuildDraft();
  };
  const setPixelBaseline = (pwanBytes: Uint8Array, visibleHeight: number) => {
    draft.side = {
      ...draft.side,
      pwanBytes,
      visibleHeight,
      scaleBasePwanBytes: undefined,
      offsetBasePwanBytes: undefined,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };
    draft.base = clonePwanSide(draft.side);
    draft.scale = 1;
    draft.offsetX = 0;
    draft.offsetY = 0;
    draft.pixelDirty = true;
    draft.dirty = true;
    reloadFrames();
    draw();
    syncControls();
  };
  const editCurrentFramePixel = (point: PwanPixelPoint, colorIndex: number): boolean => {
    const frame = frames[clampFrameIndex(frameIndex, frames.length)];
    if (!frame) return false;
    const pixels = pwanFramePixels(draft.side.pwanBytes, frame.frameIndex);
    const row = pixels[point.y];
    if (!row || row[point.x] === colorIndex) return false;
    row[point.x] = colorIndex;
    const replaced = replacePwanFramePixels(draft.side.pwanBytes, frame.frameIndex, pixels);
    setPixelBaseline(replaced.pwanBytes, replaced.visibleHeight);
    return true;
  };
  const sampleCurrentFramePixel = (point: PwanPixelPoint): number => {
    const frame = frames[clampFrameIndex(frameIndex, frames.length)];
    if (!frame) return 0;
    return pwanFramePixels(draft.side.pwanBytes, frame.frameIndex)[point.y]?.[point.x] ?? 0;
  };
  const selectPixelColor = (colorIndex: number) => {
    pixelEditor.colorIndex = clampPaletteIndex(colorIndex);
    pixelEditor.lassoFromIndex = pixelEditor.colorIndex;
    syncControls();
  };
  const setPixelPosition = (point: PwanPixelPoint | undefined) => {
    if (pixelPositionLabel) pixelPositionLabel.textContent = point ? `${point.x}, ${point.y}` : "--, --";
  };
  const clearLasso = () => {
    pixelEditor.lassoPoints = [];
    pixelEditor.lassoDraftPoints = [];
    pixelEditor.drawingLasso = false;
    draw();
    syncControls();
  };
  const applyLassoReplace = () => {
    if (pixelEditor.lassoPoints.length < 3 || pixelEditor.lassoFromIndex === pixelEditor.lassoToIndex) return;
    const header = parsePwanHeader(draft.side.pwanBytes);
    const edits: Array<{ frameIndex: number; pixels: number[][] }> = [];
    let changedPixels = 0;
    for (let uniqueFrameIndex = 0; uniqueFrameIndex < header.frameCount; uniqueFrameIndex += 1) {
      const pixels = pwanFramePixels(draft.side.pwanBytes, uniqueFrameIndex);
      let changed = false;
      for (let y = 0; y < PWAN_HEIGHT; y += 1) {
        for (let x = 0; x < PWAN_WIDTH; x += 1) {
          if (!pointInPolygon({ x: x + 0.5, y: y + 0.5 }, pixelEditor.lassoPoints)) continue;
          if ((pixels[y]?.[x] ?? 0) !== pixelEditor.lassoFromIndex) continue;
          pixels[y]![x] = pixelEditor.lassoToIndex;
          changed = true;
          changedPixels += 1;
        }
      }
      if (changed) edits.push({ frameIndex: uniqueFrameIndex, pixels });
    }
    if (edits.length === 0) {
      setStatus(status, `No ${pwanPaletteColorLabel(draft.side.paletteBgr555, pixelEditor.lassoFromIndex)} pixels inside lasso.`);
      return;
    }
    const replaced = replacePwanFramesPixels(draft.side.pwanBytes, edits);
    setPixelBaseline(replaced.pwanBytes, replaced.visibleHeight);
    setStatus(status, `Replaced ${changedPixels} pixels in ${edits.length} source frame${edits.length === 1 ? "" : "s"}.`);
  };
  let paintingPixel = false;
  const paintAtEvent = (event: PointerEvent): void => {
    const point = pwanCanvasEventPoint(canvas, event);
    setPixelPosition(point);
    if (!point) return;
    const colorIndex = pixelEditor.tool === "erase" ? 0 : pixelEditor.colorIndex;
    if (editCurrentFramePixel(point, colorIndex)) setStatus(status, `${pixelEditor.tool === "erase" ? "Erased" : "Drew"} pixel ${point.x}, ${point.y}.`);
  };
  const addLassoEventPoint = (event: PointerEvent): void => {
    const point = pwanCanvasEventPoint(canvas, event);
    setPixelPosition(point);
    if (!point) return;
    const points = pixelEditor.lassoDraftPoints;
    const previous = points[points.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      points.push(point);
      draw();
      syncControls();
    }
  };

  range?.addEventListener("input", (event) => {
    playing = false;
    stopPlayback();
    frameIndex = clampFrameIndex(Number((event.currentTarget as HTMLInputElement).value), frames.length);
    playbackTick = pwanPreviewFrameStartTick(frames, frameIndex);
    draw();
    syncControls();
  });
  playButton?.addEventListener("click", () => {
    playing = !playing;
    syncControls();
    if (playing) schedulePlayback();
    else stopPlayback();
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-step='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      playing = false;
      stopPlayback();
      const direction = button.dataset.pwanStepDirection === "prev" ? -1 : 1;
      frameIndex = wrapFrameIndex(frameIndex + direction, frames.length);
      playbackTick = pwanPreviewFrameStartTick(frames, frameIndex);
      draw();
      syncControls();
    });
  });
  fpsInput?.addEventListener("change", () => {
    updateDraftFromInputs();
    setStatus(status, `Previewing ${formatPwanFps(draft.framesPerSecond)} FPS. Apply to save.`);
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-scale-nudge='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      const delta = Number(button.dataset.pwanScaleDelta ?? 0);
      draft.scale = normalizePwanFrameScale(draft.scale + delta);
      rebuildDraft();
      setStatus(status, `Previewing scale ${formatPwanFrameScale(draft.scale)}. Apply to save.`);
    });
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-scale-mode-option='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      draft.scaleMode = normalizePwanFrameScaleMode(button.dataset.pwanScaleMode);
      rebuildDraft();
      setStatus(status, `Previewing ${draft.scaleMode === "outlineFill" ? "Outline Fill" : "Nearest"} scaling. Apply to save.`);
    });
  });
  outlineThresholdInput?.addEventListener("input", () => {
    draft.outlineThreshold = normalizePwanOutlineThreshold(Number(outlineThresholdInput.value));
    rebuildDraft();
    setStatus(status, `Previewing dark-line threshold ${draft.outlineThreshold}. Apply to save.`);
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-offset-nudge='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      const axis = button.dataset.pwanOffsetAxis === "y" ? "y" : "x";
      const delta = Number(button.dataset.pwanOffsetDelta ?? 0);
      if (axis === "x") draft.offsetX = normalizePwanOffset(draft.offsetX + delta);
      else draft.offsetY = normalizePwanOffset(draft.offsetY + delta);
      rebuildDraft();
      setStatus(status, `Previewing offset ${draft.offsetX}, ${draft.offsetY}. Apply to save.`);
    });
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-pixel-tool='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      const tool = readPwanPixelTool(button.dataset.pwanPixelToolName);
      pixelEditor.tool = tool;
      syncControls();
      draw();
      setStatus(status, `${pwanPixelToolLabel(tool)} tool selected.`);
    });
  });
  panel?.querySelectorAll<HTMLButtonElement>(`[data-pwan-pixel-color='${previewSide}']`).forEach((button) => {
    button.addEventListener("click", () => {
      selectPixelColor(Number(button.dataset.pwanPixelColorIndex ?? 0));
      pixelEditor.tool = "draw";
      syncControls();
      setStatus(status, `Selected ${pwanPaletteColorLabel(draft.side.paletteBgr555, pixelEditor.colorIndex)}.`);
    });
  });
  lassoFromSelect?.addEventListener("change", () => {
    pixelEditor.lassoFromIndex = clampPaletteIndex(Number(lassoFromSelect.value));
    syncControls();
  });
  lassoToSelect?.addEventListener("change", () => {
    pixelEditor.lassoToIndex = clampPaletteIndex(Number(lassoToSelect.value));
    syncControls();
  });
  lassoApplyButton?.addEventListener("click", applyLassoReplace);
  lassoClearButton?.addEventListener("click", () => {
    clearLasso();
    setStatus(status, "Cleared lasso.");
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = pwanCanvasEventPoint(canvas, event);
    if (!point) return;
    playing = false;
    stopPlayback();
    canvas.setPointerCapture(event.pointerId);
    if (pixelEditor.tool === "pick") {
      selectPixelColor(sampleCurrentFramePixel(point));
      setPixelPosition(point);
      setStatus(status, `Picked ${pwanPaletteColorLabel(draft.side.paletteBgr555, pixelEditor.colorIndex)} at ${point.x}, ${point.y}.`);
    } else if (pixelEditor.tool === "lasso") {
      pixelEditor.drawingLasso = true;
      pixelEditor.lassoPoints = [];
      pixelEditor.lassoDraftPoints = [point];
      setPixelPosition(point);
      draw();
      syncControls();
    } else {
      paintingPixel = true;
      paintAtEvent(event);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pixelEditor.drawingLasso) {
      addLassoEventPoint(event);
      return;
    }
    if (paintingPixel) {
      paintAtEvent(event);
      return;
    }
    setPixelPosition(pwanCanvasEventPoint(canvas, event));
  });
  canvas.addEventListener("pointerup", (event) => {
    if (paintingPixel) {
      paintingPixel = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    if (pixelEditor.drawingLasso) {
      addLassoEventPoint(event);
      pixelEditor.drawingLasso = false;
      pixelEditor.lassoPoints = simplifyLassoPoints(pixelEditor.lassoDraftPoints);
      pixelEditor.lassoDraftPoints = [];
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      draw();
      syncControls();
      setStatus(status, pixelEditor.lassoPoints.length >= 3 ? `Lasso selected ${pixelEditor.lassoPoints.length} points.` : "Lasso needs at least 3 points.");
    }
  });
  canvas.addEventListener("pointercancel", (event) => {
    paintingPixel = false;
    pixelEditor.drawingLasso = false;
    pixelEditor.lassoDraftPoints = [];
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    draw();
    syncControls();
  });
  canvas.addEventListener("pointerleave", () => {
    if (!paintingPixel && !pixelEditor.drawingLasso) setPixelPosition(undefined);
  });
  applyButton?.addEventListener("click", () => {
    if (!draft.dirty) return;
    const target = resolvePwanSpeciesTarget(project, speciesId);
    upsertPwanOverrideSide(project, {
      speciesId: target.speciesId,
      formIndex: target.formIndex,
      assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
      side: previewSide,
      sideData: clonePwanSide(draft.side),
      nativePaletteSource: previewSide,
    });
    draft.base = clonePwanSide(draft.side);
    draft.pixelDirty = false;
    draft.dirty = false;
    syncControls();
    options.onDirty?.();
    setStatus(status, `Applied ${previewSide} PWAN edits.`);
  });
  gifButton?.addEventListener("click", () => {
    const gifBytes = pwanToGifBytes(draft.side.pwanBytes);
    downloadBytes(gifBytes, "image/gif", `${pwanDownloadBaseName(project, speciesId, previewSide)}.gif`);
    setStatus(status, `Exported edited ${previewSide} GIF.`);
  });
  pngButton?.addEventListener("click", async () => {
    const frame = frames[clampFrameIndex(frameIndex, frames.length)];
    if (!frame) return;
    const frameCanvas = pwanFrameCanvas(draft.side, frame.frameIndex);
    const blob = await canvasBlob(frameCanvas, "image/png");
    downloadBlob(blob, `${pwanDownloadBaseName(project, speciesId, previewSide)}-frame-${String(frameIndex + 1).padStart(3, "0")}.png`);
    setStatus(status, `Exported ${previewSide} frame ${frameIndex + 1} PNG.`);
  });

  draw();
  syncControls();
  schedulePlayback();
}

function buildPwanPreviewFrames(side: PwanOverrideSide): PwanPreviewFrame[] {
  return pwanTimeline(side.pwanBytes).map((entry) => ({
    image: pwanFrameCanvas(side, entry.frameIndex),
    frameIndex: entry.frameIndex,
    ticks: Math.max(1, entry.ticks),
  }));
}

function buildComparisonOverlay(project: ProjectState, side: PwanSide): PwanComparisonOverlay | undefined {
  if (!pwanOverlaySettings.enabled || pwanOverlaySettings.speciesId === undefined) return undefined;
  const speciesId = pwanOverlaySettings.speciesId;
  const pwanSide = findPwanOverrideForSpecies(project, speciesId)?.[side];
  if (pwanSide) {
    const frames = buildPwanPreviewFrames(pwanSide);
    if (frames.length > 0) return { kind: "pwan", frames, totalTicks: pwanPreviewTotalTicks(frames) };
  }
  return buildNativePokemonAnimationPreview(project, speciesId, side);
}

function buildNativePokemonAnimationPreview(project: ProjectState, speciesId: number, side: PokemonAnimationSide): PwanComparisonOverlay | undefined {
  try {
    const target = resolvePwanSpeciesTarget(project, speciesId);
    const spriteId = resolvePokemonSpriteId(project, target.speciesId, target.formIndex);
    const animation = getPokemonAnimation(project, spriteId, side);
    const multiCellAnimation = safeGetPokemonMultiCellAnimation(project, spriteId, side);
    const multiCells = getPokemonMultiCells(project, spriteId, side);
    const rigCells = getRigCells(project, spriteId, side);
    const rig = rgbaImageToCanvas(getPokemonSpriteImage(project, spriteId, rigVariantForSide(side), "normal"));
    const totalTicks = nativePokemonAnimationTotalTicks(animation, multiCellAnimation);
    return {
      kind: "native",
      preview: {
        spriteId,
        side,
        animation,
        multiCellAnimation,
        multiCells: multiCells.cells,
        rigCells,
        rig,
        totalTicks,
      },
    };
  } catch {
    return undefined;
  }
}

function drawComparisonOverlay(ctx: CanvasRenderingContext2D, overlay: PwanComparisonOverlay | undefined, tick: number): void {
  if (!overlay) return;
  ctx.save();
  ctx.globalAlpha = PWAN_OVERLAY_ALPHA;
  if (overlay.kind === "pwan") drawPwanComparisonOverlay(ctx, overlay, tick);
  else drawNativePokemonAnimationOverlay(ctx, overlay.preview, tick);
  ctx.restore();
}

function drawPwanComparisonOverlay(ctx: CanvasRenderingContext2D, overlay: Extract<PwanComparisonOverlay, { kind: "pwan" }>, tick: number): void {
  const frame = pwanPreviewFrameAtTick(overlay.frames, tick);
  if (!frame) return;
  ctx.drawImage(frame.image, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawNativePokemonAnimationOverlay(ctx: CanvasRenderingContext2D, preview: NativePokemonAnimationPreview, tick: number): void {
  const localTick = ((Math.round(tick) % preview.totalTicks) + preview.totalTicks) % preview.totalTicks;
  const fallback = preview.multiCells[0];
  const playback = resolveNativeMultiCellPlayback(preview, localTick);
  const multiCell = playback?.multiCell ?? fallback;
  if (!multiCell || preview.animation.sequences.length === 0) return;
  if (playback?.outerFrame) {
    ctx.save();
    applyNativeMultiCellOuterTransform(ctx, playback.outerFrame);
  }
  for (let nodeIndex = multiCell.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = multiCell.nodes[nodeIndex];
    if (!node?.visible) continue;
    drawNativeAnimationNode(ctx, preview, multiCell, node, nativeNodePlaybackTick(node, localTick, playback?.frameStartTick ?? 0));
  }
  if (playback?.outerFrame) ctx.restore();
}

function drawNativeAnimationNode(ctx: CanvasRenderingContext2D, preview: NativePokemonAnimationPreview, _multiCell: PokemonMultiCell, node: PokemonMultiCellNode, tick: number): void {
  const sequence = preview.animation.sequences[node.sequenceNumber];
  const frameState = sequence ? nativeAnimationFrameStateForSequence(sequence, tick) : undefined;
  if (!frameState) return;
  const cell = preview.rigCells.cells[frameState.frame.cellIndex];
  if (!cell) return;
  drawNativeRigCellCanvas(ctx, preview.rig, cell, node.x, node.y, frameState.frame);
}

function drawNativeRigCellCanvas(ctx: CanvasRenderingContext2D, rig: HTMLCanvasElement, cell: RigCell, nodeX: number, nodeY: number, frame: PokemonAnimationFrame): void {
  const scale = pwanCanvasScale(ctx);
  const transform = nativeAnimationTransform(frame);
  const baseX = nodeX + frame.x;
  const baseY = nodeY + frame.y;
  const isIdentity = transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
  ctx.save();
  ctx.translate(pwanCanvasOriginX(ctx), pwanCanvasOriginY(ctx));
  ctx.scale(scale, scale);
  ctx.translate(baseX, baseY);
  if (!isIdentity) ctx.transform(transform.a, transform.c, transform.b, transform.d, 0, 0);
  drawNativeRigCellPartCanvas(ctx, rig, cell);
  if (cell.subCell.width > 0 && cell.subCell.height > 0) drawNativeRigCellPartCanvas(ctx, rig, cell.subCell);
  ctx.restore();
}

function drawNativeRigCellPartCanvas(ctx: CanvasRenderingContext2D, rig: HTMLCanvasElement, cell: RigCell): void {
  if (cell.width <= 0 || cell.height <= 0) return;
  ctx.drawImage(rig, cell.cellX, cell.cellY, cell.width, cell.height, cell.spriteX, -cell.spriteY, cell.width, cell.height);
}

function resolveNativeMultiCellPlayback(
  preview: NativePokemonAnimationPreview,
  tick: number,
): { multiCell: PokemonMultiCell; frameStartTick: number; outerFrame?: PokemonAnimationFrame } | undefined {
  const fallback = preview.multiCells[0];
  if (!fallback) return undefined;
  try {
    const sequence = preview.multiCellAnimation?.sequences[0];
    if (!sequence) return { multiCell: fallback, frameStartTick: 0 };
    const playback = pokemonAnimationPlayerStateAtTick(sequence, tick);
    const frame = sequence.frames[playback.frameIndex];
    return {
      multiCell: preview.multiCells[frame?.cellIndex ?? fallback.index] ?? fallback,
      frameStartTick: playback.frameStartTick,
      outerFrame: frame ? nativeMultiCellOuterFrame(frame) : undefined,
    };
  } catch {
    return { multiCell: fallback, frameStartTick: 0 };
  }
}

function safeGetPokemonMultiCellAnimation(project: ProjectState, spriteId: number, side: PokemonAnimationSide): PokemonAnimation | undefined {
  try {
    return getPokemonMultiCellAnimation(project, spriteId, side);
  } catch {
    return undefined;
  }
}

function nativePokemonAnimationTotalTicks(animation: PokemonAnimation, multiCellAnimation: PokemonAnimation | undefined): number {
  const sequence = multiCellAnimation?.sequences[0];
  if (sequence) return Math.max(1, nativeSequenceTotalTicks(sequence));
  return Math.max(1, nativeSequenceTotalTicks(animation.sequences[0]));
}

function nativeSequenceTotalTicks(sequence: PokemonAnimation["sequences"][number] | undefined): number {
  return Math.max(1, pokemonAnimationSequenceTotalTicks(sequence));
}

function nativeNodePlaybackTick(node: PokemonMultiCellNode, tick: number, frameStartTick: number): number {
  if (node.playMode === 1) return tick;
  if (node.playMode === 2) return 0;
  return Math.max(0, tick - frameStartTick);
}

function nativeAnimationFrameStateForSequence(sequence: PokemonAnimation["sequences"][number], tick: number): { frame: PokemonAnimationFrame; frameIndex: number } | undefined {
  if (sequence.frames.length === 0) return undefined;
  const frameIndex = nativeAnimationPlayerFrameAtTick(sequence, tick);
  const frame = sequence.frames[frameIndex];
  return frame ? { frame, frameIndex } : undefined;
}

function nativeAnimationPlayerFrameAtTick(sequence: PokemonAnimation["sequences"][number], tick: number): number {
  return pokemonAnimationPlayerStateAtTick(sequence, tick).frameIndex;
}

function nativeMultiCellOuterFrame(frame: PokemonAnimationFrame): PokemonAnimationFrame | undefined {
  if (frame.x === 0 && frame.y === 0 && frame.rotation === 0 && frame.xScale === 1 && frame.yScale === 1) return undefined;
  return frame;
}

function applyNativeMultiCellOuterTransform(ctx: CanvasRenderingContext2D, frame: PokemonAnimationFrame): void {
  const scale = pwanCanvasScale(ctx);
  const originX = pwanCanvasOriginX(ctx);
  const originY = pwanCanvasOriginY(ctx);
  ctx.translate(originX + frame.x * scale, originY + frame.y * scale);
  ctx.rotate((frame.rotation * Math.PI) / 180);
  ctx.scale(frame.xScale, frame.yScale);
  ctx.translate(-originX, -originY);
}

type NativeAnimationTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
};

function nativeAnimationTransform(frame: PokemonAnimationFrame): NativeAnimationTransform {
  const rotation = (frame.rotation * Math.PI) / 180;
  if (rotation === 0) {
    return {
      a: frame.xScale,
      b: 0,
      c: 0,
      d: frame.yScale,
    };
  }
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  return {
    a: frame.xScale * cos,
    b: -frame.yScale * sin,
    c: frame.xScale * sin,
    d: frame.yScale * cos,
  };
}

function pwanPreviewTotalTicks(frames: PwanPreviewFrame[]): number {
  return Math.max(1, frames.reduce((sum, frame) => sum + Math.max(1, frame.ticks), 0));
}

function pwanPreviewFrameAtTick(frames: PwanPreviewFrame[], tick: number): PwanPreviewFrame | undefined {
  if (frames.length === 0) return undefined;
  let localTick = ((Math.round(tick) % pwanPreviewTotalTicks(frames)) + pwanPreviewTotalTicks(frames)) % pwanPreviewTotalTicks(frames);
  for (const frame of frames) {
    if (localTick < frame.ticks) return frame;
    localTick -= frame.ticks;
  }
  return frames[frames.length - 1];
}

function pwanPreviewFrameIndexAtTick(frames: PwanPreviewFrame[], tick: number): number {
  const frame = pwanPreviewFrameAtTick(frames, tick);
  return frame ? frames.indexOf(frame) : 0;
}

function pwanPreviewFrameStartTick(frames: PwanPreviewFrame[], frameIndex: number): number {
  return frames.slice(0, clampFrameIndex(frameIndex, frames.length)).reduce((sum, frame) => sum + Math.max(1, frame.ticks), 0);
}

function pwanCanvasScale(ctx: CanvasRenderingContext2D): number {
  return Math.min(ctx.canvas.width / PWAN_WIDTH, ctx.canvas.height / PWAN_HEIGHT);
}

function pwanCanvasOriginX(ctx: CanvasRenderingContext2D): number {
  return ctx.canvas.width / 2;
}

function pwanCanvasOriginY(ctx: CanvasRenderingContext2D): number {
  return ctx.canvas.height;
}

function rigVariantForSide(side: PokemonAnimationSide): PokemonSpriteVariant {
  return { kind: "rig", side, gender: "male" };
}

function rgbaImageToCanvas(image: RgbaImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return canvas;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampFrameIndex(value: number, frameCount: number): number {
  if (frameCount <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(frameCount - 1, Math.round(value)));
}

function wrapFrameIndex(value: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return ((Math.round(value) % frameCount) + frameCount) % frameCount;
}

function clonePwanSide(side: PwanOverrideSide): PwanOverrideSide {
  return {
    ...side,
    sourceGifBytes: side.sourceGifBytes.slice(),
    pwanBytes: side.pwanBytes.slice(),
    scaleBasePwanBytes: side.scaleBasePwanBytes?.slice(),
    offsetBasePwanBytes: side.offsetBasePwanBytes?.slice(),
    paletteBgr555: side.paletteBgr555.slice(),
    notes: side.notes ? [...side.notes] : undefined,
  };
}

function pwanDraftMatchesBase(draft: PwanSideDraft): boolean {
  return (
    normalizePwanOffset(draft.side.offsetX ?? 0) === normalizePwanOffset(draft.base.offsetX ?? 0) &&
    normalizePwanOffset(draft.side.offsetY ?? 0) === normalizePwanOffset(draft.base.offsetY ?? 0) &&
    normalizePwanFrameScale(draft.side.scale ?? 1) === normalizePwanFrameScale(draft.base.scale ?? 1) &&
    normalizePwanFrameScaleMode(draft.side.scaleMode) === normalizePwanFrameScaleMode(draft.base.scaleMode) &&
    normalizePwanOutlineThreshold(draft.side.outlineThreshold ?? 48) === normalizePwanOutlineThreshold(draft.base.outlineThreshold ?? 48) &&
    Math.abs(normalizePwanFps(draft.side.framesPerSecond ?? pwanFramesPerSecond(draft.side.pwanBytes)) - normalizePwanFps(draft.base.framesPerSecond ?? pwanFramesPerSecond(draft.base.pwanBytes))) < 0.05 &&
    bytesEqual(draft.side.pwanBytes, draft.base.pwanBytes)
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizePwanFps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.max(1, Math.min(60, Math.round(value * 10) / 10));
}

function formatPwanFps(value: number): string {
  return normalizePwanFps(value).toFixed(1).replace(/\.0$/u, "");
}

function pwanCanvasEventPoint(canvas: HTMLCanvasElement, event: PointerEvent): PwanPixelPoint | undefined {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const x = Math.floor((event.clientX - rect.left) * PWAN_WIDTH / rect.width);
  const y = Math.floor((event.clientY - rect.top) * PWAN_HEIGHT / rect.height);
  if (x < 0 || y < 0 || x >= PWAN_WIDTH || y >= PWAN_HEIGHT) return undefined;
  return { x, y };
}

function drawPwanPixelEditorOverlay(ctx: CanvasRenderingContext2D, editor: PwanPixelEditorState): void {
  const points = editor.drawingLasso ? editor.lassoDraftPoints : editor.lassoPoints;
  if (points.length === 0) return;
  const scaleX = ctx.canvas.width / PWAN_WIDTH;
  const scaleY = ctx.canvas.height / PWAN_HEIGHT;
  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(scaleX));
  ctx.strokeStyle = "#f8ffff";
  ctx.fillStyle = "rgb(26 188 156 / 16%)";
  ctx.setLineDash([Math.max(3, scaleX * 2), Math.max(2, scaleX)]);
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (point.x + 0.5) * scaleX;
    const y = (point.y + 0.5) * scaleY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (!editor.drawingLasso && points.length >= 3) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function simplifyLassoPoints(points: PwanPixelPoint[]): PwanPixelPoint[] {
  const simplified: PwanPixelPoint[] = [];
  for (const point of points) {
    const previous = simplified[simplified.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) simplified.push(point);
  }
  if (simplified.length > 1) {
    const first = simplified[0]!;
    const last = simplified[simplified.length - 1]!;
    if (first.x === last.x && first.y === last.y) simplified.pop();
  }
  return simplified.length >= 3 ? simplified : [];
}

function pointInPolygon(point: PwanPixelPoint, polygon: PwanPixelPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const intersects = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function readPwanPixelTool(value: string | undefined): PwanPixelTool {
  return value === "draw" || value === "erase" || value === "lasso" ? value : "pick";
}

function pwanPixelToolLabel(tool: PwanPixelTool): string {
  if (tool === "draw") return "Pencil";
  if (tool === "erase") return "Eraser";
  if (tool === "lasso") return "Lasso";
  return "Eyedropper";
}

function clampPaletteIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(15, Math.round(value)));
}

function firstVisiblePaletteIndex(palette: Uint16Array): number {
  for (let index = 1; index < palette.length; index += 1) {
    if ((palette[index] ?? 0) !== 0) return index;
  }
  return 1;
}

function pwanPaletteColorLabel(palette: Uint16Array, index: number): string {
  const clamped = clampPaletteIndex(index);
  if (clamped === 0) return "0 Transparent";
  return `${clamped} ${bgr555Hex(palette[clamped] ?? 0)}`;
}

function pwanPaletteSwatchBackground(value: number, index: number): string {
  return index === 0 ? "transparent" : bgr555Hex(value);
}

function bgr555Hex(value: number): string {
  const color = bgr555ToRgb(value);
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function pwanFrameCanvas(side: PwanOverrideSide, frameIndex: number): HTMLCanvasElement {
  const pixels = pwanFramePixels(side.pwanBytes, frameIndex);
  const imageData = new ImageData(PWAN_WIDTH, PWAN_HEIGHT);
  for (let y = 0; y < PWAN_HEIGHT; y += 1) {
    for (let x = 0; x < PWAN_WIDTH; x += 1) {
      const colorIndex = pixels[y]?.[x] ?? 0;
      const color = bgr555ToRgb(side.paletteBgr555[colorIndex] ?? 0);
      const offset = (y * PWAN_WIDTH + x) * 4;
      imageData.data[offset] = color.r;
      imageData.data[offset + 1] = color.g;
      imageData.data[offset + 2] = color.b;
      imageData.data[offset + 3] = colorIndex === 0 ? 0 : 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = PWAN_WIDTH;
  canvas.height = PWAN_HEIGHT;
  canvas.getContext("2d")?.putImageData(imageData, 0, 0);
  return canvas;
}

function bgr555ToRgb(value: number): { r: number; g: number; b: number } {
  return {
    r: ((value & 0x1f) << 3) | ((value & 0x1f) >>> 2),
    g: (((value >>> 5) & 0x1f) << 3) | (((value >>> 5) & 0x1f) >>> 2),
    b: (((value >>> 10) & 0x1f) << 3) | (((value >>> 10) & 0x1f) >>> 2),
  };
}

function pwanDownloadBaseName(project: ProjectState, speciesId: number, side: PwanSide): string {
  return `${speciesLabel(project, speciesId).replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase() || `pokemon-${speciesId}`}-${speciesId}-${side}`;
}

function downloadBytes(bytes: Uint8Array, mimeType: string, fileName: string): void {
  downloadBlob(new Blob([copyBytesToArrayBuffer(bytes)], { type: mimeType }), fileName);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export PNG frame."));
    }, type);
  });
}

function renderEditorForm(project: ProjectState, speciesOptions: string): string {
  const black2 = project.session.baseVersion === "B2";
  return `
    <div class="pwan-editor-grid">
      ${renderPwanImportForm(project, speciesOptions)}
      <div class="pwan-panel">
        <div class="pwan-section-title">
          <h2>Export Contract</h2>
          <span>${black2 ? "IREO full" : "IRDO full"}</span>
        </div>
        <div class="pwan-contract">
          <div><strong>GIF input</strong><span>Compiled to 96x96, 4bpp, 16-color PWAN.</span></div>
          <div><strong>Native carrier</strong><span>Species pokegra metadata and fallback frames are patched at export.</span></div>
          <div><strong>Runtime config</strong><span><code>zz_pokeweb_pwan/pwan.narc</code> stores config plus imported sides.</span></div>
          ${black2 ? `<div><strong>Display scope</strong><span>Imported sprites animate in battles, summaries, evolution, egg hatch, and supported non-battle views.</span></div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderSpeciesSelectOptions(project: ProjectState, activeSpeciesId: number): string {
  const rows: string[] = [];
  for (const { requestedSpeciesId: speciesId } of listPwanSpeciesTargets(project)) {
    const override = findPwanOverrideForSpecies(project, speciesId);
    const label = `${speciesLabel(project, speciesId)} #${speciesId}${override ? ` ${pwanSideMarkerText(override)}` : ""}`;
    rows.push(`
      <option value="${speciesId}" ${speciesId === activeSpeciesId ? "selected" : ""}>${escapeHtml(label)}</option>
    `);
  }
  return rows.join("");
}

function renderOverlayControls(project: ProjectState): string {
  const selectedSpeciesId = pwanOverlaySettings.speciesId;
  const enabled = pwanOverlaySettings.enabled && selectedSpeciesId !== undefined;
  return `
    <div class="pwan-overlay-controls">
      <label>
        <span>Overlay</span>
        <select id="pwan-overlay-species-select">
          <option value="" ${selectedSpeciesId === undefined ? "selected" : ""}>No overlay</option>
          ${renderOverlaySpeciesSelectOptions(project, selectedSpeciesId)}
        </select>
      </label>
      <button class="btn -default pwan-overlay-toggle" id="pwan-overlay-toggle" type="button" ${selectedSpeciesId === undefined ? "disabled" : ""}>${enabled ? "Hide Overlay" : "Show Overlay"}</button>
    </div>
  `;
}

function renderOverlaySpeciesSelectOptions(project: ProjectState, selectedSpeciesId: number | undefined): string {
  const rows: string[] = [];
  for (const { requestedSpeciesId: speciesId } of listPwanSpeciesTargets(project)) {
    const override = findPwanOverrideForSpecies(project, speciesId);
    const label = `${speciesLabel(project, speciesId)} #${speciesId}${override ? ` ${pwanSideMarkerText(override)}` : ""}`;
    rows.push(`<option value="${speciesId}" ${speciesId === selectedSpeciesId ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return rows.join("");
}

function renderPwanLibraryPanel(project: ProjectState): string {
  if (pwanLibraryUiState.status === "ready" && pwanLibraryUiState.library) {
    const entries = listLoadedPwanLibraryEntries(pwanLibraryUiState.library);
    const selectedEntry = selectedPwanLibraryEntry(entries);
    const missingSprites = !project.narcs.pokemon_sprites;
    const missingIcons = Boolean(selectedEntry?.icon) && !project.narcs.pokemon_icons;
    const canImport = !missingSprites && !missingIcons;
    return `
      <div class="pwan-panel pwan-library-panel">
        <div class="pwan-section-title">
          <h2>Hzla's PWAN Library</h2>
          <span>${entries.length} assets</span>
        </div>
        <label>
          <span>Community Asset</span>
          <select id="pwan-library-entry-select">
            ${entries.map((entry) => renderPwanLibraryOption(entry, selectedEntry?.id)).join("")}
          </select>
        </label>
        ${selectedEntry ? renderPwanLibraryEntryDetails(selectedEntry) : `<div class="pwan-empty">No community PWAN assets found.</div>`}
        <button class="btn -default pwan-library-import-button" id="pwan-library-import" type="button" ${!selectedEntry || !canImport || pwanLibraryUiState.importing ? "disabled" : ""}>${
          pwanLibraryUiState.importing ? "Importing..." : "Import"
        }</button>
        ${
          canImport
            ? ""
            : `<div class="pwan-library-message -error">${missingSprites ? "Pokemon Sprites" : "Pokemon Icons"} must be loaded before importing this community asset.</div>`
        }
        ${pwanLibraryUiState.message ? `<div class="pwan-library-message ${pwanLibraryUiState.messageError ? "-error" : ""}">${escapeHtml(pwanLibraryUiState.message)}</div>` : ""}
      </div>
    `;
  }
  return `
    <div class="pwan-panel pwan-library-panel">
      <div class="pwan-section-title">
        <h2>Hzla's PWAN Library</h2>
        <span>Community</span>
      </div>
      <button class="btn -default pwan-library-fetch-button" id="pwan-library-fetch" type="button" ${pwanLibraryUiState.status === "loading" ? "disabled" : ""}>${
        pwanLibraryUiState.status === "loading" ? "Fetching..." : "Fetch Community Assets"
      }</button>
      <div class="pwan-library-message ${pwanLibraryUiState.status === "error" || pwanLibraryUiState.messageError ? "-error" : ""}">
        ${escapeHtml(pwanLibraryUiState.message ?? "Loads the bundled PWAN archive on demand.")}
      </div>
    </div>
  `;
}

function renderPwanLibraryOption(entry: PwanLibraryEntry, selectedEntryId: string | undefined): string {
  const selected = entry.id === selectedEntryId ? "selected" : "";
  return `<option value="${escapeHtml(entry.id)}" ${selected}>${escapeHtml(pwanLibraryEntryLabel(entry))}</option>`;
}

function renderPwanLibraryEntryDetails(entry: PwanLibraryEntry): string {
  return `
    <div class="pwan-library-details">
      <div class="pwan-library-side-row">
        <span class="pwan-side-badge ${entry.hasFront ? "-front" : "-missing"}">F</span>
        <span class="pwan-side-badge ${entry.hasBack ? "-back" : "-missing"}">B</span>
        <span>Asset ${entry.assetIndex}</span>
        ${entry.icon ? `<span>Icon included</span>` : ""}
      </div>
      <div><strong>Credits</strong><span>${escapeHtml(entry.credits || "Missing credit")}</span></div>
      ${entry.notes ? `<div><strong>Notes</strong><span>${escapeHtml(entry.notes)}</span></div>` : ""}
    </div>
  `;
}

function selectedPwanLibraryEntry(entries: PwanLibraryEntry[]): PwanLibraryEntry | undefined {
  const selected = entries.find((entry) => entry.id === pwanLibraryUiState.selectedEntryId) ?? entries[0];
  pwanLibraryUiState.selectedEntryId = selected?.id;
  return selected;
}

function pwanLibraryEntryLabel(entry: PwanLibraryEntry): string {
  return `${entry.name} #${entry.speciesId}${entry.formIndex > 0 ? ` Form ${entry.formIndex}` : ""} ${pwanLibrarySideText(entry)}`;
}

function pwanLibrarySideText(entry: PwanLibraryEntry): string {
  if (entry.hasFront && entry.hasBack) return "[F/B]";
  if (entry.hasFront) return "[F]";
  if (entry.hasBack) return "[B]";
  return "[none]";
}

function renderPwanPixelEditorControls(side: PwanSide, data: PwanOverrideSide): string {
  const selectedIndex = firstVisiblePaletteIndex(data.paletteBgr555);
  return `
    <div class="pwan-pixel-editor">
      <div class="pwan-pixel-tool-row" role="group" aria-label="${side} pixel tools">
        ${renderPwanPixelToolButton(side, "pick", "Eyedropper")}
        ${renderPwanPixelToolButton(side, "draw", "Pencil")}
        ${renderPwanPixelToolButton(side, "erase", "Eraser")}
        ${renderPwanPixelToolButton(side, "lasso", "Lasso")}
        <span class="pwan-pixel-position" data-pwan-pixel-position="${side}">--, --</span>
      </div>
      <div class="pwan-pixel-palette" role="group" aria-label="${side} palette">
        ${Array.from({ length: 16 }, (_value, index) => renderPwanPixelSwatch(side, data.paletteBgr555, index, index === selectedIndex)).join("")}
      </div>
      <div class="pwan-pixel-selection">
        <span class="pwan-pixel-selected ${selectedIndex === 0 ? "-transparent" : ""}" data-pwan-pixel-selected="${side}" style="background: ${pwanPaletteSwatchBackground(data.paletteBgr555[selectedIndex] ?? 0, selectedIndex)}"></span>
        <strong data-pwan-pixel-selected-label="${side}">${pwanPaletteColorLabel(data.paletteBgr555, selectedIndex)}</strong>
      </div>
      <div class="pwan-pixel-lasso">
        <label>
          <span>From</span>
          <select data-pwan-lasso-from="${side}">${renderPwanPaletteOptions(data.paletteBgr555, selectedIndex)}</select>
        </label>
        <label>
          <span>To</span>
          <select data-pwan-lasso-to="${side}">${renderPwanPaletteOptions(data.paletteBgr555, selectedIndex)}</select>
        </label>
        <button class="btn -default" data-pwan-lasso-apply="${side}" type="button" disabled>Apply</button>
        <button class="btn -default" data-pwan-lasso-clear="${side}" type="button" disabled>Clear</button>
      </div>
    </div>
  `;
}

function renderPwanPixelToolButton(side: PwanSide, tool: PwanPixelTool, label: string): string {
  return `
    <button class="animation-icon-btn pwan-pixel-tool ${tool === "pick" ? "-active" : ""}" data-pwan-pixel-tool="${side}" data-pwan-pixel-tool-name="${tool}" type="button" aria-label="${label}" aria-pressed="${tool === "pick"}" title="${label}">
      <span class="pwan-pixel-icon -${tool}" aria-hidden="true"></span>
    </button>
  `;
}

function renderPwanPixelSwatch(side: PwanSide, palette: Uint16Array, index: number, selected: boolean): string {
  return `
    <button class="pwan-pixel-swatch ${selected ? "-active" : ""} ${index === 0 ? "-transparent" : ""}" data-pwan-pixel-color="${side}" data-pwan-pixel-color-index="${index}" type="button" aria-label="${pwanPaletteColorLabel(palette, index)}" aria-pressed="${selected}" title="${pwanPaletteColorLabel(palette, index)}" style="background: ${pwanPaletteSwatchBackground(palette[index] ?? 0, index)}"></button>
  `;
}

function renderPwanPaletteOptions(palette: Uint16Array, selectedIndex: number): string {
  return Array.from({ length: 16 }, (_value, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${pwanPaletteColorLabel(palette, index)}</option>`).join("");
}

function renderSpeciesSidePanel(project: ProjectState, speciesId: number, side: PwanSide, data: PwanOverrideSide | undefined): string {
  const title = side === "front" ? "Front" : "Back";
  const inputId = `pwan-${side}-gif`;
  const previewId = `pwan-${side}-gif-preview`;
  const statusId = `pwan-${side}-status`;
  const timelineCount = data ? pwanTimeline(data.pwanBytes).length : 0;
  const framesPerSecond = data ? normalizePwanFps(data.framesPerSecond ?? pwanFramesPerSecond(data.pwanBytes)) : 10;
  const frameScale = data ? normalizePwanFrameScale(data.scale ?? 1) : 1;
  const frameScaleMode = data ? normalizePwanFrameScaleMode(data.scaleMode) : "nearest";
  const outlineThreshold = data ? normalizePwanOutlineThreshold(data.outlineThreshold ?? 48) : 48;
  const offsetX = data ? normalizePwanOffset(data.offsetX ?? 0) : 0;
  const offsetY = data ? normalizePwanOffset(data.offsetY ?? 0) : 0;
  return `
    <section class="pwan-panel pwan-side-panel" data-pwan-side-panel="${side}">
      <div class="pwan-section-title">
        <h2>${title}</h2>
        <span>${data ? "PWAN" : "Native"}</span>
      </div>
      ${
        data
          ? `<div class="pwan-live-preview">
              <div class="pwan-preview-shell">
                <div class="pwan-preview-stack">
                  <div class="pwan-preview-stage">
                    <canvas width="${PWAN_WIDTH * 6}" height="${PWAN_HEIGHT * 6}" data-pwan-preview="${side}" aria-label="${title} PWAN preview"></canvas>
                    <div class="pwan-preview-playback" aria-label="${title} playback controls">
                      <button class="animation-icon-btn pwan-preview-icon-btn" data-pwan-step="${side}" data-pwan-step-direction="prev" type="button" aria-label="Previous frame" title="Previous frame"><span class="animation-icon -step-back" aria-hidden="true"></span></button>
                      <button class="animation-icon-btn pwan-preview-icon-btn" data-pwan-play="${side}" type="button" aria-label="Pause" title="Pause"><span class="animation-icon -pause" aria-hidden="true"></span></button>
                      <button class="animation-icon-btn pwan-preview-icon-btn" data-pwan-step="${side}" data-pwan-step-direction="next" type="button" aria-label="Next frame" title="Next frame"><span class="animation-icon -step-forward" aria-hidden="true"></span></button>
                    </div>
                  </div>
                  <div class="pwan-offset-axis -x" aria-label="${title} horizontal offset controls">
                    <button class="animation-icon-btn pwan-offset-button" data-pwan-offset-nudge="${side}" data-pwan-offset-axis="x" data-pwan-offset-delta="-1" type="button" aria-label="Move left" title="Move left"><span class="pwan-arrow-icon -left" aria-hidden="true"></span></button>
                    <strong data-pwan-offset-x-label="${side}">${offsetX}px</strong>
                    <button class="animation-icon-btn pwan-offset-button" data-pwan-offset-nudge="${side}" data-pwan-offset-axis="x" data-pwan-offset-delta="1" type="button" aria-label="Move right" title="Move right"><span class="pwan-arrow-icon -right" aria-hidden="true"></span></button>
                  </div>
                  <div class="pwan-scale-axis" aria-label="${title} scale controls">
                    <button class="animation-icon-btn pwan-scale-button" data-pwan-scale-nudge="${side}" data-pwan-scale-delta="${-PWAN_FRAME_SCALE_STEP}" type="button" aria-label="Scale down" title="Scale down">-</button>
                    <strong data-pwan-scale-label="${side}">${formatPwanFrameScale(frameScale)}</strong>
                    <button class="animation-icon-btn pwan-scale-button" data-pwan-scale-nudge="${side}" data-pwan-scale-delta="${PWAN_FRAME_SCALE_STEP}" type="button" aria-label="Scale up" title="Scale up">+</button>
                  </div>
                  <div class="pwan-scale-mode" aria-label="${title} scale mode">
                    <button class="pwan-segment-button ${frameScaleMode === "nearest" ? "-active" : ""}" data-pwan-scale-mode-option="${side}" data-pwan-scale-mode="nearest" type="button" aria-pressed="${frameScaleMode === "nearest"}">Nearest</button>
                    <button class="pwan-segment-button ${frameScaleMode === "outlineFill" ? "-active" : ""}" data-pwan-scale-mode-option="${side}" data-pwan-scale-mode="outlineFill" type="button" aria-pressed="${frameScaleMode === "outlineFill"}">Outline Fill</button>
                  </div>
                </div>
                <div class="pwan-offset-axis -y" aria-label="${title} vertical offset controls">
                  <button class="animation-icon-btn pwan-offset-button" data-pwan-offset-nudge="${side}" data-pwan-offset-axis="y" data-pwan-offset-delta="-1" type="button" aria-label="Move up" title="Move up"><span class="pwan-arrow-icon -up" aria-hidden="true"></span></button>
                  <strong data-pwan-offset-y-label="${side}">${offsetY}px</strong>
                  <button class="animation-icon-btn pwan-offset-button" data-pwan-offset-nudge="${side}" data-pwan-offset-axis="y" data-pwan-offset-delta="1" type="button" aria-label="Move down" title="Move down"><span class="pwan-arrow-icon -down" aria-hidden="true"></span></button>
                </div>
              </div>
              <div class="pwan-preview-controls">
                <label class="pwan-preview-field">
                  <span>Frame <strong data-pwan-frame-label="${side}">1 / ${Math.max(1, timelineCount)}</strong></span>
                  <input data-pwan-frame-slider="${side}" type="range" min="0" max="${Math.max(0, timelineCount - 1)}" step="1" value="0" ${timelineCount > 1 ? "" : "disabled"}>
                </label>
                <label class="pwan-preview-field">
                  <span>FPS</span>
                  <input class="pwan-number-field" data-pwan-fps="${side}" type="number" min="1" max="60" step="0.1" value="${formatPwanFps(framesPerSecond)}">
                </label>
                <label class="pwan-preview-field pwan-outline-threshold-field ${frameScaleMode === "outlineFill" ? "" : "-hidden"}" data-pwan-outline-threshold-field="${side}" aria-hidden="${frameScaleMode === "outlineFill" ? "false" : "true"}">
                  <span>Dark Line <strong data-pwan-outline-threshold-label="${side}">${outlineThreshold}</strong></span>
                  <input data-pwan-outline-threshold="${side}" type="range" min="${PWAN_MIN_OUTLINE_THRESHOLD}" max="${PWAN_MAX_OUTLINE_THRESHOLD}" step="1" value="${outlineThreshold}" ${frameScaleMode === "outlineFill" ? "" : "disabled"}>
                </label>
                <div class="pwan-preview-actions">
                  <button class="btn -default" data-pwan-download-gif="${side}" type="button">Export GIF</button>
                  <button class="btn -default" data-pwan-download-png="${side}" type="button">Export PNG</button>
                </div>
                ${renderPwanPixelEditorControls(side, data)}
              </div>
            </div>`
          : `<div class="pwan-empty">No ${side} PWAN imported for ${escapeHtml(speciesLabel(project, speciesId))}.</div>`
      }
      <div class="pwan-form pwan-side-import">
        <label class="pwan-gif-field pwan-gif-dropzone" data-pwan-dropzone="${side}">
          <span class="pwan-dropzone-title">${title} GIF</span>
          <input id="${inputId}" data-pwan-side-input="${side}" type="file" accept="image/gif,.gif">
          <span class="pwan-dropzone-copy">Drop or choose GIF</span>
          <img class="pwan-gif-preview" id="${previewId}" alt="${title} GIF preview" hidden>
        </label>
        <div class="pwan-status" id="${statusId}"></div>
      </div>
      ${data ? `<div class="pwan-side-footer"><button class="btn -default" data-pwan-apply="${side}" type="button" disabled>Applied</button></div>` : ""}
    </section>
  `;
}

function installSpeciesPwanEvents(project: ProjectState, root: HTMLElement, speciesId: number, options: PwanAnimationEditorOptions): void {
  const refresh = () => {
    if (options.onRefresh) options.onRefresh();
    else renderPwanAnimationEditor(project, root, options);
  };
  root.querySelector<HTMLButtonElement>("#pwan-back-to-pokemon")?.addEventListener("click", () => options.onBack?.());
  root.querySelector<HTMLSelectElement>("#pwan-species-select")?.addEventListener("change", (event) => {
    const nextSpeciesId = Number((event.currentTarget as HTMLSelectElement).value);
    if (Number.isInteger(nextSpeciesId)) options.onNavigateSpecies?.(nextSpeciesId);
  });
  root.querySelector<HTMLSelectElement>("#pwan-overlay-species-select")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    pwanOverlaySettings.speciesId = value ? Number(value) : undefined;
    pwanOverlaySettings.enabled = pwanOverlaySettings.speciesId !== undefined;
    refresh();
  });
  root.querySelector<HTMLButtonElement>("#pwan-overlay-toggle")?.addEventListener("click", () => {
    if (pwanOverlaySettings.speciesId === undefined) return;
    pwanOverlaySettings.enabled = !pwanOverlaySettings.enabled;
    refresh();
  });
  root.querySelector<HTMLButtonElement>("#pwan-library-fetch")?.addEventListener("click", async () => {
    pwanLibraryUiState.status = "loading";
    pwanLibraryUiState.message = "Fetching community PWAN assets...";
    pwanLibraryUiState.messageError = false;
    refresh();
    try {
      const library = await loadPwanLibrary();
      pwanLibraryUiState.status = "ready";
      pwanLibraryUiState.library = library;
      pwanLibraryUiState.selectedEntryId ??= library.entries[0]?.id;
      pwanLibraryUiState.message = `Loaded ${library.entries.length} community PWAN assets.`;
      pwanLibraryUiState.messageError = false;
    } catch (error) {
      pwanLibraryUiState.status = "error";
      pwanLibraryUiState.message = error instanceof Error ? error.message : String(error);
      pwanLibraryUiState.messageError = true;
    }
    refresh();
  });
  root.querySelector<HTMLSelectElement>("#pwan-library-entry-select")?.addEventListener("change", (event) => {
    pwanLibraryUiState.selectedEntryId = (event.currentTarget as HTMLSelectElement).value;
    pwanLibraryUiState.message = undefined;
    pwanLibraryUiState.messageError = false;
    refresh();
  });
  root.querySelector<HTMLButtonElement>("#pwan-library-import")?.addEventListener("click", async () => {
    if (!pwanLibraryUiState.library || !pwanLibraryUiState.selectedEntryId || pwanLibraryUiState.importing) return;
    const entry = pwanLibraryUiState.library.entries.find((candidate) => candidate.id === pwanLibraryUiState.selectedEntryId);
    pwanLibraryUiState.importing = true;
    pwanLibraryUiState.message = entry ? `Importing ${entry.name}...` : "Importing community asset...";
    pwanLibraryUiState.messageError = false;
    refresh();
    try {
      await importPwanLibraryEntry(project, speciesId, pwanLibraryUiState.selectedEntryId, { library: pwanLibraryUiState.library });
      pwanLibraryUiState.message = entry ? `Imported ${entry.name}${entry.icon ? " with its icon" : ""}.` : "Imported community asset.";
      pwanLibraryUiState.messageError = false;
      options.onDirty?.();
    } catch (error) {
      pwanLibraryUiState.message = error instanceof Error ? error.message : String(error);
      pwanLibraryUiState.messageError = true;
    } finally {
      pwanLibraryUiState.importing = false;
    }
    refresh();
  });

  for (const side of ["front", "back"] as const) installPwanSideDropzone(project, root, speciesId, side, options);

  installPwanLivePreviews(project, root, speciesId, options);
}

function installPwanSideDropzone(project: ProjectState, root: HTMLElement, speciesId: number, side: PwanSide, options: PwanAnimationEditorOptions): void {
  const dropzone = root.querySelector<HTMLElement>(`[data-pwan-dropzone='${side}']`);
  const input = root.querySelector<HTMLInputElement>(`#pwan-${side}-gif`);
  const preview = root.querySelector<HTMLImageElement>(`#pwan-${side}-gif-preview`);
  const message = root.querySelector<HTMLElement>(`#pwan-${side}-status`);
  if (!dropzone || !input) return;
  const title = side === "front" ? "Front" : "Back";
  let importing = false;

  const importFile = async (file: File) => {
    if (importing) return;
    if (!isGifFile(file)) {
      setStatus(message, `${title} import needs a .gif file.`, true);
      return;
    }
    importing = true;
    input.disabled = true;
    dropzone.classList.add("-busy");
    dropzone.classList.remove("-dragging");
    setPwanGifPreview(preview, file);
    try {
      setStatus(message, `Compiling ${file.name}...`);
      const sideData = await buildPwanOverrideSideAsync({ fileName: file.name, gifBytes: new Uint8Array(await file.arrayBuffer()) });
      const target = resolvePwanSpeciesTarget(project, speciesId);
      upsertPwanOverrideSide(project, {
        speciesId: target.speciesId,
        formIndex: target.formIndex,
        assetIndex: target.assetIndex === target.speciesId ? undefined : target.assetIndex,
        side,
        sideData,
        nativePaletteSource: side,
      });
      options.onDirty?.();
      setStatus(message, `Imported ${title.toLowerCase()} PWAN for ${speciesLabel(project, speciesId)}.`);
      options.onRefresh?.();
    } catch (error) {
      setStatus(message, error instanceof Error ? error.message : String(error), true);
    } finally {
      importing = false;
      input.disabled = false;
      input.value = "";
      dropzone.classList.remove("-busy", "-dragging");
    }
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void importFile(file);
    else clearPwanGifPreview(preview);
  });

  dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("-dragging");
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropzone.classList.add("-dragging");
  });
  dropzone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !dropzone.contains(related)) dropzone.classList.remove("-dragging");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) void importFile(file);
  });
}

function isGifFile(file: File): boolean {
  return file.type === "image/gif" || /\.gif$/iu.test(file.name);
}

function renderPwanImportForm(project: ProjectState, speciesOptions: string, options: PwanImportFormOptions = {}): string {
  const title = options.title ?? "Add Override";
  const defaultSpeciesId = options.defaultSpeciesId ?? 498;
  const defaultPaletteSource = options.defaultPaletteSource ?? "back";
  const existingOverride = options.showImportStatus ? findPwanOverrideForSpecies(project, defaultSpeciesId) : undefined;
  const showPaletteField = options.showPaletteField ?? true;
  const showSpeciesField = options.showSpeciesField ?? true;
  const submitLabel = options.submitLabel ?? "Save Override";
  return `
    <div class="pwan-panel">
      <div class="pwan-section-title">
        <h2>${escapeHtml(title)}</h2>
        <span>Front + back required</span>
      </div>
      ${existingOverride ? renderPwanImportStatus(existingOverride) : ""}
      <div class="pwan-form">
        ${
          showSpeciesField
            ? `<label>
                <span>Species</span>
                <input id="pwan-species-id" type="number" min="1" max="${Math.max(1, (project.narcs.personal?.fileCount ?? 650) - 1)}" value="${defaultSpeciesId}" list="pwan-species-list">
                <datalist id="pwan-species-list">${speciesOptions}</datalist>
              </label>`
            : `<input id="pwan-species-id" type="hidden" value="${defaultSpeciesId}">`
        }
        <label class="pwan-gif-field">
          <span>Front GIF</span>
          <input id="pwan-front-gif" type="file" accept="image/gif,.gif">
          <img class="pwan-gif-preview" id="pwan-front-gif-preview" alt="Front GIF preview" hidden>
        </label>
        <label class="pwan-gif-field">
          <span>Back GIF</span>
          <input id="pwan-back-gif" type="file" accept="image/gif,.gif">
          <img class="pwan-gif-preview" id="pwan-back-gif-preview" alt="Back GIF preview" hidden>
        </label>
        ${
          showPaletteField
            ? `<label>
                <span>Fallback Palette</span>
                <select id="pwan-palette-source">
                  <option value="back" ${defaultPaletteSource === "back" ? "selected" : ""}>Back PWAN palette</option>
                  <option value="front" ${defaultPaletteSource === "front" ? "selected" : ""}>Front PWAN palette</option>
                </select>
              </label>`
            : `<input id="pwan-palette-source" type="hidden" value="${defaultPaletteSource}">`
        }
        <button class="btn -default" id="pwan-save-override" type="button">${escapeHtml(submitLabel)}</button>
        <div class="pwan-status" id="pwan-form-status"></div>
      </div>
    </div>
  `;
}

function renderPwanImportStatus(override: PwanAnimationOverride): string {
  return `
    <div class="pwan-import-status">
      <strong>GIF import active</strong>
      <span>Front: ${override.front ? `${escapeHtml(override.front.sourceFileName)} (${override.front.frameCount} frames)` : "Native"}</span>
      <span>Back: ${override.back ? `${escapeHtml(override.back.sourceFileName)} (${override.back.frameCount} frames)` : "Native"}</span>
    </div>
  `;
}

function renderSpeciesSideSummary(override: PwanAnimationOverride | undefined): string {
  return `
    <div class="pwan-side-summary">
      <span class="pwan-sidebar-label">PWAN Sides</span>
      ${renderSpeciesSideSummaryRow("Front", override?.front)}
      ${renderSpeciesSideSummaryRow("Back", override?.back)}
    </div>
  `;
}

function renderSpeciesSideSummaryRow(label: string, side: PwanOverrideSide | undefined): string {
  if (!side) {
    return `
      <div class="pwan-side-summary-row">
        <strong>${label}</strong>
        <span>Native</span>
      </div>
    `;
  }
  return `
    <div class="pwan-side-summary-row">
      <strong>${label}</strong>
      <span>${side.frameCount} frames</span>
      <span>${side.uniqueFrameCount} unique</span>
      <span>${side.timelineCount} timeline</span>
      <span>${formatPwanFps(side.framesPerSecond ?? pwanFramesPerSecond(side.pwanBytes))} FPS</span>
      <span>Scale ${formatPwanFrameScale(side.scale ?? 1)}</span>
      <span>${formatPwanScaleMode(side)}</span>
      <span>Offset ${normalizePwanOffset(side.offsetX ?? 0)}, ${normalizePwanOffset(side.offsetY ?? 0)}</span>
      <span>${formatBytes(side.pwanBytes.length)}</span>
    </div>
  `;
}

function renderOverride(project: ProjectState, override: PwanAnimationOverride): string {
  const notes = override.notes?.length ? override.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("") : `<li>No compiler warnings.</li>`;
  const assetIndex = pwanAssetIndex(override);
  return `
    <article class="pwan-override">
      <div class="pwan-override__main">
        <h3>#${override.speciesId} ${escapeHtml(speciesLabel(project, override.speciesId))}</h3>
        <div class="pwan-override__meta">
          ${override.front ? `<span>${escapeHtml(override.front.sourceFileName)} -> ${escapeHtml(pwanAssetPath(assetIndex, "front"))}</span>` : `<span>Front: native</span>`}
          ${override.back ? `<span>${escapeHtml(override.back.sourceFileName)} -> ${escapeHtml(pwanAssetPath(assetIndex, "back"))}</span>` : `<span>Back: native</span>`}
          <span>Palette: ${override.nativePaletteSource}</span>
          ${override.backNcecY ? `<span>Back NCEC Y: ${override.backNcecY}</span>` : ""}
        </div>
        <div class="pwan-stats">
          ${override.front ? renderSideStats("Front", override.front) : renderMissingSideStats("Front")}
          ${override.back ? renderSideStats("Back", override.back) : renderMissingSideStats("Back")}
        </div>
        <ul class="pwan-notes">${notes}</ul>
      </div>
      <button class="btn -default" data-pwan-remove="${override.speciesId}" type="button">Remove</button>
    </article>
  `;
}

function renderSideStats(label: string, side: PwanAnimationOverride["front"]): string {
  if (!side) return renderMissingSideStats(label);
  return `
    <div>
      <strong>${label}</strong>
      <span>${side.frameCount} frames</span>
      <span>${side.uniqueFrameCount} unique</span>
      <span>${side.timelineCount} timeline</span>
      <span>${formatPwanFps(side.framesPerSecond ?? pwanFramesPerSecond(side.pwanBytes))} FPS</span>
      <span>Scale ${formatPwanFrameScale(side.scale ?? 1)}</span>
      <span>${formatPwanScaleMode(side)}</span>
      <span>Offset ${normalizePwanOffset(side.offsetX ?? 0)}, ${normalizePwanOffset(side.offsetY ?? 0)}</span>
      <span>${formatBytes(side.pwanBytes.length)}</span>
    </div>
  `;
}

function renderMissingSideStats(label: string): string {
  return `
    <div>
      <strong>${label}</strong>
      <span>Native</span>
    </div>
  `;
}

function renderSideBadges(override: PwanAnimationOverride): string {
  const badges = [
    override.front ? `<span class="pwan-side-badge -front">F</span>` : "",
    override.back ? `<span class="pwan-side-badge -back">B</span>` : "",
  ].join("");
  return badges || "No PWAN sides imported";
}

function renderSpeciesOptions(project: ProjectState): string {
  const options: string[] = [];
  for (const { requestedSpeciesId: speciesId } of listPwanSpeciesTargets(project)) {
    options.push(`<option value="${speciesId}" label="${escapeHtml(speciesLabel(project, speciesId))} #${speciesId}"></option>`);
  }
  return options.join("");
}

function renderDetectedArchiveSummary(project: ProjectState): string {
  const state = project.pwanAnimations;
  if (state?.loadError) {
    return `<div class="pwan-archive-summary -error"><strong>Archive unreadable</strong><span>${escapeHtml(state.loadError)}</span></div>`;
  }
  if (!state?.detectedArchive) {
    return `<div class="pwan-archive-summary"><strong>No ROM archive</strong><span>Import a GIF side to create PWAN data.</span></div>`;
  }
  return `
    <div class="pwan-archive-summary">
      <strong>${state.detectedArchive.count} loaded</strong>
      <span>${escapeHtml(state.detectedArchive.path)} v${state.detectedArchive.version}</span>
    </div>
  `;
}

function speciesLabel(project: ProjectState, speciesId: number): string {
  return pokemonSpeciesLabel(project, speciesId);
}

function pwanSideMarkerText(override: PwanAnimationOverride): string {
  const sides = [override.front ? "F" : "", override.back ? "B" : ""].filter(Boolean).join(" ");
  return sides ? `[${sides}]` : "";
}

function formatPwanScaleMode(side: PwanOverrideSide): string {
  const mode = normalizePwanFrameScaleMode(side.scaleMode);
  return mode === "outlineFill" ? `Outline Fill ${normalizePwanOutlineThreshold(side.outlineThreshold ?? 48)}` : "Nearest";
}

function normalizeSpeciesId(project: ProjectState, speciesId: number | undefined): number | undefined {
  if (speciesId === undefined || !Number.isInteger(speciesId)) return undefined;
  try {
    resolvePwanSpeciesTarget(project, speciesId);
    return speciesId;
  } catch {
    return undefined;
  }
}

function setStatus(element: HTMLElement | null | undefined, message: string, error = false): void {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("-error", error);
}
