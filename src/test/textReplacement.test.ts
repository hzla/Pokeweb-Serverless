import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { BW2_MESSAGE_BANKS } from "../pokeweb/constants";
import { decodeGen4TextBank, decodeGen5TextBank, encodeGen4TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { applyTextReplacement, getTextBank, previewTextReplacement } from "../pokeweb/textModel";

function makeProject(banks: Gen5TextEntry[][], gen4 = false): ProjectState {
  const encode = gen4 ? encodeGen4TextBank : encodeGen5TextBank;
  const rawFiles = banks.map(encode);
  return {
    session: { romName: "test", baseVersion: gen4 ? "Pt" : "W2", baseRom: gen4 ? "Pt" : "BW2", fairy: false, fileIds: { message_texts: 1 }, blacklist: [] },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, formats: {}, trpokInfo: [],
    narcs: {
      message_texts: { name: "message_texts", fileId: 1, sourcePath: "test", fileCount: banks.length, rawFiles, records: new Map(), dirty: new Set() },
      story_texts: { name: "story_texts", fileId: 2, sourcePath: "test", fileCount: 1, rawFiles: [encode([["0_0", "Bulbasaur", 0]])], records: new Map(), dirty: new Set() },
    },
    texts: { banks: {} },
  } as ProjectState;
}

describe("text find and replace", () => {
  it("previews exact occurrence counts without modifying text, bytes, dirty state, or changelog", () => {
    const project = makeProject([
      [["0_0", "Bulbasaur BULBASAUR bulbasaur", 0], ["0_1", "Unchanged", 0]],
      [["0_0", "Bulbasaur", 0]],
    ]);
    const original = project.narcs.message_texts!.rawFiles.map((bytes) => bytes.slice());
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", "capitalization-aware");
    expect(plan.replacementCount).toBe(4);
    expect(plan.bankCount).toBe(2);
    expect(plan.changes).toHaveLength(2);
    expect(plan.matches.map(({ bankId, entryIndex, offset, length }) => [bankId, entryIndex, offset, length])).toEqual([
      [0, 0, 0, 9], [0, 0, 10, 9], [0, 0, 20, 9], [1, 0, 0, 9],
    ]);
    expect(getTextBank(project, "message_texts", 0)[0][1]).toBe("Bulbasaur BULBASAUR bulbasaur");
    expect(project.narcs.message_texts!.rawFiles).toEqual(original);
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();

    applyTextReplacement(project, plan);
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[0]).map((entry) => entry[1])).toEqual(["Charmander CHARMANDER charmander", "Unchanged"]);
    expect(project.narcs.message_texts!.dirty).toEqual(new Set([0, 1]));
    expect(project.narcs.message_texts!.revision).toBe(2);
    expect(project.actionChangelog!.entries.map((entry) => entry.key)).toEqual(["text:message_texts:0:0", "text:message_texts:1:0"]);
    expect(decodeGen5TextBank(project.narcs.story_texts!.rawFiles[0])[0][1]).toBe("Bulbasaur");
    expect(project.narcs.story_texts!.dirty.size).toBe(0);
  });

  it.each([
    ["match-case", "Charmander BULBASAUR bulbasaur bUlBaSaUr", 1],
    ["ignore-case", "Charmander Charmander Charmander Charmander", 4],
    ["capitalization-aware", "Charmander CHARMANDER charmander Charmander", 4],
  ] as const)("uses %s matching", (mode, expected, count) => {
    const project = makeProject([[["0_0", "Bulbasaur BULBASAUR bulbasaur bUlBaSaUr", 0]]]);
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", mode);
    expect(plan.changes[0].after).toBe(expected);
    expect(plan.replacementCount).toBe(count);
  });

  it("preserves multiword capitalization, punctuation, accents, and replacement control codes", () => {
    const project = makeProject([[["0_0", "MR. MIME / Mr. Mime / mr. mime", 0], ["0_1", "POKÉMON Pokémon pokémon", 0]]]);
    expect(previewTextReplacement(project, "message_texts", "Mr. Mime", "mime jr.", "capitalization-aware").changes[0].after)
      .toBe("MIME JR. / Mime Jr. / mime jr.");
    const replacement = "évoli\\nVAR(1, 2)\\x01AF\\f\\r{1234 5,6}";
    const plan = previewTextReplacement(project, "message_texts", "Pokémon", replacement, "capitalization-aware");
    expect(plan.changes[0].after).toBe([
      "ÉVOLI\\nVAR(1, 2)\\x01AF\\f\\r{1234 5,6}",
      "Évoli\\nVAR(1, 2)\\x01AF\\f\\r{1234 5,6}",
      replacement,
    ].join(" "));
    expect(previewTextReplacement(project, "message_texts", "POKÉMON", "{TRAINER_NAME:évoli}", "capitalization-aware").changes[0].after)
      .toBe("{TRAINER_NAME:ÉVOLI} {TRAINER_NAME:Évoli} {TRAINER_NAME:évoli}");
  });

  it("handles literal punctuation, dollar substitutions, whitespace, empty replacements, and non-overlapping matches", () => {
    const project = makeProject([[["0_0", "[a.*], [a.*], aaaaa", 0]]]);
    expect(previewTextReplacement(project, "message_texts", "[a.*], ", "$&$1", "match-case").changes[0].after).toBe("$&$1$&$1aaaaa");
    const plan = previewTextReplacement(project, "message_texts", "aa", "", "match-case");
    expect(plan.replacementCount).toBe(2);
    expect(plan.changes[0].after).toBe("[a.*], [a.*], a");
    expect(previewTextReplacement(project, "message_texts", " ", "_", "match-case").replacementCount).toBe(2);
  });

  it("ignores empty searches, absent text, and replacements that would not change a match", () => {
    const project = makeProject([[["0_0", "Bulbasaur BULBASAUR bulbasaur", 0]]]);
    for (const find of ["", "Missing", "Bulbasaur"]) {
      const plan = previewTextReplacement(project, "message_texts", find, "Bulbasaur", "capitalization-aware");
      expect(plan.replacementCount).toBe(0);
      expect(plan.changes).toEqual([]);
      expect(plan.bankCount).toBe(0);
      applyTextReplacement(project, plan);
    }
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "Bulbasaur", "ignore-case");
    expect(plan.matches).toHaveLength(3);
    expect(plan.replacementCount).toBe(2);
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
  });

  it("limits changes to the selected bank and works on story text", () => {
    const project = makeProject([[["0_0", "Bulbasaur", 0]], [["0_0", "Bulbasaur", 0]]]);
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", "match-case", 1);
    expect(plan.replacementCount).toBe(1);
    applyTextReplacement(project, plan);
    expect(getTextBank(project, "message_texts", 0)[0][1]).toBe("Bulbasaur");
    expect(getTextBank(project, "message_texts", 1)[0][1]).toBe("Charmander");
    expect(project.narcs.message_texts!.dirty).toEqual(new Set([1]));
    applyTextReplacement(project, previewTextReplacement(project, "story_texts", "Bulbasaur", "Charmander", "match-case"));
    expect(decodeGen5TextBank(project.narcs.story_texts!.rawFiles[0])[0][1]).toBe("Charmander");
  });

  it("updates known display-name caches", () => {
    const source = BW2_MESSAGE_BANKS.find(([, name]) => name === "pokedex")![0];
    expect(typeof source).toBe("number");
    const project = makeProject(Array.from({ length: (source as number) + 1 }, () => [["0_0", "Bulbasaur", 0]]));
    applyTextReplacement(project, previewTextReplacement(project, "message_texts", "Bulbasaur", "CHARMANDER", "match-case", source as number));
    expect(project.texts.banks.pokedex).toEqual(["Charmander"]);
  });

  it("round-trips Gen IV text and preserves entry metadata and control codes", () => {
    const project = makeProject([[["0_0", "BULBASAUR\\n{1234 5,6}", 0x2468], ["0_1", "bulbasaur", 0x2468]]], true);
    applyTextReplacement(project, previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", "capitalization-aware"));
    expect(decodeGen4TextBank(project.narcs.message_texts!.rawFiles[0])).toEqual([
      ["0_0", "CHARMANDER\\xE000{1234 5,6}", 0x2468], ["0_1", "charmander", 0x2468],
    ]);
  });

  it("preserves Gen V blocks, compressed entry IDs, and flags", () => {
    const project = makeProject([[["0_0c", "BULBASAUR", 0], ["1_0", "bulbasaur", 0]]]);
    const metadata = getTextBank(project, "message_texts", 0).map(([id, , flags]) => [id, flags]);
    applyTextReplacement(project, previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", "capitalization-aware"));
    expect(getTextBank(project, "message_texts", 0).map(([id, , flags]) => [id, flags])).toEqual(metadata);
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[0]).map(([id, text]) => [id, text])).toEqual([["0_0c", "CHARMANDER"], ["1_0", "charmander"]]);
  });

  it("leaves every bank untouched if a later bank cannot encode the replacement", () => {
    const project = makeProject([[["0_0", "Bulbasaur", 0]], [["0_0c", "Bulbasaur", 0]]]);
    const original = project.narcs.message_texts!.rawFiles.map((bytes) => bytes.slice());
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "\\x1234", "match-case");
    expect(() => applyTextReplacement(project, plan)).toThrow(/Cannot compress/u);
    expect(project.narcs.message_texts!.rawFiles).toEqual(original);
    expect([0, 1].map((bankId) => getTextBank(project, "message_texts", bankId)[0][1])).toEqual(["Bulbasaur", "Bulbasaur"]);
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
  });

  it("rejects a stale preview without applying earlier entries", () => {
    const project = makeProject([[["0_0", "Bulbasaur", 0], ["0_1", "Bulbasaur", 0]]]);
    const plan = previewTextReplacement(project, "message_texts", "Bulbasaur", "Charmander", "match-case");
    getTextBank(project, "message_texts", 0)[1][1] = "Edited elsewhere";
    expect(() => applyTextReplacement(project, plan)).toThrow(/Text changed/u);
    expect(getTextBank(project, "message_texts", 0)[0][1]).toBe("Bulbasaur");
    expect(project.narcs.message_texts!.dirty.size).toBe(0);
    expect(project.actionChangelog).toBeUndefined();
  });
});
