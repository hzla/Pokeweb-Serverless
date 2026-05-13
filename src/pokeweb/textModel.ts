import { BW2_MESSAGE_BANKS, BW_MESSAGE_BANKS, type NarcName } from "./constants";
import { markDirty, type ProjectState } from "./projectStore";
import { cleanDisplayText, decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "./text";

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
  const decoded = store.rawFiles.map((file) => {
    try {
      return decodeGen5TextBank(file);
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
  entry[1] = value;
  commitTextBank(project, narcName, bankId);
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
}

export function deleteLastTextEntries(project: ProjectState, narcName: TextNarcName, bankId: number, count: number): void {
  const bank = getTextBank(project, narcName, bankId);
  const shape = getBankShape(bank);
  const nextEntryCount = Math.max(1, shape.numEntries - count);
  const remaining = bank.filter((entry) => parseTextEntryId(entry[0]).entry < nextEntryCount);
  bank.splice(0, bank.length, ...remaining);
  commitTextBank(project, narcName, bankId);
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
  project.narcs[narcName]!.rawFiles[bankId] = encodeGen5TextBank(bank);
  markDirty(project, narcName, bankId);
  refreshKnownTextBank(project, narcName, bankId, bank);
}

function refreshKnownTextBank(project: ProjectState, narcName: TextNarcName, bankId: number, bank: Gen5TextEntry[]): void {
  if (narcName !== "message_texts") return;
  const mappings = project.session.baseRom === "BW" ? BW_MESSAGE_BANKS : BW2_MESSAGE_BANKS;
  const mapping = mappings.find(([mappedBankId]) => mappedBankId === bankId);
  if (!mapping) return;
  const [, bankName] = mapping;
  const nameCase = bankName === "pokedex" || bankName === "moves";
  project.texts.banks[bankName] = bank.map((entry, index) => cleanDisplayText(entry?.[1] ?? `Entry ${index}`, nameCase));
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
