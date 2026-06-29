import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  buildMastersheetExport,
  generateMastersheetDownload,
  parseMastersheetMarkdown,
  setMastersheetMarkdown,
} from "../pokeweb/mastersheetModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("mastersheetModel", () => {
  it("parses legacy mastersheet grammar and resolves trainer and encounter references", () => {
    const project = makeProject();
    const result = parseMastersheetMarkdown(
      [
        "# Test Rom",
        "",
        "## Route 19",
        "- Bring [docs](https://example.com)",
        "Line one<br>Line two",
        "!notif Warning, bring potions, red",
        "!items Mart",
        "desc: Basic goods",
        "Potion, Cheap healing",
        "end",
        "!gifts Starter",
        "Bulbasaur, Starter gift",
        "end",
        "!trm Dan/Bulbasaur/42 note",
        "!enc Route 19",
      ].join("\n"),
      project,
    );

    expect(result.warnings).toEqual([]);
    expect(result.masterData.map((element) => element.tag)).toEqual([
      "h1",
      "p",
      "h2",
      "li",
      "p",
      "br",
      "p",
      "notif",
      "items",
      "gifts",
      "trainer",
      "encounter",
    ]);
    expect(result.masterData[3].content_parts).toContainEqual({ type: "link", text: "docs", href: "https://example.com" });
    expect(result.masterData[8]).toMatchObject({ tag: "items", itemsTitle: "Mart", itemsDescription: "Basic goods", itemList: ["Potion"] });
    expect(result.masterData[10]).toMatchObject({ tag: "trainer", id: 1, class: "mand", notes: ["note"] });
    expect(result.masterData[11]).toMatchObject({ tag: "encounter", id: 0 });
    expect(result.trainerPointers).toEqual({ "1": { id: 1, prev: undefined } });
  });

  it("reports blocking warnings for unresolved trainer and encounter references", () => {
    const result = parseMastersheetMarkdown(["!tr 99", "!enc missing place"].join("\n"), makeProject());

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((warning) => warning.blocking)).toBe(true);
  });

  it("builds Dynamic Calc-compatible globals with location-appended trainer names", () => {
    const project = makeProject();
    setMastersheetMarkdown(project, "!tr 1\n!enc 0\n");

    const exportData = buildMastersheetExport(project);
    const trainer = exportData.trainersById[1];
    expect(trainer).toMatchObject({
      class: "Ace Trainer",
      name: "Dan - Route 19",
      count: 1,
      type: "Doubles",
      tr_sprite: "trainer_sprites/ace_trainer.png",
      species_id_0: "Bulbasaur",
      raw_species_id_0: 1,
      level_0: 42,
      item_id_0: "Potion",
      ability_name_0: "Overgrow",
      move_1_0: "Tackle",
    });
    expect(exportData.encountersById[0]).toMatchObject({ name: "Route 19", wilds: ["Bulbasaur"] });

    const file = generateMastersheetDownload(project);
    expect(file.filename).toBe("testrom.js");
    expect(file.contents).toContain("masterData = ");
    expect(file.contents).toContain("encountersById = ");
    expect(file.contents).toContain("trainersById = ");
  });

  it("blocks downloads when references are unresolved", () => {
    const project = makeProject();
    setMastersheetMarkdown(project, "!tr nope\n");

    expect(() => generateMastersheetDownload(project)).toThrow(/Unable to resolve trainer/u);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const trdata = packRows(formats.trdata!, [{}, { template: 3, class: 1, battle_type_1: 1, num_pokemon: 1 }]);
  const trpok = [
    new Uint8Array(),
    packTrpok(3, [{ ivs: 255, ability: 16, level: 42, species_id: 1, form: 0, item_id: 1, move_1: 1, move_2: 0, move_3: 0, move_4: 0 }]),
  ];

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
      trdata: makeStore("trdata", splitRows(trdata, 2), 2),
      trpok: makeStore("trpok", trpok, trpok.length),
      personal: makeStore("personal", [packRows(formats.personal!, [{}]), packRows(formats.personal!, [{ ability_1: 1 }])], 2),
      learnsets: makeStore("learnsets", [new Uint8Array(), packLearnset([{ moveId: 1, level: 1 }])], 2),
      moves: makeStore("moves", [], 0),
      items: makeStore("items", [], 0),
      encounters: makeStore(
        "encounters",
        [
          packRows(formats.encounters!, [
            {
              spring_grass_slot_0: 1,
              spring_grass_slot_0_min_level: 5,
              spring_grass_slot_0_max_level: 7,
            },
          ]),
        ],
        1,
      ),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur"],
        moves: ["None", "Tackle"],
        items: ["None", "Potion"],
        abilities: ["None", "Overgrow"],
        tr_names: ["None", "Dan"],
        tr_classes: ["None", "Ace Trainer"],
      },
    },
    formats,
    trpokInfo: [{ template: 0, numPokemon: 0 }, { template: 3, numPokemon: 1 }],
    headers: {
      count: 1,
      rows: {
        1: { index: 0, location_name: "Route 19", encounter_id: 0 },
      },
    },
    docs: {
      romTitle: "Test Rom",
      mastersheetMarkdown: "# Test Rom\n\n",
      trainerLocations: { "1": ["Route 19"] },
      trainerDiffs: {},
      itemLocations: {},
      groundItemScriptMap: {},
    },
  };
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
    fields.forEach((field, fieldIndex) => {
      writeInt(out, offset, sizes[fieldIndex], row[field] ?? 0);
      offset += sizes[fieldIndex];
    });
  });
  return out;
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

function splitRows(data: Uint8Array, count: number): Uint8Array[] {
  const size = Math.floor(data.length / count);
  return Array.from({ length: count }, (_, index) => data.slice(index * size, (index + 1) * size));
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
}
