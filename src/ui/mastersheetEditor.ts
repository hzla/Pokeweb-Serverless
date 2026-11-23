import { announceMastersheet } from "../pokeweb/mastersheetSync";
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

type RenderOptions = {
  onDirty?: () => void;
  /** Saves pending edits; the viewer opens the saved project. */
  beforeOpenViewer?: () => Promise<void>;
};

/**
 * The Mastersheet page. The sheet is written in the Mastersheet Viewer (it edits in place, with the template beside
 * it), so this page opens the viewer and keeps the calc export, Import JS and the ROM option.
 */
export function renderMastersheetEditor(project: ProjectState, root: HTMLElement, options: RenderOptions = {}): void {
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
            <input id="mastersheet-import-input" type="file" accept=".js,text/javascript,application/javascript,.txt,text/plain" hidden>
          </div>
        </div>
        <div class="mastersheet-rom" id="mastersheet-rom"></div>
        <div class="mastersheet-status" id="mastersheet-status">Ready.</div>
      </aside>
      <main class="mastersheet-launch">
        <div class="mastersheet-launch__card">
          <h2>Edit in the Mastersheet Viewer</h2>
          <button class="btn -primary" id="mastersheet-viewer-btn" type="button">Open in viewer</button>
        </div>
      </main>
    </section>
  `;

  const status = root.querySelector<HTMLElement>("#mastersheet-status");
  const importButton = root.querySelector<HTMLButtonElement>("#mastersheet-import-btn");
  const importInput = root.querySelector<HTMLInputElement>("#mastersheet-import-input");
  const downloadButton = root.querySelector<HTMLButtonElement>("#mastersheet-download-btn");
  const copyButton = root.querySelector<HTMLButtonElement>("#mastersheet-copy-btn");
  const romPanel = root.querySelector<HTMLElement>("#mastersheet-rom");
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

  /** The checks the calc export needs: its warnings, and whether it can be downloaded. */
  const checkSheet = (): void => {
    lastExport = buildMastersheetPreview(project, ensureMastersheetMarkdown(project));
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
    if (!button) return;
    const choice = button.dataset.romChoice === "rom" ? "rom" : "project";
    resolveMastersheetRomConflict(project, choice);
    if (choice === "rom") announceMastersheet(ensureMastersheetMarkdown(project));
    checkSheet();
    if (status) status.textContent = choice === "rom" ? "Loaded the mastersheet saved in the ROM." : "Kept this project's mastersheet.";
    options.onDirty?.();
  });

  importButton?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      if (status) status.textContent = `Importing ${file.name}...`;
      const source = await file.text();
      const markdown = mastersheetMarkdownFromLegacyJs(source);
      setMastersheetMarkdown(project, markdown);
      setMastersheetHighlights(project, mastersheetHighlightsFromLegacyJs(source));
      checkSheet();
      // An open viewer takes the imported sheet (unless it has unsaved edits of its own).
      announceMastersheet(markdown);
      if (status && !lastExport?.warnings.length) status.textContent = `Imported ${file.name}.`;
      options.onDirty?.();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      importInput.value = "";
    }
  });
  downloadButton?.addEventListener("click", () => {
    ensureTrainerLocationEnrichment();
    lastExport = buildMastersheetPreview(project, ensureMastersheetMarkdown(project));
    renderStatus(status, lastExport.warnings, enrichmentStatus);
    if (lastExport.warnings.some((warning) => warning.blocking)) return;
    runExportAction(status, () => {
      const file = generateMastersheetDownload(project);
      downloadFile(file);
      return `Downloaded ${file.filename}.`;
    });
  });
  copyButton?.addEventListener("click", async () => {
    ensureTrainerLocationEnrichment();
    lastExport = buildMastersheetPreview(project, ensureMastersheetMarkdown(project));
    if (lastExport.warnings.some((warning) => warning.blocking)) {
      renderStatus(status, lastExport.warnings, enrichmentStatus);
      return;
    }
    try {
      const file = generateMastersheetDownload(project);
      await copyText(file.contents);
      if (status) status.textContent = `Copied ${file.filename}.`;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  root.querySelector<HTMLButtonElement>("#mastersheet-viewer-btn")?.addEventListener("click", async () => {
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

  checkSheet();
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

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Without clipboard access, copy from a hidden text field.
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }
}
