import { readU16, writeU16 } from "../nds/binary";
import type { BaseVersion } from "./constants";
import { getMoveRecord, moveMatchesSearch, titleize, type FieldUpdateResult, type MoveRecord } from "./moveItemModel";
import type { ProjectState, RawRecord, ReadableRecord } from "./projectStore";

export type TmKind = "tm" | "hm";

export type TmState = {
  offset: number;
  byteLength: number;
  raw: RawRecord;
  readable: ReadableRecord;
  dirty: boolean;
};

export type TmEntry = {
  kind: TmKind;
  number: number;
  field: string;
  moveId: number;
  moveName: string;
  move?: MoveRecord;
};

const TM_OFFSETS: Record<BaseVersion, number> = {
  B: 0x9aaa0,
  W: 0x9aab8,
  B2: 0x8cc84,
  W2: 0x8ccb0,
};

export const TM_FIELDS = [
  ...Array.from({ length: 92 }, (_, index) => `tm_${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `hm_${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `tm_${index + 93}`),
] as const;

export function parseTms(project: ProjectState): TmState {
  const offset = TM_OFFSETS[project.session.baseVersion];
  const raw: RawRecord = {};
  const readable: ReadableRecord = {};
  TM_FIELDS.forEach((field, index) => {
    raw[field] = readU16(project.arm9, offset + index * 2);
    readable[field] = moveName(project, raw[field]);
  });
  return {
    offset,
    byteLength: TM_FIELDS.length * 2,
    raw,
    readable,
    dirty: false,
  };
}

export function ensureTms(project: ProjectState): TmState {
  project.tms ??= parseTms(project);
  return project.tms;
}

export function getTmEntries(project: ProjectState): TmEntry[] {
  const state = ensureTms(project);
  return [
    ...Array.from({ length: 6 }, (_, index) => tmEntry(project, state, "hm", index + 1)),
    ...Array.from({ length: 95 }, (_, index) => tmEntry(project, state, "tm", index + 1)),
  ];
}

export function getTmNames(project: ProjectState): { tmNames: string[]; hmNames: string[] } {
  const state = ensureTms(project);
  return {
    tmNames: Array.from({ length: 95 }, (_, index) => titleize(String(state.readable[`tm_${index + 1}`] ?? ""))),
    hmNames: Array.from({ length: 6 }, (_, index) => titleize(String(state.readable[`hm_${index + 1}`] ?? ""))),
  };
}

export function updateTmMove(project: ProjectState, field: string, inputValue: string): FieldUpdateResult {
  if (!TM_FIELDS.includes(field as (typeof TM_FIELDS)[number])) throw new Error(`Unsupported TM field: ${field}`);
  const state = ensureTms(project);
  const rawValue = findMoveId(project, inputValue.trim());
  state.raw[field] = rawValue;
  state.readable[field] = moveName(project, rawValue);
  state.dirty = true;
  const index = TM_FIELDS.indexOf(field as (typeof TM_FIELDS)[number]);
  writeU16(project.arm9, state.offset + index * 2, rawValue);
  return { value: titleize(String(state.readable[field])), rawValue };
}

export function tmMatchesSearch(entry: TmEntry, searchText: string, categories: Set<string>, types: Set<string>): boolean {
  if (entry.move) return moveMatchesSearch(entry.move, searchText, categories, types);
  const terms = searchTerms(searchText);
  if (terms.length === 0) return true;
  const haystack = JSON.stringify(entry).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function tmEntry(project: ProjectState, state: TmState, kind: TmKind, number: number): TmEntry {
  const field = `${kind}_${number}`;
  const moveId = state.raw[field] ?? 0;
  const entry: TmEntry = {
    kind,
    number,
    field,
    moveId,
    moveName: titleize(String(state.readable[field] ?? moveName(project, moveId))),
  };
  if (project.narcs.moves && moveId >= 0 && moveId < project.narcs.moves.fileCount) {
    try {
      entry.move = getMoveRecord(project, moveId);
    } catch {
      entry.move = undefined;
    }
  }
  return entry;
}

function moveName(project: ProjectState, moveId: number): string {
  return project.texts.banks.moves?.[moveId] ?? `Move ${moveId}`;
}

function findMoveId(project: ProjectState, input: string): number {
  const moves = project.texts.banks.moves ?? [];
  const index = moves.findIndex((move) => move.toLowerCase() === input.toLowerCase());
  if (index < 0) throw new Error(`Unknown move: ${input}`);
  return index;
}

function searchTerms(searchText: string): string[] {
  return searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}
