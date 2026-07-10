import { describe, expect, it } from "vitest";
import { readU16, readU32 } from "../nds/binary";
import type { NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { cleanDisplayText, decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { addTextEntries, deleteLastTextEntries, getTextBank, updateTextEntry } from "../pokeweb/textModel";

describe("Gen V text backend", () => {
  it("encodes and decodes escaped Gen V text entries including flags and compressed text", () => {
    const entries: Gen5TextEntry[] = [
      ["0_0", "Hello\\nWorld", 0],
      ["0_1A", "VAR(1, 2, 3)\\f\\r\\x0001", 0x1234],
      ["0_2c", "ABC", 0],
    ];

    const encoded = encodeGen5TextBank(entries);
    const decoded = decodeGen5TextBank(encoded);

    expect(decoded.map(([id, text]) => [id, text])).toEqual(entries.map(([id, text]) => [id, text]));
    expect(gameDecryptEntry(encoded, 0, 0)).toBe("Hello\\nWorld");
    expect(gameDecryptEntry(encoded, 0, 1)).toBe("VAR(1, 2, 3)\\f\\r\\x0001");
    expect(decoded[1][2]).toBe(getExpectedEncodedTerminator(1, 12));
  });

  it("rejects malformed text banks with impossible table sizes", () => {
    const malformed = new Uint8Array(16);
    malformed[0] = 1;
    malformed[2] = 0xff;
    malformed[3] = 0xff;
    malformed[12] = 16;

    expect(() => decodeGen5TextBank(malformed)).toThrow(/exceeds file size/u);
  });

  it("formats Pokemon and move display names without changing raw text", () => {
    expect(cleanDisplayText("SWEET SCENT", true)).toBe("Sweet Scent");
    expect(cleanDisplayText("MR. MIME", true)).toBe("Mr. Mime");
    expect(cleanDisplayText("PORYGON-Z", true)).toBe("Porygon-Z");
    expect(cleanDisplayText("SWEET SCENT", false)).toBe("SWEET SCENT");
    expect(cleanDisplayText("\\x01E0\\x01E1 Trainer", false)).toBe("Pkmn Trainer");
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
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "message_texts" && entry.text.includes("Text Bank 0 entry 1 changed from World to Edited\\nLine."))).toBe(true);

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

function gameDecryptEntry(data: Uint8Array, blockIndex: number, entryIndex: number): string {
  const blockOffset = readU32(data, 12 + blockIndex * 4);
  const tableOffset = blockOffset + 4 + entryIndex * 8;
  const textOffset = blockOffset + readU32(data, tableOffset);
  const charCount = readU16(data, tableOffset + 4);
  let key = getGen5TextEntrySeed(entryIndex);
  const words: number[] = [];
  for (let index = 0; index < charCount; index += 1) {
    words.push(readU16(data, textOffset + index * 2) ^ key);
    key = rotateLeft16(key, 3);
  }
  return renderTestText(words);
}

function renderTestText(words: number[]): string {
  let text = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === 0xffff) break;
    if (word === 0xfffe) {
      text += "\\n";
    } else if (word === 0xf000) {
      const kind = words[index + 1];
      const count = words[index + 2];
      if (kind === 0xbe00 && count === 0) {
        text += "\\f";
      } else if (kind === 0xbe01 && count === 0) {
        text += "\\r";
      } else {
        text += `VAR(${[kind, ...words.slice(index + 3, index + 3 + count)].join(", ")})`;
      }
      index += 2 + count;
    } else if (word < 20 || word > 0xf000) {
      text += `\\x${word.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      text += String.fromCharCode(word);
    }
  }
  return text;
}

function getExpectedEncodedTerminator(entryIndex: number, terminatorIndex: number): number {
  let key = getGen5TextEntrySeed(entryIndex);
  for (let index = 0; index < terminatorIndex; index += 1) key = rotateLeft16(key, 3);
  return 0xffff ^ key;
}

function getGen5TextEntrySeed(entryIndex: number): number {
  return (0x2983 * (entryIndex + 3)) & 0xffff;
}

function rotateLeft16(value: number, count: number): number {
  return ((value << count) | (value >>> (16 - count))) & 0xffff;
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
