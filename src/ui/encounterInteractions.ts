import {
  copyEncounterData,
  copyEncounterSeason,
  encounterMatchesSearch,
  getEncounterRecord,
  updateEncounterField,
  type EncounterGroup,
  type EncounterSeason,
} from "../pokeweb/encounterModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";

export type EncounterInteractionOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderPanel: (encounterId: number, season: EncounterSeason, group: EncounterGroup) => string;
  renderRow: (encounterId: number) => string;
};

type EncounterOpenState = { group?: EncounterGroup; season?: EncounterSeason };
type EncounterRootState = HTMLElement & {
  __encounterOptions?: EncounterInteractionOptions;
  __encounterProject?: ProjectState;
  __encounterOpenState?: Map<number, EncounterOpenState>;
};

export function attachEncounterInteractions(root: HTMLElement, project: ProjectState, options: EncounterInteractionOptions): void {
  const stateRoot = root as EncounterRootState;
  stateRoot.__encounterOptions = options;
  stateRoot.__encounterProject = project;
  stateRoot.__encounterOpenState = new Map();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterEncounters(root, project, searchInput?.value ?? "");
    stripeEncounterRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-autocomplete], .suggestions")) return;

    const card = target.closest<HTMLElement>(".encounter-card");
    if (!card) return;

    const copyAction = target.closest<HTMLButtonElement>("[data-encounter-copy]");
    if (copyAction) {
      const encounterId = Number(card.dataset.index);
      const toolbar = copyAction.closest<HTMLElement>(".encounter-copy-toolbar");
      const input = toolbar?.querySelector<HTMLInputElement>(".encounter-copy-source");
      const sourceValue = input?.value.trim() ?? "";
      const sourceEncounterId = sourceValue === "" ? Number.NaN : Number(sourceValue);
      if (!Number.isInteger(encounterId)) return;
      try {
        const openState = getOpenState(card);
        copyEncounterData(project, encounterId, sourceEncounterId);
        replaceEncounterRow(root, project, card, encounterId, options, openState);
        options.onDirty?.();
      } catch (error) {
        copyAction.classList.add("invalid");
        if (input) {
          input.classList.add("invalid");
          input.title = error instanceof Error ? error.message : String(error);
          input.focus();
          input.select();
        }
      }
      return;
    }

    const wildGroup = target.closest<HTMLElement>(".encounter-wild-group");
    if (wildGroup?.dataset.openGroup) {
      openEncounterGroup(card, wildGroup.dataset.openGroup as EncounterGroup);
      stripeEncounterRows(root);
      return;
    }

    const expandIcon = target.closest<HTMLElement>(".expand-action");
    if (expandIcon?.dataset.expand) {
      toggleEncounterGroup(card, expandIcon, expandIcon.dataset.expand as EncounterGroup);
      stripeEncounterRows(root);
      return;
    }

    const seasonIcon = target.closest<HTMLElement>(".season-icon");
    if (seasonIcon?.dataset.show) {
      showEncounterSeason(card, seasonIcon.dataset.show as EncounterSeason);
      stripeEncounterRows(root);
    }
  });

  root.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement;
    const seasonIcon = target.closest<HTMLElement>(".season-icon");
    const card = seasonIcon?.closest<HTMLElement>(".encounter-card");
    const encounterId = Number(card?.dataset.index);
    const season = seasonIcon?.dataset.show as EncounterSeason | undefined;
    if (!seasonIcon || !card || !Number.isInteger(encounterId) || !season) return;

    event.preventDefault();
    if (!window.confirm(`Copy ${season} to other seasons in encounter file ${encounterId}?`)) return;

    const openState = getOpenState(card, season);
    copyEncounterSeason(project, encounterId, season);
    replaceEncounterRow(root, project, card, encounterId, options, openState);
    options.onDirty?.();
  });

  installEditableFields(root, project, options);
  runFilter();
}

export function filterEncounters(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#encounters .encounter-card").forEach((card) => {
    const encounterId = Number(card.dataset.index);
    const show = Number.isInteger(encounterId) ? encounterMatchesSearch(getEncounterRecord(project, encounterId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installEditableFields(root: HTMLElement, project: ProjectState, options: EncounterInteractionOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true']").forEach((field) => {
    if (field.dataset.encounterEditInstalled === "true") return;
    field.dataset.encounterEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);

    field.addEventListener("mousedown", () => {
      initialValue = field.textContent?.trim() ?? "";
    });
    field.addEventListener("click", () => selectText(field));
    field.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
    field.addEventListener("focusout", () => {
      const card = field.closest<HTMLElement>(".encounter-card");
      const encounterId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(encounterId) || !fieldName) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        const openState = getOpenState(card);
        const result = updateEncounterField(project, encounterId, fieldName, nextValue);
        field.textContent = String(result.value);
        refreshEncounterRowMain(root, card, encounterId, options, openState);
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });
}

function replaceEncounterRow(
  root: HTMLElement,
  project: ProjectState,
  card: HTMLElement,
  encounterId: number,
  options: EncounterInteractionOptions,
  openState: EncounterOpenState = {},
): void {
  const state = openState.group ? openState : getStoredOpenState(root, encounterId);
  card.outerHTML = options.renderRow(encounterId);
  const nextCard = root.querySelector<HTMLElement>(`.encounter-card[data-index="${encounterId}"]`);
  if (!nextCard) return;
  installEditableFields(nextCard, project, options);
  if (state.group) {
    const icon = nextCard.querySelector<HTMLElement>(`.expand-${state.group}`);
    if (icon) {
      icon.classList.add("-active");
      nextCard.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.add("show-flex");
      const season = state.season ?? "spring";
      ensureEncounterPanel(nextCard, encounterId, season, state.group, options)?.classList.add("show-flex");
      nextCard.querySelector<HTMLElement>(`.season-icon[data-show='${season}']`)?.classList.add("-active");
      rememberOpenState(root, encounterId, { group: state.group, season });
    }
  }
  stripeEncounterRows(root);
}

function refreshEncounterRowMain(
  root: HTMLElement,
  card: HTMLElement,
  encounterId: number,
  options: EncounterInteractionOptions,
  openState: EncounterOpenState = {},
): void {
  const template = document.createElement("template");
  template.innerHTML = options.renderRow(encounterId).trim();
  const nextMain = template.content.querySelector<HTMLElement>(".expanded-field-main");
  const currentMain = card.querySelector<HTMLElement>(":scope > .expanded-field-main");
  if (!nextMain || !currentMain) return;

  currentMain.replaceWith(nextMain);
  if (openState.group) {
    nextMain.querySelector<HTMLElement>(`.expand-${openState.group}`)?.classList.add("-active");
    nextMain.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.add("show-flex");
    const season = openState.season ?? "spring";
    nextMain.querySelector<HTMLElement>(`.season-icon[data-show='${season}']`)?.classList.add("-active");
    rememberOpenState(root, encounterId, { group: openState.group, season });
  }
  stripeEncounterRows(root);
}

function toggleEncounterGroup(card: HTMLElement, icon: HTMLElement, group: EncounterGroup): void {
  const encounterId = Number(card.dataset.index);
  if (!Number.isInteger(encounterId)) return;
  const target = ensureEncounterPanel(card, encounterId, "spring", group, getOptions(card));
  if (!target) return;
  const alreadyOpen = icon.classList.contains("-active") && card.querySelector(`.expanded-${group}.show-flex`) !== null;
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".expand-action, .season-icon").forEach((item) => item.classList.remove("-active"));
  card.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.remove("show-flex");

  if (!alreadyOpen) {
    target.classList.add("show-flex");
    icon.classList.add("-active");
    card.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.add("show-flex");
    card.querySelector<HTMLElement>(".season-icon[data-show='spring']")?.classList.add("-active");
    rememberOpenState(card, encounterId, { group, season: "spring" });
    scrollRowBelowStickyHeader(card);
  } else {
    clearOpenState(card, encounterId);
  }
}

function openEncounterGroup(card: HTMLElement, group: EncounterGroup): void {
  const encounterId = Number(card.dataset.index);
  if (!Number.isInteger(encounterId)) return;
  const target = ensureEncounterPanel(card, encounterId, "spring", group, getOptions(card));
  if (!target) return;
  const alreadyOpen = card.querySelector<HTMLElement>(`.expand-${group}`)?.classList.contains("-active") === true && target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".expand-action, .season-icon").forEach((item) => item.classList.remove("-active"));
  card.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.remove("show-flex");

  if (alreadyOpen) {
    clearOpenState(card, encounterId);
    return;
  }

  card.querySelector<HTMLElement>(".expanded-tab-icons")?.classList.add("show-flex");
  target.classList.add("show-flex");
  card.querySelector<HTMLElement>(`.expand-${group}`)?.classList.add("-active");
  card.querySelector<HTMLElement>(".season-icon[data-show='spring']")?.classList.add("-active");
  rememberOpenState(card, encounterId, { group, season: "spring" });
  scrollRowBelowStickyHeader(card);
}

function showEncounterSeason(card: HTMLElement, season: EncounterSeason): void {
  const group = card.querySelector<HTMLElement>(".expand-action.-active")?.dataset.expand as EncounterGroup | undefined;
  if (!group) return;
  const encounterId = Number(card.dataset.index);
  if (!Number.isInteger(encounterId)) return;
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
  ensureEncounterPanel(card, encounterId, season, group, getOptions(card))?.classList.add("show-flex");
  card.querySelectorAll<HTMLElement>(".season-icon").forEach((item) => item.classList.remove("-active"));
  card.querySelector<HTMLElement>(`.season-icon[data-show='${season}']`)?.classList.add("-active");
  rememberOpenState(card, encounterId, { group, season });
}

function ensureEncounterPanel(
  card: HTMLElement,
  encounterId: number,
  season: EncounterSeason,
  group: EncounterGroup,
  options: EncounterInteractionOptions,
): HTMLElement | null {
  let panel = card.querySelector<HTMLElement>(`.expanded-${season}.expanded-${group}`);
  if (panel) return panel;
  card.insertAdjacentHTML("beforeend", options.renderPanel(encounterId, season, group));
  panel = card.querySelector<HTMLElement>(`.expanded-${season}.expanded-${group}`);
  if (panel) installEditableFields(panel, getProject(card), options);
  return panel;
}

function getOptions(card: HTMLElement): EncounterInteractionOptions {
  return getStateRoot(card).__encounterOptions!;
}

function getProject(card: HTMLElement): ProjectState {
  return getStateRoot(card).__encounterProject!;
}

function getOpenState(card: HTMLElement, fallbackSeason?: EncounterSeason): EncounterOpenState {
  const encounterId = Number(card.dataset.index);
  const storedState = Number.isInteger(encounterId) ? getStoredOpenState(card, encounterId) : {};
  const group =
    (card.querySelector<HTMLElement>(".expand-action.-active")?.dataset.expand as EncounterGroup | undefined) ??
    storedState.group;
  const season =
    (card.querySelector<HTMLElement>(".season-icon.-active")?.dataset.show as EncounterSeason | undefined) ??
    fallbackSeason ??
    storedState.season ??
    undefined;
  return { group, season };
}

function getStateRoot(element: HTMLElement): EncounterRootState {
  return element.closest<HTMLElement>("#content-container") as EncounterRootState;
}

function getOpenStateMap(element: HTMLElement): Map<number, EncounterOpenState> {
  const root = getStateRoot(element);
  root.__encounterOpenState ??= new Map();
  return root.__encounterOpenState;
}

function rememberOpenState(element: HTMLElement, encounterId: number, state: Required<EncounterOpenState>): void {
  getOpenStateMap(element).set(encounterId, state);
}

function getStoredOpenState(element: HTMLElement, encounterId: number): EncounterOpenState {
  return getOpenStateMap(element).get(encounterId) ?? {};
}

function clearOpenState(element: HTMLElement, encounterId: number): void {
  getOpenStateMap(element).delete(encounterId);
}

function stripeEncounterRows(root: HTMLElement): void {
  const visible = [...root.querySelectorAll<HTMLElement>("#encounters .encounter-card")].filter((card) => card.style.display !== "none");
  visible.forEach((card, index) => {
    const rowColor = index % 2 === 0 ? "#282a36" : "#383a59";
    const contentColor = index % 2 === 0 ? "#383a59" : "#282a36";
    card.style.background = rowColor;
    card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((content) => {
      content.style.background = contentColor;
    });
  });
}

function installAutocomplete(field: HTMLElement, autofills: Record<string, string[]>): void {
  const key = field.dataset.autofill;
  if (!key || field.parentElement?.hasAttribute("data-autocomplete")) return;
  const values = autofills[key] ?? [];
  if (values.length === 0) return;

  const host = document.createElement("span");
  host.setAttribute("data-autocomplete", "");
  field.before(host);
  host.append(field);

  const suggestions = document.createElement("div");
  suggestions.className = "suggestions";
  suggestions.hidden = true;
  host.append(suggestions);

  const render = () => {
    const query = field.textContent?.trim().toLowerCase() ?? "";
    if (!query) {
      suggestions.hidden = true;
      return;
    }
    const matches = values.filter((value) => value.toLowerCase().includes(query)).slice(0, 12);
    suggestions.innerHTML = matches.map((value) => `<div>${escapeHtml(value)}</div>`).join("");
    suggestions.hidden = matches.length === 0;
  };

  field.addEventListener("input", render);
  field.addEventListener("focus", render);
  field.addEventListener("blur", () => {
    window.setTimeout(() => {
      suggestions.hidden = true;
    }, 150);
  });
  suggestions.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.parentElement !== suggestions) return;
    event.preventDefault();
    event.stopPropagation();
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    field.blur();
  });
  suggestions.addEventListener("click", (event) => event.stopPropagation());
}
