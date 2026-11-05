import {
  getMoveRecord,
  getMoveGeneration,
  moveMatchesSearch,
  updateMoveEffectId,
  updateMoveField,
  type FieldUpdateResult,
} from "../pokeweb/moveItemModel";
import { updateMoveDescription, updateMoveTextName } from "../pokeweb/moveTextModel";
import { installLazyDescriptionPreview } from "./lazyDescriptionPreview";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";
import { getMoveListFilters } from "./moveListFilters";

export type MoveAnimationEditorOptions = {
  onDirty?: () => void;
  onTestMove?: (moveId: number, scriptText: string) => Promise<void>;
};

export type MoveOptions = MoveAnimationEditorOptions & {
  onOpenMoveAnimation?: (moveId: number) => void;
  /** Called with the visible list rows after every search or filter change. */
  onFiltered?: (visible: HTMLElement[]) => void;
  autofills: Record<string, string[]>;
  renderExpanded: (moveId: number) => string;
  renderTextPanel?: (moveId: number) => string;
};

const moveInteractionInstallations = new WeakMap<HTMLElement, AbortController>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function attachMoveInteractions(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  moveInteractionInstallations.get(root)?.abort();
  const controller = new AbortController();
  moveInteractionInstallations.set(root, controller);
  const filters = getMoveListFilters(project);
  const activeCategories = filters.categories;
  const activeTypes = filters.types;
  const activeGenerations = filters.generations;
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  if (searchInput) searchInput.value = filters.searchText;

  const runFilter = () => {
    filters.searchText = searchInput?.value ?? "";
    const visible = filterMoves(root, project, filters.searchText, activeCategories, activeTypes, activeGenerations);
    stripeRows(root);
    options.onFiltered?.(visible);
  };

  searchButton?.addEventListener("click", runFilter, { signal: controller.signal });
  searchInput?.addEventListener("input", runFilter, { signal: controller.signal });
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  }, { signal: controller.signal });

  root.querySelectorAll<HTMLButtonElement>(".cat-filters [data-mcat]").forEach((button) => {
    button.classList.toggle("-active", activeCategories.has(button.dataset.mcat ?? ""));
    button.setAttribute("aria-pressed", String(activeCategories.has(button.dataset.mcat ?? "")));
    button.addEventListener("click", () => {
      toggleSet(activeCategories, button.dataset.mcat ?? "");
      button.classList.toggle("-active", activeCategories.has(button.dataset.mcat ?? ""));
      button.setAttribute("aria-pressed", String(activeCategories.has(button.dataset.mcat ?? "")));
      runFilter();
    }, { signal: controller.signal });
  });

  root.querySelectorAll<HTMLButtonElement>(".type-filters [data-ptype]").forEach((button) => {
    button.classList.toggle("-active", activeTypes.has(button.dataset.ptype ?? ""));
    button.setAttribute("aria-pressed", String(activeTypes.has(button.dataset.ptype ?? "")));
    button.addEventListener("click", () => {
      toggleSet(activeTypes, button.dataset.ptype ?? "");
      button.classList.toggle("-active", activeTypes.has(button.dataset.ptype ?? ""));
      button.setAttribute("aria-pressed", String(activeTypes.has(button.dataset.ptype ?? "")));
      runFilter();
    }, { signal: controller.signal });
  });

  root.querySelectorAll<HTMLButtonElement>(".gen-filters [data-gen]").forEach(button => {
    const generation = Number(button.dataset.gen);
    button.classList.toggle("-active", activeGenerations.has(generation));
    button.setAttribute("aria-pressed", String(activeGenerations.has(generation)));
    button.addEventListener("click", () => {
      if (activeGenerations.has(generation)) activeGenerations.delete(generation);
      else activeGenerations.add(generation);
      button.classList.toggle("-active", activeGenerations.has(generation));
      button.setAttribute("aria-pressed", String(activeGenerations.has(generation)));
      runFilter();
    }, { signal: controller.signal });
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
      } catch {
        category.classList.add("invalid");
      }
      return;
    }

    const animationRowToggle = target.closest<HTMLButtonElement>(".move-animation-row-toggle");
    if (animationRowToggle) {
      options.onOpenMoveAnimation?.(moveId);
      return;
    }

    const icon = target.closest<HTMLElement>(".expand-action");
    if (!icon) return;
    const expandKind = icon.dataset.expand;
    if (expandKind === "move-text") {
      if (!card.querySelector(".expanded-move-texts") && options.renderTextPanel) {
        card.insertAdjacentHTML("beforeend", options.renderTextPanel(moveId));
        installMoveTextFields(card, project, options);
      }
      togglePanel(card, ".expanded-move-texts", icon);
      stripeRows(root);
      return;
    }
    if (!card.querySelector(".expanded-move")) {
      card.insertAdjacentHTML("beforeend", options.renderExpanded(moveId));
      installMoveEditableFields(card, project, options);
    }
    togglePanel(card, ".expanded-move", icon);
    stripeRows(root);
  }, { signal: controller.signal });

  root.addEventListener("change", (event) => {
    const checkbox = event.target as HTMLInputElement;
    if (!checkbox.matches("input.move-native-flag")) return;
    const card = checkbox.closest<HTMLElement>(".move-card");
    const moveId = Number(card?.dataset.index);
    const fieldName = checkbox.dataset.fieldName;
    if (!card || !Number.isInteger(moveId) || !fieldName) return;
    try {
      updateMoveField(project, moveId, fieldName, checkbox.checked);
      checkbox.classList.remove("invalid");
      checkbox.removeAttribute("title");
      options.onDirty?.();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      checkbox.classList.add("invalid");
      checkbox.title = errorMessage(error);
    }
  }, { signal: controller.signal });

  installMoveEditableFields(root, project, options);
  runFilter();
}

export function installMoveTextFields(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
  root.querySelectorAll<HTMLInputElement>(".move-text-name-input").forEach((input) => {
    if (input.dataset.moveTextNameInstalled === "true") return;
    input.dataset.moveTextNameInstalled = "true";
    let initialValue = input.value.trim();
    const commit = () => {
      const card = input.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      updateMoveTextName(project, moveId, input.value);
      refreshMoveTextPanel(card, project, moveId, options);
      syncMoveNameInRow(card, project, moveId);
      return true;
    };
    input.addEventListener("focus", () => {
      initialValue = input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("change", () => {
      if (input.value.trim() === initialValue) return;
      try {
        if (commit()) {
          input.classList.remove("invalid");
          options.onDirty?.();
        }
      } catch (error) {
        input.value = initialValue;
        input.classList.add("invalid");
        setMoveTextStatus(input, error instanceof Error ? error.message : String(error), true);
      }
    });
  });

  root.querySelectorAll<HTMLTextAreaElement>(".move-text-description-input").forEach((textarea) => {
    if (textarea.dataset.moveTextDescriptionInstalled === "true") return;
    textarea.dataset.moveTextDescriptionInstalled = "true";
    const details = textarea.closest(".expanded-move-texts")?.querySelector<HTMLDetailsElement>("[data-description-preview]");
    const preview = details ? installLazyDescriptionPreview(project, details, "move", () => textarea.value) : undefined;
    textarea.addEventListener("input", () => preview?.refresh());
    let initialValue = textarea.value;
    const commit = () => {
      const card = textarea.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      updateMoveDescription(project, moveId, textarea.value);
      refreshMoveTextPanel(card, project, moveId, options);
      return true;
    };
    textarea.addEventListener("focus", () => {
      initialValue = textarea.value;
    });
    textarea.addEventListener("change", () => {
      if (textarea.value === initialValue) return;
      try {
        if (commit()) {
          textarea.classList.remove("invalid");
          options.onDirty?.();
        }
      } catch (error) {
        textarea.value = initialValue;
        textarea.classList.add("invalid");
        setMoveTextStatus(textarea, error instanceof Error ? error.message : String(error), true);
      }
    });
  });
}

function refreshMoveTextPanel(card: HTMLElement, project: ProjectState, moveId: number, options: MoveOptions): void {
  const panel = card.querySelector<HTMLElement>(".expanded-move-texts");
  if (!panel || !options.renderTextPanel) return;
  const wasOpen = panel.classList.contains("show-flex");
  const previewOpen = Boolean(panel.querySelector<HTMLDetailsElement>("[data-description-preview]")?.open);
  panel.outerHTML = options.renderTextPanel(moveId);
  const nextPanel = card.querySelector<HTMLElement>(".expanded-move-texts");
  if (nextPanel && wasOpen) nextPanel.classList.add("show-flex");
  const details = nextPanel?.querySelector<HTMLDetailsElement>("[data-description-preview]");
  if (details) details.open = previewOpen;
  if (nextPanel) installMoveTextFields(nextPanel, project, options);
}

function setMoveTextStatus(field: HTMLElement, message: string, error = false): void {
  const panel = field.closest<HTMLElement>(".expanded-move-texts");
  const status = panel?.querySelector<HTMLElement>(".move-text-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("-error", error);
}

function filterMoves(root: HTMLElement, project: ProjectState, searchText: string, categories: Set<string>, types: Set<string>, generations: Set<number>): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("[data-move-row]").forEach((card) => {
    const moveId = Number(card.dataset.moveRow);
    const generationMatches = generations.size === 0 || generations.has(getMoveGeneration(project, moveId) ?? 0);
    const show = Number.isInteger(moveId) && generationMatches && moveMatchesSearch(getMoveRecord(project, moveId), searchText, categories, types);
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

export function installMoveEditableFields(root: HTMLElement, project: ProjectState, options: MoveOptions): void {
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
    });
  });

  root.querySelectorAll<HTMLInputElement>(".move-effect-id-input").forEach((input) => {
    if (input.dataset.moveEffectIdInstalled === "true") return;
    input.dataset.moveEffectIdInstalled = "true";
    let initialValue = input.value.trim();
    const commit = () => {
      const card = input.closest<HTMLElement>(".move-card");
      const moveId = Number(card?.dataset.index);
      if (!card || !Number.isInteger(moveId)) return false;
      const result = updateMoveEffectId(project, moveId, input.value.trim());
      input.value = String(result.rawValue);
      syncMoveRow(card, result, "effect");
      return true;
    };
    input.addEventListener("focus", () => {
      initialValue = input.value.trim();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("change", () => {
      const nextValue = input.value.trim();
      if (nextValue === initialValue) return;
      try {
        if (commit()) {
          input.classList.remove("invalid");
          initialValue = input.value.trim();
        }
      } catch {
        input.value = initialValue;
        input.classList.add("invalid");
      }
    });
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
  if (fieldName === "effect") {
    const effectName = card.querySelector<HTMLElement>("[contenteditable='true'][data-field-name='effect']");
    if (effectName) {
      effectName.textContent = String(result.value);
      effectName.title = String(result.value);
    }
    const effectId = card.querySelector<HTMLInputElement>(".move-effect-id-input");
    if (effectId) effectId.value = String(result.rawValue);
  }
}

function syncMoveNameInRow(card: HTMLElement, project: ProjectState, moveId: number): void {
  const main = card.querySelector<HTMLElement>(":scope > .expanded-field-main");
  const nameField = main?.querySelector<HTMLElement>(".move-name");
  if (!nameField) return;
  const move = getMoveRecord(project, moveId);
  nameField.textContent = `${move.id} - ${String(move.readable.name ?? `Move ${move.id}`)}`;
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
  // On focus the picker lists every option (current one marked); typing filters it.
  let focusValue = "";
  const render = () => {
    const query = field.textContent?.trim().toLowerCase() ?? "";
    const browsing = query === "" || query === focusValue.toLowerCase();
    const matches = browsing ? values : values.filter((value) => value.toLowerCase().includes(query)).slice(0, 50);
    suggestions.innerHTML = matches.map((value) => `<div${value.toLowerCase() === query ? ' class="is-current"' : ""}>${escapeHtml(value)}</div>`).join("");
    suggestions.hidden = matches.length === 0;
    const current = browsing ? suggestions.querySelector<HTMLElement>(".is-current") : null;
    suggestions.scrollTop = current ? Math.max(0, current.offsetTop - suggestions.clientHeight / 2) : 0;
  };
  field.addEventListener("input", render);
  field.addEventListener("focus", () => {
    focusValue = field.textContent?.trim() ?? "";
    render();
  });
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
