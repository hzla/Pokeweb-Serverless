import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import type { NarcName } from "./constants";
import { getFacilitySetRecord, type BattleFacilitySet, type FacilitySetNarcName } from "./battleFacilityModel";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, markDirty, type ProjectState } from "./projectStore";
import { cleanDisplayText } from "./text";
import { getTextBank, updateTextEntry } from "./textModel";

/**
 * The Pokémon World Tournament, laid out the way players think about it: tournaments that pick trainers,
 * and trainers that bring teams.
 *
 * In the ROM (see pokebw2 wbt_makematch.c, wbt_battle.c, wbt_tool.c and scrcmd_ochiba.c):
 * - a/2/4/7 is one table of 16-byte trainer rows. A row's flags say which tournaments take the trainer.
 *   The trainer's name is the same line of message bank 409.
 * - Each tournament draws teams from one of three pools. A pool is three archives: lead Pokémon (one set
 *   the trainer always brings when its row asks for it), rosters (the sets the rest are picked from) and
 *   the sets themselves. Lead and roster files are read at row + 1; file 0 is a placeholder.
 * - a/2/5/7 holds the Rental tournaments' rental Pokémon.
 */

export type PwtPoolId = "regular" | "leaders" | "masters";

export type PwtPool = {
  id: PwtPoolId;
  label: string;
  leads: NarcName;
  rosters: NarcName;
  sets: FacilitySetNarcName;
};

export const PWT_POOLS: Record<PwtPoolId, PwtPool> = {
  regular: { id: "regular", label: "Regular", leads: "pwt_regular_leads", rosters: "pwt_regular_rosters", sets: "pwt_sets_0" },
  leaders: { id: "leaders", label: "Leaders", leads: "pwt_map_1", rosters: "pwt_map_2", sets: "pwt_sets_3" },
  masters: { id: "masters", label: "Masters", leads: "pwt_tr1", rosters: "pwt_tr6", sets: "pwt_sets_6" },
};
export const PWT_POOL_ORDER: PwtPoolId[] = ["regular", "leaders", "masters"];
export const PWT_RENTAL_SETS: FacilitySetNarcName = "pwt_sets_7";

const PWT_ARCHIVE_PATHS: Partial<Record<NarcName, string>> = {
  pwt_trainer_table: "a/2/4/7",
  pwt_regular_leads: "a/2/4/8",
  pwt_regular_rosters: "a/2/4/9",
  pwt_sets_0: "a/2/5/0",
  pwt_map_1: "a/2/5/1",
  pwt_map_2: "a/2/5/2",
  pwt_sets_3: "a/2/5/3",
  pwt_tr1: "a/2/5/4",
  pwt_tr6: "a/2/5/5",
  pwt_sets_6: "a/2/5/6",
  pwt_sets_7: "a/2/5/7",
};

export const PWT_NAME_BANK = 409;
const TRAINER_ROW_LENGTH = 16;
export const TYPE_ANY = 17;
export const TYPE_NONE = 0xff;
export const PWT_TYPE_NAMES = ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark"];

/** Membership flags in byte 5 of a trainer row, by tournament number. */
const FLAG_BITS: Record<number, number> = { 11: 0, 4: 1, 10: 2, 12: 3, 14: 4, 13: 5, 15: 6 };
/** Tournaments that take exactly the trainers whose row names them (byte 6). */
export const EXCLUSIVE_TOURNAMENTS = [1, 5, 6, 7, 8, 9];

export type PwtCounter = "left" | "right";

export type PwtTournament = {
  id: number;
  name: string;
  counter: PwtCounter;
  pool: PwtPoolId;
  level: number;
  /** Battle Points for a win, by Single, Double, Triple, Rotation. */
  battlePoints: [number, number, number, number];
  unlock: string;
  /** How the tournament picks trainers, for the rules strip. */
  membership: "flag" | "exclusive" | "type" | "download";
  /** Regulation numbers (arc 106) by battle style. */
  regulations: number[];
  note?: string;
};

const SINGLE_REGULATIONS = [29, 30, 31, 32];
const DOUBLE_REGULATIONS = [33, 34, 35, 36];

// From PWT_TOURNAMENT_INFO (overlay 36) and WbtTournament_IsOpenByCounts. The pool and rewards live in code,
// so the editor shows them but doesn't change them.
export const PWT_TOURNAMENTS: PwtTournament[] = [
  { id: 4, name: "Driftveil", counter: "left", pool: "regular", level: 25, battlePoints: [1, 1, 2, 2], unlock: "After winning the first Driftveil tournament", membership: "flag", regulations: SINGLE_REGULATIONS },
  { id: 11, name: "Driftveil (first visit)", counter: "left", pool: "regular", level: 25, battlePoints: [1, 0, 0, 0], unlock: "Until the player wins Driftveil once", membership: "flag", regulations: [37], note: "The story tournament: single battles only." },
  { id: 12, name: "Rental", counter: "left", pool: "regular", level: 50, battlePoints: [1, 1, 2, 2], unlock: "Win Driftveil", membership: "flag", regulations: DOUBLE_REGULATIONS },
  { id: 14, name: "Mix", counter: "left", pool: "regular", level: 50, battlePoints: [1, 1, 2, 2], unlock: "Win Driftveil", membership: "flag", regulations: SINGLE_REGULATIONS },
  { id: 3, name: "Download", counter: "left", pool: "regular", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Driftveil", membership: "download", regulations: [], note: "Teams come from downloaded tournament data, not the ROM." },
  { id: 5, name: "Unova Leaders", counter: "right", pool: "leaders", level: 50, battlePoints: [1, 1, 2, 2], unlock: "Beat the Champion (event flag 2400)", membership: "exclusive", regulations: SINGLE_REGULATIONS },
  { id: 6, name: "Kanto Leaders", counter: "right", pool: "leaders", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Unova Leaders", membership: "exclusive", regulations: DOUBLE_REGULATIONS },
  { id: 7, name: "Johto Leaders", counter: "right", pool: "leaders", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Unova Leaders", membership: "exclusive", regulations: DOUBLE_REGULATIONS },
  { id: 8, name: "Hoenn Leaders", counter: "right", pool: "leaders", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Unova Leaders", membership: "exclusive", regulations: DOUBLE_REGULATIONS },
  { id: 9, name: "Sinnoh Leaders", counter: "right", pool: "leaders", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Unova Leaders", membership: "exclusive", regulations: DOUBLE_REGULATIONS },
  { id: 10, name: "World Leaders", counter: "right", pool: "masters", level: 50, battlePoints: [0, 0, 0, 0], unlock: "Win all five Leaders tournaments", membership: "flag", regulations: DOUBLE_REGULATIONS },
  { id: 1, name: "Champions", counter: "right", pool: "masters", level: 50, battlePoints: [0, 0, 0, 0], unlock: "Win World Leaders 10 times", membership: "exclusive", regulations: DOUBLE_REGULATIONS, note: "Takes the first seven trainers of the table that name it." },
  { id: 13, name: "Rental Master", counter: "right", pool: "masters", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Rental and all Leaders tournaments", membership: "flag", regulations: DOUBLE_REGULATIONS },
  { id: 15, name: "Mix Master", counter: "right", pool: "masters", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win Mix and all Leaders tournaments", membership: "flag", regulations: DOUBLE_REGULATIONS },
  { id: 2, name: "Type Expert", counter: "right", pool: "masters", level: 50, battlePoints: [2, 2, 3, 3], unlock: "Win all five Leaders tournaments", membership: "type", regulations: DOUBLE_REGULATIONS, note: "One tournament per type. Takes trainers of that type, plus trainers set to any type." },
];

export const PWT_STYLES = [
  { name: "Single", brought: 3 },
  { name: "Double", brought: 4 },
  { name: "Triple", brought: 6 },
  { name: "Rotation", brought: 4 },
];

export function pwtTournament(id: number): PwtTournament | undefined {
  return PWT_TOURNAMENTS.find((tournament) => tournament.id === id);
}

export type PwtTrainer = {
  index: number;
  name: string;
  /** The type the trainer's team is themed on (byte 0). */
  type: number;
  gender: number;
  objCode: number;
  trainerClass: number;
  flags: number;
  /** Byte 6: the one of Champions/Unova/Kanto/Johto/Hoenn/Sinnoh Leaders that takes the trainer, or 0. */
  exclusive: number;
  expertType: number;
  rank: number;
  rankExtra: number;
  unk9: number;
  bgm: number;
  winBgm: number;
  /** Bytes 14–15: non-zero means the trainer always brings its lead Pokémon. */
  leadFlag: number;
  hasLead: boolean;
  tournaments: number[];
};

export type PwtTeam = {
  pool: PwtPoolId;
  trainerIndex: number;
  /** The team exists in the archives (rows past the end have none). */
  exists: boolean;
  leadSetId?: number;
  setIds: number[];
  header: number;
};

const ARCHIVES_TO_LOAD: NarcName[] = ["pwt_trainer_table", "pwt_regular_leads", "pwt_regular_rosters", "pwt_sets_0", "pwt_map_1", "pwt_map_2", "pwt_sets_3", "pwt_tr1", "pwt_tr6", "pwt_sets_6", "pwt_sets_7"];

export function hasPwtData(project: ProjectState): boolean {
  return project.session.baseRom === "BW2";
}

export function missingPwtArchives(project: ProjectState): NarcName[] {
  return ARCHIVES_TO_LOAD.filter((name) => !project.narcs[name]);
}

/** Projects opened before these archives were part of the editor get them from the ROM on first use. */
export async function ensurePwtArchives(project: ProjectState): Promise<void> {
  const missing = missingPwtArchives(project);
  if (!missing.length) return;
  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) throw new Error("Reload the ROM to open the World Tournament editor.");
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  for (const name of missing) {
    const path = PWT_ARCHIVE_PATHS[name];
    if (!path) continue;
    const fileId = rom.fileId(path);
    const narc = new NARC(rom.files[fileId]);
    narc.files = narc.files.map((file) => file.slice());
    project.narcs[name] = createNarcStore(name, path, fileId, narc);
    project.session.fileIds[name] = fileId;
  }
}

// ---------- Trainers ----------

function tableBytes(project: ProjectState): Uint8Array {
  const store = project.narcs.pwt_trainer_table;
  if (!store?.rawFiles[0]) throw new Error("The PWT trainer table (a/2/4/7) is not loaded.");
  return store.rawFiles[0];
}

export function getPwtTrainerCount(project: ProjectState): number {
  return Math.floor(tableBytes(project).length / TRAINER_ROW_LENGTH);
}

export function pwtTrainerName(project: ProjectState, index: number): string {
  let name = "";
  try {
    const entry = getTextBank(project, "message_texts", PWT_NAME_BANK)[index];
    name = entry ? cleanDisplayText(entry[1]).trim() : "";
  } catch {
    // Without the message archive, rows are named by number.
  }
  return name || `Trainer ${index}`;
}

export function getPwtTrainer(project: ProjectState, index: number): PwtTrainer {
  const bytes = tableBytes(project);
  const at = index * TRAINER_ROW_LENGTH;
  if (index < 0 || at + TRAINER_ROW_LENGTH > bytes.length) throw new Error(`PWT trainer ${index} does not exist`);
  const flags = bytes[at + 5]!;
  const exclusive = bytes[at + 6]!;
  const expertType = bytes[at + 7]!;
  const leadFlag = readU16(bytes, at + 14);
  const trainer: PwtTrainer = {
    index,
    name: pwtTrainerName(project, index),
    type: bytes[at]!,
    gender: bytes[at + 1]!,
    objCode: readU16(bytes, at + 2),
    trainerClass: bytes[at + 4]!,
    flags,
    exclusive,
    expertType,
    rank: bytes[at + 8]! & 0x7,
    rankExtra: bytes[at + 8]! >> 3,
    unk9: bytes[at + 9]!,
    bgm: readU16(bytes, at + 10),
    winBgm: readU16(bytes, at + 12),
    leadFlag,
    hasLead: leadFlag !== 0,
    tournaments: [],
  };
  trainer.tournaments = PWT_TOURNAMENTS.filter((tournament) => tournament.membership !== "download" && trainerInTournament(trainer, tournament.id)).map((tournament) => tournament.id);
  return trainer;
}

export function getPwtTrainers(project: ProjectState): PwtTrainer[] {
  return Array.from({ length: getPwtTrainerCount(project) }, (_unused, index) => getPwtTrainer(project, index));
}

/** WbtMakeMatch_IsEligible, minus the Type Expert's per-run type. */
export function trainerInTournament(trainer: Pick<PwtTrainer, "flags" | "exclusive" | "expertType">, tournamentId: number, expertType?: number): boolean {
  const bit = FLAG_BITS[tournamentId];
  if (bit !== undefined) return (trainer.flags & (1 << bit)) !== 0;
  if (EXCLUSIVE_TOURNAMENTS.includes(tournamentId)) return trainer.exclusive === tournamentId;
  if (tournamentId === 2) {
    if (trainer.expertType === TYPE_ANY) return true;
    if (expertType === undefined) return trainer.expertType < PWT_TYPE_NAMES.length;
    return trainer.expertType === expertType;
  }
  return false;
}

export function getTournamentTrainers(project: ProjectState, tournamentId: number, expertType?: number): PwtTrainer[] {
  const trainers = getPwtTrainers(project).filter((trainer) => trainerInTournament(trainer, tournamentId, expertType));
  // Champions takes the first seven of the table that name it.
  return tournamentId === 1 ? trainers.slice(0, 7) : trainers;
}

export function poolsForTrainer(trainer: PwtTrainer): PwtPoolId[] {
  const pools = new Set(trainer.tournaments.map((id) => pwtTournament(id)!.pool));
  return PWT_POOL_ORDER.filter((pool) => pools.has(pool));
}

/**
 * Classes 0 and 1 are the player characters (Nate, Rosa). The vanilla table gives class 0 to its 50 rank-1
 * background entrants (Ted to Larry), who fill brackets and only ever battle other NPCs; the game shows them
 * by their overworld model, and a battle would use the player's sprite.
 */
export function usesPlayerBattleClass(trainer: Pick<PwtTrainer, "trainerClass">): boolean {
  return trainer.trainerClass <= 1;
}

/** Rank-1 trainers are picked last, after the three opponents the player meets, so they only fill the bracket. */
export function isBackgroundEntrant(trainer: Pick<PwtTrainer, "rank">): boolean {
  return trainer.rank <= 1;
}

// BtlInst_GetTrainerClassObjCode's table (ov012 fld_btl_inst_tool.c): the overworld model the game gives a
// trainer class, as [class, objCode]. Read backwards, it names the battle class that matches a model.
const CLASS_OBJ_CODES: ReadonlyArray<readonly [number, number]> = [
  [0x02, 0x0b], [0x03, 0x0f], [0x04, 0x0c], [0x05, 0x10], [0x29, 0x0d], [0x2a, 0x11], [0x0f, 0x99], [0x0e, 0x9a],
  [0x1b, 0x30], [0x1c, 0x31], [0x08, 0x2a], [0x09, 0x2b], [0x3b, 0x18], [0x3c, 0x1a], [0x3d, 0x32], [0x3e, 0x33],
  [0x5a, 0x26], [0x5b, 0x27], [0x4c, 0x2c], [0x4b, 0x2d], [0x11, 0x22], [0x12, 0x23], [0x34, 0x49], [0x2e, 0x4a],
  [0x23, 0xb7], [0x24, 0xb8], [0x33, 0x2e], [0x40, 0x2f], [0x18, 0x24], [0x19, 0x25], [0x32, 0x1e], [0x31, 0x1f],
  [0x46, 0x20], [0x47, 0x21], [0x1d, 0x3f], [0x4a, 0x40], [0x2c, 0x43], [0x1a, 0x9b], [0x20, 0x36], [0x21, 0x1c],
  [0x56, 0x48], [0x39, 0x3d], [0x48, 0x3e], [0x3a, 0x45], [0x53, 0x44], [0x2b, 0x47], [0x42, 0x34], [0x43, 0x34],
  [0x41, 0x54], [0x22, 0x42], [0x0d, 0x17], [0x57, 0x41], [0x30, 0x35],
];

/** The trainer class whose overworld model is objCode, if the game pairs one with it. */
export function battleClassForObjCode(objCode: number): number | undefined {
  return CLASS_OBJ_CODES.find(([, obj]) => obj === objCode)?.[0];
}

/** The overworld model the game gives a battle trainer class, if its table has one. */
export function objCodeForBattleClass(trainerClass: number): number | undefined {
  return CLASS_OBJ_CODES.find(([cls]) => cls === trainerClass)?.[1];
}

export type PwtTrainerField = "name" | "type" | "gender" | "objCode" | "trainerClass" | "exclusive" | "expertType" | "rank" | "hasLead" | "bgm" | "winBgm" | `tournament_${number}`;

/** Edits one trainer row (or its name) and records the change. */
export function updatePwtTrainerField(project: ProjectState, index: number, field: PwtTrainerField, value: string | number | boolean): PwtTrainer {
  const before = getPwtTrainer(project, index);
  if (field === "name") {
    const text = String(value).trim();
    if (!text) throw new Error("Name can't be empty");
    updateTextEntry(project, "message_texts", PWT_NAME_BANK, index, text);
    recordFieldChange(project, "pwt_trainer_table", `PWT trainer ${index}`, "name", before.name, text, { key: `pwt-trainer:${index}:name` });
    return getPwtTrainer(project, index);
  }
  const bytes = tableBytes(project).slice();
  const at = index * TRAINER_ROW_LENGTH;
  const int = (min: number, max: number) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Enter a whole number from ${min} to ${max}`);
    return number;
  };
  let label: string = field;
  let beforeValue: string | number | boolean;
  let afterValue: string | number | boolean;
  const tournamentMatch = /^tournament_(\d+)$/u.exec(field);
  if (tournamentMatch) {
    const tournamentId = Number(tournamentMatch[1]);
    const tournament = pwtTournament(tournamentId);
    if (!tournament) throw new Error(`Unknown tournament ${tournamentId}`);
    const on = value === true || value === "true" || value === 1;
    label = `${tournament.name} tournament`;
    beforeValue = trainerInTournament(before, tournamentId);
    afterValue = on;
    const bit = FLAG_BITS[tournamentId];
    if (bit !== undefined) bytes[at + 5] = on ? bytes[at + 5]! | (1 << bit) : bytes[at + 5]! & ~(1 << bit);
    else if (EXCLUSIVE_TOURNAMENTS.includes(tournamentId)) {
      if (on) bytes[at + 6] = tournamentId;
      else if (bytes[at + 6] === tournamentId) bytes[at + 6] = 0;
    } else if (tournamentId === 2) {
      bytes[at + 7] = on ? (before.type < PWT_TYPE_NAMES.length ? before.type : TYPE_ANY) : TYPE_NONE;
    } else throw new Error(`${tournament.name} doesn't take trainers from the table`);
  } else {
    beforeValue = fieldValue(before, field);
    if (field === "type") bytes[at] = int(0, 255);
    else if (field === "gender") bytes[at + 1] = int(0, 1);
    else if (field === "objCode") writeU16(bytes, at + 2, int(0, 65535));
    else if (field === "trainerClass") bytes[at + 4] = int(0, 255);
    else if (field === "exclusive") bytes[at + 6] = int(0, 255);
    else if (field === "expertType") bytes[at + 7] = int(0, 255);
    else if (field === "rank") bytes[at + 8] = (bytes[at + 8]! & ~0x7) | int(0, 7);
    else if (field === "hasLead") writeU16(bytes, at + 14, value === true || value === "true" ? Math.max(1, before.leadFlag) : 0);
    else if (field === "bgm") writeU16(bytes, at + 10, int(0, 65535));
    else if (field === "winBgm") writeU16(bytes, at + 12, int(0, 65535));
    else throw new Error(`Unsupported PWT trainer field: ${field}`);
    afterValue = value;
  }
  setFile(project, "pwt_trainer_table", 0, bytes);
  const after = getPwtTrainer(project, index);
  if (!tournamentMatch) afterValue = fieldValue(after, field);
  recordFieldChange(project, "pwt_trainer_table", `PWT ${before.name}`, label, beforeValue, afterValue, { key: `pwt-trainer:${index}:${field}` });
  return after;
}

function fieldValue(trainer: PwtTrainer, field: PwtTrainerField): string | number | boolean {
  if (field === "hasLead") return trainer.hasLead;
  const value = (trainer as unknown as Record<string, unknown>)[field];
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : "";
}

// ---------- Teams ----------

function u16Values(bytes: Uint8Array): number[] {
  return Array.from({ length: Math.floor(bytes.length / 2) }, (_unused, index) => readU16(bytes, index * 2));
}

function listFile(header: number, ids: number[]): Uint8Array {
  const bytes = new Uint8Array(4 + ids.length * 2);
  writeU16(bytes, 0, header);
  writeU16(bytes, 2, ids.length);
  ids.forEach((id, index) => writeU16(bytes, 4 + index * 2, id));
  return bytes;
}

export function getPwtTeam(project: ProjectState, pool: PwtPoolId, trainerIndex: number): PwtTeam {
  const definition = PWT_POOLS[pool];
  const file = trainerIndex + 1;
  const roster = project.narcs[definition.rosters]?.rawFiles[file];
  const lead = project.narcs[definition.leads]?.rawFiles[file];
  if (!roster || roster.length < 4) return { pool, trainerIndex, exists: false, setIds: [], header: 2 };
  const values = u16Values(roster);
  const count = Math.min(values[1] ?? 0, values.length - 2);
  const leadValues = lead && lead.length >= 6 ? u16Values(lead) : [];
  return {
    pool,
    trainerIndex,
    exists: true,
    header: values[0] ?? 2,
    setIds: values.slice(2, 2 + count),
    leadSetId: leadValues.length >= 3 && (leadValues[1] ?? 0) > 0 ? leadValues[2] : undefined,
  };
}

export function getPwtTeamSets(project: ProjectState, team: PwtTeam): Array<{ id: number; set?: BattleFacilitySet }> {
  const narc = PWT_POOLS[team.pool].sets;
  return team.setIds.map((id) => {
    try {
      return { id, set: getFacilitySetRecord(project, narc, id) };
    } catch {
      return { id };
    }
  });
}

function writeTeam(project: ProjectState, team: PwtTeam, label: string): void {
  const definition = PWT_POOLS[team.pool];
  const file = team.trainerIndex + 1;
  ensureSlots(project, definition.rosters, file);
  ensureSlots(project, definition.leads, file);
  setFile(project, definition.rosters, file, listFile(team.header, team.setIds));
  const leadId = team.leadSetId ?? team.setIds[0] ?? 0;
  setFile(project, definition.leads, file, listFile(team.header, [leadId]));
  recordGenericChange(project, definition.rosters, `${label}.`, undefined, { key: `pwt-team:${team.pool}:${team.trainerIndex}` });
}

function teamLabel(project: ProjectState, pool: PwtPoolId, trainerIndex: number): string {
  return `PWT ${pwtTrainerName(project, trainerIndex)}'s ${PWT_POOLS[pool].label} team`;
}

export function setPwtTeamSets(project: ProjectState, pool: PwtPoolId, trainerIndex: number, setIds: number[]): PwtTeam {
  const setCount = project.narcs[PWT_POOLS[pool].sets]?.rawFiles.length ?? 0;
  for (const id of setIds) {
    if (!Number.isInteger(id) || id < 0 || id >= setCount) throw new Error(`Set ${id} is not in the ${PWT_POOLS[pool].label} pool`);
  }
  const team = getPwtTeam(project, pool, trainerIndex);
  const next = { ...team, exists: true, setIds: [...setIds] };
  if (next.leadSetId !== undefined && !next.setIds.includes(next.leadSetId) && team.setIds.includes(next.leadSetId)) {
    // The lead was removed from the roster: follow it to the new first set.
    next.leadSetId = next.setIds[0];
  }
  writeTeam(project, next, `${teamLabel(project, pool, trainerIndex)} now has ${setIds.length} set${setIds.length === 1 ? "" : "s"}`);
  return getPwtTeam(project, pool, trainerIndex);
}

export function setPwtTeamLead(project: ProjectState, pool: PwtPoolId, trainerIndex: number, setId: number): PwtTeam {
  const team = getPwtTeam(project, pool, trainerIndex);
  if (!team.exists) throw new Error(`${pwtTrainerName(project, trainerIndex)} has no ${PWT_POOLS[pool].label} team`);
  writeTeam(project, { ...team, leadSetId: setId }, `${teamLabel(project, pool, trainerIndex)} leads with set ${setId}`);
  return getPwtTeam(project, pool, trainerIndex);
}

/** Starts a team in a pool, copying another pool's team (its sets are duplicated into this pool) or empty. */
export function createPwtTeam(project: ProjectState, pool: PwtPoolId, trainerIndex: number, copyFrom?: PwtPoolId): PwtTeam {
  let setIds: number[] = [];
  let leadSetId: number | undefined;
  if (copyFrom && copyFrom !== pool) {
    const source = getPwtTeam(project, copyFrom, trainerIndex);
    const mapped = new Map<number, number>();
    const copy = (id: number) => {
      if (!mapped.has(id)) mapped.set(id, appendSet(project, pool, readSet(project, copyFrom, id)));
      return mapped.get(id)!;
    };
    setIds = source.setIds.map(copy);
    if (source.leadSetId !== undefined) leadSetId = copy(source.leadSetId);
  }
  if (!setIds.length) {
    const blank = appendSet(project, pool, new Uint8Array(16));
    setIds = [blank];
  }
  writeTeam(project, { pool, trainerIndex, exists: true, header: 2, setIds, leadSetId: leadSetId ?? setIds[0] }, `${teamLabel(project, pool, trainerIndex)} created${copyFrom ? ` from the ${PWT_POOLS[copyFrom].label} team` : ""}`);
  return getPwtTeam(project, pool, trainerIndex);
}

// ---------- Sets shared between trainers ----------

export type PwtSetUser = { trainerIndex: number; name: string; role: "lead" | "roster"; inTournament: boolean };

/** Every trainer row whose lead or roster in this pool names the set. */
export function getPwtSetUsers(project: ProjectState, pool: PwtPoolId, setId: number): PwtSetUser[] {
  const definition = PWT_POOLS[pool];
  const rosters = project.narcs[definition.rosters]?.rawFiles ?? [];
  const leads = project.narcs[definition.leads]?.rawFiles ?? [];
  const trainerCount = getPwtTrainerCount(project);
  const users: PwtSetUser[] = [];
  for (let trainerIndex = 0; trainerIndex < trainerCount; trainerIndex += 1) {
    const roster = rosters[trainerIndex + 1];
    const lead = leads[trainerIndex + 1];
    const rosterIds = roster ? u16Values(roster).slice(2, 2 + (readU16(roster, 2) || 0)) : [];
    const leadIds = lead && lead.length >= 6 ? [readU16(lead, 4)] : [];
    const role = rosterIds.includes(setId) ? "roster" : leadIds.includes(setId) ? "lead" : undefined;
    if (!role) continue;
    const trainer = getPwtTrainer(project, trainerIndex);
    users.push({ trainerIndex, name: trainer.name, role, inTournament: trainer.tournaments.some((id) => pwtTournament(id)!.pool === pool) });
  }
  return users;
}

/**
 * Gives one trainer its own copy of a shared set, so edits stop affecting the others.
 * The copy goes on the end of the pool's set archive and replaces the set in the trainer's roster and lead.
 */
export function copyPwtSetForTrainer(project: ProjectState, pool: PwtPoolId, trainerIndex: number, setId: number): number {
  const team = getPwtTeam(project, pool, trainerIndex);
  if (!team.exists) throw new Error(`${pwtTrainerName(project, trainerIndex)} has no ${PWT_POOLS[pool].label} team`);
  const copyId = appendSet(project, pool, readSet(project, pool, setId));
  const next: PwtTeam = {
    ...team,
    setIds: team.setIds.map((id) => (id === setId ? copyId : id)),
    leadSetId: team.leadSetId === setId ? copyId : team.leadSetId,
  };
  writeTeam(project, next, `${teamLabel(project, pool, trainerIndex)} got its own copy of set ${setId} (set ${copyId})`);
  return copyId;
}

/** Adds a new set to a pool: a copy of an existing set, or a blank one. Returns its ID. */
export function addPwtSet(project: ProjectState, pool: PwtPoolId, copyOf?: number): number {
  return appendSet(project, pool, copyOf === undefined ? new Uint8Array(16) : readSet(project, pool, copyOf));
}

function readSet(project: ProjectState, pool: PwtPoolId, setId: number): Uint8Array {
  const bytes = project.narcs[PWT_POOLS[pool].sets]?.rawFiles[setId];
  if (!bytes) throw new Error(`Set ${setId} is not in the ${PWT_POOLS[pool].label} pool`);
  return bytes.slice();
}

function appendSet(project: ProjectState, pool: PwtPoolId, bytes: Uint8Array): number {
  const narc = PWT_POOLS[pool].sets;
  const store = project.narcs[narc];
  if (!store) throw new Error(`The ${PWT_POOLS[pool].label} set archive is not loaded`);
  const id = store.rawFiles.length;
  if (id > 0xffff) throw new Error("The set archive is full");
  ensureSlots(project, narc, id);
  setFile(project, narc, id, bytes.length === 16 ? bytes : Uint8Array.from({ length: 16 }, (_unused, index) => bytes[index] ?? 0));
  return id;
}

// ---------- Archive helpers ----------

function ensureSlots(project: ProjectState, narc: NarcName, index: number): void {
  const store = project.narcs[narc];
  if (!store) throw new Error(`NARC is not loaded: ${narc}`);
  while (store.rawFiles.length <= index) {
    const id = store.rawFiles.length;
    // Placeholder rosters/leads point at set 0 like the game's own unused rows.
    store.rawFiles.push(narc === PWT_POOLS.regular.sets || narc === PWT_POOLS.leaders.sets || narc === PWT_POOLS.masters.sets ? new Uint8Array(16) : listFile(0, [0]));
    store.dirty.add(id);
  }
  store.fileCount = store.rawFiles.length;
}

function setFile(project: ProjectState, narc: NarcName, id: number, bytes: Uint8Array): void {
  const store = project.narcs[narc];
  if (!store) throw new Error(`NARC is not loaded: ${narc}`);
  store.rawFiles[id] = bytes;
  store.records.delete(id);
  markDirty(project, narc, id);
}
