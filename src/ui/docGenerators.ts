import {
  enrichItemLocations,
  enrichTrainerLocations,
  ensureDocs,
  generateCalcDownload,
  generateDexDownloads,
  generateTextDocsDownload,
  setDocRomTitle,
  type DownloadFile,
} from "../pokeweb/docGeneratorModel";
import type { NarcName } from "../pokeweb/constants";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type RenderOptions = {
  onDirty?: () => void;
};

export function renderDocGenerators(project: ProjectState, root: HTMLElement, options: RenderOptions = {}): void {
  const docs = ensureDocs(project);
  root.innerHTML = `
    <div class="doc-generators">
      <section class="doc-panel">
        <div class="doc-panel__header">
          <h1>Doc Generators</h1>
          <div class="doc-status" id="doc-status">Ready.</div>
        </div>
        <div class="doc-section">
          <h2>Publish Calc</h2>
          <label class="doc-title-field">
            <span>Rom Title</span>
            <input id="rom-title-input" type="text" value="${escapeHtml(docs.romTitle)}" required />
          </label>
          <button class="btn -default doc-action" id="generate-calc-btn" type="button" ${missing(project, calcRequirements()).length ? "disabled" : ""}>
            Generate Calc
          </button>
          ${missingText(project, calcRequirements())}
        </div>
        <div class="doc-section">
          <h2>Dex Generation</h2>
          <button class="btn -default doc-action" id="generate-dex-btn" type="button" ${missing(project, dexRequirements()).length ? "disabled" : ""}>
            Generate Dex
          </button>
          ${missingText(project, dexRequirements())}
        </div>
        <div class="doc-section">
          <h2>Text Docs</h2>
          <button class="btn -default doc-action" id="generate-text-docs-btn" type="button" ${missing(project, textDocRequirements()).length ? "disabled" : ""}>
            Generate Text Docs
          </button>
          ${missingText(project, textDocRequirements())}
        </div>
        <div class="doc-section">
          <h2>Location Data</h2>
          <div class="doc-action-row">
            <button class="btn -default doc-action" id="trainer-locations-btn" type="button" ${missing(project, trainerLocationRequirements()).length ? "disabled" : ""}>
              Get Trainer Location Data
            </button>
            <span>${Object.keys(docs.trainerLocations).length} trainers enriched, ${Object.keys(docs.trainerDiffs).length} diff values</span>
          </div>
          ${missingText(project, trainerLocationRequirements())}
          <div class="doc-action-row">
            <button class="btn -default doc-action" id="item-locations-btn" type="button" ${missing(project, itemLocationRequirements()).length ? "disabled" : ""}>
              Get Item Location Data
            </button>
            <span>${Object.keys(docs.itemLocations).length} items enriched</span>
          </div>
          ${missingText(project, itemLocationRequirements())}
        </div>
      </section>
    </div>
  `;

  const titleInput = root.querySelector<HTMLInputElement>("#rom-title-input");
  const calcButton = root.querySelector<HTMLButtonElement>("#generate-calc-btn");
  const dexButton = root.querySelector<HTMLButtonElement>("#generate-dex-btn");
  const textDocsButton = root.querySelector<HTMLButtonElement>("#generate-text-docs-btn");
  const trainerLocationsButton = root.querySelector<HTMLButtonElement>("#trainer-locations-btn");
  const itemLocationsButton = root.querySelector<HTMLButtonElement>("#item-locations-btn");
  const status = root.querySelector<HTMLElement>("#doc-status");

  const syncTitle = (): string => {
    const title = titleInput?.value.trim() ?? "";
    setDocRomTitle(project, title);
    if (calcButton) calcButton.disabled = title.length === 0 || missing(project, calcRequirements()).length > 0;
    return title;
  };

  titleInput?.addEventListener("input", () => {
    syncTitle();
    options.onDirty?.();
  });
  syncTitle();

  calcButton?.addEventListener("click", () => {
    runAction(status, "Generating calc data", () => {
      const title = syncTitle();
      if (!title) throw new Error("Rom Title is required.");
      downloadFile(generateCalcDownload(project, title));
      return "Downloaded calc data.";
    });
  });

  dexButton?.addEventListener("click", () => {
    runAction(status, "Generating dex files", () => {
      const title = syncTitle() || project.session.romName;
      for (const file of generateDexDownloads(project, title)) downloadFile(file);
      return "Downloaded dex overrides and search index.";
    });
  });

  textDocsButton?.addEventListener("click", () => {
    runAction(status, "Generating text docs", () => {
      const title = syncTitle() || project.session.romName;
      downloadFile(generateTextDocsDownload(project, title));
      options.onDirty?.();
      return "Downloaded text docs zip.";
    });
  });

  trainerLocationsButton?.addEventListener("click", () => {
    try {
      if (status) status.textContent = "Finding trainer locations";
      const result = enrichTrainerLocations(project);
      options.onDirty?.();
      renderDocGenerators(project, root, options);
      const nextStatus = root.querySelector<HTMLElement>("#doc-status");
      if (nextStatus) nextStatus.textContent = result.message;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  itemLocationsButton?.addEventListener("click", () => {
    try {
      if (status) status.textContent = "Finding item locations";
      const result = enrichItemLocations(project);
      options.onDirty?.();
      renderDocGenerators(project, root, options);
      const nextStatus = root.querySelector<HTMLElement>("#doc-status");
      if (nextStatus) nextStatus.textContent = result.message;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

function runAction(status: HTMLElement | null, pending: string, action: () => string): void {
  try {
    if (status) status.textContent = pending;
    const message = action();
    if (status) status.textContent = message;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function downloadFile(file: DownloadFile): void {
  const contents: BlobPart = file.contents instanceof Uint8Array ? new Uint8Array(file.contents).buffer as ArrayBuffer : file.contents;
  const blob = new Blob([contents], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function missing(project: ProjectState, requirements: NarcName[]): NarcName[] {
  return requirements.filter((name) => !project.narcs[name]);
}

function missingText(project: ProjectState, requirements: NarcName[]): string {
  const names = missing(project, requirements);
  return names.length ? `<div class="doc-missing">Missing loaded data: ${names.map(escapeHtml).join(", ")}</div>` : "";
}

function calcRequirements(): NarcName[] {
  return ["personal", "learnsets", "evolutions", "moves", "items", "trdata", "trpok"];
}

function dexRequirements(): NarcName[] {
  return ["personal", "learnsets", "evolutions", "moves", "items", "encounters"];
}

function textDocRequirements(): NarcName[] {
  return ["personal", "learnsets", "evolutions", "moves", "items", "trdata", "trpok"];
}

function trainerLocationRequirements(): NarcName[] {
  return ["headers", "overworlds"];
}

function itemLocationRequirements(): NarcName[] {
  return ["headers", "overworlds", "scripts", "items"];
}
