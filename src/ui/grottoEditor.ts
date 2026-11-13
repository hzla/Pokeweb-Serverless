import { publicAsset } from "../assetUrl";
import {
  GROTTO_ITEM_RARITIES,
  GROTTO_ITEM_TYPES,
  GROTTO_POKEMON_RARITIES,
  GROTTO_VERSIONS,
  getGrottoAutofills,
  getGrottoCount,
  getGrottoOdds,
  getGrottoRecord,
  grottoMatchesSearch,
  remainingHiddenCommonOdd,
  updateGrottoField,
  updateGrottoOddsField,
  type GrottoRecord,
} from "../pokeweb/martGrottoModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { trainerPokemonSpriteSlug } from "../pokeweb/trainerModel";
import { attachListArrows, changedKeys, installDetailFields, markSelectedRow, patchDetail, refreshEditMarks } from "./detailFields";
import { escapeHtml } from "./dom";
import { pokemonFormOptions } from "./pokemonFormOptions";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/encounterData.css";

type GrottoVersion = (typeof GROTTO_VERSIONS)[number];

type GrottoEditorState = {
  grottoId: number;
  version: GrottoVersion;
  search: string;
  /** Grottos whose Black 2 and White 2 Pokémon are edited together; seeded from whether they match. */
  linked: Map<number, boolean>;
};

const editorStates = new WeakMap<ProjectState, GrottoEditorState>();
const VERSION_LABELS: Record<GrottoVersion, string> = { black: "Black 2", white: "White 2" };
const RARITY_LABELS: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", superrare: "Super rare" };
/** The rate table holds one row per entry, but the rates are shared by every grotto. */
const RATE_ROWS = 20;
const SLOT_FIELDS = ["pok", "min_lvl", "max_lvl", "gender", "form"] as const;

export function renderGrottoEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void): void {
  const count = getGrottoCount(project);
  const state = editorStates.get(project) ?? { grottoId: 0, version: "black", search: "", linked: new Map() };
  editorStates.set(project, state);
  if (state.grottoId >= count) state.grottoId = 0;
  const autofills = getGrottoAutofills(project);
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  root.innerHTML = `
    <div class="encounter-data grotto-data" id="encounter-data">
      <aside class="md-list" aria-label="Hidden grottos">
        <div class="md-filters">
          <input class="md-search" id="grotto-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search grottos, Pokémon, items" autocomplete="off" spellcheck="false" aria-label="Search grottos">
        </div>
        <div class="md-rows" id="grotto-list" role="listbox" aria-label="Hidden grottos" tabindex="0">
          ${Array.from({ length: count }, (_unused, id) => renderGrottoRow(project, id)).join("")}
        </div>
      </aside>
      <section class="md-detail" id="grotto-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#grotto-list")!;
  const detail = root.querySelector<HTMLElement>("#grotto-detail")!;
  const searchInput = root.querySelector<HTMLInputElement>("#grotto-search")!;

  const isLinked = (id: number) => {
    let linked = state.linked.get(id);
    if (linked === undefined) {
      linked = versionsMatch(getGrottoRecord(project, id));
      state.linked.set(id, linked);
    }
    return linked;
  };

  const filter = () => {
    list.querySelectorAll<HTMLElement>("[data-grotto]").forEach((row) => {
      const show = !state.search.trim() || grottoMatchesSearch(getGrottoRecord(project, Number(row.dataset.grotto)), state.search);
      row.style.display = show ? "" : "none";
    });
  };

  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-grotto="${id}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderGrottoRow(project, id).trim();
    const next = template.content.firstElementChild as HTMLElement;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const html = () => renderGrottoDetail(project, state.grottoId, state.version, isLinked(state.grottoId));
  const install = (scope: HTMLElement) => installDetailFields(scope, { autofills, commit });
  const marks = () => {
    const edited = changedKeys(project.actionChangelog?.entries, `grotto:${state.grottoId}:`);
    // Shared rates are marked when any row of the rate table changed.
    for (const key of changedKeys(project.actionChangelog?.entries, "grotto-odds:")) edited.add(`rate:${key.replace(/_\d+$/u, "")}`);
    refreshEditMarks(detail, edited);
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

  function commit(field: HTMLElement, value: string): boolean {
    const name = field.dataset.fieldName ?? "";
    try {
      const rate = /^rate:(.+)$/u.exec(name);
      if (rate) {
        for (let row = 0; row < RATE_ROWS; row += 1) updateGrottoOddsField(project, `${rate[1]}_${row}`, value);
      } else {
        const versions = /^(black|white)_/u.test(name) && isLinked(state.grottoId) ? GROTTO_VERSIONS : [undefined];
        const input = name.includes("_pok_") && value === "" ? "0" : value;
        for (const version of versions) updateGrottoField(project, state.grottoId, version ? name.replace(/^(black|white)_/u, `${version}_`) : name, input);
      }
      onDirty?.();
      refreshRow(state.grottoId);
      window.setTimeout(refresh, 0);
      return true;
    } catch (error) {
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  const select = (id: number, scroll = false) => {
    state.grottoId = id;
    markSelectedRow(list, "[data-grotto]", (row) => Number(row.dataset.grotto) === id, scroll);
    render();
    detail.scrollTop = 0;
  };

  detail.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-version-tab]");
    if (tab) {
      state.version = tab.dataset.versionTab as GrottoVersion;
      render();
    }
  });
  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.matches("[data-version-link]")) {
      if (target.checked && !versionsMatch(getGrottoRecord(project, state.grottoId))) {
        const other = state.version === "black" ? "white" : "black";
        if (!window.confirm(`Copy the ${VERSION_LABELS[state.version]} Pokémon to ${VERSION_LABELS[other]} so they match?`)) {
          target.checked = false;
          return;
        }
        copyVersion(project, state.grottoId, state.version, other);
        onDirty?.();
        refreshRow(state.grottoId);
      }
      state.linked.set(state.grottoId, target.checked);
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
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-grotto]");
    if (row) select(Number(row.dataset.grotto));
  });
  attachListArrows(list, "[data-grotto]", (row) => select(Number(row.dataset.grotto), true));

  filter();
  select(state.grottoId, true);
}

/** Copy one version's Pokémon slots onto the other through the normal field updates. */
function copyVersion(project: ProjectState, grottoId: number, from: GrottoVersion, to: GrottoVersion): void {
  const record = getGrottoRecord(project, grottoId);
  for (const rarity of GROTTO_POKEMON_RARITIES) {
    for (let n = 0; n < 4; n += 1) {
      for (const field of SLOT_FIELDS) {
        const source = `${from}_${rarity}_${field}_${n}`;
        const target = `${to}_${rarity}_${field}_${n}`;
        if (record.raw[source] === record.raw[target]) continue;
        updateGrottoField(project, grottoId, target, field === "pok" ? String(record.raw[source] ?? 0) : String(record.readable[source] ?? 0));
      }
    }
  }
}

function versionsMatch(grotto: GrottoRecord): boolean {
  return GROTTO_POKEMON_RARITIES.every((rarity) => Array.from({ length: 4 }, (_unused, n) => n).every((n) => SLOT_FIELDS.every((field) => grotto.raw[`black_${rarity}_${field}_${n}`] === grotto.raw[`white_${rarity}_${field}_${n}`])));
}

// ---------- List ----------

function renderGrottoRow(project: ProjectState, id: number): string {
  const grotto = getGrottoRecord(project, id);
  const edits = (project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(`grotto:${id}:`)).length;
  return `
    <div class="md-row en-row" role="option" aria-selected="false" data-grotto="${id}">
      <span class="md-row-id">${id}</span>
      <span class="md-row-name">${escapeHtml(String(grotto.readable.name ?? `Grotto ${id}`))}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
      ${versionsMatch(grotto) ? "<span></span>" : `<span class="en-tag">Differs by version</span>`}
      <span></span>
    </div>
  `;
}

function miniIcon(slug: string, name: string): string {
  const missing = publicAsset("images/pokesprite/-.png");
  return `<img class="fd-mini-icon" src="${publicAsset(`images/pokesprite/${slug}.png`)}" alt="" title="${escapeHtml(name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${missing}'">`;
}

function itemIcon(name: string): string {
  if (!name || /^(none|-+|\?+)$/iu.test(name)) return "";
  return `<img class="gr-item-icon" src="${publicAsset(`images/item_sprites/${name.normalize("NFKD").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase()}.png`)}" alt="" onerror="this.remove()">`;
}

// ---------- Detail ----------

function renderGrottoDetail(project: ProjectState, id: number, version: GrottoVersion, linked: boolean): string {
  const grotto = getGrottoRecord(project, id);
  const odds = getGrottoOdds(project).readable;
  const shownVersion = linked ? "black" : version;
  return `
    <article class="en-card" data-index="${id}">
      <header class="td-head fd-head -no-sprite">
        <div class="td-ident">
          <div class="td-title"><h1>${escapeHtml(String(grotto.readable.name ?? `Grotto ${id}`))}</h1><span class="td-num">#${id}</span></div>
        </div>
      </header>
      <div class="section-bar">Pokémon</div>
      <div class="en-seasons">
        <label class="md-check td-check en-link"><input type="checkbox" data-version-link ${linked ? "checked" : ""}><span>Same in both versions</span></label>
        ${linked ? "" : `<div class="en-season-tabs" role="tablist" aria-label="Version">
          ${GROTTO_VERSIONS.map((v) => `<button class="btn sm" type="button" role="tab" data-version-tab="${v}" aria-pressed="${v === version}">${VERSION_LABELS[v]}</button>`).join("")}
        </div>`}
      </div>
      <div class="en-kinds gr-pokemon" data-structure="${shownVersion}">
        ${GROTTO_POKEMON_RARITIES.map((rarity) => renderPokemonTable(project, grotto, shownVersion, rarity, Number(odds[`${rarity}_pok_odds_0`] ?? 0))).join("")}
      </div>
      ${GROTTO_ITEM_TYPES.map((itemType) => `
        <div class="section-bar md-gap">${itemType === "hidden" ? "Hidden items" : "Items"}</div>
        <div class="en-kinds gr-items">
          ${GROTTO_ITEM_RARITIES.map((rarity) => renderItemTable(project, grotto, itemType, rarity, odds)).join("")}
        </div>
      `).join("")}
    </article>
  `;
}

function rateField(key: string, value: number, label: string): string {
  return `<label class="en-rate" data-mark-fields="rate:${key}"><span class="md-label">Rate</span>${editable(`rate:${key}`, value, { type: "int-100", label: `${label} rate`, title: "Shared by every grotto" })}<span class="md-unit">%</span></label>`;
}

function renderPokemonTable(project: ProjectState, grotto: GrottoRecord, version: GrottoVersion, rarity: string, rate: number): string {
  const rows = Array.from({ length: 4 }, (_unused, n) => {
    const base = `${version}_${rarity}`;
    const species = `${base}_pok_${n}`;
    const name = String(grotto.readable[species] ?? "");
    const shown = name && name !== "None" ? name : "";
    return `
      <tr data-mark-fields="${["pok", "min_lvl", "max_lvl", "gender", "form"].map((field) => `${base}_${field}_${n}`).join("|")}">
        <td class="en-mon-cell"><div class="en-mon">
          <span class="en-mon-icon" data-derived="icon-${species}">${shown ? miniIcon(trainerPokemonSpriteSlug(shown, Number(grotto.readable[`${base}_form_${n}`] ?? 0)), shown) : ""}</span>
          ${editable(species, shown, { autofill: "pokemon_names", placeholder: "Empty" })}
        </div></td>
        <td class="r">${editable(`${base}_min_lvl_${n}`, grotto.readable[`${base}_min_lvl_${n}`], { type: "int-100", label: "Minimum level" })}</td>
        <td class="r">${editable(`${base}_max_lvl_${n}`, grotto.readable[`${base}_max_lvl_${n}`], { type: "int-100", label: "Maximum level" })}</td>
        <td class="r">${editable(`${base}_gender_${n}`, grotto.readable[`${base}_gender_${n}`], { type: "int-100", label: "Female chance" })}</td>
        <td>${pokemonFormOptions(project, Number(grotto.raw[species] ?? 0), Number(grotto.readable[`${base}_form_${n}`] ?? 0), `${base}_form_${n}`)}</td>
      </tr>
    `;
  }).join("");
  return `
    <section class="en-kind">
      <div class="en-kind-head"><h3>${RARITY_LABELS[rarity]}</h3>${rateField(`${rarity}_pok_odds`, rate, RARITY_LABELS[rarity])}</div>
      <table class="md-table en-table">
        <thead><tr><th>Pokémon</th><th class="r">Min</th><th class="r">Max</th><th class="r" title="Chance the Pokémon is female">Female %</th><th>Form</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderItemTable(project: ProjectState, grotto: GrottoRecord, itemType: string, rarity: string, odds: Record<string, string | number>): string {
  const remainder = itemType === "hidden" && rarity === "common";
  const rate = remainder ? remainingHiddenCommonOdd(project, 0) : Number(odds[`${rarity}_${itemType}_item_odds_0`] ?? 0);
  const rows = Array.from({ length: 4 }, (_unused, n) => {
    const field = `${itemType}_${rarity}_item_${n}`;
    const name = String(grotto.readable[field] ?? "");
    return `
      <tr data-mark-fields="${field}">
        <td class="en-mon-cell"><div class="en-mon"><span class="en-mon-icon" data-derived="icon-${field}">${itemIcon(name)}</span>${editable(field, name, { autofill: "items" })}</div></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="en-kind">
      <div class="en-kind-head">
        <h3>${RARITY_LABELS[rarity]}</h3>
        ${remainder
          ? `<span class="en-rate"><span class="md-label">Rate</span><span class="gr-remainder${rate < 0 ? " -over" : ""}" data-derived="hidden-common" title="Whatever the other item rates leave over">${rate}%</span></span>`
          : rateField(`${rarity}_${itemType}_item_odds`, rate, `${RARITY_LABELS[rarity]} ${itemType} item`)}
      </div>
      <table class="md-table en-table gr-item-table"><tbody>${rows}</tbody></table>
    </section>
  `;
}

function editable(field: string, value: unknown, options: { autofill?: string; type?: string; placeholder?: string; label?: string; title?: string } = {}): string {
  const attributes = [
    options.autofill ? `data-autofill="${options.autofill}"` : "",
    options.type ? `data-type="${options.type}"` : "",
    options.placeholder ? `data-placeholder="${escapeHtml(options.placeholder)}"` : "",
    options.label ? `aria-label="${escapeHtml(options.label)}"` : "",
    options.title ? `title="${escapeHtml(options.title)}"` : "",
  ].filter(Boolean).join(" ");
  return `<div autocorrect="off" spellcheck="false" contenteditable="true" data-field-name="${escapeHtml(field)}" ${attributes}>${escapeHtml(String(value ?? ""))}</div>`;
}
