import { getTmEntries, syncAllTmIcons, tmMatchesSearch, updateTmMove, type TmEntry } from "../pokeweb/tmModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

type TmOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderRow: (entry: TmEntry) => string;
};

export function attachTmInteractions(root: HTMLElement, project: ProjectState, options: TmOptions): void {
  const activeCategories = new Set<string>();
  const activeTypes = new Set<string>();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const syncButton = root.querySelector<HTMLButtonElement>("#sync-tm-icons-btn");
  const syncStatus = root.querySelector<HTMLElement>("#tm-sync-status");

  const runFilter = () => {
    filterTms(root, project, searchInput?.value ?? "", activeCategories, activeTypes);
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  syncButton?.addEventListener("click", () => {
    try {
      const changed = syncAllTmIcons(project);
      if (syncStatus) {
        syncStatus.textContent = changed > 0 ? `Synced ${changed} icon${changed === 1 ? "" : "s"}` : "Icons already synced";
        syncStatus.classList.remove("-error");
      }
      if (changed > 0) options.onDirty?.();
    } catch (error) {
      if (syncStatus) {
        syncStatus.textContent = error instanceof Error ? error.message : String(error);
        syncStatus.classList.add("-error");
      }
    }
  });

  root.querySelectorAll<HTMLButtonElement>(".cat-filters [data-mcat]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeCategories, button.dataset.mcat ?? "");
      button.classList.toggle("-active", activeCategories.has(button.dataset.mcat ?? ""));
      runFilter();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".type-filters [data-ptype]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSet(activeTypes, button.dataset.ptype ?? "");
      button.classList.toggle("-active", activeTypes.has(button.dataset.ptype ?? ""));
      runFilter();
    });
  });

  installEditableFields(root, project, options);
  runFilter();
}

function filterTms(root: HTMLElement, project: ProjectState, searchText: string, categories: Set<string>, types: Set<string>): HTMLElement[] {
  const byField = new Map(getTmEntries(project).map((entry) => [entry.field, entry]));
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#moves .tm-card").forEach((card) => {
    const entry = byField.get(card.dataset.tmField ?? "");
    const show = entry ? tmMatchesSearch(entry, searchText, categories, types) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installEditableFields(root: HTMLElement, project: ProjectState, options: TmOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='tm']").forEach((field) => {
    if (field.dataset.tmEditInstalled === "true") return;
    field.dataset.tmEditInstalled = "true";
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
      const card = field.closest<HTMLElement>(".tm-card");
      const fieldName = field.dataset.fieldName;
      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (!card || !fieldName || nextValue === initialValue) return;
      try {
        updateTmMove(project, fieldName, nextValue);
        const entry = getTmEntries(project).find((candidate) => candidate.field === fieldName);
        if (entry) {
          const replacement = htmlToElement(options.renderRow(entry));
          card.replaceWith(replacement);
          installEditableFields(replacement, project, options);
        }
        stripeRows(root);
        field.classList.remove("invalid");
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
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

function htmlToElement(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

function toggleSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
