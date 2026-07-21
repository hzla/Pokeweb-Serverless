import { isGen5Project, type BaseRom } from "./constants";
import { findPokemonPersonalFormOwner, pokemonSpeciesLabel } from "./pokemonLabels";
import type { ProjectState } from "./projectStore";
import { cleanDisplayText, type Gen5TextEntry } from "./text";
import { getTextBank, parseTextEntryId, updateTextEntry } from "./textModel";

export type PokemonTextBankRole = "name" | "localized" | "grammar" | "uppercase";

export type PokemonTextLine = {
  bankId: number;
  role: PokemonTextBankRole;
  flatIndex: number;
  entryIndex: number;
  entryLabel: string;
  entryId: string;
  text: string;
};

export type PokemonTextSection = {
  bankId: number;
  role: PokemonTextBankRole;
  language: string;
  editable: boolean;
  title: string;
  lines: PokemonTextLine[];
};

export type PokemonTextInfo = {
  requestedPersonalId: number;
  speciesId: number;
  title: string;
  sections: PokemonTextSection[];
};

type PokemonTextBankConfig = {
  nameBankId: number;
  uppercaseName: boolean;
  banks: ReadonlyArray<readonly [bankId: number, role: PokemonTextBankRole, language: string, editable: boolean]>;
};

const POKEMON_TEXT_BANKS: Record<BaseRom, PokemonTextBankConfig | undefined> = {
  BW: {
    nameBankId: 284,
    uppercaseName: true,
    banks: [
      [70, "name", "English", true],
      [253, "localized", "English", true],
      [254, "localized", "French", false],
      [255, "localized", "German", false],
      [256, "localized", "Italian", false],
      [257, "localized", "Japanese", false],
      [258, "localized", "Korean", false],
      [259, "localized", "Spanish", false],
      [281, "grammar", "English", true],
      [284, "uppercase", "English", true],
    ],
  },
  BW2: {
    nameBankId: 90,
    uppercaseName: false,
    banks: [
      [90, "name", "English", true],
      [458, "localized", "English", true],
      [459, "localized", "French", false],
      [460, "localized", "German", false],
      [461, "localized", "Italian", false],
      [462, "localized", "Korean", false],
      [463, "localized", "Spanish", false],
      [483, "grammar", "English", true],
      [486, "uppercase", "English", true],
    ],
  },
  DP: undefined,
  Pt: undefined,
  HGSS: undefined,
};

export function hasPokemonTextBanks(project: ProjectState): boolean {
  return Boolean(getPokemonTextBankConfig(project) && project.narcs.message_texts);
}

export function getPokemonTextInfo(project: ProjectState, requestedPersonalId: number): PokemonTextInfo | undefined {
  const config = getPokemonTextBankConfig(project);
  if (!config || !project.narcs.message_texts) return undefined;

  const speciesId = findPokemonPersonalFormOwner(project, requestedPersonalId)?.speciesId ?? requestedPersonalId;
  const canonical = getIndexedEntry(project, config.nameBankId, speciesId);
  const title = pokemonSpeciesLabel(project, speciesId).trim() || cleanDisplayText(canonical?.[1] ?? "", true).trim();
  if (!title || !canonical) return undefined;

  const sections = config.banks.flatMap(([bankId, role, language, editable]): PokemonTextSection[] => {
    const line = getIndexedEntryLine(project, bankId, role, speciesId);
    return line ? [{ bankId, role, language, editable, title: `Info Text Bank ${bankId}`, lines: [line] }] : [];
  });

  return { requestedPersonalId, speciesId, title, sections };
}

export function updatePokemonTextName(project: ProjectState, requestedPersonalId: number, inputValue: string): PokemonTextInfo {
  const config = requirePokemonTextBankConfig(project);
  const nextTitle = normalizePokemonName(inputValue);
  if (!nextTitle) throw new Error("Pokemon name cannot be empty");

  const previous = getPokemonTextInfo(project, requestedPersonalId);
  if (!previous) throw new Error("Pokemon text banks are not available");
  const nextUppercase = nextTitle.toUpperCase();

  for (const section of previous.sections) {
    if (!section.editable) continue;
    for (const line of section.lines) {
      const replacement = pokemonNameValueForRole(line.text, line.role, nextTitle, nextUppercase);
      if (replacement !== line.text) updateTextEntry(project, "message_texts", line.bankId, line.flatIndex, replacement);
    }
  }

  const canonicalFlatIndex = getIndexedEntryFlatIndex(project, config.nameBankId, previous.speciesId);
  if (canonicalFlatIndex < 0) throw new Error(`Pokemon ${previous.speciesId} does not exist in text bank ${config.nameBankId}`);
  const canonicalValue = config.uppercaseName ? nextUppercase : nextTitle;
  const nextCanonical = getTextBank(project, "message_texts", config.nameBankId)[canonicalFlatIndex];
  if (nextCanonical?.[1] !== canonicalValue) {
    updateTextEntry(project, "message_texts", config.nameBankId, canonicalFlatIndex, canonicalValue);
  }

  const info = getPokemonTextInfo(project, requestedPersonalId);
  if (!info) throw new Error("Pokemon text banks are not available");
  return info;
}

export function normalizePokemonName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function getPokemonTextBankConfig(project: ProjectState): PokemonTextBankConfig | undefined {
  if (!isGen5Project(project)) return undefined;
  return POKEMON_TEXT_BANKS[project.session.baseRom];
}

function requirePokemonTextBankConfig(project: ProjectState): PokemonTextBankConfig {
  const config = getPokemonTextBankConfig(project);
  if (!config || !project.narcs.message_texts) throw new Error("Pokemon text banks are not available for this ROM");
  return config;
}

function getIndexedEntry(project: ProjectState, bankId: number, entryIndex: number): Gen5TextEntry | undefined {
  const flatIndex = getIndexedEntryFlatIndex(project, bankId, entryIndex);
  return flatIndex >= 0 ? getTextBank(project, "message_texts", bankId)[flatIndex] : undefined;
}

function getIndexedEntryLine(
  project: ProjectState,
  bankId: number,
  role: PokemonTextBankRole,
  entryIndex: number,
): PokemonTextLine | undefined {
  const flatIndex = getIndexedEntryFlatIndex(project, bankId, entryIndex);
  const entry = flatIndex >= 0 ? getTextBank(project, "message_texts", bankId)[flatIndex] : undefined;
  return entry ? lineFromEntry(bankId, role, flatIndex, entry) : undefined;
}

function getIndexedEntryFlatIndex(project: ProjectState, bankId: number, entryIndex: number): number {
  const bank = getTextBank(project, "message_texts", bankId);
  const exactIndex = bank.findIndex((entry) => parseEntryIndex(entry[0]) === entryIndex);
  return exactIndex >= 0 ? exactIndex : bank[entryIndex] ? entryIndex : -1;
}

function pokemonNameValueForRole(currentValue: string, role: PokemonTextBankRole, title: string, uppercase: string): string {
  if (role === "uppercase") return uppercase;
  if (role !== "grammar") return title;
  const finalVariable = currentValue.lastIndexOf(")");
  if (finalVariable < 0) return title;
  const article = startsWithVowel(title) ? "an" : "a";
  const prefix = currentValue.slice(0, finalVariable + 1).replace(/(VAR\(48385\))(?:a|an)(\s+VAR\()/u, `$1${article}$2`);
  return prefix + title;
}

function startsWithVowel(value: string): boolean {
  return /^[AEIOU]/iu.test(value);
}

function lineFromEntry(bankId: number, role: PokemonTextBankRole, flatIndex: number, entry: Gen5TextEntry): PokemonTextLine {
  const parsed = parseTextEntryId(entry[0]);
  return {
    bankId,
    role,
    flatIndex,
    entryIndex: parsed.entry,
    entryLabel: `${parsed.block}-${parsed.entry}`,
    entryId: entry[0],
    text: entry[1],
  };
}

function parseEntryIndex(entryId: string): number | undefined {
  try {
    return parseTextEntryId(entryId).entry;
  } catch {
    return undefined;
  }
}
