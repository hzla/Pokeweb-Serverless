import {
  enrichItemLocations,
  enrichTrainerLocations,
  ensureDocs,
  GEN5_CALC_BRIDGE_CONFIG,
  generateCalcBridgePayload,
  generateCalcDownload,
  generateDexDownloads,
  generateTextDocsDownload,
  setDocRomTitle,
  type CalcBridgePayload,
  type DownloadFile,
} from "../pokeweb/docGeneratorModel";
import type { NarcName } from "../pokeweb/constants";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

type RenderOptions = {
  onDirty?: () => void;
};

const CALC_READY_MESSAGE_TYPE = "ddex:calc-ready";
const CALC_SYNC_STARTED_MESSAGE_TYPE = "ddex:calc-sync-started";
const CALC_SYNC_ERROR_MESSAGE_TYPE = "ddex:calc-sync-error";

type CalcBridgeState = {
  calcWindow: Window | null;
  calcReady: boolean;
  pendingSyncPayload: CalcBridgePayload | null;
  status: string;
};

const calcBridgeState: CalcBridgeState = {
  calcWindow: null,
  calcReady: false,
  pendingSyncPayload: null,
  status: "",
};

let calcBridgeListenerBound = false;
let activeBridgeStatus: HTMLElement | null = null;

export function renderDocGenerators(project: ProjectState, root: HTMLElement, options: RenderOptions = {}): void {
  const docs = ensureDocs(project);
  const calcDisabled = docs.romTitle.trim().length === 0 || missing(project, calcRequirements()).length > 0;
  root.innerHTML = `
    <div class="doc-generators">
      <section class="doc-panel">
        <div class="doc-panel__header">
          <h1>Doc Generators</h1>
          <div class="doc-status" id="doc-status">${escapeHtml(calcBridgeState.status || "Ready.")}</div>
        </div>
        <div class="doc-section">
          <h2>Publish Calc</h2>
          <label class="doc-title-field">
            <span>Rom Title</span>
            <input id="rom-title-input" type="text" value="${escapeHtml(docs.romTitle)}" required />
          </label>
          <div class="doc-action-row">
            <button class="btn -default doc-action" id="generate-calc-btn" type="button" ${calcDisabled ? "disabled" : ""}>
              Generate Calc
            </button>
            <button class="btn -default doc-action" id="open-calc-btn" type="button" ${calcDisabled ? "disabled" : ""}>
              Open Calc
            </button>
            <button class="btn -default doc-action" id="sync-calc-btn" type="button" ${calcDisabled ? "disabled" : ""}>
              Sync Data to Calc
            </button>
          </div>
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
  const openCalcButton = root.querySelector<HTMLButtonElement>("#open-calc-btn");
  const syncCalcButton = root.querySelector<HTMLButtonElement>("#sync-calc-btn");
  const dexButton = root.querySelector<HTMLButtonElement>("#generate-dex-btn");
  const textDocsButton = root.querySelector<HTMLButtonElement>("#generate-text-docs-btn");
  const trainerLocationsButton = root.querySelector<HTMLButtonElement>("#trainer-locations-btn");
  const itemLocationsButton = root.querySelector<HTMLButtonElement>("#item-locations-btn");
  const status = root.querySelector<HTMLElement>("#doc-status");
  activeBridgeStatus = status;
  bindCalcBridgeMessages();

  const syncTitle = (): string => {
    const title = titleInput?.value.trim() ?? "";
    setDocRomTitle(project, title);
    const disabled = title.length === 0 || missing(project, calcRequirements()).length > 0;
    if (calcButton) calcButton.disabled = disabled;
    if (openCalcButton) openCalcButton.disabled = disabled;
    if (syncCalcButton) syncCalcButton.disabled = disabled;
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

  openCalcButton?.addEventListener("click", () => {
    openCalc(status);
  });

  syncCalcButton?.addEventListener("click", () => {
    syncCalc(project, status, syncTitle);
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

function bindCalcBridgeMessages(): void {
  if (calcBridgeListenerBound) return;
  window.addEventListener("message", handleCalcBridgeMessage);
  calcBridgeListenerBound = true;
}

function handleCalcBridgeMessage(event: MessageEvent): void {
  if (event.origin !== getCalcBridgeOrigin()) return;
  if (calcBridgeState.calcWindow && event.source !== calcBridgeState.calcWindow) return;
  const data = event.data || {};
  if (!data || typeof data.type !== "string") return;

  if (data.type === CALC_READY_MESSAGE_TYPE) {
    calcBridgeState.calcWindow = event.source as Window || calcBridgeState.calcWindow;
    calcBridgeState.calcReady = true;
    setCalcBridgeStatus("Calc ready.");
    if (calcBridgeState.pendingSyncPayload) {
      const pendingPayload = calcBridgeState.pendingSyncPayload;
      calcBridgeState.pendingSyncPayload = null;
      if (postCalcBridgePayload(pendingPayload)) {
        setCalcBridgeStatus("Syncing calc data...");
      }
    }
    return;
  }

  if (data.type === CALC_SYNC_STARTED_MESSAGE_TYPE) {
    setCalcBridgeStatus("Calc data synced. The calc is reloading.");
    return;
  }

  if (data.type === CALC_SYNC_ERROR_MESSAGE_TYPE) {
    setCalcBridgeStatus(data.error ? `Sync failed: ${data.error}` : "Sync failed.");
  }
}

function openCalc(status: HTMLElement | null): boolean {
  const calcWindow = window.open(buildCalcBridgeUrl(), "pokeweb-dynamic-calc");
  if (!calcWindow) {
    setCalcBridgeStatus("The calc tab was blocked. Allow pop-ups and try again.", status);
    return false;
  }

  calcBridgeState.calcWindow = calcWindow;
  calcBridgeState.calcReady = false;
  calcBridgeState.pendingSyncPayload = null;
  setCalcBridgeStatus("Opening calc tab...", status);
  return true;
}

function syncCalc(project: ProjectState, status: HTMLElement | null, syncTitle: () => string): boolean {
  const title = syncTitle();
  if (!title) {
    setCalcBridgeStatus("Rom Title is required.", status);
    return false;
  }

  const syncPayload = generateCalcBridgePayload(project, title);
  if (!calcBridgeState.calcWindow || calcBridgeState.calcWindow.closed) {
    calcBridgeState.calcReady = false;
    calcBridgeState.calcWindow = null;
    calcBridgeState.pendingSyncPayload = null;
    setCalcBridgeStatus("Open Calc first.", status);
    return false;
  }

  if (!calcBridgeState.calcReady) {
    calcBridgeState.pendingSyncPayload = syncPayload;
    setCalcBridgeStatus("Waiting for the calc tab to finish loading...", status);
    return true;
  }

  calcBridgeState.pendingSyncPayload = null;
  if (postCalcBridgePayload(syncPayload)) {
    setCalcBridgeStatus("Syncing calc data...", status);
    return true;
  }
  return false;
}

function postCalcBridgePayload(payload: CalcBridgePayload): boolean {
  if (!calcBridgeState.calcWindow || calcBridgeState.calcWindow.closed) {
    calcBridgeState.calcReady = false;
    calcBridgeState.calcWindow = null;
    calcBridgeState.pendingSyncPayload = null;
    setCalcBridgeStatus("Open Calc first.");
    return false;
  }
  calcBridgeState.calcWindow.postMessage(payload, getCalcBridgeOrigin());
  return true;
}

function buildCalcBridgeUrl(): string {
  const url = new URL(getCalcBridgePath(), getCalcBridgeOrigin());
  url.searchParams.set("dev", "1");
  url.searchParams.set("forceBlankConfig", "1");
  url.searchParams.set("gen", String(GEN5_CALC_BRIDGE_CONFIG.gen));
  url.searchParams.set("dmgGen", String(GEN5_CALC_BRIDGE_CONFIG.damageGen));
  url.searchParams.set("types", String(GEN5_CALC_BRIDGE_CONFIG.typeChart));
  url.searchParams.set("critGen", String(GEN5_CALC_BRIDGE_CONFIG.critGen));
  url.searchParams.set("switchIn", String(GEN5_CALC_BRIDGE_CONFIG.switchIn));
  url.searchParams.set("ddexBridgeOrigin", window.location.origin);
  return url.toString();
}

function getCalcBridgeOrigin(): string {
  return isLocalPokeweb() ? "http://localhost:3001" : "https://hzla.github.io";
}

function getCalcBridgePath(): string {
  return isLocalPokeweb() ? "/" : "/Dynamic-Calc-Decomps/";
}

function isLocalPokeweb(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1";
}

function setCalcBridgeStatus(message: string, status: HTMLElement | null = activeBridgeStatus): void {
  calcBridgeState.status = message;
  if (status) status.textContent = message;
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
