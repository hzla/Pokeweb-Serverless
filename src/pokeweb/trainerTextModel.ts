import { readU16, writeU16 } from "../nds/binary";
import type { NarcName } from "./constants";
import { markDirty, type NarcStore, type ProjectState } from "./projectStore";
import type { Gen5TextEntry } from "./text";
import { commitTextBank, getTextBank } from "./textModel";

const TRAINER_TEXT_BANK_ID = 381;

export const TRAINER_TEXT_TYPES = [
  [0, "Pre Bttl"],
  [1, "Bttl - After Loss"],
  [2, "Fld - After Loss"],
  [3, "Pre Bttl Dbls 1"],
  [5, "Fld - After Loss Dbls 1"],
  [6, "Reject Dbls 1"],
  [7, "Pre Bttl Dbls 2"],
  [9, "Fld - After Loss Dbls 2"],
  [10, "Reject Dbls 2"],
  [13, "Before Heal"],
  [14, "After Heal"],
  [15, "After Bttl Item"],
  [16, "More Item"],
  [17, "After 1st Hit (Non KO)"],
  [19, "Last Pok"],
  [20, "Last Pok Less than 1/2 HP"],
  [24, "Reject Triple"],
] as const;

type TrainerTextStores = {
  lineTableName: NarcName;
  lineTableStore: NarcStore;
  offsetName: NarcName;
  offsetStore: NarcStore;
};

type TrainerTextTableRow = {
  trainerId: number;
  typeId: number;
};

export type TrainerTextLine = {
  typeId: number;
  label: string;
  entryIndex: number;
  value: string;
  exists: boolean;
};

export function hasTrainerTextSupport(project: ProjectState): boolean {
  return project.session.baseRom === "BW2" && Boolean(resolveTrainerTextStores(project)) && getTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID).length > 0;
}

export function getTrainerTextLines(project: ProjectState, trainerId: number): TrainerTextLine[] {
  const context = getTrainerTextContext(project, trainerId);
  if (!context) return [];
  const byType = new Map<number, { entryIndex: number; value: string }>();
  for (const entryIndex of context.entryIndexes) {
    const typeId = context.rows[entryIndex]?.typeId;
    if (typeId === undefined) continue;
    byType.set(typeId, { entryIndex, value: context.bank[entryIndex]?.[1] ?? "" });
  }
  const insertIndex = context.startIndex + context.entryIndexes.length;
  return TRAINER_TEXT_TYPES.map(([typeId, label]) => {
    const existing = byType.get(typeId);
    return {
      typeId,
      label,
      entryIndex: existing?.entryIndex ?? insertIndex,
      value: existing?.value ?? "",
      exists: existing !== undefined,
    };
  });
}

export function updateTrainerText(project: ProjectState, trainerId: number, typeId: number, value: string): TrainerTextLine[] {
  const context = getTrainerTextContext(project, trainerId);
  if (!context) throw new Error("Trainer text data is not loaded");
  const existingIndex = context.entryIndexes.find((entryIndex) => context.rows[entryIndex]?.typeId === typeId);
  const nextValue = value.trim();

  if (existingIndex !== undefined) {
    if (nextValue === "") deleteTrainerText(project, context, trainerId, existingIndex);
    else {
      context.bank[existingIndex][1] = nextValue;
      commitTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID);
    }
  } else if (nextValue !== "") {
    insertTrainerText(project, context, trainerId, typeId, nextValue);
  }

  return getTrainerTextLines(project, trainerId);
}

export function addTrainerTextFromTemplate(project: ProjectState, trainerId: number, templateTrainerId: number): void {
  if (!hasTrainerTextSupport(project)) return;
  const stores = resolveTrainerTextStores(project);
  if (!stores) return;

  const rows = parseLineTable(stores.lineTableStore.rawFiles[0] ?? new Uint8Array());
  const offsets = parseOffsets(stores.offsetStore.rawFiles[0] ?? new Uint8Array());
  const bank = getTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID);
  const sourceEntries = rows
    .map((row, entryIndex) => ({ row, entryIndex, text: bank[entryIndex] }))
    .filter((entry) => entry.row.trainerId === templateTrainerId && entry.text !== undefined);

  const insertIndex = rows.length;
  while (offsets.length <= trainerId) offsets.push(insertIndex * 4);
  offsets[trainerId] = insertIndex * 4;

  for (const source of sourceEntries) {
    rows.push({ trainerId, typeId: source.row.typeId });
    bank.push([`0_${bank.length}`, source.text[1], source.text[2] ?? 0]);
  }

  renumberBank(bank);
  commitRawTrainerTextTables(project, stores, rows, offsets);
  commitTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID);
}

function getTrainerTextContext(project: ProjectState, trainerId: number):
  | {
      stores: TrainerTextStores;
      rows: TrainerTextTableRow[];
      offsets: number[];
      bank: Gen5TextEntry[];
      startIndex: number;
      startOffset: number;
      entryIndexes: number[];
    }
  | undefined {
  if (project.session.baseRom !== "BW2") return undefined;
  const stores = resolveTrainerTextStores(project);
  if (!stores) return undefined;
  const rows = parseLineTable(stores.lineTableStore.rawFiles[0] ?? new Uint8Array());
  const offsets = parseOffsets(stores.offsetStore.rawFiles[0] ?? new Uint8Array());
  const bank = getTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID);
  let startOffset = offsets[trainerId];
  let startIndex = startOffset === undefined ? -1 : Math.floor(startOffset / 4);
  if (startIndex < 0 || rows[startIndex]?.trainerId !== trainerId) startIndex = rows.findIndex((row) => row.trainerId === trainerId);
  if (startIndex < 0) {
    startIndex = insertionIndexForMissingTrainer(rows, offsets, trainerId);
    startOffset = startIndex * 4;
  } else {
    startOffset = startIndex * 4;
  }
  const entryIndexes: number[] = [];
  for (let index = startIndex; index < rows.length && rows[index]?.trainerId === trainerId; index += 1) entryIndexes.push(index);
  return { stores, rows, offsets, bank, startIndex, startOffset, entryIndexes };
}

function insertTrainerText(
  project: ProjectState,
  context: NonNullable<ReturnType<typeof getTrainerTextContext>>,
  trainerId: number,
  typeId: number,
  value: string,
): void {
  const insertIndex = context.startIndex + context.entryIndexes.length;
  context.rows.splice(insertIndex, 0, { trainerId, typeId });
  if (context.offsets[trainerId] === undefined) context.offsets[trainerId] = insertIndex * 4;
  bumpOffsetsAfter(context.offsets, context.startOffset, 4);
  context.bank.splice(insertIndex, 0, [`0_${insertIndex}`, value, 0]);
  renumberBank(context.bank);
  commitTrainerTextTables(project, context);
}

function deleteTrainerText(project: ProjectState, context: NonNullable<ReturnType<typeof getTrainerTextContext>>, trainerId: number, entryIndex: number): void {
  context.rows.splice(entryIndex, 1);
  context.bank.splice(entryIndex, 1);
  bumpOffsetsAfter(context.offsets, context.startOffset, -4);
  if (!context.rows.some((row) => row.trainerId === trainerId)) context.offsets[trainerId] = context.startIndex * 4;
  renumberBank(context.bank);
  commitTrainerTextTables(project, context);
}

function commitTrainerTextTables(project: ProjectState, context: NonNullable<ReturnType<typeof getTrainerTextContext>>): void {
  commitRawTrainerTextTables(project, context.stores, context.rows, context.offsets);
  commitTextBank(project, "message_texts", TRAINER_TEXT_BANK_ID);
}

function commitRawTrainerTextTables(project: ProjectState, stores: TrainerTextStores, rows: TrainerTextTableRow[], offsets: number[]): void {
  stores.lineTableStore.rawFiles[0] = serializeLineTable(rows);
  stores.lineTableStore.records.clear();
  markDirty(project, stores.lineTableName, 0);

  stores.offsetStore.rawFiles[0] = serializeOffsets(offsets);
  stores.offsetStore.records.clear();
  markDirty(project, stores.offsetName, 0);
}

function resolveTrainerTextStores(project: ProjectState): TrainerTextStores | undefined {
  const candidates: Array<[NarcName, NarcStore | undefined]> = [
    ["trtext_table", project.narcs.trtext_table],
    ["trtext_offsets", project.narcs.trtext_offsets],
  ];
  const loaded = candidates.filter((candidate): candidate is [NarcName, NarcStore] => Boolean(candidate[1]));
  if (loaded.length < 2) return undefined;

  const lineTable = loaded.find(([, store]) => store.sourcePath === "a/0/9/0") ?? loaded.find(([name]) => name === "trtext_table");
  const offsetTable = loaded.find(([, store]) => store.sourcePath === "a/0/8/9") ?? loaded.find(([name]) => name === "trtext_offsets");
  if (!lineTable || !offsetTable || lineTable[0] === offsetTable[0]) return undefined;
  return {
    lineTableName: lineTable[0],
    lineTableStore: lineTable[1],
    offsetName: offsetTable[0],
    offsetStore: offsetTable[1],
  };
}

function parseLineTable(bytes: Uint8Array): TrainerTextTableRow[] {
  const rows: TrainerTextTableRow[] = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
    rows.push({ trainerId: readU16(bytes, offset), typeId: readU16(bytes, offset + 2) });
  }
  return rows;
}

function serializeLineTable(rows: TrainerTextTableRow[]): Uint8Array {
  const out = new Uint8Array(rows.length * 4);
  rows.forEach((row, index) => {
    writeU16(out, index * 4, row.trainerId);
    writeU16(out, index * 4 + 2, row.typeId);
  });
  return out;
}

function parseOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 2 <= bytes.length; offset += 2) offsets.push(readU16(bytes, offset));
  return offsets;
}

function serializeOffsets(offsets: number[]): Uint8Array {
  const out = new Uint8Array(offsets.length * 2);
  offsets.forEach((offset, index) => writeU16(out, index * 2, Math.max(0, offset)));
  return out;
}

function bumpOffsetsAfter(offsets: number[], currentOffset: number, delta: number): void {
  offsets.forEach((offset, index) => {
    if (offset > currentOffset) offsets[index] = Math.max(0, offset + delta);
  });
}

function insertionIndexForMissingTrainer(rows: TrainerTextTableRow[], offsets: number[], trainerId: number): number {
  for (let nextTrainer = trainerId + 1; nextTrainer < offsets.length; nextTrainer += 1) {
    if (offsets[nextTrainer] !== undefined) return Math.floor(offsets[nextTrainer] / 4);
  }
  return rows.length;
}

function renumberBank(bank: Gen5TextEntry[]): void {
  bank.forEach((entry, index) => {
    entry[0] = `0_${index}`;
  });
}
