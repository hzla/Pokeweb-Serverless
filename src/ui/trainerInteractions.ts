import {
  addTrainer,
  getTrainerRecord,
  trainerMatchesSearch,
  updateTrainerField,
  updateTrainerPokemonField,
  addTrainerPokemon,
  autofillTrainerPokemonMoves,
  deleteTrainerPokemon,
  formatTrainerPokemonShowdownText,
  importTrainerPokemonShowdownText,
  setTrainerAiFlagForAll,
} from "../pokeweb/trainerModel";
import { updateTrainerText } from "../pokeweb/trainerTextModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, scrollRowBelowStickyHeader, selectText } from "./dom";
import { stripeRows } from "./legacyInteractions";

export type TrainerInteractionOptions = {
  onDirty?: () => void;
  onTestBattle?: (trainerId: number, showdownText: string) => Promise<void>;
  onOpenTrainerSprite?: (trainerClassId: number) => void;
  autofills: Record<string, string[]>;
  renderRow: (trainerId: number) => string;
};

const AUTOCOMPLETE_CLICK_SUPPRESS_MS = 500;
const autocompleteClickSuppressUntil = new WeakMap<HTMLElement, number>();

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
    if (shouldSuppressAutocompleteClick(root)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target.closest("[data-autocomplete], .suggestions")) return;

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

    const trainerSprite = target.closest<HTMLElement>(".trainer-rom-sprite-link");
    const trainerClassId = Number(trainerSprite?.dataset.trainerClassId);
    if (trainerSprite && Number.isInteger(trainerClassId) && options.onOpenTrainerSprite) {
      options.onOpenTrainerSprite(trainerClassId);
      return;
    }

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

    const deleteTrainerTextButton = target.closest<HTMLButtonElement>(".delete-trtext");
    if (deleteTrainerTextButton) {
      const typeId = Number(deleteTrainerTextButton.dataset.typeId);
      if (!Number.isInteger(typeId)) return;
      try {
        updateTrainerText(project, trainerId, typeId, "");
        replaceTrainerRow(root, project, card, trainerId, options);
        options.onDirty?.();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const preview = target.closest<HTMLElement>(".trainer-poks .trainer-pokemon-preview");
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

    const copyShowdownButton = target.closest<HTMLElement>(".copy-showdown-btn");
    if (copyShowdownButton) {
      const slot = Number(target.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
      if (!Number.isInteger(slot)) return;
      const previousText = copyShowdownButton.textContent ?? "Copy";
      try {
        await writeClipboardText(formatTrainerPokemonShowdownText(project, trainerId, slot));
        copyShowdownButton.textContent = "Copied";
        window.setTimeout(() => {
          copyShowdownButton.textContent = previousText;
        }, 1000);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const importShowdownButton = target.closest<HTMLElement>(".import-showdown-btn");
    if (importShowdownButton) {
      const slot = Number(target.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
      if (!Number.isInteger(slot)) return;
      try {
        const showdownText = await requestShowdownImportText();
        if (showdownText === undefined) return;
        importTrainerPokemonShowdownText(project, trainerId, slot, showdownText);
        replaceTrainerRow(root, project, card, trainerId, options, String(slot));
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
    const commit = (forceOpenPok?: string) => {
      const committed = commitTrainerEditableField(root, project, options, field, initialValue, forceOpenPok);
      if (committed) initialValue = field.textContent?.trim() ?? "";
    };
    installAutocomplete(field, options.autofills, () => commit(field.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex));

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
      commit();
    });
  });
}

function commitTrainerEditableField(
  root: HTMLElement,
  project: ProjectState,
  options: TrainerInteractionOptions,
  field: HTMLElement,
  initialValue: string,
  forceOpenPok?: string,
): boolean {
  const card = field.closest<HTMLElement>(".trainer-card");
  const trainerId = Number(card?.dataset.index);
  const narc = field.dataset.narc as "trdata" | "trpok" | "trtext" | undefined;
  const fieldName = field.dataset.fieldName;
  if (!card || !Number.isInteger(trainerId) || !narc || !fieldName) return false;

  const nextValue = field.textContent?.trim() ?? "";
  field.textContent = nextValue;
  if (nextValue === initialValue) return false;

  try {
    if (narc === "trdata") updateTrainerField(project, trainerId, fieldName, nextValue);
    else if (narc === "trtext") {
      const match = /^text_(\d+)_entry_\d+$/u.exec(fieldName);
      if (!match) throw new Error(`Unsupported trainer text field: ${fieldName}`);
      updateTrainerText(project, trainerId, Number(match[1]), nextValue);
    } else {
      const slot = Number(field.closest<HTMLElement>(".expanded-pok")?.dataset.subIndex);
      const result = updateTrainerPokemonField(project, trainerId, slot, fieldName, nextValue);
      field.textContent = String(result.value);
      refreshTrainerRowMain(root, project, card, trainerId, options, String(slot));
      refreshOpenTrainerPokemonLabels(card, result.slot);
      options.onDirty?.();
      return true;
    }
    replaceTrainerRow(root, project, card, trainerId, options, forceOpenPok);
    options.onDirty?.();
    return true;
  } catch {
    field.textContent = initialValue;
    field.classList.add("invalid");
    field.style.border = "1px solid red";
    return false;
  }
}

function refreshTrainerRowMain(
  root: HTMLElement,
  project: ProjectState,
  card: HTMLElement,
  trainerId: number,
  options: TrainerInteractionOptions,
  openPok?: string,
): void {
  const template = document.createElement("template");
  template.innerHTML = options.renderRow(trainerId).trim();
  const nextMain = template.content.querySelector<HTMLElement>(".trainer-card > .expanded-field-main");
  const currentMain = card.querySelector<HTMLElement>(":scope > .expanded-field-main");
  if (!nextMain || !currentMain) return;

  currentMain.replaceWith(nextMain);
  installEditableFields(nextMain, project, options);
  if (openPok !== undefined) {
    nextMain.querySelectorAll<HTMLElement>(`.trainer-poks .trainer-pokemon-preview[data-show="pok-${openPok}"]`).forEach((preview) => preview.classList.add("-active"));
  }
  stripeRows(root);
}

function refreshOpenTrainerPokemonLabels(card: HTMLElement, slot?: { slot: number; abilityName: string | number; nature: string }): void {
  if (!slot) return;
  const panel = card.querySelector<HTMLElement>(`.expanded-pok-${slot.slot}`);
  const abilityField = panel?.querySelector<HTMLElement>(`[data-field-name="ability_${slot.slot}"]`);
  const abilityLabel = abilityField?.closest<HTMLElement>(".expanded-field")?.firstElementChild;
  if (abilityLabel) abilityLabel.textContent = `Ability Slot (${slot.abilityName})`;

  const ivField = panel?.querySelector<HTMLElement>(`[data-field-name="ivs_${slot.slot}"]`);
  const ivLabel = ivField?.closest<HTMLElement>(".expanded-field")?.firstElementChild;
  if (ivLabel) ivLabel.textContent = `IVs: (${slot.nature})`;
}

function replaceTrainerRow(root: HTMLElement, project: ProjectState, card: HTMLElement, trainerId: number, options: TrainerInteractionOptions, forceOpenPok?: string): void {
  const wasTrainerOpen = card.querySelector(".expanded-trainer.show-flex") !== null;
  const wasTextsOpen = card.querySelector(".expanded-trainer.-show-texts") !== null;
  const openPok = forceOpenPok ?? card.querySelector<HTMLElement>(".expanded-pok.show-flex")?.dataset.subIndex;
  card.outerHTML = options.renderRow(trainerId);
  const nextCard = root.querySelector<HTMLElement>(`.trainer-card[data-index="${trainerId}"]`);
  if (!nextCard) return;
  installEditableFields(nextCard, project, options);
  if (wasTrainerOpen) nextCard.querySelector<HTMLElement>(".expanded-trainer")?.classList.add("show-flex");
  if (wasTextsOpen) nextCard.querySelector<HTMLElement>(".expanded-trainer")?.classList.add("-show-texts");
  if (openPok !== undefined) {
    nextCard.querySelector<HTMLElement>(`.expanded-pok-${openPok}`)?.classList.add("show-flex");
    nextCard.querySelectorAll<HTMLElement>(`.trainer-poks .trainer-pokemon-preview[data-show="pok-${openPok}"]`).forEach((preview) => preview.classList.add("-active"));
  }
  stripeRows(root);
}

function toggleTrainerPanel(card: HTMLElement): void {
  const target = card.querySelector<HTMLElement>(".expanded-trainer");
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content, .expanded-card-subcontent").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".trainer-poks .trainer-pokemon-preview, .expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    scrollRowBelowStickyHeader(card);
  }
}

function showTrainerPokemon(card: HTMLElement, preview: HTMLElement): void {
  const slot = preview.dataset.show?.replace("pok-", "");
  if (slot === undefined) return;
  const target = card.querySelector<HTMLElement>(`.expanded-pok-${slot}`);
  if (!target) return;
  const alreadyOpen = target.classList.contains("show-flex");
  card.querySelectorAll<HTMLElement>(".expanded-card-content, .expanded-card-subcontent").forEach((panel) => panel.classList.remove("show-flex"));
  card.querySelectorAll<HTMLElement>(".trainer-poks .trainer-pokemon-preview, .expand-action").forEach((item) => item.classList.remove("-active"));
  if (!alreadyOpen) {
    target.classList.add("show-flex");
    card.querySelectorAll<HTMLElement>(`.trainer-poks .trainer-pokemon-preview[data-show="pok-${slot}"]`).forEach((item) => item.classList.add("-active"));
    scrollRowBelowStickyHeader(card);
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed.");
  } finally {
    textarea.remove();
  }
}

function requestShowdownImportText(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "trainer-showdown-import-modal";
    overlay.innerHTML = `
      <form class="trainer-showdown-import-dialog">
        <div class="trainer-showdown-import-title">Import Showdown Set</div>
        <textarea class="trainer-showdown-import-input" spellcheck="false" placeholder="Paste one Pokemon Showdown set"></textarea>
        <div class="trainer-showdown-import-actions">
          <button class="field-btn" type="submit">Import</button>
          <button class="field-btn del-btn" type="button" data-cancel>Cancel</button>
        </div>
      </form>
    `;
    const textarea = overlay.querySelector<HTMLTextAreaElement>(".trainer-showdown-import-input");
    const form = overlay.querySelector<HTMLFormElement>("form");
    let settled = false;
    const close = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(value);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(undefined);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(undefined);
    });
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => close(undefined));
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = textarea?.value.trim() ?? "";
      if (value === "") {
        textarea?.focus();
        return;
      }
      close(value);
    });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
    textarea?.focus();
  });
}

function isTrainerRowControl(target: HTMLElement): boolean {
  return Boolean(target.closest("button, input, label, [contenteditable='true'], [data-autocomplete], .suggestions, .add-trpok"));
}

function installAutocomplete(field: HTMLElement, autofills: Record<string, string[]>, onSelect?: () => void): void {
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
    suppressAutocompleteClick(field);
    field.textContent = target.textContent ?? "";
    suggestions.hidden = true;
    onSelect?.();
  });
  suggestions.addEventListener("click", (event) => event.stopPropagation());
}

function suppressAutocompleteClick(field: HTMLElement): void {
  const root = field.closest<HTMLElement>("#content-container");
  if (!root) return;
  autocompleteClickSuppressUntil.set(root, window.performance.now() + AUTOCOMPLETE_CLICK_SUPPRESS_MS);
}

function shouldSuppressAutocompleteClick(root: HTMLElement): boolean {
  const until = autocompleteClickSuppressUntil.get(root) ?? 0;
  if (until <= window.performance.now()) return false;
  autocompleteClickSuppressUntil.delete(root);
  return true;
}
