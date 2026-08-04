import { ENCOUNTER_SEASONS, NATURES, isGen4Project } from "./constants";
import {
  encounterKindHasLevels,
  encounterKindHasPercent,
  encounterKindHasRate,
  encounterKindLabel,
  encounterKindsForGroup,
  encounterPercentFor,
  encounterSlotCount,
  getEncounterCount,
  getEncounterRecord,
  type EncounterKind,
  type EncounterSeason,
} from "./encounterModel";
import { learnsetEntries } from "./pokemonModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { parseShowdownTeam } from "./testBattleTeam";
import { evolvePokemonForLevelTargets } from "./testTeamEvolution";

const DEFAULT_KIND_PRIORITY: readonly EncounterKind[] = [
  "grass",
  "surf",
  "old_rod",
  "good_rod",
  "super_rod",
  "rock_smash",
  "grass_doubles",
  "grass_special",
  "surf_special",
  "super_rod_special",
];

export const AUTO_ENCOUNTER_TABLE_KEY = "auto";

export type EncounterRollSlot = {
  speciesId: number;
  formIndex: number;
  minLevel: number;
  maxLevel: number;
  weight: number;
};

export type EncounterRollTable = {
  key: string;
  encounterId: number;
  season: EncounterSeason;
  kind: EncounterKind;
  label: string;
  maxLevel: number;
  slots: EncounterRollSlot[];
};

export type EncounterRollArea = {
  encounterId: number;
  label: string;
  tables: EncounterRollTable[];
  defaultTableKey: string;
};

export type EncounterRollSelection = {
  encounterId: number;
  tableKey: string;
};

export type EncounterRollTableOdds = {
  fishingPercent: number;
  surfPercent: number;
  grassDoublesPercent: number;
  maxLevel?: number;
  obtainedEvolutionItemIds?: readonly number[];
};

export type EncounterRollResult = {
  speciesId: number;
  formIndex: number;
  speciesName: string;
  level: number;
  encounterId: number;
  areaLabel: string;
  tableLabel: string;
  nature: string;
  ivs: EncounterRollIvs;
  tableChancePercent: number;
  effectiveChancePercent: number;
  showdownText: string;
};

export type EncounterRollStatic = {
  speciesId: number;
  formIndex: number;
  speciesName: string;
  level: number;
  showdownText: string;
};

export type EncounterRollIvs = {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
};

export function getEncounterRollAreas(project: ProjectState): EncounterRollArea[] {
  const areas: EncounterRollArea[] = [];
  for (let encounterId = 0; encounterId < getEncounterCount(project); encounterId += 1) {
    const encounter = getEncounterRecord(project, encounterId);
    if (encounter.locations.length === 0) continue;
    const tables = getRollTables(project, encounterId, encounter.raw);
    if (tables.length === 0) continue;
    const locations = [...new Set(encounter.locations.map(cleanLocation).filter(Boolean))];
    const locationLabel = locations.length > 0 ? locations.join(" / ") : `Encounter area ${encounterId}`;
    areas.push({
      encounterId,
      label: `#${encounterId} · ${locationLabel}`,
      tables,
      defaultTableKey: defaultTable(tables).key,
    });
  }
  return areas;
}

export function encounterRollSelectionsForLevel(
  areas: readonly EncounterRollArea[],
  maxLevel: number,
  automaticTables = false,
): EncounterRollSelection[] {
  if (!Number.isFinite(maxLevel) || maxLevel < 1 || maxLevel > 100) {
    throw new Error("Enter a level from 1 to 100.");
  }
  return areas.flatMap((area) => {
    if (automaticTables) {
      return automaticTablesForArea(area, Math.trunc(maxLevel)).length > 0
        ? [{ encounterId: area.encounterId, tableKey: AUTO_ENCOUNTER_TABLE_KEY }]
        : [];
    }
    const table = area.tables.find((candidate) => candidate.key === area.defaultTableKey);
    return table && table.maxLevel <= Math.trunc(maxLevel)
      ? [{ encounterId: area.encounterId, tableKey: table.key }]
      : [];
  });
}

export function rollEncounterSelections(
  project: ProjectState,
  selections: readonly EncounterRollSelection[],
  random: () => number = Math.random,
  tableOdds?: EncounterRollTableOdds,
): EncounterRollResult[] {
  const areaById = new Map(getEncounterRollAreas(project).map((area) => [area.encounterId, area]));
  const caughtSpecies = new Set<number>();
  const rolledAreas = new Set<number>();
  const results: EncounterRollResult[] = [];
  const normalizedTableOdds = normalizeTableOdds(tableOdds);
  const obtainedEvolutionItemIds = new Set(tableOdds?.obtainedEvolutionItemIds ?? []);

  for (const selection of selections) {
    if (rolledAreas.has(selection.encounterId)) continue;
    const area = areaById.get(selection.encounterId);
    const table = area && selection.tableKey === AUTO_ENCOUNTER_TABLE_KEY
      ? chooseAutomaticTable(area, normalizedTableOdds, random)
      : area?.tables.find((candidate) => candidate.key === selection.tableKey);
    if (!area || !table || table.slots.length === 0) continue;
    rolledAreas.add(area.encounterId);

    const nonDupeSlots = table.slots.filter((slot) => !caughtSpecies.has(slot.speciesId));
    const eligibleSlots = nonDupeSlots.length > 0 ? nonDupeSlots : table.slots;
    const slot = weightedPick(eligibleSlots, random);
    const tableChancePercent = speciesChancePercent(table.slots, slot.speciesId);
    const effectiveChancePercent = speciesChancePercent(eligibleSlots, slot.speciesId);
    const level = normalizedTableOdds.maxLevel ?? randomInteger(slot.minLevel, slot.maxLevel, random);
    const nature = NATURES[randomInteger(0, NATURES.length - 1, random)] ?? NATURES[0];
    const ivs = randomIvs(random);
    const evolvedTargets = evolvePokemonForLevelTargets(project, slot.speciesId, slot.formIndex, level, obtainedEvolutionItemIds);
    evolvedTargets.forEach((evolved) => results.push({
      speciesId: evolved.speciesId,
      formIndex: evolved.formIndex,
      speciesName: evolved.speciesName,
      level,
      encounterId: area.encounterId,
      areaLabel: area.label,
      tableLabel: table.label,
      nature,
      ivs,
      tableChancePercent,
      effectiveChancePercent,
      showdownText: formatRolledEncounter(project, evolved.speciesName, evolved.speciesId, evolved.formIndex, level, nature, ivs),
    }));
    caughtSpecies.add(slot.speciesId);
  }
  return results;
}

type EncounterRollMethod = "grass" | "grass_doubles" | "surf" | "fishing";

type NormalizedEncounterRollTableOdds = Omit<Required<EncounterRollTableOdds>, "maxLevel" | "obtainedEvolutionItemIds"> & {
  grassPercent: number;
  maxLevel?: number;
};

function normalizeTableOdds(tableOdds?: EncounterRollTableOdds): NormalizedEncounterRollTableOdds {
  const fishingPercent = validPercent(tableOdds?.fishingPercent ?? 0, "Fishing");
  const surfPercent = validPercent(tableOdds?.surfPercent ?? 0, "Surf");
  const grassDoublesPercent = validPercent(tableOdds?.grassDoublesPercent ?? 0, "Grass Doubles");
  const configuredTotal = fishingPercent + surfPercent + grassDoublesPercent;
  if (configuredTotal > 100) throw new Error("Fishing, Surf, and Grass Doubles percentages cannot total more than 100%.");
  const maxLevel = Number.isFinite(tableOdds?.maxLevel) && Number(tableOdds?.maxLevel) >= 1
    ? Math.min(100, Math.trunc(Number(tableOdds?.maxLevel)))
    : undefined;
  return {
    fishingPercent,
    surfPercent,
    grassDoublesPercent,
    grassPercent: 100 - configuredTotal,
    maxLevel,
  };
}

function validPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be from 0% to 100%.`);
  return value;
}

function chooseAutomaticTable(
  area: EncounterRollArea,
  tableOdds: NormalizedEncounterRollTableOdds,
  random: () => number,
): EncounterRollTable | undefined {
  const eligibleTables = automaticTablesForArea(area, tableOdds.maxLevel ?? 100);
  if (eligibleTables.length === 0) return undefined;
  const methodTables = new Map<EncounterRollMethod, EncounterRollTable>();
  for (const method of ["grass", "grass_doubles", "surf", "fishing"] as const) {
    const table = preferredMethodTable(eligibleTables, method);
    if (table) methodTables.set(method, table);
  }
  const weightedMethods = [
    { method: "grass" as const, weight: tableOdds.grassPercent },
    { method: "grass_doubles" as const, weight: tableOdds.grassDoublesPercent },
    { method: "surf" as const, weight: tableOdds.surfPercent },
    { method: "fishing" as const, weight: tableOdds.fishingPercent },
  ].filter(({ method, weight }) => weight > 0 && methodTables.has(method));
  if (weightedMethods.length === 0) return defaultTable(eligibleTables);
  if (weightedMethods.length === 1) return methodTables.get(weightedMethods[0].method);
  const total = weightedMethods.reduce((sum, candidate) => sum + candidate.weight, 0);
  let target = randomUnit(random) * total;
  for (const candidate of weightedMethods) {
    if (target < candidate.weight) return methodTables.get(candidate.method);
    target -= candidate.weight;
  }
  return methodTables.get(weightedMethods[weightedMethods.length - 1].method);
}

function automaticTablesForArea(area: EncounterRollArea, maxLevel: number): EncounterRollTable[] {
  return area.tables.filter((table) => table.maxLevel <= maxLevel && encounterRollMethod(table.kind) !== undefined);
}

function preferredMethodTable(tables: readonly EncounterRollTable[], method: EncounterRollMethod): EncounterRollTable | undefined {
  return tables
    .filter((table) => encounterRollMethod(table.kind) === method)
    .sort((left, right) => {
      if (method === "fishing") {
        const rodDifference = fishingKindPriority(left.kind) - fishingKindPriority(right.kind);
        if (rodDifference !== 0) return rodDifference;
      }
      const seasonDifference = (left.season === "spring" ? 0 : 1) - (right.season === "spring" ? 0 : 1);
      if (seasonDifference !== 0) return seasonDifference;
      return right.maxLevel - left.maxLevel;
    })[0];
}

function encounterRollMethod(kind: EncounterKind): EncounterRollMethod | undefined {
  if (kind === "grass") return "grass";
  if (kind === "grass_doubles") return "grass_doubles";
  if (kind === "surf") return "surf";
  if (kind === "old_rod" || kind === "good_rod" || kind === "super_rod") return "fishing";
  return undefined;
}

function fishingKindPriority(kind: EncounterKind): number {
  if (kind === "super_rod") return 0;
  if (kind === "good_rod") return 1;
  if (kind === "old_rod") return 2;
  return 3;
}

export function parseEncounterRollStatics(project: ProjectState, showdownText: string): EncounterRollStatic[] {
  return showdownText
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      try {
        const pokemon = parseShowdownTeam(project, block)[0];
        if (!pokemon) throw new Error("Pokemon set is empty.");
        return {
          speciesId: pokemon.speciesId,
          formIndex: pokemon.formIndex,
          speciesName: pokemon.speciesName,
          level: pokemon.level,
          showdownText: block,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Static Pokémon ${index + 1}: ${message}`);
      }
    });
}

function getRollTables(project: ProjectState, encounterId: number, raw: Record<string, number>): EncounterRollTable[] {
  const tables: EncounterRollTable[] = [];
  const seasons = isGen4Project(project) ? (["spring"] as const) : ENCOUNTER_SEASONS;
  const kinds = [...encounterKindsForGroup("grass", project), ...encounterKindsForGroup("water", project)];
  for (const season of seasons) {
    for (const kind of kinds) {
      if (!encounterKindHasRate(project, kind) || !encounterKindHasLevels(project, kind) || !encounterKindHasPercent(project, kind)) continue;
      if (Number(raw[`${season}_${kind}_rate`] ?? 0) <= 0) continue;
      const slots: EncounterRollSlot[] = [];
      for (let slotIndex = 0; slotIndex < encounterSlotCount(kind, project); slotIndex += 1) {
        const base = `${season}_${kind}_slot_${slotIndex}`;
        const encodedSpecies = Number(raw[base] ?? 0);
        const speciesId = encodedSpecies % 2048;
        const weight = encounterPercentFor(kind, slotIndex);
        if (speciesId <= 0 || weight <= 0) continue;
        const minLevel = clampLevel(Number(raw[`${base}_min_level`] ?? 1));
        const maxLevel = Math.max(minLevel, clampLevel(Number(raw[`${base}_max_level`] ?? minLevel)));
        slots.push({
          speciesId,
          formIndex: isGen4Project(project) ? 0 : Math.floor(encodedSpecies / 2048),
          minLevel,
          maxLevel,
          weight,
        });
      }
      if (slots.length === 0) continue;
      tables.push({
        key: `${encounterId}:${season}:${kind}`,
        encounterId,
        season,
        kind,
        label: isGen4Project(project)
          ? encounterKindLabel(project, kind)
          : `${titleize(season)} · ${encounterKindLabel(project, kind)}`,
        maxLevel: Math.max(...slots.map((slot) => slot.maxLevel)),
        slots,
      });
    }
  }
  return tables;
}

function defaultTable(tables: readonly EncounterRollTable[]): EncounterRollTable {
  return [...tables].sort((left, right) => {
    const leftSeason = left.season === "spring" ? 0 : 1;
    const rightSeason = right.season === "spring" ? 0 : 1;
    if (leftSeason !== rightSeason) return leftSeason - rightSeason;
    return kindPriority(left.kind) - kindPriority(right.kind);
  })[0];
}

function kindPriority(kind: EncounterKind): number {
  const index = DEFAULT_KIND_PRIORITY.indexOf(kind);
  return index < 0 ? DEFAULT_KIND_PRIORITY.length : index;
}

function weightedPick(slots: readonly EncounterRollSlot[], random: () => number): EncounterRollSlot {
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
  let target = randomUnit(random) * total;
  for (const slot of slots) {
    if (target < slot.weight) return slot;
    target -= slot.weight;
  }
  return slots[slots.length - 1];
}

function speciesChancePercent(slots: readonly EncounterRollSlot[], speciesId: number): number {
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
  if (total <= 0) return 0;
  const speciesWeight = slots.reduce((sum, slot) => sum + (slot.speciesId === speciesId ? slot.weight : 0), 0);
  return speciesWeight / total * 100;
}

function randomInteger(min: number, max: number, random: () => number): number {
  return min + Math.floor(randomUnit(random) * (max - min + 1));
}

function randomUnit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

function formatRolledEncounter(
  project: ProjectState,
  speciesName: string,
  speciesId: number,
  formIndex: number,
  level: number,
  nature: string,
  ivs: EncounterRollIvs,
): string {
  const species = formIndex > 0 ? `${speciesName}^${formIndex}` : speciesName;
  const lines = [
    species,
    `Level: ${level}`,
    `${nature} Nature`,
    `IVs: ${ivs.hp} HP / ${ivs.atk} Atk / ${ivs.def} Def / ${ivs.spa} SpA / ${ivs.spd} SpD / ${ivs.spe} Spe`,
  ];
  for (const move of encounterMoves(project, speciesId, formIndex, level)) lines.push(`- ${move}`);
  return lines.join("\n");
}

function randomIvs(random: () => number): EncounterRollIvs {
  return {
    hp: randomInteger(0, 31, random),
    atk: randomInteger(0, 31, random),
    def: randomInteger(0, 31, random),
    spa: randomInteger(0, 31, random),
    spd: randomInteger(0, 31, random),
    spe: randomInteger(0, 31, random),
  };
}

function encounterMoves(project: ProjectState, speciesId: number, formIndex: number, level: number): string[] {
  if (!project.narcs.learnsets) return [];
  let learnsetId = speciesId;
  if (formIndex > 0 && project.narcs.personal) {
    try {
      const basePersonal = decodeRecord(project, "personal", speciesId).raw;
      const firstFormId = Number(basePersonal?.form_id ?? 0);
      const formPersonalId = firstFormId + formIndex - 1;
      if (firstFormId > 0 && project.narcs.learnsets.rawFiles[formPersonalId]) learnsetId = formPersonalId;
    } catch {
      // Fall back to the base species learnset.
    }
  }
  if (!project.narcs.learnsets.rawFiles[learnsetId]) return [];
  try {
    const raw = decodeRecord(project, "learnsets", learnsetId).raw;
    if (!raw) return [];
    return learnsetEntries(raw)
      .filter((entry) => entry.moveId > 0 && entry.level <= level)
      .slice(-4)
      .map((entry) => project.texts.banks.moves?.[entry.moveId] || String(entry.moveId));
  } catch {
    return [];
  }
}

function cleanLocation(value: string): string {
  return value.replace(/\s*\(\d+\)\s*$/u, "").trim();
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function titleize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
