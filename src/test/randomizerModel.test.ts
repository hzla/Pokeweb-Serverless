import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import {
  createSeededRng,
  defaultRandomizerSettings,
  randomizeProject,
  randomizerProjectCounts,
} from "../pokeweb/randomizerModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";

describe("randomizerModel", () => {
  it("produces a stable seeded random sequence", () => {
    const first = createSeededRng("same-seed");
    const second = createSeededRng("same-seed");
    const other = createSeededRng("different-seed");

    const firstValues = Array.from({ length: 8 }, () => first.integer(0, 1_000_000));
    expect(Array.from({ length: 8 }, () => second.integer(0, 1_000_000))).toEqual(firstValues);
    expect(Array.from({ length: 8 }, () => other.integer(0, 1_000_000))).not.toEqual(firstValues);
  });

  it("discovers variable Pokémon and move counts without treating a lookup-table file as Pokémon data", () => {
    const project = makeProject();

    expect(randomizerProjectCounts(project)).toEqual({
      pokemon: 5,
      moves: 8,
      trainers: 1,
      encounters: 1,
      grottos: 1,
      shops: 1,
      starters: 0,
      gifts: 0,
      giftEggs: 0,
      inGameTrades: 0,
    });
  });

  it("applies the same settings and seed deterministically across expanded data archives", () => {
    const first = makeProject();
    const second = makeProject();
    const settings = enabledSettings("expanded-seed");

    const firstResult = randomizeProject(first, settings);
    const secondResult = randomizeProject(second, settings);
    materializeProjectEdits(first);
    materializeProjectEdits(second);

    expect(snapshot(first)).toEqual(snapshot(second));
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.changes).toMatchObject({
      pokemon: 5,
      moves: 8,
      evolutions: 2,
      learnsets: 5,
      eggMoves: 5,
      trainers: 1,
      encounters: 1,
      grottos: 1,
      shops: 1,
    });
    expect(first.narcs.personal?.dirty.has(5)).toBe(true);
    expect(first.narcs.moves?.dirty.has(8)).toBe(true);
    expect(first.narcs.trpok?.rawFiles[1]).toHaveLength(40);
    expect(first.narcs.trpok?.rawFiles[1].slice(-4)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("changes the output when the seed changes", () => {
    const first = makeProject();
    const second = makeProject();

    randomizeProject(first, enabledSettings("seed-a"));
    randomizeProject(second, enabledSettings("seed-b"));

    expect(snapshot(first)).not.toEqual(snapshot(second));
  });

  it("fills all discovered Gen 5 TM/HM compatibility bits", () => {
    const project = makeProject();
    const settings = defaultRandomizerSettings("full-compat");
    settings.tmCompatibility.mode = "full";

    const result = randomizeProject(project, settings);
    const species = decodeRecord(project, "personal", 5).raw;

    expect(result.changes.tmCompatibility).toBe(5);
    expect(species?.["tm_1-32"]).toBe(2 ** 32 - 1);
    expect(species?.["tm_33-64"]).toBe(2 ** 32 - 1);
    expect(species?.["tm_65-95+hm_1"]).toBe(2 ** 32 - 1);
    expect(species?.["hm_2-6"]).toBe(31);
  });

  it("does not assign Fairy typing when the loaded ROM has no Fairy support", () => {
    const project = makeProject();
    const settings = defaultRandomizerSettings("no-fairy");
    settings.pokemon.types = "completely-random";
    settings.moveData.types = true;

    randomizeProject(project, settings);

    for (const speciesId of [1, 2, 4, 5, 6]) {
      const raw = decodeRecord(project, "personal", speciesId).raw;
      expect(raw?.type_1).toBeLessThanOrEqual(16);
      expect(raw?.type_2).toBeLessThanOrEqual(16);
    }
    for (let moveId = 1; moveId <= 8; moveId += 1) expect(decodeRecord(project, "moves", moveId).raw?.type).toBeLessThanOrEqual(16);
  });

  it("randomizes relocated starter scripts, gift Pokémon, eggs, and variable trade records", () => {
    const project = makeProject();
    project.narcs.scripts = makeStore("scripts", [
      makeStarterScript([1, 2, 4]),
      makeScriptFile([0x10c, 0x8010, 1, 0, 10]),
      makeScriptFile([0x10f, 0x8010, 2, 0]),
    ]);
    project.narcs.ingame_trades = makeStore("ingame_trades", [makeTrade(1, 2), new Uint8Array(12)]);
    const settings = defaultRandomizerSettings("scripted-pokemon");
    settings.starters.mode = "random";
    settings.gifts.mode = "similar-strength";
    settings.inGameTrades.mode = "random-given-requested";
    settings.inGameTrades.randomizeIvs = true;
    settings.inGameTrades.randomizeHeldItems = true;

    const result = randomizeProject(project, settings);

    expect(result.changes).toMatchObject({ starters: 3, gifts: 1, giftEggs: 1, inGameTrades: 1 });
    expect(project.narcs.scripts.dirty).toEqual(new Set([0, 1, 2]));
    expect(project.narcs.ingame_trades.dirty).toEqual(new Set([0]));
    expect(project.narcs.ingame_trades.rawFiles[1]).toEqual(new Uint8Array(12));
  });
});

function enabledSettings(seed: string) {
  const settings = defaultRandomizerSettings(seed);
  settings.pokemon.baseStats = "random";
  settings.pokemon.types = "completely-random";
  settings.pokemon.abilities = "random";
  settings.pokemon.heldItems = "random";
  settings.evolutions.mode = "random";
  settings.evolutions.forceChange = false;
  settings.evolutions.maxThreeStages = false;
  settings.movesets.mode = "prefer-same-type";
  settings.movesets.forceGoodDamaging = true;
  settings.moveData.powers = true;
  settings.moveData.types = true;
  settings.trainers.mode = "distributed";
  settings.trainers.levelModifierPercent = 10;
  settings.trainers.betterMovesets = true;
  settings.trainers.randomHeldItems = true;
  settings.wild.scope = "game";
  settings.wild.levelModifierPercent = 5;
  settings.grottos.randomizePokemon = true;
  settings.grottos.randomizeItems = true;
  settings.shops.mode = "random";
  return settings;
}

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const personalLength = byteLength(formats.personal!);
  const personalFiles = Array.from({ length: 6 }, (_unused, id) => packRow(formats.personal!, {
    base_hp: 40 + id,
    base_atk: 45 + id,
    base_def: 50 + id,
    base_speed: 55 + id,
    base_spatk: 60 + id,
    base_spdef: 65 + id,
    type_1: id % 4,
    type_2: id % 4,
    catchrate: 45,
    exp_rate: id % 6,
    ability_1: 1,
    ability_2: 2,
    ability_3: 3,
    num_forms: 1,
  }));
  personalFiles.splice(3, 0, new Uint8Array(personalLength + 17));

  const moveFiles = Array.from({ length: 9 }, (_unused, id) => packRow(formats.moves!, {
    type: id % 4,
    category: id === 0 ? 0 : id % 2 + 1,
    power: id === 0 ? 0 : 35 + id * 5,
    accuracy: id === 0 ? 0 : 90,
    pp: id === 0 ? 0 : 15,
  }));
  const itemFiles = Array.from({ length: 7 }, (_unused, id) => packRow(formats.items!, { market_value: id * 10 }));
  const evolutionFiles = Array.from({ length: 7 }, (_unused, id) => packRow(formats.evolutions!, id > 0 && id < 4 ? { method_0: 4, param_0: id * 10, target_0: id + 1 } : {}));
  const learnsetFiles = Array.from({ length: 7 }, (_unused, id) => makeLearnset([1 + id % 4, 5 + id % 4]));
  const eggMoveFiles = Array.from({ length: 7 }, (_unused, id) => makeEggMoves([1 + id % 4, 5 + id % 4]));

  const trdataFiles = [packRow(formats.trdata!, {}), packRow(formats.trdata!, { template: 3, num_pokemon: 2 })];
  const trainerParty = makeTrpok([{ species: 1, level: 12 }, { species: 2, level: 18 }]);
  const trainerPartyWithHackBytes = new Uint8Array(trainerParty.length + 4);
  trainerPartyWithHackBytes.set(trainerParty);
  trainerPartyWithHackBytes.set([0xde, 0xad, 0xbe, 0xef], trainerParty.length);
  const trpokFiles = [new Uint8Array(), trainerPartyWithHackBytes];
  const encounters = packRow(formats.encounters!, {
    spring_grass_rate: 20,
    spring_grass_slot_0: 1,
    spring_grass_slot_0_min_level: 5,
    spring_grass_slot_0_max_level: 7,
    spring_grass_slot_1: 2,
    spring_grass_slot_1_min_level: 6,
    spring_grass_slot_1_max_level: 8,
  });
  const grotto = packRow(formats.grottos!, {
    black_common_pok_0: 1,
    black_common_min_lvl_0: 10,
    black_common_max_lvl_0: 15,
    white_common_pok_0: 2,
    white_common_min_lvl_0: 10,
    white_common_max_lvl_0: 15,
    normal_common_item_0: 1,
    hidden_common_item_0: 2,
  });
  const mart = packRow(formats.marts!, { item_0: 1, item_1: 2, item_2: 3 });

  return {
    session: {
      romName: "expanded-test",
      generation: "gen5",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", personalFiles),
      moves: makeStore("moves", moveFiles),
      items: makeStore("items", itemFiles),
      evolutions: makeStore("evolutions", evolutionFiles),
      learnsets: makeStore("learnsets", learnsetFiles),
      egg_moves: makeStore("egg_moves", eggMoveFiles),
      trdata: makeStore("trdata", trdataFiles),
      trpok: makeStore("trpok", trpokFiles),
      encounters: makeStore("encounters", [encounters]),
      grottos: makeStore("grottos", [grotto]),
      marts: makeStore("marts", [mart]),
      mart_counts: makeStore("mart_counts", [new Uint8Array([3])]),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: ["None", "Alpha", "Beta", "Lookup Hole", "Gamma", "Delta", "Epsilon"],
        moves: ["None", "Pound", "Ember", "Water Gun", "Vine Whip", "Rock Throw", "Confusion", "Bite", "Custom Beam"],
        items: ["None", "Potion", "Fire Stone", "X Attack", "Rare Candy", "Leftovers", "Custom Charm"],
        abilities: ["None", "Overgrow", "Blaze", "Torrent", "Pressure", "Intimidate"],
      },
    },
    formats,
    trpokInfo: [{ template: 0, numPokemon: 0 }, { template: 3, numPokemon: 2 }],
    tms: makeTmState(),
  };
}

function makeTmState(): NonNullable<ProjectState["tms"]> {
  const raw: Record<string, number> = {};
  const readable: Record<string, string> = {};
  for (let index = 1; index <= 95; index += 1) {
    raw[`tm_${index}`] = 1 + index % 8;
    readable[`tm_${index}`] = `Move ${raw[`tm_${index}`]}`;
  }
  for (let index = 1; index <= 6; index += 1) {
    raw[`hm_${index}`] = index;
    readable[`hm_${index}`] = `Move ${index}`;
  }
  return { offset: 0, byteLength: 202, raw, readable, dirty: false };
}

function makeStore(name: NarcName, files: Uint8Array[]): NarcStore {
  return { name, fileId: 1, sourcePath: "test", fileCount: files.length, rawFiles: files, records: new Map(), dirty: new Set() };
}

function packRow(format: FieldSpec[], values: Record<string, number>): Uint8Array {
  const out = new Uint8Array(byteLength(format));
  let offset = 0;
  for (const [size, field] of format) {
    writeInt(out, offset, size, values[field] ?? 0);
    offset += size;
  }
  return out;
}

function makeLearnset(moveIds: number[]): Uint8Array {
  const out = new Uint8Array(moveIds.length * 4 + 4);
  moveIds.forEach((moveId, index) => {
    writeInt(out, index * 4, 2, moveId);
    writeInt(out, index * 4 + 2, 2, index === 0 ? 1 : 10);
  });
  writeInt(out, moveIds.length * 4, 2, 0xffff);
  writeInt(out, moveIds.length * 4 + 2, 2, 0xffff);
  return out;
}

function makeEggMoves(moveIds: number[]): Uint8Array {
  const out = new Uint8Array(2 + moveIds.length * 2);
  writeInt(out, 0, 2, moveIds.length);
  moveIds.forEach((moveId, index) => writeInt(out, 2 + index * 2, 2, moveId));
  return out;
}

function makeTrpok(party: Array<{ species: number; level: number }>): Uint8Array {
  const out = new Uint8Array(party.length * 18);
  party.forEach((pokemon, slot) => {
    const offset = slot * 18;
    writeInt(out, offset, 1, 20);
    writeInt(out, offset + 1, 1, 1);
    writeInt(out, offset + 2, 1, pokemon.level);
    writeInt(out, offset + 4, 2, pokemon.species);
    writeInt(out, offset + 8, 2, 1);
    for (let move = 0; move < 4; move += 1) writeInt(out, offset + 10 + move * 2, 2, move + 1);
  });
  return out;
}

function makeStarterScript(speciesIds: number[]): Uint8Array {
  const out = new Uint8Array(43);
  let offset = 0;
  for (const speciesId of speciesIds) {
    writeInt(out, offset, 2, 0x28);
    writeInt(out, offset + 2, 2, 0x8025);
    writeInt(out, offset + 4, 2, speciesId);
    offset += 6;
    writeInt(out, offset, 2, 0x57);
    out[offset + 2] = 1;
    writeInt(out, offset + 3, 2, speciesId);
    offset += 5;
  }
  writeInt(out, offset, 2, 0x10c);
  writeInt(out, offset + 2, 2, 0x8010);
  writeInt(out, offset + 4, 2, 0x8025);
  writeInt(out, offset + 8, 2, 5);
  return out;
}

function makeScriptFile(words: number[]): Uint8Array {
  const out = new Uint8Array(8 + words.length * 2);
  writeInt(out, 0, 4, 4);
  writeInt(out, 4, 2, 0xfd13);
  words.forEach((word, index) => writeInt(out, 8 + index * 2, 2, word));
  return out;
}

function makeTrade(given: number, requested: number): Uint8Array {
  const out = new Uint8Array(108);
  writeInt(out, 4, 4, given);
  writeInt(out, 0x5c, 4, requested);
  return out;
}

function byteLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (index * 8)) & 0xff;
}

function snapshot(project: ProjectState): unknown {
  const names: NarcName[] = ["personal", "moves", "evolutions", "learnsets", "egg_moves", "trpok", "encounters", "grottos", "marts", "items"];
  return names.map((name) => project.narcs[name]?.rawFiles.map((bytes) => Array.from(bytes)) ?? []);
}
