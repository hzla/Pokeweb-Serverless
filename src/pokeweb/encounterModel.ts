import {
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_GRASS_PERCENTAGES,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  ENCOUNTER_WATER_PERCENTAGES,
} from "./constants";
import { parseHeaders } from "./headerModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";

export type EncounterSeason = (typeof ENCOUNTER_SEASONS)[number];
export type EncounterGroup = "grass" | "water";
export type EncounterKind = (typeof ENCOUNTER_GRASS_FIELDS)[number] | (typeof ENCOUNTER_WATER_FIELDS)[number];

export type EncounterRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
  locations: string[];
  wilds: string[];
  spriteSlugs: string[];
};

export type EncounterUpdateResult = {
  field: string;
  value: string | number;
  rawValue: number;
};

const SLOT_FIELD_RE = /^(spring|summer|fall|winter)_(grass|grass_doubles|grass_special|surf|surf_special|super_rod|super_rod_special)_slot_(\d+)$/u;
const FORM_FIELD_RE = /^(spring|summer|fall|winter)_(grass|grass_doubles|grass_special|surf|surf_special|super_rod|super_rod_special)_slot_(\d+)_form$/u;

export function getEncounterCount(project: ProjectState): number {
  return project.narcs.encounters?.fileCount ?? 0;
}

export function getEncounterRecord(project: ProjectState, encounterId: number): EncounterRecord {
  const record = decodeRecord(project, "encounters", encounterId);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode encounter ${encounterId}`);
  syncEncounterReadable(project, record.raw, record.readable);
  const wilds = deriveWilds(record.readable);
  return {
    id: encounterId,
    raw: record.raw,
    readable: record.readable,
    locations: deriveLocations(project, encounterId),
    wilds,
    spriteSlugs: wilds.map(spriteSlug),
  };
}

export function getEncounterAutofills(project: ProjectState): Record<string, string[]> {
  return {
    pokemon_names: project.texts.banks.pokedex ?? [],
  };
}

export function encounterMatchesSearch(record: EncounterRecord, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = JSON.stringify(record).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function updateEncounterField(project: ProjectState, encounterId: number, field: string, inputValue: string): EncounterUpdateResult {
  const record = decodeRecord(project, "encounters", encounterId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update encounter ${encounterId}`);
  syncEncounterReadable(project, record.raw, record.readable);

  const trimmedValue = inputValue.trim();
  const speciesMatch = SLOT_FIELD_RE.exec(field);
  if (speciesMatch) {
    const speciesId = parsePokemonId(project, trimmedValue);
    const form = speciesId === 0 ? 0 : Number(record.readable[`${field}_form`] ?? 0);
    const rawValue = speciesId + form * 2048;
    record.raw[field] = rawValue;
    record.readable[field] = speciesId === 0 ? "" : (project.texts.banks.pokedex?.[speciesId] ?? String(speciesId));
    record.readable[`${field}_form`] = form;
    markDirty(project, "encounters", encounterId);
    return { field, value: record.readable[field], rawValue };
  }

  const formMatch = FORM_FIELD_RE.exec(field);
  if (formMatch) {
    const value = parseInteger(trimmedValue, 0, 100, field);
    const baseField = field.replace(/_form$/u, "");
    const speciesId = (record.raw[baseField] ?? 0) % 2048;
    const rawValue = speciesId + value * 2048;
    record.raw[baseField] = rawValue;
    record.readable[field] = value;
    markDirty(project, "encounters", encounterId);
    return { field, value, rawValue };
  }

  if (field.endsWith("_rate") || field.endsWith("_min_level") || field.endsWith("_max_level")) {
    const value = parseInteger(trimmedValue, 0, 100, field);
    record.raw[field] = value;
    record.readable[field] = value;
    markDirty(project, "encounters", encounterId);
    return { field, value, rawValue: value };
  }

  throw new Error(`Unsupported encounter field: ${field}`);
}

export function copyEncounterSeason(project: ProjectState, encounterId: number, sourceSeason: EncounterSeason): EncounterRecord {
  const record = decodeRecord(project, "encounters", encounterId);
  if (!record.raw || !record.readable) throw new Error(`Unable to update encounter ${encounterId}`);

  for (const targetSeason of ENCOUNTER_SEASONS) {
    if (targetSeason === sourceSeason) continue;
    for (const [field, value] of Object.entries(record.raw)) {
      if (!field.startsWith(`${sourceSeason}_`)) continue;
      const targetField = `${targetSeason}_${field.slice(sourceSeason.length + 1)}`;
      record.raw[targetField] = value;
    }
  }

  syncEncounterReadable(project, record.raw, record.readable);
  markDirty(project, "encounters", encounterId);
  return getEncounterRecord(project, encounterId);
}

export function encounterKindsForGroup(group: EncounterGroup): readonly EncounterKind[] {
  return group === "grass" ? ENCOUNTER_GRASS_FIELDS : ENCOUNTER_WATER_FIELDS;
}

export function encounterSlotCount(kind: EncounterKind): number {
  return (ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? 12 : 5;
}

export function encounterPercentFor(kind: EncounterKind, slot: number): number {
  return ((ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? ENCOUNTER_GRASS_PERCENTAGES : ENCOUNTER_WATER_PERCENTAGES)[slot] ?? 0;
}

export function syncEncounterReadable(project: ProjectState, raw: RawRecord, readable: ReadableRecord): void {
  const pokedex = project.texts.banks.pokedex ?? [];
  for (const season of ENCOUNTER_SEASONS) {
    for (const kind of ENCOUNTER_GRASS_FIELDS) {
      for (let slot = 0; slot < 12; slot += 1) decodeSpecies(raw, readable, pokedex, `${season}_${kind}_slot_${slot}`);
    }
    for (const kind of ENCOUNTER_WATER_FIELDS) {
      for (let slot = 0; slot < 5; slot += 1) decodeSpecies(raw, readable, pokedex, `${season}_${kind}_slot_${slot}`);
    }
  }
}

function deriveLocations(project: ProjectState, encounterId: number): string[] {
  try {
    if (!project.headers) project.headers = parseHeaders(project);
  } catch {
    return [];
  }
  const locations: string[] = [];
  for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
    const row = project.headers.rows[rowId];
    if (Number(row?.encounter_id) === encounterId) locations.push(`${row.location_name} (${rowId})`);
  }
  return locations;
}

function deriveWilds(readable: ReadableRecord): string[] {
  const wilds: string[] = [];
  for (const season of ENCOUNTER_SEASONS) {
    for (const kind of ENCOUNTER_GRASS_FIELDS) {
      for (let slot = 0; slot < 12; slot += 1) addUniqueWild(wilds, readable[`${season}_${kind}_slot_${slot}`]);
    }
    for (const kind of ENCOUNTER_WATER_FIELDS) {
      for (let slot = 0; slot < 5; slot += 1) addUniqueWild(wilds, readable[`${season}_${kind}_slot_${slot}`]);
    }
  }
  return wilds;
}

function addUniqueWild(wilds: string[], value: unknown): void {
  const name = String(value ?? "").trim();
  if (!name || name === "-") return;
  const cleanName = name.replace(/[^0-9A-Za-z -]/gu, "");
  if (cleanName && !wilds.includes(cleanName)) wilds.push(cleanName);
}

function decodeSpecies(raw: RawRecord, readable: ReadableRecord, pokedex: string[], field: string): void {
  const rawValue = raw[field] ?? 0;
  const speciesId = rawValue % 2048;
  readable[field] = speciesId === 0 ? "" : (pokedex[speciesId] ?? String(speciesId));
  readable[`${field}_form`] = Math.floor(rawValue / 2048);
}

function parsePokemonId(project: ProjectState, value: string): number {
  if (value === "" || value === "-") return 0;
  if (/^\d+$/u.test(value)) return parseInteger(value, 0, 2047, "Pokemon");
  const pokedex = project.texts.banks.pokedex ?? [];
  const index = pokedex.findIndex((name) => name.toLowerCase() === value.toLowerCase());
  if (index < 0) throw new Error(`Unknown Pokemon: ${value}`);
  return index;
}

function parseInteger(value: string, min: number, max: number, field: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return parsed;
}

export function spriteSlug(name: string): string {
  return pokemonSpriteSlug(name);
}
