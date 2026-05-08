import {
  getItemRecord,
  getMoveRecord,
  itemMatchesSearch,
  moveMatchesSearch,
  updateItemField,
  updateMoveField,
  type FieldUpdateResult,
} from "../pokeweb/moveItemModel";
import { decompileMoveAnimation, hasMoveAnimationScript, updateMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

type MoveOptions = {
  onDirty?: () => void;
  autofills: Record<string, string[]>;
  renderExpanded: (moveId: number) => string;
};

type ItemOptions = {
  onDirty?: () => void;
  renderExpanded: (itemId: number) => string;
};

export function attachMoveInteractions(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  const activeCategories = new Set<string>();
  const activeTypes = new Set<string>();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");

  const runFilter = () => {
    filterMoves(root, project, searchInput?.value ?? "", activeCategories, activeTypes);
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
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

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".move-card");
    const moveId = Number(card?.dataset.index);
    if (!card || !Number.isInteger(moveId)) return;

    const category = target.closest<HTMLElement>(".move-cat img");
    if (category?.dataset.value) {
      try {
        const result = updateMoveField(project, moveId, "category", category.dataset.value);
        syncMoveRow(card, result, "category");
        options.onDirty?.();
      } catch {
        category.classList.add("invalid");
      }
      return;
    }

    const prop = target.closest<HTMLElement>(".move-prop");
    if (prop?.dataset.fieldName) {
      const next = !prop.classList.contains("-active");
      updateMoveField(project, moveId, prop.dataset.fieldName, next);
      prop.classList.toggle("-active", next);
      options.onDirty?.();
      return;
    }

    const animationToggle = target.closest<HTMLButtonElement>(".move-animation-toggle");
    if (animationToggle) {
      toggleMoveAnimationEditor(card, project, moveId, options);
      return;
    }

    const icon = target.closest<HTMLElement>(".expand-action");
    if (!icon) return;
    if (!card.querySelector(".expanded-move")) {
      card.insertAdjacentHTML("beforeend", options.renderExpanded(moveId));
      installMoveEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-move", icon);
    stripeRows(root);
  });

  installMoveEditableFields(root, project, options);
  runFilter();
}

function toggleMoveAnimationEditor(card: HTMLElement, project: ProjectState, moveId: number, options: MoveOptions): void {
  const panel = card.querySelector<HTMLElement>(".move-animation-editor");
  if (!panel) return;
  if (panel.classList.contains("show-flex")) {
    panel.classList.remove("show-flex");
    return;
  }

  if (panel.dataset.loaded !== "true") {
    panel.dataset.loaded = "true";
    if (!hasMoveAnimationScript(project, moveId)) {
      panel.innerHTML = `<div class="move-animation-error">Move animation NARCs were not loaded for this ROM session.</div>`;
    } else {
      try {
        const script = decompileMoveAnimation(project, moveId);
        panel.innerHTML = renderMoveAnimationEditor(script);
        installMoveAnimationEditor(panel, project, moveId, options);
      } catch (error) {
        panel.innerHTML = `<div class="move-animation-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
      }
    }
  }

  panel.classList.add("show-flex");
}

function renderMoveAnimationEditor(script: string): string {
  return `
    <div class="move-animation-toolbar">
      <button class="script-btn move-animation-apply" type="button">Apply Script</button>
      <button class="script-btn move-animation-revert" type="button">Revert</button>
      <div class="move-animation-status"></div>
    </div>
    <textarea class="move-animation-text" spellcheck="false">${escapeHtml(script)}</textarea>
  `;
}

function installMoveAnimationEditor(panel: HTMLElement, project: ProjectState, moveId: number, options: MoveOptions): void {
  const textarea = panel.querySelector<HTMLTextAreaElement>(".move-animation-text");
  const status = panel.querySelector<HTMLElement>(".move-animation-status");
  let lastGood = textarea?.value ?? "";
  panel.querySelector<HTMLButtonElement>(".move-animation-apply")?.addEventListener("click", () => {
    if (!textarea) return;
    try {
      updateMoveAnimationScript(project, moveId, textarea.value);
      lastGood = textarea.value;
      if (status) {
        status.textContent = "Applied";
        status.classList.remove("-error");
      }
      textarea.classList.remove("invalid");
      options.onDirty?.();
    } catch (error) {
      if (status) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("-error");
      }
      textarea.classList.add("invalid");
    }
  });
  panel.querySelector<HTMLButtonElement>(".move-animation-revert")?.addEventListener("click", () => {
    if (!textarea) return;
    textarea.value = lastGood;
    textarea.classList.remove("invalid");
    if (status) {
      status.textContent = "";
      status.classList.remove("-error");
    }
  });
}

export function attachItemInteractions(root: HTMLElement, project: ProjectState, options: ItemOptions): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterItems(root, project, searchInput?.value ?? "");
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>(".item-card");
    const itemId = Number(card?.dataset.index);
    const icon = target.closest<HTMLElement>(".expand-action");
    if (!card || !Number.isInteger(itemId) || !icon) return;
    if (!card.querySelector(".expanded-item")) {
      card.insertAdjacentHTML("beforeend", options.renderExpanded(itemId));
      installItemEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-item", icon);
    stripeRows(root);
  });

  installItemEditableFields(root, project, options);
  runFilter();
}

function filterMoves(root: HTMLElement, project: ProjectState, searchText: string, categories: Set<string>, types: Set<string>): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#moves .move-card").forEach((card) => {
    const moveId = Number(card.dataset.index);
    const show = Number.isInteger(moveId) ? moveMatchesSearch(getMoveRecord(project, moveId), searchText, categories, types) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function filterItems(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#items .item-card").forEach((card) => {
    const itemId = Number(card.dataset.index);
    const show = Number.isInteger(itemId) ? itemMatchesSearch(getItemRecord(project, itemId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installMoveEditableFields(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='move']").forEach((field) => {
    if (field.dataset.moveEditInstalled === "true") return;
    field.dataset.moveEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installAutocomplete(field, options.autofills);
    installEditableHandlers(field, () => {
      const card = field.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(moveId) || !fieldName) return false;
      const result = updateMoveField(project, moveId, fieldName, field.textContent?.trim() ?? "");
      field.textContent = String(result.value);
      syncMoveRow(card, result, fieldName);
      return true;
    }, () => initialValue, (value) => {
      initialValue = value;
    }, options.onDirty);
  });
}

function installItemEditableFields(root: HTMLElement, project: ProjectState, options: ItemOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true'][data-narc='item']").forEach((field) => {
    if (field.dataset.itemEditInstalled === "true") return;
    field.dataset.itemEditInstalled = "true";
    let initialValue = field.textContent?.trim() ?? "";
    installEditableHandlers(field, () => {
      const card = field.closest<HTMLElement>(".item-card");
      const itemId = Number(card?.dataset.index);
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(itemId) || !fieldName) return false;
      const result = updateItemField(project, itemId, fieldName, field.textContent?.trim() ?? "");
      field.textContent = String(result.value);
      return true;
    }, () => initialValue, (value) => {
      initialValue = value;
    }, options.onDirty);
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

function syncMoveRow(card: HTMLElement, result: FieldUpdateResult, fieldName: string): void {
  if (fieldName === "type") {
    const typeField = card.querySelector<HTMLElement>("[data-field-name='type']");
    if (typeField) {
      [...typeField.classList].filter((name) => name.startsWith("-")).forEach((name) => typeField.classList.remove(name));
      typeField.classList.add(`-${String(result.value).toLowerCase()}`, "-active");
      typeField.textContent = String(result.value);
    }
  }
  if (fieldName === "category") {
    card.querySelectorAll<HTMLImageElement>(".move-cat img").forEach((image) => {
      const active = image.dataset.value === String(result.value).toLowerCase();
      image.classList.toggle("chosen", active);
      image.classList.toggle("unchosen", !active);
    });
  }
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

function toggleSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
