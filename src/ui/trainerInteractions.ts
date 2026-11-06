import {
  addTrainerPokemon,
  autofillTrainerPokemonMoves,
  deleteTrainerPokemon,
  duplicateTrainerPokemon,
  formatTrainerPokemonShowdownText,
  formatTrainerTeamShowdownText,
  getTrainerRecord,
  importTrainerPokemonShowdownText,
  importTrainerTeamShowdownText,
  moveTrainerPokemon,
  setTrainerAiFlagForAll,
  updateTrainerField,
  updateTrainerPokemonField,
} from "../pokeweb/trainerModel";
import { updateTrainerText } from "../pokeweb/trainerTextModel";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, selectText } from "./dom";
import { attachTrainerFieldSettings } from "./trainerFieldConditions";
import { attachTrainerLevelCapSetting } from "./trainerLevelCaps";
import { installBw2DialoguePreview, type Bw2DialoguePreview } from "./bw2DialoguePreview";
import { assumedDialogueVariables, installGameTextEditor } from "./textHighlight";
import {
  editedTrainerFields,
  renderTrainerDetail,
  renderTrainerDialogue,
  renderTrainerPartyStrip,
  renderTrainerSlotEditor,
  renderTrainerSpriteImage,
} from "./trainerDetail";

export type TrainerSelection = { trainerId: number; slot: number };

export type TrainerDetailOptions = {
  onDirty?: () => void;
  onTestBattle?: (trainerId: number, showdownText: string) => Promise<void>;
  onOpenTrainerSprite?: (trainerClassId: number) => void;
  /** Called after any change to a trainer so its list row can be redrawn. */
  onTrainerChanged?: (trainerId: number) => void;
  getTestTeamText: () => string;
  autofills: Record<string, string[]>;
  natureField: boolean;
};

export type TrainerDetailController = {
  render: () => void;
};

const controllers = new WeakMap<HTMLElement, AbortController>();

export function attachTrainerDetail(
  detail: HTMLElement,
  project: ProjectState,
  selection: TrainerSelection,
  options: TrainerDetailOptions,
): TrainerDetailController {
  controllers.get(detail)?.abort();
  const controller = new AbortController();
  controllers.set(detail, controller);
  const { signal } = controller;
  const trainerId = () => selection.trainerId;

  const changed = () => {
    options.onDirty?.();
    options.onTrainerChanged?.(trainerId());
    refreshMarks();
  };

  const refreshMarks = () => {
    const edited = editedTrainerFields(project, trainerId());
    detail.querySelectorAll<HTMLElement>("[data-mark-fields]").forEach((element) => {
      const fields = (element.dataset.markFields ?? "").split("|");
      element.classList.toggle("is-edited", fields.some((field) => edited.has(field)));
    });
    detail.querySelectorAll<HTMLElement>("[data-mark-prefix]").forEach((element) => {
      const prefix = element.dataset.markPrefix ?? "";
      element.classList.toggle("is-edited", [...edited].some((key) => key.startsWith(prefix)));
    });
  };

  const render = () => {
    const scrollTop = detail.scrollTop;
    const trainer = getTrainerRecord(project, trainerId(), { includeTexts: false });
    if (!trainer.party.some((pok) => pok.slot === selection.slot)) selection.slot = trainer.party.length ? 0 : -1;
    detail.innerHTML = renderTrainerDetail(project, trainerId(), selection.slot, options.natureField);
    installFields(detail);
    installDialoguePreview();
    refreshMarks();
    detail.scrollTop = scrollTop;
  };

  /** Re-render the strip and slot editor after a structural party change. */
  const renderParty = () => {
    const trainer = getTrainerRecord(project, trainerId(), { includeTexts: false });
    if (!trainer.party.some((pok) => pok.slot === selection.slot)) selection.slot = trainer.party.length ? Math.min(Math.max(selection.slot, 0), trainer.party.length - 1) : -1;
    const strip = detail.querySelector<HTMLElement>("[data-party-strip]");
    const editor = detail.querySelector<HTMLElement>("[data-slot-editor]");
    const pok = trainer.party.find((slot) => slot.slot === selection.slot);
    if (strip) strip.innerHTML = renderTrainerPartyStrip(project, trainer, selection.slot);
    if (editor) {
      editor.innerHTML = pok
        ? renderTrainerSlotEditor(project, trainer, pok, options.natureField)
        : `<p class="td-empty">This trainer has no Pokémon. Add one to start building the party.</p>`;
      installFields(editor);
    }
    const note = detail.querySelector<HTMLElement>(".td-party .td-bar-note");
    if (note) note.textContent = `${trainer.party.length} of 6`;
    const copyTeam = detail.querySelector<HTMLButtonElement>("[data-team-copy]");
    if (copyTeam) copyTeam.disabled = trainer.party.length === 0;
    refreshMarks();
  };

  /**
   * Update what a field edit can change without replacing focusable elements,
   * so a click that ended the edit still lands on its target.
   */
  const refreshSlotDerived = () => {
    const trainer = getTrainerRecord(project, trainerId(), { includeTexts: false });
    const pok = trainer.party.find((slot) => slot.slot === selection.slot);
    const editor = detail.querySelector<HTMLElement>("[data-slot-editor]");
    if (!pok || !editor) return;
    const next = document.createElement("template");
    next.innerHTML = renderTrainerSlotEditor(project, trainer, pok, options.natureField);
    next.content.querySelectorAll<HTMLElement>("[data-derived]").forEach((source) => {
      const target = editor.querySelector<HTMLElement>(`[data-derived="${source.dataset.derived}"]`);
      if (target) target.innerHTML = source.innerHTML;
    });
    next.content.querySelectorAll<HTMLSelectElement>("select[data-slot-select]").forEach((source) => {
      const target = editor.querySelector<HTMLSelectElement>(`select[data-slot-select="${source.dataset.slotSelect}"]`);
      if (target) {
        target.innerHTML = source.innerHTML;
        target.value = source.value;
      }
    });
    next.content.querySelectorAll<HTMLElement>("[contenteditable][data-field-name]").forEach((source) => {
      const target = editor.querySelector<HTMLElement>(`[contenteditable][data-field-name="${source.dataset.fieldName}"]`);
      if (!target) return;
      if (target !== document.activeElement) target.textContent = source.textContent;
      if (source.dataset.placeholder) target.dataset.placeholder = source.dataset.placeholder;
      else delete target.dataset.placeholder;
    });
    editor.querySelectorAll<HTMLElement>(".td-move-table tbody tr").forEach((row) => row.classList.toggle("-default", !trainer.hasMoves));
    const strip = document.createElement("template");
    strip.innerHTML = renderTrainerPartyStrip(project, trainer, selection.slot);
    const card = detail.querySelector<HTMLElement>(`[data-party-strip] [data-slot="${pok.slot}"]`);
    const nextCard = strip.content.querySelector<HTMLElement>(`[data-slot="${pok.slot}"]`);
    if (card && nextCard) card.innerHTML = nextCard.innerHTML;
  };

  const flagsChanged = (before: { hasMoves: boolean; hasItems: boolean }) => {
    const after = getTrainerRecord(project, trainerId(), { includeTexts: false });
    return after.hasMoves !== before.hasMoves || after.hasItems !== before.hasItems;
  };

  /** Turning custom moves on must not silently blank the rest of the party's moves. */
  const fillDefaultMovesBeforeEnabling = () => {
    const trainer = getTrainerRecord(project, trainerId(), { includeTexts: false });
    if (trainer.hasMoves) return;
    for (const pok of trainer.party) {
      try {
        autofillTrainerPokemonMoves(project, trainer.id, pok.slot);
      } catch {
        // Slots without a learnset keep empty moves, as the game would have used none.
      }
    }
  };

  const commit = (field: HTMLElement, initialValue: string): boolean => {
    const narc = field.dataset.narc;
    const fieldName = field.dataset.fieldName;
    if (!narc || !fieldName) return false;
    let nextValue = field.textContent?.trim() ?? "";
    const pickedValue = field.dataset.commitValue;
    if (pickedValue !== undefined && field.dataset.commitLabel === nextValue) nextValue = pickedValue;
    else if (nextValue === initialValue) {
      field.textContent = nextValue;
      return false;
    }
    delete field.dataset.commitValue;
    delete field.dataset.commitLabel;
    const before = getTrainerRecord(project, trainerId(), { includeTexts: false });
    try {
      if (narc === "trdata") {
        updateTrainerField(project, trainerId(), fieldName, nextValue);
        const trainer = getTrainerRecord(project, trainerId(), { includeTexts: false });
        field.textContent = String(trainer.readable[fieldName] ?? nextValue);
        if (fieldName === "class") {
          const sprite = detail.querySelector<HTMLElement>(".td-sprite");
          const classId = Number(trainer.readable.class_id ?? 0);
          const link = sprite?.querySelector<HTMLElement>(".trainer-rom-sprite-link");
          if (link) {
            link.dataset.trainerClassId = String(classId);
            link.innerHTML = renderTrainerSpriteImage(project, trainer);
          } else if (sprite) sprite.innerHTML = renderTrainerSpriteImage(project, trainer);
        }
      } else if (narc === "trtext") {
        const match = /^text_(\d+)_entry_\d+$/u.exec(fieldName);
        if (!match) throw new Error(`Unsupported trainer text field: ${fieldName}`);
        const wasUsed = field.closest(".td-unused") === null;
        updateTrainerText(project, trainerId(), Number(match[1]), nextValue);
        if (wasUsed !== (nextValue !== "")) window.setTimeout(renderDialogue, 0);
      } else {
        if (/^move_[1-4]_\d+$/u.test(fieldName)) fillDefaultMovesBeforeEnabling();
        const result = updateTrainerPokemonField(project, trainerId(), selection.slot, fieldName, nextValue);
        field.textContent = String(result.value);
        if (flagsChanged(before)) window.setTimeout(render, 0);
        else refreshSlotDerived();
      }
      field.classList.remove("invalid");
      field.removeAttribute("title");
      changed();
      return true;
    } catch (error) {
      field.textContent = initialValue;
      field.classList.add("invalid");
      field.title = error instanceof Error ? error.message : String(error);
      return false;
    }
  };

  const renderDialogue = () => {
    const section = detail.querySelector<HTMLElement>("[data-trainer-dialogue]");
    if (!section) return;
    const trainer = getTrainerRecord(project, trainerId(), { includeTexts: true });
    const openUnused = section.querySelector<HTMLDetailsElement>(".td-unused")?.open ?? false;
    section.innerHTML = renderTrainerDialogue(trainer.texts);
    section.querySelectorAll<HTMLTextAreaElement>("textarea.tx-input").forEach(installGameTextEditor);
    const unused = section.querySelector<HTMLDetailsElement>(".td-unused");
    if (unused) unused.open = openUnused;
    installFields(section);
    refreshMarks();
  };

  let dialoguePreview: Bw2DialoguePreview | undefined;
  let dialogueText = "";
  const installDialoguePreview = () => {
    dialoguePreview?.destroy();
    dialoguePreview = undefined;
    detail.querySelectorAll<HTMLTextAreaElement>("[data-trainer-dialogue] textarea.tx-input").forEach(installGameTextEditor);
    const host = detail.querySelector<HTMLElement>("[data-dialogue-preview]");
    if (!host) return;
    const first = detail.querySelector<HTMLTextAreaElement>("textarea[data-trainer-text]");
    showDialogueLine(first);
    dialoguePreview = installBw2DialoguePreview(project, host, () => dialogueText, assumedDialogueVariables, { stacked: true });
    dialoguePreview.show();
  };
  const showDialogueLine = (textarea: HTMLTextAreaElement | null) => {
    dialogueText = textarea?.value ?? "";
    const label = detail.querySelector<HTMLElement>("[data-dialogue-preview-label]");
    if (label) label.textContent = textarea?.getAttribute("aria-label") ?? "";
    detail.querySelectorAll<HTMLElement>(".td-line").forEach((line) => line.classList.toggle("is-selected", line.contains(textarea)));
    dialoguePreview?.refresh();
  };

  detail.addEventListener("focusin", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-trainer-text]");
    if (!textarea) return;
    textarea.dataset.initial = textarea.value;
    showDialogueLine(textarea);
  }, { signal });
  detail.addEventListener("input", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-trainer-text]");
    if (!textarea) return;
    dialogueText = textarea.value;
    dialoguePreview?.refresh();
  }, { signal });
  detail.addEventListener("keydown", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-trainer-text]");
    if (!textarea) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      textarea.blur();
    } else if (event.key === "Escape") {
      textarea.value = textarea.dataset.initial ?? textarea.value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.blur();
    }
  }, { signal });
  detail.addEventListener("focusout", (event) => {
    const textarea = (event.target as HTMLElement).closest<HTMLTextAreaElement>("textarea[data-trainer-text]");
    if (!textarea || textarea.value === (textarea.dataset.initial ?? textarea.value)) return;
    const typeId = Number(textarea.dataset.trainerText);
    const wasUsed = textarea.closest(".td-unused") === null;
    try {
      updateTrainerText(project, trainerId(), typeId, textarea.value.trim());
      textarea.dataset.initial = textarea.value;
      textarea.classList.remove("invalid");
      changed();
      if (wasUsed !== (textarea.value.trim() !== "")) window.setTimeout(renderDialogue, 0);
    } catch (error) {
      textarea.classList.add("invalid");
      textarea.title = error instanceof Error ? error.message : String(error);
    }
  }, { signal });

  const installFields = (container: HTMLElement) => {
    container.querySelectorAll<HTMLElement>("[contenteditable='true'][data-field-name]").forEach((field) => {
      if (field.dataset.trainerEditInstalled === "true") return;
      field.dataset.trainerEditInstalled = "true";
      let initialValue = field.textContent?.trim() ?? "";
      const picker = field.dataset.autofill ? installPicker(field, options.autofills[field.dataset.autofill] ?? []) : undefined;
      field.addEventListener("focus", () => {
        initialValue = field.textContent?.trim() ?? "";
        window.setTimeout(() => {
          if (document.activeElement === field) selectText(field);
        }, 0);
        picker?.open();
      });
      field.addEventListener("input", () => {
        field.classList.remove("invalid");
        delete field.dataset.commitValue;
        delete field.dataset.commitLabel;
      });
      field.addEventListener("keydown", (event) => {
        if (picker?.handleKey(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          field.blur();
        } else if (event.key === "Escape") {
          field.textContent = initialValue;
          field.blur();
        }
      });
      field.addEventListener("blur", () => {
        picker?.close();
        if (commit(field, initialValue)) initialValue = field.textContent?.trim() ?? "";
      });
    });
  };

  detail.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-autocomplete] .suggestions")) return;
    const id = trainerId();

    const sprite = target.closest<HTMLElement>(".trainer-rom-sprite-link");
    if (sprite) {
      const classId = Number(sprite.dataset.trainerClassId);
      if (Number.isInteger(classId)) options.onOpenTrainerSprite?.(classId);
      return;
    }

    const card = target.closest<HTMLElement>("[data-party-strip] [data-slot]");
    if (card) {
      selectSlot(Number(card.dataset.slot));
      return;
    }

    const button = target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    const run = (action: () => void, after: () => void = renderParty) => {
      try {
        action();
        after();
        changed();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
    };

    if (button.matches("[data-party-add]")) {
      run(() => {
        selection.slot = addTrainerPokemon(project, id).slot;
      });
    } else if (button.matches("[data-slot-move]")) {
      const to = selection.slot + Number(button.dataset.slotMove);
      run(() => {
        moveTrainerPokemon(project, id, selection.slot, to);
        selection.slot = to;
      });
    } else if (button.matches("[data-slot-duplicate]")) {
      run(() => {
        selection.slot = duplicateTrainerPokemon(project, id, selection.slot).slot;
      });
    } else if (button.matches("[data-slot-delete]")) {
      run(() => {
        deleteTrainerPokemon(project, id, selection.slot);
      });
    } else if (button.matches("[data-slot-autofill]")) {
      run(() => {
        autofillTrainerPokemonMoves(project, id, selection.slot);
      }, render);
    } else if (button.matches("[data-slot-copy]")) {
      await copyWithFeedback(button, () => formatTrainerPokemonShowdownText(project, id, selection.slot));
    } else if (button.matches("[data-team-copy]")) {
      await copyWithFeedback(button, () => formatTrainerTeamShowdownText(project, id));
    } else if (button.matches("[data-slot-import]")) {
      const text = await requestShowdownImportText("Import Showdown set", `Replaces Pokémon ${selection.slot + 1}. Paste one Pokémon Showdown set.`);
      if (text !== undefined) run(() => {
        importTrainerPokemonShowdownText(project, id, selection.slot, text);
      }, render);
    } else if (button.matches("[data-team-import]")) {
      const text = await requestShowdownImportText("Import team", "Replaces the whole party. Paste up to six Pokémon Showdown sets separated by blank lines.");
      if (text !== undefined) run(() => {
        importTrainerTeamShowdownText(project, id, text);
        selection.slot = 0;
      }, render);
    } else if (button.matches("[data-text-delete]")) {
      run(() => {
        updateTrainerText(project, id, Number(button.dataset.textDelete), "");
      }, renderDialogue);
    } else if (button.matches("[data-trainer-test]") && options.onTestBattle) {
      const label = button.textContent ?? "Test battle";
      try {
        button.disabled = true;
        button.textContent = "Building…";
        await options.onTestBattle(id, options.getTestTeamText());
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }, { signal });

  const selectSlot = (slot: number) => {
    if (!Number.isInteger(slot) || slot === selection.slot) return;
    selection.slot = slot;
    renderParty();
    detail.querySelector<HTMLElement>(`[data-party-strip] [data-slot="${slot}"]`)?.focus();
  };

  detail.addEventListener("keydown", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-party-strip] [data-slot]");
    if (!card || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const count = getTrainerRecord(project, trainerId(), { includeTexts: false }).party.length;
    selectSlot(Math.max(0, Math.min(count - 1, selection.slot + (event.key === "ArrowRight" ? 1 : -1))));
  }, { signal });

  detail.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const id = trainerId();
    try {
      if (target instanceof HTMLSelectElement && target.dataset.trainerSelect) {
        updateTrainerField(project, id, target.dataset.trainerSelect, target.value);
      } else if (target instanceof HTMLSelectElement && target.dataset.slotSelect) {
        updateTrainerPokemonField(project, id, selection.slot, target.dataset.slotSelect, target.value);
        refreshSlotDerived();
      } else if (target instanceof HTMLInputElement && target.dataset.trainerAi) {
        updateTrainerField(project, id, target.dataset.trainerAi, target.checked);
      } else if (target instanceof HTMLInputElement && target.dataset.trainerCheck) {
        const field = target.dataset.trainerCheck;
        if (field === "heal") updateTrainerField(project, id, field, target.checked ? 1 : 0);
        else {
          if (field === "has_moves" && target.checked) fillDefaultMovesBeforeEnabling();
          updateTrainerField(project, id, field, target.checked);
          render();
        }
      } else return;
      changed();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      render();
    }
  }, { signal });

  detail.addEventListener("contextmenu", (event) => {
    const input = (event.target as HTMLElement).closest(".td-ai-flag")?.querySelector<HTMLInputElement>("input[data-trainer-ai]");
    const flag = input?.dataset.trainerAi;
    if (!input || !flag) return;
    event.preventDefault();
    const enabled = !input.checked;
    if (!window.confirm(`${enabled ? "Turn on" : "Turn off"} the “${flag}” AI flag for every trainer?`)) return;
    const updated = setTrainerAiFlagForAll(project, flag, enabled);
    input.checked = enabled;
    if (updated > 0) options.onDirty?.();
  }, { signal });

  attachTrainerFieldSettings(project, detail, options.onDirty);
  attachTrainerLevelCapSetting(project, detail, changed);
  return { render };
}

type Picker = {
  open: () => void;
  close: () => void;
  handleKey: (event: KeyboardEvent) => boolean;
};

/**
 * Picker for a contenteditable field: lists every option on focus (current one
 * marked), filters as you type, and supports arrow keys and Enter. Options
 * written as "Name (12)" show the name and keep the id for an exact commit.
 */
export function installPicker(field: HTMLElement, values: string[]): Picker | undefined {
  if (values.length === 0) return undefined;
  const host = document.createElement("span");
  host.setAttribute("data-autocomplete", "");
  field.before(host);
  host.append(field);
  const list = document.createElement("div");
  list.className = "suggestions";
  list.hidden = true;
  host.append(list);
  const options = values.map((value) => {
    const match = /^(.*) \((\d+)\)$/u.exec(value);
    return match ? { value, label: match[1], hint: match[2] } : { value, label: value, hint: "" };
  });

  let focusValue = "";
  let active = -1;
  const items = () => [...list.querySelectorAll<HTMLElement>("[data-index]")];
  const setActive = (index: number) => {
    const all = items();
    all[active]?.classList.remove("is-active");
    active = Math.max(-1, Math.min(all.length - 1, index));
    all[active]?.classList.add("is-active");
    all[active]?.scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    const query = field.textContent?.trim().toLowerCase() ?? "";
    const browsing = query === "" || query === focusValue.toLowerCase();
    const matches = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => browsing || option.label.toLowerCase().includes(query) || option.hint === query)
      .slice(0, browsing ? undefined : 60);
    list.innerHTML = matches
      .map(({ option, index }) => `<div data-index="${index}"${option.label.toLowerCase() === query ? ' class="is-current"' : ""}>${escapeHtml(option.label)}${option.hint ? `<small>${option.hint}</small>` : ""}</div>`)
      .join("");
    list.hidden = matches.length === 0;
    active = -1;
    if (!browsing && matches.length) setActive(0);
    const current = list.querySelector<HTMLElement>(".is-current");
    list.scrollTop = browsing && current ? Math.max(0, current.offsetTop - list.clientHeight / 2) : 0;
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    field.textContent = option.label;
    if (option.hint) {
      field.dataset.commitValue = option.value;
      field.dataset.commitLabel = option.label;
    }
    list.hidden = true;
    field.blur();
  };

  field.addEventListener("input", render);
  list.addEventListener("mousedown", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (!item) return;
    event.preventDefault();
    choose(Number(item.dataset.index));
  });

  return {
    open: () => {
      focusValue = field.textContent?.trim() ?? "";
      render();
    },
    close: () => window.setTimeout(() => {
      list.hidden = true;
    }, 120),
    handleKey: (event) => {
      if (list.hidden) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive(active + (event.key === "ArrowDown" ? 1 : -1));
        return true;
      }
      if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        choose(Number(items()[active]?.dataset.index));
        return true;
      }
      if (event.key === "Escape") {
        list.hidden = true;
        return false;
      }
      return false;
    },
  };
}

async function copyWithFeedback(button: HTMLButtonElement, text: () => string): Promise<void> {
  const label = button.textContent ?? "Copy";
  try {
    await writeClipboardText(text());
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = label;
    }, 1200);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

export async function writeClipboardText(text: string): Promise<void> {
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

function requestShowdownImportText(title: string, description: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "trainer-showdown-import-modal";
    overlay.innerHTML = `
      <form class="trainer-showdown-import-dialog">
        <div class="trainer-showdown-import-title">${escapeHtml(title)}</div>
        <p class="trainer-showdown-import-description">${escapeHtml(description)}</p>
        <textarea class="trainer-showdown-import-input" spellcheck="false" placeholder="Garchomp @ Choice Scarf&#10;Ability: Rough Skin&#10;Level: 50&#10;Jolly Nature&#10;- Earthquake"></textarea>
        <div class="trainer-showdown-import-actions">
          <button class="btn" type="button" data-cancel>Cancel</button>
          <button class="btn -primary" type="submit">Import</button>
        </div>
      </form>
    `;
    const textarea = overlay.querySelector<HTMLTextAreaElement>("textarea");
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
