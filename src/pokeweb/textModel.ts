import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS, GEN4_MESSAGE_BANKS, isGen4Project, type Gen4Version, type NarcName, type TextBankSource } from "./constants";
import { markDirty, type ProjectState } from "./projectStore";
import { cleanDisplayText, decodeGen4TextBank, decodeGen5TextBank, encodeGen4TextBank, encodeGen5TextBank, type Gen5TextEntry } from "./text";

export type TextNarcName = "message_texts" | "story_texts";

export type TextBankSummary = {
  id: number;
  entries: Gen5TextEntry[];
  preview: Gen5TextEntry[];
};

export function getTextBankCount(project: ProjectState, narcName: TextNarcName): number {
  return getTextBanks(project, narcName).length;
}

export function getTextBanks(project: ProjectState, narcName: TextNarcName): Gen5TextEntry[][] {
  const key = textStateKey(narcName);
  const existing = project.texts[key];
  if (existing) return existing;
  const store = project.narcs[narcName];
  if (!store) throw new Error(`Text NARC is not loaded: ${narcName}`);
  const decodeBank = isGen4Project(project) ? decodeGen4TextBank : decodeGen5TextBank;
  const decoded = store.rawFiles.map((file) => {
    try {
      return decodeBank(file);
    } catch {
      return [];
    }
  });
  project.texts[key] = decoded;
  return decoded;
}

export function getTextBank(project: ProjectState, narcName: TextNarcName, bankId: number): Gen5TextEntry[] {
  return getTextBanks(project, narcName)[bankId] ?? [];
}

export function getTextBankSummaries(project: ProjectState, narcName: TextNarcName, searchText = "", ignoreCase = false): TextBankSummary[] {
  return getTextBanks(project, narcName)
    .map((entries, id) => ({ id, entries, preview: textMatches(entries, searchText, ignoreCase) }))
    .filter((summary) => summary.entries.length > 0 && summary.preview.length > 0)
    .map((summary) => ({ ...summary, preview: summary.preview.slice(0, 5) }));
}

export function updateTextEntry(project: ProjectState, narcName: TextNarcName, bankId: number, flatEntryIndex: number, value: string): Gen5TextEntry {
  const bank = getTextBank(project, narcName, bankId);
  const entry = bank[flatEntryIndex];
  if (!entry) throw new Error(`Text entry ${flatEntryIndex} does not exist in bank ${bankId}`);
  const before = entry[1];
  entry[1] = value;
  commitTextBank(project, narcName, bankId);
  recordFieldChange(project, narcName, `Text Bank ${bankId}`, `entry ${flatEntryIndex}`, before, value, {
    key: `text:${narcName}:${bankId}:${flatEntryIndex}`,
  });
  return entry;
}

export function addTextEntries(project: ProjectState, narcName: TextNarcName, bankId: number, count: number): void {
  const bank = getTextBank(project, narcName, bankId);
  const shape = getBankShape(bank);
  for (let n = 0; n < count; n += 1) {
    for (let block = 0; block < shape.numBlocks; block += 1) {
      bank.push([`${block}_${shape.numEntries + n}`, "", 0]);
    }
  }
  sortTextBank(bank);
  commitTextBank(project, narcName, bankId);
  recordGenericChange(project, narcName, `${count} text entr${count === 1 ? "y" : "ies"} added to bank ${bankId}.`, `Text Bank ${bankId}`, {
    key: `text-add:${narcName}:${bankId}`,
  });
}

export function deleteLastTextEntries(project: ProjectState, narcName: TextNarcName, bankId: number, count: number): void {
  const bank = getTextBank(project, narcName, bankId);
  const shape = getBankShape(bank);
  const nextEntryCount = Math.max(1, shape.numEntries - count);
  const remaining = bank.filter((entry) => parseTextEntryId(entry[0]).entry < nextEntryCount);
  bank.splice(0, bank.length, ...remaining);
  commitTextBank(project, narcName, bankId);
  const removed = shape.numEntries - nextEntryCount;
  if (removed > 0) {
    recordGenericChange(project, narcName, `${removed} text entr${removed === 1 ? "y" : "ies"} removed from bank ${bankId}.`, `Text Bank ${bankId}`, {
      key: `text-delete:${narcName}:${bankId}`,
    });
  }
}

export function textBankMatchesSearch(entries: Gen5TextEntry[], searchText: string, ignoreCase = false): boolean {
  return textMatches(entries, searchText, ignoreCase).length > 0;
}

export function parseTextEntryId(id: string): { block: number; entry: number; suffix: string } {
  const match = /^(\d+)_(\d+)(.*)$/u.exec(id);
  if (!match) throw new Error(`Invalid text entry id: ${id}`);
  return { block: Number(match[1]), entry: Number(match[2]), suffix: match[3] ?? "" };
}

export function commitTextBank(project: ProjectState, narcName: TextNarcName, bankId: number): void {
  const bank = getTextBank(project, narcName, bankId);
  project.narcs[narcName]!.rawFiles[bankId] = isGen4Project(project) ? encodeGen4TextBank(bank) : encodeGen5TextBank(bank);
  markDirty(project, narcName, bankId);
  refreshKnownTextBank(project, narcName, bankId, bank);
}

function refreshKnownTextBank(project: ProjectState, narcName: TextNarcName, bankId: number, bank: Gen5TextEntry[]): void {
  if (narcName !== "message_texts") return;
  const mappings = isGen4Project(project) ? GEN4_MESSAGE_BANKS[project.session.baseVersion as Gen4Version] : project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : BW2_MESSAGE_BANKS;
  const mapping = mappings.find(([source]) => textBankSourceIncludes(source, bankId));
  if (!mapping) return;
  const [source, bankName] = mapping;
  const nameCase = bankName === "pokedex" || bankName === "moves";
  project.texts.banks[bankName] = textEntriesFromSource(project, source, bank).map((entry, index) => cleanDisplayText(entry?.[1] ?? `Entry ${index}`, nameCase));
}

function textBankSourceIncludes(source: TextBankSource, bankId: number): boolean {
  return typeof source === "number" ? source === bankId : source.includes(bankId);
}

function textEntriesFromSource(project: ProjectState, source: TextBankSource, fallback: Gen5TextEntry[]): Gen5TextEntry[] {
  if (typeof source === "number") return project.texts.messageTexts?.[source] ?? fallback;
  const merged: Gen5TextEntry[] = [];
  for (const sourceBankId of source) {
    const sourceBank = project.texts.messageTexts?.[sourceBankId] ?? [];
    sourceBank.forEach((entry, index) => {
      if (!entry) return;
      const existing = merged[index];
      if (!existing || !existing[1]) merged[index] = entry;
    });
  }
  return merged.length > 0 ? merged : fallback;
}

function getBankShape(bank: Gen5TextEntry[]): { numBlocks: number; numEntries: number } {
  const ids = bank.map((entry) => parseTextEntryId(entry[0]));
  return {
    numBlocks: Math.max(1, ...ids.map((id) => id.block + 1)),
    numEntries: Math.max(1, ...ids.map((id) => id.entry + 1)),
  };
}

function sortTextBank(bank: Gen5TextEntry[]): void {
  bank.sort((a, b) => {
    const left = parseTextEntryId(a[0]);
    const right = parseTextEntryId(b[0]);
    return left.block - right.block || left.entry - right.entry;
  });
}

function textMatches(entries: Gen5TextEntry[], searchText: string, ignoreCase: boolean): Gen5TextEntry[] {
  const terms = searchText
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return entries;
  const normalizedTerms = ignoreCase ? terms.map((term) => term.toLowerCase()) : terms;
  return entries.filter((entry) => {
    const text = ignoreCase ? entry[1].toLowerCase() : entry[1];
    return normalizedTerms.some((term) => text.includes(term));
  });
}

function textStateKey(narcName: TextNarcName): "messageTexts" | "storyTexts" {
  return narcName === "message_texts" ? "messageTexts" : "storyTexts";
}
