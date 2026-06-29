import { describe, expect, it } from "vitest";
import type { BaseRom, BaseVersion, NarcName } from "../pokeweb/constants";
import { getMoveTextInfo, updateMoveDescription, updateMoveTextName } from "../pokeweb/moveTextModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import { decodeGen5TextBank, encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { getTextBank } from "../pokeweb/textModel";

describe("moveTextModel", () => {
  it("collects BW2 move battle/name/uppercase/description banks", () => {
    const project = makeProject("BW2", "W2");

    const info = getMoveTextInfo(project, 4);

    expect(info?.title).toBe("Comet Punch");
    expect(info?.description).toContain("flurry of punches");
    expect(info?.sections.find((section) => section.bankId === 16)?.lines.map((line) => line.entryIndex)).toEqual([12, 13, 14]);
    expect(info?.sections.find((section) => section.bankId === 403)?.lines[0]?.text).toBe("Comet Punch");
    expect(info?.sections.find((section) => section.bankId === 488)?.lines[0]?.text).toBe("COMET PUNCH");
  });

  it("renames BW2 move references and edits descriptions", () => {
    const project = makeProject("BW2", "W2");

    updateMoveTextName(project, 4, "meteor mash");
    updateMoveDescription(project, 4, "The target is hit by a heavy\nmetallic punch.");

    expect(getTextBank(project, "message_texts", 16)[12][1]).toBe("VAR(258, 0) used\\nMeteor Mash!");
    expect(getTextBank(project, "message_texts", 16)[13][1]).toBe("The wild VAR(258, 0) used\\nMeteor Mash!");
    expect(getTextBank(project, "message_texts", 403)[4][1]).toBe("Meteor Mash");
    expect(getTextBank(project, "message_texts", 488)[4][1]).toBe("METEOR MASH");
    expect(getTextBank(project, "message_texts", 402)[4][1]).toBe("The target is hit by a heavy\\nmetallic punch.");
    expect(project.narcs.message_texts?.dirty.has(16)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(402)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(403)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(488)).toBe(true);
    expect(project.texts.banks.moves?.[4]).toBe("Meteor Mash");
  });

  it("renames BW move references with BW-specific banks", () => {
    const project = makeProject("BW", "W");

    updateMoveTextName(project, 4, "mega punch");

    expect(getTextBank(project, "message_texts", 13)[12][1]).toBe("VAR(257, 0) used\\nMega Punch!");
    expect(getTextBank(project, "message_texts", 203)[4][1]).toBe("Mega Punch");
    expect(getTextBank(project, "message_texts", 286)[4][1]).toBe("MEGA PUNCH");
    expect(project.narcs.message_texts?.dirty.has(13)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(203)).toBe(true);
    expect(project.narcs.message_texts?.dirty.has(286)).toBe(true);
    expect(project.texts.banks.moves?.[4]).toBe("Mega Punch");
  });
});

function makeProject(baseRom: "BW" | "BW2", baseVersion: BaseVersion): ProjectState {
  const rawFiles: Uint8Array[] = [];
  const messageTexts: Gen5TextEntry[][] = [];
  const banks =
    baseRom === "BW2"
      ? {
          battle: 16,
          description: 402,
          name: 403,
          uppercase: 488,
          battleVar: "VAR(258, 0)",
        }
      : {
          battle: 13,
          description: 202,
          name: 203,
          uppercase: 286,
          battleVar: "VAR(257, 0)",
        };

  setBank(rawFiles, messageTexts, banks.battle, makeBank(15, {
    12: `${banks.battleVar} used\\nComet Punch!`,
    13: `The wild ${banks.battleVar} used\\nComet Punch!`,
    14: `The foe's ${banks.battleVar} used\\nComet Punch!`,
  }));
  setBank(rawFiles, messageTexts, banks.description, makeBank(6, {
    4: "The target is hit with a flurry of punches\\nthat strike two to five times in a row.",
  }));
  setBank(rawFiles, messageTexts, banks.name, makeBank(6, { 4: "Comet Punch" }));
  setBank(rawFiles, messageTexts, banks.uppercase, makeBank(6, { 4: "COMET PUNCH" }));

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
      banks: {},
      messageTexts,
    },
    formats: {},
    trpokInfo: [],
  };
}

function makeBank(count: number, overrides: Record<number, string>): Gen5TextEntry[] {
  return Array.from({ length: count }, (_, index) => [`0_${index}`, overrides[index] ?? "", 0]);
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
