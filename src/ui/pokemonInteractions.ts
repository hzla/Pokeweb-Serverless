import { getPokemonSummaryRecord, pokemonMatchesSearch, updatePokemonField, updatePokemonTmCompatibility } from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

export type PokemonInteractionOptions = {
  onDirty?: () => void;
  onOpenSprites?: (speciesId: number) => void;
  renderExpanded: (speciesId: number) => string;
  autofills: Record<string, string[]>;
};

export function attachPokemonInteractions(root: HTMLElement, project: ProjectState, options: PokemonInteractionOptions): void {
  const activeGenerations = new Set<number>();
  const activeTypes = new Set<string>();
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");

  const runFilter = () => {
    filterPokemon(root, project, searchInput?.value ?? "", activeGenerations, activeTypes);
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.querySelectorAll<HTMLButtonElement>(".gen-filters [data-gen]").forEach((button) => {
    button.addEventListener("click", () => {
      const gen = Number(button.dataset.gen);
      toggleSet(activeGenerations, gen);
      button.classList.toggle("-active", activeGenerations.has(gen));
      runFilter();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".type-filters [data-ptype]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.ptype ?? "";
      toggleSet(activeTypes, type);
      button.classList.toggle("-active", activeTypes.has(type));
      runFilter();
    });
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const spriteAction = target.closest<HTMLElement>(".sprite-editor-action");
    if (spriteAction) {
      const card = spriteAction.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      if (Number.isInteger(speciesId)) options.onOpenSprites?.(speciesId);
      return;
    }

    const tmCell = target.closest<HTMLElement>(".cell.tm[data-kind][data-index]");
    if (tmCell) {
      const card = tmCell.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      const kind = tmCell.dataset.kind as "tm" | "hm" | undefined;
      const index = Number(tmCell.dataset.index);
      if (!card || !Number.isInteger(speciesId) || (kind !== "tm" && kind !== "hm") || !Number.isInteger(index)) return;
      const enabled = !tmCell.classList.contains("-active");
      updatePokemonTmCompatibility(project, speciesId, kind, index, enabled);
      tmCell.classList.toggle("-active", enabled);
      options.onDirty?.();
      return;
    }

    const icon = target.closest<HTMLElement>(".expand-action");
    if (!icon) return;
    const card = icon.closest<HTMLElement>(".pokemon-card.filterable");
    const speciesId = Number(card?.dataset.index);
    const expand = icon.dataset.expand;
    if (!card || !Number.isInteger(speciesId) || !expand) return;

    if (!card.querySelector(".expanded-card-content")) card.insertAdjacentHTML("beforeend", options.renderExpanded(speciesId));
    installEditableFields(card, project, options);

    const targetPanel = card.querySelector<HTMLElement>(`.expanded-${expand}`);
    if (!targetPanel) return;
    const alreadyOpen = targetPanel.classList.contains("show-flex");
    card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.classList.remove("show-flex"));
    card.querySelectorAll<HTMLElement>(".card-icon, .expand-action").forEach((item) => item.classList.remove("-active"));
    if (!alreadyOpen) {
      targetPanel.classList.add("show-flex");
      icon.classList.add("-active");
      scrollRowBelowStickyHeader(card);
    }
    stripeRows(root);
  });

  installEditableFields(root, project, options);
  runFilter();
}

export function filterPokemon(
  root: HTMLElement,
  project: ProjectState,
  searchText: string,
  generations = new Set<number>(),
  types = new Set<string>(),
): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#personals .pokemon-card.filterable").forEach((card) => {
    const speciesId = Number(card.dataset.index);
    const show = Number.isInteger(speciesId) ? pokemonMatchesSearch(getPokemonSummaryRecord(project, speciesId), searchText, generations, types) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installEditableFields(root: HTMLElement, project: ProjectState, options: PokemonInteractionOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true']").forEach((field) => {
    if (field.dataset.pokemonEditInstalled === "true") return;
    field.dataset.pokemonEditInstalled = "true";
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
      const card = field.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      const narc = field.dataset.narc as "personal" | "learnset" | "evolution" | undefined;
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(speciesId) || !narc || !fieldName) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        const result = updatePokemonField(project, speciesId, narc, fieldName, nextValue);
        field.textContent = String(result.value);
        field.classList.remove("invalid");
        field.style.border = "";
        syncVisualFieldState(field, result);
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });
}

function syncVisualFieldState(field: HTMLElement, result: ReturnType<typeof updatePokemonField>): void {
  if (field.classList.contains("pokemon-type")) {
    [...field.classList].filter((name) => name.startsWith("-")).forEach((name) => field.classList.remove(name));
    field.classList.add(`-${String(result.value).toLowerCase()}`);
  }

  if (field.closest("td")) {
    const value = Number(result.value);
    const graph = field.closest("tr")?.querySelector<HTMLElement>(".pokemon-card__graph");
    if (graph && Number.isFinite(value)) graph.style.width = `${value / 2.55}%`;
  }

  if (result.movePreview) {
    const row = field.closest<HTMLElement>(".expanded-field.multi");
    const typeButton = row?.querySelector<HTMLButtonElement>(".move-type .btn");
    const type = result.movePreview.type;
    if (typeButton) {
      typeButton.className = `btn -${String(type).toLowerCase()} -active`;
      typeButton.textContent = String(type).toUpperCase().slice(0, 3);
    }
    const cat = row?.querySelector<HTMLElement>(".move-cat");
    const power = row?.querySelector<HTMLElement>(".move-power");
    const accuracy = row?.querySelector<HTMLElement>(".move-accuracy");
    if (cat) cat.textContent = String(result.movePreview.category).slice(0, 3);
    if (power) power.textContent = String(result.movePreview.power);
    if (accuracy) accuracy.textContent = String(result.movePreview.accuracy);
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

function toggleSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
