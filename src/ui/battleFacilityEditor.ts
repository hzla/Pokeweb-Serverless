import { publicAsset } from "../assetUrl";
import {
  FACILITY_CHOICE_LABELS,
  FACILITY_SET_LABELS,
  defaultSetLibraryForChoice,
  evStatLabels,
  facilityAreaPoolMatchesSearch,
  facilityChoiceMatchesSearch,
  facilityChoiceUsesTrainerClass,
  facilityRegulationMatchesSearch,
  facilitySetMatchesSearch,
  getFacilityAreaPoolCount,
  getFacilityAreaPoolRecord,
  getFacilityAutofills,
  getFacilityChoiceCount,
  getFacilityChoiceNarcOptions,
  getFacilityChoiceRecord,
  getFacilityRegulationCount,
  getFacilityRegulationRecord,
  getFacilitySetCount,
  getFacilitySetNarcOptions,
  getFacilitySetRecord,
  isBossFacilityChoice,
  updateFacilityAreaPoolValue,
  updateFacilityChoiceField,
  updateFacilityRegulationField,
  updateFacilitySetField,
  type BattleFacilityAreaPoolRecord,
  type BattleFacilityChoiceRecord,
  type BattleFacilityGroup,
  type BattleFacilityRegulationRecord,
  type BattleFacilitySet,
  type FacilityChoiceNarcName,
  type FacilitySetNarcName,
} from "../pokeweb/battleFacilityModel";
import { NATURES } from "../pokeweb/constants";
import { getMovePreview } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { hasGen5TrainerSprites } from "../pokeweb/trainerSpriteModel";
import { escapeHtml, selectText } from "./dom";
import { TRAINER_SPRITE_RENDER_VERSION } from "./trainerDetail";
import { installTrainerSpriteRendering } from "./trainerEditor";
import { installPicker } from "./trainerInteractions";
import "../styles/moveData.css";
import "../styles/trainerData.css";
import "../styles/facilityData.css";

type FacilityMode = "sets" | "choices" | "areaPools" | "bosses" | "regulations";
type FacilityKind = "set" | "choice" | "regulation" | "areaPool";

type BattleFacilityEditorOptions = {
  group?: BattleFacilityGroup;
};

type GroupState = {
  mode: FacilityMode;
  setNarc?: FacilitySetNarcName;
  choiceNarc?: FacilityChoiceNarcName;
  search: string;
  /** Selected record per list ("sets:subway_sets" → id). */
  selected: Record<string, number>;
};

const groupStates: Record<BattleFacilityGroup, GroupState> = {
  subwayPwt: { mode: "sets", search: "", selected: {} },
  wbt: { mode: "sets", search: "", selected: {} },
};

const REGULATION_LEVEL_RULES: Array<[number, string]> = [[0, "Normal"], [1, "Minimum"], [2, "Maximum"], [3, "Scale down"], [4, "Set level"], [5, "Scale up"]];
const REGULATION_BATTLE_TYPES: Array<[number, string]> = [[0, "Single"], [1, "Double"], [2, "Triple"], [3, "Rotation"], [4, "Multi"], [5, "Shooter"]];

export function renderBattleFacilityEditor(project: ProjectState, root: HTMLElement, onDirty?: () => void, options: BattleFacilityEditorOptions = {}): void {
  const group = options.group ?? "subwayPwt";
  const state = groupStates[group];
  const setNarcs = getFacilitySetNarcOptions(project, group);
  const choiceNarcs = getFacilityChoiceNarcOptions(project, group);
  const hasRegulations = group === "subwayPwt" && Boolean(project.narcs.regulations);
  const hasAreaPools = group === "wbt" && Boolean(project.narcs.wbt_area_pools);
  state.setNarc = state.setNarc && setNarcs.includes(state.setNarc) ? state.setNarc : setNarcs[0];
  state.choiceNarc = state.choiceNarc && choiceNarcs.includes(state.choiceNarc) ? state.choiceNarc : choiceNarcs[0];
  const available: Record<FacilityMode, boolean> = {
    sets: Boolean(state.setNarc),
    choices: Boolean(state.choiceNarc),
    bosses: group === "wbt" && Boolean(state.choiceNarc),
    areaPools: hasAreaPools,
    regulations: hasRegulations,
  };
  if (!available[state.mode]) state.mode = (["sets", "choices", "areaPools", "regulations"] as FacilityMode[]).find((mode) => available[mode]) ?? "sets";

  const modes: Array<[FacilityMode, string]> = group === "wbt"
    ? [["sets", "Sets"], ["choices", "Trainers"], ["bosses", "Boss teams"], ["areaPools", "Area pools"]]
    : [["sets", "Sets"], ["choices", "Choices"], ["regulations", "Regulations"]];
  const pageActions = document.getElementById("page-actions");
  if (pageActions) pageActions.innerHTML = "";

  root.innerHTML = `
    <div class="facility-data" id="facility-data">
      <aside class="md-list" aria-label="Records">
        <div class="md-filters">
          <div class="fd-modes" role="tablist" aria-label="Record type">
            ${modes.map(([mode, label]) => `<button class="btn sm" type="button" role="tab" data-facility-mode="${mode}" aria-pressed="${state.mode === mode}" ${available[mode] ? "" : "disabled"}>${label}</button>`).join("")}
          </div>
          ${renderArchiveSelect(state, setNarcs, choiceNarcs)}
          <input class="md-search" id="facility-search-text" type="search" value="${escapeHtml(state.search)}" placeholder="${escapeHtml(searchPlaceholder(state.mode))}" autocomplete="off" spellcheck="false" aria-label="Search records">
        </div>
        <div class="md-rows" id="facility-list" role="listbox" aria-label="Records" tabindex="0">${renderRows(project, state)}</div>
        <div class="md-list-foot" data-facility-count></div>
        <details class="md-tools"><summary>How these connect</summary><div class="fd-guide">${renderGuide(group)}</div></details>
      </aside>
      <section class="md-detail" id="facility-detail"></section>
    </div>
  `;

  const list = root.querySelector<HTMLElement>("#facility-list")!;
  const detail = root.querySelector<HTMLElement>("#facility-detail")!;
  const countLabel = root.querySelector<HTMLElement>("[data-facility-count]")!;
  const searchInput = root.querySelector<HTMLInputElement>("#facility-search-text")!;
  const listKey = () => `${state.mode}:${state.mode === "sets" ? state.setNarc : state.mode === "choices" || state.mode === "bosses" ? state.choiceNarc : ""}`;
  const rerender = () => renderBattleFacilityEditor(project, root, onDirty, options);

  const filter = () => {
    const query = state.search;
    let visible = 0;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-record]")];
    rows.forEach((row) => {
      const show = !query.trim() || recordMatches(project, state, Number(row.dataset.record), query);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    const noun = state.mode === "sets" ? "sets" : state.mode === "regulations" ? "regulations" : state.mode === "areaPools" ? "area configs" : group === "wbt" ? "trainers" : "choices";
    countLabel.textContent = visible === rows.length ? `${rows.length} ${noun}` : `${visible} of ${rows.length} ${noun}`;
  };

  const refreshRow = (id: number) => {
    const row = list.querySelector<HTMLElement>(`[data-record="${id}"]`);
    if (!row) return;
    const template = document.createElement("template");
    template.innerHTML = renderRow(project, state, id).trim();
    const next = template.content.firstElementChild as HTMLElement | null;
    if (!next) return;
    next.classList.toggle("is-selected", row.classList.contains("is-selected"));
    next.setAttribute("aria-selected", row.getAttribute("aria-selected") ?? "false");
    next.style.display = row.style.display;
    row.replaceWith(next);
  };

  const controller = attachFacilityDetail(detail, project, state, {
    onDirty,
    onRecordChanged: refreshRow,
    jumpToSet: (narc, id) => {
      state.mode = "sets";
      state.setNarc = narc;
      state.search = "";
      state.selected[`sets:${narc}`] = id;
      rerender();
    },
    jumpToChoice: (narc, id) => {
      state.mode = "choices";
      state.choiceNarc = narc;
      state.search = "";
      state.selected[`choices:${narc}`] = id;
      rerender();
    },
  });

  const select = (id: number, fromKeyboard = false) => {
    state.selected[listKey()] = id;
    controller.render(state.mode, id);
    list.querySelectorAll<HTMLElement>("[data-record]").forEach((row) => {
      const active = Number(row.dataset.record) === id;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
      if (active && fromKeyboard) row.scrollIntoView({ block: "nearest" });
    });
  };

  root.querySelectorAll<HTMLButtonElement>("[data-facility-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.facilityMode as FacilityMode;
      rerender();
    });
  });
  root.querySelector<HTMLSelectElement>("[data-facility-archive]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (state.mode === "sets") state.setNarc = value as FacilitySetNarcName;
    else state.choiceNarc = value as FacilityChoiceNarcName;
    rerender();
  });
  let searchTimer = 0;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = searchInput.value;
      filter();
    }, 160);
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-record]");
    if (row) select(Number(row.dataset.record));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-record]")].filter((row) => row.style.display !== "none");
    const index = rows.findIndex((row) => row.classList.contains("is-selected"));
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) select(Number(next.dataset.record), true);
  });

  installTrainerSpriteRendering(project, root);
  filter();
  const ids = [...list.querySelectorAll<HTMLElement>("[data-record]")].map((row) => Number(row.dataset.record));
  const remembered = state.selected[listKey()];
  const initial = remembered !== undefined && ids.includes(remembered) ? remembered : ids[0];
  if (initial === undefined) detail.innerHTML = `<p class="td-empty">No records in this archive.</p>`;
  else select(initial, true);
}

// ---------- List ----------

function renderArchiveSelect(state: GroupState, setNarcs: FacilitySetNarcName[], choiceNarcs: FacilityChoiceNarcName[]): string {
  const choose = <T extends string>(names: T[], current: T | undefined, labels: Record<T, string>) => names.length > 1
    ? `<select data-facility-archive aria-label="Archive">${names.map((name) => `<option value="${name}"${name === current ? " selected" : ""}>${escapeHtml(labels[name])}</option>`).join("")}</select>`
    : "";
  if (state.mode === "sets") return choose(setNarcs, state.setNarc, FACILITY_SET_LABELS);
  if (state.mode === "choices" || state.mode === "bosses") return choose(choiceNarcs, state.choiceNarc, FACILITY_CHOICE_LABELS);
  return "";
}

function searchPlaceholder(mode: FacilityMode): string {
  if (mode === "sets") return "Search Pokémon, moves, items";
  if (mode === "regulations") return "Search regulations";
  if (mode === "areaPools") return "Search area configs";
  return "Search trainers, set IDs";
}

function recordIds(project: ProjectState, state: GroupState): number[] {
  const range = (count: number) => Array.from({ length: count }, (_unused, id) => id);
  if (state.mode === "sets") return state.setNarc ? range(getFacilitySetCount(project, state.setNarc)) : [];
  if (state.mode === "regulations") return range(getFacilityRegulationCount(project));
  if (state.mode === "areaPools") return range(getFacilityAreaPoolCount(project));
  if (!state.choiceNarc) return [];
  const narc = state.choiceNarc;
  const ids = range(getFacilityChoiceCount(project, narc));
  return state.mode === "bosses" ? ids.filter((id) => isBossFacilityChoice(getFacilityChoiceRecord(project, narc, id))) : ids;
}

function renderRows(project: ProjectState, state: GroupState): string {
  return recordIds(project, state).map((id) => renderRow(project, state, id)).join("");
}

function recordMatches(project: ProjectState, state: GroupState, id: number, query: string): boolean {
  try {
    if (state.mode === "sets") return facilitySetMatchesSearch(getFacilitySetRecord(project, state.setNarc!, id), query);
    if (state.mode === "regulations") return facilityRegulationMatchesSearch(getFacilityRegulationRecord(project, id), query);
    if (state.mode === "areaPools") return facilityAreaPoolMatchesSearch(getFacilityAreaPoolRecord(project, id), query);
    return facilityChoiceMatchesSearch(getFacilityChoiceRecord(project, state.choiceNarc!, id), query);
  } catch {
    return false;
  }
}

function editCount(project: ProjectState, prefix: string): number {
  return (project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(prefix)).length;
}

function editBadge(count: number): string {
  return count ? `<span class="md-edits" title="${count} change${count === 1 ? "" : "s"}">${count}</span>` : "";
}

function renderRow(project: ProjectState, state: GroupState, id: number): string {
  const open = (extra = "") => `<div class="md-row fd-row${extra}" role="option" aria-selected="false" data-record="${id}">`;
  try {
    if (state.mode === "sets") {
      const set = getFacilitySetRecord(project, state.setNarc!, id);
      return `${open()}
        <span class="md-row-id">${id}</span>
        ${pokemonIcon(set.spriteSlug, "fd-row-icon")}
        <span class="md-row-name">${escapeHtml(set.speciesName || "—")}${editBadge(editCount(project, `facility-set:${set.narc}:${id}:`))}</span>
        <span class="fd-row-aside">${escapeHtml(hasValue(set.itemName) ? set.itemName : "")}</span>
      </div>`;
    }
    if (state.mode === "regulations") {
      const record = getFacilityRegulationRecord(project, id);
      return `${open()}
        <span class="md-row-id">${id}</span>
        <span></span>
        <span class="md-row-name">${escapeHtml(record.label)}${editBadge(editCount(project, `facility-regulation:${id}:`))}</span>
        <span class="fd-row-aside">${escapeHtml(record.battleTypeName)}</span>
      </div>`;
    }
    if (state.mode === "areaPools") {
      const record = getFacilityAreaPoolRecord(project, id);
      return `${open()}
        <span class="md-row-id">${id}</span>
        <span></span>
        <span class="md-row-name">Area config ${record.recordId}${editBadge(editCount(project, `facility-area-pool:${id}:`))}</span>
        <span class="fd-row-aside">${record.pools.length} pools</span>
      </div>`;
    }
    const choice = getFacilityChoiceRecord(project, state.choiceNarc!, id);
    return `${open(" fd-row-tall")}
      <span class="md-row-id">${id}</span>
      <span class="td-row-sprite">${choiceSprite(project, choice)}</span>
      <span class="td-row-main">
        <span class="td-row-line">
          <span class="md-row-name">${escapeHtml(choiceName(choice))}${editBadge(editCount(project, `facility-choice:${choice.narc}:${id}:`))}</span>
          <span class="td-row-lv">${choice.setIds.length} set${choice.setIds.length === 1 ? "" : "s"}</span>
        </span>
        <span class="td-row-line"><span class="fd-row-sets">${choiceSetIcons(project, choice, 6)}</span></span>
      </span>
    </div>`;
  } catch (error) {
    return `${open()}<span class="md-row-id">${id}</span><span></span><span class="md-row-name fd-invalid">${escapeHtml(error instanceof Error ? error.message : "Unreadable record")}</span><span></span></div>`;
  }
}

function choiceName(choice: BattleFacilityChoiceRecord): string {
  return facilityChoiceUsesTrainerClass(choice.narc) ? choice.trainerTypeName : `Record ${choice.id}`;
}

function choiceSprite(project: ProjectState, choice: BattleFacilityChoiceRecord): string {
  if (!facilityChoiceUsesTrainerClass(choice.narc) || !hasGen5TrainerSprites(project)) return "";
  return `<canvas class="trainer-rom-sprite" data-trainer-class-id="${choice.trainerType}" data-trainer-sprite-version="${TRAINER_SPRITE_RENDER_VERSION}" width="96" height="96" aria-hidden="true"></canvas>`;
}

function choiceSetIcons(project: ProjectState, choice: BattleFacilityChoiceRecord, limit: number): string {
  const library = choice.setLibrary;
  if (!library) return "";
  const icons = choice.setIds.slice(0, limit).map((setId) => {
    try {
      const set = getFacilitySetRecord(project, library, setId);
      return pokemonIcon(set.spriteSlug, "fd-mini-icon", set.speciesName);
    } catch {
      return pokemonIcon("-", "fd-mini-icon", `Missing set ${setId}`);
    }
  });
  const more = choice.setIds.length - limit;
  return `${icons.join("")}${more > 0 ? `<span class="fd-more">+${more}</span>` : ""}`;
}

function pokemonIcon(spriteSlug: string, className: string, title = ""): string {
  const missing = publicAsset("images/pokesprite/-.png");
  return `<img class="${className}" src="${publicAsset(`images/pokesprite/${spriteSlug}.png`)}" alt="" loading="lazy" decoding="async"${title ? ` title="${escapeHtml(title)}"` : ""} onerror="this.onerror=null;this.src='${missing}'">`;
}

function renderGuide(group: BattleFacilityGroup): string {
  if (group === "subwayPwt") {
    return `
      <p><strong>Choices → Sets.</strong> Each trainer choice lists the set IDs it can draw from; a set is one Pokémon build. PWT maps hold tournament and trainer assignments.</p>
      <p><strong>Regulations</strong> set battle rules such as level, format and party size. They don't pick opponents or teams.</p>
    `;
  }
  return `
    <p><strong>Area pools → Trainers → Sets.</strong> Areas pick trainer records, and each trainer lists the set IDs used to build its Pokémon.</p>
    <p><strong>Boss teams</strong> are the same trainer records, filtered to bosses.</p>
  `;
}

// ---------- Detail ----------

type FacilityDetailOptions = {
  onDirty?: () => void;
  onRecordChanged: (id: number) => void;
  jumpToSet: (narc: FacilitySetNarcName, id: number) => void;
  jumpToChoice: (narc: FacilityChoiceNarcName, id: number) => void;
};

const detailControllers = new WeakMap<HTMLElement, AbortController>();

function attachFacilityDetail(detail: HTMLElement, project: ProjectState, state: GroupState, options: FacilityDetailOptions) {
  detailControllers.get(detail)?.abort();
  const controller = new AbortController();
  detailControllers.set(detail, controller);
  const { signal } = controller;
  const autofills = getFacilityAutofills(project) as unknown as Record<string, string[]>;
  let current: { mode: FacilityMode; id: number } | undefined;

  const html = () => {
    if (!current) return "";
    try {
      return renderDetail(project, state, current.mode, current.id);
    } catch (error) {
      return `<p class="td-empty fd-invalid">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  };

  const markPrefix = () => {
    const card = detail.querySelector<HTMLElement>(".fd-card");
    return card?.dataset.markPrefix ?? "";
  };

  const refreshMarks = () => {
    const prefix = markPrefix();
    if (!prefix) return;
    const edited = new Set((project.actionChangelog?.entries ?? []).filter((entry) => entry.key.startsWith(prefix)).map((entry) => entry.key.slice(prefix.length)));
    detail.querySelectorAll<HTMLElement>("[data-mark-fields]").forEach((element) => {
      element.classList.toggle("is-edited", (element.dataset.markFields ?? "").split("|").some((field) => edited.has(field)));
    });
  };

  const install = (container: HTMLElement) => {
    container.querySelectorAll<HTMLElement>("[contenteditable='true'][data-field-name]").forEach((field) => {
      if (field.dataset.facilityInstalled === "true") return;
      field.dataset.facilityInstalled = "true";
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
        if (event.key === "Enter" && !field.classList.contains("fd-hex")) {
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
        if (commit(field, value)) initial = field.textContent?.trim() ?? "";
        else field.textContent = initial;
      });
    });
  };

  /** Apply a re-render without replacing focusable elements when the layout is unchanged. */
  const refresh = () => {
    const next = document.createElement("template");
    next.innerHTML = html();
    const signature = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>("[data-field-name], [data-jump-set], [data-jump-choice]")].map((element) => `${element.tagName}:${element.dataset.fieldName ?? ""}`).join(",");
    if (signature(next.content) !== signature(detail)) {
      const scrollTop = detail.scrollTop;
      detail.innerHTML = next.innerHTML;
      install(detail);
      detail.scrollTop = scrollTop;
    } else {
      next.content.querySelectorAll<HTMLElement>("[data-derived]").forEach((source) => {
        const target = detail.querySelector<HTMLElement>(`[data-derived="${source.dataset.derived}"]`);
        if (target) target.innerHTML = source.innerHTML;
      });
      next.content.querySelectorAll<HTMLElement>("[data-field-name]").forEach((source) => {
        const target = detail.querySelector<HTMLElement>(`${source.tagName.toLowerCase()}[data-field-name="${source.dataset.fieldName}"]`);
        if (!target || target === document.activeElement) return;
        if (target instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
          target.innerHTML = source.innerHTML;
          target.value = source.value;
        } else if (target instanceof HTMLInputElement && source instanceof HTMLInputElement) target.checked = source.checked;
        else target.textContent = source.textContent;
      });
    }
    refreshMarks();
  };

  const commit = (field: HTMLElement, value: string | boolean): boolean => {
    const card = field.closest<HTMLElement>(".fd-card");
    if (!card || !current) return false;
    const kind = card.dataset.kind as FacilityKind;
    const id = Number(card.dataset.index);
    const fieldName = field.dataset.fieldName ?? "";
    try {
      if (kind === "set") updateFacilitySetField(project, card.dataset.narc as FacilitySetNarcName, id, fieldName, value);
      else if (kind === "choice") updateFacilityChoiceField(project, card.dataset.narc as FacilityChoiceNarcName, id, fieldName, String(value));
      else if (kind === "areaPool") updateFacilityAreaPoolValue(project, id, Number(field.dataset.offset), String(value));
      else updateFacilityRegulationField(project, id, fieldName, String(value));
      field.classList.remove("invalid");
      field.removeAttribute("title");
      options.onDirty?.();
      options.onRecordChanged(id);
      window.setTimeout(refresh, 0);
      return true;
    } catch (error) {
      field.classList.add("invalid");
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  };

  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement && target.dataset.fieldName) {
      if (!commit(target, target.value)) refresh();
    } else if (target instanceof HTMLInputElement && target.type === "checkbox" && target.dataset.fieldName) {
      if (!commit(target, target.checked)) refresh();
    }
  }, { signal });

  detail.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const setJump = target.closest<HTMLElement>("[data-jump-set]");
    if (setJump) {
      options.jumpToSet(setJump.dataset.jumpSet as FacilitySetNarcName, Number(setJump.dataset.setId));
      return;
    }
    const choiceJump = target.closest<HTMLElement>("[data-jump-choice]");
    if (choiceJump) options.jumpToChoice(choiceJump.dataset.jumpChoice as FacilityChoiceNarcName, Number(choiceJump.dataset.choiceId));
  }, { signal });

  return {
    render: (mode: FacilityMode, id: number) => {
      current = { mode, id };
      detail.innerHTML = html();
      install(detail);
      refreshMarks();
      detail.scrollTop = 0;
    },
  };
}

function renderDetail(project: ProjectState, state: GroupState, mode: FacilityMode, id: number): string {
  if (mode === "sets") return renderSetDetail(project, state.setNarc!, id);
  if (mode === "regulations") return renderRegulationDetail(getFacilityRegulationRecord(project, id));
  if (mode === "areaPools") return renderAreaPoolDetail(getFacilityAreaPoolRecord(project, id));
  return renderChoiceDetail(project, getFacilityChoiceRecord(project, state.choiceNarc!, id));
}

function renderSetDetail(project: ProjectState, narc: FacilitySetNarcName, id: number): string {
  const set = getFacilitySetRecord(project, narc, id);
  const evLabels = evStatLabels();
  const evCount = set.evStats.filter(Boolean).length;
  const evShare = evCount ? Math.floor(510 / evCount) : 0;
  return `
    <article class="fd-card" data-kind="set" data-narc="${narc}" data-index="${id}" data-mark-prefix="facility-set:${narc}:${id}:">
      ${renderHead(`<span data-derived="sprite">${pokemonIcon(set.spriteSlug, "fd-head-icon")}</span>`, `<span data-derived="title">${escapeHtml(set.speciesName || "—")}</span>`, id, FACILITY_SET_LABELS[narc])}
      <div class="fd-body">
        <section>
          <div class="section-bar">Set</div>
          <div class="md-form">
            ${formRow("Species", "species", editable("set", "species", set.speciesName, { autofill: "pokemon_names" }))}
            ${formRow("Held item", "item", editable("set", "item", set.itemName, { autofill: "items" }))}
            ${formRow("Nature", "nature", select("nature", NATURES.map((nature) => [nature, nature]), set.natureName))}
            ${formRow("Form", "form", editable("set", "form", set.form, { type: "int-65535" }))}
          </div>
          <div class="section-bar md-gap">EVs<span class="td-bar-note" data-derived="ev-note">${evCount ? `510 split evenly: ${evShare} each` : "None"}</span></div>
          <div class="fd-evs">
            ${evLabels.map((label, index) => `
              <label class="md-check td-check" data-mark-fields="ev_${index}|evSpread|rawHex">
                <input type="checkbox" data-field-name="ev_${index}" ${set.evStats[index] ? "checked" : ""}>
                <span>${escapeHtml(label)}</span>
              </label>
            `).join("")}
          </div>
        </section>
        <section>
          ${renderMoveTable(project, set)}
          <div class="section-bar md-gap">Used by</div>
          <div class="fd-used-by">${renderSetUsers(project, narc, id)}</div>
        </section>
      </div>
      ${renderRaw("set", set.rawHex)}
    </article>
  `;
}

function renderMoveTable(project: ProjectState, set: BattleFacilitySet): string {
  const rows = set.moves.map((move, index) => {
    const preview = move.id > 0 ? getMovePreview(project, move.id) : undefined;
    const power = String(preview?.power ?? "");
    return `
      <tr data-mark-fields="move_${index}|rawHex">
        <td>${editable("set", `move_${index}`, move.name, { autofill: "move_names" })}</td>
        <td data-derived="m${index}-type">${preview?.type ? `<span class="type-plate sm -${preview.type.toLowerCase().replace(/[^a-z0-9_-]+/gu, "")}">${escapeHtml(preview.type)}</span>` : ""}</td>
        <td class="td-move-cat" data-derived="m${index}-cat">${escapeHtml(preview?.category ? preview.category.charAt(0).toUpperCase() + preview.category.slice(1).toLowerCase() : "")}</td>
        <td class="r" data-derived="m${index}-pow">${escapeHtml(power === "0" ? "—" : power)}</td>
      </tr>
    `;
  }).join("");
  return `
    <table class="md-table td-move-table" aria-label="Moves">
      <thead><tr><th>Moves</th><th>Type</th><th>Category</th><th class="r">Power</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/** Choice records in this group's archives whose set list includes this set. */
function renderSetUsers(project: ProjectState, narc: FacilitySetNarcName, setId: number): string {
  const users: string[] = [];
  for (const choiceNarc of Object.keys(FACILITY_CHOICE_LABELS) as FacilityChoiceNarcName[]) {
    if (!project.narcs[choiceNarc] || defaultSetLibraryForChoice(project, choiceNarc) !== narc) continue;
    for (let id = 0; id < getFacilityChoiceCount(project, choiceNarc); id += 1) {
      try {
        const choice = getFacilityChoiceRecord(project, choiceNarc, id);
        if (!choice.setIds.includes(setId)) continue;
        users.push(`<button class="btn sm fd-chip" type="button" data-jump-choice="${choiceNarc}" data-choice-id="${id}" title="${escapeHtml(`${FACILITY_CHOICE_LABELS[choiceNarc]} ${id}`)}">${escapeHtml(choiceName(choice))} <span>#${id}</span></button>`);
      } catch {
        // Skip unreadable records.
      }
    }
  }
  return users.length ? users.join("") : `<p class="td-empty">No trainer uses this set.</p>`;
}

function renderChoiceDetail(project: ProjectState, choice: BattleFacilityChoiceRecord): string {
  const usesClass = facilityChoiceUsesTrainerClass(choice.narc);
  const library = choice.setLibrary;
  const cards = choice.setIds.map((setId, index) => {
    let body = `<span class="fd-set-missing">Missing set</span>`;
    let jump = "";
    if (library) {
      try {
        const set = getFacilitySetRecord(project, library, setId);
        body = `${pokemonIcon(set.spriteSlug, "fd-set-icon")}<span class="fd-set-name">${escapeHtml(set.speciesName)}</span><span class="fd-set-item">${escapeHtml(hasValue(set.itemName) ? set.itemName : "")}</span>`;
        jump = `<button class="btn sm -ghost fd-set-open" type="button" data-jump-set="${library}" data-set-id="${setId}" title="Open set ${setId}">Open</button>`;
      } catch {
        // Keep the missing-set body.
      }
    }
    return `
      <div class="fd-set" data-mark-fields="set_${index}|rawHex">
        <div class="fd-set-body" data-derived="set-${index}">${body}</div>
        <div class="fd-set-foot">
          <span class="md-unit">Set</span>${editable("choice", `set_${index}`, setId, { type: "int-65535", label: `Set ID ${index + 1}` })}
          <span data-derived="set-jump-${index}">${jump}</span>
        </div>
      </div>
    `;
  }).join("");
  return `
    <article class="fd-card" data-kind="choice" data-narc="${choice.narc}" data-index="${choice.id}" data-mark-prefix="facility-choice:${choice.narc}:${choice.id}:">
      ${renderHead(`<span data-derived="sprite">${choiceSprite(project, choice)}</span>`, `<span data-derived="title">${escapeHtml(choiceName(choice))}</span>`, choice.id, FACILITY_CHOICE_LABELS[choice.narc])}
      <div class="md-form fd-meta">
        ${usesClass
          ? formRow("Trainer class", "trainerType", editable("choice", "trainerType", `${choice.trainerTypeName}`, { autofill: "trainer_types" }))
          : formRow("Header", "trainerType", editable("choice", "trainerType", choice.trainerType, { type: "int-65535" }))}
        ${formRow("Set count", "count", `${editable("choice", "count", choice.count, { type: "int-65535" })}<span class="md-unit" title="Record length; 4 bytes plus 2 for each set ID">${choice.byteLength} bytes</span>`)}
      </div>
      <div class="section-bar md-gap">Sets<span class="td-bar-note">${choice.setIds.length}${choice.setIds.length === choice.count ? "" : ` of ${choice.count} declared`}${library ? ` · from ${escapeHtml(FACILITY_SET_LABELS[library])}` : ""}</span></div>
      ${choice.invalidSetIds.length ? `<p class="fd-warning">Set IDs not in ${escapeHtml(library ? FACILITY_SET_LABELS[library] : "the set archive")}: ${choice.invalidSetIds.join(", ")}</p>` : ""}
      <div class="fd-sets">${cards || `<p class="td-empty">This record has no sets.</p>`}</div>
      ${choice.extraValues.length ? `
        <div class="section-bar md-gap">Extra values</div>
        <div class="md-form fd-meta">${choice.extraValues.map((value, index) => formRow(`Extra ${index + 1}`, `extra_${index}`, editable("choice", `extra_${index}`, value, { type: "int-65535" }))).join("")}</div>
      ` : ""}
      ${renderRaw("choice", choice.rawHex)}
    </article>
  `;
}

function renderRegulationDetail(record: BattleFacilityRegulationRecord): string {
  const options = (choices: Array<[number, string]>, current: number, currentName: string) => {
    const all = choices.some(([value]) => value === current) ? choices : [...choices, [current, currentName] as [number, string]];
    return all.map(([value, label]) => [String(value), label] as [string, string]);
  };
  return `
    <article class="fd-card" data-kind="regulation" data-index="${record.id}" data-mark-prefix="facility-regulation:${record.id}:">
      ${renderHead("", escapeHtml(record.label), record.id, record.note ?? "Battle regulation")}
      <div class="section-bar">Rules</div>
      <div class="md-form fd-meta">
        ${formRow("Pokémon", "numLo|numHi", `${editable("regulation", "numLo", record.numLo, { type: "int-255", label: "Minimum Pokémon" })}<span class="md-unit">to</span>${editable("regulation", "numHi", record.numHi, { type: "int-255", label: "Maximum Pokémon" })}`)}
        ${formRow("Level", "level", editable("regulation", "level", record.level, { type: "int-255" }))}
        ${formRow("Level rule", "levelRange", select("levelRange", options(REGULATION_LEVEL_RULES, record.levelRange, record.levelRangeName), String(record.levelRange)))}
        ${formRow("Total level", "levelTotal", `${editable("regulation", "levelTotal", record.levelTotal, { type: "int-65535" })}<span class="md-unit">${record.levelTotal ? "" : "no cap"}</span>`)}
        ${formRow("Battle", "battleType", select("battleType", options(REGULATION_BATTLE_TYPES, record.battleType, record.battleTypeName), String(record.battleType)))}
        ${formRow("Battle count", "battleCount", editable("regulation", "battleCount", record.battleCount, { type: "int-255" }))}
      </div>
      <p class="fd-warning">Changing the Pokémon count needs matching code changes to the battle mode's team size and opponent generation.</p>
    </article>
  `;
}

function renderAreaPoolDetail(record: BattleFacilityAreaPoolRecord): string {
  return `
    <article class="fd-card" data-kind="areaPool" data-index="${record.id}" data-mark-prefix="facility-area-pool:${record.id}:">
      ${renderHead("", `Area config ${record.recordId}`, record.id, `${record.byteLength} bytes`)}
      <div class="section-bar">Header</div>
      <p class="fd-mono">${record.headerValues.map((value) => escapeHtml(String(value))).join(" ")}</p>
      ${record.pools.map((pool) => `
        <div class="section-bar md-gap">Pool ${pool.index + 1}<span class="td-bar-note">${pool.trainerRefCount} trainers · 0x${pool.startOffset.toString(16).padStart(4, "0")}</span></div>
        <div class="fd-pool">
          ${pool.values.map((value) => value.isTrainerRef ? `
            <div class="fd-pool-trainer" data-mark-fields="${value.offset}">
              ${editable("areaPool", "value", value.value, { type: "int-65535", offset: value.offset, label: "Trainer ID" })}
              <button class="btn sm -ghost" type="button" data-jump-choice="wbt_trainers" data-choice-id="${value.value}" title="Open trainer ${value.value}">${escapeHtml(value.trainerTypeName ?? `Trainer ${value.value}`)}</button>
            </div>
          ` : `<span class="fd-pool-control" title="Control value at 0x${value.offset.toString(16).padStart(4, "0")} (read-only)">${escapeHtml(String(value.value))}</span>`).join("")}
        </div>
      `).join("")}
    </article>
  `;
}

function renderHead(sprite: string, title: string, id: number, subtitle: string): string {
  return `
    <header class="td-head fd-head${sprite ? "" : " -no-sprite"}">
      ${sprite ? `<div class="td-sprite">${sprite}</div>` : ""}
      <div class="td-ident">
        <div class="td-title"><h1>${title}</h1><span class="td-num">#${id}</span></div>
        <div class="fd-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    </header>
  `;
}

function renderRaw(kind: FacilityKind, rawHex: string): string {
  return `
    <details class="fd-raw">
      <summary>Raw record</summary>
      <div data-mark-fields="rawHex">${editable(kind, "rawHex", rawHex, { className: "fd-hex", label: "Raw record bytes" })}</div>
    </details>
  `;
}

function formRow(label: string, markFields: string, value: string): string {
  return `<span class="md-label" data-mark-fields="${escapeHtml(markFields)}|rawHex">${escapeHtml(label)}</span><span class="md-value">${value}</span>`;
}

function select(field: string, options: Array<[string, string]>, current: string): string {
  return `<select data-field-name="${field}">${options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function editable(
  kind: FacilityKind,
  field: string,
  value: unknown,
  options: { autofill?: string; type?: string; offset?: number; label?: string; className?: string } = {},
): string {
  const attributes = [
    options.autofill ? `data-autofill="${options.autofill}"` : "",
    options.type ? `data-type="${options.type}"` : "",
    options.offset === undefined ? "" : `data-offset="${options.offset}"`,
    options.label ? `aria-label="${escapeHtml(options.label)}"` : "",
  ].filter(Boolean).join(" ");
  return `<div autocorrect="off" spellcheck="false" contenteditable="true" data-facility-edit="${kind}" data-field-name="${field}" class="${options.className ?? ""}" ${attributes}>${escapeHtml(String(value ?? ""))}</div>`;
}

function hasValue(name: string): boolean {
  return Boolean(name) && !/^(none|-+|\?+|0)$/iu.test(name.trim());
}
