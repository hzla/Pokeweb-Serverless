import { readU32, writeU32 } from "../nds/binary";
import { recordFieldChange } from "./actionChangelog";
import type { BaseVersion } from "./constants";
import { markDirty, type NarcStore, type ProjectState } from "./projectStore";

export const BW2_TUTOR_MOVE_OVERLAY_ID = 36;
export const W2_TUTOR_MOVE_TABLE_OFFSET = 0x5152c;
export const B2_TUTOR_MOVE_TABLE_OFFSET = 0x51538;
export const BW2_TUTOR_MOVE_ROW_SIZE = 12;
export const BW2_TUTOR_MOVE_ROW_COUNT = 60;
export const BW2_TUTOR_MOVE_TABLE_LENGTH = BW2_TUTOR_MOVE_ROW_SIZE * BW2_TUTOR_MOVE_ROW_COUNT;

export type TutorMoveField = "move" | "shardCost" | "displayIndex";

export type TutorMoveGroupKey = "driftveil" | "lentimas" | "humilau" | "nacrene";

export type TutorMoveGroupDefinition = {
  key: TutorMoveGroupKey;
  label: string;
  shortLabel: string;
  field: "driftveil_tutor" | "lentimas_tutor" | "humilau_tutor" | "nacrene_tutor";
  start: number;
  count: number;
};

export type TutorMoveRow = {
  rowIndex: number;
  offset: number;
  group: TutorMoveGroupKey;
  groupLabel: string;
  groupField: TutorMoveGroupDefinition["field"];
  groupOffset: number;
  moveId: number;
  moveName: string;
  shardCost: number;
  displayIndex: number;
};

export type TutorCompatibilityMove = {
  moveName: string;
  compatibilityIndex: number;
};

export type TutorCompatibilityGroupDefinition = {
  key: "special" | TutorMoveGroupKey;
  label: string;
  shortLabel: string;
  field: "tutors" | TutorMoveGroupDefinition["field"];
  moves: TutorCompatibilityMove[];
};

export const TUTOR_MOVE_GROUPS: readonly TutorMoveGroupDefinition[] = [
  { key: "driftveil", label: "Driftveil Tutor", shortLabel: "DR", field: "driftveil_tutor", start: 13, count: 15 },
  { key: "lentimas", label: "Lentimas Tutor", shortLabel: "LE", field: "lentimas_tutor", start: 43, count: 17 },
  { key: "humilau", label: "Humilau Tutor", shortLabel: "HU", field: "humilau_tutor", start: 0, count: 13 },
  { key: "nacrene", label: "Nacrene Tutor", shortLabel: "NA", field: "nacrene_tutor", start: 28, count: 15 },
] as const;

const SPECIAL_TUTOR_GROUP: TutorCompatibilityGroupDefinition = {
  key: "special",
  label: "Special Tutors",
  shortLabel: "SP",
  field: "tutors",
  moves: ["Grass Pledge", "Fire Pledge", "Water Pledge", "Frenzy Plant", "Blast Burn", "Hydro Cannon", "Draco Meteor"].map((moveName, compatibilityIndex) => ({
    moveName,
    compatibilityIndex,
  })),
};

const FALLBACK_BW2_TUTOR_MOVES: Record<TutorMoveGroupKey, readonly string[]> = {
  driftveil: ["Bug Bite", "Covet", "Super Fang", "Dual Chop", "Signal Beam", "Iron Head", "Seed Bomb", "Drill Run", "Bounce", "Low Kick", "Gunk Shot", "Uproar", "Thunder Punch", "Fire Punch", "Ice Punch"],
  lentimas: ["Magic Coat", "Block", "Earth Power", "Foul Play", "Gravity", "Magnet Rise", "Iron Defense", "Last Resort", "Superpower", "Electroweb", "Icy Wind", "Aqua Tail", "Dark Pulse", "Zen Headbutt", "Dragon Pulse", "Hyper Voice", "Iron Tail"],
  humilau: ["Bind", "Snore", "Knock Off", "Synthesis", "Heat Wave", "Role Play", "Heal Bell", "Tailwind", "Sky Attack", "Pain Split", "Giga Drain", "Drain Punch", "Roost"],
  nacrene: ["Gastro Acid", "Worry Seed", "Spite", "After You", "Helping Hand", "Trick", "Magic Room", "Wonder Room", "Endeavor", "Outrage", "Recycle", "Snatch", "Stealth Rock", "Sleep Talk", "Skill Swap"],
};

export function tutorMoveTableOffset(baseVersion: BaseVersion): number {
  if (baseVersion === "B2") return B2_TUTOR_MOVE_TABLE_OFFSET;
  if (baseVersion === "W2") return W2_TUTOR_MOVE_TABLE_OFFSET;
  throw new Error(`Move tutor table editing is not supported for ${baseVersion}.`);
}

export function createTutorMoveStore(overlay36: Uint8Array, baseVersion: BaseVersion): NarcStore {
  const tableOffset = tutorMoveTableOffset(baseVersion);
  return {
    name: "tutor_moves",
    fileId: -1,
    sourcePath: `overlay${BW2_TUTOR_MOVE_OVERLAY_ID}:tutor_moves`,
    fileCount: 1,
    rawFiles: [overlay36.slice(tableOffset, tableOffset + BW2_TUTOR_MOVE_TABLE_LENGTH)],
    records: new Map(),
    dirty: new Set(),
  };
}

export function ensureTutorMoveStore(project: ProjectState): NarcStore {
  if (project.session.baseRom !== "BW2") throw new Error("Move tutor table editing is currently BW2-only.");
  const existing = project.narcs.tutor_moves;
  if (existing) return existing;
  const overlay = project.overlays[BW2_TUTOR_MOVE_OVERLAY_ID];
  if (!overlay) throw new Error("Tutor move overlay data is not loaded. Reload the ROM with Moves, Tutor Moves, or Grottos selected.");
  const store = createTutorMoveStore(overlay, project.session.baseVersion);
  project.narcs.tutor_moves = store;
  return store;
}

export function getTutorMoveRows(project: ProjectState): TutorMoveRow[] {
  const store = ensureTutorMoveStore(project);
  const bytes = tutorMoveBytes(store);
  return Array.from({ length: BW2_TUTOR_MOVE_ROW_COUNT }, (_unused, rowIndex) => tutorMoveRow(project, bytes, rowIndex));
}

export function updateTutorMoveField(project: ProjectState, rowIndex: number, field: TutorMoveField, inputValue: string | number): TutorMoveRow {
  validateRowIndex(rowIndex);
  const store = ensureTutorMoveStore(project);
  const before = tutorMoveRow(project, tutorMoveBytes(store), rowIndex);
  const bytes = tutorMoveBytes(store).slice();
  const offset = rowIndex * BW2_TUTOR_MOVE_ROW_SIZE;
  let beforeValue: string | number;
  let afterValue: string | number;

  if (field === "move") {
    const moveId = parseMoveId(project, String(inputValue));
    beforeValue = before.moveName;
    writeU32(bytes, offset, moveId);
    afterValue = moveName(project, moveId);
  } else if (field === "shardCost") {
    const shardCost = parseInteger(String(inputValue), 0, 0xffffffff, "Shard cost");
    beforeValue = before.shardCost;
    writeU32(bytes, offset + 4, shardCost);
    afterValue = shardCost;
  } else {
    const group = groupForRow(rowIndex);
    const displayIndex = parseInteger(String(inputValue), 0, Math.max(31, group.count - 1), "Menu order");
    beforeValue = before.displayIndex;
    writeU32(bytes, offset + 8, displayIndex);
    afterValue = displayIndex;
  }

  store.rawFiles[0] = bytes;
  store.records.clear();
  markDirty(project, "tutor_moves", 0);
  const after = tutorMoveRow(project, bytes, rowIndex);
  recordFieldChange(project, "tutor_moves", `${before.groupLabel} row ${before.groupOffset + 1}`, tutorMoveFieldLabel(field), beforeValue, afterValue, {
    key: `tutor-move:${rowIndex}:${field}`,
  });
  return after;
}

export function getTutorMoveCompatibilityGroups(project: ProjectState): TutorCompatibilityGroupDefinition[] {
  if (project.session.baseRom !== "BW2") return [];
  const rows = tryGetTutorMoveRows(project);
  return [
    SPECIAL_TUTOR_GROUP,
    ...TUTOR_MOVE_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      shortLabel: group.shortLabel,
      field: group.field,
      moves: rows ? tutorCompatibilityMovesFromRows(rows, group) : fallbackTutorCompatibilityMoves(group.key),
    })),
  ];
}

export function tutorMoveMatchesSearch(row: TutorMoveRow, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${row.rowIndex} ${row.groupLabel} ${row.groupOffset + 1} ${row.moveId} ${row.moveName} ${row.shardCost} ${row.displayIndex}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function tryGetTutorMoveRows(project: ProjectState): TutorMoveRow[] | undefined {
  try {
    return getTutorMoveRows(project);
  } catch {
    return undefined;
  }
}

function tutorCompatibilityMovesFromRows(rows: TutorMoveRow[], group: TutorMoveGroupDefinition): TutorCompatibilityMove[] {
  return rows
    .filter((row) => row.group === group.key)
    .map((row) => ({ moveName: row.moveName, compatibilityIndex: row.groupOffset }));
}

function fallbackTutorCompatibilityMoves(group: TutorMoveGroupKey): TutorCompatibilityMove[] {
  return FALLBACK_BW2_TUTOR_MOVES[group].map((moveName, compatibilityIndex) => ({ moveName, compatibilityIndex }));
}

function tutorMoveRow(project: ProjectState, bytes: Uint8Array, rowIndex: number): TutorMoveRow {
  validateRowIndex(rowIndex);
  const group = groupForRow(rowIndex);
  const offset = rowIndex * BW2_TUTOR_MOVE_ROW_SIZE;
  const moveId = readU32(bytes, offset);
  return {
    rowIndex,
    offset: tutorMoveTableOffset(project.session.baseVersion) + offset,
    group: group.key,
    groupLabel: group.label,
    groupField: group.field,
    groupOffset: rowIndex - group.start,
    moveId,
    moveName: moveName(project, moveId),
    shardCost: readU32(bytes, offset + 4),
    displayIndex: readU32(bytes, offset + 8),
  };
}

function tutorMoveBytes(store: NarcStore): Uint8Array {
  const current = store.rawFiles[0];
  if (current && current.length >= BW2_TUTOR_MOVE_TABLE_LENGTH) return current;
  const bytes = new Uint8Array(BW2_TUTOR_MOVE_TABLE_LENGTH);
  if (current) bytes.set(current.subarray(0, Math.min(current.length, bytes.length)));
  store.rawFiles[0] = bytes;
  return bytes;
}

function groupForRow(rowIndex: number): TutorMoveGroupDefinition {
  const group = TUTOR_MOVE_GROUPS.find((candidate) => rowIndex >= candidate.start && rowIndex < candidate.start + candidate.count);
  if (!group) throw new Error(`Tutor move row ${rowIndex} does not belong to a known tutor group.`);
  return group;
}

function validateRowIndex(rowIndex: number): void {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= BW2_TUTOR_MOVE_ROW_COUNT) throw new Error(`Tutor move row out of range: ${rowIndex}`);
}

function parseMoveId(project: ProjectState, inputValue: string): number {
  const input = inputValue.trim();
  if (/^\d+$/u.test(input)) {
    const id = Number(input);
    if (Number.isSafeInteger(id) && id >= 0 && id < moveCount(project)) return id;
  }
  const normalized = normalizeName(input);
  const index = (project.texts.banks.moves ?? []).findIndex((name) => normalizeName(name) === normalized);
  if (index >= 0) return index;
  throw new Error(`Unknown move: ${inputValue}`);
}

function moveName(project: ProjectState, moveId: number): string {
  return project.texts.banks.moves?.[moveId] ?? `Move ${moveId}`;
}

function moveCount(project: ProjectState): number {
  return Math.max(project.narcs.moves?.fileCount ?? 0, project.texts.banks.moves?.length ?? 0, 1);
}

function parseInteger(inputValue: string, min: number, max: number, label: string): number {
  const value = Number(inputValue.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

function tutorMoveFieldLabel(field: TutorMoveField): string {
  if (field === "move") return "Move";
  if (field === "shardCost") return "Shard cost";
  return "Menu order";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
