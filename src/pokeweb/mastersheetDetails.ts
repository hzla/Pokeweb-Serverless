import { buildGroundItemScriptMap, GROUND_ITEM_SCRIPT_FIRST, GROUND_ITEM_SCRIPT_LAST } from "./docGeneratorModel";
import { parseHeaders } from "./headerModel";
import { getMartCount, getMartRecord } from "./martGrottoModel";
import { getPokemonCount, getPokemonExportRecord, getPokemonSummaryRecord, isPokemonPersonalRecord } from "./pokemonModel";
import { getTrainerCount } from "./trainerModel";
import type { ProjectState } from "./projectStore";
import { decodeRecord } from "./projectStore";
import { bankText, normalizeName, titleCase, type MsMove } from "./mastersheetDocument";
import { cleanDisplayText } from "./text";

/**
 * Details for the viewer's side drawer, read from the ROM on demand: a Pokémon's abilities, evolutions and level-up
 * moves, and the descriptions of moves, abilities and items. Plain data, like the document.
 */

type DescriptionBanks = { moves?: number; abilities?: number; items?: number };

/** Message banks holding descriptions. Black / White 1 only has a verified ability bank so far. */
function descriptionBanks(project: ProjectState): DescriptionBanks {
  if (project.session.baseRom === "BW2") return { moves: 402, abilities: 375, items: 63 };
  if (project.session.baseRom === "BW") return { abilities: 183 };
  return {};
}

export type MsAbilityDetail = { name: string; description: string };

export type MsPokemonDetail = {
  personalId: number;
  name: string;
  types: string[];
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: Array<MsAbilityDetail & { hidden: boolean }>;
  height: number;
  weight: number;
  catchRate: number;
  genderRatio: number;
  eggGroups: string[];
  evolutions: Array<{ targetId: number; target: string; method: string }>;
  learnset: Array<{ level: number; move: MsMove }>;
};

export function getMastersheetPokemonDetail(project: ProjectState, personalId: number): MsPokemonDetail | undefined {
  let record;
  try {
    record = getPokemonExportRecord(project, personalId);
  } catch {
    return undefined;
  }
  const personal = record.personal;
  const abilityIds = [record.rawPersonal.ability_1, record.rawPersonal.ability_2, record.rawPersonal.ability_3].map((id) => Number(id ?? 0));
  const abilities = abilityIds
    .map((id, index) => ({ id, hidden: index === 2 }))
    .filter((entry, index) => entry.id > 0 && abilityIds.indexOf(entry.id) === index)
    .map((entry) => ({ hidden: entry.hidden, ...abilityById(project, entry.id) }));
  const eggGroups = [String(personal.egg_group_1 ?? ""), String(personal.egg_group_2 ?? "")].filter((group, index, all) => group && all.indexOf(group) === index);
  return {
    personalId,
    name: cleanDisplayText(String(project.texts.banks.pokedex?.[personalId] ?? personal.name ?? `#${personalId}`)),
    types: [String(personal.type_1 ?? ""), String(personal.type_2 ?? "")].filter((type, index, all) => type && all.indexOf(type) === index),
    stats: {
      hp: Number(personal.base_hp ?? 0),
      atk: Number(personal.base_atk ?? 0),
      def: Number(personal.base_def ?? 0),
      spa: Number(personal.base_spatk ?? 0),
      spd: Number(personal.base_spdef ?? 0),
      spe: Number(personal.base_speed ?? 0),
    },
    abilities,
    height: Number(personal.height ?? 0) / 10,
    weight: Number(personal.weight ?? 0) / 10,
    catchRate: Number(personal.catchrate ?? 0),
    genderRatio: Number(record.rawPersonal.gender ?? 0),
    eggGroups,
    evolutions: record.evolutions
      .filter((evolution) => evolution.targetId > 0 && evolution.methodId > 0)
      .map((evolution) => ({ targetId: evolution.targetId, target: cleanDisplayText(String(evolution.target)), method: evolutionText(evolution.method, evolution.param) })),
    learnset: record.learnset
      .filter((entry) => entry.moveId > 0)
      .map((entry) => ({ level: entry.level, move: getMastersheetMove(project, entry.moveId) }))
      .filter((entry): entry is { level: number; move: MsMove } => Boolean(entry.move)),
  };
}

export function getMastersheetMove(project: ProjectState, id: number): MsMove | undefined {
  if (!project.narcs.moves || id <= 0 || id >= project.narcs.moves.fileCount) return undefined;
  const record = decodeRecord(project, "moves", id);
  const readable = record.readable ?? {};
  return {
    id,
    name: cleanDisplayText(String(project.texts.banks.moves?.[id] ?? readable.name ?? `Move ${id}`)),
    type: String(readable.type ?? ""),
    category: String(readable.category ?? ""),
    power: Number(readable.power ?? 0) || 0,
    accuracy: Number(readable.accuracy ?? 0) || 0,
    pp: Number(readable.pp ?? 0) || 0,
    priority: Number(record.raw?.priority ?? 0) << 24 >> 24,
  };
}

export type MsMoveDetail = MsMove & { description: string; effectChance: number };

export function getMastersheetMoveDetail(project: ProjectState, id: number): MsMoveDetail | undefined {
  const move = getMastersheetMove(project, id);
  if (!move) return undefined;
  const banks = descriptionBanks(project);
  const readable = decodeRecord(project, "moves", id).readable ?? {};
  return { ...move, description: banks.moves === undefined ? "" : bankText(project, banks.moves, id), effectChance: Number(readable.effect_chance ?? 0) || 0 };
}

/** By name, for abilities shown by name only (trainer Pokémon). Prefer IDs: hacks rename abilities. */
export function getMastersheetAbilityDetail(project: ProjectState, name: string): MsAbilityDetail | undefined {
  const names = project.texts.banks.abilities ?? [];
  const key = normalizeName(name);
  const id = names.findIndex((candidate) => normalizeName(String(candidate ?? "")) === key);
  return id > 0 ? abilityById(project, id) : undefined;
}

function abilityById(project: ProjectState, id: number): MsAbilityDetail {
  const banks = descriptionBanks(project);
  return { name: titleCase(String(project.texts.banks.abilities?.[id] ?? `Ability ${id}`)), description: banks.abilities === undefined ? "" : bankText(project, banks.abilities, id) };
}

export type MsItemDetail = { id: number; name: string; description: string };

export function getMastersheetItemDetail(project: ProjectState, id: number): MsItemDetail | undefined {
  const name = project.texts.banks.items?.[id];
  if (name === undefined || id <= 0) return undefined;
  const banks = descriptionBanks(project);
  return { id, name: cleanDisplayText(String(name)), description: banks.items === undefined ? "" : bankText(project, banks.items, id) };
}

function evolutionText(method: string | number, param: string | number): string {
  const text = String(method);
  if (/level/iu.test(text) && Number(param) > 0) return `Level ${param}`;
  if (param !== "" && param !== 0 && String(param) !== "None") return `${text}: ${param}`;
  return text;
}

export type MsItemSourceKind = "ground" | "wild" | "reward" | "mart";

/** Where an item can be found, by method. `zoneName` / `personalId` / `trainerId` let the viewer link to the sheet. */
export type MsItemSource = {
  kind: MsItemSourceKind;
  place: string;
  zoneName?: string;
  personalId?: number;
  trainerId?: number;
  /** How many of this source there are, e.g. two item balls on one route. */
  count: number;
};

export const ITEM_SOURCE_LABELS: Record<MsItemSourceKind, string> = {
  ground: "On the ground",
  wild: "Held by wild Pokémon",
  reward: "Trainer rewards",
  mart: "Poké Marts",
};

/**
 * Every source of every item, read once from the ROM: the same sources as the doc generators' item locations
 * (enrichItemLocations), kept structured.
 * - Ground items: overworld NPCs running item scripts 7000–7799, which give the item named in the global item script
 * - Wild held items: personal data item slots
 * - Trainer rewards: trainer data
 * - Mart stock: mart data
 * A source the ROM can't be read for is skipped, not fatal.
 */
export function getMastersheetItemSources(project: ProjectState): Map<number, MsItemSource[]> {
  const sources = new Map<number, MsItemSource[]>();
  const add = (itemId: number, source: Omit<MsItemSource, "count">) => {
    if (!(itemId > 0)) return;
    const list = sources.get(itemId) ?? [];
    const same = list.find((entry) => entry.kind === source.kind && entry.place === source.place);
    if (same) {
      if (source.kind === "ground") same.count += 1;
    } else {
      list.push({ ...source, count: 1 });
    }
    sources.set(itemId, list);
  };
  const attempt = (read: () => void) => {
    try {
      read();
    } catch {
      // Missing archives (or a hack's unusual layout) leave that source out.
    }
  };

  attempt(() => {
    if (!project.narcs.overworlds || !project.narcs.scripts) return;
    const scriptMap = buildGroundItemScriptMap(project);
    project.headers ??= parseHeaders(project);
    const zoneByOverworld = new Map<number, string>();
    for (let rowId = 1; rowId <= project.headers.count; rowId += 1) {
      const row = project.headers.rows[rowId];
      const overworldId = Number(row?.overworlds_id ?? row?.map_id);
      if (row && !zoneByOverworld.has(overworldId)) zoneByOverworld.set(overworldId, cleanDisplayText(String(row.location_name ?? "")));
    }
    for (let overworldId = 0; overworldId < project.narcs.overworlds.fileCount; overworldId += 1) {
      const raw = decodeRecord(project, "overworlds", overworldId).raw;
      if (!raw) continue;
      const zoneName = zoneByOverworld.get(overworldId) || `Overworld ${overworldId}`;
      for (let npc = 0; npc < Number(raw.npc_count ?? 0); npc += 1) {
        const scriptId = Number(raw[`npc_${npc}_script_id`] ?? 0);
        if (scriptId < GROUND_ITEM_SCRIPT_FIRST || scriptId > GROUND_ITEM_SCRIPT_LAST) continue;
        const itemId = scriptMap.get(scriptId);
        if (itemId !== undefined) add(itemId, { kind: "ground", place: zoneName, zoneName });
      }
    }
  });

  attempt(() => {
    if (!project.narcs.personal) return;
    for (let personalId = 1; personalId < getPokemonCount(project); personalId += 1) {
      if (!isPokemonPersonalRecord(project, personalId)) continue;
      const record = getPokemonSummaryRecord(project, personalId);
      const name = cleanDisplayText(String(project.texts.banks.pokedex?.[personalId] ?? record.personal.name ?? `#${personalId}`));
      for (const field of ["item_1", "item_2", "item_3"]) add(Number(record.rawPersonal[field] ?? 0), { kind: "wild", place: name, personalId });
    }
  });

  attempt(() => {
    if (!project.narcs.trdata) return;
    for (let trainerId = 0; trainerId < getTrainerCount(project); trainerId += 1) {
      const trainer = decodeRecord(project, "trdata", trainerId);
      if (!trainer.raw) continue;
      const itemId = Number(trainer.raw.reward_item ?? 0);
      if (!(itemId > 0)) continue;
      const className = String(project.texts.banks.tr_classes?.[Number(trainer.raw.class)] ?? trainer.readable?.class ?? "");
      const name = String(project.texts.banks.tr_names?.[trainerId] ?? trainer.readable?.name ?? "");
      add(itemId, { kind: "reward", place: cleanDisplayText(`${className} ${name}`.trim()) || `Trainer ${trainerId}`, trainerId });
    }
  });

  attempt(() => {
    if (!project.narcs.marts) return;
    for (let martId = 0; martId < getMartCount(project); martId += 1) {
      const mart = getMartRecord(project, martId);
      const place = cleanDisplayText(String(mart.readable.name ?? `Mart ${martId}`));
      for (let slot = 0; slot < 20; slot += 1) add(Number(mart.raw[`item_${slot}`] ?? 0), { kind: "mart", place });
    }
  });

  return sources;
}
