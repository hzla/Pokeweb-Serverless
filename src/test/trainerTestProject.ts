import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

/** A small Black 2 / White 2 project with one trainer (Cheren, one Bulbasaur), for roster and party tests. */
export function makeTrainerTestProject(template = 0): ProjectState {
  const formats = getNarcFormats("BW2");
  const trdata = packRows(formats.trdata!, [
    {},
    { template, class: 1, battle_type_1: 0, num_pokemon: 1, item_1: 0, item_2: 0, item_3: 0, item_4: 0, ai: 0, heal: 0, money: 10, reward_item: 1 },
  ]);
  const trpok = [new Uint8Array(), packTrpok(template, [{ ivs: 50, ability: 16, level: 5, species_id: 1, form: 0, item_id: 1, move_1: 2, move_2: 0, move_3: 0, move_4: 0 }])];
  const personal = packRows(formats.personal!, [
    {},
    { base_hp: 45, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 },
    { base_hp: 60, ability_1: 1, ability_2: 2, ability_3: 3, gender: 127 },
  ]);
  return {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: { trdata: 1, trpok: 2, personal: 3, learnsets: 4 }, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: trdata.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      trdata: makeStore("trdata", trdata, 2),
      trpok: makeStore("trpok", trpok, 2),
      personal: makeStore("personal", personal, 3),
      learnsets: makeStore("learnsets", [packLearnset([]), packLearnset([{ moveId: 1, level: 1 }, { moveId: 2, level: 3 }]), packLearnset([{ moveId: 2, level: 1 }])], 3),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: {
        tr_names: ["None", "Cheren"],
        tr_classes: ["None", "Ace Trainer", "Leader"],
        pokedex: ["None", "Bulbasaur", "Ivysaur"],
        abilities: ["None", "Overgrow", "Chlorophyll", "Hidden"],
        items: ["None", "Potion"],
        moves: ["None", "Tackle", "Vine Whip", "Growl"],
      },
    },
    formats,
    trpokInfo: [{ template: 0, numPokemon: 0 }, { template, numPokemon: 1 }],
  } as unknown as ProjectState;
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

function makeStore(name: NarcName, data: Uint8Array | Uint8Array[], count: number): NarcStore {
  return { name, fileId: 1, sourcePath: "test", fileCount: count, rawFiles: Array.isArray(data) ? data : splitRows(data, count), records: new Map(), dirty: new Set() };
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
      writeInt(out, offset, sizes[index]!, row[field] ?? 0);
      offset += sizes[index]!;
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
