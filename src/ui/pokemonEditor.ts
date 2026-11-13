import { isGen4Project, typeNamesForProject } from "../pokeweb/constants";
import { cascadeWhiteTrainerAbilityName, detectCascadeWhiteRom } from "../pokeweb/cascadeWhiteModel";
import { hasCascadePersonalData } from "../pokeweb/cascadeWhitePersonalModel";
import {
  BASE_STAT_FIELDS,
  EV_YIELD_FIELDS,
  MISC_INTEGER_FIELDS,
  PERSONAL_TEXT_FIELDS,
  learnsetMoveLimit,
  getPokemonAutofills,
  getPokemonCount,
  getPokemonRecord,
  getPokemonSummaryRecord,
  evolutionParamKind,
  clearAllPokemonEvYields,
  type EvolutionSlot,
  type EggMoveSlot,
  type LearnsetMove,
  type PokemonEditorRecord,
  type PokemonSummaryRecord,
  type TmCompatibilitySlot,
  type TutorCompatibilityGroup,
  type TutorCompatibilitySlot,
} from "../pokeweb/pokemonModel";
import {
  getPokemonFormDeletionAvailability,
  type AddPokemonFormResult,
  type DeletePokemonFormResult,
} from "../pokeweb/pokemonFormModel";
import { findPokemonPersonalFormOwner, pokemonPersonalDisplayIds, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import {
  getPokemonTextInfo,
  hasPokemonTextBanks,
  type PokemonTextInfo,
  type PokemonTextLine,
  type PokemonTextSection,
} from "../pokeweb/pokemonTextModel";
import { getPokemonCardFrontSpriteImage } from "../pokeweb/pokemonCardSpriteModel";
import type { RgbaImageData } from "../pokeweb/pokemonSpriteModel";
import type { ProjectState, ReadableRecord } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";
import { attachPokemonInteractions } from "./pokemonInteractions";
import { attachPokemonMegaSection, renderPokemonMegaSection } from "./pokemonMegaPanel";
import "../styles/moveData.css";
import "../styles/pokemonData.css";
import { observeNearViewport } from "./nearViewport";
import { pokemonSpriteSlug } from "../pokeweb/spriteSlug";
import { publicAsset } from "../assetUrl";
import { installPokemonCryPanel, renderPokemonCryPanel } from "./pokemonCryEditor";
import {
  getPokemonKoMoves,
  KO_MOVE_LEARNSET_MAX_MOVES,
  type KoMoveLearnsetEntry,
} from "../pokeweb/koMoveLearnsetModel";
import { isKoMoveEditorAvailable } from "../pokeweb/menuEvolutionModel";

const POKEMON_CARD_SPRITE_RENDER_VERSION = "personal-front-sprite-v2";
const pokemonCardSpriteInstallations = new WeakMap<HTMLElement, { disconnect: () => void }>();

type PokemonTab = "personal" | "learnset" | "tms" | "tutors" | "egg-moves" | "evos" | "names" | "cry";

/** Selected Pokemon and tab survive re-renders (route changes, form edits) per project. */
const pokemonDataSelection = new WeakMap<ProjectState, { speciesId: number; tab: PokemonTab }>();

const STAT_LABELS: Record<string, string> = {
  base_hp: "HP",
  base_atk: "Attack",
  base_def: "Defense",
  base_spatk: "Sp. Atk",
  base_spdef: "Sp. Def",
  base_speed: "Speed",
};

/** Header fields are marked in the header itself, so they do not count toward the Personal tab. */
const HEADER_FIELDS = /^personal:(type_|ability_|base_(hp|atk|def|spatk|spdef|speed)$)/u;

const TAB_EDIT_PREFIXES: Record<PokemonTab, RegExp> = {
  personal: /^personal:/u,
  learnset: /^(learnsets:|learnset-|ko)/u,
  tms: /^(compat:|tm-compat-copy)/u,
  tutors: /^tutor/u,
  "egg-moves": /^egg/u,
  evos: /^evolutions:/u,
  names: /^$^/u,
  cry: /^$^/u,
};

export function renderPokemonEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty?: () => void,
  onOpenSprites?: (speciesId: number) => void,
  onOpenPwan?: (speciesId: number) => void,
  onEnsureFormAssets?: () => Promise<void>,
): void {
  const ids = pokemonPersonalDisplayIds(project);
  const selection = pokemonDataSelection.get(project) ?? { speciesId: ids.includes(1) ? 1 : ids[0] ?? 0, tab: "personal" as PokemonTab };
  if (!ids.includes(selection.speciesId)) selection.speciesId = ids.includes(1) ? 1 : ids[0] ?? 0;
  pokemonDataSelection.set(project, selection);
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  root.innerHTML = `
    <div class="pokemon-data" id="pokemon-data">
      <aside class="md-list" aria-label="Pokemon">
        <div class="md-filters">
          <input class="md-search" id="search-text" type="search" placeholder="Search Pokémon, moves, abilities" autocomplete="off" spellcheck="false" aria-label="Search Pokemon">
          <div class="md-chips">
            ${renderPokemonFilter("Type", "type-filters", typeNamesForProject(project).map((type) => `<button class="type-plate -${typeClass(type)} md-type-toggle" data-ptype="${type.toLowerCase()}" type="button" aria-pressed="false">${escapeHtml(type)}</button>`).join(""))}
            ${renderPokemonFilter("Generation", "gen-filters", [1, 2, 3, 4, 5].map((gen) => `<button class="btn sm" data-gen="${gen}" type="button" aria-pressed="false">Gen ${gen}</button>`).join(""))}
          </div>
        </div>
        <div class="md-list-head" aria-hidden="true"><span>#</span><span></span><span>Name</span><span>Type</span></div>
        <div class="md-rows" id="pokemon-list" role="listbox" aria-label="Pokemon" tabindex="0">
          ${ids.map((id) => `<div class="md-row" data-pokemon-row="${id}" role="option" aria-selected="false">${renderPokemonListRowContent(project, id)}</div>`).join("")}
        </div>
      </aside>
      <section class="md-detail" id="pokemon-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#pokemon-list")!;
  const detail = root.querySelector<HTMLElement>("#pokemon-detail")!;
  const rerender = (speciesId: number) => {
    selection.speciesId = speciesId;
    renderPokemonEditor(project, root, onDirty, onOpenSprites, onOpenPwan, onEnsureFormAssets);
  };

  const interactions = attachPokemonInteractions(root, project, {
    onDirty,
    onOpenSprites,
    onOpenPwan,
    renderExpanded: (speciesId) => renderPokemonExpandedSections(project, speciesId),
    renderTextPanel: (speciesId) => renderPokemonTextPanel(getPokemonTextInfo(project, speciesId)),
    installCryPanel: (panel, speciesId) => installPokemonCryPanel(panel, project, speciesId, { onDirty }),
    autofills: getPokemonAutofills(project),
    onEnsureFormAssets,
    onFormAdded: (result: AddPokemonFormResult) => rerender(result.personalId),
    onFormDeleted: (result: DeletePokemonFormResult) => rerender(result.speciesId),
    onFiltered: () => {
      updatePokemonFilterCounts(root);
    },
    onBulkApplied: (speciesIds) => {
      speciesIds.forEach((id) => refreshPokemonListRow(project, root, id));
      refreshPokemonEditState(project, root, selection.speciesId);
    },
  });

  const showTab = (tab: PokemonTab) => {
    const card = detail.querySelector<HTMLElement>(".pokemon-card");
    if (!card) return;
    if (tab === "names" && !hasPokemonTextBanks(project)) tab = "personal";
    if (tab === "cry" && project.session.generation !== "gen5") tab = "personal";
    selection.tab = tab;
    const speciesId = Number(card.dataset.index);
    const panels = card.querySelector<HTMLElement>(".pd-panels")!;
    if (tab === "names" && !panels.querySelector(".expanded-pokemon-texts")) {
      panels.insertAdjacentHTML("beforeend", renderPokemonTextPanel(getPokemonTextInfo(project, speciesId)));
      interactions.installCard(card);
    }
    const panelClass = tab === "names" ? "expanded-pokemon-texts" : `expanded-${tab}`;
    const target = panels.querySelector<HTMLElement>(`:scope > .${panelClass}`);
    if (tab === "cry" && target && target.dataset.cryInstalled !== "true") {
      target.dataset.cryInstalled = "true";
      void installPokemonCryPanel(target, project, speciesId, { onDirty });
    }
    panels.querySelectorAll<HTMLElement>(":scope > .expanded-card-content").forEach((panel) => panel.classList.toggle("show-flex", panel === target));
    card.querySelectorAll<HTMLButtonElement>("[data-pokemon-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.pokemonTab === tab)));
  };

  const select = (speciesId: number, focusList = false) => {
    selection.speciesId = speciesId;
    detail.innerHTML = renderPokemonDetail(project, speciesId, Boolean(onOpenPwan));
    interactions.installCard(detail);
    installPokemonCardSpriteRendering(project, detail);
    list.querySelectorAll<HTMLElement>("[data-pokemon-row]").forEach((row) => {
      const active = Number(row.dataset.pokemonRow) === speciesId;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
      if (active && focusList) row.scrollIntoView({ block: "nearest" });
    });
    showTab(selection.tab);
    refreshPokemonEditState(project, root, speciesId);
  };

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-pokemon-row]");
    if (row) select(Number(row.dataset.pokemonRow));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-pokemon-row]")].filter((row) => row.style.display !== "none");
    const index = rows.findIndex((row) => Number(row.dataset.pokemonRow) === selection.speciesId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.pokemonRow), true);
  });
  detail.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-pokemon-tab]");
    if (tab) {
      showTab(tab.dataset.pokemonTab as PokemonTab);
      return;
    }
    if ((event.target as HTMLElement).closest("[data-clear-all-evs]")) {
      if (!window.confirm(`Remove EV yields from every Pokémon? This sets all six EV yields to 0 on all ${ids.length} Pokémon and forms.`)) return;
      const changed = clearAllPokemonEvYields(project);
      if (changed > 0) onDirty?.();
      select(selection.speciesId);
      const status = detail.querySelector<HTMLElement>("[data-clear-all-evs-status]");
      if (status) status.textContent = changed > 0 ? `Removed from ${changed} Pokémon` : "No Pokémon had EV yields";
      return;
    }
    window.setTimeout(() => refreshPokemonEditState(project, root, selection.speciesId), 0);
  });
  // Field commits happen on focusout/change; resync the list row, header and marks after them.
  const resync = () => window.setTimeout(() => refreshPokemonEditState(project, root, selection.speciesId), 0);
  attachPokemonMegaSection(detail, project, { onDirty, rerender, select: (speciesId) => select(speciesId, true), onEnsureFormAssets });
  detail.addEventListener("focusout", resync);
  detail.addEventListener("change", resync);
  root.querySelectorAll<HTMLDetailsElement>(".md-filter").forEach((filter) => {
    filter.addEventListener("toggle", () => {
      if (filter.open) root.querySelectorAll<HTMLDetailsElement>(".md-filter").forEach((other) => { if (other !== filter) other.open = false; });
    });
  });
  document.addEventListener("click", (event) => {
    if (!root.isConnected) return;
    root.querySelectorAll<HTMLDetailsElement>(".md-filter[open]").forEach((filter) => { if (!filter.contains(event.target as Node)) filter.open = false; });
  });

  select(selection.speciesId, true);
}

function renderPokemonFilter(label: string, groupClass: string, buttons: string): string {
  return `
    <details class="md-filter">
      <summary class="btn sm">${label}<span class="md-filter-count" data-filter-count></span></summary>
      <div class="md-filter-pop small-filters ${groupClass}" role="group" aria-label="${label}">${buttons}</div>
    </details>
  `;
}

function updatePokemonFilterCounts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".md-filter").forEach((filter) => {
    const count = filter.querySelectorAll('[aria-pressed="true"]').length;
    const label = filter.querySelector<HTMLElement>("[data-filter-count]");
    if (label) label.textContent = count ? String(count) : "";
    filter.classList.toggle("-active", count > 0);
  });
}

/** Changed fields for a species, as "<group>:<field>" suffixes of its changelog keys. */
function editedPokemonFields(project: ProjectState, speciesId: number): Set<string> {
  const prefix = `pokemon:${speciesId}:`;
  return new Set((project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(prefix)).map((entry) => entry.key.slice(prefix.length)));
}

function renderPokemonListRowContent(project: ProjectState, speciesId: number): string {
  const record = getPokemonSummaryRecord(project, speciesId);
  const name = pokemonSpeciesLabel(project, speciesId);
  const type1 = String(record.personal.type_1 ?? "");
  const type2 = String(record.personal.type_2 ?? "");
  const edits = editedPokemonFields(project, speciesId).size;
  return `
    <span class="md-row-id">${speciesId}</span>
    <img class="pd-row-icon" src="${publicAsset(`images/pokesprite/${pokemonSpriteSlug(name)}.png`)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <span class="md-row-name">${escapeHtml(name)}${edits ? `<span class="md-edits" title="${edits} change${edits === 1 ? "" : "s"}">${edits}</span>` : ""}</span>
    <span class="pd-row-types"><span class="type-plate sm -${typeClass(type1)}">${escapeHtml(type1)}</span>${type2 && type2 !== type1 ? `<span class="type-plate sm -${typeClass(type2)}">${escapeHtml(type2)}</span>` : ""}</span>
  `;
}

function refreshPokemonListRow(project: ProjectState, root: HTMLElement, speciesId: number): void {
  const row = root.querySelector<HTMLElement>(`[data-pokemon-row="${speciesId}"]`);
  if (row) row.innerHTML = renderPokemonListRowContent(project, speciesId);
}

function refreshPokemonEditState(project: ProjectState, root: HTMLElement, speciesId: number): void {
  refreshPokemonListRow(project, root, speciesId);
  const card = root.querySelector<HTMLElement>(`#pokemon-detail .pokemon-card[data-index="${speciesId}"]`);
  if (!card) return;
  const edited = editedPokemonFields(project, speciesId);
  const record = getPokemonSummaryRecord(project, speciesId);
  const title = card.querySelector<HTMLElement>(".pd-title h1");
  if (title) title.textContent = pokemonSpeciesLabel(project, speciesId);
  card.querySelectorAll<HTMLElement>("[data-mark-fields]").forEach((mark) => {
    const fields = (mark.dataset.markFields ?? "").split(" ");
    mark.classList.toggle("is-edited", fields.some((field) => edited.has(field)));
  });
  card.querySelectorAll<HTMLElement>("[data-tab-edits]").forEach((badge) => {
    const tab = badge.dataset.tabEdits as PokemonTab;
    const count = [...edited].filter((key) => TAB_EDIT_PREFIXES[tab]?.test(key) && !HEADER_FIELDS.test(key)).length;
    badge.textContent = count ? String(count) : "";
  });
  const total = BASE_STAT_FIELDS.reduce((sum, [, field]) => sum + (Number(record.personal[field]) || 0), 0);
  const totalCell = card.querySelector<HTMLElement>("[data-base-stat-total]");
  if (totalCell) totalCell.textContent = String(total);
  card.querySelectorAll<HTMLElement>(".pd-stats tr[data-stat]").forEach((row) => {
    const value = Number(record.personal[row.dataset.stat ?? ""]) || 0;
    const bar = row.querySelector<HTMLElement>(".pd-stat-bar > span");
    if (bar) {
      bar.style.width = `${Math.min(100, (value / 255) * 100)}%`;
      bar.style.background = statColor(value);
    }
  });
  card.querySelectorAll<HTMLElement>("[data-hint]").forEach((hint) => {
    hint.textContent = personalHint(hint.dataset.hint ?? "", Number(record.personal[hint.dataset.hint ?? ""]));
  });
  card.querySelectorAll<HTMLElement>("[data-compat-count]").forEach((label) => {
    const panel = label.closest<HTMLElement>(".expanded-card-content");
    const cells = panel ? [...panel.querySelectorAll<HTMLElement>(".cell[aria-pressed]")] : [];
    label.textContent = `${cells.filter((cell) => cell.getAttribute("aria-pressed") === "true").length} of ${cells.length} compatible`;
  });
}

function statColor(value: number): string {
  if (value < 50) return "#ff6b6b";
  if (value < 80) return "#f0a050";
  if (value < 100) return "#e8d050";
  if (value < 120) return "#9fd65a";
  return "#5ccf8f";
}

/** Plain-language meaning shown beside raw personal values. */
function personalHint(field: string, value: number): string {
  if (!Number.isFinite(value)) return "";
  if (field === "gender") {
    if (value === 255) return "Genderless";
    if (value === 0) return "Always male";
    if (value === 254) return "Always female";
    const female = ((value + 1) / 256) * 100;
    return `${Number((100 - female).toFixed(1))}% male`;
  }
  if (field === "hatch_cycle") return `≈ ${(value * 257).toLocaleString("en-US")} steps`;
  if (field === "height") return `${(value / 10).toFixed(1)} m`;
  if (field === "weight") return `${(value / 10).toFixed(1)} kg`;
  return "";
}

function renderPokemonDetail(project: ProjectState, speciesId: number, showPwan: boolean): string {
  const record = getPokemonSummaryRecord(project, speciesId);
  const pok = record.personal;
  const name = pokemonSpeciesLabel(project, speciesId);
  const type1 = String(pok.type_1 ?? "");
  const type2 = String(pok.type_2 ?? "");
  const cascade = renderCascadeAbilitySlots(project, speciesId);
  const tab = (key: PokemonTab, label: string) => `<button class="uv-tab" type="button" role="tab" data-pokemon-tab="${key}">${label}<span class="pd-tab-edits" data-tab-edits="${key}"></span></button>`;
  const ability = (field: string, label: string) => `<label class="pd-ability" data-mark-fields="personal:${field}"><span>${label}</span>${editable("personal", field, titleizeValue(pok[field]), "pokemon-card__ability", { autofill: "abilities" })}</label>`;
  return `
    <article class="pokemon-card filterable pd-card" data-index="${speciesId}">
      <header class="pd-head">
        <div class="pd-sprite pokemon-card__img">${renderPokemonCardSprite(project, speciesId, name)}</div>
        <div class="pd-ident">
          <div class="pd-title"><span class="pd-num">#${String(speciesId).padStart(3, "0")}</span><h1>${escapeHtml(name)}</h1></div>
          <div class="pd-types" data-mark-fields="personal:type_1 personal:type_2">
            ${editable("personal", "type_1", type1, `type-plate pokemon-type -${typeClass(type1)}`, { autofill: "types", label: "Type 1" })}
            ${editable("personal", "type_2", type2, `type-plate pokemon-type -${typeClass(type2)}`, { autofill: "types", label: "Type 2" })}
          </div>
          <div class="pd-abilities">
            ${ability("ability_1", "Ability 1")}
            ${ability("ability_2", "Ability 2")}
            ${ability("ability_3", "Hidden")}
          </div>
          ${cascade ? `<div class="pd-abilities pd-ai-abilities"><span class="pd-hint">AI abilities</span>${cascade}</div>` : ""}
        </div>
        <table class="pd-stats" aria-label="Base stats">
          <tbody>
            ${BASE_STAT_FIELDS.map(([, field]) => renderBaseStat(STAT_LABELS[field] ?? field, field, pok[field])).join("")}
            <tr class="pd-total"><td>Total</td><td data-base-stat-total></td><td></td></tr>
          </tbody>
        </table>
      </header>
      <div class="md-tabs pd-tabs" role="tablist" aria-label="Pokemon editor">
        ${tab("personal", "Personal")}
        ${tab("learnset", "Learnset")}
        ${tab("tms", "TMs")}
        ${tab("tutors", "Tutors")}
        ${tab("egg-moves", "Egg moves")}
        ${tab("evos", "Evolutions")}
        ${hasPokemonTextBanks(project) ? tab("names", "Names") : ""}
        ${project.session.generation === "gen5" ? tab("cry", "Cry") : ""}
        <button class="uv-tab sprite-editor-action" type="button" title="Open the sprite editor">Sprites</button>
        ${showPwan ? `<button class="uv-tab pwan-editor-action" type="button" title="Open the PWAN animation editor">Animation</button>` : ""}
      </div>
      <div class="md-panels pd-panels">${renderPokemonExpandedSections(project, speciesId)}</div>
    </article>
  `;
}

export function renderPokemonExpandedSections(project: ProjectState, speciesId: number): string {
  return renderExpanded(project, getPokemonRecord(project, speciesId));
}

function renderPokemonTextPanel(info: PokemonTextInfo | undefined): string {
  if (!info) {
    return `
      <div class="expanded-card-content expanded-pokemon-texts">
        <div class="pokemon-text-empty">Pokemon text banks are unavailable for this ROM.</div>
      </div>
    `;
  }
  const formNote =
    info.requestedPersonalId === info.speciesId
      ? ""
      : `<div class="pokemon-text-form-note">This form uses the base species name from Pokemon #${info.speciesId}.</div>`;
  const editableBankCount = info.sections.filter((section) => section.editable).length;
  return `
    <div class="expanded-card-content expanded-pokemon-texts" data-pokemon-text-panel="${info.speciesId}">
      <div class="pokemon-text-editor">
        <label class="pokemon-text-control">
          <span>Pokemon Name</span>
          <input class="pokemon-text-name-input" type="text" value="${escapeHtml(info.title)}" autocomplete="off" spellcheck="false">
        </label>
        <div class="pokemon-text-editor-copy">
          <strong>${info.sections.length} species name bank${info.sections.length === 1 ? "" : "s"}</strong>
          <span>Saving updates ${editableBankCount} English bank${editableBankCount === 1 ? "" : "s"}. Non-English entries are display-only.</span>
          ${formNote}
        </div>
        <div class="pokemon-text-status" aria-live="polite"></div>
      </div>
      <div class="pokemon-text-bank-list">
        ${info.sections.map(renderPokemonTextSection).join("")}
      </div>
    </div>
  `;
}

function renderPokemonTextSection(section: PokemonTextSection): string {
  const kind =
    section.role === "name"
      ? "primary species name"
      : section.role === "uppercase"
        ? "uppercase species name"
        : section.role === "grammar"
          ? "grammar species name"
          : "species name";
  const detail = `${section.language} ${kind}${section.editable ? "" : " · Display only"}`;
  return `
    <section class="pokemon-text-bank-section${section.editable ? "" : " -read-only"}" data-bank-id="${section.bankId}" data-role="${section.role}" data-editable="${section.editable}">
      <div class="pokemon-text-bank-header">
        <span>${escapeHtml(section.title)}</span>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${section.lines.map(renderPokemonTextLine).join("")}
    </section>
  `;
}

function renderPokemonTextLine(line: PokemonTextLine): string {
  return `
    <div class="pokemon-text-line" data-entry-index="${line.flatIndex}">
      <div class="pokemon-text-msg">MSG ${escapeHtml(line.entryLabel)}</div>
      <div class="pokemon-text-value">${escapeHtml(line.text)}</div>
    </div>
  `;
}

function renderPokemonCardSprite(project: ProjectState, speciesId: number, name: string): string {
  const fallbackSrc = publicAsset(`images/pokesprite/${pokemonSpriteSlug(name)}.png`);
  const fallback = `<img class="pokemon-card-fallback-sprite" src="${fallbackSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  const hasPwanFront = Boolean(project.pwanAnimations?.overrides.some((override) => override.front && (override.speciesId === speciesId || override.assetIndex === speciesId)));
  if (!hasPwanFront && !project.narcs.pokemon_sprites) return fallback;
  return `<canvas class="pokemon-card-rom-sprite" data-pokemon-species-id="${speciesId}" data-pokemon-sprite-version="${POKEMON_CARD_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>${fallback}`;
}

function installPokemonCardSpriteRendering(project: ProjectState, root: HTMLElement): void {
  pokemonCardSpriteInstallations.get(root)?.disconnect();
  if (!project.narcs.pokemon_sprites && !project.pwanAnimations?.overrides.some((override) => override.front)) return;

  const imageCache = new Map<number, Promise<RgbaImageData | undefined>>();
  const loadImage = (speciesId: number): Promise<RgbaImageData | undefined> => {
    let cached = imageCache.get(speciesId);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => getPokemonCardFrontSpriteImage(project, speciesId))
        .catch((error) => {
          console.warn(`Failed to render Pokemon sprite ${speciesId}`, error);
          return undefined;
        });
      imageCache.set(speciesId, cached);
      // Scrolling through the whole ROM should not retain every decoded sprite.
      if (imageCache.size > 32) imageCache.delete(imageCache.keys().next().value!);
    }
    return cached;
  };

  const renderCanvas = async (canvas: HTMLCanvasElement): Promise<void> => {
    if (
      (canvas.dataset.pokemonSpriteRendered === "true" && canvas.dataset.pokemonSpriteVersion === POKEMON_CARD_SPRITE_RENDER_VERSION) ||
      canvas.dataset.pokemonSpriteRendered === "loading"
    ) {
      return;
    }
    const speciesId = Number(canvas.dataset.pokemonSpeciesId);
    if (!Number.isInteger(speciesId)) return;
    canvas.dataset.pokemonSpriteVersion = POKEMON_CARD_SPRITE_RENDER_VERSION;
    canvas.dataset.pokemonSpriteRendered = "loading";
    const image = await loadImage(speciesId);
    if (!canvas.isConnected) return;
    if (!image) {
      canvas.hidden = true;
      canvas.dataset.pokemonSpriteRendered = "missing";
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = new Uint8ClampedArray(image.pixels.length);
    pixels.set(image.pixels);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    canvas.classList.add("-loaded");
    canvas.closest<HTMLElement>(".pokemon-card__img")?.classList.add("-rom-loaded");
    canvas.dataset.pokemonSpriteRendered = "true";
  };

  const disconnectImages = observeNearViewport(root, "canvas.pokemon-card-rom-sprite", (canvas) => {
    void renderCanvas(canvas as HTMLCanvasElement);
  });

  pokemonCardSpriteInstallations.set(root, {
    disconnect: () => {
      disconnectImages();
    },
  });
}

export function renderCascadeAbilitySlots(project: ProjectState, speciesId: number): string {
  if (!detectCascadeWhiteRom(project)) return "";
  const migrated = hasCascadePersonalData(project);
  return [4, 5, 6]
    .map((slot) => {
      const ability = titleizeValue(cascadeWhiteTrainerAbilityName(project, speciesId, slot) ?? "");
      if (migrated) return editable("personal", `ability_${slot}`, ability, "pokemon-card__ability", { autofill: "cascade_abilities", label: `AI Ability ${slot}` });
      return `<div class="pokemon-card__ability -readonly" title="Ability ${slot}" aria-label="Ability ${slot}">${escapeHtml(String(ability ?? ""))}</div>`;
    })
    .join("");
}

function renderExpanded(project: ProjectState, record: PokemonEditorRecord): string {
  const learnsetLimit = learnsetMoveLimit(project);
  const learnsetSpeciesMax = Math.max(1, (project.narcs.learnsets?.fileCount ?? 1) - 1);
  const personalSpeciesMax = Math.max(1, getPokemonCount(project) - 1);
  const canAddLearnsetMove = record.learnset.length < learnsetLimit;
  const koMovesAvailable = isKoMoveEditorAvailable(project);
  const koMoves = koMovesAvailable ? getPokemonKoMoves(project, record.id) : [];
  const addFormReady =
    !isGen4Project(project) &&
    Boolean(
      project.narcs.personal &&
        project.narcs.learnsets &&
        project.narcs.evolutions &&
        project.narcs.pokemon_sprites &&
        project.narcs.pokemon_icons &&
        project.narcs.message_texts,
    );
  const formOwner = findPokemonPersonalFormOwner(project, record.id);
  const deletion = formOwner ? getPokemonFormDeletionAvailability(project, record.id) : undefined;
  const deleteFormButton = deletion
    ? `<button class="btn sm -danger personal-delete-form${deletion.deletable ? "" : " invalid"}" data-delete-pokemon-form type="button" ${deletion.deletable ? "" : "disabled"} title="${escapeHtml(deletion.deletable ? "Delete this appended form and its data" : deletion.reason)}">Delete form</button>`
    : "";
  const tmsEnabled = record.tmCompatibility.filter((slot) => slot.enabled).length;
  const tutorSlots = record.tutorCompatibility.flatMap((group) => group.slots);
  return `
    <div class="expanded-card-content expanded-personal">
      ${renderPersonalPanel(record)}
      <section class="pd-forms">
        <div class="section-bar">Forms</div>
        <div class="pd-forms-body">
          <div class="md-form">
            ${personalRow(record, "form_id", "Form data offset")}
            ${personalRow(record, "form", "Form sprite offset")}
            ${personalRow(record, "num_forms", "Number of forms")}
          </div>
          <div class="pd-form-actions">
            <div class="personal-form-actions">
              <button class="btn sm personal-add-form" data-add-pokemon-form type="button" ${addFormReady ? "" : "disabled"} title="${addFormReady ? "Generate and append all files for a new form" : "Load Personal, Learnsets, Evolutions, Pokemon Sprites, Pokemon Icons, and Message Texts to add a form"}">Add form</button>
              ${deleteFormButton}
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="expanded-card-content expanded-learnset">
      <div class="learnset-panel">
        <div class="learnset-toolbar pd-toolbar">
          <div class="learnset-toolbar-actions">
            <button class="btn sm learnset-action" data-learnset-action="append" type="button" ${canAddLearnsetMove ? "" : "disabled"}>Add move</button>
            <span class="pd-copy">
              <input class="learnset-copy-source" type="number" inputmode="numeric" min="1" max="${learnsetSpeciesMax}" step="1" placeholder="Species ID" aria-label="Source species ID">
              <button class="btn sm learnset-action" data-learnset-action="copy" type="button">Copy from</button>
            </span>
          </div>
          <span class="learnset-count">${record.learnset.length} of ${learnsetLimit} moves</span>
        </div>
        ${renderMoveTable("Level", record.learnset.map((move) => renderLearnsetMove(move, canAddLearnsetMove)).join(""))}
      </div>
      ${koMovesAvailable ? renderKoMoves(koMoves, learnsetSpeciesMax) : ""}
    </div>
    <div class="expanded-card-content expanded-tms">
      ${renderCompatibilityCopyToolbar("tm", "TM/HM", personalSpeciesMax, `${tmsEnabled} of ${record.tmCompatibility.length} compatible`)}
      <div class="tm-compatibility-grid">
        ${record.tmCompatibility.map((slot) => renderTmCompatibility(slot)).join("")}
      </div>
    </div>
    <div class="expanded-card-content expanded-tutors">
      ${record.tutorCompatibility.length > 0 ? `${renderCompatibilityCopyToolbar("tutor", "Tutor", personalSpeciesMax, `${tutorSlots.filter((slot) => slot.enabled).length} of ${tutorSlots.length} compatible`)}${record.tutorCompatibility.map((group) => renderTutorGroup(group)).join("")}` : renderUnavailablePanel("BW2 tutor compatibility is not available for this ROM.")}
    </div>
    <div class="expanded-card-content expanded-egg-moves">
      ${record.eggMovesLoaded ? renderEggMoves(record.eggMoves) : renderUnavailablePanel("Egg move data was not loaded for this project. Reload with Pokemon data selected.")}
    </div>
    <div class="expanded-card-content expanded-evos">
      ${renderEvolutionTable(record.evolutions)}
      ${renderPokemonMegaSection(project, record.id)}
    </div>
    ${project.session.generation === "gen5" ? renderPokemonCryPanel(record.id) : ""}
  `;
}

const PERSONAL_INTEGER_MAX: Record<string, number> = Object.fromEntries(MISC_INTEGER_FIELDS.map(([, field, max]) => [field, max]));
const PERSONAL_TEXT_AUTOFILL: Record<string, string> = Object.fromEntries(PERSONAL_TEXT_FIELDS.map(([, field, autofill]) => [field, autofill]));

/** One label + value row of the personal form; skipped when this ROM's personal format lacks the field. */
function personalRow(record: PokemonEditorRecord, field: string, label: string): string {
  if (!(field in record.rawPersonal)) return "";
  const autofill = PERSONAL_TEXT_AUTOFILL[field];
  const value = autofill
    ? editable("personal", field, record.personal[field], "pd-field", { autofill })
    : editable("personal", field, record.personal[field], "pd-field", { type: `int-${PERSONAL_INTEGER_MAX[field] ?? 255}` });
  const hint = ["gender", "hatch_cycle", "height", "weight"].includes(field) ? `<span class="md-unit" data-hint="${field}"></span>` : "";
  return `<span class="md-label" data-mark-fields="personal:${field}">${label}</span><div class="md-value">${value}${hint}</div>`;
}

function renderPersonalPanel(record: PokemonEditorRecord): string {
  const evFields = EV_YIELD_FIELDS.filter(([, field]) => field in record.rawPersonal);
  return `
    <div class="md-grid">
      <section>
        <div class="section-bar">Training</div>
        <div class="md-form">
          ${personalRow(record, "catchrate", "Catch rate")}
          ${personalRow(record, "base_exp", "Exp yield")}
          ${personalRow(record, "base_happy", "Base happiness")}
          ${personalRow(record, "exp_rate", "Growth rate")}
          ${personalRow(record, "hidden_ability_chance", "Hidden ability chance")}
        </div>
      </section>
      <section>
        <div class="section-bar">Breeding</div>
        <div class="md-form">
          ${personalRow(record, "gender", "Gender")}
          ${personalRow(record, "hatch_cycle", "Egg cycles")}
          ${personalRow(record, "egg_group_1", "Egg group 1")}
          ${personalRow(record, "egg_group_2", "Egg group 2")}
        </div>
      </section>
      <section>
        <div class="section-bar">Wild held items</div>
        <div class="md-form">
          ${personalRow(record, "item_1", "50%")}
          ${personalRow(record, "item_2", "5%")}
          ${personalRow(record, "item_3", "1%")}
        </div>
        <div class="section-bar md-gap">Size</div>
        <div class="md-form">
          ${personalRow(record, "height", "Height")}
          ${personalRow(record, "weight", "Weight")}
        </div>
      </section>
    </div>
    ${evFields.length ? `
      <section class="pd-evs">
        <div class="pd-section-head">
          <div class="section-bar">EV yield</div>
          <span class="learnset-count" data-clear-all-evs-status role="status"></span>
          <button class="btn sm -danger" type="button" data-clear-all-evs title="Set all six EV yields to 0 on every Pokémon and form">Remove from all Pokémon</button>
        </div>
        <table class="md-table pd-ev-table">
          <thead><tr>${evFields.map(([label]) => `<th class="r">${escapeHtml(label)}</th>`).join("")}</tr></thead>
          <tbody><tr>${evFields.map(([label, field]) => `<td class="r" data-mark-fields="personal:${field}">${editable("personal", field, record.personal[field], "pd-field ev-field", { type: "int-3", label: `${label} EV yield` })}</td>`).join("")}</tr></tbody>
        </table>
      </section>` : ""}
  `;
}

function renderMoveTable(firstColumn: string, rows: string, extraClass = ""): string {
  return `
    <div class="pd-move-table ${extraClass}">
      <div class="pd-move-head" aria-hidden="true">
        ${firstColumn ? `<span class="r">${firstColumn}</span>` : ""}<span>Move</span><span>Type</span><span>Category</span><span class="r">Power</span><span class="r">Acc.</span><span></span>
      </div>
      ${rows || `<div class="pd-empty">No moves yet.</div>`}
    </div>
  `;
}

function renderEvolutionTable(slots: EvolutionSlot[]): string {
  const paramLabels: Record<string, string> = { none: "", level: "Level", integer: "Value", item: "Item", move: "Move", pokemon: "Pokémon", ability: "Ability" };
  return `
    <div class="pd-evo-table">
      <div class="pd-evo-head" aria-hidden="true"><span>#</span><span>Method</span><span>Parameter</span><span>Evolves into</span><span class="r">ID</span></div>
      ${slots.map((slot) => {
        const paramOptions = slot.paramAutofill ? { autofill: slot.paramAutofill } : { type: "int-65535" };
        const kind = paramLabels[evolutionParamKind(slot.method)] ?? "";
        return `
          <div class="pd-evo-row${slot.methodId === 0 ? " -empty" : ""}" data-mark-fields="evolutions:method_${slot.index} evolutions:param_${slot.index} evolutions:target_${slot.index}">
            <span class="pd-evo-n">${slot.index + 1}</span>
            <div class="pd-evo-cell">${editable("evolution", `method_${slot.index}`, slot.method, "evo-value", { autofill: "evo_methods", label: `Evolution ${slot.index + 1} method` })}</div>
            <div class="pd-evo-cell pd-evo-param">${editable("evolution", `param_${slot.index}`, slot.param, "evo-value", { ...paramOptions, label: `Evolution ${slot.index + 1} ${kind || "parameter"}` })}${kind ? `<span class="md-unit">${kind}</span>` : ""}</div>
            <div class="pd-evo-cell">${editable("evolution", `target_${slot.index}`, slot.target, "evo-value", { autofill: "evolution_targets", label: `Evolution ${slot.index + 1} target name or species ID` })}</div>
            <div class="pd-evo-cell r">${editable("evolution", `target_${slot.index}`, slot.targetId, "evolution-target-id-input", { type: "int-65535", label: `Evolution ${slot.index + 1} target species ID` })}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCompatibilityCopyToolbar(kind: "tm" | "tutor", label: string, speciesMax: number, count: string): string {
  return `
    <div class="compatibility-copy-toolbar pd-toolbar">
      <div class="compatibility-copy-actions">
        <input class="learnset-copy-source compatibility-copy-source" type="number" inputmode="numeric" min="1" max="${speciesMax}" step="1" placeholder="Species ID" aria-label="${label} compatibility source species ID">
        <button class="btn sm compatibility-copy-action" data-compatibility-copy="${kind}" type="button">Copy from</button>
        <span class="learnset-count" data-compat-count>${count}</span>
      </div>
      ${kind === "tm" ? renderTmSortControls() : ""}
    </div>
  `;
}

function renderTmSortControls(): string {
  return `
    <div class="tm-compatibility-sort">
      <span class="tm-compatibility-sort__label">Sort by</span>
      <select data-tm-sort aria-label="Sort TM compatibility options">
        <option value="number">TM number</option>
        <option value="type">Move type</option>
        <option value="category">Move category</option>
        <option value="power">Base power</option>
      </select>
      <button class="tm-compatibility-sort__direction" data-tm-sort-direction data-direction="asc" type="button" aria-label="Sort ascending" title="Sort ascending">&uarr;</button>
    </div>
  `;
}

function renderBaseStat(label: string, field: string, value: unknown): string {
  const numeric = Number(value) || 0;
  return `
    <tr data-stat="${field}" data-mark-fields="personal:${field}">
      <th scope="row">${label}</th>
      <td data-narc="personal" data-type="int-255" data-field-name="${field}" contenteditable="true">${numeric}</td>
      <td><div class="pd-stat-bar"><span class="pokemon-card__graph" style="width: ${Math.min(100, (numeric / 255) * 100)}%; background: ${statColor(numeric)}"></span></div></td>
    </tr>
  `;
}

function renderLearnsetMove(move: LearnsetMove, canInsert: boolean): string {
  return `
    <div class="expanded-field multi learnset-row pd-move-row" data-learnset-index="${move.index}" data-mark-fields="learnsets:lvl_learned_${move.index} learnsets:move_id_${move.index}">
      <div data-require="move-name" data-narc="learnset" data-field-name="lvl_learned_${move.index}" data-type="int-100" class="move-level" contenteditable="true">${move.level}</div>
      ${editable("learnset", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names", require: "move-level" })}
      <div class="move-type"><span class="type-plate sm -${typeClass(move.type)}">${escapeHtml(String(move.type))}</span></div>
      <div class="move-cat">${escapeHtml(titleize(String(move.category)))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
      <div class="learnset-row-actions">
        <button class="learnset-icon-button" data-learnset-action="insert" data-learnset-index="${move.index + 1}" title="Insert move below" type="button" ${canInsert ? "" : "disabled"}>+</button>
        <button class="learnset-icon-button -danger" data-learnset-action="delete" data-learnset-index="${move.index}" title="Delete move" type="button">×</button>
      </div>
    </div>
  `;
}

function renderKoMoves(moves: KoMoveLearnsetEntry[], speciesMax: number): string {
  const canInsert = moves.length < KO_MOVE_LEARNSET_MAX_MOVES;
  return `
    <div class="learnset-panel ko-move-panel">
      <div class="section-bar md-gap">KO moves</div>
      <div class="learnset-toolbar pd-toolbar">
        <div class="learnset-toolbar-actions">
          <button class="btn sm" data-ko-learnset-action="append" type="button" ${canInsert ? "" : "disabled"}>Add move</button>
          <span class="pd-copy">
            <input class="learnset-copy-source ko-learnset-copy-source" type="number" inputmode="numeric" min="1" max="${speciesMax}" step="1" placeholder="Species ID" aria-label="KO learnset source species ID">
            <button class="btn sm" data-ko-learnset-action="copy" type="button">Copy from</button>
          </span>
        </div>
        <span class="learnset-count">${moves.length} of ${KO_MOVE_LEARNSET_MAX_MOVES} moves</span>
      </div>
      ${renderMoveTable("KOs", moves.map((move) => renderKoMove(move, canInsert)).join(""))}
    </div>
  `;
}

function renderKoMove(move: KoMoveLearnsetEntry, canInsert: boolean): string {
  return `
    <div class="expanded-field multi learnset-row ko-move-row pd-move-row" data-ko-learnset-index="${move.index}">
      <div data-require="move-name" data-narc="ko_learnset" data-field-name="ko_count_${move.index}" data-type="int-65535" class="move-level" contenteditable="true" title="Required KO count">${move.koCount}</div>
      ${editable("ko_learnset", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names", require: "move-level" })}
      <div class="move-type"><span class="type-plate sm -${typeClass(move.type)}">${escapeHtml(String(move.type))}</span></div>
      <div class="move-cat">${escapeHtml(titleize(String(move.category)))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
      <div class="learnset-row-actions">
        <button class="learnset-icon-button" data-ko-learnset-action="insert" data-ko-learnset-index="${move.index + 1}" title="Insert KO move below" type="button" ${canInsert ? "" : "disabled"}>+</button>
        <button class="learnset-icon-button -danger" data-ko-learnset-action="delete" data-ko-learnset-index="${move.index}" title="Delete KO move" type="button">×</button>
      </div>
    </div>
  `;
}

function renderTmCompatibility(slot: TmCompatibilitySlot): string {
  const moveType = slot.moveType || "Unknown";
  const moveCategory = slot.moveCategory || "Unknown";
  const numericPower = Number(slot.basePower);
  const basePower = Number.isFinite(numericPower) ? numericPower : 0;
  const stateLabel = slot.enabled ? "Compatible" : "Not compatible";
  return `
    <button
      class="cell tm tm-compatibility-option -${typeClass(moveType)} ${slot.enabled ? "-active" : ""}"
      data-field-name="tms"
      data-narc="personal"
      data-kind="${slot.kind}"
      data-index="${slot.index}"
      data-move-type="${escapeHtml(moveType)}"
      data-move-category="${escapeHtml(moveCategory)}"
      data-base-power="${basePower}"
      type="button"
      aria-pressed="${slot.enabled}"
      aria-label="${escapeHtml(`${slot.label} ${slot.moveName}, ${moveType} type, ${moveCategory}, ${basePower} base power. ${stateLabel}`)}"
      title="${escapeHtml(`${moveType} · ${moveCategory} · ${basePower} power · ${stateLabel}`)}"
    >
      <span class="tm-compatibility-option__machine">${escapeHtml(slot.label)}</span>
      <span class="tm-compatibility-option__move">${escapeHtml(slot.moveName)}</span>
      <span class="tm-compatibility-option__check" aria-hidden="true"></span>
    </button>
  `;
}

function renderTutorGroup(group: TutorCompatibilityGroup): string {
  return `
    <section class="tutor-group">
      <h3>${escapeHtml(group.label)}</h3>
      <div class="tutor-grid">
        ${group.slots.map((slot) => renderTutorCompatibility(slot)).join("")}
      </div>
    </section>
  `;
}

function renderTutorCompatibility(slot: TutorCompatibilitySlot): string {
  const moveType = slot.moveType || "Unknown";
  const stateLabel = slot.enabled ? "Compatible" : "Not compatible";
  return `
    <button
      class="cell tutor tm-compatibility-option -${typeClass(moveType)} ${slot.enabled ? "-active" : ""}"
      data-field-name="tutors"
      data-narc="personal"
      data-tutor-field="${slot.field}"
      data-index="${slot.index}"
      type="button"
      aria-pressed="${slot.enabled}"
      aria-label="${escapeHtml(`${slot.label} ${slot.moveName}, ${moveType} type. ${stateLabel}`)}"
      title="${escapeHtml(`${moveType} type · ${stateLabel}`)}"
    >
      <span class="tm-compatibility-option__machine">${escapeHtml(slot.label)}</span>
      <span class="tm-compatibility-option__move">${escapeHtml(slot.moveName)}</span>
      <span class="tm-compatibility-option__check" aria-hidden="true"></span>
    </button>
  `;
}

function renderEggMoves(moves: EggMoveSlot[]): string {
  const canInsert = true;
  return `
    <div class="learnset-panel egg-move-panel">
      <div class="learnset-toolbar pd-toolbar">
        <div class="learnset-toolbar-actions">
          <button class="btn sm egg-move-action" data-egg-move-action="append" type="button">Add move</button>
        </div>
        <span class="learnset-count">${moves.length} egg move${moves.length === 1 ? "" : "s"}</span>
      </div>
      ${renderMoveTable("", moves.map((move) => renderEggMove(move, canInsert)).join(""), "-no-first")}
    </div>
  `;
}

function renderEggMove(move: EggMoveSlot, canInsert: boolean): string {
  return `
    <div class="expanded-field multi egg-move-row pd-move-row -no-first" data-egg-move-index="${move.index}" data-mark-fields="egg:${move.index}">
      ${editable("egg_moves", `move_id_${move.index}`, move.moveName, "move-name", { autofill: "move_names" })}
      <div class="move-type"><span class="type-plate sm -${typeClass(move.type)}">${escapeHtml(String(move.type))}</span></div>
      <div class="move-cat">${escapeHtml(titleize(String(move.category)))}</div>
      <div class="move-power">${escapeHtml(String(move.power))}</div>
      <div class="move-accuracy">${escapeHtml(String(move.accuracy))}</div>
      <div class="learnset-row-actions">
        <button class="learnset-icon-button" data-egg-move-action="insert" data-egg-move-index="${move.index + 1}" title="Insert move below" type="button" ${canInsert ? "" : "disabled"}>+</button>
        <button class="learnset-icon-button -danger" data-egg-move-action="delete" data-egg-move-index="${move.index}" title="Delete move" type="button">×</button>
      </div>
    </div>
  `;
}

function renderUnavailablePanel(message: string): string {
  return `<div class="expanded-empty">${escapeHtml(message)}</div>`;
}

function editable(
  narc: "personal" | "learnset" | "evolution" | "egg_moves" | "ko_learnset",
  field: string,
  value: unknown,
  className: string,
  options: { autofill?: string; type?: string; require?: string; label?: string } = {},
): string {
  const autofill = options.autofill ? ` data-autocomplete-spy data-autofill="${options.autofill}"` : "";
  const type = options.type ? ` data-type="${options.type}"` : "";
  const require = options.require ? ` data-require="${options.require}"` : "";
  const label = options.label ? ` aria-label="${escapeHtml(options.label)}" title="${escapeHtml(options.label)}"` : "";
  return `<div autocorrect="off" data-narc="${narc}" data-field-name="${field}" class="${className}" contenteditable="true"${autofill}${type}${require}${label}>${escapeHtml(String(value ?? ""))}</div>`;
}

function typeClass(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
}

function titleize(value: string): string {
  return value
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function titleizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return titleize(value);
}
