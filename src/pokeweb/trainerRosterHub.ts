import { NATURES, TRAINER_GENDERS } from "./constants";
import { findPokemonBaseSpeciesId, pokemonSpeciesLabel } from "./pokemonLabels";
import { decodeRecord, type ProjectState } from "./projectStore";
import { getTrainerMemberSettings, hasTrainerPartyPools } from "./trainerCustomizationModel";
import { changeTrainerMemberSetting, DEFAULT_TRAINER_MEMBER_SETTINGS, type TrainerMemberSettings } from "./trainerMemberSettings";
import { getAutofilledTrainerPokemonMoveIds, getTrainerPokemonAbilityOptions, getTrainerRecord, trainerPokemonSpriteSlug, type TrainerPokemonSlot, type TrainerRecord } from "./trainerModel";
import {
  findSlotPoolTeam, isFixedTrainerPartySource, isTrainerPoolSource, trainerPoolId, trainerPoolSource, TRAINER_PARTY_MAX_ID, TRAINER_POOL_MAX_ID, TRAINER_POOL_MAX_MEMBERS,
  type TrainerPartyPool, type TrainerPoolMember, type TrainerPoolPokemon,
} from "./trainerPartyPools";
import {
  getTrainerPartyPools, getTrainerRosterChoices, getTrainerRosterRules, setTrainerPartyPool, setTrainerRosterChoices, setTrainerRosterRules, trainerRosterTables,
  TRAINER_ROSTER_ID_LIMIT, TRAINER_ROSTER_MAX_CHOICES, type TrainerRosterChoice, type TrainerRosterRule,
} from "./trainerRosterModel";

/*
 * The roster hub: everything a trainer can field, as one list of tabs. The trainer's own party ("original"), its
 * alternate parties, the shared pools it draws from and other trainers' parties it borrows. Each tab carries its weight
 * in the default random choice (0 when only a rule picks it). Alternate parties and pools save as you edit; while an
 * edit leaves one unable to build a legal team, it stays a draft here and the ROM keeps the last version that worked.
 */

export type RosterKey = string;
export type RosterTab = {
  key: RosterKey;
  kind: "original" | "party" | "pool" | "trainer";
  /** The roster source as the patch stores it: a trainer ID, or a party/pool ID with bit 15 set. */
  source: number;
  label: string;
  /** Weight in the default random choice; 0 when it is not part of it. */
  weight: number;
  /** Share of the default choice, 0-1. */
  chance: number;
  /** Rules that can pick this roster. */
  rules: number;
  /** Pokémon fielded: the party size, or a pool's draw. */
  size: number;
  /** Candidates in a pool. */
  candidates?: number;
  poolId?: number;
  /** Other trainers that use this pool. */
  sharedWith?: number[];
  /** Set while a party or pool has unsaved changes that can't build a team yet. */
  problem?: string;
};

export const originalRosterKey = "original";
export const rosterKeyFor = (trainer: number, source: number): RosterKey =>
  source === trainer ? originalRosterKey : isFixedTrainerPartySource(source) ? `party:${trainerPoolId(source)}`
    : isTrainerPoolSource(source) ? `pool:${trainerPoolId(source)}` : `trainer:${source}`;

export function rosterSourceFor(trainer: number, key: RosterKey): number {
  if (key === originalRosterKey) return trainer;
  const [kind, id] = key.split(":");
  const value = Number(id);
  return kind === "trainer" ? value : trainerPoolSource(value);
}

// ---------- Drafts ----------

type Draft = { pool: TrainerPartyPool; problem: string };
const drafts = new WeakMap<ProjectState, Map<number, Draft>>();
const ruleDrafts = new WeakMap<ProjectState, Map<number, { rules: TrainerRosterRule[]; problem: string }>>();

function draftMap(project: ProjectState): Map<number, Draft> {
  let map = drafts.get(project);
  if (!map) drafts.set(project, map = new Map());
  return map;
}

/** A party or pool as the editor shows it: its unsaved draft if there is one, else the saved version. */
export function rosterPool(project: ProjectState, poolId: number): TrainerPartyPool | undefined {
  return draftMap(project).get(poolId)?.pool ?? getTrainerPartyPools(project).get(poolId);
}

export function rosterPoolProblem(project: ProjectState, poolId: number): string | undefined {
  return draftMap(project).get(poolId)?.problem;
}

function clonePool(pool: TrainerPartyPool): TrainerPartyPool {
  return structuredClone(pool);
}

/** Change a party or pool and save it if it can build a team; otherwise keep the change as a draft. */
export function editRosterPool(project: ProjectState, poolId: number, change: (pool: TrainerPartyPool) => void): { saved: boolean; problem?: string } {
  const current = rosterPool(project, poolId);
  if (!current) throw new Error("That party no longer exists.");
  const next = clonePool(current);
  change(next);
  if (next.owner !== undefined) next.size = next.members.length;
  try {
    setTrainerPartyPool(project, poolId, next);
    draftMap(project).delete(poolId);
    return { saved: true };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    draftMap(project).set(poolId, { pool: next, problem });
    return { saved: false, problem };
  }
}

export function discardRosterPoolDraft(project: ProjectState, poolId: number): void {
  draftMap(project).delete(poolId);
}

// ---------- Tabs ----------

function trainerName(project: ProjectState, trainer: number): string {
  const name = String(project.texts.banks.tr_names?.[trainer] ?? "").trim();
  const record = decodeRecord(project, "trdata", trainer);
  const className = String(record.readable?.class ?? "").trim();
  return [className, name && name !== "0" ? name : ""].filter(Boolean).join(" ") || `Trainer ${trainer}`;
}

export function trainerLabel(project: ProjectState, trainer: number): string {
  return `#${trainer} ${trainerName(project, trainer)}`;
}

/** Trainers whose default choices or rules use a source. */
export function rosterSourceUsers(project: ProjectState, source: number): number[] {
  const users = new Set<number>();
  const count = Math.min(TRAINER_ROSTER_ID_LIMIT, project.narcs.trdata?.fileCount ?? 0);
  for (let trainer = 1; trainer < count; trainer++) {
    if (!trainerHasRosterVariants(project, trainer)) continue;
    const choices = getTrainerRosterChoices(project, trainer);
    const rules = getTrainerRosterRules(project, trainer);
    if (choices.some((choice) => choice.rosterId === source) || rules.some((rule) => rule.choices.some((choice) => choice.rosterId === source))) users.add(trainer);
  }
  return [...users];
}

export function listTrainerRosters(project: ProjectState, trainer: number): RosterTab[] {
  if (!hasTrainerPartyPools(project)) return [];
  const choices = getTrainerRosterChoices(project, trainer);
  const rules = ruleDraft(project, trainer)?.rules ?? getTrainerRosterRules(project, trainer);
  const pools = getTrainerPartyPools(project);
  const sources = new Set<number>([trainer]);
  for (const [id, pool] of pools) if (pool.owner === trainer) sources.add(trainerPoolSource(id));
  for (const [id, draft] of draftMap(project)) if (draft.pool.owner === trainer) sources.add(trainerPoolSource(id));
  for (const choice of choices) sources.add(choice.rosterId);
  for (const rule of rules) for (const choice of rule.choices) if (choice.rosterId) sources.add(choice.rosterId);
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  const tabs = [...sources].map((source): RosterTab => {
    const key = rosterKeyFor(trainer, source);
    const weight = choices.length ? choices.find((choice) => choice.rosterId === source)?.weight ?? 0 : source === trainer ? 1 : 0;
    const chance = choices.length ? weight / total : source === trainer ? 1 : 0;
    const ruleCount = rules.filter((rule) => rule.choices.some((choice) => choice.rosterId === source)).length;
    if (source === trainer) {
      return { key, kind: "original", source, label: "Original", weight, chance, rules: ruleCount, size: project.trpokInfo[trainer]?.numPokemon ?? 0 };
    }
    if (isTrainerPoolSource(source)) {
      const poolId = trainerPoolId(source);
      const pool = rosterPool(project, poolId);
      const fixed = isFixedTrainerPartySource(source);
      const sharedWith = fixed ? undefined : rosterSourceUsers(project, source).filter((other) => other !== trainer);
      return {
        key, kind: fixed ? "party" : "pool", source, poolId, weight, chance, rules: ruleCount, sharedWith,
        label: fixed ? "Party" : `Pool ${poolId}`,
        size: fixed ? pool?.members.length ?? 0 : pool?.size ?? 0,
        candidates: pool?.members.length ?? 0,
        problem: rosterPoolProblem(project, poolId) ?? (pool ? undefined : "This party is missing."),
      };
    }
    return { key, kind: "trainer", source, label: trainerLabel(project, source), weight, chance, rules: ruleCount, size: project.trpokInfo[source]?.numPokemon ?? 0 };
  });
  const order = { original: 0, party: 1, pool: 2, trainer: 3 };
  tabs.sort((a, b) => order[a.kind] - order[b.kind] || a.source - b.source);
  // Alternate parties go by letter in the order they were made: Party B, Party C... (the original is A).
  let letter = 1;
  for (const tab of tabs) if (tab.kind === "party") tab.label = `Party ${letter < 26 ? String.fromCharCode(65 + letter++) : ++letter}`;
  return tabs;
}

// ---------- Weights ----------

/** Set a roster's weight in the default choice. 0 takes it out; when only the original is left the list is cleared. */
export function setRosterWeight(project: ProjectState, trainer: number, source: number, weight: number): void {
  const choices = getTrainerRosterChoices(project, trainer);
  // An empty list means "original only": spell that out before giving anything else a share.
  if (!choices.length && source !== trainer && weight > 0 && (project.trpokInfo[trainer]?.numPokemon ?? 0) > 0) choices.push({ rosterId: trainer, weight: 1 });
  const existing = choices.find((choice) => choice.rosterId === source);
  if (weight > 0) {
    if (existing) existing.weight = weight;
    else {
      if (choices.length >= TRAINER_ROSTER_MAX_CHOICES) throw new Error(`A trainer can use up to ${TRAINER_ROSTER_MAX_CHOICES} rosters at once.`);
      choices.push({ rosterId: source, weight });
    }
  } else if (existing) choices.splice(choices.indexOf(existing), 1);
  const simplified = choices.length === 1 && choices[0]!.rosterId === trainer ? [] : choices;
  setTrainerRosterChoices(project, trainer, simplified);
}

// ---------- Creating and removing ----------

function freePoolId(project: ProjectState, fixed: boolean): number {
  const used = new Set([...getTrainerPartyPools(project).keys(), ...draftMap(project).keys()]);
  for (let id = fixed ? TRAINER_POOL_MAX_ID + 1 : 1; id <= (fixed ? TRAINER_PARTY_MAX_ID : TRAINER_POOL_MAX_ID); id++) if (!used.has(id)) return id;
  throw new Error(fixed ? "There's no room for another alternate party." : "There's no room for another pool (255 at most).");
}

/** A trainer Pokémon as a party or pool member of its own, with all its settings. */
export function poolPokemonFromTrainerSlot(project: ProjectState, trainer: number, slot: number): TrainerPoolPokemon {
  const info = project.trpokInfo[trainer];
  const fields = decodeRecord(project, "trpok", trainer).raw ?? {};
  const value = (key: string) => Number(fields[`${key}_${slot}`] ?? 0);
  const packed = value("ability") === 255 ? 0 : value("ability");
  const nature = value("padding");
  return {
    species: value("species_id"), form: value("form"), item: info && info.template & 2 ? value("item_id") : 0,
    level: Math.max(1, value("level")), ivs: value("ivs"), gender: Math.min(packed & 15, 2), ability: packed >> 4,
    nature: nature <= 25 ? nature : 0,
    moves: [1, 2, 3, 4].map((move) => (info && info.template & 1 ? value(`move_${move}`) : 0)),
    settings: getTrainerMemberSettings(project, trainer, slot),
  };
}

function originalMembers(project: ProjectState, trainer: number): TrainerPoolMember[] {
  const count = Math.min(project.trpokInfo[trainer]?.numPokemon ?? 0, 6);
  return Array.from({ length: count }, (_, slot) => ({ role: 0, pokemon: poolPokemonFromTrainerSlot(project, trainer, slot) }));
}

/** A new alternate party, a copy of the original, already in the default random choice. */
export function createAlternateParty(project: ProjectState, trainer: number): number {
  const members = originalMembers(project, trainer);
  if (!members.length) throw new Error("Give the trainer at least one Pokémon first; the new party starts as a copy of it.");
  const id = freePoolId(project, true);
  setTrainerPartyPool(project, id, { owner: trainer, size: members.length, roleSlots: 1, speciesRule: 0, itemClause: false, itemExceptions: [], members });
  setRosterWeight(project, trainer, trainerPoolSource(id), 1);
  return id;
}

/** A new pool, starting with the original party as its candidates, already in the default random choice. */
export function createPool(project: ProjectState, trainer: number): number {
  const members = originalMembers(project, trainer);
  if (!members.length) throw new Error("Give the trainer at least one Pokémon first; the new pool starts with its party as candidates.");
  const id = freePoolId(project, false);
  setTrainerPartyPool(project, id, { size: members.length, roleSlots: 1, speciesRule: 0, itemClause: false, itemExceptions: [], members });
  setRosterWeight(project, trainer, trainerPoolSource(id), 1);
  return id;
}

/** Use an existing shared pool or another trainer's party. */
export function linkRoster(project: ProjectState, trainer: number, source: number): void {
  if (source === trainer) throw new Error("That's this trainer's own party.");
  setRosterWeight(project, trainer, source, 1);
}

function replaceInRules(rules: TrainerRosterRule[], source: number, replacement?: number): TrainerRosterRule[] {
  return rules
    .map((rule) => ({ ...rule, choices: rule.choices.flatMap((choice) => choice.rosterId !== source ? [choice] : replacement === undefined ? [] : [{ ...choice, rosterId: replacement }]) }))
    .filter((rule) => rule.choices.length);
}

/** Take a roster off this trainer. An alternate party is deleted; a pool or another trainer's party is only unlinked. */
export function removeRoster(project: ProjectState, trainer: number, source: number): void {
  if (source === trainer) throw new Error("The original party can't be removed; set its weight to 0 to use it only from rules.");
  const choices = getTrainerRosterChoices(project, trainer).filter((choice) => choice.rosterId !== source);
  setTrainerRosterChoices(project, trainer, choices.length === 1 && choices[0]!.rosterId === trainer ? [] : choices);
  const draft = ruleDraft(project, trainer);
  const rules = replaceInRules(draft?.rules ?? getTrainerRosterRules(project, trainer), source);
  saveRules(project, trainer, rules);
  if (isFixedTrainerPartySource(source)) {
    const id = trainerPoolId(source);
    discardRosterPoolDraft(project, id);
    if (getTrainerPartyPools(project).has(id)) setTrainerPartyPool(project, id, undefined);
  }
}

/** Delete a pool no trainer uses any more. */
export function deletePool(project: ProjectState, poolId: number): void {
  discardRosterPoolDraft(project, poolId);
  if (getTrainerPartyPools(project).has(poolId)) setTrainerPartyPool(project, poolId, undefined);
}

/** Give this trainer its own copy of a shared pool, so its edits don't reach the other trainers. */
export function copyPoolForTrainer(project: ProjectState, trainer: number, poolId: number): number {
  const pool = rosterPool(project, poolId);
  if (!pool) throw new Error("That pool no longer exists.");
  const id = freePoolId(project, false);
  setTrainerPartyPool(project, id, clonePool(pool));
  const source = trainerPoolSource(poolId), copy = trainerPoolSource(id);
  setTrainerRosterChoices(project, trainer, getTrainerRosterChoices(project, trainer).map((choice) => choice.rosterId === source ? { ...choice, rosterId: copy } : choice));
  saveRules(project, trainer, replaceInRules(ruleDraft(project, trainer)?.rules ?? getTrainerRosterRules(project, trainer), source, copy));
  return id;
}

// ---------- Rules ----------

function ruleDraftMap(project: ProjectState) {
  let map = ruleDrafts.get(project);
  if (!map) ruleDrafts.set(project, map = new Map());
  return map;
}

export function ruleDraft(project: ProjectState, trainer: number): { rules: TrainerRosterRule[]; problem: string } | undefined {
  return ruleDraftMap(project).get(trainer);
}

export function discardRuleDraft(project: ProjectState, trainer: number): void {
  ruleDraftMap(project).delete(trainer);
}

export function rosterRules(project: ProjectState, trainer: number): TrainerRosterRule[] {
  return structuredClone(ruleDraft(project, trainer)?.rules ?? getTrainerRosterRules(project, trainer));
}

/** Save the rules if they're complete; otherwise keep them as a draft and say what's missing. */
export function saveRules(project: ProjectState, trainer: number, rules: TrainerRosterRule[]): { saved: boolean; problem?: string } {
  try {
    setTrainerRosterRules(project, trainer, rules);
    ruleDraftMap(project).delete(trainer);
    return { saved: true };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    ruleDraftMap(project).set(trainer, { rules, problem });
    return { saved: false, problem };
  }
}

// ---------- Variants in the trainer list ----------

const variantCache = new WeakMap<ProjectState, { tables: readonly (Uint8Array | undefined)[]; trainers: Set<number> }>();

/** True when a trainer has rosters besides its own party. Cheap enough to ask for every row of the trainer list. */
export function trainerHasRosterVariants(project: ProjectState, trainer: number): boolean {
  if (!hasTrainerPartyPools(project)) return false;
  const tables = trainerRosterTables(project);
  let cached = variantCache.get(project);
  if (!cached || cached.tables.some((table, index) => table !== tables[index])) {
    const trainers = new Set<number>();
    const count = Math.min(TRAINER_ROSTER_ID_LIMIT, project.narcs.trdata?.fileCount ?? 0);
    try {
      for (let id = 1; id < count; id++) {
        if (getTrainerRosterChoices(project, id).length || getTrainerRosterRules(project, id).length) trainers.add(id);
      }
    } catch {
      // Unreadable roster tables show no badges; the editor reports the problem when the trainer is opened.
    }
    cached = { tables, trainers };
    variantCache.set(project, cached);
  }
  return cached.trainers.has(trainer);
}

// ---------- Party and pool members in the slot editor ----------

const natureNames = NATURES as readonly string[];

function moveName(project: ProjectState, id: number): string {
  return id ? String(project.texts.banks.moves?.[id] ?? id) : "";
}

/** A party or pool member shaped like a trainer Pokémon, so the slot editor and party cards can show it. */
export function poolMemberSlot(project: ProjectState, member: TrainerPoolMember, slot: number): TrainerPokemonSlot & { role: number; linked?: { trainerId: number; slot: number } } {
  if (!("pokemon" in member)) {
    const source = getTrainerRecord(project, member.trainerId, { includeTexts: false }).party[member.slot];
    if (source) return { ...source, slot, role: member.role, linked: { trainerId: member.trainerId, slot: member.slot } };
    return {
      slot, speciesId: 0, speciesName: "Missing Pokémon", spriteSlug: "-", level: 0, ivs: 0, abilitySlot: 0, resolvedAbilitySlot: 0, abilityName: "",
      gender: "Default", form: 0, moves: [], nature: "", natureSetting: "Auto", natureValue: 0, role: member.role, linked: { trainerId: member.trainerId, slot: member.slot },
    };
  }
  const pokemon = member.pokemon;
  const speciesName = pokemon.species ? pokemonSpeciesLabel(project, pokemon.species) : "Choose species";
  const base: TrainerPokemonSlot = {
    slot, speciesId: pokemon.species, speciesName, spriteSlug: trainerPokemonSpriteSlug(speciesName, pokemon.form),
    level: pokemon.level, ivs: pokemon.ivs, abilitySlot: pokemon.ability, resolvedAbilitySlot: pokemon.ability || 1, abilityName: "",
    gender: TRAINER_GENDERS[pokemon.gender] ?? "Default", form: pokemon.form,
    itemName: pokemon.item ? String(project.texts.banks.items?.[pokemon.item] ?? pokemon.item) : "",
    moves: pokemon.moves.map((id) => moveName(project, id)),
    nature: pokemon.nature ? natureNames[pokemon.nature - 1] ?? "" : "Auto", natureSetting: pokemon.nature ? natureNames[pokemon.nature - 1] ?? "Auto" : "Auto", natureValue: pokemon.nature,
  };
  try {
    const option = getTrainerPokemonAbilityOptions(project, { ...base, abilitySlot: pokemon.ability || 1 })[pokemon.ability || 1];
    base.abilityName = option?.label.includes(": ") ? option.label.slice(option.label.indexOf(": ") + 2) : "";
  } catch {
    // A species without personal data has no ability names.
  }
  return { ...base, role: member.role };
}

/** A trainer record standing in for a party or pool, for the slot editor: the trainer's own data with these members. */
export function poolRecord(project: ProjectState, trainer: number, pool: TrainerPartyPool, selectedSlot: number): TrainerRecord {
  const record = getTrainerRecord(project, trainer, { includeTexts: false });
  const selected = pool.members[selectedSlot];
  return {
    ...record,
    hasItems: true,
    hasMoves: Boolean(selected && "pokemon" in selected && selected.pokemon.moves.some(Boolean)),
    party: pool.members.map((member, slot) => poolMemberSlot(project, member, slot)),
  };
}

/** Apply one slot editor field (named as the trainer Pokémon archive names them) to a party or pool member. */
export function editPoolMemberField(project: ProjectState, pokemon: TrainerPoolPokemon, field: string, input: string): string | number {
  const name = field.replace(/_\d+$/u, "");
  const number = (min: number, max: number) => {
    const value = Number(input.trim());
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Enter a whole number from ${min} to ${max}.`);
    return value;
  };
  switch (name) {
  case "species_id": {
    const species = input.trim() ? findPokemonBaseSpeciesId(project, input.trim()) : 0;
    if (!species) throw new Error(`Unknown Pokémon: ${input}`);
    if (species !== pokemon.species) pokemon.form = 0;
    pokemon.species = species;
    return pokemonSpeciesLabel(project, species);
  }
  case "level": return pokemon.level = number(1, 100);
  case "ivs": return pokemon.ivs = number(0, 255);
  case "form": return pokemon.form = number(0, 31);
  case "ability": return pokemon.ability = number(0, 15);
  case "gender": {
    const index = TRAINER_GENDERS.indexOf(input);
    if (index < 0) throw new Error(`Unknown gender: ${input}`);
    pokemon.gender = index;
    return input;
  }
  case "nature": {
    const index = input === "Auto" ? 0 : natureNames.indexOf(input) + 1;
    if (index < 0 || (input !== "Auto" && index === 0)) throw new Error(`Unknown nature: ${input}`);
    pokemon.nature = index;
    return input;
  }
  case "item_id": {
    pokemon.item = resolveName(project.texts.banks.items ?? [], input, "item");
    return pokemon.item ? String(project.texts.banks.items?.[pokemon.item] ?? pokemon.item) : "";
  }
  default: {
    const move = /^move_([1-4])$/u.exec(name);
    if (!move) throw new Error(`Unsupported field: ${field}`);
    const id = resolveName(project.texts.banks.moves ?? [], input, "move");
    pokemon.moves[Number(move[1]) - 1] = id;
    return moveName(project, id);
  }
  }
}

function resolveName(names: readonly string[], input: string, label: string): number {
  const text = input.trim();
  if (!text || /^(none|-+)$/iu.test(text)) return 0;
  if (/^\d+$/u.test(text)) return Number(text);
  const id = names.findIndex((name, index) => index > 0 && String(name).toLowerCase() === text.toLowerCase());
  if (id > 0) return id;
  throw new Error(`Unknown ${label}: ${input}`);
}

export function setPoolMemberSetting(pokemon: TrainerPoolPokemon, field: keyof TrainerMemberSettings, value: number): void {
  pokemon.settings = changeTrainerMemberSetting(pokemon.settings, field, value);
}

/** A new party or pool member: the species and level of the one before it (to change from there), level-up moves, nothing else set. */
export function newPoolMember(project: ProjectState, from?: TrainerPoolPokemon): TrainerPoolMember {
  void project;
  return {
    role: 0,
    pokemon: {
      species: from?.species || 1, form: 0, level: from?.level ?? 5, item: 0, ivs: from?.ivs ?? 0, ability: 0, gender: 0, nature: 0, moves: [0, 0, 0, 0],
      settings: { ...DEFAULT_TRAINER_MEMBER_SETTINGS },
    },
  };
}

export function autofillPoolMemberMoves(project: ProjectState, pokemon: TrainerPoolPokemon): void {
  const moves = getAutofilledTrainerPokemonMoveIds(project, pokemon.species, pokemon.level);
  pokemon.moves = [0, 1, 2, 3].map((index) => moves[index] ?? 0);
}

export const POOL_MEMBER_LIMIT = (pool: TrainerPartyPool) => (pool.owner !== undefined ? 6 : TRAINER_POOL_MAX_MEMBERS);

// ---------- Rolling a sample team ----------

/**
 * Draw a team the way the game does: Lead-tagged candidates first, Ace-tagged last, untagged in between, no repeated
 * species or held items when the pool's rules forbid them. A random order stands in for the game's random numbers.
 */
export function rollPoolTeam(project: ProjectState, pool: TrainerPartyPool, random = Math.random): number[] | undefined {
  if (pool.owner !== undefined) return pool.members.map((_member, index) => index);
  const data = pool.members.map((member) => {
    const slot = poolMemberSlot(project, member, 0);
    const item = "pokemon" in member ? member.pokemon.item
      : (project.trpokInfo[member.trainerId]?.template ?? 0) & 2
        ? Number(decodeRecord(project, "trpok", member.trainerId).raw?.[`item_id_${member.slot}`] ?? 0) : 0;
    return { role: member.role, groups: member.groups, species: slot.speciesId, form: slot.form, item };
  });
  if (pool.slotGroups) return pool.slotGroups.length === pool.size ? findSlotPoolTeam(pool, data, random) : undefined;
  const groups = [0, 1, 2].map((role) => data.flatMap((member, index) => (member.role === role ? [index] : [])).sort(() => random() - 0.5));
  const exceptions = new Set(pool.itemExceptions);
  const minLead = groups[1]!.length ? 1 : 0;
  const minAce = groups[2]!.length && pool.size > minLead ? 1 : 0;
  const maxLead = Math.min(groups[1]!.length, pool.roleSlots, pool.size - minAce);
  const maxAce = Math.min(groups[2]!.length, pool.roleSlots, pool.size - minLead);
  for (let tagged = Math.min(pool.size, maxLead + maxAce); tagged >= minLead + minAce; --tagged) {
    for (let leads = Math.min(tagged, maxLead); leads >= minLead; --leads) {
      const aces = tagged - leads;
      if (aces < minAce || aces > maxAce) continue;
      const counts = [pool.size - leads - aces, leads, aces];
      const picks: number[][] = [[], [], []];
      const species = new Set<number>(), items = new Set<number>();
      const roles = [1, 2, 0].filter((role) => counts[role]);
      const search = (group: number, start: number): boolean => {
        if (group === roles.length) return true;
        const role = roles[group]!;
        if (picks[role]!.length === counts[role]) return search(group + 1, 0);
        const candidates = groups[role]!;
        for (let i = start; i < candidates.length; i++) {
          const member = data[candidates[i]!]!;
          const speciesKey = pool.speciesRule === 2 ? member.species * 65536 + member.form : member.species;
          const item = pool.itemClause && !exceptions.has(member.item) ? member.item : 0;
          if ((pool.speciesRule && species.has(speciesKey)) || (item && items.has(item))) continue;
          if (pool.speciesRule) species.add(speciesKey);
          if (item) items.add(item);
          picks[role]!.push(candidates[i]!);
          if (search(group, i + 1)) return true;
          picks[role]!.pop();
          species.delete(speciesKey);
          if (item) items.delete(item);
        }
        return false;
      };
      if (search(0, 0)) return [...picks[1]!, ...picks[0]!, ...picks[2]!];
    }
  }
  return undefined;
}

export type { TrainerRosterChoice };
