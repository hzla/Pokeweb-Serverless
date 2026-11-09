import {
  DEX_AREA_METHODS,
  dexAreaSlots,
  dexAreaSpeciesCount,
  encounterDexAreaFlags,
  ensureDexAreaData,
  readDexArea,
  syncEncountersToDexAreas,
  writeDexArea,
  type DexAreaSeasons,
  type DexAreaSlot,
} from "../pokeweb/dexAreaModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import "../styles/moveData.css";
import "../styles/encounterData.css";

type Filter = "all" | "found" | "missing";
type State = { species: number; search: string; filter: Filter; onlyFound: boolean; split: boolean };

const SEASON_LABELS = ["Spring", "Summer", "Autumn", "Winter"];
const SHORT = ["G", "DG", "SG", "S", "RW", "F", "RF"];
/** Colour family per method bit: grass greens, surfing light blues, fishing deep blues. */
const TONE = ["grass", "dark-grass", "shaking-grass", "surf", "ripple", "fish", "fish-ripple"];
const states = new WeakMap<ProjectState, State>();
let generation = 0;

export function renderDexAreaEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const run = ++generation;
  root.innerHTML = `<section class="md-detail"><p class="td-empty" role="status">Loading Pokédex areas…</p></section>`;
  void ensureDexAreaData(project).then(
    () => { if (run === generation && root.isConnected) mount(project, root, onDirty); },
    (error: unknown) => { if (run === generation) root.innerHTML = `<section class="md-detail"><p role="alert">${escapeHtml(errorText(error))}</p></section>`; },
  );
}

function mount(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const count = dexAreaSpeciesCount(project);
  const state = states.get(project) ?? { species: 1, search: "", filter: "all", onlyFound: true, split: false };
  states.set(project, state);
  if (state.species < 1 || state.species > count) state.species = 1;
  let slots: DexAreaSlot[] = dexAreaSlots(project);
  const name = (species: number) => pokemonSpeciesLabel(project, species) || `Species ${species}`;

  root.innerHTML = `
    <div class="encounter-data dex-area-data" id="dex-area-data">
      <aside class="md-list" aria-label="Pokémon">
        <div class="md-filters">
          <input class="md-search" id="dex-area-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search Pokémon" autocomplete="off" spellcheck="false" aria-label="Search Pokémon">
          <select data-dex-area-filter aria-label="Show">
            ${([["all", "All Pokémon"], ["found", "Has areas"], ["missing", "No areas"]] as Array<[Filter, string]>)
              .map(([value, label]) => `<option value="${value}"${state.filter === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="md-rows" id="dex-area-list" role="listbox" aria-label="Pokémon" tabindex="0">
          ${Array.from({ length: count }, (_unused, i) => row(i + 1)).join("")}
        </div>
        <div class="md-list-foot" data-dex-area-count></div>
      </aside>
      <section class="md-detail" id="dex-area-detail"></section>
    </div>`;

  const list = root.querySelector<HTMLElement>("#dex-area-list")!;
  const detail = root.querySelector<HTMLElement>("#dex-area-detail")!;
  const countLabel = root.querySelector<HTMLElement>("[data-dex-area-count]")!;

  function areaCount(species: number): number {
    const seasons = readDexArea(project, species);
    return slots.filter((slot) => seasons.some((flags) => flags[slot.slot])).length;
  }

  function row(species: number): string {
    const areas = areaCount(species);
    const edits = (project.actionChangelog?.entries ?? []).some((entry) => entry.key === `dex-area:${species}`);
    return `<div class="md-row en-row${species === state.species ? " is-selected" : ""}" role="option" aria-selected="${species === state.species}" data-species="${species}" data-areas="${areas}">
      <span class="md-row-id">${species}</span>
      <span class="md-row-name">${escapeHtml(name(species))}${edits ? `<span class="md-edits" title="Edited">1</span>` : ""}</span>
      <span class="en-none">${areas ? `${areas} area${areas === 1 ? "" : "s"}` : "None"}</span>
    </div>`;
  }

  function filter(): void {
    const query = state.search.trim().toLowerCase();
    let visible = 0;
    list.querySelectorAll<HTMLElement>("[data-species]").forEach((element) => {
      const species = Number(element.dataset.species), areas = Number(element.dataset.areas);
      let show = state.filter === "all" || (state.filter === "found" ? areas > 0 : areas === 0);
      if (show && query) show = String(species) === query || name(species).toLowerCase().includes(query);
      element.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    countLabel.textContent = `${visible} of ${count} Pokémon`;
  }

  function refreshRow(species: number): void {
    const element = list.querySelector<HTMLElement>(`[data-species="${species}"]`);
    if (!element) return;
    element.outerHTML = row(species);
    filter();
  }

  function select(species: number): void {
    state.species = species;
    state.split = false;
    list.querySelectorAll<HTMLElement>("[data-species]").forEach((element) => {
      const active = Number(element.dataset.species) === species;
      element.classList.toggle("is-selected", active);
      element.setAttribute("aria-selected", String(active));
    });
    renderDetail();
  }

  function save(seasons: DexAreaSeasons): void {
    try {
      if (writeDexArea(project, state.species, seasons, name(state.species))) {
        onDirty?.();
        refreshRow(state.species);
      }
    } catch (error) {
      window.alert(errorText(error));
    }
    renderDetail();
  }

  function renderDetail(): void {
    const species = state.species, seasons = readDexArea(project, species);
    const yearRound = seasons.every((flags) => flags.every((value, slot) => value === seasons[0][slot])) && !state.split;
    const columns = yearRound ? [0] : [0, 1, 2, 3];
    const shown = slots.filter((slot) => !state.onlyFound || seasons.some((flags) => flags[slot.slot]));
    detail.innerHTML = `
      <div class="en-card da-card">
        <header class="da-head">
          <h2>${escapeHtml(name(species))} <span class="md-row-id">#${species}</span></h2>
          <div class="da-actions">
            <label class="da-check"><input type="checkbox" data-da-year ${yearRound ? "checked" : ""}> Same all year</label>
            <label class="da-check"><input type="checkbox" data-da-only ${state.onlyFound ? "checked" : ""}> Only areas where found</label>
            <button class="btn" type="button" data-da-encounters title="Replace this Pokémon's areas with where it appears in the wild encounter tables">From encounters</button>
            <button class="btn" type="button" data-da-clear>Clear</button>
          </div>
        </header>
        <p class="da-legend">${DEX_AREA_METHODS.map((method, bit) => `<span class="-${TONE[bit]}"><i aria-hidden="true"></i>${method.label}</span>`).join("")}</p>
        <div class="da-add">
          <select data-da-add aria-label="Add an area">
            <option value="">Add an area…</option>
            ${slots.filter((slot) => !shown.includes(slot)).map((slot) => `<option value="${slot.slot}">${escapeHtml(slot.name)} (zone ${slot.zone})</option>`).join("")}
          </select>
        </div>
        ${shown.length ? `<table class="md-table da-table">
          <thead>
            <tr>
              <th class="da-area-head" rowspan="2">Area</th>
              ${columns.map((season) => `<th class="da-season" colspan="${DEX_AREA_METHODS.length}">${yearRound ? "All seasons" : SEASON_LABELS[season]}</th>`).join("")}
              <th class="da-remove-head" rowspan="2"><span class="sr-only">Remove</span></th>
            </tr>
            <tr>${columns.map(() => DEX_AREA_METHODS.map((method, bit) => `<th class="da-method -${TONE[bit]}${bit === 0 ? " -first" : ""}" title="${escapeHtml(method.label)}">${SHORT[bit]}</th>`).join("")).join("")}</tr>
          </thead>
          <tbody>${shown.map((slot) => `<tr data-slot="${slot.slot}">
            <th scope="row" class="da-area-cell"><span class="da-area">${escapeHtml(slot.name)}</span><span class="da-zone">zone ${slot.zone}</span></th>
            ${columns.map((season) => DEX_AREA_METHODS.map((method, bit) => {
              const on = Boolean(seasons[season][slot.slot] & (1 << bit));
              const label = `${method.label}${yearRound ? "" : `, ${SEASON_LABELS[season]}`}, ${slot.name}`;
              return `<td class="da-cell${bit === 0 ? " -first" : ""}"><button type="button" class="da-bit -${TONE[bit]}" aria-pressed="${on}" data-season="${season}" data-bit="${bit}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></button></td>`;
            }).join("")).join("")}
            <td class="da-remove-cell"><button type="button" class="da-remove" data-da-remove title="Remove ${escapeHtml(slot.name)} from this Pokémon" aria-label="Remove ${escapeHtml(slot.name)}">×</button></td>
          </tr>`).join("")}</tbody>
        </table>` : `<p class="td-empty">This Pokémon has no Pokédex areas.</p>`}
      </div>`;

    detail.querySelector<HTMLInputElement>("[data-da-only]")!.addEventListener("change", (event) => {
      state.onlyFound = (event.target as HTMLInputElement).checked;
      renderDetail();
    });
    detail.querySelector<HTMLInputElement>("[data-da-year]")!.addEventListener("change", (event) => {
      // Turning "same all year" on copies spring to every season; turning it off keeps the data and shows four columns.
      if ((event.target as HTMLInputElement).checked) {
        const differs = seasons.some((flags) => flags.some((value, slot) => value !== seasons[0][slot]));
        if (differs && !window.confirm("Copy the spring areas to summer, autumn and winter?")) { renderDetail(); return; }
        state.split = false;
        save(seasons.map(() => [...seasons[0]]));
      }
      else { state.split = true; renderDetail(); }
    });
    detail.querySelector("[data-da-clear]")!.addEventListener("click", () => {
      if (window.confirm(`Remove every Pokédex area for ${name(species)}?`)) save(seasons.map((flags) => flags.map(() => 0)));
    });
    detail.querySelector("[data-da-encounters]")!.addEventListener("click", () => {
      const next = seasons.map((flags) => flags.map(() => 0));
      slots.forEach((slot) => encounterDexAreaFlags(project, slot.pools, dexAreaSpeciesCount(project)).get(species)?.forEach((value, season) => { next[season][slot.slot] = value; }));
      save(next);
    });
    detail.querySelector<HTMLSelectElement>("[data-da-add]")!.addEventListener("change", (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") return;
      // A new area starts as grass in every season; adjust the methods afterwards.
      save(seasons.map((flags) => flags.map((bits, slot) => slot === Number(value) ? bits | 1 : bits)));
    });
    detail.querySelectorAll<HTMLButtonElement>("[data-da-remove]").forEach((button) => button.addEventListener("click", () => {
      const slot = Number(button.closest<HTMLElement>("[data-slot]")!.dataset.slot);
      save(seasons.map((flags) => flags.map((bits, at) => at === slot ? 0 : bits)));
    }));
    detail.querySelectorAll<HTMLButtonElement>(".da-bit").forEach((button) => button.addEventListener("click", () => {
      const slot = Number(button.closest<HTMLElement>("[data-slot]")!.dataset.slot), bit = 1 << Number(button.dataset.bit);
      const targets = yearRound ? [0, 1, 2, 3] : [Number(button.dataset.season)];
      save(seasons.map((flags, season) => flags.map((bits, at) => at === slot && targets.includes(season) ? bits ^ bit : bits)));
    }));

  }

  list.addEventListener("click", (event) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-species]");
    if (element) select(Number(element.dataset.species));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const visible = [...list.querySelectorAll<HTMLElement>("[data-species]")].filter((element) => element.style.display !== "none");
    const at = visible.findIndex((element) => Number(element.dataset.species) === state.species);
    const next = visible[Math.min(visible.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) { select(Number(next.dataset.species)); next.scrollIntoView({ block: "nearest" }); }
  });
  root.querySelector<HTMLInputElement>("#dex-area-search")!.addEventListener("input", (event) => {
    state.search = (event.target as HTMLInputElement).value;
    filter();
  });
  root.querySelector<HTMLSelectElement>("[data-dex-area-filter]")!.addEventListener("change", (event) => {
    state.filter = (event.target as HTMLSelectElement).value as Filter;
    filter();
  });

  renderSyncAction(project, () => {
    slots = dexAreaSlots(project);
    list.innerHTML = Array.from({ length: count }, (_unused, i) => row(i + 1)).join("");
    filter();
    renderDetail();
  }, onDirty);
  filter();
  renderDetail();
  list.querySelector(`[data-species="${state.species}"]`)?.scrollIntoView({ block: "nearest" });
}

function renderSyncAction(project: ProjectState, after: () => void, onDirty?: () => void): void {
  const pageActions = document.getElementById("page-actions");
  if (!pageActions) return;
  pageActions.innerHTML = dexAreaSyncButton();
  bindDexAreaSync(project, pageActions, () => { onDirty?.(); after(); });
}

/** "Sync dex areas" button shared by the Wild encounters and Pokédex areas pages. */
export function dexAreaSyncButton(): string {
  return `<button class="btn" type="button" data-sync-dex-areas title="Rebuild every Pokémon's Pokédex Area map from the wild encounter tables">Sync dex areas</button>`;
}

export function bindDexAreaSync(project: ProjectState, container: HTMLElement, onDone?: () => void): void {
  const button = container.querySelector<HTMLButtonElement>("[data-sync-dex-areas]");
  button?.addEventListener("click", async () => {
    const label = "Sync dex areas";
    if (!window.confirm("Replace every Pokémon's Pokédex areas with where it appears in the wild encounter tables? Manual area edits will be overwritten.")) return;
    button.disabled = true;
    button.textContent = "Syncing…";
    try {
      const result = await syncEncountersToDexAreas(project);
      onDone?.();
      button.textContent = "Dex areas synced";
      button.title = `${result.species} Pokémon found across ${result.slots} areas; ${result.changed} changed.`;
    } catch (error) {
      button.textContent = "Sync failed";
      button.title = errorText(error);
    } finally {
      button.disabled = false;
      window.setTimeout(() => { button.textContent = label; }, 2500);
    }
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

