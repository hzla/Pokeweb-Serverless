import { readU16, writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { addRomFile, setRomFileReplacement } from "./fileSystemModel";
import { getMovePreview, type LearnsetMove } from "./pokemonModel";
import type { ProjectState } from "./projectStore";

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
  project.koMoveLearnsetSource = { fileId, bytes: rom.files[fileId]! };

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
  while (narc.files.length < minimumMembers) {
    narc.files.push(emptyKoMoveMember());
    changed = true;
  }
  validateKoMoveNarc(narc);
  const bytes = changed ? narc.save() : existing!;
  if (changed) stageKoLearnsetBytes(project, bytes);
  return { path: KO_MOVE_LEARNSET_PATH, members: narc.files.length, bytes: bytes.length };
}

export function getPokemonKoMoves(project: ProjectState, speciesId: number): KoMoveLearnsetEntry[] {
  const narc = loadKoMoveNarc(project);
  if (!narc || speciesId < 0 || speciesId >= narc.files.length) return [];
  return decodeKoMoveMember(project, narc.files[speciesId]!);
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
  narc.files[speciesId] = encodeEntries(entries);
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
    hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(project.originalRomBytes));
  }
  const source = project.koMoveLearnsetSource;
  if (source) return project.fileSystem?.replacements?.[source.fileId] ?? source.bytes;
  const added = project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
  return added;
}

function stageKoLearnsetBytes(project: ProjectState, bytes: Uint8Array): void {
  if (!project.koMoveLearnsetSource && project.originalRomBytes) {
    hydrateKoMoveLearnsetFromRom(project, new NintendoDSRom(project.originalRomBytes));
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
