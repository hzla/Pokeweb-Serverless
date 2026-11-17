import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { megaEvolutionRoutes } from "./megaEvolutionModel";
import { getMovePreview, type LearnsetMove } from "./pokemonModel";
import type { ProjectState } from "./projectStore";

const PERSONAL_PATH = "a/0/1/6";
/** Retail Black 2 / White 2's first form record: the species expansion moves the records from here on. */
const RETAIL_FIRST_FORM_RECORD = 685;

// A dedicated new folder lets NitroFS append this archive without renumbering
// any existing file IDs (members inside an existing folder must stay contiguous).
export const KO_MOVE_LEARNSET_PATH = "battlelog_ko/learnsets.narc";
export const KO_MOVE_LEARNSET_MAX_MOVES = 32;

export type KoMoveLearnsetEntry = {
  index: number;
  moveId: number;
  moveName: string;
  koCount: number;
  type: string;
  category: string;
  power: number | string;
  accuracy: number | string;
};

export function hasKoMoveLearnset(project: ProjectState): boolean {
  return Boolean(currentKoLearnsetBytes(project));
}

export function hydrateKoMoveLearnsetFromRom(project: ProjectState, rom: NintendoDSRom): void {
  const fileId = rom.filenames.idOf(KO_MOVE_LEARNSET_PATH);
  if (fileId === undefined) {
    delete project.koMoveLearnsetSource;
    return;
  }
  // This small archive outlives the parser and must not pin the entire ROM.
  project.koMoveLearnsetSource = { fileId, bytes: rom.files[fileId]!.slice() };

  // Older installers lost sight of the source archive after autosave removed
  // originalRomBytes. They staged an empty duplicate, possibly followed by
  // actual KO edits. Recover per member: retain original lists for untouched
  // empty rows, but honor explicit edits (including an intentional deletion).
  const duplicate = project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
  if (!duplicate) return;
  const original = new NARC(project.fileSystem?.replacements?.[fileId] ?? rom.files[fileId]);
  const added = new NARC(duplicate);
  validateKoMoveNarc(original);
  validateKoMoveNarc(added);
  const edited = new Set((project.actionChangelog?.entries ?? [])
    .map((entry) => /^pokemon:(\d+):ko-learnset$/u.exec(entry.key)?.[1])
    .filter((id): id is string => id !== undefined).map(Number));
  for (let member = 0; member < added.files.length; member += 1) {
    if (member >= original.files.length || edited.has(member) || decodeRawEntries(added.files[member]!).length > 0) {
      original.files[member] = added.files[member]!;
    }
  }
  setRomFileReplacement(project, fileId, original.save());
  delete project.fileSystem!.additions![KO_MOVE_LEARNSET_PATH];
}

export function ensureKoMoveLearnsetNarc(project: ProjectState): { path: string; members: number; bytes: number } {
  const minimumMembers = Math.max(
    project.narcs.learnsets?.fileCount ?? 0,
    project.narcs.evolutions?.fileCount ?? 0,
    project.narcs.personal?.fileCount ?? 0,
  );
  if (minimumMembers <= 0) throw new Error("Load Pokemon learnsets before installing the enhanced party-menu patch.");

  const existing = currentKoLearnsetBytes(project);
  const narc = existing ? new NARC(existing) : new NARC();
  let changed = !existing;
  if (existing && followPersonalRecords(project, narc, project.narcs.personal?.rawFiles)) changed = true;
  if (existing && mirrorMegaForms(narc, megaKoMirrors(project, project.narcs.personal?.rawFiles))) changed = true;
  while (narc.files.length < minimumMembers) {
    narc.files.push(emptyKoMoveMember());
    changed = true;
  }
  validateKoMoveNarc(narc);
  const bytes = changed ? narc.save() : existing!;
  if (changed) stageKoLearnsetBytes(project, bytes);
  return { path: KO_MOVE_LEARNSET_PATH, members: narc.files.length, bytes: bytes.length };
}

/**
 * Keeps the KO learnset archive in step with the personal archive. The Battle Counters runtime reads it at the
 * Pokémon's personal record (species + form) after every KO, and a record past its end fails an assertion (the error
 * screen): forms added after the KO moves were installed (Mega Evolution, Regional Forms, the editor) and the species
 * expansion's records did that.
 * - Missing members are added empty: a permanent form (a regional one) has KO moves of its own.
 * - A Mega form's member is its source form's: a KO while Mega Evolved counts toward the base form's KO moves.
 * - A species expansion installed before its installer moved the form records' members has them moved now.
 * Returns whether the archive changed.
 */
export function syncKoMoveLearnsetWithPersonal(project: ProjectState, rom?: NintendoDSRom): boolean {
  const existing = currentKoLearnsetBytes(project);
  if (!existing) return false;
  const personalId = rom?.filenames.idOf(PERSONAL_PATH);
  const personal = project.narcs.personal?.rawFiles
    ?? (personalId !== undefined ? new NARC(project.fileSystem?.replacements?.[personalId] ?? rom!.files[personalId]).files : undefined);
  if (!personal) return false;
  const narc = new NARC(existing);
  const grown = followPersonalRecords(project, narc, personal);
  const mirrored = mirrorMegaForms(narc, megaKoMirrors(project, personal, rom));
  if (!grown && !mirrored) return false;
  validateKoMoveNarc(narc);
  stageKoLearnsetBytes(project, narc.save());
  return true;
}

/** Inserts empty members at `at` (the species expansion moves the personal form records from there by `count`). */
export function insertKoMoveLearnsetMembers(project: ProjectState, at: number, count: number): void {
  const existing = currentKoLearnsetBytes(project);
  if (!existing) return;
  const narc = new NARC(existing);
  if (narc.files.length <= at) return;
  narc.files.splice(at, 0, ...Array.from({ length: count }, emptyKoMoveMember));
  stageKoLearnsetBytes(project, narc.save());
}

/** The base form whose KO moves a Mega form uses (personal IDs), or undefined for any other Pokémon. */
export function koMoveMirrorSource(project: ProjectState, speciesId: number): number | undefined {
  return megaKoMirrors(project, project.narcs.personal?.rawFiles).get(speciesId);
}

function followPersonalRecords(project: ProjectState, narc: NARC, personal: readonly Uint8Array[] | undefined): boolean {
  if (!personal?.length) return false;
  let changed = false;
  // A species expansion installed before its installer moved these members: its records moved past the added species.
  const expansion = project.codeInjection?.speciesExpansion;
  if (expansion && narc.files.length > RETAIL_FIRST_FORM_RECORD && narc.files.length < RETAIL_FIRST_FORM_RECORD + expansion.formShift) {
    narc.files.splice(RETAIL_FIRST_FORM_RECORD, 0, ...Array.from({ length: expansion.formShift }, emptyKoMoveMember));
    changed = true;
  }
  while (narc.files.length < personal.length) {
    narc.files.push(emptyKoMoveMember());
    changed = true;
  }
  return changed;
}

/** Mega form → source form, as personal IDs (a species record names its first form record, u16 at 0x1c). */
function megaKoMirrors(project: ProjectState, personal: readonly Uint8Array[] | undefined, rom?: NintendoDSRom): Map<number, number> {
  const mirrors = new Map<number, number>();
  if (!personal?.length) return mirrors;
  const recordOf = (species: number, form: number) => {
    if (!form) return species;
    const record = personal[species];
    const first = record && record.length >= 0x1e ? readU16(record, 0x1c) : 0;
    return first ? first + form - 1 : undefined;
  };
  for (const route of megaEvolutionRoutes(project, rom)) {
    const target = recordOf(route.species, route.targetForm), source = recordOf(route.species, route.sourceForm);
    if (target !== undefined && source !== undefined && target !== source && target < personal.length) mirrors.set(target, source);
  }
  return mirrors;
}

function mirrorMegaForms(narc: NARC, mirrors: ReadonlyMap<number, number>): boolean {
  let changed = false;
  for (const [target, source] of mirrors) {
    const from = narc.files[source];
    if (!from || target >= narc.files.length || bytesEqual(narc.files[target]!, from)) continue;
    narc.files[target] = from.slice();
    changed = true;
  }
  return changed;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export function getPokemonKoMoves(project: ProjectState, speciesId: number): KoMoveLearnsetEntry[] {
  const narc = loadKoMoveNarc(project);
  // A Mega form shows its base form's (what the runtime gets: the export copies them).
  const member = koMoveMirrorSource(project, speciesId) ?? speciesId;
  if (!narc || member < 0 || member >= narc.files.length) return [];
  return decodeKoMoveMember(project, narc.files[member]!);
}

export function appendPokemonKoMove(project: ProjectState, speciesId: number): KoMoveLearnsetEntry[] {
  const entries = rawEntries(project, speciesId);
  return insertPokemonKoMove(project, speciesId, entries.length);
}

export function insertPokemonKoMove(project: ProjectState, speciesId: number, index: number): KoMoveLearnsetEntry[] {
  const entries = rawEntries(project, speciesId);
  if (entries.length >= KO_MOVE_LEARNSET_MAX_MOVES) {
    throw new Error(`KO learnset cannot exceed ${KO_MOVE_LEARNSET_MAX_MOVES} moves`);
  }
  const insertAt = Math.max(0, Math.min(index, entries.length));
  const template = entries[Math.max(0, insertAt - 1)]
    ?? entries[insertAt]
    ?? { moveId: firstUsableMoveId(project), koCount: 1 };
  entries.splice(insertAt, 0, { ...template });
  writePokemonEntries(project, speciesId, entries, `KO move slot ${insertAt + 1} was added.`);
  return getPokemonKoMoves(project, speciesId);
}

export function deletePokemonKoMove(project: ProjectState, speciesId: number, index: number): KoMoveLearnsetEntry[] {
  const entries = rawEntries(project, speciesId);
  if (index < 0 || index >= entries.length) throw new Error(`KO move row ${index} does not exist`);
  entries.splice(index, 1);
  writePokemonEntries(project, speciesId, entries, `KO move slot ${index + 1} was removed.`);
  return getPokemonKoMoves(project, speciesId);
}

export function copyPokemonKoMoves(project: ProjectState, speciesId: number, sourceSpeciesId: number): KoMoveLearnsetEntry[] {
  const narc = requiredKoMoveNarc(project);
  if (!Number.isInteger(sourceSpeciesId) || sourceSpeciesId < 1 || sourceSpeciesId >= narc.files.length) {
    throw new Error(`No KO learnset is available for species ${sourceSpeciesId}`);
  }
  writePokemonEntries(project, speciesId, rawEntries(project, sourceSpeciesId), `KO learnset was copied from species ${sourceSpeciesId}.`);
  return getPokemonKoMoves(project, speciesId);
}

export function updatePokemonKoMoveField(
  project: ProjectState,
  speciesId: number,
  fieldName: string,
  inputValue: string,
): { value: string | number; rawValue: number; movePreview?: Pick<LearnsetMove, "type" | "category" | "power" | "accuracy"> } {
  const match = /^(ko_count|move_id)_(\d+)$/u.exec(fieldName);
  if (!match) throw new Error(`Unsupported KO learnset field: ${fieldName}`);
  const entries = rawEntries(project, speciesId);
  const index = Number(match[2]);
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error(`KO move row ${index} does not exist`);

  if (match[1] === "ko_count") {
    const value = parseInteger(inputValue, 0, 0xffff, "KO count");
    entries[index]!.koCount = value;
    writePokemonEntries(project, speciesId, entries, `KO move ${index + 1} threshold changed to ${value}.`);
    return { value, rawValue: value };
  }

  const moveId = parseMoveId(project, inputValue);
  entries[index]!.moveId = moveId;
  writePokemonEntries(project, speciesId, entries, `KO move ${index + 1} changed to move ${moveId}.`);
  return {
    value: project.texts.banks.moves?.[moveId] ?? moveId,
    rawValue: moveId,
    movePreview: getMovePreview(project, moveId),
  };
}

function rawEntries(project: ProjectState, speciesId: number): Array<{ moveId: number; koCount: number }> {
  const narc = requiredKoMoveNarc(project);
  if (!Number.isInteger(speciesId) || speciesId < 0 || speciesId >= narc.files.length) {
    throw new Error(`No KO learnset is available for species ${speciesId}`);
  }
  return decodeRawEntries(narc.files[speciesId]!);
}

function writePokemonEntries(
  project: ProjectState,
  speciesId: number,
  entries: Array<{ moveId: number; koCount: number }>,
  description: string,
): void {
  const narc = requiredKoMoveNarc(project);
  if (!Number.isInteger(speciesId) || speciesId < 0 || speciesId >= narc.files.length) {
    throw new Error(`No KO learnset is available for species ${speciesId}`);
  }
  const mirrors = megaKoMirrors(project, project.narcs.personal?.rawFiles);
  const base = mirrors.get(speciesId);
  if (base !== undefined) throw new Error(`A Mega form uses its base form's KO moves: edit Pokémon ${base}'s.`);
  narc.files[speciesId] = encodeEntries(entries);
  mirrorMegaForms(narc, mirrors);
  stageKoLearnsetBytes(project, narc.save());
  recordGenericChange(project, "learnsets", `Pokemon ${speciesId} ${description}`, `Pokemon ${speciesId} KO Moves`, {
    key: `pokemon:${speciesId}:ko-learnset`,
  });
}

function decodeKoMoveMember(project: ProjectState, member: Uint8Array): KoMoveLearnsetEntry[] {
  return decodeRawEntries(member).map((entry, index) => ({
    index,
    moveId: entry.moveId,
    moveName: project.texts.banks.moves?.[entry.moveId] ?? `Move ${entry.moveId}`,
    koCount: entry.koCount,
    ...getMovePreview(project, entry.moveId),
  }));
}

function decodeRawEntries(member: Uint8Array): Array<{ moveId: number; koCount: number }> {
  if (member.length < 4 || member.length % 4 !== 0) throw new Error("Malformed KO learnset member");
  const entries: Array<{ moveId: number; koCount: number }> = [];
  for (let offset = 0; offset + 4 <= member.length; offset += 4) {
    const moveId = readU16(member, offset);
    const koCount = readU16(member, offset + 2);
    if (moveId === 0xffff) return entries;
    if (moveId !== 0) entries.push({ moveId, koCount });
    if (entries.length > KO_MOVE_LEARNSET_MAX_MOVES) throw new Error("KO learnset exceeds the 32-move runtime limit");
  }
  throw new Error("KO learnset member has no terminator");
}

function encodeEntries(entries: Array<{ moveId: number; koCount: number }>): Uint8Array {
  if (entries.length > KO_MOVE_LEARNSET_MAX_MOVES) throw new Error("KO learnset exceeds the 32-move runtime limit");
  const output = new Uint8Array((entries.length + 1) * 4);
  entries.forEach((entry, index) => {
    writeU16(output, index * 4, entry.moveId);
    writeU16(output, index * 4 + 2, entry.koCount);
  });
  writeU16(output, entries.length * 4, 0xffff);
  writeU16(output, entries.length * 4 + 2, 0xffff);
  return output;
}

function emptyKoMoveMember(): Uint8Array {
  return new Uint8Array([0xff, 0xff, 0xff, 0xff]);
}

function validateKoMoveNarc(narc: NARC): void {
  for (const member of narc.files) decodeRawEntries(member);
}

function requiredKoMoveNarc(project: ProjectState): NARC {
  // Forms can be appended after the companion was installed. Grow the
  // append-only archive before the first edit so their personal IDs remain a
  // direct member lookup just like the retail learnset NARC.
  ensureKoMoveLearnsetNarc(project);
  const narc = loadKoMoveNarc(project);
  if (!narc) throw new Error("Install the enhanced party-menu patch to create the KO move learnset NARC.");
  return narc;
}

function loadKoMoveNarc(project: ProjectState): NARC | undefined {
  const bytes = currentKoLearnsetBytes(project);
  if (!bytes) return undefined;
  const narc = new NARC(bytes);
  validateKoMoveNarc(narc);
  return narc;
}

function currentKoLearnsetBytes(project: ProjectState): Uint8Array | undefined {
  if (!project.koMoveLearnsetSource && project.originalRomBytes) {
    hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
  }
  const source = project.koMoveLearnsetSource;
  if (source) return project.fileSystem?.replacements?.[source.fileId] ?? source.bytes;
  const added = project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
  return added;
}

function stageKoLearnsetBytes(project: ProjectState, bytes: Uint8Array): void {
  if (!project.koMoveLearnsetSource && project.originalRomBytes) {
    hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
  }
  if (project.koMoveLearnsetSource) {
    setRomFileReplacement(project, project.koMoveLearnsetSource.fileId, bytes);
    delete project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
    return;
  }
  addRomFile(project, KO_MOVE_LEARNSET_PATH, bytes);
}

function parseMoveId(project: ProjectState, inputValue: string): number {
  const numeric = Number(inputValue.trim());
  const moveNames = project.texts.banks.moves ?? [];
  if (Number.isInteger(numeric) && numeric > 0 && numeric < Math.max(moveNames.length, 0x10000)) return numeric;
  const wanted = normalize(inputValue);
  const moveId = moveNames.findIndex((name) => normalize(name) === wanted);
  if (moveId <= 0) throw new Error(`Unknown move: ${inputValue}`);
  return moveId;
}

function firstUsableMoveId(project: ProjectState): number {
  return (project.texts.banks.moves?.length ?? 0) > 1 ? 1 : 0;
}

function parseInteger(value: string, min: number, max: number, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be ${min}–${max}`);
  return parsed;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
