import grottoLocationsText from "../assets/data/grotto_locations.txt?raw";
import martLocationsText from "../assets/data/mart_locations.txt?raw";
import { writeU8 } from "../nds/binary";
import { recordFieldChange } from "./actionChangelog";
import {
  bw1MartCapacity, bw1MartCount, bw1MartLabel, isBw1BpMart, readBw1Marts, setBw1BpItems, setBw1MartItems, type Bw1MartData,
} from "./bw1MartModel";
import { findPokemonSpeciesId, pokemonSpeciesLabel, pokemonSpeciesNameOptions } from "./pokemonLabels";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { pokemonSpriteSlug } from "./spriteSlug";

export type MartRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
  inventory: string;
};

export type GrottoRecord = {
  id: number;
  raw: RawRecord;
  readable: ReadableRecord;
  wilds: string[];
  spriteSlugs: string[];
};

export type GrottoOddsState = {
  raw: RawRecord;
  readable: ReadableRecord;
  dirty: boolean;
};

export type FieldUpdateResult = {
  value: string | number;
  rawValue: number;
};

export const GROTTO_VERSIONS = ["black", "white"] as const;
export const GROTTO_POKEMON_RARITIES = ["common", "uncommon", "rare"] as const;
export const GROTTO_ITEM_TYPES = ["normal", "hidden"] as const;
export const GROTTO_ITEM_RARITIES = ["common", "uncommon", "rare", "superrare"] as const;
export const GROTTO_ODDS_FIELDS = Array.from({ length: 20 }, (_, index) => [
  ...["rare", "uncommon", "common"].map((rarity) => `${rarity}_pok_odds_${index}`),
  ...["normal", "hidden"].flatMap((itemType) =>
    ["superrare", "rare", "uncommon", "common"]
      .filter((rarity) => !(itemType === "hidden" && rarity === "common"))
      .map((rarity) => `${rarity}_${itemType}_item_odds_${index}`),
  ),
]).flat();

const MART_LOCATIONS = martLocationsText.split(/\r?\n/u).filter(Boolean);
const GROTTO_LOCATIONS = grottoLocationsText.split(/\r?\n/u).filter(Boolean);

export const BW2_MART_SLOTS = 20;

export function getMartCount(project: ProjectState): number {
  if (project.session.baseRom === "BW") return bw1MartCount();
  return project.narcs.marts?.fileCount ?? 0;
}

/** Slots this mart can hold: 20 in BW2; BW1's retail list size, or 40 with expanded inventories. */
export function getMartSlotLimit(project: ProjectState, martId: number): number {
  return project.session.baseRom === "BW" ? bw1MartCapacity(readBw1Marts(project), martId) : BW2_MART_SLOTS;
}

/** BW1's Battle Subway shops sell for BP at per-entry prices (`price_N` fields). */
export function isBpMart(project: ProjectState, martId: number): boolean {
  return project.session.baseRom === "BW" && isBw1BpMart(martId);
}

export function getGrottoCount(project: ProjectState): number {
  return project.narcs.grottos?.fileCount ?? 0;
}

export function getMartRecord(project: ProjectState, martId: number): MartRecord {
  if (project.session.baseRom === "BW") return bw1MartRecord(project, readBw1Marts(project), martId);
  const record = decodeRecord(project, "marts", martId);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode mart ${martId}`);
  syncMartReadable(project, martId, record.raw, record.readable);
  return { id: martId, raw: record.raw, readable: record.readable, inventory: martInventory(record.readable) };
}

export function getGrottoRecord(project: ProjectState, grottoId: number): GrottoRecord {
  const record = decodeRecord(project, "grottos", grottoId);
  if (!record.raw || !record.readable) throw new Error(`Unable to decode grotto ${grottoId}`);
  syncGrottoReadable(project, grottoId, record.raw, record.readable);
  const wilds = grottoWilds(record.readable);
  return {
    id: grottoId,
    raw: record.raw,
    readable: record.readable,
    wilds,
    spriteSlugs: wilds.map(spriteSlug),
  };
}

export function getGrottoOdds(project: ProjectState): GrottoOddsState {
  if (project.grottoOdds) return project.grottoOdds;
  const bytes = project.narcs.grotto_odds?.rawFiles[0];
  if (!bytes) throw new Error("Grotto odds table is not loaded");
  const raw: RawRecord = {};
  GROTTO_ODDS_FIELDS.forEach((field, index) => {
    raw[field] = bytes[index] ?? 0;
  });
  project.grottoOdds = { raw, readable: { ...raw }, dirty: false };
  return project.grottoOdds;
}

export function getMartAutofills(project: ProjectState): Record<string, string[]> {
  return { items: project.texts.banks.items ?? [] };
}

export function getGrottoAutofills(project: ProjectState): Record<string, string[]> {
  return {
    pokemon_names: pokemonSpeciesNameOptions(project),
    items: project.texts.banks.items ?? [],
  };
}

export function updateMartField(project: ProjectState, martId: number, field: string, inputValue: string): FieldUpdateResult {
  if (project.session.baseRom === "BW") return updateBw1MartField(project, martId, field, inputValue);
  if (!/^item_\d+$/u.test(field)) throw new Error(`Unsupported mart field: ${field}`);
  const record = getMartRecord(project, martId);
  const before = record.readable[field] ?? "";
  const rawValue = findValueIndex(project.texts.banks.items ?? [], inputValue.trim(), "item");
  record.raw[field] = rawValue;
  record.readable[field] = itemName(project, rawValue);
  markDirty(project, "marts", martId);
  syncMartCount(project, martId, record.raw);
  recordFieldChange(project, "marts", martSubject(record), martFieldLabel(field), before, record.readable[field], {
    key: `mart:${martId}:${field}`,
  });
  return { value: record.readable[field], rawValue };
}

export function updateGrottoField(project: ProjectState, grottoId: number, field: string, inputValue: string): FieldUpdateResult {
  const record = getGrottoRecord(project, grottoId);
  const before = record.readable[field] ?? "";
  const value = inputValue.trim();
  let rawValue: number;
  let displayValue: string | number;

  if (field.includes("_pok_")) {
    rawValue = findPokemonSpeciesId(project, value);
    displayValue = pokemonName(project, rawValue);
  } else if (field.includes("_item_")) {
    rawValue = findValueIndex(project.texts.banks.items ?? [], value, "item");
    displayValue = itemName(project, rawValue);
  } else if (/_(min|max)_lvl_\d+$/u.test(field) || /_gender_\d+$/u.test(field) || /_form_\d+$/u.test(field)) {
    rawValue = parseInteger(value, 0, 100, field);
    displayValue = rawValue;
  } else {
    throw new Error(`Unsupported grotto field: ${field}`);
  }

  record.raw[field] = rawValue;
  record.readable[field] = displayValue;
  markDirty(project, "grottos", grottoId);
  recordFieldChange(project, "grottos", grottoSubject(record), grottoFieldLabel(field), before, displayValue, {
    key: `grotto:${grottoId}:${field}`,
  });
  return { value: displayValue, rawValue };
}

export function updateGrottoOddsField(project: ProjectState, field: string, inputValue: string): FieldUpdateResult {
  if (!GROTTO_ODDS_FIELDS.includes(field)) throw new Error(`Unsupported grotto odds field: ${field}`);
  const odds = getGrottoOdds(project);
  const before = odds.readable[field] ?? 0;
  const rawValue = parseInteger(inputValue.trim(), 0, 100, field);
  odds.raw[field] = rawValue;
  odds.readable[field] = rawValue;
  odds.dirty = true;
  const index = GROTTO_ODDS_FIELDS.indexOf(field);
  const bytes = project.narcs.grotto_odds?.rawFiles[0];
  if (bytes) {
    writeU8(bytes, index, rawValue);
    markDirty(project, "grotto_odds", 0);
  }
  recordFieldChange(project, "grotto_odds", "Grotto odds", grottoFieldLabel(field), before, rawValue, {
    key: `grotto-odds:${field}`,
  });
  return { value: rawValue, rawValue };
}

export function martMatchesSearch(record: MartRecord, searchText: string): boolean {
  return commaSearch(record, searchText);
}

export function grottoMatchesSearch(record: GrottoRecord, searchText: string): boolean {
  return commaSearch(record, searchText);
}

export function remainingHiddenCommonOdd(project: ProjectState, grottoId: number): number {
  const odds = getGrottoOdds(project).readable;
  let remaining = 100;
  for (const [key, value] of Object.entries(odds)) {
    if (key.endsWith(`_${grottoId}`)) remaining -= Number(value) || 0;
  }
  return remaining;
}

function bw1MartRecord(project: ProjectState, data: Bw1MartData, martId: number): MartRecord {
  const raw: RawRecord = {};
  const readable: ReadableRecord = { index: martId, name: bw1MartLabel(data, martId) };
  const bp = isBw1BpMart(martId);
  const entries = bp ? data.bpShops[martId - data.shops.length] ?? [] : (data.shops[martId] ?? []).map((itemId) => ({ itemId, price: 0 }));
  const slots = Math.max(bw1MartCapacity(data, martId), entries.length);
  for (let n = 0; n < slots; n += 1) {
    const entry = entries[n];
    raw[`item_${n}`] = entry?.itemId ?? 0;
    readable[`item_${n}`] = itemName(project, entry?.itemId ?? 0);
    if (bp) {
      raw[`price_${n}`] = entry?.price ?? 0;
      readable[`price_${n}`] = entry?.price ?? 0;
    }
  }
  return { id: martId, raw, readable, inventory: martInventory(readable, slots) };
}

/**
 * Reorder or drop slots in one step: `order` lists the current slot indices to
 * keep, in their new order. BP prices move with their items.
 */
export function reorderMartSlots(project: ProjectState, martId: number, order: number[]): void {
  if (project.session.baseRom === "BW") {
    const data = readBw1Marts(project);
    if (isBw1BpMart(martId)) {
      const entries = data.bpShops[martId - data.shops.length] ?? [];
      setBw1BpItems(project, martId, order.map((slot) => entries[slot]!).filter(Boolean));
    } else {
      const items = data.shops[martId] ?? [];
      setBw1MartItems(project, martId, order.map((slot) => items[slot]!).filter((item) => item !== undefined));
    }
    return;
  }
  const record = getMartRecord(project, martId);
  const items = order.map((slot) => Number(record.raw[`item_${slot}`] ?? 0));
  for (let slot = 0; slot < BW2_MART_SLOTS; slot += 1) {
    const next = items[slot] ?? 0;
    if (Number(record.raw[`item_${slot}`] ?? 0) !== next) updateMartField(project, martId, `item_${slot}`, itemName(project, next));
  }
}

/** Item edits rebuild the list without empty slots; `price_N` edits a BP price. */
function updateBw1MartField(project: ProjectState, martId: number, field: string, inputValue: string): FieldUpdateResult {
  const match = /^(item|price)_(\d+)$/u.exec(field);
  if (!match) throw new Error(`Unsupported mart field: ${field}`);
  const slot = Number(match[2]);
  const data = readBw1Marts(project);
  const bp = isBw1BpMart(martId);
  const entries = bp ? (data.bpShops[martId - data.shops.length] ?? []).map((entry) => ({ ...entry })) : (data.shops[martId] ?? []).map((itemId) => ({ itemId, price: 0 }));
  if (slot > entries.length) throw new Error("Fill the slots in order.");
  let result: FieldUpdateResult;
  if (match[1] === "price") {
    if (!bp || !entries[slot]) throw new Error("Only BP shop entries have prices.");
    const price = parseInteger(inputValue.trim(), 0, 0xffff, "BP price");
    entries[slot]!.price = price;
    result = { value: price, rawValue: price };
  } else {
    const itemId = findValueIndex(project.texts.banks.items ?? [], inputValue.trim(), "item");
    if (entries[slot]) entries[slot]!.itemId = itemId;
    else if (itemId) entries.push({ itemId, price: 1 });
    result = { value: itemName(project, itemId), rawValue: itemId };
  }
  const kept = entries.filter((entry) => entry.itemId !== 0);
  if (bp) setBw1BpItems(project, martId, kept, martFieldLabel(field));
  else setBw1MartItems(project, martId, kept.map((entry) => entry.itemId), martFieldLabel(field));
  return result;
}

function syncMartReadable(project: ProjectState, martId: number, raw: RawRecord, readable: ReadableRecord): void {
  readable.index = martId;
  readable.name = MART_LOCATIONS[martId] ?? "-";
  for (let n = 0; n < 20; n += 1) readable[`item_${n}`] = itemName(project, raw[`item_${n}`] ?? 0);
}

function syncGrottoReadable(project: ProjectState, grottoId: number, raw: RawRecord, readable: ReadableRecord): void {
  readable.index = grottoId;
  readable.name = GROTTO_LOCATIONS[grottoId] ?? `Grotto ${grottoId}`;
  for (const version of ["black", "white"]) {
    for (const rarity of ["rare", "uncommon", "common"]) {
      for (let n = 0; n < 4; n += 1) {
        readable[`${version}_${rarity}_pok_${n}`] = pokemonName(project, raw[`${version}_${rarity}_pok_${n}`] ?? 0);
      }
    }
  }
  for (const itemType of ["normal", "hidden"]) {
    for (const rarity of ["superrare", "rare", "uncommon", "common"]) {
      for (let n = 0; n < 4; n += 1) {
        readable[`${itemType}_${rarity}_item_${n}`] = itemName(project, raw[`${itemType}_${rarity}_item_${n}`] ?? 0);
      }
    }
  }
}

function martInventory(readable: ReadableRecord, slots = BW2_MART_SLOTS): string {
  const items = Array.from({ length: slots }, (_, n) => String(readable[`item_${n}`] ?? "None"));
  return [...new Set(items.filter((item) => item !== "None"))].join(", ");
}

function syncMartCount(project: ProjectState, martId: number, raw: RawRecord): void {
  const count = Array.from({ length: 20 }, (_, n) => raw[`item_${n}`] ?? 0).filter((itemId) => itemId !== 0).length;
  const countsFile = project.narcs.mart_counts?.rawFiles[0];
  if (countsFile && martId < countsFile.length) {
    writeU8(countsFile, martId, count);
    markDirty(project, "mart_counts", 0);
  }
}

function grottoWilds(readable: ReadableRecord): string[] {
  const wilds: string[] = [];
  for (const version of ["black", "white"]) {
    for (const rarity of ["rare", "uncommon", "common"]) {
      for (let n = 0; n < 4; n += 1) {
        const name = String(readable[`${version}_${rarity}_pok_${n}`] ?? "");
        if (name && name !== "None" && !wilds.includes(name)) wilds.push(name);
      }
    }
  }
  return wilds;
}

function itemName(project: ProjectState, itemId: number): string {
  return project.texts.banks.items?.[itemId] ?? String(itemId);
}

function pokemonName(project: ProjectState, speciesId: number): string {
  return pokemonSpeciesLabel(project, speciesId);
}

function findValueIndex(values: readonly string[], input: string, label: string): number {
  const index = values.findIndex((value) => value.toLowerCase() === input.toLowerCase());
  if (index < 0) throw new Error(`Unknown ${label}: ${input}`);
  return index;
}

function parseInteger(value: string, min: number, max: number, field: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return parsed;
}

function commaSearch(record: unknown, searchText: string): boolean {
  const terms = searchText
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = JSON.stringify(record).toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function spriteSlug(name: string): string {
  return pokemonSpriteSlug(name);
}

function martSubject(record: MartRecord): string {
  return String(record.readable.name ?? `Mart ${record.id}`);
}

function grottoSubject(record: GrottoRecord): string {
  return String(record.readable.name ?? `Grotto ${record.id}`);
}

function martFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}

function grottoFieldLabel(field: string): string {
  return field.replace(/_/gu, " ");
}
