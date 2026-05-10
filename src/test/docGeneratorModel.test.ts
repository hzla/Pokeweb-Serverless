import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { generateCalcDownload, generateTextDocsDownload, enrichItemLocations, enrichTrainerLocations, parseGroundItemScripts } from "../pokeweb/docGeneratorModel";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { OVERWORLD_GROUP_FORMATS, OVERWORLD_HEADER_FORMAT } from "../pokeweb/overworldModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("docGeneratorModel", () => {
  it("wraps calc payloads in backup_data and injects the ROM title", () => {
    const project = makeProject();
    const file = generateCalcDownload(project, "Volt White Plus");

    expect(file.filename).toBe("voltwhiteplus-calc.js");
    expect(file.contents.startsWith("backup_data = ")).toBe(true);
    expect(file.contents).toContain('"title": "Volt White Plus"');
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

  it("enriches trainer locations from overworld script ids", () => {
    const project = makeProject();
    const result = enrichTrainerLocations(project);

    expect(result.count).toBe(1);
    expect(project.docs?.trainerLocations).toEqual({ "7": ["Black City"] });
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
  scripts[1240] = makeGroundItemScriptBytes();

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
      headers: makeStore("headers", [packRows(headerFormat, [{ map_id: 0, location_name_id: 0 }])], 1),
      overworlds: makeStore("overworlds", [makeOverworldBytes()], 1),
      scripts: makeStore("scripts", scripts, scripts.length),
      items: makeStore("items", Array.from({ length: 26 }, () => new Uint8Array()), 26),
      personal: makeStore("personal", [packRows(formats.personal!, [{}]), packRows(formats.personal!, [{ base_hp: 45, item_1: 25 }])], 2),
      learnsets: makeStore("learnsets", [], 0),
      evolutions: makeStore("evolutions", [], 0),
      moves: makeStore("moves", [], 0),
      trdata: makeStore(
        "trdata",
        Array.from({ length: 8 }, (_, index) => packRows(formats.trdata!, [index === 7 ? { class: 1, reward_item: 25 } : {}])),
        8,
      ),
      trpok: makeStore("trpok", [], 0),
      marts: makeStore("marts", [packRows(formats.marts!, [{ item_0: 25 }])], 1),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        locations: ["Black City"],
        pokedex: ["None", "Bulbasaur"],
        moves: [],
        abilities: [],
        items: Array.from({ length: 26 }, (_, index) => (index === 25 ? "Potion" : index === 0 ? "None" : `Item ${index}`)),
        tr_names: Array.from({ length: 8 }, (_, index) => (index === 7 ? "Dan" : `Trainer ${index}`)),
        tr_classes: ["None", "Ace Trainer"],
      },
    },
    formats,
    trpokInfo: [],
    docs: { romTitle: "test-rom", trainerLocations: {}, itemLocations: {}, groundItemScriptMap: {} },
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
