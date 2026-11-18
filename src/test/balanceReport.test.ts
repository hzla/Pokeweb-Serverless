import { describe, expect, it } from "vitest";
import { createBalanceEvolutionPlanner } from "../pokeweb/balanceEvolution";
import { balanceGeneration, gen5BalanceData, reliableBalanceWin, type BalanceMove, type BalancePokemon } from "../pokeweb/balanceMatchup";
import { buildBalanceReport, suggestedBalanceTables } from "../pokeweb/balanceReportModel";
import { getEncounterRollAreas } from "../pokeweb/encounterRollModel";
import { setPokemonEvolutions, setPokemonLearnset } from "../pokeweb/pokemonModel";
import { decodeRecord, type NarcStore, type ProjectState, type RawRecord } from "../pokeweb/projectStore";
import { duplicateTrainerPokemon, updateTrainerPokemonField } from "../pokeweb/trainerModel";
import { makeTrainerTestProject } from "./trainerTestProject";

const attack = (mechanics: string, overrides: Partial<BalanceMove> = {}): BalanceMove => ({
  name: mechanics, mechanics, data: {}, accurate: true, pp: 20, minHits: 1, maxHits: 1, ...overrides,
});

function fighter(overrides: Partial<BalancePokemon> = {}): BalancePokemon {
  return {
    name: "Training Pokémon", level: 15, iv: 15, nature: "Hardy", ability: "",
    species: { types: ["Normal"], baseStats: { hp: 60, atk: 60, def: 60, spa: 60, spd: 60, spe: 60 }, weightkg: 10 },
    moves: [attack("Dragon Rage")],
    ...overrides,
  };
}

function reportRows(project: ProjectState, name: NarcStore["name"], rows: RawRecord[]) {
  const format = project.formats[name]!.filter(([, key]) => name !== "encounters" || key.startsWith("spring_"));
  project.narcs[name] = {
    name, fileId: 10, sourcePath: "test", fileCount: rows.length, records: new Map(), dirty: new Set(),
    rawFiles: rows.map((row) => Uint8Array.from(format.flatMap(([size, key]) => Array.from(
      { length: size }, (_, byte) => ((row[key] ?? 0) >>> (8 * byte)) & 0xff,
    )))),
  };
}

describe("balance report damage races", () => {
  it("gives tied speed to the boss, and compares actual priority brackets before speed", () => {
    const regular = fighter();
    expect(reliableBalanceWin(gen5BalanceData, regular, regular)).toBeUndefined();
    const priority = fighter({ moves: [attack("Dragon Rage", { data: { priority: 1 } })] });
    expect(reliableBalanceWin(gen5BalanceData, priority, fighter({ item: "Quick Claw" }))).toMatchObject({ turns: 2 });
    const higherPriority = fighter({ moves: [attack("Dragon Rage", { data: { priority: 2 } })] });
    expect(reliableBalanceWin(gen5BalanceData, priority, higherPriority)).toBeUndefined();
  });

  it("checks a slower boss using a strong hit and then finishing with priority", () => {
    const player = fighter();
    const slower = { ...player.species, baseStats: { ...player.species.baseStats, spe: 20 } };
    const strong = attack("Dragon Rage");
    const priority = attack("Sonic Boom", { data: { priority: 1 } });
    expect(reliableBalanceWin(gen5BalanceData, player, fighter({ species: slower, moves: [strong] }))).toBeDefined();
    expect(reliableBalanceWin(gen5BalanceData, player, fighter({ species: slower, moves: [priority] }))).toBeDefined();
    expect(reliableBalanceWin(gen5BalanceData, player, fighter({ species: slower, moves: [strong, priority] }))).toBeUndefined();
  });

  it("handles exact damage, immunities and a boss surviving an opening KO with Sturdy or Focus Sash", () => {
    const player = fighter({ level: 30, moves: [attack("Sonic Boom", { data: { priority: 1 } })] });
    const boss = fighter({ level: 3, moves: [attack("Dragon Rage")] });
    expect(reliableBalanceWin(gen5BalanceData, player, boss)).toMatchObject({ turns: 1, hpPercent: 100 });
    expect(reliableBalanceWin(gen5BalanceData, player, { ...boss, item: "Focus Sash" })).toMatchObject({ turns: 2 });
    expect(reliableBalanceWin(gen5BalanceData, player, { ...boss, ability: "Sturdy" })).toMatchObject({ turns: 2 });
    expect(reliableBalanceWin(gen5BalanceData, player, { ...boss, species: { ...boss.species, types: ["Ghost"] } })).toBeUndefined();
  });

  it("uses the lower hit count for the player and only recommends attacks that can hit reliably", () => {
    const boss = fighter({ level: 3, item: "Focus Sash", moves: [] });
    const player = fighter({ level: 30, moves: [
      attack("Tackle", { accurate: false }),
      attack("Double Slap", { minHits: 2, maxHits: 5 }),
    ] });
    expect(reliableBalanceWin(gen5BalanceData, player, boss)).toMatchObject({ move: "Double Slap", turns: 1 });
    expect(reliableBalanceWin(gen5BalanceData, { ...player, moves: [player.moves[0]] }, boss)).toBeUndefined();
  });

  it("applies the project's type effectiveness to the calculation", () => {
    const player = fighter({ level: 30, moves: [attack("Tackle")] });
    const boss = fighter({ level: 3, moves: [] });
    expect(reliableBalanceWin(gen5BalanceData, player, boss)).toBeDefined();
    const gen = balanceGeneration(new Map([["Normal", { Normal: 0 }]]));
    expect(reliableBalanceWin(gen, player, boss)).toBeUndefined();
  });
});

describe("balance report project data", () => {
  it("uses the highest boss level for every slot and reports catches only from confirmed tables", async () => {
    const project = makeTrainerTestProject();
    const fixtures: Array<[NarcStore["name"], RawRecord[]]> = [
      ["evolutions", [{}, {}, {}]],
      ["moves", [{}, { category: 1, type: 0, power: 50, pp: 35, accuracy: 100 }, { category: 0, type: 0 }]],
      ["encounters", [{
        spring_grass_rate: 20,
        spring_grass_slot_0: 2, spring_grass_slot_0_min_level: 2, spring_grass_slot_0_max_level: 3,
        spring_grass_slot_1: 2, spring_grass_slot_1_min_level: 4, spring_grass_slot_1_max_level: 5,
        spring_grass_slot_2: 1, spring_grass_slot_2_min_level: 20, spring_grass_slot_2_max_level: 25,
        spring_surf_rate: 20,
        spring_surf_slot_0: 1, spring_surf_slot_0_min_level: 2, spring_surf_slot_0_max_level: 3,
      }]],
    ];
    for (const [name, rows] of fixtures) reportRows(project, name, rows);
    project.headers = { count: 1, rows: { 1: { index: 0, location_name: "Test Route", encounter_id: 0 } } };
    project.texts.banks.moves![2] = "Growl";
    for (const id of [1, 2]) {
      const personal = decodeRecord(project, "personal", id).raw!;
      Object.assign(personal, { base_hp: 60, base_atk: 100, base_def: 40, base_spatk: 40, base_spdef: 40, base_speed: 60 });
    }
    const wildLearnset = decodeRecord(project, "learnsets", 2).raw!;
    wildLearnset.move_id_0 = 1;
    wildLearnset.lvl_learned_0 = 15;
    const ace = duplicateTrainerPokemon(project, 1, 0);
    updateTrainerPokemonField(project, 1, ace.slot, `level_${ace.slot}`, "15");

    const areas = getEncounterRollAreas(project);
    expect(suggestedBalanceTables(areas, 15)).toEqual(["spring", "summer", "fall", "winter"].map((season) => `0:${season}:surf`));
    const report = await buildBalanceReport(project, 1, ["0:spring:grass"]);
    expect(report.playerLevel).toBe(15);
    expect(report.slots.map(({ level }) => level)).toEqual([5, 15]);
    expect(report.candidates).toBe(1);
    expect(report.slots[0].ignoredMoves).toEqual(["Growl"]);
    expect(report.slots[0].answers[0]).toMatchObject({
      species: "Ivysaur", move: "Tackle",
      catches: [{ area: "#0 · Test Route", table: "Spring · Grass", levels: ["2–3", "4–5"], weight: 40 }],
    });
    updateTrainerPokemonField(project, 1, ace.slot, `level_${ace.slot}`, "14");
    const revisedReport = await buildBalanceReport(project, 1, ["0:spring:grass"]);
    expect(revisedReport.playerLevel).toBe(14);
    expect(revisedReport.slots.every(({ answers }) => answers.length === 0)).toBe(true);
    await expect(buildBalanceReport(project, 1, ["9:winter:grass"])).rejects.toThrow("Confirm the available encounter tables");
  });

  it("uses a move learned at the cap to evolve and keeps the actual catch source for inherited attacks", async () => {
    const project = makeTrainerTestProject();
    reportRows(project, "moves", [{}, { category: 1, type: 0, power: 50, pp: 35, accuracy: 100 }, { category: 0 }]);
    reportRows(project, "encounters", [{
      spring_grass_rate: 20,
      spring_grass_slot_0: 2, spring_grass_slot_0_min_level: 13, spring_grass_slot_0_max_level: 15,
    }]);
    reportRows(project, "evolutions", [{}, {}, {}]);
    project.headers = { count: 1, rows: { 1: { index: 0, location_name: "Test Route", encounter_id: 0 } } };
    project.texts.banks.moves![2] = "Growl";
    for (const id of [1, 2]) {
      Object.assign(decodeRecord(project, "personal", id).raw!, {
        base_hp: 60, base_atk: 100, base_def: 40, base_spatk: 40, base_spdef: 40, base_speed: 60,
      });
    }
    setPokemonLearnset(project, 1, [{ moveId: 2, level: 1 }]);
    setPokemonLearnset(project, 2, [{ moveId: 1, level: 15 }]);
    setPokemonEvolutions(project, 2, [{ method: 21, param: 1, target: 1 }]);
    updateTrainerPokemonField(project, 1, 0, "level_0", "15");
    const report = await buildBalanceReport(project, 1, ["0:spring:grass"]);
    expect(report.candidates).toBe(2);
    expect(report.slots[0].answers.find(({ species }) => species === "Bulbasaur")).toMatchObject({
      move: "Tackle",
      catches: [{ caughtAs: "Ivysaur", area: "#0 · Test Route", levels: ["13–14"], weight: 20 }],
    });
    expect(report.slots[0].answers.find(({ species }) => species === "Ivysaur")?.catches[0].levels).toEqual(["15"]);

    setPokemonEvolutions(project, 2, [{ method: 8, param: 1, target: 1 }]);
    const withoutItem = await buildBalanceReport(project, 1, ["0:spring:grass"]);
    expect(withoutItem.slots[0].answers.every(({ species }) => species === "Ivysaur")).toBe(true);
    const withItem = await buildBalanceReport(project, 1, ["0:spring:grass"], { itemIds: [1] });
    expect(withItem.slots[0].answers[0]).toMatchObject({
      species: "Bulbasaur", move: "Tackle", catches: [{ caughtAs: "Ivysaur", levels: ["13–15"] }],
    });
  });
});

describe("balance report evolution timing", () => {
  it("requires another level for each level-up evolution and uses the learnset of the current stage", () => {
    const project = makeTrainerTestProject();
    reportRows(project, "evolutions", [{}, {}, {}, {}]);
    for (const name of ["personal", "learnsets"] as const) {
      const store = project.narcs[name]!;
      store.rawFiles.push(store.rawFiles[2].slice());
      store.fileCount = store.rawFiles.length;
    }
    project.texts.banks.pokedex!.push("Venusaur");
    setPokemonEvolutions(project, 1, [{ method: 4, param: 10, target: 2 }]);
    setPokemonEvolutions(project, 2, [{ method: 21, param: 2, target: 3 }]);
    setPokemonLearnset(project, 1, [{ moveId: 1, level: 1 }]);
    setPokemonLearnset(project, 2, [{ moveId: 2, level: 10 }]);
    setPokemonLearnset(project, 3, [{ moveId: 3, level: 9 }, { moveId: 4, level: 11 }]);
    expect(createBalanceEvolutionPlanner(project, 9, {})(1, 0, 5)).toEqual([{ speciesId: 1, form: 0, moves: new Set([1]) }]);
    expect(createBalanceEvolutionPlanner(project, 10, {})(1, 0, 5)).toEqual([{ speciesId: 2, form: 0, moves: new Set([1, 2]) }]);
    expect(createBalanceEvolutionPlanner(project, 11, {})(1, 0, 5)).toEqual([{ speciesId: 3, form: 0, moves: new Set([1, 2, 4]) }]);
  });

  it("requires selected held items and checks whether a trade or level-up is possible", () => {
    const project = makeTrainerTestProject();
    reportRows(project, "evolutions", [{}, {}, {}]);
    setPokemonEvolutions(project, 1, [{ method: 20, param: 1, target: 2 }]);
    expect(createBalanceEvolutionPlanner(project, 13, {})(1, 0, 12)[0].speciesId).toBe(1);
    expect(createBalanceEvolutionPlanner(project, 13, { itemIds: [1] })(1, 0, 13)[0].speciesId).toBe(1);
    expect(createBalanceEvolutionPlanner(project, 13, { itemIds: [1] })(1, 0, 12)[0].speciesId).toBe(2);
    setPokemonEvolutions(project, 1, [{ method: 6, param: 1, target: 2 }]);
    expect(createBalanceEvolutionPlanner(project, 13, { itemIds: [1] })(1, 0, 12)[0].speciesId).toBe(1);
    expect(createBalanceEvolutionPlanner(project, 13, { allowTrading: true })(1, 0, 12)[0].speciesId).toBe(1);
    expect(createBalanceEvolutionPlanner(project, 13, { itemIds: [1], allowTrading: true })(1, 0, 13)[0].speciesId).toBe(2);
  });
});
