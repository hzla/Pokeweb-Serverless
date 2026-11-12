import { canOpenMastersheetViewer } from "../pokeweb/mastersheetViewerAccess";
import {
  buildMastersheetPreview,
  enrichMastersheetTrainerLocations,
  ensureMastersheetMarkdown,
  generateMastersheetDownload,
  mastersheetHighlightsFromLegacyJs,
  mastersheetMarkdownFromLegacyJs,
  setMastersheetHighlights,
  setMastersheetMarkdown,
  type MastersheetExport,
  type MastersheetWarning,
} from "../pokeweb/mastersheetModel";
import {
  hasAuthoredMastersheet,
  mastersheetRomFileForProject,
  mastersheetSavesInRom,
  resolveMastersheetRomConflict,
  setMastersheetSavesInRom,
} from "../pokeweb/mastersheetRomFile";
import type { ProjectState } from "../pokeweb/projectStore";
import type { TextDownloadFile } from "../pokeweb/docGeneratorModel";
import { escapeHtml } from "./dom";
import { renderMasterData, renderMastersheetToc } from "./mastersheetRenderer";

type RenderOptions = {
  onDirty?: () => void;
  /** Saves pending edits; the viewer opens the saved project. */
  beforeOpenViewer?: () => Promise<void>;
};

const RENDER_DEBOUNCE_MS = 150;

export function renderMastersheetEditor(project: ProjectState, root: HTMLElement, options: RenderOptions = {}): void {
  const initialMarkdown = ensureMastersheetMarkdown(project);
  let enrichmentStatus = "";

  root.innerHTML = `
    <section class="mastersheet-page">
      <aside class="mastersheet-sidebar">
        <div class="mastersheet-sidebar__header">
          <h1>Mastersheet</h1>
          <div class="mastersheet-actions">
            <button class="btn -default" id="mastersheet-import-btn" type="button">Import JS</button>
            <button class="btn -default" id="mastersheet-download-btn" type="button">Download JS</button>
            <button class="btn -default" id="mastersheet-copy-btn" type="button">Copy JS</button>
            ${canOpenMastersheetViewer() ? `<button class="btn -default" id="mastersheet-viewer-btn" type="button" title="The new viewer, with maps and sprites from the ROM">Open in viewer</button>` : ""}
            <input id="mastersheet-import-input" type="file" accept=".js,text/javascript,application/javascript,.txt,text/plain" hidden>
          </div>
        </div>
        <div class="mastersheet-rom" id="mastersheet-rom"></div>
        <div class="mastersheet-status" id="mastersheet-status">Ready.</div>
        <div class="mastersheet-toc" id="mastersheet-toc"></div>
      </aside>
      <main class="mastersheet-preview-panel" id="mastersheet-preview-panel">
        <div class="mastersheet-preview" id="mastersheet"></div>
      </main>
      <aside class="mastersheet-editor-panel">
        <textarea id="mastersheet-source" spellcheck="false">${escapeHtml(initialMarkdown)}</textarea>
      </aside>
    </section>
  `;

  const textarea = root.querySelector<HTMLTextAreaElement>("#mastersheet-source");
  const preview = root.querySelector<HTMLElement>("#mastersheet");
  const previewPanel = root.querySelector<HTMLElement>("#mastersheet-preview-panel");
  const toc = root.querySelector<HTMLElement>("#mastersheet-toc");
  const status = root.querySelector<HTMLElement>("#mastersheet-status");
  const importButton = root.querySelector<HTMLButtonElement>("#mastersheet-import-btn");
  const importInput = root.querySelector<HTMLInputElement>("#mastersheet-import-input");
  const downloadButton = root.querySelector<HTMLButtonElement>("#mastersheet-download-btn");
  const copyButton = root.querySelector<HTMLButtonElement>("#mastersheet-copy-btn");
  const romPanel = root.querySelector<HTMLElement>("#mastersheet-rom");
  let renderTimeout: number | undefined;
  let lastExport: MastersheetExport | undefined;
  let enrichmentAttempted = false;

  const ensureTrainerLocationEnrichment = (): void => {
    if (enrichmentAttempted) return;
    enrichmentAttempted = true;
    if (!project.narcs.headers || !project.narcs.overworlds) return;
    try {
      enrichmentStatus = enrichMastersheetTrainerLocations(project);
    } catch (error) {
      enrichmentStatus = error instanceof Error ? error.message : String(error);
    }
  };

  const refreshPreview = (): void => {
    if (!textarea || !preview || !toc || !previewPanel) return;
    const markdown = textarea.value;
    setMastersheetMarkdown(project, markdown);
    lastExport = buildMastersheetPreview(project, markdown);
    if (lastExport.masterData.some((element) => element.tag === "trainer") && !enrichmentAttempted) {
      ensureTrainerLocationEnrichment();
      lastExport = buildMastersheetPreview(project, markdown);
    }
    preview.innerHTML = renderMasterData(lastExport.masterData, lastExport.trainersById, lastExport.encountersById, { highlights: lastExport.highlights });
    renderMastersheetToc(preview, toc, previewPanel);
    const blocking = lastExport.warnings.some((warning) => warning.blocking);
    if (downloadButton) downloadButton.disabled = blocking;
    if (copyButton) copyButton.disabled = blocking;
    renderStatus(status, lastExport.warnings, enrichmentStatus);
    renderRomPanel();
  };

  /** "Save in the ROM" and, when the source ROM carries a different copy, the choice between the two. */
  const renderRomPanel = (): void => {
    if (!romPanel) return;
    const docs = project.docs;
    const pending = docs?.mastersheetRomPending;
    const enabled = mastersheetSavesInRom(project);
    const bytes = enabled ? mastersheetRomFileForProject(project) : undefined;
    const note = !enabled
      ? "Export leaves it out of the ROM."
      : bytes
        ? `Saved in the exported ROM, compressed to ${formatBytes(bytes.length)}. Importing that ROM brings it back.`
        : hasAuthoredMastersheet(project) ? "" : "Nothing to save yet.";
    romPanel.innerHTML = `
      <label class="mastersheet-rom__toggle"><input type="checkbox" id="mastersheet-rom-toggle" ${enabled ? "checked" : ""}> Save in the ROM</label>
      <p class="mastersheet-rom__note">${escapeHtml(note)}</p>
      ${docs?.mastersheetRomError ? `<p class="mastersheet-rom__error">The ROM's saved mastersheet couldn't be read: ${escapeHtml(docs.mastersheetRomError)}</p>` : ""}
      ${pending ? `
        <div class="mastersheet-rom__conflict" role="alert">
          <p>This ROM has a different saved mastersheet: ${differingLines(pending.markdown, docs?.mastersheetMarkdown ?? "")} differ from this project's.</p>
          <div class="mastersheet-rom__choices">
            <button class="btn -default" type="button" data-rom-choice="rom">Use the ROM's</button>
            <button class="btn -default" type="button" data-rom-choice="project">Keep this one</button>
          </div>
        </div>` : ""}
    `;
  };

  romPanel?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== "mastersheet-rom-toggle") return;
    setMastersheetSavesInRom(project, input.checked);
    renderRomPanel();
    options.onDirty?.();
  });
  romPanel?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rom-choice]");
    if (!button || !textarea) return;
    const choice = button.dataset.romChoice === "rom" ? "rom" : "project";
    resolveMastersheetRomConflict(project, choice);
    if (choice === "rom") textarea.value = ensureMastersheetMarkdown(project);
    refreshPreview();
    if (status) status.textContent = choice === "rom" ? "Loaded the mastersheet saved in the ROM." : "Kept this project's mastersheet.";
    options.onDirty?.();
  });

  const scheduleRefresh = (): void => {
    if (renderTimeout !== undefined) window.clearTimeout(renderTimeout);
    renderTimeout = window.setTimeout(() => {
      refreshPreview();
      options.onDirty?.();
    }, RENDER_DEBOUNCE_MS);
  };

  textarea?.addEventListener("input", scheduleRefresh);
  importButton?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file || !textarea) return;
    try {
      if (status) status.textContent = `Importing ${file.name}...`;
      const source = await file.text();
      const markdown = mastersheetMarkdownFromLegacyJs(source);
      textarea.value = markdown;
      setMastersheetMarkdown(project, markdown);
      setMastersheetHighlights(project, mastersheetHighlightsFromLegacyJs(source));
      refreshPreview();
      if (status && !lastExport?.warnings.length) status.textContent = `Imported ${file.name}.`;
      options.onDirty?.();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      importInput.value = "";
    }
  });
  downloadButton?.addEventListener("click", () => {
    if (!textarea) return;
    setMastersheetMarkdown(project, textarea.value);
    ensureTrainerLocationEnrichment();
    lastExport = buildMastersheetPreview(project, textarea.value);
    renderStatus(status, lastExport.warnings, enrichmentStatus);
    if (lastExport.warnings.some((warning) => warning.blocking)) return;
    runExportAction(status, () => {
      const file = generateMastersheetDownload(project);
      downloadFile(file);
      return `Downloaded ${file.filename}.`;
    });
  });
  copyButton?.addEventListener("click", async () => {
    if (!textarea) return;
    setMastersheetMarkdown(project, textarea.value);
    ensureTrainerLocationEnrichment();
    lastExport = buildMastersheetPreview(project, textarea.value);
    if (lastExport.warnings.some((warning) => warning.blocking)) {
      renderStatus(status, lastExport.warnings, enrichmentStatus);
      return;
    }
    try {
      const file = generateMastersheetDownload(project);
      await copyText(file.contents, textarea);
      if (status) status.textContent = `Copied ${file.filename}.`;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#mastersheet-viewer-btn")?.addEventListener("click", async () => {
    if (textarea) setMastersheetMarkdown(project, textarea.value);
    // Open the tab inside the click so popup blockers allow it, then point it at the viewer once saved.
    const viewer = window.open("about:blank", "_blank");
    try {
      await options.beforeOpenViewer?.();
      const url = new URL("./mastersheet.html?source=project", window.location.href).toString();
      if (viewer) viewer.location.href = url;
      else window.open(url, "_blank");
    } catch (error) {
      viewer?.close();
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  refreshPreview();
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

/** "3 lines": lines found in one copy but not the other, counted with repeats. */
function differingLines(a: string, b: string): string {
  const counts = new Map<string, number>();
  for (const line of a.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const line of b.split("\n")) counts.set(line, (counts.get(line) ?? 0) - 1);
  let total = 0;
  for (const value of counts.values()) total += Math.abs(value);
  return `${total} line${total === 1 ? "" : "s"}`;
}

function renderStatus(status: HTMLElement | null, warnings: MastersheetWarning[], enrichmentStatus: string): void {
  if (!status) return;
  if (warnings.length === 0) {
    status.textContent = enrichmentStatus || "Ready.";
    status.classList.remove("-warning");
    return;
  }
  status.classList.add("-warning");
  status.innerHTML = `
    <strong>${warnings.length} warning${warnings.length === 1 ? "" : "s"}</strong>
    <ul>
      ${warnings.map((warning) => `<li>Line ${warning.line}: ${escapeHtml(warning.message)}</li>`).join("")}
    </ul>
  `;
}

function runExportAction(status: HTMLElement | null, action: () => string): void {
  try {
    if (status) status.textContent = "Generating mastersheet JS...";
    const message = action();
    if (status) status.textContent = message;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function downloadFile(file: TextDownloadFile): void {
  const blob = new Blob([file.contents], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string, fallback: HTMLTextAreaElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallback.select();
    document.execCommand("copy");
  }
}
