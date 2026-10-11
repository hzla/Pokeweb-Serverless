import { describe, expect, it } from "vitest";
import type { BaseVersion, NarcName } from "../pokeweb/constants";
import { changelogLoadNarcs, generateChangelogFromProjects, validateSameBaseVersion } from "../pokeweb/changelogModel";
import { PNG } from "pngjs";
import { changelogIconPng } from "../pokeweb/changelogIconPng";
import { buildChangelogPdf } from "../pokeweb/changelogPdf";
import { createChangelogIconExtractor } from "../pokeweb/changelogIcons";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("changelogModel", () => {
  it("requires the same exact base version", () => {
    const before = makeProject();
    const after = makeProject({ version: "B2" });

    expect(() => validateSameBaseVersion(before, after)).toThrow(/must match exactly/u);
  });

  it("reports no entries when selected data is unchanged", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject());

    expect(result.entries).toHaveLength(0);
    expect(result.text).toContain("No changes detected");
  });

  it("reports readable semantic gameplay changes", () => {
    const result = generateChangelogFromProjects(
      makeProject(),
      makeProject({
        personal: { base_atk: 95, "tm_1-32": 3 },
        learnset: { move_id_0: 2, lvl_learned_0: 15 },
        evolution: { target_0: 2 },
        move: { power: 90 },
        item: { market_value: 500 },
        trainer: { class: 2, money: 20 },
        trainerPokemon: { species_id: 2, level: 55, move_1: 2 },
        encounter: { spring_grass_slot_0: 2, spring_grass_slot_0_min_level: 20 },
        mart: { item_0: 2 },
        grotto: { black_common_pok_0: 2, normal_common_item_0: 2 },
        grottoOdds: 15,
      }),
    );

    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Charizard base attack changed from 84 to 95.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Charizard now compatible with: TM01 Hone Claws, TM02 Dragon Claw.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Charizard removed compatibility with: TM03 Psyshock.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Charizard learnset slot 1 changed from Flamethrower at level 10 to Tackle at level 15.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Charizard evolution 1 target changed from Charizard to Ivysaur.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Flamethrower power changed from 95 to 90.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Potion market value changed from 300 to 500.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Leader Iris (Trainer 1) money changed from 10 to 20.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Leader Iris (Trainer 1) team changed.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Old Team: Pokemon 1: Lv 50 Charizard");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("New Team: Pokemon 1: Lv 55 Ivysaur");
    expect(result.entries.find((entry) => entry.domain === "trpok")?.parts?.some((part) => part.changed && part.text === "Ivysaur")).toBe(true);
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Route 4 (1) spring grass slot 0 changed from Charizard to Ivysaur.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Stock No Badges item 1 changed from Potion to Super Potion.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Floccesy Ranch black common pok 0 changed from Charizard to Ivysaur.");
    expect(result.entries.map((entry) => entry.text).join("\n")).toContain("Hidden grotto odds rare pok odds 0 changed from 10 to 15.");
  });


  it("limits comparisons and documents to the selected NARCs", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject({ personal: { base_atk: 95 }, move: { power: 90 }, mapFile: new Uint8Array([7]) }), { selectedNarcs: ["moves"] });
    expect(result.entries.map((entry) => entry.domain)).toEqual(["moves"]);
    expect(result.summary.domains).toEqual({ moves: 1 });
    expect(result.documents.map((document) => document.domain)).toEqual(["moves"]);
    expect(result.documents[0].html).toContain("<h2>Flamethrower</h2>");
    expect(result.documents[0].subjects[0].fields).toContainEqual(expect.objectContaining({ label: "power", before: "95", after: "90" }));
    expect(result.text).not.toContain("Charizard");
    expect(result.text).not.toContain("Map file");
    expect(generateChangelogFromProjects(makeProject(), makeProject({ move: { power: 90 } }), { selectedNarcs: [] }).entries).toEqual([]);
  });

  it("loads decoding dependencies without adding them to the chosen output", () => {
    expect(changelogLoadNarcs({ selectedNarcs: ["trpok"] })).toEqual(expect.arrayContaining(["trpok", "trdata", "personal", "headers", "message_texts", "pokemon_icons"]));
    expect(changelogLoadNarcs({ selectedNarcs: ["evolutions"] })).toEqual(expect.arrayContaining(["evolutions", "personal", "learnsets", "moves"]));
    expect(changelogLoadNarcs({ selectedNarcs: ["maps"] })).not.toContain("trpok");
    expect(changelogLoadNarcs({ selectedNarcs: ["moves"] })).not.toContain("pokemon_icons");
    expect(changelogLoadNarcs({ selectedNarcs: ["learnsets"] })).toEqual(expect.arrayContaining(["learnsets", "personal", "pokemon_icons"]));
    const result = generateChangelogFromProjects(makeProject(), makeProject({ trainerPokemon: { level: 55 }, trainer: { money: 20 } }), { selectedNarcs: ["trpok"] });
    expect(result.documents.map((document) => document.domain)).toEqual(["trainers"]);
    expect(result.documents[0].narcs).toEqual(["trpok"]);
    expect(result.entries.every((entry) => entry.domain === "trpok")).toBe(true);
  });

  it("renders grouped names, aligned trainer fields, and paired tables", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject({
      personal: { base_atk: 95, base_def: 90 }, move: { power: 90, pp: 20 }, trainer: { money: 20 },
      learnset: { move_id_0: 2, lvl_learned_0: 15 }, trainerPokemon: { level: 55, ivs: 100 },
      encounter: { spring_grass_slot_0: 2, spring_grass_rate: 30 },
    }));
    const document = (domain: NarcName | "trainers" | "pokemon") => result.documents.find((document) => document.domain === domain)!;
    expect(document("pokemon").html.match(/<h2>Charizard<\/h2>/gu)).toHaveLength(1);
    expect(document("moves").html.match(/Flamethrower/gu)).toHaveLength(1);
    expect(document("trainers").subjects[0].fields).toContainEqual(expect.objectContaining({ label: "money", before: "10", after: "20" }));
    expect(document("pokemon").html).toContain('<span class="changelog-old">Flamethrower</span>');
    expect(document("pokemon").html).toContain('<mark><strong>Tackle</strong></mark>');
    expect(document("pokemon").html.match(/width="50%"/gu)).toHaveLength(2);
    expect(document("encounters").html).toContain("Spring · Grass");
    expect(document("encounters").html).toContain('Encounter rate: <span class="changelog-old">20</span>');
    expect(document("encounters").html).toContain('<mark><strong>Ivysaur</strong></mark>');
    expect(document("encounters").html).not.toContain("Spring · Surf");
    expect(document("trainers").html).toContain('<th scope="row">IVs</th>');
    expect(document("trainers").html).toContain('<mark><strong>100</strong></mark>');
    expect(document("trainers").html).not.toContain("Old Team: Pokemon");
    expect(document("moves").filename).toBe("pokeweb-changelog-moves.pdf");
    expect(result.text).not.toContain("<del>");
    expect(result.text).not.toContain("~~");
    expect(result.documents.every((document) => !document.html.includes("<del>"))).toBe(true);
  });

  it("combines every selected subset of personal, learnsets, and evolutions into one Pokemon document", () => {
    const subsets: NarcName[][] = [
      ["personal"], ["learnsets"], ["evolutions"], ["personal", "learnsets"],
      ["personal", "evolutions"], ["learnsets", "evolutions"], ["personal", "learnsets", "evolutions"],
    ];
    for (const selectedNarcs of subsets) {
      const result = generateChangelogFromProjects(makeProject(), makeProject({
        personal: { base_atk: 95 }, learnset: { move_id_0: 2 }, evolution: { target_0: 2 }, move: { power: 90 },
      }), { selectedNarcs });
      expect(result.documents).toHaveLength(1);
      const document = result.documents[0];
      expect(document.domain).toBe("pokemon");
      expect(document.filename).toBe("pokeweb-changelog-pokemon.pdf");
      expect(document.narcs).toEqual(selectedNarcs);
      expect(document.subjects).toHaveLength(1);
      expect(document.subjects[0].title).toBe("Charizard");
      expect(document.subjects[0].fields.some((field) => field.label === "base attack")).toBe(selectedNarcs.includes("personal"));
      expect(document.subjects[0].fields.some((field) => field.label === "evolution 1 target")).toBe(selectedNarcs.includes("evolutions"));
      expect(document.subjects[0].comparisons).toHaveLength(selectedNarcs.includes("learnsets") ? 1 : 0);
      expect(result.entries.every((entry) => selectedNarcs.includes(entry.domain as NarcName))).toBe(true);
    }
  });

  it("consolidates trainer settings and teams under one trainer heading and download", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject({
      trainer: { money: 20 }, trainerPokemon: { species_id: 2, level: 55 }, move: { power: 90 },
    }), { selectedNarcs: ["trdata", "trpok"] });
    expect(result.documents).toHaveLength(1);
    const document = result.documents[0];
    expect(document.domain).toBe("trainers");
    expect(document.title).toBe("Trainers");
    expect(document.narcs).toEqual(["trdata", "trpok"]);
    expect(document.changes).toBe(2);
    expect(result.summary.totalChanges).toBe(2);
    expect(document.filename).toBe("pokeweb-changelog-trainers.pdf");
    expect(document.html).toContain("<code>trdata</code> + <code>trpok</code>");
    expect(document.html.match(/<h2>Leader Iris \(Trainer 1\)<\/h2>/gu)).toHaveLength(1);
    expect(document.subjects[0].fields).toContainEqual(expect.objectContaining({ label: "money", before: "10", after: "20" }));
    expect(document.html).toContain("<h3>Team</h3>");
    expect(document.html).toContain("<mark><strong>Ivysaur</strong></mark>");
    expect(document.html).not.toContain("Flamethrower power");
  });

  it("leaves unchanged rows plain and shows added or removed learnset rows", () => {
    const before = makeProject();
    const after = makeProject();
    after.narcs.learnsets!.rawFiles[1] = packRows(after.formats.learnsets!, [{ move_id_0: 1, lvl_learned_0: 10, move_id_1: 2, lvl_learned_1: 15 }], 1, true);
    const added = generateChangelogFromProjects(before, after, { selectedNarcs: ["learnsets"] });
    expect(added.documents[0].html).toContain('<td>Flamethrower</td>');
    expect(added.documents[0].html).not.toContain('<span class="changelog-old">Flamethrower</span>');
    expect(added.documents[0].html).toContain('<mark><strong>Tackle</strong></mark>');
    const removed = generateChangelogFromProjects(after, before, { selectedNarcs: ["learnsets"] });
    expect(removed.documents[0].html).toContain('<span class="changelog-old">Tackle</span>');
  });

  it("escapes ROM names and record text in previews", () => {
    const before = makeProject();
    const after = makeProject({ move: { power: 90 } });
    after.session.romName = '<img src=x onerror=alert(1)>';
    after.texts.banks.moves![1] = '[Move](javascript:alert(1)) | *test*';
    const result = generateChangelogFromProjects(before, after, { selectedNarcs: ["moves"] });
    expect(result.documents[0].html).not.toContain('<img');
    expect(result.documents[0].html).not.toContain('<a');
    expect(result.documents[0].html).toContain('&lt;img');
    expect(result.documents[0].subjects[0].title).toBe(after.texts.banks.moves![1]);
  });

  it("includes downloadable documents for unchanged and unavailable selections", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject(), { selectedNarcs: ["moves", "headers"] });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.find((document) => document.domain === "moves")?.html).toContain("No changes detected");
    expect(result.documents.find((document) => document.domain === "headers")?.html).toContain("not available");
  });

  it("decorates Pokemon names with one extracted icon across headings and comparison tables", () => {
    const before = makeProject();
    const after = makeProject({ personal: { base_atk: 100 }, trainer: { money: 30 }, trainerPokemon: { species_id: 2 }, encounter: { spring_grass_slot_0: 2 }, grotto: { black_common_pok_0: 2 } });
    addTestIcons(before, 0x001f);
    addTestIcons(after, 0x7c00);
    const result = generateChangelogFromProjects(before, after, { selectedNarcs: ["personal", "trdata", "trpok", "encounters", "grottos"] });
    const personal = result.documents.find((document) => document.domain === "pokemon")!;
    const icon = personal.subjects[0].icon!;
    expect([icon.width, icon.height]).toEqual([32, 32]);
    expect(icon.pixels[0]).toBe(0);
    expect(icon.pixels[2]).toBeGreaterThan(200);
    icon.pixels[3] = 0;
    const png = PNG.sync.read(Buffer.from(changelogIconPng(icon)));
    expect([...png.data.subarray(0, 4)]).toEqual([...icon.pixels.subarray(0, 4)]);
    expect(personal.icons).toHaveLength(1);
    expect(personal.html).toContain('icon"></canvas>Charizard</h2>');
    expect(personal.html).not.toContain("changelog-subject-icons");
    expect(result.documents.every((document) => document.icons.length > 0 && !document.iconWarning)).toBe(true);
    const trainer = result.documents.find((document) => document.domain === "trainers")!.subjects[0].comparisons[0];
    expect(trainer.beforeIcons[0]).toBe(icon);
    expect(trainer.afterIcons[0]!.label).toBe("Ivysaur");
    after.narcs.pokemon_icons!.rawFiles.length = 0;
    expect(icon.pixels[2]).toBeGreaterThan(200);
    const pdf = buildChangelogPdf(result.documents);
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(result.documents.length);
    expect(pdf.output()).toContain("/Subtype /Image");
    expect(pdf.output()).toContain("/Width 32");
    expect(pdf.output()).toContain("/SMask");
  });

  it("includes party icons for trainer settings-only changes and reports unavailable icons", () => {
    const before = makeProject();
    const after = makeProject({ trainer: { money: 30 } });
    addTestIcons(before, 0x001f);
    addTestIcons(after, 0x7c00);
    const document = generateChangelogFromProjects(before, after, { selectedNarcs: ["trdata", "trpok"] }).documents[0];
    expect(document.subjects[0].comparisons).toHaveLength(0);
    expect(document.subjects[0].pokemon).toHaveLength(1);
    expect(document.subjects[0].pokemon[0].name).toBe("Charizard");
    expect(document.subjects[0].pokemon[0].icon!.pixels[2]).toBeGreaterThan(200);
    delete after.narcs.pokemon_icons;
    const fallback = generateChangelogFromProjects(before, after, { selectedNarcs: ["trdata", "trpok"] }).documents[0];
    expect(fallback.iconWarning).toBeUndefined();
    expect(fallback.subjects[0].pokemon[0].icon!.pixels[0]).toBeGreaterThan(200);
    delete before.narcs.pokemon_icons;
    const missing = generateChangelogFromProjects(before, after, { selectedNarcs: ["trdata", "trpok"] }).documents[0];
    expect(missing.iconWarning).toContain("could not be extracted");
    expect(missing.subjects[0].fields[0].after).toBe("30");
    expect(missing.subjects[0].pokemon[0].icon).toBeUndefined();

  });

  it("does not report icon differences as changelog changes", () => {
    const before = makeProject();
    const after = makeProject();
    addTestIcons(before, 0x001f);
    addTestIcons(after, 0x7c00);
    const result = generateChangelogFromProjects(before, after, { selectedNarcs: ["personal", "trdata", "trpok", "encounters"] });
    expect(result.summary.totalChanges).toBe(0);
    expect(result.entries).toHaveLength(0);
    expect(result.documents.every((document) => document.subjects.length === 0)).toBe(true);
  });

  it("resolves female icon data, forms, and BW1 archive offsets", () => {
    const project = makeProject();
    addTestIcons(project, 0x001f);
    const female = new Uint8Array(48 + 1024); female.fill(0x11, 48);
    project.narcs.pokemon_icons!.rawFiles[11] = female;
    const icons = createChangelogIconExtractor(project, "before");
    expect(icons.extract({ speciesId: 1, female: true })?.key).toContain("female");
    expect(icons.extract({ speciesId: 1, form: 7 })).toBeUndefined();
    project.session.baseRom = "BW";
    project.session.baseVersion = "W";
    project.narcs.pokemon_icons!.rawFiles[9] = female;
    expect(createChangelogIconExtractor(project, "before").extract({ speciesId: 1 })?.pixels[0]).toBeGreaterThan(200);
  });

  it("keeps paired tables aligned across multiple PDF pages", () => {
    const result = generateChangelogFromProjects(makeProject(), makeProject({ learnset: { lvl_learned_0: 20 } }), { selectedNarcs: ["learnsets"] });
    const comparison = result.documents[0].subjects[0].comparisons[0];
    comparison.before = Array.from({ length: 180 }, (_, index) => [String(index + 1), String(index), "Flamethrower"]);
    comparison.after = Array.from({ length: 180 }, (_, index) => [String(index + 1), String(index + 1), "Tackle"]);
    const pdf = buildChangelogPdf(result.documents);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(3);
    expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });

  it("reports complex asset files generically", () => {
    const result = generateChangelogFromProjects(
      makeProject(),
      makeProject({
        mapFile: new Uint8Array([9, 9]),
        matrixFile: new Uint8Array([8, 8]),
        overworldFile: new Uint8Array([7, 7]),
        moveAnimationFile: new Uint8Array([6, 6]),
        battleAnimationFile: new Uint8Array([5, 5]),
        moveSpaFile: new Uint8Array([4, 4]),
      }),
    );

    expect(result.text).toContain("Map file 0 changed.");
    expect(result.text).toContain("Matrix file 0 changed.");
    expect(result.text).toContain("Overworld file 0 changed.");
    expect(result.text).toContain("Move animation file for Flamethrower changed.");
    expect(result.text).toContain("Battle animation file 0 changed.");
    expect(result.text).toContain("Move particle file 0 changed.");
  });

  it("reports added and removed files without crashing", () => {
    const before = makeProject();
    const after = makeProject();
    after.narcs.maps!.rawFiles.push(new Uint8Array([3]));
    after.narcs.maps!.fileCount = 2;

    const added = generateChangelogFromProjects(before, after);
    const removed = generateChangelogFromProjects(after, before);

    expect(added.text).toContain("Map file 1 was added.");
    expect(removed.text).toContain("Map file 1 was removed.");
  });
});

type ProjectOverrides = {
  version?: BaseVersion;
  personal?: Record<string, number>;
  learnset?: Record<string, number>;
  evolution?: Record<string, number>;
  move?: Record<string, number>;
  item?: Record<string, number>;
  trainer?: Record<string, number>;
  trainerPokemon?: Record<string, number>;
  encounter?: Record<string, number>;
  mart?: Record<string, number>;
  grotto?: Record<string, number>;
  grottoOdds?: number;
  mapFile?: Uint8Array;
  matrixFile?: Uint8Array;
  overworldFile?: Uint8Array;
  moveAnimationFile?: Uint8Array;
  battleAnimationFile?: Uint8Array;
  moveSpaFile?: Uint8Array;
};

function makeProject(overrides: ProjectOverrides = {}): ProjectState {
  const formats = getNarcFormats("BW2");
  const personal = packRows(formats.personal!, [
    {},
    {
      base_hp: 78,
      base_atk: 84,
      base_def: 78,
      base_speed: 100,
      base_spatk: 109,
      base_spdef: 85,
      type_1: 9,
      type_2: 2,
      ability_1: 1,
      ability_2: 2,
      ability_3: 3,
      "tm_1-32": 4,
      ...overrides.personal,
    },
    { base_atk: 62, type_1: 11, ability_1: 1 },
  ]);
  const learnsets = [
    new Uint8Array(),
    packRows(formats.learnsets!, [{ move_id_0: 1, lvl_learned_0: 10, ...overrides.learnset }], 1, true),
    new Uint8Array(),
  ];
  const evolutions = [
    new Uint8Array(),
    packRows(formats.evolutions!, [{ method_0: 4, param_0: 36, target_0: 1, ...overrides.evolution }]),
    new Uint8Array(),
  ];
  const moves = packRows(formats.moves!, [
    {},
    { type: 9, category: 2, power: 95, accuracy: 100, pp: 15, effect: 0, result_effect: 0, status: 0, target: 0, hits: 0x11, properties: 0, ...overrides.move },
    { type: 0, category: 1, power: 40, accuracy: 100, pp: 35, effect: 0, result_effect: 0, status: 0, target: 0, hits: 0x11, properties: 0 },
  ]);
  const items = packRows(formats.items!, [{}, { market_value: 300, ...overrides.item }, { market_value: 700 }]);
  const trdata = packRows(formats.trdata!, [
    {},
    { template: 3, class: 1, battle_type_1: 0, num_pokemon: 1, item_1: 1, money: 10, reward_item: 1, ...overrides.trainer },
  ]);
  const trpok = [
    new Uint8Array(),
    packTrpok(3, [{ ivs: 50, ability: 16, level: 50, species_id: 1, form: 0, item_id: 1, move_1: 1, move_2: 0, move_3: 0, move_4: 0, ...overrides.trainerPokemon }]),
  ];
  const encounters = packRows(formats.encounters!, [
    { spring_grass_rate: 20, spring_grass_slot_0: 1, spring_grass_slot_0_min_level: 10, spring_grass_slot_0_max_level: 12, ...overrides.encounter },
  ]);
  const marts = packRows(formats.marts!, [{ item_0: 1, ...overrides.mart }]);
  const grottos = packRows(formats.grottos!, [{ black_common_pok_0: 1, normal_common_item_0: 1, ...overrides.grotto }]);
  const grottoOdds = new Uint8Array(200);
  grottoOdds[0] = overrides.grottoOdds ?? 10;

  return {
    session: {
      romName: "test",
      baseVersion: overrides.version ?? "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", personal, 3),
      learnsets: makeStore("learnsets", learnsets, 3, false),
      evolutions: makeStore("evolutions", evolutions, 3, false),
      moves: makeStore("moves", moves, 3),
      items: makeStore("items", items, 3),
      trdata: makeStore("trdata", trdata, 2),
      trpok: makeStore("trpok", trpok, 2, false),
      encounters: makeStore("encounters", encounters, 1),
      marts: makeStore("marts", marts, 1),
      grottos: makeStore("grottos", grottos, 1),
      grotto_odds: makeStore("grotto_odds", grottoOdds, 1, false),
      maps: makeStore("maps", overrides.mapFile ?? new Uint8Array([1, 2]), 1, false),
      matrix: makeStore("matrix", overrides.matrixFile ?? new Uint8Array([1, 2]), 1, false),
      overworlds: makeStore("overworlds", overrides.overworldFile ?? new Uint8Array([1, 2]), 1, false),
      move_animations: makeStore("move_animations", [new Uint8Array([0]), overrides.moveAnimationFile ?? new Uint8Array([1])], 2, false),
      battle_animations: makeStore("battle_animations", overrides.battleAnimationFile ?? new Uint8Array([1, 2]), 1, false),
      move_spas: makeStore("move_spas", overrides.moveSpaFile ?? new Uint8Array([1, 2]), 1, false),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: ["None", "Charizard", "Ivysaur"],
        abilities: ["None", "Blaze", "Solar Power", "Tough Claws"],
        moves: ["None", "Flamethrower", "Tackle"],
        items: ["None", "Potion", "Super Potion"],
        tr_classes: ["None", "Leader", "Champion"],
        tr_names: ["None", "Iris"],
      },
    },
    formats,
    trpokInfo: [{ template: 0, numPokemon: 0 }, { template: 3, numPokemon: 1 }],
    tms: {
      offset: 0,
      byteLength: 0,
      raw: { tm_1: 1, tm_2: 2, tm_3: 3 },
      readable: { tm_1: "Hone Claws", tm_2: "Dragon Claw", tm_3: "Psyshock" },
      dirty: false,
    },
    headers: {
      count: 1,
      rows: {
        1: {
          index: 1,
          location_name: "Route 4",
          encounter_id: 0,
        },
      },
    },
  };
}

function makeStore(name: NarcName, data: Uint8Array | Uint8Array[], count: number, split = true): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: Array.isArray(data) ? data : split ? splitRows(data, count) : [data],
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

function packTrpok(template: number, rows: Array<Record<string, number>>): Uint8Array {
  const fields = [
    [1, "ivs"],
    [1, "ability"],
    [1, "level"],
    [1, "padding"],
    [2, "species_id"],
    [2, "form"],
    ...(template & 2 ? ([[2, "item_id"]] as const) : []),
    ...(template & 1 ? ([[2, "move_1"], [2, "move_2"], [2, "move_3"], [2, "move_4"]] as const) : []),
  ] as const;
  const size = fields.reduce((sum, [bytes]) => sum + bytes, 0);
  const out = new Uint8Array(size * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * size;
    for (const [bytes, field] of fields) {
      writeInt(out, offset, bytes, row[field] ?? 0);
      offset += bytes;
    }
  });
  return out;
}

function splitRows(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.length / count);
  return Array.from({ length: count }, (_, index) => data.slice(index * size, (index + 1) * size));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
}

function addTestIcons(project: ProjectState, color: number): void {
  const files = Array.from({ length: 14 }, () => new Uint8Array());
  files[0] = new Uint8Array(40 + 96);
  writeInt(files[0], 42, 2, color);
  for (const index of [10, 12]) {
    files[index] = new Uint8Array(48 + 1024);
    files[index].fill(0x11, 48);
  }
  project.narcs.pokemon_icons = makeStore("pokemon_icons", files, files.length, false);
}
