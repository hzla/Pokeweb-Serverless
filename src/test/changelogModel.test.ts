import { describe, expect, it } from "vitest";
import type { BaseVersion, NarcName } from "../pokeweb/constants";
import { generateChangelogFromProjects, validateSameBaseVersion } from "../pokeweb/changelogModel";
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

    expect(result.text).toContain("Charizard base attack changed from 84 to 95.");
    expect(result.text).toContain("Charizard now compatible with: TM01 Hone Claws, TM02 Dragon Claw.");
    expect(result.text).toContain("Charizard removed compatibility with: TM03 Psyshock.");
    expect(result.text).toContain("Charizard learnset slot 1 changed from Flamethrower at level 10 to Tackle at level 15.");
    expect(result.text).toContain("Charizard evolution 1 target changed from Charizard to Ivysaur.");
    expect(result.text).toContain("Flamethrower power changed from 95 to 90.");
    expect(result.text).toContain("Potion market value changed from 300 to 500.");
    expect(result.text).toContain("Leader Iris (Trainer 1) money changed from 10 to 20.");
    expect(result.text).toContain("Leader Iris (Trainer 1) team changed.");
    expect(result.text).toContain("Old Team: Pokemon 1: Lv 50 Charizard");
    expect(result.text).toContain("New Team: Pokemon 1: Lv 55 Ivysaur");
    expect(result.entries.find((entry) => entry.domain === "trpok")?.parts?.some((part) => part.changed && part.text === "Ivysaur")).toBe(true);
    expect(result.text).toContain("Route 4 (1) spring grass slot 0 changed from Charizard to Ivysaur.");
    expect(result.text).toContain("Stock No Badges item 1 changed from Potion to Super Potion.");
    expect(result.text).toContain("Floccesy Ranch black common pok 0 changed from Charizard to Ivysaur.");
    expect(result.text).toContain("Hidden grotto odds rare pok odds 0 changed from 10 to 15.");
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
