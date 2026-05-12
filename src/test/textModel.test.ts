import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { addTextEntries, deleteLastTextEntries, getTextBank, updateTextEntry } from "../pokeweb/textModel";

describe("Gen V text backend", () => {
  it("encodes and decodes escaped Gen V text entries including flags and compressed text", () => {
    const entries: Gen5TextEntry[] = [
      ["0_0", "Hello\\nWorld", 0],
      ["0_1A", "VAR(1, 2, 3)\\f\\r\\x0001", 0x1234],
      ["0_2c", "ABC", 0],
    ];

    const decoded = decodeGen5TextBank(encodeGen5TextBank(entries));

    expect(decoded.map(([id, text]) => [id, text])).toEqual(entries.map(([id, text]) => [id, text]));
    expect(decoded[1][2]).toBe(0x1234);
  });

  it("rejects malformed text banks with impossible table sizes", () => {
    const malformed = new Uint8Array(16);
    malformed[0] = 1;
    malformed[2] = 0xff;
    malformed[3] = 0xff;
    malformed[12] = 16;

    expect(() => decodeGen5TextBank(malformed)).toThrow(/exceeds file size/u);
  });

  it("updates text banks in memory, rebuilds bytes, adds and deletes entries, and marks dirty", () => {
    const initial = encodeGen5TextBank([
      ["0_0", "Hello", 0],
      ["0_1", "World", 0],
    ]);
    const project = makeProject(initial);

    updateTextEntry(project, "message_texts", 0, 1, "Edited\\nLine");
    expect(getTextBank(project, "message_texts", 0)[1][1]).toBe("Edited\\nLine");
    expect(decodeGen5TextBank(project.narcs.message_texts!.rawFiles[0])[1][1]).toBe("Edited\\nLine");
    expect(project.narcs.message_texts?.dirty.has(0)).toBe(true);

    addTextEntries(project, "message_texts", 0, 2);
    expect(getTextBank(project, "message_texts", 0).map((entry) => entry[0])).toEqual(["0_0", "0_1", "0_2", "0_3"]);

    deleteLastTextEntries(project, "message_texts", 0, 1);
    expect(getTextBank(project, "message_texts", 0).map((entry) => entry[0])).toEqual(["0_0", "0_1", "0_2"]);
  });
});

function makeProject(messageBank: Uint8Array): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { message_texts: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: messageBank.length },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      message_texts: makeStore("message_texts", [messageBank]),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: {}, messageTexts: [decodeGen5TextBank(messageBank)] },
    formats: {},
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
