import type { Folder } from "../nds/fnt";

export const TRANSLATION_VERSION = "0.4.2-alpha";
export const TRANSLATION_GAMES = {
  white2: { title: "White 2", version: "W2", sourceCode: "IRDO", sourceSha256: "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446" },
  black2: { title: "Black 2", version: "B2", sourceCode: "IREO", sourceSha256: "2e6b2415354aa41471bc7617068dce059a59931bf5c4348a264f8043f297683a" },
} as const;
export type TranslationGameId = keyof typeof TRANSLATION_GAMES;
export const TRANSLATION_LOCALES = [
  { id: "italian", language: "Italian", region: "Italy", gameCode: "IRDI", black2GameCode: "IREI" },
  { id: "french", language: "French", region: "France", gameCode: "IRDF", black2GameCode: "IREF" },
  { id: "german", language: "German", region: "Germany", gameCode: "IRDD", black2GameCode: "IRED" },
  { id: "spanish", language: "Spanish", region: "Spain", gameCode: "IRDS", black2GameCode: "IRES" },
  { id: "korean", language: "Korean", region: "Korea", gameCode: "IRDK", black2GameCode: "IREK" },
] as const;
export type TranslationLocaleId = typeof TRANSLATION_LOCALES[number]["id"];
export function translationSourceGame(code: string): TranslationGameId | undefined {
  return (Object.keys(TRANSLATION_GAMES) as TranslationGameId[]).find(game => TRANSLATION_GAMES[game].sourceCode === code);
}
export function translationDonorLocale(code: string, game: TranslationGameId) {
  return TRANSLATION_LOCALES.find(locale => (game === "black2" ? locale.black2GameCode : locale.gameCode) === code);
}
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
export async function loadTranslationProfile(locale: TranslationLocaleId, game: TranslationGameId = "white2"): Promise<TranslationProfile> {
  let data: unknown;
  if (game === "black2") {
    switch (locale) {
      case "italian": data = (await import("../assets/translation/black2-italian.json")).default; break;
      case "french": data = (await import("../assets/translation/black2-french.json")).default; break;
      case "german": data = (await import("../assets/translation/black2-german.json")).default; break;
      case "spanish": data = (await import("../assets/translation/black2-spanish.json")).default; break;
      case "korean": data = (await import("../assets/translation/black2-korean.json")).default; break;
      default: throw new Error("Unsupported Black 2 language.");
    }
    return data as TranslationProfile;
  }
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
