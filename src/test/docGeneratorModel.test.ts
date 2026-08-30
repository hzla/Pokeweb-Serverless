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
  trainerPokemonExportName,
} from "../pokeweb/docGeneratorModel";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { OVERWORLD_GROUP_FORMATS, OVERWORLD_HEADER_FORMAT } from "../pokeweb/overworldModel";
import { decodeRecord, markDirty, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { TYPE_CHART_OFFSET, TYPE_CHART_TYPES, updateTypeChartValue } from "../pokeweb/typeChartModel";

describe("docGeneratorModel", () => {
  it("wraps calc payloads in backup_data and injects the ROM title", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");

    expect(file.filename).toBe("voltwhiteplus-calc.js");
    expect(file.contents.startsWith("backup_data = ")).toBe(true);
    expect(file.contents).toContain('"title": "Volt White Plus"');
  });

  it("skips editor-only tutor move lookups for calc and dex Pokemon exports", () => {
    const project = makeProject();
    const moves = project.texts.banks.moves ?? [];
    let findIndexCalls = 0;
    project.texts.banks.moves = new Proxy(moves, {
      get(target, property, receiver) {
        if (property === "findIndex") findIndexCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    generateCalcDownload(project, "Volt White Plus");
    generateDexDownloads(project, "Volt White Plus");

    expect(findIndexCalls).toBe(0);
  });

  it("exports ability descriptions and BW2 tutor compatibility in the legacy dex payload shape", () => {
    const project = makeProject();
    project.texts.messageTexts = Array.from({ length: 376 }, () => []);
    project.texts.messageTexts[375] = [
      ["0_0", " -", 0],
      ["0_1", "Powers up Grass-type moves\\nwhen in trouble.", 0],
      ["0_2", "The Pokemon raises opposing PP usage.", 0],
    ];

    const bulbasaur = decodeRecord(project, "personal", 1).raw!;
    bulbasaur.tutors = 2 ** 0;
    bulbasaur.driftveil_tutor = 2 ** 6;
    bulbasaur.lentimas_tutor = 2 ** 12;
    bulbasaur.humilau_tutor = 2 ** 10;
    bulbasaur.nacrene_tutor = 2 ** 13;

    const tutorBytes = new Uint8Array(60 * 12);
    writeInt(tutorBytes, 19 * 12, 4, 6); // Driftveil slot 6 -> Solar Beam
    writeInt(tutorBytes, 55 * 12, 4, 4); // Lentimas slot 12 -> Razor Leaf
    writeInt(tutorBytes, 10 * 12, 4, 2); // Humilau slot 10 -> Vine Whip
    writeInt(tutorBytes, 41 * 12, 4, 3); // Nacrene slot 13 -> Growl
    project.narcs.tutor_moves = makeStore("tutor_moves", [tutorBytes], 1);

    const [file] = generateDexDownloads(project, "Volt White Plus");
    const payload = JSON.parse(String(file.contents).replace(/^overrides = /u, "").replace(/;\n$/u, ""));

    expect(payload.abilities.overgrow).toEqual({
      name: "Overgrow",
      desc: "Powers up Grass-type moves when in trouble.",
    });
    expect(payload.abilities.pressure).toEqual({
      name: "Pressure",
      desc: "The Pokemon raises opposing PP usage.",
    });
    expect(payload.poks.Bulbasaur.learnset_info.tutors).toEqual([
      "Grass Pledge",
      "Solar Beam",
      "Razor Leaf",
      "Vine Whip",
      "Growl",
    ]);
    expect(payload.poks.Ivysaur.learnset_info.tutors).toEqual([]);
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

  it("exports trainer NARC member indexes as calc trainer IDs", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));
    const exportedSets = Object.values(payload.formatted_sets as Record<string, Record<string, { tr_id: number }>>)
      .flatMap((sets) => Object.values(sets));

    // The fixture deliberately leaves trainer members 0-6 empty. Export must
    // retain member 7, rather than compacting it to the first populated row.
    expect(exportedSets.length).toBeGreaterThan(0);
    expect(new Set(exportedSets.map((set) => set.tr_id))).toEqual(new Set([7]));

    const bridge = generateCalcBridgePayload(project, "Volt White Plus");
    const bridgePayload = JSON.parse(bridge.scriptText.replace(/^var backup_data = /u, "").replace(/;$/u, ""));
    const bridgeSets = Object.values(bridgePayload.formatted_sets as Record<string, Record<string, { tr_id: number }>>)
      .flatMap((sets) => Object.values(sets));
    expect(new Set(bridgeSets.map((set) => set.tr_id))).toEqual(new Set([7]));
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

  it("finds odd-aligned trainer battle commands and applies their header difficulty", () => {
    const project = makeProject();
    const headerFormat = project.formats.headers!;
    project.narcs.headers = makeStore(
      "headers",
      [
        packRows(
          headerFormat,
          Array.from({ length: 64 }, (_, index): Record<string, number> =>
            index === 63 ? { script_id: 126, location_name_id: 1, name_icon: 2 << 13 } : {},
          ),
        ),
      ],
      1,
    );
    project.narcs.scripts!.rawFiles[126] = makeOddAlignedTrainerBattleScriptBytes();
    project.narcs.trdata = makeStore("trdata", Array.from({ length: 768 }, () => new Uint8Array()), 768);
    project.texts.banks.locations = ["Unknown Location", "Nimbasa City"];

    enrichTrainerLocations(project);

    expect(project.docs?.trainerLocations["767"]).toContain("Nimbasa City");
    expect(project.docs?.trainerDiffs["767"]).toBe(2);
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

  it("preserves the HP acronym in Hidden Power move names", () => {
    const project = makeProject();
    setProjectMoves(project, [{}, { type: 1, category: 1, power: 60, accuracy: 100, pp: 15 }], ["None", "HP FIGHTING"]);
    const file = generateCalcDownload(project, "Volt White Plus");
    const payload = JSON.parse(file.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(payload.moves).toHaveProperty("HP Fighting");
    expect(payload.moves).not.toHaveProperty("Hp Fighting");
    expect(payload.formatted_sets.Bulbasaur["Lvl 42 Ace Trainer Dan - Black City"].moves).toContain("HP Fighting");
  });

  it("exports crit, recoil, drain, and heal metadata to calc and dex moves", () => {
    const project = makeProject();
    setProjectMoves(
      project,
      [
        {},
        { type: 1, category: 1, power: 90, accuracy: 100, pp: 20, crit: 1, recoil: 231 },
        { type: 11, effect_category: 8, category: 2, power: 75, accuracy: 100, pp: 10, recoil: 50 },
        { type: 0, effect_category: 3, category: 0, accuracy: 101, pp: 10, healing: 50, target: 7 },
        { type: 1, category: 1, power: 40, accuracy: 100, pp: 10, crit: 6 },
        { type: 0, category: 1, power: 120, accuracy: 100, pp: 15, recoil: 223 },
        { type: 1, category: 1, power: 40, accuracy: 100, pp: 10 },
        { type: 0, category: 1, power: 50, accuracy: 101, pp: 1, healing: 231 },
      ],
      ["None", "Take Down", "Giga Drain", "Recover", "Storm Throw", "Double-Edge", "Pound", "Struggle"],
    );

    const calcFile = generateCalcDownload(project, "Volt White Plus");
    const calcMoves = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, "")).moves;
    const [dexFile] = generateDexDownloads(project, "Volt White Plus");
    const dexMoves = JSON.parse(String(dexFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, "")).moves;

    for (const moves of [calcMoves, dexMoves]) {
      expect(moves["Take Down"]).toMatchObject({ critRatio: 2, recoil: [1, 4] });
      expect(moves["Giga Drain"].drain).toEqual([1, 2]);
      expect(moves.Recover.heal).toEqual([1, 2]);
      expect(moves["Storm Throw"]).toMatchObject({ critRatio: 7, willCrit: true });
      expect(moves["Double-Edge"].recoil).toEqual([33, 100]);
      expect(moves.Pound).not.toHaveProperty("critRatio");
      expect(moves.Pound).not.toHaveProperty("recoil");
      expect(moves.Pound).not.toHaveProperty("drain");
      expect(moves.Pound).not.toHaveProperty("heal");
      expect(moves.Struggle).not.toHaveProperty("heal");
    }
  });

  it("exports Sheer Force secondaries only for target afflictions, target drops, and user boosts", () => {
    const project = makeProject();
    setProjectMoves(
      project,
      [
        {},
        {
          type: 1,
          effect_category: 7,
          category: 1,
          power: 120,
          accuracy: 100,
          pp: 5,
          target: 0,
          effect: 229,
          stat_1: 2,
          stat_2: 4,
          magnitude_1: 255,
          magnitude_2: 255,
          stat_chance_1: 100,
          stat_chance_2: 100,
        },
        {
          type: 1,
          effect_category: 7,
          category: 1,
          power: 100,
          accuracy: 90,
          pp: 10,
          target: 0,
          effect: 218,
          stat_1: 5,
          magnitude_1: 255,
          stat_chance_1: 100,
        },
        {
          type: 8,
          effect_category: 7,
          category: 1,
          power: 100,
          accuracy: 85,
          pp: 10,
          target: 0,
          effect: 139,
          stat_1: 1,
          magnitude_1: 1,
          stat_chance_1: 20,
        },
        {
          type: 7,
          effect_category: 6,
          category: 2,
          power: 80,
          accuracy: 100,
          pp: 15,
          target: 0,
          effect: 72,
          stat_1: 4,
          magnitude_1: 255,
          stat_chance_1: 20,
        },
        {
          type: 9,
          effect_category: 4,
          category: 2,
          power: 95,
          accuracy: 100,
          pp: 15,
          target: 0,
          result_effect: 4,
          effect_chance: 10,
          status: 1,
          effect: 4,
        },
        {
          type: 0,
          effect_category: 2,
          category: 0,
          power: 0,
          accuracy: 101,
          pp: 40,
          target: 7,
          effect: 10,
          stat_1: 1,
          magnitude_1: 1,
        },
        {
          type: 0,
          effect_category: 2,
          category: 0,
          power: 0,
          accuracy: 100,
          pp: 40,
          target: 5,
          effect: 18,
          stat_1: 1,
          magnitude_1: 255,
        },
      ],
      ["None", "Close Combat", "Hammer Arm", "Meteor Mash", "Shadow Ball", "Flamethrower", "Howl", "Growl"],
    );
    const calcFile = generateCalcDownload(project, "Volt White Plus");
    const calcPayload = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));
    const [dexFile] = generateDexDownloads(project, "Volt White Plus");
    const dexPayload = JSON.parse(String(dexFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, ""));

    expect(calcPayload.moves["Close Combat"]).not.toHaveProperty("secondaries");
    expect(calcPayload.moves["Hammer Arm"]).not.toHaveProperty("secondaries");
    expect(calcPayload.moves["Meteor Mash"].secondaries).toBe(true);
    expect(calcPayload.moves["Shadow Ball"].secondaries).toBe(true);
    expect(calcPayload.moves.Flamethrower.secondaries).toBe(true);
    expect(calcPayload.moves.Howl.secondaries).toBe(true);
    expect(calcPayload.moves.Growl.secondaries).toBe(true);
    expect(Object.values(calcPayload.moves).some((move) => Object.hasOwn(move as object, "sf"))).toBe(false);

    expect(dexPayload.moves["Close Combat"]).not.toHaveProperty("secondaries");
    expect(dexPayload.moves["Hammer Arm"]).not.toHaveProperty("secondaries");
    expect(dexPayload.moves["Meteor Mash"].secondaries).toBe(true);
    expect(dexPayload.moves["Shadow Ball"].secondaries).toBe(true);
    expect(dexPayload.moves.Flamethrower.secondaries).toBe(true);
    expect(Object.values(dexPayload.moves).some((move) => Object.hasOwn(move as object, "sf"))).toBe(false);
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
    expect(dexPayload.poks.Deoxys).toMatchObject({
      baseForme: "Base",
      otherFormes: ["Deoxys-Attack"],
      formeOrder: ["Deoxys", "Deoxys-Attack"],
    });
    expect(dexPayload.poks["Deoxys-Attack"]).toMatchObject({
      name: "Deoxys-Attack",
      num: 5,
      baseSpecies: "Deoxys",
      forme: "Attack",
    });
    expect(calcPayload.formatted_sets["Deoxys-Attack"]["Lvl 43 Ace Trainer Dan - Black City"]).toMatchObject({
      ability: "Pressure",
      form: 1,
    });
    expect(calcPayload.formatted_sets.Deoxys).toBeUndefined();
  });

  it("invalidates cached form relationships after personal data changes", () => {
    const project = makeProject();
    expect(trainerPokemonExportName(project, trainerSlot(5, 0))).toBe("Deoxys-Attack");

    const base = decodeRecord(project, "personal", 4).raw!;
    base.form_id = 0;
    base.num_forms = 1;
    markDirty(project, "personal", 4);

    expect(trainerPokemonExportName(project, trainerSlot(5, 0))).toBe("Pokemon 5");
  });

  it("exports newly appended known-species and custom-species forms for DDex navigation", () => {
    const project = makeProject();
    const personal = project.narcs.personal!;
    const personalFormat = project.formats.personal!;
    personal.rawFiles[1] = packRows(personalFormat, [{ base_hp: 45, item_1: 25, ability_1: 1, form_id: 6, num_forms: 2 }]);
    personal.rawFiles.push(
      packRows(personalFormat, [{ base_hp: 46, item_1: 25, ability_1: 1 }]),
      packRows(personalFormat, [{ base_hp: 80, ability_1: 2, form_id: 8, num_forms: 2 }]),
      packRows(personalFormat, [{ base_hp: 90, ability_1: 2 }]),
    );
    personal.fileCount = personal.rawFiles.length;
    project.texts.banks.pokedex![6] = "Bulbasaur";
    project.texts.banks.pokedex![7] = "Fakemon";
    project.texts.banks.pokedex![8] = "Fakemon";

    const [dexFile, searchIndexFile] = generateDexDownloads(project, "Volt White Plus");
    const poks = JSON.parse(String(dexFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, "")).poks;

    expect(poks.Bulbasaur).toMatchObject({
      otherFormes: ["Bulbasaur Form 1"],
      formeOrder: ["Bulbasaur", "Bulbasaur Form 1"],
    });
    expect(poks["Bulbasaur Form 1"]).toMatchObject({ baseSpecies: "Bulbasaur", forme: "Form 1", bs: { hp: 46 } });
    expect(poks.Fakemon).toMatchObject({ otherFormes: ["Fakemon Form 1"] });
    expect(poks["Fakemon Form 1"]).toMatchObject({ baseSpecies: "Fakemon", forme: "Form 1", bs: { hp: 90 } });
    expect(String(searchIndexFile.contents)).toContain("bulbasaurform1");
    expect(String(searchIndexFile.contents)).toContain("fakemonform1");
  });

  it("exports the three battle-counter evolution method IDs and thresholds", () => {
    const project = makeProject();
    const evolutionFiles = Array.from({ length: 6 }, () => packRows(project.formats.evolutions!, [{}]));
    evolutionFiles[1] = packRows(project.formats.evolutions!, [{
      method_0: 29,
      param_0: 5,
      target_0: 2,
      method_1: 30,
      param_1: 6,
      target_1: 3,
      method_2: 31,
      param_2: 7,
      target_2: 4,
    }]);
    project.narcs.evolutions = makeStore("evolutions", evolutionFiles, evolutionFiles.length);

    const [dexFile] = generateDexDownloads(project, "Volt White Plus");
    const bulbasaur = JSON.parse(String(dexFile.contents).replace(/^overrides = /u, "").replace(/;\n$/u, "")).poks.Bulbasaur;

    expect(bulbasaur.evos).toEqual(["Ivysaur", "Pokemon 3", "Deoxys"]);
    expect(bulbasaur.evoMethods).toEqual(["KO Count", "Battle Count", "Battles Used Count"]);
    expect(bulbasaur.evoMethodIds).toEqual([29, 30, 31]);
    expect(bulbasaur.evoParams).toEqual([5, 6, 7]);
  });

  it("exports DSPRE Gen 4 trainer form bits as calc species names", () => {
    const project = makeGen4TrainerFormProject();
    const calcFile = generateCalcDownload(project, "Platinum Hack");
    const calcPayload = JSON.parse(calcFile.contents.replace(/^backup_data = /u, "").replace(/;\n$/u, ""));

    expect(calcPayload.formatted_sets.Wormadam["Lvl 40 Galactic Dia"]).toMatchObject({ form: 0, gender: "Female" });
    expect(calcPayload.formatted_sets["Wormadam-Sandy"]["Lvl 41 Galactic Dia"]).toMatchObject({ form: 1, gender: "Female" });
    expect(calcPayload.formatted_sets["Wormadam-Trash"]["Lvl 42 Galactic Dia"]).toMatchObject({ form: 2, gender: "Female" });
    expect(calcPayload.poks.Wormadam.types).toEqual(["Bug", "Grass"]);
    expect(calcPayload.poks["Deoxys-Defense"]).toMatchObject({
      name: "Deoxys-Defense",
      num: 497,
      bs: { hp: 50, at: 70, df: 160, sa: 70, sd: 160, sp: 90 },
    });
    expect(calcPayload.poks["Rotom-Frost"]).toMatchObject({ name: "Rotom-Frost", num: 505 });
    expect(calcPayload.poks).not.toHaveProperty("Pokemon 497");

    expect(trainerPokemonExportName(project, trainerSlot(413, 1))).toBe("Wormadam-Sandy");
    expect(trainerPokemonExportName(project, trainerSlot(412, 1))).toBe("Burmy");
    expect(trainerPokemonExportName(project, trainerSlot(412, 2))).toBe("Burmy");
    expect(trainerPokemonExportName(project, trainerSlot(422, 1))).toBe("Shellos");
    expect(trainerPokemonExportName(project, trainerSlot(479, 5))).toBe("Rotom-Mow");
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

function makeGen4TrainerFormProject(): ProjectState {
  const formats = getNarcFormats("Pt");
  const personalRows: Record<number, Record<string, number>> = {
    413: {
      base_hp: 60,
      base_atk: 59,
      base_def: 85,
      base_speed: 36,
      base_spatk: 79,
      base_spdef: 105,
      type_1: 6,
      type_2: 12,
      ability_1: 1,
      gender: 254,
    },
    497: {
      base_hp: 50,
      base_atk: 70,
      base_def: 160,
      base_speed: 90,
      base_spatk: 70,
      base_spdef: 160,
      type_1: 14,
      type_2: 14,
      ability_1: 1,
      gender: 255,
    },
    505: {
      base_hp: 50,
      base_atk: 65,
      base_def: 107,
      base_speed: 86,
      base_spatk: 105,
      base_spdef: 107,
      type_1: 13,
      type_2: 7,
      ability_1: 1,
      gender: 255,
    },
  };
  const personalFiles = Array.from({ length: 508 }, (_unused, index) => packRows(formats.personal!, [personalRows[index] ?? {}]));
  const trdata = packRows(formats.trdata!, [{ template: 3, class: 1, num_pokemon: 3, ai: 1 }]);
  const trpok = packGen4Trpok(
    3,
    [
      { ivs: 255, ability: 16, level: 40, species_id: 413, form: 0, move_1: 1 },
      { ivs: 255, ability: 16, level: 41, species_id: 413, form: 1, move_1: 1 },
      { ivs: 255, ability: 16, level: 42, species_id: 413, form: 2, move_1: 1 },
    ],
    "Pt",
  );

  return {
    session: {
      romName: "platinum-hack",
      generation: "gen4",
      baseVersion: "Pt",
      baseRom: "Pt",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "PLATINUM", idCode: "CPUJ", fileName: "platinum.nds", size: 1 },
    arm9: makeGen4TmArm9(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", personalFiles, personalFiles.length),
      moves: makeStore("moves", [packRows(formats.moves!, [{}]), packRows(formats.moves!, [{ power: 40, accuracy: 100 }])], 2),
      trdata: makeStore("trdata", [trdata], 1),
      trpok: makeStore("trpok", [trpok], 1),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: namedRows(496, { 386: "Deoxys", 412: "Burmy", 413: "Wormadam", 422: "Shellos", 479: "Rotom", 487: "Giratina", 492: "Shaymin" }),
        moves: ["None", "Bug Buzz"],
        abilities: ["None", "Snow Cloak"],
        tr_names: ["Dia"],
        tr_classes: ["None", "Galactic"],
        items: ["None"],
      },
    },
    formats,
    trpokInfo: [{ template: 3, numPokemon: 3 }],
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
  writeInt(out, 28, 2, 0x8010);
  writeInt(out, 30, 2, 1);
  writeInt(out, 32, 2, 0);
  writeInt(out, 34, 2, 10);
  writeInt(out, 36, 2, 0x010f);
  writeInt(out, 38, 2, 0x8010);
  writeInt(out, 40, 2, 2);
  writeInt(out, 42, 2, 0);
  writeInt(out, 44, 2, 0x0174);
  writeInt(out, 46, 2, 1);
  writeInt(out, 48, 2, 12);
  writeInt(out, 50, 2, 0);
  writeInt(out, 52, 2, 0x0002);
  return out;
}

function makeOddAlignedTrainerBattleScriptBytes(): Uint8Array {
  const out = new Uint8Array(18);
  writeInt(out, 0, 4, 4);
  writeInt(out, 4, 2, 0xfd13);
  out[8] = 0;
  writeInt(out, 9, 2, 0x0085);
  writeInt(out, 11, 2, 767);
  writeInt(out, 13, 2, 0);
  writeInt(out, 15, 2, 0);
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

function trainerSlot(speciesId: number, form: number): Parameters<typeof trainerPokemonExportName>[1] {
  return {
    slot: 0,
    speciesId,
    speciesName: "",
    spriteSlug: "",
    level: 1,
    ivs: 0,
    abilitySlot: 0,
    resolvedAbilitySlot: 0,
    abilityName: "",
    gender: "Default",
    form,
    itemName: "None",
    moves: [],
    nature: "Hardy",
    natureSetting: "Auto",
    natureValue: 0,
  };
}

function setProjectMoves(project: ProjectState, rows: Array<Record<string, number>>, names: string[]): void {
  const format = project.formats.moves;
  if (!format) throw new Error("Missing move format");
  project.narcs.moves = makeStore(
    "moves",
    rows.map((row) => packRows(format, [row])),
    rows.length,
  );
  project.texts.banks.moves = names;
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

function makeGen4TmArm9(): Uint8Array {
  const offset = 0xf0bfc;
  const arm9 = new Uint8Array(offset + 200);
  for (let index = 0; index < 100; index += 1) writeInt(arm9, offset + index * 2, 2, 1);
  [15, 19, 57, 70, 432, 249, 127, 431].forEach((moveId, index) => {
    writeInt(arm9, offset + (92 + index) * 2, 2, moveId);
  });
  return arm9;
}

function namedRows(length: number, names: Record<number, string>): string[] {
  return Array.from({ length }, (_unused, index) => names[index] ?? String(index));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}
