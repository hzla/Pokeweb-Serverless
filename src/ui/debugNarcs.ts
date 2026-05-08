import type { NarcName } from "../pokeweb/constants";
import { decodeRecord, getCachedRecordCount, type ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, formatBytes } from "./dom";

export function renderDebugNarcs(project: ProjectState, root: HTMLElement, onCacheChange?: () => void): void {
  const stores = Object.values(project.narcs).filter(Boolean);
  root.innerHTML = `
    <div class="debug-page">
      <div class="debug-summary">
        <h1>Debug NARCs</h1>
        <p>${project.romInfo.fileName} · ${project.session.baseVersion} / ${project.session.baseRom} · ${getCachedRecordCount(project)} decoded records</p>
      </div>
      <div id="narc-grid" class="narc-grid">
        ${stores
          .map(
            (store) => `
              <button class="narc-card" data-narc="${store.name}">
                <span>${store.name}</span>
                <strong>${store.fileCount}</strong>
                <small>file id ${store.fileId}</small>
              </button>
            `,
          )
          .join("")}
      </div>
      <div id="record-panel" class="record-panel" hidden></div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".narc-card").forEach((button) => {
    button.addEventListener("click", () => renderRecord(project, root, button.dataset.narc as NarcName, 0, onCacheChange));
  });
}

function renderRecord(project: ProjectState, root: HTMLElement, name: NarcName, id: number, onCacheChange?: () => void): void {
  const store = project.narcs[name];
  if (!store) return;
  const safeId = Math.max(0, Math.min(id, store.fileCount - 1));
  const record = decodeRecord(project, name, safeId);
  const panel = root.querySelector<HTMLDivElement>("#record-panel");
  if (!panel) return;

  panel.hidden = false;
  panel.innerHTML = `
    <div class="record-header">
      <div>
        <h2>${name} / ${safeId}</h2>
        <p>${formatBytes(record.bytes.length)} source bytes. Decoded on demand.</p>
      </div>
      <div class="stepper">
        <button id="prev-record" ${safeId === 0 ? "disabled" : ""}>Prev</button>
        <input id="record-id" type="number" min="0" max="${store.fileCount - 1}" value="${safeId}" />
        <button id="next-record" ${safeId >= store.fileCount - 1 ? "disabled" : ""}>Next</button>
      </div>
    </div>
    <pre>${escapeHtml(JSON.stringify({ raw: record.raw, readable: record.readable }, null, 2))}</pre>
  `;

  panel.querySelector<HTMLButtonElement>("#prev-record")?.addEventListener("click", () => renderRecord(project, root, name, safeId - 1, onCacheChange));
  panel.querySelector<HTMLButtonElement>("#next-record")?.addEventListener("click", () => renderRecord(project, root, name, safeId + 1, onCacheChange));
  panel.querySelector<HTMLInputElement>("#record-id")?.addEventListener("change", (event) => {
    renderRecord(project, root, name, Number((event.target as HTMLInputElement).value), onCacheChange);
  });
  onCacheChange?.();
}
