import {
  appendEmptyMoveBackground,
  getMoveBackgroundIds,
  getReferencedMoveBackgroundCatalog,
  importMoveBackgroundImage,
  moveBackgroundReferenceLabel,
  type ReferencedMoveBackground,
} from "../pokeweb/moveBackgroundModel";
import type { MoveBackgroundImportReport, MoveBackgroundSourceImage } from "../pokeweb/moveBackgroundCompiler";
import { invalidateMoveBackgroundCache, loadMoveBackground } from "../pokeweb/moveAnimationPreviewModel";
import type { NitroBackgroundImage } from "../pokeweb/nitroBg";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { renderMoveBackgroundPreviewCanvas } from "./moveAnimationPreview";

export function renderMoveBackgroundEditor(project: ProjectState, root: HTMLElement): void {
  let selectedBackgroundId: number | undefined;
  let loadToken = 0;
  let renderToken = 0;
  let status: { message: string; tone: "success" | "error" | "working" } | undefined;
  const importReports = new Map<number, MoveBackgroundImportReport>();

  const render = async () => {
    const activeRenderToken = ++renderToken;
    const referencedCatalog = getReferencedMoveBackgroundCatalog(project);
    let backgroundIds: number[] = [];
    let archiveError: string | undefined;
    try {
      backgroundIds = await getMoveBackgroundIds(project);
    } catch (error) {
      archiveError = error instanceof Error ? error.message : String(error);
    }
    if (activeRenderToken !== renderToken) return;
    const referencesById = new Map(referencedCatalog.backgrounds.map((background) => [background.backgroundId, background.references]));
    const backgrounds = backgroundIds.map((backgroundId) => ({ backgroundId, references: referencesById.get(backgroundId) ?? [] }));
    if (selectedBackgroundId === undefined || !backgroundIds.includes(selectedBackgroundId)) selectedBackgroundId = backgroundIds[0];
    const selected = backgrounds.find((background) => background.backgroundId === selectedBackgroundId);
    root.innerHTML = `
      <aside class="pokemon-filter move-background-sidebar">
        <div class="filter-title">Move Backgrounds</div>
        ${renderSelector(backgrounds, selectedBackgroundId)}
        <div class="move-background-actions">
          <button class="btn -primary" id="add-move-background" type="button" ${archiveError ? "disabled" : ""}>Add Background</button>
          <label class="btn -default move-background-import ${selected ? "" : "-disabled"}">
            Import Image
            <input id="import-move-background" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" ${selected ? "" : "disabled"}>
          </label>
        </div>
        ${status ? `<div class="move-background-status -${status.tone}" role="status" aria-live="polite">${escapeHtml(status.message)}</div>` : ""}
        <div class="move-background-catalog-summary">
          <strong>${backgrounds.length}</strong>
          <span>background entr${backgrounds.length === 1 ? "y" : "ies"}</span>
          <small>${referencedCatalog.backgrounds.length} referenced · ${referencedCatalog.scannedScriptCount} script${referencedCatalog.scannedScriptCount === 1 ? "" : "s"} scanned${referencedCatalog.skippedScriptCount ? ` · ${referencedCatalog.skippedScriptCount} skipped` : ""}</small>
        </div>
        ${selected ? renderSidebarReferences(selected) : ""}
      </aside>
      <main class="pokemon-list move-background-content">
        ${selected ? renderLoadingState(selected) : renderEmptyState(referencedCatalog.skippedScriptCount, archiveError)}
      </main>
    `;

    const select = root.querySelector<HTMLSelectElement>("#move-background-select");
    select?.addEventListener("change", () => {
      selectedBackgroundId = Number(select.value);
      status = undefined;
      void render();
    });

    root.querySelector<HTMLButtonElement>("#add-move-background")?.addEventListener("click", async () => {
      try {
        selectedBackgroundId = await appendEmptyMoveBackground(project);
        invalidateMoveBackgroundCache(project, selectedBackgroundId);
        status = { message: `Added empty background ${selectedBackgroundId}. Import a PNG or JPEG to populate it.`, tone: "success" };
      } catch (error) {
        status = { message: error instanceof Error ? error.message : String(error), tone: "error" };
      }
      void render();
    });

    root.querySelector<HTMLInputElement>("#import-move-background")?.addEventListener("change", async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      const backgroundId = selectedBackgroundId;
      if (!file || backgroundId === undefined) return;
      status = { message: `Converting ${file.name}…`, tone: "working" };
      updateStatus(root, status);
      try {
        const source = await decodeImageFile(file);
        const compiled = await importMoveBackgroundImage(project, backgroundId, source, file.name);
        importReports.set(backgroundId, compiled.report);
        invalidateMoveBackgroundCache(project, backgroundId);
        status = {
          message: `Imported ${file.name}: ${source.width}×${source.height} → 256×192, ${compiled.report.uniqueTileCount} unique tiles, ${compiled.report.usedPaletteBankCount} palette banks.`,
          tone: "success",
        };
      } catch (error) {
        status = { message: error instanceof Error ? error.message : String(error), tone: "error" };
      }
      void render();
    });
    if (selected) {
      const token = ++loadToken;
      const viewer = root.querySelector<HTMLElement>(`.move-background-viewer[data-move-background-id="${selected.backgroundId}"]`);
      if (viewer) viewer.dataset.loadToken = String(token);
      void hydrateSelectedBackground(project, root, selected, token, importReports.get(selected.backgroundId));
    }
  };

  void render();
}

function renderSelector(backgrounds: ReferencedMoveBackground[], selectedBackgroundId: number | undefined): string {
  if (!backgrounds.length) return "";
  return `
    <label class="move-background-selector" for="move-background-select">
      <span>Background</span>
      <select class="filter-input" id="move-background-select">
        ${backgrounds.map((background) => `<option value="${background.backgroundId}" ${background.backgroundId === selectedBackgroundId ? "selected" : ""}>Background ${background.backgroundId} · ${background.references.length ? `${background.references.length} script${background.references.length === 1 ? "" : "s"}` : "unreferenced"}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderSidebarReferences(background: ReferencedMoveBackground): string {
  return `
    <section class="move-background-references" aria-label="Scripts referencing background ${background.backgroundId}">
      <div class="move-background-sidebar-title">Referenced by</div>
      <div class="move-background-reference-list">
        ${background.references.length ? background.references.map((reference) => `
          <div class="move-background-reference">
            <strong>${escapeHtml(moveBackgroundReferenceLabel(reference))}</strong>
            <span>${reference.storeName === "move_animations" ? "Move" : "Battle"} script ${reference.scriptIndex}</span>
          </div>
        `).join("") : `<div class="move-background-unreferenced">No loaded animation scripts reference this entry yet.</div>`}
      </div>
    </section>
  `;
}

function renderLoadingState(background: ReferencedMoveBackground): string {
  return `
    <section class="move-background-viewer" data-move-background-id="${background.backgroundId}">
      <header class="move-background-header">
        <div>
          <span>Move animation asset</span>
          <h1>Background ${background.backgroundId}</h1>
        </div>
        <div class="move-background-header-reference">${referenceCountLabel(background.references.length)}</div>
      </header>
      <div class="move-background-loading">Loading graphical previews...</div>
    </section>
  `;
}

function renderEmptyState(skippedScriptCount: number, archiveError?: string): string {
  return `
    <section class="move-background-empty">
      <h1>${archiveError ? "Move-background archive unavailable" : "No move backgrounds"}</h1>
      <p>${archiveError ? escapeHtml(archiveError) : "The loaded move-background NARC contains no valid NSCR/NCGR/NCLR entries."}</p>
      ${skippedScriptCount ? `<p>${skippedScriptCount} script${skippedScriptCount === 1 ? " was" : "s were"} skipped because the data could not be decoded.</p>` : ""}
    </section>
  `;
}

async function hydrateSelectedBackground(
  project: ProjectState,
  root: HTMLElement,
  selected: ReferencedMoveBackground,
  loadToken: number,
  importReport?: MoveBackgroundImportReport,
): Promise<void> {
  const viewer = root.querySelector<HTMLElement>(`.move-background-viewer[data-move-background-id="${selected.backgroundId}"]`);
  if (!viewer) return;
  try {
    const background = await loadMoveBackground(project, selected.backgroundId);
    if (!viewer.isConnected || viewer.dataset.loadToken !== String(loadToken)) return;
    viewer.innerHTML = renderLoadedBackground(selected, background, importReport);
    const battleCanvas = viewer.querySelector<HTMLCanvasElement>("[data-move-background-preview='battle']");
    const sourceCanvas = viewer.querySelector<HTMLCanvasElement>("[data-move-background-preview='source']");
    if (battleCanvas) renderMoveBackgroundPreviewCanvas(battleCanvas, background);
    if (sourceCanvas) renderSourceCanvas(sourceCanvas, background);
  } catch (error) {
    if (!viewer.isConnected || viewer.dataset.loadToken !== String(loadToken)) return;
    viewer.innerHTML = `
      <header class="move-background-header">
        <div><span>Move animation asset</span><h1>Background ${selected.backgroundId}</h1></div>
      </header>
      <div class="move-background-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
    `;
  }
}

function renderLoadedBackground(
  backgroundReference: ReferencedMoveBackground,
  background: NitroBackgroundImage,
  importReport?: MoveBackgroundImportReport,
): string {
  return `
    <header class="move-background-header">
      <div>
        <span>Move animation asset</span>
        <h1>Background ${backgroundReference.backgroundId}</h1>
      </div>
      <div class="move-background-header-reference">${referenceCountLabel(backgroundReference.references.length)}</div>
    </header>
    <div class="move-background-preview-grid">
      <article class="move-background-preview-card -battle">
        <div class="move-background-preview-title">
          <div><strong>Battle View</strong><span>DS viewport · tiled to 256×192</span></div>
          <code>256×192</code>
        </div>
        <div class="move-background-canvas-frame"><canvas data-move-background-preview="battle" aria-label="Background ${backgroundReference.backgroundId} battle view"></canvas></div>
      </article>
      <article class="move-background-preview-card -source">
        <div class="move-background-preview-title">
          <div><strong>Source Map</strong><span>Decoded NSCR tile map</span></div>
          <code>${background.width}×${background.height}</code>
        </div>
        <div class="move-background-canvas-frame"><canvas data-move-background-preview="source" aria-label="Background ${backgroundReference.backgroundId} source map"></canvas></div>
      </article>
    </div>
    ${importReport ? renderImportReport(importReport) : ""}
    <div class="move-background-metadata">
      ${metadataItem("Background ID", String(backgroundReference.backgroundId))}
      ${metadataItem("Source size", `${background.width} × ${background.height}`)}
      ${metadataItem("Color depth", `${background.indexed.bitsPerPixel} bpp`)}
      ${metadataItem("Transparency", background.hasTransparency ? "Index 0" : "Opaque")}
      ${metadataItem("Tile count", String(background.indexed.tilePixels.length))}
      ${metadataItem("Palette colors", String(background.indexed.palette.length))}
      ${metadataItem("Palette base", `Bank ${background.indexed.paletteBankOffset}`)}
    </div>
    ${background.warnings.length ? `<section class="move-background-warnings"><strong>Decoder notes</strong><ul>${background.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>` : ""}
  `;
}

function metadataItem(label: string, value: string): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderImportReport(report: MoveBackgroundImportReport): string {
  return `
    <section class="move-background-import-report">
      <strong>Image conversion</strong>
      <span>${report.sourceWidth}×${report.sourceHeight} cover-cropped to ${report.viewportWidth}×${report.viewportHeight} and converted to 4bpp DS tiles. The unused area of the ${report.mapWidth}×${report.mapHeight} source map remains transparent.</span>
      <small>${report.uniqueTileCount} unique tiles · ${report.usedPaletteBankCount}/${report.paletteBankCount} palette banks used · 15 opaque colors per bank</small>
    </section>
  `;
}

function referenceCountLabel(count: number): string {
  return count ? `Referenced by ${count} script${count === 1 ? "" : "s"}` : "Not referenced by a loaded script";
}

function updateStatus(root: HTMLElement, status: { message: string; tone: "success" | "error" | "working" }): void {
  let element = root.querySelector<HTMLElement>(".move-background-status");
  if (!element) {
    element = document.createElement("div");
    element.className = "move-background-status";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    root.querySelector(".move-background-actions")?.insertAdjacentElement("afterend", element);
  }
  element.className = `move-background-status -${status.tone}`;
  element.textContent = status.message;
}

async function decodeImageFile(file: File): Promise<MoveBackgroundSourceImage> {
  const supportedType = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/jpg";
  const supportedName = /\.(?:png|jpe?g)$/iu.test(file.name);
  if ((file.type && !supportedType) || (!file.type && !supportedName)) throw new Error("Choose a PNG or JPEG image to import.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PNG conversion needs canvas support in this browser.");
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.data) };
  } finally {
    bitmap.close();
  }
}

function renderSourceCanvas(canvas: HTMLCanvasElement, background: NitroBackgroundImage): void {
  canvas.width = background.width;
  canvas.height = background.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = new Uint8ClampedArray(background.rgba.length);
  pixels.set(background.rgba);
  context.putImageData(new ImageData(pixels, background.width, background.height), 0, 0);
}
