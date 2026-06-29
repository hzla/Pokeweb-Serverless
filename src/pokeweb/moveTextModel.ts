import { type BaseRom, isGen5Project } from "./constants";
import type { ProjectState } from "./projectStore";
import type { Gen5TextEntry } from "./text";
import { getTextBank, parseTextEntryId, updateTextEntry } from "./textModel";

export type MoveTextBankRole = "battle" | "name" | "uppercase" | "description";

export type MoveTextLine = {
  bankId: number;
  role: MoveTextBankRole;
  flatIndex: number;
  entryIndex: number;
  entryLabel: string;
  entryId: string;
  text: string;
};

export type MoveTextSection = {
  bankId: number;
  role: MoveTextBankRole;
  title: string;
  editable: boolean;
  lines: MoveTextLine[];
};

export type MoveTextInfo = {
  moveId: number;
  title: string;
  description: string;
  sections: MoveTextSection[];
};

type MoveTextBankConfig = {
  battleBankId: number;
  descriptionBankId: number;
  nameBankId: number;
  uppercaseBankId: number;
};

const MOVE_TEXT_BANKS: Record<BaseRom, MoveTextBankConfig | undefined> = {
  BW: {
    battleBankId: 13,
    descriptionBankId: 202,
    nameBankId: 203,
    uppercaseBankId: 286,
  },
  BW2: {
    battleBankId: 16,
    descriptionBankId: 402,
    nameBankId: 403,
    uppercaseBankId: 488,
  },
  DP: undefined,
  Pt: undefined,
  HGSS: undefined,
};

export function hasMoveTextBanks(project: ProjectState): boolean {
  return Boolean(getMoveTextBankConfig(project) && project.narcs.message_texts);
}

export function getMoveTextInfo(project: ProjectState, moveId: number): MoveTextInfo | undefined {
  const config = getMoveTextBankConfig(project);
  if (!config || !project.narcs.message_texts) return undefined;

  const titleEntry = getBankEntryLine(project, config.nameBankId, "name", moveId);
  const uppercaseEntry = getBankEntryLine(project, config.uppercaseBankId, "uppercase", moveId);
  const descriptionEntry = getBankEntryLine(project, config.descriptionBankId, "description", moveId);
  const title = (titleEntry?.text || uppercaseEntry?.text || `Move ${moveId}`).trim();
  const battleEntries = getBankLinesContaining(project, config.battleBankId, "battle", title);

  return {
    moveId,
    title,
    description: descriptionEntry?.text ?? "",
    sections: [
      {
        bankId: config.battleBankId,
        role: "battle",
        title: `Text Bank ${config.battleBankId}`,
        editable: false,
        lines: battleEntries,
      },
      {
        bankId: config.nameBankId,
        role: "name",
        title: `Text Bank ${config.nameBankId}`,
        editable: false,
        lines: titleEntry ? [titleEntry] : [],
      },
      {
        bankId: config.uppercaseBankId,
        role: "uppercase",
        title: `Text Bank ${config.uppercaseBankId}`,
        editable: false,
        lines: uppercaseEntry ? [uppercaseEntry] : [],
      },
      {
        bankId: config.descriptionBankId,
        role: "description",
        title: `Text Bank ${config.descriptionBankId}`,
        editable: true,
        lines: descriptionEntry ? [descriptionEntry] : [],
      },
    ],
  };
}

export function updateMoveTextName(project: ProjectState, moveId: number, inputValue: string): MoveTextInfo {
  const config = requireMoveTextBankConfig(project);
  const title = normalizeMoveTitleCase(inputValue);
  if (!title) throw new Error("Move name cannot be empty");

  const previousTitle = (getBankEntryLine(project, config.nameBankId, "name", moveId)?.text || `Move ${moveId}`).trim();
  const previousUppercase = previousTitle.toUpperCase();
  const nextUppercase = title.toUpperCase();

  replaceInTextBank(project, config.battleBankId, "battle", previousTitle, title);
  const changedNameEntries = replaceInTextBank(project, config.nameBankId, "name", previousTitle, title);
  const changedUppercaseEntries = replaceInTextBank(project, config.uppercaseBankId, "uppercase", previousUppercase, nextUppercase);

  updateIndexedTextEntryIfNeeded(project, config.nameBankId, "name", moveId, title, changedNameEntries);
  updateIndexedTextEntryIfNeeded(project, config.uppercaseBankId, "uppercase", moveId, nextUppercase, changedUppercaseEntries);

  const info = getMoveTextInfo(project, moveId);
  if (!info) throw new Error("Move text banks are not available");
  return info;
}

export function updateMoveDescription(project: ProjectState, moveId: number, inputValue: string): MoveTextInfo {
  const config = requireMoveTextBankConfig(project);
  const entry = getBankEntryLine(project, config.descriptionBankId, "description", moveId);
  if (!entry) throw new Error(`Move description ${moveId} does not exist in text bank ${config.descriptionBankId}`);
  updateTextEntry(project, "message_texts", config.descriptionBankId, entry.flatIndex, normalizeEscapedLineBreaks(inputValue));
  const info = getMoveTextInfo(project, moveId);
  if (!info) throw new Error("Move text banks are not available");
  return info;
}

export function normalizeMoveTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, " ")
    .split(/([ -])/u)
    .map((part) => (part === " " || part === "-" || part.length === 0 ? part : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
}

function getMoveTextBankConfig(project: ProjectState): MoveTextBankConfig | undefined {
  if (!isGen5Project(project)) return undefined;
  return MOVE_TEXT_BANKS[project.session.baseRom];
}

function requireMoveTextBankConfig(project: ProjectState): MoveTextBankConfig {
  const config = getMoveTextBankConfig(project);
  if (!config || !project.narcs.message_texts) throw new Error("Move text banks are not available for this ROM");
  return config;
}

function getBankEntryLine(project: ProjectState, bankId: number, role: MoveTextBankRole, entryIndex: number): MoveTextLine | undefined {
  const bank = readMessageBank(project, bankId);
  if (!bank) return undefined;
  const exactIndex = bank.findIndex((entry) => parseEntryIndex(entry[0]) === entryIndex);
  const flatIndex = exactIndex >= 0 ? exactIndex : bank[entryIndex] ? entryIndex : -1;
  if (flatIndex < 0) return undefined;
  return lineFromEntry(bankId, role, flatIndex, bank[flatIndex]);
}

function getBankLinesContaining(project: ProjectState, bankId: number, role: MoveTextBankRole, searchText: string): MoveTextLine[] {
  const bank = readMessageBank(project, bankId);
  if (!bank || !searchText) return [];
  const exact = bank
    .map((entry, flatIndex) => ({ entry, flatIndex }))
    .filter(({ entry }) => entry[1].includes(searchText));
  const matches =
    exact.length > 0
      ? exact
      : bank
          .map((entry, flatIndex) => ({ entry, flatIndex }))
          .filter(({ entry }) => entry[1].toLowerCase().includes(searchText.toLowerCase()));
  return matches.map(({ entry, flatIndex }) => lineFromEntry(bankId, role, flatIndex, entry));
}

function replaceInTextBank(project: ProjectState, bankId: number, role: MoveTextBankRole, searchText: string, replacement: string): Set<number> {
  const changed = new Set<number>();
  if (!searchText || searchText === replacement) return changed;
  const bank = readMessageBank(project, bankId);
  if (!bank) return changed;
  for (let flatIndex = 0; flatIndex < bank.length; flatIndex += 1) {
    const before = bank[flatIndex][1];
    const after = before.split(searchText).join(replacement);
    if (after === before) continue;
    updateTextEntry(project, "message_texts", bankId, flatIndex, after);
    changed.add(flatIndex);
  }
  if (role === "battle") return changed;
  return changed;
}

function updateIndexedTextEntryIfNeeded(
  project: ProjectState,
  bankId: number,
  role: MoveTextBankRole,
  entryIndex: number,
  value: string,
  alreadyChanged: Set<number>,
): void {
  const entry = getBankEntryLine(project, bankId, role, entryIndex);
  if (!entry || alreadyChanged.has(entry.flatIndex) || entry.text === value) return;
  updateTextEntry(project, "message_texts", bankId, entry.flatIndex, value);
}

function readMessageBank(project: ProjectState, bankId: number): Gen5TextEntry[] | undefined {
  try {
    const bank = getTextBank(project, "message_texts", bankId);
    return bank.length > 0 ? bank : undefined;
  } catch {
    return undefined;
  }
}

function lineFromEntry(bankId: number, role: MoveTextBankRole, flatIndex: number, entry: Gen5TextEntry): MoveTextLine {
  const parsed = parseTextEntryId(entry[0]);
  return {
    bankId,
    role,
    flatIndex,
    entryIndex: parsed.entry,
    entryLabel: parsed.block === 0 ? String(parsed.entry) : `${parsed.block}_${parsed.entry}`,
    entryId: entry[0],
    text: entry[1],
  };
}

function parseEntryIndex(entryId: string): number {
  try {
    return parseTextEntryId(entryId).entry;
  } catch {
    return -1;
  }
}

function normalizeEscapedLineBreaks(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\\n");
}
