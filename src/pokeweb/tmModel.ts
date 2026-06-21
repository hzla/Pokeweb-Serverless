import { readU16, writeU16 } from "../nds/binary";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
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

const TM_OFFSETS: Partial<Record<BaseVersion, number>> = {
  B: 0x9aaa0,
  W: 0x9aab8,
  B2: 0x8cc84,
  W2: 0x8ccb0,
};

const TM_COUNT_BEFORE_HMS = 92;
const HM_ANCHOR_MOVE_IDS = [15, 19, 57, 70, 127, 291] as const;
const TM_TABLE_NEARBY_SEARCH_RADIUS = 0x400;

const ITEM_GRAPHICS_ENTRY_SIZE = 4;
const ITEM_GRAPHICS_ANCHOR: Array<readonly [number, number]> = [
  [2, 3],
  [4, 5],
  [6, 7],
  [8, 9],
  [10, 11],
  [12, 13],
  [14, 15],
  [16, 17],
  [18, 19],
  [20, 19],
  [21, 22],
  [23, 22],
];

// Palette file indexes from Clean White's item icon archive/source item table.
const TM_TYPE_PALETTES: Partial<Record<string, number>> = {
  Normal: 402,
  Fighting: 398,
  Flying: 413,
  Poison: 403,
  Ground: 410,
  Rock: 412,
  Bug: 610,
  Ghost: 411,
  Steel: 408,
  Fire: 406,
  Water: 400,
  Grass: 405,
  Electric: 409,
  Psychic: 401,
  Ice: 404,
  Dragon: 399,
  Dark: 407,
};

export const TM_FIELDS = [
  ...Array.from({ length: 92 }, (_, index) => `tm_${index + 1}`),
  ...Array.from({ length: 6 }, (_, index) => `hm_${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `tm_${index + 93}`),
] as const;

export function parseTms(project: ProjectState): TmState {
  const offset = locateTmTableOffset(project);
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

function locateTmTableOffset(project: ProjectState): number {
  const fallbackOffset = TM_OFFSETS[project.session.baseVersion];
  if (fallbackOffset === undefined) throw new Error(`TM table offsets are not implemented for ${project.session.baseVersion}.`);
  const maxMoveId = Math.max(project.texts.banks.moves?.length ?? 0, project.narcs.moves?.fileCount ?? 0) - 1;
  const nearbyOffset = locateTmTableOffsetFromHmAnchor(project.arm9, fallbackOffset, TM_TABLE_NEARBY_SEARCH_RADIUS, maxMoveId);
  if (nearbyOffset !== undefined) return nearbyOffset;
  const globalOffset = locateTmTableOffsetFromHmAnchor(project.arm9, undefined, undefined, maxMoveId);
  return globalOffset ?? fallbackOffset;
}

function locateTmTableOffsetFromHmAnchor(arm9: Uint8Array, expectedOffset?: number, radius?: number, maxMoveId?: number): number | undefined {
  const tableLength = TM_FIELDS.length * 2;
  const hmAnchorLength = HM_ANCHOR_MOVE_IDS.length * 2;
  const expectedHmOffset = expectedOffset === undefined ? undefined : expectedOffset + TM_COUNT_BEFORE_HMS * 2;
  const start = expectedHmOffset === undefined || radius === undefined ? 0 : Math.max(0, expectedHmOffset - radius);
  const end = expectedHmOffset === undefined || radius === undefined
    ? arm9.length - hmAnchorLength
    : Math.min(arm9.length - hmAnchorLength, expectedHmOffset + radius);
  const candidates: Array<{ offset: number; matches: number; distance: number }> = [];

  for (let hmOffset = start + (start % 2); hmOffset <= end; hmOffset += 2) {
    const tableOffset = hmOffset - TM_COUNT_BEFORE_HMS * 2;
    if (tableOffset < 0 || tableOffset + tableLength > arm9.length) continue;

    const matches = countHmAnchorMatches(arm9, hmOffset);
    if (matches < HM_ANCHOR_MOVE_IDS.length) continue;
    if (!tmTableValuesArePlausible(arm9, tableOffset, maxMoveId)) continue;

    candidates.push({
      offset: tableOffset,
      matches,
      distance: expectedOffset === undefined ? tableOffset : Math.abs(tableOffset - expectedOffset),
    });
  }

  candidates.sort((a, b) => b.matches - a.matches || a.distance - b.distance || a.offset - b.offset);
  return candidates[0]?.offset;
}

function countHmAnchorMatches(arm9: Uint8Array, hmOffset: number): number {
  let matches = 0;
  HM_ANCHOR_MOVE_IDS.forEach((moveId, index) => {
    if (readU16(arm9, hmOffset + index * 2) === moveId) matches += 1;
  });
  return matches;
}

function tmTableValuesArePlausible(arm9: Uint8Array, offset: number, maxMoveId?: number): boolean {
  if (maxMoveId === undefined || maxMoveId <= 0) return true;
  if (maxMoveId < Math.max(...HM_ANCHOR_MOVE_IDS)) return true;
  let invalid = 0;
  for (let index = 0; index < TM_FIELDS.length; index += 1) {
    const moveId = readU16(arm9, offset + index * 2);
    if (moveId <= 0 || moveId > maxMoveId) invalid += 1;
  }
  return invalid <= 2;
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
  const before = state.readable[field];
  const rawValue = findMoveId(project, inputValue.trim());
  state.raw[field] = rawValue;
  state.readable[field] = moveName(project, rawValue);
  state.dirty = true;
  const index = TM_FIELDS.indexOf(field as (typeof TM_FIELDS)[number]);
  writeU16(project.arm9, state.offset + index * 2, rawValue);
  try {
    syncTmIcon(project, field);
  } catch {
    // The explicit Sync Icons button reports table-location errors; TM edits should still apply.
  }
  recordFieldChange(project, "tms", "TM/HM Table", field.toUpperCase(), before, state.readable[field], { key: `tm:${field}` });
  return { value: titleize(String(state.readable[field])), rawValue };
}

export function syncAllTmIcons(project: ProjectState): number {
  ensureTms(project);
  return TM_FIELDS.reduce((count, field) => count + (syncTmIcon(project, field) ? 1 : 0), 0);
}

export function syncTmIcon(project: ProjectState, field: string): boolean {
  if (!TM_FIELDS.includes(field as (typeof TM_FIELDS)[number])) throw new Error(`Unsupported TM field: ${field}`);
  const state = ensureTms(project);
  const itemId = tmFieldItemId(field);
  if (itemId === undefined) return false;
  const tableOffset = locateItemGraphicsTable(project.arm9);
  if (tableOffset === undefined) throw new Error("Unable to locate the item icon graphics table in ARM9");

  const moveId = Number(state.raw[field] ?? 0);
  const move = getMoveRecord(project, moveId);
  const type = titleize(String(move.readable.type ?? ""));
  const paletteId = TM_TYPE_PALETTES[type];
  if (paletteId === undefined) return false;

  const paletteOffset = tableOffset + itemId * ITEM_GRAPHICS_ENTRY_SIZE + 2;
  if (paletteOffset + 2 > project.arm9.length) throw new Error(`TM item icon entry is outside ARM9: item ${itemId}`);
  if (readU16(project.arm9, paletteOffset) === paletteId) return false;
  writeU16(project.arm9, paletteOffset, paletteId);
  project.arm9Dirty = true;
  recordGenericChange(project, "tms", `${field.toUpperCase()} icon palette synced.`, "TM/HM Table", { key: `tm-icon:${field}` });
  return true;
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

function tmFieldItemId(field: string): number | undefined {
  const tm = /^tm_(\d+)$/u.exec(field);
  if (tm) {
    const number = Number(tm[1]);
    if (number >= 1 && number <= 92) return 327 + number;
    if (number >= 93 && number <= 95) return 525 + number;
    return undefined;
  }
  const hm = /^hm_(\d+)$/u.exec(field);
  if (hm) {
    const number = Number(hm[1]);
    if (number >= 1 && number <= 6) return 419 + number;
  }
  return undefined;
}

function locateItemGraphicsTable(arm9: Uint8Array): number | undefined {
  const anchor = encodeItemGraphicsAnchor();
  for (let offset = 0; offset + anchor.length <= arm9.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < anchor.length; index += 1) {
      if (arm9[offset + index] !== anchor[index]) {
        matches = false;
        break;
      }
    }
    if (matches && offset >= ITEM_GRAPHICS_ENTRY_SIZE) return offset - ITEM_GRAPHICS_ENTRY_SIZE;
  }
  return undefined;
}

function encodeItemGraphicsAnchor(): Uint8Array {
  const out = new Uint8Array(ITEM_GRAPHICS_ANCHOR.length * ITEM_GRAPHICS_ENTRY_SIZE);
  ITEM_GRAPHICS_ANCHOR.forEach(([cgx, pal], index) => {
    writeU16(out, index * ITEM_GRAPHICS_ENTRY_SIZE, cgx);
    writeU16(out, index * ITEM_GRAPHICS_ENTRY_SIZE + 2, pal);
  });
  return out;
}

function searchTerms(searchText: string): string[] {
  return searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}
