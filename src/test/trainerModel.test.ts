import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  addTrainer,
  addTrainerPokemon,
  autofillTrainerPokemonMoves,
  calculateTrainerPokemonNature,
  deleteTrainerPokemon,
  getTrainerRecord,
  setTrainerAiFlagForAll,
  updateTrainerField,
  updateTrainerPokemonField,
} from "../pokeweb/trainerModel";
import { getTrainerTextLines, updateTrainerText } from "../pokeweb/trainerTextModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";

describe("trainerModel", () => {
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

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.template).toBe(3);
    expect(trainer.party[0]).toMatchObject({ speciesId: 2, itemName: "Potion", abilitySlot: 2, gender: "Female" });
    expect(decodeRecord(project, "trpok", 1).raw?.ability_0).toBe(34);
    expect(project.narcs.trpok?.dirty.has(1)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "trpok" && entry.text.includes("Pokemon 1 species id changed from Bulbasaur to Ivysaur."))).toBe(true);
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
    deleteTrainerPokemon(project, 1, 0);

    const trainer = getTrainerRecord(project, 1);
    expect(trainer.raw.num_pokemon).toBe(1);
    expect(trainer.party[0].speciesName).toBe("Ivysaur");
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
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 4)).toBe(12);
    expect(readU16(project.narcs.trtext_offsets!.rawFiles[0], 12)).toBe(2);
  });

  it("calculates Gen V trainer Pokemon natures with the old PID algorithm", () => {
    const project = makeProject(0);

    expect(calculateTrainerPokemonNature(project, 1, 0)).toBe("Impish");
  });

  it("reads, inserts, updates, and deletes BW2 trainer text through the table and offset indexer", () => {
    const project = makeProject(0);
    addTrainerTextFixtures(project);

    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 0)).toMatchObject({
      entryIndex: 0,
      value: "Battle start",
      exists: true,
    });

    updateTrainerText(project, 1, 0, "New start");
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 0)?.value).toBe("New start");

    updateTrainerText(project, 1, 2, "Field defeat");
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 2)).toMatchObject({
      entryIndex: 2,
      value: "Field defeat",
      exists: true,
    });
    expect(readU16(project.narcs.trtext_offsets!.rawFiles[0], 10)).toBe(2);
    expect(readU16(project.narcs.trtext_table!.rawFiles[0], 4)).toBe(12);

    updateTrainerText(project, 1, 1, "");
    const bank = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[381]);
    expect(bank.map((entry) => entry[1])).toEqual(["New start", "Field defeat", "Other trainer"]);
    expect(getTrainerTextLines(project, 1).find((line) => line.typeId === 1)?.exists).toBe(false);
    expect(project.narcs.trtext_offsets?.dirty.has(0)).toBe(true);
    expect(project.narcs.trtext_table?.dirty.has(0)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(381)).toBe(true);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "trainer_text" && entry.text.includes("Trainer 1 Pre Bttl changed from Battle start to New start."))).toBe(true);
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

  // In BW2, a/0/9/0 is the line table and a/0/8/9 is the accelerator offset table.
  project.narcs.trtext_offsets = makeStore("trtext_offsets", [packLineTable([[1, 0], [1, 1], [4, 0]])], 1, "a/0/9/0");
  project.narcs.trtext_table = makeStore("trtext_table", [packOffsets([0, 0, 8, 8, 8])], 1, "a/0/8/9");
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

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
