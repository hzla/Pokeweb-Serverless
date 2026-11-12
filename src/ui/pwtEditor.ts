import { publicAsset } from "../assetUrl";
import {
  evStatLabels,
  getFacilityAutofills,
  getFacilitySetRecord,
  updateFacilitySetField,
  type BattleFacilitySet,
  type FacilitySetNarcName,
} from "../pokeweb/battleFacilityModel";
import { NATURES } from "../pokeweb/constants";
import { spriteSlugForOverworldSprite } from "../pokeweb/overworldModel";
import { getMovePreview } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  addPwtSet,
  battleClassForObjCode,
  copyPwtSetForTrainer,
  createPwtTeam,
  ensurePwtArchives,
  getPwtSetUsers,
  getPwtTeam,
  getPwtTrainer,
  getPwtTrainers,
  getTournamentTrainers,
  isBackgroundEntrant,
  poolsForTrainer,
  pwtTournament,
  PWT_POOLS,
  PWT_POOL_ORDER,
  PWT_RENTAL_SETS,
  PWT_STYLES,
  PWT_TOURNAMENTS,
  PWT_TYPE_NAMES,
  setPwtTeamLead,
  setPwtTeamSets,
  TYPE_ANY,
  TYPE_NONE,
  updatePwtTrainerField,
  usesPlayerBattleClass,
  type PwtPoolId,
  type PwtTeam,
  type PwtTournament,
  type PwtTrainer,
  type PwtTrainerField,
} from "../pokeweb/pwtModel";
import { trainerTypeName } from "../pokeweb/battleFacilityModel";
import { focusFacilityRecord } from "./battleFacilityEditor";
import { escapeHtml, selectText } from "./dom";
import { TRAINER_SPRITE_RENDER_VERSION } from "./trainerDetail";
import { installTrainerSpriteRendering } from "./trainerEditor";
import { installPicker } from "./trainerInteractions";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/pwtData.css";

/**
 * World Tournament editor: tournaments on the left (grouped by the two reception counters), each opening a
 * bracket of trainer cards; a trainer opens its teams, one per pool, edited set by set.
 *
 * Views (also the URL after #pwt/): t<id> tournament, t2-<type> one Type Expert type, tr<index> trainer,
 * all, unused, rental.
 */

export type PwtEditorOptions = {
  view?: string;
  onDirty?: () => void;
  /** The page changed views; push adds a history entry (so Back returns), otherwise replace it. */
  onNavigate?: (view: string, push: boolean) => void;
};

type PageState = {
  search: string;
  /** The tournament a trainer was opened from, for the back link and the default team tab. */
  from?: string;
  pool: Partial<Record<number, PwtPoolId>>;
  rentalSearch: string;
};

const pageStates = new WeakMap<ProjectState, PageState>();
const DEFAULT_VIEW = "t5";

export async function renderPwtEditor(project: ProjectState, root: HTMLElement, options: PwtEditorOptions = {}): Promise<void> {
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";
  try {
    if (!project.narcs.pwt_trainer_table || !project.narcs.pwt_regular_rosters) root.innerHTML = `<p class="td-empty pwt-loading">Loading World Tournament data…</p>`;
    await ensurePwtArchives(project);
  } catch (error) {
    root.innerHTML = `<p class="td-empty fd-invalid pwt-loading">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    return;
  }
  const state = pageStates.get(project) ?? { search: "", pool: {}, rentalSearch: "" };
  pageStates.set(project, state);
  let view = isValidView(project, options.view) ? options.view! : DEFAULT_VIEW;

  root.innerHTML = `
    <div class="facility-data pwt-data" id="facility-data">
      <aside class="md-list" aria-label="World Tournament">
        <div class="md-filters">
          <input class="md-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search trainers or Pokémon" autocomplete="off" spellcheck="false" aria-label="Search trainers or Pokémon">
        </div>
        <div class="md-rows" role="listbox" aria-label="Tournaments" tabindex="0"></div>
        <div class="md-list-foot pwt-foot"><span data-pwt-count></span><a href="#facilities/raw" title="The underlying lead, roster and set archives">Raw files</a></div>
      </aside>
      <section class="md-detail pwt-detail" aria-live="polite"></section>
    </div>
  `;
  const list = root.querySelector<HTMLElement>(".md-rows")!;
  const detail = root.querySelector<HTMLElement>(".pwt-detail")!;
  const search = root.querySelector<HTMLInputElement>(".md-search")!;
  const count = root.querySelector<HTMLElement>("[data-pwt-count]")!;
  const autofills = getFacilityAutofills(project) as unknown as Record<string, string[]>;

  const renderList = () => {
    const query = state.search.trim().toLowerCase();
    if (query) {
      const matches = searchTrainers(project, query);
      list.innerHTML = matches.length
        ? matches.map((trainer) => trainerRow(trainer, view === `tr${trainer.index}`)).join("")
        : `<p class="td-empty pwt-empty">No trainer or Pokémon matches “${escapeHtml(state.search)}”.</p>`;
      count.textContent = `${matches.length} trainer${matches.length === 1 ? "" : "s"}`;
    } else {
      list.innerHTML = renderTournamentList(project, view);
      count.textContent = "";
    }
    installTrainerSpriteRendering(project, list);
  };

  const show = (next: string, push: boolean) => {
    if (!isValidView(project, next)) return;
    if (next.startsWith("t") && !next.startsWith("tr")) state.from = next;
    else if (next === "all" || next === "unused") state.from = next;
    view = next;
    renderDetail();
    list.querySelectorAll<HTMLElement>("[data-view]").forEach((row) => {
      const active = row.dataset.view === view || (view.startsWith("t2-") && row.dataset.view === "t2");
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
    });
    options.onNavigate?.(view, push);
  };

  const renderDetail = () => {
    const scroll = detail.scrollTop;
    try {
      detail.innerHTML = renderView(project, state, view);
    } catch (error) {
      detail.innerHTML = `<p class="td-empty fd-invalid">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
    installFields(detail);
    installTrainerSpriteRendering(project, detail);
    detail.scrollTop = view.startsWith("tr") ? scroll : 0;
  };

  const changed = (opts: { list?: boolean } = {}) => {
    options.onDirty?.();
    if (opts.list) renderList();
  };

  // ----- Field editing (sets and trainer rows) -----
  const installFields = (scope: HTMLElement) => {
    scope.querySelectorAll<HTMLElement>("[contenteditable='true'][data-edit]").forEach((field) => {
      let initial = field.textContent?.trim() ?? "";
      const picker = field.dataset.autofill ? installPicker(field, autofills[field.dataset.autofill] ?? []) : undefined;
      field.addEventListener("focus", () => {
        initial = field.textContent?.trim() ?? "";
        window.setTimeout(() => {
          if (document.activeElement === field) selectText(field);
        }, 0);
        picker?.open();
      });
      field.addEventListener("input", () => {
        field.classList.remove("invalid");
        delete field.dataset.commitValue;
        delete field.dataset.commitLabel;
      });
      field.addEventListener("keydown", (event) => {
        if (picker?.handleKey(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          field.blur();
        } else if (event.key === "Escape") {
          field.textContent = initial;
          field.blur();
        }
      });
      field.addEventListener("blur", () => {
        picker?.close();
        let value = field.textContent?.trim() ?? "";
        if (field.dataset.commitValue !== undefined && field.dataset.commitLabel === value) value = field.dataset.commitValue;
        else if (value === initial) return;
        if (commitField(field, value)) initial = field.textContent?.trim() ?? "";
        else field.textContent = initial;
      });
    });
  };

  const commitField = (field: HTMLElement, value: string | boolean): boolean => {
    try {
      const card = field.closest<HTMLElement>("[data-set-card]");
      if (field.dataset.edit === "set" && card) {
        updateFacilitySetField(project, card.dataset.narc as FacilitySetNarcName, Number(card.dataset.setId), field.dataset.field!, value);
        field.classList.remove("invalid");
        field.removeAttribute("title");
        changed();
        refreshCardLater(card);
        return true;
      }
      if (field.dataset.edit === "trainer") {
        const index = Number(field.dataset.trainer);
        updatePwtTrainerField(project, index, field.dataset.field as PwtTrainerField, value);
        changed({ list: true });
        window.setTimeout(renderDetail, 0);
        return true;
      }
    } catch (error) {
      field.classList.add("invalid");
      field.title = error instanceof Error ? error.message : String(error);
    }
    return false;
  };

  /** Re-render a set card once focus has left it, so tabbing between its fields keeps working. */
  const refreshCardLater = (card: HTMLElement) => {
    window.setTimeout(() => {
      if (!card.isConnected) return;
      if (card.contains(document.activeElement)) {
        card.addEventListener("focusout", () => refreshCardLater(card), { once: true });
        return;
      }
      const template = document.createElement("template");
      template.innerHTML = renderSetCard(project, card.dataset.narc as FacilitySetNarcName, Number(card.dataset.setId), cardContext(card)).trim();
      const next = template.content.firstElementChild as HTMLElement;
      card.replaceWith(next);
      installFields(next);
    }, 0);
  };

  // ----- Actions -----
  const act = (action: () => void, opts: { list?: boolean } = {}) => {
    try {
      action();
      changed(opts);
      renderDetail();
    } catch (error) {
      const status = detail.querySelector<HTMLElement>("[data-pwt-status]");
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.hidden = false;
      }
    }
  };

  detail.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    // "Edit rules" goes to the raw editor's regulations; the link itself does the navigating.
    const regulation = target.closest<HTMLElement>("[data-regulation]");
    if (regulation) focusFacilityRecord("subwayPwt", "regulations", Number(regulation.dataset.regulation));
    const open = target.closest<HTMLElement>("[data-open]");
    if (open) {
      event.preventDefault();
      show(open.dataset.open!, true);
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (!button || button.disabled) return;
    const trainerIndex = Number(button.dataset.trainer);
    const pool = button.dataset.pool as PwtPoolId;
    const setId = Number(button.dataset.setId);
    switch (button.dataset.action) {
      case "pool-tab":
        state.pool[trainerIndex] = pool;
        renderDetail();
        break;
      case "tournament": {
        const on = button.getAttribute("aria-pressed") !== "true";
        act(() => updatePwtTrainerField(project, trainerIndex, `tournament_${Number(button.dataset.tournament)}`, on), { list: true });
        break;
      }
      case "set-class":
        act(() => updatePwtTrainerField(project, trainerIndex, "trainerClass", Number(button.dataset.class)), { list: true });
        break;
      case "copy-set":
        act(() => copyPwtSetForTrainer(project, pool, trainerIndex, setId));
        break;
      case "make-lead":
        act(() => setPwtTeamLead(project, pool, trainerIndex, setId));
        break;
      case "remove-set": {
        const team = getPwtTeam(project, pool, trainerIndex);
        const index = team.setIds.indexOf(setId);
        if (index < 0) break;
        act(() => setPwtTeamSets(project, pool, trainerIndex, team.setIds.filter((_id, at) => at !== index)), { list: true });
        break;
      }
      case "create-team":
        act(() => createPwtTeam(project, pool, trainerIndex, (button.dataset.copyFrom || undefined) as PwtPoolId | undefined), { list: true });
        break;
      case "add-blank": {
        act(() => {
          const id = addPwtSet(project, pool);
          setPwtTeamSets(project, pool, trainerIndex, [...getPwtTeam(project, pool, trainerIndex).setIds, id]);
        }, { list: true });
        break;
      }
    }
  });
  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement && target.dataset.trainerSelect) {
      act(() => updatePwtTrainerField(project, Number(target.dataset.trainer), target.dataset.trainerSelect as PwtTrainerField, Number(target.value)), { list: true });
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.trainerCheck) {
      act(() => updatePwtTrainerField(project, Number(target.dataset.trainer), target.dataset.trainerCheck as PwtTrainerField, target.checked));
      return;
    }
    const card = target.closest<HTMLElement>("[data-set-card]");
    if (!card) return;
    const field = (target as HTMLInputElement | HTMLSelectElement).dataset.field;
    if (!field) return;
    try {
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : (target as HTMLSelectElement).value;
      updateFacilitySetField(project, card.dataset.narc as FacilitySetNarcName, Number(card.dataset.setId), field, value);
      changed();
      refreshCardLater(card);
    } catch (error) {
      target.classList.add("invalid");
      target.title = error instanceof Error ? error.message : String(error);
    }
  });
  // "Add Pokémon": pick one of the pool's sets for this team.
  detail.addEventListener("focusin", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-add-set]");
    if (!field || field.dataset.installed) return;
    field.dataset.installed = "true";
    const pool = field.dataset.pool as PwtPoolId;
    const trainerIndex = Number(field.dataset.trainer);
    const values = poolSetOptions(project, pool);
    const picker = installPicker(field, values);
    picker?.open();
    field.addEventListener("keydown", (keyEvent) => {
      if (picker?.handleKey(keyEvent)) return;
      if (keyEvent.key === "Enter" || keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        if (keyEvent.key === "Escape") field.textContent = "";
        field.blur();
      }
    });
    field.addEventListener("blur", () => {
      picker?.close();
      const chosen = field.dataset.commitValue ?? field.textContent ?? "";
      const id = /\((\d+)\)$/u.exec(chosen.trim())?.[1] ?? /^#?(\d+)$/u.exec(chosen.trim())?.[1];
      field.textContent = "";
      if (id === undefined) return;
      act(() => setPwtTeamSets(project, pool, trainerIndex, [...getPwtTeam(project, pool, trainerIndex).setIds, Number(id)]), { list: true });
    });
    window.setTimeout(() => picker?.open(), 0);
  });
  detail.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-rental-search]")) {
      state.rentalSearch = input.value;
      const grid = detail.querySelector<HTMLElement>("[data-rental-grid]");
      if (grid) {
        grid.innerHTML = renderRentalCards(project, state.rentalSearch);
        installFields(grid);
      }
    }
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (row && !row.classList.contains("is-disabled")) show(row.dataset.view!, false);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-view]:not(.is-disabled)")];
    const index = rows.findIndex((row) => row.classList.contains("is-selected"));
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      show(next.dataset.view!, false);
      next.scrollIntoView({ block: "nearest" });
    }
  });
  let searchTimer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = search.value;
      renderList();
    }, 150);
  });

  renderList();
  show(view, false);
}

// ---------- Views ----------

function isValidView(project: ProjectState, view: string | undefined): boolean {
  if (!view) return false;
  if (view === "all" || view === "unused" || view === "rental") return true;
  const type = /^t2-(\d+)$/u.exec(view);
  if (type) return Number(type[1]) < PWT_TYPE_NAMES.length;
  const tournament = /^t(\d+)$/u.exec(view);
  if (tournament) return Boolean(pwtTournament(Number(tournament[1])));
  const trainer = /^tr(\d+)$/u.exec(view);
  if (trainer) {
    try {
      getPwtTrainer(project, Number(trainer[1]));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function renderView(project: ProjectState, state: PageState, view: string): string {
  if (view === "rental") return renderRental(project, state);
  if (view === "all") return renderTrainerGroup(project, "All trainers", "Every row of the PWT trainer table.", getPwtTrainers(project), view);
  if (view === "unused") {
    return renderTrainerGroup(project, "Not in any tournament", "Rows no tournament takes. Turn on a tournament on a trainer's page to use one.", getPwtTrainers(project).filter((trainer) => trainer.tournaments.length === 0), view);
  }
  const type = /^t2-(\d+)$/u.exec(view);
  if (type) return renderTournament(project, pwtTournament(2)!, Number(type[1]));
  const tournament = /^t(\d+)$/u.exec(view);
  if (tournament) return renderTournament(project, pwtTournament(Number(tournament[1]))!);
  return renderTrainer(project, state, Number(view.slice(2)));
}

function renderTournamentList(project: ProjectState, view: string): string {
  const trainers = getPwtTrainers(project);
  const row = (tournament: PwtTournament) => {
    const viewId = `t${tournament.id}`;
    const download = tournament.membership === "download";
    const members = download ? 0 : tournament.id === 1 ? Math.min(7, trainers.filter((trainer) => trainer.exclusive === 1).length) : trainers.filter((trainer) => trainer.tournaments.includes(tournament.id)).length;
    const selected = view === viewId || (tournament.id === 2 && view.startsWith("t2-"));
    return `<div class="md-row pwt-row${download ? " is-disabled" : ""}${selected ? " is-selected" : ""}" role="option" aria-selected="${selected}" data-view="${viewId}"${download ? ` title="${escapeHtml(tournament.note ?? "")}"` : ""}>
      <span class="md-row-name">${escapeHtml(tournament.name)}</span>
      <span class="pwt-row-meta">${download ? "Wi-Fi" : `${members}`}</span>
    </div>`;
  };
  const special = (id: string, label: string, meta: string) => `<div class="md-row pwt-row${view === id ? " is-selected" : ""}" role="option" aria-selected="${view === id}" data-view="${id}"><span class="md-row-name">${escapeHtml(label)}</span><span class="pwt-row-meta">${escapeHtml(meta)}</span></div>`;
  const unused = trainers.filter((trainer) => trainer.tournaments.length === 0).length;
  const rentalCount = project.narcs[PWT_RENTAL_SETS]?.rawFiles.length ?? 0;
  return `
    <div class="pwt-group">Left counter</div>
    ${PWT_TOURNAMENTS.filter((tournament) => tournament.counter === "left").map(row).join("")}
    <div class="pwt-group">Right counter</div>
    ${PWT_TOURNAMENTS.filter((tournament) => tournament.counter === "right").map(row).join("")}
    <div class="pwt-group">Everyone</div>
    ${special("all", "All trainers", String(trainers.length))}
    ${special("unused", "Not in any tournament", String(unused))}
    ${special("rental", "Rental Pokémon", String(rentalCount))}
  `;
}

function trainerRow(trainer: PwtTrainer, selected: boolean): string {
  const tournaments = trainer.tournaments.map((id) => pwtTournament(id)!.name).join(", ");
  return `<div class="md-row pwt-row pwt-trainer-row${selected ? " is-selected" : ""}" role="option" aria-selected="${selected}" data-view="tr${trainer.index}">
    <span class="td-row-sprite">${trainerPortrait(trainer)}</span>
    <span class="pwt-row-main"><span class="md-row-name">${escapeHtml(trainer.name)}</span><span class="pwt-row-sub">${escapeHtml(tournaments || "Not in any tournament")}</span></span>
  </div>`;
}

function searchTrainers(project: ProjectState, query: string): PwtTrainer[] {
  return getPwtTrainers(project).filter((trainer) => {
    if (trainer.name.toLowerCase().includes(query)) return true;
    return PWT_POOL_ORDER.some((pool) => {
      const team = getPwtTeam(project, pool, trainer.index);
      return team.setIds.some((id) => {
        try {
          return getFacilitySetRecord(project, PWT_POOLS[pool].sets, id).speciesName.toLowerCase().includes(query);
        } catch {
          return false;
        }
      });
    });
  });
}

// ---------- Tournament ----------

function renderTournament(project: ProjectState, tournament: PwtTournament, expertType?: number): string {
  const trainers = getTournamentTrainers(project, tournament.id, expertType);
  const pool = PWT_POOLS[tournament.pool];
  const styles = PWT_STYLES.map((style, index) => ({ ...style, bp: tournament.battlePoints[index] ?? 0 }));
  const singlesOnly = tournament.id === 11;
  const typePicker = tournament.id === 2 ? `
    <div class="pwt-types" role="tablist" aria-label="Type">
      ${PWT_TYPE_NAMES.map((name, type) => `<button class="type-plate sm -${name.toLowerCase()} pwt-type${expertType === type ? " is-active" : ""}" type="button" role="tab" aria-selected="${expertType === type}" data-open="t2-${type}">${name}</button>`).join("")}
    </div>` : "";
  const body = tournament.id === 2 && expertType === undefined
    ? `<p class="td-empty">Pick a type to see the trainers its tournament draws from.</p>`
    : trainers.length
      ? `<div class="pwt-cards">${trainers.map((trainer) => trainerCard(project, trainer, tournament.pool)).join("")}</div>`
      : `<p class="td-empty">No trainer is in this tournament. Open a trainer and turn the tournament on.</p>`;
  return `
    <header class="pwt-head">
      <div class="pwt-kicker">${tournament.counter === "left" ? "Left counter" : "Right counter"} · ${escapeHtml(pool.label)} teams</div>
      <h1>${escapeHtml(tournament.name)}${expertType === undefined ? "" : ` <span class="pwt-sub">${escapeHtml(PWT_TYPE_NAMES[expertType]!)}</span>`}</h1>
    </header>
    <div class="pwt-rules">
      <div><span>Level</span><strong>${tournament.level}</strong></div>
      <div><span>Pokémon brought</span><strong>${singlesOnly ? "3 (Single only)" : styles.map((style) => style.brought).join(" / ")}</strong>${singlesOnly ? "" : `<small>Single / Double / Triple / Rotation</small>`}</div>
      <div><span>Battle Points</span><strong>${styles.some((style) => style.bp) ? styles.map((style) => style.bp).join(" / ") : "—"}</strong></div>
      <div><span>Opens</span><strong class="pwt-rule-text">${escapeHtml(tournament.unlock)}</strong></div>
      <div><span>Regulations</span><strong class="pwt-rule-text">${tournament.regulations.length ? tournament.regulations.map((id) => `#${id}`).join(", ") : "—"}</strong>${tournament.regulations.length ? `<small><a href="#facilities/raw" data-regulation="${tournament.regulations[0]}">Edit rules</a></small>` : ""}</div>
    </div>
    ${tournament.note ? `<p class="pwt-note">${escapeHtml(tournament.note)}</p>` : ""}
    ${typePicker}
    <div class="section-bar md-gap">Trainers<span class="td-bar-note">${tournament.id === 2 && expertType === undefined ? "" : `${trainers.length}${tournament.id === 1 ? " (first 7 of the table)" : ""}`}</span></div>
    ${body}
  `;
}

function trainerCard(project: ProjectState, trainer: PwtTrainer, pool: PwtPoolId, showTournaments = false): string {
  const team = getPwtTeam(project, pool, trainer.index);
  const sets = team.setIds.slice(0, 6).map((id) => setIcon(project, pool, id, id === team.leadSetId && trainer.hasLead)).join("");
  const more = team.setIds.length - 6;
  const warning = !team.exists ? `<span class="pwt-card-warn">No ${PWT_POOLS[pool].label} team</span>` : "";
  const tournaments = showTournaments ? `<span class="pwt-card-sub">${escapeHtml(trainer.tournaments.map((id) => pwtTournament(id)!.name).join(" · ") || "Not in any tournament")}</span>` : `<span class="pwt-card-sub">Rank ${trainer.rank}</span>`;
  return `
    <a class="pwt-card${trainer.tournaments.length ? "" : " -unused"}" href="#pwt/tr${trainer.index}" data-open="tr${trainer.index}">
      <span class="pwt-card-sprite">${trainerPortrait(trainer)}</span>
      <span class="pwt-card-body">
        <span class="pwt-card-name">${escapeHtml(trainer.name)} <span class="pwt-card-num">#${trainer.index}</span></span>
        ${tournaments}
        <span class="pwt-card-team">${sets}${more > 0 ? `<span class="fd-more">+${more}</span>` : ""}${warning}</span>
      </span>
    </a>
  `;
}

function renderTrainerGroup(project: ProjectState, title: string, note: string, trainers: PwtTrainer[], _view: string): string {
  return `
    <header class="pwt-head"><div class="pwt-kicker">World Tournament</div><h1>${escapeHtml(title)}</h1></header>
    <p class="pwt-note">${escapeHtml(note)}</p>
    <div class="section-bar md-gap">Trainers<span class="td-bar-note">${trainers.length}</span></div>
    ${trainers.length ? `<div class="pwt-cards">${trainers.map((trainer) => trainerCard(project, trainer, poolsForTrainer(trainer)[0] ?? "regular", true)).join("")}</div>` : `<p class="td-empty">None.</p>`}
  `;
}

// ---------- Trainer ----------

function renderTrainer(project: ProjectState, state: PageState, index: number): string {
  const trainer = getPwtTrainer(project, index);
  const memberPools = poolsForTrainer(trainer);
  const fromTournament = state.from && state.from !== `tr${index}` ? state.from : undefined;
  const fromLabel = fromTournament ? backLabel(fromTournament) : undefined;
  const fromPool = fromTournament && /^t(\d+)/u.exec(fromTournament) ? pwtTournament(Number(/^t(\d+)/u.exec(fromTournament)![1]))?.pool : undefined;
  const pool = state.pool[index] ?? (fromPool && memberPools.includes(fromPool) ? fromPool : memberPools[0] ?? "regular");
  return `
    ${fromLabel ? `<a class="pwt-back" href="#pwt/${fromTournament}" data-open="${fromTournament}">‹ ${escapeHtml(fromLabel)}</a>` : ""}
    <header class="td-head fd-head pwt-trainer-head">
      <div class="td-sprite">${trainerPortrait(trainer)}</div>
      <div class="td-ident">
        <div class="td-title"><h1><span contenteditable="true" spellcheck="false" data-edit="trainer" data-trainer="${index}" data-field="name" aria-label="Name">${escapeHtml(trainer.name)}</span></h1><span class="td-num">#${index}</span></div>
        <div class="fd-subtitle">${escapeHtml(trainerTypeName(project, trainer.trainerClass))} · ${escapeHtml(PWT_TYPE_NAMES[trainer.type] ?? "Mixed")} specialist · Rank ${trainer.rank}</div>
      </div>
    </header>
    <p class="fd-warning" data-pwt-status hidden></p>
    ${renderClassNotice(project, trainer)}
    ${renderMembership(trainer)}
    ${renderTrainerDetails(trainer)}
    <div class="section-bar md-gap">Teams</div>
    <nav class="md-tabs pwt-team-tabs" role="tablist" aria-label="Teams">
      ${PWT_POOL_ORDER.map((id) => {
        const team = getPwtTeam(project, id, index);
        const used = memberPools.includes(id);
        return `<button class="uv-tab" type="button" role="tab" aria-selected="${id === pool}" data-action="pool-tab" data-trainer="${index}" data-pool="${id}">${escapeHtml(PWT_POOLS[id].label)}<span class="pwt-tab-meta${used ? "" : " -off"}">${team.exists ? team.setIds.length : "—"}</span></button>`;
      }).join("")}
    </nav>
    ${renderTeam(project, trainer, pool)}
  `;
}

/** Explains trainers on a player class (shown by overworld model) and offers the class that matches the model. */
function renderClassNotice(project: ProjectState, trainer: PwtTrainer): string {
  if (!usesPlayerBattleClass(trainer)) return "";
  const player = trainer.trainerClass === 0 ? "Nate" : "Rosa";
  const match = battleClassForObjCode(trainer.objCode);
  const fix = match === undefined
    ? `<span class="pwt-hint">No battle class is paired with overworld model ${trainer.objCode}; set one under Trainer details.</span>`
    : `<button class="btn sm" type="button" data-action="set-class" data-trainer="${trainer.index}" data-class="${match}">Use the ${escapeHtml(trainerTypeName(project, match))} battle class</button>`;
  const text = isBackgroundEntrant(trainer)
    ? `Background entrant: rank 1 trainers fill the bracket and lose to other NPCs, so the player doesn't battle them. Its battle class is ${player} (the player's sprite), so it's shown here by its overworld model.`
    : `This trainer can battle the player, but its battle class is ${player}, so the battle would show the player's sprite. It's shown here by its overworld model.`;
  return `<div class="pwt-class-note${isBackgroundEntrant(trainer) ? "" : " -warn"}"><p>${escapeHtml(text)}</p>${fix}</div>`;
}

function backLabel(view: string): string {
  if (view === "all") return "All trainers";
  if (view === "unused") return "Not in any tournament";
  const type = /^t2-(\d+)$/u.exec(view);
  if (type) return `Type Expert · ${PWT_TYPE_NAMES[Number(type[1])]}`;
  return pwtTournament(Number(view.slice(1)))?.name ?? "Back";
}

function renderMembership(trainer: PwtTrainer): string {
  const chip = (tournament: PwtTournament) => {
    const on = trainer.tournaments.includes(tournament.id);
    return `<button class="btn sm pwt-chip" type="button" aria-pressed="${on}" data-action="tournament" data-trainer="${trainer.index}" data-tournament="${tournament.id}" title="${escapeHtml(`${tournament.name}: ${PWT_POOLS[tournament.pool].label} team`)}">${escapeHtml(tournament.name)}</button>`;
  };
  const byId = (ids: number[]) => ids.map((id) => pwtTournament(id)!).map(chip).join("");
  const expertOptions = [
    ...PWT_TYPE_NAMES.map((name, type) => [type, name] as const),
    [TYPE_ANY, "Any type"] as const,
    [TYPE_NONE, "Not in Type Expert"] as const,
  ];
  const expertValue = trainer.expertType <= TYPE_ANY ? trainer.expertType : TYPE_NONE;
  return `
    <div class="section-bar md-gap">Tournaments${trainer.tournaments.length ? "" : `<span class="pwt-unused-badge">Not used in any tournament</span>`}</div>
    <div class="pwt-member">
      <div class="pwt-member-row"><span class="md-label">Left counter</span><div class="pwt-chips">${byId([11, 4, 12, 14])}</div></div>
      <div class="pwt-member-row"><span class="md-label">Leaders</span><div class="pwt-chips">${byId([5, 6, 7, 8, 9, 1])}</div><span class="pwt-hint" title="These tournaments read one field of the row, so a trainer can be in only one of them.">One of these</span></div>
      <div class="pwt-member-row"><span class="md-label">Masters</span><div class="pwt-chips">${byId([10, 13, 15])}</div></div>
      <div class="pwt-member-row"><span class="md-label">Type Expert</span>
        <select data-trainer-select="expertType" data-trainer="${trainer.index}" aria-label="Type Expert tournament">
          ${expertOptions.map(([value, label]) => `<option value="${value}"${value === expertValue ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </div>
    </div>
  `;
}

function renderTrainerDetails(trainer: PwtTrainer): string {
  const number = (field: PwtTrainerField, value: number, label: string) =>
    `<span class="md-label">${escapeHtml(label)}</span><span class="md-value"><div contenteditable="true" spellcheck="false" data-edit="trainer" data-trainer="${trainer.index}" data-field="${field}" aria-label="${escapeHtml(label)}">${value}</div></span>`;
  return `
    <details class="pwt-details">
      <summary>Trainer details</summary>
      <div class="md-form fd-meta">
        <span class="md-label">Lead Pokémon</span>
        <span class="md-value"><label class="md-check"><input type="checkbox" data-trainer-check="hasLead" data-trainer="${trainer.index}" ${trainer.hasLead ? "checked" : ""}> Always brings its lead first</label></span>
        <span class="md-label">Specialty type</span>
        <span class="md-value"><select data-trainer-select="type" data-trainer="${trainer.index}">${PWT_TYPE_NAMES.map((name, type) => `<option value="${type}"${type === trainer.type ? " selected" : ""}>${name}</option>`).join("")}${trainer.type >= PWT_TYPE_NAMES.length ? `<option value="${trainer.type}" selected>${trainer.type}</option>` : ""}</select></span>
        ${number("rank", trainer.rank, "Rank (0–7)")}
        ${number("trainerClass", trainer.trainerClass, "Trainer class")}
        ${number("objCode", trainer.objCode, "Overworld sprite")}
        <span class="md-label">Gender</span>
        <span class="md-value"><select data-trainer-select="gender" data-trainer="${trainer.index}"><option value="0"${trainer.gender === 0 ? " selected" : ""}>Male</option><option value="1"${trainer.gender === 1 ? " selected" : ""}>Female</option></select></span>
        ${number("bgm", trainer.bgm, "Battle music")}
        ${number("winBgm", trainer.winBgm, "Victory music")}
      </div>
      <p class="pwt-note">Rank decides who meets whom: the three highest-ranked picks are the player's opponents, the top one in the final; rank 1 trainers only fill the other seats.</p>
    </details>
  `;
}

function renderTeam(project: ProjectState, trainer: PwtTrainer, pool: PwtPoolId): string {
  const team = getPwtTeam(project, pool, trainer.index);
  const definition = PWT_POOLS[pool];
  const usedBy = trainer.tournaments.filter((id) => pwtTournament(id)!.pool === pool).map((id) => pwtTournament(id)!.name);
  const usage = usedBy.length
    ? `<p class="pwt-note">Used in ${escapeHtml(usedBy.join(", "))}.</p>`
    : `<p class="pwt-note -off">No tournament ${escapeHtml(trainer.name)} is in uses ${escapeHtml(definition.label)} teams.</p>`;
  if (!team.exists) {
    const sources = PWT_POOL_ORDER.filter((id) => id !== pool && getPwtTeam(project, id, trainer.index).exists && getPwtTeam(project, id, trainer.index).setIds.length);
    return `
      ${usage}
      <div class="pwt-empty-team">
        <p>${escapeHtml(trainer.name)} has no ${escapeHtml(definition.label)} team.</p>
        ${sources.map((source) => `<button class="btn sm -primary" type="button" data-action="create-team" data-trainer="${trainer.index}" data-pool="${pool}" data-copy-from="${source}">Copy the ${escapeHtml(PWT_POOLS[source].label)} team</button>`).join("")}
        <button class="btn sm" type="button" data-action="create-team" data-trainer="${trainer.index}" data-pool="${pool}" data-copy-from="">Start an empty team</button>
      </div>
    `;
  }
  const leadInRoster = team.leadSetId !== undefined && team.setIds.includes(team.leadSetId);
  const leadLine = trainer.hasLead
    ? team.leadSetId === undefined
      ? `<p class="fd-warning">This trainer brings a lead, but its ${definition.label} team has none.</p>`
      : `<p class="pwt-note">Always leads with ${escapeHtml(setName(project, pool, team.leadSetId))}; the rest are picked at random.</p>`
    : `<p class="pwt-note">Picks every Pokémon at random from these sets.</p>`;
  const usable = usablePicks(project, pool, team);
  const capacity = usable < 6 ? `<p class="fd-warning">Triple battles bring 6 Pokémon, but only ${usable} of these sets can be picked together (each pick needs a different species and item).</p>` : "";
  const cards = team.setIds.map((id) => renderSetCard(project, definition.sets, id, { pool, trainer: trainer.index, isLead: trainer.hasLead && id === team.leadSetId })).join("");
  const separateLead = trainer.hasLead && team.leadSetId !== undefined && !leadInRoster
    ? `<div class="section-bar md-gap">Lead<span class="td-bar-note">not in the roster</span></div><div class="pwt-sets">${renderSetCard(project, definition.sets, team.leadSetId, { pool, trainer: trainer.index, isLead: true, leadOnly: true })}</div>`
    : "";
  return `
    ${usage}
    ${leadLine}
    ${capacity}
    ${separateLead}
    <div class="pwt-sets">${cards}</div>
    <div class="pwt-add">
      <span class="md-label">Add Pokémon</span>
      <div class="pwt-add-field"><div contenteditable="true" spellcheck="false" data-add-set data-pool="${pool}" data-trainer="${trainer.index}" data-placeholder="Search this pool's sets" aria-label="Add a set from the ${escapeHtml(definition.label)} pool"></div></div>
      <button class="btn sm" type="button" data-action="add-blank" data-trainer="${trainer.index}" data-pool="${pool}">New set</button>
    </div>
  `;
}

/** How many sets the game can pick together: each pick excludes the species and item already taken. */
function usablePicks(project: ProjectState, pool: PwtPoolId, team: PwtTeam): number {
  const species = new Set<number>();
  const items = new Set<number>();
  let count = 0;
  for (const id of team.setIds) {
    try {
      const set = getFacilitySetRecord(project, PWT_POOLS[pool].sets, id);
      if (species.has(set.speciesId) || (set.itemId !== 0 && items.has(set.itemId))) continue;
      species.add(set.speciesId);
      if (set.itemId !== 0) items.add(set.itemId);
      count += 1;
    } catch {
      // Unreadable sets can't be picked.
    }
  }
  return count;
}

// ---------- Sets ----------

type SetCardContext = { pool?: PwtPoolId; trainer?: number; isLead?: boolean; leadOnly?: boolean };

function cardContext(card: HTMLElement): SetCardContext {
  return {
    pool: (card.dataset.pool || undefined) as PwtPoolId | undefined,
    trainer: card.dataset.trainer ? Number(card.dataset.trainer) : undefined,
    isLead: card.dataset.lead === "true",
    leadOnly: card.dataset.leadOnly === "true",
  };
}

function renderSetCard(project: ProjectState, narc: FacilitySetNarcName, setId: number, context: SetCardContext): string {
  let set: BattleFacilitySet;
  try {
    set = getFacilitySetRecord(project, narc, setId);
  } catch {
    return `<article class="pwt-set -missing"><p class="fd-invalid">Set ${setId} is missing from this pool.</p>${context.pool !== undefined ? `<button class="btn sm -ghost" type="button" data-action="remove-set" data-trainer="${context.trainer}" data-pool="${context.pool}" data-set-id="${setId}">Remove</button>` : ""}</article>`;
  }
  const evs = evStatLabels();
  const short = ["HP", "Atk", "Def", "Spe", "SpA", "SpD"];
  const users = context.pool !== undefined ? getPwtSetUsers(project, context.pool, setId) : [];
  // Only trainers whose tournaments use this pool battle with the set; unused rows that point at it don't count.
  const others = users.filter((user) => user.trainerIndex !== context.trainer && user.inTournament);
  const idle = users.filter((user) => user.trainerIndex !== context.trainer && !user.inTournament).length;
  const shared = others.length
    ? `<span class="pwt-shared" title="${escapeHtml(`Also used by ${others.map((user) => user.name).join(", ")}${idle ? `, and by ${idle} row${idle === 1 ? "" : "s"} no tournament uses` : ""}. Editing this set changes it for them too.`)}">Shared with ${escapeHtml(others.slice(0, 2).map((user) => user.name).join(", "))}${others.length > 2 ? ` +${others.length - 2}` : ""}</span>`
    : "";
  const actions = context.pool !== undefined && context.trainer !== undefined ? `
    <footer class="pwt-set-foot">
      ${shared}
      ${others.length ? `<button class="btn sm" type="button" data-action="copy-set" data-trainer="${context.trainer}" data-pool="${context.pool}" data-set-id="${setId}" title="Edits to the copy only change this trainer">Make a copy for this trainer</button>` : ""}
      <span class="pwt-set-actions">
        ${context.isLead || context.leadOnly ? "" : `<button class="btn sm -ghost" type="button" data-action="make-lead" data-trainer="${context.trainer}" data-pool="${context.pool}" data-set-id="${setId}">Make lead</button>`}
        ${context.leadOnly ? "" : `<button class="btn sm -ghost" type="button" data-action="remove-set" data-trainer="${context.trainer}" data-pool="${context.pool}" data-set-id="${setId}">Remove</button>`}
      </span>
    </footer>` : "";
  const moves = set.moves.map((move, index) => {
    const preview = move.id > 0 ? getMovePreview(project, move.id) : undefined;
    const type = preview?.type ? preview.type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "") : "";
    return `<div class="pwt-move${type ? ` -${type}` : ""}"><div contenteditable="true" spellcheck="false" data-edit="set" data-field="move_${index}" data-autofill="move_names" aria-label="Move ${index + 1}">${escapeHtml(move.id ? move.name : "")}</div></div>`;
  }).join("");
  return `
    <article class="pwt-set${context.isLead ? " -lead" : ""}${others.length ? " -shared" : ""}" data-set-card data-narc="${narc}" data-set-id="${setId}" data-pool="${context.pool ?? ""}" data-trainer="${context.trainer ?? ""}" data-lead="${Boolean(context.isLead)}" data-lead-only="${Boolean(context.leadOnly)}">
      <header class="pwt-set-head">
        ${pokemonIcon(set.spriteSlug, "pwt-set-icon", set.speciesName)}
        <div class="pwt-set-title">
          <div contenteditable="true" spellcheck="false" class="pwt-species" data-edit="set" data-field="species" data-autofill="pokemon_names" aria-label="Species">${escapeHtml(set.speciesName || "")}</div>
          <div class="pwt-item"><span>@</span><div contenteditable="true" spellcheck="false" data-edit="set" data-field="item" data-autofill="items" aria-label="Held item">${escapeHtml(hasValue(set.itemName) ? set.itemName : "")}</div></div>
        </div>
        <span class="pwt-set-badges">${context.isLead ? `<span class="pwt-lead">Lead</span>` : ""}<span class="pwt-set-id" title="Set ${setId} in ${escapeHtml(narc)}">#${setId}</span></span>
      </header>
      <div class="pwt-moves">${moves}</div>
      <div class="pwt-set-meta">
        <select data-field="nature" aria-label="Nature">${NATURES.map((nature) => `<option value="${escapeHtml(nature)}"${nature === set.natureName ? " selected" : ""}>${escapeHtml(nature)}</option>`).join("")}</select>
        <div class="pwt-evs" role="group" aria-label="EVs">
          ${evs.map((label, index) => `<label class="pwt-ev" title="${escapeHtml(label)} EVs"><input type="checkbox" data-field="ev_${index}" ${set.evStats[index] ? "checked" : ""}><span>${short[index]}</span></label>`).join("")}
        </div>
      </div>
      ${actions}
    </article>
  `;
}

function poolSetOptions(project: ProjectState, pool: PwtPoolId): string[] {
  const narc = PWT_POOLS[pool].sets;
  const count = project.narcs[narc]?.rawFiles.length ?? 0;
  const values: string[] = [];
  for (let id = 1; id < count; id += 1) {
    try {
      const set = getFacilitySetRecord(project, narc, id);
      if (!set.speciesId) continue;
      values.push(`${set.speciesName}${hasValue(set.itemName) ? ` @ ${set.itemName}` : ""} (${id})`);
    } catch {
      // Skip unreadable sets.
    }
  }
  return values;
}

function setName(project: ProjectState, pool: PwtPoolId, id: number): string {
  try {
    return getFacilitySetRecord(project, PWT_POOLS[pool].sets, id).speciesName || `set ${id}`;
  } catch {
    return `set ${id}`;
  }
}

function setIcon(project: ProjectState, pool: PwtPoolId, id: number, lead: boolean): string {
  try {
    const set = getFacilitySetRecord(project, PWT_POOLS[pool].sets, id);
    return pokemonIcon(set.spriteSlug, `fd-mini-icon${lead ? " pwt-lead-icon" : ""}`, `${set.speciesName}${lead ? " (lead)" : ""}`);
  } catch {
    return pokemonIcon("-", "fd-mini-icon", `Missing set ${id}`);
  }
}

// ---------- Rental ----------

function renderRental(project: ProjectState, state: PageState): string {
  return `
    <header class="pwt-head"><div class="pwt-kicker">Rental and Rental Master tournaments</div><h1>Rental Pokémon</h1></header>
    <p class="pwt-note">The Pokémon players borrow in Rental tournaments.</p>
    <div class="pwt-rental-search"><input class="md-search" type="search" data-rental-search value="${escapeHtml(state.rentalSearch)}" placeholder="Search Pokémon, moves, items" autocomplete="off" spellcheck="false" aria-label="Search rental Pokémon"></div>
    <div class="pwt-sets" data-rental-grid>${renderRentalCards(project, state.rentalSearch)}</div>
  `;
}

const RENTAL_LIMIT = 60;

function renderRentalCards(project: ProjectState, query: string): string {
  const count = project.narcs[PWT_RENTAL_SETS]?.rawFiles.length ?? 0;
  const terms = query.trim().toLowerCase();
  const ids: number[] = [];
  for (let id = 1; id < count && ids.length < RENTAL_LIMIT; id += 1) {
    if (!terms) {
      ids.push(id);
      continue;
    }
    try {
      const set = getFacilitySetRecord(project, PWT_RENTAL_SETS, id);
      const haystack = [set.speciesName, set.itemName, set.natureName, ...set.moves.map((move) => move.name)].join(" ").toLowerCase();
      if (haystack.includes(terms)) ids.push(id);
    } catch {
      // Skip unreadable sets.
    }
  }
  if (!ids.length) return `<p class="td-empty">No rental Pokémon match.</p>`;
  const note = ids.length === RENTAL_LIMIT ? `<p class="pwt-note pwt-span">Showing the first ${RENTAL_LIMIT}. Search to find others.</p>` : "";
  return ids.map((id) => renderSetCard(project, PWT_RENTAL_SETS, id, {})).join("") + note;
}

// ---------- Small pieces ----------

/**
 * The battle sprite for the trainer's class; trainers on a player class (the vanilla background entrants) are
 * shown by their overworld model instead, since that is how the game presents them.
 */
function trainerPortrait(trainer: PwtTrainer): string {
  if (!usesPlayerBattleClass(trainer)) return trainerSprite(trainer.trainerClass);
  const src = publicAsset(`images/overworlds/${spriteSlugForOverworldSprite(trainer.objCode)}.png`);
  // The sheets are 32-px frames stacked vertically; the third faces the camera. Single-frame sheets stay at 0.
  return `<span class="pwt-ow" title="Overworld model ${trainer.objCode}"><img src="${escapeHtml(src)}" alt="" onload="if(this.naturalHeight<this.naturalWidth*3)this.style.top='0'" onerror="this.parentElement.classList.add('-missing');this.remove()"></span>`;
}

function trainerSprite(trainerClass: number): string {
  return `<canvas class="trainer-rom-sprite" data-trainer-class-id="${trainerClass}" data-trainer-sprite-version="${TRAINER_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>`;
}

function pokemonIcon(spriteSlug: string, className: string, title = ""): string {
  const missing = publicAsset("images/pokesprite/-.png");
  return `<img class="${className}" src="${publicAsset(`images/pokesprite/${spriteSlug}.png`)}" alt="" loading="lazy" decoding="async"${title ? ` title="${escapeHtml(title)}"` : ""} onerror="this.onerror=null;this.src='${missing}'">`;
}

function hasValue(name: string): boolean {
  return Boolean(name) && !/^(none|-+|\?+|0)$/iu.test(name.trim());
}
