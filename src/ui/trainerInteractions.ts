import { attachRosterHub, clearPoolRoll, ensureRosterLists, renderRosterHub } from "./trainerRosterHub";
import {
  autofillPoolMemberMoves, editPoolMemberField, editRosterPool, newPoolMember, originalRosterKey, poolPokemonFromTrainerSlot, setPoolMemberSetting, trainerHasRosterVariants,
  type RosterKey,
} from "../pokeweb/trainerRosterHub";
import { trainerPoolGroupBit, trainerPoolSource, type TrainerPartyPool, type TrainerPoolPokemon } from "../pokeweb/trainerPartyPools";
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
import { getTrainerCustomizationStatus, getTrainerMemberSettings, trainerCustomizationNeedsInstall, updateTrainerMemberSettings, type TrainerMemberSettings } from "../pokeweb/trainerCustomizationModel";
import { updateTrainerText } from "../pokeweb/trainerTextModel";
import { followTrainerSlotMoves, getTrainerSlotMovePools, setTrainerSlotMovePools, trainerSlotMoves } from "../pokeweb/trainerRosterModel";
import { emptyTrainerMovePools, hasMoveAlternatives, TRAINER_MOVE_WEIGHT_MAX, type TrainerMovePools } from "../pokeweb/trainerMovePools";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml, selectText } from "./dom";
import { attachTrainerFieldSettings } from "./trainerFieldConditions";
import { attachTrainerLevelCapSetting } from "./trainerLevelCaps";
import { installBw2DialoguePreview, type Bw2DialoguePreview } from "./bw2DialoguePreview";
import { assumedDialogueVariables, installGameTextEditor } from "./textHighlight";
import {
  editedTrainerFields,
  partyNote,
  renderEmptyParty,
  renderTrainerDetail,
  rosterView,
  renderNewMoveAlternative,
  renderTrainerDialogue,
  renderTrainerPartyStrip,
  renderTrainerSlotEditor,
  renderTrainerSpriteImage,
} from "./trainerDetail";

/** The open trainer, the roster tab shown (its own party unless set) and the selected Pokémon in it. */
export type TrainerSelection = { trainerId: number; slot: number; roster?: RosterKey };

export type TrainerDetailOptions = {
  onDirty?: () => void;
  /** rosterSource: the roster to fight (a trainer ID, or a party or pool ID with bit 15 set); the game's own choice when omitted. */
  onTestBattle?: (trainerId: number, showdownText: string, rosterSource?: number) => Promise<void>;
  onOpenTrainerSprite?: (trainerClassId: number) => void;
  /** Open another trainer in the editor. */
  onOpenTrainer?: (trainerId: number) => void;
  /** Install or update Trainer Customization (without redrawing). Edits that need the patch call this first. */
  installCustomization?: () => Promise<void>;
  /** Redraw the whole editor once an edit has installed Trainer Customization. */
  onCustomizationInstalled?: () => void;
  /** Called after any change to a trainer so its list row can be redrawn. */
  onTrainerChanged?: (trainerId: number) => void;
  getTestTeamText: () => string;
  autofills: Record<string, string[]>;
  natureField: boolean;
  /** The ROM has its own trainer nature patch, so choosing a nature doesn't need Trainer Customization. */
  natureNative?: boolean;
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
  const view = () => rosterView(project, trainerId(), selection.roster ?? originalRosterKey, selection.slot);
  /** The selected party or pool member's own Pokémon, when the open roster is an alternate party or pool. */
  const poolPokemon = (pool: TrainerPartyPool): TrainerPoolPokemon => {
    const member = pool.members[selection.slot];
    if (!member || !("pokemon" in member)) throw new Error("This candidate is linked from another trainer; edit it there or copy it into the pool.");
    return member.pokemon;
  };
  /** Change the open alternate party or pool. A change that leaves it unable to build a team stays a draft. */
  const editPool = (change: (pool: TrainerPartyPool) => void) => {
    const current = view();
    if (current.poolId === undefined) throw new Error("Choose an alternate party or pool first.");
    const result = editRosterPool(project, current.poolId, change);
    clearPoolRoll(project, current.poolId);
    renderHub();
    return result;
  };
  const renderHub = () => {
    const hub = detail.querySelector<HTMLElement>("[data-roster-hub]");
    if (hub) {
      try {
        hub.innerHTML = renderRosterHub(project, trainerId(), view().key);
        ensureRosterLists(project, detail);
      } catch {
        hub.innerHTML = "";
      }
    }
    const note = detail.querySelector<HTMLElement>(".td-party .td-bar-note");
    if (note) note.textContent = partyNote(view());
  };

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
    const current = view();
    selection.roster = current.key;
    const trainer = current.record;
    if (!trainer.party.some((pok) => pok.slot === selection.slot)) selection.slot = trainer.party.length ? 0 : -1;
    detail.innerHTML = renderTrainerDetail(project, trainerId(), selection.slot, options.natureField, current.key);
    installFields(detail);
    ensureRosterLists(project, detail);
    installDialoguePreview();
    refreshMarks();
    detail.scrollTop = scrollTop;
  };

  /** Re-render the strip and slot editor after a structural party change. */
  const renderParty = () => {
    let current = view();
    let trainer = current.record;
    if (!trainer.party.some((pok) => pok.slot === selection.slot)) {
      selection.slot = trainer.party.length ? Math.min(Math.max(selection.slot, 0), trainer.party.length - 1) : -1;
      current = view();
      trainer = current.record;
    }
    selection.roster = current.key;
    const strip = detail.querySelector<HTMLElement>("[data-party-strip]");
    const editor = detail.querySelector<HTMLElement>("[data-slot-editor]");
    const pok = trainer.party.find((slot) => slot.slot === selection.slot);
    if (strip) {
      strip.innerHTML = renderTrainerPartyStrip(project, trainer, selection.slot, current);
      strip.classList.toggle("-pool", current.kind === "pool");
    }
    if (editor) {
      editor.innerHTML = pok ? renderTrainerSlotEditor(project, trainer, pok, options.natureField, current) : renderEmptyParty(current);
      installFields(editor);
    }
    renderHub();
    const copyTeam = detail.querySelector<HTMLButtonElement>("[data-team-copy]");
    if (copyTeam) copyTeam.disabled = trainer.party.length === 0;
    refreshMarks();
  };

  /**
   * Update what a field edit can change without replacing focusable elements,
   * so a click that ended the edit still lands on its target.
   */
  const refreshSlotDerived = () => {
    const current = view();
    const trainer = current.record;
    const pok = trainer.party.find((slot) => slot.slot === selection.slot);
    const editor = detail.querySelector<HTMLElement>("[data-slot-editor]");
    if (!pok || !editor) return;
    const next = document.createElement("template");
    next.innerHTML = renderTrainerSlotEditor(project, trainer, pok, options.natureField, current);
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
    installFields(editor);
    editor.querySelectorAll<HTMLElement>(".td-move-table tbody tr").forEach((row) => row.classList.toggle("-default", !trainer.hasMoves));
    const strip = document.createElement("template");
    strip.innerHTML = renderTrainerPartyStrip(project, trainer, selection.slot, current);
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
    if (narc === "trmove" && fieldName.endsWith("_new") && !nextValue) {
      field.closest("tr")?.remove();
      return false;
    }
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
      } else if (narc === "trmove") {
        const match = /^movealt_([0-3])_(\d+|new)$/u.exec(fieldName);
        if (!match) throw new Error(`Unsupported move field: ${fieldName}`);
        const slot = Number(match[1]), index = match[2] === "new" ? -1 : Number(match[2]);
        const move = resolveMove(nextValue);
        withCustomization(() => editMoves((pools, moves) => {
          const alternatives = pools[slot]!.alternatives;
          if (move && (move === moves[slot] || alternatives.some((option, other) => other !== index && option.move === move)))
            throw new Error(`${nextValue} is already a choice for move ${slot + 1}.`);
          if (index < 0) {
            if (move) alternatives.push({ move, weight: 1 });
          } else if (!move) alternatives.splice(index, 1);
          else alternatives[index]!.move = move;
        }));
        return true;
      } else if (view().pool) {
        let shown: string | number = nextValue;
        const member = view().pool?.members[selection.slot];
        const varied = !!member && "pokemon" in member && hasMoveAlternatives(member.pokemon.movePools);
        const result = editPool((pool) => { shown = editPoolMemberField(project, poolPokemon(pool), fieldName, nextValue); });
        field.textContent = String(shown);
        if (!result.saved) field.title = `Not saved yet: ${result.problem}`;
        if (varied && /^move_[1-4]_\d+$/u.test(fieldName)) window.setTimeout(renderParty, 0);
        else refreshSlotDerived();
      } else {
        const moveField = /^move_[1-4]_\d+$/u.test(fieldName);
        if (moveField) fillDefaultMovesBeforeEnabling();
        const previousMoves = trainerSlotMoves(project, trainerId(), selection.slot);
        const result = updateTrainerPokemonField(project, trainerId(), selection.slot, fieldName, nextValue);
        field.textContent = String(result.value);
        const varied = moveField && hasMoveAlternatives(getTrainerSlotMovePools(project, trainerId(), selection.slot));
        if (varied) followTrainerSlotMoves(project, trainerId(), selection.slot, previousMoves);
        if (flagsChanged(before)) window.setTimeout(render, 0);
        else if (varied) window.setTimeout(renderParty, 0);
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
    if (button.dataset.moveAltAdd !== undefined) {
      const slot = Number(button.dataset.moveAltAdd);
      // Put the new row under the slot's own move and its alternatives.
      let last = detail.querySelector<HTMLElement>(`[data-slot-editor] tr[data-move-row="${slot}"]`);
      while (last?.nextElementSibling?.classList.contains("td-move-alt")) last = last.nextElementSibling as HTMLElement;
      const existing = detail.querySelector<HTMLElement>(`[data-slot-editor] tr.-new[data-move-alt-row="${slot}"] [contenteditable]`);
      if (existing) {
        existing.focus();
        return;
      }
      if (!last) return;
      last.insertAdjacentHTML("afterend", renderNewMoveAlternative(slot));
      const row = last.nextElementSibling as HTMLElement;
      installFields(row);
      row.querySelector<HTMLElement>("[contenteditable]")?.focus();
      return;
    }
    if (button.dataset.moveAltRemove !== undefined) {
      const [slot, index] = button.dataset.moveAltRemove.split(":").map(Number) as [number, number];
      withCustomization(() => editMoves((pools) => { pools[slot]!.alternatives.splice(index, 1); }));
      return;
    }
    const choice = button.dataset.slotChoice ?? button.dataset.memberChoice;
    if (choice !== undefined) {
      if (button.getAttribute("aria-pressed") === "true") return;
      if (button.dataset.memberChoice !== undefined && !view().pool) withCustomization(() => applyChoice(button, choice));
      else applyChoice(button, choice);
      return;
    }
    const run = (action: () => void, after: () => void = renderParty) => {
      try {
        action();
        after();
        changed();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
    };

    const poolView = view();
    if (poolView.pool && button.matches("[data-party-add], [data-slot-move], [data-slot-duplicate], [data-slot-delete], [data-slot-autofill], [data-pool-role], [data-pool-group], [data-pool-unlink]")) {
      run(() => {
        editPool((pool) => {
          const members = pool.members;
          const slot = selection.slot;
          if (button.matches("[data-party-add]")) {
            const previous = members[members.length - 1];
            const member = newPoolMember(project, previous && "pokemon" in previous ? previous.pokemon : undefined);
            if (pool.slotGroups) member.groups = trainerPoolGroupBit(pool.slotGroups[0]);
            members.push(member);
            selection.slot = members.length - 1;
          } else if (button.matches("[data-slot-move]")) {
            const to = slot + Number(button.dataset.slotMove);
            if (!members[to]) return;
            [members[slot], members[to]] = [members[to]!, members[slot]!];
            selection.slot = to;
          } else if (button.matches("[data-slot-duplicate]")) {
            const member = members[slot];
            if (!member) return;
            members.splice(slot + 1, 0, structuredClone(member));
            selection.slot = slot + 1;
          } else if (button.matches("[data-slot-delete]")) {
            members.splice(slot, 1);
          } else if (button.matches("[data-slot-autofill]")) {
            autofillPoolMemberMoves(project, poolPokemon(pool));
          } else if (button.matches("[data-pool-role]")) {
            const member = members[slot];
            if (member) member.role = Number(button.dataset.value);
          } else if (button.matches("[data-pool-group]")) {
            const member = members[slot];
            if (member && pool.slotGroups) member.groups = (member.groups ?? 0) ^ trainerPoolGroupBit(Number(button.dataset.value));
          } else if (button.matches("[data-pool-unlink]")) {
            const member = members[slot];
            if (member && !("pokemon" in member)) members[slot] = { role: member.role, groups: member.groups, pokemon: poolPokemonFromTrainerSlot(project, member.trainerId, member.slot) };
          }
        });
      });
      return;
    }
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
        const previousMoves = trainerSlotMoves(project, id, selection.slot);
        autofillTrainerPokemonMoves(project, id, selection.slot);
        followTrainerSlotMoves(project, id, selection.slot, previousMoves);
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
        // With variations, fight the roster on screen unless "Game's pick" is chosen.
        const current = view();
        const gamePick = detail.querySelector<HTMLSelectElement>("[data-test-roster]")?.value !== "shown";
        const source = gamePick || !trainerHasRosterVariants(project, id) ? undefined
          : current.kind === "original" ? id : current.kind === "trainer" ? current.record.id : current.poolId === undefined ? undefined : trainerPoolSource(current.poolId);
        await options.onTestBattle(id, options.getTestTeamText(), source);
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
    if (target instanceof HTMLInputElement && target.dataset.moveWeight) {
      const [slot, option] = target.dataset.moveWeight.split(":") as [string, string];
      const weight = Math.round(target.valueAsNumber);
      const own = option === "own";
      if (!(weight >= (own ? 0 : 1) && weight <= TRAINER_MOVE_WEIGHT_MAX)) {
        renderParty();
        return;
      }
      withCustomization(() => editMoves((pools) => {
        const entry = pools[Number(slot)]!;
        if (own) entry.weight = weight;
        else entry.alternatives[Number(option)]!.weight = weight;
      }));
      return;
    }
    // Trainer Customization's settings, and the nature when only the patch can set it, install the patch first.
    const customization = target.dataset.hpExact !== undefined || target.dataset.trainerCustomization !== undefined
      || (target.dataset.slotSelect?.startsWith("nature") && getTrainerCustomizationStatus(project) === "ready" && !options.natureNative);
    if (customization && !view().pool && (pendingEdits || trainerCustomizationNeedsInstall(project))) withCustomization(() => applyChange(target));
    else applyChange(target);
  }, { signal });
  const applyChange = (target: HTMLElement) => {
    const id = trainerId();
    try {
      if (target instanceof HTMLInputElement && target.dataset.hpExact !== undefined) {
        const max = Number(target.closest<HTMLElement>(".td-hp")?.dataset.hpMax);
        const value = Math.round(target.valueAsNumber);
        if (!(value >= 1) || !(max >= 1)) {
          refreshSlotDerived();
          return;
        }
        setStartingHp(value >= max ? 0 : 2, Math.min(value, max));
      } else if ((target instanceof HTMLSelectElement || target instanceof HTMLInputElement) && target.dataset.trainerCustomization) {
        const field = target.dataset.trainerCustomization as keyof TrainerMemberSettings;
        updateTrainerMemberSettings(project, id, selection.slot, field, Number(target.value));
        if (field === "hpMode" || field === "status") renderParty();
      } else if (target instanceof HTMLSelectElement && target.dataset.trainerSelect) {
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
  };

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

  /**
   * Run an edit that needs Trainer Customization. When the patch isn't installed (or is an older version), it is
   * installed first, the edit is applied, and the whole editor is redrawn so every control the patch adds shows.
   * Edits made while the install runs wait for it.
   */
  let pendingEdits: Array<() => void> | undefined;
  const withCustomization = (edit: () => void) => {
    if (pendingEdits) {
      pendingEdits.push(edit);
      return;
    }
    if (!options.installCustomization || !trainerCustomizationNeedsInstall(project)) {
      edit();
      return;
    }
    const edits = pendingEdits = [edit];
    detail.setAttribute("aria-busy", "true");
    void options.installCustomization().then(() => {
      pendingEdits = undefined;
      for (const queued of edits) {
        try {
          queued();
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        }
      }
      detail.removeAttribute("aria-busy");
      if (options.onCustomizationInstalled) options.onCustomizationInstalled();
      else render();
    }, (error: unknown) => {
      pendingEdits = undefined;
      detail.removeAttribute("aria-busy");
      window.alert(`Trainer Customization couldn't be installed: ${error instanceof Error ? error.message : String(error)}`);
      render();
    });
  };
  /** Change the selected Pokémon's move alternatives, in its trainer's party or its alternate party or pool. */
  const editMoves = (change: (pools: TrainerMovePools, moves: readonly number[]) => void) => {
    try {
      if (view().pool) {
        editPool((pool) => {
          const pokemon = poolPokemon(pool);
          const next = structuredClone(pokemon.movePools ?? emptyTrainerMovePools());
          change(next, pokemon.moves);
          if (hasMoveAlternatives(next)) pokemon.movePools = next;
          else delete pokemon.movePools;
        });
      } else {
        const id = trainerId();
        const next = structuredClone(getTrainerSlotMovePools(project, id, selection.slot) ?? emptyTrainerMovePools());
        change(next, trainerSlotMoves(project, id, selection.slot));
        setTrainerSlotMovePools(project, id, selection.slot, next);
      }
      changed();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
    renderParty();
  };
  const resolveMove = (text: string) => {
    const names = project.texts.banks.moves ?? [];
    const value = text.trim();
    if (!value || /^(none|-+)$/iu.test(value)) return 0;
    if (/^\d+$/u.test(value) && Number(value) > 0 && Number(value) < names.length) return Number(value);
    const id = names.findIndex((name, index) => index > 0 && String(name).toLowerCase() === value.toLowerCase());
    if (id > 0) return id;
    throw new Error(`Unknown move: ${text}`);
  };
  /** A pressed choice button in the slot editor: a Pokémon field, or a Trainer Customization setting. */
  const applyChoice = (button: HTMLButtonElement, choice: string) => {
    const id = trainerId();
    try {
      if (view().pool) {
        editPool((pool) => {
          const pokemon = poolPokemon(pool);
          if (button.dataset.slotChoice !== undefined) editPoolMemberField(project, pokemon, choice, button.dataset.value ?? "");
          else setPoolMemberSetting(pokemon, choice as keyof TrainerMemberSettings, Number(button.dataset.value));
        });
      } else if (button.dataset.slotChoice !== undefined) updateTrainerPokemonField(project, id, selection.slot, choice, button.dataset.value ?? "");
      else updateTrainerMemberSettings(project, id, selection.slot, choice as keyof TrainerMemberSettings, Number(button.dataset.value));
      changed();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
    refreshSlotDerived();
    const attribute = button.dataset.slotChoice !== undefined ? "data-slot-choice" : "data-member-choice";
    detail.querySelector<HTMLElement>(`[data-slot-editor] [${attribute}="${CSS.escape(choice)}"][data-value="${CSS.escape(button.dataset.value ?? "")}"]`)?.focus();
  };
  /** Starting HP: 100% is full HP, anything less a percentage, or an exact number typed beside the bar. */
  const setStartingHp = (mode: number, hp: number) => {
    const id = trainerId();
    if (view().pool) {
      editPool((pool) => {
        const pokemon = poolPokemon(pool);
        setPoolMemberSetting(pokemon, "hpMode", mode);
        if (mode) setPoolMemberSetting(pokemon, "hp", hp);
      });
    } else {
      if (getTrainerMemberSettings(project, id, selection.slot).hpMode !== mode) updateTrainerMemberSettings(project, id, selection.slot, "hpMode", mode);
      if (mode && getTrainerMemberSettings(project, id, selection.slot).hp !== hp) updateTrainerMemberSettings(project, id, selection.slot, "hp", hp);
    }
    refreshSlotDerived();
  };
  const commitHpPercent = (percent: number) => withCustomization(() => {
    try {
      setStartingHp(percent >= 100 ? 0 : 1, percent);
      changed();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      refreshSlotDerived();
    }
  });
  /** Show a percentage on the bar while it is dragged, before it is saved. */
  const previewHp = (bar: HTMLElement, percent: number) => {
    const hp = bar.closest<HTMLElement>(".td-hp");
    const max = Number(hp?.dataset.hpMax);
    const fill = bar.querySelector<HTMLElement>(".td-hp-fill");
    const current = max >= 1 ? (percent >= 100 ? max : Math.max(1, Math.floor((max * percent) / 100))) : undefined;
    const share = current !== undefined ? (current / max) * 100 : percent;
    if (fill) {
      fill.style.width = `${share}%`;
      fill.classList.remove("-high", "-mid", "-low");
      fill.classList.add(share > 50 ? "-high" : share > 20 ? "-mid" : "-low");
    }
    const number = hp?.querySelector<HTMLInputElement>("[data-hp-exact]");
    if (number && current !== undefined) number.value = String(current);
    const mode = hp?.querySelector<HTMLElement>(".td-hp-mode");
    if (mode) mode.textContent = percent >= 100 ? "Full" : `${percent}%`;
    bar.setAttribute("aria-valuenow", String(percent));
  };
  const percentAt = (bar: HTMLElement, clientX: number) => {
    const track = bar.querySelector<HTMLElement>(".td-hp-track")?.getBoundingClientRect();
    if (!track || !track.width) return 100;
    return Math.max(1, Math.min(100, Math.round(((clientX - track.left) / track.width) * 100)));
  };
  detail.addEventListener("pointerdown", (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>(".td-hp-bar");
    if (!bar || event.button !== 0) return;
    event.preventDefault();
    bar.focus();
    bar.setPointerCapture(event.pointerId);
    let percent = percentAt(bar, event.clientX);
    previewHp(bar, percent);
    const move = (next: PointerEvent) => {
      percent = percentAt(bar, next.clientX);
      previewHp(bar, percent);
    };
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
      commitHpPercent(percent);
      detail.querySelector<HTMLElement>("[data-slot-editor] .td-hp-bar")?.focus();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }, { signal });
  detail.addEventListener("keydown", (event) => {
    const bar = (event.target as HTMLElement).closest<HTMLElement>(".td-hp-bar");
    if (!bar) return;
    const now = Number(bar.getAttribute("aria-valuenow")) || 100;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    const next = event.key === "Home" ? 1 : event.key === "End" ? 100 : steps[event.key] === undefined ? undefined : Math.max(1, Math.min(100, now + steps[event.key]!));
    if (next === undefined) return;
    event.preventDefault();
    commitHpPercent(next);
    detail.querySelector<HTMLElement>("[data-slot-editor] .td-hp-bar")?.focus();
  }, { signal });

  attachRosterHub(project, detail, {
    trainerId,
    active: () => view().key,
    select: (key) => {
      if (selection.roster === key) return;
      selection.roster = key;
      selection.slot = 0;
      renderParty();
    },
    rerender: renderParty,
    changed,
    openTrainer: (id) => options.onOpenTrainer?.(id),
    install: async () => {
      await options.installCustomization?.();
      if (options.onCustomizationInstalled) options.onCustomizationInstalled();
      else render();
    },
    withCustomization,
  }, signal);
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
