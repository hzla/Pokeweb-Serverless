import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import {
  appendPokemonEggMove,
  appendPokemonLearnsetMove,
  deletePokemonEggMove,
  deletePokemonLearnsetMove,
  getPokemonRecord,
  insertPokemonEggMove,
  insertPokemonLearnsetMove,
  pokemonMatchesSearch,
  updatePokemonEggMove,
  updatePokemonField,
  updatePokemonTmCompatibility,
  updatePokemonTutorCompatibility,
} from "../pokeweb/pokemonModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("pokemonModel", () => {
  it("derives personal, learnset, and evolution editor data from their NARCs", () => {
    const project = makeProject();
    const bulbasaur = getPokemonRecord(project, 1);

    expect(bulbasaur.personal.name).toBe("Bulbasaur");
    expect(bulbasaur.personal.type_1).toBe("Grass");
    expect(bulbasaur.personal.ability_1).toBe("Overgrow");
    expect(bulbasaur.learnset[0]).toMatchObject({ moveName: "Tackle", level: 1, type: "Normal", power: 40 });
    expect(bulbasaur.evolutions[0]).toMatchObject({ method: "Level Requirement", param: 16, target: "Ivysaur" });
  });

  it("updates personal text, packed EV yields, learnset moves, and evolution targets in memory", () => {
    const project = makeProject();

    const type = updatePokemonField(project, 1, "personal", "type_1", "Poison");
    const ev = updatePokemonField(project, 1, "personal", "hp_yield", "3");
    const move = updatePokemonField(project, 1, "learnset", "move_id_0", "Vine Whip");
    const evo = updatePokemonField(project, 1, "evolution", "target_0", "Venusaur");

    const record = getPokemonRecord(project, 1);
    expect(type.rawValue).toBe(3);
    expect(ev.value).toBe(3);
    expect(move.movePreview).toMatchObject({ type: "Grass", power: 45 });
    expect(evo.rawValue).toBe(3);
    expect(record.personal.type_1).toBe("Poison");
    expect(record.rawPersonal.evs & 0b11).toBe(3);
    expect(record.learnset[0].moveName).toBe("Vine Whip");
    expect(record.evolutions[0].target).toBe("Venusaur");
    expect(project.narcs.personal?.dirty.has(1)).toBe(true);
    expect(project.narcs.learnsets?.dirty.has(1)).toBe(true);
    expect(project.narcs.evolutions?.dirty.has(1)).toBe(true);
    expect(project.actionChangelog?.entries.map((entry) => entry.domain)).toEqual(expect.arrayContaining(["personal", "learnsets", "evolutions"]));
    expect(project.actionChangelog?.entries.some((entry) => entry.text.includes("Bulbasaur type 1 changed from Grass to Poison."))).toBe(true);
  });

  it("toggles TM/HM compatibility bits without changing TM move names", () => {
    const project = makeProject();

    updatePokemonTmCompatibility(project, 1, "tm", 1, true);
    updatePokemonTmCompatibility(project, 1, "tm", 65, true);
    updatePokemonTmCompatibility(project, 1, "hm", 1, true);
    updatePokemonTmCompatibility(project, 1, "hm", 6, true);

    const record = getPokemonRecord(project, 1);
    expect(record.rawPersonal["tm_1-32"]).toBe(1);
    expect(record.rawPersonal["tm_65-95+hm_1"]).toBe(2 ** 31 + 1);
    expect(record.rawPersonal["hm_2-6"]).toBe(16);
    expect(record.tmCompatibility.find((slot) => slot.label === "TM1")).toMatchObject({ enabled: true, moveName: "None" });
    expect(record.tmCompatibility.find((slot) => slot.label === "HM1")).toMatchObject({ enabled: true, moveName: "None" });
    expect(project.narcs.personal?.dirty.has(1)).toBe(true);
  });

  it("toggles BW2 tutor compatibility bits from personal data", () => {
    const project = makeProject();

    updatePokemonTutorCompatibility(project, 1, "driftveil_tutor", 0, true);
    updatePokemonTutorCompatibility(project, 1, "lentimas_tutor", 16, true);

    const record = getPokemonRecord(project, 1);
    expect(record.rawPersonal.driftveil_tutor).toBe(1);
    expect(record.rawPersonal.lentimas_tutor).toBe(2 ** 16);
    expect(record.tutorCompatibility.find((group) => group.group === "driftveil")?.slots[0]).toMatchObject({ enabled: true, moveName: "Covet" });
    expect(project.narcs.personal?.dirty.has(1)).toBe(true);
  });

  it("inserts, appends, updates, and deletes egg move rows", () => {
    const project = makeProject();

    insertPokemonEggMove(project, 1, 0);
    updatePokemonEggMove(project, 1, 0, "Vine Whip");
    appendPokemonEggMove(project, 1);
    deletePokemonEggMove(project, 1, 1);

    const record = getPokemonRecord(project, 1);
    expect(record.eggMoves.map((move) => move.moveName)).toEqual(["Vine Whip", "Tackle"]);
    expect(project.narcs.egg_moves?.rawFiles[1]).toEqual(new Uint8Array([2, 0, 2, 0, 1, 0]));
    expect(project.narcs.egg_moves?.dirty.has(1)).toBe(true);
  });

  it("inserts, appends, deletes, and serializes learnset move rows", () => {
    const project = makeProject();

    insertPokemonLearnsetMove(project, 1, 0);
    updatePokemonField(project, 1, "learnset", "move_id_0", "Vine Whip");
    appendPokemonLearnsetMove(project, 1);
    deletePokemonLearnsetMove(project, 1, 1);

    const record = getPokemonRecord(project, 1);
    expect(record.learnset.map((move) => [move.moveName, move.level])).toEqual([
      ["Vine Whip", 1],
      ["Tackle", 1],
    ]);

    materializeProjectEdits(project);
    const bytes = project.narcs.learnsets?.rawFiles[1];
    expect(bytes).toEqual(new Uint8Array([2, 0, 1, 0, 1, 0, 1, 0, 0xff, 0xff, 0xff, 0xff]));
  });

  it("rejects invalid values and filters by old comma search plus generation/type buttons", () => {
    const project = makeProject();
    const bulbasaur = getPokemonRecord(project, 1);

    expect(() => updatePokemonField(project, 1, "personal", "base_hp", "300")).toThrow(/between 0 and 255/u);
    expect(() => updatePokemonField(project, 1, "learnset", "move_id_0", "Nope")).toThrow(/Unknown move/u);
    expect(pokemonMatchesSearch(bulbasaur, "nope, bulb", new Set([1]), new Set(["grass"]))).toBe(true);
    expect(pokemonMatchesSearch(bulbasaur, "bulb", new Set([2]), new Set(["grass"]))).toBe(false);
    expect(pokemonMatchesSearch(bulbasaur, "bulb", new Set([1]), new Set(["fire"]))).toBe(false);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const personal = packRows(formats.personal!, [
    {},
    { base_hp: 45, base_atk: 49, base_def: 49, base_speed: 45, base_spatk: 65, base_spdef: 65, type_1: 11, type_2: 3, ability_1: 1, ability_2: 2, ability_3: 3, evs: 1 },
  ]);
  const learnsets = [
    new Uint8Array(),
    packRows(formats.learnsets!, [{ move_id_0: 1, lvl_learned_0: 1 }], 1, true),
  ];
  const evolutions = [
    new Uint8Array(),
    packRows(formats.evolutions!, [{ method_0: 4, param_0: 16, target_0: 2 }]),
  ];
  const moves = packRows(formats.moves!, [
    {},
    { type: 0, category: 1, power: 40, accuracy: 100 },
    { type: 11, category: 1, power: 45, accuracy: 100 },
  ]);
  const eggMoves = [new Uint8Array([0, 0]), new Uint8Array([1, 0, 1, 0])];

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, learnsets: 2, evolutions: 3, moves: 4, egg_moves: 5 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: personal.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", personal, 2),
      learnsets: makeStore("learnsets", learnsets, 2),
      evolutions: makeStore("evolutions", evolutions, 2),
      egg_moves: makeStore("egg_moves", eggMoves, 2),
      moves: makeStore("moves", moves, 3),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur", "Ivysaur", "Venusaur"],
        abilities: ["None", "overgrow", "chlorophyll", "hidden"],
        items: ["None"],
        moves: ["None", "Tackle", "Vine Whip"],
      },
    },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, data: Uint8Array | Uint8Array[], count: number): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: Array.isArray(data) ? data : splitRows(data, count),
    records: new Map(),
    dirty: new Set(),
  };
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>, rowCount = rows.length, learnset = false): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0) + (learnset ? 4 : 0);
  const out = new Uint8Array(rowLength * rowCount);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
    if (learnset) {
      writeInt(out, offset, 2, 65535);
      writeInt(out, offset + 2, 2, 65535);
    }
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
