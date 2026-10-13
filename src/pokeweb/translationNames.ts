import { readU16 } from "../nds/binary";
import { decodeGen5TextBank, encodeGen5TextBank } from "./text";

// US word-set commands use these article forms even when the regional code
// would read the ordinary names. Some regional releases leave them empty.
export const TRANSLATION_ARTICLE_NAME_BANKS = [[481, 64], [483, 90], [485, 383]] as const;

export function fillTranslationArticleNames(forms: Uint8Array, names: Uint8Array): {
  bytes: Uint8Array; adjustedTextEntries: { id: string; before: string; after: string }[];
} {
  if (readU16(forms, 0) !== readU16(names, 0) || readU16(forms, 2) !== readU16(names, 2))
    throw new Error("Article-name and ordinary-name banks have different IDs; keep the existing form bank.");
  const entries = decodeGen5TextBank(forms), ordinary = decodeGen5TextBank(names);
  const adjustedTextEntries: { id: string; before: string; after: string }[] = [];
  entries.forEach((entry, index) => {
    const name = ordinary[index];
    if (entry[0].match(/^\d+_\d+/u)?.[0] !== name?.[0].match(/^\d+_\d+/u)?.[0])
      throw new Error("Article-name and ordinary-name entry IDs do not match.");
    if (entry[1].trim() || !name[1].trim()) return;
    adjustedTextEntries.push({ id: entry[0], before: entry[1], after: name[1] });
    entry[1] = name[1];
  });
  return { bytes: adjustedTextEntries.length ? encodeGen5TextBank(entries) : forms, adjustedTextEntries };
}
