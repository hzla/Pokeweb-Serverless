import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  addTrainer,
  addTrainerPokemon,
  autofillTrainerPokemonMoves,
  calculateTrainerPokemonNature,
  deleteTrainerPokemon,
  formatTrainerPokemonShowdownText,
  getTrainerRecord,
  importTrainerPokemonShowdownText,
  resolveTrainerPokemonGender,
  setTrainerAiFlagForAll,
  trainerPokemonSpriteSlug,
  updateTrainerField,
  updateTrainerPokemonField,
} from "../pokeweb/trainerModel";
import { getTrainerTextLines, updateTrainerText } from "../pokeweb/trainerTextModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";

describe("trainerModel", () => {
  it("uses the trainer form index for Pokemon sprite fallbacks", () => {
    expect(trainerPokemonSpriteSlug("Rotom", 0)).toBe("rotom");
    expect(trainerPokemonSpriteSlug("Rotom", 1)).toBe("rotom-heat");
    expect(trainerPokemonSpriteSlug("Rotom", 5)).toBe("rotom-mow");
    expect(trainerPokemonSpriteSlug("Bulbasaur", 1)).toBe("bulbasaur");
  });

  it("parses trpok records for all four trainer templates", () => {
    for (const template of [0, 1, 2, 3]) {
      const project = makeProject(template);
      const record = decodeRecord(project, "trpok", 1);
      expect(record.raw).toMatchObject({ ivs_0: 50, ability_0: 16, level_0: 5, species_id_0: 1, form_0: 0 });
      expect(record.readable).toMatchObject({ ability_0: 1, gender_0: "Default", species_id_0: "Bulbasaur", count: 1, template });
      expect(record.raw?.move_1_0).toBe(template & 1 ? 2 : undefined);
      expect(record.raw?.item_id_0).toBe(template & 2 ? 1 : undefined);
    }
  });

  it("updates trainer fields, template flags, and AI bit packing", () => {
    const project = makeProject(0);

    updateTrainerField(project, 1, "class", "Leader (2)");
    updateTrainerField(project, 1, "battle_type_1", "Doubles");
    updateTrainerField(project, 1, "item_1", "Potion");
    updateTrainerField(project, 1, "has_moves", true);
    updateTrainerField(project, 1, "Expert", true);

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.class).toBe(2);
    expect(trainer.raw.battle_type_1).toBe(1);
    expect(trainer.raw.item_1).toBe(1);
    expect(trainer.raw.template).toBe(1);
    expect(trainer.raw.ai).toBe(4);
    expect(project.trpokInfo[1]).toEqual({ template: 1, numPokemon: 1 });
    expect(project.narcs.trdata?.dirty.has(1)).toBe(true);
  });

  it("sets an AI flag for every trainer while preserving existing flags", () => {
    const project = makeProject(0);
    const trainerOne = decodeRecord(project, "trdata", 1);
    trainerOne.raw!.ai = 4;
    project.narcs.trdata?.dirty.clear();

    expect(setTrainerAiFlagForAll(project, "Evaluate Attacks")).toBe(2);
    expect(decodeRecord(project, "trdata", 0).raw?.ai).toBe(2);
    expect(decodeRecord(project, "trdata", 1).raw?.ai).toBe(6);
    expect(project.narcs.trdata?.dirty.has(0)).toBe(true);
    expect(project.narcs.trdata?.dirty.has(1)).toBe(true);

    expect(setTrainerAiFlagForAll(project, "Evaluate Attacks")).toBe(0);

    project.narcs.trdata?.dirty.clear();
    expect(setTrainerAiFlagForAll(project, "Evaluate Attacks", false)).toBe(2);
    expect(decodeRecord(project, "trdata", 0).raw?.ai).toBe(0);
    expect(decodeRecord(project, "trdata", 1).raw?.ai).toBe(4);
    expect(project.narcs.trdata?.dirty.has(0)).toBe(true);
    expect(project.narcs.trdata?.dirty.has(1)).toBe(true);
  });

  it("updates trainer Pokemon fields and auto-enables item/move templates", () => {
    const project = makeProject(0);

    updateTrainerPokemonField(project, 1, 0, "species_id_0", "Ivysaur");
    updateTrainerPokemonField(project, 1, 0, "item_id_0", "Potion");
    updateTrainerPokemonField(project, 1, 0, "move_1_0", "Vine Whip");
    updateTrainerPokemonField(project, 1, 0, "ability_0", "2");
    updateTrainerPokemonField(project, 1, 0, "gender_0", "Female");
    updateTrainerPokemonField(project, 1, 0, "nature_0", "Adamant");

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.template).toBe(3);
    expect(trainer.party[0]).toMatchObject({ speciesId: 2, itemName: "Potion", abilitySlot: 2, gender: "Female", nature: "Adamant", natureSetting: "Adamant", natureValue: 4 });
    expect(decodeRecord(project, "trpok", 1).raw?.ability_0).toBe(34);
    expect(decodeRecord(project, "trpok", 1).raw?.padding_0).toBe(4);
    expect(project.narcs.trpok?.dirty.has(1)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "trpok" && entry.text.includes("Pokemon 1 species id changed from Bulbasaur to Ivysaur."))).toBe(true);
  });

  it("allows Cascade White trainer ability slots 4-6 only when the AI patch is present", () => {
    const project = makeProject(0);

    expect(() => updateTrainerPokemonField(project, 1, 0, "ability_0", "4")).toThrow(/between 0 and 3/u);

    project.codeInjection = {
      modules: [{ path: "patches/A2_AIChanges.dll", target: "patches", fileName: "A2_AIChanges.dll" }],
    };
    updateTrainerPokemonField(project, 1, 0, "ability_0", "4");

    let trainer = getTrainerRecord(project, 1);
    expect(trainer.party[0]).toMatchObject({ abilitySlot: 4, resolvedAbilitySlot: 4, abilityName: "Drought" });
    expect(decodeRecord(project, "trpok", 1).raw?.ability_0).toBe(64);

    updateTrainerPokemonField(project, 1, 0, "ability_0", "6");
    trainer = getTrainerRecord(project, 1);
    expect(trainer.party[0]).toMatchObject({ abilitySlot: 6, resolvedAbilitySlot: 6, abilityName: "Flower Gift" });
    expect(decodeRecord(project, "trpok", 1).raw?.ability_0).toBe(96);
  });

  it("stores trainer Pokemon natures in the legacy padding byte and materializes the same trpok layout", () => {
    const project = makeProject(3);
    const originalLength = project.narcs.trpok!.rawFiles[1].length;

    expect(getTrainerRecord(project, 1).party[0]).toMatchObject({ nature: "Impish", natureSetting: "Auto", natureValue: 0 });

    updateTrainerPokemonField(project, 1, 0, "nature_0", "Jolly");
    expect(getTrainerRecord(project, 1).party[0]).toMatchObject({ nature: "Jolly", natureSetting: "Jolly", natureValue: 14 });

    materializeProjectEdits(project);
    expect(project.narcs.trpok!.rawFiles[1]).toHaveLength(originalLength);
    expect(project.narcs.trpok!.rawFiles[1][3]).toBe(14);

    updateTrainerPokemonField(project, 1, 0, "nature_0", "Auto");
    materializeProjectEdits(project);
    expect(project.narcs.trpok!.rawFiles[1]).toHaveLength(originalLength);
    expect(project.narcs.trpok!.rawFiles[1][3]).toBe(0);
    expect(getTrainerRecord(project, 1).party[0]).toMatchObject({ nature: "Impish", natureSetting: "Auto", natureValue: 0 });
  });

  it("formats a trainer Pokemon as Showdown import text", () => {
    const project = makeProject(3);

    expect(formatTrainerPokemonShowdownText(project, 1, 0)).toBe(
      [
        "Bulbasaur @ Potion",
        "Ability: Overgrow",
        "Level: 5",
        "Impish Nature",
        "IVs: 6 HP / 6 Atk / 6 Def / 6 SpA / 6 SpD / 6 Spe",
        "- Vine Whip",
      ].join("\n"),
    );
  });

  it("imports Showdown text into one trainer Pokemon slot", () => {
    const project = makeProject(0);

    importTrainerPokemonShowdownText(
      project,
      1,
      0,
      [
        "Partner (Ivysaur) (F) @ Potion",
        "Ability: Chlorophyll",
        "Level: 42",
        "Jolly Nature",
        "IVs: 31 HP / 30 Atk / 29 Def / 28 SpA / 27 SpD / 26 Spe",
        "Form: 2",
        "- Razor Leaf",
        "- Solar Beam",
      ].join("\n"),
    );

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.template).toBe(3);
    expect(trainer.party[0]).toMatchObject({
      speciesId: 2,
      speciesName: "Ivysaur",
      itemName: "Potion",
      abilitySlot: 2,
      gender: "Female",
      level: 42,
      ivs: 235,
      nature: "Jolly",
      natureSetting: "Jolly",
      natureValue: 14,
      form: 2,
    });
    expect(decodeRecord(project, "trpok", 1).raw).toMatchObject({
      species_id_0: 2,
      item_id_0: 1,
      ability_0: 34,
      level_0: 42,
      ivs_0: 235,
      padding_0: 14,
      form_0: 2,
      move_1_0: 4,
      move_2_0: 6,
      move_3_0: 0,
      move_4_0: 0,
    });
    expect(project.narcs.trdata?.dirty.has(1)).toBe(true);
    expect(project.narcs.trpok?.dirty.has(1)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "trpok" && entry.text.includes("Pokemon 1 was imported from Showdown text."))).toBe(true);
  });

  it("treats invalid stored trainer Pokemon nature bytes as Auto", () => {
    const project = makeProject(0);
    const trpok = decodeRecord(project, "trpok", 1);
    trpok.raw!.padding_0 = 26;

    expect(getTrainerRecord(project, 1).party[0]).toMatchObject({ nature: "Impish", natureSetting: "Auto", natureValue: 0 });
  });

  it("autofills trainer Pokemon moves from the latest learnset moves and enables moves", () => {
    const project = makeProject(0);

    autofillTrainerPokemonMoves(project, 1, 0);

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.hasMoves).toBe(true);
    expect(trainer.raw.template).toBe(1);
    expect(trainer.party[0].moves).toEqual(["Sleep Powder", "Razor Leaf", "Vine Whip", "Tackle"]);
    expect(decodeRecord(project, "trpok", 1).raw).toMatchObject({
      move_1_0: 5,
      move_2_0: 4,
      move_3_0: 2,
      move_4_0: 1,
    });
    expect(project.narcs.trdata?.dirty.has(1)).toBe(true);
    expect(project.narcs.trpok?.dirty.has(1)).toBe(true);
  });

  it("adds and deletes trainer Pokemon slots while keeping indexes compact", () => {
    const project = makeProject(3);

    const added = addTrainerPokemon(project, 1);
    expect(added.slot).toBe(1);
    expect(getTrainerRecord(project, 1).party).toHaveLength(2);

    updateTrainerPokemonField(project, 1, 1, "species_id_1", "Ivysaur");
    updateTrainerPokemonField(project, 1, 1, "nature_1", "Timid");
    deleteTrainerPokemon(project, 1, 0);

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.num_pokemon).toBe(1);
    expect(trainer.party[0].speciesName).toBe("Ivysaur");
    expect(trainer.party[0]).toMatchObject({ nature: "Timid", natureSetting: "Timid", natureValue: 11 });
    expect(project.trpokInfo[1]).toEqual({ template: 3, numPokemon: 1 });
  });

  it("adds a trainer by cloning trainer data, party data, names, and BW2 text tables", () => {
    const project = makeProject(3);
    addTrainerTextFixtures(project);

    const added = addTrainer(project, 1);

    expect(added.id).toBe(2);
    expect(project.narcs.trdata?.fileCount).toBe(3);
    expect(project.narcs.trpok?.fileCount).toBe(3);
    expect(getTrainerRecord(project, 2).party[0]).toMatchObject({ speciesName: "Bulbasaur", level: 5, itemName: "Potion" });
    expect(project.texts.banks.tr_names?.[2]).toBe("Trainer");
    expect(project.narcs.trdata?.dirty.has(2)).toBe(true);
    expect(project.narcs.trpok?.dirty.has(2)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(382)).toBe(true);

    const copiedTexts = getTrainerTextLines(project, 2);
    expect(copiedTexts.find((line) => line.typeId === 0)).toMatchObject({ value: "Battle start", exists: true });
    expect(copiedTexts.find((line) => line.typeId === 1)).toMatchObject({ value: "Battle loss", exists: true });
    expect(readU16(project.narcs.trtext_offsets!.rawFiles[0], 4)).toBe(12);
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 12)).toBe(2);
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 14)).toBe(0);
  });

  it("calculates Gen V trainer Pokemon natures with the old PID algorithm", () => {
    const project = makeProject(0);

    expect(calculateTrainerPokemonNature(project, 1, 0)).toBe("Impish");
  });

  it("calculates Gen IV JAK7 trainer natures and abilities from the Platinum trainer data", () => {
    const project = makeJak7Project();

    const trainer = getTrainerRecord(project, 338);
    expect(trainer.readable).toMatchObject({ class: "Idol", name: "Skylar" });
    expect(trainer.party.map((pokemon) => pokemon.nature)).toEqual(["Sassy", "Relaxed", "Calm", "Naughty", "Quiet", "Rash"]);
    expect(trainer.party.map((pokemon) => resolveTrainerPokemonGender(project, 338, pokemon.slot))).toEqual(["Female", "Female", "Female", "Female", "Female", "Female"]);
    expect(trainer.party[0]).toMatchObject({ speciesName: "Flygon", abilitySlot: 1, resolvedAbilitySlot: 1, abilityName: "Sand Stream" });
    expect(trainer.party[1]).toMatchObject({
      speciesName: "Aggron",
      level: 61,
      ivs: 252,
      itemName: "Leftovers",
      moves: ["Head Smash", "Giga Impact", "Superpower", "Avalanche"],
      abilitySlot: 0,
      abilityName: "Rock Head",
      gender: "Female",
      nature: "Relaxed",
      natureSetting: "Auto",
    });
    expect(trainer.party[3]).toMatchObject({ speciesName: "Butterfree", abilitySlot: 0, resolvedAbilitySlot: 2, abilityName: "Compound Eyes" });
    expect(calculateTrainerPokemonNature(project, 338, 1)).toBe("Relaxed");

    const carryTrainer = getTrainerRecord(project, 340);
    expect(carryTrainer.party[0]).toMatchObject({ speciesName: "Flygon", abilitySlot: 1, nature: "Adamant" });
  });

  it("reads, inserts, updates, and deletes BW2 trainer text through the table and offset indexer", () => {
    const project = makeProject(0);
    addTrainerTextFixtures(project);

    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 2)?.label).toBe("Fld - After Loss");
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 16)?.label).toBe("Fld - After Loss (Item)");

    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 0)).toMatchObject({
      bankIndex: 0,
      entryIndex: 0,
      value: "Battle start",
      exists: true,
    });
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 2)?.bankIndex).toBeUndefined();

    updateTrainerText(project, 1, 0, "New start");
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 0)?.value).toBe("New start");

    updateTrainerText(project, 1, 2, "Field defeat");
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 2)).toMatchObject({
      bankIndex: 2,
      entryIndex: 2,
      value: "Field defeat",
      exists: true,
    });
    expect(readU16(project.narcs.trtext_offsets!.rawFiles[0], 4)).toBe(12);
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 8)).toBe(1);
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 10)).toBe(2);

    updateTrainerText(project, 1, 1, "");
    const bank = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[381]);
    expect(bank.map((entry) => entry[1])).toEqual(["New start", "Field defeat", "Other trainer"]);
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 1)?.exists).toBe(false);
    expect(project.narcs.trtext_offsets?.dirty.has(0)).toBe(true);
    expect(project.narcs.trtext_table?.dirty.has(0)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(381)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "trainer_text" && entry.text.includes("Trainer 1 Pre Bttl changed from Battle start to New start."))).toBe(true);
  });

  it("can omit trainer text when a bulk reader only needs battle data", () => {
    const project = makeProject(0);
    addTrainerTextFixtures(project);

    expect(getTrainerRecord(project, 1).texts.some((line) => line.exists)).toBe(true);
    expect(getTrainerRecord(project, 1, { includeTexts: false }).texts).toEqual([]);
  });

  it("inserts and deletes BW2 trainer text for a trainer with no existing rows", () => {
    const project = makeProject(0);
    addTrainerTextFixtures(project);

    updateTrainerText(project, 2, 0, "New missing trainer start");

    expect(getTrainerTextLines(project, 2).find((line) => line.typeId === 0)).toMatchObject({
      entryIndex: 2,
      value: "New missing trainer start",
      exists: true,
    });
    expect(readLineTable(project.narcs.trtext_table!.rawFiles[0])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
      [4, 0],
    ]);
    expect(readOffsets(project.narcs.trtext_offsets!.rawFiles[0])).toEqual([0, 0, 8, 12, 12]);
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[381]).map((entry) => entry[1])).toEqual([
      "Battle start",
      "Battle loss",
      "New missing trainer start",
      "Other trainer",
    ]);

    updateTrainerText(project, 2, 0, "");

    expect(getTrainerTextLines(project, 2).find((line) => line.typeId === 0)).toMatchObject({
      entryIndex: 2,
      value: "",
      exists: false,
    });
    expect(readLineTable(project.narcs.trtext_table!.rawFiles[0])).toEqual([
      [1, 0],
      [1, 1],
      [4, 0],
    ]);
    expect(readOffsets(project.narcs.trtext_offsets!.rawFiles[0])).toEqual([0, 0, 8, 8, 8]);
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[381]).map((entry) => entry[1])).toEqual([
      "Battle start",
      "Battle loss",
      "Other trainer",
    ]);
  });
});

function makeProject(template: number): ProjectState {
  const formats = getNarcFormats("BW2");
  const trdata = packRows(formats.trdata!, [
    {},
    { template, class: 1, battle_type_1: 0, num_pokemon: 1, item_1: 0, item_2: 0, item_3: 0, item_4: 0, ai: 0, heal: 0, money: 10, reward_item: 1 },
  ]);
  const trpok = [new Uint8Array(), packTrpok(template, [{ ivs: 50, ability: 16, level: 5, species_id: 1, form: 0, item_id: 1, move_1: 2, move_2: 0, move_3: 0, move_4: 0 }])];
  const personal = packRows(formats.personal!, [
    {},
    { ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 },
    { ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 },
  ]);

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { trdata: 1, trpok: 2, personal: 3, learnsets: 4 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: trdata.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      trdata: makeStore("trdata", trdata, 2),
      trpok: makeStore("trpok", trpok, 2),
      personal: makeStore("personal", personal, 3),
      learnsets: makeStore("learnsets", [
        packLearnset([]),
        packLearnset([
          { moveId: 1, level: 1 },
          { moveId: 2, level: 3 },
          { moveId: 3, level: 6 },
          { moveId: 4, level: 4 },
          { moveId: 5, level: 5 },
          { moveId: 6, level: 10 },
        ]),
        packLearnset([{ moveId: 2, level: 1 }]),
      ], 3),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        tr_names: ["None", "Cheren"],
        tr_classes: ["None", "Ace Trainer", "Leader"],
        pokedex: ["None", "Bulbasaur", "Ivysaur"],
        abilities: ["None", "Overgrow", "Chlorophyll", "Hidden"],
        items: ["None", "Potion"],
        moves: ["None", "Tackle", "Vine Whip", "Growl", "Razor Leaf", "Sleep Powder", "Solar Beam"],
      },
    },
    formats,
    trpokInfo: [{ template: 0, numPokemon: 0 }, { template, numPokemon: 1 }],
  };
}

function makeJak7Project(): ProjectState {
  const formats = getNarcFormats("Pt");
  const trainerRows = Array.from({ length: 341 }, () => ({} as Record<string, number>));
  trainerRows[338] = { template: 3, class: 85, unknown_1: 0, num_pokemon: 6, item_1: 0, item_2: 0, item_3: 0, item_4: 0, ai: 15, double_battle: 0 };
  trainerRows[340] = { template: 3, class: 85, unknown_1: 0, num_pokemon: 1, item_1: 0, item_2: 0, item_3: 0, item_4: 0, ai: 15, double_battle: 0 };
  const trdata = packRows(formats.trdata!, trainerRows);
  const trpokRows = [
    { ivs: 255, ability: 18, level: 59, species_id: 330, item_id: 188, move_1: 434, move_2: 446, move_3: 89, move_4: 53 },
    { ivs: 252, ability: 2, level: 61, species_id: 306, item_id: 234, move_1: 457, move_2: 416, move_3: 276, move_4: 419 },
    { ivs: 252, ability: 2, level: 58, species_id: 227, item_id: 0, move_1: 0, move_2: 0, move_3: 0, move_4: 0 },
    { ivs: 255, ability: 0, level: 62, species_id: 12, item_id: 0, move_1: 0, move_2: 0, move_3: 0, move_4: 0 },
    { ivs: 255, ability: 2, level: 55, species_id: 472, item_id: 0, move_1: 0, move_2: 0, move_3: 0, move_4: 0 },
    { ivs: 255, ability: 2, level: 60, species_id: 205, item_id: 0, move_1: 0, move_2: 0, move_3: 0, move_4: 0 },
  ];
  const trpokFiles: Uint8Array[] = Array.from({ length: 341 }, () => new Uint8Array());
  trpokFiles[338] = packGen4Trpok(3, trpokRows, "Pt");
  trpokFiles[340] = packGen4Trpok(3, [
    { ivs: 255, ability: 16, level: 59, species_id: 330, item_id: 188, move_1: 434, move_2: 446, move_3: 89, move_4: 53 },
  ], "Pt");

  const personalRows = Array.from({ length: 473 }, () => ({} as Record<string, number>));
  personalRows[12] = { gender: 127, ability_1: 14, ability_2: 0 };
  personalRows[205] = { gender: 127, ability_1: 5, ability_2: 5 };
  personalRows[227] = { gender: 127, ability_1: 51, ability_2: 5 };
  personalRows[306] = { gender: 127, ability_1: 5, ability_2: 69 };
  personalRows[330] = { gender: 127, ability_1: 26, ability_2: 26 };
  personalRows[472] = { gender: 127, ability_1: 8, ability_2: 52 };
  const personal = packRows(formats.personal!, personalRows);
  const arm9 = new Uint8Array(0xf0714 + 105);
  arm9[0xf0714 + 85] = 1;
  arm9[0x0793b8] = 0xf0;
  arm9[0x0793b9] = 0xb5;
  arm9[0x0793ba] = 0x93;
  arm9[0x0793bb] = 0xb0;
  arm9[0x0795a2] = 0x1d;
  arm9[0x0795a3] = 0x1c;
  arm9[0x0795a4] = 0x0f;
  arm9[0x0795a5] = 0x23;

  const trNames = namedRows(341, { 338: "Skylar", 340: "Carry" });
  const trClasses = namedRows(106, { 85: "Idol" });
  const pokedex = namedRows(473, { 12: "Butterfree", 205: "Forretress", 227: "Skarmory", 306: "Aggron", 330: "Flygon", 472: "Gliscor" });
  const abilities = namedRows(70, { 5: "Filter", 8: "Sand Veil", 14: "Compound Eyes", 26: "Sand Stream", 51: "Keen Eye", 52: "Hyper Cutter", 69: "Rock Head" });
  const items = namedRows(235, { 188: "Yache Berry", 234: "Leftovers" });
  const moves = namedRows(458, { 53: "Flamethrower", 89: "Earthquake", 276: "Superpower", 416: "Giga Impact", 419: "Avalanche", 434: "Draco Meteor", 446: "Stealth Rock", 457: "Head Smash" });

  return {
    session: {
      romName: "pknightfinal",
      generation: "gen4",
      baseVersion: "Pt",
      baseRom: "Pt",
      fairy: false,
      fileIds: { trdata: 1, trpok: 2, personal: 3 },
      blacklist: [],
    },
    romInfo: { title: "PKNIGHT", idCode: "JAK7", fileName: "pknightfinal.nds", size: trdata.length },
    arm9,
    overlays: {},
    narcs: {
      trdata: makeStore("trdata", trdata, trainerRows.length),
      trpok: makeStore("trpok", trpokFiles, trpokFiles.length),
      personal: makeStore("personal", personal, personalRows.length),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { tr_names: trNames, tr_classes: trClasses, pokedex, abilities, items, moves } },
    formats,
    trpokInfo: Array.from({ length: 341 }, (_, trainerId) => {
      if (trainerId === 338) return { template: 3, numPokemon: 6 };
      if (trainerId === 340) return { template: 3, numPokemon: 1 };
      return { template: 0, numPokemon: 0 };
    }),
  };
}

function namedRows(length: number, names: Record<number, string>): string[] {
  return Array.from({ length }, (_unused, index) => names[index] ?? String(index));
}

function packLearnset(rows: Array<{ moveId: number; level: number }>): Uint8Array {
  const out = new Uint8Array((25 + 1) * 4);
  rows.forEach((row, index) => {
    writeInt(out, index * 4, 2, row.moveId);
    writeInt(out, index * 4 + 2, 2, row.level);
  });
  writeInt(out, rows.length * 4, 2, 65535);
  writeInt(out, rows.length * 4 + 2, 2, 65535);
  return out;
}

function addTrainerTextFixtures(project: ProjectState): void {
  const bank: Gen5TextEntry[] = [
    ["0_0", "Battle start", 0],
    ["0_1", "Battle loss", 0],
    ["0_2", "Other trainer", 0],
  ];
  const rawFiles: Uint8Array[] = Array.from({ length: 383 }, () => new Uint8Array(0));
  rawFiles[381] = new Uint8Array(encodeGen5TextBank(bank));
  rawFiles[382] = new Uint8Array(encodeGen5TextBank([["0_0", "None", 0], ["0_1", "Cheren", 0]]));
  const messageTexts: Gen5TextEntry[][] = [];
  messageTexts[381] = [...bank.map((entry) => [...entry] as Gen5TextEntry)];
  messageTexts[382] = [
    ["0_0", "None", 0],
    ["0_1", "Cheren", 0],
  ];
  project.narcs.message_texts = makeStore("message_texts", rawFiles, rawFiles.length);
  project.texts.messageTexts = messageTexts;

  project.narcs.trtext_table = makeStore("trtext_table", [packLineTable([[1, 0], [1, 1], [4, 0]])], 1, "a/0/8/9");
  project.narcs.trtext_offsets = makeStore("trtext_offsets", [packOffsets([0, 0, 8, 8, 8])], 1, "a/0/9/0");
}

function makeStore(name: NarcName, data: Uint8Array | Uint8Array[], count: number, sourcePath = "test"): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath,
    fileCount: count,
    rawFiles: Array.isArray(data) ? data : splitRows(data, count),
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

function packTrpok(template: number, rows: Array<Record<string, number>>): Uint8Array {
  const fields = ["ivs", "ability", "level", "padding", "species_id", "form", ...(template & 2 ? ["item_id"] : []), ...(template & 1 ? ["move_1", "move_2", "move_3", "move_4"] : [])];
  const sizes = fields.map((field) => (["ivs", "ability", "level", "padding"].includes(field) ? 1 : 2));
  const rowLength = sizes.reduce((sum, size) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    fields.forEach((field, index) => {
      writeInt(out, offset, sizes[index], row[field] ?? 0);
      offset += sizes[index];
    });
  });
  return out;
}

function packGen4Trpok(template: number, rows: Array<Record<string, number>>, baseRom: "DP" | "Pt" | "HGSS"): Uint8Array {
  const hasItems = (template & 2) !== 0;
  const hasMoves = (template & 1) !== 0;
  const hasBallSeals = baseRom !== "DP";
  const rowLength = 6 + (hasItems ? 2 : 0) + (hasMoves ? 8 : 0) + (hasBallSeals ? 2 : 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    writeInt(out, offset, 1, row.ivs ?? 0);
    writeInt(out, offset + 1, 1, row.ability ?? 0);
    writeInt(out, offset + 2, 2, row.level ?? 0);
    writeInt(out, offset + 4, 2, (((row.form ?? 0) & 0x3f) << 10) | ((row.species_id ?? 0) & 0x03ff));
    offset += 6;
    if (hasItems) {
      writeInt(out, offset, 2, row.item_id ?? 0);
      offset += 2;
    }
    if (hasMoves) {
      for (let move = 1; move <= 4; move += 1) {
        writeInt(out, offset, 2, row[`move_${move}`] ?? 0);
        offset += 2;
      }
    }
    if (hasBallSeals) writeInt(out, offset, 2, row.ball_seals ?? 0);
  });
  return out;
}

function splitRows(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.length / count);
  return Array.from({ length: count }, (_, index) => data.slice(index * size, (index + 1) * size));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}

function packLineTable(rows: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(rows.length * 4);
  rows.forEach(([trainerId, typeId], index) => {
    writeInt(out, index * 4, 2, trainerId);
    writeInt(out, index * 4 + 2, 2, typeId);
  });
  return out;
}

function packOffsets(offsets: number[]): Uint8Array {
  const out = new Uint8Array(offsets.length * 2);
  offsets.forEach((offset, index) => writeInt(out, index * 2, 2, offset));
  return out;
}

function readLineTable(bytes: Uint8Array): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) rows.push([readU16(bytes, offset), readU16(bytes, offset + 2)]);
  return rows;
}

function readOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 2 <= bytes.length; offset += 2) offsets.push(readU16(bytes, offset));
  return offsets;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
