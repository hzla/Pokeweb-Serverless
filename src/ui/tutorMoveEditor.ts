import {
  getTutorMoveRows,
  tutorMoveMatchesSearch,
  updateTutorMoveField,
  type TutorMoveField,
  type TutorMoveRow,
} from "../pokeweb/tutorMoveModel";
import { getPokemonTutorCompatibilityRoster, updatePokemonTutorCompatibility } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { stripeRows } from "./legacyInteractions";
import {
  applyPokemonCompatibilityFilter,
  createPokemonCompatibilityIconRenderer,
  renderPokemonCompatibilityPanel,
  syncPokemonCompatibilityCard,
} from "./pokemonCompatibilityPanel";

const tutorMoveInstallations = new WeakMap<HTMLElement, { controller: AbortController; disconnectIcons: () => void }>();

export function renderTutorMoveEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const previous = tutorMoveInstallations.get(root);
  previous?.controller.abort();
  previous?.disconnectIcons();
  tutorMoveInstallations.delete(root);
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
              <div class="tutor-index">Index</div>
              <div class="tutor-compatibility-column">Compatibility</div>
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
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const iconRenderer = createPokemonCompatibilityIconRenderer(project);
  tutorMoveInstallations.set(root, { controller, disconnectIcons: iconRenderer.disconnect });
  const compatibilitySearchTimers = new WeakMap<HTMLInputElement, number>();
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

  searchButton?.addEventListener("click", runFilter, listenerOptions);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  }, listenerOptions);

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const expandButton = event.target.closest<HTMLButtonElement>("[data-tutor-compatibility-expand]");
    if (expandButton) {
      const rowElement = expandButton.closest<HTMLElement>(".tutor-move-row");
      const row = rows[Number(rowElement?.dataset.index)];
      const host = rowElement?.querySelector<HTMLElement>(".tm-pokemon-compatibility-host");
      if (!rowElement || !row || !host) return;
      const opening = host.hidden;
      if (opening && host.dataset.rendered !== "true") {
        host.innerHTML = renderTutorPokemonCompatibilityPanel(project, row);
        host.dataset.rendered = "true";
      }
      host.hidden = !opening;
      rowElement.classList.toggle("-compatibility-open", opening);
      expandButton.classList.toggle("-active", opening);
      expandButton.setAttribute("aria-expanded", String(opening));
      if (opening) iconRenderer.observe(host);
      return;
    }

    const typeFilter = event.target.closest<HTMLButtonElement>(".tm-pokemon-type-filter");
    if (typeFilter) {
      const panel = typeFilter.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
      if (!panel) return;
      const active = !typeFilter.classList.contains("-active");
      typeFilter.classList.toggle("-active", active);
      typeFilter.setAttribute("aria-pressed", String(active));
      applyPokemonCompatibilityFilter(panel, project);
      return;
    }

    const pokemonCard = event.target.closest<HTMLButtonElement>(".tm-pokemon-compatibility-card");
    if (pokemonCard) {
      const panel = pokemonCard.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
      const speciesId = Number(pokemonCard.dataset.speciesId);
      const field = panel?.dataset.field;
      const index = Number(panel?.dataset.index);
      if (!panel || !field || !Number.isInteger(speciesId) || !Number.isInteger(index)) return;
      const enabled = pokemonCard.dataset.compatible !== "true";
      updatePokemonTutorCompatibility(project, speciesId, field, index, enabled);
      syncPokemonCompatibilityCard(pokemonCard, enabled);
      onDirty?.();
    }
  }, listenerOptions);

  root.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches(".tm-pokemon-search-input")) return;
    const input = event.target;
    const previousTimer = compatibilitySearchTimers.get(input);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      const panel = input.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
      if (panel) applyPokemonCompatibilityFilter(panel, project);
      compatibilitySearchTimers.delete(input);
    }, 120);
    compatibilitySearchTimers.set(input, timer);
  }, listenerOptions);

  root.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches(".tm-pokemon-search-input") || event.key !== "Enter") return;
    event.preventDefault();
    const previousTimer = compatibilitySearchTimers.get(event.target);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    compatibilitySearchTimers.delete(event.target);
    const panel = event.target.closest<HTMLElement>(".tm-pokemon-compatibility-panel");
    if (panel) applyPokemonCompatibilityFilter(panel, project);
  }, listenerOptions);

  root.querySelectorAll<HTMLInputElement>("[data-tutor-move-field]").forEach((input) => {
    let initialValue = input.value;
    input.addEventListener("focus", () => {
      initialValue = input.value;
      input.select();
    }, listenerOptions);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    }, listenerOptions);
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
        syncCompatibilityPanelHeading(rowElement, row);
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
    }, listenerOptions);
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
          <input data-tutor-move-field="displayIndex" inputmode="numeric" value="${row.displayIndex}" aria-label="Tutor row ${row.rowIndex} index">
        </div>
        <div class="tutor-compatibility-column">
          <button
            class="tm-compatibility-expand"
            data-tutor-compatibility-expand
            type="button"
            aria-expanded="false"
            aria-controls="tutor-compatibility-${row.rowIndex}"
            title="Edit compatible Pokemon"
          >
            <span>Pokemon</span>
            <span class="tm-compatibility-expand__chevron" aria-hidden="true">⌄</span>
          </button>
        </div>
      </div>
      <div class="tm-pokemon-compatibility-host" id="tutor-compatibility-${row.rowIndex}" hidden></div>
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

function renderTutorPokemonCompatibilityPanel(project: ProjectState, row: TutorMoveRow): string {
  return renderPokemonCompatibilityPanel(project, {
    title: `${row.groupLabel} · ${row.moveName}`,
    ariaLabel: `${row.groupLabel} ${row.moveName} Pokemon compatibility`,
    data: { field: row.groupField, index: row.groupOffset },
    roster: getPokemonTutorCompatibilityRoster(project, row.groupField, row.groupOffset),
  });
}

function syncCompatibilityPanelHeading(rowElement: HTMLElement | null | undefined, row: TutorMoveRow): void {
  const panel = rowElement?.querySelector<HTMLElement>(".tm-pokemon-compatibility-panel");
  if (!panel) return;
  const title = `${row.groupLabel} · ${row.moveName}`;
  const heading = panel.querySelector<HTMLElement>(".tm-pokemon-compatibility-toolbar strong");
  if (heading) heading.textContent = title;
  panel.setAttribute("aria-label", `${row.groupLabel} ${row.moveName} Pokemon compatibility`);
}
