import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import type { NintendoDSRom } from "../nds/rom";
import { recordFieldChange } from "./actionChangelog";
import { addRomFile, getRomFileBytes, setRomFileReplacement } from "./fileSystemModel";
import { trainerAbilitySlotMax } from "./cascadeWhiteModel";
import { findPokemonPersonalFormOwner } from "./pokemonLabels";
import { isAbsentExpansionSlot, regionalDexFile, storedSpeciesId } from "./speciesExpansionIds";
import { decodeRecord, type ProjectState } from "./projectStore";
import {
  compileTrainerPool, decodeTrainerPools, encodeTrainerPools, isTrainerPoolSource, trainerPoolId,
  trainerPoolSource, trainerPartyLabel, TRAINER_POOLS_PATH, type TrainerPartyPool, type TrainerPoolPokemon, type TrainerPoolReference,
} from "./trainerPartyPools";
import {
  changeOwnMove, decodeTrainerMovePools, encodeTrainerMovePools, hasMoveAlternatives, withoutOwnMoves, TRAINER_MOVE_POOLS_PATH, trainerMovePoolKey, trainerMovePoolProblem,
  trainerMovePoolSource, type TrainerMovePools,
} from "./trainerMovePools";

import { decodeTrainerNicknames, encodeTrainerNicknames, TRAINER_NICKNAMES_PATH, validateTrainerNickname } from "./trainerNicknames";

export const TRAINER_ROSTERS_PATH = "battle/trainer-rosters.bin";
const RULES_PATH = "battle/trainer-roster-rules.bin";
export const TRAINER_ROSTER_MAX_RULES = 8;
export const TRAINER_ROSTER_MAX_CONDITIONS = 8;
export const TRAINER_ROSTER_CONDITIONS = ["Party species", "Party type count", "Highest party level", "Starter choice"] as const;
export const TRAINER_ROSTER_COMPARISONS = ["Equals", "Does not equal", "Below", "At most", "Above", "At least"] as const;
export const TRAINER_ROSTER_MAX_CHOICES = 32;
export const TRAINER_ROSTER_MAX_WEIGHT = 65535;
export const TRAINER_ROSTER_ID_LIMIT = 0x500;
const HEADER = 16;
const ENTRY = 6;
const MAGIC = 0x52545750;
const RULE_MAGIC = 0x43525750;
const RULE = 4;
const CONDITION = 6;

export type TrainerRosterChoice = { rosterId: number; weight: number };
type RosterEntry = TrainerRosterChoice & { size: number };
export type TrainerRosterCondition = { kind: number; comparison: number; subject: number; value: number };
export type TrainerRosterRule = { match: "all" | "any"; conditions: TrainerRosterCondition[]; choices: TrainerRosterChoice[] };
type RosterRule = Omit<TrainerRosterRule, "choices"> & { choices: RosterEntry[] };
const sources = new WeakMap<ProjectState, Map<string, { fileId: number; bytes: Uint8Array }>>();

export function hydrateTrainerRosters(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseRom !== "BW2") return;
  const files = new Map<string, { fileId: number; bytes: Uint8Array }>();
  for (const path of [TRAINER_ROSTERS_PATH, RULES_PATH, TRAINER_POOLS_PATH, TRAINER_MOVE_POOLS_PATH, TRAINER_NICKNAMES_PATH]) {
    const fileId = rom.filenames.idOf(path);
    if (fileId !== undefined) files.set(path, { fileId, bytes: rom.files[fileId].slice() });
  }
  sources.set(project, files);
}

function currentTable(project: ProjectState, rom?: NintendoDSRom, path = TRAINER_ROSTERS_PATH): Uint8Array | undefined {
  const added = project.fileSystem?.additions?.[path];
  if (added) return added;
  const source = sources.get(project)?.get(path);
  const id = rom?.filenames.idOf(path) ?? source?.fileId;
  if (id === undefined || project.fileSystem?.tombstones?.[id]) return undefined;
  return project.fileSystem?.replacements[id] ?? rom?.files[id] ?? source?.bytes;
}

function stageTable(project: ProjectState, bytes: Uint8Array, rom?: NintendoDSRom, path = TRAINER_ROSTERS_PATH) {
  const id = rom?.filenames.idOf(path) ?? sources.get(project)?.get(path)?.fileId;
  if (id === undefined) addRomFile(project, path, bytes);
  else {
    delete project.fileSystem?.additions?.[path];
    delete project.fileSystem?.tombstones?.[id];
    setRomFileReplacement(project, id, bytes);
  }
}

const isTrainerId = (id: number) => Number.isInteger(id) && id > 0 && id < TRAINER_ROSTER_ID_LIMIT;
const isWeight = (weight: number) => Number.isInteger(weight) && weight > 0 && weight <= TRAINER_ROSTER_MAX_WEIGHT;

function decode(bytes?: Uint8Array): Map<number, RosterEntry[]> {
  const result = new Map<number, RosterEntry[]>();
  if (!bytes) return result;
  if (bytes.length < HEADER + 4 || readU32(bytes, 0) !== MAGIC || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== ENTRY)
    throw new Error("Unrecognized trainer roster data.");
  const trainers = readU32(bytes, 8);
  const entries = readU32(bytes, 12);
  const directoryEnd = HEADER + (trainers + 1) * 4;
  if (trainers > TRAINER_ROSTER_ID_LIMIT || entries > trainers * TRAINER_ROSTER_MAX_CHOICES
    || bytes.length !== directoryEnd + entries * ENTRY || readU32(bytes, HEADER) !== 0
    || readU32(bytes, directoryEnd - 4) !== entries) throw new Error("Invalid trainer roster directory.");

  for (let trainer = 0; trainer < trainers; trainer++) {
    const start = readU32(bytes, HEADER + trainer * 4);
    const end = readU32(bytes, HEADER + (trainer + 1) * 4);
    if (end < start || end > entries || end - start > TRAINER_ROSTER_MAX_CHOICES || (!trainer && end !== start))
      throw new Error("Invalid trainer roster range.");
    if (start === end) continue;
    result.set(trainer, readEntries(bytes, directoryEnd + start * ENTRY, end - start, trainer));
  }
  return result;
}

function readEntries(bytes: Uint8Array, offset: number, count: number, trainer: number): RosterEntry[] {
  const choices: RosterEntry[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++, offset += ENTRY) {
    const rosterId = readU16(bytes, offset);
    const weight = readU16(bytes, offset + 2);
    const size = bytes[offset + 4];
    if ((!isTrainerId(rosterId) && !isTrainerPoolSource(rosterId)) || !isWeight(weight) || !size || size > 6 || bytes[offset + 5] || used.has(rosterId))
      throw new Error(`Trainer ${trainer} has an invalid roster entry.`);
    used.add(rosterId);
    choices.push({ rosterId, weight, size });
  }
  return choices;
}

function writeEntry(bytes: Uint8Array, offset: number, choice: RosterEntry): void {
  writeU16(bytes, offset, choice.rosterId);
  writeU16(bytes, offset + 2, choice.weight);
  bytes[offset + 4] = choice.size;
}

function encode(rows: ReadonlyMap<number, RosterEntry[]>): Uint8Array {
  const trainers = Math.max(-1, ...rows.keys()) + 1;
  const directoryEnd = HEADER + (trainers + 1) * 4;
  const entries = [...rows.values()].reduce((sum, row) => sum + row.length, 0);
  const bytes = new Uint8Array(directoryEnd + entries * ENTRY);
  writeU32(bytes, 0, MAGIC);
  writeU16(bytes, 4, 1);
  writeU16(bytes, 6, ENTRY);
  writeU32(bytes, 8, trainers);
  writeU32(bytes, 12, entries);
  let index = 0;
  for (let trainer = 0; trainer < trainers; trainer++) {
    writeU32(bytes, HEADER + trainer * 4, index);
    for (const choice of rows.get(trainer) ?? []) {
      const offset = directoryEnd + index++ * ENTRY;
      writeEntry(bytes, offset, choice);
    }
  }
  writeU32(bytes, directoryEnd - 4, index);
  return bytes;
}

/** The default roster and rule tables as they stand; a new array whenever either changes. */
export function trainerRosterTables(project: ProjectState): [Uint8Array | undefined, Uint8Array | undefined] {
  return [currentTable(project), currentTable(project, undefined, RULES_PATH)];
}

/** Let a copy of a project (structuredClone, as Test Battle makes) read the ROM's roster files like the original. */
export function shareTrainerRosterSources(from: ProjectState, to: ProjectState): void {
  const files = sources.get(from);
  if (files) sources.set(to, files);
}

export function getTrainerRosterChoices(project: ProjectState, trainer: number): TrainerRosterChoice[] {
  return (decode(currentTable(project)).get(trainer) ?? []).map(({ rosterId, weight }) => ({ rosterId, weight }));
}

function validateTrainer(project: ProjectState, trainer: number): void {
  if (project.session.baseRom !== "BW2" || !isTrainerId(trainer) || !project.narcs.trdata?.rawFiles[trainer])
    throw new Error("Choose a Black 2 or White 2 trainer with a valid ID.");
}

function validateChoices(project: ProjectState, trainer: number, choices: readonly TrainerRosterChoice[]): RosterEntry[] {
  if (choices.length > TRAINER_ROSTER_MAX_CHOICES) throw new Error(`A trainer can use up to ${TRAINER_ROSTER_MAX_CHOICES} roster choices per list.`);
  const pools = getTrainerPartyPools(project);
  const used = new Set<number>();
  return choices.map(({ rosterId, weight }) => {
    if (!isWeight(weight) || used.has(rosterId))
      throw new Error("Each choice needs a distinct trainer ID or party pool and a weight from 1 to 65,535.");
    const pool = isTrainerPoolSource(rosterId);
    if (!pool && (!isTrainerId(rosterId) || !project.narcs.trdata?.rawFiles[rosterId]))
      throw new Error("Choose a valid roster trainer ID.");
    const entry = pool ? pools.get(trainerPoolId(rosterId)) : undefined;
    if (entry?.owner !== undefined && entry.owner !== trainer) throw new Error("Choose an alternate party belonging to this trainer.");
    const size = pool ? entry?.size : project.trpokInfo[rosterId]?.numPokemon;
    if (!size || size > 6) throw new Error(`${pool ? trainerPartyLabel(trainerPoolId(rosterId)) : `Roster #${rosterId}`} needs one to six Pokémon.`);
    used.add(rosterId);
    return { rosterId, weight, size };
  });
}

export function setTrainerRosterChoices(project: ProjectState, trainer: number, choices: readonly TrainerRosterChoice[]): void {
  validateTrainer(project, trainer);
  const rows = decode(currentTable(project));
  const original = rows.get(trainer) ?? [];
  const entries = validateChoices(project, trainer, choices);
  const summary = (row: readonly TrainerRosterChoice[]) => row.map(({ rosterId, weight }) => `${isTrainerPoolSource(rosterId) ? trainerPartyLabel(trainerPoolId(rosterId)) : `#${rosterId}`} × ${weight}`).join(", ");
  if (summary(original) === summary(entries)) return;
  if (entries.length) rows.set(trainer, entries);
  else rows.delete(trainer);
  stageTable(project, encode(rows));
  recordFieldChange(project, "trdata", `Trainer ${trainer}`, "Roster variations", summary(original), summary(entries),
    { key: `trainer:${trainer}:data:roster-variations` });
}

function validateCondition({ kind, comparison, subject, value }: TrainerRosterCondition): void {
  const within = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  const valid = within(comparison, 0, kind === 0 || kind === 3 ? 1 : 5) && (
    kind === 0 ? within(subject, 1, 65535) && value === 0
      : kind === 1 ? within(subject, 0, 17) && within(value, 0, 6)
        : kind === 2 ? subject === 0 && within(value, 1, 100)
          : kind === 3 && subject === 0 && within(value, 0, 2));
  if (!valid) throw new Error("Check the value and comparison for each roster condition.");
}

function decodeRules(bytes?: Uint8Array): Map<number, RosterRule[]> {
  const result = new Map<number, RosterRule[]>();
  if (!bytes) return result;
  if (bytes.length < HEADER + 4 || readU32(bytes, 0) !== RULE_MAGIC || readU16(bytes, 4) !== 1 || readU16(bytes, 6) !== 0)
    throw new Error("Unrecognized trainer roster rules.");
  const trainers = readU32(bytes, 8), payload = readU32(bytes, 12);
  const directoryEnd = HEADER + (trainers + 1) * 4;
  if (trainers > TRAINER_ROSTER_ID_LIMIT || bytes.length !== directoryEnd + payload
    || readU32(bytes, HEADER) !== 0 || readU32(bytes, directoryEnd - 4) !== payload)
    throw new Error("Invalid trainer roster rule directory.");

  for (let trainer = 0; trainer < trainers; trainer++) {
    const start = readU32(bytes, HEADER + trainer * 4), end = readU32(bytes, HEADER + (trainer + 1) * 4);
    if (end < start || end > payload || (!trainer && end !== start)) throw new Error("Invalid trainer roster rule range.");
    if (start === end) continue;
    const rules: RosterRule[] = [];
    const stop = directoryEnd + end;
    for (let at = directoryEnd + start; at < stop;) {
      if (rules.length >= TRAINER_ROSTER_MAX_RULES || at + RULE > stop) throw new Error("Invalid trainer roster rule count.");
      const conditionCount = bytes[at], choiceCount = bytes[at + 1], mode = bytes[at + 2];
      if (!conditionCount || conditionCount > TRAINER_ROSTER_MAX_CONDITIONS || !choiceCount || choiceCount > TRAINER_ROSTER_MAX_CHOICES
        || mode > 1 || bytes[at + 3] || at + RULE + conditionCount * CONDITION + choiceCount * ENTRY > stop)
        throw new Error("Invalid trainer roster rule.");
      at += RULE;
      const conditions: TrainerRosterCondition[] = [];
      for (let i = 0; i < conditionCount; i++, at += CONDITION) {
        const condition = { kind: bytes[at], comparison: bytes[at + 1], subject: readU16(bytes, at + 2), value: readU16(bytes, at + 4) };
        validateCondition(condition);
        conditions.push(condition);
      }
      rules.push({ match: mode ? "any" : "all", conditions, choices: readEntries(bytes, at, choiceCount, trainer) });
      at += choiceCount * ENTRY;
    }
    result.set(trainer, rules);
  }
  return result;
}

function encodeRules(rows: ReadonlyMap<number, RosterRule[]>): Uint8Array {
  const trainers = Math.max(-1, ...rows.keys()) + 1;
  const directoryEnd = HEADER + (trainers + 1) * 4;
  const payload = [...rows.values()].flat().reduce((sum, rule) => sum + RULE + rule.conditions.length * CONDITION + rule.choices.length * ENTRY, 0);
  const bytes = new Uint8Array(directoryEnd + payload);
  writeU32(bytes, 0, RULE_MAGIC);
  writeU16(bytes, 4, 1);
  writeU32(bytes, 8, trainers);
  writeU32(bytes, 12, payload);
  let at = directoryEnd;
  for (let trainer = 0; trainer < trainers; trainer++) {
    writeU32(bytes, HEADER + trainer * 4, at - directoryEnd);
    for (const rule of rows.get(trainer) ?? []) {
      bytes.set([rule.conditions.length, rule.choices.length, rule.match === "any" ? 1 : 0, 0], at);
      at += RULE;
      for (const { kind, comparison, subject, value } of rule.conditions) {
        bytes[at] = kind;
        bytes[at + 1] = comparison;
        writeU16(bytes, at + 2, subject);
        writeU16(bytes, at + 4, value);
        at += CONDITION;
      }
      for (const choice of rule.choices) {
        writeEntry(bytes, at, choice);
        at += ENTRY;
      }
    }
  }
  writeU32(bytes, directoryEnd - 4, payload);
  return bytes;
}

export function getTrainerRosterRules(project: ProjectState, trainer: number): TrainerRosterRule[] {
  return (decodeRules(currentTable(project, undefined, RULES_PATH)).get(trainer) ?? [])
    .map(rule => ({ ...rule, choices: rule.choices.map(({ rosterId, weight }) => ({ rosterId, weight })) }));
}

export function setTrainerRosterRules(project: ProjectState, trainer: number, rules: readonly TrainerRosterRule[]): void {
  validateTrainer(project, trainer);
  if (rules.length > TRAINER_ROSTER_MAX_RULES) throw new Error(`A trainer can use up to ${TRAINER_ROSTER_MAX_RULES} rules.`);
  const rows = decodeRules(currentTable(project, undefined, RULES_PATH));
  const original = rows.get(trainer) ?? [];
  const entries = rules.map((rule) => {
    if ((rule.match !== "all" && rule.match !== "any") || !rule.conditions.length
      || rule.conditions.length > TRAINER_ROSTER_MAX_CONDITIONS || !rule.choices.length)
      throw new Error(`Every rule needs 1–${TRAINER_ROSTER_MAX_CONDITIONS} conditions and at least one roster choice.`);
    rule.conditions.forEach(validateCondition);
    return { ...rule, choices: validateChoices(project, trainer, rule.choices) };
  });
  if (JSON.stringify(original) === JSON.stringify(entries)) return;
  if (entries.length) rows.set(trainer, entries);
  else rows.delete(trainer);
  stageTable(project, encodeRules(rows), undefined, RULES_PATH);
  recordFieldChange(project, "trdata", `Trainer ${trainer}`, "Conditional roster rules",
    JSON.stringify(original), JSON.stringify(entries), { key: `trainer:${trainer}:data:conditional-rosters` });
}

export function getTrainerPartyPools(project: ProjectState): Map<number, TrainerPartyPool> {
  const pools: Map<number, TrainerPartyPool> = decodeTrainerPools(currentTable(project, undefined, TRAINER_POOLS_PATH));
  const moves = readMovePools(project);
  const names = readNicknames(project);
  if (moves.size || names.size) {
    for (const [id, pool] of pools) {
      const source = trainerPoolSource(id);
      pool.members.forEach((member, index) => {
        if (!("pokemon" in member)) return;
        const key = trainerMovePoolKey(source, index);
        const alternatives = moves.get(key);
        const nickname = names.get(key);
        if (alternatives) member.pokemon.movePools = alternatives;
        if (nickname) member.pokemon.nickname = nickname;
      });
    }
  }
  return pools;
}

const nicknameCache = new WeakMap<Uint8Array, ReadonlyMap<number, string>>();

function readNicknames(project: ProjectState): ReadonlyMap<number, string> {
  const bytes = currentTable(project, undefined, TRAINER_NICKNAMES_PATH);
  if (!bytes) return new Map();
  const cached = nicknameCache.get(bytes);
  if (cached) return cached;
  let names: Map<number, string>;
  try {
    names = decodeTrainerNicknames(bytes);
  } catch {
    names = new Map();
  }
  nicknameCache.set(bytes, names);
  return names;
}

function saveNicknames(project: ProjectState, names: ReadonlyMap<number, string>): void {
  const current = currentTable(project, undefined, TRAINER_NICKNAMES_PATH);
  if (!current && !names.size) return;
  const bytes = encodeTrainerNicknames(names);
  if (current?.length === bytes.length && bytes.every((byte, index) => byte === current[index])) return;
  stageTable(project, bytes, undefined, TRAINER_NICKNAMES_PATH);
}

export function getTrainerSlotNickname(project: ProjectState, trainer: number, slot: number): string {
  return readNicknames(project).get(trainerMovePoolKey(trainer, slot)) ?? "";
}

export function setTrainerSlotNickname(project: ProjectState, trainer: number, slot: number, nickname: string): void {
  validateTrainer(project, trainer);
  if (!Number.isInteger(slot) || slot < 0 || slot >= Math.min(project.trpokInfo[trainer]?.numPokemon ?? 0, 6))
    throw new Error("Trainer Pokémon slot does not exist.");
  validateTrainerNickname(nickname);
  const names = decodeTrainerNicknames(currentTable(project, undefined, TRAINER_NICKNAMES_PATH));
  const key = trainerMovePoolKey(trainer, slot);
  const previous = names.get(key) ?? "";
  if (previous === nickname) return;
  if (nickname) names.set(key, nickname);
  else names.delete(key);
  saveNicknames(project, names);
  recordFieldChange(project, "trpok", `Trainer ${trainer}`, `Pokémon ${slot + 1} nickname`, previous, nickname,
    { key: `trainer:${trainer}:pokemon:${slot}:nickname` });
}

export function remapTrainerSlotNicknames(project: ProjectState, sourceId: number, targetId: number, slots: readonly (number | undefined)[]): void {
  const saved = readNicknames(project);
  if (!saved.size) return;
  const names = new Map(saved);
  const moved = slots.map(slot => slot === undefined ? undefined : names.get(trainerMovePoolKey(sourceId, slot)));
  for (let slot = 0; slot < 6; ++slot) names.delete(trainerMovePoolKey(targetId, slot));
  moved.forEach((name, slot) => {
    if (name && slot < 6) names.set(trainerMovePoolKey(targetId, slot), name);
  });
  saveNicknames(project, names);
}

// ---------- Move pools ----------

/** The saved move pools; unreadable data reads as none, so the rest of the editor keeps working. */
function readMovePools(project: ProjectState): Map<number, TrainerMovePools> {
  try {
    return decodeTrainerMovePools(currentTable(project, undefined, TRAINER_MOVE_POOLS_PATH));
  } catch {
    return new Map();
  }
}

function saveMovePools(project: ProjectState, pools: Map<number, TrainerMovePools>): void {
  const current = currentTable(project, undefined, TRAINER_MOVE_POOLS_PATH);
  const bytes = encodeTrainerMovePools(pools);
  if (!current && bytes.length === 16) return;
  if (current?.length === bytes.length && bytes.every((byte, offset) => byte === current[offset])) return;
  stageTable(project, bytes, undefined, TRAINER_MOVE_POOLS_PATH);
}

/** A trainer Pokémon's own moves, as the game reads them (none without the moves template). */
export function trainerSlotMoves(project: ProjectState, trainer: number, slot: number): number[] {
  const info = project.trpokInfo[trainer];
  const fields = decodeRecord(project, "trpok", trainer).raw ?? {};
  return [1, 2, 3, 4].map((move) => (info && info.template & 1 ? Number(fields[`move_${move}_${slot}`] ?? 0) : 0));
}

export function getTrainerSlotMovePools(project: ProjectState, trainer: number, slot: number): TrainerMovePools | undefined {
  return readMovePools(project).get(trainerMovePoolKey(trainer, slot));
}

/** Set a trainer Pokémon's move alternatives; undefined (or no alternatives) clears them. */
export function setTrainerSlotMovePools(project: ProjectState, trainer: number, slot: number, value: TrainerMovePools | undefined): void {
  validateTrainer(project, trainer);
  if (!Number.isInteger(slot) || slot < 0 || slot >= Math.min(project.trpokInfo[trainer]?.numPokemon ?? 0, 6))
    throw new Error("Trainer Pokémon slot does not exist.");
  const pools = decodeTrainerMovePools(currentTable(project, undefined, TRAINER_MOVE_POOLS_PATH));
  const key = trainerMovePoolKey(trainer, slot);
  const previous = pools.get(key);
  if (hasMoveAlternatives(value)) {
    const problem = trainerMovePoolProblem(value, trainerSlotMoves(project, trainer, slot));
    if (problem) throw new Error(problem);
    pools.set(key, value);
  } else pools.delete(key);
  if (JSON.stringify(previous) === JSON.stringify(pools.get(key))) return;
  saveMovePools(project, pools);
  recordFieldChange(project, "trpok", `Trainer ${trainer}`, `Pokémon ${slot + 1} move alternatives`,
    JSON.stringify(previous ?? null), JSON.stringify(pools.get(key) ?? null), { key: `trainer:${trainer}:pokemon:${slot}:move-pools` });
}

/**
 * After a trainer Pokémon's own moves change, keep its alternatives sensible: a move picked from a slot's
 * alternatives swaps with the old one, and alternatives that now repeat their slot's move are dropped.
 */
export function followTrainerSlotMoves(project: ProjectState, trainer: number, slot: number, previous: readonly number[]): void {
  const pools = readMovePools(project);
  const key = trainerMovePoolKey(trainer, slot);
  const value = pools.get(key);
  if (!value) return;
  const moves = trainerSlotMoves(project, trainer, slot);
  let next: TrainerMovePools | undefined = value;
  moves.forEach((move, index) => {
    if (move !== previous[index]) next = changeOwnMove(next, index, previous[index] ?? 0, move);
  });
  next = withoutOwnMoves(next, moves);
  if (JSON.stringify(next) === JSON.stringify(value)) return;
  if (next) pools.set(key, next);
  else pools.delete(key);
  saveMovePools(project, pools);
}

/** Copy or reorder move pools along with the party members they belong to. */
export function remapTrainerSlotMovePools(project: ProjectState, sourceId: number, targetId: number, slots: readonly (number | undefined)[]): void {
  if (!currentTable(project, undefined, TRAINER_MOVE_POOLS_PATH)) return;
  const pools = readMovePools(project);
  if (!pools.size) return;
  const moved = slots.map((slot) => slot === undefined ? undefined : pools.get(trainerMovePoolKey(sourceId, slot)));
  for (let slot = 0; slot < 6; ++slot) pools.delete(trainerMovePoolKey(targetId, slot));
  moved.forEach((value, slot) => {
    if (value && slot < 6) pools.set(trainerMovePoolKey(targetId, slot), structuredClone(value));
  });
  saveMovePools(project, pools);
}

/** Store a pool's own candidates' move pools under the pool, replacing what it had. */
function savePoolMovePools(project: ProjectState, id: number, pool: TrainerPartyPool | undefined): void {
  const pools = readMovePools(project);
  const source = trainerPoolSource(id);
  for (const key of [...pools.keys()]) if (trainerMovePoolSource(key) === source) pools.delete(key);
  pool?.members.forEach((member, index) => {
    if ("pokemon" in member && hasMoveAlternatives(member.pokemon.movePools)) pools.set(trainerMovePoolKey(source, index), member.pokemon.movePools);
  });
  saveMovePools(project, pools);
}

export function setTrainerPartyPool(project: ProjectState, id: number, pool: TrainerPartyPool | undefined): void {
  if (project.session.baseRom !== "BW2") throw new Error("Trainer party pools require Black 2 or White 2.");
  const current = currentTable(project, undefined, TRAINER_POOLS_PATH);
  const pools = decodeTrainerPools(current);
  const previous = pools.get(id);
  const label = trainerPartyLabel(id);
  if (pool) {
    if (pool.owner !== undefined) validateTrainer(project, pool.owner);
    if (previous && previous.owner !== pool.owner) throw new Error("An alternate party cannot change trainers.");
    const compiled = compileTrainerPool(id, pool, ({ trainerId, slot }) => {
      const info = project.trpokInfo[trainerId];
      if (!info || slot >= info.numPokemon) throw new Error(`Trainer #${trainerId} has no Pokémon in slot ${slot + 1}.`);
      const fields = decodeRecord(project, "trpok", trainerId).raw;
      return {
        template: info.template,
        species: fields?.[`species_id_${slot}`] ?? 0,
        form: fields?.[`form_${slot}`] ?? 0,
        item: info.template & 2 ? fields?.[`item_id_${slot}`] ?? 0 : 0,
      };
    });
    validatePoolPokemon(project, id, pool, name => project.narcs[name]?.rawFiles);
    pool.members.forEach((member, index) => {
      if (!("pokemon" in member) || !hasMoveAlternatives(member.pokemon.movePools)) return;
      const problem = trainerMovePoolProblem(member.pokemon.movePools, member.pokemon.moves);
      if (problem) throw new Error(`${label} Pokémon ${index + 1}: ${problem}`);
    });
    pools.set(id, compiled);
  } else {
    if (!previous) return;
    const source = trainerPoolSource(id);
    const rows = decode(currentTable(project));
    const rules = decodeRules(currentTable(project, undefined, RULES_PATH));
    const trainers = new Set([
      ...[...rows].filter(([, choices]) => choices.some(choice => choice.rosterId === source)).map(([trainer]) => trainer),
      ...[...rules].filter(([, list]) => list.some(rule => rule.choices.some(choice => choice.rosterId === source))).map(([trainer]) => trainer),
    ]);
    if (trainers.size) throw new Error(`Remove ${label} from the roster choices for trainer ${[...trainers].map(trainer => `#${trainer}`).join(", ")} before deleting it.`);
    pools.delete(id);
  }
  const before = describePool(previous && getTrainerPartyPools(project).get(id));
  const nicknameSource = trainerPoolSource(id);
  const existingNicknames = currentTable(project, undefined, TRAINER_NICKNAMES_PATH);
  const hasNicknames = pool?.members.some(member => "pokemon" in member && member.pokemon.nickname);
  if (existingNicknames || hasNicknames) {
    const names = decodeTrainerNicknames(existingNicknames);
    for (const key of names.keys()) if (trainerMovePoolSource(key) === nicknameSource) names.delete(key);
    pool?.members.forEach((member, index) => {
      if ("pokemon" in member && member.pokemon.nickname)
        names.set(trainerMovePoolKey(nicknameSource, index), member.pokemon.nickname);
    });
    saveNicknames(project, names);
  }
  savePoolMovePools(project, id, pool);
  const bytes = encodeTrainerPools(pools);
  const after = describePool(pool);
  if (current?.length === bytes.length && bytes.every((byte, offset) => byte === current[offset])) {
    if (before !== after) recordFieldChange(project, "trdata", label, "Trainer party", before, after, { key: `trainer-party-pool:${id}` });
    return;
  }
  stageTable(project, bytes, undefined, TRAINER_POOLS_PATH);
  recordFieldChange(project, "trdata", label, "Trainer party", before, after,
    { key: `trainer-party-pool:${id}` });
}

function describePool(pool?: TrainerPartyPool): string {
  if (!pool) return "";
  const { owner, size, roleSlots, speciesRule, itemClause, itemExceptions, slotGroups, members } = pool;
  return JSON.stringify({ owner, size, roleSlots, speciesRule, itemClause, itemExceptions, slotGroups, members: members.map(member => "pokemon" in member
    ? { role: member.role, groups: member.groups, pokemon: member.pokemon } : { trainerId: member.trainerId, slot: member.slot, role: member.role, groups: member.groups }) });
}

/** Keep references on the same Pokémon when party slots move. */
export function remapTrainerPoolMembers(project: ProjectState, trainerId: number, order: readonly number[]): void {
  const source = currentTable(project, undefined, TRAINER_POOLS_PATH);
  if (!source) return;
  const pools = decodeTrainerPools(source);
  let changed = false;
  for (const [id, pool] of pools) {
    for (const member of pool.members) {
      if (!("trainerId" in member) || member.trainerId !== trainerId) continue;
      const slot = order.indexOf(member.slot);
      if (slot < 0) throw new Error(`Remove this Pokémon from Pool #${id} before deleting it from the roster.`);
      if (slot === member.slot) continue;
      member.slot = slot;
      changed = true;
    }
  }
  if (changed) stageTable(project, encodeTrainerPools(pools), undefined, TRAINER_POOLS_PATH);
}

const validMetadata = (metadata?: Uint8Array) => metadata?.length === 16 || metadata?.length === 20;

function archiveParty(metadata?: Uint8Array, party?: Uint8Array) {
  const size = metadata?.[3] ?? 0;
  const template = metadata?.[0] ?? 255;
  const stride = 8 + (template & 1 ? 8 : 0) + (template & 2 ? 2 : 0);
  if (!validMetadata(metadata) || template > 3 || size < 1 || size > 6 || !party
    || party.length < stride * size || party.length > 108) return;
  return { size, template, stride, party };
}

const POOL_DATA_ARCHIVES = { personal: "a/0/1/6", moves: "a/0/2/1", items: "a/0/2/4" } as const;

function validatePoolPokemon(
  project: ProjectState, id: number, pool: TrainerPartyPool,
  files: (name: keyof typeof POOL_DATA_ARCHIVES) => readonly Uint8Array[] | undefined,
): void {
  const direct = pool.members.flatMap(member => "pokemon" in member ? [member.pokemon] : []);
  if (!direct.length) return;
  const personal = files("personal"), moves = files("moves"), items = files("items");
  let formsOffset = 0;
  const format = project.formats.personal ?? [];
  for (const [length, name] of format) {
    if (name === "num_forms") break;
    formsOffset += length;
  }
  const personalLength = format.reduce((size, [length]) => size + length, 0);
  const validForm = (pokemon: TrainerPoolPokemon) => {
    const record = personal?.[pokemon.species];
    if (!personal) return true;
    if (!record || (personalLength && record.length !== personalLength)) return false;
    const store = project.narcs.personal;
    const edited = store?.dirty.has(pokemon.species) ? store.records.get(pokemon.species)?.raw?.num_forms : undefined;
    return pokemon.form < Math.max(1, edited ?? record[formsOffset] ?? 1);
  };
  for (const [index, pokemon] of direct.entries()) {
    if (pokemon.species === 650 || pokemon.species === 651 || pokemon.species !== storedSpeciesId(project, pokemon.species) || pokemon.species === regionalDexFile(project)
      || isAbsentExpansionSlot(project, pokemon.species) || findPokemonPersonalFormOwner(project, pokemon.species) || !validForm(pokemon)
      || pokemon.ability > trainerAbilitySlotMax(project)
      || pokemon.moves.some(move => moves && move !== 0 && !moves[move]?.length)
      || (items && pokemon.item !== 0 && !items[pokemon.item]?.length))
      throw new Error(`Check the species, form, ability, moves and held item for ${trainerPartyLabel(id)} Pokémon ${index + 1}.`);
  }
}

/** Refresh pool member data and party sizes from the archives being written to the ROM. */
export function materializeTrainerRosters(project: ProjectState, rom: NintendoDSRom): void {
  if (project.session.baseRom !== "BW2") return;
  const source = currentTable(project, rom);
  const rulesSource = currentTable(project, rom, RULES_PATH);
  const poolsSource = currentTable(project, rom, TRAINER_POOLS_PATH);
  const rows = decode(source);
  const rules = decodeRules(rulesSource);
  const pools = decodeTrainerPools(poolsSource);
  if (!rows.size && !rules.size && !pools.size) return;
  const files = (name: "trdata" | "trpok" | keyof typeof POOL_DATA_ARCHIVES, path: string) => {
    const store = project.narcs[name];
    if (store?.dirty.size) return store.rawFiles;
    const id = rom.fileId(path);
    return new NARC(store ? rom.files[id] : getRomFileBytes(project, rom, id)).files;
  };
  const trdata = files("trdata", "a/0/9/1");
  const trpok = files("trpok", "a/0/9/2");
  const resolveMember = ({ trainerId, slot }: TrainerPoolReference) => {
    const entry = archiveParty(trdata[trainerId], trpok[trainerId]);
    if (!entry || slot >= entry.size) throw new Error(`Trainer #${trainerId} has no valid Pokémon in slot ${slot + 1}.`);
    const { template, stride, party } = entry;
    const offset = stride * slot;
    return { template, species: readU16(party, offset + 4), form: readU16(party, offset + 6),
      item: template & 2 ? readU16(party, offset + 8) : 0 };
  };
  const poolArchives = new Map<string, Uint8Array[]>();
  for (const [id, pool] of pools) {
    if (pool.owner !== undefined && !validMetadata(trdata[pool.owner]))
      throw new Error(`${trainerPartyLabel(id)} belongs to a missing trainer.`);
    const compiled = compileTrainerPool(id, pool, resolveMember);
    validatePoolPokemon(project, id, pool, name => {
      let archive = poolArchives.get(name);
      if (!archive) {
        archive = files(name, POOL_DATA_ARCHIVES[name]);
        poolArchives.set(name, archive);
      }
      return archive;
    });
    pools.set(id, compiled);
  }

  const authored = [...rows, ...[...rules].map(([trainer, rules]) => [trainer, rules.flatMap(rule => rule.choices)] as const)];
  for (const [trainer, choices] of authored) {
    if (!validMetadata(trdata[trainer])) throw new Error(`Trainer ${trainer} has roster variations but its trainer data is missing.`);
    for (const choice of choices) {
      const { rosterId } = choice;
      const pool = isTrainerPoolSource(rosterId);
      const entry = pool ? pools.get(trainerPoolId(rosterId)) : undefined;
      if (entry?.owner !== undefined && entry.owner !== trainer)
        throw new Error(`Trainer ${trainer} refers to an alternate party belonging to another trainer.`);
      const size = pool ? entry?.size : archiveParty(trdata[rosterId], trpok[rosterId])?.size;
      if (!size) throw new Error(`Trainer ${trainer} refers to invalid or empty ${pool ? trainerPartyLabel(trainerPoolId(rosterId)) : `roster ${rosterId}`}.`);
      choice.size = size;
    }
  }
  const refresh = (previous: Uint8Array, bytes: Uint8Array, path: string) => {
    if (bytes.length !== previous.length || bytes.some((byte, i) => byte !== previous[i])) stageTable(project, bytes, rom, path);
  };
  if (source && rows.size) refresh(source, encode(rows), TRAINER_ROSTERS_PATH);
  if (rulesSource && rules.size) refresh(rulesSource, encodeRules(rules), RULES_PATH);
  if (poolsSource && pools.size) refresh(poolsSource, encodeTrainerPools(pools), TRAINER_POOLS_PATH);
}
