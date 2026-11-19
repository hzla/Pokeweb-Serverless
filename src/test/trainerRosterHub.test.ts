import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { decodeTrainerPools, findSlotPoolTeam, TRAINER_POOLS_PATH, trainerPoolSource, type TrainerPartyPool } from "../pokeweb/trainerPartyPools";
import {
  copyPoolForTrainer, createAlternateParty, createPool, editPoolMemberField, editRosterPool, linkRoster, removeRoster, rollPoolTeam,
  poolPokemonFromTrainerSlot, rosterPool, rosterPoolProblem, rosterRules, ruleDraft, saveRules, setRosterWeight,
} from "../pokeweb/trainerRosterHub";
import { getTrainerPartyPools, getTrainerRosterChoices, getTrainerRosterRules, getTrainerSlotNickname, setTrainerSlotNickname } from "../pokeweb/trainerRosterModel";
import { addTrainer, addTrainerPokemon, deleteTrainerPokemon, duplicateTrainerPokemon, moveTrainerPokemon, updateTrainerPokemonField } from "../pokeweb/trainerModel";
import { trainerMaxHp, trainerStartingHp } from "../pokeweb/trainerSlotFacts";
import { makeTrainerTestProject } from "./trainerTestProject";

describe("roster hub", () => {
  it("makes an alternate party that is already part of the random choice", () => {
    const project = makeTrainerTestProject();
    const id = createAlternateParty(project, 1);
    expect(getTrainerPartyPools(project).get(id)).toMatchObject({ owner: 1, size: 1 });
    expect(getTrainerRosterChoices(project, 1)).toEqual([{ rosterId: 1, weight: 1 }, { rosterId: trainerPoolSource(id), weight: 1 }]);
    // Taking the original out leaves the party alone; taking the party out returns to "original only".
    setRosterWeight(project, 1, 1, 0);
    expect(getTrainerRosterChoices(project, 1)).toEqual([{ rosterId: trainerPoolSource(id), weight: 1 }]);
    setRosterWeight(project, 1, 1, 2);
    removeRoster(project, 1, trainerPoolSource(id));
    expect(getTrainerRosterChoices(project, 1)).toEqual([]);
    expect(getTrainerPartyPools(project).has(id)).toBe(false);
  });

  it("keeps an edit that can't build a team as a draft and the last working pool in the ROM", () => {
    const project = makeTrainerTestProject();
    const id = createPool(project, 1);
    const saved = getTrainerPartyPools(project).get(id)!;
    const result = editRosterPool(project, id, (pool) => { pool.size = 3; });
    expect(result.saved).toBe(false);
    expect(rosterPoolProblem(project, id)).toMatch(/party size|candidates/);
    expect(rosterPool(project, id)?.size).toBe(3);
    expect(getTrainerPartyPools(project).get(id)?.size).toBe(saved.size);
    // Adding candidates makes it valid again, and it saves.
    expect(editRosterPool(project, id, (pool) => {
      for (const species of ["Ivysaur", "Bulbasaur"]) {
        const member = structuredClone(pool.members[0]!) as Extract<TrainerPartyPool["members"][number], { pokemon: unknown }>;
        editPoolMemberField(project, member.pokemon, "species_id_0", species);
        pool.members.push(member);
      }
    }).saved).toBe(true);
    expect(getTrainerPartyPools(project).get(id)).toMatchObject({ size: 3 });
    expect(rosterPoolProblem(project, id)).toBeUndefined();
  });

  it("gives a trainer its own copy of a shared pool", () => {
    const project = makeTrainerTestProject();
    const other = addTrainer(project, 1).id;
    const id = createPool(project, 1);
    linkRoster(project, other, trainerPoolSource(id));
    saveRules(project, other, [{ match: "all", conditions: [{ kind: 2, comparison: 5, subject: 0, value: 30 }], choices: [{ rosterId: trainerPoolSource(id), weight: 1 }] }]);
    const copy = copyPoolForTrainer(project, other, id);
    expect(copy).not.toBe(id);
    expect(getTrainerRosterChoices(project, other).map((choice) => choice.rosterId)).toContain(trainerPoolSource(copy));
    expect(getTrainerRosterRules(project, other)[0]!.choices[0]!.rosterId).toBe(trainerPoolSource(copy));
    expect(getTrainerRosterChoices(project, 1).map((choice) => choice.rosterId)).toContain(trainerPoolSource(id));
  });

  it("keeps unfinished rules as a draft until they name a Pokémon", () => {
    const project = makeTrainerTestProject();
    const id = createAlternateParty(project, 1);
    const rule = { match: "all" as const, conditions: [{ kind: 0, comparison: 0, subject: 0, value: 0 }], choices: [{ rosterId: trainerPoolSource(id), weight: 1 }] };
    expect(saveRules(project, 1, [rule]).saved).toBe(false);
    expect(ruleDraft(project, 1)).toBeDefined();
    expect(getTrainerRosterRules(project, 1)).toEqual([]);
    const rules = rosterRules(project, 1);
    rules[0]!.conditions[0]!.subject = 2;
    expect(saveRules(project, 1, rules).saved).toBe(true);
    expect(getTrainerRosterRules(project, 1)[0]!.conditions[0]!.subject).toBe(2);
  });

  it("rolls teams with leads first and aces last", () => {
    const project = makeTrainerTestProject();
    addTrainerPokemon(project, 1);
    updateTrainerPokemonField(project, 1, 1, "species_id_1", "Ivysaur");
    addTrainerPokemon(project, 1);
    updateTrainerPokemonField(project, 1, 2, "species_id_2", "Ivysaur");
    const id = createPool(project, 1);
    editRosterPool(project, id, (pool) => {
      pool.size = 2;
      pool.members[0]!.role = 2;
      pool.members[1]!.role = 1;
    });
    const pool = getTrainerPartyPools(project).get(id)!;
    for (let i = 0; i < 20; i++) {
      const team = rollPoolTeam(project, pool)!;
      expect(team).toEqual([1, 0]);
    }
  });

  it("draws from shared and separate slot groups while enforcing species and item rules across the team", () => {
    const project = makeTrainerTestProject(2);
    const personal = project.narcs.personal!;
    personal.rawFiles.push(personal.rawFiles[2]!.slice());
    ++personal.fileCount;
    project.texts.banks.pokedex!.push("Venusaur");
    const fixed = createAlternateParty(project, 1);
    const id = createPool(project, 1);
    const result = editRosterPool(project, id, (pool) => {
      const original = pool.members[0] as Extract<TrainerPartyPool["members"][number], { pokemon: unknown }>;
      const candidate = (species: number, item: number, groups: number) =>
        ({ role: 0, groups, pokemon: { ...original.pokemon, species, item } });
      pool.size = 3;
      pool.slotGroups = [1, 1, 2];
      pool.speciesRule = 1;
      pool.itemClause = true;
      pool.members = [
        { trainerId: 1, slot: 0, role: 2, groups: 1 },
        candidate(2, 0, 1),
        candidate(1, 0, 3),
        candidate(3, 1, 2),
      ];
    });
    expect(result.saved).toBe(true);
    const bytes = project.fileSystem!.additions![TRAINER_POOLS_PATH]!;
    expect(readU16(bytes, 4)).toBe(4);
    const decoded = decodeTrainerPools(bytes);
    expect(decoded.get(fixed)).toMatchObject({ owner: 1, size: 1 });
    const pool = decoded.get(id)!;
    expect(pool.slotGroups).toEqual([1, 1, 2]);
    expect(pool.fallback.slice(0, 2).sort()).toEqual([1, 2]);
    expect(pool.fallback[2]).toBe(3);

    // Keeping candidate 0 at the front of the shuffle requires backtracking.
    expect(rollPoolTeam(project, pool, () => 0.999)).toEqual([1, 2, 3]);
    expect(rollPoolTeam(project, { ...pool, itemExceptions: [1] }, () => 0.999)).toEqual([0, 1, 3]);
    expect(editRosterPool(project, id, (draft) => { draft.members[2]!.groups = 2; }).saved).toBe(false);
    expect(rosterPoolProblem(project, id)).toMatch(/fill every slot/);
    expect(getTrainerPartyPools(project).get(id)?.slotGroups).toEqual([1, 1, 2]);
  });

  it("shuffles each slot separately when their candidate groups overlap", () => {
    const config = { slotGroups: [1, 2], speciesRule: 1, itemClause: false, itemExceptions: [] };
    const members = [
      { species: 1, form: 0, item: 0, groups: 3 },
      { species: 2, form: 0, item: 0, groups: 1 },
      { species: 3, form: 0, item: 0, groups: 2 },
    ];
    const drawing = (first: number, second: number) => {
      const rolls = [first, second];
      return findSlotPoolTeam(config, members, () => rolls.shift()!);
    };
    expect(drawing(0.999, 0.999)).toEqual([0, 2]);
    expect(drawing(0, 0.999)).toEqual([1, 0]);
    expect(drawing(0, 0)).toEqual([1, 2]);
  });

  it("preserves trainer nicknames when slots are copied, moved, deleted, or used to create an alternate", () => {
    const project = makeTrainerTestProject();
    setTrainerSlotNickname(project, 1, 0, "Éclair");
    expect(() => setTrainerSlotNickname(project, 1, 0, "Elevenchars")).toThrow(/at most 10/);
    expect(() => setTrainerSlotNickname(project, 1, 0, "Bolt 🐾")).toThrow(/DS text/);
    duplicateTrainerPokemon(project, 1, 0);
    setTrainerSlotNickname(project, 1, 1, "Sparky");
    moveTrainerPokemon(project, 1, 0, 1);
    expect(getTrainerSlotNickname(project, 1, 0)).toBe("Sparky");
    expect(getTrainerSlotNickname(project, 1, 1)).toBe("Éclair");
    const clone = addTrainer(project, 1).id;
    expect(getTrainerSlotNickname(project, clone, 1)).toBe("Éclair");
    deleteTrainerPokemon(project, 1, 0);
    expect(getTrainerSlotNickname(project, 1, 0)).toBe("Éclair");
    expect(getTrainerSlotNickname(project, 1, 1)).toBe("");

    const alternate = createAlternateParty(project, 1);
    const pool = createPool(project, 1);
    expect(poolPokemonFromTrainerSlot(project, 1, 0).nickname).toBe("Éclair");
    expect(getTrainerPartyPools(project).get(alternate)?.members[0]).toMatchObject({ pokemon: { nickname: "Éclair" } });
    expect(editRosterPool(project, pool, (draft) => {
      const member = draft.members[0];
      if (member && "pokemon" in member) member.pokemon.nickname = "Seed";
    }).saved).toBe(true);
    setTrainerSlotNickname(project, 1, 0, "");
    expect(getTrainerSlotNickname(project, 1, 0)).toBe("");
    expect(getTrainerPartyPools(project).get(pool)?.members[0]).toMatchObject({ pokemon: { nickname: "Seed" } });
    expect(getTrainerPartyPools(project).get(alternate)?.members[0]).toMatchObject({ pokemon: { nickname: "Éclair" } });
    editRosterPool(project, pool, (draft) => {
      const member = draft.members[0];
      if (member && "pokemon" in member) delete member.pokemon.nickname;
    });
    expect(getTrainerPartyPools(project).get(pool)?.members[0]).not.toHaveProperty("pokemon.nickname");
  });

  it("works out maximum and starting HP like the battle does", () => {
    const project = makeTrainerTestProject();
    // The fixture's species has base HP 45 (see trainerTestProject).
    expect(trainerMaxHp(project, 1, 0, 50, 255)).toBe(Math.floor(((2 * 45 + 31) * 50) / 100) + 60);
    expect(trainerStartingHp(120, 1, 1)).toBe(1);
    expect(trainerStartingHp(120, 1, 50)).toBe(60);
    expect(trainerStartingHp(120, 2, 500)).toBe(120);
    expect(trainerStartingHp(120, 0, 0)).toBe(120);
  });
});
