import { tmTypePalette } from "./tmModel";
import { ENCOUNTER_SEASONS } from "./constants";
import { decodeRecord, type MastersheetHighlightMap, type ProjectState, type RawRecord } from "./projectStore";
import { encounterPercentFor, encounterSlotCount, getEncounterCount, type EncounterKind } from "./encounterModel";
import { ensureMastersheetMarkdown, parseMastersheetMarkdown, type MastersheetElement, type MastersheetInlinePart, type MastersheetWarning } from "./mastersheetModel";
import { parseHeaders } from "./headerModel";
import { getTrainerCount, getTrainerRecord, getAutofilledTrainerPokemonMoveIds, type TrainerPokemonSlot } from "./trainerModel";
import { getPokemonSummaryRecord } from "./pokemonModel";
import { cleanDisplayText } from "./text";
import { getTextBank } from "./textModel";

/**
 * The mastersheet as the viewer shows it: the author's source resolved against the ROM it travels with.
 *
 * - Pages: the introduction (everything before the first split) and one page per area (`##`). Splits (`#`) group
 *   areas in the outline. `###` and below are sections within a page.
 * - Trainers, encounter tables, Pokémon and moves referenced by the pages, resolved from the ROM. Everything here is
 *   plain data (no DOM), so the same document can later be written out for a static site.
 */

export type MsInline = MastersheetInlinePart;

export type MsBlock =
  | { kind: "heading"; id: string; level: 3 | 4; text: string }
  | { kind: "text"; parts: MsInline[] }
  | { kind: "list"; items: MsInline[][] }
  | { kind: "trainer"; trainerId: number; role: MsTrainerRole; notes: MsInline[] }
  | { kind: "encounter"; tableId: number }
  /**
   * An item entry's first value only chooses the icon; its text is free-form (it can list other items, places…).
   * `tmType` is set for icons written as "TM Fire" / "HM Water": a TM disc in that type's colour.
   */
  | { kind: "items"; title: string; description: string; entries: Array<{ name: string; itemId?: number; tmType?: string; note?: string }> }
  | { kind: "gifts"; title: string; description: string; entries: Array<{ name: string; personalId?: number; note?: string }> }
  | { kind: "notice"; title: string; text: string; color?: string };

export type MsTrainerRole = "mandatory" | "optional" | "rematch" | "other";

export type MsPage = {
  id: string;
  kind: "intro" | "area";
  title: string;
  splitId?: string;
  blocks: MsBlock[];
};

export type MsSplit = { id: string; title: string; detail?: string; pageIds: string[] };

export type MsMoveRef = { id: number; name: string };

export type MsPartyMon = {
  slot: number;
  personalId: number;
  species: number;
  form: number;
  name: string;
  level: number;
  gender: string;
  ivs: number;
  nature: string;
  ability: string;
  item?: { id?: number; name: string };
  moves: MsMoveRef[];
};

export type MsPlacement = {
  zoneId: number;
  zoneName: string;
  npcIndex: number;
  /** Tile coordinates: x east, z south, y height (as the overworld file stores them). */
  tileX: number;
  tileZ: number;
  height: number;
  /** 0 up, 1 down, 2 left, 3 right. */
  direction: number;
  objCode: number;
};

export type MsTrainer = {
  id: number;
  name: string;
  className: string;
  classId: number;
  battleType: string;
  party: MsPartyMon[];
  placements: MsPlacement[];
};

export type MsEncounterSlot = { personalId: number; species: number; form: number; name: string; minLevel: number; maxLevel: number; chance: number };

export type MsEncounterMethod = { kind: EncounterKind; label: string; rate: number; slots: MsEncounterSlot[] };

export type MsEncounterTable = {
  id: number;
  name: string;
  zones: Array<{ zoneId: number; name: string }>;
  /** One entry when all four seasons are the same. */
  seasons: Array<{ season: string; methods: MsEncounterMethod[] }>;
};

export type MsPokemon = {
  personalId: number;
  species: number;
  form: number;
  name: string;
  types: string[];
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: string[];
};

export type MsMove = { id: number; name: string; type: string; category: string; power: number; accuracy: number; pp: number; priority: number };

export type MastersheetDocument = {
  title: string;
  baseRom: string;
  splits: MsSplit[];
  pages: MsPage[];
  trainers: Record<number, MsTrainer>;
  encounters: Record<number, MsEncounterTable>;
  pokemon: Record<number, MsPokemon>;
  moves: Record<number, MsMove>;
  highlights: MastersheetHighlightMap;
  warnings: MastersheetWarning[];
};

export const ENCOUNTER_METHOD_LABELS: Partial<Record<EncounterKind, string>> = {
  grass: "Grass",
  grass_doubles: "Dark grass",
  grass_special: "Shaking grass",
  surf: "Surfing",
  surf_special: "Rippling water",
  super_rod: "Fishing",
  super_rod_special: "Fishing (ripples)",
};
const BW_METHODS: EncounterKind[] = ["grass", "grass_doubles", "grass_special", "surf", "surf_special", "super_rod", "super_rod_special"];

/** TM01, whose disc graphic every TM shares; its palette is swapped for the type. */
const TM01_ITEM_ID = 328;

/**
 * Lookups beyond what the sheet itself mentions, for the viewer's dex: any wild table in the ROM, and any Pokémon.
 * Shares the document's resolved tables and Pokémon so nothing is read twice.
 */
export type MastersheetCatalog = {
  /** The wild table with this ID, whether or not the sheet uses it. */
  encounter(id: number): MsEncounterTable | undefined;
  /** IDs of every wild table that at least one zone uses, in ID order. */
  wildTableIds(): number[];
  pokemon(personalId: number): MsPokemon | undefined;
};

export function createMastersheetCatalog(project: ProjectState, document?: MastersheetDocument): MastersheetCatalog {
  const resolver = new Resolver(project);
  if (document) {
    Object.assign(resolver.encounters, document.encounters);
    Object.assign(resolver.pokemon, document.pokemon);
  }
  let ids: number[] | undefined;
  return {
    encounter: (id) => resolver.encounter(id),
    wildTableIds: () => (ids ??= [...resolver.encounterZones().keys()].filter((id) => id < getEncounterCount(project)).sort((a, b) => a - b)),
    pokemon: (personalId) => resolver.pokemonEntry(personalId),
  };
}

export function buildMastersheetDocument(project: ProjectState, markdown = ensureMastersheetMarkdown(project)): MastersheetDocument {
  const parsed = parseMastersheetMarkdown(markdown, project);
  const resolver = new Resolver(project);
  const { splits, pages, title } = buildPages(parsed.masterData, resolver);
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.kind === "trainer") resolver.trainer(block.trainerId);
      if (block.kind === "encounter") resolver.encounter(block.tableId);
    }
  }
  return {
    title: title || project.docs?.romTitle || project.session.romName,
    baseRom: project.session.baseRom,
    splits,
    pages,
    trainers: resolver.trainers,
    encounters: resolver.encounters,
    pokemon: resolver.pokemon,
    moves: resolver.moves,
    highlights: project.docs?.mastersheetHighlights ?? {},
    warnings: parsed.warnings,
  };
}

// ---------- Pages ----------

function buildPages(elements: MastersheetElement[], resolver: Resolver): { splits: MsSplit[]; pages: MsPage[]; title: string } {
  const splits: MsSplit[] = [];
  const pages: MsPage[] = [];
  const ids = new Set<string>();
  const uniqueId = (text: string, prefix: string) => {
    const base = `${prefix}${slugify(text) || "section"}`;
    let id = base;
    for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  let title = "";
  let split: MsSplit | undefined;
  let page: MsPage = { id: uniqueId("introduction", ""), kind: "intro", title: "Introduction", blocks: [] };
  pages.push(page);
  let list: MsInline[][] | undefined;
  let gap = false;
  const push = (block: MsBlock) => {
    list = undefined;
    page.blocks.push(block);
    gap = false;
  };

  for (const element of elements) {
    const text = inlineText(element);
    switch (element.tag) {
      case "h1": {
        if (!title && !splits.length && !page.blocks.length) {
          title = text;
          page.title = text;
          break;
        }
        const { name, detail } = splitTitle(text);
        split = { id: uniqueId(name, "split-"), title: name, detail, pageIds: [] };
        splits.push(split);
        // Text under a split heading before its first area becomes that split's own page.
        page = { id: uniqueId(name, ""), kind: "intro", title: name, splitId: split.id, blocks: [] };
        pages.push(page);
        list = undefined;
        break;
      }
      case "h2":
        page = { id: uniqueId(text, ""), kind: "area", title: text, splitId: split?.id, blocks: [] };
        pages.push(page);
        split?.pageIds.push(page.id);
        list = undefined;
        break;
      case "h3":
      case "h4":
        push({ kind: "heading", id: uniqueId(text, `${page.id}--`), level: element.tag === "h3" ? 3 : 4, text });
        break;
      case "p":
        if (!text.trim()) {
          gap = true;
          list = undefined;
          break;
        }
        push({ kind: "text", parts: inlineParts(element) });
        break;
      case "li":
        if (!list || gap) {
          list = [];
          page.blocks.push({ kind: "list", items: list });
          gap = false;
        }
        list.push(inlineParts(element));
        break;
      case "br":
        gap = true;
        break;
      case "trainer":
        push({ kind: "trainer", trainerId: Number(element.id), role: trainerRole(element.class), notes: noteParts(element) });
        break;
      case "encounter":
        push({ kind: "encounter", tableId: Number(element.id) });
        break;
      case "items":
        push({
          kind: "items",
          title: String(element.itemsTitle ?? ""),
          description: String(element.itemsDescription ?? ""),
          entries: zipEntries(element.itemList, element.itemDescriptions).map(([name, note]) => {
            const tmType = /^\s*[th]m[\s_-]*([a-z]+)\s*$/iu.exec(name)?.[1];
            if (tmType && tmTypePalette(tmType) !== undefined) return { name, tmType: titleCase(tmType), itemId: TM01_ITEM_ID, note };
            return { name: resolver.itemName(name) ?? name, itemId: resolver.itemId(name), note };
          }),
        });
        break;
      case "gifts":
        push({
          kind: "gifts",
          title: String(element.giftsTitle ?? ""),
          description: String(element.giftsDescription ?? ""),
          entries: zipEntries(element.giftPokemonList, element.giftPokemonDescriptions).map(([name, note]) => {
            const personalId = resolver.speciesId(name);
            if (personalId !== undefined) resolver.pokemonEntry(personalId);
            return { name: personalId !== undefined ? resolver.pokemonEntry(personalId)?.name ?? name : name, personalId, note };
          }),
        });
        break;
      case "notif":
        push({ kind: "notice", title: String(element.notificationTitle ?? ""), text: String(element.text ?? ""), color: typeof element.fontColor === "string" ? element.fontColor : undefined });
        break;
    }
  }
  // An introduction with nothing in it (sheets that open straight into a split) isn't a page.
  const kept = pages.filter((candidate) => candidate.kind === "area" || candidate.blocks.length || (candidate === pages[0] && !splits.length));
  // A split with no areas and no text of its own (an "end of content" marker) stays out of the outline.
  const keptIds = new Set(kept.map((candidate) => candidate.id));
  const keptSplits = splits.filter((candidate) => candidate.pageIds.length || kept.some((entry) => entry.splitId === candidate.id && keptIds.has(entry.id)));
  return { splits: keptSplits, pages: kept, title };
}

/** "Cheren Split (Level Cap 15)" → name "Cheren Split", detail "Level Cap 15". */
function splitTitle(text: string): { name: string; detail?: string } {
  const match = /^(.*?)\s*\((.+)\)\s*$/u.exec(text);
  return match ? { name: match[1]!.trim(), detail: match[2]!.trim() } : { name: text };
}

function trainerRole(value: unknown): MsTrainerRole {
  const text = String(value ?? "").toLowerCase();
  if (text.startsWith("mand")) return "mandatory";
  if (text.startsWith("opt")) return "optional";
  if (text.startsWith("rem")) return "rematch";
  return "other";
}

function inlineParts(element: MastersheetElement): MsInline[] {
  const parts = element.content_parts;
  if (Array.isArray(parts)) return parts as MsInline[];
  if (parts && typeof parts === "object") return [parts as MsInline];
  return [{ type: "text", text: String(element.content ?? "") }];
}

function inlineText(element: MastersheetElement): string {
  return inlineParts(element).map((part) => part.text).join("").trim();
}

function noteParts(element: MastersheetElement): MsInline[] {
  const parts = element.notes_parts;
  if (Array.isArray(parts)) return (parts as MsInline[]).filter((part) => part.text.trim());
  const notes = element.notes;
  return Array.isArray(notes) && notes.length ? [{ type: "text", text: notes.join(" ") }] : [];
}

function zipEntries(names: unknown, notes: unknown): Array<[string, string | undefined]> {
  const list = Array.isArray(names) ? names.map(String) : [];
  const descriptions = Array.isArray(notes) ? notes : [];
  return list.map((name, index) => [name, typeof descriptions[index] === "string" && descriptions[index] ? String(descriptions[index]) : undefined]);
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
}

// ---------- ROM data ----------

class Resolver {
  trainers: Record<number, MsTrainer> = {};
  encounters: Record<number, MsEncounterTable> = {};
  pokemon: Record<number, MsPokemon> = {};
  moves: Record<number, MsMove> = {};
  private moveIds?: Map<string, number>;
  private itemIds?: Map<string, number>;
  private speciesIds?: Map<string, number>;
  private placements?: Map<number, MsPlacement[]>;
  private zonesByEncounter?: Map<number, Array<{ zoneId: number; name: string }>>;

  constructor(private project: ProjectState) {}

  trainer(id: number): MsTrainer | undefined {
    if (id in this.trainers) return this.trainers[id];
    if (!Number.isInteger(id) || id < 0 || id >= getTrainerCount(this.project)) return undefined;
    let record;
    try {
      record = getTrainerRecord(this.project, id);
    } catch {
      return undefined;
    }
    const readable = record.readable;
    const trainer: MsTrainer = {
      id,
      name: cleanDisplayText(String(readable.name ?? "")).trim() || `Trainer ${id}`,
      className: cleanDisplayText(String(readable.class ?? "")),
      classId: Number(record.raw.class ?? readable.class_id ?? 0),
      battleType: battleType(readable.battle_type_1),
      party: record.party.map((slot) => this.partyMon(slot, record.hasMoves)),
      placements: this.placementIndex().get(id) ?? [],
    };
    this.trainers[id] = trainer;
    return trainer;
  }

  private partyMon(slot: TrainerPokemonSlot, hasMoves: boolean): MsPartyMon {
    const personalId = this.personalId(slot.speciesId, slot.form);
    const pokemon = this.pokemonEntry(personalId, slot.speciesId, slot.form);
    let moveIds = slot.moves.map((move) => this.moveId(move)).filter((id): id is number => id !== undefined && id > 0);
    if (!hasMoves || !moveIds.length) {
      try {
        moveIds = getAutofilledTrainerPokemonMoveIds(this.project, slot.speciesId, slot.level).filter((id) => id > 0);
      } catch {
        // Keep whatever the record has.
      }
    }
    const item = slot.itemName !== undefined && String(slot.itemName) !== "None" && String(slot.itemName) !== "" ? String(slot.itemName) : undefined;
    return {
      slot: slot.slot,
      personalId,
      species: slot.speciesId,
      form: slot.form,
      name: pokemon?.name ?? slot.speciesName,
      level: slot.level,
      gender: slot.gender,
      ivs: slot.ivs,
      nature: slot.nature,
      ability: String(slot.abilityName ?? ""),
      item: item ? { id: this.itemId(item), name: item } : undefined,
      moves: moveIds.map((id) => this.moveRef(id)),
    };
  }

  encounter(id: number): MsEncounterTable | undefined {
    if (id in this.encounters) return this.encounters[id];
    if (!Number.isInteger(id) || id < 0 || id >= getEncounterCount(this.project)) return undefined;
    const record = decodeRecord(this.project, "encounters", id);
    if (!record.raw) return undefined;
    const raw = record.raw;
    const seasons = ENCOUNTER_SEASONS.map((season) => ({
      season,
      methods: BW_METHODS.map((kind) => this.encounterMethod(raw, season, kind)).filter((method): method is MsEncounterMethod => Boolean(method)),
    }));
    // Tables without seasonal variation store the same data four times (or only spring).
    const distinct = seasons.filter((entry, index) => entry.methods.length && (index === 0 || JSON.stringify(entry.methods) !== JSON.stringify(seasons[0]!.methods)));
    const zones = this.encounterZones().get(id) ?? [];
    const table: MsEncounterTable = {
      id,
      name: zones[0]?.name ?? `Encounter table ${id}`,
      zones,
      seasons: distinct.length > 1 ? seasons.filter((entry) => entry.methods.length) : seasons.slice(0, 1).filter((entry) => entry.methods.length),
    };
    this.encounters[id] = table;
    return table;
  }

  private encounterMethod(raw: RawRecord, season: string, kind: EncounterKind): MsEncounterMethod | undefined {
    const rate = Number(raw[`${season}_${kind}_rate`] ?? 0);
    if (!rate) return undefined;
    const slots: MsEncounterSlot[] = [];
    const count = encounterSlotCount(kind, this.project);
    for (let slot = 0; slot < count; slot += 1) {
      const value = Number(raw[`${season}_${kind}_slot_${slot}`] ?? 0);
      const species = value & 0x7ff;
      if (!species) continue;
      const form = value >> 11;
      const personalId = this.personalId(species, form);
      const pokemon = this.pokemonEntry(personalId, species, form);
      slots.push({
        personalId,
        species,
        form,
        name: pokemon?.name ?? `#${species}`,
        minLevel: Number(raw[`${season}_${kind}_slot_${slot}_min_level`] ?? 0),
        maxLevel: Number(raw[`${season}_${kind}_slot_${slot}_max_level`] ?? 0),
        chance: encounterPercentFor(kind, slot),
      });
    }
    if (!slots.length) return undefined;
    return { kind, label: ENCOUNTER_METHOD_LABELS[kind] ?? kind, rate, slots };
  }

  /** The personal record of a species' form: forms after the first live at form_id + form - 1. */
  personalId(species: number, form: number): number {
    if (form <= 0) return species;
    try {
      const formId = Number(getPokemonSummaryRecord(this.project, species).rawPersonal.form_id ?? 0);
      const id = formId + form - 1;
      return formId > 0 && id < (this.project.narcs.personal?.fileCount ?? 0) ? id : species;
    } catch {
      return species;
    }
  }

  pokemonEntry(personalId: number, species = personalId, form = 0): MsPokemon | undefined {
    if (personalId in this.pokemon) return this.pokemon[personalId];
    let record;
    try {
      record = getPokemonSummaryRecord(this.project, personalId);
    } catch {
      return undefined;
    }
    const personal = record.personal;
    const types = [String(personal.type_1 ?? ""), String(personal.type_2 ?? "")].filter((type, index, all) => type && all.indexOf(type) === index);
    const abilities = [personal.ability_1, personal.ability_2, personal.ability_3].map((ability) => titleCase(String(ability ?? ""))).filter((ability) => ability && ability !== "-" && ability !== "None");
    const entry: MsPokemon = {
      personalId,
      species,
      form,
      name: this.pokemonName(form ? species : personalId, String(personal.name ?? "")),
      types,
      stats: {
        hp: Number(personal.base_hp ?? 0),
        atk: Number(personal.base_atk ?? 0),
        def: Number(personal.base_def ?? 0),
        spa: Number(personal.base_spatk ?? 0),
        spd: Number(personal.base_spdef ?? 0),
        spe: Number(personal.base_speed ?? 0),
      },
      abilities: abilities.filter((ability, index) => abilities.indexOf(ability) === index),
    };
    this.pokemon[personalId] = entry;
    return entry;
  }

  private pokemonName(personalId: number, fallback: string): string {
    const name = this.project.texts.banks.pokedex?.[personalId];
    return cleanDisplayText(name && name !== "-" ? String(name) : fallback, false) || `#${personalId}`;
  }

  moveRef(id: number): MsMoveRef {
    const move = this.move(id);
    return { id, name: move?.name ?? `Move ${id}` };
  }

  move(id: number): MsMove | undefined {
    if (id in this.moves) return this.moves[id];
    if (!this.project.narcs.moves || id <= 0 || id >= this.project.narcs.moves.fileCount) return undefined;
    const record = decodeRecord(this.project, "moves", id);
    const readable = record.readable ?? {};
    const move: MsMove = {
      id,
      name: cleanDisplayText(String(this.project.texts.banks.moves?.[id] ?? readable.name ?? `Move ${id}`)),
      type: String(readable.type ?? ""),
      category: String(readable.category ?? ""),
      power: Number(readable.power ?? 0) || 0,
      accuracy: Number(readable.accuracy ?? 0) || 0,
      pp: Number(readable.pp ?? 0) || 0,
      priority: Number(record.raw?.priority ?? 0) << 24 >> 24,
    };
    this.moves[id] = move;
    return move;
  }

  private moveId(value: string | number): number | undefined {
    if (typeof value === "number") return value;
    const text = value.trim();
    if (!text || /^-+$/u.test(text)) return undefined;
    if (/^\d+$/u.test(text)) return Number(text);
    this.moveIds ??= nameIndex(this.project.texts.banks.moves ?? []);
    return this.moveIds.get(normalizeName(text));
  }

  itemId(name: string): number | undefined {
    this.itemIds ??= nameIndex(this.project.texts.banks.items ?? []);
    return this.itemIds.get(normalizeName(name));
  }

  itemName(name: string): string | undefined {
    const id = this.itemId(name);
    return id === undefined ? undefined : cleanDisplayText(String(this.project.texts.banks.items?.[id] ?? name));
  }

  speciesId(name: string): number | undefined {
    this.speciesIds ??= nameIndex(this.project.texts.banks.pokedex ?? []);
    return this.speciesIds.get(normalizeName(name));
  }

  /** Common-script trainers stand in the overworld: NPCs whose script is 3000–3999 or 5000–5999 (trainer = script % 1000). */
  private placementIndex(): Map<number, MsPlacement[]> {
    if (this.placements) return this.placements;
    const placements = new Map<number, MsPlacement[]>();
    this.placements = placements;
    const overworlds = this.project.narcs.overworlds;
    if (!overworlds) return placements;
    const zonesByOverworld = new Map<number, Array<{ zoneId: number; name: string }>>();
    for (const row of Object.values(this.headers()?.rows ?? {})) {
      const overworldId = Number(row.overworlds_id ?? row.map_id);
      const list = zonesByOverworld.get(overworldId) ?? [];
      list.push({ zoneId: Number(row.index), name: cleanDisplayText(String(row.location_name ?? "")) });
      zonesByOverworld.set(overworldId, list);
    }
    for (let overworldId = 0; overworldId < overworlds.fileCount; overworldId += 1) {
      const zones = zonesByOverworld.get(overworldId);
      if (!zones?.length) continue;
      let raw;
      try {
        raw = decodeRecord(this.project, "overworlds", overworldId).raw;
      } catch {
        continue;
      }
      if (!raw) continue;
      const npcCount = Number(raw.npc_count ?? 0);
      for (let npc = 0; npc < npcCount; npc += 1) {
        const script = Number(raw[`npc_${npc}_script_id`] ?? 0);
        if (!((script > 3000 && script < 4000) || (script > 5000 && script < 6000))) continue;
        const trainerId = script % 1000;
        const list = placements.get(trainerId) ?? [];
        list.push({
          zoneId: zones[0]!.zoneId,
          zoneName: zones[0]!.name,
          npcIndex: npc,
          tileX: Number(raw[`npc_${npc}_x_cord`] ?? 0),
          tileZ: Number(raw[`npc_${npc}_y_cord`] ?? 0),
          height: Number(raw[`npc_${npc}_z_cord`] ?? 0),
          direction: Number(raw[`npc_${npc}_direction`] ?? 1),
          objCode: Number(raw[`npc_${npc}_overworld_sprite`] ?? 0),
        });
        placements.set(trainerId, list);
      }
    }
    return placements;
  }

  /** Every wild table some zone uses, with those zones. */
  encounterZones(): Map<number, Array<{ zoneId: number; name: string }>> {
    if (this.zonesByEncounter) return this.zonesByEncounter;
    const map = new Map<number, Array<{ zoneId: number; name: string }>>();
    for (const row of Object.values(this.headers()?.rows ?? {})) {
      const table = Number(row.encounter_id);
      if (!Number.isInteger(table) || table === 0xffff) continue;
      const list = map.get(table) ?? [];
      list.push({ zoneId: Number(row.index), name: cleanDisplayText(String(row.location_name ?? "")) });
      map.set(table, list);
    }
    this.zonesByEncounter = map;
    return map;
  }

  private headers() {
    try {
      this.project.headers ??= parseHeaders(this.project);
      return this.project.headers;
    } catch {
      return undefined;
    }
  }
}

function battleType(value: unknown): string {
  const text = String(value ?? "");
  if (/rotation/iu.test(text)) return "Rotation";
  if (/triple/iu.test(text)) return "Triples";
  if (/double/iu.test(text)) return "Doubles";
  return "Singles";
}

export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function nameIndex(names: readonly unknown[]): Map<string, number> {
  const index = new Map<string, number>();
  names.forEach((name, id) => {
    const key = normalizeName(cleanDisplayText(String(name ?? "")));
    if (key && !index.has(key)) index.set(key, id);
  });
  return index;
}

/** A description from a message bank, with the game's line breaks turned into spaces. */
export function bankText(project: ProjectState, bankId: number, index: number): string {
  try {
    const entry = getTextBank(project, "message_texts", bankId)[index];
    return entry ? cleanDisplayText(String(entry[1])).replace(/\\[nrf]/gu, " ").replace(/\s+/gu, " ").trim() : "";
  } catch {
    return "";
  }
}

/** "STENCH" or "stench" → "Stench"; names already mixed-case are kept. */
export function titleCase(value: string): string {
  const text = cleanDisplayText(value).trim();
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}
