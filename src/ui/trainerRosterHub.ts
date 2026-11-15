import { typeNamesForProject } from "../pokeweb/constants";
import { pokemonBaseSpeciesNameOptions, findPokemonBaseSpeciesId, pokemonSpeciesLabel } from "../pokeweb/pokemonLabels";
import type { ProjectState } from "../pokeweb/projectStore";
import { getStarterEditorState } from "../pokeweb/starterModel";
import { getTrainerCustomizationStatus, hasTrainerPartyPools } from "../pokeweb/trainerCustomizationModel";
import { getTrainerRecord, trainerPokemonSpriteSlug, type TrainerPokemonSlot } from "../pokeweb/trainerModel";
import { isTrainerPoolSource, trainerPoolSource, TRAINER_POOL_GROUPS, TRAINER_POOL_MAX_ID, TRAINER_POOL_SPECIES_RULES } from "../pokeweb/trainerPartyPools";
import {
  copyPoolForTrainer, createAlternateParty, createPool, deletePool, discardRosterPoolDraft, discardRuleDraft, editRosterPool, linkRoster, listTrainerRosters, originalRosterKey,
  poolMemberSlot, removeRoster, rollPoolTeam, rosterKeyFor, rosterPool, rosterRules, ruleDraft, saveRules, setRosterWeight, trainerLabel,
  type RosterKey, type RosterTab,
} from "../pokeweb/trainerRosterHub";
import {
  getTrainerPartyPools, TRAINER_ROSTER_COMPARISONS, TRAINER_ROSTER_ID_LIMIT, TRAINER_ROSTER_MAX_CHOICES, TRAINER_ROSTER_MAX_CONDITIONS,
  TRAINER_ROSTER_MAX_RULES, TRAINER_ROSTER_MAX_WEIGHT, type TrainerRosterCondition, type TrainerRosterRule,
} from "../pokeweb/trainerRosterModel";
import { escapeHtml } from "./dom";
import { renderPartyIcon } from "./trainerDetail";

/*
 * The roster hub above the party cards: a tab for every roster the trainer can field, the controls for the selected
 * one (its share of battles, a pool's draw rules), and the rules that pick between them, written as sentences.
 */

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

/** Rolled sample teams, by pool ID, until the pool changes or another is rolled. */
const rolls = new WeakMap<ProjectState, Map<number, number[] | "none">>();

export function renderRosterInstallPrompt(project: ProjectState): string {
  const status = getTrainerCustomizationStatus(project);
  if (status !== "ready" && status !== "upgrade") return "";
  return `<div class="td-roster-prompt">
    <span>${status === "upgrade" ? "Update Trainer Customization to use" : "Install Trainer Customization for"} alternate parties, random pools, shininess, starting HP and status.</span>
    <button class="btn sm -primary" type="button" data-roster-install>${status === "upgrade" ? "Update patch" : "Install"}</button>
  </div>`;
}

function chanceText(tab: RosterTab): string {
  if (tab.weight > 0) return percent.format(tab.chance);
  return tab.rules ? "Rules" : "Off";
}

function tabIcons(project: ProjectState, trainer: number, tab: RosterTab): string {
  // A small preview of who's in it: the first few Pokémon.
  let slots: TrainerPokemonSlot[] = [];
  try {
    if (tab.kind === "original" || tab.kind === "trainer") slots = getTrainerRecord(project, tab.kind === "original" ? trainer : tab.source, { includeTexts: false }).party.slice(0, 3);
    else {
      const pool = tab.poolId === undefined ? undefined : rosterPool(project, tab.poolId);
      slots = (pool?.members ?? []).slice(0, 3).map((member, index) => poolMemberSlot(project, member, index));
    }
  } catch {
    return "";
  }
  const icons = slots.filter((slot) => slot.speciesId).map((slot) => renderPartyIcon(project, slot, "td-roster-mon"));
  return icons.length ? `<span class="td-roster-mons trainer-poks" aria-hidden="true">${icons.join("")}</span>` : "";
}

export function renderRosterHub(project: ProjectState, trainer: number, active: RosterKey): string {
  if (!hasTrainerPartyPools(project) || trainer < 1 || trainer >= TRAINER_ROSTER_ID_LIMIT) return renderRosterInstallPrompt(project);
  let tabs: RosterTab[];
  try {
    tabs = listTrainerRosters(project, trainer);
  } catch (error) {
    return `<p class="td-roster-problem" role="alert">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
  const selected = tabs.find((tab) => tab.key === active) ?? tabs[0]!;
  const many = tabs.length > 1;
  return `
    <div class="td-roster-bar">
      ${many ? `<div class="td-roster-tabs" role="tablist" aria-label="Rosters">${tabs.map((tab) => `
        <button class="td-roster-tab${tab.problem ? " -problem" : ""}" type="button" role="tab" aria-selected="${tab.key === selected.key}" data-roster-tab="${escapeHtml(tab.key)}" title="${escapeHtml(tabTitle(tab))}">
          ${tabIcons(project, trainer, tab)}
          <span class="td-roster-name">${escapeHtml(tab.label)}</span>
          <span class="td-roster-size">${tab.kind === "pool" ? `${tab.size}/${tab.candidates}` : `${tab.size} mon${tab.size === 1 ? "" : "s"}`}</span>
          <span class="td-roster-chance${tab.weight ? "" : " -off"}">${chanceText(tab)}</span>
        </button>`).join("")}</div>` : `<span class="td-roster-solo">One party${tabs[0]?.rules ? "" : " — add an alternate party or a random pool to vary it"}</span>`}
      <div class="td-roster-actions">
        <button class="btn sm" type="button" data-roster-new="party" title="A second fixed party for this trainer, starting as a copy of the original">+ Party</button>
        <button class="btn sm" type="button" data-roster-new="pool" title="A pool of candidates the game draws a team from, starting with this party">+ Pool</button>
        <button class="btn sm -ghost" type="button" data-roster-link-open title="Use another trainer's party or a pool other trainers use">Link…</button>
      </div>
    </div>
    <form class="td-roster-link" data-roster-link hidden>
      <label>Use <input type="text" name="source" list="td-roster-sources" placeholder="Trainer name, #ID or Pool number" autocomplete="off" required></label>
      <button class="btn sm" type="submit">Link</button>
      <button class="btn sm -ghost" type="button" data-roster-link-close>Cancel</button>
    </form>
    ${many || selected.kind !== "original" ? renderRosterControls(project, trainer, selected, tabs) : ""}
    ${renderRules(project, trainer, tabs)}
    <div class="td-roster-message" role="status" data-roster-message></div>
  `;
}

function tabTitle(tab: RosterTab): string {
  const parts = [tab.kind === "pool" ? `Draws ${tab.size} of ${tab.candidates} candidates` : `${tab.size} Pokémon`];
  if (tab.weight) parts.push(`${percent.format(tab.chance)} of battles when no rule applies`);
  else parts.push(tab.rules ? "Only when a rule picks it" : "Not used yet");
  if (tab.rules) parts.push(`Used by ${tab.rules} rule${tab.rules === 1 ? "" : "s"}`);
  if (tab.problem) parts.push(`Not saved: ${tab.problem}`);
  return parts.join(" · ");
}

function linkSources(project: ProjectState, trainer: number): string[] {
  const names: string[] = [];
  for (const [id, pool] of getTrainerPartyPools(project)) {
    if (pool.owner === undefined) names.push(`Pool ${id} (${pool.members.length} candidates)`);
  }
  const count = Math.min(TRAINER_ROSTER_ID_LIMIT, project.narcs.trdata?.fileCount ?? 0);
  for (let id = 1; id < count; id++) if (id !== trainer && (project.trpokInfo[id]?.numPokemon ?? 0) > 0) names.push(trainerLabel(project, id));
  return names;
}

function parseLinkSource(project: ProjectState, text: string): number {
  const value = text.trim();
  const pool = /^pool\s*#?(\d+)/iu.exec(value);
  if (pool) {
    const id = Number(pool[1]);
    if (id < 1 || id > TRAINER_POOL_MAX_ID || !getTrainerPartyPools(project).has(id)) throw new Error(`There's no Pool ${id}.`);
    return trainerPoolSource(id);
  }
  const trainer = /^#?(\d+)/u.exec(value);
  if (trainer) return Number(trainer[1]);
  const count = Math.min(TRAINER_ROSTER_ID_LIMIT, project.narcs.trdata?.fileCount ?? 0);
  for (let id = 1; id < count; id++) if (trainerLabel(project, id).toLowerCase().includes(value.toLowerCase())) return id;
  throw new Error(`No trainer or pool matches “${value}”.`);
}

export function clearPoolRoll(project: ProjectState, poolId: number): void {
  rolls.get(project)?.delete(poolId);
}

function renderRosterControls(project: ProjectState, trainer: number, tab: RosterTab, tabs: RosterTab[]): string {
  const total = tabs.reduce((sum, entry) => sum + entry.weight, 0);
  const weight = `<label class="td-roster-weight">Weight <input type="number" min="0" max="${TRAINER_ROSTER_MAX_WEIGHT}" value="${tab.weight}" data-roster-weight aria-label="Weight of ${escapeHtml(tab.label)} in the random choice"></label>
    <span class="md-unit">${tab.weight ? `${percent.format(tab.chance)} of battles${total !== tab.weight ? ` (weight ${tab.weight} of ${total})` : ""}` : tab.rules ? "Only when a rule picks it" : "Not used; give it a weight or pick it in a rule"}</span>`;
  const remove = tab.kind === "original" ? ""
    : `<button class="btn sm -remove" type="button" data-roster-remove>${tab.kind === "party" ? "Delete party" : tab.kind === "pool" ? "Remove from trainer" : "Unlink"}</button>`;
  const pool = tab.poolId === undefined ? undefined : rosterPool(project, tab.poolId);
  const shared = tab.kind === "pool" && tab.sharedWith?.length
    ? `<p class="td-roster-note">Shared with ${tab.sharedWith.map((id) => `<a href="#" data-roster-open-trainer="${id}">${escapeHtml(trainerLabel(project, id))}</a>`).join(", ")}. Changes here change their battles too.
        <button class="btn sm" type="button" data-roster-copy-pool>Make a copy for this trainer</button></p>` : "";
  const unusedPool = tab.kind === "pool" && !tab.sharedWith?.length && !tab.weight && !tab.rules
    ? `<button class="btn sm -remove" type="button" data-roster-delete-pool>Delete pool</button>` : "";
  const problem = tab.problem ? `<p class="td-roster-problem" role="alert">Not saved yet: ${escapeHtml(tab.problem)} The ROM keeps the last version that worked. <button class="btn sm -ghost" type="button" data-roster-discard>Undo changes</button></p>` : "";
  const perSlotAvailable = tab.kind === "pool" && getTrainerCustomizationStatus(project) === "installed";
  const settings = tab.kind === "pool" && pool ? `
    <div class="td-pool-settings">
      <label>Draws <select data-pool-setting="size">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === pool.size ? " selected" : ""}${n > pool.members.length ? " disabled" : ""}>${n}</option>`).join("")}</select> of ${pool.members.length}</label>
      ${perSlotAvailable ? `<label>Draw mode <select data-pool-setting="mode">
        <option value="roles"${pool.slotGroups ? "" : " selected"}>Lead / Ace</option>
        <option value="slots"${pool.slotGroups ? " selected" : ""}>Per slot</option>
      </select></label>` : '<button class="btn sm" type="button" data-roster-install>Upgrade for per-slot pools</button>'}
      ${pool.slotGroups ? "" : `<label>Lead and Ace slots <select data-pool-setting="roleSlots"><option value="1"${pool.roleSlots === 1 ? " selected" : ""}>Up to 1 each</option><option value="2"${pool.roleSlots === 2 ? " selected" : ""}>Up to 2 each</option></select></label>`}
      <label>Species <select data-pool-setting="speciesRule">${TRAINER_POOL_SPECIES_RULES.map((label, index) => `<option value="${index}"${index === pool.speciesRule ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
      <label class="md-check"><input type="checkbox" data-pool-setting="itemClause"${pool.itemClause ? " checked" : ""}> No repeated held items</label>
      ${pool.itemClause ? `<label>Except <input type="text" data-pool-setting="itemExceptions" value="${escapeHtml(pool.itemExceptions.map((id) => project.texts.banks.items?.[id] ?? id).join(", "))}" placeholder="Items that may repeat" list="td-roster-items"></label>` : ""}
    </div>
    ${pool.slotGroups ? `<div class="td-pool-settings" role="group" aria-label="Party slot groups">${pool.slotGroups.map((group, slot) =>
      `<label>Slot ${slot + 1} <select data-pool-setting="slotGroup" data-pool-slot="${slot}">${TRAINER_POOL_GROUPS.map((name, index) =>
        `<option value="${index + 1}"${group === index + 1 ? " selected" : ""}>Group ${name}</option>`).join("")}</select></label>`).join("")}</div>` : ""}
    ${renderRoll(project, tab.poolId!, pool)}` : "";
  const linked = tab.kind === "trainer" ? `<p class="td-roster-note">This is ${escapeHtml(trainerLabel(project, tab.source))}'s party; edit it there. <a href="#" data-roster-open-trainer="${tab.source}">Open ${escapeHtml(trainerLabel(project, tab.source))}</a></p>` : "";
  return `<div class="td-roster-controls" data-roster-controls="${escapeHtml(tab.key)}">
    <div class="td-roster-row">${weight}<span class="td-roster-spacer"></span>${unusedPool}${remove}</div>
    ${settings}${shared}${linked}${problem}
  </div>`;
}

function renderRoll(project: ProjectState, poolId: number, pool: NonNullable<ReturnType<typeof rosterPool>>): string {
  const rolled = rolls.get(project)?.get(poolId);
  const team = rolled === "none" ? `<span class="md-unit">This pool can't build a legal team.</span>`
    : rolled ? `<span class="td-roll-team trainer-poks">${rolled.map((index) => {
      const slot = poolMemberSlot(project, pool.members[index]!, index);
      return renderPartyIcon(project, { ...slot, spriteSlug: trainerPokemonSpriteSlug(slot.speciesName, slot.form) }, "td-roll-mon");
    }).join("")}</span><span class="md-unit">${rolled.map((index) => escapeHtml(poolMemberSlot(project, pool.members[index]!, index).speciesName)).join(", ")}</span>` : "";
  return `<div class="td-roll"><button class="btn sm" type="button" data-roster-roll>Roll a team</button>${team}</div>`;
}

// ---------- Rules ----------

function starterNames(project: ProjectState): string[] {
  try {
    const slots = getStarterEditorState(project).slots;
    if (slots.length === 3) return slots.map((slot) => pokemonSpeciesLabel(project, slot.speciesId));
  } catch {
    // Starters that can't be detected fall back to their slots.
  }
  return ["Starter 1", "Starter 2", "Starter 3"];
}

function options(labels: readonly string[], selected: number): string {
  return labels.map((label, index) => `<option value="${index}"${index === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

const COMPARISON_WORDS = ["is", "is not", "is below", "is at most", "is above", "is at least"];

function renderCondition(project: ProjectState, condition: TrainerRosterCondition, index: number): string {
  const { kind, comparison, subject, value } = condition;
  const remove = `<button class="td-rule-x" type="button" data-rule-action="remove-condition" aria-label="Remove this condition" title="Remove this condition">×</button>`;
  const kindSelect = `<select data-rule-field="kind" aria-label="What to check">${options(["the player's party", "the number of", "the highest level in the party", "the player's starter"], kind)}</select>`;
  let rest = "";
  if (kind === 0) {
    rest = `<select data-rule-field="comparison" aria-label="Has or lacks">${options(["has", "doesn't have"], comparison)}</select>
      <input type="text" data-rule-field="species" list="td-rule-species" value="${subject ? escapeHtml(pokemonSpeciesLabel(project, subject)) : ""}" placeholder="Pokémon" aria-label="Pokémon" required>`;
  } else if (kind === 1) {
    rest = `<select data-rule-field="subject" aria-label="Type">${options(typeNamesForProject(project).slice(0, 18), subject)}</select><span>-type Pokémon</span>
      <select data-rule-field="comparison" aria-label="Comparison">${options(COMPARISON_WORDS, comparison)}</select>
      <input type="number" data-rule-field="value" min="0" max="6" value="${value}" aria-label="Count">`;
  } else if (kind === 2) {
    rest = `<select data-rule-field="comparison" aria-label="Comparison">${options(COMPARISON_WORDS, comparison)}</select>
      <input type="number" data-rule-field="value" min="1" max="100" value="${value}" aria-label="Level">`;
  } else {
    rest = `<select data-rule-field="comparison" aria-label="Is or isn't">${options(["is", "isn't"], comparison)}</select>
      <span class="td-choices" role="group" aria-label="Starter">${starterNames(project).map((name, slot) => `<button class="td-choice" type="button" data-rule-starter="${slot}" aria-pressed="${value === slot}">${escapeHtml(name)}</button>`).join("")}</span>`;
  }
  return `<span class="td-rule-condition" data-condition-index="${index}">${kindSelect}${rest}${remove}</span>`;
}

function renderRules(project: ProjectState, trainer: number, tabs: RosterTab[]): string {
  const rules = rosterRules(project, trainer);
  const draft = ruleDraft(project, trainer);
  const choosable = tabs.map((tab) => ({ value: tab.source, label: tab.label }));
  const ruleHtml = rules.map((rule, index) => `
    <div class="td-rule" data-rule-index="${index}">
      <div class="td-rule-line">
        <span class="td-rule-word">${index === 0 ? "If" : "Else if"}</span>
        ${rule.conditions.map((condition, conditionIndex) => `${conditionIndex ? `<select class="td-rule-join" data-rule-field="match" aria-label="All or any">${options(["and", "or"], rule.match === "any" ? 1 : 0)}</select>` : ""}${renderCondition(project, condition, conditionIndex)}`).join("")}
        ${rule.conditions.length < TRAINER_ROSTER_MAX_CONDITIONS ? `<button class="btn sm -ghost" type="button" data-rule-action="add-condition">+ condition</button>` : ""}
      </div>
      <div class="td-rule-line">
        <span class="td-rule-word">use</span>
        ${rule.choices.map((choice, choiceIndex) => `<span class="td-rule-choice" data-choice-index="${choiceIndex}">
          <select data-rule-field="rosterId" aria-label="Roster">${choice.rosterId ? "" : `<option value="0" selected>Choose…</option>`}${choosable.map(({ value, label }) => `<option value="${value}"${value === choice.rosterId ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}${choosable.some(({ value }) => value === choice.rosterId) || !choice.rosterId ? "" : `<option value="${choice.rosterId}" selected>${escapeHtml(isTrainerPoolSource(choice.rosterId) ? "Missing party" : `#${choice.rosterId}`)}</option>`}</select>
          ${rule.choices.length > 1 ? `<label class="td-rule-weight">× <input type="number" data-rule-field="weight" min="1" max="${TRAINER_ROSTER_MAX_WEIGHT}" value="${choice.weight}" aria-label="Weight"></label>
          <button class="td-rule-x" type="button" data-rule-action="remove-choice" aria-label="Remove this roster" title="Remove this roster">×</button>` : ""}
        </span>`).join(`<span class="td-rule-word">or</span>`)}
        ${rule.choices.length < Math.min(TRAINER_ROSTER_MAX_CHOICES, choosable.length) ? `<button class="btn sm -ghost" type="button" data-rule-action="add-choice" title="Pick randomly between several rosters">+ or</button>` : ""}
        <span class="td-roster-spacer"></span>
        <button class="btn sm -ghost" type="button" data-rule-action="up" aria-label="Check this rule earlier" title="Check earlier" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="btn sm -ghost" type="button" data-rule-action="down" aria-label="Check this rule later" title="Check later" ${index === rules.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn sm -remove" type="button" data-rule-action="remove">Remove rule</button>
      </div>
    </div>`).join("");
  const otherwise = rules.length ? `<p class="td-rule-else"><span class="td-rule-word">Otherwise</span> ${tabs.filter((tab) => tab.weight).map((tab) => `${escapeHtml(tab.label)} ${percent.format(tab.chance)}`).join(", ") || "Original"}</p>` : "";
  return `<details class="td-rules"${rules.length ? " open" : ""}>
    <summary>Rules${rules.length ? ` <span class="md-unit">${rules.length}</span>` : ` <span class="md-unit">pick a roster from the player's party, level or starter</span>`}</summary>
    ${ruleHtml}${otherwise}
    ${draft ? `<p class="td-roster-problem" role="alert">Not saved yet: ${escapeHtml(ruleProblem(rules, draft.problem))} <button class="btn sm -ghost" type="button" data-rule-action="discard">Undo changes</button></p>` : ""}
    ${rules.length < TRAINER_ROSTER_MAX_RULES ? `<button class="btn sm" type="button" data-rule-action="add">+ Rule</button>` : ""}
  </details>`;
}

/** What an unsaved rule still needs, in the words of the sentence it reads as. */
function ruleProblem(rules: TrainerRosterRule[], fallback: string): string {
  for (const [index, rule] of rules.entries()) {
    const which = rules.length > 1 ? `Rule ${index + 1}` : "The rule";
    if (rule.conditions.some((condition) => condition.kind === 0 && !condition.subject)) return `${which} needs a Pokémon to look for.`;
    if (rule.choices.some((choice) => !choice.rosterId)) return `${which} needs a roster to use.`;
    if (rule.conditions.some((condition) => !Number.isFinite(condition.value))) return `${which} needs a number.`;
  }
  return fallback;
}

function initialCondition(kind: number): TrainerRosterCondition {
  return { kind, comparison: kind === 2 || kind === 1 ? 5 : 0, subject: 0, value: kind === 2 ? 50 : kind === 1 ? 2 : 0 };
}

// ---------- Suggestion lists ----------

/**
 * The suggestion lists for the hub's text fields (trainers and pools to link, species for rules, items for a pool's
 * exceptions) hold hundreds of entries each. They live outside the hub, built the first time a field needs them, so
 * switching tabs doesn't rebuild them.
 */
export function ensureRosterLists(project: ProjectState, detail: HTMLElement): void {
  let host = detail.querySelector<HTMLElement>("[data-roster-lists]");
  const add = (id: string, needed: boolean, labels: () => string[]) => {
    if (!needed || detail.querySelector(`#${id}`)) return;
    if (!host) {
      host = document.createElement("div");
      host.hidden = true;
      host.dataset.rosterLists = "";
      detail.append(host);
    }
    const list = document.createElement("datalist");
    list.id = id;
    list.innerHTML = labels().map((label) => `<option value="${escapeHtml(label)}"></option>`).join("");
    host.append(list);
  };
  add("td-roster-sources", !!detail.querySelector("[data-roster-link]:not([hidden])"), () => linkSources(project, 0));
  add("td-rule-species", !!detail.querySelector(".td-rules [data-rule-field='species']"), () => pokemonBaseSpeciesNameOptions(project));
  add("td-roster-items", !!detail.querySelector("[data-pool-setting='itemExceptions']"), () => (project.texts.banks.items ?? []).filter((name, id) => id > 0 && name && name !== "0"));
}

// ---------- Events ----------

export type RosterHubContext = {
  trainerId: () => number;
  active: () => RosterKey;
  select: (key: RosterKey) => void;
  /** Redraw the hub, the cards and the slot editor. */
  rerender: () => void;
  changed: () => void;
  openTrainer: (trainerId: number) => void;
  install: () => Promise<void>;
};

export function attachRosterHub(project: ProjectState, detail: HTMLElement, context: RosterHubContext, signal: AbortSignal): void {
  const message = (text: string) => {
    const output = detail.querySelector("[data-roster-message]");
    if (output) output.textContent = text;
  };
  const activeTab = () => listTrainerRosters(project, context.trainerId()).find((tab) => tab.key === context.active());
  const run = (action: () => void) => {
    try {
      action();
      context.changed();
      context.rerender();
    } catch (error) {
      context.rerender();
      message(error instanceof Error ? error.message : String(error));
    }
  };

  const editRules = (change: (rules: TrainerRosterRule[]) => void, rerender = true) => {
    const trainer = context.trainerId();
    const rules = rosterRules(project, trainer);
    change(rules);
    saveRules(project, trainer, rules);
    context.changed();
    if (rerender) context.rerender();
    else {
      // Keep focus in the field being typed in; only the warning changes.
      const draft = ruleDraft(project, trainer);
      const problem = draft && ruleProblem(draft.rules, draft.problem);
      const host = detail.querySelector(".td-rules");
      host?.querySelector(".td-roster-problem")?.remove();
      if (problem) host?.querySelector("[data-rule-action='add']")?.insertAdjacentHTML("beforebegin", `<p class="td-roster-problem" role="alert">Not saved yet: ${escapeHtml(problem)}</p>`);
    }
  };
  const ruleIndices = (element: HTMLElement) => ({
    rule: Number(element.closest<HTMLElement>("[data-rule-index]")?.dataset.ruleIndex),
    condition: Number(element.closest<HTMLElement>("[data-condition-index]")?.dataset.conditionIndex),
    choice: Number(element.closest<HTMLElement>("[data-choice-index]")?.dataset.choiceIndex),
  });

  detail.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const element = target.closest<HTMLElement>("[data-roster-tab], [data-roster-new], [data-roster-link-open], [data-roster-link-close], [data-roster-remove], [data-roster-copy-pool], [data-roster-delete-pool], [data-roster-discard], [data-roster-roll], [data-roster-open-trainer], [data-roster-install], [data-rule-action], [data-rule-starter]");
    if (!element || !detail.contains(element) || (element as HTMLButtonElement).disabled) return;
    const trainer = context.trainerId();
    if (element.dataset.rosterTab !== undefined) {
      context.select(element.dataset.rosterTab);
      return;
    }
    if (element.dataset.rosterOpenTrainer !== undefined) {
      event.preventDefault();
      context.openTrainer(Number(element.dataset.rosterOpenTrainer));
      return;
    }
    if (element.dataset.rosterInstall !== undefined) {
      (element as HTMLButtonElement).disabled = true;
      element.textContent = "Installing…";
      void context.install().catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error));
        context.rerender();
      });
      return;
    }
    if (element.dataset.rosterNew !== undefined) {
      run(() => {
        const id = element.dataset.rosterNew === "party" ? createAlternateParty(project, trainer) : createPool(project, trainer);
        context.select(rosterKeyFor(trainer, trainerPoolSource(id)));
      });
      return;
    }
    if (element.dataset.rosterLinkOpen !== undefined || element.dataset.rosterLinkClose !== undefined) {
      const form = detail.querySelector<HTMLFormElement>("[data-roster-link]");
      if (!form) return;
      form.hidden = element.dataset.rosterLinkClose !== undefined;
      ensureRosterLists(project, detail);
      if (!form.hidden) form.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    const tab = activeTab();
    if (element.dataset.rosterRemove !== undefined && tab) {
      if (tab.kind === "party" && !window.confirm(`Delete ${tab.label}? Its Pokémon go with it.`)) return;
      run(() => {
        removeRoster(project, trainer, tab.source);
        context.select(originalRosterKey);
      });
      return;
    }
    if (element.dataset.rosterDeletePool !== undefined && tab?.poolId !== undefined) {
      if (!window.confirm(`Delete ${tab.label}? No trainer uses it.`)) return;
      run(() => {
        deletePool(project, tab.poolId!);
        context.select(originalRosterKey);
      });
      return;
    }
    if (element.dataset.rosterCopyPool !== undefined && tab?.poolId !== undefined) {
      run(() => context.select(rosterKeyFor(trainer, trainerPoolSource(copyPoolForTrainer(project, trainer, tab.poolId!)))));
      return;
    }
    if (element.dataset.rosterDiscard !== undefined && tab?.poolId !== undefined) {
      discardRosterPoolDraft(project, tab.poolId);
      clearPoolRoll(project, tab.poolId);
      context.rerender();
      return;
    }
    if (element.dataset.rosterRoll !== undefined && tab?.poolId !== undefined) {
      const pool = rosterPool(project, tab.poolId);
      if (!pool) return;
      let byPool = rolls.get(project);
      if (!byPool) rolls.set(project, byPool = new Map());
      byPool.set(tab.poolId, rollPoolTeam(project, pool) ?? "none");
      context.rerender();
      return;
    }
    if (element.dataset.ruleStarter !== undefined) {
      const index = ruleIndices(element);
      editRules((rules) => { rules[index.rule]!.conditions[index.condition]!.value = Number(element.dataset.ruleStarter); });
      return;
    }
    const action = element.dataset.ruleAction;
    if (!action) return;
    const index = ruleIndices(element);
    if (action === "discard") {
      discardRuleDraft(project, trainer);
      context.rerender();
      return;
    }
    editRules((rules) => {
      const rule = rules[index.rule];
      switch (action) {
      case "add": {
        const target = activeTab();
        rules.push({ match: "all", conditions: [initialCondition(0)], choices: [{ rosterId: target && target.kind !== "original" ? target.source : 0, weight: 1 }] });
        break;
      }
      case "remove": rules.splice(index.rule, 1); break;
      case "up": case "down": {
        const next = index.rule + (action === "up" ? -1 : 1);
        if (rule && rules[next]) [rules[index.rule], rules[next]] = [rules[next]!, rule];
        break;
      }
      case "add-condition": rule?.conditions.push(initialCondition(0)); break;
      case "remove-condition":
        rule?.conditions.splice(index.condition, 1);
        if (rule && !rule.conditions.length) rules.splice(index.rule, 1);
        break;
      case "add-choice": rule?.choices.push({ rosterId: 0, weight: 1 }); break;
      case "remove-choice": rule?.choices.splice(index.choice, 1); break;
      }
    });
  }, { signal });

  detail.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-roster-link]");
    if (!form) return;
    event.preventDefault();
    const trainer = context.trainerId();
    run(() => {
      const source = parseLinkSource(project, String(new FormData(form).get("source") ?? ""));
      linkRoster(project, trainer, source);
      context.select(rosterKeyFor(trainer, source));
    });
  }, { signal });

  const onChange = (event: Event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const trainer = context.trainerId();
    if (control.dataset.rosterWeight !== undefined) {
      if (event.type !== "change") return;
      const tab = activeTab();
      const weight = Math.round(Number(control.value));
      if (!tab || !(weight >= 0 && weight <= TRAINER_ROSTER_MAX_WEIGHT)) return;
      run(() => setRosterWeight(project, trainer, tab.source, weight));
      return;
    }
    const setting = control.dataset.poolSetting;
    if (setting) {
      if (event.type !== "change") return;
      const tab = activeTab();
      if (tab?.poolId === undefined) return;
      run(() => {
        const result = editRosterPool(project, tab.poolId!, (pool) => {
          if (setting === "mode") {
            if (control.value === "slots") {
              pool.slotGroups = Array<number>(pool.size).fill(1);
              for (const member of pool.members) member.groups = 1;
            } else {
              delete pool.slotGroups;
              for (const member of pool.members) delete member.groups;
            }
          } else if (setting === "slotGroup") {
            if (pool.slotGroups) pool.slotGroups[Number(control.dataset.poolSlot)] = Number(control.value);
          } else if (setting === "size") {
            pool.size = Number(control.value);
            const groups = pool.slotGroups;
            if (groups) pool.slotGroups = Array.from({ length: pool.size }, (_, slot) => groups[slot] ?? groups[0] ?? 1);
          } else if (setting === "itemClause") pool.itemClause = (control as HTMLInputElement).checked;
          else if (setting === "itemExceptions") {
            const names = project.texts.banks.items ?? [];
            pool.itemExceptions = control.value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
              const id = /^\d+$/u.test(part) ? Number(part) : names.findIndex((name, index) => index > 0 && name.toLowerCase() === part.toLowerCase());
              if (!(id > 0)) throw new Error(`Unknown item: ${part}`);
              return id;
            });
          } else if (setting === "roleSlots" || setting === "speciesRule") pool[setting] = Number(control.value);
        });
        clearPoolRoll(project, tab.poolId!);
        if (!result.saved) message(`Not saved yet: ${result.problem}`);
      });
      return;
    }
    const field = control.dataset.ruleField;
    if (!field || !control.closest(".td-rules")) return;
    const typing = control instanceof HTMLInputElement && control.type !== "checkbox";
    if (typing && event.type === "input" && field !== "species") return;
    if (!typing && event.type === "input") return;
    const index = ruleIndices(control);
    const number = control.value === "" ? NaN : Number(control.value);
    if (field === "species") {
      // Commit a species once the text names one; until then only the warning updates.
      if (event.type === "input" && !findSpecies(project, control.value)) return;
    }
    editRules((rules) => {
      const rule = rules[index.rule]!;
      switch (field) {
      case "match": rule.match = number === 1 ? "any" : "all"; break;
      case "kind": rule.conditions[index.condition] = initialCondition(number); break;
      case "species": rule.conditions[index.condition]!.subject = findSpecies(project, control.value) ?? 0; break;
      case "comparison": case "subject": case "value": rule.conditions[index.condition]![field] = number; break;
      case "rosterId": case "weight": rule.choices[index.choice]![field] = number; break;
      }
    }, field === "kind" || field === "rosterId" || field === "match" || event.type === "change");
  };
  detail.addEventListener("change", onChange, { signal });
  detail.addEventListener("input", onChange, { signal });
}

function findSpecies(project: ProjectState, text: string): number | undefined {
  try {
    const id = findPokemonBaseSpeciesId(project, text.trim());
    return id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}
