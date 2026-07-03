import {
  buildMastersheetExport,
  enrichMastersheetTrainerLocations,
  ensureMastersheetMarkdown,
  generateMastersheetDownload,
  mastersheetMarkdownFromLegacyJs,
  setMastersheetMarkdown,
  type MastersheetExport,
  type MastersheetWarning,
} from "../pokeweb/mastersheetModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { ensureDocs, type TextDownloadFile } from "../pokeweb/docGeneratorModel";
import { escapeHtml } from "./dom";
import { renderMasterData, renderMastersheetToc } from "./mastersheetRenderer";

type RenderOptions = {
  onDirty?: () => void;
};

const RENDER_DEBOUNCE_MS = 150;

export function renderMastersheetEditor(project: ProjectState, root: HTMLElement, options: RenderOptions = {}): void {
  const initialMarkdown = ensureMastersheetMarkdown(project);
  let enrichmentStatus = "";
  if (project.narcs.headers && project.narcs.overworlds) {
    try {
      const docs = ensureDocs(project);
      const before = JSON.stringify({ trainerLocations: docs.trainerLocations, trainerDiffs: docs.trainerDiffs });
      enrichmentStatus = enrichMastersheetTrainerLocations(project);
      const after = JSON.stringify({ trainerLocations: docs.trainerLocations, trainerDiffs: docs.trainerDiffs });
      if (before !== after) options.onDirty?.();
    } catch (error) {
      enrichmentStatus = error instanceof Error ? error.message : String(error);
    }
  }

  root.innerHTML = `
    <section class="mastersheet-page">
      <aside class="mastersheet-sidebar">
        <div class="mastersheet-sidebar__header">
          <h1>Mastersheet</h1>
          <div class="mastersheet-actions">
            <button class="btn -default" id="mastersheet-import-btn" type="button">Import JS</button>
            <button class="btn -default" id="mastersheet-download-btn" type="button">Download JS</button>
            <button class="btn -default" id="mastersheet-copy-btn" type="button">Copy JS</button>
            <input id="mastersheet-import-input" type="file" accept=".js,text/javascript,application/javascript,.txt,text/plain" hidden>
          </div>
        </div>
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
  let renderTimeout: number | undefined;
  let lastExport: MastersheetExport | undefined;

  const refreshPreview = (): void => {
    if (!textarea || !preview || !toc || !previewPanel) return;
    const markdown = textarea.value;
    setMastersheetMarkdown(project, markdown);
    lastExport = buildMastersheetExport(project, markdown);
    preview.innerHTML = renderMasterData(lastExport.masterData, lastExport.trainersById, lastExport.encountersById);
    renderMastersheetToc(preview, toc, previewPanel);
    const blocking = lastExport.warnings.some((warning) => warning.blocking);
    if (downloadButton) downloadButton.disabled = blocking;
    if (copyButton) copyButton.disabled = blocking;
    renderStatus(status, lastExport.warnings, enrichmentStatus);
  };

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
      const markdown = mastersheetMarkdownFromLegacyJs(await file.text());
      textarea.value = markdown;
      setMastersheetMarkdown(project, markdown);
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
    lastExport = buildMastersheetExport(project, textarea.value);
    renderStatus(status, lastExport.warnings, enrichmentStatus);
    runExportAction(status, () => {
      const file = generateMastersheetDownload(project);
      downloadFile(file);
      return `Downloaded ${file.filename}.`;
    });
  });
  copyButton?.addEventListener("click", async () => {
    if (!textarea) return;
    setMastersheetMarkdown(project, textarea.value);
    lastExport = buildMastersheetExport(project, textarea.value);
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

  refreshPreview();
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
