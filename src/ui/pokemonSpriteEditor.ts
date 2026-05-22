import {
  genderedPokemonIcons,
  getPokemonIconImage,
  getPokemonIconPaletteAssignment,
  getPokemonIconPalettes,
  getPokemonAnimation,
  getPokemonCellBank,
  getPokemonMultiCellAnimation,
  getPokemonMultiCells,
  getPokemonPalettes,
  getPokemonSpriteEntry,
  getPokemonSpriteFormOptions,
  getPokemonSpriteIndexedImage,
  getPokemonSpriteImage,
  getPokemonRigAtlasDimensions,
  getRigCells,
  importPokemonAnimationBundle,
  importPokemonSpritePackage,
  copyPokemonSpriteVariant,
  replaceRigCells,
  resolvePokemonSpriteId,
  scalePokemonAnimationDurations,
  setPokemonAnimation,
  setPokemonCellBank,
  setPokemonIconImage,
  setPokemonIconPaletteAssignment,
  setPokemonMultiCellAnimation,
  setPokemonMultiCells,
  setPokemonPalette,
  setPokemonSpriteImage,
  setRigCells,
  rewritePokemonAnimationSequences,
  updatePokemonAnimationFrame,
  type PokemonAnimation,
  type PokemonAnimationFrame,
  type PokemonAnimationFrameEdit,
  type PokemonAnimationSequence,
  type PokemonAnimationSide,
  type PokemonCell,
  type PokemonCellBank,
  type PokemonCellOam,
  type PokemonMultiCellNode,
  type PokemonMultiCell,
  type PokemonIconVariant,
  type PokemonPaletteKind,
  type PokemonSpriteVariant,
  type IndexedImageData,
  type RgbColor,
  type RgbaImageData,
  type RigCell,
  type RigCellsFile,
} from "../pokeweb/pokemonSpriteModel";
import {
  buildPairedPokemonFlipbookRigsFromGifs,
  buildPokemonFlipbookRigFromGif,
  decodePokemonFlipbookGifFrames,
  defaultPokemonFlipbookImportConfig,
  type PokemonFlipbookFrameEntry,
  type PokemonFlipbookImportConfig,
  type PokemonFlipbookPackingMode,
  type PokemonFlipbookReport,
  type PokemonFlipbookSamplingStrategy,
} from "../pokeweb/pokemonFlipbookRig";
import { getPokemonCount } from "../pokeweb/pokemonModel";
import { concatBytes } from "../nds/binary";
import { parsePokemonCustomSpriteBundle } from "../pokeweb/pokemonSpriteWriters";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type RenderOptions = {
  onDirty?: () => void;
  onBack?: () => void;
  onNavigateForm?: (formIndex: number) => void;
  onNavigateSpecies?: (speciesId: number) => void;
};

type SpriteEditorState = {
  variant: PokemonSpriteVariant;
  paletteKind: PokemonPaletteKind;
  previewPaletteKind: PokemonPaletteKind;
  iconVariant: PokemonIconVariant;
  iconPaletteId: number;
  rigSide: "front" | "back";
  animationSide: PokemonAnimationSide;
  animationSequence: number;
  animationFrame: number;
  animationMultiCell: number;
  animationVisibleNode: number;
  animationActiveNode: number;
  animationPlaying: boolean;
  animationTick: number;
  animationExpanded: boolean;
  animationStepInterval: number;
  animationTab: AnimationEditorTab;
  sidebarCollapsed: boolean;
  selectedCell: number;
  selectedSubCell: boolean;
  gifFlipbookPackingMode: PokemonFlipbookPackingMode;
  gifFlipbookStrategy: PokemonFlipbookSamplingStrategy;
  gifFlipbookSpeedScale: number;
  gifFlipbookDownscalePercent: number;
  gifLoopStartFrame: number;
  gifLoopEndFrame: number;
  gifLoopCount: number;
  gifManualFrames: string;
  gifViewerFrame: number;
  gifViewerPlaying: boolean;
  gifSource?: GifSourceState;
  gifLoopBase?: GifLoopBase;
  lastGifImport?: GifImportSummary;
  spritesExpanded: boolean;
  palettesExpanded: boolean;
  iconsExpanded: boolean;
};

type AnimationEditorTab = "preview" | "nanr" | "nmar" | "nmcr" | "ncer" | "ncec";

type GifLoopBase = {
  spriteId: number;
  side: PokemonAnimationSide;
  sequences: PokemonAnimationFrameEdit[][];
};

type GifImportSummary = {
  spriteId: number;
  fileName: string;
  side: PokemonAnimationSide;
  paletteKind: PokemonPaletteKind;
  speedScale: number;
  report: PokemonFlipbookReport;
};

type GifSourceState = {
  spriteId: number;
  side: PokemonAnimationSide;
  fileName: string;
  bytes: Uint8Array;
  frames: PokemonFlipbookFrameEntry[];
};

type PaletteHighlight = { kind: PokemonPaletteKind; index: number } | undefined;
type RigDragMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type RigCellRect = Pick<RigCell, "cellX" | "cellY" | "width" | "height">;
type Rect = { x: number; y: number; width: number; height: number };
type RigDragState = {
  cells: RigCellsFile;
  mode: RigDragMode;
  startX: number;
  startY: number;
  original: RigCellRect;
  rigImage?: RgbaImageData;
  moved: boolean;
};
type AnimationDragMode = "move" | "rotate" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type AnimationCanvasPoint = { x: number; y: number };
type AnimationRenderPart = {
  nodeIndex: number;
  node: PokemonMultiCellNode;
  sequenceIndex: number;
  frameIndex: number;
  frame: PokemonAnimationFrame;
  cell: RigCell;
  localBounds: AnimationSelectionBox;
  worldCorners: AnimationCanvasPoint[];
  canvasCorners: AnimationCanvasPoint[];
  anchorLocal: AnimationCanvasPoint;
  anchorWorld: AnimationCanvasPoint;
  anchorCanvas: AnimationCanvasPoint;
  handles: Record<AnimationDragMode, AnimationCanvasPoint>;
  canTranslate: boolean;
  canTransform: boolean;
};
type AnimationRenderState = {
  parts: AnimationRenderPart[];
  selected?: AnimationRenderPart;
  outerFrame?: PokemonAnimationFrame;
};
type AnimationDragState = {
  mode: AnimationDragMode;
  nodeIndex: number;
  sequenceIndex: number;
  frameIndex: number;
  startPointer: AnimationCanvasPoint;
  startWorldPointer: AnimationCanvasPoint;
  startFrame: PokemonAnimationFrameEdit;
  startAnchorWorld: AnimationCanvasPoint;
  anchorLocal: AnimationCanvasPoint;
  node: PokemonMultiCellNode;
  outerFrame?: PokemonAnimationFrame;
  previewFrame: PokemonAnimationFrame;
  moved: boolean;
};
type AnimationHistoryEntry = {
  spriteId: number;
  side: PokemonAnimationSide;
  sequenceIndex: number;
  frameIndex: number;
  before: PokemonAnimationFrameEdit;
  after: PokemonAnimationFrameEdit;
};
type AnimationDraftFrame = {
  spriteId: number;
  side: PokemonAnimationSide;
  sequenceIndex: number;
  frameIndex: number;
  frame: PokemonAnimationFrame;
};
type AnimationFileDraft = {
  spriteId: number;
  side: PokemonAnimationSide;
  tab: "nanr" | "nmar";
  animation: PokemonAnimation;
};

const ANIMATION_STEP_INTERVAL_STORAGE_KEY = "pokeweb.animationStepInterval";
const GIF_FLIPBOOK_PACKING_MODE_STORAGE_KEY = "pokeweb.gifFlipbookPackingMode";
const GIF_FLIPBOOK_STRATEGY_STORAGE_KEY = "pokeweb.gifFlipbookStrategy";
const GIF_FLIPBOOK_SPEED_STORAGE_KEY = "pokeweb.gifFlipbookSpeedScale";
const GIF_FLIPBOOK_DOWNSCALE_STORAGE_KEY = "pokeweb.gifFlipbookDownscalePercent";

const state: SpriteEditorState = {
  variant: { kind: "sprite", side: "front", gender: "male" },
  paletteKind: "normal",
  previewPaletteKind: "normal",
  iconVariant: "male",
  iconPaletteId: 0,
  rigSide: "front",
  animationSide: "front",
  animationSequence: 0,
  animationFrame: 0,
  animationMultiCell: 0,
  animationVisibleNode: -1,
  animationActiveNode: -1,
  animationPlaying: false,
  animationTick: 0,
  animationExpanded: false,
  animationStepInterval: readAnimationStepInterval(),
  animationTab: "preview",
  sidebarCollapsed: false,
  selectedCell: 0,
  selectedSubCell: false,
  gifFlipbookPackingMode: readGifFlipbookPackingModePreference(),
  gifFlipbookStrategy: readGifFlipbookStrategyPreference(),
  gifFlipbookSpeedScale: readGifFlipbookSpeedPreference(),
  gifFlipbookDownscalePercent: readGifFlipbookDownscalePreference(),
  gifLoopStartFrame: 1,
  gifLoopEndFrame: 1,
  gifLoopCount: 1,
  gifManualFrames: "",
  gifViewerFrame: 0,
  gifViewerPlaying: false,
  spritesExpanded: false,
  palettesExpanded: false,
  iconsExpanded: false,
};
let animationPlaybackHandle: number | undefined;
let gifViewerPlaybackHandle: number | undefined;
let animationDragState: AnimationDragState | undefined;
let animationDraftFrame: AnimationDraftFrame | undefined;
let animationFileDraft: AnimationFileDraft | undefined;
let spriteEditorShortcutCleanup: (() => void) | undefined;
let animationOutsidePointerCleanup: (() => void) | undefined;
const animationEditHistory: AnimationHistoryEntry[] = [];

const SPRITE_FILE_LABELS = [
  "Front Sprite",
  "Front Female Sprite",
  "Front Rig",
  "Front Female Rig",
  "Front NCER Cells",
  "Front NANR Animation",
  "Front NMCR Multi-Cells",
  "Front NMAR Multi-Cell Animation",
  "Front NCEC Rig Cells",
  "Back Sprite",
  "Back Female Sprite",
  "Back Rig",
  "Back Female Rig",
  "Back NCER Cells",
  "Back NANR Animation",
  "Back NMCR Multi-Cells",
  "Back NMAR Multi-Cell Animation",
  "Back NCEC Rig Cells",
  "Palette",
  "Shiny Palette",
] as const;

const ANIMATION_PREVIEW_SCALE = 3;
const ANIMATION_CANVAS_WIDTH = 320;
const ANIMATION_CANVAS_HEIGHT = 400;
const ANIMATION_PREVIEW_X_OFFSET = 8;
const ANIMATION_PREVIEW_Y_OFFSET = 114;
const ANIMATION_ROTATE_HANDLE_RADIUS = 8;
const ANIMATION_ROTATE_HIT_RADIUS = 24;

export function renderPokemonSpriteEditor(
  project: ProjectState,
  root: HTMLElement,
  speciesId: number,
  formIndex: number,
  options: RenderOptions = {},
): void {
  stopAnimationPlayback();
  try {
    const forms = getPokemonSpriteFormOptions(project, speciesId);
    const selectedForm = forms.find((form) => form.formIndex === formIndex) ?? forms[0];
    const spriteId = selectedForm.spriteId;
    const entry = getPokemonSpriteEntry(project, spriteId);
    const iconAssignment = getPokemonIconPaletteAssignment(project, spriteId, state.iconVariant);
    state.iconPaletteId = Math.min(2, iconAssignment.paletteId);
    const rigCells = getRigCells(project, spriteId, state.rigSide);
    state.selectedCell = clamp(state.selectedCell, 0, Math.max(0, rigCells.cells.length - 1));
    const showAnimationHotkeys = hasSelectedAnimationPart(project, spriteId);

    root.innerHTML = `
      <aside class="pokemon-filter sprite-sidebar ${state.sidebarCollapsed ? "-collapsed" : ""}">
        <button class="sprite-sidebar-toggle" id="sprite-sidebar-toggle" type="button" aria-label="${state.sidebarCollapsed ? "Show sprite sidebar" : "Hide sprite sidebar"}" title="${state.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}">${state.sidebarCollapsed ? ">" : "<"}</button>
        <div class="sprite-sidebar-content">
          <div class="filter-title">Sprite Editor</div>
          <label class="sprite-field">
            <span>Pokemon</span>
            <select id="sprite-species-select">
              ${renderSpeciesOptions(project, speciesId)}
            </select>
          </label>
          ${renderFormSelector(forms, selectedForm.formIndex)}
          <div class="sprite-sidebar-group">
            <div class="sprite-sidebar-heading">Bundle</div>
            <label class="sprite-bundle-drop" id="sprite-bundle-drop">
              <input id="sprite-bundle-import" type="file" accept=".pkmonspritebundle">
              <strong>Import Bundle</strong>
              <span>Click or drop .pkmonspritebundle</span>
            </label>
          </div>
          <div class="sprite-sidebar-group">
            <div class="sprite-sidebar-heading">Raw Files</div>
            <label class="sprite-field">
              <span>File</span>
              <select id="raw-file-index">${SPRITE_FILE_LABELS.map((label, index) => `<option value="${index}">${index}: ${label}</option>`).join("")}</select>
            </label>
            <div class="sprite-actions -raw">
              <button class="btn -default" id="raw-export" type="button">Export</button>
              <label class="btn -default file-btn">Import<input id="raw-import" type="file"></label>
              <button class="btn -default" id="raw-dump" type="button">Dump All</button>
            </div>
          </div>
          <div class="sprite-status" id="sprite-status"></div>
          ${showAnimationHotkeys ? renderAnimationHotkeyHint() : ""}
        </div>
      </aside>
      <main class="sprite-editor-page ${state.sidebarCollapsed ? "-sidebar-collapsed" : ""}">
        ${renderAnimationSection(project, spriteId)}
        ${renderRigSection(project, rigCells)}
        <section class="sprite-section sprite-preview-section ${state.spritesExpanded ? "" : "-collapsed"}">
          <button class="sprite-section-toggle" data-toggle-sprite-section="sprites" type="button" aria-expanded="${state.spritesExpanded}">
            <span>${state.spritesExpanded ? "v" : ">"} Sprites</span>
          </button>
          ${state.spritesExpanded ? renderPreviewCanvases(project, entry.hasFemale) : ""}
        </section>
        <section class="sprite-section ${state.palettesExpanded ? "" : "-collapsed"}">
          <button class="sprite-section-toggle" data-toggle-sprite-section="palettes" type="button" aria-expanded="${state.palettesExpanded}">
            <span>${state.palettesExpanded ? "v" : ">"} Palettes</span>
          </button>
          ${state.palettesExpanded ? `<div class="palette-columns">
            ${renderPaletteEditor("normal", entry.palette)}
            ${renderPaletteEditor("shiny", entry.shinyPalette)}
          </div>` : ""}
        </section>
        <section class="sprite-section ${state.iconsExpanded ? "" : "-collapsed"}">
          <button class="sprite-section-toggle" data-toggle-sprite-section="icons" type="button" aria-expanded="${state.iconsExpanded}">
            <span>${state.iconsExpanded ? "v" : ">"} Icons</span>
          </button>
          ${state.iconsExpanded ? `<div class="icon-editor-grid">
            <div class="icon-preview-wrap"><canvas id="pokemon-icon-preview" width="32" height="64"></canvas></div>
            <div class="icon-controls">
              <label class="sprite-field"><span>Icon</span><select id="icon-variant"><option value="male" ${state.iconVariant === "male" ? "selected" : ""}>Male Icon</option><option value="female" ${state.iconVariant === "female" ? "selected" : ""}>Female Icon</option></select></label>
              <label class="sprite-field"><span>Palette</span><input id="icon-palette-id" type="number" min="0" max="2" value="${state.iconPaletteId}"></label>
              <button class="btn -default" id="icon-set-palette" type="button" ${iconAssignment.editable ? "" : "disabled"}>Set Palette</button>
              <button class="btn -default" id="icon-export-png" type="button">Export Icon</button>
              <label class="btn -default file-btn">Import Icon<input id="icon-import-png" type="file" accept="image/png"></label>
            </div>
            <div class="icon-palettes">${renderIconPalettes(getPokemonIconPalettes(project))}</div>
          </div>` : ""}
        </section>
      </main>
    `;
    attachSpriteEditor(project, root, speciesId, selectedForm.formIndex, spriteId, options);
    adjustAnimationCanvasDisplaySize(root);
    drawAllPreviews(project, spriteId, root);
    drawIconPreview(project, spriteId);
    drawRigEditor(project, spriteId, rigCells);
    drawAnimationEditor(project, spriteId, root);
    drawGifViewer(root);
    if (state.animationPlaying) startAnimationPlayback(project, spriteId, root);
    if (state.gifViewerPlaying) startGifViewerPlayback(root);
  } catch (error) {
    root.innerHTML = `<div class="sprite-editor-error"><button class="btn -default" id="sprite-back" type="button">Back</button><p>${escapeHtml(errorMessage(error))}</p></div>`;
    root.querySelector("#sprite-back")?.addEventListener("click", () => options.onBack?.());
  }
}

function attachSpriteEditor(project: ProjectState, root: HTMLElement, speciesId: number, formIndex: number, spriteId: number, options: RenderOptions): void {
  const status = root.querySelector<HTMLElement>("#sprite-status");
  let paletteHighlight: PaletteHighlight;
  const setStatus = (message: string) => {
    if (status) status.textContent = message;
  };
  const redrawPreviews = () => drawAllPreviews(project, spriteId, root, paletteHighlight);
  const rerender = () => renderPokemonSpriteEditor(project, root, speciesId, formIndex, options);
  installSpriteEditorShortcuts(project, root, spriteId, options, setStatus, rerender);
  root.querySelector("#sprite-sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    rerender();
  });
  root.querySelector("#sprite-back")?.addEventListener("click", () => options.onBack?.());
  root.querySelectorAll<HTMLButtonElement>("[data-toggle-sprite-section]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.toggleSpriteSection === "icons") state.iconsExpanded = !state.iconsExpanded;
      else if (button.dataset.toggleSpriteSection === "palettes") state.palettesExpanded = !state.palettesExpanded;
      else state.spritesExpanded = !state.spritesExpanded;
      rerender();
    });
  });
  root.querySelector<HTMLSelectElement>("#sprite-species-select")?.addEventListener("change", (event) => {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    if (Number.isInteger(value)) options.onNavigateSpecies?.(value);
  });
  root.querySelector<HTMLSelectElement>("#sprite-form-select")?.addEventListener("change", (event) => {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    options.onNavigateForm?.(value);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-form-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.formTab);
      options.onNavigateForm?.(value);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-preview-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewPaletteKind = button.dataset.previewPalette as PokemonPaletteKind;
      rerender();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-export-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        const variant = parseVariant(String(button.dataset.exportPreview ?? ""));
        const image = getPokemonSpriteImage(project, spriteId, variant, state.previewPaletteKind);
        downloadPng(image, `${spriteFileBaseName(spriteId)}_${variantValue(variant)}_${state.previewPaletteKind}.png`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-import-preview]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const variant = parseVariant(String(input.dataset.importPreview ?? ""));
        setPokemonSpriteImage(project, spriteId, variant, state.previewPaletteKind, await imageFileToRgba(file));
        options.onDirty?.();
        setStatus(`Imported ${variantLabel(variant)} ${state.previewPaletteKind} PNG`);
        rerender();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-apply-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        const kind = button.dataset.applyPalette as PokemonPaletteKind;
        setPokemonPalette(project, spriteId, kind, readPaletteInputs(root, kind));
        options.onDirty?.();
        setStatus(`Applied ${kind} palette`);
        rerender();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-export-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.exportPalette as PokemonPaletteKind;
      downloadPng(paletteToImage(getPokemonPalettes(project, spriteId)[kind]), `${spriteFileBaseName(spriteId)}_${kind}_palette.png`);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-import-palette]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const kind = input.dataset.importPalette as PokemonPaletteKind;
        setPokemonPalette(project, spriteId, kind, imageToPalette(await imageFileToRgba(file)));
        options.onDirty?.();
        setStatus(`Imported ${kind} palette`);
        rerender();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-palette-picker]").forEach((picker) => {
    picker.addEventListener("input", () => {
      syncPalettePicker(root, picker);
      redrawPreviews();
    });
    picker.addEventListener("change", () => {
      syncPalettePicker(root, picker);
      redrawPreviews();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-palette][data-channel]").forEach((input) => {
    input.addEventListener("input", () => {
      syncPaletteNumber(root, input);
      redrawPreviews();
    });
    input.addEventListener("change", () => {
      syncPaletteNumber(root, input);
      redrawPreviews();
    });
  });
  root.querySelectorAll<HTMLElement>(".palette-swatch[data-palette-kind][data-color]").forEach((swatch) => {
    swatch.addEventListener("mouseenter", () => {
      const kind = swatch.dataset.paletteKind as PokemonPaletteKind;
      paletteHighlight = { kind, index: Number(swatch.dataset.color ?? 0) };
      redrawPreviews();
    });
    swatch.addEventListener("mouseleave", () => {
      paletteHighlight = undefined;
      redrawPreviews();
    });
  });

  root.querySelector<HTMLSelectElement>("#icon-variant")?.addEventListener("change", (event) => {
    state.iconVariant = (event.currentTarget as HTMLSelectElement).value as PokemonIconVariant;
    rerender();
  });
  root.querySelector<HTMLInputElement>("#icon-palette-id")?.addEventListener("change", (event) => {
    state.iconPaletteId = clamp(Number((event.currentTarget as HTMLInputElement).value), 0, 2);
    drawIconPreview(project, spriteId);
  });
  root.querySelector("#icon-set-palette")?.addEventListener("click", () => {
    try {
      setPokemonIconPaletteAssignment(project, spriteId, state.iconVariant, state.iconPaletteId);
      options.onDirty?.();
      setStatus("Updated icon palette assignment");
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelector("#icon-export-png")?.addEventListener("click", () => {
    try {
      downloadPng(getPokemonIconImage(project, spriteId, state.iconVariant, state.iconPaletteId), `${spriteFileBaseName(spriteId)}_${state.iconVariant}_icon.png`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelector<HTMLInputElement>("#icon-import-png")?.addEventListener("change", async (event) => {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      setPokemonIconImage(project, spriteId, state.iconVariant, state.iconPaletteId, await imageFileToRgba(file));
      options.onDirty?.();
      setStatus("Imported icon PNG");
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-export-icon-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      const paletteId = Number(button.dataset.exportIconPalette);
      downloadPng(paletteToImage(getPokemonIconPalettes(project)[paletteId]), `${spriteFileBaseName(spriteId)}_icon_palette_${paletteId}.png`);
    });
  });

  installRigSideEvents(project, root, spriteId, options, setStatus, rerender);
  installRigEvents(project, root, spriteId, options, setStatus, rerender);
  installAnimationEvents(project, root, spriteId, options, setStatus, rerender);
  installRawFileEvents(project, root, spriteId, options, setStatus, rerender);
  installBundleImportEvents(project, root, spriteId, options, setStatus, rerender);
  installGifFlipbookImportEvents(project, root, spriteId, options, setStatus, rerender);
}

function installGifFlipbookImportEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const importGif = async (file: File) => {
    try {
      setStatus(`Building flipbook rig from ${file.name}...`);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const config = readGifFlipbookConfig(root, project);
      const paletteKind = readGifFlipbookPaletteKind(root);
      state.gifSource = { spriteId, side: config.side, fileName: file.name, bytes, frames: decodePokemonFlipbookGifFrames(bytes) };
      state.gifViewerFrame = 0;
      state.gifViewerPlaying = false;
      const result = buildPokemonFlipbookRigFromGif(bytes, config);
      applyGifFlipbookBuildResult(project, spriteId, config, paletteKind, result, file.name);
      state.gifManualFrames = result.report.selectedSourceFrames.join(", ");
      const warnings = result.report.warnings.length ? `; ${result.report.warnings.length} warning(s)` : "";
      setStatus(
        `Imported ${config.side} ${paletteKind} GIF: ${result.report.uniquePoseCount} pose(s), ${result.report.uniqueTileCount} tile(s), ${result.report.packingMode}, duplicated female variant, max ${result.report.maxOamsPerPose} OAM(s), ${result.report.visibilityValidation.invisibleFrameCount} invisible frame(s)${warnings}`,
      );
      options.onDirty?.();
      refreshGifImportEditorContent(project, root, spriteId, options, setStatus, rerender);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  let pairedFrontFile: File | undefined;
  let pairedBackFile: File | undefined;
  const setPairedFile = (side: PokemonAnimationSide, file: File | undefined) => {
    if (side === "front") pairedFrontFile = file;
    else pairedBackFile = file;
    const label = root.querySelector<HTMLElement>(`[data-gif-pair-name='${side}']`);
    if (label) label.textContent = file?.name ?? `Drop ${side} GIF`;
  };
  const importPairedGifs = async () => {
    const frontFile = pairedFrontFile ?? root.querySelector<HTMLInputElement>("#gif-pair-front-import")?.files?.[0];
    const backFile = pairedBackFile ?? root.querySelector<HTMLInputElement>("#gif-pair-back-import")?.files?.[0];
    if (!frontFile || !backFile) {
      setStatus("Choose both a front GIF and a back GIF before importing a paired palette.");
      return;
    }
    try {
      setStatus(`Building paired flipbook rigs from ${frontFile.name} and ${backFile.name}...`);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const singleConfig = readGifFlipbookConfig(root, project);
      const pairedConfig = {
        strategy: singleConfig.strategy,
        packingMode: singleConfig.packingMode,
        sourceFramePercent: singleConfig.sourceFramePercent,
        maxUniqueFrames: singleConfig.maxUniqueFrames,
        restLoopCount: singleConfig.restLoopCount,
        includeFinish: singleConfig.includeFinish,
        maxAtlasTiles: singleConfig.maxAtlasTiles,
        atlasWidth: singleConfig.atlasWidth,
        atlasHeight: singleConfig.atlasHeight,
        durationScale: singleConfig.durationScale,
        downscalePercent: singleConfig.downscalePercent,
      };
      const paletteKind = readGifFlipbookPaletteKind(root);
      const result = buildPairedPokemonFlipbookRigsFromGifs(
        new Uint8Array(await frontFile.arrayBuffer()),
        new Uint8Array(await backFile.arrayBuffer()),
        pairedConfig,
      );
      setPokemonPalette(project, spriteId, paletteKind, result.palette);
      for (const [side, sideResult] of [["front", result.front], ["back", result.back]] as const) {
        setPokemonSpriteImage(project, spriteId, { kind: "sprite", side, gender: "male" }, paletteKind, sideResult.sprite);
        setPokemonSpriteImage(project, spriteId, { kind: "rig", side, gender: "male" }, paletteKind, sideResult.rig);
        copyPokemonSpriteVariant(project, spriteId, { kind: "sprite", side, gender: "male" }, { kind: "sprite", side, gender: "female" });
        copyPokemonSpriteVariant(project, spriteId, { kind: "rig", side, gender: "male" }, { kind: "rig", side, gender: "female" });
        importPokemonAnimationBundle(project, spriteId, sideResult.bundle);
      }
      state.gifLoopBase = captureGifLoopBase(project, spriteId, "front");
      state.gifLoopStartFrame = 1;
      state.gifLoopEndFrame = Math.max(1, state.gifLoopBase.sequences[0]?.length ?? result.front.report.timelineFrames.length);
      state.gifLoopCount = 1;
      state.previewPaletteKind = paletteKind;
      state.rigSide = "front";
      state.selectedCell = 0;
      state.selectedSubCell = false;
      state.animationSide = "front";
      state.animationMultiCell = 0;
      state.animationSequence = 0;
      state.animationFrame = 0;
      state.animationTick = 0;
      state.animationPlaying = false;
      state.animationActiveNode = -1;
      state.animationVisibleNode = -1;
      animationDragState = undefined;
      animationDraftFrame = undefined;
      state.lastGifImport = { spriteId, fileName: `${frontFile.name} + ${backFile.name}`, side: "front", paletteKind, speedScale: state.gifFlipbookSpeedScale, report: result.front.report };
      options.onDirty?.();
      const warningCount = result.front.report.warnings.length + result.back.report.warnings.length;
      setStatus(
        `Imported paired ${paletteKind} GIFs with one palette: front ${result.front.report.uniquePoseCount} pose(s), back ${result.back.report.uniquePoseCount} pose(s), ${warningCount} warning(s)`,
      );
      refreshGifImportEditorContent(project, root, spriteId, options, setStatus, rerender);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const drop = root.querySelector<HTMLElement>("#gif-flipbook-drop");
  const input = root.querySelector<HTMLInputElement>("#gif-flipbook-import");
  const pairButton = root.querySelector<HTMLButtonElement>("#gif-pair-import");
  root.querySelectorAll<HTMLButtonElement>("[data-gif-flipbook-side]").forEach((button) => {
    button.addEventListener("click", () => {
      state.animationSide = button.dataset.gifFlipbookSide === "back" ? "back" : "front";
      syncGifSegmentedButtons(root, "gifFlipbookSide", state.animationSide);
      syncGifFlipbookStats(project, root, spriteId);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-gif-flipbook-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewPaletteKind = button.dataset.gifFlipbookPalette === "shiny" ? "shiny" : "normal";
      syncGifSegmentedButtons(root, "gifFlipbookPalette", state.previewPaletteKind);
      drawAllPreviews(project, spriteId, root);
      drawAnimationEditor(project, spriteId, root);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-gif-flipbook-packing-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.gifFlipbookPackingMode = readGifFlipbookPackingModeValue(button.dataset.gifFlipbookPackingMode);
      writeGifFlipbookPackingModePreference(state.gifFlipbookPackingMode);
      syncGifSegmentedButtons(root, "gifFlipbookPackingMode", state.gifFlipbookPackingMode);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-gif-flipbook-strategy]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.gifFlipbookStrategy;
      state.gifFlipbookStrategy = value === "first-window" || value === "even" ? value : "loop-rest";
      writeGifFlipbookStrategyPreference(state.gifFlipbookStrategy);
      syncGifSegmentedButtons(root, "gifFlipbookStrategy", state.gifFlipbookStrategy);
    });
  });
  root.querySelector<HTMLInputElement>("#gif-flipbook-speed-scale")?.addEventListener("input", (event) => {
    const next = normalizeGifFlipbookSpeedScale(Number((event.currentTarget as HTMLInputElement).value));
    const label = root.querySelector<HTMLElement>("#gif-flipbook-speed-label");
    if (label) label.textContent = `${formatSpeedScale(next)}x`;
    applyGifFlipbookSpeedScale(project, root, spriteId, next, options, setStatus, false);
  });
  root.querySelector<HTMLInputElement>("#gif-flipbook-speed-scale")?.addEventListener("change", (event) => {
    const next = normalizeGifFlipbookSpeedScale(Number((event.currentTarget as HTMLInputElement).value));
    applyGifFlipbookSpeedScale(project, root, spriteId, next, options, setStatus, true);
  });
  root.querySelector<HTMLInputElement>("#gif-flipbook-downscale-percent")?.addEventListener("change", (event) => {
    const next = normalizeGifFlipbookDownscalePercent(Number((event.currentTarget as HTMLInputElement).value));
    state.gifFlipbookDownscalePercent = next;
    writeGifFlipbookDownscalePreference(next);
    (event.currentTarget as HTMLInputElement).value = String(next);
    setStatus(`Set GIF import downscale to ${next}%`);
  });
  root.querySelectorAll<HTMLInputElement>("[data-gif-loop-field]").forEach((input) => {
    input.addEventListener("change", () => {
      applyGifTimelineLoop(project, root, spriteId, options, setStatus, rerender);
    });
  });
  root.querySelector("#gif-manual-apply")?.addEventListener("click", () => {
    applyManualGifSampling(project, root, spriteId, options, setStatus, rerender);
  });
  root.querySelector<HTMLInputElement>("#gif-manual-frames")?.addEventListener("change", () => {
    applyManualGifSampling(project, root, spriteId, options, setStatus, rerender);
  });
  root.querySelector<HTMLInputElement>("#gif-viewer-frame")?.addEventListener("input", (event) => {
    state.gifViewerFrame = clamp(Number((event.currentTarget as HTMLInputElement).value), 0, Math.max(0, (state.gifSource?.frames.length ?? 1) - 1));
    drawGifViewer(root);
  });
  root.querySelector<HTMLInputElement>("#gif-viewer-number")?.addEventListener("change", (event) => {
    state.gifViewerFrame = clamp(Number((event.currentTarget as HTMLInputElement).value), 0, Math.max(0, (state.gifSource?.frames.length ?? 1) - 1));
    state.gifViewerPlaying = false;
    stopGifViewerPlayback();
    drawGifViewer(root);
  });
  root.querySelector("#gif-viewer-prev")?.addEventListener("click", () => {
    state.gifViewerFrame = clamp(state.gifViewerFrame - 1, 0, Math.max(0, (state.gifSource?.frames.length ?? 1) - 1));
    state.gifViewerPlaying = false;
    stopGifViewerPlayback();
    drawGifViewer(root);
    syncGifViewerControls(root);
  });
  root.querySelector("#gif-viewer-next")?.addEventListener("click", () => {
    state.gifViewerFrame = clamp(state.gifViewerFrame + 1, 0, Math.max(0, (state.gifSource?.frames.length ?? 1) - 1));
    state.gifViewerPlaying = false;
    stopGifViewerPlayback();
    drawGifViewer(root);
    syncGifViewerControls(root);
  });
  root.querySelector("#gif-viewer-play")?.addEventListener("click", () => {
    state.gifViewerPlaying = !state.gifViewerPlaying;
    syncGifViewerControls(root);
    if (state.gifViewerPlaying) startGifViewerPlayback(root);
    else stopGifViewerPlayback();
  });
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (file) await importGif(file);
  });
  pairButton?.addEventListener("click", importPairedGifs);
  (["front", "back"] as const).forEach((side) => {
    const pairInput = root.querySelector<HTMLInputElement>(`#gif-pair-${side}-import`);
    const pairDrop = root.querySelector<HTMLElement>(`#gif-pair-${side}-drop`);
    pairInput?.addEventListener("change", () => setPairedFile(side, pairInput.files?.[0]));
    pairDrop?.addEventListener("dragover", (event) => {
      event.preventDefault();
      pairDrop.classList.add("-dragging");
    });
    pairDrop?.addEventListener("dragleave", () => {
      pairDrop.classList.remove("-dragging");
    });
    pairDrop?.addEventListener("drop", async (event) => {
      event.preventDefault();
      pairDrop.classList.remove("-dragging");
      setPairedFile(side, event.dataTransfer?.files?.[0]);
      if (pairedFrontFile && pairedBackFile) await importPairedGifs();
    });
  });
  drop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("-dragging");
  });
  drop?.addEventListener("dragleave", () => {
    drop.classList.remove("-dragging");
  });
  drop?.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) await importGif(file);
  });
}

function applyGifFlipbookBuildResult(
  project: ProjectState,
  spriteId: number,
  config: PokemonFlipbookImportConfig,
  paletteKind: PokemonPaletteKind,
  result: ReturnType<typeof buildPokemonFlipbookRigFromGif>,
  fileName: string,
): void {
  setPokemonPalette(project, spriteId, paletteKind, result.palette);
  setPokemonSpriteImage(project, spriteId, { kind: "sprite", side: config.side, gender: "male" }, paletteKind, result.sprite);
  setPokemonSpriteImage(project, spriteId, { kind: "rig", side: config.side, gender: "male" }, paletteKind, result.rig);
  copyPokemonSpriteVariant(project, spriteId, { kind: "sprite", side: config.side, gender: "male" }, { kind: "sprite", side: config.side, gender: "female" });
  copyPokemonSpriteVariant(project, spriteId, { kind: "rig", side: config.side, gender: "male" }, { kind: "rig", side: config.side, gender: "female" });
  importPokemonAnimationBundle(project, spriteId, result.bundle);
  state.gifLoopBase = captureGifLoopBase(project, spriteId, config.side);
  state.gifLoopStartFrame = 1;
  state.gifLoopEndFrame = Math.max(1, state.gifLoopBase.sequences[0]?.length ?? result.report.timelineFrames.length);
  state.gifLoopCount = 1;
  state.previewPaletteKind = paletteKind;
  state.rigSide = config.side;
  state.selectedCell = 0;
  state.selectedSubCell = false;
  state.animationSide = config.side;
  state.animationMultiCell = 0;
  state.animationSequence = 0;
  state.animationFrame = 0;
  state.animationTick = 0;
  state.animationPlaying = false;
  state.animationActiveNode = -1;
  state.animationVisibleNode = -1;
  animationDragState = undefined;
  animationDraftFrame = undefined;
  state.lastGifImport = { spriteId, fileName, side: config.side, paletteKind, speedScale: state.gifFlipbookSpeedScale, report: result.report };
}

function applyManualGifSampling(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  try {
    const source = state.gifSource;
    if (!source || source.spriteId !== spriteId) throw new Error("Import a GIF first before applying manual frame numbers");
    const input = root.querySelector<HTMLInputElement>("#gif-manual-frames");
    state.gifManualFrames = input?.value ?? state.gifManualFrames;
    const manualFrameNumbers = parseManualGifFrameNumbers(state.gifManualFrames);
    const config = { ...readGifFlipbookConfig(root, project), manualFrameNumbers };
    const paletteKind = readGifFlipbookPaletteKind(root);
    state.gifSource = { ...source, side: config.side };
    const result = buildPokemonFlipbookRigFromGif(source.bytes, config);
    applyGifFlipbookBuildResult(project, spriteId, config, paletteKind, result, source.fileName);
    state.gifManualFrames = result.report.timelineFrames.join(", ");
    options.onDirty?.();
    setStatus(`Applied manual GIF frames: ${result.report.timelineFrames.join(", ")}`);
    refreshGifImportEditorContent(project, root, spriteId, options, setStatus, rerender);
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

function parseManualGifFrameNumbers(value: string): number[] {
  const frames = value
    .split(/[\s,]+/u)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  if (!frames.length) throw new Error("Enter at least one GIF frame number for manual sampling");
  return frames;
}

function drawGifViewer(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#gif-viewer-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f2333";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const source = state.gifSource;
  if (!source || !source.frames.length) {
    ctx.fillStyle = "#c9c9d3";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Import a GIF to inspect frames", canvas.width / 2, canvas.height / 2);
    syncGifViewerControls(root);
    return;
  }
  state.gifViewerFrame = clamp(state.gifViewerFrame, 0, source.frames.length - 1);
  const frame = source.frames[state.gifViewerFrame];
  const image = document.createElement("canvas");
  image.width = frame.width;
  image.height = frame.height;
  const imageCtx = image.getContext("2d");
  if (imageCtx) {
    imageCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    const scale = Math.max(1, Math.floor(Math.min((canvas.width - 16) / frame.width, (canvas.height - 16) / frame.height)));
    const width = frame.width * scale;
    const height = frame.height * scale;
    ctx.drawImage(image, Math.floor((canvas.width - width) / 2), Math.floor((canvas.height - height) / 2), width, height);
  }
  syncGifViewerControls(root);
}

function syncGifViewerControls(root: HTMLElement): void {
  const source = state.gifSource;
  const frameCount = source?.frames.length ?? 0;
  const label = root.querySelector<HTMLElement>("#gif-viewer-label");
  const range = root.querySelector<HTMLInputElement>("#gif-viewer-frame");
  const number = root.querySelector<HTMLInputElement>("#gif-viewer-number");
  const play = root.querySelector<HTMLButtonElement>("#gif-viewer-play");
  const disabled = frameCount === 0;
  root.querySelectorAll<HTMLButtonElement>("#gif-viewer-prev, #gif-viewer-play, #gif-viewer-next").forEach((button) => {
    button.disabled = disabled;
  });
  if (range) {
    range.disabled = disabled;
    range.max = String(Math.max(0, frameCount - 1));
    range.value = String(clamp(state.gifViewerFrame, 0, Math.max(0, frameCount - 1)));
  }
  if (number) {
    number.disabled = disabled;
    number.max = String(Math.max(0, frameCount - 1));
    number.value = String(clamp(state.gifViewerFrame, 0, Math.max(0, frameCount - 1)));
  }
  if (play) play.textContent = state.gifViewerPlaying ? "Pause" : "Play";
  if (label) {
    label.textContent = frameCount
      ? `${state.gifViewerFrame}/${frameCount - 1} · ${source?.fileName ?? "GIF"}`
      : "No GIF loaded";
  }
}

function startGifViewerPlayback(root: HTMLElement): void {
  stopGifViewerPlayback();
  const tick = () => {
    const source = state.gifSource;
    if (!state.gifViewerPlaying || !source?.frames.length) return;
    state.gifViewerFrame = (state.gifViewerFrame + 1) % source.frames.length;
    drawGifViewer(root);
    const delay = clamp(source.frames[state.gifViewerFrame]?.delayMs ?? 100, 20, 1000);
    gifViewerPlaybackHandle = window.setTimeout(tick, delay);
  };
  tick();
}

function stopGifViewerPlayback(): void {
  if (gifViewerPlaybackHandle !== undefined) window.clearTimeout(gifViewerPlaybackHandle);
  gifViewerPlaybackHandle = undefined;
}

function installRigSideEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-rig-side]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSide = button.dataset.rigSide as "front" | "back";
      if (state.rigSide === nextSide) return;
      state.rigSide = nextSide;
      state.selectedCell = 0;
      state.selectedSubCell = false;
      refreshRigSectionContent(project, root, spriteId, options, setStatus, rerender);
    });
  });
}

function applyGifFlipbookSpeedScale(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  nextSpeed: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  announce: boolean,
): void {
  const previous = state.gifFlipbookSpeedScale;
  const next = normalizeGifFlipbookSpeedScale(nextSpeed);
  state.gifFlipbookSpeedScale = next;
  writeGifFlipbookSpeedPreference(next);
  const lastImport = state.lastGifImport?.spriteId === spriteId ? state.lastGifImport : undefined;
  if (lastImport && Math.abs(previous - next) > 0.001) {
    const ratio = previous / next;
    scalePokemonAnimationDurations(project, spriteId, lastImport.side, ratio);
    scaleGifLoopBaseDurations(spriteId, lastImport.side, ratio);
    state.lastGifImport = {
      ...lastImport,
      speedScale: next,
      report: { ...lastImport.report, durationScale: durationScaleForGifSpeed(next) },
    };
    syncLastGifSpeedLabel(root, next);
    if (state.animationSide === lastImport.side) {
      syncAnimationPreviewAfterDurationChange(project, root, spriteId);
    }
    options.onDirty?.();
  }
  if (announce) setStatus(`Set imported GIF animation speed to ${formatSpeedScale(next)}x`);
}

function applyGifTimelineLoop(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  try {
    const base = ensureGifLoopBase(project, spriteId, state.animationSide);
    const frameCount = Math.max(1, base.sequences[0]?.length ?? 1);
    const startInput = root.querySelector<HTMLInputElement>("[data-gif-loop-field='start']");
    const endInput = root.querySelector<HTMLInputElement>("[data-gif-loop-field='end']");
    const countInput = root.querySelector<HTMLInputElement>("[data-gif-loop-field='count']");
    state.gifLoopStartFrame = clamp(Number(startInput?.value ?? state.gifLoopStartFrame), 1, frameCount);
    state.gifLoopEndFrame = clamp(Number(endInput?.value ?? state.gifLoopEndFrame), state.gifLoopStartFrame, frameCount);
    state.gifLoopCount = clamp(Number(countInput?.value ?? state.gifLoopCount), 1, 12);
    if (startInput) startInput.value = String(state.gifLoopStartFrame);
    if (endInput) endInput.value = String(state.gifLoopEndFrame);
    if (countInput) countInput.value = String(state.gifLoopCount);
    const nextSequences = base.sequences.map((sequence) => loopFrameSequence(sequence, state.gifLoopStartFrame, state.gifLoopEndFrame, state.gifLoopCount));
    rewritePokemonAnimationSequences(project, spriteId, base.side, nextSequences);
    state.animationSide = base.side;
    state.animationTick = 0;
    state.animationFrame = 0;
    state.animationPlaying = false;
    options.onDirty?.();
    refreshAnimationSectionContent(project, root, spriteId, options, setStatus, rerender);
    setStatus(`Looped frames ${state.gifLoopStartFrame}-${state.gifLoopEndFrame} x${state.gifLoopCount}`);
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

function loopFrameSequence(sequence: PokemonAnimationFrameEdit[], startFrame: number, endFrame: number, loopCount: number): PokemonAnimationFrameEdit[] {
  if (sequence.length === 0) return [];
  const start = clamp(Math.round(startFrame), 1, sequence.length) - 1;
  const end = clamp(Math.round(endFrame), start + 1, sequence.length);
  const before = sequence.slice(0, start).map((frame) => ({ ...frame }));
  const loop = sequence.slice(start, end).map((frame) => ({ ...frame }));
  const after = sequence.slice(end).map((frame) => ({ ...frame }));
  return [...before, ...Array.from({ length: Math.max(1, Math.round(loopCount)) }).flatMap(() => loop.map((frame) => ({ ...frame }))), ...after];
}

function ensureGifLoopBase(project: ProjectState, spriteId: number, side: PokemonAnimationSide): GifLoopBase {
  if (state.gifLoopBase?.spriteId === spriteId && state.gifLoopBase.side === side) return state.gifLoopBase;
  state.gifLoopBase = captureGifLoopBase(project, spriteId, side);
  state.gifLoopStartFrame = 1;
  state.gifLoopEndFrame = Math.max(1, state.gifLoopBase.sequences[0]?.length ?? 1);
  state.gifLoopCount = 1;
  return state.gifLoopBase;
}

function captureGifLoopBase(project: ProjectState, spriteId: number, side: PokemonAnimationSide): GifLoopBase {
  const animation = getPokemonAnimation(project, spriteId, side);
  return {
    spriteId,
    side,
    sequences: animation.sequences.map((sequence) => sequence.frames.map(animationFrameEdit)),
  };
}

function scaleGifLoopBaseDurations(spriteId: number, side: PokemonAnimationSide, ratio: number): void {
  if (state.gifLoopBase?.spriteId !== spriteId || state.gifLoopBase.side !== side) return;
  state.gifLoopBase = {
    ...state.gifLoopBase,
    sequences: state.gifLoopBase.sequences.map((sequence) => sequence.map((frame) => ({ ...frame, duration: clamp(Math.round(frame.duration * ratio), 1, 0xffff) }))),
  };
}

function gifLoopBaseFrameCount(project: ProjectState, spriteId: number, side: PokemonAnimationSide): number {
  try {
    if (state.gifLoopBase?.spriteId === spriteId && state.gifLoopBase.side === side) return Math.max(1, state.gifLoopBase.sequences[0]?.length ?? 1);
    return Math.max(1, getPokemonAnimation(project, spriteId, side).sequences[0]?.frames.length ?? 1);
  } catch {
    return 1;
  }
}

function refreshAnimationSectionContent(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const animationSection = root.querySelector<HTMLElement>("#sprite-animation-section");
  if (animationSection) animationSection.outerHTML = renderAnimationSection(project, spriteId);
  installAnimationEvents(project, root, spriteId, options, setStatus, rerender);
  installGifFlipbookImportEvents(project, root, spriteId, options, setStatus, rerender);
  adjustAnimationCanvasDisplaySize(root);
  drawAnimationEditor(project, spriteId, root);
  drawGifViewer(root);
}

function refreshRigSectionContent(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const rigCells = getRigCells(project, spriteId, state.rigSide);
  state.selectedCell = clamp(state.selectedCell, 0, Math.max(0, rigCells.cells.length - 1));
  const rigSection = root.querySelector<HTMLElement>("#sprite-rig-section");
  if (rigSection) rigSection.outerHTML = renderRigSection(project, rigCells);
  installRigSideEvents(project, root, spriteId, options, setStatus, rerender);
  installRigEvents(project, root, spriteId, options, setStatus, rerender);
  drawRigEditor(project, spriteId, rigCells);
}

function syncAnimationPreviewAfterDurationChange(project: ProjectState, root: HTMLElement, spriteId: number): void {
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
    const maxTick = animationTimelineMaxTick(project, spriteId, animation, sequence);
    state.animationTick = clamp(state.animationTick, 0, maxTick);
    state.animationFrame = sequence ? animationPlayerFrameAtTick(sequence, state.animationTick) : 0;
    const slider = root.querySelector<HTMLInputElement>("#animation-frame");
    if (slider) slider.max = String(maxTick);
    syncAnimationFrameControl(root);
    syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
    drawAnimationEditor(project, spriteId, root);
  } catch {
    // The GIF speed preference still applies to the next import even if the current preview cannot be parsed.
  }
}

function syncAnimationPlaybackButton(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("#animation-play");
  if (!button) return;
  const label = state.animationPlaying ? "Pause" : "Play";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const icon = button.querySelector<HTMLElement>(".animation-icon");
  if (!icon) return;
  icon.classList.toggle("-play", !state.animationPlaying);
  icon.classList.toggle("-pause", state.animationPlaying);
}

function syncLastGifSpeedLabel(root: HTMLElement, speedScale: number): void {
  const label = root.querySelector<HTMLElement>("#last-gif-speed-label");
  if (label) label.textContent = `${formatSpeedScale(speedScale)}x speed`;
}

function refreshGifImportEditorContent(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  syncGifFlipbookStats(project, root, spriteId);
  drawAllPreviews(project, spriteId, root);
  try {
    const rigCells = getRigCells(project, spriteId, state.rigSide);
    state.selectedCell = clamp(state.selectedCell, 0, Math.max(0, rigCells.cells.length - 1));
    const rigSection = root.querySelector<HTMLElement>("#sprite-rig-section");
    if (rigSection) rigSection.outerHTML = renderRigSection(project, rigCells);
    const animationSection = root.querySelector<HTMLElement>("#sprite-animation-section");
    if (animationSection) animationSection.outerHTML = renderAnimationSection(project, spriteId);
    installRigSideEvents(project, root, spriteId, options, setStatus, rerender);
    installRigEvents(project, root, spriteId, options, setStatus, rerender);
    installAnimationEvents(project, root, spriteId, options, setStatus, rerender);
    installGifFlipbookImportEvents(project, root, spriteId, options, setStatus, rerender);
    adjustAnimationCanvasDisplaySize(root);
    drawRigEditor(project, spriteId, rigCells);
    drawAnimationEditor(project, spriteId, root);
    drawGifViewer(root);
  } catch {
    rerender();
  }
}

function syncGifFlipbookStats(project: ProjectState, root: HTMLElement, spriteId: number): void {
  const stats = root.querySelector<HTMLElement>(".gif-flipbook-stats");
  if (!stats) return;
  const currentOams = currentSideOamSummary(project, spriteId, state.animationSide);
  const lastImport = state.lastGifImport?.spriteId === spriteId ? state.lastGifImport : undefined;
  stats.innerHTML = `
    <div>
      <span>Current ${state.animationSide}</span>
      <strong>${currentOams.maxOamsPerCell}</strong>
      <small>max OAMs/cell across ${currentOams.cellCount} cell(s)</small>
    </div>
    ${lastImport ? renderLastGifImportStats(lastImport) : "<p>No GIF imported in this editor session.</p>"}
  `;
  syncGifLoopControlInputs(project, root, spriteId);
}

function syncGifLoopControlInputs(project: ProjectState, root: HTMLElement, spriteId: number): void {
  const frameCount = gifLoopBaseFrameCount(project, spriteId, state.animationSide);
  const start = root.querySelector<HTMLInputElement>("[data-gif-loop-field='start']");
  const end = root.querySelector<HTMLInputElement>("[data-gif-loop-field='end']");
  const count = root.querySelector<HTMLInputElement>("[data-gif-loop-field='count']");
  if (start) {
    start.max = String(frameCount);
    start.value = String(clamp(state.gifLoopStartFrame, 1, frameCount));
  }
  if (end) {
    end.max = String(frameCount);
    end.value = String(clamp(state.gifLoopEndFrame, 1, frameCount));
  }
  if (count) count.value = String(clamp(state.gifLoopCount, 1, 12));
}

function readGifFlipbookConfig(root: HTMLElement, project?: ProjectState): PokemonFlipbookImportConfig {
  const side = state.animationSide;
  const config = defaultPokemonFlipbookImportConfig(side);
  const rigAtlas = project ? getPokemonRigAtlasDimensions(project) : undefined;
  config.strategy = state.gifFlipbookStrategy;
  config.packingMode = state.gifFlipbookPackingMode;
  config.sourceFramePercent = clamp(Number(root.querySelector<HTMLInputElement>("#gif-flipbook-source-percent")?.value ?? config.sourceFramePercent), 1, 100);
  config.downscalePercent = normalizeGifFlipbookDownscalePercent(Number(root.querySelector<HTMLInputElement>("#gif-flipbook-downscale-percent")?.value ?? state.gifFlipbookDownscalePercent));
  state.gifFlipbookDownscalePercent = config.downscalePercent;
  writeGifFlipbookDownscalePreference(config.downscalePercent);
  config.atlasWidth = rigAtlas?.width ?? config.atlasWidth;
  config.atlasHeight = rigAtlas?.height ?? config.atlasHeight;
  config.maxAtlasTiles = (config.atlasWidth / 8) * (config.atlasHeight / 8);
  config.durationScale = durationScaleForGifSpeed(state.gifFlipbookSpeedScale);
  const restLoop = root.querySelector<HTMLSelectElement>("#gif-flipbook-rest-loops")?.value ?? "auto";
  config.restLoopCount = restLoop === "1" || restLoop === "2" || restLoop === "3" ? (Number(restLoop) as 1 | 2 | 3) : "auto";
  config.includeFinish = Boolean(root.querySelector<HTMLInputElement>("#gif-flipbook-include-finish")?.checked);
  return config;
}

function syncGifSegmentedButtons(root: HTMLElement, datasetKey: "gifFlipbookPackingMode" | "gifFlipbookStrategy" | "gifFlipbookSide" | "gifFlipbookPalette", activeValue: string): void {
  root.querySelectorAll<HTMLButtonElement>(`[data-${camelToKebab(datasetKey)}]`).forEach((button) => {
    const isActive = button.dataset[datasetKey] === activeValue;
    button.classList.toggle("-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function readGifFlipbookPaletteKind(root: HTMLElement): PokemonPaletteKind {
  return state.previewPaletteKind;
}

function installSpriteEditorShortcuts(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  spriteEditorShortcutCleanup?.();
  const onKeydown = (event: KeyboardEvent) => {
    if (!root.isConnected) {
      spriteEditorShortcutCleanup?.();
      return;
    }
    if (isEditableShortcutTarget(event.target)) return;
    if (isUndoShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      performAnimationUndo(project, spriteId, options, setStatus, rerender);
      return;
    }
    if (isAnimationArrowShortcut(event)) {
      const handled = performAnimationKeyboardEdit(project, root, spriteId, event, setStatus);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
  document.addEventListener("keydown", onKeydown, { capture: true });
  spriteEditorShortcutCleanup = () => {
    document.removeEventListener("keydown", onKeydown, { capture: true });
    spriteEditorShortcutCleanup = undefined;
  };
}

function installRigEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#rig-cells-canvas");
  const loadCells = () => getRigCells(project, spriteId, state.rigSide);
  let drag: RigDragState | undefined;
  if (!canvas) return;
  const updateNumeric = (cells: RigCellsFile) => {
    const cell = selectedRigCell(cells);
    root.querySelectorAll<HTMLInputElement>("[data-rig-field]").forEach((input) => {
      const field = input.dataset.rigField as keyof RigCell;
      input.value = String(cell[field] ?? 0);
    });
  };
  canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = rigCanvasPoint(project, canvas, event);
    const cells = loadCells();
    const hit = hitRigCell(cells, x, y);
    if (!hit) return;
    state.selectedCell = hit.index;
    state.selectedSubCell = hit.subCell;
    const cell = selectedRigCell(cells);
    drag = {
      cells,
      mode: hit.mode,
      startX: x,
      startY: y,
      original: { cellX: cell.cellX, cellY: cell.cellY, width: cell.width, height: cell.height },
      rigImage: hit.mode === "move" ? readRigImageForEditing(project, spriteId) : undefined,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = cursorForRigMode(hit.mode);
    event.preventDefault();
    drawRigEditor(project, spriteId, cells);
    updateNumeric(cells);
  });
  canvas.addEventListener("pointermove", (event) => {
    const { x, y } = rigCanvasPoint(project, canvas, event);
    if (!drag) {
      const hit = hitRigCell(loadCells(), x, y);
      canvas.style.cursor = hit ? cursorForRigMode(hit.mode) : "default";
      return;
    }
    const cell = selectedRigCell(drag.cells);
    applyRigDrag(project, cell, drag, x, y);
    drag.moved = true;
    drawRigEditor(project, spriteId, drag.cells, drag);
    updateNumeric(drag.cells);
    event.preventDefault();
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag) return;
    if (drag.moved) {
      try {
        if (drag.mode === "move" && drag.rigImage) {
          setPokemonSpriteImage(project, spriteId, rigVariantForSide(state.rigSide), "normal", moveRigCellPixels(drag.rigImage, drag.original, selectedRigCell(drag.cells)));
        }
        setRigCells(project, spriteId, state.rigSide, drag.cells);
        options.onDirty?.();
        drawAllPreviews(project, spriteId, root);
        drawRigEditor(project, spriteId, drag.cells);
        setStatus(drag.mode === "move" && drag.rigImage ? "Moved rig cell and pixels" : "Updated rig cell");
      } catch (error) {
        setStatus(errorMessage(error));
      }
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = undefined;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", () => {
    drag = undefined;
  });
  root.querySelectorAll<HTMLInputElement>("[data-rig-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const cells = loadCells();
      const cell = selectedRigCell(cells);
      const field = input.dataset.rigField as keyof RigCell;
      (cell as unknown as Record<string, number>)[field] = Number(input.value);
      setRigCells(project, spriteId, state.rigSide, cells);
      options.onDirty?.();
      drawRigEditor(project, spriteId, cells);
    });
  });
  root.querySelector("#rig-toggle-subcell")?.addEventListener("click", () => {
    const cells = loadCells();
    const parent = cells.cells[state.selectedCell];
    if (!parent) return;
    parent.subCell = parent.subCell.width > 0 ? { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: parent.subCell.subCell } : { ...parent, subCell: parent.subCell.subCell };
    state.selectedSubCell = parent.subCell.width > 0;
    setRigCells(project, spriteId, state.rigSide, cells);
    options.onDirty?.();
    rerender();
  });
  root.querySelector<HTMLInputElement>("#rig-import-cells")?.addEventListener("change", async (event) => {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      const imported = rigCellsFromImportJson(JSON.parse(await file.text()), loadCells());
      setRigCells(project, spriteId, state.rigSide, imported);
      state.selectedCell = 0;
      state.selectedSubCell = false;
      options.onDirty?.();
      setStatus(`Imported ${imported.cells.length} ${state.rigSide} rig cell(s)`);
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelector("#rig-apply")?.addEventListener("click", () => {
    try {
      const cells = loadCells();
      const flags = parseHexFlags((root.querySelector<HTMLTextAreaElement>("#rig-flags")?.value ?? "").trim());
      if (flags.length !== cells.flags.length) throw new Error(`Expected ${cells.flags.length} rig flag bytes`);
      cells.flags = flags;
      setRigCells(project, spriteId, state.rigSide, cells);
      options.onDirty?.();
      setStatus("Applied rig cells");
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
}

function rigCellsFromImportJson(value: unknown, existing: RigCellsFile): RigCellsFile {
  const source = value as { cells?: unknown[]; parts?: unknown[]; flags?: unknown[] };
  const rows = Array.isArray(source.cells) ? source.cells : Array.isArray(source.parts) ? source.parts : undefined;
  if (!rows) throw new Error("Rig cell import must contain a cells or parts array");
  if (rows.length > 255) throw new Error("Rig cell import cannot contain more than 255 cells");
  const cells = rows.map((row, index) => rigCellFromImportRow(row, index));
  const flags = Array.isArray(source.flags) ? new Uint8Array(source.flags.map((byte) => clamp(Number(byte), 0, 255))) : existing.flags;
  return { cells, flags };
}

function rigCellFromImportRow(row: unknown, index: number): RigCell {
  const record = row as {
    atlas?: Partial<Record<"x" | "y" | "width" | "height", unknown>>;
    source?: Partial<Record<"x" | "y" | "width" | "height", unknown>>;
    cellX?: unknown;
    cellY?: unknown;
    width?: unknown;
    height?: unknown;
    spriteX?: unknown;
    spriteY?: unknown;
    subCell?: unknown;
  };
  const atlas = record.atlas ?? {};
  const source = record.source ?? {};
  const cellX = importNumber(record.cellX ?? atlas.x, 0);
  const cellY = importNumber(record.cellY ?? atlas.y, 0);
  const width = importNumber(record.width ?? atlas.width, 0);
  const height = importNumber(record.height ?? atlas.height, 0);
  if (width <= 0 || height <= 0) throw new Error(`Imported rig cell ${index} must have positive width and height`);
  return {
    cellX,
    cellY,
    width,
    height,
    spriteX: importNumber(record.spriteX ?? (source.x === undefined ? 0 : Number(source.x) - 48), 0),
    spriteY: importNumber(record.spriteY ?? (source.y === undefined ? 0 : 48 - Number(source.y)), 0),
    subCell: record.subCell ? rigCellFromImportRow(record.subCell, index) : { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell },
  };
}

function importNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function installAnimationEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const refreshAnimation = () => refreshAnimationSectionContent(project, root, spriteId, options, setStatus, rerender);
  root.querySelectorAll<HTMLButtonElement>("[data-animation-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.animationTab as AnimationEditorTab;
      if (state.animationTab === nextTab) return;
      stopAnimationPlayback();
      state.animationTab = nextTab;
      animationDragState = undefined;
      refreshAnimation();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-animation-side]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSide = button.dataset.animationSide as PokemonAnimationSide;
      if (state.animationSide === nextSide) return;
      stopAnimationPlayback();
      state.animationSide = nextSide;
      state.animationSequence = 0;
      state.animationFrame = 0;
      state.animationTick = 0;
      state.animationPlaying = false;
      state.animationActiveNode = -1;
      animationDragState = undefined;
      animationFileDraft = undefined;
      syncGifFlipbookStats(project, root, spriteId);
      refreshAnimation();
    });
  });
  installAnimationFileTabEvents(project, root, spriteId, options, setStatus, refreshAnimation);
  root.querySelector<HTMLSelectElement>("#animation-sequence")?.addEventListener("change", (event) => {
    stopAnimationPlayback();
    state.animationSequence = Number((event.currentTarget as HTMLSelectElement).value);
    state.animationActiveNode = -1;
    state.animationFrame = 0;
    state.animationTick = 0;
    state.animationPlaying = false;
    animationDragState = undefined;
    refreshAnimation();
  });
  root.querySelector<HTMLSelectElement>("#animation-multicell")?.addEventListener("change", (event) => {
    stopAnimationPlayback();
    state.animationMultiCell = Number((event.currentTarget as HTMLSelectElement).value);
    state.animationVisibleNode = -1;
    state.animationActiveNode = -1;
    state.animationTick = 0;
    state.animationPlaying = false;
    animationDragState = undefined;
    refreshAnimation();
  });
  root.querySelector<HTMLSelectElement>("#animation-visible-node")?.addEventListener("change", (event) => {
    stopAnimationPlayback();
    state.animationVisibleNode = Number((event.currentTarget as HTMLSelectElement).value);
    state.animationActiveNode = state.animationVisibleNode;
    syncAnimationSequenceToVisibleNode(project, spriteId);
    state.animationPlaying = false;
    animationDragState = undefined;
    refreshAnimation();
  });
  root.querySelector<HTMLInputElement>("#animation-frame")?.addEventListener("input", (event) => {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
    state.animationTick = Number((event.currentTarget as HTMLInputElement).value);
    state.animationFrame = sequence ? animationPlayerFrameAtTick(sequence, state.animationTick) : 0;
    state.animationPlaying = false;
    stopAnimationPlayback();
    drawAnimationEditor(project, spriteId, root);
    syncAnimationFrameControl(root);
    syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
    syncAnimationPlaybackButton(root);
  });
  root.querySelector<HTMLInputElement>("#animation-frame")?.addEventListener("change", () => {
    syncAnimationFrameControl(root);
    syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
  });
  root.querySelector<HTMLInputElement>("#animation-step-interval")?.addEventListener("change", (event) => {
    state.animationStepInterval = normalizeAnimationStepInterval(Number((event.currentTarget as HTMLInputElement).value));
    writeAnimationStepInterval(state.animationStepInterval);
    (event.currentTarget as HTMLInputElement).value = String(state.animationStepInterval);
  });
  root.querySelector("#animation-play")?.addEventListener("click", () => {
    state.animationPlaying = !state.animationPlaying;
    if (state.animationPlaying) {
      stopAnimationPlayback();
      state.animationTick = 0;
      const animation = getPokemonAnimation(project, spriteId, state.animationSide);
      const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
      state.animationFrame = sequence ? animationPlayerFrameAtTick(sequence, state.animationTick) : 0;
      syncAnimationFrameControl(root);
      syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
      drawAnimationEditor(project, spriteId, root);
      syncAnimationPlaybackButton(root);
      startAnimationPlayback(project, spriteId, root);
    } else {
      stopAnimationPlayback();
      syncAnimationPlaybackButton(root);
    }
  });
  root.querySelector("#animation-step")?.addEventListener("click", () => {
    stepAnimation(project, spriteId, root, setStatus, state.animationStepInterval);
  });
  root.querySelector("#animation-step-back")?.addEventListener("click", () => {
    stepAnimation(project, spriteId, root, setStatus, -state.animationStepInterval);
  });
  root.querySelector("#animation-step-forward")?.addEventListener("click", () => {
    stepAnimation(project, spriteId, root, setStatus, state.animationStepInterval);
  });
  root.querySelector("#animation-expand")?.addEventListener("click", () => {
    state.animationExpanded = !state.animationExpanded;
    refreshAnimation();
  });
  root.querySelector("#animation-apply")?.addEventListener("click", () => {
    try {
      const next = readAnimationInputs(root);
      commitAnimationFrameEdit(project, spriteId, state.animationSide, state.animationSequence, state.animationFrame, next);
      clearAnimationDraft(spriteId, state.animationSide, state.animationSequence, state.animationFrame);
      options.onDirty?.();
      setStatus("Applied animation frame");
      refreshAnimation();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelector("#animation-undo")?.addEventListener("click", () => {
    performAnimationUndo(project, spriteId, options, setStatus, refreshAnimation);
  });
  root.querySelector("#animation-reset")?.addEventListener("click", () => {
    try {
      if (!hasAnimationUndoState(spriteId, state.animationSide)) return;
      if (!window.confirm("Reset all animation edits for this sprite side?")) return;
      const hadHistory = hasAnimationHistory(spriteId, state.animationSide);
      resetAnimationEdits(project, spriteId, state.animationSide);
      state.animationPlaying = false;
      animationDragState = undefined;
      clearAnimationDraft(spriteId, state.animationSide);
      if (hadHistory) options.onDirty?.();
      setStatus("Reset animation edits");
      refreshAnimation();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  installAnimationCanvasEvents(project, root, spriteId, options, setStatus, rerender);
}

function installAnimationFileTabEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  refreshAnimation: () => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-animation-file-revert]").forEach((button) => {
    button.addEventListener("click", () => {
      animationFileDraft = undefined;
      setStatus("Reverted animation file edits");
      refreshAnimation();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-animation-file-apply]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        const kind = button.dataset.animationFileApply as AnimationEditorTab;
        if (kind === "nanr") setPokemonAnimation(project, spriteId, state.animationSide, readAnimationBankEditor(root, project, spriteId, "nanr"));
        else if (kind === "nmar") setPokemonMultiCellAnimation(project, spriteId, state.animationSide, readAnimationBankEditor(root, project, spriteId, "nmar"));
        else if (kind === "nmcr") setPokemonMultiCells(project, spriteId, state.animationSide, readNmcrEditor(root, project, spriteId));
        else if (kind === "ncer") setPokemonCellBank(project, spriteId, state.animationSide, readNcerEditor(root, project, spriteId));
        else if (kind === "ncec") replaceRigCells(project, spriteId, state.animationSide, readNcecEditor(root, project, spriteId));
        animationFileDraft = undefined;
        options.onDirty?.();
        state.animationFrame = 0;
        state.animationTick = 0;
        state.animationPlaying = false;
        setStatus(`Applied ${kind.toUpperCase()} edits`);
        refreshAnimation();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-animation-frame-action]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        const kind = button.dataset.kind as "nanr" | "nmar";
        const sequenceIndex = Number(button.dataset.sequence);
        const frameIndex = Number(button.dataset.frame);
        const action = button.dataset.animationFrameAction as "insert" | "duplicate" | "delete";
        const animation = readAnimationBankEditor(root, project, spriteId, kind);
        const sequence = animation.sequences[sequenceIndex];
        if (!sequence) throw new Error("Animation sequence is out of range");
        if (action === "delete") {
          if (sequence.frames.length <= 1) throw new Error("A sequence must keep at least one frame");
          sequence.frames.splice(frameIndex, 1);
        } else {
          const source = sequence.frames[frameIndex] ?? sequence.frames[sequence.frames.length - 1];
          if (!source) throw new Error("Animation frame is out of range");
          sequence.frames.splice(action === "insert" ? frameIndex : frameIndex + 1, 0, cloneAnimationFrameForDraft(source));
        }
        sequence.frameCount = sequence.frames.length;
        animationFileDraft = { spriteId, side: state.animationSide, tab: kind, animation };
        setStatus("Frame list changed. Click Apply to save.");
        refreshAnimation();
      } catch (error) {
        setStatus(errorMessage(error));
      }
    });
  });
}

function readAnimationBankEditor(root: HTMLElement, project: ProjectState, spriteId: number, kind: "nanr" | "nmar"): PokemonAnimation {
  const base = animationFileDraftFor(spriteId, state.animationSide, kind) ?? (kind === "nanr" ? getPokemonAnimation(project, spriteId, state.animationSide) : getPokemonMultiCellAnimation(project, spriteId, state.animationSide));
  const sequenceElements = Array.from(root.querySelectorAll<HTMLElement>(`[data-animation-file-editor="${kind}"] [data-animation-sequence]`));
  const sequences: PokemonAnimationSequence[] = sequenceElements.map((element, index) => {
    const sequenceIndex = Number(element.dataset.animationSequence ?? index);
    const baseSequence = base.sequences[sequenceIndex] ?? base.sequences[index];
    const mode = readNumberFromElement(element.querySelector<HTMLInputElement>('[data-animation-sequence-field="mode"]'), baseSequence?.mode ?? 2);
    const motionType = readNumberFromElement(element.querySelector<HTMLInputElement | HTMLSelectElement>('[data-animation-sequence-field="motionType"]'), baseSequence?.motionType ?? 1);
    const startFrameIndex = readNumberFromElement(element.querySelector<HTMLInputElement>('[data-animation-sequence-field="startFrameIndex"]'), baseSequence?.startFrameIndex ?? 0);
    const frames = Array.from(element.querySelectorAll<HTMLElement>("[data-animation-frame-row]")).map((row, frameIndex) => {
      const baseFrame = baseSequence?.frames[frameIndex] ?? baseSequence?.frames[0];
      const frame = {
        duration: readFrameField(row, "duration", baseFrame?.duration ?? 1),
        cellIndex: readFrameField(row, "cellIndex", baseFrame?.cellIndex ?? 0),
        x: readFrameField(row, "x", baseFrame?.x ?? 0),
        y: readFrameField(row, "y", baseFrame?.y ?? 0),
        rotation: readFrameField(row, "rotation", baseFrame?.rotation ?? 0),
        xScale: readFrameField(row, "xScale", baseFrame?.xScale ?? 1),
        yScale: readFrameField(row, "yScale", baseFrame?.yScale ?? 1),
        frameType: motionType === 0 ? "index" : motionType === 2 ? "index-t" : "index-srt",
        valueOffset: baseFrame?.valueOffset ?? 0,
        sequenceFrameOffset: baseFrame?.sequenceFrameOffset ?? 0,
      } satisfies PokemonAnimationFrame;
      return frame;
    });
    return {
      index: sequenceIndex,
      frameCount: frames.length,
      startFrameIndex,
      motionType,
      targetType: kind === "nanr" ? 1 : 2,
      mode,
      frames,
    };
  });
  return { side: state.animationSide, raw: base.raw, sequences };
}

function readNmcrEditor(root: HTMLElement, project: ProjectState, spriteId: number): ReturnType<typeof getPokemonMultiCells> {
  const base = getPokemonMultiCells(project, spriteId, state.animationSide);
  const groups = Array.from(root.querySelectorAll<HTMLElement>("[data-nmcr-group]")).map((group, index) => {
    const groupIndex = Number(group.dataset.nmcrGroup ?? index);
    const baseCell = base.cells[groupIndex] ?? base.cells[index];
    const cellAnimationCount = readNumberFromElement(group.querySelector<HTMLInputElement>('[data-nmcr-group-field="cellAnimationCount"]'), baseCell?.cellAnimationCount ?? 1);
    const nodes = Array.from(group.querySelectorAll<HTMLElement>("[data-nmcr-node-row]")).map((row, nodeIndex) => {
      const baseNode = baseCell?.nodes[nodeIndex];
      const visibleInput = row.querySelector<HTMLInputElement>('[data-nmcr-node-field="visible"]');
      const cellAnimationIndex = readNodeField(row, "cellAnimationIndex", baseNode?.cellAnimationIndex ?? nodeIndex);
      const playMode = readNodeField(row, "playMode", baseNode?.playMode ?? 0);
      const visible = visibleInput ? visibleInput.checked : baseNode?.visible ?? true;
      return {
        sequenceNumber: readNodeField(row, "sequenceNumber", baseNode?.sequenceNumber ?? 0),
        x: readNodeField(row, "x", baseNode?.x ?? 0),
        y: readNodeField(row, "y", baseNode?.y ?? 0),
        nodeAttr: ((cellAnimationIndex & 0xff) << 8) | (visible ? 0x20 : 0) | (playMode & 0x0f),
        cellAnimationIndex,
        playMode,
        visible,
      };
    });
    return { index: groupIndex, nodes, cellAnimationCount };
  });
  return { side: state.animationSide, raw: base.raw, cells: groups };
}

function readNcerEditor(root: HTMLElement, project: ProjectState, spriteId: number): PokemonCellBank {
  const base = getPokemonCellBank(project, spriteId, state.animationSide);
  const mappingMode = readNumberFromElement(root.querySelector<HTMLInputElement>("#ncer-mapping-mode"), base.mappingMode);
  const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-ncer-cell]")).map((cellElement, index) => {
    const cellIndex = Number(cellElement.dataset.ncerCell ?? index);
    const baseCell = base.cells[cellIndex] ?? base.cells[index];
    const oams = Array.from(cellElement.querySelectorAll<HTMLElement>("[data-ncer-oam-row]")).map((row, oamIndex) => {
      const baseOam = baseCell?.oams[oamIndex];
      const objectSize = readSelectValue(row.querySelector<HTMLSelectElement>('[data-ncer-oam-field="objectSize"]'), `${baseOam?.width ?? 8}x${baseOam?.height ?? 8}`);
      const size = oamSizeFromValue(objectSize);
      const rotateScale = readCheckbox(row, "rotateScale", baseOam?.rotateScale ?? false);
      const doubleOrDisable = readCheckbox(row, "doubleSize", rotateScale ? baseOam?.doubleSize ?? false : baseOam?.disable ?? false);
      return {
        x: readOamField(row, "x", baseOam?.x ?? 0),
        y: readOamField(row, "y", baseOam?.y ?? 0),
        width: size.width,
        height: size.height,
        characterName: readOamField(row, "characterName", baseOam?.characterName ?? 0),
        palette: readOamField(row, "palette", baseOam?.palette ?? 0),
        flipX: readCheckbox(row, "flipX", baseOam?.flipX ?? false),
        flipY: readCheckbox(row, "flipY", baseOam?.flipY ?? false),
        disable: rotateScale ? false : doubleOrDisable,
        rotateScale,
        doubleSize: rotateScale ? doubleOrDisable : false,
        matrix: readOamField(row, "matrix", baseOam?.matrix ?? 0),
        mode: readOamField(row, "mode", baseOam?.mode ?? 0),
        mosaic: baseOam?.mosaic ?? false,
        shape: size.shape,
        size: size.size,
        priority: readOamField(row, "priority", baseOam?.priority ?? 0),
        characterBits: readNumberFromElement(row.querySelector<HTMLSelectElement>('[data-ncer-oam-field="characterBits"]'), baseOam?.characterBits ?? 4) === 8 ? 8 : 4,
      } satisfies PokemonCellOam;
    });
    return {
      index: cellIndex,
      nAttribs: oams.length,
      cellAttr: readNumberFromElement(cellElement.querySelector<HTMLInputElement>('[data-ncer-cell-field="cellAttr"]'), baseCell?.cellAttr ?? 0),
      minX: baseCell?.minX ?? 0,
      minY: baseCell?.minY ?? 0,
      maxX: baseCell?.maxX ?? 0,
      maxY: baseCell?.maxY ?? 0,
      oams,
    };
  });
  return { side: state.animationSide, mappingMode, cells, raw: base.raw };
}

function readNcecEditor(root: HTMLElement, project: ProjectState, spriteId: number): RigCellsFile {
  const base = getRigCells(project, spriteId, state.animationSide);
  const flags = parseHexFlags((root.querySelector<HTMLTextAreaElement>("#ncec-flags")?.value ?? "").trim());
  const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-ncec-cell-row]")).map((row, index) => {
    const baseCell = base.cells[index] ?? emptyUiRigCell();
    const baseSubCell = baseCell.subCell ?? emptyUiRigCell();
    return {
      cellX: readNcecField(row, "cellX", baseCell.cellX),
      cellY: readNcecField(row, "cellY", baseCell.cellY),
      width: readNcecField(row, "width", baseCell.width),
      height: readNcecField(row, "height", baseCell.height),
      spriteX: readNcecField(row, "spriteX", baseCell.spriteX),
      spriteY: readNcecField(row, "spriteY", baseCell.spriteY),
      subCell: {
        cellX: readNcecField(row, "subcellX", baseSubCell.cellX),
        cellY: readNcecField(row, "subcellY", baseSubCell.cellY),
        width: readNcecField(row, "subwidth", baseSubCell.width),
        height: readNcecField(row, "subheight", baseSubCell.height),
        spriteX: readNcecField(row, "subspriteX", baseSubCell.spriteX),
        spriteY: readNcecField(row, "subspriteY", baseSubCell.spriteY),
        subCell: emptyUiRigCell(),
      },
    };
  });
  return { cells, flags };
}

function cloneAnimationFrameForDraft(frame: PokemonAnimationFrame): PokemonAnimationFrame {
  return { ...frame, valueOffset: 0, sequenceFrameOffset: 0 };
}

function readFrameField(row: HTMLElement, field: keyof PokemonAnimationFrameEdit, fallback: number): number {
  return readNumberFromElement(row.querySelector<HTMLInputElement>(`[data-animation-frame-field="${field}"]`), fallback);
}

function readNodeField(row: HTMLElement, field: keyof Pick<PokemonMultiCellNode, "sequenceNumber" | "x" | "y" | "cellAnimationIndex" | "playMode">, fallback: number): number {
  return readNumberFromElement(row.querySelector<HTMLInputElement>(`[data-nmcr-node-field="${field}"]`), fallback);
}

function readOamField(row: HTMLElement, field: keyof Pick<PokemonCellOam, "x" | "y" | "characterName" | "palette" | "priority" | "matrix" | "mode">, fallback: number): number {
  return readNumberFromElement(row.querySelector<HTMLInputElement>(`[data-ncer-oam-field="${field}"]`), fallback);
}

function readNcecField(row: HTMLElement, field: string, fallback: number): number {
  return readNumberFromElement(row.querySelector<HTMLInputElement>(`[data-ncec-field="${field}"]`), fallback);
}

function readCheckbox(row: HTMLElement, field: string, fallback: boolean): boolean {
  const input = row.querySelector<HTMLInputElement>(`[data-ncer-oam-field="${field}"]`);
  return input ? input.checked : fallback;
}

function readNumberFromElement(input: HTMLInputElement | HTMLSelectElement | null, fallback: number): number {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function readSelectValue(input: HTMLSelectElement | null, fallback: string): string {
  return input?.value ?? fallback;
}

function oamSizeFromValue(value: string): (typeof NITRO_OAM_SIZES)[number] {
  const [widthText, heightText] = value.split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  const size = NITRO_OAM_SIZES.find((candidate) => candidate.width === width && candidate.height === height);
  if (!size) throw new Error(`Unsupported OAM size ${value}`);
  return size;
}

function emptyUiRigCell(): RigCell {
  return { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell };
}

function stepAnimation(project: ProjectState, spriteId: number, root: HTMLElement, setStatus: (message: string) => void, deltaTicks: number): void {
  try {
    state.animationPlaying = false;
    stopAnimationPlayback();
    stepAnimationPlayers(project, spriteId, getPokemonAnimation(project, spriteId, state.animationSide), deltaTicks);
    drawAnimationEditor(project, spriteId, root);
    syncAnimationFrameControl(root);
    syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
    syncAnimationPlaybackButton(root);
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

function commitAnimationFrameEdit(
  project: ProjectState,
  spriteId: number,
  side: PokemonAnimationSide,
  sequenceIndex: number,
  frameIndex: number,
  next: PokemonAnimationFrameEdit,
  knownBefore?: PokemonAnimationFrameEdit,
): PokemonAnimation {
  const animation = getPokemonAnimation(project, spriteId, side);
  const beforeFrame = animation.sequences[sequenceIndex]?.frames[frameIndex];
  if (!beforeFrame) throw new Error("Animation frame is out of range");
  const before = knownBefore ? { ...knownBefore } : animationFrameEdit(beforeFrame);
  const edited = updatePokemonAnimationFrame(project, spriteId, side, sequenceIndex, frameIndex, next);
  const afterFrame = edited.sequences[sequenceIndex]?.frames[frameIndex];
  if (afterFrame) {
    const after = animationFrameEdit(afterFrame);
    if (!sameAnimationFrameEdit(before, after)) {
      animationEditHistory.push({ spriteId, side, sequenceIndex, frameIndex, before, after });
    }
  }
  return edited;
}

function performAnimationUndo(
  project: ProjectState,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  try {
    const draft = animationDraftFor(spriteId, state.animationSide);
    if (draft) {
      state.animationSequence = draft.sequenceIndex;
      state.animationFrame = draft.frameIndex;
      state.animationPlaying = false;
      animationDragState = undefined;
      clearAnimationDraft(spriteId, state.animationSide, draft.sequenceIndex, draft.frameIndex);
      setStatus("Undid draft animation edit");
      rerender();
      return;
    }
    const undone = undoAnimationEdit(project, spriteId, state.animationSide);
    if (!undone) return;
    state.animationSequence = undone.sequenceIndex;
    state.animationFrame = undone.frameIndex;
    state.animationPlaying = false;
    animationDragState = undefined;
    clearAnimationDraft(spriteId, state.animationSide, undone.sequenceIndex, undone.frameIndex);
    options.onDirty?.();
    setStatus("Undid animation edit");
    rerender();
  } catch (error) {
    setStatus(errorMessage(error));
  }
}

function performAnimationKeyboardEdit(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  event: KeyboardEvent,
  setStatus: (message: string) => void,
): boolean {
  if (!hasSelectedAnimationPart(project, spriteId)) return false;
  const frame = selectedAnimationFrame(project, spriteId);
  if (!frame) return false;
  const next = { ...frame };
  if (event.shiftKey) {
    if (next.frameType !== "index-srt") {
      setStatus("Selected animation frame does not support rotation");
      return true;
    }
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -5 : 5;
    next.rotation = normalizeRotation(next.rotation + delta);
  } else {
    if (next.frameType !== "index-srt" && next.frameType !== "index-t") {
      setStatus("Selected animation frame does not support translation");
      return true;
    }
    if (event.key === "ArrowLeft") next.x -= 1;
    else if (event.key === "ArrowRight") next.x += 1;
    else if (event.key === "ArrowUp") next.y -= 1;
    else if (event.key === "ArrowDown") next.y += 1;
  }
  animationDraftFrame = {
    spriteId,
    side: state.animationSide,
    sequenceIndex: state.animationSequence,
    frameIndex: state.animationFrame,
    frame: next,
  };
  state.animationPlaying = false;
  stopAnimationPlayback();
  syncAnimationInputs(root, next);
  syncAnimationPlaybackButton(root);
  drawAnimationEditor(project, spriteId, root);
  setStatus("Preview changed. Click Apply Frame to save.");
  return true;
}

function undoAnimationEdit(project: ProjectState, spriteId: number, side: PokemonAnimationSide): AnimationHistoryEntry | undefined {
  for (let index = animationEditHistory.length - 1; index >= 0; index -= 1) {
    const entry = animationEditHistory[index];
    if (!entry || entry.spriteId !== spriteId || entry.side !== side) continue;
    animationEditHistory.splice(index, 1);
    updatePokemonAnimationFrame(project, spriteId, side, entry.sequenceIndex, entry.frameIndex, entry.before);
    return entry;
  }
  return undefined;
}

function resetAnimationEdits(project: ProjectState, spriteId: number, side: PokemonAnimationSide): void {
  for (let index = animationEditHistory.length - 1; index >= 0; index -= 1) {
    const entry = animationEditHistory[index];
    if (!entry || entry.spriteId !== spriteId || entry.side !== side) continue;
    updatePokemonAnimationFrame(project, spriteId, side, entry.sequenceIndex, entry.frameIndex, entry.before);
    animationEditHistory.splice(index, 1);
  }
}

function hasAnimationHistory(spriteId: number, side: PokemonAnimationSide): boolean {
  return animationEditHistory.some((entry) => entry.spriteId === spriteId && entry.side === side);
}

function hasAnimationUndoState(spriteId: number, side: PokemonAnimationSide): boolean {
  return hasAnimationHistory(spriteId, side) || Boolean(animationDraftFor(spriteId, side));
}

function animationDraftFor(spriteId: number, side: PokemonAnimationSide): AnimationDraftFrame | undefined {
  return animationDraftFrame && animationDraftFrame.spriteId === spriteId && animationDraftFrame.side === side ? animationDraftFrame : undefined;
}

function clearAnimationDraft(spriteId: number, side?: PokemonAnimationSide, sequenceIndex?: number, frameIndex?: number): void {
  if (!animationDraftFrame || animationDraftFrame.spriteId !== spriteId) return;
  if (side !== undefined && animationDraftFrame.side !== side) return;
  if (sequenceIndex !== undefined && animationDraftFrame.sequenceIndex !== sequenceIndex) return;
  if (frameIndex !== undefined && animationDraftFrame.frameIndex !== frameIndex) return;
  animationDraftFrame = undefined;
}

function sameAnimationFrameEdit(left: PokemonAnimationFrameEdit, right: PokemonAnimationFrameEdit): boolean {
  return (
    left.duration === right.duration &&
    left.cellIndex === right.cellIndex &&
    left.x === right.x &&
    left.y === right.y &&
    roundDisplay(left.rotation) === roundDisplay(right.rotation) &&
    roundDisplay(left.xScale) === roundDisplay(right.xScale) &&
    roundDisplay(left.yScale) === roundDisplay(right.yScale)
  );
}

function installAnimationCanvasEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#sprite-animation-canvas");
  if (!canvas) return;
  const refreshAnimation = () => refreshAnimationSectionContent(project, root, spriteId, options, setStatus, rerender);
  animationOutsidePointerCleanup?.();
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!root.isConnected) {
      animationOutsidePointerCleanup?.();
      return;
    }
    if ((event.target as Element | null)?.closest(".animation-canvas-wrap")) return;
    clearAnimationPartSelection(root, project, spriteId);
  };
  root.addEventListener("pointerdown", onOutsidePointerDown);
  animationOutsidePointerCleanup = () => {
    root.removeEventListener("pointerdown", onOutsidePointerDown);
    animationOutsidePointerCleanup = undefined;
  };
  canvas.addEventListener("pointerdown", (event) => {
    const pointer = canvasPointer(event, canvas);
    const renderState = animationRenderState(project, spriteId, canvas);
    if (!renderState) return;
    const selected = renderState.selected;
    const selectedHandleHit = selected ? hitAnimationHandles(pointer, selected) : undefined;
    const selectedBodyHit = selected ? hitAnimationBody(pointer, selected) : undefined;
    const selectedHit = selectedHandleHit ?? selectedBodyHit;
    if (selected && selectedHit && canDragAnimationPart(selected, selectedHit)) {
      event.preventDefault();
      state.animationPlaying = false;
      stopAnimationPlayback();
      syncAnimationPlaybackButton(root);
      canvas.setPointerCapture(event.pointerId);
      animationDragState = {
        mode: selectedHit,
        nodeIndex: selected.nodeIndex,
        sequenceIndex: selected.sequenceIndex,
        frameIndex: selected.frameIndex,
        startPointer: pointer,
        startWorldPointer: canvasToAnimationWorld(pointer, canvas, renderState.outerFrame),
        startFrame: animationFrameEdit(selected.frame),
        startAnchorWorld: selected.anchorWorld,
        anchorLocal: selected.anchorLocal,
        node: selected.node,
        outerFrame: renderState.outerFrame,
        previewFrame: { ...selected.frame },
        moved: false,
      };
      return;
    }

    const hit = hitAnimationRenderedPart(pointer, renderState.parts);
    if (!hit) {
      clearAnimationPartSelection(root, project, spriteId);
      return;
    }
    state.animationActiveNode = hit.nodeIndex;
    state.animationSequence = hit.sequenceIndex;
    state.animationFrame = hit.frameIndex;
    state.animationPlaying = false;
    stopAnimationPlayback();
    syncAnimationFrameControl(root);
    syncAnimationInputs(root, hit.frame);
    syncAnimationPlaybackButton(root);
    drawAnimationEditor(project, spriteId, root);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (animationDragState) {
      event.preventDefault();
      const pointer = canvasPointer(event, canvas);
      const next = animationFrameForDrag(animationDragState, pointer, canvas, event.shiftKey);
      animationDragState.previewFrame = { ...animationDragState.previewFrame, ...next };
      animationDragState.moved = true;
      syncAnimationInputs(root, animationDragState.previewFrame);
      drawAnimationEditor(project, spriteId, root);
      return;
    }
    const pointer = canvasPointer(event, canvas);
    const renderState = animationRenderState(project, spriteId, canvas);
    const selectedHit = renderState?.selected ? hitAnimationHandles(pointer, renderState.selected) ?? hitAnimationBody(pointer, renderState.selected) : undefined;
    canvas.style.cursor = selectedHit && canDragAnimationPart(renderState!.selected!, selectedHit) ? animationDragCursor(selectedHit) : hitAnimationRenderedPart(pointer, renderState?.parts ?? []) ? "pointer" : "";
  });
  const endDrag = (event: PointerEvent) => {
    const drag = animationDragState;
    if (!drag) return;
    animationDragState = undefined;
    canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "";
    try {
      if (drag.moved) {
        animationDraftFrame = {
          spriteId,
          side: state.animationSide,
          sequenceIndex: drag.sequenceIndex,
          frameIndex: drag.frameIndex,
          frame: { ...drag.previewFrame },
        };
        state.animationSequence = drag.sequenceIndex;
        state.animationFrame = drag.frameIndex;
        setStatus("Preview changed. Click Apply Frame to save.");
      }
      refreshAnimation();
    } catch (error) {
      setStatus(errorMessage(error));
      refreshAnimation();
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", () => {
    animationDragState = undefined;
    canvas.style.cursor = "";
  });
}

function clearAnimationPartSelection(root: HTMLElement, project: ProjectState, spriteId: number): void {
  if (state.animationActiveNode < 0 && state.animationVisibleNode < 0) return;
  state.animationActiveNode = -1;
  state.animationVisibleNode = -1;
  animationDragState = undefined;
  drawAnimationEditor(project, spriteId, root);
  syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
  const visible = root.querySelector<HTMLSelectElement>("#animation-visible-node");
  if (visible) visible.value = "-1";
}

function installRawFileEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const selectedFileIndex = () => Number(root.querySelector<HTMLSelectElement>("#raw-file-index")?.value ?? 0);
  root.querySelector("#raw-export")?.addEventListener("click", () => {
    const index = selectedFileIndex();
    const file = getPokemonSpriteEntry(project, spriteId).files[index];
    downloadBytes(file, `${spriteFileBaseName(spriteId)}_${String(index).padStart(2, "0")}.bin`, "application/octet-stream");
  });
  root.querySelector<HTMLInputElement>("#raw-import")?.addEventListener("change", async (event) => {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isPngBytes(bytes)) {
        throw new Error("Raw Replace expects a compressed Gen 5 sprite binary, not a PNG. Use the Sprites section Import button for sprite/rig PNGs.");
      }
      const index = selectedFileIndex();
      const entry = getPokemonSpriteEntry(project, spriteId);
      entry.files[index] = bytes;
      importPokemonSpritePackage(project, spriteId, packageFromFiles(entry.files));
      options.onDirty?.();
      setStatus(`Replaced raw file ${index}`);
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  });
  root.querySelector("#raw-dump")?.addEventListener("click", () => {
    const entry = getPokemonSpriteEntry(project, spriteId);
    const baseName = spriteFileBaseName(spriteId);
    const files = entry.files.map((file, index) => ({
      name: `${baseName}_${String(index).padStart(2, "0")}.bin`,
      data: file,
    }));
    downloadBytes(zipStoredFiles(files), `${baseName}_raw_files.zip`, "application/zip");
  });
}

function installBundleImportEvents(
  project: ProjectState,
  root: HTMLElement,
  spriteId: number,
  options: RenderOptions,
  setStatus: (message: string) => void,
  rerender: () => void,
): void {
  const input = root.querySelector<HTMLInputElement>("#sprite-bundle-import");
  const dropZone = root.querySelector<HTMLElement>("#sprite-bundle-drop");
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importCustomSpriteBundleFile(project, spriteId, file);
      options.onDirty?.();
      setStatus("Imported custom sprite bundle");
      rerender();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  input?.addEventListener("change", async (event) => {
    await importFile((event.currentTarget as HTMLInputElement).files?.[0]);
  });
  if (!dropZone) return;
  const setDragging = (dragging: boolean) => dropZone.classList.toggle("-dragging", dragging);
  dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    setDragging(true);
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDragging(true);
  });
  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget as Node | null)) setDragging(false);
  });
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    setDragging(false);
    await importFile(event.dataTransfer?.files?.[0]);
  });
}

async function importCustomSpriteBundleFile(project: ProjectState, spriteId: number, file: File): Promise<void> {
  const imported = parsePokemonCustomSpriteBundle(new Uint8Array(await file.arrayBuffer()));
  if (imported.files && Object.keys(imported.files).length > 0) {
    const entry = getPokemonSpriteEntry(project, spriteId);
    const files = entry.files.slice();
    for (const [index, bytes] of Object.entries(imported.files)) {
      if (!bytes) continue;
      files[Number(index)] = bytes;
    }
    importPokemonSpritePackage(project, spriteId, packageFromFiles(files));
  }
  if (imported.normalPalettePng) {
    setPokemonPalette(project, spriteId, "normal", imageToPalette(await imageBlobToRgba(imported.normalPalettePng)));
  }
  if (imported.shinyPalettePng) {
    setPokemonPalette(project, spriteId, "shiny", imageToPalette(await imageBlobToRgba(imported.shinyPalettePng)));
  }
  if (imported.frontSpritePng) {
    setPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "front", gender: "male" }, "normal", await imageBlobToRgba(imported.frontSpritePng));
  }
  if (imported.backSpritePng) {
    setPokemonSpriteImage(project, spriteId, { kind: "sprite", side: "back", gender: "male" }, "normal", await imageBlobToRgba(imported.backSpritePng));
  }
  if (imported.frontRigPng) {
    setPokemonSpriteImage(project, spriteId, { kind: "rig", side: "front", gender: "male" }, "normal", await imageBlobToRgba(imported.frontRigPng));
  }
  if (imported.backRigPng) {
    setPokemonSpriteImage(project, spriteId, { kind: "rig", side: "back", gender: "male" }, "normal", await imageBlobToRgba(imported.backRigPng));
  }
  state.previewPaletteKind = "normal";
  state.paletteKind = "normal";
  state.rigSide = imported.side ?? "front";
  state.animationSide = imported.side ?? "front";
  state.animationSequence = 0;
  state.animationFrame = 0;
  state.animationTick = 0;
  state.animationMultiCell = 0;
  state.animationVisibleNode = -1;
  state.animationActiveNode = -1;
  state.animationPlaying = false;
  animationDragState = undefined;
  animationDraftFrame = undefined;
}

function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function drawAllPreviews(project: ProjectState, spriteId: number, root: HTMLElement, highlight?: PaletteHighlight): void {
  const palettes = {
    normal: readPaletteInputs(root, "normal"),
    shiny: readPaletteInputs(root, "shiny"),
  };
  const paletteKind = highlight?.kind ?? state.previewPaletteKind;
  for (const variant of variantOptions(true)) {
    const canvas = root.querySelector<HTMLCanvasElement>(`#preview-${variantValue(variant)}`);
    if (!canvas) continue;
    try {
      drawIndexedImageToCanvas(canvas, getPokemonSpriteIndexedImage(project, spriteId, variant), palettes[paletteKind], highlight?.kind === paletteKind ? highlight.index : undefined);
    } catch {
      clearCanvas(canvas);
    }
  }
}

function drawIconPreview(project: ProjectState, spriteId: number): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#pokemon-icon-preview");
  if (!canvas) return;
  try {
    drawImageToCanvas(canvas, getPokemonIconImage(project, spriteId, state.iconVariant, state.iconPaletteId));
  } catch {
    clearCanvas(canvas);
  }
}

function adjustAnimationCanvasDisplaySize(root: HTMLElement): void {
  const wrap = root.querySelector<HTMLElement>(".animation-canvas-wrap");
  const canvas = root.querySelector<HTMLCanvasElement>("#sprite-animation-canvas");
  const controls = root.querySelector<HTMLElement>(".animation-controls");
  if (!wrap || !canvas || !controls) return;
  if (state.animationExpanded) {
    wrap.style.width = "";
    canvas.style.width = "";
    canvas.style.height = "";
    return;
  }
  const controlsHeight = controls.getBoundingClientRect().height;
  if (controlsHeight <= 0) return;
  const width = Math.round(controlsHeight * ANIMATION_CANVAS_WIDTH / ANIMATION_CANVAS_HEIGHT);
  wrap.style.width = `${width}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${Math.round(controlsHeight)}px`;
}

function drawRigEditor(project: ProjectState, spriteId: number, cells: RigCellsFile, drag?: RigDragState): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#rig-cells-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#8aa0a5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const baseRig = getPokemonSpriteImage(project, spriteId, rigVariantForSide(state.rigSide), "normal");
    const rig = drag?.mode === "move" && drag.rigImage ? moveRigCellPixels(drag.rigImage, drag.original, selectedRigCell(drag.cells)) : baseRig;
    const off = imageToCanvas(rig);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  } catch {
    // Empty rigs are still editable as cell metadata.
  }
  drawGrid(ctx, canvas.width, canvas.height, 24, "rgb(0 0 0 / 35%)");
  ctx.lineWidth = 2;
  cells.cells.forEach((cell, index) => {
    drawRigCellOverlay(ctx, project, spriteId, cell, index, !state.selectedSubCell && state.selectedCell === index, "#7cff52", 3);
    if (cell.subCell.width > 0) drawCell(ctx, cell.subCell, index, state.selectedSubCell && state.selectedCell === index, "#ffd84d", 3);
  });
}

function drawAnimationEditor(project: ProjectState, spriteId: number, root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("#sprite-animation-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#242638";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height, 24, "rgb(255 255 255 / 10%)");
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const multiCells = getPokemonMultiCells(project, spriteId, state.animationSide);
    const rigCells = getRigCells(project, spriteId, state.animationSide);
    const rigImage = getPokemonSpriteImage(project, spriteId, rigVariantForSide(state.animationSide), state.previewPaletteKind);
    const usePlayback = state.animationPlaying || state.animationTick > 0;
    const playback = usePlayback ? resolveMultiCellPlayback(project, spriteId, multiCells.cells, multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0], state.animationTick) : undefined;
    const multiCell = playback?.multiCell ?? multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0];
    if (animation.sequences.length === 0 || !multiCell) return;
    const tick = usePlayback ? state.animationTick : selectedAnimationTimelineTick(animation);
    const rig = imageToCanvas(rigImage);
    const visibleNodeIndex = state.animationVisibleNode >= 0 && state.animationVisibleNode < multiCell.nodes.length ? state.animationVisibleNode : -1;
    const selectedNodeIndex = selectedAnimationNodeIndex(multiCell);
    if (playback?.outerFrame) {
      ctx.save();
      applyMultiCellOuterTransform(ctx, playback.outerFrame);
    }
    for (let nodeIndex = multiCell.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      if (visibleNodeIndex !== -1 && nodeIndex !== visibleNodeIndex) continue;
      const node = multiCell.nodes[nodeIndex];
      if (!node) continue;
      drawAnimationNodeCanvas(
        ctx,
        spriteId,
        rig,
        rigCells,
        animation,
        multiCell,
        node,
        usePlayback ? nodePlaybackTick(node, tick, playback?.frameStartTick ?? 0) : tick,
        usePlayback,
        selectedNodeIndex === nodeIndex,
      );
    }
    if (playback?.outerFrame) ctx.restore();
    drawAnimationPartOverlay(ctx, animationRenderState(project, spriteId, canvas)?.selected);
    ctx.strokeStyle = "#1abc9c";
    ctx.lineWidth = 2;
    ctx.strokeRect(canvas.width / 2 - 2, canvas.height / 2 - 2, 4, 4);
  } catch {
    clearCanvas(canvas);
  }
}

function drawAnimationCell(ctx: CanvasRenderingContext2D, rig: HTMLCanvasElement, cell: RigCell, frame: PokemonAnimationFrame, selected = false): void {
  if (cell.width <= 0 || cell.height <= 0) return;
  const scale = ANIMATION_PREVIEW_SCALE;
  const dx = canvasAnimationOriginX(ctx) + (cell.spriteX + frame.x) * scale;
  const dy = canvasAnimationOriginY(ctx) - (cell.spriteY - frame.y) * scale;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate((frame.rotation * Math.PI) / 180);
  ctx.scale(frame.xScale, frame.yScale);
  ctx.drawImage(rig, cell.cellX, cell.cellY, cell.width, cell.height, 0, 0, cell.width * scale, cell.height * scale);
  ctx.restore();
  if (selected) {
    ctx.strokeStyle = "rgb(26 188 156 / 85%)";
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, cell.width * scale, cell.height * scale);
  }
}

function drawAnimationNode(
  output: RgbaImageData,
  rig: RgbaImageData,
  cellBank: PokemonCellBank,
  animation: PokemonAnimation,
  multiCell: PokemonMultiCell,
  node: PokemonMultiCellNode,
  tick: number,
  usePlayerFrames: boolean,
  selected = false,
): AnimationSelectionBox | undefined {
  const sequence = animation.sequences[node.sequenceNumber];
  const frameIndex = sequence && usePlayerFrames ? animationPlayerFrameAtTick(sequence, tick) : undefined;
  const frame = usePlayerFrames ? (frameIndex === undefined ? undefined : sequence?.frames[frameIndex]) : sequence ? animationFrameAtTick(sequence, tick) : undefined;
  if (!frame) return undefined;
  const cell = cellBank.cells[frame.cellIndex];
  if (!cell) return undefined;
  return drawNcerCell(output, rig, cellBank, cell, node.x, node.y, frame, selected);
}

function drawAnimationNodeCanvas(
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  rig: HTMLCanvasElement,
  rigCells: RigCellsFile,
  animation: PokemonAnimation,
  multiCell: PokemonMultiCell,
  node: PokemonMultiCellNode,
  tick: number,
  usePlayerFrames: boolean,
  selected = false,
): void {
  const sequence = animation.sequences[node.sequenceNumber];
  const frameState = sequence ? animationFrameStateForSequence(sequence, tick, usePlayerFrames) : undefined;
  if (!frameState) return;
  const frame = animationPreviewFrame(spriteId, state.animationSide, sequence.index, frameState.frameIndex, frameState.frame);
  const cell = rigCells.cells[frame.cellIndex];
  if (!cell) return;
  drawMcssRigCellCanvas(ctx, rig, cell, node.x, node.y, frame, selected);
}

function drawAnimationCellAt(ctx: CanvasRenderingContext2D, rig: HTMLCanvasElement, cell: RigCell, x: number, y: number, frame: PokemonAnimationFrame, selected = false): void {
  if (cell.width <= 0 || cell.height <= 0) return;
  const scale = ANIMATION_PREVIEW_SCALE;
  const dx = canvasAnimationOriginX(ctx) + x * scale;
  const dy = canvasAnimationOriginY(ctx) - y * scale;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate((frame.rotation * Math.PI) / 180);
  ctx.scale(frame.xScale, frame.yScale);
  ctx.drawImage(rig, cell.cellX, cell.cellY, cell.width, cell.height, 0, 0, cell.width * scale, cell.height * scale);
  ctx.restore();
  if (selected) {
    ctx.strokeStyle = "rgb(26 188 156 / 85%)";
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, cell.width * scale, cell.height * scale);
  }
}

function drawNcerCellCanvas(
  ctx: CanvasRenderingContext2D,
  rig: HTMLCanvasElement,
  cellBank: PokemonCellBank,
  cell: PokemonCell,
  nodeX: number,
  nodeY: number,
  frame: PokemonAnimationFrame,
  selected = false,
): void {
  const scale = ANIMATION_PREVIEW_SCALE;
  const transform = nitroAnimationTransform(frame);
  const baseX = nodeX + frame.x;
  const baseY = nodeY + frame.y;
  const isIdentity = transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
  const cellImage = renderNcerCellImageCanvas(rig, cellBank, cell);
  ctx.save();
  ctx.translate(canvasAnimationOriginX(ctx), canvasAnimationOriginY(ctx));
  ctx.scale(scale, scale);
  ctx.translate(baseX, baseY);
  if (!isIdentity) {
    ctx.transform(transform.a, transform.c, transform.b, transform.d, 0, 0);
  }
  ctx.drawImage(cellImage.canvas, cellImage.minX, cellImage.minY);
  if (selected) {
    ctx.strokeStyle = "rgb(26 188 156 / 90%)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cellImage.minX, cellImage.minY, Math.max(1, cellImage.maxX - cellImage.minX), Math.max(1, cellImage.maxY - cellImage.minY));
  }
  ctx.restore();
}

function drawMcssRigCellCanvas(
  ctx: CanvasRenderingContext2D,
  rig: HTMLCanvasElement,
  cell: RigCell,
  nodeX: number,
  nodeY: number,
  frame: PokemonAnimationFrame,
  selected = false,
): void {
  const scale = ANIMATION_PREVIEW_SCALE;
  const transform = nitroAnimationTransform(frame);
  const baseX = nodeX + frame.x;
  const baseY = nodeY + frame.y;
  const isIdentity = transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
  const bounds = mcssRigCellVisibleBounds(cell);
  ctx.save();
  ctx.translate(canvasAnimationOriginX(ctx), canvasAnimationOriginY(ctx));
  ctx.scale(scale, scale);
  ctx.translate(baseX, baseY);
  if (!isIdentity) {
    ctx.transform(transform.a, transform.c, transform.b, transform.d, 0, 0);
  }
  drawMcssRigCellPartCanvas(ctx, rig, cell);
  if (cell.subCell.width > 0 && cell.subCell.height > 0) drawMcssRigCellPartCanvas(ctx, rig, cell.subCell);
  if (selected) {
    ctx.strokeStyle = "rgb(26 188 156 / 90%)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  ctx.restore();
}

function drawMcssRigCellPartCanvas(ctx: CanvasRenderingContext2D, rig: HTMLCanvasElement, cell: RigCell): void {
  if (cell.width <= 0 || cell.height <= 0) return;
  ctx.drawImage(rig, cell.cellX, cell.cellY, cell.width, cell.height, cell.spriteX, -cell.spriteY, cell.width, cell.height);
}

function animationRenderState(project: ProjectState, spriteId: number, canvas: HTMLCanvasElement): AnimationRenderState | undefined {
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const multiCells = getPokemonMultiCells(project, spriteId, state.animationSide);
    const rigCells = getRigCells(project, spriteId, state.animationSide);
    const usePlayback = state.animationPlaying || state.animationTick > 0;
    const fallbackCell = multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0];
    const playback = usePlayback ? resolveMultiCellPlayback(project, spriteId, multiCells.cells, fallbackCell, state.animationTick) : undefined;
    const multiCell = playback?.multiCell ?? fallbackCell;
    if (!multiCell) return undefined;
    const tick = usePlayback ? state.animationTick : selectedAnimationTimelineTick(animation);
    const visibleNodeIndex = state.animationVisibleNode >= 0 && state.animationVisibleNode < multiCell.nodes.length ? state.animationVisibleNode : -1;
    const selectedNode = selectedAnimationNodeIndex(multiCell);
    const parts: AnimationRenderPart[] = [];
    for (let nodeIndex = multiCell.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
      if (visibleNodeIndex !== -1 && nodeIndex !== visibleNodeIndex) continue;
      const node = multiCell.nodes[nodeIndex];
      if (!node) continue;
      const sequence = animation.sequences[node.sequenceNumber];
      if (!sequence) continue;
      const nodeTick = usePlayback ? nodePlaybackTick(node, tick, playback?.frameStartTick ?? 0) : tick;
      const frameState = animationFrameStateForSequence(sequence, nodeTick, usePlayback);
      if (!frameState) continue;
      const frame = animationPreviewFrame(spriteId, state.animationSide, sequence.index, frameState.frameIndex, frameState.frame);
      const cell = rigCells.cells[frame.cellIndex];
      if (!cell) continue;
      parts.push(animationRenderPart(canvas, nodeIndex, node, sequence.index, frameState.frameIndex, frame, cell, playback?.outerFrame));
    }
    return {
      parts,
      selected: parts.find((part) => part.nodeIndex === selectedNode),
      outerFrame: playback?.outerFrame,
    };
  } catch {
    return undefined;
  }
}

function animationRenderPart(
  canvas: HTMLCanvasElement,
  nodeIndex: number,
  node: PokemonMultiCellNode,
  sequenceIndex: number,
  frameIndex: number,
  frame: PokemonAnimationFrame,
  cell: RigCell,
  outerFrame?: PokemonAnimationFrame,
): AnimationRenderPart {
  const transform = nitroAnimationTransform(frame);
  const localBounds = mcssRigCellVisibleBounds(cell);
  const baseX = node.x + frame.x;
  const baseY = node.y + frame.y;
  const localCorners = [
    { x: localBounds.x, y: localBounds.y },
    { x: localBounds.x + localBounds.width, y: localBounds.y },
    { x: localBounds.x + localBounds.width, y: localBounds.y + localBounds.height },
    { x: localBounds.x, y: localBounds.y + localBounds.height },
  ];
  const worldCorners = localCorners.map((point) => {
    const transformed = transformNcerPoint(point.x, point.y, transform);
    return { x: baseX + transformed.x, y: baseY + transformed.y };
  });
  const canvasCorners = worldCorners.map((point) => animationWorldToCanvas(point, canvas, outerFrame));
  const anchorLocal = { x: localBounds.x + localBounds.width / 2, y: localBounds.y + localBounds.height / 2 };
  const transformedAnchor = transformNcerPoint(anchorLocal.x, anchorLocal.y, transform);
  const anchorWorld = { x: baseX + transformedAnchor.x, y: baseY + transformedAnchor.y };
  const anchorCanvas = animationWorldToCanvas(anchorWorld, canvas, outerFrame);
  return {
    nodeIndex,
    node,
    sequenceIndex,
    frameIndex,
    frame,
    cell,
    localBounds,
    worldCorners,
    canvasCorners,
    anchorLocal,
    anchorWorld,
    anchorCanvas,
    handles: animationSelectionHandles(canvasCorners, anchorCanvas),
    canTranslate: frame.frameType === "index-srt" || frame.frameType === "index-t",
    canTransform: frame.frameType === "index-srt",
  };
}

function ncerVisibleBounds(cell: PokemonCell): AnimationSelectionBox {
  const visibleOams = cell.oams.filter((oam) => oam && !oam.disable && oam.width > 0 && oam.height > 0);
  const bounds = visibleOams.reduce(
    (acc, oam) => {
      const pos = ncerOamDisplayPosition(oam);
      return {
        minX: Math.min(acc.minX, pos.x),
        minY: Math.min(acc.minY, pos.y),
        maxX: Math.max(acc.maxX, pos.x + oam.width),
        maxY: Math.max(acc.maxY, pos.y + oam.height),
      };
    },
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : cell.minX;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : cell.minY;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : cell.maxX;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : cell.maxY;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function mcssRigCellVisibleBounds(cell: RigCell): AnimationSelectionBox {
  const parts = [cell, cell.subCell].filter((part) => part.width > 0 && part.height > 0);
  const bounds = parts.reduce(
    (acc, part) => {
      const x = part.spriteX;
      const y = -part.spriteY;
      return {
        minX: Math.min(acc.minX, x),
        minY: Math.min(acc.minY, y),
        maxX: Math.max(acc.maxX, x + part.width),
        maxY: Math.max(acc.maxY, y + part.height),
      };
    },
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : minX + 1;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : minY + 1;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function animationSelectionHandles(corners: AnimationCanvasPoint[], anchor: AnimationCanvasPoint): Record<AnimationDragMode, AnimationCanvasPoint> {
  const [nw, ne, se, sw] = corners;
  const n = midpoint(nw!, ne!);
  const e = midpoint(ne!, se!);
  const s = midpoint(se!, sw!);
  const w = midpoint(sw!, nw!);
  const topVector = normalizePoint({ x: n.x - anchor.x, y: n.y - anchor.y }, { x: 0, y: -1 });
  return {
    move: anchor,
    rotate: { x: n.x + topVector.x * 30, y: n.y + topVector.y * 30 },
    n,
    e,
    s,
    w,
    ne: ne!,
    nw: nw!,
    se: se!,
    sw: sw!,
  };
}

function drawAnimationPartOverlay(ctx: CanvasRenderingContext2D, part: AnimationRenderPart | undefined): void {
  if (!part) return;
  ctx.save();
  ctx.strokeStyle = "rgb(26 188 156 / 95%)";
  ctx.fillStyle = "#1abc9c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  part.canvasCorners.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(midpoint(part.canvasCorners[0]!, part.canvasCorners[1]!).x, midpoint(part.canvasCorners[0]!, part.canvasCorners[1]!).y);
  ctx.lineTo(part.handles.rotate.x, part.handles.rotate.y);
  ctx.stroke();
  for (const mode of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
    const point = part.handles[mode];
    ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
  }
  ctx.beginPath();
  ctx.arc(part.handles.rotate.x, part.handles.rotate.y, ANIMATION_ROTATE_HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffd84d";
  ctx.fillStyle = "#ffd84d";
  ctx.beginPath();
  ctx.moveTo(part.anchorCanvas.x - 7, part.anchorCanvas.y);
  ctx.lineTo(part.anchorCanvas.x + 7, part.anchorCanvas.y);
  ctx.moveTo(part.anchorCanvas.x, part.anchorCanvas.y - 7);
  ctx.lineTo(part.anchorCanvas.x, part.anchorCanvas.y + 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(part.anchorCanvas.x, part.anchorCanvas.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hitAnimationRenderedPart(pointer: AnimationCanvasPoint, parts: AnimationRenderPart[]): AnimationRenderPart | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part && pointInPolygon(pointer, part.canvasCorners)) return part;
  }
  return undefined;
}

function hitAnimationPart(pointer: AnimationCanvasPoint, part: AnimationRenderPart): AnimationDragMode | undefined {
  return hitAnimationHandles(pointer, part) ?? hitAnimationBody(pointer, part);
}

function hitAnimationHandles(pointer: AnimationCanvasPoint, part: AnimationRenderPart): AnimationDragMode | undefined {
  if (part.canTransform && distance(pointer, part.handles.rotate) <= ANIMATION_ROTATE_HIT_RADIUS) return "rotate";
  if (part.canTransform) {
    for (const mode of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
      if (distance(pointer, part.handles[mode]) <= 9) return mode;
    }
  }
  return undefined;
}

function hitAnimationBody(pointer: AnimationCanvasPoint, part: AnimationRenderPart): AnimationDragMode | undefined {
  return pointInPolygon(pointer, part.canvasCorners) ? "move" : undefined;
}

function canDragAnimationPart(part: AnimationRenderPart, mode: AnimationDragMode): boolean {
  if (mode === "move") return part.canTranslate;
  return part.canTransform;
}

function animationFrameForDrag(drag: AnimationDragState, pointer: AnimationCanvasPoint, canvas: HTMLCanvasElement, snap: boolean): PokemonAnimationFrameEdit {
  const currentWorld = canvasToAnimationWorld(pointer, canvas, drag.outerFrame);
  const next = { ...drag.startFrame };
  if (drag.mode === "move") {
    next.x = Math.round(drag.startFrame.x + currentWorld.x - drag.startWorldPointer.x);
    next.y = Math.round(drag.startFrame.y + currentWorld.y - drag.startWorldPointer.y);
    return next;
  }
  if (drag.mode === "rotate") {
    const startAngle = Math.atan2(drag.startWorldPointer.y - drag.startAnchorWorld.y, drag.startWorldPointer.x - drag.startAnchorWorld.x);
    const currentAngle = Math.atan2(currentWorld.y - drag.startAnchorWorld.y, currentWorld.x - drag.startAnchorWorld.x);
    next.rotation = normalizeRotation(drag.startFrame.rotation + ((currentAngle - startAngle) * 180) / Math.PI);
    if (snap) next.rotation = Math.round(next.rotation / 45) * 45;
    return animationFramePreservingAnchor(next, drag.node, drag.anchorLocal, drag.startAnchorWorld);
  }
  const startVector = { x: drag.startWorldPointer.x - drag.startAnchorWorld.x, y: drag.startWorldPointer.y - drag.startAnchorWorld.y };
  const currentVector = { x: currentWorld.x - drag.startAnchorWorld.x, y: currentWorld.y - drag.startAnchorWorld.y };
  const rotation = (drag.startFrame.rotation * Math.PI) / 180;
  const right = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const down = { x: -Math.sin(rotation), y: Math.cos(rotation) };
  if (drag.mode.includes("e") || drag.mode.includes("w")) {
    const ratio = safeRatio(dot(currentVector, right), dot(startVector, right));
    next.xScale = clampScale(drag.startFrame.xScale * ratio);
    if (snap) next.xScale = snapScale(next.xScale);
  }
  if (drag.mode.includes("n") || drag.mode.includes("s")) {
    const ratio = safeRatio(dot(currentVector, down), dot(startVector, down));
    next.yScale = clampScale(drag.startFrame.yScale * ratio);
    if (snap) next.yScale = snapScale(next.yScale);
  }
  return animationFramePreservingAnchor(next, drag.node, drag.anchorLocal, drag.startAnchorWorld);
}

function animationFramePreservingAnchor(
  frame: PokemonAnimationFrameEdit,
  node: PokemonMultiCellNode,
  anchorLocal: AnimationCanvasPoint,
  anchorWorld: AnimationCanvasPoint,
): PokemonAnimationFrameEdit {
  const transform = nitroAnimationTransform({ ...neutralAnimationFrame(), ...frame });
  const movedAnchor = transformNcerPoint(anchorLocal.x, anchorLocal.y, transform);
  return {
    ...frame,
    x: Math.round(anchorWorld.x - node.x - movedAnchor.x),
    y: Math.round(anchorWorld.y - node.y - movedAnchor.y),
  };
}

function drawNcerCell(
  output: RgbaImageData,
  rig: RgbaImageData,
  cellBank: PokemonCellBank,
  cell: PokemonCell,
  nodeX: number,
  nodeY: number,
  frame: PokemonAnimationFrame,
  selected = false,
): AnimationSelectionBox | undefined {
  const transform = nitroAnimationTransform(frame);
  const baseX = nodeX + floatToInt(transform.transX);
  const baseY = nodeY + floatToInt(transform.transY);
  const isIdentity = transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
  const inverse = inverseNitroCellTransform(transform);
  for (let index = cell.oams.length - 1; index >= 0; index -= 1) {
    const oam = cell.oams[index];
    if (!oam || oam.disable || oam.width <= 0 || oam.height <= 0) continue;
    const block = renderNcerOamBlock(rig, cellBank, oam);
    drawNcerOamBlock(output, block, oam, baseX, baseY, transform, inverse, isIdentity);
  }
  return selected ? { x: baseX + cell.minX, y: baseY + cell.minY, width: Math.max(1, cell.maxX - cell.minX), height: Math.max(1, cell.maxY - cell.minY) } : undefined;
}

function renderNcerOamBlock(rig: RgbaImageData, cellBank: PokemonCellBank, oam: PokemonCellOam): RgbaImageData {
  const block = emptyRgbaImage(oam.width, oam.height);
  const tilesWide = Math.max(1, Math.floor(oam.width / 8));
  const tilesHigh = Math.max(1, Math.floor(oam.height / 8));
  const sourceTilesWide = Math.max(1, Math.floor(rig.width / 8));
  const tileStart = ncerTileStart(oam.characterName, cellBank.mappingMode, oam.characterBits);
  for (let tileY = 0; tileY < tilesHigh; tileY += 1) {
    for (let tileX = 0; tileX < tilesWide; tileX += 1) {
      const tileIndex = ncerTileIndex(tileStart, tileX, tileY, tilesWide, sourceTilesWide, cellBank.mappingMode);
      const sx = (tileIndex % sourceTilesWide) * 8;
      const sy = Math.floor(tileIndex / sourceTilesWide) * 8;
      if (sx >= rig.width || sy >= rig.height) continue;
      copyImageRect(rig, block, sx, sy, 8, 8, tileX * 8, tileY * 8);
    }
  }
  return block;
}

function renderNcerOamBlockCanvas(rig: HTMLCanvasElement, cellBank: PokemonCellBank, oam: PokemonCellOam): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = oam.width;
  canvas.height = oam.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  const tilesWide = Math.max(1, Math.floor(oam.width / 8));
  const tilesHigh = Math.max(1, Math.floor(oam.height / 8));
  const sourceTilesWide = Math.max(1, Math.floor(rig.width / 8));
  const tileStart = ncerTileStart(oam.characterName, cellBank.mappingMode, oam.characterBits);
  for (let tileY = 0; tileY < tilesHigh; tileY += 1) {
    for (let tileX = 0; tileX < tilesWide; tileX += 1) {
      const tileIndex = ncerTileIndex(tileStart, tileX, tileY, tilesWide, sourceTilesWide, cellBank.mappingMode);
      const sx = (tileIndex % sourceTilesWide) * 8;
      const sy = Math.floor(tileIndex / sourceTilesWide) * 8;
      if (sx >= rig.width || sy >= rig.height) continue;
      ctx.drawImage(rig, sx, sy, 8, 8, tileX * 8, tileY * 8, 8, 8);
    }
  }
  return canvas;
}

type RenderedNcerCellCanvas = {
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function ncerOamDisplayPosition(oam: PokemonCellOam): { x: number; y: number } {
  return {
    x: oam.x + (oam.doubleSize ? oam.width / 2 : 0),
    y: oam.y + (oam.doubleSize ? oam.height / 2 : 0),
  };
}

function renderNcerCellImageCanvas(rig: HTMLCanvasElement, cellBank: PokemonCellBank, cell: PokemonCell): RenderedNcerCellCanvas {
  const visibleOams = cell.oams.filter((oam) => oam && !oam.disable && oam.width > 0 && oam.height > 0);
  const bounds = visibleOams.reduce(
    (acc, oam) => {
      const pos = ncerOamDisplayPosition(oam);
      return {
        minX: Math.min(acc.minX, pos.x),
        minY: Math.min(acc.minY, pos.y),
        maxX: Math.max(acc.maxX, pos.x + oam.width),
        maxY: Math.max(acc.maxY, pos.y + oam.height),
      };
    },
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : cell.minX;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : cell.minY;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : cell.maxX;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : cell.maxY;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, minX, minY, maxX, maxY };
  ctx.imageSmoothingEnabled = false;
  for (let index = cell.oams.length - 1; index >= 0; index -= 1) {
    const oam = cell.oams[index];
    if (!oam || oam.disable || oam.width <= 0 || oam.height <= 0) continue;
    const block = renderNcerOamBlockCanvas(rig, cellBank, oam);
    const pos = ncerOamDisplayPosition(oam);
    const dx = pos.x - minX;
    const dy = pos.y - minY;
    ctx.save();
    if (oam.flipX || oam.flipY) {
      ctx.translate(dx + (oam.flipX ? oam.width : 0), dy + (oam.flipY ? oam.height : 0));
      ctx.scale(oam.flipX ? -1 : 1, oam.flipY ? -1 : 1);
      ctx.drawImage(block, 0, 0);
    } else {
      ctx.drawImage(block, dx, dy);
    }
    ctx.restore();
  }
  return { canvas, minX, minY, maxX, maxY };
}

function transformedNcerCellBounds(cell: PokemonCell, baseX: number, baseY: number, transform: NitroCellTransform, isIdentity: boolean): AnimationSelectionBox {
  if (isIdentity) {
    return { x: baseX + cell.minX, y: baseY + cell.minY, width: Math.max(1, cell.maxX - cell.minX), height: Math.max(1, cell.maxY - cell.minY) };
  }
  const corners = [
    transformNcerPoint(cell.minX, cell.minY, transform),
    transformNcerPoint(cell.maxX, cell.minY, transform),
    transformNcerPoint(cell.maxX, cell.maxY, transform),
    transformNcerPoint(cell.minX, cell.maxY, transform),
  ];
  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const maxY = Math.max(...corners.map((corner) => corner.y));
  return { x: baseX + minX, y: baseY + minY, width: maxX - minX, height: maxY - minY };
}

function transformNcerPoint(x: number, y: number, transform: NitroCellTransform): { x: number; y: number } {
  return {
    x: nitroMul(transform.a, x) + nitroMul(transform.b, y),
    y: nitroMul(transform.c, x) + nitroMul(transform.d, y),
  };
}

function nitroMul(value: number, coordinate: number): number {
  return Math.round(value * coordinate);
}

function drawNcerOamBlock(
  output: RgbaImageData,
  block: RgbaImageData,
  oam: PokemonCellOam,
  baseX: number,
  baseY: number,
  transform: NitroCellTransform,
  inverse: NitroCellTransform,
  isIdentity: boolean,
  forceAffine = false,
): void {
  const position = transformedNcerOamPosition(oam, transform, isIdentity);
  const xOffs = baseX + 256;
  const yOffs = baseY + 128;
  const doubleSize = oam.doubleSize ? 1 : 0;
  if (!(oam.rotateScale || forceAffine)) {
    const x = position.x + (doubleSize ? oam.width / 2 : 0);
    const y = position.y + (doubleSize ? oam.height / 2 : 0);
    for (let j = 0; j < oam.height; j += 1) {
      const destY = (y + j + yOffs) & 0xff;
      const sourceY = oam.flipY ? oam.height - 1 - j : j;
      for (let k = 0; k < oam.width; k += 1) {
        const destX = (x + k + xOffs) & 0x1ff;
        const sourceX = oam.flipX ? oam.width - 1 - k : k;
        copyOpaquePixel(block, output, sourceX, sourceY, destX, destY);
      }
    }
    return;
  }
  const realWidth = oam.width << doubleSize;
  const realHeight = oam.height << doubleSize;
  const cx = (realWidth - 1) * 0.5;
  const cy = (realHeight - 1) * 0.5;
  for (let j = 0; j < realHeight; j += 1) {
    const destY = (position.y + j + yOffs) & 0xff;
    for (let k = 0; k < realWidth; k += 1) {
      const destX = (position.x + k + xOffs) & 0x1ff;
      let sourceX = floatToInt((k - cx) * inverse.a + (j - cy) * inverse.b + cx);
      let sourceY = floatToInt((k - cx) * inverse.c + (j - cy) * inverse.d + cy);
      if (doubleSize) {
        sourceX -= realWidth / 4;
        sourceY -= realHeight / 4;
      }
      copyOpaquePixel(block, output, sourceX, sourceY, destX, destY);
    }
  }
}

type AnimationSelectionBox = { x: number; y: number; width: number; height: number };

type NitroCellTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  transX: number;
  transY: number;
};

function nitroAnimationTransform(frame: PokemonAnimationFrame): NitroCellTransform {
  const rotation = (frame.rotation * Math.PI) / 180;
  if (rotation === 0) {
    return {
      a: frame.xScale,
      b: 0,
      c: 0,
      d: frame.yScale,
      transX: frame.x,
      transY: frame.y,
    };
  }
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  return {
    a: frame.xScale * cos,
    b: -frame.yScale * sin,
    c: frame.xScale * sin,
    d: frame.yScale * cos,
    transX: frame.x,
    transY: frame.y,
  };
}

function inverseNitroCellTransform(transform: NitroCellTransform): NitroCellTransform {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (determinant === 0) return { a: 127.99609375, b: 0, c: 0, d: 127.99609375, transX: 0, transY: 0 };
  return {
    a: transform.d / determinant,
    b: -transform.b / determinant,
    c: -transform.c / determinant,
    d: transform.a / determinant,
    transX: 0,
    transY: 0,
  };
}

function transformedNcerOamPosition(oam: PokemonCellOam, transform: NitroCellTransform, isIdentity: boolean): { x: number; y: number } {
  let x = oam.x;
  let y = oam.y;
  const doubleSize = oam.doubleSize ? 1 : 0;
  if (!isIdentity) {
    const realWidth = oam.width << doubleSize;
    const realHeight = oam.height << doubleSize;
    const movedX = x + realWidth / 2;
    const movedY = y + realHeight / 2;
    x = floatToInt(movedX * transform.a + movedY * transform.b) - realWidth / 2;
    y = floatToInt(movedX * transform.c + movedY * transform.d) - realHeight / 2;
  }
  if (doubleSize) {
    x += oam.width / 2;
    y += oam.height / 2;
  }
  return { x, y };
}

function copyOpaquePixel(source: RgbaImageData, target: RgbaImageData, sx: number, sy: number, tx: number, ty: number): void {
  if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height || tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) return;
  const sourceOffset = (Math.trunc(sy) * source.width + Math.trunc(sx)) * 4;
  if ((source.pixels[sourceOffset + 3] ?? 0) === 0) return;
  const targetOffset = (ty * target.width + tx) * 4;
  target.pixels[targetOffset] = source.pixels[sourceOffset] ?? 0;
  target.pixels[targetOffset + 1] = source.pixels[sourceOffset + 1] ?? 0;
  target.pixels[targetOffset + 2] = source.pixels[sourceOffset + 2] ?? 0;
  target.pixels[targetOffset + 3] = source.pixels[sourceOffset + 3] ?? 255;
}

function drawAnimationSelectionBoxes(ctx: CanvasRenderingContext2D, boxes: AnimationSelectionBox[], scale: number, originX: number, originY: number): void {
  ctx.strokeStyle = "rgb(26 188 156 / 90%)";
  ctx.lineWidth = 2;
  for (const box of boxes) {
    ctx.strokeRect(originX + (256 + box.x) * scale, originY + (128 + box.y) * scale, box.width * scale, box.height * scale);
  }
}

function floatToInt(value: number): number {
  return value < 0 ? Math.trunc(value - 0.5) : Math.trunc(value + 0.5);
}

function ncerTileStart(characterName: number, mappingMode: number, characterBits: 4 | 8): number {
  const boundaryBytes = ncerMappingBoundaryBytes(mappingMode);
  return Math.floor((boundaryBytes * characterName) / (characterBits * 8));
}

function ncerTileIndex(tileStart: number, tileX: number, tileY: number, objectTilesWide: number, sourceTilesWide: number, mappingMode: number): number {
  if (ncerIs2dMappingMode(mappingMode)) return tileStart + tileX + tileY * sourceTilesWide;
  return tileStart + tileX + tileY * objectTilesWide;
}

function ncerIs2dMappingMode(mappingMode: number): boolean {
  // NCER stores the raw GX mapping constant. NitroPaint's UI enum also uses 4
  // for 2D, so accept both forms when rendering imported/generated data.
  return mappingMode === 0 || mappingMode === 4;
}

function ncerMappingBoundaryBytes(mappingMode: number): number {
  if (mappingMode === 1 || mappingMode === 0x100010) return 64;
  if (mappingMode === 2 || mappingMode === 0x200010) return 128;
  if (mappingMode === 3 || mappingMode === 0x300010) return 256;
  return 32;
}

function canvasAnimationOriginX(ctx: CanvasRenderingContext2D): number {
  return ctx.canvas.width / 2 + ANIMATION_PREVIEW_X_OFFSET;
}

function canvasAnimationOriginY(ctx: CanvasRenderingContext2D): number {
  return ctx.canvas.height / 2 + ANIMATION_PREVIEW_Y_OFFSET;
}

function canvasPointer(event: PointerEvent, canvas: HTMLCanvasElement): AnimationCanvasPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function animationWorldToCanvas(point: AnimationCanvasPoint, canvas: HTMLCanvasElement, outerFrame?: PokemonAnimationFrame): AnimationCanvasPoint {
  const scale = ANIMATION_PREVIEW_SCALE;
  const canvasPoint = {
    x: canvas.width / 2 + ANIMATION_PREVIEW_X_OFFSET + point.x * scale,
    y: canvas.height / 2 + ANIMATION_PREVIEW_Y_OFFSET + point.y * scale,
  };
  return outerFrame ? applyOuterFrameToCanvasPoint(canvasPoint, canvas, outerFrame) : canvasPoint;
}

function canvasToAnimationWorld(point: AnimationCanvasPoint, canvas: HTMLCanvasElement, outerFrame?: PokemonAnimationFrame): AnimationCanvasPoint {
  const unwrapped = outerFrame ? invertOuterFrameCanvasPoint(point, canvas, outerFrame) : point;
  const scale = ANIMATION_PREVIEW_SCALE;
  return {
    x: (unwrapped.x - (canvas.width / 2 + ANIMATION_PREVIEW_X_OFFSET)) / scale,
    y: (unwrapped.y - (canvas.height / 2 + ANIMATION_PREVIEW_Y_OFFSET)) / scale,
  };
}

function applyOuterFrameToCanvasPoint(point: AnimationCanvasPoint, canvas: HTMLCanvasElement, frame: PokemonAnimationFrame): AnimationCanvasPoint {
  const scale = ANIMATION_PREVIEW_SCALE;
  const origin = { x: canvas.width / 2 + ANIMATION_PREVIEW_X_OFFSET, y: canvas.height / 2 + ANIMATION_PREVIEW_Y_OFFSET };
  const movedOrigin = { x: origin.x + frame.x * scale, y: origin.y + frame.y * scale };
  const rotation = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: movedOrigin.x + (dx * frame.xScale * cos - dy * frame.yScale * sin),
    y: movedOrigin.y + (dx * frame.xScale * sin + dy * frame.yScale * cos),
  };
}

function invertOuterFrameCanvasPoint(point: AnimationCanvasPoint, canvas: HTMLCanvasElement, frame: PokemonAnimationFrame): AnimationCanvasPoint {
  const scale = ANIMATION_PREVIEW_SCALE;
  const origin = { x: canvas.width / 2 + ANIMATION_PREVIEW_X_OFFSET, y: canvas.height / 2 + ANIMATION_PREVIEW_Y_OFFSET };
  const movedOrigin = { x: origin.x + frame.x * scale, y: origin.y + frame.y * scale };
  const rotation = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - movedOrigin.x;
  const dy = point.y - movedOrigin.y;
  const sx = frame.xScale === 0 ? 1 : frame.xScale;
  const sy = frame.yScale === 0 ? 1 : frame.yScale;
  return {
    x: origin.x + (dx * cos + dy * sin) / sx,
    y: origin.y + (-dx * sin + dy * cos) / sy,
  };
}

function midpoint(a: AnimationCanvasPoint, b: AnimationCanvasPoint): AnimationCanvasPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function normalizePoint(point: AnimationCanvasPoint, fallback: AnimationCanvasPoint): AnimationCanvasPoint {
  const length = Math.hypot(point.x, point.y);
  return length < 0.001 ? fallback : { x: point.x / length, y: point.y / length };
}

function pointInPolygon(point: AnimationCanvasPoint, polygon: AnimationCanvasPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects = pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y || 1) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distance(a: AnimationCanvasPoint, b: AnimationCanvasPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dot(a: AnimationCanvasPoint, b: AnimationCanvasPoint): number {
  return a.x * b.x + a.y * b.y;
}

function safeRatio(value: number, base: number): number {
  return Math.abs(base) < 0.001 ? 1 : value / base;
}

function clampScale(value: number): number {
  const clamped = clamp(value, -8, 8);
  if (Math.abs(clamped) >= 0.05) return clamped;
  return clamped < 0 ? -0.05 : 0.05;
}

function snapScale(value: number): number {
  if (Math.abs(value) >= 1) return Math.round(value * 4) / 4;
  return Math.round(value * 20) / 20;
}

function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function animationDragCursor(mode: AnimationDragMode): string {
  if (mode === "move") return "move";
  if (mode === "rotate") return "crosshair";
  if (mode === "n" || mode === "s") return "ns-resize";
  if (mode === "e" || mode === "w") return "ew-resize";
  if (mode === "ne" || mode === "sw") return "nesw-resize";
  return "nwse-resize";
}

function renderPreviewCanvases(project: ProjectState, hasFemale: boolean): string {
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  const grouped = [
    { kind: "sprite", title: "", variants: variantOptions(hasFemale).filter((variant) => variant.kind === "sprite") },
    { kind: "rig", title: "Rigs", variants: variantOptions(hasFemale).filter((variant) => variant.kind === "rig") },
  ];
  return grouped
    .map((group) => `
      <div class="sprite-preview-group">
        <div class="sprite-preview-group-header">
          ${
            group.kind === "sprite"
              ? `<div class="sprite-preview-tabs" role="tablist" aria-label="Sprite palette">
                  <button class="btn -default ${state.previewPaletteKind === "normal" ? "-active" : ""}" data-preview-palette="normal" type="button" role="tab" aria-selected="${state.previewPaletteKind === "normal"}">Normal</button>
                  <button class="btn -default ${state.previewPaletteKind === "shiny" ? "-active" : ""}" data-preview-palette="shiny" type="button" role="tab" aria-selected="${state.previewPaletteKind === "shiny"}">Shiny</button>
                </div>`
              : `<h3>${group.title}</h3>`
          }
        </div>
        <div class="sprite-preview-grid">
          ${group.variants
            .map(
              (variant) => `
        <div class="sprite-preview-item">
          <div class="sprite-preview-item-header">
            <div>${escapeHtml(variantLabel(variant))}</div>
            <div class="sprite-preview-item-actions">
              <button class="btn -default" data-export-preview="${variantValue(variant)}" type="button">Export</button>
              <label class="btn -default file-btn">Import<input data-import-preview="${variantValue(variant)}" type="file" accept="image/png"></label>
            </div>
          </div>
          <canvas id="preview-${variantValue(variant)}" data-preview-kind="${variant.kind}" width="${variant.kind === "rig" ? rigAtlas.width : 96}" height="${variant.kind === "rig" ? rigAtlas.height : 96}"></canvas>
        </div>
      `,
            )
            .join("")}
        </div>
      </div>
    `)
    .join("");
}

function renderAnimationSection(project: ProjectState, spriteId: number): string {
  const previewActive = state.animationTab === "preview";
  return `
    <section class="sprite-section" id="sprite-animation-section">
      <div class="sprite-section-header animation-section-header">
        <div class="animation-title-row">
          <h2>Animation</h2>
          ${renderAnimationScrubber(project, spriteId)}
        </div>
        <div class="sprite-actions -inline">
          ${previewActive ? `<button class="btn -default" id="animation-apply" type="button">Apply Frame</button>` : ""}
        </div>
      </div>
      <div class="animation-workbench">
        ${renderAnimationTabButtons()}
        ${previewActive ? `${renderAnimationEditor(project, spriteId)}${renderGifFlipbookImportControls(project, spriteId)}` : renderAnimationFileEditor(project, spriteId, state.animationTab)}
      </div>
    </section>
  `;
}

function renderAnimationTabButtons(): string {
  const tabs: Array<{ value: AnimationEditorTab; label: string }> = [
    { value: "preview", label: "Preview" },
    { value: "nanr", label: "NANR" },
    { value: "nmar", label: "NMAR" },
    { value: "nmcr", label: "NMCR" },
    { value: "ncer", label: "NCER" },
    { value: "ncec", label: "NCEC" },
  ];
  return `
    <div class="animation-file-tabs sprite-preview-tabs" role="tablist" aria-label="Animation editor file tabs">
      ${tabs
        .map(
          (tab) =>
            `<button class="btn -default ${state.animationTab === tab.value ? "-active" : ""}" data-animation-tab="${tab.value}" type="button" role="tab" aria-selected="${state.animationTab === tab.value}">${tab.label}</button>`,
        )
        .join("")}
    </div>
  `;
}

function renderAnimationFileEditor(project: ProjectState, spriteId: number, tab: AnimationEditorTab): string {
  try {
    const sideControls = renderAnimationFileSideControls();
    if (tab === "nanr") {
      const animation = animationFileDraftFor(spriteId, state.animationSide, "nanr") ?? getPokemonAnimation(project, spriteId, state.animationSide);
      return renderAnimationSequenceEditor("nanr", "NANR Cell Animation", sideControls, animation);
    }
    if (tab === "nmar") {
      const animation = animationFileDraftFor(spriteId, state.animationSide, "nmar") ?? getPokemonMultiCellAnimation(project, spriteId, state.animationSide);
      return renderAnimationSequenceEditor("nmar", "NMAR Multi-Cell Animation", sideControls, animation);
    }
    if (tab === "nmcr") return renderNmcrEditor(sideControls, getPokemonMultiCells(project, spriteId, state.animationSide));
    if (tab === "ncer") return renderNcerEditor(sideControls, getPokemonCellBank(project, spriteId, state.animationSide));
    if (tab === "ncec") return renderNcecEditor(sideControls, getRigCells(project, spriteId, state.animationSide));
    return renderAnimationEditor(project, spriteId);
  } catch (error) {
    return `<div class="sprite-editor-error -inline">${escapeHtml(errorMessage(error))}</div>`;
  }
}

function renderAnimationFileSideControls(): string {
  return `
    <div class="animation-file-side sprite-preview-tabs" role="tablist" aria-label="Animation side">
      <button class="btn -default ${state.animationSide === "front" ? "-active" : ""}" data-animation-side="front" type="button" role="tab" aria-selected="${state.animationSide === "front"}">Front</button>
      <button class="btn -default ${state.animationSide === "back" ? "-active" : ""}" data-animation-side="back" type="button" role="tab" aria-selected="${state.animationSide === "back"}">Back</button>
    </div>
  `;
}

function renderAnimationFileActions(kind: AnimationEditorTab): string {
  return `
    <div class="sprite-actions -inline">
      <button class="btn -default" data-animation-file-apply="${kind}" type="button">Apply</button>
      <button class="btn -default" data-animation-file-revert="${kind}" type="button">Revert</button>
    </div>
  `;
}

function renderAnimationSequenceEditor(kind: "nanr" | "nmar", title: string, sideControls: string, animation: PokemonAnimation): string {
  return `
    <div class="animation-file-editor" data-animation-file-editor="${kind}">
      <div class="animation-file-header">
        <div>
          <div class="sprite-sidebar-heading">${title}</div>
          ${sideControls}
        </div>
        ${renderAnimationFileActions(kind)}
      </div>
      <div class="animation-file-sequences">
        ${animation.sequences.map((sequence) => renderAnimationSequenceTable(kind, sequence)).join("")}
      </div>
    </div>
  `;
}

function renderAnimationSequenceTable(kind: "nanr" | "nmar", sequence: PokemonAnimationSequence): string {
  return `
    <div class="animation-file-sequence" data-animation-sequence="${sequence.index}">
      <div class="animation-file-sequence-header">
        <strong>Sequence ${sequence.index}</strong>
        <label class="sprite-field"><span>Mode</span><input data-animation-sequence-field="mode" type="number" value="${sequence.mode}"></label>
        <label class="sprite-field"><span>Motion</span><select data-animation-sequence-field="motionType">
          ${[0, 1, 2].map((value) => `<option value="${value}" ${sequence.motionType === value ? "selected" : ""}>${animationMotionTypeLabel(value)}</option>`).join("")}
        </select></label>
        <input data-animation-sequence-field="startFrameIndex" type="hidden" value="${sequence.startFrameIndex}">
      </div>
      <div class="animation-file-table-wrap">
        <table class="animation-file-table">
          <thead><tr><th>Frame</th><th>${kind === "nanr" ? "Cell" : "Group"}</th><th>Duration</th><th>X</th><th>Y</th><th>Rotation</th><th>Scale X</th><th>Scale Y</th><th></th></tr></thead>
          <tbody>
            ${sequence.frames
              .map(
                (frame, frameIndex) => `
                  <tr data-animation-frame-row data-sequence="${sequence.index}" data-frame="${frameIndex}">
                    <td>${frameIndex}</td>
                    <td><input data-animation-frame-field="cellIndex" type="number" min="0" value="${frame.cellIndex}"></td>
                    <td><input data-animation-frame-field="duration" type="number" min="1" value="${frame.duration}"></td>
                    <td><input data-animation-frame-field="x" type="number" value="${frame.x}"></td>
                    <td><input data-animation-frame-field="y" type="number" value="${frame.y}"></td>
                    <td><input data-animation-frame-field="rotation" type="number" step="0.1" value="${roundDisplay(frame.rotation)}"></td>
                    <td><input data-animation-frame-field="xScale" type="number" step="0.05" value="${roundDisplay(frame.xScale)}"></td>
                    <td><input data-animation-frame-field="yScale" type="number" step="0.05" value="${roundDisplay(frame.yScale)}"></td>
                    <td class="animation-file-row-actions">
                      <button class="btn -default" data-animation-frame-action="insert" data-kind="${kind}" data-sequence="${sequence.index}" data-frame="${frameIndex}" type="button">Insert</button>
                      <button class="btn -default" data-animation-frame-action="duplicate" data-kind="${kind}" data-sequence="${sequence.index}" data-frame="${frameIndex}" type="button">Duplicate</button>
                      <button class="btn -default sprite-remove-btn" data-animation-frame-action="delete" data-kind="${kind}" data-sequence="${sequence.index}" data-frame="${frameIndex}" type="button" ${sequence.frames.length <= 1 ? "disabled" : ""}>Delete</button>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderNmcrEditor(sideControls: string, multiCells: ReturnType<typeof getPokemonMultiCells>): string {
  return `
    <div class="animation-file-editor" data-animation-file-editor="nmcr">
      <div class="animation-file-header">
        <div><div class="sprite-sidebar-heading">NMCR Multi-Cell Groups</div>${sideControls}</div>
        ${renderAnimationFileActions("nmcr")}
      </div>
      <div class="animation-file-sequences">
        ${multiCells.cells
          .map(
            (cell) => `
              <div class="animation-file-sequence" data-nmcr-group="${cell.index}">
                <div class="animation-file-sequence-header">
                  <strong>Group ${cell.index}</strong>
                  <label class="sprite-field"><span>Cell Anims</span><input data-nmcr-group-field="cellAnimationCount" type="number" min="1" value="${cell.cellAnimationCount}"></label>
                </div>
                <div class="animation-file-table-wrap">
                  <table class="animation-file-table">
                    <thead><tr><th>Node</th><th>Sequence</th><th>X</th><th>Y</th><th>Cell Anim</th><th>Play Mode</th><th>Visible</th></tr></thead>
                    <tbody>
                      ${cell.nodes
                        .map(
                          (node, nodeIndex) => `
                            <tr data-nmcr-node-row data-group="${cell.index}" data-node="${nodeIndex}">
                              <td>${nodeIndex}</td>
                              <td><input data-nmcr-node-field="sequenceNumber" type="number" min="0" value="${node.sequenceNumber}"></td>
                              <td><input data-nmcr-node-field="x" type="number" value="${node.x}"></td>
                              <td><input data-nmcr-node-field="y" type="number" value="${node.y}"></td>
                              <td><input data-nmcr-node-field="cellAnimationIndex" type="number" min="0" value="${node.cellAnimationIndex}"></td>
                              <td><input data-nmcr-node-field="playMode" type="number" min="0" max="15" value="${node.playMode}"></td>
                              <td><input data-nmcr-node-field="visible" type="checkbox" ${node.visible ? "checked" : ""}></td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderNcerEditor(sideControls: string, cellBank: PokemonCellBank): string {
  return `
    <div class="animation-file-editor" data-animation-file-editor="ncer">
      <div class="animation-file-header">
        <div>
          <div class="sprite-sidebar-heading">NCER Cell Bank</div>
          ${sideControls}
          <label class="sprite-field"><span>Mapping</span><input id="ncer-mapping-mode" type="number" value="${cellBank.mappingMode}"></label>
        </div>
        ${renderAnimationFileActions("ncer")}
      </div>
      <div class="animation-file-sequences">
        ${cellBank.cells
          .map(
            (cell) => `
              <div class="animation-file-sequence" data-ncer-cell="${cell.index}">
                <div class="animation-file-sequence-header">
                  <strong>Cell ${cell.index}</strong>
                  <label class="sprite-field"><span>Attr</span><input data-ncer-cell-field="cellAttr" type="number" min="0" max="65535" value="${cell.cellAttr}"></label>
                  <span>${cell.oams.length} OAM</span>
                </div>
                <div class="animation-file-table-wrap">
                  <table class="animation-file-table">
                    <thead><tr><th>OAM</th><th>X</th><th>Y</th><th>Size</th><th>Tile</th><th>Pal</th><th>Pri</th><th>Flip X</th><th>Flip Y</th><th>Affine</th><th>Dbl/Off</th><th>Matrix</th><th>Mode</th><th>Bits</th></tr></thead>
                    <tbody>
                      ${cell.oams
                        .map(
                          (oam, oamIndex) => `
                            <tr data-ncer-oam-row data-cell="${cell.index}" data-oam="${oamIndex}">
                              <td>${oamIndex}</td>
                              <td><input data-ncer-oam-field="x" type="number" value="${oam.x}"></td>
                              <td><input data-ncer-oam-field="y" type="number" value="${oam.y}"></td>
                              <td><select data-ncer-oam-field="objectSize">${renderOamSizeOptions(oam.width, oam.height)}</select></td>
                              <td><input data-ncer-oam-field="characterName" type="number" min="0" max="1023" value="${oam.characterName}"></td>
                              <td><input data-ncer-oam-field="palette" type="number" min="0" max="15" value="${oam.palette}"></td>
                              <td><input data-ncer-oam-field="priority" type="number" min="0" max="3" value="${oam.priority}"></td>
                              <td><input data-ncer-oam-field="flipX" type="checkbox" ${oam.flipX ? "checked" : ""}></td>
                              <td><input data-ncer-oam-field="flipY" type="checkbox" ${oam.flipY ? "checked" : ""}></td>
                              <td><input data-ncer-oam-field="rotateScale" type="checkbox" ${oam.rotateScale ? "checked" : ""}></td>
                              <td><input data-ncer-oam-field="doubleSize" type="checkbox" ${oam.rotateScale ? (oam.doubleSize ? "checked" : "") : oam.disable ? "checked" : ""}></td>
                              <td><input data-ncer-oam-field="matrix" type="number" min="0" max="31" value="${oam.matrix}"></td>
                              <td><input data-ncer-oam-field="mode" type="number" min="0" max="3" value="${oam.mode}"></td>
                              <td><select data-ncer-oam-field="characterBits"><option value="4" ${oam.characterBits === 4 ? "selected" : ""}>4</option><option value="8" ${oam.characterBits === 8 ? "selected" : ""}>8</option></select></td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderNcecEditor(sideControls: string, rigCells: RigCellsFile): string {
  const flagText = [...rigCells.flags].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  return `
    <div class="animation-file-editor" data-animation-file-editor="ncec">
      <div class="animation-file-header">
        <div><div class="sprite-sidebar-heading">NCEC Rig Cell Metadata</div>${sideControls}</div>
        ${renderAnimationFileActions("ncec")}
      </div>
      <label class="sprite-field -wide"><span>Flags</span><textarea id="ncec-flags">${flagText}</textarea></label>
      <div class="animation-file-table-wrap">
        <table class="animation-file-table">
          <thead><tr><th>Cell</th><th>Cell X</th><th>Cell Y</th><th>Width</th><th>Height</th><th>Sprite X</th><th>Sprite Y</th><th>Sub X</th><th>Sub Y</th><th>Sub W</th><th>Sub H</th><th>Sub Sprite X</th><th>Sub Sprite Y</th></tr></thead>
          <tbody>
            ${rigCells.cells
              .map(
                (cell, index) => `
                  <tr data-ncec-cell-row data-cell="${index}">
                    <td>${index}</td>
                    ${renderNcecCellInputs(cell, "")}
                    ${renderNcecCellInputs(cell.subCell, "sub")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderNcecCellInputs(cell: RigCell, prefix: "" | "sub"): string {
  const fields: Array<keyof Pick<RigCell, "cellX" | "cellY" | "width" | "height" | "spriteX" | "spriteY">> = ["cellX", "cellY", "width", "height", "spriteX", "spriteY"];
  return fields
    .map((field) => `<td><input data-ncec-field="${prefix}${field}" type="number" step="0.01" value="${roundDisplay(cell[field] ?? 0)}"></td>`)
    .join("");
}

function animationMotionTypeLabel(value: number): string {
  if (value === 0) return "0 Index";
  if (value === 2) return "2 Translation";
  return "1 SRT";
}

function animationFileDraftFor(spriteId: number, side: PokemonAnimationSide, tab: "nanr" | "nmar"): PokemonAnimation | undefined {
  return animationFileDraft?.spriteId === spriteId && animationFileDraft.side === side && animationFileDraft.tab === tab ? animationFileDraft.animation : undefined;
}

const NITRO_OAM_SIZES = [
  { width: 8, height: 8, shape: 0, size: 0 },
  { width: 16, height: 8, shape: 1, size: 0 },
  { width: 8, height: 16, shape: 2, size: 0 },
  { width: 16, height: 16, shape: 0, size: 1 },
  { width: 32, height: 8, shape: 1, size: 1 },
  { width: 8, height: 32, shape: 2, size: 1 },
  { width: 32, height: 32, shape: 0, size: 2 },
  { width: 32, height: 16, shape: 1, size: 2 },
  { width: 16, height: 32, shape: 2, size: 2 },
  { width: 64, height: 64, shape: 0, size: 3 },
  { width: 64, height: 32, shape: 1, size: 3 },
  { width: 32, height: 64, shape: 2, size: 3 },
] as const;

function renderOamSizeOptions(width: number, height: number): string {
  return NITRO_OAM_SIZES.map((size) => {
    const value = `${size.width}x${size.height}`;
    return `<option value="${value}" ${size.width === width && size.height === height ? "selected" : ""}>${value}</option>`;
  }).join("");
}

function renderRigSection(project: ProjectState, rigCells: RigCellsFile): string {
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  return `
    <section class="sprite-section" id="sprite-rig-section">
      <div class="sprite-section-header">
        <h2>Rig Cells</h2>
        <div class="sprite-actions -inline">
          <button class="btn -default" id="rig-apply" type="button">Apply Cells</button>
        </div>
      </div>
      <div class="rig-editor-grid">
        <div class="rig-canvas-wrap">
          <canvas id="rig-cells-canvas" width="${rigAtlas.width * 3}" height="${rigAtlas.height * 3}"></canvas>
          <div class="rig-canvas-tabs sprite-preview-tabs" role="tablist" aria-label="Rig cell side">
            <button class="btn -default ${state.rigSide === "front" ? "-active" : ""}" data-rig-side="front" type="button" role="tab" aria-selected="${state.rigSide === "front"}">Front</button>
            <button class="btn -default ${state.rigSide === "back" ? "-active" : ""}" data-rig-side="back" type="button" role="tab" aria-selected="${state.rigSide === "back"}">Back</button>
          </div>
          <div class="rig-canvas-actions">
            <label class="btn -default file-btn">Import Cells<input id="rig-import-cells" type="file" accept="application/json,.json"></label>
          </div>
        </div>
        <div class="rig-controls">${renderRigControls(rigCells)}</div>
      </div>
    </section>
  `;
}

function renderGifFlipbookImportControls(project: ProjectState, spriteId: number): string {
  return `
    <div class="gif-flipbook-panel">
      <div class="sprite-sidebar-heading">GIF Flipbook</div>
      <div class="gif-flipbook-row">
        ${renderGifSideButtons()}
        ${renderGifPaletteButtons()}
      </div>
      <div class="gif-flipbook-row">
        ${renderGifFlipbookModeButtons()}
        ${renderGifFlipbookStrategyButtons()}
      </div>
      <div class="gif-flipbook-row -numbers">
        <label class="sprite-field">
          <span>Source %</span>
          <input id="gif-flipbook-source-percent" type="number" min="1" max="100" value="100">
        </label>
        <label class="sprite-field">
          <span>Scale %</span>
          <input id="gif-flipbook-downscale-percent" type="number" min="5" max="100" step="5" value="${state.gifFlipbookDownscalePercent}">
        </label>
        <label class="sprite-field gif-speed-field">
          <span>Speed <strong id="gif-flipbook-speed-label">${formatSpeedScale(state.gifFlipbookSpeedScale)}x</strong></span>
          <input id="gif-flipbook-speed-scale" type="range" min="0.1" max="4" step="0.1" value="${formatSpeedScale(state.gifFlipbookSpeedScale)}">
        </label>
      </div>
      <div class="gif-flipbook-row -timeline">
        ${renderGifLoopControls(project, spriteId)}
        <label class="sprite-field">
          <span>Rest Loops</span>
          <select id="gif-flipbook-rest-loops">
            <option value="auto">Auto</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
        <label class="sprite-field -checkbox">
          <span>Finish</span>
          <input id="gif-flipbook-include-finish" type="checkbox" checked title="Append later GIF frames after the repeated idle loop">
        </label>
      </div>
      ${renderGifManualSamplingControls()}
      <div class="gif-flipbook-row -import">
        <label class="sprite-bundle-drop gif-flipbook-drop" id="gif-flipbook-drop">
          <input id="gif-flipbook-import" type="file" accept="image/gif,.gif">
          <strong>Import GIF</strong>
          <span>Click or drop animation GIF</span>
        </label>
        <div class="gif-pair-import">
          <div class="sprite-sidebar-heading">Paired Palette Import</div>
          <div class="gif-pair-drops">
            <label class="sprite-bundle-drop gif-flipbook-drop -compact" id="gif-pair-front-drop">
              <input id="gif-pair-front-import" type="file" accept="image/gif,.gif">
              <strong>Front GIF</strong>
              <span data-gif-pair-name="front">Drop front GIF</span>
            </label>
            <label class="sprite-bundle-drop gif-flipbook-drop -compact" id="gif-pair-back-drop">
              <input id="gif-pair-back-import" type="file" accept="image/gif,.gif">
              <strong>Back GIF</strong>
              <span data-gif-pair-name="back">Drop back GIF</span>
            </label>
          </div>
          <button class="btn -default -full" id="gif-pair-import" type="button">Import Front + Back</button>
        </div>
      </div>
    </div>
  `;
}

function renderGifManualSamplingControls(): string {
  const source = state.gifSource;
  const frameCount = source?.frames.length ?? 0;
  return `
    <div class="gif-flipbook-row -manual">
      <div class="gif-viewer">
        <div class="sprite-sidebar-heading">GIF Viewer</div>
        <canvas id="gif-viewer-canvas" width="192" height="136"></canvas>
        <div class="gif-viewer-controls">
          <button class="btn -default" id="gif-viewer-prev" type="button" ${frameCount ? "" : "disabled"}>Prev</button>
          <button class="btn -default" id="gif-viewer-play" type="button" ${frameCount ? "" : "disabled"}>${state.gifViewerPlaying ? "Pause" : "Play"}</button>
          <button class="btn -default" id="gif-viewer-next" type="button" ${frameCount ? "" : "disabled"}>Next</button>
          <span id="gif-viewer-label">${frameCount ? `${state.gifViewerFrame}/${frameCount - 1} · ${escapeHtml(source?.fileName ?? "GIF")}` : "No GIF loaded"}</span>
        </div>
        <div class="gif-viewer-scrub">
          <input id="gif-viewer-frame" type="range" min="0" max="${Math.max(0, frameCount - 1)}" value="${clamp(state.gifViewerFrame, 0, Math.max(0, frameCount - 1))}" ${frameCount ? "" : "disabled"}>
          <input id="gif-viewer-number" type="number" min="0" max="${Math.max(0, frameCount - 1)}" value="${clamp(state.gifViewerFrame, 0, Math.max(0, frameCount - 1))}" ${frameCount ? "" : "disabled"}>
        </div>
      </div>
      <div class="gif-manual-sampling">
        <div class="sprite-sidebar-heading">Manual Sampling</div>
        <label class="sprite-field">
          <span>Frame Numbers</span>
          <input id="gif-manual-frames" type="text" value="${escapeHtml(state.gifManualFrames)}" placeholder="0, 4, 8, 12">
        </label>
        <button class="btn -default" id="gif-manual-apply" type="button" ${frameCount ? "" : "disabled"}>Apply Manual Frames</button>
      </div>
    </div>
  `;
}

function renderGifLoopControls(project: ProjectState, spriteId: number): string {
  const frameCount = gifLoopBaseFrameCount(project, spriteId, state.animationSide);
  state.gifLoopEndFrame = clamp(state.gifLoopEndFrame, 1, frameCount);
  state.gifLoopStartFrame = clamp(state.gifLoopStartFrame, 1, state.gifLoopEndFrame);
  state.gifLoopCount = clamp(state.gifLoopCount, 1, 12);
  return `
    <div class="gif-loop-controls">
      <div class="sprite-sidebar-heading">Timeline Loop</div>
      <div class="gif-loop-grid">
        <label class="sprite-field">
          <span>Start</span>
          <input data-gif-loop-field="start" type="number" min="1" max="${frameCount}" value="${state.gifLoopStartFrame}">
        </label>
        <label class="sprite-field">
          <span>End</span>
          <input data-gif-loop-field="end" type="number" min="1" max="${frameCount}" value="${state.gifLoopEndFrame}">
        </label>
        <label class="sprite-field">
          <span>Loops</span>
          <input data-gif-loop-field="count" type="number" min="1" max="12" value="${state.gifLoopCount}">
        </label>
      </div>
    </div>
  `;
}

function renderGifFlipbookModeButtons(): string {
  const options: { value: PokemonFlipbookPackingMode; label: string }[] = [
    { value: "mcss-safe", label: "Pose Blocks" },
    { value: "rotated-pose-blocks", label: "Rotated Pose" },
    { value: "macro-blocks", label: "Macro Blocks" },
  ];
  return renderGifSegmentedButtons("Mode", options, state.gifFlipbookPackingMode, "gif-flipbook-packing-mode");
}

function renderGifSideButtons(): string {
  return renderGifSegmentedButtons("Side", [
    { value: "front" as const, label: "Front" },
    { value: "back" as const, label: "Back" },
  ], state.animationSide, "gif-flipbook-side");
}

function renderGifPaletteButtons(): string {
  return renderGifSegmentedButtons("Palette", [
    { value: "normal" as const, label: "Normal" },
    { value: "shiny" as const, label: "Shiny" },
  ], state.previewPaletteKind, "gif-flipbook-palette");
}

function renderGifFlipbookStrategyButtons(): string {
  const options: { value: PokemonFlipbookSamplingStrategy; label: string }[] = [
    { value: "loop-rest", label: "Loop Rest" },
    { value: "first-window", label: "Keyframes" },
    { value: "even", label: "Even" },
  ];
  return renderGifSegmentedButtons("Sampling Strategy", options, state.gifFlipbookStrategy, "gif-flipbook-strategy");
}

function renderGifSegmentedButtons<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  active: T,
  dataName: "gif-flipbook-packing-mode" | "gif-flipbook-strategy" | "gif-flipbook-side" | "gif-flipbook-palette",
): string {
  const dataAttr = `data-${dataName}`;
  return `
    <div class="sprite-field gif-segmented-field">
      <span>${escapeHtml(label)}</span>
      <div class="gif-segmented-buttons" role="group" aria-label="${escapeHtml(label)}">
        ${options.map((option) => `
          <button class="btn -default ${option.value === active ? "-active" : ""}" ${dataAttr}="${escapeHtml(option.value)}" type="button" aria-pressed="${option.value === active}">${escapeHtml(option.label)}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderLastGifImportStats(summary: GifImportSummary): string {
  const report = summary.report;
  const warningText = report.warnings.length ? `<small>${escapeHtml(report.warnings.join(" | "))}</small>` : "<small>No import warnings.</small>";
  return `
    <div>
      <span>Last Import</span>
      <strong>${report.maxOamsPerPose}</strong>
      <small>${escapeHtml(summary.fileName)} ${summary.side}/${summary.paletteKind}; ${report.packingMode}, ${report.uniquePoseCount} pose(s), ${report.uniqueTileCount} tile(s), ${report.downscalePercent}% scale, ${report.visibilityValidation.invisibleFrameCount} invisible</small>
      <small id="last-gif-speed-label">${formatSpeedScale(summary.speedScale)}x speed</small>
      ${warningText}
    </div>
  `;
}

function currentSideOamSummary(project: ProjectState, spriteId: number, side: PokemonAnimationSide): { cellCount: number; maxOamsPerCell: number } {
  try {
    const cellBank = getPokemonCellBank(project, spriteId, side);
    return {
      cellCount: cellBank.cells.length,
      maxOamsPerCell: Math.max(0, ...cellBank.cells.map((cell) => cell.oams.length)),
    };
  } catch {
    return { cellCount: 0, maxOamsPerCell: 0 };
  }
}

function renderPaletteEditor(kind: PokemonPaletteKind, palette: RgbColor[]): string {
  const label = kind === "normal" ? "Normal" : "Shiny";
  return `
    <div class="palette-editor" data-palette-kind="${kind}">
      <h3>${label}</h3>
      <div class="palette-grid">
        ${palette
          .map(
            (color, index) => `
              <div class="palette-row">
                <label class="palette-swatch" data-palette-kind="${kind}" data-color="${index}" style="background: rgb(${color.r} ${color.g} ${color.b})" title="Edit color ${index}">
                  <input data-palette-picker="${kind}" data-color="${index}" type="color" value="${rgbToHex(color)}">
                </label>
                <strong>${index}</strong>
                <input data-palette="${kind}" data-color="${index}" data-channel="r" type="number" min="0" max="255" value="${color.r}">
                <input data-palette="${kind}" data-color="${index}" data-channel="g" type="number" min="0" max="255" value="${color.g}">
                <input data-palette="${kind}" data-color="${index}" data-channel="b" type="number" min="0" max="255" value="${color.b}">
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="palette-actions">
        <button class="btn -default" data-apply-palette="${kind}" type="button">Apply</button>
        <button class="btn -default" data-export-palette="${kind}" type="button">Export</button>
        <label class="btn -default file-btn">Import<input data-import-palette="${kind}" type="file" accept="image/png"></label>
      </div>
    </div>
  `;
}

function renderIconPalettes(palettes: RgbColor[][]): string {
  return palettes
    .map(
      (palette, paletteId) => `
        <div class="icon-palette">
          <button class="btn -default" data-export-icon-palette="${paletteId}" type="button">Export Palette ${paletteId}</button>
          <div class="icon-palette-swatches">${palette.map((color) => `<span style="background: rgb(${color.r} ${color.g} ${color.b})"></span>`).join("")}</div>
        </div>
      `,
    )
    .join("");
}

function renderSpeciesOptions(project: ProjectState, selectedSpeciesId: number): string {
  const count = getPokemonCount(project);
  const names = project.texts.banks.pokedex ?? [];
  return Array.from({ length: count }, (_, speciesId) => {
    const name = titleize(String(names[speciesId] ?? `Pokemon ${speciesId}`));
    return `<option value="${speciesId}" ${speciesId === selectedSpeciesId ? "selected" : ""}>${escapeHtml(name)} (#${speciesId})</option>`;
  }).join("");
}

function renderFormSelector(forms: ReturnType<typeof getPokemonSpriteFormOptions>, selectedFormIndex: number): string {
  if (forms.length <= 1) return "";
  if (forms.length < 7) {
    return `
      <div class="sprite-field">
        <span>Form</span>
        <div class="sprite-form-tabs" role="tablist" aria-label="Pokemon form">
          ${forms
            .map(
              (form) =>
                `<button class="btn -default ${form.formIndex === selectedFormIndex ? "-active" : ""}" data-form-tab="${form.formIndex}" type="button" role="tab" aria-selected="${form.formIndex === selectedFormIndex}">${escapeHtml(form.label)}</button>`,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  return `
    <label class="sprite-field">
      <span>Form</span>
      <select id="sprite-form-select">
        ${forms.map((form) => `<option value="${form.formIndex}" ${form.formIndex === selectedFormIndex ? "selected" : ""}>${escapeHtml(form.label)} (${form.spriteId})</option>`).join("")}
      </select>
    </label>
  `;
}

function renderRigControls(cells: RigCellsFile): string {
  const selected = selectedRigCell(cells);
  const hasSubCell = Boolean(cells.cells[state.selectedCell]?.subCell.width);
  return `
    <div class="sprite-field"><span>Selected</span><strong>Cell ${state.selectedCell}${state.selectedSubCell ? "b" : ""}</strong></div>
    ${(["cellX", "cellY", "width", "height", "spriteX", "spriteY"] as const)
      .map((field) => `<label class="sprite-field"><span>${field}</span><input data-rig-field="${field}" type="number" value="${selected[field] ?? 0}"></label>`)
      .join("")}
    <button class="btn -default ${hasSubCell ? "sprite-remove-btn" : ""}" id="rig-toggle-subcell" type="button">${hasSubCell ? "Remove Sub Cell" : "Add Sub Cell"}</button>
    <label class="sprite-field -wide"><span>Flags</span><textarea id="rig-flags">${[...cells.flags].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ")}</textarea></label>
  `;
}

function renderAnimationEditor(project: ProjectState, spriteId: number): string {
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const multiCells = getPokemonMultiCells(project, spriteId, state.animationSide);
    state.animationMultiCell = clamp(state.animationMultiCell, 0, Math.max(0, multiCells.cells.length - 1));
    const multiCell = multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0];
    state.animationVisibleNode = state.animationVisibleNode >= 0 && multiCell && state.animationVisibleNode < multiCell.nodes.length ? state.animationVisibleNode : -1;
    state.animationActiveNode = state.animationActiveNode >= 0 && multiCell && state.animationActiveNode < multiCell.nodes.length ? state.animationActiveNode : state.animationVisibleNode;
    const activeNodeIndex = selectedAnimationNodeIndex(multiCell);
    const activeNode = activeNodeIndex >= 0 ? multiCell?.nodes[activeNodeIndex] : undefined;
    const sequence = animation.sequences[activeNode?.sequenceNumber ?? state.animationSequence] ?? animation.sequences[state.animationSequence] ?? animation.sequences[0];
    state.animationSequence = sequence?.index ?? 0;
    state.animationFrame = clamp(state.animationFrame, 0, Math.max(0, (sequence?.frames.length ?? 1) - 1));
    state.animationTick = clamp(state.animationTick, 0, animationTimelineMaxTick(project, spriteId, animation, sequence));
    state.animationFrame = sequence ? animationPlayerFrameAtTick(sequence, state.animationTick) : state.animationFrame;
    const frame = sequence?.frames[state.animationFrame];
    if (!sequence || !frame) throw new Error("No animation frames found");
    const displayFrame = animationPreviewFrame(spriteId, state.animationSide, state.animationSequence, state.animationFrame, frame);
    return `
      <div class="animation-editor-grid ${state.animationExpanded ? "-expanded" : ""}">
        <div class="animation-canvas-wrap">
          <canvas id="sprite-animation-canvas" width="${ANIMATION_CANVAS_WIDTH}" height="${ANIMATION_CANVAS_HEIGHT}"></canvas>
          <div class="animation-canvas-tabs sprite-preview-tabs" role="tablist" aria-label="Animation side">
            <button class="btn -default ${state.animationSide === "front" ? "-active" : ""}" data-animation-side="front" type="button" role="tab" aria-selected="${state.animationSide === "front"}">Front</button>
            <button class="btn -default ${state.animationSide === "back" ? "-active" : ""}" data-animation-side="back" type="button" role="tab" aria-selected="${state.animationSide === "back"}">Back</button>
          </div>
          <div class="animation-canvas-playback" aria-label="Animation playback controls">
            <button class="animation-icon-btn" id="animation-step-back" type="button" aria-label="Step backward" title="Step backward"><span class="animation-icon -step-back" aria-hidden="true"></span></button>
            <button class="animation-icon-btn" id="animation-play" type="button" aria-label="${state.animationPlaying ? "Pause" : "Play"}" title="${state.animationPlaying ? "Pause" : "Play"}"><span class="animation-icon ${state.animationPlaying ? "-pause" : "-play"}" aria-hidden="true"></span></button>
            <button class="animation-icon-btn" id="animation-step-forward" type="button" aria-label="Step forward" title="Step forward"><span class="animation-icon -step-forward" aria-hidden="true"></span></button>
          </div>
          <div class="animation-canvas-history" aria-label="Animation edit history">
            <button class="btn -default" id="animation-undo" type="button" ${hasAnimationUndoState(spriteId, state.animationSide) ? "" : "disabled"}>Undo</button>
            <button class="btn -default sprite-remove-btn" id="animation-reset" type="button" ${hasAnimationUndoState(spriteId, state.animationSide) ? "" : "disabled"}>Reset</button>
          </div>
          <button class="animation-icon-btn animation-canvas-expand" id="animation-expand" type="button" aria-label="${state.animationExpanded ? "Restore preview size" : "Enlarge preview"}" title="${state.animationExpanded ? "Restore preview size" : "Enlarge preview"}"><span class="animation-icon ${state.animationExpanded ? "-collapse" : "-expand"}" aria-hidden="true"></span></button>
        </div>
        <div class="animation-controls">
          <div class="animation-part-summary">${renderAnimationPartSummary(activeNodeIndex, activeNode, sequence, displayFrame)}</div>
          <label class="sprite-field"><span>Multi Cell</span><select id="animation-multicell">${multiCells.cells.map((cell) => `<option value="${cell.index}" ${cell.index === state.animationMultiCell ? "selected" : ""}>${cell.index} (${cell.nodes.length})</option>`).join("")}</select></label>
          <label class="sprite-field"><span>Visible Part</span><select id="animation-visible-node">${renderAnimationVisibleNodeOptions(multiCell)}</select></label>
          <label class="sprite-field"><span>Sequence</span><select id="animation-sequence">${animation.sequences.map((option) => `<option value="${option.index}" ${option.index === state.animationSequence ? "selected" : ""}>${option.index} (${option.frames.length})</option>`).join("")}</select></label>
          ${renderAnimationFrameInputs(displayFrame)}
        </div>
      </div>
    `;
  } catch (error) {
    return `<div class="sprite-editor-error -inline">${escapeHtml(errorMessage(error))}</div>`;
  }
}

function renderAnimationVisibleNodeOptions(multiCell: PokemonMultiCell | undefined): string {
  const nodes = multiCell?.nodes ?? [];
  return [
    `<option value="-1" ${state.animationVisibleNode === -1 ? "selected" : ""}>All parts</option>`,
    ...nodes.map((node, index) => {
      const label = `Part ${index} - Seq ${node.sequenceNumber}, Cell Anim ${node.cellAnimationIndex}`;
      return `<option value="${index}" ${index === state.animationVisibleNode ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
}

function renderAnimationPartSummary(
  nodeIndex: number,
  node: PokemonMultiCellNode | undefined,
  sequence: PokemonAnimation["sequences"][number],
  frame: PokemonAnimationFrame,
): string {
  const part = node ? `Part ${nodeIndex} - Seq ${node.sequenceNumber}, Cell Anim ${node.cellAnimationIndex}` : "All parts";
  const frameType = frame.frameType === "index-srt" ? "SRT" : frame.frameType === "index-t" ? "Translation" : "Cell index";
  return `
    <strong>${escapeHtml(part)}</strong>
    <span>Sequence ${sequence.index} · Key ${state.animationFrame + 1}/${sequence.frames.length} · ${frameType}</span>
  `;
}

function renderAnimationHotkeyHint(): string {
  return `
    <div class="sprite-animation-hotkeys">
      <strong>Animation hotkeys</strong>
      <span>Arrow keys move the selected part.</span>
      <span>Shift + arrow keys rotate it.</span>
      <span>Click Apply Frame to save.</span>
    </div>
  `;
}

function renderAnimationScrubber(project: ProjectState, spriteId: number): string {
  try {
    syncAnimationSequenceToVisibleNode(project, spriteId);
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
    const maxTick = animationTimelineMaxTick(project, spriteId, animation, sequence);
    state.animationTick = clamp(state.animationTick, 0, maxTick);
    state.animationFrame = sequence ? animationPlayerFrameAtTick(sequence, state.animationTick) : state.animationFrame;
    return `
      <div class="animation-header-scrubber animation-frame-scrubber">
        <label class="animation-frame-range">
          <span><strong id="animation-frame-label">${animationFrameLabel(state.animationTick, maxTick, state.animationFrame)}</strong></span>
          <input id="animation-frame" type="range" min="0" max="${maxTick}" value="${state.animationTick}">
        </label>
        <label class="animation-step-field">
          <span>Step</span>
          <input id="animation-step-interval" type="number" min="1" max="999" value="${state.animationStepInterval}">
        </label>
      </div>
    `;
  } catch {
    return "";
  }
}

function renderAnimationFrameInputs(frame: PokemonAnimationFrame): string {
  const canTranslate = frame.frameType === "index-srt" || frame.frameType === "index-t";
  const canTransform = frame.frameType === "index-srt";
  return `
    <label class="sprite-field"><span>Cell</span><input data-animation-field="cellIndex" type="number" min="0" value="${frame.cellIndex}"></label>
    <label class="sprite-field"><span>Duration</span><input data-animation-field="duration" type="number" min="1" value="${frame.duration}"></label>
    <label class="sprite-field"><span>X</span><input data-animation-field="x" type="number" value="${frame.x}" ${canTranslate ? "" : "disabled"}></label>
    <label class="sprite-field"><span>Y</span><input data-animation-field="y" type="number" value="${frame.y}" ${canTranslate ? "" : "disabled"}></label>
    <label class="sprite-field"><span>Rotation</span><input data-animation-field="rotation" type="number" step="0.1" value="${roundDisplay(frame.rotation)}" ${canTransform ? "" : "disabled"}></label>
    <label class="sprite-field"><span>Scale X</span><input data-animation-field="xScale" type="number" step="0.05" value="${roundDisplay(frame.xScale)}" ${canTransform ? "" : "disabled"}></label>
    <label class="sprite-field"><span>Scale Y</span><input data-animation-field="yScale" type="number" step="0.05" value="${roundDisplay(frame.yScale)}" ${canTransform ? "" : "disabled"}></label>
  `;
}

function variantOptions(hasFemale: boolean): PokemonSpriteVariant[] {
  return [
    { kind: "sprite", side: "front", gender: "male" },
    ...(hasFemale ? ([{ kind: "sprite", side: "front", gender: "female" }] as PokemonSpriteVariant[]) : []),
    { kind: "rig", side: "front", gender: "male" },
    ...(hasFemale ? ([{ kind: "rig", side: "front", gender: "female" }] as PokemonSpriteVariant[]) : []),
    { kind: "sprite", side: "back", gender: "male" },
    ...(hasFemale ? ([{ kind: "sprite", side: "back", gender: "female" }] as PokemonSpriteVariant[]) : []),
    { kind: "rig", side: "back", gender: "male" },
    ...(hasFemale ? ([{ kind: "rig", side: "back", gender: "female" }] as PokemonSpriteVariant[]) : []),
  ];
}

function variantValue(variant: PokemonSpriteVariant): string {
  return `${variant.side}-${variant.gender}-${variant.kind}`;
}

function parseVariant(value: string): PokemonSpriteVariant {
  const [side, gender, kind] = value.split("-") as ["front" | "back", "male" | "female", "sprite" | "rig"];
  return { side, gender, kind };
}

function variantLabel(variant: PokemonSpriteVariant): string {
  return `${titleize(variant.side)} ${titleize(variant.gender)} ${titleize(variant.kind)}`;
}

function selectedRigCell(cells: RigCellsFile): RigCell {
  const parent = cells.cells[state.selectedCell] ?? cells.cells[0];
  if (!parent) return { cellX: 0, cellY: 0, width: 0, height: 0, spriteX: 0, spriteY: 0, subCell: undefined as unknown as RigCell };
  return state.selectedSubCell ? parent.subCell : parent;
}

function selectedAnimationFrame(project: ProjectState, spriteId: number): PokemonAnimationFrame | undefined {
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const frame = animation.sequences[state.animationSequence]?.frames[state.animationFrame];
    return frame ? animationPreviewFrame(spriteId, state.animationSide, state.animationSequence, state.animationFrame, frame) : undefined;
  } catch {
    return undefined;
  }
}

function hasSelectedAnimationPart(project: ProjectState, spriteId: number): boolean {
  try {
    const multiCells = getPokemonMultiCells(project, spriteId, state.animationSide);
    const multiCell = multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0];
    return selectedAnimationNodeIndex(multiCell) >= 0;
  } catch {
    return false;
  }
}

function syncAnimationSequenceToVisibleNode(project: ProjectState, spriteId: number): void {
  try {
    const animation = getPokemonAnimation(project, spriteId, state.animationSide);
    const multiCells = getPokemonMultiCells(project, spriteId, state.animationSide);
    const multiCell = multiCells.cells[state.animationMultiCell] ?? multiCells.cells[0];
    const nodeIndex = selectedAnimationNodeIndex(multiCell);
    if (nodeIndex < 0) return;
    const node = multiCell?.nodes[nodeIndex];
    const sequence = node ? animation.sequences[node.sequenceNumber] : undefined;
    if (!sequence) return;
    state.animationSequence = sequence.index;
    state.animationFrame = animationPlayerFrameAtTick(sequence, state.animationTick);
  } catch {
    // Leave the current sequence in place if the selected node cannot be resolved.
  }
}

function selectedAnimationTimelineTick(animation: PokemonAnimation): number {
  const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
  if (!sequence) return 0;
  let tick = 0;
  for (let index = 0; index < Math.min(state.animationFrame, sequence.frames.length); index += 1) {
    tick += Math.max(1, sequence.frames[index]?.duration ?? 1);
  }
  return tick;
}

function sequenceTotalTicks(sequence: PokemonAnimation["sequences"][number] | undefined): number {
  return sequence?.frames.reduce((sum, frame) => sum + Math.max(1, frame.duration), 0) ?? 0;
}

function animationTimelineTotalTicks(
  project: ProjectState,
  spriteId: number,
  animation: PokemonAnimation,
  fallbackSequence: PokemonAnimation["sequences"][number] | undefined,
): number {
  try {
    const multiCellAnimation = getPokemonMultiCellAnimation(project, spriteId, state.animationSide);
    const sequence = multiCellAnimation.sequences[0];
    if (sequence) return Math.max(1, sequenceTotalTicks(sequence));
  } catch {
    // Fall back to the editable NANR sequence when NMAR is unavailable.
  }
  return Math.max(1, sequenceTotalTicks(fallbackSequence ?? animation.sequences[0]));
}

function animationTimelineMaxTick(
  project: ProjectState,
  spriteId: number,
  animation: PokemonAnimation,
  fallbackSequence: PokemonAnimation["sequences"][number] | undefined,
): number {
  return Math.max(0, animationTimelineTotalTicks(project, spriteId, animation, fallbackSequence) - 1);
}

function animationFrameLabel(tick: number, maxTick: number, keyFrame: number): string {
  return `${tick + 1} / ${maxTick + 1} (key ${keyFrame})`;
}

function animationPlayerFrameAtTick(sequence: PokemonAnimation["sequences"][number], tick: number): number {
  return animationPlayerStateAtTick(sequence, tick).frameIndex;
}

function animationPlayerStateAtTick(sequence: PokemonAnimation["sequences"][number], tick: number): { frameIndex: number; frameStartTick: number } {
  if (sequence.frames.length === 0) return { frameIndex: 0, frameStartTick: 0 };
  // ABNK startFrameIndex is an offset into the shared frame table. After parsing,
  // sequence.frames is already sliced to local frames, so playback starts at 0.
  let currentFrame = 0;
  let curFrameTime = 0;
  let frameStartTick = 0;
  let direction: "forward" | "backward" = "forward";
  let playing = true;
  for (let frameTick = 0; frameTick < tick && playing; frameTick += 1) {
    curFrameTime += 1;
    const duration = Math.max(1, sequence.frames[currentFrame]?.duration ?? 1);
    if (curFrameTime < duration) continue;
    curFrameTime = 0;
    frameStartTick = frameTick + 1;
    if (direction === "forward") {
      currentFrame += 1;
      if (currentFrame >= sequence.frames.length) {
        currentFrame -= 1;
        if (sequence.mode === 1) {
          playing = false;
        } else if (sequence.mode === 2) {
          currentFrame = 0;
        } else if (sequence.mode === 3 || sequence.mode === 4) {
          direction = "backward";
          if (currentFrame > 0) currentFrame -= 1;
        }
      }
    } else {
      currentFrame -= 1;
      if (currentFrame < 0) {
        currentFrame = 0;
        if (sequence.mode === 4) {
          direction = "forward";
          currentFrame = Math.min(1, sequence.frames.length - 1);
        } else {
          playing = false;
        }
      }
    }
    currentFrame = clamp(currentFrame, 0, sequence.frames.length - 1);
  }
  return { frameIndex: currentFrame, frameStartTick };
}

function resolveMultiCellPlayback(
  project: ProjectState,
  spriteId: number,
  cells: PokemonMultiCell[],
  fallback: PokemonMultiCell | undefined,
  tick: number,
): { multiCell: PokemonMultiCell; frameStartTick: number; outerFrame?: PokemonAnimationFrame } | undefined {
  if (!fallback) return undefined;
  try {
    const animation = getPokemonMultiCellAnimation(project, spriteId, state.animationSide);
    const sequence = animation.sequences[0];
    if (!sequence) return { multiCell: fallback, frameStartTick: 0 };
    const playback = animationPlayerStateAtTick(sequence, tick);
    const frame = sequence.frames[playback.frameIndex];
    return {
      multiCell: cells[frame?.cellIndex ?? fallback.index] ?? fallback,
      frameStartTick: playback.frameStartTick,
      outerFrame: frame ? multiCellOuterFrame(frame) : undefined,
    };
  } catch {
    return { multiCell: fallback, frameStartTick: 0 };
  }
}

function multiCellOuterFrame(frame: PokemonAnimationFrame): PokemonAnimationFrame | undefined {
  if (frame.x === 0 && frame.y === 0 && frame.rotation === 0 && frame.xScale === 1 && frame.yScale === 1) return undefined;
  return frame;
}

function applyMultiCellOuterTransform(ctx: CanvasRenderingContext2D, frame: PokemonAnimationFrame): void {
  const scale = ANIMATION_PREVIEW_SCALE;
  const originX = canvasAnimationOriginX(ctx);
  const originY = canvasAnimationOriginY(ctx);
  ctx.translate(originX + frame.x * scale, originY + frame.y * scale);
  ctx.rotate((frame.rotation * Math.PI) / 180);
  ctx.scale(frame.xScale, frame.yScale);
  ctx.translate(-originX, -originY);
}

function nodePlaybackTick(node: PokemonMultiCellNode, tick: number, frameStartTick: number): number {
  if (node.playMode === 1) return tick;
  if (node.playMode === 2) return 0;
  return Math.max(0, tick - frameStartTick);
}

function animationFrameAtTick(sequence: PokemonAnimation["sequences"][number], tick: number): PokemonAnimationFrame | undefined {
  if (sequence.frames.length === 0) return undefined;
  const total = sequence.frames.reduce((sum, frame) => sum + Math.max(1, frame.duration), 0);
  let localTick = sequence.mode === 1 ? Math.min(tick, Math.max(0, total - 1)) : tick % Math.max(1, total);
  if (sequence.mode === 3 || sequence.mode === 4) localTick = Math.max(0, total - 1 - localTick);
  for (const frame of sequence.frames) {
    localTick -= Math.max(1, frame.duration);
    if (localTick < 0) return frame;
  }
  return sequence.frames[sequence.frames.length - 1];
}

function animationFrameStateForSequence(
  sequence: PokemonAnimation["sequences"][number],
  tick: number,
  usePlayerFrames: boolean,
): { frame: PokemonAnimationFrame; frameIndex: number } | undefined {
  if (sequence.frames.length === 0) return undefined;
  const frameIndex = usePlayerFrames ? animationPlayerFrameAtTick(sequence, tick) : animationFrameIndexAtTick(sequence, tick);
  const frame = sequence.frames[frameIndex];
  return frame ? { frame, frameIndex } : undefined;
}

function animationFrameIndexAtTick(sequence: PokemonAnimation["sequences"][number], tick: number): number {
  if (sequence.frames.length === 0) return 0;
  const total = sequence.frames.reduce((sum, frame) => sum + Math.max(1, frame.duration), 0);
  let localTick = sequence.mode === 1 ? Math.min(tick, Math.max(0, total - 1)) : tick % Math.max(1, total);
  if (sequence.mode === 3 || sequence.mode === 4) localTick = Math.max(0, total - 1 - localTick);
  for (let index = 0; index < sequence.frames.length; index += 1) {
    localTick -= Math.max(1, sequence.frames[index]?.duration ?? 1);
    if (localTick < 0) return index;
  }
  return sequence.frames.length - 1;
}

function animationPreviewFrame(spriteId: number, side: PokemonAnimationSide, sequenceIndex: number, frameIndex: number, frame: PokemonAnimationFrame): PokemonAnimationFrame {
  const drag = animationDragState;
  if (drag && drag.sequenceIndex === sequenceIndex && drag.frameIndex === frameIndex) return drag.previewFrame;
  if (
    animationDraftFrame &&
    animationDraftFrame.spriteId === spriteId &&
    animationDraftFrame.side === side &&
    animationDraftFrame.sequenceIndex === sequenceIndex &&
    animationDraftFrame.frameIndex === frameIndex
  ) {
    return animationDraftFrame.frame;
  }
  return frame;
}

function animationFrameEdit(frame: PokemonAnimationFrame): PokemonAnimationFrameEdit {
  return {
    duration: frame.duration,
    cellIndex: frame.cellIndex,
    x: frame.x,
    y: frame.y,
    rotation: frame.rotation,
    xScale: frame.xScale,
    yScale: frame.yScale,
  };
}

function selectedAnimationNodeIndex(multiCell: PokemonMultiCell | undefined): number {
  if (!multiCell) return -1;
  if (state.animationActiveNode >= 0 && state.animationActiveNode < multiCell.nodes.length) return state.animationActiveNode;
  if (state.animationVisibleNode >= 0 && state.animationVisibleNode < multiCell.nodes.length) return state.animationVisibleNode;
  return -1;
}

function animationCellsForFrame(cells: RigCellsFile, frame: PokemonAnimationFrame): RigCell[] {
  const direct = cells.cells[frame.cellIndex];
  if (direct) return [direct, ...(direct.subCell.width > 0 ? [direct.subCell] : [])];
  return [];
}

function neutralAnimationFrame(): PokemonAnimationFrame {
  return {
    duration: 1,
    cellIndex: 0,
    x: 0,
    y: 0,
    rotation: 0,
    xScale: 1,
    yScale: 1,
    frameType: "index-srt",
    valueOffset: 0,
    sequenceFrameOffset: 0,
  };
}

function rigVariantForSide(side: "front" | "back"): PokemonSpriteVariant {
  return { kind: "rig", side, gender: "male" };
}

function readRigImageForEditing(project: ProjectState, spriteId: number): RgbaImageData | undefined {
  try {
    return getPokemonSpriteImage(project, spriteId, rigVariantForSide(state.rigSide), "normal");
  } catch {
    return undefined;
  }
}

function moveRigCellPixels(image: RgbaImageData, from: RigCellRect, to: RigCellRect): RgbaImageData {
  const out = cloneImage(image);
  const sx = Math.round(from.cellX);
  const sy = Math.round(from.cellY);
  const tx = Math.round(to.cellX);
  const ty = Math.round(to.cellY);
  const width = Math.round(Math.min(from.width, to.width));
  const height = Math.round(Math.min(from.height, to.height));
  clearImageRect(out, sx, sy, Math.round(from.width), Math.round(from.height));
  copyImageRect(image, out, sx, sy, width, height, tx, ty);
  return out;
}

function readPaletteInputs(root: HTMLElement, kind: PokemonPaletteKind): RgbColor[] {
  return Array.from({ length: 16 }, (_, index) => ({
    r: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="r"]`)?.value ?? 0), 0, 255),
    g: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="g"]`)?.value ?? 0), 0, 255),
    b: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="b"]`)?.value ?? 0), 0, 255),
  }));
}

function readAnimationInputs(root: HTMLElement): Pick<PokemonAnimationFrame, "duration" | "cellIndex" | "x" | "y" | "rotation" | "xScale" | "yScale"> {
  return {
    cellIndex: animationNumber(root, "cellIndex", 0),
    duration: animationNumber(root, "duration", 1),
    x: animationNumber(root, "x", 0),
    y: animationNumber(root, "y", 0),
    rotation: animationNumber(root, "rotation", 0),
    xScale: animationNumber(root, "xScale", 1),
    yScale: animationNumber(root, "yScale", 1),
  };
}

function animationNumber(root: HTMLElement, field: string, fallback: number): number {
  const value = Number(root.querySelector<HTMLInputElement>(`[data-animation-field="${field}"]`)?.value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function syncAnimationInputs(root: HTMLElement, frame?: PokemonAnimationFrame): void {
  if (!frame) return;
  const values = {
    cellIndex: frame.cellIndex,
    duration: frame.duration,
    x: frame.x,
    y: frame.y,
    rotation: roundDisplay(frame.rotation),
    xScale: roundDisplay(frame.xScale),
    yScale: roundDisplay(frame.yScale),
  };
  Object.entries(values).forEach(([field, value]) => {
    const input = root.querySelector<HTMLInputElement>(`[data-animation-field="${field}"]`);
    if (input) input.value = String(value);
  });
}

function syncPalettePicker(root: HTMLElement, picker: HTMLInputElement): void {
  const kind = picker.dataset.palettePicker as PokemonPaletteKind | undefined;
  const index = picker.dataset.color;
  if (!kind || index === undefined) return;
  const color = hexToRgb(picker.value);
  setPaletteNumber(root, kind, index, "r", color.r);
  setPaletteNumber(root, kind, index, "g", color.g);
  setPaletteNumber(root, kind, index, "b", color.b);
  updatePaletteSwatch(picker, color);
}

function syncPaletteNumber(root: HTMLElement, input: HTMLInputElement): void {
  const kind = input.dataset.palette as PokemonPaletteKind | undefined;
  const index = input.dataset.color;
  if (!kind || index === undefined) return;
  const color = {
    r: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="r"]`)?.value ?? 0), 0, 255),
    g: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="g"]`)?.value ?? 0), 0, 255),
    b: clamp(Number(root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="b"]`)?.value ?? 0), 0, 255),
  };
  const picker = root.querySelector<HTMLInputElement>(`[data-palette-picker="${kind}"][data-color="${index}"]`);
  if (picker) {
    picker.value = rgbToHex(color);
    updatePaletteSwatch(picker, color);
  }
}

function setPaletteNumber(root: HTMLElement, kind: PokemonPaletteKind, index: string, channel: "r" | "g" | "b", value: number): void {
  const input = root.querySelector<HTMLInputElement>(`[data-palette="${kind}"][data-color="${index}"][data-channel="${channel}"]`);
  if (input) input.value = String(value);
}

function updatePaletteSwatch(picker: HTMLInputElement, color: RgbColor): void {
  const swatch = picker.closest<HTMLElement>(".palette-swatch");
  if (swatch) swatch.style.background = `rgb(${color.r} ${color.g} ${color.b})`;
}

function rgbToHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(value: string): RgbColor {
  const match = /^#?([0-9a-f]{6})$/iu.exec(value);
  const hex = match?.[1] ?? "000000";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

async function imageFileToRgba(file: Blob): Promise<RgbaImageData> {
  return imageBlobToRgba(file);
}

async function imageBlobToRgba(bytes: Uint8Array | Blob): Promise<RgbaImageData> {
  const blob = bytes instanceof Blob ? bytes : new Blob([arrayBufferCopy(bytes)], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: data.width, height: data.height, pixels: data.data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read image"));
    image.src = url;
  });
}

function drawImageToCanvas(canvas: HTMLCanvasElement, image: RgbaImageData): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
}

function emptyRgbaImage(width: number, height: number): RgbaImageData {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

function drawIndexedImageToCanvas(canvas: HTMLCanvasElement, image: IndexedImageData, palette: RgbColor[], highlightIndex?: number): void {
  const pixels = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.indices.length; i += 1) {
    const colorIndex = image.indices[i] ?? 0;
    const color = palette[colorIndex] ?? { r: 0, g: 0, b: 0 };
    const offset = i * 4;
    const highlighted = highlightIndex !== undefined && colorIndex === highlightIndex;
    const dimmed = highlightIndex !== undefined && colorIndex !== highlightIndex;
    pixels[offset] = highlighted ? 255 : dimmed ? Math.round(color.r * 0.35) : color.r;
    pixels[offset + 1] = highlighted ? 245 : dimmed ? Math.round(color.g * 0.35) : color.g;
    pixels[offset + 2] = highlighted ? 80 : dimmed ? Math.round(color.b * 0.35) : color.b;
    pixels[offset + 3] = highlighted ? 255 : colorIndex === 0 ? 0 : 255;
  }
  drawImageToCanvas(canvas, { width: image.width, height: image.height, pixels });
}

function imageToCanvas(image: RgbaImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawImageToCanvas(canvas, image);
  return canvas;
}

function cloneImage(image: RgbaImageData): RgbaImageData {
  return { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.pixels) };
}

function clearImageRect(image: RgbaImageData, x: number, y: number, width: number, height: number): void {
  const left = clamp(x, 0, image.width);
  const top = clamp(y, 0, image.height);
  const right = clamp(x + width, left, image.width);
  const bottom = clamp(y + height, top, image.height);
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      image.pixels.fill(0, (py * image.width + px) * 4, (py * image.width + px) * 4 + 4);
    }
  }
}

function copyImageRect(source: RgbaImageData, target: RgbaImageData, sx: number, sy: number, width: number, height: number, tx: number, ty: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = sx + x;
      const sourceY = sy + y;
      const targetX = tx + x;
      const targetY = ty + y;
      if (sourceX < 0 || sourceX >= source.width || sourceY < 0 || sourceY >= source.height) continue;
      if (targetX < 0 || targetX >= target.width || targetY < 0 || targetY >= target.height) continue;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (targetY * target.width + targetX) * 4;
      target.pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

function downloadPng(image: RgbaImageData, filename: string): void {
  const canvas = imageToCanvas(image);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, "image/png");
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type }), filename);
}

function zipStoredFiles(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatBytes([...parts, ...centralParts, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function paletteToImage(palette: RgbColor[]): RgbaImageData {
  const image = { width: 16, height: 1, pixels: new Uint8ClampedArray(16 * 4) };
  palette.forEach((color, index) => {
    image.pixels[index * 4] = color.r;
    image.pixels[index * 4 + 1] = color.g;
    image.pixels[index * 4 + 2] = color.b;
    image.pixels[index * 4 + 3] = 255;
  });
  return image;
}

function imageToPalette(image: RgbaImageData): RgbColor[] {
  if (image.width < 16 || image.height < 1) throw new Error("Palette image must be at least 16 x 1");
  return Array.from({ length: 16 }, (_, index) => {
    const offset = index * 4;
    return { r: image.pixels[offset] ?? 0, g: image.pixels[offset + 1] ?? 0, b: image.pixels[offset + 2] ?? 0 };
  });
}

function packageFromFiles(files: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();
  files.forEach((file, index) => {
    parts.push(
      encoder.encode(`{file${index}|`),
      new Uint8Array([file.length & 0xff, (file.length >>> 8) & 0xff, (file.length >>> 16) & 0xff, (file.length >>> 24) & 0xff, 0x3a]),
      file,
      new Uint8Array([0x7d]),
    );
  });
  return concatBytes(parts);
}

function parseHexFlags(text: string): Uint8Array {
  if (!text) return new Uint8Array();
  const parts = text.split(/\s+/u);
  return new Uint8Array(parts.map((part) => {
    const value = Number.parseInt(part, 16);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Invalid hex byte: ${part}`);
    return value;
  }));
}

function startAnimationPlayback(project: ProjectState, spriteId: number, root: HTMLElement): void {
  stopAnimationPlayback();
  let last = performance.now();
  const tick = (now: number) => {
    if (!state.animationPlaying || !root.isConnected) {
      animationPlaybackHandle = undefined;
      return;
    }
    try {
      const animation = getPokemonAnimation(project, spriteId, state.animationSide);
      const durationMs = 1000 / 60;
      if (now - last >= durationMs) {
        last = now;
        stepAnimationPlayers(project, spriteId, animation);
        syncAnimationFrameControl(root);
        syncAnimationInputs(root, selectedAnimationFrame(project, spriteId));
        drawAnimationEditor(project, spriteId, root);
      }
      animationPlaybackHandle = requestAnimationFrame(tick);
    } catch {
      state.animationPlaying = false;
      animationPlaybackHandle = undefined;
    }
  };
  animationPlaybackHandle = requestAnimationFrame(tick);
}

function stopAnimationPlayback(): void {
  if (animationPlaybackHandle !== undefined) cancelAnimationFrame(animationPlaybackHandle);
  animationPlaybackHandle = undefined;
}

function advanceAnimationFrame(animation: PokemonAnimation): void {
  const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
  if (!sequence || sequence.frames.length === 0) return;
  state.animationSequence = sequence.index;
  const next = state.animationFrame + 1;
  if (next < sequence.frames.length) {
    state.animationFrame = next;
    return;
  }
  if (sequence.mode === 1) {
    state.animationFrame = sequence.frames.length - 1;
    state.animationPlaying = false;
    return;
  }
  state.animationFrame = 0;
}

function stepAnimationPlayers(project: ProjectState, spriteId: number, animation: PokemonAnimation, deltaTicks = 1): void {
  const sequence = animation.sequences[state.animationSequence] ?? animation.sequences[0];
  if (!sequence) return;
  state.animationSequence = sequence.index;
  const totalTicks = animationTimelineTotalTicks(project, spriteId, animation, sequence);
  state.animationTick = totalTicks > 0 ? (state.animationTick + Math.round(deltaTicks) + totalTicks * Math.ceil(Math.abs(deltaTicks) / totalTicks + 1)) % totalTicks : 0;
  state.animationFrame = animationPlayerFrameAtTick(sequence, state.animationTick);
}

function syncAnimationFrameControl(root: HTMLElement): void {
  const slider = root.querySelector<HTMLInputElement>("#animation-frame");
  if (slider) slider.value = String(state.animationTick);
  const label = root.querySelector<HTMLElement>("#animation-frame-label");
  const maxTick = Number(slider?.max ?? 0);
  if (label) label.textContent = animationFrameLabel(state.animationTick, maxTick, state.animationFrame);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, step: number, stroke: string): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawCell(ctx: CanvasRenderingContext2D, cell: RigCell, index: number, selected: boolean, color: string, scale: number): void {
  ctx.fillStyle = selected ? "rgb(255 255 255 / 60%)" : `${color}66`;
  ctx.strokeStyle = selected ? "#ffffff" : color;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.fillRect(cell.cellX * scale, cell.cellY * scale, cell.width * scale, cell.height * scale);
  ctx.strokeRect(cell.cellX * scale, cell.cellY * scale, cell.width * scale, cell.height * scale);
  if (selected) {
    ctx.fillStyle = "#bd93f9";
    for (const handle of rigResizeHandles(cell)) ctx.fillRect(handle.x * scale - 4, handle.y * scale - 4, 8, 8);
  }
  ctx.fillStyle = "#111111";
  ctx.font = "16px sans-serif";
  ctx.fillText(String(index), cell.cellX * scale + 4, cell.cellY * scale + 18);
}

function drawRigCellOverlay(
  ctx: CanvasRenderingContext2D,
  project: ProjectState,
  spriteId: number,
  cell: RigCell,
  index: number,
  selected: boolean,
  color: string,
  scale: number,
): void {
  const chunkRects = macroRigChunkRects(project, spriteId, state.rigSide, index, cell);
  if (chunkRects.length <= 1) {
    drawCell(ctx, cell, index, selected, color, scale);
    return;
  }
  ctx.fillStyle = selected ? "rgb(255 255 255 / 45%)" : `${color}4d`;
  ctx.strokeStyle = selected ? "#ffffff" : color;
  ctx.lineWidth = selected ? 3 : 2;
  for (const rect of chunkRects) {
    ctx.fillRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    ctx.strokeRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
  }
  if (selected) {
    ctx.fillStyle = "#bd93f9";
    const bounds = unionBounds(chunkRects);
    if (bounds) {
      for (const handle of rigRectResizeHandles(bounds)) ctx.fillRect(handle.x * scale - 4, handle.y * scale - 4, 8, 8);
    }
  }
  const label = chunkRects[0]!;
  ctx.fillStyle = "#111111";
  ctx.font = "16px sans-serif";
  ctx.fillText(String(index), label.x * scale + 4, label.y * scale + 18);
}

function macroRigChunkRects(project: ProjectState, spriteId: number, side: PokemonAnimationSide, cellIndex: number, rigCell: RigCell): Rect[] {
  if (rigCell.width <= 0 || rigCell.height <= 0) return [];
  try {
    const cellBank = getPokemonCellBank(project, spriteId, side);
    const cell = cellBank.cells[cellIndex];
    if (!cell) return [];
    const oamRects = cell.oams
      .filter((oam) => !oam.disable && oam.width > 0 && oam.height > 0)
      .map((oam) => ncerOamAtlasRect(project, cellBank, oam))
      .filter((rect): rect is Rect => Boolean(rect));
    if (oamRects.length <= 1) return [];
    const oamArea = oamRects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    const cellArea = Math.max(1, rigCell.width * rigCell.height);
    if (oamArea / cellArea > 0.72) return [];
    return mergeRigAtlasRects(oamRects);
  } catch {
    return [];
  }
}

function ncerOamAtlasRect(project: ProjectState, cellBank: PokemonCellBank, oam: PokemonCellOam): Rect | undefined {
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  const sourceTilesWide = rigAtlas.width / 8;
  const tileStart = ncerTileStart(oam.characterName, cellBank.mappingMode, oam.characterBits);
  const x = (tileStart % sourceTilesWide) * 8;
  const y = Math.floor(tileStart / sourceTilesWide) * 8;
  if (x < 0 || y < 0 || x >= rigAtlas.width || y >= rigAtlas.height) return undefined;
  return { x, y, width: oam.width, height: oam.height };
}

function mergeRigAtlasRects(rects: Rect[]): Rect[] {
  let merged = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const combined = combineAdjacentRects(merged[i]!, merged[j]!);
        if (!combined) continue;
        merged = [...merged.slice(0, i), combined, ...merged.slice(i + 1, j), ...merged.slice(j + 1)];
        changed = true;
        break outer;
      }
    }
  }
  return merged.sort((left, right) => left.y - right.y || left.x - right.x);
}

function combineAdjacentRects(left: Rect, right: Rect): Rect | undefined {
  if (left.y === right.y && left.height === right.height && (left.x + left.width === right.x || right.x + right.width === left.x)) {
    const x = Math.min(left.x, right.x);
    return { x, y: left.y, width: left.width + right.width, height: left.height };
  }
  if (left.x === right.x && left.width === right.width && (left.y + left.height === right.y || right.y + right.height === left.y)) {
    const y = Math.min(left.y, right.y);
    return { x: left.x, y, width: left.width, height: left.height + right.height };
  }
  return undefined;
}

function unionBounds(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rigRectResizeHandles(rect: Rect): Array<{ x: number; y: number }> {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width / 2, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function containsCell(cell: RigCell, x: number, y: number): boolean {
  return x >= cell.cellX && y >= cell.cellY && x < cell.cellX + cell.width && y < cell.cellY + cell.height;
}

function hitRigCell(cells: RigCellsFile, x: number, y: number): { index: number; subCell: boolean; mode: RigDragMode } | undefined {
  for (let index = cells.cells.length - 1; index >= 0; index -= 1) {
    const cell = cells.cells[index];
    if (!cell) continue;
    if (cell.subCell.width > 0 && containsCell(cell.subCell, x, y)) return { index, subCell: true, mode: rigDragModeForPoint(cell.subCell, x, y) };
    if (containsCell(cell, x, y)) return { index, subCell: false, mode: rigDragModeForPoint(cell, x, y) };
  }
  return undefined;
}

function rigDragModeForPoint(cell: RigCell, x: number, y: number): RigDragMode {
  const threshold = 4;
  const left = Math.abs(x - cell.cellX) <= threshold;
  const right = Math.abs(x - (cell.cellX + cell.width)) <= threshold;
  const top = Math.abs(y - cell.cellY) <= threshold;
  const bottom = Math.abs(y - (cell.cellY + cell.height)) <= threshold;
  if (top && left) return "nw";
  if (top && right) return "ne";
  if (bottom && left) return "sw";
  if (bottom && right) return "se";
  if (top) return "n";
  if (bottom) return "s";
  if (left) return "w";
  if (right) return "e";
  return "move";
}

function rigResizeHandles(cell: RigCell): Array<{ x: number; y: number }> {
  const x1 = cell.cellX;
  const x2 = cell.cellX + cell.width;
  const y1 = cell.cellY;
  const y2 = cell.cellY + cell.height;
  return [
    { x: x1, y: y1 },
    { x: (x1 + x2) / 2, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: (y1 + y2) / 2 },
    { x: x2, y: y2 },
    { x: (x1 + x2) / 2, y: y2 },
    { x: x1, y: y2 },
    { x: x1, y: (y1 + y2) / 2 },
  ];
}

function rigCanvasPoint(project: ProjectState, canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  return {
    x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * rigAtlas.width), 0, rigAtlas.width - 1),
    y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * rigAtlas.height), 0, rigAtlas.height - 1),
  };
}

function applyRigDrag(project: ProjectState, cell: RigCell, drag: RigDragState, x: number, y: number): void {
  const rigAtlas = getPokemonRigAtlasDimensions(project);
  const dx = snap8(x - drag.startX);
  const dy = snap8(y - drag.startY);
  const originalRight = drag.original.cellX + drag.original.width;
  const originalBottom = drag.original.cellY + drag.original.height;
  let left = drag.original.cellX;
  let top = drag.original.cellY;
  let right = originalRight;
  let bottom = originalBottom;

  if (drag.mode === "move") {
    left = clamp(snap8(drag.original.cellX + dx), 0, rigAtlas.width - drag.original.width);
    top = clamp(snap8(drag.original.cellY + dy), 0, rigAtlas.height - drag.original.height);
    right = left + drag.original.width;
    bottom = top + drag.original.height;
  } else {
    if (drag.mode.includes("w")) left = clamp(snap8(drag.original.cellX + dx), 0, originalRight - 8);
    if (drag.mode.includes("e")) right = clamp(snap8(originalRight + dx), left + 8, rigAtlas.width);
    if (drag.mode.includes("n")) top = clamp(snap8(drag.original.cellY + dy), 0, originalBottom - 8);
    if (drag.mode.includes("s")) bottom = clamp(snap8(originalBottom + dy), top + 8, rigAtlas.height);
  }

  cell.cellX = left;
  cell.cellY = top;
  cell.width = right - left;
  cell.height = bottom - top;
}

function cursorForRigMode(mode: RigDragMode): string {
  if (mode === "move") return "move";
  if (mode === "n" || mode === "s") return "ns-resize";
  if (mode === "e" || mode === "w") return "ew-resize";
  if (mode === "ne" || mode === "sw") return "nesw-resize";
  return "nwse-resize";
}

function snap8(value: number): number {
  return Math.round(value / 8) * 8;
}

function spriteFileBaseName(spriteId: number): string {
  return `pokemon_sprite_${spriteId}`;
}

function titleize(value: string): string {
  return value
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAnimationStepInterval(): number {
  try {
    if (typeof localStorage === "undefined") return 6;
    return normalizeAnimationStepInterval(Number(localStorage.getItem(ANIMATION_STEP_INTERVAL_STORAGE_KEY) ?? 6));
  } catch {
    return 6;
  }
}

function writeAnimationStepInterval(value: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ANIMATION_STEP_INTERVAL_STORAGE_KEY, String(normalizeAnimationStepInterval(value)));
  } catch {
    // Storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function normalizeAnimationStepInterval(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(999, Math.round(value)));
}

function readGifFlipbookPackingModePreference(): PokemonFlipbookPackingMode {
  try {
    if (typeof localStorage === "undefined") return "mcss-safe";
    const stored = readGifFlipbookPackingModeValue(localStorage.getItem(GIF_FLIPBOOK_PACKING_MODE_STORAGE_KEY));
    return stored === "tile-node-dedup" ? "mcss-safe" : stored;
  } catch {
    return "mcss-safe";
  }
}

function readGifFlipbookPackingModeValue(value: unknown): PokemonFlipbookPackingMode {
  return value === "macro-blocks" || value === "rotated-pose-blocks" || value === "tile-node-dedup" ? value : "mcss-safe";
}

function writeGifFlipbookPackingModePreference(value: PokemonFlipbookPackingMode): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(GIF_FLIPBOOK_PACKING_MODE_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function readGifFlipbookStrategyPreference(): PokemonFlipbookSamplingStrategy {
  try {
    if (typeof localStorage === "undefined") return "loop-rest";
    const value = localStorage.getItem(GIF_FLIPBOOK_STRATEGY_STORAGE_KEY);
    return value === "first-window" || value === "even" ? value : "loop-rest";
  } catch {
    return "loop-rest";
  }
}

function writeGifFlipbookStrategyPreference(value: PokemonFlipbookSamplingStrategy): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(GIF_FLIPBOOK_STRATEGY_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function readGifFlipbookSpeedPreference(): number {
  try {
    if (typeof localStorage === "undefined") return 1;
    return normalizeGifFlipbookSpeedScale(Number(localStorage.getItem(GIF_FLIPBOOK_SPEED_STORAGE_KEY) ?? 1));
  } catch {
    return 1;
  }
}

function writeGifFlipbookSpeedPreference(value: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(GIF_FLIPBOOK_SPEED_STORAGE_KEY, formatSpeedScale(normalizeGifFlipbookSpeedScale(value)));
  } catch {
    // Storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function readGifFlipbookDownscalePreference(): number {
  try {
    if (typeof localStorage === "undefined") return 100;
    return normalizeGifFlipbookDownscalePercent(Number(localStorage.getItem(GIF_FLIPBOOK_DOWNSCALE_STORAGE_KEY) ?? 100));
  } catch {
    return 100;
  }
}

function writeGifFlipbookDownscalePreference(value: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(GIF_FLIPBOOK_DOWNSCALE_STORAGE_KEY, String(normalizeGifFlipbookDownscalePercent(value)));
  } catch {
    // Storage can be unavailable in private contexts; the in-memory state still works.
  }
}

function normalizeGifFlipbookSpeedScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.max(0.1, Math.min(4, value)) * 10) / 10;
}

function normalizeGifFlipbookDownscalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return clamp(Math.round(value), 5, 100);
}

function durationScaleForGifSpeed(speedScale: number): number {
  return clamp(1 / normalizeGifFlipbookSpeedScale(speedScale), 0.25, 16);
}

function formatSpeedScale(value: number): string {
  return normalizeGifFlipbookSpeedScale(value).toFixed(1).replace(/\.0$/u, "");
}

function isUndoShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "z" && !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

function isAnimationArrowShortcut(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : undefined;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function roundDisplay(value: number): number {
  return Math.round(value * 1000) / 1000;
}
