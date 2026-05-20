import {
  addTrainer,
  getTrainerRecord,
  trainerMatchesSearch,
  updateTrainerField,
  updateTrainerPokemonField,
  addTrainerPokemon,
  autofillTrainerPokemonMoves,
  deleteTrainerPokemon,
  setTrainerAiFlagForAll,
} from "../pokeweb/trainerModel";
import { updateTrainerText } from "../pokeweb/trainerTextModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

export type TrainerInteractionOptions = {
  onDirty?: () => void;
  onTestBattle?: (trainerId: number, showdownText: string) => Promise<void>;
  autofills: Record<string, string[]>;
  renderRow: (trainerId: number) => string;
};

export function attachTrainerInteractions(root: HTMLElement, project: ProjectState, options: TrainerInteractionOptions): void {
  const searchInput = root.querySelector<HTMLInputElement>("#search-text");
  const searchButton = root.querySelector<HTMLButtonElement>("#search-text-btn");
  const runFilter = () => {
    filterTrainers(root, project, searchInput?.value ?? "");
    stripeRows(root);
  };

  searchButton?.addEventListener("click", runFilter);
  searchInput?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") runFilter();
  });

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#add-trainer-btn")) {
      try {
        const openTrainer = root.querySelector<HTMLElement>("#trainers .trainer-card .expanded-trainer.show-flex")?.closest<HTMLElement>(".trainer-card");
        const selectedTrainerId = openTrainer ? Number(openTrainer.dataset.index) : undefined;
        const trainer = addTrainer(project, selectedTrainerId);
        const trainers = root.querySelector<HTMLElement>("#trainers");
        trainers?.insertAdjacentHTML("beforeend", options.renderRow(trainer.id));
        const nextCard = root.querySelector<HTMLElement>(`.trainer-card[data-index="${trainer.id}"]`);
        if (nextCard) {
          installEditableFields(nextCard, project, options);
          scrollRowBelowStickyHeader(nextCard);
        }
        filterTrainers(root, project, searchInput?.value ?? "");
        stripeRows(root);
        options.onDirty?.();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const card = target.closest<HTMLElement>(".trainer-card");
    const trainerId = Number(card?.dataset.index);
    if (!card || !Number.isInteger(trainerId)) return;

    const testBattleButton = target.closest<HTMLButtonElement>(".test-battle-btn");
    if (testBattleButton && options.onTestBattle) {
      const previousText = testBattleButton.textContent ?? "Test";
      const showdownText = root.querySelector<HTMLTextAreaElement>("#test-battle-team-import")?.value ?? "";
      try {
        testBattleButton.disabled = true;
        testBattleButton.textContent = "Building...";
        await options.onTestBattle(trainerId, showdownText);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        testBattleButton.disabled = false;
        testBattleButton.textContent = previousText;
      }
      return;
    }

    if (target.closest(".show-bottom")) {
      card.querySelector<HTMLElement>(".expanded-trainer")?.classList.toggle("-show-texts");
      return;
    }

    const preview = target.closest<HTMLImageElement>(".trainer-poks img");
    if (preview?.dataset.show) {
      showTrainerPokemon(card, preview);
      stripeRows(root);
      return;
    }

    if (target.closest(".add-trpok")) {
      try {
        addTrainerPokemon(project, trainerId);
        replaceTrainerRow(root, project, card, trainerId, options);
        options.onDirty?.();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (target.closest(".delete-trpok")) {
      const slot = Number(target.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
      if (!Number.isInteger(slot)) return;
      deleteTrainerPokemon(project, trainerId, slot);
      replaceTrainerRow(root, project, card, trainerId, options);
      options.onDirty?.();
      return;
    }

    if (target.closest(".autofill-btn")) {
      const slot = Number(target.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
      if (!Number.isInteger(slot)) return;
      try {
        autofillTrainerPokemonMoves(project, trainerId, slot);
        replaceTrainerRow(root, project, card, trainerId, options);
        options.onDirty?.();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const ai = target.closest<HTMLElement>(".choosable-text.choosable-prop");
    if (ai?.dataset.fieldName) {
      const next = !ai.classList.contains("-active");
      updateTrainerField(project, trainerId, ai.dataset.fieldName, next);
      replaceTrainerRow(root, project, card, trainerId, options);
      options.onDirty?.();
      return;
    }

    const mainRow = target.closest<HTMLElement>("#trainers .trainer-card > .expanded-field-main");
    if (mainRow && !isTrainerRowControl(target)) {
      toggleTrainerPanel(card);
      stripeRows(root);
    }
  });

  root.addEventListener("change", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>(".trainer-tmp-flag");
    const card = input?.closest<HTMLElement>(".trainer-card");
    const trainerId = Number(card?.dataset.index);
    if (!input || !card || !Number.isInteger(trainerId) || !input.dataset.fieldName) return;
    updateTrainerField(project, trainerId, input.dataset.fieldName, input.checked);
    replaceTrainerRow(root, project, card, trainerId, options);
    options.onDirty?.();
  });

  root.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement;
    const ai = target.closest<HTMLElement>(".trainer-ai .choosable-text.choosable-prop");
    const fieldName = ai?.dataset.fieldName;
    if (!ai || !fieldName) return;

    event.preventDefault();
    const enabled = !ai.classList.contains("-active");
    const action = enabled ? "Set" : "Unset";
    if (!window.confirm(`${action} ${fieldName} AI flag for all trainers?`)) return;

    const updated = setTrainerAiFlagForAll(project, fieldName, enabled);
    root.querySelectorAll<HTMLElement>(".trainer-ai .choosable-text.choosable-prop").forEach((flag) => {
      if (flag.dataset.fieldName === fieldName) flag.classList.toggle("-active", enabled);
    });
    if (updated > 0) options.onDirty?.();
  });

  installEditableFields(root, project, options);
  runFilter();
}

export function filterTrainers(root: HTMLElement, project: ProjectState, searchText: string): HTMLElement[] {
  const visible: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("#trainers .trainer-card").forEach((card) => {
    const trainerId = Number(card.dataset.index);
    const show = Number.isInteger(trainerId) ? trainerMatchesSearch(getTrainerRecord(project, trainerId), searchText) : false;
    card.style.display = show ? "" : "none";
    if (show) visible.push(card);
  });
  return visible;
}

function installEditableFields(root: HTMLElement, project: ProjectState, options: TrainerInteractionOptions): void {
  root.querySelectorAll<HTMLElement>("[contenteditable='true']").forEach((field) => {
    if (field.dataset.trainerEditInstalled === "true") return;
    field.dataset.trainerEditInstalled = "true";
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
      const card = field.closest<HTMLElement>(".trainer-card");
      const trainerId = Number(card?.dataset.index);
      const narc = field.dataset.narc as "trdata" | "trpok" | "trtext" | undefined;
      const fieldName = field.dataset.fieldName;
      if (!card || !Number.isInteger(trainerId) || !narc || !fieldName) return;

      const nextValue = field.textContent?.trim() ?? "";
      field.textContent = nextValue;
      if (nextValue === initialValue) return;

      try {
        if (narc === "trdata") updateTrainerField(project, trainerId, fieldName, nextValue);
        else if (narc === "trtext") {
          const match = /^text_(\d+)_entry_\d+$/u.exec(fieldName);
          if (!match) throw new Error(`Unsupported trainer text field: ${fieldName}`);
          updateTrainerText(project, trainerId, Number(match[1]), nextValue);
        } else {
          const slot = Number(field.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
          updateTrainerPokemonField(project, trainerId, slot, fieldName, nextValue);
        }
        replaceTrainerRow(root, project, card, trainerId, options);
        options.onDirty?.();
      } catch {
        field.textContent = initialValue;
        field.classList.add("invalid");
        field.style.border = "1px solid red";
      }
    });
  });
}

function replaceTrainerRow(root: HTMLElement, project: ProjectState, card: HTMLElement, trainerId: number, options: TrainerInteractionOptions): void {
  const wasTrainerOpen = card.querySelector(".expanded-trainer.show-flex") !== null;
  const wasTextsOpen = card.querySelector(".expanded-trainer.-show-texts") !== null;
  const openPok = card.querySelector<HTMLElement>(".expanded-pok.show-flex")?.dataset.subIndex;
  card.outerHTML = options.renderRow(trainerId);
  const nextCard = root.querySelector<HTMLElement>(`.trainer-card[data-index="${trainerId}"]`);
  if (!nextCard) return;
  installEditableFields(nextCard, project, options);
  if (wasTrainerOpen) nextCard.querySelector<HTMLElement>(".expanded-trainer")?.classList.add("show-flex");
  if (wasTextsOpen) nextCard.querySelector<HTMLElement>(".expanded-trainer")?.classList.add("-show-texts");
  if (openPok !== undefined) {
    nextCard.querySelector<HTMLElement>(`.expanded-pok-${openPok}`)?.classList.add("show-flex");
    nextCard.querySelector<HTMLImageElement>(`.trainer-poks img[data-show="pok-${openPok}"]`)?.classList.add("-active");
  }
  stripeRows(root);
}

function toggleTrainerPanel(card: HTMLElement): void {
  const target = card.querySelector<HTMLElement>(".expanded-trainer");
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content, .expanded-card-subcontent").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".trainer-poks img, .expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    scrollRowBelowStickyHeader(card);
  }
}

function showTrainerPokemon(card: HTMLElement, preview: HTMLImageElement): void {
  const slot = preview.dataset.show?.replace("pok-", "");
  if (slot === undefined) return;
  const target = card.querySelector<HTMLElement>(`.expanded-pok-${slot}`);
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content, .expanded-card-subcontent").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".trainer-poks img, .expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    preview.classList.add("-active");
    scrollRowBelowStickyHeader(card);
  }
}

function isTrainerRowControl(target: HTMLElement): boolean {
  return Boolean(target.closest("button, input, label, [contenteditable='true'], .add-trpok"));
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
