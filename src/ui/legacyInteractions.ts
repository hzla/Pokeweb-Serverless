import type { ProjectState } from "../pokeweb/projectStore";
import { HEADER_PACKED_FIELDS, headerMatchesSearch, updateHeaderField, updateHeaderPackedField } from "../pokeweb/headerModel";
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
      if (!card || !rowId || !name) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        if (field.dataset.narc === "header-part") {
          const partKey = field.dataset.partKey;
          if (!partKey) return;
          const result = updateHeaderPackedField(project, rowId, name, partKey, nextValue);
          syncHeaderPackedEditor(card, name, Number(result.value));
        } else {
          const result = updateHeaderField(project, rowId, name, nextValue);
          field.textContent = String(result.value);
          syncHeaderLinkedFields(card, project, rowId);
        }
        field.classList.remove("invalid");
        field.style.border = "";

        if (name === "location_name") {
          const row = project.headers?.rows[rowId];
          const locationIdField = card.querySelector<HTMLElement>("[data-field-name='place_name_id']");
          if (row && locationIdField) locationIdField.textContent = String(row.place_name_id);
        }
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });

  root.querySelectorAll<HTMLInputElement>(".header-flag-checkbox").forEach((checkbox) => {
    if (checkbox.dataset.headerFlagInstalled === "true") return;
    checkbox.dataset.headerFlagInstalled = "true";
    checkbox.addEventListener("change", () => {
      const card = checkbox.closest<HTMLElement>(".filterable");
      const rowId = Number(card?.dataset.index);
      const fieldName = checkbox.dataset.fieldName;
      const partKey = checkbox.dataset.partKey;
      if (!card || !Number.isInteger(rowId) || !fieldName || !partKey) return;
      try {
        const result = updateHeaderPackedField(project, rowId, fieldName, partKey, checkbox.checked);
        syncHeaderPackedEditor(card, fieldName, Number(result.value));
        checkbox.classList.remove("invalid");
        options.onDirty?.();
      } catch {
        checkbox.checked = !checkbox.checked;
        checkbox.classList.add("invalid");
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

function syncHeaderLinkedFields(card: HTMLElement, project: ProjectState, rowId: number): void {
  const row = project.headers?.rows[rowId];
  if (!row) return;
  for (const fieldName of [
    "name_icon",
    "name_icon_id",
    "difficulty_level_adjustment",
    "location_name",
    "location_name_id",
    "place_name_id",
    "enc_data_id",
    "encounter_id",
    "wild_id",
    "event_id",
    "map_id",
    "overworlds_id",
    "area_data_id",
    "texture_id",
  ]) {
    const fields = card.querySelectorAll<HTMLElement>(`[contenteditable='true'][data-narc='header'][data-field-name='${fieldName}']`);
    fields.forEach((item) => {
      if (row[fieldName] !== undefined) item.textContent = String(row[fieldName]);
    });
  }
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

function syncHeaderPackedEditor(card: HTMLElement, fieldName: string, rawValue: number): void {
  const packed = HEADER_PACKED_FIELDS[fieldName];
  if (!packed) return;

  const editor = card.querySelector<HTMLElement>(`.header-flag-editor[data-field-name='${CSS.escape(fieldName)}']`);
  if (editor) editor.dataset.rawValue = String(rawValue);

  packed.parts.forEach((part) => {
    const partMax = (1 << part.size) - 1;
    const partValue = (rawValue >> part.offset) & partMax;
    if (part.kind === "checkbox") {
      const checkbox = card.querySelector<HTMLInputElement>(
        `.header-flag-checkbox[data-field-name='${CSS.escape(fieldName)}'][data-part-key='${CSS.escape(part.key)}']`,
      );
      if (checkbox) checkbox.checked = partValue > 0;
      return;
    }

    const valueField = card.querySelector<HTMLElement>(
      `[contenteditable='true'][data-narc='header-part'][data-field-name='${CSS.escape(fieldName)}'][data-part-key='${CSS.escape(part.key)}']`,
    );
    if (valueField) valueField.textContent = String(partValue);
  });
}
