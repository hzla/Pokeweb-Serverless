import { publicAsset } from "../assetUrl";
import { evStatLabels, getFacilityAutofills, updateFacilitySetField, type BattleFacilitySet } from "../pokeweb/battleFacilityModel";
import { NATURES } from "../pokeweb/constants";
import { getMovePreview } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  addSubwaySet,
  copySubwaySetFor,
  distinctSpecies,
  getPoolOfTrainer,
  getSlotTrainers,
  getSubwayPools,
  getSubwaySet,
  getSubwaySetCount,
  getSubwaySetUsage,
  getSubwayTrainer,
  getSubwayTrainerCount,
  getSubwayTrainers,
  getUnusedSubwaySets,
  hasSubwayData,
  QUOTE_LABELS,
  setSubwayPoolSets,
  setSubwayTrainerSets,
  speciesNeeded,
  SUBWAY_BOSSES,
  SUBWAY_FIRST_BOSS,
  SUBWAY_FIRST_PARTNER,
  SUBWAY_ROUNDS,
  SUBWAY_TRAINS,
  subwayPartnerLabel,
  subwayTrain,
  subwayTrainerQuotes,
  updateSubwayTrainerField,
  type SubwayPool,
  type SubwaySlot,
  type SubwayTrain,
  type SubwayTrainer,
  type SubwayTrainerField,
} from "../pokeweb/subwayModel";
import { renderBattleFacilityEditor, focusFacilityRecord } from "./battleFacilityEditor";
import { installBw2DialoguePreview, type Bw2DialoguePreview } from "./bw2DialoguePreview";
import { escapeHtml, selectText } from "./dom";
import { assumedDialogueVariables, installGameTextEditor, renderGameTextEditor } from "./textHighlight";
import { TRAINER_SPRITE_RENDER_VERSION } from "./trainerDetail";
import { installTrainerSpriteRendering } from "./trainerEditor";
import { installPicker } from "./trainerInteractions";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";
import "../styles/textData.css";
import "../styles/pwtData.css";
import "../styles/subwayData.css";

/**
 * Battle Subway editor, laid out the way the game plays: trains on the left, each opening its rounds and the
 * trainer ranges its cars draw from; trainers open their name, quotes and Pokémon; pools gather trainers that
 * share one Pokémon list. The record-by-record editor stays available as "Raw files".
 *
 * Views (also the URL after #facilities/): a train id (single, double, multi, s-single, s-double, s-multi, wifi),
 * bosses, partners, all, pools, sets, unused, tr<id>, pool<trainer id>, raw.
 */

export type SubwayEditorOptions = {
  view?: string;
  onDirty?: () => void;
  /** The page changed views; push adds a history entry (so Back returns), otherwise replace it. */
  onNavigate?: (view: string, push: boolean) => void;
};

type PageState = {
  search: string;
  /** The page a trainer or pool was opened from, for the back link. */
  from?: string;
  /** Slots expanded on train pages. */
  open: Set<string>;
  setSearch: string;
};

const pageStates = new WeakMap<ProjectState, PageState>();
const DEFAULT_VIEW = "single";
const TRAIN_VIEWS: Record<string, string> = {
  single: "single",
  double: "double",
  multi: "multi",
  superSingle: "s-single",
  superDouble: "s-double",
  superMulti: "s-multi",
  wifi: "wifi",
};
const SET_GRID_LIMIT = 60;

function trainForView(view: string): SubwayTrain | undefined {
  const id = Object.entries(TRAIN_VIEWS).find(([, value]) => value === view)?.[0];
  return id ? subwayTrain(id) : undefined;
}

export function renderSubwayEditor(project: ProjectState, root: HTMLElement, options: SubwayEditorOptions = {}): void {
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";
  const state = pageStates.get(project) ?? { search: "", open: new Set<string>(), setSearch: "" };
  pageStates.set(project, state);
  let view = isValidView(project, options.view) ? options.view! : DEFAULT_VIEW;

  // Without the Subway archives only the raw editor (World Tournament files, regulations) has anything to show.
  if (view === "raw" || !hasSubwayData(project)) {
    renderRaw(project, root, options);
    return;
  }

  root.innerHTML = `
    <div class="facility-data pwt-data subway-data" id="facility-data">
      <aside class="md-list" aria-label="Battle Subway">
        <div class="md-filters">
          <input class="md-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search trainers or Pokémon" autocomplete="off" spellcheck="false" aria-label="Search trainers or Pokémon">
        </div>
        <div class="md-rows" role="listbox" aria-label="Battle Subway" tabindex="0"></div>
        <div class="md-list-foot pwt-foot"><span data-subway-count></span><a href="#facilities/raw" data-view="raw" title="Trainer, set and regulation records one by one, plus the World Tournament archives">Raw files</a></div>
      </aside>
      <section class="md-detail pwt-detail" aria-live="polite"></section>
    </div>
  `;
  const list = root.querySelector<HTMLElement>(".md-rows")!;
  const detail = root.querySelector<HTMLElement>(".pwt-detail")!;
  const search = root.querySelector<HTMLInputElement>(".md-search")!;
  const count = root.querySelector<HTMLElement>("[data-subway-count]")!;
  const autofills = getFacilityAutofills(project) as unknown as Record<string, string[]>;
  let setOptions: string[] | undefined;

  const renderList = () => {
    const query = state.search.trim().toLowerCase();
    if (query) {
      const matches = searchTrainers(project, query);
      list.innerHTML = matches.length
        ? matches.map((trainer) => trainerRow(trainer, view === `tr${trainer.id}`)).join("")
        : `<p class="td-empty pwt-empty">No trainer or Pokémon matches “${escapeHtml(state.search)}”.</p>`;
      count.textContent = `${matches.length} trainer${matches.length === 1 ? "" : "s"}`;
    } else {
      list.innerHTML = renderNav(project, view);
      count.textContent = `${getSubwayTrainerCount(project)} trainers`;
    }
    installTrainerSpriteRendering(project, list);
  };

  const show = (next: string, push: boolean) => {
    if (!isValidView(project, next)) return;
    if (next === "raw") {
      options.onNavigate?.(next, push);
      renderRaw(project, root, options);
      return;
    }
    if (!next.startsWith("tr") && !next.startsWith("pool") || next === "pools") state.from = next;
    view = next;
    renderDetail(true);
    list.querySelectorAll<HTMLElement>("[data-view]").forEach((row) => {
      const active = row.dataset.view === view;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
    });
    options.onNavigate?.(view, push);
  };

  let dialoguePreview: Bw2DialoguePreview | undefined;
  let dialogueText = "";

  const renderDetail = (fresh = false) => {
    const scroll = detail.scrollTop;
    dialoguePreview?.destroy();
    dialoguePreview = undefined;
    try {
      detail.innerHTML = renderView(project, state, view);
    } catch (error) {
      detail.innerHTML = `<p class="td-empty fd-invalid">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
    installFields(detail);
    installTrainerSpriteRendering(project, detail);
    installQuotes();
    detail.scrollTop = fresh ? 0 : scroll;
  };

  const changed = (opts: { list?: boolean } = {}) => {
    options.onDirty?.();
    if (opts.list) renderList();
  };

  // ----- Quotes, with the in-game preview -----
  const installQuotes = () => {
    const textareas = [...detail.querySelectorAll<HTMLTextAreaElement>("textarea[data-quote]")];
    textareas.forEach(installGameTextEditor);
    const host = detail.querySelector<HTMLElement>("[data-dialogue-preview]");
    if (!host || !textareas.length) return;
    showQuote(textareas[0]!);
    dialoguePreview = installBw2DialoguePreview(project, host, () => dialogueText, assumedDialogueVariables, { stacked: true });
    dialoguePreview.show();
  };
  const showQuote = (textarea: HTMLTextAreaElement) => {
    dialogueText = textarea.value;
    const label = detail.querySelector<HTMLElement>("[data-dialogue-preview-label]");
    if (label) label.textContent = textarea.getAttribute("aria-label") ?? "";
    detail.querySelectorAll<HTMLElement>(".td-line").forEach((line) => line.classList.toggle("is-selected", line.contains(textarea)));
    dialoguePreview?.refresh();
  };
  detail.addEventListener("focusin", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-quote]");
    if (!textarea) return;
    textarea.dataset.initial = textarea.value;
    showQuote(textarea);
  });
  detail.addEventListener("keydown", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-quote]");
    if (!textarea) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      textarea.blur();
    } else if (event.key === "Escape") {
      textarea.value = textarea.dataset.initial ?? textarea.value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.blur();
    }
  });
  detail.addEventListener("focusout", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-quote]");
    if (!textarea || textarea.value === (textarea.dataset.initial ?? textarea.value)) return;
    try {
      updateSubwayTrainerField(project, Number(textarea.dataset.trainer), `quote_${Number(textarea.dataset.quote)}` as SubwayTrainerField, textarea.value);
      textarea.dataset.initial = textarea.value;
      textarea.classList.remove("invalid");
      textarea.closest(".td-line")?.classList.add("is-edited");
      changed();
    } catch (error) {
      textarea.classList.add("invalid");
      textarea.title = error instanceof Error ? error.message : String(error);
    }
  });

  // ----- Field editing (sets, names, classes) -----
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

  const commitField = (field: HTMLElement, value: string): boolean => {
    try {
      const card = field.closest<HTMLElement>("[data-set-card]");
      if (field.dataset.edit === "set" && card) {
        updateFacilitySetField(project, "subway_sets", Number(card.dataset.setId), field.dataset.field!, value);
        setOptions = undefined;
        field.classList.remove("invalid");
        field.removeAttribute("title");
        changed();
        refreshCardLater(card);
        return true;
      }
      if (field.dataset.edit === "trainer") {
        const id = Number(field.dataset.trainer);
        const name = field.dataset.field as SubwayTrainerField;
        const parsed = name === "trainerClass" ? classIdFromInput(value, autofills.trainer_types ?? []) : value;
        updateSubwayTrainerField(project, id, name, parsed);
        changed({ list: true });
        window.setTimeout(() => renderDetail(), 0);
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
      template.innerHTML = renderSetCard(project, Number(card.dataset.setId), cardContextOf(card), getSubwaySetUsage(project)).trim();
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
      const status = detail.querySelector<HTMLElement>("[data-subway-status]");
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.hidden = false;
      }
    }
  };

  /** The list an action edits: one trainer's, or every trainer in a pool. */
  const targetIds = (button: HTMLElement): number[] => (button.dataset.targets ?? "").split(",").filter(Boolean).map(Number);
  const setList = (ids: number[]) => getSubwayTrainer(project, ids[0]!).setIds;
  const writeList = (ids: number[], setIds: number[]) => {
    if (ids.length === 1) setSubwayTrainerSets(project, ids[0]!, setIds);
    else setSubwayPoolSets(project, ids, setIds);
  };

  detail.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLElement>("[data-open]");
    if (open) {
      event.preventDefault();
      if (open.dataset.regulation) focusFacilityRecord("subwayPwt", "regulations", Number(open.dataset.regulation));
      show(open.dataset.open!, true);
      return;
    }
    const toggle = target.closest<HTMLElement>("[data-toggle-slot]");
    if (toggle) {
      const key = toggle.dataset.toggleSlot!;
      if (state.open.has(key)) state.open.delete(key);
      else state.open.add(key);
      renderDetail();
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (!button || button.disabled) return;
    const ids = targetIds(button);
    const setId = Number(button.dataset.setId);
    switch (button.dataset.action) {
      case "copy-set":
        act(() => copySubwaySetFor(project, ids, setId));
        break;
      case "remove-set": {
        const current = setList(ids);
        const index = current.indexOf(setId);
        if (index < 0) break;
        act(() => writeList(ids, current.filter((_id, at) => at !== index)), { list: true });
        break;
      }
      case "add-blank":
        act(() => {
          const id = addSubwaySet(project);
          setOptions = undefined;
          writeList(ids, [...setList(ids), id]);
        }, { list: true });
        break;
      case "show-all-sets":
        button.closest<HTMLElement>("[data-set-grid]")?.classList.add("-all");
        button.remove();
        break;
    }
  });
  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-set-card]");
    if (!card) return;
    const field = (target as HTMLInputElement | HTMLSelectElement).dataset.field;
    if (!field) return;
    try {
      const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : (target as HTMLSelectElement).value;
      updateFacilitySetField(project, "subway_sets", Number(card.dataset.setId), field, value);
      changed();
      refreshCardLater(card);
    } catch (error) {
      target.classList.add("invalid");
      target.title = error instanceof Error ? error.message : String(error);
    }
  });
  // "Add Pokémon": pick any Battle Subway set for this list.
  detail.addEventListener("focusin", (event) => {
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-add-set]");
    if (!field || field.dataset.installed) return;
    field.dataset.installed = "true";
    const ids = targetIds(field);
    setOptions ??= allSetOptions(project);
    const picker = installPicker(field, setOptions);
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
      act(() => writeList(ids, [...setList(ids), Number(id)]), { list: true });
    });
    window.setTimeout(() => picker?.open(), 0);
  });
  detail.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-set-search]")) return;
    state.setSearch = input.value;
    const grid = detail.querySelector<HTMLElement>("[data-set-results]");
    if (grid) {
      grid.innerHTML = renderSetLibrary(project, state.setSearch, view === "unused");
      installFields(grid);
    }
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!row) return;
    event.preventDefault();
    show(row.dataset.view!, row.dataset.view === "raw");
  });
  root.querySelector(".pwt-foot")?.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!link) return;
    event.preventDefault();
    show(link.dataset.view!, true);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-view]")];
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

/** The record-by-record editor, with a way back. */
function renderRaw(project: ProjectState, root: HTMLElement, options: SubwayEditorOptions): void {
  renderBattleFacilityEditor(project, root, options.onDirty, { group: "subwayPwt", afterRender: (host) => addRawBackLink(project, host, options) });
}

function addRawBackLink(project: ProjectState, root: HTMLElement, options: SubwayEditorOptions): void {
  const filters = root.querySelector<HTMLElement>(".md-filters");
  if (!filters || filters.querySelector(".subway-raw-back")) return;
  const target = () => {
    const from = pageStates.get(project)?.from;
    return from && from !== "raw" ? from : DEFAULT_VIEW;
  };
  const back = document.createElement("a");
  back.className = "pwt-back subway-raw-back";
  back.href = `#facilities/${target()}`;
  back.textContent = "‹ Battle Subway";
  back.addEventListener("click", (event) => {
    event.preventDefault();
    const view = target();
    renderSubwayEditor(project, root, { ...options, view });
    options.onNavigate?.(view, true);
  });
  filters.prepend(back);
}

// ---------- Navigation ----------

function isValidView(project: ProjectState, view: string | undefined): boolean {
  if (!view) return false;
  if (["bosses", "partners", "all", "pools", "sets", "unused", "raw"].includes(view)) return true;
  if (trainForView(view)) return true;
  const trainer = /^(?:tr|pool)(\d+)$/u.exec(view);
  if (trainer) return Number(trainer[1]) < getSubwayTrainerCount(project);
  return false;
}

function renderView(project: ProjectState, state: PageState, view: string): string {
  const train = trainForView(view);
  if (train) return renderTrain(project, state, train);
  if (view === "bosses") return renderBosses(project);
  if (view === "partners") return renderGroup(project, "Multi partners", "Nate or Rosa join a player who takes the Multi Train without a friend. The player picks one of three teams; each partner brings 2 Pokémon.", range(SUBWAY_FIRST_PARTNER, SUBWAY_FIRST_BOSS - 1).map((id) => getSubwayTrainer(project, id)));
  if (view === "all") return renderGroup(project, "All trainers", "Every Battle Subway trainer, in trainer number order. The number decides which trains and rounds they appear in.", getSubwayTrainers(project));
  if (view === "pools") return renderPools(project);
  if (view === "sets" || view === "unused") return renderSets(project, state, view === "unused");
  const pool = /^pool(\d+)$/u.exec(view);
  if (pool) return renderPool(project, state, Number(pool[1]));
  return renderTrainer(project, state, Number(view.slice(2)));
}

function renderNav(project: ProjectState, view: string): string {
  const row = (id: string, name: string, meta: string) =>
    `<div class="md-row pwt-row${view === id ? " is-selected" : ""}" role="option" aria-selected="${view === id}" data-view="${id}"><span class="md-row-name">${escapeHtml(name)}</span><span class="pwt-row-meta">${escapeHtml(meta)}</span></div>`;
  const trainRow = (train: SubwayTrain) => row(TRAIN_VIEWS[train.id]!, train.name, train.series === "wifi" ? "Wi-Fi" : train.series === "normal" ? "21" : "∞");
  const pools = getSubwayPools(project).length;
  return `
    <div class="pwt-group">Normal trains</div>
    ${SUBWAY_TRAINS.filter((train) => train.series === "normal").map(trainRow).join("")}
    <div class="pwt-group">Super trains</div>
    ${SUBWAY_TRAINS.filter((train) => train.series !== "normal").map(trainRow).join("")}
    <div class="pwt-group">Everyone</div>
    ${row("bosses", "Ingo & Emmet", `${SUBWAY_BOSSES.length} teams`)}
    ${row("partners", "Multi partners", String(SUBWAY_FIRST_BOSS - SUBWAY_FIRST_PARTNER))}
    ${row("all", "All trainers", String(getSubwayTrainerCount(project)))}
    <div class="pwt-group">Pokémon</div>
    ${row("pools", "Pokémon pools", String(pools))}
    ${row("sets", "All sets", String(Math.max(0, getSubwaySetCount(project) - 1)))}
    ${row("unused", "Unused sets", String(getUnusedSubwaySets(project).length))}
  `;
}

function trainerRow(trainer: SubwayTrainer, selected: boolean): string {
  return `<div class="md-row pwt-row pwt-trainer-row${selected ? " is-selected" : ""}" role="option" aria-selected="${selected}" data-view="tr${trainer.id}">
    <span class="td-row-sprite">${trainerSprite(trainer.trainerClass)}</span>
    <span class="pwt-row-main"><span class="md-row-name">${escapeHtml(trainer.name)} <span class="pwt-card-num">#${trainer.id}</span></span><span class="pwt-row-sub">${escapeHtml(trainerWhere(trainer))}</span></span>
  </div>`;
}

function searchTrainers(project: ProjectState, query: string): SubwayTrainer[] {
  const speciesCache = new Map<number, string>();
  const species = (id: number) => {
    if (!speciesCache.has(id)) {
      try {
        speciesCache.set(id, getSubwaySet(project, id).speciesName.toLowerCase());
      } catch {
        speciesCache.set(id, "");
      }
    }
    return speciesCache.get(id)!;
  };
  return getSubwayTrainers(project).filter((trainer) =>
    trainer.name.toLowerCase().includes(query) ||
    trainer.className.toLowerCase().includes(query) ||
    `#${trainer.id}` === query ||
    trainer.setIds.some((id) => species(id).includes(query)));
}

// ---------- Trains ----------

function renderTrain(project: ProjectState, state: PageState, train: SubwayTrain): string {
  const brought = train.brought === 2 ? "2 each" : String(train.brought);
  const battles = train.series === "normal" ? "21" : train.series === "super" ? "No limit" : "—";
  const battlesNote = train.series === "normal" ? "Beating the boss opens the Super train" : train.series === "super" ? "Boss at battle 49" : "";
  const head = `
    <header class="pwt-head">
      <div class="pwt-kicker">${train.series === "normal" ? "Normal train · 3 rounds of 7 battles" : train.series === "super" ? "Super train · rounds of 7 battles, no limit" : "Downloaded train"}</div>
      <h1>${escapeHtml(train.name)}</h1>
    </header>
    <div class="pwt-rules">
      <div><span>Level</span><strong>50</strong></div>
      <div><span>Pokémon brought</span><strong>${brought}</strong>${train.brought === 2 ? "<small>Two trainers per side</small>" : ""}</div>
      <div><span>Battles</span><strong>${battles}</strong>${battlesNote ? `<small>${battlesNote}</small>` : ""}</div>
      <div><span>Battle Points</span><strong class="pwt-rule-text">${escapeHtml(train.battlePoints)}</strong></div>
      <div><span>Regulation</span><strong class="pwt-rule-text">#${train.regulation} ${escapeHtml(train.regulationName)}</strong><small><a href="#facilities/raw" data-open="raw" data-regulation="${train.regulation}">Edit rules</a></small></div>
    </div>
    ${train.note ? `<p class="pwt-note">${escapeHtml(train.note)}</p>` : ""}
  `;
  if (train.series === "wifi") return head;
  const rounds = SUBWAY_ROUNDS[train.series];
  return `
    ${head}
    <p class="pwt-note">Each car draws a trainer at random from its slot, never the same one twice in a run. The trainer then draws ${train.brought === 2 ? "2" : train.brought} Pokémon from its pool with no repeated species, none the player brought, and (when it can) no repeated held items. Single, Double and Multi trains share these slots; only the boss and team size differ.</p>
    ${rounds.map((round) => `
      <div class="section-bar md-gap">${escapeHtml(round.label)}<span class="td-bar-note">${escapeHtml(round.battles)}</span></div>
      ${round.slots.map((entry) => entry.boss ? renderBossSlot(project, entry, train) : renderSlot(project, state, entry)).join("")}
    `).join("")}
  `;
}

function renderSlot(project: ProjectState, state: PageState, entry: SubwaySlot): string {
  const trainers = getSlotTrainers(project, entry);
  const open = state.open.has(entry.key);
  const ivs = [...new Set(trainers.map((trainer) => trainer.iv))];
  const pools = new Map<string, { pool: SubwayPool; inSlot: number }>();
  const allPools = getSubwayPools(project);
  for (const trainer of trainers) {
    const pool = allPools.find((candidate) => candidate.trainerIds.includes(trainer.id))!;
    const found = pools.get(pool.key);
    if (found) found.inSlot += 1;
    else pools.set(pool.key, { pool, inSlot: 1 });
  }
  const poolList = [...pools.values()];
  const poolChip = poolList.length === 1 ? `1 shared pool · ${poolList[0]!.pool.setIds.length} sets` : `${poolList.length} Pokémon pools`;
  const body = open ? `
    <div class="subway-slot-body">
      <div class="subway-pools">
        ${poolList.map(({ pool, inSlot }) => `
          <a class="subway-pool-row" href="#facilities/pool${pool.firstTrainer}" data-open="pool${pool.firstTrainer}">
            <span class="subway-pool-label"><strong>${inSlot === trainers.length ? "Everyone here" : `${inSlot} trainer${inSlot === 1 ? "" : "s"}`}</strong><small>${pool.setIds.length} sets${pool.trainerIds.length > inSlot ? ` · shared with ${pool.trainerIds.length - inSlot} more` : ""}</small></span>
            <span class="subway-icons">${setIcons(project, pool.setIds, 22)}</span>
            <span class="btn sm">Edit pool</span>
          </a>`).join("")}
      </div>
      <div class="pwt-cards">${trainers.map((trainer) => trainerCard(project, trainer)).join("")}</div>
    </div>` : "";
  return `
    <div class="subway-slot${open ? " -open" : ""}">
      <button class="subway-slot-head" type="button" data-toggle-slot="${entry.key}" aria-expanded="${open}">
        <span class="subway-slot-label"><strong>${escapeHtml(entry.cars)}</strong><small>${escapeHtml(entry.battles)}</small></span>
        <span class="subway-strip">${trainers.slice(0, 12).map((trainer) => `<span class="subway-mini" title="${escapeHtml(trainer.name)}">${trainerSprite(trainer.trainerClass)}</span>`).join("")}${trainers.length > 12 ? `<span class="fd-more">+${trainers.length - 12}</span>` : ""}</span>
        <span class="subway-slot-meta">${trainers.length} trainers · #${entry.min}–${entry.max} · IVs ${ivs.length === 1 ? ivs[0] : `${Math.min(...ivs)}–${Math.max(...ivs)}`}</span>
        <span class="subway-chip">${poolChip}</span>
        <span class="subway-caret" aria-hidden="true">${open ? "▾" : "▸"}</span>
      </button>
      ${body}
    </div>
  `;
}

function renderBossSlot(project: ProjectState, entry: SubwaySlot, train: SubwayTrain): string {
  const bosses = train.bosses.map((id) => getSubwayTrainer(project, id));
  return `
    <div class="subway-slot -boss">
      <div class="subway-slot-head -static">
        <span class="subway-slot-label"><strong>${escapeHtml(entry.cars)}</strong><small>${escapeHtml(entry.battles)}</small></span>
        <span class="subway-boss-cards">${bosses.map((boss) => `
          <a class="subway-boss" href="#facilities/tr${boss.id}" data-open="tr${boss.id}">
            <span class="subway-mini -big">${trainerSprite(boss.trainerClass)}</span>
            <span class="subway-boss-name"><strong>${escapeHtml(boss.name)}</strong><small>${escapeHtml(boss.className)} · #${boss.id}</small></span>
            <span class="subway-icons">${setIcons(project, boss.setIds, 6)}</span>
          </a>`).join("")}</span>
        <span class="subway-slot-meta">${bosses.length > 1 ? "Both at once" : "Fixed team"} · IVs 31</span>
      </div>
    </div>
  `;
}

function renderBosses(project: ProjectState): string {
  const trains = SUBWAY_TRAINS.filter((train) => train.bosses.length);
  return `
    <header class="pwt-head"><div class="pwt-kicker">Battle Subway</div><h1>Ingo &amp; Emmet</h1></header>
    <p class="pwt-note">Each train ends with a boss: battle 21 on the normal trains and battle 49 on the Super trains. Multi trains face Ingo and Emmet together. Their teams have exactly as many Pokémon as they bring, so every set always appears.</p>
    ${trains.map((train) => `
      <div class="section-bar md-gap">${escapeHtml(train.name)}<span class="td-bar-note">${train.series === "normal" ? "Battle 21" : "Battle 49"}</span></div>
      <div class="pwt-cards">${train.bosses.map((id) => trainerCard(project, getSubwayTrainer(project, id), true)).join("")}</div>
    `).join("")}
  `;
}

function renderGroup(project: ProjectState, title: string, note: string, trainers: SubwayTrainer[]): string {
  return `
    <header class="pwt-head"><div class="pwt-kicker">Battle Subway</div><h1>${escapeHtml(title)}</h1></header>
    <p class="pwt-note">${escapeHtml(note)}</p>
    <div class="section-bar md-gap">Trainers<span class="td-bar-note">${trainers.length}</span></div>
    <div class="pwt-cards">${trainers.map((trainer) => trainerCard(project, trainer, true)).join("")}</div>
  `;
}

function trainerCard(project: ProjectState, trainer: SubwayTrainer, showTeam = false): string {
  return `
    <a class="pwt-card" href="#facilities/tr${trainer.id}" data-open="tr${trainer.id}">
      <span class="pwt-card-sprite">${trainerSprite(trainer.trainerClass)}</span>
      <span class="pwt-card-body">
        <span class="pwt-card-name">${escapeHtml(trainer.name)} <span class="pwt-card-num">#${trainer.id}</span></span>
        <span class="pwt-card-sub">${escapeHtml(showTeam ? trainerWhere(trainer) : trainer.className)}</span>
        ${showTeam ? `<span class="pwt-card-team">${setIcons(project, trainer.setIds, 6)}</span>` : ""}
      </span>
    </a>
  `;
}

/** A one-line "where": the trains and battles a trainer shows up in. */
function trainerWhere(trainer: SubwayTrainer): string {
  if (trainer.boss) return `${subwayTrain(trainer.boss.train)!.name} boss`;
  if (trainer.role === "partner") return "Multi partner";
  if (!trainer.slots.length) return "Not drawn by any train";
  const normal = trainer.slots.filter((entry) => entry.series === "normal").map((entry) => entry.battles.replace("Battles ", "").replace("Battle ", ""));
  const superSlots = trainer.slots.filter((entry) => entry.series === "super").map((entry) => entry.battles.replace("Battles ", "").replace("Battle ", ""));
  return [normal.length ? `Normal ${normal.join(", ")}` : "", superSlots.length ? `Super ${superSlots.join(", ")}` : ""].filter(Boolean).join(" · ");
}

// ---------- Trainer ----------

function renderTrainer(project: ProjectState, state: PageState, id: number): string {
  const trainer = getSubwayTrainer(project, id);
  const quotes = subwayTrainerQuotes(project, id);
  const pool = getPoolOfTrainer(project, id);
  const others = pool.trainerIds.filter((other) => other !== id);
  const back = state.from && !state.from.startsWith("tr") ? state.from : undefined;
  const role = trainer.boss ? `${subwayTrain(trainer.boss.train)!.name} boss` : trainer.role === "partner" ? subwayPartnerLabel(id) : "Regular trainer";
  const appears = trainer.boss
    ? [`${subwayTrain(trainer.boss.train)!.name} · ${subwayTrain(trainer.boss.train)!.series === "normal" ? "battle 21" : "battle 49"}`]
    : trainer.role === "partner"
      ? ["Multi Train", "Super Multi Train"]
      : trainer.slots.map((entry) => `${entry.series === "normal" ? "Normal" : "Super"} trains · ${entry.round}, ${entry.cars.toLowerCase()} (${entry.battles.toLowerCase()})`);
  const usage = getSubwaySetUsage(project);
  return `
    ${back ? `<a class="pwt-back" href="#facilities/${back}" data-open="${back}">‹ ${escapeHtml(backLabel(project, back))}</a>` : ""}
    <header class="td-head fd-head pwt-trainer-head">
      <div class="td-sprite">${trainerSprite(trainer.trainerClass)}</div>
      <div class="td-ident">
        <div class="td-title"><h1><span contenteditable="true" spellcheck="false" data-edit="trainer" data-trainer="${id}" data-field="name" aria-label="Name">${escapeHtml(trainer.name)}</span></h1><span class="td-num">#${id}</span></div>
        <div class="fd-subtitle subway-class"><span contenteditable="true" spellcheck="false" data-edit="trainer" data-trainer="${id}" data-field="trainerClass" data-autofill="trainer_types" aria-label="Trainer class" title="Trainer class: sets the sprite and title">${escapeHtml(trainer.className)}</span><span>· ${escapeHtml(role)} · IVs ${trainer.iv}</span></div>
      </div>
    </header>
    <p class="fd-warning" data-subway-status hidden></p>
    <div class="section-bar md-gap">Appears in${trainer.role === "regular" ? `<span class="td-bar-note">Set by the trainer number</span>` : ""}</div>
    <div class="subway-appears">${appears.length ? appears.map((text) => `<span class="subway-chip">${escapeHtml(text)}</span>`).join("") : `<span class="pwt-unused-badge">Not drawn by any train</span>`}</div>
    <section class="subway-quotes">
      <div>
        <div class="section-bar md-gap">Quotes</div>
        <div class="td-lines">${quotes.map((text, which) => `
          <div class="td-line">
            <span class="md-label">${escapeHtml(QUOTE_LABELS[which]!)}</span>
            ${renderGameTextEditor(text, `data-quote="${which}" data-trainer="${id}" aria-label="${escapeHtml(QUOTE_LABELS[which]!)}"`)}
            <span></span>
          </div>`).join("")}
        </div>
      </div>
      ${project.session.baseRom === "BW2" ? `<aside class="subway-quote-preview" aria-label="In-game preview"><div class="tx-preview-head"><span class="tx-block-title">In-game preview</span><span class="tx-preview-entry" data-dialogue-preview-label></span></div><div data-dialogue-preview></div></aside>` : ""}
    </section>
    <div class="section-bar md-gap">Pokémon<span class="td-bar-note">${trainer.setIds.length} set${trainer.setIds.length === 1 ? "" : "s"}${trainer.role === "boss" ? " · brings all of them" : trainer.role === "partner" ? " · brings 2" : " · brings 3 in Singles, 4 in Doubles, 2 in Multis"}</span></div>
    ${others.length ? `
      <div class="subway-shared-note">
        <span class="pwt-shared">Same list as ${escapeHtml(namesOf(project, others))}</span>
        <span>Adding or removing Pokémon here only changes ${escapeHtml(trainer.name)}'s list.</span>
        <a class="btn sm" href="#facilities/pool${pool.firstTrainer}" data-open="pool${pool.firstTrainer}">Edit the shared pool</a>
      </div>` : ""}
    ${speciesWarning(project, trainer, trainer.setIds)}
    ${renderSetGrid(project, trainer.setIds, [id], usage)}
    ${renderAddRow([id])}
  `;
}

function backLabel(project: ProjectState, view: string): string {
  const train = trainForView(view);
  if (train) return train.name;
  const labels: Record<string, string> = { bosses: "Ingo & Emmet", partners: "Multi partners", all: "All trainers", pools: "Pokémon pools", sets: "All sets", unused: "Unused sets" };
  if (labels[view]) return labels[view]!;
  const pool = /^pool(\d+)$/u.exec(view);
  if (pool) return `Pool of ${getSubwayTrainer(project, Number(pool[1])).name}`;
  return "Back";
}

function namesOf(project: ProjectState, ids: number[]): string {
  const names = ids.slice(0, 2).map((id) => getSubwayTrainer(project, id).name);
  return `${names.join(", ")}${ids.length > 2 ? ` +${ids.length - 2}` : ""}`;
}

function speciesWarning(project: ProjectState, trainer: SubwayTrainer, setIds: number[]): string {
  const needed = speciesNeeded(trainer);
  const have = distinctSpecies(project, setIds);
  if (!needed || have >= needed) return "";
  return `<p class="fd-warning">Only ${have} different species. A ${needed / 2}-Pokémon team can't repeat a species or use one the player brought, so the game can freeze with fewer than ${needed}.</p>`;
}

// ---------- Pools ----------

function renderPools(project: ProjectState): string {
  const pools = getSubwayPools(project);
  return `
    <header class="pwt-head"><div class="pwt-kicker">Battle Subway</div><h1>Pokémon pools</h1></header>
    <p class="pwt-note">Trainers with exactly the same Pokémon list share a pool. Editing a pool changes every trainer in it; a trainer's own page changes only that trainer.</p>
    <div class="section-bar md-gap">Pools<span class="td-bar-note">${pools.length}</span></div>
    <div class="subway-pools">${pools.map((pool) => {
      const first = getSubwayTrainer(project, pool.firstTrainer);
      const last = pool.trainerIds[pool.trainerIds.length - 1]!;
      return `
        <a class="subway-pool-row" href="#facilities/pool${pool.firstTrainer}" data-open="pool${pool.firstTrainer}">
          <span class="subway-pool-label"><strong>${pool.trainerIds.length === 1 ? escapeHtml(first.name) : `${pool.trainerIds.length} trainers`}</strong><small>${pool.trainerIds.length === 1 ? `#${first.id}` : contiguous(pool.trainerIds) ? `#${pool.firstTrainer}–${last}` : `#${pool.trainerIds.slice(0, 4).join(", #")}${pool.trainerIds.length > 4 ? "…" : ""}`} · ${pool.setIds.length} sets</small></span>
          <span class="subway-icons">${setIcons(project, pool.setIds, 22)}</span>
          <span class="subway-slot-meta">${escapeHtml(trainerWhere(first))}</span>
        </a>`;
    }).join("")}</div>
  `;
}

function contiguous(ids: number[]): boolean {
  return ids.every((id, index) => index === 0 || id === ids[index - 1]! + 1);
}

function renderPool(project: ProjectState, state: PageState, trainerId: number): string {
  const pool = getPoolOfTrainer(project, trainerId);
  const trainers = pool.trainerIds.map((id) => getSubwayTrainer(project, id));
  const back = state.from && !state.from.startsWith("pool") ? state.from : "pools";
  const usage = getSubwaySetUsage(project);
  const strictest = trainers.reduce((worst, trainer) => (speciesNeeded(trainer) > speciesNeeded(worst) ? trainer : worst), trainers[0]!);
  return `
    <a class="pwt-back" href="#facilities/${back}" data-open="${back}">‹ ${escapeHtml(backLabel(project, back))}</a>
    <header class="pwt-head"><div class="pwt-kicker">Pokémon pool</div><h1>${trainers.length === 1 ? `${escapeHtml(trainers[0]!.name)}'s Pokémon` : `Shared by ${trainers.length} trainers`}</h1></header>
    <p class="pwt-note">${trainers.length === 1 ? "Only this trainer uses this exact list." : `Adding or removing a Pokémon here changes the list of all ${trainers.length} trainers. To change one of them alone, open that trainer.`}</p>
    <p class="fd-warning" data-subway-status hidden></p>
    <div class="section-bar md-gap">Trainers<span class="td-bar-note">${trainers.length}</span></div>
    <div class="subway-chips">${trainers.map((trainer) => `<a class="subway-person" href="#facilities/tr${trainer.id}" data-open="tr${trainer.id}"><span class="subway-mini">${trainerSprite(trainer.trainerClass)}</span><span>${escapeHtml(trainer.name)} <span class="pwt-card-num">#${trainer.id}</span></span></a>`).join("")}</div>
    <div class="section-bar md-gap">Pokémon<span class="td-bar-note">${pool.setIds.length} sets</span></div>
    ${speciesWarning(project, strictest, pool.setIds)}
    ${renderSetGrid(project, pool.setIds, pool.trainerIds, usage)}
    ${renderAddRow(pool.trainerIds)}
  `;
}

// ---------- Sets ----------

type SetCardContext = { targets: number[] };

function cardContextOf(card: HTMLElement): SetCardContext {
  return { targets: (card.dataset.targets ?? "").split(",").filter(Boolean).map(Number) };
}

const SET_GRID_INITIAL = 24;

function renderSetGrid(project: ProjectState, setIds: number[], targets: number[], usage: Map<number, number[]>): string {
  const more = setIds.length > SET_GRID_INITIAL;
  return `
    <div class="pwt-sets subway-sets${more ? "" : " -all"}" data-set-grid>
      ${setIds.map((setId) => renderSetCard(project, setId, { targets }, usage)).join("") || `<p class="td-empty">No Pokémon yet.</p>`}
      ${more ? `<button class="btn sm -ghost subway-show-all" type="button" data-action="show-all-sets">Show all ${setIds.length}</button>` : ""}
    </div>
  `;
}

function renderAddRow(targets: number[]): string {
  return `
    <div class="pwt-add">
      <span class="md-label">Add Pokémon</span>
      <div class="pwt-add-field"><div contenteditable="true" spellcheck="false" data-add-set data-targets="${targets.join(",")}" aria-label="Add a Pokémon set" data-placeholder="Search sets by Pokémon or item"></div></div>
      <button class="btn sm" type="button" data-action="add-blank" data-targets="${targets.join(",")}">New set</button>
    </div>
  `;
}

function renderSets(project: ProjectState, state: PageState, unusedOnly: boolean): string {
  return `
    <header class="pwt-head"><div class="pwt-kicker">Battle Subway</div><h1>${unusedOnly ? "Unused sets" : "All sets"}</h1></header>
    <p class="pwt-note">${unusedOnly ? "No trainer's list names these sets. Add them to a trainer or pool to use them." : "Every Battle Subway set. Editing one changes it for every trainer whose list names it."}</p>
    <input class="md-search pwt-rental-search" type="search" value="${escapeHtml(state.setSearch)}" placeholder="Search Pokémon, moves, items" data-set-search aria-label="Search sets">
    <div data-set-results>${renderSetLibrary(project, state.setSearch, unusedOnly)}</div>
  `;
}

function renderSetLibrary(project: ProjectState, query: string, unusedOnly: boolean): string {
  const usage = getSubwaySetUsage(project);
  const ids = unusedOnly ? getUnusedSubwaySets(project) : range(1, getSubwaySetCount(project) - 1);
  const needle = query.trim().toLowerCase();
  const matches = needle ? ids.filter((id) => setMatches(project, id, needle)) : ids;
  const shown = matches.slice(0, SET_GRID_LIMIT);
  return `
    <div class="section-bar md-gap">Sets<span class="td-bar-note">${matches.length > shown.length ? `${shown.length} of ${matches.length}` : matches.length}</span></div>
    <div class="pwt-sets subway-sets -all">${shown.map((id) => renderSetCard(project, id, { targets: [] }, usage)).join("") || `<p class="td-empty">No sets match.</p>`}</div>
    ${matches.length > shown.length ? `<p class="pwt-note">Showing the first ${SET_GRID_LIMIT}. Search to narrow it down.</p>` : ""}
  `;
}

function setMatches(project: ProjectState, id: number, needle: string): boolean {
  try {
    const set = getSubwaySet(project, id);
    return `#${id}` === needle || String(id) === needle || set.speciesName.toLowerCase().includes(needle) || set.itemName.toLowerCase().includes(needle) || set.moves.some((move) => move.name.toLowerCase().includes(needle));
  } catch {
    return false;
  }
}

function renderSetCard(project: ProjectState, setId: number, context: SetCardContext, usage: Map<number, number[]>): string {
  let set: BattleFacilitySet;
  try {
    set = getSubwaySet(project, setId);
  } catch {
    return `<article class="pwt-set -missing" data-set-card data-set-id="${setId}" data-targets="${context.targets.join(",")}"><p class="fd-invalid">Set ${setId} is missing.</p>${context.targets.length ? `<button class="btn sm -ghost" type="button" data-action="remove-set" data-targets="${context.targets.join(",")}" data-set-id="${setId}">Remove</button>` : ""}</article>`;
  }
  const evs = evStatLabels();
  const short = ["HP", "Atk", "Def", "Spe", "SpA", "SpD"];
  const users = usage.get(setId) ?? [];
  const outside = users.filter((id) => !context.targets.includes(id));
  const sharedLabel = outside.length
    ? `<span class="pwt-shared" title="Editing this set also changes it for ${outside.length} other trainer${outside.length === 1 ? "" : "s"}">${context.targets.length ? "Also used by" : "Used by"} ${outside.length} trainer${outside.length === 1 ? "" : "s"}</span>`
    : context.targets.length ? "" : `<span class="pwt-hint">Unused</span>`;
  const copyLabel = context.targets.length === 1 ? "Make a copy for this trainer" : "Make a copy for this pool";
  const footer = `
    <footer class="pwt-set-foot">
      ${sharedLabel}
      ${context.targets.length && outside.length ? `<button class="btn sm" type="button" data-action="copy-set" data-targets="${context.targets.join(",")}" data-set-id="${setId}" title="Edits to the copy only change ${context.targets.length === 1 ? "this trainer" : "these trainers"}">${copyLabel}</button>` : ""}
      ${context.targets.length ? `<span class="pwt-set-actions"><button class="btn sm -ghost" type="button" data-action="remove-set" data-targets="${context.targets.join(",")}" data-set-id="${setId}">Remove</button></span>` : ""}
    </footer>`;
  const moves = set.moves.map((move, index) => {
    const preview = move.id > 0 ? getMovePreview(project, move.id) : undefined;
    const type = preview?.type ? preview.type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "") : "";
    return `<div class="pwt-move${type ? ` -${type}` : ""}"><div contenteditable="true" spellcheck="false" data-edit="set" data-field="move_${index}" data-autofill="move_names" aria-label="Move ${index + 1}">${escapeHtml(move.id ? move.name : "")}</div></div>`;
  }).join("");
  return `
    <article class="pwt-set${outside.length && context.targets.length ? " -shared" : ""}" data-set-card data-set-id="${setId}" data-targets="${context.targets.join(",")}">
      <header class="pwt-set-head">
        ${pokemonIcon(set.spriteSlug, "pwt-set-icon", set.speciesName)}
        <div class="pwt-set-title">
          <div contenteditable="true" spellcheck="false" class="pwt-species" data-edit="set" data-field="species" data-autofill="pokemon_names" aria-label="Species">${escapeHtml(set.speciesName || "")}</div>
          <div class="pwt-item"><span>@</span><div contenteditable="true" spellcheck="false" data-edit="set" data-field="item" data-autofill="items" aria-label="Held item">${escapeHtml(hasValue(set.itemName) ? set.itemName : "")}</div></div>
        </div>
        <span class="pwt-set-badges"><span class="pwt-set-id" title="Set ${setId}">#${setId}</span></span>
      </header>
      <div class="pwt-moves">${moves}</div>
      <div class="pwt-set-meta">
        <select data-field="nature" aria-label="Nature">${NATURES.map((nature) => `<option value="${escapeHtml(nature)}"${nature === set.natureName ? " selected" : ""}>${escapeHtml(nature)}</option>`).join("")}</select>
        <div class="pwt-evs" role="group" aria-label="EVs">
          ${evs.map((label, index) => `<label class="pwt-ev" title="${escapeHtml(label)} EVs"><input type="checkbox" data-field="ev_${index}" ${set.evStats[index] ? "checked" : ""}><span>${short[index]}</span></label>`).join("")}
        </div>
      </div>
      ${footer}
    </article>
  `;
}

function allSetOptions(project: ProjectState): string[] {
  const values: string[] = [];
  for (let id = 1; id < getSubwaySetCount(project); id += 1) {
    try {
      const set = getSubwaySet(project, id);
      if (!set.speciesId) continue;
      values.push(`${set.speciesName}${hasValue(set.itemName) ? ` @ ${set.itemName}` : ""} (${id})`);
    } catch {
      // Skip unreadable sets.
    }
  }
  return values;
}

function setIcons(project: ProjectState, setIds: number[], limit: number): string {
  const icons = setIds.slice(0, limit).map((setId) => {
    try {
      const set = getSubwaySet(project, setId);
      return pokemonIcon(set.spriteSlug, "fd-mini-icon", set.speciesName);
    } catch {
      return pokemonIcon("-", "fd-mini-icon", `Missing set ${setId}`);
    }
  });
  return `${icons.join("")}${setIds.length > limit ? `<span class="fd-more">+${setIds.length - limit}</span>` : ""}`;
}

// ---------- Helpers ----------

/** "Youngster (2)" from the picker, a bare number, or a class name. */
function classIdFromInput(value: string, options: string[]): number {
  const fromLabel = /\((\d+)\)\s*$/u.exec(value)?.[1] ?? /^\d+$/u.exec(value.trim())?.[0];
  if (fromLabel !== undefined) return Number(fromLabel);
  const match = options.find((option) => option.replace(/\s*\(\d+\)$/u, "").toLowerCase() === value.trim().toLowerCase());
  const id = match ? /\((\d+)\)$/u.exec(match)?.[1] : undefined;
  if (id === undefined) throw new Error("Pick a trainer class from the list");
  return Number(id);
}

function trainerSprite(trainerClass: number): string {
  return `<canvas class="trainer-rom-sprite" data-trainer-class-id="${trainerClass}" data-trainer-sprite-version="${TRAINER_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>`;
}

function pokemonIcon(spriteSlug: string, className: string, title = ""): string {
  const missing = publicAsset("images/pokesprite/-.png");
  return `<img class="${className}" src="${publicAsset(`images/pokesprite/${spriteSlug}.png`)}" alt="" loading="lazy" decoding="async"${title ? ` title="${escapeHtml(title)}"` : ""} onerror="this.onerror=null;this.src='${missing}'">`;
}

function hasValue(name: string): boolean {
  return Boolean(name) && name !== "None" && name !== "-" && name !== "—";
}

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
}
