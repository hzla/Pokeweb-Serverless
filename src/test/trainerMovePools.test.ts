import { describe, expect, it } from "vitest";
import {
  changeOwnMove, decodeTrainerMovePools, emptyTrainerMovePools, encodeTrainerMovePools, trainerMovePoolKey, trainerMovePoolProblem,
  trainerMoveSlotChances, withoutOwnMoves, type TrainerMovePools,
} from "../pokeweb/trainerMovePools";
import { createAlternateParty, editPoolMemberField, editRosterPool, rosterPool } from "../pokeweb/trainerRosterHub";
import {
  followTrainerSlotMoves, getTrainerPartyPools, getTrainerSlotMovePools, setTrainerSlotMovePools, trainerSlotMoves,
} from "../pokeweb/trainerRosterModel";
import { duplicateTrainerPokemon, updateTrainerPokemonField } from "../pokeweb/trainerModel";
import { trainerPoolSource } from "../pokeweb/trainerPartyPools";
import { makeTrainerTestProject } from "./trainerTestProject";

const pools = (...slots: Array<Array<[number, number]>>): TrainerMovePools => {
  const value = emptyTrainerMovePools();
  slots.forEach((alternatives, slot) => { value[slot]!.alternatives = alternatives.map(([move, weight]) => ({ move, weight })); });
  return value;
};

describe("move pool file", () => {
  it("round-trips entries sorted by source and slot, leaving out empty ones", () => {
    const map = new Map([
      [trainerMovePoolKey(trainerPoolSource(3), 2), pools([], [[85, 3]])],
      [trainerMovePoolKey(4, 0), pools([[85, 1], [58, 2]])],
      [trainerMovePoolKey(5, 1), emptyTrainerMovePools()],
    ]);
    map.get(trainerMovePoolKey(4, 0))![0]!.weight = 0;
    const bytes = encodeTrainerMovePools(map);
    // Header, two 8-byte keys, then entries of 12 bytes plus 4 per alternative.
    expect(bytes.length).toBe(16 + 2 * 8 + (12 + 8) + (12 + 4));
    expect([bytes[16], bytes[17], bytes[18]]).toEqual([4, 0, 0]);
    const decoded = decodeTrainerMovePools(bytes);
    expect([...decoded.keys()]).toEqual([trainerMovePoolKey(4, 0), trainerMovePoolKey(trainerPoolSource(3), 2)]);
    expect(decoded.get(trainerMovePoolKey(4, 0))![0]).toEqual({ weight: 0, alternatives: [{ move: 85, weight: 1 }, { move: 58, weight: 2 }] });
    expect(() => decodeTrainerMovePools(bytes.slice(0, -1))).toThrow();
  });

  it("checks that a roll can give every slot a different move", () => {
    expect(trainerMovePoolProblem(pools([[85, 1]]), [94, 0, 0, 0])).toBeUndefined();
    expect(trainerMovePoolProblem(pools([[94, 1]]), [94, 0, 0, 0])).toMatch(/same move twice/);
    // Slot 1 can only be Thunderbolt, which slot 2 keeps: no set works.
    const stuck = pools([[85, 1]], []);
    stuck[0]!.weight = 0;
    expect(trainerMovePoolProblem(stuck, [94, 85, 0, 0])).toMatch(/can't all get different moves/);
    expect(trainerMovePoolProblem(pools([[85, 1]]), [94, 85, 0, 0])).toBeUndefined();
    expect(trainerMoveSlotChances({ weight: 2, alternatives: [{ move: 85, weight: 1 }, { move: 58, weight: 1 }] }, 94).map((option) => option.chance))
      .toEqual([0.5, 0.25, 0.25]);
  });

  it("swaps an alternative with the slot's move when it is picked as the move", () => {
    const value = pools([[85, 3]]);
    expect(changeOwnMove(value, 0, 94, 85)![0]!.alternatives).toEqual([{ move: 94, weight: 3 }]);
    expect(changeOwnMove(value, 0, 0, 85)).toBeUndefined();
    expect(withoutOwnMoves(pools([[85, 1], [58, 1]]), [58, 0, 0, 0])![0]!.alternatives).toEqual([{ move: 85, weight: 1 }]);
  });
});

describe("trainer move pools", () => {
  it("stores alternatives per trainer slot and follows the party when slots move", () => {
    const project = makeTrainerTestProject(1);
    setTrainerSlotMovePools(project, 1, 0, pools([[1, 2]]));
    expect(getTrainerSlotMovePools(project, 1, 0)![0]!.alternatives).toEqual([{ move: 1, weight: 2 }]);
    expect(() => setTrainerSlotMovePools(project, 1, 0, pools([[2, 1]]))).toThrow(/same move twice/);
    duplicateTrainerPokemon(project, 1, 0);
    expect(getTrainerSlotMovePools(project, 1, 1)![0]!.alternatives).toEqual([{ move: 1, weight: 2 }]);
    // Picking the alternative as the slot's move swaps the two.
    const previous = trainerSlotMoves(project, 1, 0);
    updateTrainerPokemonField(project, 1, 0, "move_1_0", "Tackle");
    followTrainerSlotMoves(project, 1, 0, previous);
    expect(getTrainerSlotMovePools(project, 1, 0)![0]!.alternatives).toEqual([{ move: 2, weight: 2 }]);
    setTrainerSlotMovePools(project, 1, 0, undefined);
    expect(getTrainerSlotMovePools(project, 1, 0)).toBeUndefined();
  });

  it("keeps a party's own Pokémon's alternatives with the party", () => {
    const project = makeTrainerTestProject(1);
    setTrainerSlotMovePools(project, 1, 0, pools([[1, 1]]));
    const id = createAlternateParty(project, 1);
    const member = getTrainerPartyPools(project).get(id)!.members[0]!;
    expect("pokemon" in member && member.pokemon.movePools?.[0]?.alternatives).toEqual([{ move: 1, weight: 1 }]);
    expect(editRosterPool(project, id, (pool) => {
      const pokemon = (pool.members[0] as Extract<typeof pool.members[number], { pokemon: unknown }>).pokemon;
      pokemon.movePools![1]!.alternatives.push({ move: 3, weight: 4 });
    }).saved).toBe(true);
    const saved = getTrainerPartyPools(project).get(id)!.members[0]!;
    expect("pokemon" in saved && saved.pokemon.movePools?.[1]?.alternatives).toEqual([{ move: 3, weight: 4 }]);
    // Choosing an alternative as the move swaps them here too.
    editRosterPool(project, id, (pool) => {
      const pokemon = (pool.members[0] as Extract<typeof pool.members[number], { pokemon: unknown }>).pokemon;
      editPoolMemberField(project, pokemon, "move_1_0", "Tackle");
    });
    const swapped = rosterPool(project, id)!.members[0]!;
    expect("pokemon" in swapped && swapped.pokemon.movePools?.[0]?.alternatives).toEqual([{ move: 2, weight: 1 }]);
    // A repeated move can't be saved; the edit stays a draft.
    expect(editRosterPool(project, id, (pool) => {
      const pokemon = (pool.members[0] as Extract<typeof pool.members[number], { pokemon: unknown }>).pokemon;
      pokemon.movePools![0]!.alternatives.push({ move: 1, weight: 1 });
    }).saved).toBe(false);
  });
});
