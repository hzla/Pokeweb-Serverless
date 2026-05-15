import {
  ENCOUNTER_GRASS_FIELDS,
  ENCOUNTER_GRASS_PERCENTAGES,
  ENCOUNTER_SEASONS,
  ENCOUNTER_WATER_FIELDS,
  ENCOUNTER_WATER_PERCENTAGES,
} from "./constants";
import { writeU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { recordFieldChange, recordGenericChange } from "./actionChangelog";
import { parseHeaders } from "./headerModel";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
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
  grassWilds: string[];
  grassSpriteSlugs: string[];
  waterWilds: string[];
  waterSpriteSlugs: string[];
};

export type EncounterUpdateResult = {
  field: string;
  value: string | number;
  rawValue: number;
};

export type HabitatSyncResult = {
  habitats: number;
  species: number;
};

const SLOT_FIELD_RE = /^(spring|summer|fall|winter)_(grass|grass_doubles|grass_special|surf|surf_special|super_rod|super_rod_special)_slot_(\d+)$/u;
const FORM_FIELD_RE = /^(spring|summer|fall|winter)_(grass|grass_doubles|grass_special|surf|surf_special|super_rod|super_rod_special)_slot_(\d+)_form$/u;
const BW2_HABITAT_NARC_PATH = "a/2/9/6";
const BW2_HABITAT_ENCOUNTER_POOLS: readonly number[][] = [
  [104, 105, 10],
  [124],
  [134],
  [84, 85, 86],
  [23, 24, 25, 26],
  [97],
  [27, 28, 29, 30],
  [81, 82, 83],
  [125],
  [106],
  [98],
  [123],
  [132],
  [107],
  [43],
  [102, 103],
  [95],
  [127],
  [32, 33, 34, 35, 36],
  [111],
  [31, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80],
  [12, 13, 14, 15, 16, 17, 18, 19],
  [0],
  [128],
  [3],
  [116],
  [44, 45],
  [61, 62, 63, 64, 65, 66, 67, 68, 69, 70],
  [129],
  [4],
  [37, 38, 39, 40, 41],
  [118],
  [46, 47],
  [42],
  [1],
  [8, 9],
  [5],
  [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
  [6, 7],
  [112, 113, 114, 115],
  [130],
  [11],
  [119],
  [133],
  [99],
  [131],
  [2],
  [120],
  [100],
  [108, 109],
  [121],
  [101],
  [117],
  [96],
  [93, 94],
  [126],
  [122],
  [20, 21, 22],
];

export function getEncounterCount(project: ProjectState): number {
  return project.narcs.encounters?.fileCount ?? 0;
}

export function getEncounterRecord(project: ProjectState, encounterId: number): EncounterRecord {
  const record = decodeRecord(project, "encounters", encounterId);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode encounter ${encounterId}`);
  syncEncounterReadable(project, record.raw, record.readable);
  const grassWilds = deriveWilds(record.readable, "grass");
  const waterWilds = deriveWilds(record.readable, "water");
  const wilds = [...grassWilds];
  waterWilds.forEach((wild) => {
    if (!wilds.includes(wild)) wilds.push(wild);
  });
  return {
    id: encounterId,
    raw: record.raw,
    readable: record.readable,
    locations: deriveLocations(project, encounterId),
    wilds,
    spriteSlugs: wilds.map(spriteSlug),
    grassWilds,
    grassSpriteSlugs: grassWilds.map(spriteSlug),
    waterWilds,
    waterSpriteSlugs: waterWilds.map(spriteSlug),
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
    const before = record.readable[field] ?? "";
    const speciesId = parsePokemonId(project, trimmedValue);
    const form = speciesId === 0 ? 0 : Number(record.readable[`${field}_form`] ?? 0);
    const rawValue = speciesId + form * 2048;
    record.raw[field] = rawValue;
    record.readable[field] = speciesId === 0 ? "" : (project.texts.banks.pokedex?.[speciesId] ?? String(speciesId));
    record.readable[`${field}_form`] = form;
    markDirty(project, "encounters", encounterId);
    recordFieldChange(project, "encounters", encounterSubject(project, encounterId), encounterFieldLabel(field), before, record.readable[field], {
      key: `encounter:${encounterId}:${field}`,
    });
    return { field, value: record.readable[field], rawValue };
  }

  const formMatch = FORM_FIELD_RE.exec(field);
  if (formMatch) {
    const before = record.readable[field] ?? 0;
    const value = parseInteger(trimmedValue, 0, 100, field);
    const baseField = field.replace(/_form$/u, "");
    const speciesId = (record.raw[baseField] ?? 0) % 2048;
    const rawValue = speciesId + value * 2048;
    record.raw[baseField] = rawValue;
    record.readable[field] = value;
    markDirty(project, "encounters", encounterId);
    recordFieldChange(project, "encounters", encounterSubject(project, encounterId), encounterFieldLabel(field), before, value, {
      key: `encounter:${encounterId}:${field}`,
    });
    return { field, value, rawValue };
  }

  if (field.endsWith("_rate") || field.endsWith("_min_level") || field.endsWith("_max_level")) {
    const before = record.readable[field] ?? 0;
    const value = parseInteger(trimmedValue, 0, 100, field);
    record.raw[field] = value;
    record.readable[field] = value;
    markDirty(project, "encounters", encounterId);
    recordFieldChange(project, "encounters", encounterSubject(project, encounterId), encounterFieldLabel(field), before, value, {
      key: `encounter:${encounterId}:${field}`,
    });
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
  recordGenericChange(project, "encounters", `${seasonLabel(sourceSeason)} encounter data copied to other seasons.`, encounterSubject(project, encounterId), {
    key: `encounter-season-copy:${encounterId}:${sourceSeason}`,
  });
  return getEncounterRecord(project, encounterId);
}

export async function syncEncountersToDexHabitats(project: ProjectState): Promise<HabitatSyncResult> {
  if (project.session.baseRom !== "BW2") throw new Error("Dex habitats are only available for BW2 ROMs.");
  if (!project.narcs.encounters) throw new Error("Encounter data is not loaded.");
  await ensureDexHabitatStore(project);
  const store = project.narcs.habitats;
  if (!store) throw new Error("Dex Habitat NARC is not loaded.");

  let totalSpecies = 0;
  for (let habitatId = 0; habitatId < BW2_HABITAT_ENCOUNTER_POOLS.length; habitatId += 1) {
    const existing = store.rawFiles[habitatId] ?? new Uint8Array(10);
    const synced = buildHabitatFile(project, existing, BW2_HABITAT_ENCOUNTER_POOLS[habitatId]);
    store.rawFiles[habitatId] = synced.bytes;
    store.dirty.add(habitatId);
    totalSpecies += synced.speciesCount;
  }
  store.fileCount = Math.max(store.fileCount, BW2_HABITAT_ENCOUNTER_POOLS.length);
  store.records.clear();
  recordGenericChange(project, "habitats", `Dex habitats synced from encounters (${totalSpecies} species across ${BW2_HABITAT_ENCOUNTER_POOLS.length} habitats).`, "Dex habitats", {
    key: "dex-habitat-sync",
  });
  return { habitats: BW2_HABITAT_ENCOUNTER_POOLS.length, species: totalSpecies };
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

function deriveWilds(readable: ReadableRecord, group: EncounterGroup): string[] {
  const wilds: string[] = [];
  for (const season of ENCOUNTER_SEASONS) {
    const kinds = group === "grass" ? ENCOUNTER_GRASS_FIELDS : ENCOUNTER_WATER_FIELDS;
    const slotCount = group === "grass" ? 12 : 5;
    for (const kind of kinds) {
      for (let slot = 0; slot < slotCount; slot += 1) addUniqueWild(wilds, readable[`${season}_${kind}_slot_${slot}`]);
    }
  }
  return wilds;
}

async function ensureDexHabitatStore(project: ProjectState): Promise<void> {
  if (project.narcs.habitats) return;
  const romBytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!romBytes) throw new Error("Dex Habitat NARC is not loaded. Reload the ROM with Dex Habitats selected.");
  const rom = new NintendoDSRom(romBytes);
  const fileId = rom.fileId(BW2_HABITAT_NARC_PATH);
  project.session.fileIds.habitats = fileId;
  project.session.blacklist = project.session.blacklist.filter((name) => name !== "habitats");
  project.narcs.habitats = createNarcStore("habitats", BW2_HABITAT_NARC_PATH, fileId, new NARC(rom.files[fileId]));
}

function buildHabitatFile(project: ProjectState, existing: Uint8Array, pools: readonly number[]): { bytes: Uint8Array; speciesCount: number } {
  const speciesFlags = new Map<number, Uint8Array>();
  let hasSeasonalDifferences = false;
  for (const pool of pools) {
    if (pool < 0 || pool >= getEncounterCount(project)) continue;
    const record = decodeRecord(project, "encounters", pool);
    if (!record.raw || !record.readable) continue;
    syncEncounterReadable(project, record.raw, record.readable);
    collectHabitatSpecies(record.raw, speciesFlags);
    if (encounterHasSeasonalDifferences(record.raw)) hasSeasonalDifferences = true;
  }

  const entries = [...speciesFlags.entries()].slice(0, 30);
  const header = new Uint8Array(10);
  header.set(existing.subarray(0, Math.min(10, existing.length)));
  header[0] = hasSeasonalDifferences ? 1 : 0;
  header[1] = hasSeasonalDifferences ? 1 : 0;
  header[2] = hasSeasonalDifferences ? 1 : 0;
  writeU16(header, 8, entries.length);

  const out = new Uint8Array(10 + entries.length * 28);
  out.set(header);
  entries.forEach(([species, flags], index) => {
    const offset = 10 + index * 28;
    writeU16(out, offset, species);
    out.set(flags.subarray(0, 26), offset + 2);
  });
  return { bytes: out, speciesCount: entries.length };
}

function collectHabitatSpecies(raw: RawRecord, speciesFlags: Map<number, Uint8Array>): void {
  ENCOUNTER_SEASONS.forEach((season, seasonIndex) => {
    for (const kind of ENCOUNTER_GRASS_FIELDS) {
      addHabitatSpecies(raw, speciesFlags, season, kind, encounterSlotCount(kind), seasonIndex * 3);
    }
    addHabitatSpecies(raw, speciesFlags, season, "surf", 5, seasonIndex * 3 + 1);
    addHabitatSpecies(raw, speciesFlags, season, "surf_special", 5, seasonIndex * 3 + 1);
    addHabitatSpecies(raw, speciesFlags, season, "super_rod", 5, seasonIndex * 3 + 2);
    addHabitatSpecies(raw, speciesFlags, season, "super_rod_special", 5, seasonIndex * 3 + 2);
  });
}

function addHabitatSpecies(
  raw: RawRecord,
  speciesFlags: Map<number, Uint8Array>,
  season: EncounterSeason,
  kind: EncounterKind,
  slotCount: number,
  flagIndex: number,
): void {
  for (let slot = 0; slot < slotCount; slot += 1) {
    const species = Number(raw[`${season}_${kind}_slot_${slot}`] ?? 0) % 2048;
    if (species <= 0) continue;
    const flags = speciesFlags.get(species) ?? new Uint8Array(26);
    flags[flagIndex] = 1;
    speciesFlags.set(species, flags);
  }
}

function encounterHasSeasonalDifferences(raw: RawRecord): boolean {
  for (const season of ENCOUNTER_SEASONS) {
    if (season === "spring") continue;
    for (const kind of [...ENCOUNTER_GRASS_FIELDS, ...ENCOUNTER_WATER_FIELDS]) {
      const slotCount = encounterSlotCount(kind);
      for (let slot = 0; slot < slotCount; slot += 1) {
        const spring = speciesFromRaw(raw, `spring_${kind}_slot_${slot}`);
        const seasonal = speciesFromRaw(raw, `${season}_${kind}_slot_${slot}`);
        if (spring !== seasonal) return true;
      }
    }
  }
  return false;
}

function speciesFromRaw(raw: RawRecord, field: string): number {
  return Number(raw[field] ?? 0) % 2048;
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

function encounterSubject(project: ProjectState, encounterId: number): string {
  const locations = deriveLocations(project, encounterId);
  return locations[0] ?? `Encounter ${encounterId}`;
}

function encounterFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function seasonLabel(season: EncounterSeason): string {
  return season[0].toUpperCase() + season.slice(1);
}
