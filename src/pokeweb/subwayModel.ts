import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { getFacilitySetRecord, trainerTypeName, type BattleFacilitySet } from "./battleFacilityModel";
import { markDirty, type ProjectState } from "./projectStore";
import { cleanDisplayText } from "./text";
import { getTextBank, updateTextEntry } from "./textModel";

/**
 * Battle Subway (Black 2 / White 2) as the game plays it, from ov033 bsubway_trainers.c / bsubway_scr.c and
 * ov012 fld_btl_inst_tool.c / event_bsubway.c.
 *
 * - Trainer N is file N + 1 of a/2/1/2 (file 0 is a placeholder): u16 trainer class, u16 set count, then the set
 *   IDs into a/2/1/1. A trainer has no fixed team: each battle draws 3 or 4 sets from its list at random, with no
 *   repeated species (and none the player brought) and, for the first 50 tries, no repeated held item.
 * - Names are system message bank 15 (entry N); quotes are bank 376 (entries 3N, 3N + 1, 3N + 2).
 * - Which trainers a car draws from depends only on the train and the round (7 battles); see SUBWAY_ROUNDS.
 * - #300–305 are the Multi Train partners and #306–313 are Ingo and Emmet's teams.
 */

export const SUBWAY_NAME_BANK = 15;
export const SUBWAY_QUOTE_BANK = 376;
export const SUBWAY_FIRST_PARTNER = 300;
export const SUBWAY_FIRST_BOSS = 306;
export const SUBWAY_REGULAR_COUNT = 300;
const SET_LENGTH = 16;

export type SubwaySeries = "normal" | "super";
export type SubwayTrainId = "single" | "double" | "multi" | "superSingle" | "superDouble" | "superMulti" | "wifi";

export type SubwayTrain = {
  id: SubwayTrainId;
  name: string;
  series: SubwaySeries | "wifi";
  /** The game's play modes (0–8) this train covers. */
  modes: number[];
  /** Pokémon each side brings; Multi trains bring 2 each. */
  brought: number;
  regulation: number;
  regulationName: string;
  battlePoints: string;
  /** Ingo / Emmet team(s) at the end of the train. */
  bosses: number[];
  note?: string;
};

export const SUBWAY_TRAINS: SubwayTrain[] = [
  { id: "single", name: "Single Train", series: "normal", modes: [0], brought: 3, regulation: 20, regulationName: "Subway Single", battlePoints: "3 per round", bosses: [306] },
  { id: "double", name: "Double Train", series: "normal", modes: [1], brought: 4, regulation: 21, regulationName: "Subway Double", battlePoints: "3 per round", bosses: [308] },
  { id: "multi", name: "Multi Train", series: "normal", modes: [2, 3], brought: 2, regulation: 22, regulationName: "Subway Multi", battlePoints: "3 per round", bosses: [310, 311], note: "Two trainers per car. The player teams up with a friend or with Nate / Rosa (see Multi partners)." },
  { id: "superSingle", name: "Super Single Train", series: "super", modes: [5], brought: 3, regulation: 20, regulationName: "Subway Single", battlePoints: "5, 6, 7, 8, 9, then 10 per round", bosses: [307] },
  { id: "superDouble", name: "Super Double Train", series: "super", modes: [6], brought: 4, regulation: 21, regulationName: "Subway Double", battlePoints: "5, 6, 7, 8, 9, then 10 per round", bosses: [309] },
  { id: "superMulti", name: "Super Multi Train", series: "super", modes: [7, 8], brought: 2, regulation: 22, regulationName: "Subway Multi", battlePoints: "5, 6, 7, 8, 9, then 10 per round", bosses: [312, 313], note: "Two trainers per car. The player teams up with a friend or with Nate / Rosa (see Multi partners)." },
  { id: "wifi", name: "Wi-Fi Train", series: "wifi", modes: [4], brought: 3, regulation: 20, regulationName: "Subway Single", battlePoints: "By Wi-Fi rank", bosses: [], note: "Its trainers were downloaded from Nintendo's servers (now offline), so nothing in the ROM decides them." },
];

export function subwayTrain(id: string): SubwayTrain | undefined {
  return SUBWAY_TRAINS.find((train) => train.id === id);
}

/** One slot of a round: the cars that draw from one trainer range, or the boss. */
export type SubwaySlot = {
  key: string;
  series: SubwaySeries;
  round: string;
  battles: string;
  cars: string;
  /** Trainer range the cars draw from; absent for the boss slot. */
  min?: number;
  max?: number;
  boss?: true;
};

export type SubwayRound = { label: string; battles: string; slots: SubwaySlot[] };

const slot = (series: SubwaySeries, key: string, round: string, cars: string, battles: string, min?: number, max?: number): SubwaySlot =>
  min === undefined ? { key, series, round, cars, battles, boss: true } : { key, series, round, cars, battles, min, max };

/** How each train fills its cars, round by round (the sNormal… and sSuper… range tables in bsubway_trainers.c). */
export const SUBWAY_ROUNDS: Record<SubwaySeries, SubwayRound[]> = {
  normal: [
    { label: "Round 1", battles: "Battles 1–7", slots: [slot("normal", "n1a", "Round 1", "Cars 1–6", "Battles 1–6", 0, 49), slot("normal", "n1b", "Round 1", "Car 7", "Battle 7", 50, 69)] },
    { label: "Round 2", battles: "Battles 8–14", slots: [slot("normal", "n2a", "Round 2", "Cars 1–6", "Battles 8–13", 30, 69), slot("normal", "n2b", "Round 2", "Car 7", "Battle 14", 70, 89)] },
    { label: "Round 3", battles: "Battles 15–21", slots: [slot("normal", "n3a", "Round 3", "Cars 1–6", "Battles 15–20", 50, 109), slot("normal", "n3b", "Round 3", "Car 7", "Battle 21")] },
  ],
  super: [
    { label: "Round 1", battles: "Battles 1–7", slots: [slot("super", "s1a", "Round 1", "Cars 1–6", "Battles 1–6", 110, 159), slot("super", "s1b", "Round 1", "Car 7", "Battle 7", 160, 179)] },
    { label: "Round 2", battles: "Battles 8–14", slots: [slot("super", "s2a", "Round 2", "Cars 1–6", "Battles 8–13", 140, 179), slot("super", "s2b", "Round 2", "Car 7", "Battle 14", 180, 199)] },
    { label: "Round 3", battles: "Battles 15–21", slots: [slot("super", "s3a", "Round 3", "Cars 1–6", "Battles 15–20", 160, 199), slot("super", "s3b", "Round 3", "Car 7", "Battle 21", 200, 219)] },
    { label: "Round 4", battles: "Battles 22–28", slots: [slot("super", "s4a", "Round 4", "Cars 1–6", "Battles 22–27", 180, 219), slot("super", "s4b", "Round 4", "Car 7", "Battle 28", 220, 239)] },
    { label: "Rounds 5–6", battles: "Battles 29–42", slots: [slot("super", "s5a", "Rounds 5–6", "All cars", "Battles 29–42", 200, 299)] },
    { label: "Round 7", battles: "Battles 43–49", slots: [slot("super", "s7a", "Round 7", "Cars 1–6", "Battles 43–48", 200, 299), slot("super", "s7b", "Round 7", "Car 7", "Battle 49")] },
    { label: "Round 8 onward", battles: "Battle 50 and up", slots: [slot("super", "s8a", "Round 8 onward", "All cars", "Battle 50 and up", 200, 299)] },
  ],
};

export function subwaySlot(key: string): SubwaySlot | undefined {
  for (const rounds of Object.values(SUBWAY_ROUNDS)) {
    for (const round of rounds) {
      const found = round.slots.find((entry) => entry.key === key);
      if (found) return found;
    }
  }
  return undefined;
}

export type SubwayBoss = { id: number; name: string; train: SubwayTrainId };

/** Ingo and Emmet's teams (func_ov033_0217c11c). Multi trains face both at once. */
export const SUBWAY_BOSSES: SubwayBoss[] = [
  { id: 306, name: "Ingo", train: "single" },
  { id: 307, name: "Ingo", train: "superSingle" },
  { id: 308, name: "Emmet", train: "double" },
  { id: 309, name: "Emmet", train: "superDouble" },
  { id: 310, name: "Ingo", train: "multi" },
  { id: 311, name: "Emmet", train: "multi" },
  { id: 312, name: "Ingo", train: "superMulti" },
  { id: 313, name: "Emmet", train: "superMulti" },
];

/** Multi Train partners: #300–302 team up with a female player, #303–305 with a male player; one per team choice. */
export function subwayPartnerLabel(id: number): string {
  const offset = id - SUBWAY_FIRST_PARTNER;
  return `Partner of a ${offset < 3 ? "female" : "male"} player · team choice ${(offset % 3) + 1}`;
}

/** The IVs the game gives a trainer's Pokémon (BtlInst_GetTrainerIV; partners use the same steps). */
export function subwayTrainerIv(id: number): number {
  if (id < 50) return 3;
  if (id < 70) return 6;
  if (id < 90) return 9;
  if (id < 110) return 12;
  if (id < 160) return 15;
  if (id < 180) return 18;
  if (id < 200) return 21;
  return 31;
}

export type SubwayRole = "regular" | "partner" | "boss";

export type SubwayTrainer = {
  id: number;
  name: string;
  trainerClass: number;
  className: string;
  setIds: number[];
  /** u16 values after the set list, kept as they are. */
  extra: number[];
  iv: number;
  role: SubwayRole;
  /** Slots whose range includes this trainer. */
  slots: SubwaySlot[];
  boss?: SubwayBoss;
};

export function hasSubwayData(project: ProjectState): boolean {
  return project.session.baseRom === "BW2" && Boolean(project.narcs.subway_trainers && project.narcs.subway_sets);
}

export function getSubwayTrainerCount(project: ProjectState): number {
  return Math.max(0, (project.narcs.subway_trainers?.rawFiles.length ?? 0) - 1);
}

function trainerBytes(project: ProjectState, id: number): Uint8Array {
  const bytes = project.narcs.subway_trainers?.rawFiles[id + 1];
  if (!bytes) throw new Error(`Battle Subway trainer ${id} doesn't exist`);
  return bytes;
}

export function subwayTrainerName(project: ProjectState, id: number): string {
  const entry = safeBank(project, SUBWAY_NAME_BANK)[id];
  return entry ? cleanDisplayText(entry[1]) : `Trainer ${id}`;
}

export function subwayTrainerQuotes(project: ProjectState, id: number): [string, string, string] {
  const bank = safeBank(project, SUBWAY_QUOTE_BANK);
  return [0, 1, 2].map((offset) => bank[id * 3 + offset]?.[1] ?? "") as [string, string, string];
}

function safeBank(project: ProjectState, bankId: number) {
  try {
    return getTextBank(project, "message_texts", bankId);
  } catch {
    return [];
  }
}

export function getSubwayTrainer(project: ProjectState, id: number): SubwayTrainer {
  const bytes = trainerBytes(project, id);
  const values = Array.from({ length: Math.floor(bytes.length / 2) }, (_unused, index) => readU16(bytes, index * 2));
  const trainerClass = values[0] ?? 0;
  const count = Math.min(values[1] ?? 0, Math.max(0, values.length - 2));
  const role: SubwayRole = id >= SUBWAY_FIRST_BOSS ? "boss" : id >= SUBWAY_FIRST_PARTNER ? "partner" : "regular";
  const slots = Object.values(SUBWAY_ROUNDS).flatMap((rounds) => rounds.flatMap((round) => round.slots)).filter((entry) => entry.min !== undefined && id >= entry.min && id <= entry.max!);
  return {
    id,
    name: subwayTrainerName(project, id),
    trainerClass,
    className: trainerTypeName(project, trainerClass),
    setIds: values.slice(2, 2 + count),
    extra: values.slice(2 + count),
    iv: subwayTrainerIv(id),
    role,
    slots,
    boss: SUBWAY_BOSSES.find((boss) => boss.id === id),
  };
}

export function getSubwayTrainers(project: ProjectState): SubwayTrainer[] {
  const trainers: SubwayTrainer[] = [];
  for (let id = 0; id < getSubwayTrainerCount(project); id += 1) {
    try {
      trainers.push(getSubwayTrainer(project, id));
    } catch {
      // Skip unreadable records; the raw files view still shows them.
    }
  }
  return trainers;
}

export function getSlotTrainers(project: ProjectState, entry: SubwaySlot): SubwayTrainer[] {
  if (entry.min === undefined) return [];
  const last = Math.min(entry.max!, getSubwayTrainerCount(project) - 1);
  const trainers: SubwayTrainer[] = [];
  for (let id = entry.min; id <= last; id += 1) trainers.push(getSubwayTrainer(project, id));
  return trainers;
}

/** Trains a trainer can show up on, from its slots (or its boss / partner role). */
export function subwayTrainsForTrainer(trainer: SubwayTrainer): SubwayTrain[] {
  if (trainer.boss) return [subwayTrain(trainer.boss.train)!];
  if (trainer.role === "partner") return SUBWAY_TRAINS.filter((train) => train.id === "multi" || train.id === "superMulti");
  const series = new Set(trainer.slots.map((entry) => entry.series));
  return SUBWAY_TRAINS.filter((train) => train.series !== "wifi" && series.has(train.series as SubwaySeries));
}

// ---------- Pokémon pools ----------

/** Trainers whose set lists are identical share a pool; the pool is named by its first trainer. */
export type SubwayPool = { key: string; firstTrainer: number; setIds: number[]; trainerIds: number[] };

export function poolKey(setIds: number[]): string {
  return setIds.join(",");
}

export function getSubwayPools(project: ProjectState): SubwayPool[] {
  const pools = new Map<string, SubwayPool>();
  for (const trainer of getSubwayTrainers(project)) {
    const key = poolKey(trainer.setIds);
    const pool = pools.get(key);
    if (pool) pool.trainerIds.push(trainer.id);
    else pools.set(key, { key, firstTrainer: trainer.id, setIds: trainer.setIds, trainerIds: [trainer.id] });
  }
  return [...pools.values()];
}

export function getPoolOfTrainer(project: ProjectState, id: number): SubwayPool {
  const key = poolKey(getSubwayTrainer(project, id).setIds);
  return getSubwayPools(project).find((pool) => pool.key === key)!;
}

/** Every trainer whose list names the set. */
export function getSubwaySetUsers(project: ProjectState, setId: number): number[] {
  return getSubwaySetUsage(project).get(setId) ?? [];
}

/** Set ID → the trainers whose lists name it, built in one pass. */
export function getSubwaySetUsage(project: ProjectState): Map<number, number[]> {
  const usage = new Map<number, number[]>();
  for (const trainer of getSubwayTrainers(project)) {
    for (const setId of new Set(trainer.setIds)) {
      const users = usage.get(setId);
      if (users) users.push(trainer.id);
      else usage.set(setId, [trainer.id]);
    }
  }
  return usage;
}

export function getSubwaySetCount(project: ProjectState): number {
  return project.narcs.subway_sets?.rawFiles.length ?? 0;
}

export function getSubwaySet(project: ProjectState, setId: number): BattleFacilitySet {
  return getFacilitySetRecord(project, "subway_sets", setId);
}

/** Set IDs (1 up) no trainer lists. */
export function getUnusedSubwaySets(project: ProjectState): number[] {
  const used = new Set(getSubwayTrainers(project).flatMap((trainer) => trainer.setIds));
  const unused: number[] = [];
  for (let id = 1; id < getSubwaySetCount(project); id += 1) if (!used.has(id)) unused.push(id);
  return unused;
}

/** Distinct species in a list. The game won't repeat a species in a team or reuse one the player brought. */
export function distinctSpecies(project: ProjectState, setIds: number[]): number {
  const species = new Set<number>();
  for (const id of setIds) {
    try {
      const set = getSubwaySet(project, id);
      if (set.speciesId) species.add(set.speciesId);
    } catch {
      // Missing sets don't count.
    }
  }
  return species.size;
}

/**
 * The fewest distinct species a list needs before the game can freeze looking for a team: the trainer brings
 * `brought` Pokémon, none sharing a species with each other or with the `brought` the player chose.
 */
export function speciesNeeded(trainer: SubwayTrainer): number {
  if (trainer.role === "boss") return 0;
  const brought = Math.max(...subwayTrainsForTrainer(trainer).map((train) => train.brought), 0);
  return brought * 2;
}

// ---------- Edits ----------

export type SubwayTrainerField = "name" | "trainerClass" | "quote_0" | "quote_1" | "quote_2";

export function updateSubwayTrainerField(project: ProjectState, id: number, field: SubwayTrainerField, value: string | number): SubwayTrainer {
  const before = getSubwayTrainer(project, id);
  if (field === "name") {
    const text = String(value).trim();
    if (!text) throw new Error("Name can't be empty");
    updateTextEntry(project, "message_texts", SUBWAY_NAME_BANK, id, text);
    recordFieldChange(project, "subway_trainers", `Battle Subway trainer ${id}`, "name", before.name, text, { key: `subway-trainer:${id}:name` });
  } else if (field.startsWith("quote_")) {
    const which = Number(field.slice("quote_".length));
    const previous = subwayTrainerQuotes(project, id)[which] ?? "";
    updateTextEntry(project, "message_texts", SUBWAY_QUOTE_BANK, id * 3 + which, String(value));
    recordFieldChange(project, "subway_trainers", `Battle Subway ${before.name}`, QUOTE_LABELS[which]!, previous, String(value), { key: `subway-trainer:${id}:${field}` });
  } else if (field === "trainerClass") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 0xffff) throw new Error("Pick a trainer class");
    writeTrainer(project, id, number, before.setIds, before.extra);
    recordFieldChange(project, "subway_trainers", `Battle Subway ${before.name}`, "trainer class", before.className, trainerTypeName(project, number), { key: `subway-trainer:${id}:trainerClass` });
  } else {
    throw new Error(`Unsupported Battle Subway trainer field: ${field}`);
  }
  return getSubwayTrainer(project, id);
}

export const QUOTE_LABELS = ["Before battle", "If it wins", "If it loses"];

function writeTrainer(project: ProjectState, id: number, trainerClass: number, setIds: number[], extra: number[]): void {
  const bytes = new Uint8Array(4 + (setIds.length + extra.length) * 2);
  writeU16(bytes, 0, trainerClass);
  writeU16(bytes, 2, setIds.length);
  [...setIds, ...extra].forEach((value, index) => writeU16(bytes, 4 + index * 2, value));
  setFile(project, "subway_trainers", id + 1, bytes);
}

function checkSetIds(project: ProjectState, setIds: number[]): void {
  const count = getSubwaySetCount(project);
  if (!setIds.length) throw new Error("A trainer needs at least one Pokémon");
  for (const id of setIds) {
    if (!Number.isInteger(id) || id < 1 || id >= count) throw new Error(`Set ${id} isn't in the Battle Subway sets`);
  }
}

/** Replaces one trainer's Pokémon list. */
export function setSubwayTrainerSets(project: ProjectState, id: number, setIds: number[]): SubwayTrainer {
  checkSetIds(project, setIds);
  const trainer = getSubwayTrainer(project, id);
  writeTrainer(project, id, trainer.trainerClass, setIds, trainer.extra);
  recordGenericChange(project, "subway_trainers", `Battle Subway ${trainer.name} now draws from ${setIds.length} set${setIds.length === 1 ? "" : "s"}.`, undefined, { key: `subway-pool:${id}` });
  return getSubwayTrainer(project, id);
}

/** Replaces the list of every trainer in a pool, so they keep sharing it. */
export function setSubwayPoolSets(project: ProjectState, trainerIds: number[], setIds: number[]): void {
  checkSetIds(project, setIds);
  for (const id of trainerIds) {
    const trainer = getSubwayTrainer(project, id);
    writeTrainer(project, id, trainer.trainerClass, setIds, trainer.extra);
  }
  recordGenericChange(project, "subway_trainers", `${trainerIds.length} Battle Subway trainers (#${trainerIds[0]} on) now share a ${setIds.length}-set pool.`, undefined, { key: `subway-pool:${trainerIds.join(",")}` });
}

/**
 * Gives some trainers their own copy of a shared set so editing it stops changing everyone else's.
 * The copy goes on the end of the set archive and replaces the set in those trainers' lists.
 */
export function copySubwaySetFor(project: ProjectState, trainerIds: number[], setId: number): number {
  const copyId = addSubwaySet(project, setId);
  for (const id of trainerIds) {
    const trainer = getSubwayTrainer(project, id);
    writeTrainer(project, id, trainer.trainerClass, trainer.setIds.map((value) => (value === setId ? copyId : value)), trainer.extra);
  }
  recordGenericChange(project, "subway_sets", `Set ${setId} copied to set ${copyId} for ${trainerIds.length === 1 ? subwayTrainerName(project, trainerIds[0]!) : `${trainerIds.length} trainers`}.`, undefined, { key: `subway-copy:${copyId}` });
  return copyId;
}

/** Adds a set to the end of the archive: a copy of another set, or a blank one. Returns its ID. */
export function addSubwaySet(project: ProjectState, copyOf?: number): number {
  const store = project.narcs.subway_sets;
  if (!store) throw new Error("The Battle Subway set archive isn't loaded");
  const id = store.rawFiles.length;
  if (id > 0xffff) throw new Error("The set archive is full");
  const source = copyOf === undefined ? new Uint8Array(SET_LENGTH) : store.rawFiles[copyOf];
  if (!source) throw new Error(`Set ${copyOf} doesn't exist`);
  store.rawFiles.push(Uint8Array.from({ length: SET_LENGTH }, (_unused, index) => source[index] ?? 0));
  store.fileCount = store.rawFiles.length;
  markDirty(project, "subway_sets", id);
  return id;
}

function setFile(project: ProjectState, narc: "subway_trainers" | "subway_sets", id: number, bytes: Uint8Array): void {
  const store = project.narcs[narc];
  if (!store) throw new Error(`NARC is not loaded: ${narc}`);
  store.rawFiles[id] = bytes;
  store.records.delete(id);
  markDirty(project, narc, id);
}
