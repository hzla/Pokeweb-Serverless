import { readAscii, readU16, readU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { validateDsRomSections } from "../nds/romValidation";
import { BW_NARCS, BW2_NARCS, EFFECT_CATEGORIES, STATS, STATUSES, TARGETS, VERSION_BY_ID_CODE_PREFIX, type NarcName } from "./constants";
import { getNarcFormats, type FieldSpec } from "./formats";
import { decodeGen5TextBank } from "./text";
import effectsText from "../assets/data/effects.txt?raw";
import resultEffectsText from "../assets/data/result_effects.txt?raw";

export type DataValidationSeverity = "error" | "warning";
export type DataValidationIssue = {
  severity: DataValidationSeverity;
  code: string;
  archive: string;
  path: string;
  record?: number;
  label?: string;
  field: string;
  offset?: number;
  value?: number | string;
  expected: string;
  message: string;
};
export type DataArchiveSummary = {
  archive: string;
  path: string;
  records: number;
  checked: number;
  skipped: number;
  errors: number;
  warnings: number;
};
export type RomDataValidationReport = {
  schemaVersion: 1;
  game: string;
  version: string;
  limits: { speciesRecords: number; moveRecords: number; itemRecords: number; abilityNames: number; types: number };
  archives: DataArchiveSummary[];
  errors: number;
  warnings: number;
  omittedIssues: number;
  issues: DataValidationIssue[];
  limitations: string[];
};

type Archive = { name: string; path: string; files: Uint8Array[]; summary: DataArchiveSummary };
type Row = { archive: Archive; id: number; bytes: Uint8Array; fields: Map<string, { offset: number; value: number }> };
const signed = (value: number) => value > 127 ? value - 256 : value;
const blank = (bytes: Uint8Array) => bytes.every(value => value === 0);
const effectCount = effectsText.split(/\r?\n/u).filter(Boolean).length;
// Blank lines are reserved IDs, not removable gaps (Embargo/Perish Song/Ingrain
// are native result effects 19/20/21).
const resultEffectCount = resultEffectsText.trimEnd().split(/\r?\n/u).length;
const core: NarcName[] = ["personal", "moves", "items", "learnsets", "evolutions", "egg_moves", "encounters", "trdata", "trpok", "ingame_trades", "marts", "mart_counts", "grottos"];

/** Inspect original bytes only. No loader repairs, encounter normalization or materialization. */
export function validateRomData(bytes: Uint8Array, options: { maxIssues?: number } = {}): RomDataValidationReport {
  const maxIssues = options.maxIssues ?? 10000;
  if (!Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > 100000) throw new Error("maxIssues must be an integer in 1..100000.");
  validateDsRomSections(bytes);
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const version = VERSION_BY_ID_CODE_PREFIX[rom.idCode.slice(0, 3)];
  if (!version || version.generation !== "gen5") throw new Error("Core data validation currently supports Black, White, Black 2 and White 2 ROMs.");
  const bw2 = version.baseRom === "BW2", formats = getNarcFormats(version.baseRom);
  const report: RomDataValidationReport = {
    schemaVersion: 1, game: rom.idCode, version: version.baseVersion,
    limits: { speciesRecords: 0, moveRecords: 0, itemRecords: 0, abilityNames: 165, types: 17 },
    archives: [], errors: 0, warnings: 0, omittedIssues: 0, issues: [],
    limitations: [
      "Known scalar ranges, record structure and references are checked. Bitfields, padding and unknown fields retain their storage-width semantics; their individual bits are not certified.",
      "Warnings include unusual values, inactive data and unknown custom-engine enums. A clean report is not a gameplay or native-patch compatibility certificate.",
      "Scripts, graphics, map/header data, executable move effects, machine/tutor tables, battle facilities and runtime DLL behavior are outside this scan.",
    ],
  };
  const errors: DataValidationIssue[] = [], warnings: DataValidationIssue[] = [];
  const summaries = new Map<string, DataArchiveSummary>();
  function emit(issue: DataValidationIssue): void {
    const summary = summaries.get(issue.archive);
    if (issue.severity === "error") { report.errors++; if (summary) summary.errors++; }
    else { report.warnings++; if (summary) summary.warnings++; }
    // Keep errors preferentially, but count every finding even after the detail cap.
    if (issue.severity === "error") {
      if (errors.length < maxIssues) { if (errors.length + warnings.length >= maxIssues) warnings.pop(); errors.push(issue); }
    } else if (errors.length + warnings.length < maxIssues) warnings.push(issue);
  }
  function issue(a: Archive, id: number | undefined, field: string, value: number | string | undefined, expected: string, code = "value.range", severity: DataValidationSeverity = "error", offset?: number): void {
    const label = id === undefined ? undefined : names[a.name === "personal" || ["learnsets", "evolutions", "egg_moves", "baby_species"].includes(a.name) ? "species" : a.name]?.[id];
    emit({ severity, code, archive: a.name, path: a.path, record: id, label, field, offset, value, expected, message: `${field}: expected ${expected}${value === undefined ? "" : `; found ${value}`}.` });
  }
  const names: Record<string, string[]> = {};
  const archives = new Map<string, Archive>();
  function load(name: string, path: string, required = true): Archive | undefined {
    const summary: DataArchiveSummary = { archive: name, path, records: 0, checked: 0, skipped: 0, errors: 0, warnings: 0 };
    summaries.set(name, summary); report.archives.push(summary);
    const a: Archive = { name, path, files: [], summary };
    const fileId = rom.filenames.idOf(path);
    if (fileId === undefined) { if (required) issue(a, undefined, "archive", undefined, "an existing NARC", "archive.missing"); return; }
    try {
      const data = rom.files[fileId];
      // NARC's general reader intentionally tolerates legacy container layouts.
      // Verify FAT bounds first so slice() cannot silently hide truncated members.
      if (data.length < 28 || readAscii(data, 0, 4) !== "NARC" || readAscii(data, 16, 4) !== "BTAF") throw new Error("Missing NARC/BTAF header");
      const count = readU16(data, 24), fatSize = readU32(data, 20), fnt = 16 + fatSize;
      if (readU16(data, 26) !== 0 || fatSize < 12 + count * 8 || fnt + 8 > data.length || readAscii(data, fnt, 4) !== "BTNF") throw new Error("Invalid FAT count, size or FNT bounds");
      let image = fnt + readU32(data, fnt + 4);
      if (readAscii(data, image, 4) !== "GMIF" && image >= 4 && readAscii(data, image - 4, 4) === "GMIF") {
        image -= 4; issue(a, undefined, "FNT size", undefined, "standard section sizes", "archive.legacy-layout", "warning");
      }
      if (image < fnt + 8 || image + 8 > data.length || readAscii(data, image, 4) !== "GMIF") throw new Error("Invalid image section bounds");
      const imageSize = readU32(data, image + 4);
      if (imageSize < 8) throw new Error("Invalid image section size");
      if (image + imageSize !== data.length) issue(a, undefined, "image size", imageSize, `${data.length - image} bytes matching the physical payload`, "archive.image-size", "warning", image + 4);
      let exceedsDeclaration = false;
      for (let id = 0; id < count; id++) {
        const start = readU32(data, 28 + id * 8), end = readU32(data, 32 + id * 8);
        if (start > end || end > data.length - image - 8) throw new Error(`Member ${id} exceeds physical image section bounds`);
        if (end > imageSize - 8) exceedsDeclaration = true;
      }
      if (exceedsDeclaration) issue(a, undefined, "image size", imageSize, "a declared image covering every physically present member", "archive.image-declaration", "warning", image + 4);
      if (readU32(data, 8) !== data.length) issue(a, undefined, "declared size", readU32(data, 8), `${data.length} bytes`, "archive.size", "warning", 8);
      a.files = new NARC(data).files; summary.records = a.files.length; archives.set(name, a); return a;
    } catch (error) { issue(a, undefined, "archive", String(error), "a structurally valid NARC", "archive.invalid"); }
  }
  const definitions = bw2 ? BW2_NARCS : BW_NARCS;
  for (const name of core) {
    const path = definitions.find(entry => entry.name === name)?.path;
    if (path) load(name, path);
  }
  load("baby_species", "a/0/2/0");
  const messages = load("message_texts", "a/0/0/2");
  const banks = bw2 ? { species: 90, moves: 403, items: 64, abilities: 374, types: 398, classes: 383 } : { species: 70, moves: 203, items: 54, abilities: 182, types: 199, classes: 191 };
  if (messages) for (const [name, bank] of Object.entries(banks)) {
    try {
      if (!messages.files[bank]) throw new Error("Missing name bank");
      names[name] = decodeGen5TextBank(messages.files[bank]).filter(entry => entry[0].startsWith("0_")).map(entry => entry[1]); messages.summary.checked++;
      if (!names[name].length) issue(messages, bank, name, 0, "a nonempty name bank", "text.empty");
    } catch (error) { issue(messages, bank, name, String(error), "a valid name bank", "text.invalid"); }
  }
  if (messages) messages.summary.skipped = Math.max(0, messages.files.length - messages.summary.checked);
  report.limits.types = names.types?.length ?? 0;
  report.limits.abilityNames = names.abilities?.length ?? 0;
  const personal = archives.get("personal"), moves = archives.get("moves"), items = archives.get("items");
  const personalSize = bw2 ? 76 : 60, dexIndex = bw2 ? 709 : 668;
  report.limits.speciesRecords = personal?.files.filter(file => file.length === personalSize).length ?? 0;
  report.limits.moveRecords = moves?.files.length ?? 0; report.limits.itemRecords = items?.files.length ?? 0;
  const realSpecies = (id: number) => !!personal?.files[id] && personal.files[id].length === personalSize && id !== dexIndex;
  const formOwners = new Map<number, number>();
  personal?.files.forEach((file, id) => {
    if (file.length !== personalSize || id === dexIndex) return;
    const start = readU16(file, 28), count = file[32];
    if (start && count > 1 && start + count - 1 <= personal.files.length) for (let n = 0; n < count - 1; n++) formOwners.set(start + n, id);
  });
  function row(a: Archive, id: number, format: FieldSpec[], minimum: number): Row | undefined {
    const data = a.files[id];
    if (data.length < minimum) { issue(a, id, "record length", data.length, `at least ${minimum} bytes`, "record.truncated"); a.summary.skipped++; return; }
    const fields: Row["fields"] = new Map(); let offset = 0;
    for (const [size, name] of format) {
      if (offset + size > data.length) break;
      const value = size === 1 ? data[offset] : size === 2 ? readU16(data, offset) : size === 3 ? data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 : readU32(data, offset);
      fields.set(name, { offset, value }); offset += size;
    }
    a.summary.checked++; return { archive: a, id, bytes: data, fields };
  }
  function range(r: Row, field: string, min: number, max: number, severity: DataValidationSeverity = "error", transform = (v: number) => v): void {
    const f = r.fields.get(field); if (!f) return;
    const value = transform(f.value);
    if (value < min || value > max) issue(r.archive, r.id, field, value, `${min}..${max}`, "value.range", severity, f.offset);
  }
  function ref(a: Archive, id: number, field: string, value: number, kind: "species" | "moves" | "items", zero = true, severity: DataValidationSeverity = "error", offset?: number): boolean {
    const target = kind === "species" ? personal : archives.get(kind);
    if (!target) return false; // The missing/invalid archive already has an error.
    const valid = value === 0 ? zero : kind === "species" ? realSpecies(value) : value < target.files.length && target.files[value].length >= (kind === "moves" ? 34 : 36);
    if (!valid) issue(a, id, field, value, `an existing ${kind === "species" ? "personal record" : kind.slice(0, -1) + " record"}${zero ? " or 0" : ""}`, "reference.invalid", severity, offset);
    else if (value && blank(target.files[value])) issue(a, id, field, value, "an initialized referenced record", "reference.blank", "warning", offset);
    return valid;
  }
  function form(a: Archive, id: number, field: string, species: number, value: number, offset: number, random = false): void {
    if (value > 31) { issue(a, id, field, value, "a native form index in 0..31, or a reviewed engine extension", "form.storage", "warning", offset); return; }
    if (!realSpecies(species) || !value || random && value === 31) return;
    const count = Math.max(1, personal!.files[species][32]);
    // Some native cosmetic forms (e.g. Shellos) share one personal record and
    // do not enumerate all appearances in num_forms. Do not invent a bound.
    if (count === 1 && readU16(personal!.files[species], 28) === 0) return;
    if (value >= count) issue(a, id, field, value, `a declared form of species ${species} (0..${count - 1})`, "form.undeclared", "warning", offset);
  }

  personal?.files.forEach((file, id) => {
    if (id === dexIndex && file.length !== personalSize) {
      if (file.length < 2 || file.length % 2) issue(personal, id, "regional Dex table length", file.length, "a nonempty sequence of lookup words", "record.length");
      personal.summary.skipped++; return; // Regional-Dex lookup, not a Pokémon.
    }
    const r = row(personal, id, formats.personal!, personalSize); if (!r) return;
    if (id === 0 || blank(file)) { personal.summary.skipped++; personal.summary.checked--; return; }
    if (file.length !== personalSize) issue(personal, id, "record length", file.length, `${personalSize} bytes (custom extensions need review)`, "record.extended", "warning");
    for (const field of ["base_hp", "base_atk", "base_def", "base_speed", "base_spatk", "base_spdef"]) range(r, field, 1, 255, "warning");
    if (report.limits.types) { range(r, "type_1", 0, report.limits.types - 1); range(r, "type_2", 0, report.limits.types - 1); }
    range(r, "exp_rate", 0, 7); range(r, "exp_rate", 0, 5, "warning");
    range(r, "stage", 0, 3, "warning");
    range(r, "egg_group_1", 0, 15); range(r, "egg_group_2", 0, 15); range(r, "color", 0, 9, "error", v => v & 63);
    range(r, "num_forms", 1, 32, "warning"); range(r, "height", 1, 65535, "warning"); range(r, "weight", 1, 65535, "warning");
    const evs = readU16(file, 10), yieldSum = Array.from({ length: 6 }, (_, n) => evs >>> (n * 2) & 3).reduce((a, b) => a + b, 0);
    if (yieldSum > 3) issue(personal, id, "evs", yieldSum, "a typical total EV yield of 0..3", "personal.ev-yield", "warning", 10);
    for (let slot = 1; slot <= 3; slot++) {
      const at = 10 + slot * 2, word = readU16(file, at), ability = file[23 + slot] | (word & 0xc000) >>> 6;
      ref(personal, id, `item_${slot}`, word & 0x3fff, "items", true, "error", at);
      if (report.limits.abilityNames && ability >= report.limits.abilityNames) issue(personal, id, `ability_${slot}`, ability, `0..${report.limits.abilityNames - 1} (ability-name bank)`, "reference.ability", "error", 23 + slot);
    }
    const start = readU16(file, 28), count = Math.max(0, file[32] - 1);
    if (start) for (let n = 0; n < count; n++) if (!realSpecies(start + n)) { issue(personal, id, "form_id", start, `${count} consecutive personal form records`, "reference.form", "error", 28); break; }
  });

  moves?.files.forEach((file, id) => {
    const r = row(moves, id, formats.moves!, 36); if (!r) return;
    if (id === 0 || blank(file)) { moves.summary.skipped++; moves.summary.checked--; return; }
    if (report.limits.types) range(r, "type", 0, report.limits.types - 1); range(r, "category", 0, 2);
    range(r, "effect_category", 0, EFFECT_CATEGORIES.length - 1, "warning"); range(r, "status", 0, STATUSES.length - 1, "warning");
    range(r, "target", 0, TARGETS.length - 1, "warning"); range(r, "accuracy", 0, 101); // 101 is native always-hit.
    range(r, "effect", 0, effectCount - 1, "warning");
    if (readU16(file, 8) !== 0xffff) range(r, "result_effect", 0, resultEffectCount - 1, "warning"); // Tri Attack sentinel.
    for (const field of ["effect_chance", "flinch", "stat_chance_1", "stat_chance_2", "stat_chance_3"]) range(r, field, 0, 100);
    for (let n = 1; n <= 3; n++) { range(r, `stat_${n}`, 0, STATS.length - 1, "warning"); range(r, `magnitude_${n}`, -6, 6, "warning", signed); }
    range(r, "priority", -7, 7, "warning", signed); range(r, "recoil", -100, 100, "warning", signed); range(r, "healing", -100, 100, "warning", signed);
    range(r, "pp", 1, 255, "warning"); range(r, "crit", 0, 6, "warning"); // 6 guarantees a critical hit.
    const min = file[7] & 15, max = file[7] >>> 4;
    if (min > max && max) issue(moves, id, "hits", file[7], "packed minimum hits <= maximum hits", "value.order", "error", 7);
    if (file[12] > file[13] && file[13]) issue(moves, id, "min_turns", file[12], "minimum effect turns <= maximum", "value.order", "warning", 12);
    if (file.length > 36) issue(moves, id, "record length", file.length, "36 bytes (custom extensions need review)", "record.extended", "warning");
  });
  items?.files.forEach((file, id) => {
    const r = row(items, id, formats.items!, 36); if (!r) return;
    if (id === 0 || blank(file)) { items.summary.skipped++; items.summary.checked--; return; }
    if (report.limits.types && (readU16(file, 8) & 31) !== 31) range(r, "type_attribute", 0, report.limits.types - 1, "warning", v => v & 31); // 31 = no Natural Gift type.
    if (file.length > 36) issue(items, id, "record length", file.length, "36 bytes (custom extensions need review)", "record.extended", "warning");
  });

  const learnsets = archives.get("learnsets");
  for (const related of [learnsets, archives.get("evolutions")]) if (related && personal) {
    personal.files.forEach((_file, id) => { if (id && realSpecies(id) && !blank(personal.files[id]) && !related.files[id]) issue(related, id, "record", undefined, "a record for this personal entry", "reference.missing-record"); });
  }
  learnsets?.files.forEach((file, id) => {
    if (id === 0 || id === dexIndex && !realSpecies(id) || file.length === 0) {
      if (id && realSpecies(id) && !blank(personal!.files[id]) && !file.length) issue(learnsets, id, "record length", 0, "a terminated learnset (possibly empty)", "learnset.empty", "warning");
      learnsets.summary.skipped++; return;
    }
    learnsets.summary.checked++;
    if (file.length % 4) { issue(learnsets, id, "record length", file.length, "a multiple of four bytes", "record.length"); return; }
    if (file.length > 32 * 4 + 4) issue(learnsets, id, "move count", file.length / 4 - 1, "at most 32 moves, or a reviewed engine extension", "record.extended", "warning");
    let terminated = false, previous = 0;
    for (let at = 0; at < file.length; at += 4) {
      const move = readU16(file, at), level = readU16(file, at + 2);
      if (move === 0xffff) { terminated = true; if (at + 4 < file.length && !file.subarray(at + 4).every(v => v === 0 || v === 255)) issue(learnsets, id, "terminator", at, "no active data after the terminator", "learnset.trailing", "warning", at); break; }
      ref(learnsets, id, `move_${at / 4}`, move, "moves", false, "error", at);
      if (level > 100) issue(learnsets, id, `level_${at / 4}`, level, "0..100", "value.range", "error", at + 2);
      if (level > 0 && level < previous) issue(learnsets, id, `level_${at / 4}`, level, "nondecreasing levels", "learnset.order", "warning", at + 2);
      previous = level || previous;
    }
    if (!terminated) issue(learnsets, id, "terminator", undefined, "a 0xFFFF move terminator", "learnset.unterminated");
  });
  const eggMoves = archives.get("egg_moves");
  eggMoves?.files.forEach((file, id) => {
    if (!file.length && id === 0) { eggMoves.summary.skipped++; return; }
    eggMoves.summary.checked++;
    if (file.length < 2 || file.length % 2) { issue(eggMoves, id, "record length", file.length, "a count word followed by move words", "record.length"); return; }
    const count = readU16(file, 0), end = 2 + count * 2;
    if (end > file.length) { issue(eggMoves, id, "move count", count, `at most ${(file.length - 2) / 2} moves`, "record.count"); return; }
    if (end !== file.length) issue(eggMoves, id, "move count", count, `${(file.length - 2) / 2} moves matching payload length`, "record.trailing", "warning");
    for (let n = 0; n < count; n++) ref(eggMoves, id, `move_${n}`, readU16(file, 2 + n * 2), "moves", false, "error", 2 + n * 2);
  });
  const evolutions = archives.get("evolutions");
  evolutions?.files.forEach((file, id) => {
    if (id === 0 || id === dexIndex && !realSpecies(id)) { evolutions.summary.skipped++; return; }
    evolutions.summary.checked++;
    if (!file.length || file.length % 6) { issue(evolutions, id, "record length", file.length, "one or more six-byte evolution slots", "record.length"); return; }
    if (file.length !== 42 && file.length !== 48) issue(evolutions, id, "slot count", file.length / 6, "7 retail or 8 expanded slots, or a reviewed custom layout", "record.extended", "warning");
    for (let at = 0; at < file.length; at += 6) {
      const method = readU16(file, at), param = readU16(file, at + 2), target = readU16(file, at + 4), field = `slot_${at / 6}`;
      if (!method) { if (target || param) issue(evolutions, id, field, target, "zero parameters/target in an unused slot", "evolution.inactive", "warning", at); continue; }
      ref(evolutions, id, `${field}.target`, target, "species", false, "error", at + 4);
      if (target === id) issue(evolutions, id, `${field}.target`, target, "an evolution target distinct from itself", "evolution.self", "warning", at + 4);
      if ([6, 8, 17, 18, 19, 20].includes(method)) ref(evolutions, id, `${field}.item`, param, "items", false, "error", at + 2);
      else if ([7, 22].includes(method)) ref(evolutions, id, `${field}.species`, param, "species", method === 7, "error", at + 2); // Karrablast/Shelmet uses 0.
      else if (method === 21) ref(evolutions, id, `${field}.move`, param, "moves", false, "error", at + 2);
      else if (method === 16 && param > 255) issue(evolutions, id, `${field}.beauty`, param, "0..255", "value.range", "error", at + 2);
      else if ([2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 23, 24].includes(method) && param > 100) issue(evolutions, id, `${field}.level`, param, "0..100", "value.range", "error", at + 2);
      else if (method > 31) issue(evolutions, id, `${field}.method`, method, "a known method (0..31), or a reviewed engine extension", "enum.custom", "warning", at);
    }
  });

  const encounters = archives.get("encounters"), seasons = ["spring", "summer", "fall", "winter"];
  const kinds = ["grass", "grass_doubles", "grass_special", "surf", "surf_special", "super_rod", "super_rod_special"];
  encounters?.files.forEach((file, id) => {
    encounters.summary.checked++;
    if (file.length !== 232 && file.length !== 928) { issue(encounters, id, "record length", file.length, "232 bytes or four seasonal 232-byte blocks", "record.length"); return; }
    for (let season = 0; season < file.length / 232; season++) {
      const base = season * 232; let at = base + 8;
      for (const [k, kind] of kinds.entries()) {
        const rate = file[base + k], prefix = `${seasons[season]}.${kind}`;
        if (rate > 100) issue(encounters, id, `${prefix}.rate`, rate, "a typical 0..100 encounter rate; custom byte values need review", "value.range", "warning", base + k);
        for (let n = 0; n < (k < 3 ? 12 : 5); n++, at += 4) {
          const word = readU16(file, at), species = word & 2047, formId = word >>> 11, min = file[at + 2], max = file[at + 3], field = `${prefix}.slot_${n}`, severity = rate ? "error" : "warning";
          if (!word && !min && !max && !rate) continue;
          ref(encounters, id, `${field}.species`, species, "species", false, severity, at);
          if (min < 1 || max > 100 || min > max) issue(encounters, id, `${field}.levels`, `${min}..${max}`, "1 <= minimum <= maximum <= 100", "value.order", severity, at + 2);
          form(encounters, id, `${field}.form`, species, formId, at, true);
          if (formOwners.has(species)) issue(encounters, id, `${field}.species`, species, `base species ${formOwners.get(species)} plus a packed form`, "encounter.personal-form", "warning", at);
        }
      }
    }
  });

  const trainers = archives.get("trdata"), parties = archives.get("trpok");
  trainers?.files.forEach((file, id) => {
    if (id === 0 && file.length >= 4 && file[3] === 0) { trainers.summary.skipped++; if (parties?.files[id]) parties.summary.skipped++; return; }
    const r = row(trainers, id, formats.trdata!, 16); if (!r) return;
    if (file.length > 20) issue(trainers, id, "record length", file.length, "16..20 bytes, or a reviewed custom layout", "record.extended", "warning");
    range(r, "num_pokemon", 0, 6); range(r, "battle_type_1", 0, 3, "warning");
    if (names.classes?.length) range(r, "class", 0, names.classes.length - 1);
    for (let slot = 1; slot <= 4; slot++) ref(trainers, id, `item_${slot}`, readU16(file, 2 + slot * 2), "items", true, "error", 2 + slot * 2);
    if (file.length >= 20) ref(trainers, id, "reward_item", readU16(file, 18), "items", true, "error", 18);
    if (!parties) return;
    const count = file[3], template = file[0], party = parties.files[id];
    if (!party) { issue(trainers, id, "party", id, "a matching trainer-party member", "reference.party"); return; }
    if (template & ~3) { issue(trainers, id, "template", template, "known template flags 0..3; custom party layout requires review", "layout.custom", "warning", 0); parties.summary.skipped++; return; }
    parties.summary.checked++;
    const stride = 8 + (template & 2 ? 2 : 0) + (template & 1 ? 8 : 0), expected = stride * count;
    if (party.length < expected) { issue(parties, id, "record length", party.length, `${expected} bytes for ${count} party members`, "record.truncated"); return; }
    if (count && party.length > expected && !party.subarray(expected).every(value => value === 0 || value === 255)) issue(parties, id, "record length", party.length, `${expected} bytes plus optional padding`, "record.trailing", "warning");
    for (let n = 0; n < count; n++) {
      const at = n * stride, species = readU16(party, at + 4), formId = readU16(party, at + 6), level = party[at + 2], ability = party[at + 1] >>> 4, gender = party[at + 1] & 15;
      ref(parties, id, `slot_${n}.species`, species, "species", false, "error", at + 4);
      if (level < 1 || level > 100) issue(parties, id, `slot_${n}.level`, level, "1..100", "value.range", "error", at + 2);
      if (ability > 3 || gender > 2) issue(parties, id, `slot_${n}.gender_ability`, party[at + 1], "known gender/ability slot nibbles, or an engine extension", "enum.custom", "warning", at + 1);
      form(parties, id, `slot_${n}.form`, species, formId, at + 6);
      let next = at + 8;
      if (template & 2) { ref(parties, id, `slot_${n}.item`, readU16(party, next), "items", true, "error", next); next += 2; }
      if (template & 1) for (let move = 0; move < 4; move++) ref(parties, id, `slot_${n}.move_${move}`, readU16(party, next + move * 2), "moves", true, "error", next + move * 2);
      // at+0 is a 0..255 shared IV-quality value, not an individual 0..31 IV.
      // at+3 can carry explicit nature data in existing trainer-nature patches.
    }
  });
  if (parties && trainers && parties.files.length !== trainers.files.length) issue(parties, undefined, "member count", parties.files.length, `${trainers.files.length} trainer-party members`, "archive.count");
  if (parties && !trainers) parties.summary.skipped = parties.files.length;
  const babies = archives.get("baby_species");
  babies?.files.forEach((file, id) => {
    babies.summary.checked++;
    if (file.length < 2) { issue(babies, id, "record length", file.length, "a species word", "record.truncated"); return; }
    if (file.length > 2) issue(babies, id, "record length", file.length, "one species word", "record.extended", "warning");
    ref(babies, id, "baby_species", readU16(file, 0), "species", true, "error", 0);
  });

  const marts = archives.get("marts"), counts = archives.get("mart_counts");
  marts?.files.forEach((file, id) => {
    marts.summary.checked++;
    if (file.length % 2) { issue(marts, id, "record length", file.length, "a sequence of item words", "record.length"); return; }
    const count = counts?.files[0]?.[id] ?? file.length / 2;
    if (count > file.length / 2) issue(marts, id, "count", count, `at most ${file.length / 2} items`, "record.count");
    for (let at = 0; at < file.length; at += 2) ref(marts, id, `item_${at / 2}`, readU16(file, at), "items", true, at < count * 2 ? "error" : "warning", at);
  });
  if (counts && marts) {
    counts.summary.checked = counts.files.length;
    if (counts.files.length !== 1 || counts.files[0].length !== marts.files.length) issue(counts, undefined, "record length", counts.files[0]?.length, `${marts.files.length} count bytes in one member`, "record.count");
  }
  const grottos = archives.get("grottos");
  grottos?.files.forEach((file, id) => {
    const r = row(grottos, id, formats.grottos!, 220); if (!r) return;
    if (file.length > 220) issue(grottos, id, "record length", file.length, "220 bytes, or a reviewed custom layout", "record.extended", "warning");
    for (const [field, f] of r.fields) {
      if (/_item_\d+$/u.test(field)) ref(grottos, id, field, f.value, "items", true, "error", f.offset);
      const match = /^(white|black)_(rare|uncommon|common)_pok_(\d+)$/u.exec(field);
      if (!match || f.value === 0) continue;
      ref(grottos, id, field, f.value, "species", false, "error", f.offset);
      const prefix = `${match[1]}_${match[2]}`, slot = match[3], min = r.fields.get(`${prefix}_min_lvl_${slot}`)!, max = r.fields.get(`${prefix}_max_lvl_${slot}`)!;
      if (min.value < 1 || max.value > 100 || min.value > max.value) issue(grottos, id, `${field}.levels`, `${min.value}..${max.value}`, "1 <= minimum <= maximum <= 100", "value.order", "error", min.offset);
      range(r, `${prefix}_gender_${slot}`, 0, 100);
      const fId = r.fields.get(`${prefix}_form_${slot}`)!; form(grottos, id, `${field}.form`, f.value, fId.value, fId.offset);
    }
  });
  const trades = archives.get("ingame_trades");
  trades?.files.forEach((file, id) => {
    trades.summary.checked++;
    if (file.length < 108) { issue(trades, id, "record length", file.length, "at least 108 bytes", "record.truncated"); return; }
    if (file.length > 108) issue(trades, id, "record length", file.length, "108 bytes, or a reviewed custom layout", "record.extended", "warning");
    if (blank(file)) { trades.summary.skipped++; trades.summary.checked--; return; }
    const species = readU32(file, 4); ref(trades, id, "given_species", species, "species", false, "error", 4);
    ref(trades, id, "requested_species", readU32(file, 92), "species", false, "error", 92);
    ref(trades, id, "held_item", readU32(file, 76), "items", true, "error", 76);
    form(trades, id, "given_form", species, readU32(file, 8), 8);
    const level = readU32(file, 12); if (level > 100) issue(trades, id, "level", level, "0 (script-derived) or 1..100", "value.range", "error", 12);
    for (let n = 0; n < 6; n++) { const iv = readU32(file, 16 + n * 4); if (iv > 31 && iv !== 255 && iv !== 0xffffffff) issue(trades, id, `iv_${n}`, iv, "0..31, 255 or 0xFFFFFFFF (unspecified)", "value.range", "error", 16 + n * 4); }
    for (const [field, at, max] of [["ability_slot", 40, 2], ["nature", 44, 24], ["gender", 48, 2], ["ot_gender", 80, 2], ["requested_gender", 96, 2]] as const) {
      const value = readU32(file, at); if (value > max && value !== 255 && value !== 0xffffffff) issue(trades, id, field, value, `0..${max} or an unspecified sentinel`, "value.range", "warning", at);
    }
    for (const at of [56, 60, 64, 68, 72, 84]) if (readU32(file, at) > 255) issue(trades, id, `condition_0x${at.toString(16)}`, readU32(file, at), "0..255", "value.range", "warning", at);
  });
  report.issues = [...errors, ...warnings]; report.omittedIssues = report.errors + report.warnings - report.issues.length;
  return report;
}
