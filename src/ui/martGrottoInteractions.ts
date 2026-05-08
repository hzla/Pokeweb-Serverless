import {
  getGrottoRecord,
  getMartRecord,
  grottoMatchesSearch,
  martMatchesSearch,
  updateGrottoField,
  updateGrottoOddsField,
  updateMartField,
} from "../pokeweb/martGrottoModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";

type MartOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderPanel: (martId: number) => string;
};

type GrottoOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderRow: (grottoId: number) => string;
  renderPanel: (grottoId: number) => string;
};

type GrottoOddsOptions = {
  onDirty?: () => void;
};

export function attachMartInteractions(root: HTMLElement, project: ProjectState, options: MartOptions): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterMarts(root, project, searchInput?.value ?? "");
    stripeRows(root, "#marts .mart-card");
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".mart-card");
    const martId = Number(card?.dataset.index);
    const icon = target.closest<HTMLElement>(".expand-action");
    if (!card || !Number.isInteger(martId) || !icon) return;
    if (!card.querySelector(".expanded-mart")) {
      card.insertAdjacentHTML("beforeend", options.renderPanel(martId));
      installMartEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-mart", icon);
    stripeRows(root, "#marts .mart-card");
  });

  installMartEditableFields(root, project, options);
  runFilter();
}

export function attachGrottoInteractions(root: HTMLElement, project: ProjectState, options: GrottoOptions): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterGrottos(root, project, searchInput?.value ?? "");
    stripeRows(root, "#grottos .grotto-card");
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".grotto-card");
    const grottoId = Number(card?.dataset.index);
    const icon = target.closest<HTMLElement>(".expand-action");
    if (!card || !Number.isInteger(grottoId) || !icon) return;
    if (!card.querySelector(".expanded-grotto")) {
      card.insertAdjacentHTML("beforeend", options.renderPanel(grottoId));
      installGrottoEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-grotto", icon);
    stripeRows(root, "#grottos .grotto-card");
  });

  installGrottoEditableFields(root, project, options);
  runFilter();
}

export function attachGrottoOddsInteractions(root: HTMLElement, project: ProjectState, options: GrottoOddsOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='grotto']").forEach((field) => {
    if (field.dataset.grottoOddsEditInstalled === "true") return;
    field.dataset.grottoOddsEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installEditableHandlers(
      field,
      () => {
        const fieldName = field.dataset.fieldName;
        if (!fieldName) return false;
        const result = updateGrottoOddsField(project, fieldName, field.textContent?.trim() ?? "");
        field.textContent = String(result.value);
        return true;
      },
      () => initialValue,
      (value) => {
        initialValue = value;
      },
      options.onDirty,
    );
  });
  stripeRows(root, "#grotto-odds .grotto-odds-card");
}

function filterMarts(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#marts .mart-card").forEach((card) => {
    const martId = Number(card.dataset.index);
    const show = Number.isInteger(martId) ? martMatchesSearch(getMartRecord(project, martId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function filterGrottos(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#grottos .grotto-card").forEach((card) => {
    const grottoId = Number(card.dataset.index);
    const show = Number.isInteger(grottoId) ? grottoMatchesSearch(getGrottoRecord(project, grottoId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installMartEditableFields(root: HTMLElement, project: ProjectState, options: MartOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='mart']").forEach((field) => {
    if (field.dataset.martEditInstalled === "true") return;
    field.dataset.martEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);
    installEditableHandlers(
      field,
      () => {
        const card = field.closest<HTMLElement>(".mart-card");
        const martId = Number(card?.dataset.index);
        const fieldName = field.dataset.fieldName;
        if (!card || !Number.isInteger(martId) || !fieldName) return false;
        const result = updateMartField(project, martId, fieldName, field.textContent?.trim() ?? "");
        field.textContent = String(result.value);
        card.querySelector<HTMLElement>(".mart-inv")!.textContent = getMartRecord(project, martId).inventory;
        return true;
      },
      () => initialValue,
      (value) => {
        initialValue = value;
      },
      options.onDirty,
    );
  });
}

function installGrottoEditableFields(root: HTMLElement, project: ProjectState, options: GrottoOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='grotto']").forEach((field) => {
    if (field.dataset.grottoEditInstalled === "true") return;
    field.dataset.grottoEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);
    installEditableHandlers(
      field,
      () => {
        const card = field.closest<HTMLElement>(".grotto-card");
        const grottoId = Number(card?.dataset.index);
        const fieldName = field.dataset.fieldName;
        if (!card || !Number.isInteger(grottoId) || !fieldName) return false;
        const open = card.querySelector(".expanded-grotto.show-flex") !== null;
        updateGrottoField(project, grottoId, fieldName, field.textContent?.trim() ?? "");
        card.outerHTML = options.renderRow(grottoId);
        const nextCard = root.querySelector<HTMLElement>(`.grotto-card[data-index="${grottoId}"]`);
        if (nextCard && open) {
          nextCard.insertAdjacentHTML("beforeend", options.renderPanel(grottoId));
          nextCard.querySelector<HTMLElement>(".expanded-grotto")?.classList.add("show-flex");
          nextCard.querySelector<HTMLElement>(".expand-action")?.classList.add("-active");
          installGrottoEditableFields(nextCard, project, options);
        }
        stripeRows(root, "#grottos .grotto-card");
        return true;
      },
      () => initialValue,
      (value) => {
        initialValue = value;
      },
      options.onDirty,
    );
  });
}

function installEditableHandlers(
  field: HTMLElement,
  commit: () => boolean,
  getInitial: () => string,
  setInitial: (value: string) => void,
  onDirty?: () => void,
): void {
  field.addEventListener("mousedown", () => setInitial(field.textContent?.trim() ?? ""));
  field.addEventListener("click", () => selectText(field));
  field.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    }
  });
  field.addEventListener("focusout", () => {
    const nextValue = field.textContent?.trim() ?? "";
    field.textContent = nextValue;
    if (nextValue === getInitial()) return;
    try {
      if (commit()) {
        field.classList.remove("invalid");
        field.style.border = "";
        onDirty?.();
      }
    } catch {
      field.textContent = getInitial();
      field.classList.add("invalid");
      field.style.border = "1px solid red";
    }
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
  field.addEventListener("blur", () => window.setTimeout(() => (suggestions.hidden = true), 150));
  suggestions.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!target || target.parentElement !== suggestions) return;
    event.preventDefault();
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    field.blur();
  });
}

function togglePanel(card: HTMLElement, selector: string, icon: HTMLElement): void {
  const target = card.querySelector<HTMLElement>(selector);
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    icon.classList.add("-active");
    scrollRowBelowStickyHeader(card);
  }
}

function stripeRows(root: HTMLElement, selector: string): void {
  const visible = [...root.querySelectorAll<HTMLElement>(selector)].filter((card) => card.style.display !== "none");
  visible.forEach((card, index) => {
    const rowColor = index % 2 === 0 ? "#282a36" : "#383a59";
    const contentColor = index % 2 === 0 ? "#383a59" : "#282a36";
    card.style.background = rowColor;
    card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((content) => {
      content.style.background = contentColor;
    });
  });
}
