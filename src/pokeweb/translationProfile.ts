import type { Folder } from "../nds/fnt";

export const TRANSLATION_VERSION = "0.3.0-alpha";
export const TRANSLATION_LOCALES = [
  { id: "italian", language: "Italian", region: "Italy", gameCode: "IRDI" },
  { id: "french", language: "French", region: "France", gameCode: "IRDF" },
  { id: "german", language: "German", region: "Germany", gameCode: "IRDD" },
  { id: "spanish", language: "Spanish", region: "Spain", gameCode: "IRDS" },
  { id: "korean", language: "Korean", region: "Korea", gameCode: "IRDK" },
] as const;
export type TranslationLocaleId = typeof TRANSLATION_LOCALES[number]["id"];
export const MAIN_MENU_LABEL_ADAPTATIONS: Partial<Record<TranslationLocaleId, { before: string; after: string }>> = {
  german: { before: "EINSTELLUNGEN DER NINTENDO WFC", after: "NINTENDO WFC-EINSTELLUNGEN" },
  spanish: { before: "CONFIG. DE LA CWF DE NINTENDO", after: "CONFIG. CWF DE NINTENDO" },
};
export type TranslationFileBaseline = {
  path: string; donorPath: string; sha256: string; members?: number; sourceMembers?: number;
  regionalMembers?: Record<string, string>; retainedMembers?: number[];
};
export type TranslationProfile = {
  schemaVersion: 2; id: string; version: string; language: string; locale: TranslationLocaleId;
  sourceCode: string; donorCode: string; revision: number; sourceSha256: string; donorSha256: string;
  alphabetBanks: number[]; storyBankLimits: Record<string, number>;
  files: TranslationFileBaseline[];
  native: Record<string, string>; overlays: Record<string, string>;
};

export function translationFileNames(folder: Folder, prefix = "", result = new Map<string, number>()): Map<string, number> {
  folder.files.forEach((name, index) => {
    const path = prefix + name;
    if (result.has(path)) throw new Error(`Duplicate ROM file path: ${path}`);
    result.set(path, folder.firstId + index);
  });
  folder.folders.forEach(([name, child]) => translationFileNames(child, `${prefix}${name}/`, result));
  return result;
}

/** Load only the selected locale's baseline fingerprints. No ROM payloads are shipped. */
export async function loadTranslationProfile(locale: TranslationLocaleId): Promise<TranslationProfile> {
  let data: unknown;
  switch (locale) {
    case "italian": data = (await import("../assets/translation/white2-italian.json")).default; break;
    case "french": data = (await import("../assets/translation/white2-french.json")).default; break;
    case "german": data = (await import("../assets/translation/white2-german.json")).default; break;
    case "spanish": data = (await import("../assets/translation/white2-spanish.json")).default; break;
    case "korean": data = (await import("../assets/translation/white2-korean.json")).default; break;
    default: throw new Error("Unsupported White 2 language.");
  }
  return data as TranslationProfile;
}
