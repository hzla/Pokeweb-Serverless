import type { Move as CalcMoveData, Specie, TypeName, Weather } from "@smogon/calc/dist/data/interface";
import { balanceStartingMoves, createBalanceEvolutionPlanner, type BalanceEvolutionOptions } from "./balanceEvolution";
import { balanceGeneration, balanceId, gen5BalanceData, reliableBalanceWin, type BalanceMove, type BalancePokemon, type BalanceWin } from "./balanceMatchup";
import { resolveCalcItemName } from "./calcItemNames";
import { isGen5Project, TYPES } from "./constants";
import { showdownName } from "./docGeneratorModel";
import { getEncounterRollAreas, type EncounterRollArea, type EncounterRollTable } from "./encounterRollModel";
import { getMoveRecord } from "./moveItemModel";
import { pokemonSpeciesLabel } from "./pokemonLabels";
import { pokemonFormSpeciesLabel } from "./pokemonFormLabels";
import { decodeRecord, type ProjectState } from "./projectStore";
import { getTrainerMemberSettings } from "./trainerCustomizationModel";
import { getTrainerFieldConditions } from "./trainerFieldConditionsModel";
import { getTrainerRecord, type TrainerPokemonSlot, type TrainerRecord } from "./trainerModel";
import { hasMoveAlternatives } from "./trainerMovePools";
import { trainerHasRosterVariants } from "./trainerRosterHub";
import { getTrainerSlotMovePools, trainerSlotMoves } from "./trainerRosterModel";
import { trainerFormPersonalId, trainerIv } from "./trainerSlotFacts";
import { getTypeChart, typeChartOverlayId } from "./typeChartModel";
import { inspectMoveEffects } from "./moveEffectsModel";
import { inspectAbilityEffects } from "./abilityEffectsModel";
import { inspectItemEffect } from "./itemEffectsModel";
import { listCodeInjectionDlls } from "./pmcModel";

export type BalanceCatch = { area: string; table: string; levels: string[]; weight: number; caughtAs?: string };
export type BalanceAnswer = Omit<BalanceWin, "moveIndex"> & { species: string; ability: string; catches: BalanceCatch[] };
export type BalanceReport = {
  playerLevel: number;
  candidates: number;
  skipped: number;
  slots: Array<{ species: string; level: number; answers: BalanceAnswer[]; ignoredMoves: string[]; issue?: string }>;
};

const unsupportedAttacks = new Set([
  "Assist", "Bide", "Bounce", "Copycat", "Counter", "Destiny Bond", "Dig", "Dive", "Dragon Tail", "Endeavor", "Explosion",
  "Covet", "Fake Out", "Final Gambit", "Fly", "Focus Punch", "Future Sight", "Knock Off", "Last Resort", "Me First", "Metronome",
  "Mirror Coat", "Mirror Move", "Nature Power", "Natural Gift", "Revenge", "Avalanche", "Round", "Self-Destruct",
  "Sky Drop", "Sleep Talk", "Snore", "Spit Up", "Struggle", "Sucker Punch", "Thief", "Triple Kick", "U-turn", "Volt Switch",
]);
const statefulAbilities = new Set([
  "Anger Point", "Color Change", "Contrary", "Defeatist", "Defiant", "Flash Fire", "Harvest", "Imposter",
  "Klutz", "Moody", "Mummy", "Rivalry", "Slow Start", "Speed Boost", "Trace", "Truant", "Unburden", "Weak Armor", "Zen Mode",
]);
const unsupportedItems = new Set([
  "Custap Berry", "Eject Button", "Enigma Berry", "Focus Band", "King's Rock", "Lagging Tail", "Full Incense",
  "Red Card", "Razor Fang", "Ring Target", "Shell Bell", "White Herb",
]);
const natureStats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const personalStats = ["base_hp", "base_atk", "base_def", "base_spatk", "base_spdef", "base_speed"] as const;

export function balancePlayerLevel(trainer: TrainerRecord): number {
  return Math.max(0, ...trainer.party.map(({ level }) => level));
}

export function balanceReportBlocker(project: ProjectState, trainer: TrainerRecord): string | undefined {
  if (!isGen5Project(project)) return "The balance report supports Black, White, Black 2 and White 2.";
  if (trainer.raw.battle_type_1 !== 0 || !trainer.party.length) return "Choose a singles trainer with a party.";
  const level = balancePlayerLevel(trainer);
  if (!Number.isInteger(level) || level < 1 || level > 100) return "The boss’s highest Pokémon level must be from 1 to 100.";
  if (!project.narcs.encounters || !project.narcs.personal || !project.narcs.moves || !project.narcs.learnsets || !project.narcs.evolutions) {
    return "Load the Encounters, Pokémon, Learnsets, Evolutions and Moves data to run a balance report.";
  }
  if (trainerHasRosterVariants(project, trainer.id)) return "Choose a trainer with a fixed roster.";
  const fields = getTrainerFieldConditions(project, trainer.id);
  if (fields.fields || fields.player || fields.opponent || fields.playerSpikes || fields.playerToxicSpikes
    || fields.opponentSpikes || fields.opponentToxicSpikes) return "This trainer has starting field conditions outside the report's damage model.";
  return undefined;
}

export function suggestedBalanceTables(areas: readonly EncounterRollArea[], level: number): string[] {
  return areas.flatMap(({ tables }) => tables.filter((table) => table.maxLevel <= level).map((table) => table.key));
}

type CatchSlot = {
  tableKey: string;
  area: string;
  table: string;
  weight: number;
  caughtAs?: string;
  levels: Set<number>;
};
type CatchCandidate = { speciesId: number; form: number; sources: Map<number, CatchSlot[]> };

async function catchCandidates(
  project: ProjectState, areas: readonly EncounterRollArea[], tables: ReadonlySet<string>, playerLevel: number,
  options: BalanceEvolutionOptions, signal?: AbortSignal,
): Promise<{ candidates: CatchCandidate[]; skipped: number }> {
  const evolve = createBalanceEvolutionPlanner(project, playerLevel, options);
  const slotPlans = new Map<string, Map<CatchCandidate, Map<number, Set<number>>>>();
  const candidates = new Map<string, CatchCandidate>();
  const names = new Map<string, string>();
  let skipped = 0;
  let selected = 0;
  for (const area of areas) {
    for (const table of area.tables) {
      if (!tables.has(table.key)) continue;
      if (selected++ % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      for (const slot of table.slots) {
        if (slot.minLevel > playerLevel) continue;
        const identity = `${slot.speciesId}:${slot.formIndex}`;
        const max = Math.min(slot.maxLevel, playerLevel);
        const planKey = `${identity}:${slot.minLevel}:${max}`;
        try {
          let plan = slotPlans.get(planKey);
          if (!plan) {
            plan = new Map();
            for (let level = slot.minLevel; level <= max; level += 1) {
              for (const target of evolve(slot.speciesId, slot.formIndex, level)) {
                const key = `${target.speciesId}:${target.form}`;
                const candidate = candidates.get(key) ?? { speciesId: target.speciesId, form: target.form, sources: new Map() };
                candidates.set(key, candidate);
                const moves = plan.get(candidate) ?? new Map<number, Set<number>>();
                for (const move of target.moves) {
                  const catchLevels = moves.get(move) ?? new Set<number>();
                  catchLevels.add(level);
                  moves.set(move, catchLevels);
                }
                plan.set(candidate, moves);
              }
            }
            slotPlans.set(planKey, plan);
          }
          for (const [candidate, moves] of plan) {
            let caughtAs: string | undefined;
            if (candidate.speciesId !== slot.speciesId || candidate.form !== slot.formIndex) {
              caughtAs = names.get(identity) ?? personalFields(project, slot.speciesId, slot.formIndex).name;
              names.set(identity, caughtAs);
            }
            for (const [move, levels] of moves) {
              const sources = candidate.sources.get(move) ?? [];
              sources.push({ tableKey: table.key, area: area.label, table: table.label, weight: slot.weight, levels, caughtAs });
              candidate.sources.set(move, sources);
            }
          }
        } catch {
          skipped += 1;
        }
      }
    }
  }
  return { candidates: [...candidates.values()], skipped };
}

function catchLocations(sources: readonly CatchSlot[]): BalanceCatch[] {
  const locations = new Map<string, BalanceCatch>();
  for (const { tableKey, area, table, weight, levels, caughtAs } of sources) {
    const key = `${tableKey}:${caughtAs ?? ""}`;
    const location = locations.get(key) ?? { area, table, weight: 0, levels: [], ...(caughtAs ? { caughtAs } : {}) };
    location.weight += weight;
    for (let start = 1; start <= 100; start += 1) {
      if (!levels.has(start)) continue;
      let end = start;
      while (levels.has(end + 1)) end += 1;
      const range = end === start ? String(start) : `${start}–${end}`;
      if (!location.levels.includes(range)) location.levels.push(range);
      start = end;
    }
    locations.set(key, location);
  }
  return [...locations.values()];
}

function personalFields(project: ProjectState, speciesId: number, form: number) {
  const baseId = trainerFormPersonalId(project, speciesId, 0);
  const personalId = form ? trainerFormPersonalId(project, speciesId, form) : baseId;
  const raw = decodeRecord(project, "personal", personalId).raw;
  const baseName = pokemonSpeciesLabel(project, speciesId);
  const name = form ? pokemonFormSpeciesLabel(baseName, form, personalId !== baseId ? project.texts.banks.pokedex?.[personalId] : undefined) : baseName;
  if (!raw) throw new Error(`Missing personal data for ${name}.`);
  const baseStats = Object.fromEntries(natureStats.map((stat, index) => [stat, raw[personalStats[index]]])) as Specie["baseStats"];
  if (natureStats.some((stat) => !baseStats[stat])) throw new Error(`Incomplete base stats for ${name}.`);
  const first = TYPES[raw.type_1] as TypeName | undefined;
  const second = TYPES[raw.type_2] as TypeName | undefined;
  if (!first || !second) throw new Error(`Unknown type for ${name}.`);
  const types: Specie["types"] = first === second ? [first] : [first, second];
  return { baseId, personalId, name, raw, species: { baseStats, types, weightkg: raw.weight / 10 } };
}

function supportedAbility(project: ProjectState, id: number, custom: ReadonlySet<number>): string {
  if (!id) return "";
  const name = String(project.texts.banks.abilities?.[id] ?? "");
  const stock = gen5BalanceData.abilities.get(balanceId(name));
  if (!stock || custom.has(id) || statefulAbilities.has(stock.name)) throw new Error(`Ability outside the damage model: ${name || id}.`);
  return stock.name;
}

type ParsedMove = { attack?: BalanceMove; ignored?: string; issue?: string };

function readMove(project: ProjectState, id: number, custom: ReadonlySet<number>): ParsedMove {
  const { raw, readable } = getMoveRecord(project, id);
  const name = String(readable.name);
  const stock = gen5BalanceData.moves.get(balanceId(showdownName(name)));
  // Status and setup moves are outside the repeated-attack comparison.
  if (raw.category === 0 && !custom.has(id) && !unsupportedAttacks.has(stock?.name ?? name)) return { ignored: name };
  const type = TYPES[raw.type] as TypeName | undefined;
  if (!type || (raw.category !== 1 && raw.category !== 2) || custom.has(id) || raw.effect_category === 9
    || unsupportedAttacks.has(stock?.name ?? name) || readable.requires_charge || readable.recharge_turn
    || (!stock && (!raw.power || raw.effect || raw.effect_category > 8))) return { issue: name };

  const minHits = Number(readable.min_hits) || 1;
  const maxHits = Math.max(minHits, Number(readable.max_hits) || 1);
  const recoilOrDrain = (raw.effect_category === 8 ? raw.recoil : Number(readable.recoil)) / 100;
  const data: Partial<CalcMoveData> = {
    basePower: raw.power,
    type,
    category: raw.category === 1 ? "Physical" : "Special",
    priority: raw.priority > 127 ? raw.priority - 256 : raw.priority,
    willCrit: raw.crit === 6,
    flags: { ...stock?.flags, contact: readable.contact ? 1 : undefined, sound: readable.sound_move ? 1 : undefined, punch: readable.punch_move ? 1 : undefined },
    secondaries: raw.effect_chance > 0 || raw.flinch > 0 || raw.stat_chance_1 > 0 || raw.stat_chance_2 > 0 || raw.stat_chance_3 > 0,
    ...(raw.effect_category === 8 && recoilOrDrain > 0 ? { drain: [recoilOrDrain, 1] } : {}),
    ...(raw.effect_category !== 8 && recoilOrDrain > 0 ? { recoil: [recoilOrDrain, 1] } : {}),
    multihit: maxHits > 1 ? [minHits, maxHits] : 1,
  };
  return { attack: { name, mechanics: stock?.name ?? name, data, accurate: raw.accuracy === 0 || raw.accuracy >= 100, pp: raw.pp, minHits, maxHits } };
}

function bossItem(project: ProjectState, id: number, checkCustom: boolean): string | undefined {
  if (!id) return undefined;
  const name = String(project.texts.banks.items?.[id] ?? "");
  const item = gen5BalanceData.items.get(balanceId(resolveCalcItemName(name) ?? name));
  if (!item || unsupportedItems.has(item.name) || (item.isBerry && item.name !== "Oran Berry" && item.name !== "Sitrus Berry")
    || (checkCustom && inspectItemEffect(project, id).rules)) throw new Error(`Held item outside the damage model: ${name || id}.`);
  return item.name;
}

function bossSlot(
  project: ProjectState, trainer: TrainerRecord, slot: TrainerPokemonSlot, move: (id: number) => ParsedMove,
  customAbilities: ReadonlySet<number>, checkCustomItems: boolean,
): { boss: BalancePokemon; ignoredMoves: string[] } {
  const settings = getTrainerMemberSettings(project, trainer.id, slot.slot);
  if (settings.status || settings.hpMode) throw new Error("This slot has custom starting HP or status.");
  if (hasMoveAlternatives(getTrainerSlotMovePools(project, trainer.id, slot.slot))) throw new Error("This slot has randomized moves.");
  const personal = personalFields(project, slot.speciesId, slot.form);
  const itemId = trainer.hasItems ? Number(decodeRecord(project, "trpok", trainer.id).raw?.[`item_id_${slot.slot}`] ?? 0) : 0;
  const moveIds = trainer.hasMoves ? trainerSlotMoves(project, trainer.id, slot.slot).filter(Boolean)
    : balanceStartingMoves(project, personal.personalId, personal.baseId, slot.level);
  if (!moveIds.length) throw new Error("This slot has no readable moves.");
  const moves = moveIds.map(move);
  const unknown = moves.flatMap(({ issue }) => issue ? [issue] : []);
  if (unknown.length) throw new Error(`Moves outside the damage model: ${unknown.join(", ")}.`);
  return {
    boss: {
      name: personal.name, species: personal.species, level: slot.level, iv: trainerIv(slot.ivs), nature: slot.nature,
      ability: supportedAbility(project, personal.raw[`ability_${slot.resolvedAbilitySlot}`] || personal.raw.ability_1, customAbilities),
      item: bossItem(project, itemId, checkCustomItems),
      moves: moves.flatMap(({ attack }) => attack ? [attack] : []),
    },
    ignoredMoves: moves.flatMap(({ ignored }) => ignored ? [ignored] : []),
  };
}

export async function buildBalanceReport(
  project: ProjectState, trainerId: number, tableKeys: readonly string[], options: BalanceEvolutionOptions = {}, signal?: AbortSignal,
): Promise<BalanceReport> {
  const trainer = getTrainerRecord(project, trainerId, { includeTexts: false });
  const blocker = balanceReportBlocker(project, trainer);
  if (blocker) throw new Error(blocker);
  const playerLevel = balancePlayerLevel(trainer);
  const areas = getEncounterRollAreas(project);
  const availableKeys = new Set(areas.flatMap(({ tables }) => tables.map((table) => table.key)));
  const keys = new Set(tableKeys);
  if (!keys.size || [...keys].some((key) => !availableKeys.has(key))) throw new Error("Confirm the available encounter tables.");
  if (!areas.some(({ tables }) => tables.some((table) => keys.has(table.key) && table.slots.some((slot) => slot.minLevel <= playerLevel)))) {
    throw new Error("The selected tables have no catches at or below the player level.");
  }
  const { candidates, skipped: skippedCatches } = await catchCandidates(project, areas, keys, playerLevel, options, signal);

  const chart = new Map<string, Record<string, number>>();
  if (project.narcs.type_chart || project.overlays[typeChartOverlayId(project)]) {
    for (const cell of getTypeChart(project)) {
      const attack = TYPES[cell.attackIndex];
      const defend = TYPES[cell.defendIndex];
      if (!chart.has(attack)) chart.set(attack, {});
      chart.get(attack)![defend] = cell.value / 4;
    }
  }
  const gen = balanceGeneration(chart);
  const runtimeFiles = listCodeInjectionDlls(project).map(({ path }) => path.toLowerCase());
  const hasRuntime = (name: string) => runtimeFiles.some((path) => path.endsWith(name));
  const customMoves = new Set(hasRuntime("moveeffects.dll") ? inspectMoveEffects(project).rules.keys() : []);
  const customAbilities = new Set(hasRuntime("abilityeffects.dll") ? inspectAbilityEffects(project).rules.keys() : []);
  const checkCustomItems = hasRuntime("itemeffects.dll");
  const weatherIndex = getTrainerFieldConditions(project, trainerId).weather;
  const weather = ([undefined, undefined, "Sun", "Rain", "Hail", "Sand"] as const)[weatherIndex] as Weather | undefined;

  const moveCache = new Map<number, ParsedMove>();
  function move(id: number): ParsedMove {
    let parsed = moveCache.get(id);
    if (!parsed) {
      try {
        parsed = readMove(project, id, customMoves);
      } catch {
        parsed = { issue: project.texts.banks.moves?.[id] ?? `Move #${id}` };
      }
      moveCache.set(id, parsed);
    }
    return parsed;
  }

  const slots: BalanceReport["slots"] = [];
  const bosses = trainer.party.map((slot) => {
    const result: BalanceReport["slots"][number] = { species: slot.speciesName, level: slot.level, answers: [], ignoredMoves: [] };
    slots.push(result);
    try {
      const { boss, ignoredMoves } = bossSlot(project, trainer, slot, move, customAbilities, checkCustomItems);
      result.species = boss.name;
      result.ignoredMoves = ignoredMoves;
      return boss;
    } catch (error) {
      result.issue = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  });

  let skipped = skippedCatches;
  for (const [index, candidate] of candidates.entries()) {
    if (index % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    try {
      const personal = personalFields(project, candidate.speciesId, candidate.form);
      const levelAttacks = [...candidate.sources.keys()].map((id) => ({ id, ...move(id) }));
      const moves = levelAttacks.flatMap(({ id, attack }) => {
        const changesOwnStats = attack && gen5BalanceData.moves.get(balanceId(attack.mechanics))?.self?.boosts;
        return attack && !changesOwnStats ? [{ id, attack }] : [];
      });
      if (!moves.length) {
        if (levelAttacks.some(({ issue }) => issue)) skipped += 1;
        continue;
      }
      const abilities = new Set([personal.raw.ability_1, personal.raw.ability_2].filter(Boolean));
      if (!abilities.size) abilities.add(0);
      let skippedAbility = false;
      for (const abilityId of abilities) {
        let ability: string;
        try {
          ability = supportedAbility(project, abilityId, customAbilities);
        } catch {
          skippedAbility = true;
          continue;
        }
        const player: BalancePokemon = { name: personal.name, species: personal.species, level: playerLevel, iv: 15, nature: "Hardy", moves: moves.map(({ attack }) => attack), ability };
        for (const [slot, boss] of bosses.entries()) {
          if (!boss) continue;
          try {
            const win = reliableBalanceWin(gen, player, boss, weather);
            if (win) {
              const { moveIndex, ...answer } = win;
              const sources = candidate.sources.get(moves[moveIndex].id)!;
              slots[slot].answers.push({ ...answer, species: player.name, ability, catches: catchLocations(sources) });
            }
          } catch {
            skippedAbility = true;
          }
        }
      }
      if (skippedAbility) skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  for (const slot of slots) slot.answers.sort((a, b) => b.hpPercent - a.hpPercent || a.turns - b.turns || a.species.localeCompare(b.species));
  return { playerLevel, candidates: candidates.length, skipped, slots };
}

export function balanceTableLabel(table: EncounterRollTable): string {
  const min = Math.min(...table.slots.map((slot) => slot.minLevel));
  return `${table.label} · Lv ${min === table.maxLevel ? min : `${min}–${table.maxLevel}`}`;
}
