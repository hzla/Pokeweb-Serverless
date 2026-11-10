import { installCodeInjectionPatch } from "../pokeweb/codeInjectionInstall";
import {
  addMegaRoute, FIRST_MEGA_STONE_ID, getMegaEditorState, megaFormOwner, megaTriggerNames, nameMegaForm, nextMegaSuffix, removeMegaRoute, resolveMegaTrigger, updateMegaRoute,
  type MegaEditorRoute, type MegaEditorState,
} from "../pokeweb/megaEditorModel";
import { getMegaContentStatus, installMegaContent, stageCustomMegaStone } from "../pokeweb/megaContentModel";
import type { MegaRoute } from "../pokeweb/megaEvolutionModel";
import { addPokemonForm } from "../pokeweb/pokemonFormModel";
import { pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import type { ProjectState } from "../pokeweb/projectStore";
import { escapeHtml } from "./dom";

/**
 * Mega Evolution section of the Pokémon editor's Evolutions tab: the Mega routes from the selected form (trigger item
 * or move, Mega form), a New form shortcut, New Mega Stone, and, for a Mega form, what it is reached from.
 * Black 2 / White 2 on localhost only, like the Code Injection card.
 */

export type PokemonMegaPanelOptions = {
  onDirty?: () => void;
  /** Re-render the whole editor on a personal record (after forms or installs change the Pokémon list). */
  rerender: (personalId: number) => void;
  select: (personalId: number) => void;
  onEnsureFormAssets?: () => Promise<void>;
};

const NEW_FORM = "new";
/** One status line per editor, kept across the section's re-renders. */
const statusMessages = new WeakMap<ProjectState, { personalId: number; text: string }>();

export function renderPokemonMegaSection(project: ProjectState, personalId: number): string {
  const state = getMegaEditorState(project, personalId);
  if (!state.available) return "";
  return `<section class="pd-mega" data-mega-section data-personal-id="${personalId}">${renderMegaSectionBody(project, personalId, state)}</section>`;
}

function renderMegaSectionBody(project: ProjectState, personalId: number, state: MegaEditorState): string {
  // A status line shows once, on the next render of the same Pokémon.
  const status = statusMessages.get(project);
  const statusText = status?.personalId === personalId ? status.text : "";
  statusMessages.delete(project);
  const head = `<div class="pd-mega-head"><h3>Mega Evolution</h3></div>`;
  const statusLine = `<p class="pd-note pd-mega-status" data-mega-status aria-live="polite">${escapeHtml(statusText)}</p>`;
  if (!state.installed) {
    const install = getMegaContentStatus(project);
    return `${head}
      <p class="pd-note">Mega Evolution isn't installed in this project. Installing adds the runtime, Item Expansion, Move Expansion and the 71 Mega Pokémon with their Mega Stones; custom Megas can then be added here.</p>
      <div class="pd-mega-actions">
        <button class="btn sm -primary" type="button" data-mega-install ${install.ready ? "" : "disabled"}${install.ready || !install.message ? "" : ` title="${escapeHtml(install.message)}"`}>Install Mega Evolution</button>
      </div>
      ${statusLine}`;
  }
  const items = project.texts.banks.items ?? [];
  const moves = project.texts.banks.moves ?? [];
  const reached = state.reachedBy.map((entry) => {
    const source = state.forms[entry.route.sourceForm];
    return `<p class="pd-mega-reached">Mega form of <button class="pd-mega-link" type="button" data-mega-goto="${source?.personalId ?? state.species}">${escapeHtml(source?.label ?? pokemonSpeciesLabel(project, state.species))}</button>, ${entry.route.moveTrigger ? "knowing" : "holding"} ${escapeHtml(triggerName(entry.route, items, moves))}.</p>`;
  }).join("");
  if (state.reachedBy.length && !state.routes.length) {
    return `${head}
      ${reached}
      <p class="pd-note">This is a Mega form: set its stats, types, ability and sprites in the other tabs. Its Mega Evolution is listed on ${escapeHtml(state.forms[state.reachedBy[0].route.sourceForm]?.label ?? "the base form")}.</p>
      ${statusLine}`;
  }
  const targets = state.forms.filter((form) => form.form !== state.form);
  const rows = state.routes.map((entry) => renderRoute(entry, targets, items, moves)).join("");
  const draftTarget = targets.find((form) => !state.routes.some((entry) => entry.route.targetForm === form.form) && !state.reachedBy.length)?.form;
  return `${head}
    ${reached}
    <p class="pd-note">A Pokémon in this form holding the item (or knowing the move) can Mega Evolve into the Mega form once per battle. Add the Mega form with New form, then set its stats, types, ability and sprites in the other tabs.</p>
    <div class="pd-mega-table" role="table" aria-label="Mega Evolutions">
      <div class="pd-mega-headrow" role="row" aria-hidden="true"><span>Trigger</span><span>Item or move</span><span class="r">ID</span><span>Mega form</span><span></span></div>
      ${rows}
      ${state.capacityLeft > 0 ? renderDraft(targets, draftTarget) : `<p class="pd-note">The route table is full (192 Mega Evolutions).</p>`}
    </div>
    <div class="pd-mega-actions">
      <button class="btn sm" type="button" data-mega-new-stone>New Mega Stone…</button>
    </div>
    ${statusLine}
    <datalist id="mega-item-names">${megaTriggerNames(items).map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("")}</datalist>
    <datalist id="mega-move-names">${megaTriggerNames(moves).map((move) => `<option value="${escapeHtml(move.name)}"></option>`).join("")}</datalist>`;
}

function triggerName(route: MegaRoute, items: readonly string[], moves: readonly string[]): string {
  return (route.moveTrigger ? moves : items)[route.trigger]?.trim() || `#${route.trigger}`;
}

function kindSelect(moveTrigger: boolean | undefined): string {
  return `<select class="pd-mega-input" data-mega-kind aria-label="Mega Evolution trigger">
    <option value="item"${moveTrigger ? "" : " selected"}>Held item</option>
    <option value="move"${moveTrigger ? " selected" : ""}>Knows move</option>
  </select>`;
}

function targetSelect(targets: MegaEditorState["forms"], selected: number | undefined, problem?: string): string {
  const options = targets.map((form) => `<option value="${form.form}"${form.form === selected ? " selected" : ""}>${escapeHtml(`${form.form}: ${form.label}`)}</option>`);
  if (problem && selected !== undefined && !targets.some((form) => form.form === selected)) options.unshift(`<option value="${selected}" selected>Form ${selected} (missing)</option>`);
  if (selected === undefined) options.unshift(`<option value="" selected disabled>Choose a form</option>`);
  return `<select class="pd-mega-input" data-mega-target aria-label="Mega form">${options.join("")}<option value="${NEW_FORM}">New form…</option></select>`;
}

function triggerWarning(route: Pick<MegaRoute, "trigger" | "moveTrigger">): string {
  return !route.moveTrigger && route.trigger > 0 && route.trigger < FIRST_MEGA_STONE_ID
    ? "This is a regular item: it keeps its own effect in battle (use New Mega Stone for an item with no effect)."
    : "";
}

function renderRoute(entry: MegaEditorRoute, targets: MegaEditorState["forms"], items: readonly string[], moves: readonly string[]): string {
  const note = entry.problem ?? triggerWarning(entry.route);
  const target = targets.find((form) => form.form === entry.route.targetForm && form.personalId !== undefined && form.form > 0);
  return `
    <div class="pd-mega-row${entry.problem ? " -problem" : ""}" role="row" data-mega-route="${entry.index}">
      ${kindSelect(entry.route.moveTrigger)}
      <input class="pd-mega-input" data-mega-trigger list="${entry.route.moveTrigger ? "mega-move-names" : "mega-item-names"}" value="${escapeHtml(triggerName(entry.route, items, moves))}" aria-label="${entry.route.moveTrigger ? "Move" : "Held item"}" autocomplete="off" spellcheck="false">
      <span class="r pd-mega-id">${entry.route.trigger}</span>
      <div class="pd-mega-target">
        ${targetSelect(targets, entry.route.targetForm, entry.problem)}
        ${target ? `<button class="btn sm" type="button" data-mega-goto="${target.personalId}" title="Open ${escapeHtml(target.label)} to edit its stats, types, ability and sprites">Open</button>` : ""}
      </div>
      <button class="btn sm -danger" type="button" data-mega-remove aria-label="Remove this Mega Evolution">Remove</button>
      ${note ? `<p class="pd-mega-row-note">${escapeHtml(note)}</p>` : ""}
    </div>`;
}

function renderDraft(targets: MegaEditorState["forms"], target: number | undefined): string {
  return `
    <div class="pd-mega-row -draft" role="row" data-mega-draft>
      ${kindSelect(false)}
      <input class="pd-mega-input" data-mega-trigger list="mega-item-names" value="" placeholder="Item name" aria-label="Held item" autocomplete="off" spellcheck="false">
      <span class="r pd-mega-id"></span>
      <div class="pd-mega-target">${targetSelect(targets, target)}</div>
      <button class="btn sm -primary" type="button" data-mega-add>Add</button>
    </div>`;
}

/** The route table's validation speaks of "Route N"; here the row is the route. */
function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/duplicates an earlier route/u.test(message)) return "Another Mega Evolution of this Pokémon already uses that trigger.";
  return message.replace(/^Route \d+: /u, "");
}

/** Installs the section's listeners once on the editor's detail pane (delegated, so re-renders keep working). */
export function attachPokemonMegaSection(container: HTMLElement, project: ProjectState, options: PokemonMegaPanelOptions): void {
  if (container.dataset.megaSectionInstalled === "true") return;
  container.dataset.megaSectionInstalled = "true";

  const sectionOf = (element: Element) => element.closest<HTMLElement>("[data-mega-section]");
  const personalIdOf = (section: HTMLElement) => Number(section.dataset.personalId);
  const setStatus = (section: HTMLElement, text: string) => {
    statusMessages.set(project, { personalId: personalIdOf(section), text });
    const line = section.querySelector<HTMLElement>("[data-mega-status]");
    if (line) line.textContent = text;
  };
  const refresh = (section: HTMLElement, text?: string) => {
    const personalId = personalIdOf(section);
    if (text !== undefined) statusMessages.set(project, { personalId, text });
    section.innerHTML = renderMegaSectionBody(project, personalId, getMegaEditorState(project, personalId));
  };
  const fail = (section: HTMLElement, error: unknown) => refresh(section, readableError(error));
  const names = (moveTrigger: boolean) => (moveTrigger ? project.texts.banks.moves : project.texts.banks.items) ?? [];

  /** Adds a form to the species (New form…) and returns its index. */
  const newForm = async (section: HTMLElement): Promise<number | undefined> => {
    const { species } = megaFormOwner(project, personalIdOf(section));
    const name = pokemonSpeciesLabel(project, species);
    if (!window.confirm(`Add a new form to ${name} for its Mega Evolution? This appends personal, learnset, evolution, sprite and icon files copied from ${name}.`)) return undefined;
    await options.onEnsureFormAssets?.();
    const suffix = nextMegaSuffix(project, species);
    const added = addPokemonForm(project, species);
    nameMegaForm(project, added.personalId, suffix);
    return added.formIndex;
  };

  /** Reads a row: kind, trigger ID (0 when the name doesn't match) and the chosen form. */
  const readRow = (row: HTMLElement) => {
    const moveTrigger = row.querySelector<HTMLSelectElement>("[data-mega-kind]")?.value === "move";
    const text = row.querySelector<HTMLInputElement>("[data-mega-trigger]")?.value ?? "";
    const target = row.querySelector<HTMLSelectElement>("[data-mega-target]")?.value ?? "";
    return { moveTrigger, text, trigger: resolveMegaTrigger(names(moveTrigger), text), target };
  };

  container.addEventListener("change", (event) => {
    const element = event.target as HTMLElement;
    const section = sectionOf(element);
    const row = element.closest<HTMLElement>("[data-mega-route], [data-mega-draft]");
    if (!section || !row) return;
    const read = readRow(row);
    if (element.matches("[data-mega-kind]")) {
      const input = row.querySelector<HTMLInputElement>("[data-mega-trigger]")!;
      input.setAttribute("list", read.moveTrigger ? "mega-move-names" : "mega-item-names");
      input.placeholder = read.moveTrigger ? "Move name" : "Item name";
      input.setAttribute("aria-label", read.moveTrigger ? "Move" : "Held item");
      if (row.hasAttribute("data-mega-draft") || !read.trigger) { input.value = ""; return; }
    }
    if (element.matches("[data-mega-trigger]")) {
      const id = row.querySelector<HTMLElement>(".pd-mega-id");
      if (id) id.textContent = read.trigger ? String(read.trigger) : "";
      if (row.hasAttribute("data-mega-draft")) return;
      if (!read.trigger) { setStatus(section, `No ${read.moveTrigger ? "move" : "item"} is called "${read.text.trim()}".`); return; }
    }
    if (row.hasAttribute("data-mega-draft")) {
      if (element.matches("[data-mega-target]") && read.target === NEW_FORM) {
        void newForm(section).then((form) => {
          if (form === undefined) { refresh(section); return; }
          options.onDirty?.();
          statusMessages.set(project, { personalId: personalIdOf(section), text: `Added form ${form}. Choose the trigger and press Add.` });
          options.rerender(personalIdOf(section));
        }).catch((error) => fail(section, error));
      }
      return;
    }
    const index = Number(row.dataset.megaRoute);
    void (async () => {
      const change: Partial<MegaRoute> = {};
      if (element.matches("[data-mega-target]")) {
        const form = read.target === NEW_FORM ? await newForm(section) : Number(read.target);
        if (form === undefined) { refresh(section); return; }
        change.targetForm = form;
        if (read.target === NEW_FORM) options.onDirty?.();
      } else {
        if (!read.trigger) return;
        change.trigger = read.trigger;
        change.moveTrigger = read.moveTrigger;
      }
      updateMegaRoute(project, index, change);
      options.onDirty?.();
      if (read.target === NEW_FORM) {
        statusMessages.set(project, { personalId: personalIdOf(section), text: `Added form ${change.targetForm} as the Mega form.` });
        options.rerender(personalIdOf(section));
      } else {
        refresh(section, "Saved.");
      }
    })().catch((error) => fail(section, error));
  });

  container.addEventListener("keydown", (event) => {
    const element = event.target as HTMLElement;
    if (event.key === "Enter" && element.matches("[data-mega-section] [data-mega-trigger]")) {
      event.preventDefault();
      element.blur();
    }
  });

  container.addEventListener("click", (event) => {
    const element = event.target as HTMLElement;
    const section = sectionOf(element);
    if (!section) return;
    const button = element.closest<HTMLButtonElement>("button");
    if (!button) return;

    if (button.matches("[data-mega-goto]")) {
      options.select(Number(button.dataset.megaGoto));
      return;
    }

    if (button.matches("[data-mega-install]")) {
      button.disabled = true;
      button.textContent = "Installing…";
      void installMegaContent(project, (stage) => installCodeInjectionPatch(project, stage)).then((report) => {
        options.onDirty?.();
        statusMessages.set(project, { personalId: personalIdOf(section), text: `Mega Evolution installed: ${report.forms.length} Mega Pokémon and their Mega Stones. Convert existing saves on Code Injection → Item Expansion.` });
        options.rerender(personalIdOf(section));
      }).catch((error) => fail(section, error));
      return;
    }

    if (button.matches("[data-mega-remove]")) {
      const row = button.closest<HTMLElement>("[data-mega-route]");
      if (!row) return;
      try {
        removeMegaRoute(project, Number(row.dataset.megaRoute));
        options.onDirty?.();
        refresh(section, "Mega Evolution removed. The Mega form itself stays; delete it on the Personal tab if it's no longer needed.");
      } catch (error) { fail(section, error); }
      return;
    }

    if (button.matches("[data-mega-add]")) {
      const row = button.closest<HTMLElement>("[data-mega-draft]");
      if (!row) return;
      const read = readRow(row);
      const { species, form } = megaFormOwner(project, personalIdOf(section));
      if (!read.trigger) { setStatus(section, read.text.trim() ? `No ${read.moveTrigger ? "move" : "item"} is called "${read.text.trim()}".` : `Choose the ${read.moveTrigger ? "move" : "held item"}.`); return; }
      if (!read.target || read.target === NEW_FORM) { setStatus(section, "Choose the Mega form, or New form… to add one."); return; }
      try {
        addMegaRoute(project, { species, sourceForm: form, trigger: read.trigger, targetForm: Number(read.target), moveTrigger: read.moveTrigger });
        options.onDirty?.();
        const warning = triggerWarning(read);
        refresh(section, `Mega Evolution added.${warning ? ` ${warning}` : ""}`);
      } catch (error) { fail(section, error); }
      return;
    }

    if (button.matches("[data-mega-new-stone]")) {
      const { species } = megaFormOwner(project, personalIdOf(section));
      const pokemon = pokemonSpeciesLabel(project, species);
      const name = window.prompt(`Name of the new Mega Stone for ${pokemon} (up to 16 characters):`, `${pokemon.replace(/[^A-Za-z0-9 .'-]+/gu, "").slice(0, 12)}ite`);
      if (!name?.trim()) return;
      button.disabled = true;
      void stageCustomMegaStone(project, { name, pokemon }).then((id) => {
        options.onDirty?.();
        refresh(section, `Created ${name.trim()} (item ${id}). Pick it as the held item below; edit its description in the Item editor.`);
        const draft = section.querySelector<HTMLElement>("[data-mega-draft]");
        const input = draft?.querySelector<HTMLInputElement>("[data-mega-trigger]");
        if (draft && input && draft.querySelector<HTMLSelectElement>("[data-mega-kind]")?.value !== "move") {
          input.value = name.trim();
          const idCell = draft.querySelector<HTMLElement>(".pd-mega-id");
          if (idCell) idCell.textContent = String(id);
        }
      }).catch((error) => fail(section, error));
    }
  });
}
