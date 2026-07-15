import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { addPokemonForm } from "../pokeweb/pokemonFormModel";
import { pokemonPersonalDisplayIds } from "../pokeweb/pokemonLabels";
import { getPokemonCount, getPokemonPersonalIds } from "../pokeweb/pokemonModel";
import { getPokemonIconPaletteAssignment } from "../pokeweb/pokemonSpriteModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";

const SPINDA_ID = 327;
const BW2_ICON_HEADER_FILES = 8;
const BW2_ICON_PALETTE_OFFSET = 0x8c578;
const BW2_ICON_PALETTE_POINTER_OFFSET = 0x1d0e8;
const BW2_HEAP_START_POINTER_OFFSET = 0x7741c;
const GEN5_ARM9_RAM_ADDRESS = 0x02004000;

describe("pokemonFormModel", () => {
  it("appends a complete BW2 form with filler 709, an empty evolution, and copied base graphics", () => {
    const project = makeRetailBw2Project();
    const partialReservedSprite = project.narcs.pokemon_sprites!.rawFiles.slice(-5).map((file) => file.slice());
    const sourceSprite = project.narcs.pokemon_sprites!.rawFiles.slice(SPINDA_ID * 20, SPINDA_ID * 20 + 20).map((file) => file.slice());
    const sourceLearnset = project.narcs.learnsets!.rawFiles[SPINDA_ID].slice();
    const sourcePersonal = project.narcs.personal!.rawFiles[SPINDA_ID].slice();

    const result = addPokemonForm(project, SPINDA_ID);

    expect(result).toEqual({
      speciesId: SPINDA_ID,
      formIndex: 1,
      personalId: 710,
      spriteId: 754,
      relocatedForms: 0,
      paddedLearnsetEntries: 1,
      paddedEvolutionEntries: 1,
    });

    const base = decodeRecord(project, "personal", SPINDA_ID).raw;
    const form = decodeRecord(project, "personal", 710).raw;
    expect(base).toMatchObject({ form_id: 710, form: 69, num_forms: 2 });
    expect(form).toMatchObject({ base_hp: 60, base_atk: 60, form_id: 0, form: 0, num_forms: 1 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(711);
    expect(project.narcs.personal!.rawFiles[709]).toHaveLength(1370);
    expect(project.narcs.personal!.rawFiles[710]).toEqual(sourcePersonal);
    expect(getPokemonCount(project)).toBe(711);
    expect(getPokemonPersonalIds(project)).toContain(710);
    expect(getPokemonPersonalIds(project)).not.toContain(709);
    const displayIds = pokemonPersonalDisplayIds(project);
    expect(displayIds.indexOf(710)).toBe(displayIds.indexOf(SPINDA_ID) + 1);

    expect(project.narcs.learnsets!.rawFiles).toHaveLength(711);
    expect(project.narcs.learnsets!.rawFiles[709]).toEqual(Uint8Array.of(0xff, 0xff, 0xff, 0xff));
    expect(project.narcs.learnsets!.rawFiles[710]).toEqual(sourceLearnset);
    expect(project.narcs.evolutions!.rawFiles).toHaveLength(711);
    expect(project.narcs.evolutions!.rawFiles[709]).toEqual(new Uint8Array(42));
    expect(project.narcs.evolutions!.rawFiles[710]).toEqual(new Uint8Array(42));

    const sprites = project.narcs.pokemon_sprites!;
    expect(sprites.rawFiles).toHaveLength(15100);
    expect(sprites.rawFiles.slice(15060, 15065)).toEqual(partialReservedSprite);
    expect(sprites.rawFiles.slice(15065, 15080)).toEqual(Array.from({ length: 15 }, () => new Uint8Array()));
    expect(sprites.rawFiles.slice(754 * 20, 755 * 20)).toEqual(sourceSprite);

    const icons = project.narcs.pokemon_icons!;
    expect(icons.rawFiles).toHaveLength(1518);
    expect(icons.rawFiles.slice(1510, 1516)).toEqual(Array.from({ length: 6 }, () => new Uint8Array()));
    expect(icons.rawFiles[1516]).toEqual(Uint8Array.of(3, 2, 7));
    expect(icons.rawFiles[1517]).toEqual(Uint8Array.of(4, 1));
    expect(getPokemonIconPaletteAssignment(project, 754, "male")).toEqual({ editable: true, paletteId: 1 });
    expect(getPokemonIconPaletteAssignment(project, 754, "female")).toEqual({ editable: true, paletteId: 2 });
    expect(project.arm9Dirty).toBe(true);
    const relocatedTableOffset = readU32(project.arm9, BW2_ICON_PALETTE_POINTER_OFFSET) - GEN5_ARM9_RAM_ADDRESS;
    expect(relocatedTableOffset).toBeGreaterThan(BW2_ICON_PALETTE_OFFSET + 756);
    expect(project.arm9[relocatedTableOffset + 756]).toBe(0x21);
    expect(readU32(project.arm9, BW2_HEAP_START_POINTER_OFFSET)).toBe(GEN5_ARM9_RAM_ADDRESS + project.arm9.length);

    for (const name of ["personal", "learnsets", "evolutions", "pokemon_sprites", "pokemon_icons"] as const) {
      expect(project.narcs[name]!.dirty.size).toBeGreaterThan(0);
      expect(project.narcs[name]!.fileCount).toBe(project.narcs[name]!.rawFiles.length);
    }
  });

  it("continues appending aligned form blocks without adding another 709 filler", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    const result = addPokemonForm(project, SPINDA_ID);

    expect(result).toMatchObject({ personalId: 712, spriteId: 756, relocatedForms: 1, paddedLearnsetEntries: 0, paddedEvolutionEntries: 0 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(713);
    expect(project.narcs.learnsets!.rawFiles).toHaveLength(713);
    expect(project.narcs.evolutions!.rawFiles).toHaveLength(713);
    expect(project.narcs.pokemon_sprites!.rawFiles).toHaveLength(15140);
    expect(project.narcs.pokemon_icons!.rawFiles).toHaveLength(1522);
    expect(getPokemonIconPaletteAssignment(project, 755, "male")).toEqual({ editable: true, paletteId: 1 });
    expect(getPokemonIconPaletteAssignment(project, 756, "female")).toEqual({ editable: true, paletteId: 2 });
  });
});

function makeRetailBw2Project(): ProjectState {
  const formats = getNarcFormats("BW2");
  const personalLength = byteLength(formats.personal!);
  const personal = Array.from({ length: 709 }, (_unused, id) =>
    packRecord(formats.personal!, id === SPINDA_ID ? { base_hp: 60, base_atk: 60, num_forms: 1 } : { num_forms: 1 }),
  );
  personal.push(new Uint8Array(1370));

  const learnsets = Array.from({ length: 709 }, () => Uint8Array.of(0xff, 0xff, 0xff, 0xff));
  learnsets[SPINDA_ID] = Uint8Array.of(33, 0, 5, 0, 0xff, 0xff, 0xff, 0xff);
  const evolutions = Array.from({ length: 709 }, () => new Uint8Array(42));
  evolutions[SPINDA_ID][0] = 4;

  const spriteFiles = Array.from({ length: 15065 }, () => new Uint8Array());
  for (let file = 0; file < 20; file += 1) spriteFiles[SPINDA_ID * 20 + file] = Uint8Array.of(0x80 + file, file);
  for (let file = 0; file < 5; file += 1) spriteFiles[15060 + file] = Uint8Array.of(0xf0 + file);

  const iconFiles = Array.from({ length: 1510 }, () => new Uint8Array());
  const baseIconIndex = BW2_ICON_HEADER_FILES + SPINDA_ID * 2;
  iconFiles[baseIconIndex] = Uint8Array.of(3, 2, 7);
  iconFiles[baseIconIndex + 1] = Uint8Array.of(4, 1);

  const arm9 = new Uint8Array(BW2_ICON_PALETTE_OFFSET + 800);
  arm9.fill(0x11, BW2_ICON_PALETTE_OFFSET, BW2_ICON_PALETTE_OFFSET + 16);
  arm9[BW2_ICON_PALETTE_OFFSET + SPINDA_ID] = 0x21;
  writeInt(arm9, BW2_ICON_PALETTE_POINTER_OFFSET, 4, GEN5_ARM9_RAM_ADDRESS + BW2_ICON_PALETTE_OFFSET);
  writeInt(arm9, BW2_HEAP_START_POINTER_OFFSET, 4, GEN5_ARM9_RAM_ADDRESS + arm9.length + 0x100);

  return {
    session: {
      romName: "retail-white-2",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, learnsets: 2, evolutions: 3, pokemon_sprites: 4, pokemon_icons: 5 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: personalLength },
    arm9,
    overlays: {},
    narcs: {
      personal: makeStore("personal", personal),
      learnsets: makeStore("learnsets", learnsets),
      evolutions: makeStore("evolutions", evolutions),
      pokemon_sprites: makeStore("pokemon_sprites", spriteFiles),
      pokemon_icons: makeStore("pokemon_icons", iconFiles),
    },
    texts: { banks: { pokedex: Array.from({ length: 650 }, (_unused, id) => (id === SPINDA_ID ? "Spinda" : `Pokemon ${id}`)) } },
    formats,
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
  const out = new Uint8Array(byteLength(format));
  let offset = 0;
  for (const [size, field] of format) {
    writeInt(out, offset, size, values[field] ?? 0);
    offset += size;
  }
  return out;
}

function byteLength(format: FieldSpec[]): number {
  return format.reduce((sum, [size]) => sum + size, 0);
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let index = 0; index < size; index += 1) out[offset + index] = Math.floor(value / 2 ** (index * 8)) & 0xff;
}
