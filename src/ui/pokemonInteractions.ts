import {
  appendPokemonLearnsetMove,
  appendPokemonEggMove,
  copyPokemonTmCompatibility,
  copyPokemonTutorCompatibility,
  copyPokemonLearnset,
  deletePokemonEggMove,
  deletePokemonLearnsetMove,
  getPokemonSummaryRecord,
  insertPokemonEggMove,
  insertPokemonLearnsetMove,
  pokemonMatchesSearch,
  updatePokemonEggMove,
  updatePokemonField,
  updatePokemonTmCompatibility,
  updatePokemonTutorCompatibility,
} from "../pokeweb/pokemonModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

type PokemonEditableNarc = "personal" | "learnset" | "evolution" | "egg_moves";
type PokemonFieldUpdate = ReturnType<typeof updatePokemonField>;

export type PokemonInteractionOptions = {
  onDirty?: () => void;
  onOpenSprites?: (speciesId: number) => void;
  onOpenPwan?: (speciesId: number) => void;
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
    syncEvolutionMethodInfo(root);
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

  root.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const field = editableFieldFromContextTarget(root, event.target);
    if (!field || !applyPokemonFieldToVisibleRows(root, project, options, field)) return;
    event.preventDefault();
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

    const pwanAction = target.closest<HTMLElement>(".pwan-editor-action");
    if (pwanAction) {
      const card = pwanAction.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      if (Number.isInteger(speciesId)) options.onOpenPwan?.(speciesId);
      return;
    }

    const compatibilityCopyAction = target.closest<HTMLElement>("[data-compatibility-copy]");
    if (compatibilityCopyAction) {
      const card = compatibilityCopyAction.closest<HTMLElement>(".pokemon-card.filterable");
      const panel = compatibilityCopyAction.closest<HTMLElement>(".expanded-card-content");
      const input = panel?.querySelector<HTMLInputElement>(".compatibility-copy-source");
      const speciesId = Number(card?.dataset.index);
      const sourceSpeciesId = Number(input?.value.trim());
      const kind = compatibilityCopyAction.dataset.compatibilityCopy;
      if (!card || !Number.isInteger(speciesId) || (kind !== "tm" && kind !== "tutor")) return;
      try {
        if (kind === "tm") copyPokemonTmCompatibility(project, speciesId, sourceSpeciesId);
        else copyPokemonTutorCompatibility(project, speciesId, sourceSpeciesId);
        refreshExpandedPanels(card, project, speciesId, kind === "tm" ? "tms" : "tutors", options);
        options.onDirty?.();
        stripeRows(root);
      } catch (error) {
        compatibilityCopyAction.classList.add("invalid");
        if (input) {
          input.classList.add("invalid");
          input.title = error instanceof Error ? error.message : String(error);
          input.focus();
        }
      }
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

    const tutorCell = target.closest<HTMLElement>(".cell.tutor[data-tutor-field][data-index]");
    if (tutorCell) {
      const card = tutorCell.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      const field = tutorCell.dataset.tutorField;
      const index = Number(tutorCell.dataset.index);
      if (!card || !Number.isInteger(speciesId) || !field || !Number.isInteger(index)) return;
      const enabled = !tutorCell.classList.contains("-active");
      updatePokemonTutorCompatibility(project, speciesId, field, index, enabled);
      tutorCell.classList.toggle("-active", enabled);
      options.onDirty?.();
      return;
    }

    const learnsetAction = target.closest<HTMLElement>("[data-learnset-action]");
    if (learnsetAction) {
      const card = learnsetAction.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      const action = learnsetAction.dataset.learnsetAction;
      const index = Number(learnsetAction.dataset.learnsetIndex);
      if (!card || !Number.isInteger(speciesId)) return;
      try {
        if (action === "append") appendPokemonLearnsetMove(project, speciesId);
        else if (action === "copy") {
          const input = learnsetAction.closest<HTMLElement>(".learnset-toolbar")?.querySelector<HTMLInputElement>(".learnset-copy-source");
          const sourceSpeciesId = Number(input?.value.trim());
          copyPokemonLearnset(project, speciesId, sourceSpeciesId);
        }
        else if (action === "insert" && Number.isInteger(index)) insertPokemonLearnsetMove(project, speciesId, index);
        else if (action === "delete" && Number.isInteger(index)) deletePokemonLearnsetMove(project, speciesId, index);
        else return;
        refreshExpandedPanels(card, project, speciesId, "learnset", options);
        options.onDirty?.();
        stripeRows(root);
      } catch (error) {
        learnsetAction.classList.add("invalid");
        const input = learnsetAction.closest<HTMLElement>(".learnset-toolbar")?.querySelector<HTMLInputElement>(".learnset-copy-source");
        if (input && action === "copy") {
          input.classList.add("invalid");
          input.title = error instanceof Error ? error.message : String(error);
          input.focus();
        }
      }
      return;
    }

    const eggMoveAction = target.closest<HTMLElement>("[data-egg-move-action]");
    if (eggMoveAction) {
      const card = eggMoveAction.closest<HTMLElement>(".pokemon-card.filterable");
      const speciesId = Number(card?.dataset.index);
      const action = eggMoveAction.dataset.eggMoveAction;
      const index = Number(eggMoveAction.dataset.eggMoveIndex);
      if (!card || !Number.isInteger(speciesId)) return;
      try {
        if (action === "append") appendPokemonEggMove(project, speciesId);
        else if (action === "insert" && Number.isInteger(index)) insertPokemonEggMove(project, speciesId, index);
        else if (action === "delete" && Number.isInteger(index)) deletePokemonEggMove(project, speciesId, index);
        else return;
        refreshExpandedPanels(card, project, speciesId, "egg-moves", options);
        options.onDirty?.();
        stripeRows(root);
      } catch {
        eggMoveAction.classList.add("invalid");
      }
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
    syncEvolutionMethodInfo(root);
    stripeRows(root);
  });

  installEditableFields(root, project, options);
  syncEvolutionMethodInfo(root);
  runFilter();
}

function refreshExpandedPanels(card: HTMLElement, project: ProjectState, speciesId: number, activePanel: string, options: PokemonInteractionOptions): void {
  card.querySelectorAll<HTMLElement>(".expanded-card-content").forEach((panel) => panel.remove());
  card.insertAdjacentHTML("beforeend", options.renderExpanded(speciesId));
  installEditableFields(card, project, options);
  card.querySelectorAll<HTMLElement>(".card-icon, .expand-action").forEach((item) => item.classList.remove("-active"));
  card.querySelector<HTMLElement>(`.expanded-${activePanel}`)?.classList.add("show-flex");
  card.querySelector<HTMLElement>(`.expand-action[data-expand='${CSS.escape(activePanel)}']`)?.classList.add("-active");
  syncEvolutionMethodInfo(card.closest<HTMLElement>("#content-container") ?? document.body);
}

function syncEvolutionMethodInfo(root: HTMLElement): void {
  const info = root.querySelector<HTMLElement>(".evo-method-info");
  if (!info) return;
  const hasVisibleEvolutionEditor = [...root.querySelectorAll<HTMLElement>(".expanded-evos.show-flex")].some((panel) => {
    const card = panel.closest<HTMLElement>(".pokemon-card.filterable");
    return card?.style.display !== "none";
  });
  info.hidden = !hasVisibleEvolutionEditor;
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
      const narc = field.dataset.narc as "personal" | "learnset" | "evolution" | "egg_moves" | undefined;
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(speciesId) || !narc || !fieldName) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        const result = narc === "egg_moves" ? updateEggMoveField(project, speciesId, fieldName, nextValue) : updatePokemonField(project, speciesId, narc, fieldName, nextValue);
        field.textContent = String(result.value);
        field.classList.remove("invalid");
        field.style.border = "";
        syncVisualFieldState(field, result);
        options.onDirty?.();
        if (narc === "evolution" && fieldName.startsWith("method_")) {
          refreshExpandedPanels(card, project, speciesId, "evos", options);
        }
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });
}

function editableFieldFromContextTarget(root: HTMLElement, target: HTMLElement): HTMLElement | undefined {
  const direct = target.closest<HTMLElement>("[contenteditable='true'][data-narc][data-field-name]");
  if (direct && root.contains(direct)) return direct;

  const container = target.closest<HTMLElement>(".expanded-field, tr");
  const field = container?.querySelector<HTMLElement>("[contenteditable='true'][data-narc][data-field-name]");
  return field && root.contains(field) ? field : undefined;
}

function applyPokemonFieldToVisibleRows(root: HTMLElement, project: ProjectState, options: PokemonInteractionOptions, sourceField: HTMLElement): boolean {
  const narc = sourceField.dataset.narc as PokemonEditableNarc | undefined;
  const fieldName = sourceField.dataset.fieldName;
  const value = sourceField.textContent?.trim() ?? "";
  if (!narc || !fieldName || !isPokemonEditableNarc(narc)) return false;

  const visibleCards = visiblePokemonCards(root);
  if (visibleCards.length === 0) return true;

  const label = fieldName.replace(/_/gu, " ");
  if (!window.confirm(`Apply "${value}" to ${label} for ${visibleCards.length} visible Pokemon?`)) return true;

  let updated = 0;
  let failed = 0;
  for (const card of visibleCards) {
    const speciesId = Number(card.dataset.index);
    if (!Number.isInteger(speciesId)) continue;
    try {
      const result = updatePokemonEditableField(project, speciesId, narc, fieldName, value);
      syncRenderedPokemonEditableField(card, project, speciesId, narc, fieldName, result, options);
      updated += 1;
    } catch {
      failed += 1;
      markRenderedPokemonEditableInvalid(card, narc, fieldName);
    }
  }

  if (updated > 0) {
    options.onDirty?.();
    syncEvolutionMethodInfo(root);
    stripeRows(root);
  }
  if (failed > 0) {
    window.alert(`Applied to ${updated} visible Pokemon; ${failed} row${failed === 1 ? "" : "s"} could not use that value.`);
  }
  return true;
}

function visiblePokemonCards(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("#personals .pokemon-card.filterable")].filter((card) => card.style.display !== "none");
}

function isPokemonEditableNarc(narc: string): narc is PokemonEditableNarc {
  return narc === "personal" || narc === "learnset" || narc === "evolution" || narc === "egg_moves";
}

function updatePokemonEditableField(project: ProjectState, speciesId: number, narc: PokemonEditableNarc, fieldName: string, value: string): PokemonFieldUpdate {
  if (narc === "egg_moves") return updateEggMoveField(project, speciesId, fieldName, value);
  return updatePokemonField(project, speciesId, narc, fieldName, value);
}

function syncRenderedPokemonEditableField(
  card: HTMLElement,
  project: ProjectState,
  speciesId: number,
  narc: PokemonEditableNarc,
  fieldName: string,
  result: PokemonFieldUpdate,
  options: PokemonInteractionOptions,
): void {
  if (narc === "evolution" && fieldName.startsWith("method_") && card.querySelector(".expanded-evos.show-flex")) {
    refreshExpandedPanels(card, project, speciesId, "evos", options);
    return;
  }

  card.querySelectorAll<HTMLElement>(pokemonEditableFieldSelector(narc, fieldName)).forEach((field) => {
    field.textContent = String(result.value);
    field.classList.remove("invalid");
    field.style.border = "";
    syncVisualFieldState(field, result);
  });
}

function markRenderedPokemonEditableInvalid(card: HTMLElement, narc: PokemonEditableNarc, fieldName: string): void {
  card.querySelectorAll<HTMLElement>(pokemonEditableFieldSelector(narc, fieldName)).forEach((field) => {
    field.classList.add("invalid");
    field.style.border = "1px solid red";
  });
}

function pokemonEditableFieldSelector(narc: PokemonEditableNarc, fieldName: string): string {
  return `[contenteditable='true'][data-narc='${CSS.escape(narc)}'][data-field-name='${CSS.escape(fieldName)}']`;
}

function updateEggMoveField(project: ProjectState, speciesId: number, fieldName: string, nextValue: string): ReturnType<typeof updatePokemonField> {
  const match = /^move_id_(\d+)$/u.exec(fieldName);
  if (!match) throw new Error(`Unsupported egg move field: ${fieldName}`);
  const index = Number(match[1]);
  const rows = updatePokemonEggMove(project, speciesId, index, nextValue);
  const row = rows[index];
  if (!row) throw new Error(`Egg move row ${index} does not exist`);
  return {
    value: row.moveName,
    rawValue: row.moveId,
    movePreview: {
      type: row.type,
      category: row.category,
      power: row.power,
      accuracy: row.accuracy,
    },
  };
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
