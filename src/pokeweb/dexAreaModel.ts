import contract from "../assets/data/bw2TownMapNativeContract.json";
import { NintendoDSRom } from "../nds/rom";
import { recordGenericChange } from "./actionChangelog";
import { loadCodeInjectionNarcs } from "./codeInjectionInstall";
import { parseHeaders } from "./headerModel";
import { loadActiveRomBytes } from "./persistence";
import { decodeRecord, markDirty, type ProjectState } from "./projectStore";
import { parseTownMapAreas, TOWN_MAP_STOCK_COUNT } from "./townMapModel";

/**
 * BW2 Pokédex "Area" data (a/1/7/6): one file per species, `species - 1`.
 *
 * Layout: byte 0 is 1 when all four seasons are identical. Then one block per
 * season (spring, summer, autumn, winter): an "unknown area" byte (1 when the
 * season has no areas) followed by one byte per Town Map habitat slot. Stock
 * files have 85 slots (345 bytes); the Town Map runtime widens them to 128
 * (517 bytes). Each slot byte is a bit set of the encounter methods below.
 */
export const DEX_AREA_METHODS = [
  { kind: "grass", label: "Grass" },
  { kind: "grass_doubles", label: "Dark grass" },
  { kind: "grass_special", label: "Shaking grass" },
  { kind: "surf", label: "Surfing" },
  { kind: "surf_special", label: "Rippling water" },
  { kind: "super_rod", label: "Fishing" },
  { kind: "super_rod_special", label: "Fishing (ripples)" },
] as const;
export const DEX_AREA_SEASONS = ["spring", "summer", "fall", "winter"] as const;
export const DEX_AREA_ALL_METHODS = (1 << DEX_AREA_METHODS.length) - 1;

export type DexAreaSlot = { slot: number; zone: number; name: string; pools: number[] };
/** Method bits per season and slot: `seasons[season][slot]`. */
export type DexAreaSeasons = number[][];
export type DexAreaSyncResult = { species: number; changed: number; slots: number };

type Version = "B2" | "W2";
const FILE_SIZES: Record<number, number> = { 345: TOWN_MAP_STOCK_COUNT, 517: 128 };

export function supportsDexAreas(project: ProjectState): boolean {
  return project.session.baseVersion === "B2" || project.session.baseVersion === "W2";
}

/** Loads the Area archive and the Town Map records that name its slots. */
export async function ensureDexAreaData(project: ProjectState): Promise<void> {
  if (!supportsDexAreas(project)) throw new Error("Pokédex areas are only available for Black 2 and White 2.");
  if (!project.narcs.town_map_species_habitats || !project.narcs.town_map) {
    const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
    if (!bytes) throw new Error("The source ROM is unavailable. Reload the ROM and try again.");
    loadCodeInjectionNarcs(project, new NintendoDSRom(bytes, { fileData: "view" }), ["town_map", "town_map_species_habitats"]);
  }
  project.headers ??= parseHeaders(project);
}

export function dexAreaSpeciesCount(project: ProjectState): number {
  return project.narcs.town_map_species_habitats?.rawFiles.length ?? 0;
}

export function dexAreaSlotCount(project: ProjectState): number {
  const first = project.narcs.town_map_species_habitats?.rawFiles[0];
  return first ? slotCountFor(first) : TOWN_MAP_STOCK_COUNT;
}

/**
 * Slots keep the native habitat order. A stock slot follows its Town Map
 * record, so a record moved to another zone moves the slot with it; slots past
 * the stock 85 are Town Map records appended by the Town Map editor.
 */
export function dexAreaSlots(project: ProjectState): DexAreaSlot[] {
  const version = project.session.baseVersion as Version;
  const native = contract[version].habitatZones, stock = contract[version].stockRecordZones;
  const areas = project.narcs.town_map?.rawFiles[0] ? parseTownMapAreas(project.narcs.town_map.rawFiles[0]) : [];
  const count = Math.max(dexAreaSlotCount(project), TOWN_MAP_STOCK_COUNT);
  const slots: DexAreaSlot[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const record = slot < TOWN_MAP_STOCK_COUNT ? stock.indexOf(native[slot]) : slot;
    const zone = areas[record]?.zone ?? (slot < TOWN_MAP_STOCK_COUNT ? native[slot] : undefined);
    if (zone === undefined) break;
    slots.push({ slot, zone, name: zoneName(project, zone), pools: dexAreaPools(project, zone) });
  }
  return slots;
}

/** Every encounter pool used by maps that share the slot zone's place name. */
export function dexAreaPools(project: ProjectState, zone: number): number[] {
  const headers = project.headers ??= parseHeaders(project);
  const place = headers.rows[zone + 1]?.place_name_id;
  if (place === undefined) return [];
  const pools = new Set<number>();
  for (let rowId = 1; rowId <= headers.count; rowId += 1) {
    const row = headers.rows[rowId];
    if (row?.place_name_id !== place) continue;
    const pool = encounterPool(row as unknown as Record<string, unknown>);
    if (pool !== undefined && pool < (project.narcs.encounters?.fileCount ?? 0)) pools.add(pool);
  }
  return [...pools].sort((a, b) => a - b);
}

export function decodeDexAreaFile(bytes: Uint8Array): DexAreaSeasons {
  const count = slotCountFor(bytes);
  return DEX_AREA_SEASONS.map((_season, season) => Array.from(bytes.subarray(2 + season * (count + 1), 2 + season * (count + 1) + count)));
}

export function encodeDexAreaFile(seasons: DexAreaSeasons, slotCount: number): Uint8Array {
  if (FILE_SIZES[1 + 4 * (slotCount + 1)] !== slotCount) throw new Error(`Pokédex areas support 85 or 128 slots, not ${slotCount}.`);
  if (seasons.length !== 4) throw new Error("Pokédex areas need four seasons.");
  const out = new Uint8Array(1 + 4 * (slotCount + 1));
  seasons.forEach((flags, season) => {
    const start = 1 + season * (slotCount + 1);
    const used = flags.slice(0, slotCount).map((value, slot) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Slot ${slot} has an invalid method value ${value}.`);
      return value;
    });
    out[start] = Number(!used.some(Boolean));
    out.set(used, start + 1);
  });
  out[0] = Number(seasons.slice(1).every((flags) => flags.slice(0, slotCount).every((value, slot) => value === seasons[0][slot])));
  return out;
}

export function readDexArea(project: ProjectState, species: number): DexAreaSeasons {
  const bytes = project.narcs.town_map_species_habitats?.rawFiles[species - 1];
  if (!bytes) throw new Error(`Pokédex area data for species ${species} is missing.`);
  return decodeDexAreaFile(bytes);
}

/** Writes one species' areas; returns false when nothing changed. */
export function writeDexArea(project: ProjectState, species: number, seasons: DexAreaSeasons, label = `#${species}`): boolean {
  const store = project.narcs.town_map_species_habitats;
  const old = store?.rawFiles[species - 1];
  if (!store || !old) throw new Error(`Pokédex area data for species ${species} is missing.`);
  const bytes = encodeDexAreaFile(seasons, slotCountFor(old));
  if (equalBytes(bytes, old)) return false;
  store.rawFiles[species - 1] = bytes;
  markDirty(project, "town_map_species_habitats", species - 1);
  recordGenericChange(project, "dex-areas", `${label} Pokédex areas edited.`, "Pokédex areas", { key: `dex-area:${species}` });
  return true;
}

/** Method bits per species for one slot, read from the slot's encounter pools. */
export function encounterDexAreaFlags(project: ProjectState, pools: readonly number[], speciesCount: number): Map<number, number[]> {
  const result = new Map<number, number[]>();
  for (const pool of pools) {
    const bytes = project.narcs.encounters?.rawFiles[pool];
    const raw = decodeRecord(project, "encounters", pool).raw;
    if (!bytes || !raw) throw new Error(`Encounter pool ${pool} could not be read.`);
    const seasonal = bytes.length > 232;
    DEX_AREA_SEASONS.forEach((seasonName, season) => {
      const prefix = seasonal ? seasonName : "spring";
      DEX_AREA_METHODS.forEach(({ kind }, bit) => {
        if (!Number(raw[`${prefix}_${kind}_rate`])) return;
        const slots = bit < 3 ? 12 : 5;
        for (let slot = 0; slot < slots; slot += 1) {
          const species = Number(raw[`${prefix}_${kind}_slot_${slot}`] ?? 0) % 2048;
          if (!species || species > speciesCount) continue;
          const flags = result.get(species) ?? [0, 0, 0, 0];
          flags[season] |= 1 << bit;
          result.set(species, flags);
        }
      });
    });
  }
  return result;
}

/** Rebuilds every species' Area data from the current wild encounters. */
export async function syncEncountersToDexAreas(project: ProjectState): Promise<DexAreaSyncResult> {
  if (!project.narcs.encounters) throw new Error("Encounter data is not loaded.");
  await ensureDexAreaData(project);
  const store = project.narcs.town_map_species_habitats!;
  const count = store.rawFiles.length, slots = dexAreaSlots(project), slotCount = dexAreaSlotCount(project);
  if (slots.length > slotCount) throw new Error(`The Town Map has ${slots.length} areas but the Pokédex area files hold ${slotCount}. Save the Town Map first.`);
  const perSlot = slots.map((slot) => encounterDexAreaFlags(project, slot.pools, count));
  // Build every file before touching the archive so a failure leaves it unchanged.
  const files = store.rawFiles.map((old, index) => {
    const size = slotCountFor(old);
    const seasons = DEX_AREA_SEASONS.map(() => new Array<number>(size).fill(0));
    perSlot.forEach((flags, slot) => flags.get(index + 1)?.forEach((value, season) => { seasons[season][slot] = value; }));
    return encodeDexAreaFile(seasons, size);
  });
  let changed = 0, species = 0;
  files.forEach((bytes, index) => {
    if (bytes.some((value, offset) => offset > 0 && value && (offset - 1) % (slotCount + 1) !== 0)) species += 1;
    if (equalBytes(bytes, store.rawFiles[index])) return;
    store.rawFiles[index] = bytes;
    store.dirty.add(index);
    changed += 1;
  });
  if (changed) {
    store.revision = (store.revision ?? 0) + 1;
    recordGenericChange(project, "dex-areas", `Pokédex areas synced from encounters (${changed} species changed).`, "Pokédex areas", { key: "dex-area-sync" });
  }
  return { species, changed, slots: slots.length };
}

function slotCountFor(bytes: Uint8Array): number {
  const count = FILE_SIZES[bytes.length];
  if (count === undefined) throw new Error(`Unsupported Pokédex area file size ${bytes.length}.`);
  return count;
}

function encounterPool(row: Record<string, unknown>): number | undefined {
  const pool = Number(row.encounter_id ?? (Number(row.enc_data_id) & 255));
  return Number.isInteger(pool) && pool >= 0 && pool !== 255 && pool !== 0xffff ? pool : undefined;
}

function zoneName(project: ProjectState, zone: number): string {
  return project.headers?.rows[zone + 1]?.location_name || `Zone ${zone}`;
}

function equalBytes(a: Uint8Array, b: Uint8Array | undefined): boolean {
  return Boolean(b) && a.length === b!.length && a.every((value, i) => value === b![i]);
}
