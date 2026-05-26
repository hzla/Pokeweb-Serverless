import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";

export const MOVE_EFFECT_HANDLER_COUNT = 258;
export const MOVE_EFFECT_HANDLER_OVERLAY_ID = 167;
export const MOVE_EFFECT_HANDLER_TABLE_LENGTH = MOVE_EFFECT_HANDLER_COUNT * 8;

export type MoveEffectHandlerRow = {
  index: number;
  moveId: number;
  moveName: string;
  address: number;
  addressHex: string;
};

export type MoveEffectHandlerBulkResult = {
  updated: number;
  skipped: string[];
};

export function ensureMoveEffectHandlerStore(project: ProjectState): void {
  if (project.session.baseRom !== "BW2") throw new Error("Move effect handlers are currently BW2-only.");
  if (project.narcs.move_effects_table) return;
  const overlay = project.overlays[MOVE_EFFECT_HANDLER_OVERLAY_ID];
  if (!overlay) throw new Error("Move effect handler overlay data is not loaded. Load the Moves NARC or reload the ROM with Moves selected.");
  const offset = moveEffectHandlerTableOffset(project);
  project.narcs.move_effects_table = {
    name: "move_effects_table",
    fileId: -1,
    sourcePath: "overlay167:move_effects_table",
    fileCount: 1,
    rawFiles: [overlay.slice(offset, offset + MOVE_EFFECT_HANDLER_TABLE_LENGTH)],
    records: new Map(),
    dirty: new Set(),
  };
}

export function getMoveEffectHandlerRows(project: ProjectState): MoveEffectHandlerRow[] {
  const { raw, readable } = handlerRecord(project);
  return Array.from({ length: MOVE_EFFECT_HANDLER_COUNT }, (_, index) => rowFromRecord(project, raw, readable, index));
}

export function updateMoveEffectHandlerMove(project: ProjectState, rowIndex: number, inputValue: string): MoveEffectHandlerRow {
  const { raw, readable } = handlerRecord(project);
  validateRowIndex(rowIndex);
  const field = `move_id_${rowIndex}`;
  const before = readable[field];
  const moveId = parseMoveId(project, inputValue);
  raw[field] = moveId;
  readable[field] = moveName(project, moveId);
  const row = rowFromRecord(project, raw, readable, rowIndex);
  recordFieldChange(project, "move_effects_table", `Handler Row ${rowIndex}`, "Move", before, row.moveName, {
    key: `move-effect-handler:${rowIndex}:move`,
  });
  markDirty(project, "move_effects_table", 0);
  return row;
}

export function updateMoveEffectHandlerAddress(project: ProjectState, rowIndex: number, inputValue: string | number): MoveEffectHandlerRow {
  const { raw, readable } = handlerRecord(project);
  validateRowIndex(rowIndex);
  const field = `address_${rowIndex}`;
  const before = formatAddress(raw[field] ?? 0);
  const address = parseAddress(inputValue);
  raw[field] = address;
  readable[field] = address;
  const row = rowFromRecord(project, raw, readable, rowIndex);
  recordFieldChange(project, "move_effects_table", row.moveName, "Effect Handler Address", before, row.addressHex, {
    key: `move-effect-handler:${rowIndex}:address`,
  });
  markDirty(project, "move_effects_table", 0);
  return row;
}

export function copyMoveEffectHandlerAddress(project: ProjectState, sourceInput: string, targetInput: string): MoveEffectHandlerBulkResult {
  const sourceMoveId = parseMoveId(project, sourceInput);
  const sourceRow = findRowsByMoveId(project, sourceMoveId)[0];
  if (!sourceRow) throw new Error(`No handler row exists for ${moveName(project, sourceMoveId)}.`);
  const targets = parseTargetRows(project, targetInput);
  const skipped: string[] = [];
  let updated = 0;

  for (const row of targets) {
    if (row.index === sourceRow.index) {
      skipped.push(`${row.moveName} is the source move`);
      continue;
    }
    const before = row.address;
    updateMoveEffectHandlerAddress(project, row.index, sourceRow.address);
    if (before !== sourceRow.address) updated += 1;
  }

  recordGenericChange(
    project,
    "move_effects_table",
    `${moveName(project, sourceMoveId)} handler ${sourceRow.addressHex} copied to ${updated} move${updated === 1 ? "" : "s"}.`,
    "Move Effect Handlers",
    { key: `move-effect-handler:copy:${sourceMoveId}:${targets.map((row) => row.index).join(",")}` },
  );
  return { updated, skipped };
}

export function zeroMoveEffectHandlers(project: ProjectState, targetInput: string): MoveEffectHandlerBulkResult {
  const targets = parseTargetRows(project, targetInput);
  let updated = 0;
  for (const row of targets) {
    const before = row.address;
    updateMoveEffectHandlerAddress(project, row.index, 0);
    if (before !== 0) updated += 1;
  }
  recordGenericChange(
    project,
    "move_effects_table",
    `${updated} move effect handler${updated === 1 ? "" : "s"} zeroed.`,
    "Move Effect Handlers",
    { key: `move-effect-handler:zero:${targets.map((row) => row.index).join(",")}` },
  );
  return { updated, skipped: [] };
}

export function moveEffectHandlerMatchesSearch(row: MoveEffectHandlerRow, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${row.index} ${row.moveId} ${row.moveName} ${row.address} ${row.addressHex}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function formatAddress(value: number): string {
  return `0x${(Number(value) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function handlerRecord(project: ProjectState): { raw: RawRecord; readable: ReadableRecord } {
  ensureMoveEffectHandlerStore(project);
  const record = decodeRecord(project, "move_effects_table", 0);
  if (!record.raw || !record.readable) throw new Error("Unable to decode move effect handler table.");
  return { raw: record.raw, readable: record.readable };
}

function rowFromRecord(project: ProjectState, raw: RawRecord, readable: ReadableRecord, index: number): MoveEffectHandlerRow {
  const moveId = raw[`move_id_${index}`] ?? 0;
  const address = raw[`address_${index}`] ?? 0;
  return {
    index,
    moveId,
    moveName: String(readable[`move_id_${index}`] ?? moveName(project, moveId)),
    address,
    addressHex: formatAddress(address),
  };
}

function parseTargetRows(project: ProjectState, inputValue: string): MoveEffectHandlerRow[] {
  const input = inputValue.trim();
  if (!input) throw new Error("Choose at least one target move.");
  const allRows = getMoveEffectHandlerRows(project);
  if (input.toLowerCase() === "all") return allRows;

  const targets = new Map<number, MoveEffectHandlerRow>();
  const missing: string[] = [];
  for (const token of input.split(",").map((part) => part.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/u.exec(token);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let moveId = min; moveId <= max; moveId += 1) addRowsForMove(project, allRows, moveId, targets, missing);
      continue;
    }
    addRowsForMove(project, allRows, parseMoveId(project, token), targets, missing);
  }
  if (missing.length > 0) throw new Error(`No handler row exists for: ${missing.join(", ")}`);
  return [...targets.values()];
}

function addRowsForMove(project: ProjectState, rows: MoveEffectHandlerRow[], moveId: number, targets: Map<number, MoveEffectHandlerRow>, missing: string[]): void {
  const matches = rows.filter((row) => row.moveId === moveId);
  if (matches.length === 0) {
    missing.push(moveName(project, moveId));
    return;
  }
  for (const row of matches) targets.set(row.index, row);
}

function findRowsByMoveId(project: ProjectState, moveId: number): MoveEffectHandlerRow[] {
  return getMoveEffectHandlerRows(project).filter((row) => row.moveId === moveId);
}

function parseAddress(inputValue: string | number): number {
  if (typeof inputValue === "number") {
    if (!Number.isSafeInteger(inputValue) || inputValue < 0 || inputValue > 0xffffffff) throw new Error("Address must be between 0 and 0xFFFFFFFF.");
    return inputValue >>> 0;
  }
  const input = inputValue.trim();
  const hex = /^0x([0-9a-f]+)$/iu.exec(input);
  const decimal = /^\d+$/u.exec(input);
  if (!hex && !decimal) throw new Error("Address must be a decimal number or 0x-prefixed hex value.");
  const value = hex ? Number.parseInt(hex[1], 16) : Number(input);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Address must be between 0 and 0xFFFFFFFF.");
  return value >>> 0;
}

function parseMoveId(project: ProjectState, inputValue: string): number {
  const input = inputValue.trim();
  if (/^\d+$/u.test(input)) {
    const id = Number(input);
    if (Number.isSafeInteger(id) && id >= 0 && id < moveCount(project)) return id;
  }
  const normalized = input.toLowerCase();
  const id = (project.texts.banks.moves ?? []).findIndex((name) => name.toLowerCase() === normalized);
  if (id >= 0) return id;
  throw new Error(`Unknown move: ${inputValue}`);
}

function moveName(project: ProjectState, moveId: number): string {
  return project.texts.banks.moves?.[moveId] ?? `Move ${moveId}`;
}

function moveCount(project: ProjectState): number {
  return Math.max(project.narcs.moves?.fileCount ?? 0, project.texts.banks.moves?.length ?? 0, 1);
}

function validateRowIndex(rowIndex: number): void {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MOVE_EFFECT_HANDLER_COUNT) throw new Error(`Handler row out of range: ${rowIndex}`);
}

function moveEffectHandlerTableOffset(project: ProjectState): number {
  return project.session.fairy ? 0x00040974 : 0x000407f4;
}
