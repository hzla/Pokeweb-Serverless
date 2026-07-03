import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import {
  GEN5_CALC_BRIDGE_CONFIG,
  generateCalcDownload,
  generateCalcBridgePayload,
  generateDexDownloads,
  generateTextDocsDownload,
  enrichItemLocations,
  enrichTrainerLocations,
  parseGroundItemScripts,
  parseTrainerBattleScripts,
} from "../pokeweb/docGeneratorModel";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { OVERWORLD_GROUP_FORMATS, OVERWORLD_HEADER_FORMAT } from "../pokeweb/overworldModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { TYPE_CHART_OFFSET, TYPE_CHART_TYPES, updateTypeChartValue } from "../pokeweb/typeChartModel";

describe("docGeneratorModel", () => {
  it("wraps calc payloads in backup_data and injects the ROM title", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");

    expect(file.filename).toBe("voltwhiteplus-calc.js");
    expect(file.contents.startsWith("backup_data = ")).toBe(true);
    expect(file.contents).toContain('"title": "Volt White Plus"');
  });

  it("builds Gen 5 Dynamic Calc bridge payloads from generated calc data", () => {
    const project = makeProject();
    const payload = generateCalcBridgePayload(project, "Volt White Plus");

    expect(payload).toMatchObject({
      type: "ddex:calc-sync",
      config: GEN5_CALC_BRIDGE_CONFIG,
      fileName: "voltwhiteplus_npoint_data.js",
      sourceGen: 5,
      title: "Volt White Plus",
    });
    expect(payload.scriptText.startsWith("var backup_data = ")).toBe(true);
    expect(payload.scriptText.endsWith(";")).toBe(true);
    expect(payload.scriptText).toContain('"title": "Volt White Plus"');
  });

  it("packages Pokemon, move, and trainer text docs in one zip", () => {
    const project = makeProject();
    const file = generateTextDocsDownload(project, "Volt White Plus");
    const zipText = new TextDecoder().decode(file.contents);

    expect(file.filename).toBe("voltwhiteplus_text_docs.zip");
    expect(file.mimeType).toBe("application/zip");
    expect(zipText).toContain("voltwhiteplus_pokedex.txt");
    expect(zipText).toContain("voltwhiteplus_moves.txt");
    expect(zipText).toContain("voltwhiteplus_trainers.txt");
    expect(zipText).toContain("1 - Bulbasaur");
  });

  it("parses global item scripts for StoreInVar/WorkSetConst ground item ids", () => {
    const map = parseGroundItemScripts(makeGroundItemScriptBytes());

    expect(map.get(7001)).toBe(25);
    expect(map.has(7000)).toBe(false);
  });

  it("parses direct trainer battle commands from local script files", () => {
    expect(parseTrainerBattleScripts(makeTrainerBattleScriptBytes(), 20)).toEqual([7, 6]);
  });

  it("enriches trainer locations from overworld script ids", () => {
    const project = makeProject();
    const result = enrichTrainerLocations(project);

    expect(result.count).toBe(3);
    expect(project.docs?.trainerLocations).toEqual({ "6": ["Black City"], "7": ["Black City"] });
    expect(project.docs?.trainerDiffs).toEqual({ "6": 3, "7": 3 });
  });

  it("adds trainer difficulty adjustments to generated calc sets", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(payload.formatted_sets.Bulbasaur["Lvl 42 Ace Trainer Dan - Black City"].diff).toBe(3);
  });

  it("keeps one-based Pokemon and move replacement maps aligned with vanilla names", () => {
    const project = makeProject();
    project.texts.banks.pokedex = ["None", "Bulbasaur", "Saplingasaur", "Venusaur", "Charmander"];
    project.texts.banks.moves = ["None", "Pound", "Karate Chop", "Double Slap", "Meteor Punch"];
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(payload.pok_replacements).toEqual({ ivysaur: "saplingasaur" });
    expect(payload.move_replacements).toEqual({ cometpunch: "meteorpunch" });
    expect(payload.pok_replacements).not.toMatchObject({ ivysaur: "bulbasaur", charmander: "venusaur" });
    expect(payload.move_replacements).not.toMatchObject({ karatechop: "pound", doubleslap: "karatechop" });
  });

  it("normalizes calc item names to Showdown spellings", () => {
    const project = makeProject();
    project.texts.banks.items![25] = "BlackGlasses";
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(Object.values(payload.item_replacements)).toContain("blackglasses");
    expect(payload.poks.Bulbasaur.items).toEqual(["Black Glasses", "None", "None"]);
    expect(payload.formatted_sets.Bulbasaur["Lvl 42 Ace Trainer Dan - Black City"].reward_item).toBe("Black Glasses");
  });

  it("exports alt form personal records and trainer abilities to calc and dex data", () => {
    const project = makeProject();
    const calcFile = generateCalcDownload(project, "Volt White Plus");
    const calcPayload = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));
    const [dexFile] = generateDexDownloads(project, "Volt White Plus");
    const dexPayload = JSON.parse(String(dexFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, ""));

    expect(calcPayload.poks["Deoxys-Attack"]).toMatchObject({
      name: "Deoxys-Attack",
      num: 5,
      bs: { hp: 55, at: 100 },
      abs: ["Pressure", "None", "None"],
    });
    expect(dexPayload.poks["Deoxys-Attack"]).toMatchObject({ name: "Deoxys-Attack", num: 5 });
    expect(calcPayload.formatted_sets["Deoxys-Attack"]["Lvl 43 Ace Trainer Dan - Black City"]).toMatchObject({
      ability: "Pressure",
      form: 1,
    });
    expect(calcPayload.formatted_sets.Deoxys).toBeUndefined();
  });

  it("exports Cascade White custom AI abilities to calc data", () => {
    const project = makeProject();
    project.codeInjection = {
      modules: [{ path: "patches/A2_AIChanges.dll", target: "patches", fileName: "A2_AIChanges.dll" }],
    };
    project.narcs.trpok!.rawFiles[7][1] = 64;
    project.narcs.trpok!.records.clear();

    const calcFile = generateCalcDownload(project, "Cascade White");
    const calcPayload = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(calcPayload.poks.Bulbasaur.abs).toEqual(["Overgrow", "None", "None", "Drought", "Chlorophyll", "Flower Gift"]);
    expect(calcPayload.formatted_sets.Bulbasaur["Lvl 42 Ace Trainer Dan - Black City"].ability).toBe("Drought");
  });

  it("exports edited type charts in calc backup data", () => {
    const project = makeProject();
    project.overlays[167] = makeTypeChartOverlay(TYPE_CHART_TYPES.length);
    updateTypeChartValue(project, 0, 0, 2);
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(payload.type_chart.Normal.Normal).toBe(0.5);
    expect(payload.type_chart.Normal.Ghost).toBe(1);
    expect(payload.type_chart).toHaveProperty("Dark");
    expect(payload.type_chart).not.toHaveProperty("Fairy");
  });

  it("exports ddex encounter tables with slot rates and levels", () => {
    const project = makeProject();
    const [overrideFile, searchIndexFile] = generateDexDownloads(project, "Volt White Plus");
    const overrideContents = String(overrideFile.contents);
    const searchIndexContents = String(searchIndexFile.contents);
    const overrides = JSON.parse(overrideContents.replace(/^overrides = /u, "").replace(/;\n$/u, ""));

    expect(overrides.encs.rates.grass).toEqual([20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]);
    expect(overrides.encs.blackcity).toMatchObject({
      name: "Black City",
      grass: {
        rates: [20, 10],
        encs: [
          { s: "Bulbasaur", mn: 5, mx: 7 },
          { s: "Ivysaur", mn: 6, mx: 8 },
        ],
      },
      gift: {
        rates: [100, 100],
        encs: [
          { s: "Bulbasaur", mn: 10 },
          { s: "Ivysaur", mn: 1 },
        ],
      },
      static: {
        rates: [100],
        encs: [{ s: "Bulbasaur", mn: 12 }],
      },
    });
    expect(overrides.encs.rates.gift).toEqual([100]);
    expect(overrides.encs.rates.static).toEqual([100]);
    expect(searchIndexContents).toContain("blackcity");
    expect(searchIndexContents).not.toContain('"rates","location"');
  });

  it("exports script encounters from level scripts when a location has no wild table", () => {
    const project = makeProject();
    delete project.narcs.encounters;
    project.headers = {
      count: 1,
      rows: {
        1: { index: 0, location_name: "Black City", script_id: 0, level_script_id: 3 },
      },
    } as ProjectState["headers"];

    const [overrideFile] = generateDexDownloads(project, "Volt White Plus");
    const overrides = JSON.parse(String(overrideFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, ""));

    expect(overrides.encs.blackcity).toMatchObject({
      name: "Black City",
      wilds: [],
      gift: {
        rates: [100, 100],
        encs: [
          { s: "Bulbasaur", mn: 10 },
          { s: "Ivysaur", mn: 1 },
        ],
      },
      static: {
        rates: [100],
        encs: [{ s: "Bulbasaur", mn: 12 }],
      },
    });
  });

  it("fills trainer calc moves from learnsets when trainers have no explicit moves", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(payload.formatted_sets.Bulbasaur["Lvl 42 Ace Trainer Dan - Black City"].moves).toEqual([
      "Sleep Powder",
      "Razor Leaf",
      "Vine Whip",
      "Tackle",
    ]);
    expect(project.narcs.trdata?.dirty.size).toBe(0);
    expect(project.narcs.trpok?.dirty.size).toBe(0);
  });

  it("enriches item locations from global item scripts and overworlds", () => {
    const project = makeProject();
    const result = enrichItemLocations(project);

    expect(result.count).toBe(4);
    expect(project.docs?.groundItemScriptMap).toEqual({ "7001": 25 });
    expect(project.docs?.itemLocations["25"]).toEqual(
      expect.arrayContaining(["Black City", "Wild held by Bulbasaur", "Reward from Ace Trainer Dan"]),
    );
    expect(project.docs?.itemLocations["25"].some((source) => source.startsWith("Sold at "))).toBe(true);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const headerFormat = formats.headers;
  if (!headerFormat) throw new Error("Missing header format");

  const scripts: Uint8Array[] = Array.from({ length: 1241 }, () => new Uint8Array());
  scripts[3] = makeTrainerBattleScriptBytes();
  scripts[1240] = makeGroundItemScriptBytes();
  const trpokFiles: Uint8Array[] = Array.from({ length: 8 }, () => new Uint8Array());
  trpokFiles[7] = packRows(
    [
      [1, "ivs"],
      [1, "ability"],
      [1, "level"],
      [1, "padding"],
      [2, "species_id"],
      [2, "form"],
    ],
    [
      { ivs: 255, ability: 16, level: 42, species_id: 1, form: 0 },
      { ivs: 255, ability: 16, level: 43, species_id: 4, form: 1 },
    ],
  );

  return {
    session: {
      romName: "test-rom",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      headers: makeStore("headers", [packRows(headerFormat, [{ map_id: 0, script_id: 3, encounter_id: 0, location_name_id: 0, name_icon: 0x6000 }])], 1),
      overworlds: makeStore("overworlds", [makeOverworldBytes()], 1),
      scripts: makeStore("scripts", scripts, scripts.length),
      items: makeStore("items", Array.from({ length: 26 }, () => new Uint8Array()), 26),
      personal: makeStore(
        "personal",
        [
          packRows(formats.personal!, [{}]),
          packRows(formats.personal!, [{ base_hp: 45, item_1: 25, ability_1: 1 }]),
          packRows(formats.personal!, [{}]),
          packRows(formats.personal!, [{}]),
          packRows(formats.personal!, [{ base_hp: 50, ability_1: 1, form_id: 5, num_forms: 2 }]),
          packRows(formats.personal!, [{ base_hp: 55, base_atk: 100, ability_1: 2 }]),
        ],
        6,
      ),
      learnsets: makeStore(
        "learnsets",
        [
          new Uint8Array(),
          packRows(formats.learnsets!, [
            {
              move_id_0: 1,
              lvl_learned_0: 1,
              move_id_1: 2,
              lvl_learned_1: 15,
              move_id_2: 4,
              lvl_learned_2: 28,
              move_id_3: 5,
              lvl_learned_3: 35,
              move_id_4: 6,
              lvl_learned_4: 45,
            },
          ]),
        ],
        2,
      ),
      evolutions: makeStore("evolutions", [], 0),
      moves: makeStore("moves", [], 0),
      trdata: makeStore(
        "trdata",
        Array.from({ length: 8 }, (_, index) =>
          packRows(formats.trdata!, [index === 7 ? { class: 1, reward_item: 25, num_pokemon: 2 } : {}]),
        ),
        8,
      ),
      trpok: makeStore("trpok", trpokFiles, trpokFiles.length),
      encounters: makeStore(
        "encounters",
        [
          packRows(formats.encounters!, [
            {
              spring_grass_slot_0: 1,
              spring_grass_slot_0_min_level: 5,
              spring_grass_slot_0_max_level: 7,
              spring_grass_slot_2: 2,
              spring_grass_slot_2_min_level: 6,
              spring_grass_slot_2_max_level: 8,
            },
          ]),
        ],
        1,
      ),
      marts: makeStore("marts", [packRows(formats.marts!, [{ item_0: 25 }])], 1),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        locations: ["Black City"],
        pokedex: ["None", "Bulbasaur", "Ivysaur", "Pokemon 3", "Deoxys"],
        moves: ["None", "Tackle", "Vine Whip", "Growl", "Razor Leaf", "Sleep Powder", "Solar Beam"],
        items: Array.from({ length: 26 }, (_, index) => (index === 25 ? "Potion" : index === 0 ? "None" : `Item ${index}`)),
        abilities: ["None", "Overgrow", "Pressure"],
        tr_names: Array.from({ length: 8 }, (_, index) => (index === 7 ? "Dan" : `Trainer ${index}`)),
        tr_classes: ["None", "Ace Trainer"],
      },
    },
    formats,
    trpokInfo: Array.from({ length: 8 }, (_, index) => (index === 7 ? { template: 0, numPokemon: 2 } : { template: 0, numPokemon: 0 })),
    docs: { romTitle: "test-rom", trainerLocations: {}, trainerDiffs: {}, itemLocations: {}, groundItemScriptMap: {} },
  };
}

function makeGroundItemScriptBytes(): Uint8Array {
  const out = new Uint8Array(26);
  writeInt(out, 0, 4, 6);
  writeInt(out, 4, 4, 10);
  writeInt(out, 8, 2, 0xfd13);
  writeInt(out, 10, 2, 0x0002);
  writeInt(out, 18, 2, 0x0028);
  writeInt(out, 20, 2, 32780);
  writeInt(out, 22, 2, 25);
  writeInt(out, 24, 2, 0x0002);
  return out;
}

function makeTrainerBattleScriptBytes(): Uint8Array {
  const out = new Uint8Array(54);
  writeInt(out, 0, 4, 4);
  writeInt(out, 4, 2, 0xfd13);
  writeInt(out, 8, 2, 0x0085);
  writeInt(out, 10, 2, 7);
  writeInt(out, 12, 2, 0);
  writeInt(out, 14, 2, 1);
  writeInt(out, 16, 2, 0x0086);
  writeInt(out, 18, 2, 0);
  writeInt(out, 20, 2, 6);
  writeInt(out, 22, 2, 0);
  writeInt(out, 24, 2, 1);
  writeInt(out, 26, 2, 0x010c);
  writeInt(out, 28, 2, 0);
  writeInt(out, 30, 2, 1);
  writeInt(out, 32, 2, 0);
  writeInt(out, 34, 2, 10);
  writeInt(out, 36, 2, 0x010f);
  writeInt(out, 38, 2, 0);
  writeInt(out, 40, 2, 2);
  writeInt(out, 42, 2, 0);
  writeInt(out, 44, 2, 0x0174);
  writeInt(out, 46, 2, 1);
  writeInt(out, 48, 2, 12);
  writeInt(out, 50, 2, 0);
  writeInt(out, 52, 2, 0x0002);
  return out;
}

function makeOverworldBytes(): Uint8Array {
  const out = new Uint8Array(8 + 36 * 2);
  let offset = 0;
  const raw: Record<string, number> = {
    file_length: out.length,
    furniture_count: 0,
    npc_count: 2,
    warp_count: 0,
    trigger_count: 0,
    npc_0_script_id: 3007,
    npc_1_script_id: 7001,
  };
  for (const [size, field] of OVERWORLD_HEADER_FORMAT) {
    writeInt(out, offset, size, raw[field] ?? 0);
    offset += size;
  }
  for (let npc = 0; npc < 2; npc += 1) {
    for (const [size, field] of OVERWORLD_GROUP_FORMATS.npc) {
      writeInt(out, offset, size, raw[`npc_${npc}_${field}`] ?? 0);
      offset += size;
    }
  }
  return out;
}

function makeStore(name: NarcName, data: Uint8Array[], count: number): NarcStore {
  return {
    name,
    fileId: 0,
    sourcePath: name,
    fileCount: count,
    rawFiles: data,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeTypeChartOverlay(typeCount: number): Uint8Array {
  const out = new Uint8Array(TYPE_CHART_OFFSET + typeCount * typeCount + 16);
  out.fill(4, TYPE_CHART_OFFSET, TYPE_CHART_OFFSET + typeCount * typeCount);
  return out;
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

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
