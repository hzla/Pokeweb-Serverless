import type { ProjectState } from "../pokeweb/projectStore";
import { headerMatchesSearch, updateHeaderField } from "../pokeweb/headerModel";
import { scrollRowBelowStickyHeader, selectText } from "./dom";

export type HeaderInteractionOptions = {
  onDirty?: () => void;
};

export function attachHeaderInteractions(root: HTMLElement, project: ProjectState, options: HeaderInteractionOptions = {}): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");

  const runFilter = () => {
    filterHeaders(root, project, searchInput?.value ?? "");
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.querySelectorAll<HTMLElement>(".expand-action").forEach((icon) => {
    icon.addEventListener("click", () => {
      const card = icon.closest<HTMLElement>(".filterable");
      const target = card?.querySelector<HTMLElement>(`.expanded-${icon.dataset.expand}`);
      if (!card || !target) return;
      const alreadyOpen = target.classList.contains("show-flex");
      card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((content) => content.classList.remove("show-flex"));
      card.querySelectorAll<HTMLElement>(".card-icon, .expand-action").forEach((item) => item.classList.remove("-active"));
      if (!alreadyOpen) {
        target.classList.add("show-flex");
        icon.classList.add("-active");
        scrollRowBelowStickyHeader(card);
      }
      stripeRows(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[contenteditable='true']").forEach((field) => {
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, project);

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
      const card = field.closest<HTMLElement>(".filterable");
      const rowId = Number(card?.dataset.index);
      const name = field.dataset.fieldName;
      if (!rowId || !name) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        const result = updateHeaderField(project, rowId, name, nextValue);
        field.textContent = String(result.value);
        field.classList.remove("invalid");
        field.style.border = "";

        if (name === "location_name") {
          const row = project.headers?.rows[rowId];
          const locationIdField = card?.querySelector<HTMLElement>("[data-field-name='location_name_id']");
          if (row && locationIdField) locationIdField.textContent = String(row.location_name_id);
        }
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });

  runFilter();
}

export function filterHeaders(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  if (!project.headers) return [];
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#headers .filterable").forEach((card) => {
    const rowId = Number(card.dataset.index);
    const row = project.headers?.rows[rowId];
    const show = row ? headerMatchesSearch(row, searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

export function stripeRows(root: HTMLElement): void {
  const visible = [...root.querySelectorAll<HTMLElement>(".filterable")].filter((card) => card.style.display !== "none");
  visible.forEach((card, index) => {
    const content = card.querySelector<HTMLElement>(".expanded-card-content");
    const rowColor = index % 2 === 0 ? "#282a36" : "#383a59";
    const contentColor = index % 2 === 0 ? "#383a59" : "#282a36";
    card.style.background = rowColor;
    if (content) content.style.background = contentColor;
  });
}

function installAutocomplete(field: HTMLElement, project: ProjectState): void {
  if (!field.dataset.autofill) return;
  const values = project.texts.banks.locations ?? [];
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
    suggestions.innerHTML = matches.map((value) => `<div>${value}</div>`).join("");
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
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    field.blur();
  });
}
