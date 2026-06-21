import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { getMoveRecord, updateMoveField } from "../pokeweb/moveItemModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";

describe("Gen 4 data formats", () => {
  it("parses and materializes 44-byte personal records", () => {
    const formats = getNarcFormats("Pt");
    const bytes = packRecord(formats.personal!, {
      base_hp: 45,
      base_atk: 49,
      base_def: 49,
      base_speed: 45,
      base_spatk: 65,
      base_spdef: 65,
      type_1: 12,
      type_2: 3,
      catchrate: 45,
      base_exp: 64,
      evs: 0b10,
      item_1: 1,
      item_2: 2,
      ability_1: 65,
      ability_2: 34,
      color_flip: 0x85,
      "tm_1-32": 1,
    });
    const project = makeProject({ personal: makeStore("personal", [bytes]) });

    const record = decodeRecord(project, "personal", 0);
    expect(record.bytes.length).toBe(44);
    expect(record.raw?.ability_3).toBe(0);
    expect(record.raw?.color).toBe(5);
    expect(record.raw?.flip).toBe(1);
    expect(record.readable?.type_1).toBe("Leaf");

    record.raw!.base_hp = 46;
    record.raw!.color = 7;
    project.narcs.personal!.dirty.add(0);
    materializeProjectEdits(project);

    const out = project.narcs.personal!.rawFiles[0];
    expect(out[0]).toBe(46);
    expect(out[fieldOffset(formats.personal!, "color_flip")]).toBe(0x87);
  });

  it("round-trips packed learnset entries", () => {
    const bytes = new Uint8Array(8);
    writeInt(bytes, 0, 2, (5 << 9) | 33);
    writeInt(bytes, 2, 2, (20 << 9) | 45);
    writeInt(bytes, 4, 2, 0xffff);
    const project = makeProject({ learnsets: makeStore("learnsets", [bytes]) });

    const record = decodeRecord(project, "learnsets", 0);
    expect(record.raw).toMatchObject({ move_id_0: 33, lvl_learned_0: 5, move_id_1: 45, lvl_learned_1: 20 });

    record.raw!.move_id_0 = 34;
    record.raw!.lvl_learned_0 = 6;
    project.narcs.learnsets!.dirty.add(0);
    materializeProjectEdits(project);

    expect([...project.narcs.learnsets!.rawFiles[0]]).toEqual([0x22, 0x0c, 0x2d, 0x28, 0xff, 0xff, 0x00, 0x00]);
  });

  it("preserves fixed evolution slots while writing edits", () => {
    const formats = getNarcFormats("Pt");
    const bytes = packRecord(formats.evolutions!, {
      method_0: 4,
      param_0: 16,
      target_0: 2,
      method_3: 6,
      param_3: 1,
      target_3: 3,
    });
    const project = makeProject({ evolutions: makeStore("evolutions", [bytes]) });

    const record = decodeRecord(project, "evolutions", 0);
    record.raw!.target_3 = 4;
    project.narcs.evolutions!.dirty.add(0);
    materializeProjectEdits(project);

    const out = project.narcs.evolutions!.rawFiles[0];
    expect(readU16(out, 0)).toBe(4);
    expect(readU16(out, 3 * 6 + 4)).toBe(4);
  });

  it("parses and materializes 16-byte move records", () => {
    const formats = getNarcFormats("Pt");
    const bytes = packRecord(formats.moves!, {
      effect: 0x1234,
      category: 1,
      power: 40,
      type: 12,
      accuracy: 100,
      pp: 35,
      effect_chance: 10,
      target: 1,
    });
    const project = makeProject({ moves: makeStore("moves", [bytes]) });

    const record = decodeRecord(project, "moves", 0);
    expect(record.readable?.name).toBe("Pound From Text");
    expect(record.readable?.type).toBe("Leaf");
    expect(record.readable?.category).toBe("Special");

    const move = getMoveRecord(project, 0);
    expect(move.readable.name).toBe("Pound From Text");
    expect(move.readable.type).toBe("Leaf");
    expect(updateMoveField(project, 0, "type", "Blaze").rawValue).toBe(10);

    record.raw!.power = 45;
    project.narcs.moves!.dirty.add(0);
    materializeProjectEdits(project);
    expect(project.narcs.moves!.rawFiles[0][3]).toBe(45);
  });

  it("parses and materializes Gen 4 trainer parties from trdata flags", () => {
    const formats = getNarcFormats("Pt");
    const trdata = packRecord(formats.trdata!, { template: 3, class: 4, num_pokemon: 1, item_1: 99, ai: 7, double_battle: 2 });
    const party = new Uint8Array(18);
    party[0] = 31;
    party[1] = 0x11;
    writeInt(party, 2, 2, 15);
    writeInt(party, 4, 2, 2 | (3 << 10));
    writeInt(party, 6, 2, 1);
    writeInt(party, 8, 2, 33);
    writeInt(party, 10, 2, 34);
    writeInt(party, 12, 2, 35);
    writeInt(party, 14, 2, 36);
    writeInt(party, 16, 2, 9);
    const project = makeProject({
      trdata: makeStore("trdata", [trdata]),
      trpok: makeStore("trpok", [party]),
    });
    project.trpokInfo = [{ template: 3, numPokemon: 1 }];

    const record = decodeRecord(project, "trpok", 0);
    expect(record.raw).toMatchObject({ species_id_0: 2, form_0: 3, level_0: 15, item_id_0: 1, ball_seals_0: 9 });

    record.raw!.species_id_0 = 4;
    record.raw!.form_0 = 1;
    record.raw!.ball_seals_0 = 11;
    project.narcs.trpok!.dirty.add(0);
    materializeProjectEdits(project);

    const out = project.narcs.trpok!.rawFiles[0];
    expect(readU16(out, 4)).toBe(4 | (1 << 10));
    expect(readU16(out, 16)).toBe(11);
  });
});

function makeProject(narcs: Partial<Record<NarcName, NarcStore>>): ProjectState {
  return {
    session: {
      romName: "gen4-test",
      generation: "gen4",
      baseVersion: "Pt",
      baseRom: "Pt",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "CPUE", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs,
    texts: {
      banks: {
        pokedex: ["None", "Bulbasaur", "Ivysaur", "Venusaur", "Charmander"],
        abilities: ["None", "Overgrow"],
        items: ["None", "Potion"],
        moves: ["Pound From Text", "Move 1"],
        types: ["Normal", "Fight", "Fly", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "???", "Blaze", "Water", "Leaf", "Electric", "Psychic", "Ice", "Dragon", "Dark"],
      },
    },
    formats: getNarcFormats("Pt"),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function packRecord(format: FieldSpec[], values: Record<string, number>): Uint8Array {
  const out = new Uint8Array(format.reduce((sum, [size]) => sum + size, 0));
  let offset = 0;
  for (const [size, field] of format) {
    writeInt(out, offset, size, values[field] ?? 0);
    offset += size;
  }
  return out;
}

function fieldOffset(format: FieldSpec[], target: string): number {
  let offset = 0;
  for (const [size, field] of format) {
    if (field === target) return offset;
    offset += size;
  }
  throw new Error(`Missing field ${target}`);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  let next = Number(value) >>> 0;
  for (let index = 0; index < size; index += 1) {
    out[offset + index] = next & 0xff;
    next >>>= 8;
  }
}
