import { readAscii, readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { decodeGen5TextBank, encodeGen5TextBank } from "./text";
import { MAIN_MENU_LABEL_ADAPTATIONS, translationFileNames, type TranslationProfile } from "./translationProfile";
import { BW2_NARCS, HEADER_NARCS } from "./constants";
import { getNarcFormats } from "./formats";
import { decompressNitro } from "./pokemonSpriteModel";
import { auditTranslationScript, translationScriptContexts, type TranslationScriptAudit } from "./translationScripts";
import { gen5ScriptEntries } from "./gen5ScriptCommands";

export type TranslationFingerprint = { bytes: number; sha256: string };
export type TranslationRecord = {
  scope: "file" | "member" | "section"; path: string; member?: number;
  sourceFileId?: number; donorFileId?: number;
  action: "imported" | "retained" | "skipped";
  change: "regional" | "hack" | "regional-and-hack";
  source: TranslationFingerprint | null; donor: TranslationFingerprint;
  regionalBaselineSha256: string | null; output: TranslationFingerprint | null;
  reason?: string; changedMemberIds?: number[]; omittedEntries?: number;
  dataset?: string; fields?: { field: string; offset: number; before: number; after: number }[];
  adjustedTextEntries?: { id: string; before: string; after: string }[];
};
export type TranslationPlan = { replacements: Map<number, Uint8Array>; records: TranslationRecord[]; scriptAudits: TranslationScriptAudit[] };
const datasets = new Map([...HEADER_NARCS, ...BW2_NARCS].map(item => [item.path, item.name]));
const formats = getNarcFormats("BW2");
export function isTranslationNativeRecord(item: TranslationRecord): boolean {
  return item.path.startsWith("overlay/") || item.scope === "section" && ["arm9", "arm7", "arm9i", "arm7i", "arm9OverlayTable", "arm7OverlayTable"].includes(item.path);
}
function recordFieldChanges(path: string, before: Uint8Array, after: Uint8Array): TranslationRecord["fields"] {
  if (path === "a/2/6/9") return undefined;
  const name = datasets.get(path), fields = name ? formats[name] : undefined;
  if (!fields) return undefined;
  const result: NonNullable<TranslationRecord["fields"]> = [];
  let at = 0;
  for (const [size, field] of fields) {
    if (size <= 4 && at + size <= before.length && at + size <= after.length) {
      const value = (bytes: Uint8Array) => Array.from(bytes.subarray(at, at + size)).reduce((total, byte, index) => total + byte * 2 ** (index * 8), 0);
      const a = value(before), b = value(after);
      if (a !== b) result.push({ field, offset: at, before: a, after: b });
    }
    at += size;
  }
  return result.length ? result : undefined;
}
export const translationBytesEqual = (a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): boolean => {
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
  return true;
};
export async function translationSha256(data: Uint8Array): Promise<string> {
  const view = data.buffer instanceof ArrayBuffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", view)), value => value.toString(16).padStart(2, "0")).join("");
}

/** Edited NARCs must not rely on silently clamped file slices. */
export function readTranslationArchive(bytes: Uint8Array): NARC {
  const count = readU32(bytes, 0x18), fatSize = readU32(bytes, 0x14), fntAt = 0x10 + fatSize;
  if (bytes.length < 32 || count > 0x10000 || fatSize < 12 + count * 8 || fntAt + 8 > bytes.length) throw new Error("Invalid NARC member table");
  const fntSize = readU32(bytes, fntAt + 4), declared = fntAt + fntSize;
  const magicAt = readAscii(bytes, declared, 4) === "GMIF" ? declared : declared - 4;
  const dataAt = declared + 8;
  if (fntSize < 16 || readAscii(bytes, magicAt, 4) !== "GMIF" || dataAt > bytes.length) throw new Error("Invalid NARC data block");
  for (let index = 0; index < count; index++) {
    const start = readU32(bytes, 0x1c + index * 8), end = readU32(bytes, 0x20 + index * 8);
    if (start > end || dataAt + end > bytes.length) throw new Error(`Truncated NARC member ${index}`);
  }
  return new NARC(bytes);
}

export function translationMenuMapCompatible(original: Uint8Array, incoming: Uint8Array): boolean {
  try {
    const unpack = (bytes: Uint8Array) => bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
    const usMap = unpack(original), donorMap = unpack(incoming);
    return readAscii(usMap, 0, 4) === "RCSN" && readAscii(donorMap, 0, 4) === "RCSN"
      && donorMap.length >= 36 + readU32(donorMap, 32)
      && readU16(usMap, 24) === readU16(donorMap, 24) && readU16(usMap, 26) === readU16(donorMap, 26)
      && readU32(usMap, 28) === readU32(donorMap, 28) && readU32(usMap, 32) === readU32(donorMap, 32);
  } catch { return false; }
}

export function translationOverlayFiles(rom: NintendoDSRom): Map<string, number> {
  const result = new Map<string, number>();
  for (const [cpu, table] of [["arm9", rom.arm9OverlayTable], ["arm7", rom.arm7OverlayTable]] as const) {
    for (let at = 0; at < table.length; at += 32) result.set(`${cpu}/${readU32(table, at)}`, readU32(table, at + 24));
  }
  return result;
}

/** Merge compatible data by path/member ID, never by the donor's numeric file ID. */
export async function planTranslationTransfers(source: NintendoDSRom, donor: NintendoDSRom, profile: TranslationProfile): Promise<TranslationPlan> {
  const records: TranslationRecord[] = [], replacements = new Map<number, Uint8Array>(), scriptAudits: TranslationScriptAudit[] = [];
  const sourceNames = translationFileNames(source.filenames), donorNames = translationFileNames(donor.filenames);
  const sourceOverlays = translationOverlayFiles(source), donorOverlays = translationOverlayFiles(donor);
  const protectedSource = new Set(sourceOverlays.values()), protectedDonor = new Set(donorOverlays.values());
  const fingerprint = async (data: Uint8Array): Promise<TranslationFingerprint> => ({ bytes: data.length, sha256: await translationSha256(data) });
  const record = async (scope: TranslationRecord["scope"], path: string, a: Uint8Array | undefined, b: Uint8Array, baseline: string | undefined, out: Uint8Array | undefined, action: TranslationRecord["action"], extra: Partial<TranslationRecord> = {}) => {
    const before = a ? await fingerprint(a) : null, incoming = await fingerprint(b);
    const stock = baseline ?? before?.sha256 ?? null;
    const hack = stock !== incoming.sha256, regional = baseline !== undefined && stock !== before?.sha256;
    const item: TranslationRecord = { scope, path, action, change: hack ? regional ? "regional-and-hack" : "hack" : "regional", source: before, donor: incoming,
      regionalBaselineSha256: stock, output: out ? await fingerprint(out) : null, dataset: path === "a/2/6/9" ? "pokestar_recording" : datasets.get(path),
      fields: scope === "member" && action === "imported" && a && out ? recordFieldChanges(path, a, out) : undefined, ...extra };
    records.push(item); return item;
  };
  for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "banner", "fntData"] as const) {
    if (!translationBytesEqual(source[key], donor[key]) || profile.native[key] && await translationSha256(donor[key]) !== profile.native[key]) await record("section", key, source[key], donor[key], profile.native[key], source[key], "retained", { reason: "Keep the US executable, tables and banner. Byte differences from the regional baseline can include compression or repacking changes." });
  }
  for (const [key, at, size] of [["arm9i", 0x1c0, 0x1cc], ["arm7i", 0x1d0, 0x1dc]] as const) {
    const a = source.data.subarray(readU32(source.data, at), readU32(source.data, at) + readU32(source.data, size));
    const b = donor.data.subarray(readU32(donor.data, at), readU32(donor.data, at) + readU32(donor.data, size));
    if (!translationBytesEqual(a, b) || profile.native[key] && await translationSha256(b) !== profile.native[key]) await record("section", key, a, b, profile.native[key], a, "retained", { reason: "Keep the US DSi executable." });
  }
  for (const [key, donorFileId] of donorOverlays) {
    const sourceFileId = sourceOverlays.get(key), a = sourceFileId === undefined ? undefined : source.files[sourceFileId], b = donor.files[donorFileId];
    if (!b) throw new Error(`Invalid donor overlay file ID: ${donorFileId}`);
    if (!a || !translationBytesEqual(a, b) || profile.overlays[key] && await translationSha256(b) !== profile.overlays[key]) await record("file", `overlay/${key}`, a, b, profile.overlays[key], a, "retained", { sourceFileId, donorFileId, reason: "Keep US overlay code and RAM addresses. Byte differences from the regional baseline can include compression changes." });
  }
  for (const [key, sourceFileId] of sourceOverlays) {
    if (!donorOverlays.has(key)) await record("file", `overlay/${key}`, source.files[sourceFileId], new Uint8Array(), profile.overlays[key], source.files[sourceFileId], "retained", { sourceFileId, reason: "The donor removed this overlay; keep the US overlay and its RAM addresses." });
  }
  const handledDonorPaths = new Set<string>();
  for (const file of profile.files) {
    const id = sourceNames.get(file.path), donorId = donorNames.get(file.donorPath);
    handledDonorPaths.add(file.donorPath);
    if (id === undefined) throw new Error(`Missing US file: ${file.path}`);
    const a = source.files[id];
    if (donorId === undefined) {
      await record("file", file.path, a, new Uint8Array(), file.sha256, a, "skipped", { sourceFileId: id, reason: "The donor is missing this stock file." }); continue;
    }
    const b = donor.files[donorId], ids = { sourceFileId: id, donorFileId: donorId };
    // Scripts must see the final imported/retained text and data, regardless of profile file order.
    if (file.path === "a/0/5/6") continue;
    if (protectedSource.has(id) || protectedDonor.has(donorId) || file.path.endsWith(".srl")) {
      if (!translationBytesEqual(a, b)) await record("file", file.path, a, b, file.sha256, a, "retained", { ...ids, reason: "Executable files are not transplanted." }); continue;
    }
    if (translationBytesEqual(a, b)) continue;
    if (file.members === undefined) {
      // Stock non-NARC data is imported by path; added executables never enter this list.
      replacements.set(id, b);
      await record("file", file.path, a, b, file.sha256, b, "imported", ids); continue;
    }
    let us: NARC, regional: NARC;
    try {
      us = readTranslationArchive(a); regional = readTranslationArchive(b);
      if (regional.files.length !== file.members || us.files.length !== file.sourceMembers) throw new Error("Member count differs from the audited layout; expansions require a separate port.");
    } catch (error) {
      await record("file", file.path, a, b, file.sha256, a, "skipped", { ...ids, reason: error instanceof Error ? error.message : String(error) }); continue;
    }
    const merged = new NARC(); merged.files = us.files.slice(); merged.filenames = regional.filenames; merged.endiannessOfBeginning = regional.endiannessOfBeginning;
    const imported: number[] = [];
    for (let member = 0; member < regional.files.length; member++) {
      const original = us.files[member], incoming = regional.files[member];
      if (original && translationBytesEqual(original, incoming)) continue;
      const baseline = file.regionalMembers?.[member];
      let output = incoming, reason: string | undefined, importReason: string | undefined, omittedEntries: number | undefined;
      let adjustedTextEntries: TranslationRecord["adjustedTextEntries"];
      if (file.path === "a/0/0/2" && profile.alphabetBanks.includes(member)) reason = "Keep US alphabetical search IDs and lookup ordering.";
      if (!reason && file.path === "a/0/3/4" && (member === 6 || member === 7)) {
        // The US menu copies these maps with a fixed row stride. Its labels come from message banks.
        if (!original || !translationMenuMapCompatible(original, incoming)) reason = "Keep US main-menu tilemap dimensions and row stride; localized labels are imported separately.";
      }
      if (!reason && (file.path === "a/0/0/2" || file.path === "a/0/0/3" || ["a/1/1/2", "a/1/1/3", "a/1/1/4", "a/1/1/5"].includes(file.path) && member === 1)) {
        try {
          if (!original || readU16(original, 0) !== readU16(incoming, 0)) throw new Error("Text block count changed.");
          const limit = file.path === "a/0/0/3" ? profile.storyBankLimits[member] : undefined;
          const entries = decodeGen5TextBank(incoming);
          if (limit !== undefined) {
            if (readU16(original, 2) !== limit || readU16(incoming, 2) < limit) throw new Error("Text entry limit does not match the US IDs.");
            omittedEntries = readU16(incoming, 2) - limit;
            output = encodeGen5TextBank(entries.filter(([entry]) => Number(entry.match(/^\d+_(\d+)/u)?.[1]) < limit));
            if (omittedEntries) importReason = `Keep US message IDs 0–${limit - 1}; omit ${omittedEntries} appended regional entries whose callers are not ported.`;
          } else if (readU16(original, 2) !== readU16(incoming, 2)) throw new Error("Text entry count changed; preserve the stock message IDs.");
          const label = file.path === "a/0/0/2" && member === 371 ? MAIN_MENU_LABEL_ADAPTATIONS[profile.locale] : undefined;
          const entry = label && entries.find(item => item[0] === "0_3" && item[1] === label.before);
          if (label && entry) {
            adjustedTextEntries = [{ id: entry[0], before: entry[1], after: label.after }];
            entry[1] = label.after; output = encodeGen5TextBank(entries);
          }
        } catch (error) { reason = error instanceof Error ? error.message : String(error); }
      }
      // Fixed-size gameplay records must keep the US binary schema.
      if (!reason && ["a/0/1/2", "a/0/1/6", "a/0/2/1", "a/0/2/4", "a/1/6/3"].includes(file.path) && (!original || original.length !== incoming.length)) reason = "Gameplay record size changed; native US readers expect the stock schema.";
      if (reason) {
        await record("member", file.path, original, incoming, baseline, original, "retained", { ...ids, member, reason }); continue;
      }
      // Preserve origin language while importing actual trade edits.
      if (file.path === "a/1/6/3" && original && incoming.length > 88) {
        output = incoming.slice(); output[88] = original[88];
        reason = "Keep US OT origin language at byte 88; import other trade fields.";
      }
      if (original && translationBytesEqual(original, output)) {
        await record("member", file.path, original, incoming, baseline, original, "retained", { ...ids, member, reason }); continue;
      }
      merged.files[member] = output;
      imported.push(member);
      await record("member", file.path, original, incoming, baseline, output, "imported", { ...ids, member,
        reason: adjustedTextEntries ? "Shorten the stock main-menu WFC label to fit the US button width." : importReason ?? reason, omittedEntries, adjustedTextEntries });
    }
    if (imported.length) {
      const bytes = merged.save(); replacements.set(id, bytes);
      await record("file", file.path, a, b, file.sha256, bytes, "imported", { ...ids, changedMemberIds: imported });
    } else if (!records.some(item => item.path === file.path)) {
      await record("file", file.path, a, b, file.sha256, a, "retained", { ...ids, reason: "Only archive packing or metadata changed; no member payload differs." });
    }
  }
  const scriptFile = profile.files.find(file => file.path === "a/0/5/6");
  if (scriptFile) {
    const sourceId = sourceNames.get(scriptFile.path)!, donorId = donorNames.get(scriptFile.donorPath);
    if (donorId !== undefined) {
      const a = source.files[sourceId], b = donor.files[donorId], ids = { sourceFileId: sourceId, donorFileId: donorId };
      try {
        const us = readTranslationArchive(a), incoming = readTranslationArchive(b);
        if (us.files.length !== scriptFile.sourceMembers || incoming.files.length !== scriptFile.members) throw new Error("Script archive member count changed; the native US global script table requires the stock member IDs.");
        const archiveCache = new Map<string, NARC | undefined>();
        const archive = (kind: "source" | "donor" | "output", path: string): NARC | undefined => {
          const key = `${kind}/${path}`;
          if (!archiveCache.has(key)) {
            const id = (kind === "donor" ? donorNames : sourceNames).get(path);
            const bytes = id === undefined ? undefined : kind === "donor" ? donor.files[id] : kind === "output" ? replacements.get(id) ?? source.files[id] : source.files[id];
            try { archiveCache.set(key, bytes ? readTranslationArchive(bytes) : undefined); } catch { archiveCache.set(key, undefined); }
          }
          return archiveCache.get(key);
        };
        const textCache = new Map<string, Map<number, string>>();
        const text = (kind: "source" | "donor" | "output") => (bank: number, id: number) => {
          const key = `${kind}/${bank}`;
          if (!textCache.has(key)) {
            const bytes = archive(kind, "a/0/0/3")?.files[bank];
            try { textCache.set(key, new Map(bytes ? decodeGen5TextBank(bytes).filter(([entry]) => entry.startsWith("0_")).map(([entry, value]) => [Number(entry.match(/^0_(\d+)/u)![1]), value]) : [])); }
            catch { textCache.set(key, new Map()); }
          }
          return textCache.get(key)!.get(id);
        };
        const headers = archive("output", "a/0/1/2")?.files[0], originalHeaders = archive("source", "a/0/1/2")?.files[0];
        const bindingCache = new Map<number, { entry: number; slot: number } | undefined>();
        const slots = (value: string) => [...new Set(Array.from(value.matchAll(/VAR\((\d+),\s*(\d+)(?:,|\))/gu)).filter(match => Number(match[1]) >= 256 && Number(match[1]) < 768).map(match => Number(match[2])))];
        const addedBankWordSlot = (bank: number) => {
          if (!bindingCache.has(bank)) {
            text("source")(bank, 0); text("output")(bank, 0);
            const before = textCache.get(`source/${bank}`)!, after = textCache.get(`output/${bank}`)!;
            let binding: { entry: number; slot: number } | undefined;
            for (const [entry, value] of after) {
              const original = before.get(entry); if (original === undefined) continue;
              const existing = slots(original), added = slots(value).find(slot => !existing.includes(slot));
              if (added !== undefined) { binding = { entry, slot: added }; break; }
            }
            bindingCache.set(bank, binding);
          }
          return bindingCache.get(bank);
        };
        const nativeChanges = new Set(records.filter(item => item.change !== "regional" && isTranslationNativeRecord(item)).map(item => item.path));
        const merged = new NARC(); merged.files = us.files.slice(); merged.filenames = incoming.filenames; merged.endiannessOfBeginning = incoming.endiannessOfBeginning;
        const imported: number[] = [];
        for (let member = 0; member < incoming.files.length; member++) {
          const original = us.files[member], donorBytes = incoming.files[member];
          const unchanged = translationBytesEqual(original, donorBytes);
          if (unchanged && !(member === 1281 && profile.storyBankLimits[436] !== undefined)) continue;
          const { bytes, audit } = auditTranslationScript({ member, original, incoming: donorBytes,
            locale: profile.locale,
            contexts: translationScriptContexts(member, headers, originalHeaders), sourceText: text("source"), donorText: text("donor"), outputText: text("output"),
            globalEntryCount: member => us.files[member] ? gen5ScriptEntries(us.files[member]).length : undefined,
            nativeChanges, addedBankWordSlot, dataCounts: { items: archive("output", "a/0/2/4")?.files.length ?? 0xffff, moves: archive("output", "a/0/2/1")?.files.length ?? 0xffff, species: archive("output", "a/0/1/6")?.files.length ?? 0xffff } });
          if (member === 1281 && profile.locale !== "korean") {
            audit.diagnostics.push({ code: "regional-native-text-selection", severity: "warning", offset: 9971, opcode: 1012, bank: 436, dependency: "overlay/arm9/127",
              reason: "The European helper selects appended negative-floor hints 592–599. The retained US helper uses 512–519; its selection logic is not transplanted." });
            audit.nativeDependencies.push({ opcode: 1012, segment: "overlay/arm9/127", resolution: "unresolved" });
          }
          scriptAudits.push(audit);
          if (unchanged) continue;
          const blocked = audit.diagnostics.filter(item => item.severity === "blocked");
          const reason = blocked.length ? `${blocked.length} unresolved script dependencies. ${blocked[0].reason}`
            : audit.rewrites.length ? "Imported script with audited US text-reference rewrites; see the script audit."
            : "Imported script after US command, entry, control-flow and output-text checks; inherited dynamic dependencies are logged in the script audit.";
          if (translationBytesEqual(bytes, original)) await record("member", scriptFile.path, original, donorBytes, scriptFile.regionalMembers?.[member], original, "retained", { ...ids, member, reason });
          else {
            merged.files[member] = bytes; imported.push(member);
            await record("member", scriptFile.path, original, donorBytes, scriptFile.regionalMembers?.[member], bytes, "imported", { ...ids, member, reason });
          }
        }
        if (imported.length) {
          const bytes = merged.save(); replacements.set(sourceId, bytes);
          await record("file", scriptFile.path, a, b, scriptFile.sha256, bytes, "imported", { ...ids, changedMemberIds: imported });
        } else if (!translationBytesEqual(a, b) && !records.some(item => item.path === scriptFile.path)) await record("file", scriptFile.path, a, b, scriptFile.sha256, a, "retained", { ...ids, reason: "Only archive packing changed; script payloads are unchanged." });
      } catch (error) {
        await record("file", scriptFile.path, a, b, scriptFile.sha256, a, "skipped", { ...ids, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  for (const [path, id] of donorNames) {
    if (!handledDonorPaths.has(path) && !protectedDonor.has(id)) await record("file", path, undefined, donor.files[id], undefined, undefined, "skipped", { donorFileId: id, reason: "Added or renamed donor files are outside the stock US file-ID contract." });
  }
  const namedDonorIds = new Set(donorNames.values());
  for (let id = 0; id < donor.files.length; id++) {
    if (!namedDonorIds.has(id) && !protectedDonor.has(id)) await record("file", `unnamed/${id}`, undefined, donor.files[id], undefined, undefined, "skipped", { donorFileId: id, reason: "An unnamed donor file cannot be matched to a stock US path." });
  }
  return { replacements, records, scriptAudits };
}
