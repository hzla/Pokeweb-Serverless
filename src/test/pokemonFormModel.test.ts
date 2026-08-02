import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import {
  addPokemonForm,
  deletePokemonForm,
  getPokemonFormDeletionAvailability,
  repairAppendedPokemonFormNames,
} from "../pokeweb/pokemonFormModel";
import { pokemonPersonalDisplayIds } from "../pokeweb/pokemonLabels";
import { getPokemonCount, getPokemonPersonalIds } from "../pokeweb/pokemonModel";
import { getPokemonIconPaletteAssignment, repairPokemonIconPaletteAssignmentPlacement } from "../pokeweb/pokemonSpriteModel";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";

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
    const names = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[90]);
    expect(names).toHaveLength(711);
    expect(names[709]?.[1]).toBe("");
    expect(names[710]?.[1]).toBe("SPINDA");
    expect(project.texts.banks.pokedex?.[710]).toBe("Spinda");

    const sprites = project.narcs.pokemon_sprites!;
    expect(sprites.rawFiles).toHaveLength(15100);
    expect(sprites.rawFiles.slice(15060, 15065)).toEqual(partialReservedSprite);
    expect(sprites.rawFiles.slice(15065, 15080)).toEqual(sourceSprite.slice(5));
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

    for (const name of ["personal", "learnsets", "evolutions", "pokemon_sprites", "pokemon_icons", "message_texts"] as const) {
      expect(project.narcs[name]!.dirty.size).toBeGreaterThan(0);
      expect(project.narcs[name]!.fileCount).toBe(project.narcs[name]!.rawFiles.length);
    }
  });

  it("continues appending aligned form blocks without adding another 709 filler", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    const result = addPokemonForm(project, SPINDA_ID);

    expect(result).toMatchObject({ personalId: 711, spriteId: 755, relocatedForms: 0, paddedLearnsetEntries: 0, paddedEvolutionEntries: 0 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(712);
    expect(project.narcs.learnsets!.rawFiles).toHaveLength(712);
    expect(project.narcs.evolutions!.rawFiles).toHaveLength(712);
    expect(project.narcs.pokemon_sprites!.rawFiles).toHaveLength(15120);
    expect(project.narcs.pokemon_icons!.rawFiles).toHaveLength(1520);
    expect(getPokemonIconPaletteAssignment(project, 754, "male")).toEqual({ editable: true, paletteId: 1 });
    expect(getPokemonIconPaletteAssignment(project, 755, "female")).toEqual({ editable: true, paletteId: 2 });
    const names = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[90]);
    expect(names[710]?.[1]).toBe("SPINDA");
    expect(names[711]?.[1]).toBe("SPINDA");
  });

  it("deletes an appended form, its generated files and name, its palette byte, and evolution references", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    const evolution = project.narcs.evolutions!.rawFiles[1];
    writeInt(evolution, 0, 2, 4);
    writeInt(evolution, 2, 2, 20);
    writeInt(evolution, 4, 2, 710);
    const paletteTablePointer = readU32(project.arm9, BW2_ICON_PALETTE_POINTER_OFFSET);
    const heapStartPointer = readU32(project.arm9, BW2_HEAP_START_POINTER_OFFSET);
    const relocatedArm9Length = project.arm9.length;

    expect(getPokemonFormDeletionAvailability(project, 710)).toMatchObject({
      deletable: true,
      speciesId: SPINDA_ID,
      formIndex: 1,
      personalId: 710,
      spriteId: 754,
    });
    const result = deletePokemonForm(project, 710);

    expect(result).toEqual({
      speciesId: SPINDA_ID,
      formIndex: 1,
      personalId: 710,
      spriteId: 754,
      remainingFormCount: 1,
      clearedEvolutionTargets: 1,
    });
    expect(decodeRecord(project, "personal", SPINDA_ID).raw).toMatchObject({ form_id: 0, form: 0, num_forms: 1 });
    expect(decodeRecord(project, "evolutions", 1).raw).toMatchObject({ method_0: 0, param_0: 0, target_0: 0 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(710);
    expect(project.narcs.learnsets!.rawFiles).toHaveLength(710);
    expect(project.narcs.evolutions!.rawFiles).toHaveLength(710);
    expect(project.narcs.pokemon_sprites!.rawFiles).toHaveLength(15080);
    expect(project.narcs.pokemon_icons!.rawFiles).toHaveLength(1516);
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[90])).toHaveLength(710);
    expect(project.texts.banks.pokedex).toHaveLength(710);
    expect(getPokemonPersonalIds(project)).not.toContain(710);
    expect(getPokemonIconPaletteAssignment(project, 754, "male")).toEqual({ editable: true, paletteId: 0 });
    expect(getPokemonIconPaletteAssignment(project, 754, "female")).toEqual({ editable: true, paletteId: 0 });
    expect(readU32(project.arm9, BW2_ICON_PALETTE_POINTER_OFFSET)).toBe(paletteTablePointer);
    expect(readU32(project.arm9, BW2_HEAP_START_POINTER_OFFSET)).toBe(heapStartPointer);
    expect(project.arm9).toHaveLength(relocatedArm9Length);
  });

  it("deletes several forms in reverse order without leaving an orphan personal record", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    addPokemonForm(project, SPINDA_ID);

    expect(getPokemonFormDeletionAvailability(project, 710)).toMatchObject({
      deletable: false,
      reason: "Delete this Pokemon's forms in reverse order, starting with its last form.",
    });
    const newest = deletePokemonForm(project, 711);
    expect(newest).toMatchObject({ formIndex: 2, remainingFormCount: 2 });
    expect(decodeRecord(project, "personal", SPINDA_ID).raw).toMatchObject({ form_id: 710, form: 69, num_forms: 2 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(711);
    expect(project.narcs.pokemon_sprites!.rawFiles).toHaveLength(15100);
    expect(getPokemonFormDeletionAvailability(project, 710)).toMatchObject({ deletable: true });

    const oldest = deletePokemonForm(project, 710);
    expect(oldest).toMatchObject({ formIndex: 1, remainingFormCount: 1 });
    expect(decodeRecord(project, "personal", SPINDA_ID).raw).toMatchObject({ form_id: 0, form: 0, num_forms: 1 });
    expect(project.narcs.personal!.rawFiles).toHaveLength(710);
    expect(project.narcs.pokemon_sprites!.rawFiles).toHaveLength(15080);
    expect(project.narcs.pokemon_icons!.rawFiles).toHaveLength(1516);
    expect(getPokemonPersonalIds(project)).not.toContain(710);
  });

  it("moves an already-expanded icon palette table out of PMC overlay memory", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    const unsafeTableAddress = readU32(project.arm9, BW2_ICON_PALETTE_POINTER_OFFSET);
    const unsafeAssignment = getPokemonIconPaletteAssignment(project, 754, "male");

    project.codeInjection = {
      pmc: {
        overlayId: 344,
        overlayBaseAddress: unsafeTableAddress - 16,
        overlayPath: "overlay/overlay_0344.bin",
      },
    };
    writeInt(project.arm9, BW2_HEAP_START_POINTER_OFFSET, 4, unsafeTableAddress - 16 + 0x8000);

    expect(repairPokemonIconPaletteAssignmentPlacement(project)).toBe(true);

    const safeTableAddress = readU32(project.arm9, BW2_ICON_PALETTE_POINTER_OFFSET);
    expect(safeTableAddress).toBeGreaterThanOrEqual(unsafeTableAddress - 16 + 0x8000 + 16);
    expect(safeTableAddress).not.toBe(unsafeTableAddress);
    expect(getPokemonIconPaletteAssignment(project, 754, "male")).toEqual(unsafeAssignment);
  });

  it("repairs a missing name entry for a previously appended BW2 form", () => {
    const project = makeRetailBw2Project();
    addPokemonForm(project, SPINDA_ID);
    const originalNames = project.texts.messageTexts![90].slice(0, 650);
    project.texts.messageTexts![90] = originalNames;
    project.narcs.message_texts!.rawFiles[90] = encodeGen5TextBank(originalNames);
    project.texts.banks.pokedex = project.texts.banks.pokedex!.slice(0, 650);

    expect(repairAppendedPokemonFormNames(project)).toBe(true);

    const repaired = decodeGen5TextBank(project.narcs.message_texts!.rawFiles[90]);
    expect(repaired).toHaveLength(711);
    expect(repaired[710]?.[1]).toBe("SPINDA");
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

  const pokemonNames: Gen5TextEntry[] = Array.from({ length: 650 }, (_unused, id) => [
    `0_${id}`,
    id === SPINDA_ID ? "SPINDA" : `POKEMON ${id}`,
    0,
  ]);
  const messageTextFiles: Uint8Array[] = Array.from({ length: 91 }, () => new Uint8Array());
  messageTextFiles[90] = encodeGen5TextBank(pokemonNames);
  const messageTexts: Gen5TextEntry[][] = Array.from({ length: 91 }, () => []);
  messageTexts[90] = decodeGen5TextBank(messageTextFiles[90]);

  return {
    session: {
      romName: "retail-white-2",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { personal: 1, learnsets: 2, evolutions: 3, pokemon_sprites: 4, pokemon_icons: 5, message_texts: 6 },
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
      message_texts: makeStore("message_texts", messageTextFiles),
    },
    texts: {
      banks: { pokedex: Array.from({ length: 650 }, (_unused, id) => (id === SPINDA_ID ? "Spinda" : `Pokemon ${id}`)) },
      messageTexts,
    },
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
