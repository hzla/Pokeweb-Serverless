import {
  getMoveEffectHandlerRows,
  moveEffectHandlerMatchesSearch,
  updateMoveEffectHandlerAddress,
  updateMoveEffectHandlerMove,
  type MoveEffectHandlerRow,
} from "../pokeweb/moveEffectHandlerModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { stripeRows } from "./legacyInteractions";

export function renderMoveEffectHandlerEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const render = () => {
    try {
      const rows = getMoveEffectHandlerRows(project);
      root.innerHTML = `
        <aside class="pokemon-filter move-effect-handler-filter">
          <div class="filter-title">Move Effect Handlers</div>
          <input class="filter-input" id="search-text" placeholder="Search moves or addresses"/>
          <button class="btn -default" id="search-text-btn" type="button">Search</button>
          <div class="handler-status" id="handler-status"></div>
          <section class="handler-history" aria-label="Move effect handler changelog">
            <div class="handler-history-title">History</div>
            <div class="handler-history-list" id="handler-history-list">
              ${renderHandlerHistory(project)}
            </div>
          </section>
        </aside>
        <main class="pokemon-list spreadsheet move-effect-handler-list" id="move-effect-handlers">
          <datalist id="move-effect-handler-moves">
            ${(project.texts.banks.moves ?? []).map((name, id) => `<option value="${escapeHtml(name)}">${id}</option>`).join("")}
          </datalist>
          <div class="expanded-field field-header">
            <div class="expanded-field-main">
              <div class="handler-index">#</div>
              <div class="handler-move">Move</div>
              <div class="handler-address">Handler Address</div>
            </div>
          </div>
          ${rows.map(renderRow).join("")}
        </main>
      `;
      attach(root, project, rows, onDirty);
    } catch (caught) {
      root.innerHTML = `
        <aside class="pokemon-filter move-effect-handler-filter">
          <div class="filter-title">Move Effect Handlers</div>
        </aside>
        <main class="pokemon-list spreadsheet move-effect-handler-list">
          <div class="handler-empty">${escapeHtml(caught instanceof Error ? caught.message : String(caught))}</div>
        </main>
      `;
    }
  };
  render();
}

function attach(
  root: HTMLElement,
  project: ProjectState,
  rows: MoveEffectHandlerRow[],
  onDirty: (() => void) | undefined,
): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const status = root.querySelector<HTMLElement>("#handler-status");

  const runFilter = () => {
    const query = searchInput?.value ?? "";
    root.querySelectorAll<HTMLElement>(".move-effect-handler-row").forEach((rowElement) => {
      const row = rows[Number(rowElement.dataset.index)];
      rowElement.style.display = row && moveEffectHandlerMatchesSearch(row, query) ? "" : "none";
    });
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.querySelectorAll<HTMLInputElement>("[data-handler-field]").forEach((input) => {
    let initialValue = input.value;
    input.addEventListener("focus", () => {
      initialValue = input.value;
      input.select();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      if (input.value.trim() === initialValue.trim()) return;
      const rowElement = input.closest<HTMLElement>(".move-effect-handler-row");
      const rowIndex = Number(rowElement?.dataset.index);
      try {
        const row =
          input.dataset.handlerField === "move"
            ? updateMoveEffectHandlerMove(project, rowIndex, input.value)
            : updateMoveEffectHandlerAddress(project, rowIndex, input.value);
        rows[rowIndex] = row;
        syncRow(rowElement, row);
        syncHistory(root, project);
        input.classList.remove("invalid");
        if (status) {
          status.textContent = "Saved";
          status.classList.remove("-error");
        }
        onDirty?.();
      } catch (caught) {
        input.value = initialValue;
        input.classList.add("invalid");
        if (status) {
          status.textContent = caught instanceof Error ? caught.message : String(caught);
          status.classList.add("-error");
        }
      }
    });
  });

  runFilter();
}

function renderRow(row: MoveEffectHandlerRow): string {
  return `
    <div class="expanded-field filterable move-effect-handler-row" data-index="${row.index}" data-move-id="${row.moveId}">
      <div class="expanded-field-main">
        <div class="handler-index">${row.index}</div>
        <div class="handler-move">
          <input data-handler-field="move" list="move-effect-handler-moves" value="${escapeHtml(row.moveName)}" aria-label="Handler row ${row.index} move">
        </div>
        <div class="handler-address">
          <input data-handler-field="address" value="${row.addressHex}" aria-label="Handler row ${row.index} address">
        </div>
      </div>
    </div>
  `;
}

function syncRow(rowElement: HTMLElement | null | undefined, row: MoveEffectHandlerRow): void {
  if (!rowElement) return;
  rowElement.dataset.moveId = String(row.moveId);
  const moveInput = rowElement.querySelector<HTMLInputElement>("[data-handler-field='move']");
  const addressInput = rowElement.querySelector<HTMLInputElement>("[data-handler-field='address']");
  if (moveInput) moveInput.value = row.moveName;
  if (addressInput) addressInput.value = row.addressHex;
}

function syncHistory(root: HTMLElement, project: ProjectState): void {
  const history = root.querySelector<HTMLElement>("#handler-history-list");
  if (history) history.innerHTML = renderHandlerHistory(project);
}

function renderHandlerHistory(project: ProjectState): string {
  const entries = (project.actionChangelog?.entries ?? []).filter((entry) => entry.domain === "move_effects_table").slice().reverse();
  if (entries.length === 0) return `<div class="handler-history-empty">No handler changes yet.</div>`;
  return entries
    .map(
      (entry) => `
        <div class="handler-history-entry">
          <div>${escapeHtml(entry.text)}</div>
          <time datetime="${escapeHtml(entry.updatedAt)}">${escapeHtml(formatHistoryTime(entry.updatedAt))}</time>
        </div>
      `,
    )
    .join("");
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
