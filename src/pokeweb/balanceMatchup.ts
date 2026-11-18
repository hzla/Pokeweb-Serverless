import { calculate, Field, Generations, Move, Pokemon, toID } from "@smogon/calc";
import type { Generation, Move as CalcMoveData, Specie, Weather } from "@smogon/calc/dist/data/interface";
import { getFinalSpeed } from "@smogon/calc/dist/mechanics/util";

export type BalancePokemon = {
  name: string;
  level: number;
  iv: number;
  nature: string;
  ability: string;
  item?: string;
  species: Pick<Specie, "baseStats" | "types" | "weightkg">;
  moves: BalanceMove[];
};

export type BalanceMove = {
  name: string;
  mechanics: string;
  data: Partial<CalcMoveData>;
  accurate: boolean;
  pp: number;
  minHits: number;
  maxHits: number;
};

export type BalanceWin = { move: string; moveIndex: number; turns: number; hpPercent: number };

const calcGen = Generations.get(5);
const statNames = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const weatherAbilities: Record<string, Weather> = { Drought: "Sun", Drizzle: "Rain", "Sand Stream": "Sand", "Snow Warning": "Hail" };

export function balanceGeneration(chart: ReadonlyMap<string, Record<string, number>>): Generation {
  if (chart.size === 0) return calcGen;
  return {
    ...calcGen,
    types: {
      [Symbol.iterator]: () => calcGen.types[Symbol.iterator](),
      get(id) {
        const type = calcGen.types.get(id) ?? Generations.get(6).types.get(id);
        const effectiveness = type && chart.get(type.name);
        return type && effectiveness ? { ...type, effectiveness: { ...type.effectiveness, ...effectiveness } } : type;
      },
    },
  };
}

function calcPokemon(gen: Generation, combatant: BalancePokemon): Pokemon {
  return new Pokemon(gen, combatant.name, {
    overrides: { ...combatant.species, abilities: { 0: combatant.ability as NonNullable<Specie["abilities"]>[0] } },
    level: combatant.level,
    nature: combatant.nature,
    ability: combatant.ability,
    item: combatant.item,
    ivs: Object.fromEntries(statNames.map((stat) => [stat, combatant.iv])),
    evs: {},
  });
}

function calcMove(gen: Generation, move: BalanceMove, pokemon: Pokemon, highRoll: boolean): Move {
  return new Move(gen, move.mechanics, {
    ability: pokemon.ability,
    item: pokemon.item,
    hits: highRoll || pokemon.hasAbility("Skill Link") ? move.maxHits : move.minHits,
    overrides: move.data,
  });
}

function openingField(player: Pokemon, boss: Pokemon, weather?: Weather): Field | undefined {
  const field = new Field();
  const playerWeather = weatherAbilities[player.ability ?? ""];
  const bossWeather = weatherAbilities[boss.ability ?? ""];
  if (playerWeather && bossWeather && playerWeather !== bossWeather) {
    const playerSpeed = getFinalSpeed(calcGen, player, field, field.attackerSide);
    const bossSpeed = getFinalSpeed(calcGen, boss, field, field.defenderSide);
    if (playerSpeed === bossSpeed) return undefined;
    weather = playerSpeed > bossSpeed ? bossWeather : playerWeather;
  } else {
    weather = playerWeather ?? bossWeather ?? weather;
  }
  if (!player.hasAbility("Air Lock", "Cloud Nine") && !boss.hasAbility("Air Lock", "Cloud Nine")) field.weather = weather;
  return field;
}

function canRelyOnAccuracy(move: BalanceMove, player: Pokemon, boss: Pokemon, field: Field): boolean {
  if (player.hasAbility("No Guard") || boss.hasAbility("No Guard")) return true;
  if (!move.accurate) return false;
  if (move.mechanics === "Swift" || move.mechanics === "Aerial Ace" || move.mechanics === "Aura Sphere"
    || move.mechanics === "Faint Attack" || move.mechanics === "Feint Attack" || move.mechanics === "Magical Leaf"
    || move.mechanics === "Shadow Punch" || move.mechanics === "Shock Wave" || move.mechanics === "Vital Throw") return true;
  return !(player.hasAbility("Hustle") && move.data.category === "Physical")
    && !boss.hasItem("Bright Powder", "Lax Incense")
    && !(boss.hasAbility("Sand Veil") && field.hasWeather("Sand"))
    && !(boss.hasAbility("Snow Cloak") && field.hasWeather("Hail"));
}

function hit(gen: Generation, attacker: Pokemon, defender: Pokemon, move: Move, field: Field, highRoll: boolean): void {
  const result = calculate(gen, attacker, defender, move, field);
  let damage = result.range()[highRoll ? 1 : 0];
  if (!Number.isFinite(damage) || damage < 0) throw new Error("Damage could not be calculated.");
  if (!damage) return;

  const hp = defender.curHP();
  if (hp === defender.maxHP() && damage >= hp && move.hits === 1) {
    const sash = defender.hasItem("Focus Sash");
    const sturdy = defender.hasAbility("Sturdy") && !attacker.hasAbility("Mold Breaker", "Teravolt", "Turboblaze");
    if (sash || sturdy) damage = hp - 1;
    if (sash) defender.item = undefined;
  }
  if (defender.hasItem("Air Balloon")) defender.item = undefined;
  if (attacker.item?.endsWith(" Gem") && result.rawDesc.attackerItem === attacker.item) attacker.item = undefined;
  damage = Math.min(hp, damage);
  defender.originalCurHP -= damage;

  if (move.drain && !defender.hasAbility("Liquid Ooze")) {
    const [numerator, denominator] = move.drain;
    attacker.originalCurHP = Math.min(attacker.maxHP(), attacker.curHP() + Math.max(1, Math.floor(damage * numerator / denominator)));
  }
  if (move.drain && defender.hasAbility("Liquid Ooze")) {
    const [numerator, denominator] = move.drain;
    attacker.originalCurHP -= Math.max(1, Math.floor(damage * numerator / denominator));
  }
  if (move.recoil && !attacker.hasAbility("Rock Head", "Magic Guard")) {
    const [numerator, denominator] = move.recoil;
    attacker.originalCurHP -= Math.max(1, Math.round(damage * numerator / denominator));
  }
  if (attacker.hasItem("Life Orb") && !attacker.hasAbility("Magic Guard")
    && !(attacker.hasAbility("Sheer Force") && move.secondaries)) {
    attacker.originalCurHP -= Math.max(1, Math.floor(attacker.maxHP() / 10));
  }
  if (move.flags.contact && !attacker.hasAbility("Magic Guard")) {
    if (defender.hasAbility("Rough Skin", "Iron Barbs")) attacker.originalCurHP -= Math.max(1, Math.floor(attacker.maxHP() / 8)) * move.hits;
    if (defender.hasItem("Rocky Helmet")) attacker.originalCurHP -= Math.max(1, Math.floor(attacker.maxHP() / 6)) * move.hits;
  }
  consumeHealingBerry(defender, attacker);
}

function consumeHealingBerry(pokemon: Pokemon, other: Pokemon): void {
  const hp = pokemon.maxHP();
  if (pokemon.curHP() > 0 && pokemon.curHP() <= hp / 2
    && pokemon.hasItem("Oran Berry", "Sitrus Berry") && !other.hasAbility("Unnerve")) {
    const heal = pokemon.hasItem("Oran Berry") ? 10 : Math.max(1, Math.floor(hp / 4));
    pokemon.originalCurHP = Math.min(hp, pokemon.curHP() + heal);
    pokemon.item = undefined;
  }
}

function endTurn(pokemon: Pokemon, other: Pokemon, field: Field): void {
  const hp = pokemon.maxHP();
  const ignoresWeather = pokemon.hasAbility("Magic Guard", "Overcoat");
  if (!ignoresWeather && (
    field.hasWeather("Hail") && !pokemon.hasType("Ice") && !pokemon.hasAbility("Ice Body", "Snow Cloak") ||
    field.hasWeather("Sand") && !pokemon.hasType("Rock", "Ground", "Steel") && !pokemon.hasAbility("Sand Rush", "Sand Force", "Sand Veil")
  )) pokemon.originalCurHP -= Math.max(1, Math.floor(hp / 16));
  if (pokemon.curHP() <= 0) return;
  const recovers = pokemon.hasItem("Leftovers") || (pokemon.hasItem("Black Sludge") && pokemon.hasType("Poison"))
    || (field.hasWeather("Rain") && pokemon.hasAbility("Rain Dish")) || (field.hasWeather("Hail") && pokemon.hasAbility("Ice Body"));
  if (recovers) pokemon.originalCurHP = Math.min(hp, pokemon.curHP() + Math.max(1, Math.floor(hp / 16)));
  if (pokemon.hasItem("Black Sludge") && !pokemon.hasType("Poison") && !pokemon.hasAbility("Magic Guard")) {
    pokemon.originalCurHP -= Math.max(1, Math.floor(hp / 8));
  }
  consumeHealingBerry(pokemon, other);
}

// Keep the battle console's low-player/high-boss roll check, and resolve each turn
// so the boss can combine attacks with different damage and priority.
export function reliableBalanceWin(gen: Generation, candidate: BalancePokemon, opponent: BalancePokemon, weather?: Weather): BalanceWin | undefined {
  const player = calcPokemon(gen, candidate);
  const boss = calcPokemon(gen, opponent);
  const startingField = openingField(player, boss, weather);
  if (!startingField) return undefined;
  const field = startingField;
  const bossField = field.clone().swap();
  const responses = opponent.moves.length ? opponent.moves.map((move) => calcMove(gen, move, boss, true)) : [undefined];
  let best: BalanceWin | undefined;

  for (const [moveIndex, attack] of candidate.moves.entries()) {
    if (!canRelyOnAccuracy(attack, player, boss, field)) continue;
    const playerMove = calcMove(gen, attack, player, false);
    const turnLimit = Math.min(12, Math.floor(attack.pp / (boss.hasAbility("Pressure") ? 2 : 1)));
    type Outcome = { hp: number; turns: number };
    const memo = new Map<string, Outcome | null>();
    function finish(playerState: Pokemon, bossState: Pokemon, turns: number): Outcome | null {
      if (playerState.curHP() <= 0) return null;
      if (bossState.curHP() <= 0) return { hp: playerState.curHP(), turns };
      if (turns >= turnLimit) return null;
      const key = `${turns}:${playerState.curHP()}:${bossState.curHP()}:${playerState.item ?? ""}:${bossState.item ?? ""}`;
      const previous = memo.get(key);
      if (previous !== undefined) return previous;
      // Bound the search for unusual healing or low-damage matchups in the editor.
      if (memo.size >= 2000) return null;

      let worst = { hp: Infinity, turns };
      const playerSpeed = getFinalSpeed(gen, playerState, field, field.attackerSide);
      const bossSpeed = getFinalSpeed(gen, bossState, bossField, bossField.attackerSide);
      for (const bossMove of responses) {
        const nextPlayer = playerState.clone();
        const nextBoss = bossState.clone();
        const bossFirst = bossMove && (bossMove.priority === playerMove.priority
          ? bossSpeed >= playerSpeed || bossState.hasItem("Quick Claw") : bossMove.priority > playerMove.priority);
        if (bossMove && bossFirst) hit(gen, nextBoss, nextPlayer, bossMove, bossField, true);
        if (nextPlayer.curHP() > 0 && nextBoss.curHP() > 0) hit(gen, nextPlayer, nextBoss, playerMove, field, false);
        if (bossMove && !bossFirst && nextPlayer.curHP() > 0 && nextBoss.curHP() > 0) hit(gen, nextBoss, nextPlayer, bossMove, bossField, true);
        if (nextPlayer.curHP() > 0 && nextBoss.curHP() > 0) {
          endTurn(nextPlayer, nextBoss, field);
          endTurn(nextBoss, nextPlayer, bossField);
        }
        const outcome = finish(nextPlayer, nextBoss, turns + 1);
        if (!outcome) {
          memo.set(key, null);
          return null;
        }
        worst = { hp: Math.min(worst.hp, outcome.hp), turns: Math.max(worst.turns, outcome.turns) };
      }
      memo.set(key, worst);
      return worst;
    }

    const outcome = finish(player, boss, 0);
    if (!outcome) continue;
    const hpPercent = Math.floor(1000 * outcome.hp / player.maxHP()) / 10;
    if (!best || hpPercent > best.hpPercent || (hpPercent === best.hpPercent && outcome.turns < best.turns)) {
      best = { move: attack.name, moveIndex, turns: outcome.turns, hpPercent };
    }
  }
  return best;
}

export const gen5BalanceData = calcGen;
export const balanceId = toID;
