import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { isGen5Project } from "./constants";
import { markDirty, type ProjectState } from "./projectStore";

const EVENT_DATA_END_CODE = 0xfd13;
const TRAINER_SCRIPT_RANGE_SIZE = 2000;
const KNOWN_TRAINER_SCRIPT_FILE_IDS: Partial<Record<string, number>> = {
  BW: 863,
  BW2: 1239,
};

export type TrainerScriptArchiveStatus =
  | {
      ok: false;
      reason: "unsupported" | "missing" | "unrecognized";
      message: string;
    }
  | {
      ok: true;
      scriptFileId: number;
      trainerCount: number;
      tableEntryCount: number;
      normalEntryCount: number;
      helperStart: number;
      helperEnd: number;
      helperTrainerIds: number[];
      missingTrainerIds: number[];
      outOfRangeTrainerIds: number[];
      needsExpansion: boolean;
      canExpand: boolean;
      message: string;
    };

export type TrainerScriptArchiveExpandResult = Extract<TrainerScriptArchiveStatus, { ok: true }> & {
  addedEntries: number;
};

type EventTable = {
  starts: number[];
  tableEndOffset: number;
};

type TrainerScriptCandidate = {
  fileId: number;
  table: EventTable;
  normalStart: number;
  normalEntryCount: number;
  helperStart: number;
  helperEnd: number;
};

export function getTrainerScriptArchiveStatus(project: ProjectState): TrainerScriptArchiveStatus {
  if (!isGen5Project(project)) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Global trainer script expansion is only available for Gen V projects.",
    };
  }

  const scripts = project.narcs.scripts;
  const trdata = project.narcs.trdata;
  if (!scripts || !trdata) {
    return {
      ok: false,
      reason: "missing",
      message: "Load the scripts and trainer data NARCs before expanding global trainer scripts.",
    };
  }

  const candidate = findTrainerScriptCandidate(project);
  if (!candidate) {
    return {
      ok: false,
      reason: "unrecognized",
      message: "Could not identify the global trainer script archive table.",
    };
  }

  return buildStatus(candidate, trdata.fileCount);
}

export function expandTrainerScriptArchive(project: ProjectState): TrainerScriptArchiveExpandResult {
  const status = getTrainerScriptArchiveStatus(project);
  if (!status.ok) throw new Error(status.message);

  const scripts = project.narcs.scripts;
  if (!scripts) throw new Error("Scripts NARC is not loaded.");
  const bytes = scripts.rawFiles[status.scriptFileId];
  if (!bytes) throw new Error(`Trainer script file ${status.scriptFileId} is not loaded.`);

  const targetEntryCount = Math.min(status.trainerCount, TRAINER_SCRIPT_RANGE_SIZE);
  const addedEntries = Math.max(0, targetEntryCount - status.tableEntryCount);
  if (addedEntries > 0) {
    const table = parseEventTable(bytes);
    if (!table) throw new Error("Could not parse the global trainer script table.");
    const normalStart = table.starts[0];
    scripts.rawFiles[status.scriptFileId] = appendTrainerScriptEntries(bytes, table, normalStart, addedEntries);
    scripts.records.delete(status.scriptFileId);
    markDirty(project, "scripts", status.scriptFileId);
    recordGenericChange(
      project,
      "scripts",
      `Expanded global trainer script table ${status.scriptFileId} by ${addedEntries} entr${addedEntries === 1 ? "y" : "ies"}.`,
      "Global Trainer Scripts",
      { key: `trainer-script-archive:${status.scriptFileId}` },
    );
  }

  const nextStatus = getTrainerScriptArchiveStatus(project);
  if (!nextStatus.ok) throw new Error(nextStatus.message);
  return { ...nextStatus, addedEntries };
}

export function formatTrainerScriptArchiveDetail(status: TrainerScriptArchiveStatus): string {
  if (!status.ok) return status.message;
  const parts: string[] = [];
  if (status.needsExpansion) parts.push(`${status.missingTrainerIds.length} missing table entr${status.missingTrainerIds.length === 1 ? "y" : "ies"}`);
  else parts.push("No missing table entries");
  if (status.helperTrainerIds.length) parts.push(`helper slots: ${formatIdList(status.helperTrainerIds)}`);
  if (status.outOfRangeTrainerIds.length) parts.push(`outside 3000/5000 ranges: ${formatIdList(status.outOfRangeTrainerIds)}`);
  return parts.join("; ");
}

function buildStatus(candidate: TrainerScriptCandidate, trainerCount: number): Extract<TrainerScriptArchiveStatus, { ok: true }> {
  const tableEntryCount = candidate.table.starts.length;
  const supportedTrainerCount = Math.min(trainerCount, TRAINER_SCRIPT_RANGE_SIZE);
  const helperTrainerIds = range(candidate.helperStart, Math.min(candidate.helperEnd, supportedTrainerCount));
  const missingTrainerIds = range(tableEntryCount, supportedTrainerCount);
  const outOfRangeTrainerIds = range(TRAINER_SCRIPT_RANGE_SIZE, trainerCount);
  const needsExpansion = missingTrainerIds.length > 0;
  const canExpand = needsExpansion && tableEntryCount < TRAINER_SCRIPT_RANGE_SIZE;
  return {
    ok: true,
    scriptFileId: candidate.fileId,
    trainerCount,
    tableEntryCount,
    normalEntryCount: candidate.normalEntryCount,
    helperStart: candidate.helperStart,
    helperEnd: candidate.helperEnd,
    helperTrainerIds,
    missingTrainerIds,
    outOfRangeTrainerIds,
    needsExpansion,
    canExpand,
    message: needsExpansion ? "Global trainer script table needs expansion." : "Global trainer script table is up to date.",
  };
}

function findTrainerScriptCandidate(project: ProjectState): TrainerScriptCandidate | undefined {
  const scripts = project.narcs.scripts;
  if (!scripts) return undefined;

  const knownId = KNOWN_TRAINER_SCRIPT_FILE_IDS[project.session.baseRom];
  if (knownId !== undefined) {
    const known = analyzeTrainerScriptFile(knownId, scripts.rawFiles[knownId]);
    if (known) return known;
  }

  const candidates: TrainerScriptCandidate[] = [];
  scripts.rawFiles.forEach((bytes, fileId) => {
    const candidate = analyzeTrainerScriptFile(fileId, bytes);
    if (candidate) candidates.push(candidate);
  });
  candidates.sort((a, b) => b.normalEntryCount - a.normalEntryCount || b.table.starts.length - a.table.starts.length);
  return candidates[0];
}

function analyzeTrainerScriptFile(fileId: number, bytes: Uint8Array | undefined): TrainerScriptCandidate | undefined {
  if (!bytes?.length) return undefined;
  const table = parseEventTable(bytes);
  if (!table || table.starts.length < 16) return undefined;

  const normalStart = table.starts[0];
  let normalEntryCount = 0;
  while (normalEntryCount < table.starts.length && table.starts[normalEntryCount] === normalStart) normalEntryCount += 1;
  if (normalEntryCount < 16) return undefined;

  let helperEnd = normalEntryCount;
  while (helperEnd < table.starts.length && table.starts[helperEnd] !== normalStart) helperEnd += 1;
  if (helperEnd === normalEntryCount) return undefined;
  for (let index = helperEnd; index < table.starts.length; index += 1) {
    if (table.starts[index] !== normalStart) return undefined;
  }

  return {
    fileId,
    table,
    normalStart,
    normalEntryCount,
    helperStart: normalEntryCount,
    helperEnd,
  };
}

function parseEventTable(bytes: Uint8Array): EventTable | undefined {
  const starts: number[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    if (readU16(bytes, offset) === EVENT_DATA_END_CODE) return { starts, tableEndOffset: offset };
    const relative = toSigned32(readU32(bytes, offset));
    const target = offset + relative + 4;
    if (!Number.isInteger(target) || target < 0 || target >= bytes.length) return undefined;
    starts.push(target);
    if (starts.length > TRAINER_SCRIPT_RANGE_SIZE + 16) return undefined;
    offset += 4;
  }
  return undefined;
}

function appendTrainerScriptEntries(bytes: Uint8Array, table: EventTable, normalStart: number, count: number): Uint8Array {
  const insertBytes = count * 4;
  const out = new Uint8Array(bytes.length + insertBytes);

  for (let index = 0; index < table.starts.length; index += 1) {
    writeU32(out, index * 4, (readU32(bytes, index * 4) + insertBytes) >>> 0);
  }

  const shiftedNormalStart = normalStart + insertBytes;
  for (let index = 0; index < count; index += 1) {
    const pointerOffset = table.tableEndOffset + index * 4;
    writeU32(out, pointerOffset, (shiftedNormalStart - pointerOffset - 4) >>> 0);
  }

  writeU16(out, table.tableEndOffset + insertBytes, EVENT_DATA_END_CODE);
  out.set(bytes.subarray(table.tableEndOffset + 2), table.tableEndOffset + insertBytes + 2);
  return out;
}

function toSigned32(value: number): number {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function range(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let value = Math.max(0, start); value < endExclusive; value += 1) out.push(value);
  return out;
}

function formatIdList(ids: number[]): string {
  if (ids.length <= 6) return ids.join(", ");
  return `${ids.slice(0, 4).join(", ")} ... ${ids[ids.length - 1]}`;
}
