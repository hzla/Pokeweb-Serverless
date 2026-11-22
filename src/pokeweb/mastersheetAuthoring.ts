import { enrichTrainerLocations } from "./docGeneratorModel";
import { parseHeaders } from "./headerModel";
import { getGroundItemsByOverworld } from "./mastersheetDetails";
import { normalizeName, type MastersheetCatalog, type MastersheetDocument, type MsPage, type MsTrainer } from "./mastersheetDocument";
import type { ProjectState } from "./projectStore";
import { cleanDisplayText } from "./text";

/**
 * What the Mastersheet Viewer's editor needs to know about the whole ROM, beyond what the sheet uses: every zone,
 * every trainer and where it is fought, wild tables and items on the ground by zone. Built when edit mode first
 * asks; locating every trainer reads every map script, about a second on Cascade White.
 */

export type AuthoringZone = { zoneId: number; name: string; overworldId: number; encounterId?: number };

export type AuthoringTrainer = {
  id: number;
  className: string;
  name: string;
  classId: number;
  party: Array<{ species: number; form: number; name: string; level: number }>;
  /** Location names the trainer is fought in (NPCs and map scripts). */
  locations: string[];
  zoneIds: number[];
};

export type ZoneContents = {
  trainers: AuthoringTrainer[];
  tableIds: number[];
  groundItems: Array<{ itemId: number; name: string; count: number }>;
};

export class MastersheetAuthoringIndex {
  private zoneList?: AuthoringZone[];
  private trainerList?: AuthoringTrainer[];
  private groundItems?: Map<number, number[]>;

  constructor(private readonly project: ProjectState, private readonly catalog: MastersheetCatalog) {}

  zones(): AuthoringZone[] {
    if (this.zoneList) return this.zoneList;
    const zones: AuthoringZone[] = [];
    try {
      this.project.headers ??= parseHeaders(this.project);
      for (const row of Object.values(this.project.headers.rows)) {
        const encounter = Number(row.encounter_id);
        zones.push({
          zoneId: Number(row.index),
          name: cleanDisplayText(String(row.location_name ?? "")) || `Zone ${String(row.index)}`,
          overworldId: Number(row.overworlds_id ?? row.map_id),
          encounterId: Number.isInteger(encounter) && encounter !== 0xffff ? encounter : undefined,
        });
      }
    } catch {
      // No headers: zones stay empty and Fill from the ROM has nothing to offer.
    }
    zones.sort((a, b) => a.zoneId - b.zoneId);
    this.zoneList = zones;
    return zones;
  }

  zone(zoneId: number): AuthoringZone | undefined {
    return this.zones().find((zone) => zone.zoneId === zoneId);
  }

  /** Every trainer the ROM defines, with where it is fought. */
  trainers(): AuthoringTrainer[] {
    if (this.trainerList) return this.trainerList;
    try {
      enrichTrainerLocations(this.project);
    } catch {
      // Without headers or overworlds only the trainers standing on maps are located.
    }
    const locations = this.project.docs?.trainerLocations ?? {};
    const sources = this.project.docs?.trainerLocationSources ?? {};
    const zonesByOverworld = new Map<number, number[]>();
    for (const zone of this.zones()) zonesByOverworld.set(zone.overworldId, [...(zonesByOverworld.get(zone.overworldId) ?? []), zone.zoneId]);
    const list: AuthoringTrainer[] = [];
    for (let id = 1; id < this.catalog.trainerCount(); id += 1) {
      const trainer = this.catalog.trainer(id);
      if (!trainer || !trainer.party.length) continue;
      const zoneIds = new Set(trainer.placements.map((placement) => placement.zoneId));
      for (const source of sources[String(id)] ?? []) for (const zoneId of zonesByOverworld.get(source.overworldId) ?? []) zoneIds.add(zoneId);
      list.push({
        id,
        className: trainer.className,
        name: trainer.name,
        classId: trainer.classId,
        party: trainer.party.map((mon) => ({ species: mon.species, form: mon.form, name: mon.name, level: mon.level })),
        locations: unique([...(locations[String(id)] ?? []), ...trainer.placements.map((placement) => placement.zoneName)].map((name) => cleanDisplayText(name))).filter(Boolean),
        zoneIds: [...zoneIds].sort((a, b) => a - b),
      });
    }
    this.trainerList = list;
    return list;
  }

  trainer(id: number): AuthoringTrainer | undefined {
    return this.trainers().find((trainer) => trainer.id === id);
  }

  hasWildPokemon(tableId: number): boolean {
    return Boolean(this.catalog.encounter(tableId)?.seasons.length);
  }

  /** Zones whose location is named like a page, for linking a page that has no `!zones` yet. */
  suggestZones(title: string): AuthoringZone[] {
    const key = normalizeName(title);
    if (!key) return [];
    return this.zones().filter((zone) => normalizeName(zone.name) === key);
  }

  /** Trainers, wild tables and ground items in a set of zones. */
  contents(zoneIds: number[]): ZoneContents {
    const wanted = new Set(zoneIds);
    const zones = this.zones().filter((zone) => wanted.has(zone.zoneId));
    const overworlds = new Set(zones.map((zone) => zone.overworldId));
    this.groundItems ??= getGroundItemsByOverworld(this.project);
    const counts = new Map<number, number>();
    for (const overworldId of overworlds) for (const itemId of this.groundItems.get(overworldId) ?? []) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    const itemNames = this.project.texts.banks.items ?? [];
    return {
      trainers: this.trainers().filter((trainer) => trainer.zoneIds.some((zoneId) => wanted.has(zoneId))),
      tableIds: unique(zones.flatMap((zone) => (zone.encounterId === undefined ? [] : [zone.encounterId]))).filter((id) => this.hasWildPokemon(id)),
      groundItems: [...counts].map(([itemId, count]) => ({ itemId, count, name: cleanDisplayText(String(itemNames[itemId] ?? `Item ${itemId}`)) })),
    };
  }
}

/** A page's zones: those it links with `!zones`, else zones named like it. */
export function pageZones(index: MastersheetAuthoringIndex, page: MsPage): { zoneIds: number[]; linked: boolean } {
  if (page.zones.length) return { zoneIds: page.zones, linked: true };
  return { zoneIds: index.suggestZones(page.title).map((zone) => zone.zoneId), linked: false };
}

/** Trainer IDs, table IDs and item names a page already shows. */
export function pageUses(page: MsPage): { trainers: Set<number>; tables: Set<number>; itemText: string } {
  const trainers = new Set<number>();
  const tables = new Set<number>();
  const text: string[] = [];
  for (const block of page.blocks) {
    if (block.kind === "trainer") trainers.add(block.trainerId);
    if (block.kind === "encounter") tables.add(block.tableId);
    if (block.kind === "items") for (const entry of block.entries) text.push(entry.name, entry.note ?? "");
  }
  return { trainers, tables, itemText: normalizeName(text.join(" ")) };
}

/** What the whole sheet leaves out or repeats, for the Coverage view. */
export function sheetCoverage(index: MastersheetAuthoringIndex, document: MastersheetDocument): {
  missingTrainers: AuthoringTrainer[];
  repeatedTrainers: Array<{ trainer: MsTrainer | undefined; id: number; pages: string[] }>;
  missingTables: number[];
} {
  const seen = new Map<number, string[]>();
  const tables = new Set<number>();
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind === "trainer") seen.set(block.trainerId, [...(seen.get(block.trainerId) ?? []), page.title]);
      if (block.kind === "encounter") tables.add(block.tableId);
    }
  }
  const missingTrainers = index.trainers().filter((trainer) => trainer.locations.length && !seen.has(trainer.id));
  const repeatedTrainers = [...seen].filter(([, pages]) => pages.length > 1).map(([id, pages]) => ({ id, trainer: document.trainers[id], pages }));
  const used = unique(index.zones().flatMap((zone) => (zone.encounterId === undefined ? [] : [zone.encounterId])));
  return { missingTrainers, repeatedTrainers, missingTables: used.filter((id) => !tables.has(id) && index.hasWildPokemon(id)).sort((a, b) => a - b) };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
