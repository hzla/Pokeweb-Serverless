import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { AUTO_ENCOUNTER_TABLE_KEY, encounterRollSelectionsForLevel, getEncounterRollAreas, parseEncounterRollStatics, rollEncounterSelections } from "../pokeweb/encounterRollModel";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { readGen5SavePokemon } from "../pokeweb/gen5SaveReader";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { decryptPk5Party, encryptPk5Party, normalizeTestBattleSavePartyNicknames, parseShowdownTeam, patchTestBattleSavePlayerFirstPokemon, patchTestBattleSavePlayerParty } from "../pokeweb/testBattleTeam";
import { evolvePokemonForLevel, evolvePokemonForLevelTargets, forceFinalPokemonEvolution, forceFinalPokemonEvolutions, getEvolutionItems, replaceShowdownPokemonSpecies } from "../pokeweb/testTeamEvolution";

describe("testBattleTeam", () => {
  it("parses Showdown imports with defaults and name resolution", () => {
    const project = makeProject();
    const team = parseShowdownTeam(
      project,
      `
Bulby (Bulbasaur) (M) @ Potion
Ability: Chlorophyll
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
IVs: 0 SpA
Jolly Nature
- Tackle
- Vine Whip

Ivysaur
- Razor Leaf
`,
    );

    expect(team).toHaveLength(2);
    expect(team[0]).toMatchObject({
      speciesId: 1,
      itemId: 1,
      abilitySlot: 2,
      abilityId: 2,
      level: 50,
      nature: 13,
      gender: 0,
      moves: [1, 2],
    });
    expect(team[0]?.evs).toMatchObject({ hp: 4, atk: 252, spe: 252, spa: 0 });
    expect(team[0]?.ivs).toMatchObject({ hp: 31, atk: 31, spa: 0 });
    expect(team[1]).toMatchObject({ speciesId: 2, itemId: 0, abilitySlot: 1, level: 100, nature: 0 });
  });

  it("throws for unknown specified names", () => {
    const project = makeProject();
    expect(() => parseShowdownTeam(project, "Bulbasaur\n- Fake Move")).toThrow(/Unknown move: Fake Move/u);
    expect(() => parseShowdownTeam(project, "Bulbasaur\nAbility: Fake Ability")).toThrow(/Unknown ability: Fake Ability/u);
    expect(() => parseShowdownTeam(project, "Missingno")).toThrow(/Unknown Pokemon: Missingno/u);
    expect(() => parseShowdownTeam(makeProjectWithBulbasaurForm(), "Bulbasaur^2")).toThrow(/Form 2 is out of range/u);
  });

  it("accepts Species^formIndex alongside standard Showdown headers", () => {
    const project = makeProjectWithBulbasaurForm();
    const team = parseShowdownTeam(
      project,
      `
Bulbasaur^0

Bulby (Bulbasaur^1) (F) @ Potion
Level: 50
- Tackle
`,
    );

    expect(team[0]).toMatchObject({
      speciesId: 1,
      personalId: 1,
      formIndex: 0,
      speciesName: "Bulbasaur",
      abilityId: 1,
    });
    expect(team[1]).toMatchObject({
      speciesId: 1,
      personalId: 650,
      formIndex: 1,
      speciesName: "Bulbasaur",
      abilityId: 4,
      gender: 1,
      itemId: 1,
      level: 50,
      moves: [1],
    });
  });

  it("allows abilities outside the species personal ability slots", () => {
    const project = makeProject();
    const [named] = parseShowdownTeam(project, "Bulbasaur\nAbility: Huge Power");
    const [numeric] = parseShowdownTeam(project, "Bulbasaur\nAbility: 42");

    expect(named).toMatchObject({ abilitySlot: 1, abilityId: 4 });
    expect(numeric).toMatchObject({ abilitySlot: 1, abilityId: 42 });
  });

  it("roundtrips PK5 party encryption", () => {
    const decrypted = new Uint8Array(220);
    writeLe32(decrypted, 0, 0x12345678);
    writeLe16(decrypted, 0x08, 1);
    writeLe16(decrypted, 0x0a, 1);
    writeLe32(decrypted, 0x10, 125000);
    decrypted[0x15] = 1;
    decrypted[0x41] = 13;
    writeLe16(decrypted, 0x90, 121);

    const encrypted = encryptPk5Party(decrypted);
    const roundtrip = decryptPk5Party(encrypted);

    expect(readLe32(roundtrip, 0)).toBe(0x12345678);
    expect(readLe16(roundtrip, 0x08)).toBe(1);
    expect(readLe16(roundtrip, 0x0a)).toBe(1);
    expect(readLe32(roundtrip, 0x10)).toBe(125000);
    expect(readLe16(roundtrip, 0x90)).toBe(121);
    expect(encryptPk5Party(roundtrip)).toEqual(encrypted);
  });

  it("writes a Showdown team into both BW2 save party halves with live stats and checksums", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();

    const patched = patchTestBattleSavePlayerParty(
      save,
      project,
      `
Bulby (Bulbasaur) @ Potion
Ability: Chlorophyll
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
IVs: 0 SpA
Jolly Nature
- Tackle
- Vine Whip
`,
    );

    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      expect(patched[party]).toBe(1);
      expect(patched[party + 4]).toBe(1);
      expect(readLe16(patched, half + 0x19336)).toBe(crc16Ccitt(patched.subarray(party, party + 0x534)));
      expect(readLe16(patched, half + 0x25f34)).toBe(readLe16(patched, half + 0x19336));
      expect(readLe16(patched, half + 0x25fa2)).toBe(crc16Ccitt(patched.subarray(half + 0x25f00, half + 0x25f00 + 0x94)));

      const first = decryptPk5Party(patched.subarray(party + 8, party + 8 + 220));
      expect(readLe16(first, 0x08)).toBe(1);
      expect(readLe16(first, 0x0a)).toBe(1);
      expect(readLe32(first, 0x0c)).toBe(0x9abc5678);
      expect(first[0x17]).toBe(2);
      expect(first[0x15]).toBe(2);
      expect(first[0x41]).toBe(13);
      expect(first[0x5f]).toBe(22);
      expect(readLe32(first, 0x38) >>> 31).toBe(0);
      expect(readGen5String(first, 0x48, 22)).toBe("Bulbasaur");
      expect([...first.subarray(0x68, 0x78)]).toEqual([...patched.subarray(half + 0x19404, half + 0x19414)]);
      expect(first[0x84] >> 7).toBe(1);
      expect(readLe16(first, 0x28)).toBe(1);
      expect(readLe16(first, 0x2a)).toBe(2);
      expect(first[0x30]).toBe(35);
      expect(first[0x31]).toBe(10);
      expect(first[0x8c]).toBe(50);
      expect(readLe16(first, 0x8e)).toBe(121);
      expect(readLe16(first, 0x90)).toBe(121);
      expect(readLe16(first, 0x92)).toBe(101);
      expect(readLe16(first, 0x94)).toBe(69);
      expect(readLe16(first, 0x96)).toBe(106);
      expect(readLe16(first, 0x98)).toBe(63);
      expect(readLe16(first, 0x9a)).toBe(85);

      const second = decryptPk5Party(patched.subarray(party + 8 + 220, party + 8 + 440));
      expect(readLe16(second, 0x08)).toBe(0);
    }
  });

  it("writes BW party checksums using the BW checksum table layout", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty(0x24000);

    const patched = patchTestBattleSavePlayerParty(save, project, "Bulbasaur\n- Tackle", "BW");

    for (const half of [0, 0x24000]) {
      const party = half + 0x18e00;
      expect(patched[party]).toBe(1);
      expect(patched[party + 4]).toBe(1);
      expect(readLe16(patched, half + 0x19336)).toBe(crc16Ccitt(patched.subarray(party, party + 0x534)));
      expect(readLe16(patched, half + 0x23f34)).toBe(readLe16(patched, half + 0x19336));
      expect(readLe16(patched, half + 0x23f9a)).toBe(crc16Ccitt(patched.subarray(half + 0x23f00, half + 0x23f00 + 0x8c)));
    }
  });

  it("writes the selected added form and calculates stats from its personal record", () => {
    const project = makeProjectWithBulbasaurForm();
    const patched = patchTestBattleSavePlayerParty(
      makeSaveWithTemplateParty(),
      project,
      `
Bulby (Bulbasaur^1) (F)
Level: 50
- Tackle
`,
    );
    const party = 0x18e00;
    const first = decryptPk5Party(patched.subarray(party + 8, party + 8 + 220));

    expect(readLe16(first, 0x08)).toBe(1);
    expect((first[0x40] >>> 3) & 0x1f).toBe(1);
    expect((first[0x40] >>> 1) & 0x03).toBe(1);
    expect(first[0x15]).toBe(4);
    expect(readGen5String(first, 0x48, 22)).toBe("Bulbasaur");
    expect(readLe16(first, 0x8e)).toBe(175);
    expect(readLe16(first, 0x90)).toBe(175);
  });

  it("replaces only the first party Pokemon and preserves the rest of the party", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();
    const secondSlots = new Map<number, Uint8Array>();
    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      save[party] = 2;
      save[party + 4] = 2;
      save.set(makeTemplatePokemon(), party + 8 + 220);
      secondSlots.set(half, save.slice(party + 8 + 220, party + 8 + 440));
    }

    const patched = patchTestBattleSavePlayerFirstPokemon(
      save,
      project,
      `
Ivysaur
Level: 50
- Razor Leaf
`,
    );

    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      expect(patched[party]).toBe(2);
      expect(patched[party + 4]).toBe(2);
      expect(readLe16(patched, half + 0x19336)).toBe(crc16Ccitt(patched.subarray(party, party + 0x534)));
      expect(readLe16(patched, half + 0x25f34)).toBe(readLe16(patched, half + 0x19336));
      expect(readLe16(patched, half + 0x25fa2)).toBe(crc16Ccitt(patched.subarray(half + 0x25f00, half + 0x25f00 + 0x94)));

      const first = decryptPk5Party(patched.subarray(party + 8, party + 8 + 220));
      expect(readLe16(first, 0x08)).toBe(2);
      expect(readGen5String(first, 0x48, 22)).toBe("Ivysaur");
      expect(first[0x8c]).toBe(50);
      expect(readLe16(first, 0x28)).toBe(3);
      expect(first[0x30]).toBe(25);
      expect(patched.slice(party + 8 + 220, party + 8 + 440)).toEqual(secondSlots.get(half));
    }
  });

  it("normalizes existing save party Pokemon to species names without nickname flags", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();

    const normalized = normalizeTestBattleSavePartyNicknames(save, project);

    expect(normalized).not.toBe(save);
    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      expect(readLe16(normalized, half + 0x19336)).toBe(crc16Ccitt(normalized.subarray(party, party + 0x534)));
      expect(readLe16(normalized, half + 0x25f34)).toBe(readLe16(normalized, half + 0x19336));
      expect(readLe16(normalized, half + 0x25fa2)).toBe(crc16Ccitt(normalized.subarray(half + 0x25f00, half + 0x25f00 + 0x94)));

      const first = decryptPk5Party(normalized.subarray(party + 8, party + 8 + 220));
      expect(readLe32(first, 0x38) >>> 31).toBe(0);
      expect(readGen5String(first, 0x48, 22)).toBe("Bulbasaur");
    }
  });

  it("keeps the save unchanged for an empty import", () => {
    const project = makeProject();
    const save = makeSaveWithTemplateParty();
    expect(patchTestBattleSavePlayerParty(save, project, " \n")).toEqual(save);
  });

  it("reads party and PC Pokemon from a Gen 5 save as Showdown sets", () => {
    const project = makeProject();
    const save = new Uint8Array(0x80000);
    const decrypted = new Uint8Array(220);
    writeLe32(decrypted, 0, 0x12345678);
    writeLe16(decrypted, 0x08, 1);
    writeLe16(decrypted, 0x0a, 1);
    writeLe32(decrypted, 0x10, 117360);
    decrypted[0x15] = 2;
    decrypted[0x18] = 4;
    decrypted[0x19] = 252;
    decrypted[0x1b] = 252;
    writeLe16(decrypted, 0x28, 1);
    writeLe16(decrypted, 0x2a, 2);
    writeLe32(decrypted, 0x38, 31 | (31 << 5) | (31 << 10) | (31 << 15) | (31 << 20) | (31 << 25));
    decrypted[0x40] = 0;
    decrypted[0x41] = 13;
    decrypted[0x8c] = 50;
    writeGen5String(decrypted, 0x48, 22, "Bulby");
    const encrypted = encryptPk5Party(decrypted);

    save[0x18e04] = 1;
    save.set(encrypted, 0x18e08);
    save.set(encrypted.subarray(0, 136), 0x400);

    const pokemon = readGen5SavePokemon(project, save);
    expect(pokemon).toHaveLength(2);
    expect(pokemon[0]).toMatchObject({
      speciesId: 1,
      speciesName: "Bulbasaur",
      nickname: "Bulby",
      itemName: "Potion",
      abilityName: "Chlorophyll",
      level: 50,
      nature: "Jolly",
      gender: "M",
      moveNames: ["Tackle", "Vine Whip"],
      storage: "party",
      partySlot: 0,
    });
    expect(pokemon[1]).toMatchObject({ storage: "box", box: 0, boxSlot: 0, level: 50 });
    expect(pokemon[0]?.showdownText).toContain("Bulby (Bulbasaur) (M) @ Potion");
    expect(pokemon[0]?.showdownText).toContain("EVs: 4 HP / 252 Atk");
    expect(parseShowdownTeam(project, pokemon[0]?.showdownText ?? "")[0]).toMatchObject({
      speciesId: 1,
      itemId: 1,
      abilityId: 2,
      level: 50,
      nature: 13,
      moves: [1, 2],
    });
  });

  it("rejects files that are too small to contain a Gen 5 save", () => {
    expect(() => readGen5SavePokemon(makeProject(), new Uint8Array(1024))).toThrow(/too small/u);
  });

  it("auto-fills encounter areas under a level cap and rolls in area order with dupe rerolls", () => {
    const project = makeProjectWithEncounters();
    const areas = getEncounterRollAreas(project);
    const selections = encounterRollSelectionsForLevel(areas, 10);

    expect(selections.map((selection) => selection.encounterId)).toEqual([0, 1]);
    const results = rollEncounterSelections(project, selections, () => 0);
    expect(results.map((result) => result.speciesId)).toEqual([1, 2]);
    expect(results.map((result) => result.level)).toEqual([4, 9]);
    expect(results[0]).toMatchObject({ tableChancePercent: 20, effectiveChancePercent: 20 });
    expect(results[1]).toMatchObject({ tableChancePercent: 80, effectiveChancePercent: 100 });
    expect(results[0]?.showdownText).toContain("Bulbasaur\nLevel: 4");
    expect(results[1]?.showdownText).toContain("Ivysaur\nLevel: 9");
  });

  it("uses encounter-slot weights when rolling an area", () => {
    const project = makeProjectWithEncounters();
    const [area] = getEncounterRollAreas(project);
    const randomValues = [0.25, 0];
    const [result] = rollEncounterSelections(
      project,
      [{ encounterId: area.encounterId, tableKey: area.defaultTableKey }],
      () => randomValues.shift() ?? 0,
    );

    expect(result?.speciesId).toBe(2);
    expect(result).toMatchObject({ tableChancePercent: 80, effectiveChancePercent: 80 });
  });

  it("chooses one automatic table per area using the configured method percentages", () => {
    const project = makeProjectWithEncounters();
    const [area] = getEncounterRollAreas(project);
    const selection = [{ encounterId: area.encounterId, tableKey: AUTO_ENCOUNTER_TABLE_KEY }];

    const [fishing] = rollEncounterSelections(project, selection, () => 0, {
      fishingPercent: 100,
      surfPercent: 0,
      grassDoublesPercent: 0,
      maxLevel: 20,
    });
    const [surf] = rollEncounterSelections(project, selection, () => 0, {
      fishingPercent: 0,
      surfPercent: 100,
      grassDoublesPercent: 0,
      maxLevel: 20,
    });
    const [doubles] = rollEncounterSelections(project, selection, () => 0, {
      fishingPercent: 0,
      surfPercent: 0,
      grassDoublesPercent: 100,
      maxLevel: 20,
    });

    expect(fishing).toMatchObject({ tableLabel: "Spring · Super Rod", level: 20 });
    expect(surf).toMatchObject({ tableLabel: "Spring · Surf", level: 20 });
    expect(doubles).toMatchObject({ tableLabel: "Spring · Grass Doubles", level: 20 });
    expect(fishing?.showdownText).toContain("Level: 20");
  });

  it("removes over-level automatic tables and never rolls an area more than once", () => {
    const project = makeProjectWithEncounters();
    const [area] = getEncounterRollAreas(project);
    const selection = { encounterId: area.encounterId, tableKey: AUTO_ENCOUNTER_TABLE_KEY };
    const results = rollEncounterSelections(project, [selection, selection], () => 0, {
      fishingPercent: 100,
      surfPercent: 0,
      grassDoublesPercent: 0,
      maxLevel: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ tableLabel: "Spring · Grass", level: 10 });
  });

  it("rejects automatic table percentages totaling over 100", () => {
    const project = makeProjectWithEncounters();
    const [area] = getEncounterRollAreas(project);
    expect(() => rollEncounterSelections(
      project,
      [{ encounterId: area.encounterId, tableKey: AUTO_ENCOUNTER_TABLE_KEY }],
      () => 0,
      { fishingPercent: 50, surfPercent: 40, grassDoublesPercent: 20 },
    )).toThrow(/cannot total more than 100%/u);
  });

  it("uses the latest eligible level evolution at the auto-fill level", () => {
    const project = makeProjectWithEncounters();
    addEvolutionStore(project, 4, 5, 2);
    const [area] = getEncounterRollAreas(project);
    const [result] = rollEncounterSelections(
      project,
      [{ encounterId: area.encounterId, tableKey: area.defaultTableKey }],
      () => 0,
      { fishingPercent: 0, surfPercent: 0, grassDoublesPercent: 0, maxLevel: 10 },
    );

    expect(result).toMatchObject({ speciesId: 2, speciesName: "Ivysaur", level: 10 });
    expect(result?.showdownText).toContain("Ivysaur\nLevel: 10");
  });

  it("force evolves other methods while preserving the rest of the Showdown set", () => {
    const project = makeProject();
    addEvolutionStore(project, 8, 1, 2);
    const evolved = forceFinalPokemonEvolution(project, 1, 0);
    const original = `Bulby (Bulbasaur) (M) @ Potion
Ability: Chlorophyll
Level: 12
Timid Nature
- Tackle`;
    const updated = replaceShowdownPokemonSpecies(original, evolved.speciesName, evolved.formIndex);

    expect(evolved).toMatchObject({ speciesId: 2, formIndex: 0, speciesName: "Ivysaur" });
    expect(updated).toContain("Bulby (Ivysaur) (M) @ Potion");
    expect(updated).toContain("Ability: Chlorophyll\nLevel: 12\nTimid Nature\n- Tackle");
    expect(parseShowdownTeam(project, updated)[0]).toMatchObject({ speciesId: 2, level: 12, moves: [1] });
  });

  it("discovers evolution items from evolution records and applies checked items", () => {
    const project = makeProject();
    addEvolutionStore(project, 8, 1, 2);

    expect(getEvolutionItems(project)).toEqual([{ itemId: 1, itemName: "Potion" }]);
    expect(evolvePokemonForLevel(project, 1, 0, 10)).toMatchObject({ speciesId: 1 });
    expect(evolvePokemonForLevel(project, 1, 0, 10, new Set([1]))).toMatchObject({ speciesId: 2, speciesName: "Ivysaur" });
  });

  it("adds every eligible target for branching evolutions after only one area roll", () => {
    const project = makeProjectWithEncounters();
    addBranchingEvolutionStore(project, 8, 1, [2, 3]);
    const [area] = getEncounterRollAreas(project);
    const targets = evolvePokemonForLevelTargets(project, 1, 0, 10, new Set([1]));
    const forcedTargets = forceFinalPokemonEvolutions(project, 1, 0);
    const results = rollEncounterSelections(
      project,
      [{ encounterId: area.encounterId, tableKey: area.defaultTableKey }],
      () => 0,
      {
        fishingPercent: 0,
        surfPercent: 0,
        grassDoublesPercent: 0,
        maxLevel: 10,
        obtainedEvolutionItemIds: [1],
      },
    );

    expect(targets.map((target) => target.speciesId)).toEqual([2, 3]);
    expect(forcedTargets.map((target) => target.speciesId)).toEqual([2, 3]);
    expect(results.map((result) => result.speciesId)).toEqual([2, 3]);
    expect(new Set(results.map((result) => result.encounterId))).toEqual(new Set([area.encounterId]));
  });

  it("parses persistent static encounters as complete Showdown sets", () => {
    const project = makeProject();
    const text = `Bulby (Bulbasaur) @ Potion
Ability: Chlorophyll
Level: 12
IVs: 0 Atk / 31 SpA / 31 Spe
Timid Nature
- Tackle
- Vine Whip

Ivysaur
Level: 15
Jolly Nature
- Razor Leaf`;
    const statics = parseEncounterRollStatics(project, text);

    expect(statics).toHaveLength(2);
    expect(statics[0]).toMatchObject({ speciesId: 1, formIndex: 0, speciesName: "Bulbasaur", level: 12 });
    expect(statics[0]?.showdownText).toBe(text.split("\n\n")[0]);
    expect(parseShowdownTeam(project, statics[0]?.showdownText ?? "")[0]).toMatchObject({
      speciesId: 1,
      itemId: 1,
      abilityId: 2,
      level: 12,
      nature: 10,
      ivs: { atk: 0, spa: 31, spe: 31 },
      moves: [1, 2],
    });
    expect(statics[1]).toMatchObject({ speciesId: 2, level: 15 });
  });

  it("rolls a random nature and independent IVs for each encounter", () => {
    const project = makeProjectWithEncounters();
    const [area] = getEncounterRollAreas(project);
    const randomValues = [0, 0.999, 0.52, 0, 0.999, 0.5, 0.25, 0.75, 0.1];
    const [result] = rollEncounterSelections(
      project,
      [{ encounterId: area.encounterId, tableKey: area.defaultTableKey }],
      () => randomValues.shift() ?? 0,
    );

    expect(result).toMatchObject({
      nature: "Jolly",
      ivs: { hp: 0, atk: 31, def: 16, spa: 8, spd: 24, spe: 3 },
    });
    expect(result?.showdownText).toContain("Jolly Nature");
    expect(result?.showdownText).toContain("IVs: 0 HP / 31 Atk / 16 Def / 8 SpA / 24 SpD / 3 Spe");
    expect(parseShowdownTeam(project, result?.showdownText ?? "")[0]).toMatchObject({
      nature: 13,
      ivs: { hp: 0, atk: 31, def: 16, spa: 8, spd: 24, spe: 3 },
    });
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, moves: 2, items: 3 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", [
        new Uint8Array(personalRowLength(formats.personal!)),
        packRows(formats.personal!, [{ base_hp: 45, base_atk: 49, base_def: 49, base_speed: 45, base_spatk: 65, base_spdef: 65, exp_rate: 3, base_happy: 70, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 }]),
        packRows(formats.personal!, [{ base_hp: 60, base_atk: 62, base_def: 63, base_speed: 60, base_spatk: 80, base_spdef: 80, exp_rate: 3, base_happy: 70, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 }]),
      ]),
      moves: makeStore("moves", [
        new Uint8Array(moveRowLength(formats.moves!)),
        packRows(formats.moves!, [{ pp: 35 }]),
        packRows(formats.moves!, [{ pp: 10 }]),
        packRows(formats.moves!, [{ pp: 25 }]),
      ]),
      items: makeStore("items", [new Uint8Array(1), new Uint8Array(1)]),
    },
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur", "Ivysaur"],
        abilities: ["None", "Overgrow", "Chlorophyll", "Hidden", "Huge Power"],
        items: ["None", "Potion"],
        moves: ["None", "Tackle", "Vine Whip", "Razor Leaf"],
      },
    },
    formats,
    trpokInfo: [],
  };
}

function makeProjectWithBulbasaurForm(): ProjectState {
  const project = makeProject();
  const formats = getNarcFormats("BW2");
  const rowLength = personalRowLength(formats.personal!);
  const files: Uint8Array[] = Array.from({ length: 651 }, () => new Uint8Array(rowLength));
  files[0] = project.narcs.personal!.rawFiles[0].slice();
  files[1] = packRows(formats.personal!, [{
    base_hp: 45,
    base_atk: 49,
    base_def: 49,
    base_speed: 45,
    base_spatk: 65,
    base_spdef: 65,
    exp_rate: 3,
    base_happy: 70,
    ability_1: 1,
    ability_2: 2,
    ability_3: 3,
    gender: 127,
    form_id: 650,
    num_forms: 2,
  }]);
  files[2] = project.narcs.personal!.rawFiles[2].slice();
  files[650] = packRows(formats.personal!, [{
    base_hp: 100,
    base_atk: 90,
    base_def: 80,
    base_speed: 70,
    base_spatk: 110,
    base_spdef: 90,
    exp_rate: 3,
    base_happy: 70,
    ability_1: 4,
    ability_2: 2,
    ability_3: 3,
    gender: 254,
    num_forms: 1,
  }]);
  project.narcs.personal!.rawFiles = files;
  project.narcs.personal!.fileCount = files.length;
  project.narcs.personal!.records.clear();
  return project;
}

function makeProjectWithEncounters(): ProjectState {
  const project = makeProject();
  const formats = getNarcFormats("BW2");
  const encounterRows = [
    encounterRow(5, 1, 4, 2),
    encounterRow(9, 1, 8, 2),
    encounterRow(20, 2, 20, 2),
    encounterRow(3, 2, 3, 2),
  ];
  addEncounterTable(encounterRows[0], "surf", 8, 2, 5);
  addEncounterTable(encounterRows[0], "grass_doubles", 10, 1, 12);
  addEncounterTable(encounterRows[0], "super_rod", 12, 2, 5);
  project.narcs.encounters = makeStore("encounters", encounterRows.map((row) => packRows(formats.encounters!, [row])));
  project.session.fileIds.encounters = 4;
  project.headers = {
    count: 3,
    rows: {
      1: { index: 0, location_name: "Route 1", encounter_id: 0 },
      2: { index: 1, location_name: "Route 2", encounter_id: 1 },
      3: { index: 2, location_name: "Route 3", encounter_id: 2 },
    },
  };
  return project;
}

function addEncounterTable(
  row: Record<string, number>,
  kind: "surf" | "grass_doubles" | "super_rod",
  maxLevel: number,
  speciesId: number,
  slotCount: number,
): void {
  row[`spring_${kind}_rate`] = 20;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const base = `spring_${kind}_slot_${slot}`;
    row[base] = speciesId;
    row[`${base}_min_level`] = maxLevel;
    row[`${base}_max_level`] = maxLevel;
  }
}

function addEvolutionStore(project: ProjectState, method: number, param: number, target: number): void {
  const format = getNarcFormats("BW2").evolutions!;
  project.narcs.evolutions = makeStore("evolutions", [
    new Uint8Array(format.reduce((sum, [size]) => sum + size, 0)),
    packRows(format, [{ method_0: method, param_0: param, target_0: target }]),
    new Uint8Array(format.reduce((sum, [size]) => sum + size, 0)),
  ]);
  project.session.fileIds.evolutions = 5;
}

function addBranchingEvolutionStore(
  project: ProjectState,
  method: number,
  param: number,
  targets: readonly [number, number],
): void {
  const personal = project.narcs.personal!;
  personal.rawFiles[3] = personal.rawFiles[2].slice();
  personal.fileCount = personal.rawFiles.length;
  project.texts.banks.pokedex![3] = "Venusaur";
  const format = getNarcFormats("BW2").evolutions!;
  const empty = () => new Uint8Array(format.reduce((sum, [size]) => sum + size, 0));
  project.narcs.evolutions = makeStore("evolutions", [
    empty(),
    packRows(format, [{
      method_0: method,
      param_0: param,
      target_0: targets[0],
      method_1: method,
      param_1: param,
      target_1: targets[1],
    }]),
    empty(),
    empty(),
  ]);
  project.session.fileIds.evolutions = 5;
}

function encounterRow(maxLevel: number, firstSpecies: number, firstMinLevel: number, remainingSpecies: number): Record<string, number> {
  const row: Record<string, number> = { spring_grass_rate: 20 };
  for (let slot = 0; slot < 12; slot += 1) {
    const base = `spring_grass_slot_${slot}`;
    row[base] = slot === 0 ? firstSpecies : remainingSpecies;
    row[`${base}_min_level`] = slot === 0 ? firstMinLevel : maxLevel;
    row[`${base}_max_level`] = slot === 0 ? Math.min(maxLevel, firstMinLevel + 1) : maxLevel;
  }
  return row;
}

function makeSaveWithTemplateParty(saveHalfOffset = 0x26000): Uint8Array {
  const save = new Uint8Array(0x80000);
  for (const half of [0, saveHalfOffset]) {
    const player = half + 0x19400;
    save.set(Uint8Array.from([0x41, 0, 0x4e, 0, 0x44, 0, 0x59, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]), player + 0x04);
    writeLe32(save, player + 0x14, 0x9abc5678);
    save[player + 0x1e] = 2;
    save[player + 0x1f] = 22;
    save[player + 0x21] = 1;
    const party = half + 0x18e00;
    save[party] = 1;
    save[party + 4] = 1;
    save.set(makeTemplatePokemon(), party + 8);
  }
  return save;
}

function makeTemplatePokemon(): Uint8Array {
  const decrypted = new Uint8Array(220);
  writeLe32(decrypted, 0, 0x11112222);
  writeLe16(decrypted, 0x08, 1);
  writeLe16(decrypted, 0x0c, 12345);
  writeLe16(decrypted, 0x0e, 54321);
  decrypted[0x17] = 1;
  decrypted[0x5f] = 21;
  writeLe32(decrypted, 0x38, 0x80000000);
  writeGen5String(decrypted, 0x48, 22, "TRADE");
  decrypted.set(Uint8Array.from([0x54, 0, 0x52, 0, 0x41, 0, 0x44, 0, 0x45, 0, 0xff, 0xff, 0, 0, 0, 0]), 0x68);
  return encryptPk5Party(decrypted);
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function personalRowLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function moveRowLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
}

function crc16Ccitt(data: Uint8Array): number {
  let top = 0xff;
  let bottom = 0xff;
  for (const byte of data) {
    let value = byte ^ top;
    value ^= value >> 4;
    top = (bottom ^ (value >> 3) ^ (value << 4)) & 0xff;
    bottom = (value ^ (value << 5)) & 0xff;
  }
  return ((top << 8) | bottom) & 0xffff;
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function writeLe16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeLe32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readGen5String(bytes: Uint8Array, offset: number, byteLength: number): string {
  const chars: string[] = [];
  for (let cursor = offset; cursor + 1 < offset + byteLength; cursor += 2) {
    const value = readLe16(bytes, cursor);
    if (value === 0 || value === 0xffff) break;
    chars.push(String.fromCharCode(value));
  }
  return chars.join("");
}

function writeGen5String(out: Uint8Array, offset: number, byteLength: number, value: string): void {
  out.fill(0, offset, offset + byteLength);
  let cursor = offset;
  for (const char of value.slice(0, byteLength / 2 - 1)) {
    writeLe16(out, cursor, char.charCodeAt(0));
    cursor += 2;
  }
  writeLe16(out, cursor, 0xffff);
}
