import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BaseVersion, NarcName } from "../pokeweb/constants";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import { getPokemonTextInfo, updatePokemonTextName } from "../pokeweb/pokemonTextModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { getTextBank } from "../pokeweb/textModel";

describe("pokemonTextModel", () => {
  it("finds only the species-indexed Info Text name banks in clean BW and BW2 ROMs", async () => {
    const fixtures = [
      {
        fileName: "white.nds",
        baseRom: "BW",
        nameBanks: [70, 253, 254, 255, 256, 257, 258, 259, 281, 284],
        dictionaryBank: 101,
        dictionaryEntry: 83,
        storyBank: 122,
      },
      {
        fileName: "cleanwhite2.nds",
        baseRom: "BW2",
        nameBanks: [90, 458, 459, 460, 461, 462, 463, 483, 486],
        dictionaryBank: 114,
        dictionaryEntry: 83,
        storyBank: 136,
      },
    ] as const;

    for (const fixture of fixtures) {
      const romUrl = new URL(`../../../${fixture.fileName}`, import.meta.url);
      if (!existsSync(romUrl)) continue;
      const project = await loadProjectFromRomBytes(new Uint8Array(readFileSync(romUrl)), fixture.fileName, { selectedNarcs: [] });
      const info = getPokemonTextInfo(project, 1);
      expect(project.session.baseRom).toBe(fixture.baseRom);
      expect(info?.title).toBe("Bulbasaur");
      expect(info?.sections.map((section) => section.bankId)).toEqual(fixture.nameBanks);
      expect(info?.sections.filter((section) => section.editable).map((section) => section.language)).toEqual([
        "English",
        "English",
        "English",
        "English",
      ]);

      const nameValuesBefore = new Map(info?.sections.map((section) => [section.bankId, section.lines[0]?.text]));
      const dictionaryBefore = getTextBank(project, "message_texts", fixture.dictionaryBank)[fixture.dictionaryEntry][1];
      const storyBefore = getTextBank(project, "story_texts", fixture.storyBank)[73][1];
      const renamed = updatePokemonTextName(project, 1, "Bulbax");

      expect(renamed.title).toBe("Bulbax");
      expect(renamed.sections.map((section) => section.bankId)).toEqual(fixture.nameBanks);
      for (const section of renamed.sections) {
        if (section.editable) {
          expect(section.lines[0]?.text.endsWith(section.role === "uppercase" ? "BULBAX" : "Bulbax")).toBe(true);
        } else {
          expect(section.lines[0]?.text).toBe(nameValuesBefore.get(section.bankId));
        }
      }
      expect(getTextBank(project, "message_texts", fixture.dictionaryBank)[fixture.dictionaryEntry][1]).toBe(dictionaryBefore);
      expect(getTextBank(project, "story_texts", fixture.storyBank)[73][1]).toBe(storyBefore);
    }
  });

  it("renames BW2 English entries while leaving non-English names unchanged", () => {
    const project = makeProject("BW2", "W2", 1, "Bulbasaur", [
      [63, makeBank(2, { 1: "An item to be held by Bulbasaur." })],
      [90, makeBank(2, { 1: "Bulbasaur" })],
      [114, makeBank(84, { 83: "BULBASAUR" })],
      [458, makeBank(2, { 1: "Bulbasaur" })],
      [459, makeBank(2, { 1: "Bulbizarre" })],
      [483, makeBank(2, { 1: "VAR(48385)a VAR(65280, 255)Bulbasaur" })],
      [486, makeBank(2, { 1: "BULBASAUR" })],
    ]);

    const before = getPokemonTextInfo(project, 1);
    expect(before?.sections.map((section) => section.bankId)).toEqual([90, 458, 459, 483, 486]);

    const after = updatePokemonTextName(project, 1, "Sproutling-X");

    expect(after.title).toBe("Sproutling-X");
    expect(getTextBank(project, "message_texts", 90)[1][1]).toBe("Sproutling-X");
    expect(getTextBank(project, "message_texts", 458)[1][1]).toBe("Sproutling-X");
    expect(getTextBank(project, "message_texts", 459)[1][1]).toBe("Bulbizarre");
    expect(getTextBank(project, "message_texts", 483)[1][1]).toBe("VAR(48385)a VAR(65280, 255)Sproutling-X");
    expect(getTextBank(project, "message_texts", 486)[1][1]).toBe("SPROUTLING-X");
    expect(getTextBank(project, "message_texts", 63)[1][1]).toBe("An item to be held by Bulbasaur.");
    expect(getTextBank(project, "message_texts", 114)[83][1]).toBe("BULBASAUR");
    expect(project.texts.banks.pokedex?.[1]).toBe("Sproutling-X");
    expect([...project.narcs.message_texts!.dirty]).toEqual(expect.arrayContaining([90, 458, 483, 486]));
    expect(project.narcs.message_texts!.dirty.has(459)).toBe(false);
  });

  it("uses BW-specific English banks and updates the grammar article", () => {
    const project = makeProject("BW", "W", 1, "Bulbasaur", [
      [70, makeBank(2, { 1: "Bulbasaur" })],
      [253, makeBank(2, { 1: "Bulbasaur" })],
      [254, makeBank(2, { 1: "Bulbizarre" })],
      [281, makeBank(2, { 1: "VAR(48385)a VAR(65280, 255)Bulbasaur" })],
      [284, makeBank(2, { 1: "BULBASAUR" })],
    ]);

    updatePokemonTextName(project, 1, "Ivyling");

    expect(getTextBank(project, "message_texts", 70)[1][1]).toBe("Ivyling");
    expect(getTextBank(project, "message_texts", 253)[1][1]).toBe("Ivyling");
    expect(getTextBank(project, "message_texts", 254)[1][1]).toBe("Bulbizarre");
    expect(getTextBank(project, "message_texts", 281)[1][1]).toBe("VAR(48385)an VAR(65280, 255)Ivyling");
    expect(getTextBank(project, "message_texts", 284)[1][1]).toBe("IVYLING");
    expect(project.texts.banks.pokedex?.[1]).toBe("Ivyling");
  });

  it("does not edit incidental mentions in other Info Text banks", () => {
    const project = makeProject("BW2", "W2", 151, "Mew", [
      [90, makeBank(152, { 151: "Mew" })],
      [200, makeBank(2, { 0: "Mew met Mewtwo and MEW.", 1: "Mewtwo remained unchanged." })],
      [486, makeBank(152, { 151: "MEW" })],
    ]);

    updatePokemonTextName(project, 151, "Nova");

    expect(getTextBank(project, "message_texts", 90)[151][1]).toBe("Nova");
    expect(getTextBank(project, "message_texts", 486)[151][1]).toBe("NOVA");
    expect(getTextBank(project, "message_texts", 200)[0][1]).toBe("Mew met Mewtwo and MEW.");
    expect(getTextBank(project, "message_texts", 200)[1][1]).toBe("Mewtwo remained unchanged.");
  });

  it("overwrites localized raw glyph names at the matching species index", () => {
    const project = makeProject("BW", "W", 29, "Nidoran F", [
      [70, makeBank(30, { 29: "Nidoran⑮" })],
      [253, makeBank(30, { 29: "Nidoran⑮" })],
      [284, makeBank(30, { 29: "NIDORAN⑮" })],
    ]);

    updatePokemonTextName(project, 29, "Nidora");

    expect(getTextBank(project, "message_texts", 70)[29][1]).toBe("Nidora");
    expect(getTextBank(project, "message_texts", 253)[29][1]).toBe("Nidora");
    expect(getTextBank(project, "message_texts", 284)[29][1]).toBe("NIDORA");
  });
});

function makeProject(
  baseRom: "BW" | "BW2",
  baseVersion: BaseVersion,
  speciesId: number,
  speciesName: string,
  bankEntries: Array<[number, Gen5TextEntry[]]>,
): ProjectState {
  const rawFiles: Uint8Array[] = [];
  const messageTexts: Gen5TextEntry[][] = [];
  for (const [bankId, entries] of bankEntries) setBank(rawFiles, messageTexts, bankId, entries);

  return {
    session: {
      romName: "test",
      generation: "gen5",
      baseVersion,
      baseRom,
      fairy: false,
      fileIds: { message_texts: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      message_texts: makeStore("message_texts", rawFiles),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: {
      banks: { pokedex: Array.from({ length: speciesId + 1 }, (_unused, index) => (index === speciesId ? speciesName : `Pokemon ${index}`)) },
      messageTexts,
    },
    formats: {},
    trpokInfo: [],
  };
}

function makeBank(count: number, overrides: Record<number, string>): Gen5TextEntry[] {
  return Array.from({ length: count }, (_unused, index) => [`0_${index}`, overrides[index] ?? "", 0]);
}

function setBank(rawFiles: Uint8Array[], messageTexts: Gen5TextEntry[][], bankId: number, entries: Gen5TextEntry[]): void {
  rawFiles[bankId] = encodeGen5TextBank(entries);
  messageTexts[bankId] = decodeGen5TextBank(rawFiles[bankId]);
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
