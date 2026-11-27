import { ENCOUNTER_SEASONS, NATURES, isGen4Project, typeNamesForProject } from "./constants";
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
import { evolvePokemonForLevelTargets, type TestTeamEvolution } from "./testTeamEvolution";
import { trainerFormPersonalId } from "./trainerSlotFacts";

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

export const ENCOUNTER_ROLL_PERCENT_FIELDS = [
  { field: "grassDoublesPercent", method: "grass_doubles", label: "Grass Doubles" },
  { field: "surfPercent", method: "surf", label: "Surf" },
  { field: "fishingPercent", method: "super_rod", label: "Fishing" },
  { field: "landPhenomenaPercent", method: "grass_special", label: "Land phenomena" },
  { field: "ripplingWaterPercent", method: "surf_special", label: "Rippling water" },
  { field: "ripplingFishingPercent", method: "super_rod_special", label: "Fishing (ripples)" },
] as const;

type EncounterRollPercentField = (typeof ENCOUNTER_ROLL_PERCENT_FIELDS)[number]["field"];
type EncounterRollMethod = "grass" | (typeof ENCOUNTER_ROLL_PERCENT_FIELDS)[number]["method"];
type EncounterRollMethodWeight = { method: EncounterRollMethod; weight: number };

export type EncounterRollPercentages = Partial<Record<EncounterRollPercentField, number>>;
export type EncounterRollStrategy = "weighted" | "smart";

type AutomaticTableOptions = EncounterRollPercentages & {
  strategy?: EncounterRollStrategy;
};

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

export type EncounterRollTableOdds = AutomaticTableOptions & {
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
  options?: AutomaticTableOptions,
): EncounterRollSelection[] {
  if (!Number.isFinite(maxLevel) || maxLevel < 1 || maxLevel > 100) {
    throw new Error("Enter a level from 1 to 100.");
  }
  const level = Math.trunc(maxLevel);
  const smart = options?.strategy === "smart";
  const weights = automaticTables && !smart ? tableWeights(options) : [];
  return areas.flatMap((area) => {
    if (automaticTables) {
      const tables = smart ? tablesWithinLevel(area, level) : automaticTablesForArea(area, level, weights);
      return tables.length > 0
        ? [{ encounterId: area.encounterId, tableKey: AUTO_ENCOUNTER_TABLE_KEY }]
        : [];
    }
    const table = area.tables.find((candidate) => candidate.key === area.defaultTableKey);
    return table && table.maxLevel <= level
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
  const smart = tableOdds?.strategy === "smart";
  const weights = smart ? [] : tableWeights(tableOdds);
  const maxLevel = Number.isFinite(tableOdds?.maxLevel) && Number(tableOdds?.maxLevel) >= 1
    ? Math.min(100, Math.trunc(Number(tableOdds?.maxLevel)))
    : undefined;
  const obtainedEvolutionItemIds = new Set(tableOdds?.obtainedEvolutionItemIds ?? []);
  const smartRoll = smart ? createSmartTableSelection(project, caughtSpecies, maxLevel, obtainedEvolutionItemIds) : undefined;

  for (const selection of selections) {
    if (rolledAreas.has(selection.encounterId)) continue;
    const area = areaById.get(selection.encounterId);
    if (!area) continue;
    const table = selection.tableKey === AUTO_ENCOUNTER_TABLE_KEY
      ? smartRoll
        ? smartRoll.chooseTable(area)
        : chooseAutomaticTable(area, weights, maxLevel ?? 100, random)
      : area.tables.find((candidate) => candidate.key === selection.tableKey);
    if (!table || table.slots.length === 0) continue;
    rolledAreas.add(area.encounterId);

    const eligibleSlots = eligibleEncounterSlots(table, caughtSpecies);
    const slot = weightedPick(eligibleSlots, random);
    const tableChancePercent = speciesChancePercent(table.slots, slot.speciesId);
    const effectiveChancePercent = speciesChancePercent(eligibleSlots, slot.speciesId);
    const level = maxLevel ?? randomInteger(slot.minLevel, slot.maxLevel, random);
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
    smartRoll?.recordCatch(evolvedTargets);
    caughtSpecies.add(slot.speciesId);
  }
  return results;
}

function eligibleEncounterSlots(table: EncounterRollTable, caughtSpecies: ReadonlySet<number>): readonly EncounterRollSlot[] {
  const nonDupeSlots = table.slots.filter((slot) => !caughtSpecies.has(slot.speciesId));
  return nonDupeSlots.length > 0 ? nonDupeSlots : table.slots;
}

function tablesWithinLevel(area: EncounterRollArea, maxLevel: number): EncounterRollTable[] {
  return area.tables.filter((table) => table.maxLevel <= maxLevel);
}

function createSmartTableSelection(
  project: ProjectState,
  caughtSpecies: ReadonlySet<number>,
  maxLevel: number | undefined,
  obtainedEvolutionItemIds: ReadonlySet<number>,
) {
  const typeCount = typeNamesForProject(project).length;
  const counts = new Map<number, number>();
  const typesByForm = new Map<string, ReadonlySet<number>>();
  const typesByOutcome = new Map<string, ReadonlySet<number>>();

  function pokemonTypes({ speciesId, formIndex }: TestTeamEvolution): ReadonlySet<number> {
    const key = `${speciesId}:${formIndex}`;
    const cached = typesByForm.get(key);
    if (cached) return cached;
    const types = new Set<number>();
    const personalId = trainerFormPersonalId(project, speciesId, formIndex);
    if (project.narcs.personal?.rawFiles[personalId]) {
      const personal = decodeRecord(project, "personal", personalId).raw;
      for (const type of [personal?.type_1, personal?.type_2]) {
        if (typeof type === "number" && Number.isInteger(type) && type >= 0 && type < typeCount) types.add(type);
      }
    }
    typesByForm.set(key, types);
    return types;
  }

  function outcomeTypes(slot: EncounterRollSlot, level: number): ReadonlySet<number> {
    const key = `${slot.speciesId}:${slot.formIndex}:${level}`;
    const cached = typesByOutcome.get(key);
    if (cached) return cached;
    const targets = evolvePokemonForLevelTargets(project, slot.speciesId, slot.formIndex, level, obtainedEvolutionItemIds);
    const types = new Set(targets.flatMap((target) => [...pokemonTypes(target)]));
    typesByOutcome.set(key, types);
    return types;
  }

  function tableChances(table: EncounterRollTable): ReadonlyMap<number, number> {
    const slots = eligibleEncounterSlots(table, caughtSpecies);
    const totalWeight = slots.reduce((total, slot) => total + slot.weight, 0);
    const chances = new Map<number, number>();
    for (const slot of slots) {
      const from = maxLevel ?? slot.minLevel;
      const through = maxLevel ?? slot.maxLevel;
      const chance = slot.weight / totalWeight / (through - from + 1);
      for (let level = from; level <= through; level += 1) {
        // A slot and level can only match a rarity group once, even with several types or evolutions.
        const matchingGroups = new Set([...outcomeTypes(slot, level)].map((type) => counts.get(type) ?? 0));
        for (const group of matchingGroups) chances.set(group, (chances.get(group) ?? 0) + chance);
      }
    }
    return chances;
  }

  return {
    chooseTable(area: EncounterRollArea): EncounterRollTable | undefined {
      const tables = tablesWithinLevel(area, maxLevel ?? 100);
      if (tables.length < 2) return tables[0];
      const rarityGroups = [...new Set([0, ...counts.values()])].sort((left, right) => left - right);
      return tables.map((table) => ({ table, chances: tableChances(table) })).sort((left, right) => {
        for (const group of rarityGroups) {
          const difference = (right.chances.get(group) ?? 0) - (left.chances.get(group) ?? 0);
          if (Math.abs(difference) > 1e-12) return difference;
        }
        return compareDefaultTables(left.table, right.table);
      })[0].table;
    },
    recordCatch(targets: readonly TestTeamEvolution[]): void {
      for (const target of targets) {
        for (const type of pokemonTypes(target)) counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    },
  };
}

function tableWeights(percentages?: EncounterRollPercentages): EncounterRollMethodWeight[] {
  const weights = ENCOUNTER_ROLL_PERCENT_FIELDS.map(({ field, method, label }) => ({
    method,
    weight: validPercent(percentages?.[field] ?? 0, label),
  }));
  const configuredTotal = weights.reduce((total, { weight }) => total + weight, 0);
  if (configuredTotal > 100) throw new Error("Automatic table chances cannot total more than 100%.");
  return [{ method: "grass", weight: 100 - configuredTotal }, ...weights];
}

function validPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be from 0% to 100%.`);
  return value;
}

function chooseAutomaticTable(
  area: EncounterRollArea,
  weights: readonly EncounterRollMethodWeight[],
  maxLevel: number,
  random: () => number,
): EncounterRollTable | undefined {
  const eligibleTables = automaticTablesForArea(area, maxLevel, weights);
  if (eligibleTables.length === 0) return undefined;
  const weightedTables = weights.flatMap(({ method, weight }) => {
    if (weight === 0) return [];
    const table = preferredMethodTable(eligibleTables, method);
    return table ? [{ table, weight }] : [];
  });
  if (weightedTables.length === 0) return defaultTable(eligibleTables);
  if (weightedTables.length === 1) return weightedTables[0].table;
  return weightedPick(weightedTables, random).table;
}

function automaticTablesForArea(
  area: EncounterRollArea,
  maxLevel: number,
  weights: readonly EncounterRollMethodWeight[],
): EncounterRollTable[] {
  return tablesWithinLevel(area, maxLevel).filter((table) => weights.some(({ method, weight }) =>
    encounterRollMethod(table.kind) === method && (weight > 0 || !method.endsWith("_special")),
  ));
}

function preferredMethodTable(tables: readonly EncounterRollTable[], method: EncounterRollMethod): EncounterRollTable | undefined {
  return tables
    .filter((table) => encounterRollMethod(table.kind) === method)
    .sort((left, right) => {
      if (method === "super_rod") {
        const rodDifference = fishingKindPriority(left.kind) - fishingKindPriority(right.kind);
        if (rodDifference !== 0) return rodDifference;
      }
      const seasonDifference = (left.season === "spring" ? 0 : 1) - (right.season === "spring" ? 0 : 1);
      if (seasonDifference !== 0) return seasonDifference;
      return right.maxLevel - left.maxLevel;
    })[0];
}

function encounterRollMethod(kind: EncounterKind): EncounterKind {
  return kind === "old_rod" || kind === "good_rod" ? "super_rod" : kind;
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
  return [...tables].sort(compareDefaultTables)[0];
}

function compareDefaultTables(left: EncounterRollTable, right: EncounterRollTable): number {
  const leftSeason = left.season === "spring" ? 0 : 1;
  const rightSeason = right.season === "spring" ? 0 : 1;
  return leftSeason - rightSeason || kindPriority(left.kind) - kindPriority(right.kind);
}

function kindPriority(kind: EncounterKind): number {
  const index = DEFAULT_KIND_PRIORITY.indexOf(kind);
  return index < 0 ? DEFAULT_KIND_PRIORITY.length : index;
}

function weightedPick<T extends { weight: number }>(choices: readonly T[], random: () => number): T {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let target = randomUnit(random) * total;
  for (const choice of choices) {
    if (target < choice.weight) return choice;
    target -= choice.weight;
  }
  return choices[choices.length - 1];
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
