import { readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { validateDsRomSections } from "../nds/romValidation";
import { decodeGen5TextBank, encodeGen5TextBank } from "./text";
import { loadTranslationProfile, TRANSLATION_GAMES, TRANSLATION_VERSION, translationSourceGame, translationDonorLocale, type TranslationLocaleId, type TranslationGameId } from "./translationProfile";
import { isTranslationNativeRecord, planTranslationTransfers, translationBytesEqual, translationSha256, type TranslationRecord } from "./translationTransfer";
import type { TranslationScriptAudit } from "./translationScripts";

export const ITALIAN_WHITE2_TRANSLATION_VERSION = TRANSLATION_VERSION;
export type TranslationProgress = (message: string) => void | Promise<void>;
export type TranslationReport = {
  schemaVersion: 2; profile: string; version: string; language: string; gameCode: "IRDO" | "IREO"; game?: TranslationGameId;
  sourceSha256: string; donorSha256: string; outputBytes: number;
  outputSha256: string; donorGameCode: string; donorKind: "retail" | "edited";
  baselineDonorSha256: string; replacedFiles: number; importedHackMembers: number; skippedDonorEdits: number;
  untransferredDifferences: { total: number; donorEdits: number; nativeDonorEdits: number; partiallyImportedMembers: number };
  replacedArchives: number; replacedMembers: number; unchangedFiles: number;
  executableBytesPreserved: true; fileIdsPreserved: true; dsiProgramsPreserved: true;
  retainedAlphabetBanks: number[]; omittedRegionalStoryEntries: number;
  notes: string[];
  records: TranslationRecord[];
  scripts?: { imported: number; adapted: number; retained: number; unchanged: number; unresolvedTextReferences: number; unresolvedNativeDependencies: number; audits: TranslationScriptAudit[] };
};
export type TranslationResult = { bytes: Uint8Array; report: TranslationReport };

export function translationRomFilename(name: string, language = "Italian"): string {
  return `${name.replace(/\.nds$/iu, "")}-${language}-${TRANSLATION_VERSION}.nds`;
}

/** Keep the US index contract for search keys and region-only story entries. */
export function mergeTranslationTextArchive(source: NARC, donor: NARC, retainedBanks: readonly number[], limits: Record<string, number>): NARC {
  if (source.files.length !== donor.files.length) throw new Error("The text archive has a different bank count.");
  const result = new NARC();
  result.filenames = donor.filenames;
  result.endiannessOfBeginning = donor.endiannessOfBeginning;
  result.files = donor.files.map((bytes, bank) => {
    const original = source.files[bank];
    if (retainedBanks.includes(bank)) return original.slice();
    if (readU16(original, 0) !== readU16(bytes, 0)) throw new Error(`Text bank ${bank} has a different block count.`);
    const limit = limits[bank];
    if (limit !== undefined) {
      if (readU16(original, 2) !== limit || readU16(bytes, 2) < limit) throw new Error(`Text bank ${bank} does not match its audited entry limit.`);
      const entries = decodeGen5TextBank(bytes).filter(([id]) => Number(id.match(/^\d+_(\d+)/u)?.[1]) < limit);
      const trimmed = encodeGen5TextBank(entries);
      if (readU16(trimmed, 2) !== limit) throw new Error(`Text bank ${bank} could not retain its US entry IDs.`);
      return trimmed;
    }
    if (readU16(original, 2) !== readU16(bytes, 2)) throw new Error(`Text bank ${bank} has unaudited entry differences.`);
    decodeGen5TextBank(bytes);
    return bytes.slice();
  });
  return result;
}

const equal = translationBytesEqual;

/** Validate every executable and every unselected file after the writer rebuilds. */
export function assertTranslationPreservesCode(source: NintendoDSRom, result: NintendoDSRom, replacements: ReadonlyMap<number, Uint8Array>): void {
  if (source.idCode !== result.idCode || source.arm9RamAddress !== result.arm9RamAddress || source.data[30] !== result.data[30]) {
    throw new Error("Translation changed the native game identity.");
  }
  for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "fntData", "banner"] as const) {
    if (!equal(source[key], result[key])) throw new Error(`Translation changed ${key}.`);
  }
  if (source.files.length !== result.files.length) throw new Error("Translation changed ROM file IDs.");
  const overlayFiles = new Set<number>();
  for (const table of [source.arm9OverlayTable, source.arm7OverlayTable]) {
    for (let at = 0; at < table.length; at += 32) overlayFiles.add(readU32(table, at + 24));
  }
  for (let id = 0; id < source.files.length; id++) {
    if (overlayFiles.has(id) && replacements.has(id)) throw new Error("An overlay was selected as a translation asset.");
    if (!equal(result.files[id], replacements.get(id) ?? source.files[id])) throw new Error(`Translation changed unselected ROM file ${id}.`);
  }
  for (const [offset, size] of [[0x1c0, 0x1cc], [0x1d0, 0x1dc]]) {
    const count = readU32(source.data, size), start = readU32(source.data, offset), next = readU32(result.data, offset);
    if (readU32(result.data, size) !== count || !equal(source.data.subarray(start, start + count), result.data.subarray(next, next + count))) {
      throw new Error("Translation changed a DSi program.");
    }
  }
}

export async function translateGen5Rom(sourceBytes: Uint8Array, donorBytes: Uint8Array, locale?: TranslationLocaleId, progress?: TranslationProgress, expectedGame?: TranslationGameId): Promise<TranslationResult> {
  await progress?.("Checking the US ROM…");
  validateDsRomSections(sourceBytes);
  const source = new NintendoDSRom(sourceBytes, { fileData: "view" });
  const game = translationSourceGame(source.idCode);
  if (!game || expectedGame && game !== expectedGame || sourceBytes[30] !== 0) throw new Error(`Choose a clean US ${expectedGame ? TRANSLATION_GAMES[expectedGame].title : "Black 2 or White 2"} revision-0 ROM.`);
  const title = TRANSLATION_GAMES[game];
  const sourceSha256 = await translationSha256(sourceBytes);
  if (sourceSha256 !== title.sourceSha256) throw new Error(`This version needs clean US ${title.title}. Translate the clean ROM first, then apply patches and editor changes to the translated ROM.`);

  await progress?.(`Checking the ${title.title} donor…`);
  validateDsRomSections(donorBytes);
  const donor = new NintendoDSRom(donorBytes, { fileData: "view" });
  const detected = translationDonorLocale(donor.idCode, game);
  if (!detected || donorBytes[30] !== 0) throw new Error(`Choose an Italian, French, German, Spanish or Korean ${title.title} revision-0 donor matching the US game.`);
  if (locale && detected.id !== locale) throw new Error(`The selected language does not match the ${detected.language} donor.`);
  const profile = await loadTranslationProfile(detected.id, game);
  const donorSha256 = await translationSha256(donorBytes);

  await progress?.(`Comparing ${detected.language} assets and donor data edits…`);
  const { replacements, records, scriptAudits } = await planTranslationTransfers(source, donor, profile);
  await progress?.(`Building the ${detected.language} ROM with US code…`);
  const bytes = source.save({ files: replacements });
  await progress?.("Verifying US code and file IDs…");
  assertTranslationPreservesCode(source, new NintendoDSRom(bytes, { fileData: "view" }), replacements);
  await progress?.("Recording the imported files and members…");
  const importedMembers = records.filter(item => item.scope === "member" && item.action === "imported");
  const untransferred = records.filter(item => item.action !== "imported");
  const partialMembers = importedMembers.filter(item => item.output?.sha256 !== item.donor.sha256);
  const report: TranslationReport = {
    schemaVersion: 2, profile: profile.id, version: TRANSLATION_VERSION, language: detected.language, gameCode: title.sourceCode, game, sourceSha256, donorSha256, outputBytes: bytes.length,
    donorGameCode: donor.idCode, donorKind: donorSha256 === profile.donorSha256 ? "retail" : "edited", baselineDonorSha256: profile.donorSha256,
    outputSha256: await translationSha256(bytes), replacedFiles: replacements.size,
    replacedArchives: records.filter(item => item.scope === "file" && item.action === "imported" && item.changedMemberIds).length,
    replacedMembers: importedMembers.length, importedHackMembers: importedMembers.filter(item => item.change !== "regional").length,
    skippedDonorEdits: records.filter(item => item.action !== "imported" && item.change !== "regional").length,
    untransferredDifferences: {
      total: untransferred.length + partialMembers.length, donorEdits: [...untransferred, ...partialMembers].filter(item => item.change !== "regional").length,
      nativeDonorEdits: untransferred.filter(item => item.change !== "regional" && isTranslationNativeRecord(item)).length,
      partiallyImportedMembers: partialMembers.length,
    },
    unchangedFiles: source.files.length - replacements.size,
    executableBytesPreserved: true, fileIdsPreserved: true, dsiProgramsPreserved: true,
    retainedAlphabetBanks: [...profile.alphabetBanks], omittedRegionalStoryEntries: importedMembers.reduce((sum, member) => sum + (member.omittedEntries ?? 0), 0),
    records,
    scripts: {
      imported: scriptAudits.filter(item => item.status === "imported").length, adapted: scriptAudits.filter(item => item.status === "adapted").length,
      retained: scriptAudits.filter(item => item.status === "retained").length,
      unchanged: scriptAudits.filter(item => item.status === "unchanged").length,
      unresolvedTextReferences: scriptAudits.reduce((sum, item) => sum + item.references.filter(reference => ["unresolved", "inherited"].includes(reference.status)).length, 0),
      unresolvedNativeDependencies: scriptAudits.reduce((sum, item) => sum + item.diagnostics.filter(diagnostic => diagnostic.code.includes("native") || diagnostic.code.includes("overlay") || diagnostic.code === "word-binding-unresolved").length, 0),
      audits: scriptAudits,
    },
    notes: ["Regional assets and donor edits are matched by file path and member ID. Each transferred or retained difference is recorded with sizes and hashes.",
      "US executable sections, overlays, filename table and file IDs are retained. Native donor modifications and added files are not imported.",
      "Native and overlay hashes are compared with the clean regional baseline. A mismatch detects changed bytes, including possible compression or repacking changes; it does not identify the code's intended behavior. Imported data edits can depend on donor code that was retained.",
      "US alphabetical search keys, main-menu tilemap row stride and OT origin language are retained. Compatible script changes and trade fields can be imported.",
      "The small numeric font keeps US cell geometry, glyph metrics and character IDs. Compatible donor glyph artwork is repacked into US cells; unsupported numeric-font layouts are retained and logged.",
      "Changed scripts are checked against US entry/command layouts, branches, actual output text banks and decrypted word-buffer references. Known appended facility hints can be remapped. Unresolved new dependencies retain the US script; inherited US dynamic references are logged without claiming their runtime range is proven.",
      "The script audit is a bounded static compatibility check, not a proof of gameplay behavior. New native calls outside the audited edit set, changed native dependencies and unverified regional renderers require a separate port.",
      "Unexpected member counts, changed fixed-record schemas and incompatible text-bank shapes are retained and recorded with a reason.",
      `Patch-added text remains in English. Apply US ${title.title} patches to this ROM after translation.`,
      "This is an alpha for emulator testing. In-game text layout, variable bindings, word-search screens and DSi hardware acceptance require further validation."],
  };
  return { bytes, report };
}

export function translateWhite2(sourceBytes: Uint8Array, donorBytes: Uint8Array, locale?: TranslationLocaleId, progress?: TranslationProgress): Promise<TranslationResult> {
  return translateGen5Rom(sourceBytes, donorBytes, locale, progress, "white2");
}
export function translateBlack2(sourceBytes: Uint8Array, donorBytes: Uint8Array, locale?: TranslationLocaleId, progress?: TranslationProgress): Promise<TranslationResult> {
  return translateGen5Rom(sourceBytes, donorBytes, locale, progress, "black2");
}

export async function translateWhite2ToItalian(sourceBytes: Uint8Array, donorBytes: Uint8Array, progress?: TranslationProgress): Promise<TranslationResult> {
  return translateWhite2(sourceBytes, donorBytes, "italian", progress);
}
