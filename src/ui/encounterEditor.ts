import { publicAsset } from "../assetUrl";
import grassIcon from "../assets/svgs/grass.svg?raw";
import waterIcon from "../assets/svgs/water.svg?raw";
import { ENCOUNTER_SEASONS, isGen4Project } from "../pokeweb/constants";
import {
  copyEncounterData,
  copyEncounterSeason,
  encounterKindHasLevels,
  encounterKindHasPercent,
  encounterKindHasRate,
  encounterKindLabel,
  encounterKindsForGroup,
  encounterMatchesSearch,
  encounterPercentFor,
  encounterSlotCount,
  getEncounterAutofills,
  getEncounterCount,
  getEncounterRecord,
  syncEncountersToDexHabitats,
  updateEncounterField,
  type EncounterGroup,
  type EncounterKind,
  type EncounterRecord,
  type EncounterSeason,
} from "../pokeweb/encounterModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { getHeaderPackedValue, parseHeaders, type HeaderCollection } from "../pokeweb/headerModel";
import { trainerPokemonSpriteSlug } from "../pokeweb/trainerModel";
import { pokemonFormSuffix } from "../pokeweb/pokemonFormLabels";
import { installZoneThumbnails, renderZoneThumbnails, zoneThumbnailsFor } from "./zoneThumbnails";
import type { MatrixSeason } from "../pokeweb/seasonalMatrixModel";
import type { HeaderRow } from "../pokeweb/headerModel";
import { attachListArrows, changedKeys, installDetailFields, markSelectedRow, patchDetail, refreshEditMarks } from "./detailFields";
import { escapeHtml } from "./dom";
import { pokemonFormOptions } from "./pokemonFormOptions";
import { bindDexAreaSync, dexAreaSyncButton } from "./dexAreaEditor";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/encounterData.css";

type EncounterFilter = "all" | "grass" | "water" | "cave" | "seasonal";

type EncounterEditorState = {
  encounterId: number;
  season: EncounterSeason;
  group: EncounterGroup;
  filter: EncounterFilter;
  search: string;
  /** Areas whose seasons are edited together; seeded from whether they are identical. */
  linked: Map<number, boolean>;
};

const editorStates = new WeakMap<ProjectState, EncounterEditorState>();

const SEASON_LABELS: Record<EncounterSeason, string> = { spring: "Spring", summer: "Summer", fall: "Autumn", winter: "Winter" };

/** Black/White 2 names for each encounter table. */
const GEN5_KIND_LABELS: Partial<Record<EncounterKind, string>> = {
  grass: "Grass",
  grass_doubles: "Dark grass",
  grass_special: "Shaking grass",
  surf: "Surfing",
  surf_special: "Rippling water",
  super_rod: "Fishing",
  super_rod_special: "Fishing (ripples)",
};

/** Shows an area the next time the editor renders (used by links from the header editor). */
export function selectEncounterArea(project: ProjectState, encounterId: number): void {
  const state = editorStates.get(project) ?? { encounterId: 0, season: "spring", group: "grass", filter: "all", search: "", linked: new Map() };
  state.encounterId = encounterId;
  state.filter = "all";
  state.search = "";
  editorStates.set(project, state);
}

export function renderEncounterEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const count = getEncounterCount(project);
  const state = editorStates.get(project) ?? { encounterId: 0, season: "spring", group: "grass", filter: "all", search: "", linked: new Map() };
  editorStates.set(project, state);
  if (state.encounterId >= count) state.encounterId = 0;
  if (!["all", "grass", "water", "cave", "seasonal"].includes(state.filter)) state.filter = "all";
  const gen4 = isGen4Project(project);
  if (gen4) state.season = "spring";
  const autofills = getEncounterAutofills(project);

  root.innerHTML = `
    <div class="encounter-data" id="encounter-data">
      <aside class="md-list" aria-label="Encounter areas">
        <div class="md-filters">
          <input class="md-search" id="encounter-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search locations or Pokémon" autocomplete="off" spellcheck="false" aria-label="Search encounter areas">
          <select data-encounter-filter aria-label="Show">
            ${([["all", "All areas"], ["grass", "Grass"], ["water", "Water"], ...(gen4 ? [] : [["cave", "Caves"], ["seasonal", "Changes by season"]])] as Array<[EncounterFilter, string]>)
              .map(([value, label]) => `<option value="${value}"${state.filter === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="md-rows" id="encounter-list" role="listbox" aria-label="Encounter areas" tabindex="0">
          ${Array.from({ length: count }, (_unused, id) => renderAreaRow(project, id)).join("")}
        </div>
        <div class="md-list-foot" data-encounter-count></div>
      </aside>
      <section class="md-detail" id="encounter-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#encounter-list")!;
  const detail = root.querySelector<HTMLElement>("#encounter-detail")!;
  const countLabel = root.querySelector<HTMLElement>("[data-encounter-count]")!;
  const searchInput = root.querySelector<HTMLInputElement>("#encounter-search")!;
  const filterSelect = root.querySelector<HTMLSelectElement>("[data-encounter-filter]")!;

  const isLinked = (id: number) => {
    if (gen4) return false;
    let linked = state.linked.get(id);
    if (linked === undefined) {
      linked = seasonsIdentical(getEncounterRecord(project, id));
      state.linked.set(id, linked);
    }
    return linked;
  };

  const filter = () => {
    let visible = 0;
    list.querySelectorAll<HTMLElement>("[data-area]").forEach((row) => {
      const id = Number(row.dataset.area);
      let show = state.filter === "all"
        || (state.filter === "seasonal" ? row.dataset.seasonal === "true" : (row.dataset.terrain ?? "").split(" ").includes(state.filter));
      if (show && state.search.trim()) show = encounterMatchesSearch(getEncounterRecord(project, id), state.search);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    countLabel.textContent = visible === count ? `${count} areas` : `${visible} of ${count} areas`;
  };

  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-area="${id}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderAreaRow(project, id).trim();
    const next = template.content.firstElementChild as HTMLElement;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const html = () => renderAreaDetail(project, state.encounterId, state.season, state.group, isLinked(state.encounterId));
  const install = (scope: HTMLElement) => {
    installDetailFields(scope, { autofills, commit });
    if (!isGen4Project(project)) installZoneThumbnails(project, scope, thumbnailSeason());
  };
  const thumbnailSeason = (): MatrixSeason => (isLinked(state.encounterId) || state.season === "spring" ? "spring" : state.season === "fall" ? "autumn" : state.season);
  const marks = () => {
    refreshEditMarks(detail, changedKeys(project.actionChangelog?.entries, `encounter:${state.encounterId}:`));
    const edited = changedKeys(project.actionChangelog?.entries, `encounter:${state.encounterId}:`);
    detail.querySelectorAll<HTMLElement>("[data-season-edits]").forEach((badge) => {
      const season = badge.dataset.seasonEdits;
      const n = [...edited].filter((key) => key.startsWith(`${season}_`)).length;
      badge.textContent = n ? String(n) : "";
    });
  };
  const render = () => {
    detail.innerHTML = html();
    install(detail);
    marks();
  };
  const refresh = () => {
    patchDetail(detail, html(), install);
    marks();
  };
  const changed = () => {
    onDirty?.();
    refreshRow(state.encounterId);
    window.setTimeout(refresh, 0);
  };

  /** Write a field for the current season, or for every season when they are linked. */
  function commit(field: HTMLElement, value: string): boolean {
    const name = field.dataset.fieldName;
    if (!name) return false;
    const seasons = isLinked(state.encounterId) ? ENCOUNTER_SEASONS : [state.season];
    try {
      for (const season of seasons) updateEncounterField(project, state.encounterId, name.replace(/^(spring|summer|fall|winter)_/u, `${season}_`), value);
      const record = getEncounterRecord(project, state.encounterId);
      if (field instanceof HTMLSelectElement) field.value = String(record.readable[name] ?? value);
      else if (field.isContentEditable) field.textContent = String(record.readable[name] ?? value);
      changed();
      return true;
    } catch (error) {
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  const select = (id: number, scroll = false) => {
    state.encounterId = id;
    markSelectedRow(list, "[data-area]", (row) => Number(row.dataset.area) === id, scroll);
    render();
    detail.scrollTop = 0;
  };

  detail.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const seasonTab = target.closest<HTMLElement>("[data-season-tab]");
    if (seasonTab) {
      state.season = seasonTab.dataset.seasonTab as EncounterSeason;
      render();
      return;
    }
    const groupTab = target.closest<HTMLElement>("[data-group-tab]");
    if (groupTab) {
      state.group = groupTab.dataset.groupTab as EncounterGroup;
      render();
    }
  });
  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.matches("[data-season-link]")) {
      if (target.checked && !seasonsIdentical(getEncounterRecord(project, state.encounterId))) {
        if (!window.confirm(`Copy ${SEASON_LABELS[state.season]} to the other three seasons so they match?`)) {
          target.checked = false;
          return;
        }
        copyEncounterSeason(project, state.encounterId, state.season);
        onDirty?.();
        refreshRow(state.encounterId);
      }
      state.linked.set(state.encounterId, target.checked);
      render();
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.fieldName) {
      if (!commit(target, target.value)) refresh();
    }
  });

  searchInput.addEventListener("input", () => {
    window.clearTimeout(Number(searchInput.dataset.timer));
    searchInput.dataset.timer = String(window.setTimeout(() => {
      state.search = searchInput.value;
      filter();
    }, 160));
  });
  filterSelect.addEventListener("change", () => {
    state.filter = filterSelect.value as EncounterFilter;
    filter();
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-area]");
    if (row) select(Number(row.dataset.area));
  });
  attachListArrows(list, "[data-area]", (row) => select(Number(row.dataset.area), true));

  renderPageActions(project, count, () => state.encounterId, (sourceId) => {
    copyEncounterData(project, state.encounterId, sourceId);
    state.linked.delete(state.encounterId);
    onDirty?.();
    refreshRow(state.encounterId);
    render();
  }, onDirty);

  filter();
  select(state.encounterId, true);
}

function renderPageActions(
  project: ProjectState,
  count: number,
  currentId: () => number,
  copyFrom: (sourceId: number) => void,
  onDirty?: () => void,
): void {
  const pageActions = document.getElementById("page-actions");
  if (!pageActions) return;
  const options = Array.from({ length: count }, (_unused, id) => `<option value="${id}">${id} · ${escapeHtml(areaName(getEncounterRecord(project, id)))}</option>`).join("");
  pageActions.innerHTML = `
    <details class="en-copy">
      <summary class="btn">Copy from area</summary>
      <div class="en-copy-pop">
        <label class="md-label" for="encounter-copy-source">Replace this area with</label>
        <select id="encounter-copy-source">${options}</select>
        <button class="btn -primary" type="button" data-encounter-copy>Copy every season</button>
      </div>
    </details>
    ${project.session.baseRom === "BW2" ? `<button class="btn" type="button" data-sync-habitats title="Rebuild the Pokédex habitat list from these encounters">Sync dex habitats</button>` : ""}
    ${project.session.baseVersion === "B2" || project.session.baseVersion === "W2" ? dexAreaSyncButton() : ""}
  `;
  bindDexAreaSync(project, pageActions, onDirty);
  const copy = pageActions.querySelector<HTMLDetailsElement>(".en-copy")!;
  const source = pageActions.querySelector<HTMLSelectElement>("#encounter-copy-source")!;
  copy.addEventListener("toggle", () => {
    if (copy.open) source.value = String(currentId() === 0 ? 1 : 0);
  });
  pageActions.querySelector("[data-encounter-copy]")?.addEventListener("click", () => {
    try {
      copyFrom(Number(source.value));
      copy.open = false;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  });
  const sync = pageActions.querySelector<HTMLButtonElement>("[data-sync-habitats]");
  sync?.addEventListener("click", async () => {
    const label = sync.textContent ?? "Sync dex habitats";
    sync.disabled = true;
    sync.textContent = "Syncing…";
    try {
      const result = await syncEncountersToDexHabitats(project);
      onDirty?.();
      sync.textContent = "Habitats synced";
      sync.title = `Synced ${result.habitats} habitats with ${result.species} species entries.`;
    } catch (error) {
      sync.textContent = "Sync failed";
      sync.title = error instanceof Error ? error.message : String(error);
    } finally {
      sync.disabled = false;
      window.setTimeout(() => {
        sync.textContent = label;
      }, 2500);
    }
  });
}

// ---------- List ----------

function areaName(encounter: EncounterRecord): string {
  return (encounter.locations[0] ?? "").replace(/\s*\(\d+\)$/u, "") || "Unused area";
}

function renderAreaRow(project: ProjectState, id: number): string {
  const encounter = getEncounterRecord(project, id);
  const edits = (project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(`encounter:${id}:`) || entry.key.startsWith(`encounter-copy:${id}:`) || entry.key.startsWith(`encounter-season-copy:${id}:`)).length;
  const extra = encounter.locations.length > 1 ? ` +${encounter.locations.length - 1}` : "";
  const seasonal = !isGen4Project(project) && !seasonsIdentical(encounter);
  const terrain = areaTerrain(project, encounter);
  return `
    <div class="md-row en-row" role="option" aria-selected="false" data-area="${id}" data-terrain="${terrain.join(" ")}" data-seasonal="${seasonal}">
      <span class="md-row-id">${id}</span>
      <span class="md-row-name">${escapeHtml(areaName(encounter))}<span class="en-row-more">${extra}</span>${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
      ${seasonal ? `<span class="en-tag" title="Changes by season">Seasonal</span>` : "<span></span>"}
      <span class="en-terrain">${terrain.map((kind) => `<span class="en-terrain-icon -${kind}" title="${TERRAIN_LABELS[kind]}">${TERRAIN_ICONS[kind]}</span>`).join("") || `<span class="en-none">Empty</span>`}</span>
    </div>
  `;
}

type Terrain = "grass" | "water" | "cave" | "shadow";

const TERRAIN_LABELS: Record<Terrain, string> = { grass: "Grass", water: "Water", cave: "Cave", shadow: "Flying shadows only" };
const CAVE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M1 21 8.5 6.5l3 4.5 3.5-6 8 16zM9 21v-3.5a3 3 0 0 1 6 0V21z"/></svg>`;
const WING_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 17.5C7 17 12 13.5 14.5 4c1.6 4.7.9 8.8-1.6 12 3-.3 6-1.8 8.6-4.3-1.4 4.9-5.6 8.3-11.2 8.3-3.3 0-6.1-.9-8.3-2.5z"/></svg>`;
const TERRAIN_ICONS: Record<Terrain, string> = { grass: grassIcon, water: waterIcon, cave: CAVE_ICON, shadow: WING_ICON };

/** Battle background types the map headers use for cave interiors. */
const CAVE_BATTLE_BACKGROUNDS = new Set([4, 5]);
const headerBackgrounds = new WeakMap<HeaderCollection, Map<number, Set<number>>>();

/** Battle background types of every map header that uses each encounter area. */
function areaBattleBackgrounds(project: ProjectState, encounterId: number): Set<number> {
  try {
    if (!project.headers) project.headers = parseHeaders(project);
  } catch {
    return new Set();
  }
  const headers = project.headers;
  let byArea = headerBackgrounds.get(headers);
  if (!byArea) {
    byArea = new Map();
    for (let rowId = 1; rowId <= headers.count; rowId += 1) {
      const row = headers.rows[rowId];
      if (!row) continue;
      const area = Number(row.encounter_id);
      let background: number;
      try {
        background = (getHeaderPackedValue(row, "map_behavior") >> 5) & 31;
      } catch {
        continue;
      }
      if (!byArea.has(area)) byArea.set(area, new Set());
      byArea.get(area)!.add(background);
    }
    headerBackgrounds.set(headers, byArea);
  }
  return byArea.get(encounterId) ?? new Set();
}

function kindHasData(project: ProjectState, encounter: EncounterRecord, kind: EncounterKind): boolean {
  return ENCOUNTER_SEASONS.some((season) => Array.from({ length: encounterSlotCount(kind, project) }, (_unused, slot) => slot)
    .some((slot) => Number(encounter.raw[`${season}_${kind}_slot_${slot}`] ?? 0) % 2048 > 0));
}

/**
 * What kind of place an area is: caves come from the map header's battle
 * background, an area whose only Pokémon are in the special grass table is a
 * bridge with flying shadows, and otherwise grass and water follow the tables.
 */
function areaTerrain(project: ProjectState, encounter: EncounterRecord): Terrain[] {
  const grassKinds = encounterKindsForGroup("grass", project).filter((kind) => kindHasData(project, encounter, kind));
  const water = encounterKindsForGroup("water", project).some((kind) => kindHasData(project, encounter, kind));
  if (!isGen4Project(project)) {
    if (grassKinds.length === 1 && grassKinds[0] === "grass_special" && !water) return ["shadow"];
    const cave = [...areaBattleBackgrounds(project, encounter.id)].some((background) => CAVE_BATTLE_BACKGROUNDS.has(background));
    if (cave) return water ? ["cave", "water"] : ["cave"];
  }
  return [...(grassKinds.length ? ["grass" as const] : []), ...(water ? ["water" as const] : [])];
}

function miniIcon(slug: string, name: string): string {
  const missing = publicAsset("images/pokesprite/-.png");
  return `<img class="fd-mini-icon" src="${publicAsset(`images/pokesprite/${slug}.png`)}" alt="" title="${escapeHtml(name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${missing}'">`;
}

/** True when all four seasons hold the same encounter data. */
function seasonsIdentical(encounter: EncounterRecord): boolean {
  const bySeason = ENCOUNTER_SEASONS.map((season) => Object.entries(encounter.raw)
    .filter(([key]) => key.startsWith(`${season}_`))
    .map(([key, value]) => `${key.slice(season.length + 1)}=${value}`)
    .sort()
    .join(","));
  return bySeason.every((value) => value === bySeason[0]);
}

// ---------- Detail ----------

/** Table names; cave and bridge areas use the same tables for walking, dust clouds and flying shadows. */
function kindLabel(project: ProjectState, kind: EncounterKind, encounter?: EncounterRecord): string {
  if (!isGen4Project(project) && encounter) {
    const terrain = areaTerrain(project, encounter);
    if (terrain.includes("cave") && kind === "grass") return "Cave floor";
    if (terrain.includes("cave") && kind === "grass_special") return "Dust clouds";
    if (terrain.includes("shadow") && kind === "grass_special") return "Flying shadows";
  }
  return (!isGen4Project(project) && GEN5_KIND_LABELS[kind]) || encounterKindLabel(project, kind);
}

function encounterHeaders(project: ProjectState, id: number): HeaderRow[] {
  return Object.values(project.headers?.rows ?? {}).filter((row) => Number(row?.encounter_id ?? row?.enc_data_id) === id);
}

function renderAreaDetail(project: ProjectState, id: number, season: EncounterSeason, group: EncounterGroup, linked: boolean): string {
  const encounter = getEncounterRecord(project, id);
  const gen4 = isGen4Project(project);
  const others = encounter.locations.map((location) => location.replace(/\s*\((\d+)\)$/u, " · header $1"));
  return `
    <article class="en-card" data-index="${id}">
      <header class="td-head fd-head -no-sprite en-head">
        <div class="td-ident">
          <div class="td-title"><h1>${escapeHtml(areaName(encounter))}</h1><span class="td-num">#${id}</span></div>
          <div class="fd-subtitle">${others.length ? escapeHtml(others.join(", ")) : "Not used by any map header"}</div>
        </div>
        ${gen4 ? "" : renderZoneThumbnails(zoneThumbnailsFor(project, encounterHeaders(project, id)))}
      </header>
      ${gen4 ? "" : `
        <div class="en-seasons">
          <label class="md-check td-check en-link"><input type="checkbox" data-season-link ${linked ? "checked" : ""}><span>Same in every season</span></label>
          ${linked ? "" : `<div class="en-season-tabs" role="tablist" aria-label="Season">
            ${ENCOUNTER_SEASONS.map((s) => `<button class="btn sm" type="button" role="tab" data-season-tab="${s}" aria-pressed="${s === season}">${SEASON_LABELS[s]}<span class="pd-tab-edits" data-season-edits="${s}"></span></button>`).join("")}
          </div>`}
        </div>
      `}
      <div class="md-tabs" role="tablist" aria-label="Encounter type">
        ${(["grass", "water"] as EncounterGroup[]).map((g) => `<button class="uv-tab" type="button" role="tab" data-group-tab="${g}" aria-selected="${g === group}">${g === "grass" ? "Grass" : "Water"}</button>`).join("")}
      </div>
      <div class="en-kinds" data-structure="${group}:${season}">
        ${encounterKindsForGroup(group, project).map((kind) => renderKind(project, encounter, season, kind)).join("")}
      </div>
      <div class="section-bar md-gap">Pokémon here<span class="td-bar-note">${linked || gen4 ? (gen4 ? "" : "all seasons") : SEASON_LABELS[season]}</span></div>
      <div data-derived="summary">${renderSummary(project, encounter, season, group)}</div>
    </article>
  `;
}

function renderKind(project: ProjectState, encounter: EncounterRecord, season: EncounterSeason, kind: EncounterKind): string {
  const rateField = `${season}_${kind}_rate`;
  const hasRate = encounterKindHasRate(project, kind);
  const rate = Number(encounter.readable[rateField] ?? 0);
  const off = hasRate && rate === 0;
  const showLevels = encounterKindHasLevels(project, kind);
  const showPercent = encounterKindHasPercent(project, kind);
  const showForm = !isGen4Project(project);
  const rows = Array.from({ length: encounterSlotCount(kind, project) }, (_unused, slot) => {
    const base = `${season}_${kind}_slot_${slot}`;
    const speciesId = Number(encounter.raw[base] ?? 0) % 2048;
    const name = String(encounter.readable[base] ?? "");
    return `
      <tr data-mark-fields="${base}|${base}_min_level|${base}_max_level|${base}_form">
        ${showPercent ? `<td class="en-pct">${encounterPercentFor(kind, slot)}%</td>` : ""}
        <td class="en-mon-cell"><div class="en-mon">
          <span class="en-mon-icon" data-derived="icon-${base}">${name ? miniIcon(trainerPokemonSpriteSlug(name, Number(encounter.readable[`${base}_form`] ?? 0)), name) : ""}</span>
          ${editable(base, name, { autofill: "pokemon_names", placeholder: "Empty" })}
        </div></td>
        ${showLevels ? `<td class="r">${editable(`${base}_min_level`, encounter.readable[`${base}_min_level`], { type: "int-100", label: "Minimum level" })}</td><td class="r">${editable(`${base}_max_level`, encounter.readable[`${base}_max_level`], { type: "int-100", label: "Maximum level" })}</td>` : ""}
        ${showForm ? `<td>${pokemonFormOptions(project, speciesId, Number(encounter.readable[`${base}_form`] ?? 0), `${base}_form`)}</td>` : ""}
      </tr>
    `;
  }).join("");
  return `
    <section class="en-kind${off ? " -off" : ""}" data-structure="${kind}:${off ? "off" : "on"}">
      <div class="en-kind-head">
        <h3>${escapeHtml(kindLabel(project, kind, encounter))}</h3>
        ${hasRate ? `<label class="en-rate" data-mark-fields="${rateField}"><span class="md-label">Rate</span>${editable(rateField, rate, { type: "int-100", label: `${kindLabel(project, kind, encounter)} encounter rate` })}</label>` : ""}
        ${off ? `<span class="en-off">Off</span>` : ""}
      </div>
      ${off ? "" : `
        <table class="md-table en-table">
          <thead><tr>${showPercent ? "<th>%</th>" : ""}<th>Pokémon</th>${showLevels ? `<th class="r">Min</th><th class="r">Max</th>` : ""}${showForm ? "<th>Form</th>" : ""}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `}
    </section>
  `;
}

/** Species in the selected tab: chance per encounter table and overall level range. */
function renderSummary(project: ProjectState, encounter: EncounterRecord, season: EncounterSeason, group: EncounterGroup): string {
  const kinds = encounterKindsForGroup(group, project).filter((kind) => !encounterKindHasRate(project, kind) || Number(encounter.readable[`${season}_${kind}_rate`] ?? 0) > 0);
  const species = new Map<string, { chances: Map<EncounterKind, number>; min: number; max: number; slug: string }>();
  for (const kind of kinds) {
    for (let slot = 0; slot < encounterSlotCount(kind, project); slot += 1) {
      const base = `${season}_${kind}_slot_${slot}`;
      const baseName = String(encounter.readable[base] ?? "");
      if (!baseName) continue;
      const form = Number(encounter.readable[`${base}_form`] ?? 0);
      const suffix = form ? pokemonFormSuffix(baseName, form) ?? `Form ${form}` : "";
      const name = suffix ? `${baseName}-${suffix}` : baseName;
      const entry = species.get(name) ?? { chances: new Map(), min: Infinity, max: 0, slug: trainerPokemonSpriteSlug(baseName, form) };
      entry.chances.set(kind, (entry.chances.get(kind) ?? 0) + (encounterKindHasPercent(project, kind) ? encounterPercentFor(kind, slot) : 0));
      const min = Number(encounter.readable[`${base}_min_level`] ?? 0);
      const max = Number(encounter.readable[`${base}_max_level`] ?? 0);
      if (min) entry.min = Math.min(entry.min, min);
      if (max) entry.max = Math.max(entry.max, max);
      species.set(name, entry);
    }
  }
  if (species.size === 0) return `<p class="td-empty">No Pokémon in this tab.</p>`;
  const rows = [...species.entries()].map(([name, entry]) => `
    <tr>
      <td class="en-mon-cell"><div class="en-mon">${miniIcon(entry.slug, name)}<span>${escapeHtml(name)}</span></div></td>
      ${kinds.map((kind) => `<td class="r">${entry.chances.has(kind) ? `${entry.chances.get(kind)}%` : "—"}</td>`).join("")}
      <td class="r">${entry.max ? (entry.min === entry.max ? `Lv ${entry.max}` : `Lv ${entry.min}–${entry.max}`) : ""}</td>
    </tr>
  `).join("");
  return `
    <table class="md-table en-summary">
      <thead><tr><th>Pokémon</th>${kinds.map((kind) => `<th class="r">${escapeHtml(kindLabel(project, kind, encounter))}</th>`).join("")}<th class="r">Levels</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function editable(field: string, value: unknown, options: { autofill?: string; type?: string; placeholder?: string; label?: string } = {}): string {
  const attributes = [
    options.autofill ? `data-autofill="${options.autofill}"` : "",
    options.type ? `data-type="${options.type}"` : "",
    options.placeholder ? `data-placeholder="${escapeHtml(options.placeholder)}"` : "",
    options.label ? `aria-label="${escapeHtml(options.label)}"` : "",
  ].filter(Boolean).join(" ");
  return `<div autocorrect="off" spellcheck="false" contenteditable="true" data-field-name="${escapeHtml(field)}" ${attributes}>${escapeHtml(String(value ?? ""))}</div>`;
}

