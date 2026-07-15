import {
  getTutorMoveRows,
  tutorMoveMatchesSearch,
  updateTutorMoveField,
  type TutorMoveField,
  type TutorMoveRow,
} from "../pokeweb/tutorMoveModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { stripeRows } from "./legacyInteractions";

export function renderTutorMoveEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const render = () => {
    try {
      const rows = getTutorMoveRows(project);
      root.innerHTML = `
        <aside class="pokemon-filter tutor-move-filter">
          <div class="filter-title">Tutor Moves</div>
          <input class="filter-input" id="search-text" placeholder="Search tutors or moves"/>
          <button class="btn -default" id="search-text-btn" type="button">Search</button>
          <div class="handler-status" id="tutor-move-status"></div>
        </aside>
        <main class="pokemon-list spreadsheet tutor-move-list" id="tutor-moves">
          <datalist id="tutor-move-names">
            ${(project.texts.banks.moves ?? []).map((name, id) => `<option value="${escapeHtml(name)}">${id}</option>`).join("")}
          </datalist>
          <div class="expanded-field field-header">
            <div class="expanded-field-main">
              <div class="tutor-row-index">#</div>
              <div class="tutor-group">Tutor</div>
              <div class="tutor-slot">Slot</div>
              <div class="tutor-move">Move</div>
              <div class="tutor-cost">Shards</div>
              <div class="tutor-index">Menu order</div>
            </div>
          </div>
          ${rows.map(renderRow).join("")}
        </main>
      `;
      attach(root, project, rows, onDirty);
    } catch (caught) {
      root.innerHTML = `
        <aside class="pokemon-filter tutor-move-filter">
          <div class="filter-title">Tutor Moves</div>
        </aside>
        <main class="pokemon-list spreadsheet tutor-move-list">
          <div class="handler-empty">${escapeHtml(caught instanceof Error ? caught.message : String(caught))}</div>
        </main>
      `;
    }
  };
  render();
}

function attach(root: HTMLElement, project: ProjectState, rows: TutorMoveRow[], onDirty: (() => void) | undefined): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const status = root.querySelector<HTMLElement>("#tutor-move-status");

  const runFilter = () => {
    const query = searchInput?.value ?? "";
    root.querySelectorAll<HTMLElement>(".tutor-move-row").forEach((rowElement) => {
      const row = rows[Number(rowElement.dataset.index)];
      rowElement.style.display = row && tutorMoveMatchesSearch(row, query) ? "" : "none";
    });
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.querySelectorAll<HTMLInputElement>("[data-tutor-move-field]").forEach((input) => {
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
      const rowElement = input.closest<HTMLElement>(".tutor-move-row");
      const rowIndex = Number(rowElement?.dataset.index);
      const field = input.dataset.tutorMoveField as TutorMoveField | undefined;
      if (!field) return;
      try {
        const row = updateTutorMoveField(project, rowIndex, field, input.value);
        rows[rowIndex] = row;
        syncRow(rowElement, row);
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

function renderRow(row: TutorMoveRow): string {
  return `
    <div class="expanded-field filterable tutor-move-row" data-index="${row.rowIndex}" data-move-id="${row.moveId}">
      <div class="expanded-field-main">
        <div class="tutor-row-index">${row.rowIndex}</div>
        <div class="tutor-group">${escapeHtml(row.groupLabel)}</div>
        <div class="tutor-slot">${row.groupOffset + 1}</div>
        <div class="tutor-move">
          <input data-tutor-move-field="move" list="tutor-move-names" value="${escapeHtml(row.moveName)}" aria-label="Tutor row ${row.rowIndex} move">
        </div>
        <div class="tutor-cost">
          <input data-tutor-move-field="shardCost" inputmode="numeric" value="${row.shardCost}" aria-label="Tutor row ${row.rowIndex} shard cost">
        </div>
        <div class="tutor-index">
          <input data-tutor-move-field="displayIndex" inputmode="numeric" value="${row.displayIndex}" aria-label="Tutor row ${row.rowIndex} menu order">
        </div>
      </div>
    </div>
  `;
}

function syncRow(rowElement: HTMLElement | null | undefined, row: TutorMoveRow): void {
  if (!rowElement) return;
  rowElement.dataset.moveId = String(row.moveId);
  rowElement.querySelector<HTMLInputElement>("[data-tutor-move-field='move']")!.value = row.moveName;
  rowElement.querySelector<HTMLInputElement>("[data-tutor-move-field='shardCost']")!.value = String(row.shardCost);
  rowElement.querySelector<HTMLInputElement>("[data-tutor-move-field='displayIndex']")!.value = String(row.displayIndex);
}
