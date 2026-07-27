import { readU16, writeU16 } from "../nds/binary";
import { recordGenericChange } from "./actionChangelog";
import { GROWTHS, isGen4Project, typeNamesForProject } from "./constants";
import { getEncounterCount } from "./encounterModel";
import { getGrottoCount, getMartCount } from "./martGrottoModel";
import { getItemCount, getMoveCount } from "./moveItemModel";
import { applyGen5InGameTradePatches, scanGen5InGameTrades } from "./ingameTradeModel";
import { patchGen5ScriptEncounters, scanGen5ScriptEncounterRefs } from "./gen5ScriptEncounterModel";
import { findPokemonPersonalFormOwner } from "./pokemonLabels";
import { getPokemonPersonalIds, learnsetEntries } from "./pokemonModel";
import { decodeRecord, markDirty, type ProjectState, type RawRecord, type ReadableRecord } from "./projectStore";
import { applyRandomizedStarters, detectStartersFromScriptBytes, findStarterScriptFileIds, getStarterEditorState } from "./starterModel";
import { getTmEntries, machineCountsForProject } from "./tmModel";
import { getTrainerCount } from "./trainerModel";

export type BaseStatsMode = "unchanged" | "shuffle" | "random" | "random-bst" | "buff-nerf";
export type PokemonTypesMode = "unchanged" | "random-follow-evolutions" | "completely-random";
export type AbilitiesMode = "unchanged" | "random";
export type EvolutionMode = "unchanged" | "random" | "random-every-level";
export type MovesetsMode = "unchanged" | "prefer-same-type" | "completely-random" | "metronome-only";
export type CompatibilityMode = "unchanged" | "prefer-type" | "completely-random" | "full";
export type TrainersMode = "unchanged" | "random" | "distributed" | "type-themed" | "keep-themed";
export type WildScope = "unchanged" | "slot" | "encounter" | "game";
export type ShopMode = "unchanged" | "shuffle" | "random";
export type StarterMode = "unchanged" | "random" | "random-basic" | "random-two-evolutions";
export type GiftPokemonMode = "unchanged" | "random" | "similar-strength";
export type InGameTradeMode = "unchanged" | "random-given" | "random-given-requested";

export type RandomizerSettings = {
  seed: string;
  pokemon: {
    baseStats: BaseStatsMode;
    bstVariancePercent: number;
    statsFollowEvolutions: boolean;
    types: PokemonTypesMode;
    dualTypeOnly: boolean;
    abilities: AbilitiesMode;
    abilitiesFollowEvolutions: boolean;
    allowWonderGuard: boolean;
    banNegativeAbilities: boolean;
    ensureTwoAbilities: boolean;
    expCurve: "unchanged" | "medium-fast" | "erratic" | "fluctuating" | "medium-slow" | "fast" | "slow";
    heldItems: "unchanged" | "random";
  };
  evolutions: {
    mode: EvolutionMode;
    similarStrength: boolean;
    sameType: boolean;
    maxThreeStages: boolean;
    forceChange: boolean;
    forceGrowth: boolean;
    noConvergence: boolean;
    changeImpossible: boolean;
    easierLevel: number | null;
    removeTimeBased: boolean;
  };
  movesets: {
    mode: MovesetsMode;
    randomizeEggMoves: boolean;
    guaranteedStartingMoves: number;
    reorderDamagingMoves: boolean;
    forceGoodDamaging: boolean;
    goodDamagingPercent: number;
    blockBrokenMoves: boolean;
    evolutionMoveForAll: boolean;
  };
  moveData: {
    powers: boolean;
    accuracies: boolean;
    pps: boolean;
    types: boolean;
    categories: boolean;
  };
  tmCompatibility: {
    mode: CompatibilityMode;
    fullHmCompatibility: boolean;
    levelUpMoveSanity: boolean;
    followEvolutions: boolean;
  };
  starters: {
    mode: StarterMode;
    unique: boolean;
    blockLegendaries: boolean;
  };
  gifts: {
    mode: GiftPokemonMode;
    randomizeGiftPokemon: boolean;
    randomizeEggs: boolean;
    blockLegendaries: boolean;
  };
  inGameTrades: {
    mode: InGameTradeMode;
    blockLegendaries: boolean;
    randomizeIvs: boolean;
    randomizeHeldItems: boolean;
  };
  trainers: {
    mode: TrainersMode;
    similarStrength: boolean;
    avoidDuplicates: boolean;
    blockLegendaries: boolean;
    evolvePokemon: boolean;
    levelModifierPercent: number;
    betterMovesets: boolean;
    randomHeldItems: boolean;
  };
  wild: {
    scope: WildScope;
    similarStrength: boolean;
    catchEmAll: boolean;
    blockLegendaries: boolean;
    keepPrimaryType: boolean;
    useTimeBasedEncounters: boolean;
    levelModifierPercent: number;
    minimumCatchRate: number;
  };
  grottos: {
    randomizePokemon: boolean;
    randomizeItems: boolean;
    levelModifierPercent: number;
  };
  shops: {
    mode: ShopMode;
    banBadItems: boolean;
    banRegularShopItems: boolean;
    banOverpoweredItems: boolean;
    guaranteeEvolutionItems: boolean;
    guaranteeXItems: boolean;
    addCheapRareCandy: boolean;
  };
};

export type RandomizerResult = {
  seed: string;
  changes: Partial<Record<"pokemon" | "evolutions" | "learnsets" | "eggMoves" | "moves" | "tmCompatibility" | "starters" | "gifts" | "giftEggs" | "inGameTrades" | "trainers" | "encounters" | "grottos" | "shops", number>>;
  warnings: string[];
};

export type RandomizerProjectCounts = {
  pokemon: number;
  moves: number;
  trainers: number;
  encounters: number;
  grottos: number;
  shops: number;
  starters: number;
  gifts: number;
  giftEggs: number;
  inGameTrades: number;
};

export type SeededRng = {
  next: () => number;
  integer: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
  pick: <T>(values: readonly T[]) => T;
  shuffle: <T>(values: readonly T[]) => T[];
};

const STAT_FIELDS = ["base_hp", "base_atk", "base_def", "base_speed", "base_spatk", "base_spdef"] as const;
const TM_FIELDS = ["tm_1-32", "tm_33-64", "tm_65-95+hm_1", "hm_2-6"] as const;
const NEGATIVE_ABILITY_NAMES = new Set(["truant", "slow start", "defeatist", "klutz", "stall"]);
const BROKEN_MOVE_NAMES = new Set([
  "sonic boom",
  "dragon rage",
  "guillotine",
  "horn drill",
  "fissure",
  "sheer cold",
  "selfdestruct",
  "explosion",
  "perish song",
  "destiny bond",
]);
const BAD_ITEM_TERMS = ["none", "unused", "mail", "mulch", "data card", "relic", "pretty wing"];
const REGULAR_SHOP_TERMS = ["poke ball", "great ball", "ultra ball", "potion", "antidote", "paralyze heal", "awakening", "burn heal", "ice heal", "escape rope", "repel"];
const OVERPOWERED_ITEM_TERMS = ["master ball", "rare candy", "max revive", "sacred ash", "full restore"];
const EVOLUTION_ITEM_TERMS = ["stone", "protector", "electirizer", "magmarizer", "dubious disc", "reaper cloth", "razor claw", "razor fang", "prism scale"];
const X_ITEM_TERMS = ["x attack", "x defend", "x speed", "x accuracy", "x sp. atk", "x sp. def", "dire hit", "guard spec"];

export function defaultRandomizerSettings(seed = "pokeweb"): RandomizerSettings {
  return {
    seed,
    pokemon: {
      baseStats: "unchanged",
      bstVariancePercent: 20,
      statsFollowEvolutions: false,
      types: "unchanged",
      dualTypeOnly: false,
      abilities: "unchanged",
      abilitiesFollowEvolutions: false,
      allowWonderGuard: false,
      banNegativeAbilities: true,
      ensureTwoAbilities: true,
      expCurve: "unchanged",
      heldItems: "unchanged",
    },
    evolutions: {
      mode: "unchanged",
      similarStrength: false,
      sameType: false,
      maxThreeStages: true,
      forceChange: true,
      forceGrowth: false,
      noConvergence: false,
      changeImpossible: false,
      easierLevel: null,
      removeTimeBased: false,
    },
    movesets: {
      mode: "unchanged",
      randomizeEggMoves: true,
      guaranteedStartingMoves: 0,
      reorderDamagingMoves: false,
      forceGoodDamaging: false,
      goodDamagingPercent: 50,
      blockBrokenMoves: true,
      evolutionMoveForAll: false,
    },
    moveData: { powers: false, accuracies: false, pps: false, types: false, categories: false },
    tmCompatibility: { mode: "unchanged", fullHmCompatibility: false, levelUpMoveSanity: false, followEvolutions: false },
    starters: { mode: "unchanged", unique: true, blockLegendaries: true },
    gifts: { mode: "unchanged", randomizeGiftPokemon: true, randomizeEggs: true, blockLegendaries: true },
    inGameTrades: { mode: "unchanged", blockLegendaries: true, randomizeIvs: false, randomizeHeldItems: false },
    trainers: {
      mode: "unchanged",
      similarStrength: false,
      avoidDuplicates: true,
      blockLegendaries: true,
      evolvePokemon: false,
      levelModifierPercent: 0,
      betterMovesets: false,
      randomHeldItems: false,
    },
    wild: {
      scope: "unchanged",
      similarStrength: false,
      catchEmAll: false,
      blockLegendaries: true,
      keepPrimaryType: false,
      useTimeBasedEncounters: true,
      levelModifierPercent: 0,
      minimumCatchRate: 0,
    },
    grottos: { randomizePokemon: false, randomizeItems: false, levelModifierPercent: 0 },
    shops: {
      mode: "unchanged",
      banBadItems: true,
      banRegularShopItems: false,
      banOverpoweredItems: false,
      guaranteeEvolutionItems: false,
      guaranteeXItems: false,
      addCheapRareCandy: false,
    },
  };
}

export function createSeededRng(seed: string): SeededRng {
  let state = hashSeed(seed || "pokeweb");
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    integer: (min, max) => {
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error(`Invalid random range: ${min}..${max}`);
      return Math.floor(next() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
    },
    chance: (probability) => next() < clamp(probability, 0, 1),
    pick: <T>(values: readonly T[]): T => {
      if (values.length === 0) throw new Error("Cannot choose from an empty randomizer pool");
      return values[Math.floor(next() * values.length)]!;
    },
    shuffle: <T>(values: readonly T[]): T[] => {
      const shuffled = [...values];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
      }
      return shuffled;
    },
  };
}

export function randomizerProjectCounts(project: ProjectState): RandomizerProjectCounts {
  const scripted = scriptPokemonCounts(project);
  return {
    pokemon: getPokemonPersonalIds(project).filter((id) => id > 0).length,
    moves: Math.max(0, getMoveCount(project) - 1),
    trainers: Math.max(0, getTrainerCount(project) - 1),
    encounters: getEncounterCount(project),
    grottos: getGrottoCount(project),
    shops: getMartCount(project),
    starters: scripted.starters,
    gifts: scripted.gifts,
    giftEggs: scripted.giftEggs,
    inGameTrades: scanGen5InGameTrades(project).length,
  };
}

function scriptPokemonCounts(project: ProjectState): { starters: number; gifts: number; giftEggs: number } {
  const scripts = project.narcs.scripts;
  if (!scripts || isGen4Project(project)) return { starters: 0, gifts: 0, giftEggs: 0 };
  const starterFiles = new Set(findStarterScriptFileIds(project));
  const starters = [...starterFiles].some((fileId) => detectStartersFromScriptBytes(scripts.rawFiles[fileId]!)) ? 3 : 0;
  let gifts = 0;
  let giftEggs = 0;
  scripts.rawFiles.forEach((bytes, fileId) => {
    if (starterFiles.has(fileId)) return;
    for (const encounter of scanGen5ScriptEncounterRefs(bytes, project.session.baseRom)) {
      if (encounter.kind === "gift") gifts += 1;
      if (encounter.kind === "egg") giftEggs += 1;
    }
  });
  return { starters, gifts, giftEggs };
}

export function randomizeProject(project: ProjectState, settings: RandomizerSettings): RandomizerResult {
  if (isGen4Project(project)) throw new Error("The first Randomizer pass supports Gen 5 projects only.");
  validateSelectedData(project, settings);
  const seed = settings.seed.trim() || "pokeweb";
  const rng = createSeededRng(seed);
  const result: RandomizerResult = { seed, changes: {}, warnings: [] };
  const speciesIds = getPokemonPersonalIds(project).filter((id) => id > 0);
  const playerPool = speciesIds.filter((id) => !findPokemonPersonalFormOwner(project, id));
  const moveIds = usableMoveIds(project);
  const itemIds = usableItemIds(project);
  if (speciesIds.length === 0) throw new Error("No usable Pokémon personal records were found.");
  if (needsMovePool(settings) && moveIds.length === 0) throw new Error("No usable move records were found.");
  if (settings.movesets.mode === "metronome-only" && findNamedId(project.texts.banks.moves, "metronome") === undefined && !moveIds.includes(118)) {
    throw new Error("Metronome could not be found in this ROM's move data.");
  }

  const originalEvolutionEdges = readEvolutionEdges(project, speciesIds);
  randomizePokemonData(project, settings, rng, speciesIds, itemIds, originalEvolutionEdges, result);
  randomizeStarters(project, settings, rng, playerPool, originalEvolutionEdges, result);
  randomizeEvolutions(project, settings, rng, playerPool, result);
  randomizeMoveData(project, settings, rng, moveIds, result);
  randomizeMovesets(project, settings, rng, speciesIds, moveIds, result);
  randomizeTmCompatibility(project, settings, rng, speciesIds, originalEvolutionEdges, result);
  randomizeGiftPokemon(project, settings, rng, playerPool, result);
  randomizeInGameTrades(project, settings, rng, playerPool, itemIds, result);
  randomizeTrainers(project, settings, rng, playerPool, itemIds, result);
  randomizeWildEncounters(project, settings, rng, playerPool, result);
  randomizeGrottos(project, settings, rng, playerPool, itemIds, result);
  randomizeShops(project, settings, rng, itemIds, result);
  syncRandomizedPersonalReadable(project);

  for (const [domain, count] of Object.entries(result.changes)) {
    if (!count) continue;
    recordGenericChange(project, randomizerDomain(domain), `Seed ${seed}: randomized ${count} ${randomizerLabel(domain)}.`, "Randomizer", {
      key: `randomizer:${seed}:${domain}`,
    });
  }
  return result;
}

function randomizePokemonData(
  project: ProjectState,
  settings: RandomizerSettings,
  rng: SeededRng,
  speciesIds: number[],
  itemIds: number[],
  evolutionEdges: Map<number, number[]>,
  result: RandomizerResult,
): void {
  const types = typeNamesForProject(project).slice(0, randomizableTypeCount(project));
  const abilityIds = usableAbilityIds(project, speciesIds, settings);
  const growthIndex = {
    "medium-fast": 0,
    erratic: 1,
    fluctuating: 2,
    "medium-slow": 3,
    fast: 4,
    slow: 5,
  } as const;
  const randomized = new Set<number>();

  for (const id of speciesIds) {
    const record = decodeRecord(project, "personal", id);
    if (!record.raw) continue;
    const raw = record.raw;
    let changed = false;

    if (settings.pokemon.baseStats !== "unchanged") {
      const original = STAT_FIELDS.map((field) => clamp(raw[field] ?? 1, 1, 255));
      const originalTotal = original.reduce((sum, value) => sum + value, 0);
      let next: number[];
      if (settings.pokemon.baseStats === "shuffle") next = rng.shuffle(original);
      else {
        const variance = clamp(settings.pokemon.bstVariancePercent, 0, 100) / 100;
        const targetTotal =
          settings.pokemon.baseStats === "random-bst"
            ? rng.integer(180, 720)
            : settings.pokemon.baseStats === "buff-nerf"
              ? clamp(Math.round(originalTotal * (1 + (rng.next() * 2 - 1) * variance)), 6, 1530)
              : originalTotal;
        next = distributeStatTotal(targetTotal, rng);
      }
      STAT_FIELDS.forEach((field, index) => { raw[field] = next[index]!; });
      changed = true;
    }

    if (settings.pokemon.types === "completely-random") {
      const first = rng.integer(0, Math.max(0, types.length - 1));
      const second = settings.pokemon.dualTypeOnly ? differentValue(first, types.length, rng) : rng.chance(0.5) ? first : rng.integer(0, Math.max(0, types.length - 1));
      raw.type_1 = first;
      raw.type_2 = second;
      changed = true;
    }

    if (settings.pokemon.abilities === "random" && abilityIds.length > 0) {
      const first = rng.pick(abilityIds);
      const second = settings.pokemon.ensureTwoAbilities ? pickDifferent(abilityIds, first, rng) : rng.pick(abilityIds);
      raw.ability_1 = first;
      raw.ability_2 = second;
      if (raw.ability_3 !== undefined) raw.ability_3 = pickDifferent(abilityIds, second, rng);
      changed = true;
    }

    if (settings.pokemon.expCurve !== "unchanged") {
      raw.exp_rate = growthIndex[settings.pokemon.expCurve];
      changed = true;
    }

    if (settings.pokemon.heldItems === "random" && itemIds.length > 0) {
      raw.item_1 = rng.chance(0.5) ? 0 : rng.pick(itemIds);
      raw.item_2 = rng.chance(0.75) ? 0 : rng.pick(itemIds);
      if (raw.item_3 !== undefined) raw.item_3 = rng.chance(0.9) ? 0 : rng.pick(itemIds);
      changed = true;
    }

    if (changed) {
      markDirty(project, "personal", id);
      bump(result, "pokemon");
      randomized.add(id);
    }
  }

  if (settings.pokemon.types === "random-follow-evolutions") {
    const visited = new Set<number>();
    const incoming = incomingEvolutionCounts(evolutionEdges);
    const roots = speciesIds.filter((id) => (incoming.get(id) ?? 0) === 0);
    for (const root of [...roots, ...speciesIds]) assignEvolutionTypes(project, root, evolutionEdges, types.length, settings.pokemon.dualTypeOnly, rng, visited, result);
  }

  if (settings.pokemon.statsFollowEvolutions && settings.pokemon.baseStats !== "unchanged") {
    for (const [sourceId, targets] of evolutionEdges) {
      const source = decodeRecord(project, "personal", sourceId).raw;
      if (!source) continue;
      const weights = STAT_FIELDS.map((field) => Math.max(1, source[field] ?? 1));
      for (const targetId of targets) {
        const target = decodeRecord(project, "personal", targetId).raw;
        if (!target) continue;
        const total = STAT_FIELDS.reduce((sum, field) => sum + Math.max(1, target[field] ?? 1), 0);
        const stats = distributeByWeights(total, weights);
        STAT_FIELDS.forEach((field, index) => { target[field] = stats[index]!; });
        markDirty(project, "personal", targetId);
        if (!randomized.has(targetId)) bump(result, "pokemon");
      }
    }
  }

  if (settings.pokemon.abilitiesFollowEvolutions && settings.pokemon.abilities === "random") {
    for (const [sourceId, targets] of evolutionEdges) {
      const source = decodeRecord(project, "personal", sourceId).raw;
      if (!source) continue;
      for (const targetId of targets) {
        const target = decodeRecord(project, "personal", targetId).raw;
        if (!target) continue;
        for (const field of ["ability_1", "ability_2", "ability_3"] as const) if (source[field] !== undefined && target[field] !== undefined) target[field] = source[field];
        markDirty(project, "personal", targetId);
      }
    }
  }
}

function randomizeEvolutions(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, speciesIds: number[], result: RandomizerResult): void {
  const options = settings.evolutions;
  if (options.mode === "unchanged" && !options.changeImpossible && options.easierLevel === null && !options.removeTimeBased) return;
  const incomingTargets = new Set<number>();
  const graph = readEvolutionEdges(project, speciesIds);
  const originalTargets = new Map([...graph].map(([id, targets]) => [id, new Set(targets)]));

  for (const sourceId of speciesIds) {
    const store = project.narcs.evolutions;
    if (!store?.rawFiles[sourceId]) continue;
    const record = decodeRecord(project, "evolutions", sourceId);
    if (!record.raw) continue;
    const raw = record.raw;
    const slots = Math.max(1, Math.min(32, Math.floor(store.rawFiles[sourceId]!.length / 6)));
    let changed = false;

    if (options.mode === "random-every-level") {
      clearEvolutionSlots(raw, slots);
      const target = chooseEvolutionTarget(project, sourceId, 0, speciesIds, rng, {
        ...options,
        similarStrength: false,
        maxThreeStages: false,
        forceGrowth: false,
      }, graph, originalTargets, incomingTargets);
      raw.method_0 = 4;
      raw.param_0 = 1;
      raw.target_0 = target;
      graph.set(sourceId, [target]);
      incomingTargets.add(target);
      changed = true;
    } else {
      for (let slot = 0; slot < slots; slot += 1) {
        const methodField = `method_${slot}`;
        const paramField = `param_${slot}`;
        const targetField = `target_${slot}`;
        const method = raw[methodField] ?? 0;
        const oldTarget = raw[targetField] ?? 0;
        if (options.mode === "random" && method !== 0 && oldTarget > 0) {
          const target = chooseEvolutionTarget(project, sourceId, oldTarget, speciesIds, rng, options, graph, originalTargets, incomingTargets);
          raw[targetField] = target;
          graph.set(sourceId, [...(graph.get(sourceId) ?? []).filter((value) => value !== oldTarget), target]);
          incomingTargets.add(target);
          changed ||= target !== oldTarget;
        }
        if (options.changeImpossible && [5, 6, 7].includes(method)) {
          raw[methodField] = 4;
          raw[paramField] = method === 5 ? 37 : 40;
          changed = true;
        }
        if (options.removeTimeBased && [2, 3, 19, 20].includes(raw[methodField] ?? method)) {
          raw[methodField] = 4;
          raw[paramField] = clamp(raw[paramField] || 30, 1, 100);
          changed = true;
        }
        if (options.easierLevel !== null && evolutionMethodUsesLevel(raw[methodField] ?? method) && (raw[paramField] ?? 0) > options.easierLevel) {
          raw[paramField] = options.easierLevel;
          changed = true;
        }
      }
    }
    if (changed) {
      markDirty(project, "evolutions", sourceId);
      bump(result, "evolutions");
    }
  }
}

function randomizeMoveData(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, moveIds: number[], result: RandomizerResult): void {
  const options = settings.moveData;
  if (!options.powers && !options.accuracies && !options.pps && !options.types && !options.categories) return;
  const typeCount = randomizableTypeCount(project);
  for (const id of moveIds) {
    const record = decodeRecord(project, "moves", id);
    if (!record.raw) continue;
    const raw = record.raw;
    const damaging = (raw.category ?? 0) !== 0 && (raw.power ?? 0) > 0;
    if (options.powers && damaging) raw.power = rng.chance(0.1) ? rng.integer(20, 35) : rng.integer(8, 30) * 5;
    if (options.accuracies && (raw.accuracy ?? 0) > 0) raw.accuracy = rng.integer(10, 20) * 5;
    if (options.pps) raw.pp = rng.integer(1, 8) * 5;
    if (options.types) raw.type = rng.integer(0, Math.max(0, typeCount - 1));
    if (options.categories && damaging) raw.category = rng.chance(0.5) ? 1 : 2;
    markDirty(project, "moves", id);
    bump(result, "moves");
  }
}

function randomizeMovesets(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, speciesIds: number[], moveIds: number[], result: RandomizerResult): void {
  const options = settings.movesets;
  if (options.mode === "unchanged" && !options.reorderDamagingMoves && options.guaranteedStartingMoves === 0 && !options.evolutionMoveForAll) return;
  const metronomeId = findNamedId(project.texts.banks.moves, "metronome") ?? (moveIds.includes(118) ? 118 : moveIds[0]);
  const validMoves = moveIds.filter((id) => !options.blockBrokenMoves || !BROKEN_MOVE_NAMES.has(normalize(project.texts.banks.moves?.[id] ?? "")));

  for (const speciesId of speciesIds) {
    const store = project.narcs.learnsets;
    if (!store?.rawFiles[speciesId]) continue;
    const record = decodeRecord(project, "learnsets", speciesId);
    if (!record.raw) continue;
    let entries = learnsetEntries(record.raw, 128);
    if (entries.length === 0) continue;
    const personal = decodeRecord(project, "personal", speciesId).raw;
    if (!personal) continue;

    if (options.guaranteedStartingMoves > 0) {
      const levelOneCount = entries.filter((entry) => entry.level === 1).length;
      const needed = Math.max(0, options.guaranteedStartingMoves - levelOneCount);
      for (let count = 0; count < needed; count += 1) entries.unshift({ moveId: validMoves[0] ?? 1, level: 1 });
    }
    if (options.evolutionMoveForAll && entries[0]?.level !== 0) entries.unshift({ moveId: validMoves[0] ?? 1, level: 0 });

    if (options.mode === "metronome-only" && metronomeId !== undefined) {
      entries = entries.map((entry) => ({ ...entry, moveId: metronomeId }));
    } else if (options.mode !== "unchanged") {
      const used = new Set<number>();
      const goodTarget = options.forceGoodDamaging ? Math.round(entries.length * clamp(options.goodDamagingPercent, 0, 100) / 100) : 0;
      entries = entries.map((entry, index) => {
        const forceDamaging = index < goodTarget || entry.level === 1;
        const picked = chooseMove(project, validMoves, personal, options.mode === "prefer-same-type", forceDamaging, used, rng);
        used.add(picked);
        return { ...entry, moveId: picked };
      });
    }

    if (options.reorderDamagingMoves) {
      const moveOrder = entries.map((entry) => entry.moveId).sort((left, right) => movePower(project, left) - movePower(project, right));
      entries = entries.map((entry, index) => ({ ...entry, moveId: moveOrder[index]! }));
    }
    writeLearnset(project, record.raw, record.readable, entries, Math.max(1, Math.floor((project.formats.learnsets?.length ?? 64) / 2)));
    markDirty(project, "learnsets", speciesId);
    bump(result, "learnsets");

    if (options.mode !== "unchanged" && options.randomizeEggMoves && project.narcs.egg_moves?.rawFiles[speciesId]) {
      const eggMoves = readEggMoves(project.narcs.egg_moves.rawFiles[speciesId]!);
      if (eggMoves.length > 0) {
        const used = new Set<number>();
        const randomized = options.mode === "metronome-only" && metronomeId !== undefined
          ? eggMoves.map(() => metronomeId)
          : eggMoves.map((_move, index) => {
              const forceDamaging = options.forceGoodDamaging && index < Math.round(eggMoves.length * options.goodDamagingPercent / 100);
              const picked = chooseMove(project, validMoves, personal, options.mode === "prefer-same-type", forceDamaging, used, rng);
              used.add(picked);
              return picked;
            });
        writeEggMoves(project, speciesId, randomized);
        bump(result, "eggMoves");
      }
    }
  }
}

function randomizeTmCompatibility(
  project: ProjectState,
  settings: RandomizerSettings,
  rng: SeededRng,
  speciesIds: number[],
  evolutionEdges: Map<number, number[]>,
  result: RandomizerResult,
): void {
  const options = settings.tmCompatibility;
  if (options.mode === "unchanged" && !options.fullHmCompatibility && !options.levelUpMoveSanity && !options.followEvolutions) return;
  const entries = getTmEntries(project);
  const counts = machineCountsForProject(project);
  const compatBySpecies = new Map<number, boolean[]>();

  for (const speciesId of speciesIds) {
    const personal = decodeRecord(project, "personal", speciesId).raw;
    if (!personal) continue;
    const booleans = entries.map((entry) => compatibilityEnabled(project, personal, entry.kind, entry.number));
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      let enabled = booleans[index]!;
      if (options.mode === "full") enabled = true;
      else if (options.mode === "completely-random") enabled = rng.chance(entry.kind === "hm" ? 0.65 : 0.5);
      else if (options.mode === "prefer-type") {
        const moveType = entry.move?.raw.type;
        const matchesType = moveType !== undefined && (moveType === personal.type_1 || moveType === personal.type_2);
        enabled = rng.chance(matchesType ? 0.9 : entry.kind === "hm" ? 0.65 : 0.35);
      }
      if (options.fullHmCompatibility && entry.kind === "hm") enabled = true;
      if (options.levelUpMoveSanity && speciesLearnsMove(project, speciesId, entry.moveId)) enabled = true;
      booleans[index] = enabled;
    }
    writeCompatibility(project, personal, entries, booleans);
    compatBySpecies.set(speciesId, booleans);
    markDirty(project, "personal", speciesId);
    bump(result, "tmCompatibility");
  }

  if (options.followEvolutions) {
    for (const [sourceId, targets] of evolutionEdges) {
      const source = compatBySpecies.get(sourceId);
      if (!source) continue;
      for (const targetId of targets) {
        const target = decodeRecord(project, "personal", targetId).raw;
        const targetCompat = compatBySpecies.get(targetId);
        if (!target || !targetCompat) continue;
        const merged = targetCompat.map((value, index) => value || source[index]);
        writeCompatibility(project, target, entries, merged);
        compatBySpecies.set(targetId, merged);
        markDirty(project, "personal", targetId);
      }
    }
  }
  if (counts.total !== entries.length) result.warnings.push(`TM/HM table exposed ${entries.length} entries; expected ${counts.total}.`);
}

function randomizeStarters(
  project: ProjectState,
  settings: RandomizerSettings,
  rng: SeededRng,
  speciesIds: number[],
  evolutionEdges: Map<number, number[]>,
  result: RandomizerResult,
): void {
  const options = settings.starters;
  if (options.mode === "unchanged") return;
  let candidates = speciesIds.filter((id) => id < 0x4000 && (!options.blockLegendaries || !isLegendary(project, id)));
  if (options.mode === "random-basic" || options.mode === "random-two-evolutions") {
    const incoming = incomingEvolutionCounts(evolutionEdges);
    candidates = candidates.filter((id) => (incoming.get(id) ?? 0) === 0);
  }
  if (options.mode === "random-two-evolutions") candidates = candidates.filter((id) => evolutionDepth(evolutionEdges, id) >= 2);
  if (candidates.length < 3) throw new Error(`Starter settings require at least three eligible Pokémon; only ${candidates.length} were found.`);

  const current = getStarterEditorState(project).slots.map((slot) => slot.speciesId);
  const starters: number[] = [];
  while (starters.length < 3) {
    let pool = options.unique ? candidates.filter((id) => !starters.includes(id)) : candidates;
    const changedPool = pool.filter((id) => id !== current[starters.length]);
    if (changedPool.length > 0) pool = changedPool;
    starters.push(rng.pick(pool));
  }
  const applied = applyRandomizedStarters(project, starters);
  result.warnings.push(...applied.warnings);
  result.changes.starters = 3;
}

function randomizeGiftPokemon(
  project: ProjectState,
  settings: RandomizerSettings,
  rng: SeededRng,
  speciesIds: number[],
  result: RandomizerResult,
): void {
  const options = settings.gifts;
  if (options.mode === "unchanged" || (!options.randomizeGiftPokemon && !options.randomizeEggs)) return;
  const scripts = project.narcs.scripts;
  if (!scripts) return;
  const candidates = speciesIds.filter((id) => id < 0x4000 && (!options.blockLegendaries || !isLegendary(project, id)));
  if (candidates.length === 0) throw new Error("No eligible Pokémon were found for gift randomization.");
  const starterFiles = new Set(findStarterScriptFileIds(project));

  scripts.rawFiles.forEach((source, fileId) => {
    if (starterFiles.has(fileId)) return;
    const refs = scanGen5ScriptEncounterRefs(source, project.session.baseRom).filter((encounter) =>
      (encounter.kind === "gift" && options.randomizeGiftPokemon) || (encounter.kind === "egg" && options.randomizeEggs),
    );
    if (refs.length === 0) return;
    const replacementByGift = new Map<string, number>();
    const patches = refs.map((encounter) => {
      const giftKey = `${encounter.kind}:${encounter.speciesId}`;
      let replacement = replacementByGift.get(giftKey);
      if (replacement === undefined) {
        let pool = candidates.filter((id) => id !== encounter.speciesId);
        if (options.mode === "similar-strength") pool = nearestStrengthPool(project, pool, pokemonBst(project, encounter.speciesId));
        replacement = rng.pick(pool.length > 0 ? pool : candidates);
        replacementByGift.set(giftKey, replacement);
      }
      return { encounter, speciesId: replacement, form: 0 };
    });
    scripts.rawFiles[fileId] = patchGen5ScriptEncounters(source, patches);
    markDirty(project, "scripts", fileId);
    refs.forEach((encounter) => bump(result, encounter.kind === "egg" ? "giftEggs" : "gifts"));
  });
}

function randomizeInGameTrades(
  project: ProjectState,
  settings: RandomizerSettings,
  rng: SeededRng,
  speciesIds: number[],
  itemIds: number[],
  result: RandomizerResult,
): void {
  const options = settings.inGameTrades;
  if (options.mode === "unchanged") return;
  const trades = scanGen5InGameTrades(project);
  const candidates = speciesIds.filter((id) => id < 0x10000 && (!options.blockLegendaries || !isLegendary(project, id)));
  if (candidates.length === 0) throw new Error("No eligible Pokémon were found for in-game trades.");
  const usedGiven = new Set<number>();
  const usedRequested = new Set<number>();
  const patches = trades.map((trade) => {
    let givenPool = candidates.filter((id) => id !== trade.givenSpeciesId && !usedGiven.has(id));
    if (givenPool.length === 0) givenPool = candidates.filter((id) => id !== trade.givenSpeciesId);
    const givenSpeciesId = rng.pick(givenPool.length > 0 ? givenPool : candidates);
    usedGiven.add(givenSpeciesId);

    let requestedSpeciesId = trade.requestedSpeciesId;
    if (trade.requestedSpeciesId === trade.givenSpeciesId) {
      requestedSpeciesId = givenSpeciesId;
    } else if (options.mode === "random-given-requested") {
      let requestPool = candidates.filter((id) => id !== givenSpeciesId && !usedRequested.has(id));
      if (requestPool.length === 0) requestPool = candidates.filter((id) => id !== givenSpeciesId);
      requestedSpeciesId = rng.pick(requestPool.length > 0 ? requestPool : candidates);
      usedRequested.add(requestedSpeciesId);
    }
    return {
      trade,
      givenSpeciesId,
      requestedSpeciesId,
      heldItemId: options.randomizeHeldItems ? rng.pick(itemIds) : undefined,
      ivs: options.randomizeIvs ? Array.from({ length: 6 }, () => rng.integer(0, 31)) : undefined,
    };
  });
  const applied = applyGen5InGameTradePatches(project, patches);
  result.changes.inGameTrades = applied.records;
}

function randomizeTrainers(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, speciesIds: number[], itemIds: number[], result: RandomizerResult): void {
  const options = settings.trainers;
  const metronomeOnly = settings.movesets.mode === "metronome-only";
  if (options.mode === "unchanged" && options.levelModifierPercent === 0 && !options.evolvePokemon && !options.betterMovesets && !options.randomHeldItems && !metronomeOnly) return;
  const metronomeId = metronomeOnly ? (findNamedId(project.texts.banks.moves, "metronome") ?? (project.narcs.moves?.rawFiles[118] ? 118 : undefined)) : undefined;
  const usage = new Map<number, number>();
  const nonLegendaryPool = options.blockLegendaries ? speciesIds.filter((id) => !isLegendary(project, id)) : speciesIds;
  const pool = nonLegendaryPool.length > 0 ? nonLegendaryPool : speciesIds;
  let warnedAboutShortTrainer = false;

  for (let trainerId = 1; trainerId < getTrainerCount(project); trainerId += 1) {
    const info = project.trpokInfo[trainerId];
    if (!info || info.numPokemon <= 0 || !project.narcs.trpok?.rawFiles[trainerId]) continue;
    const expectedLength = trainerPokemonRowLength(info.template) * info.numPokemon;
    if (project.narcs.trpok.rawFiles[trainerId]!.length < expectedLength) {
      if (!warnedAboutShortTrainer) {
        result.warnings.push("Skipped trainer-party files shorter than their inferred template instead of resizing them.");
        warnedAboutShortTrainer = true;
      }
      continue;
    }
    const record = decodeRecord(project, "trpok", trainerId);
    if (!record.raw) continue;
    const raw = record.raw;
    const used = new Set<number>();
    const theme = trainerTheme(project, raw, info.numPokemon, options.mode, rng);
    let changed = false;

    for (let slot = 0; slot < info.numPokemon; slot += 1) {
      const speciesField = `species_id_${slot}`;
      const levelField = `level_${slot}`;
      const originalSpecies = raw[speciesField] ?? 0;
      let level = raw[levelField] ?? 1;
      if (options.levelModifierPercent !== 0) {
        level = clamp(Math.round(level * (100 + options.levelModifierPercent) / 100), 1, 100);
        raw[levelField] = level;
        changed = true;
      }
      let species = originalSpecies;
      if (options.mode !== "unchanged") {
        let candidates = pool;
        if (theme !== undefined) candidates = candidates.filter((id) => pokemonHasType(project, id, theme));
        if (options.avoidDuplicates) candidates = candidates.filter((id) => !used.has(id));
        if (options.similarStrength) candidates = nearestStrengthPool(project, candidates, pokemonBst(project, originalSpecies));
        if (options.mode === "distributed" && candidates.length > 0) {
          const minUse = Math.min(...candidates.map((id) => usage.get(id) ?? 0));
          candidates = candidates.filter((id) => (usage.get(id) ?? 0) <= minUse + 1);
        }
        species = rng.pick(candidates.length > 0 ? candidates : pool);
        raw[speciesField] = species;
        raw[`form_${slot}`] = 0;
        usage.set(species, (usage.get(species) ?? 0) + 1);
        used.add(species);
        changed = true;
      }
      if (options.evolvePokemon) {
        const beforeEvolution = species;
        const evolved = evolveSpeciesForLevel(project, species, level);
        raw[speciesField] = evolved;
        species = evolved;
        changed ||= evolved !== beforeEvolution;
      }
      if ((options.betterMovesets || metronomeOnly) && (info.template & 1) !== 0) {
        const moves = metronomeId === undefined ? bestMovesForLevel(project, species, level) : [metronomeId, metronomeId, metronomeId, metronomeId];
        for (let move = 1; move <= 4; move += 1) raw[`move_${move}_${slot}`] = moves[move - 1] ?? 0;
        changed = true;
      }
      if (options.randomHeldItems && (info.template & 2) !== 0 && itemIds.length > 0) {
        raw[`item_id_${slot}`] = rng.chance(0.35) ? rng.pick(itemIds) : 0;
        changed = true;
      }
    }
    if (changed) {
      markDirty(project, "trpok", trainerId);
      bump(result, "trainers");
    }
  }
}

function randomizeWildEncounters(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, speciesIds: number[], result: RandomizerResult): void {
  const options = settings.wild;
  if (options.scope === "unchanged" && options.levelModifierPercent === 0 && options.minimumCatchRate === 0) return;
  const nonLegendaryPool = options.blockLegendaries ? speciesIds.filter((id) => !isLegendary(project, id)) : speciesIds;
  const pool = nonLegendaryPool.length > 0 ? nonLegendaryPool : speciesIds;
  const globalMap = new Map<string, number>();
  let catchAllPool = rng.shuffle(pool);
  let catchAllIndex = 0;
  const encountered = new Set<number>();

  for (let encounterId = 0; encounterId < getEncounterCount(project); encounterId += 1) {
    if (!project.narcs.encounters?.rawFiles[encounterId]) continue;
    const record = decodeRecord(project, "encounters", encounterId);
    if (!record.raw) continue;
    const raw = record.raw;
    const encounterMap = new Map<string, number>();
    const sharedSeasonSlots = new Map<string, number>();
    let changed = false;
    for (const field of Object.keys(raw)) {
      if (/_slot_\d+$/u.test(field)) {
        const packed = raw[field] ?? 0;
        const original = packed % 2048;
        if (original <= 0 || options.scope === "unchanged") continue;
        const seasonlessField = field.replace(/^(spring|summer|fall|winter)_/u, "");
        const timeKey = options.useTimeBasedEncounters ? field : seasonlessField;
        const map = options.scope === "game" ? globalMap : options.scope === "encounter" ? encounterMap : new Map<string, number>();
        const mapKey = options.scope === "game" ? String(original) : `${timeKey}:${original}`;
        let replacement = options.useTimeBasedEncounters ? undefined : sharedSeasonSlots.get(seasonlessField);
        replacement ??= map.get(mapKey);
        if (replacement === undefined) {
          let candidates = pool;
          if (options.keepPrimaryType) {
            const originalType = decodeRecord(project, "personal", original).raw?.type_1;
            const typed = candidates.filter((id) => decodeRecord(project, "personal", id).raw?.type_1 === originalType);
            if (typed.length > 0) candidates = typed;
          }
          if (options.similarStrength) candidates = nearestStrengthPool(project, candidates, pokemonBst(project, original));
          if (options.catchEmAll && catchAllPool.length > 0) {
            replacement = catchAllPool[catchAllIndex % catchAllPool.length]!;
            catchAllIndex += 1;
            if (catchAllIndex % catchAllPool.length === 0) catchAllPool = rng.shuffle(pool);
          } else replacement = rng.pick(candidates.length > 0 ? candidates : pool);
          map.set(mapKey, replacement);
        }
        if (!options.useTimeBasedEncounters) sharedSeasonSlots.set(seasonlessField, replacement);
        raw[field] = replacement;
        encountered.add(replacement);
        changed = true;
      } else if (options.levelModifierPercent !== 0 && /_(min|max)_level$/u.test(field)) {
        raw[field] = clamp(Math.round((raw[field] ?? 1) * (100 + options.levelModifierPercent) / 100), 1, 100);
        changed = true;
      }
    }
    if (changed) {
      markDirty(project, "encounters", encounterId);
      bump(result, "encounters");
    }
  }
  if (options.minimumCatchRate > 0) {
    for (const speciesId of encountered) {
      const personal = decodeRecord(project, "personal", speciesId).raw;
      if (personal && (personal.catchrate ?? 0) < options.minimumCatchRate) {
        personal.catchrate = clamp(options.minimumCatchRate, 1, 255);
        markDirty(project, "personal", speciesId);
      }
    }
  }
}

function randomizeGrottos(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, speciesIds: number[], itemIds: number[], result: RandomizerResult): void {
  const options = settings.grottos;
  if (!options.randomizePokemon && !options.randomizeItems && options.levelModifierPercent === 0) return;
  for (let grottoId = 0; grottoId < getGrottoCount(project); grottoId += 1) {
    const record = decodeRecord(project, "grottos", grottoId);
    if (!record.raw) continue;
    let changed = false;
    for (const field of Object.keys(record.raw)) {
      if (options.randomizePokemon && /_(?:pok)_\d+$/u.test(field)) {
        record.raw[field] = rng.pick(speciesIds);
        changed = true;
      } else if (options.randomizeItems && /_item_\d+$/u.test(field) && itemIds.length > 0) {
        record.raw[field] = rng.pick(itemIds);
        changed = true;
      } else if (options.levelModifierPercent !== 0 && /_(?:min|max)_lvl_\d+$/u.test(field)) {
        record.raw[field] = clamp(Math.round((record.raw[field] ?? 1) * (100 + options.levelModifierPercent) / 100), 1, 100);
        changed = true;
      }
    }
    if (changed) {
      markDirty(project, "grottos", grottoId);
      bump(result, "grottos");
    }
  }
}

function randomizeShops(project: ProjectState, settings: RandomizerSettings, rng: SeededRng, allItemIds: number[], result: RandomizerResult): void {
  const options = settings.shops;
  if (options.mode === "unchanged" && !options.guaranteeEvolutionItems && !options.guaranteeXItems && !options.addCheapRareCandy) return;
  let itemIds = allItemIds.filter((id) => shopItemAllowed(project, id, options));
  if (itemIds.length === 0) itemIds = allItemIds;
  const existing = Array.from({ length: getMartCount(project) }, (_unused, martId) => decodeRecord(project, "marts", martId).raw)
    .flatMap((raw) => raw ? Object.entries(raw).filter(([field, value]) => /^item_\d+$/u.test(field) && value > 0).map(([, value]) => value) : []);
  const shuffledExisting = rng.shuffle(existing);
  let existingIndex = 0;

  for (let martId = 0; martId < getMartCount(project); martId += 1) {
    const record = decodeRecord(project, "marts", martId);
    if (!record.raw) continue;
    let changed = false;
    for (const field of Object.keys(record.raw).filter((key) => /^item_\d+$/u.test(key) && (record.raw?.[key] ?? 0) > 0)) {
      if (options.mode === "shuffle" && shuffledExisting.length > 0) record.raw[field] = shuffledExisting[existingIndex++ % shuffledExisting.length]!;
      else if (options.mode === "random" && itemIds.length > 0) record.raw[field] = rng.pick(itemIds);
      else continue;
      changed = true;
    }
    if (changed) {
      markDirty(project, "marts", martId);
      bump(result, "shops");
    }
  }

  const guarantees: number[] = [];
  if (options.guaranteeEvolutionItems) guarantees.push(...idsMatchingTerms(project.texts.banks.items, EVOLUTION_ITEM_TERMS));
  if (options.guaranteeXItems) guarantees.push(...idsMatchingTerms(project.texts.banks.items, X_ITEM_TERMS));
  if (options.addCheapRareCandy) {
    const rareCandy = findNamedId(project.texts.banks.items, "rare candy");
    if (rareCandy !== undefined) {
      guarantees.push(rareCandy);
      const item = project.narcs.items?.rawFiles[rareCandy] ? decodeRecord(project, "items", rareCandy).raw : undefined;
      if (item) {
        item.market_value = 1;
        markDirty(project, "items", rareCandy);
      }
    }
  }
  if (guarantees.length > 0 && getMartCount(project) > 0) {
    const first = decodeRecord(project, "marts", 0).raw;
    if (first) {
      guarantees.slice(0, 20).forEach((itemId, index) => { first[`item_${index}`] = itemId; });
      markDirty(project, "marts", 0);
      if (!result.changes.shops) bump(result, "shops");
      syncMartCountBytes(project, 0, first);
    }
  }
}

function validateSelectedData(project: ProjectState, settings: RandomizerSettings): void {
  const missing: string[] = [];
  const needsPokemon = settings.pokemon.baseStats !== "unchanged" || settings.pokemon.types !== "unchanged" || settings.pokemon.abilities !== "unchanged" || settings.pokemon.expCurve !== "unchanged" || settings.pokemon.heldItems !== "unchanged" || settings.evolutions.mode !== "unchanged" || settings.movesets.mode !== "unchanged" || settings.tmCompatibility.mode !== "unchanged" || settings.starters.mode !== "unchanged" || settings.gifts.mode !== "unchanged" || settings.inGameTrades.mode !== "unchanged" || settings.trainers.mode !== "unchanged" || settings.wild.scope !== "unchanged" || settings.grottos.randomizePokemon;
  if (needsPokemon && !project.narcs.personal) missing.push("Personal data");
  if ((settings.evolutions.mode !== "unchanged" || settings.evolutions.changeImpossible || settings.evolutions.easierLevel !== null || settings.evolutions.removeTimeBased || settings.starters.mode === "random-basic" || settings.starters.mode === "random-two-evolutions") && !project.narcs.evolutions) missing.push("Evolutions");
  if ((settings.movesets.mode !== "unchanged" || settings.movesets.reorderDamagingMoves) && !project.narcs.learnsets) missing.push("Learnsets");
  if (settings.movesets.randomizeEggMoves && settings.movesets.mode !== "unchanged" && !project.narcs.egg_moves) missing.push("Egg moves");
  if ((Object.values(settings.moveData).some(Boolean) || settings.movesets.mode !== "unchanged" || settings.tmCompatibility.mode !== "unchanged") && !project.narcs.moves) missing.push("Moves");
  if ((settings.tmCompatibility.mode !== "unchanged" || settings.tmCompatibility.fullHmCompatibility || settings.tmCompatibility.levelUpMoveSanity || settings.tmCompatibility.followEvolutions) && !project.tms) {
    try { getTmEntries(project); } catch { missing.push("TM table"); }
  }
  if ((settings.starters.mode !== "unchanged" || settings.gifts.mode !== "unchanged") && !project.narcs.scripts) missing.push("Scripts");
  if (settings.inGameTrades.mode !== "unchanged" && !project.narcs.ingame_trades) missing.push("In-game trades");
  if ((settings.trainers.mode !== "unchanged" || settings.trainers.levelModifierPercent !== 0 || settings.trainers.betterMovesets || settings.trainers.randomHeldItems || settings.movesets.mode === "metronome-only") && (!project.narcs.trdata || !project.narcs.trpok)) missing.push("Trainer data");
  if ((settings.wild.scope !== "unchanged" || settings.wild.levelModifierPercent !== 0) && !project.narcs.encounters) missing.push("Encounters");
  if ((settings.grottos.randomizePokemon || settings.grottos.randomizeItems || settings.grottos.levelModifierPercent !== 0) && !project.narcs.grottos) missing.push("Hidden grottoes");
  if ((settings.shops.mode !== "unchanged" || settings.shops.guaranteeEvolutionItems || settings.shops.guaranteeXItems || settings.shops.addCheapRareCandy) && !project.narcs.marts) missing.push("BW2 marts");
  if ((settings.pokemon.heldItems === "random" || (settings.inGameTrades.mode !== "unchanged" && settings.inGameTrades.randomizeHeldItems) || settings.trainers.randomHeldItems || settings.grottos.randomizeItems || settings.shops.mode === "random") && !project.narcs.items) missing.push("Items");
  if (missing.length > 0) throw new Error(`Load the required data before randomizing: ${[...new Set(missing)].join(", ")}.`);
}

function assignEvolutionTypes(project: ProjectState, speciesId: number, edges: Map<number, number[]>, typeCount: number, dualOnly: boolean, rng: SeededRng, visited: Set<number>, result: RandomizerResult): void {
  if (visited.has(speciesId) || typeCount <= 0) return;
  visited.add(speciesId);
  const raw = decodeRecord(project, "personal", speciesId).raw;
  if (!raw) return;
  if (![...edges.values()].some((targets) => targets.includes(speciesId))) {
    raw.type_1 = rng.integer(0, typeCount - 1);
    raw.type_2 = dualOnly ? differentValue(raw.type_1, typeCount, rng) : rng.chance(0.5) ? raw.type_1 : rng.integer(0, typeCount - 1);
  }
  markDirty(project, "personal", speciesId);
  bump(result, "pokemon");
  for (const targetId of edges.get(speciesId) ?? []) {
    const target = decodeRecord(project, "personal", targetId).raw;
    if (!target) continue;
    target.type_1 = raw.type_1;
    target.type_2 = dualOnly ? differentValue(target.type_1, typeCount, rng) : rng.chance(0.65) ? raw.type_2 : rng.integer(0, typeCount - 1);
    assignEvolutionTypes(project, targetId, edges, typeCount, dualOnly, rng, visited, result);
  }
}

function chooseEvolutionTarget(project: ProjectState, sourceId: number, oldTarget: number, speciesIds: number[], rng: SeededRng, options: RandomizerSettings["evolutions"], graph: Map<number, number[]>, originalTargets: Map<number, Set<number>>, incomingTargets: Set<number>): number {
  const sourceBst = pokemonBst(project, sourceId);
  const oldTargetBst = pokemonBst(project, oldTarget);
  const source = decodeRecord(project, "personal", sourceId).raw;
  let candidates = speciesIds.filter((id) => id !== sourceId);
  if (options.forceChange) candidates = candidates.filter((id) => !originalTargets.get(sourceId)?.has(id));
  if (options.sameType && source) candidates = candidates.filter((id) => {
    const target = decodeRecord(project, "personal", id).raw;
    return target && (target.type_1 === source.type_1 || target.type_1 === source.type_2 || target.type_2 === source.type_1 || target.type_2 === source.type_2);
  });
  if (options.forceGrowth) candidates = candidates.filter((id) => pokemonBst(project, id) > sourceBst);
  if (options.noConvergence) candidates = candidates.filter((id) => !incomingTargets.has(id));
  if (options.maxThreeStages) candidates = candidates.filter((id) => !wouldExceedStageLimit(sourceId, id, graph, 3));
  candidates = candidates.filter((id) => !pathExists(graph, id, sourceId));
  if (options.similarStrength) candidates = nearestStrengthPool(project, candidates, oldTargetBst || sourceBst);
  if (candidates.length === 0) candidates = speciesIds.filter((id) => id !== sourceId && !pathExists(graph, id, sourceId));
  if (candidates.length === 0) throw new Error(`No valid evolution target was found for species ${sourceId}.`);
  return rng.pick(candidates);
}

function clearEvolutionSlots(raw: RawRecord, slots: number): void {
  for (let slot = 0; slot < slots; slot += 1) {
    raw[`method_${slot}`] = 0;
    raw[`param_${slot}`] = 0;
    raw[`target_${slot}`] = 0;
  }
}

function readEvolutionEdges(project: ProjectState, speciesIds: number[]): Map<number, number[]> {
  const graph = new Map<number, number[]>();
  for (const id of speciesIds) {
    const store = project.narcs.evolutions;
    if (!store?.rawFiles[id]) continue;
    const raw = decodeRecord(project, "evolutions", id).raw;
    if (!raw) continue;
    const targets = Object.keys(raw)
      .filter((field) => /^target_\d+$/u.test(field))
      .map((field) => raw[field] ?? 0)
      .filter((target) => target > 0 && speciesIds.includes(target));
    graph.set(id, targets);
  }
  return graph;
}

function evolutionDepth(graph: Map<number, number[]>, speciesId: number, visited = new Set<number>()): number {
  if (visited.has(speciesId)) return 0;
  const nextVisited = new Set(visited).add(speciesId);
  return (graph.get(speciesId) ?? []).reduce((max, target) => Math.max(max, 1 + evolutionDepth(graph, target, nextVisited)), 0);
}

function incomingEvolutionCounts(graph: Map<number, number[]>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const targets of graph.values()) for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  return counts;
}

function pathExists(graph: Map<number, number[]>, start: number, target: number, visited = new Set<number>()): boolean {
  if (start === target) return true;
  if (visited.has(start)) return false;
  visited.add(start);
  return (graph.get(start) ?? []).some((next) => pathExists(graph, next, target, visited));
}

function wouldExceedStageLimit(source: number, target: number, graph: Map<number, number[]>, limit: number): boolean {
  return longestIncomingPath(graph, source, new Set()) + longestOutgoingPath(graph, target, new Set()) + 2 > limit;
}

function longestIncomingPath(graph: Map<number, number[]>, node: number, visited: Set<number>): number {
  if (visited.has(node)) return 0;
  visited.add(node);
  let longest = 0;
  for (const [source, targets] of graph) if (targets.includes(node)) longest = Math.max(longest, 1 + longestIncomingPath(graph, source, new Set(visited)));
  return longest;
}

function longestOutgoingPath(graph: Map<number, number[]>, node: number, visited: Set<number>): number {
  if (visited.has(node)) return 0;
  visited.add(node);
  return Math.max(0, ...(graph.get(node) ?? []).map((target) => 1 + longestOutgoingPath(graph, target, new Set(visited))));
}

function evolutionMethodUsesLevel(method: number): boolean {
  return [2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 19, 20, 23, 24, 25, 26, 27, 28].includes(method);
}

function chooseMove(project: ProjectState, moveIds: number[], personal: RawRecord, preferType: boolean, forceDamaging: boolean, used: Set<number>, rng: SeededRng): number {
  let candidates = moveIds.filter((id) => !used.has(id));
  if (forceDamaging) {
    const damaging = candidates.filter((id) => isGoodDamagingMove(project, id));
    if (damaging.length > 0) candidates = damaging;
  }
  if (preferType && rng.chance(0.4)) {
    const typed = candidates.filter((id) => {
      const type = decodeRecord(project, "moves", id).raw?.type;
      return type === personal.type_1 || type === personal.type_2;
    });
    if (typed.length > 0) candidates = typed;
  }
  if (candidates.length === 0) candidates = moveIds;
  return rng.pick(candidates);
}

function writeLearnset(project: ProjectState, raw: RawRecord, readable: ReadableRecord | undefined, entries: Array<{ moveId: number; level: number }>, limit: number): void {
  for (const field of Object.keys(raw)) if (/^(move_id|lvl_learned)_\d+$/u.test(field)) {
    delete raw[field];
    if (readable) delete readable[field];
  }
  entries.slice(0, limit).forEach((entry, index) => {
    raw[`move_id_${index}`] = entry.moveId;
    raw[`lvl_learned_${index}`] = entry.level;
    if (readable) {
      readable[`move_id_${index}`] = project.texts.banks.moves?.[entry.moveId] ?? entry.moveId;
      readable[`lvl_learned_${index}`] = entry.level;
    }
  });
}

function readEggMoves(bytes: Uint8Array): number[] {
  if (bytes.length < 2) return [];
  const count = Math.min(readU16(bytes, 0), Math.floor((bytes.length - 2) / 2));
  return Array.from({ length: count }, (_unused, index) => readU16(bytes, 2 + index * 2));
}

function writeEggMoves(project: ProjectState, speciesId: number, moveIds: number[]): void {
  const store = project.narcs.egg_moves;
  if (!store) return;
  const bytes = new Uint8Array(2 + moveIds.length * 2);
  writeU16(bytes, 0, moveIds.length);
  moveIds.forEach((moveId, index) => writeU16(bytes, 2 + index * 2, moveId));
  store.rawFiles[speciesId] = bytes;
  store.records.delete(speciesId);
  markDirty(project, "egg_moves", speciesId);
}

function usableMoveIds(project: ProjectState): number[] {
  const formatLength = project.formats.moves?.reduce((sum, [size]) => sum + size, 0) ?? 0;
  const ids: number[] = [];
  for (let id = 1; id < getMoveCount(project); id += 1) {
    const bytes = project.narcs.moves?.rawFiles[id];
    if (!bytes || (formatLength > 0 && bytes.length < formatLength)) continue;
    const raw = decodeRecord(project, "moves", id).raw;
    if (!raw || (raw.pp ?? 0) <= 0) continue;
    ids.push(id);
  }
  return ids;
}

function usableAbilityIds(project: ProjectState, speciesIds: number[], settings: RandomizerSettings): number[] {
  const text = project.texts.banks.abilities ?? [];
  const observedMax = speciesIds.reduce((max, id) => {
    const raw = decodeRecord(project, "personal", id).raw;
    return Math.max(max, raw?.ability_1 ?? 0, raw?.ability_2 ?? 0, raw?.ability_3 ?? 0);
  }, 0);
  const count = Math.max(text.length, observedMax + 1);
  return Array.from({ length: count }, (_unused, id) => id).filter((id) => {
    if (id <= 0) return false;
    const name = normalize(text[id] ?? `ability ${id}`);
    if (!settings.pokemon.allowWonderGuard && name === "wonder guard") return false;
    if (settings.pokemon.banNegativeAbilities && NEGATIVE_ABILITY_NAMES.has(name)) return false;
    return name.length > 0 && !name.includes("unused") && name !== "none";
  });
}

function usableItemIds(project: ProjectState): number[] {
  const names = project.texts.banks.items ?? [];
  return Array.from({ length: getItemCount(project) }, (_unused, id) => id).filter((id) => {
    if (id <= 0 || !project.narcs.items?.rawFiles[id]) return false;
    const name = normalize(names[id] ?? `item ${id}`);
    return name.length > 0 && !name.includes("unused") && name !== "none";
  });
}

function pokemonBst(project: ProjectState, speciesId: number): number {
  if (!project.narcs.personal?.rawFiles[speciesId]) return 0;
  const raw = decodeRecord(project, "personal", speciesId).raw;
  return raw ? STAT_FIELDS.reduce((sum, field) => sum + (raw[field] ?? 0), 0) : 0;
}

function pokemonHasType(project: ProjectState, speciesId: number, type: number): boolean {
  const raw = decodeRecord(project, "personal", speciesId).raw;
  return Boolean(raw && (raw.type_1 === type || raw.type_2 === type));
}

function isLegendary(project: ProjectState, speciesId: number): boolean {
  const raw = decodeRecord(project, "personal", speciesId).raw;
  return Boolean(raw && pokemonBst(project, speciesId) >= 570 && (raw.catchrate ?? 255) <= 15);
}

function nearestStrengthPool(project: ProjectState, candidates: number[], targetBst: number): number[] {
  if (candidates.length <= 12) return candidates;
  return [...candidates].sort((left, right) => Math.abs(pokemonBst(project, left) - targetBst) - Math.abs(pokemonBst(project, right) - targetBst)).slice(0, Math.max(12, Math.ceil(candidates.length * 0.08)));
}

function trainerTheme(project: ProjectState, raw: RawRecord, count: number, mode: TrainersMode, rng: SeededRng): number | undefined {
  const typeCount = randomizableTypeCount(project);
  if (mode === "type-themed") return rng.integer(0, Math.max(0, typeCount - 1));
  if (mode !== "keep-themed") return undefined;
  const counts = new Map<number, number>();
  for (let slot = 0; slot < count; slot += 1) {
    const species = raw[`species_id_${slot}`] ?? 0;
    const personal = project.narcs.personal?.rawFiles[species] ? decodeRecord(project, "personal", species).raw : undefined;
    if (!personal) continue;
    counts.set(personal.type_1, (counts.get(personal.type_1) ?? 0) + 1);
    counts.set(personal.type_2, (counts.get(personal.type_2) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function trainerPokemonRowLength(template: number): number {
  return 8 + ((template & 2) !== 0 ? 2 : 0) + ((template & 1) !== 0 ? 8 : 0);
}

function evolveSpeciesForLevel(project: ProjectState, start: number, level: number): number {
  let current = start;
  const visited = new Set<number>();
  while (!visited.has(current) && project.narcs.evolutions?.rawFiles[current]) {
    visited.add(current);
    const raw = decodeRecord(project, "evolutions", current).raw;
    if (!raw) break;
    const eligible = Object.keys(raw)
      .filter((field) => /^method_\d+$/u.test(field))
      .map((field) => Number(field.split("_")[1]))
      .find((slot) => {
        const method = raw[`method_${slot}`] ?? 0;
        const target = raw[`target_${slot}`] ?? 0;
        const required = evolutionMethodUsesLevel(method) ? raw[`param_${slot}`] ?? 1 : 1;
        return method > 0 && target > 0 && required <= level;
      });
    if (eligible === undefined) break;
    current = raw[`target_${eligible}`] ?? current;
  }
  return current;
}

function bestMovesForLevel(project: ProjectState, speciesId: number, level: number): number[] {
  if (!project.narcs.learnsets?.rawFiles[speciesId]) return [];
  const raw = decodeRecord(project, "learnsets", speciesId).raw;
  if (!raw) return [];
  const candidates = learnsetEntries(raw, 128).filter((entry) => entry.level <= level);
  return candidates.sort((left, right) => moveScore(project, right.moveId) - moveScore(project, left.moveId)).slice(0, 4).map((entry) => entry.moveId);
}

function moveScore(project: ProjectState, moveId: number): number {
  const raw = project.narcs.moves?.rawFiles[moveId] ? decodeRecord(project, "moves", moveId).raw : undefined;
  if (!raw) return 0;
  return (raw.power ?? 0) * ((raw.accuracy ?? 100) || 100) / 100 + ((raw.category ?? 0) === 0 ? 25 : 0);
}

function movePower(project: ProjectState, moveId: number): number {
  return project.narcs.moves?.rawFiles[moveId] ? decodeRecord(project, "moves", moveId).raw?.power ?? 0 : 0;
}

function isGoodDamagingMove(project: ProjectState, moveId: number): boolean {
  const raw = decodeRecord(project, "moves", moveId).raw;
  return Boolean(raw && (raw.category ?? 0) !== 0 && (raw.power ?? 0) >= 50 && ((raw.accuracy ?? 100) === 0 || (raw.accuracy ?? 0) >= 70));
}

function speciesLearnsMove(project: ProjectState, speciesId: number, moveId: number): boolean {
  if (!project.narcs.learnsets?.rawFiles[speciesId]) return false;
  const raw = decodeRecord(project, "learnsets", speciesId).raw;
  return Boolean(raw && learnsetEntries(raw, 128).some((entry) => entry.moveId === moveId));
}

function compatibilityEnabled(project: ProjectState, raw: RawRecord, kind: "tm" | "hm", index: number): boolean {
  const location = compatibilityLocation(project, kind, index);
  return Math.floor((raw[location.field] ?? 0) / 2 ** location.bit) % 2 === 1;
}

function writeCompatibility(project: ProjectState, raw: RawRecord, entries: ReturnType<typeof getTmEntries>, values: boolean[]): void {
  const next = new Map<string, number>(TM_FIELDS.map((field) => [field, raw[field] ?? 0]));
  entries.forEach((entry, index) => {
    const location = compatibilityLocation(project, entry.kind, entry.number);
    const current = next.get(location.field) ?? 0;
    const mask = 2 ** location.bit;
    const enabled = Math.floor(current / mask) % 2 === 1;
    next.set(location.field, values[index] === enabled ? current : values[index] ? current + mask : current - mask);
  });
  for (const [field, value] of next) raw[field] = value;
}

function compatibilityLocation(project: ProjectState, kind: "tm" | "hm", index: number): { field: string; bit: number } {
  const counts = machineCountsForProject(project);
  if (kind === "tm") {
    if (index <= 32) return { field: "tm_1-32", bit: index - 1 };
    if (index <= 64) return { field: "tm_33-64", bit: index - 33 };
    return { field: "tm_65-95+hm_1", bit: index - 65 };
  }
  if (counts.hm === 8) return index <= 4 ? { field: "tm_65-95+hm_1", bit: 27 + index } : { field: "hm_2-6", bit: index - 5 };
  return index === 1 ? { field: "tm_65-95+hm_1", bit: 31 } : { field: "hm_2-6", bit: index - 2 };
}

function shopItemAllowed(project: ProjectState, itemId: number, options: RandomizerSettings["shops"]): boolean {
  const name = normalize(project.texts.banks.items?.[itemId] ?? "");
  if (options.banBadItems && BAD_ITEM_TERMS.some((term) => name.includes(term))) return false;
  if (options.banRegularShopItems && REGULAR_SHOP_TERMS.some((term) => name.includes(term))) return false;
  if (options.banOverpoweredItems && OVERPOWERED_ITEM_TERMS.some((term) => name.includes(term))) return false;
  return true;
}

function idsMatchingTerms(values: readonly string[] | undefined, terms: readonly string[]): number[] {
  if (!values) return [];
  return values.map((value, id) => ({ value: normalize(value), id })).filter(({ value, id }) => id > 0 && terms.some((term) => value.includes(term))).map(({ id }) => id);
}

function findNamedId(values: readonly string[] | undefined, name: string): number | undefined {
  if (!values) return undefined;
  const index = values.findIndex((value) => normalize(value) === normalize(name));
  return index >= 0 ? index : undefined;
}

function syncMartCountBytes(project: ProjectState, martId: number, raw: RawRecord): void {
  const bytes = project.narcs.mart_counts?.rawFiles[0];
  if (!bytes || martId >= bytes.length) return;
  bytes[martId] = Array.from({ length: 20 }, (_unused, index) => raw[`item_${index}`] ?? 0).filter((id) => id > 0).length;
  markDirty(project, "mart_counts", 0);
}

function syncRandomizedPersonalReadable(project: ProjectState): void {
  const store = project.narcs.personal;
  if (!store) return;
  const types = typeNamesForProject(project);
  for (const id of store.dirty) {
    const record = store.records.get(id);
    if (!record?.raw || !record.readable) continue;
    Object.assign(record.readable, record.raw);
    record.readable.type_1 = types[record.raw.type_1] ?? record.raw.type_1;
    record.readable.type_2 = types[record.raw.type_2] ?? record.raw.type_2;
    for (const field of ["ability_1", "ability_2", "ability_3"] as const) {
      const value = record.raw[field] ?? 0;
      record.readable[field] = project.texts.banks.abilities?.[value] ?? value;
    }
    for (const field of ["item_1", "item_2", "item_3"] as const) {
      const value = record.raw[field] ?? 0;
      record.readable[field] = project.texts.banks.items?.[value] ?? value;
    }
    record.readable.exp_rate = GROWTHS[record.raw.exp_rate] ?? record.raw.exp_rate;
  }
}

function distributeStatTotal(total: number, rng: SeededRng): number[] {
  const weights = Array.from({ length: 6 }, () => 0.25 + rng.next());
  return distributeByWeights(clamp(total, 6, 1530), weights);
}

function distributeByWeights(total: number, weights: number[]): number[] {
  const result = Array(6).fill(1) as number[];
  let remaining = Math.max(0, total - 6);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  for (let index = 0; index < result.length; index += 1) {
    const value = index === result.length - 1 ? remaining : Math.min(254, Math.floor((total - 6) * weights[index]! / weightTotal));
    const applied = Math.min(254, value);
    result[index] += applied;
    remaining -= applied;
  }
  let cursor = 0;
  while (remaining > 0 && result.some((value) => value < 255)) {
    if (result[cursor]! < 255) {
      result[cursor]! += 1;
      remaining -= 1;
    }
    cursor = (cursor + 1) % result.length;
  }
  return result;
}

function differentValue(current: number, count: number, rng: SeededRng): number {
  if (count <= 1) return current;
  const value = rng.integer(0, count - 2);
  return value >= current ? value + 1 : value;
}

function pickDifferent<T>(values: readonly T[], current: T, rng: SeededRng): T {
  const alternatives = values.filter((value) => value !== current);
  return alternatives.length > 0 ? rng.pick(alternatives) : current;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9. ]+/gu, " ").replace(/\s+/gu, " ");
}

function randomizableTypeCount(project: ProjectState): number {
  const count = typeNamesForProject(project).length;
  return project.session.fairy ? count : Math.min(17, count);
}

function bump(result: RandomizerResult, key: keyof RandomizerResult["changes"]): void {
  result.changes[key] = (result.changes[key] ?? 0) + 1;
}

function randomizerDomain(key: string): string {
  return ({ pokemon: "personal", evolutions: "evolutions", learnsets: "learnsets", eggMoves: "egg_moves", moves: "moves", tmCompatibility: "personal", starters: "scripts", gifts: "scripts", giftEggs: "scripts", inGameTrades: "ingame_trades", trainers: "trpok", encounters: "encounters", grottos: "grottos", shops: "marts" } as Record<string, string>)[key] ?? key;
}

function randomizerLabel(key: string): string {
  return ({ pokemon: "Pokémon data records", evolutions: "evolution records", learnsets: "learnsets", eggMoves: "egg-move lists", moves: "moves", tmCompatibility: "Pokémon TM/HM compatibility records", starters: "starters", gifts: "gift Pokémon", giftEggs: "gift eggs", inGameTrades: "in-game trades", trainers: "trainers", encounters: "encounter files", grottos: "hidden grottoes", shops: "shops" } as Record<string, string>)[key] ?? key;
}

function needsMovePool(settings: RandomizerSettings): boolean {
  return settings.movesets.mode !== "unchanged" || Object.values(settings.moveData).some(Boolean) || settings.tmCompatibility.mode !== "unchanged" || settings.tmCompatibility.levelUpMoveSanity;
}
