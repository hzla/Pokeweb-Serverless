import { detectBundledFormEvolutionDll } from "./pmcModel";
import { findPokemonPersonalFormOwner } from "./pokemonLabels";
import { learnsetEntries } from "./pokemonModel";
import { decodeRecord, type ProjectState } from "./projectStore";
import { evolutionEdges, type EvolutionEdge } from "./testTeamEvolution";
import { trainerFormPersonalId } from "./trainerSlotFacts";

export type BalanceEvolutionOptions = {
  itemIds?: readonly number[];
  allowTrading?: boolean;
};

export type BalanceEvolutionTarget = { speciesId: number; form: number; moves: ReadonlySet<number> };

type PokemonForm = Pick<BalanceEvolutionTarget, "speciesId" | "form">;
type Gender = "male" | "female" | "genderless";
type Learnset = ReturnType<typeof learnsetEntries>;
type EvolutionPlan = { targets: BalanceEvolutionTarget[]; evolved: ReadonlySet<string> };

function pokemonLearnset(project: ProjectState, personalId: number, baseId: number): Learnset {
  const id = project.narcs.learnsets?.rawFiles[personalId] ? personalId : baseId;
  const raw = decodeRecord(project, "learnsets", id).raw;
  if (!raw) throw new Error("Missing level-up moves.");
  return learnsetEntries(raw);
}

/** The most recently learned four distinct moves on a newly created Pokémon. */
function startingMoves(learnset: Learnset, level: number): number[] {
  const learned = new Set<number>();
  for (const { moveId, level: learnLevel } of learnset) {
    if (moveId && learnLevel <= level) {
      learned.delete(moveId);
      learned.add(moveId);
    }
  }
  return [...learned].slice(-4);
}

export function balanceStartingMoves(project: ProjectState, personalId: number, baseId: number, level: number): number[] {
  return startingMoves(pokemonLearnset(project, personalId, baseId), level);
}

const formKey = ({ speciesId, form }: PokemonForm) => `${speciesId}:${form}`;

export function createBalanceEvolutionPlanner(project: ProjectState, cap: number, options: BalanceEvolutionOptions) {
  const itemIds = new Set(options.itemIds);
  const formRuntime = detectBundledFormEvolutionDll(project) === "patched";
  const memo = new Map<string, EvolutionPlan>();
  const forms = new Map<string, ReturnType<typeof readForm>>();

  function readForm(pokemon: PokemonForm) {
    const { speciesId, form } = pokemon;
    const baseId = trainerFormPersonalId(project, speciesId, 0);
    const personalId = form ? trainerFormPersonalId(project, speciesId, form) : baseId;
    const raw = decodeRecord(project, "personal", personalId).raw;
    if (!raw) throw new Error("Missing personal data.");
    const formEdges = formRuntime && personalId !== baseId ? evolutionEdges(project, personalId) : [];
    const learnset = pokemonLearnset(project, personalId, baseId);
    const byLevel = new Map<number, number[]>();
    for (const { moveId, level } of learnset) {
      const moves = byLevel.get(level) ?? [];
      if (moveId) moves.push(moveId);
      byLevel.set(level, moves);
    }
    return { raw, learnset, byLevel, edges: formEdges.length ? formEdges : evolutionEdges(project, baseId) };
  }

  function facts(pokemon: PokemonForm) {
    const key = formKey(pokemon);
    let result = forms.get(key);
    if (!result) {
      result = readForm(pokemon);
      forms.set(key, result);
    }
    return result;
  }

  function targetForm(current: PokemonForm, edge: EvolutionEdge): PokemonForm | undefined {
    const owner = findPokemonPersonalFormOwner(project, edge.targetPersonalId);
    if (owner) return formRuntime ? { speciesId: owner.speciesId, form: owner.formIndex } : undefined;
    const speciesId = edge.targetPersonalId;
    const raw = decodeRecord(project, "personal", speciesId).raw;
    return { speciesId, form: current.form < (raw?.num_forms ?? 1) ? current.form : 0 };
  }

  function eligibleAtLevel(
    edge: EvolutionEdge, level: number, leveledUp: boolean, gender: Gender,
    moves: ReadonlySet<number>, raw: ReturnType<typeof readForm>["raw"],
  ): boolean {
    const hasItem = edge.param > 0 && itemIds.has(edge.param);
    switch (edge.method) {
      case 5: return !!options.allowTrading;
      case 6: return !!options.allowTrading && hasItem;
      case 8: return hasItem;
      case 17: return hasItem && gender === "male";
      case 18: return hasItem && gender === "female";
    }
    if (!leveledUp) return false;
    switch (edge.method) {
      case 1: case 2: case 3: return true; // Friendship and both times of day are available.
      case 4: case 12: case 13: case 14: case 15: return level >= edge.param;
      case 9: case 10: case 11: {
        // The report uses a neutral nature, 15 IVs and zero EVs.
        const stat = (base: number) => Math.floor((2 * base + 15) * level / 100) + 5;
        const comparison = Math.sign(stat(raw.base_atk) - stat(raw.base_def));
        return level >= edge.param && comparison === 10 - edge.method;
      }
      case 19: case 20: return hasItem;
      case 21: return moves.has(edge.param);
      case 23: return level >= edge.param && gender === "male";
      case 24: return level >= edge.param && gender === "female";
      default: return false;
    }
  }

  function plan(
    current: PokemonForm, entryLevel: number, gender: Gender, known: readonly number[],
    priorForms: readonly string[],
  ): EvolutionPlan {
    const currentKey = formKey(current);
    const key = JSON.stringify([currentKey, entryLevel, gender, [...known].sort((a, b) => a - b), priorForms]);
    const previous = memo.get(key);
    if (previous) return previous;
    const route = [...priorForms, currentKey];
    const { edges, raw, byLevel } = facts(current);
    const branches = edges.flatMap((edge) => {
      const target = targetForm(current, edge);
      return target && !route.includes(formKey(target)) ? [{ edge, target }] : [];
    });
    const moves = new Set(known);
    const evolutions = new Map<string, BalanceEvolutionTarget>();
    const evolved = new Set<string>();
    for (let level = entryLevel; level <= cap; level += 1) {
      if (level > entryLevel) for (const move of byLevel.get(level) ?? []) moves.add(move);
      // A player can delay evolution and keep an eligible move when offered a replacement.
      for (const { edge, target } of branches) {
        if (!eligibleAtLevel(edge, level, level > entryLevel, gender, moves, raw)) continue;
        const inherited = new Set(moves);
        for (const move of facts(target).byLevel.get(level) ?? []) inherited.add(move);
        const branch = plan(target, level, gender, [...inherited], route);
        evolved.add(currentKey);
        for (const form of branch.evolved) evolved.add(form);
        for (const result of branch.targets) mergeTarget(evolutions, result);
      }
    }
    // Waiting can preserve moves for the final form, but a delayed intermediate
    // form should only appear if this catch cannot evolve it any further.
    const targets = evolved.size ? [...evolutions.values()].filter((target) => !evolved.has(formKey(target))) : [{ ...current, moves }];
    const result = { targets, evolved };
    memo.set(key, result);
    return result;
  }

  return (speciesId: number, form: number, catchLevel: number): BalanceEvolutionTarget[] => {
    const caught = { speciesId, form };
    const { raw, learnset } = facts(caught);
    const moves = startingMoves(learnset, catchLevel);
    const ratio = raw.gender;
    const genders: Gender[] = ratio === 255 ? ["genderless"] : ratio === 254 ? ["female"] : ratio === 0 ? ["male"] : ["male", "female"];
    const targets = new Map<string, BalanceEvolutionTarget>();
    for (const gender of genders) {
      for (const target of plan(caught, catchLevel, gender, moves, []).targets) mergeTarget(targets, target);
    }
    return [...targets.values()];
  };
}

function mergeTarget(targets: Map<string, BalanceEvolutionTarget>, target: BalanceEvolutionTarget) {
  const key = formKey(target);
  const previous = targets.get(key);
  targets.set(key, previous ? { ...target, moves: new Set([...previous.moves, ...target.moves]) } : target);
}
