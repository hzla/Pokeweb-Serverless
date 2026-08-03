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
import { isGen4Project } from "./constants";
import { parseHeaders } from "./headerModel";
import { loadActiveRomBytes } from "./persistence";
import {
  findPokemonBaseSpeciesId,
  findPokemonPersonalFormOwner,
  pokemonBaseSpeciesNameOptions,
  pokemonSpeciesLabel,
} from "./pokemonLabels";
import { createNarcStore, decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";

export type EncounterSeason = (typeof ENCOUNTER_SEASONS)[number];
export type EncounterGroup = "grass" | "water";
export type EncounterKind =
  | (typeof ENCOUNTER_GRASS_FIELDS)[number]
  | (typeof ENCOUNTER_WATER_FIELDS)[number]
  | "swarm"
  | "day"
  | "night"
  | "poke_radar"
  | "ruby"
  | "sapphire"
  | "emerald"
  | "fire_red"
  | "leaf_green"
  | "old_rod"
  | "good_rod"
  | "rock_smash"
  | "hoenn_radio"
  | "sinnoh_radio";

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

export type EncounterFormReferenceNormalizationResult = {
  records: number;
  slots: number;
};

const SLOT_FIELD_RE = /^(spring|summer|fall|winter)_([a-z_]+)_slot_(\d+)$/u;
const FORM_FIELD_RE = /^(spring|summer|fall|winter)_([a-z_]+)_slot_(\d+)_form$/u;
const GEN4_DPPT_GRASS_FIELDS = ["grass", "swarm", "day", "night", "poke_radar", "ruby", "sapphire", "emerald", "fire_red", "leaf_green"] as const;
const GEN4_DPPT_WATER_FIELDS = ["surf", "old_rod", "good_rod", "super_rod"] as const;
const GEN4_HGSS_GRASS_FIELDS = ["grass", "grass_doubles", "grass_special", "hoenn_radio", "sinnoh_radio", "swarm"] as const;
const GEN4_HGSS_WATER_FIELDS = ["surf", "rock_smash", "old_rod", "good_rod", "super_rod"] as const;
const GEN4_SPECIES_ONLY_FIELDS = new Set<EncounterKind>([
  "swarm",
  "day",
  "night",
  "poke_radar",
  "ruby",
  "sapphire",
  "emerald",
  "fire_red",
  "leaf_green",
  "hoenn_radio",
  "sinnoh_radio",
]);
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
  normalizeEncounterRecordFormReferencesAndMark(project, encounterId, record.raw);
  syncEncounterReadable(project, record.raw, record.readable);
  const grassWilds = deriveWilds(record.readable, "grass", project);
  const waterWilds = deriveWilds(record.readable, "water", project);
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
    pokemon_names: pokemonBaseSpeciesNameOptions(project),
  };
}

export function normalizeEncounterFormReferences(project: ProjectState): EncounterFormReferenceNormalizationResult {
  if (isGen4Project(project) || !project.narcs.encounters || !project.narcs.personal) return { records: 0, slots: 0 };

  let records = 0;
  let slots = 0;
  for (let encounterId = 0; encounterId < getEncounterCount(project); encounterId += 1) {
    const record = decodeRecord(project, "encounters", encounterId);
    if (!record.raw || !record.readable) continue;
    const normalizedSlots = normalizeEncounterRecordFormReferencesAndMark(project, encounterId, record.raw);
    if (normalizedSlots === 0) continue;
    syncEncounterReadable(project, record.raw, record.readable);
    records += 1;
    slots += normalizedSlots;
  }

  if (slots > 0) {
    recordGenericChange(
      project,
      "encounters",
      `Normalized ${slots} alternate-form encounter reference${slots === 1 ? "" : "s"} to base species plus form fields.`,
      "Encounter Data",
      { key: "encounter-form-reference-normalization" },
    );
  }
  return { records, slots };
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
  normalizeEncounterRecordFormReferencesAndMark(project, encounterId, record.raw);
  syncEncounterReadable(project, record.raw, record.readable);

  const trimmedValue = inputValue.trim();
  const speciesMatch = SLOT_FIELD_RE.exec(field);
  if (speciesMatch) {
    const before = record.readable[field] ?? "";
    const speciesId = parsePokemonId(project, trimmedValue);
    const form = isGen4Project(project) || speciesId === 0 ? 0 : Number(record.readable[`${field}_form`] ?? 0);
    const rawValue = speciesId + form * 2048;
    record.raw[field] = rawValue;
    record.readable[field] = speciesId === 0 ? "" : pokemonSpeciesLabel(project, speciesId);
    record.readable[`${field}_form`] = form;
    syncGen4EncounterAliases(project, record.raw, record.readable, field);
    markDirty(project, "encounters", encounterId);
    recordFieldChange(project, "encounters", encounterSubject(project, encounterId), encounterFieldLabel(field), before, record.readable[field], {
      key: `encounter:${encounterId}:${field}`,
    });
    return { field, value: record.readable[field], rawValue };
  }

  const formMatch = FORM_FIELD_RE.exec(field);
  if (formMatch) {
    if (isGen4Project(project)) throw new Error("Forms are not editable in the Gen 4 encounter editor.");
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
    syncGen4EncounterAliases(project, record.raw, record.readable, field);
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

export function copyEncounterData(project: ProjectState, encounterId: number, sourceEncounterId: number): EncounterRecord {
  const store = project.narcs.encounters;
  if (!store) throw new Error("Encounter data is not loaded.");
  if (!Number.isInteger(encounterId) || encounterId < 0 || encounterId >= store.fileCount || !store.rawFiles[encounterId]) {
    throw new Error(`Encounter area ${encounterId} is unavailable.`);
  }
  if (!Number.isInteger(sourceEncounterId) || sourceEncounterId < 0 || sourceEncounterId >= store.fileCount || !store.rawFiles[sourceEncounterId]) {
    throw new Error(`No encounter data is available for area ${sourceEncounterId}.`);
  }
  if (sourceEncounterId === encounterId) throw new Error("Choose a different source encounter area.");

  const source = decodeRecord(project, "encounters", sourceEncounterId);
  const target = decodeRecord(project, "encounters", encounterId);
  if (!source.raw || !source.readable) throw new Error(`Unable to read encounter area ${sourceEncounterId}.`);
  if (!target.raw || !target.readable) throw new Error(`Unable to update encounter area ${encounterId}.`);

  target.raw = { ...source.raw };
  target.readable = { ...source.readable };
  syncEncounterReadable(project, target.raw, target.readable);
  markDirty(project, "encounters", encounterId);
  recordGenericChange(
    project,
    "encounters",
    `${encounterSubject(project, encounterId)} encounter data was copied from ${encounterSubject(project, sourceEncounterId)} (area ${sourceEncounterId}).`,
    encounterSubject(project, encounterId),
    { key: `encounter-copy:${encounterId}:${sourceEncounterId}` },
  );
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

export function encounterKindsForGroup(group: EncounterGroup, project?: ProjectState): readonly EncounterKind[] {
  if (project && isGen4Project(project)) {
    if (group === "grass") return project.session.baseRom === "HGSS" ? GEN4_HGSS_GRASS_FIELDS : GEN4_DPPT_GRASS_FIELDS;
    return project.session.baseRom === "HGSS" ? GEN4_HGSS_WATER_FIELDS : GEN4_DPPT_WATER_FIELDS;
  }
  return group === "grass" ? ENCOUNTER_GRASS_FIELDS : ENCOUNTER_WATER_FIELDS;
}

export function encounterSlotCount(kind: EncounterKind, project?: ProjectState): number {
  if (kind === "swarm") return project?.session.baseRom === "HGSS" ? 4 : 2;
  if (kind === "day" || kind === "night" || kind === "ruby" || kind === "sapphire" || kind === "emerald" || kind === "fire_red" || kind === "leaf_green" || kind === "hoenn_radio" || kind === "sinnoh_radio") return 2;
  if (kind === "poke_radar") return 4;
  if (kind === "rock_smash") return 2;
  return (ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? 12 : 5;
}

export function encounterPercentFor(kind: EncounterKind, slot: number): number {
  if (kind === "rock_smash") return [90, 10][slot] ?? 0;
  return ((ENCOUNTER_GRASS_FIELDS as readonly string[]).includes(kind) ? ENCOUNTER_GRASS_PERCENTAGES : ENCOUNTER_WATER_PERCENTAGES)[slot] ?? 0;
}

export function encounterKindHasRate(project: ProjectState, kind: EncounterKind): boolean {
  return !isGen4Project(project) || !GEN4_SPECIES_ONLY_FIELDS.has(kind);
}

export function encounterKindHasLevels(project: ProjectState, kind: EncounterKind): boolean {
  return !isGen4Project(project) || !GEN4_SPECIES_ONLY_FIELDS.has(kind);
}

export function encounterKindHasPercent(project: ProjectState, kind: EncounterKind): boolean {
  return !isGen4Project(project) || !GEN4_SPECIES_ONLY_FIELDS.has(kind);
}

export function encounterKindLabel(project: ProjectState, kind: EncounterKind): string {
  if (isGen4Project(project)) {
    const gen4Labels: Partial<Record<EncounterKind, string>> =
      project.session.baseRom === "HGSS"
        ? {
            grass: "Morning",
            grass_doubles: "Day",
            grass_special: "Night",
            hoenn_radio: "Hoenn Radio",
            sinnoh_radio: "Sinnoh Radio",
            swarm: "Swarm",
            surf: "Surf",
            rock_smash: "Rock Smash",
            old_rod: "Old Rod",
            good_rod: "Good Rod",
            super_rod: "Super Rod",
          }
        : {
            grass: "Walking",
            swarm: "Swarm",
            day: "Day",
            night: "Night",
            poke_radar: "Poke Radar",
            ruby: "Ruby Dual-Slot",
            sapphire: "Sapphire Dual-Slot",
            emerald: "Emerald Dual-Slot",
            fire_red: "FireRed Dual-Slot",
            leaf_green: "LeafGreen Dual-Slot",
            surf: "Surf",
            old_rod: "Old Rod",
            good_rod: "Good Rod",
            super_rod: "Super Rod",
          };
    return gen4Labels[kind] ?? titleize(kind);
  }
  return titleize(kind);
}

export function syncEncounterReadable(project: ProjectState, raw: RawRecord, readable: ReadableRecord): void {
  for (const season of ENCOUNTER_SEASONS) {
    for (const kind of encounterKindsForGroup("grass", project)) {
      for (let slot = 0; slot < encounterSlotCount(kind, project); slot += 1) decodeSpecies(project, raw, readable, `${season}_${kind}_slot_${slot}`);
    }
    for (const kind of encounterKindsForGroup("water", project)) {
      for (let slot = 0; slot < encounterSlotCount(kind, project); slot += 1) decodeSpecies(project, raw, readable, `${season}_${kind}_slot_${slot}`);
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

function deriveWilds(readable: ReadableRecord, group: EncounterGroup, project?: ProjectState): string[] {
  const wilds: string[] = [];
  for (const season of ENCOUNTER_SEASONS) {
    const kinds = encounterKindsForGroup(group, project);
    for (const kind of kinds) {
      const slotCount = encounterSlotCount(kind, project);
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

function decodeSpecies(project: ProjectState, raw: RawRecord, readable: ReadableRecord, field: string): void {
  const rawValue = raw[field] ?? 0;
  const encodedSpeciesId = rawValue % 2048;
  const owner = findPokemonPersonalFormOwner(project, encodedSpeciesId);
  const speciesId = owner?.speciesId ?? encodedSpeciesId;
  readable[field] = speciesId === 0 ? "" : pokemonSpeciesLabel(project, speciesId);
  const encodedForm = Math.floor(rawValue / 2048);
  readable[`${field}_form`] = owner && encodedForm === 0 ? owner.formIndex : encodedForm;
}

function normalizeEncounterRecordFormReferences(project: ProjectState, raw: RawRecord): number {
  if (isGen4Project(project) || !project.narcs.personal) return 0;
  let normalized = 0;
  for (const field of Object.keys(raw)) {
    if (!SLOT_FIELD_RE.test(field)) continue;
    const rawValue = Number(raw[field] ?? 0);
    const encodedSpeciesId = rawValue % 2048;
    const owner = findPokemonPersonalFormOwner(project, encodedSpeciesId);
    if (!owner) continue;
    const encodedForm = Math.floor(rawValue / 2048);
    const form = encodedForm === 0 ? owner.formIndex : encodedForm;
    raw[field] = owner.speciesId + form * 2048;
    normalized += 1;
  }
  return normalized;
}

function normalizeEncounterRecordFormReferencesAndMark(project: ProjectState, encounterId: number, raw: RawRecord): number {
  const normalized = normalizeEncounterRecordFormReferences(project, raw);
  if (normalized > 0) markDirty(project, "encounters", encounterId);
  return normalized;
}

function syncGen4EncounterAliases(project: ProjectState, raw: RawRecord, readable: ReadableRecord, field: string): void {
  if (!isGen4Project(project)) return;
  const match = /^(spring|summer|fall|winter)_(.+)$/u.exec(field);
  if (!match) return;
  const suffix = match[2];
  if (project.session.baseRom === "HGSS") {
    const sharedGrassRate = /^(grass|grass_doubles|grass_special)_rate$/u.exec(suffix);
    if (sharedGrassRate) {
      for (const kind of ["grass", "grass_doubles", "grass_special"]) mirrorGen4EncounterValue(raw, readable, field, `${kind}_rate`);
      return;
    }
    const sharedGrassLevel = /^(grass|grass_doubles|grass_special)_slot_(\d+)_(min_level|max_level)$/u.exec(suffix);
    if (sharedGrassLevel) {
      for (const kind of ["grass", "grass_doubles", "grass_special"]) {
        mirrorGen4EncounterValue(raw, readable, field, `${kind}_slot_${sharedGrassLevel[2]}_min_level`);
        mirrorGen4EncounterValue(raw, readable, field, `${kind}_slot_${sharedGrassLevel[2]}_max_level`);
      }
      return;
    }
  } else {
    const walkingLevel = /^grass_slot_(\d+)_(min_level|max_level)$/u.exec(suffix);
    if (walkingLevel) {
      mirrorGen4EncounterValue(raw, readable, field, `grass_slot_${walkingLevel[1]}_min_level`);
      mirrorGen4EncounterValue(raw, readable, field, `grass_slot_${walkingLevel[1]}_max_level`);
      return;
    }
  }
  mirrorGen4EncounterValue(raw, readable, field, suffix);
}

function mirrorGen4EncounterValue(raw: RawRecord, readable: ReadableRecord, sourceField: string, suffix: string): void {
  for (const season of ENCOUNTER_SEASONS) {
    const alias = `${season}_${suffix}`;
    raw[alias] = Number(raw[sourceField] ?? 0);
    readable[alias] = readable[sourceField] ?? raw[sourceField] ?? 0;
  }
}

function titleize(value: string): string {
  return value
    .replace(/_/gu, " ")
    .split(/\s+/u)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function parsePokemonId(project: ProjectState, value: string): number {
  if (value === "" || value === "-") return 0;
  if (/^\d+$/u.test(value)) {
    const parsed = parseInteger(value, 0, 2047, "Pokemon");
    return findPokemonBaseSpeciesId(project, String(parsed), 2047);
  }
  return findPokemonBaseSpeciesId(project, value, 2047);
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
