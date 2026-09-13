import { describe, expect, it } from "vitest";
import { readU16 } from "../nds/binary";
import { NARC } from "../nds/narc";
import {
  KO_MOVE_LEARNSET_PATH,
  appendPokemonKoMove,
  copyPokemonKoMoves,
  deletePokemonKoMove,
  ensureKoMoveLearnsetNarc,
  getPokemonKoMoves,
  updatePokemonKoMoveField,
} from "../pokeweb/koMoveLearnsetModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("KO move learnsets", () => {
  it("creates one terminated retail-shaped member per personal ID", () => {
    const project = makeProject(4);
    const result = ensureKoMoveLearnsetNarc(project);
    const bytes = project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH];
    const archive = new NARC(bytes);

    expect(result).toMatchObject({ path: KO_MOVE_LEARNSET_PATH, members: 4 });
    expect(archive.files).toHaveLength(4);
    for (const member of archive.files) {
      expect(member).toHaveLength(4);
      expect(readU16(member, 0)).toBe(0xffff);
      expect(readU16(member, 2)).toBe(0xffff);
    }
  });

  it("round-trips move IDs and u16 KO thresholds through add, edit, copy, and delete", () => {
    const project = makeProject(3);
    ensureKoMoveLearnsetNarc(project);

    appendPokemonKoMove(project, 1);
    updatePokemonKoMoveField(project, 1, "move_id_0", "Tackle");
    updatePokemonKoMoveField(project, 1, "ko_count_0", "65535");
    expect(getPokemonKoMoves(project, 1)).toMatchObject([
      { index: 0, moveId: 1, moveName: "Tackle", koCount: 65535 },
    ]);

    copyPokemonKoMoves(project, 2, 1);
    expect(getPokemonKoMoves(project, 2)).toMatchObject([
      { moveId: 1, koCount: 65535 },
    ]);
    deletePokemonKoMove(project, 2, 0);
    expect(getPokemonKoMoves(project, 2)).toEqual([]);
    expect(() => updatePokemonKoMoveField(project, 1, "ko_count_0", "65536")).toThrow(/0–65535/u);
    expect(() => updatePokemonKoMoveField(project, 1, "ko_count_0", "-1")).toThrow(/0–65535/u);
  });

  it("extends an installed archive when a later custom form adds a personal member", () => {
    const project = makeProject(2);
    ensureKoMoveLearnsetNarc(project);
    project.narcs.personal!.fileCount = 4;

    appendPokemonKoMove(project, 3);
    expect(new NARC(project.fileSystem?.additions?.[KO_MOVE_LEARNSET_PATH]).files).toHaveLength(4);
    expect(getPokemonKoMoves(project, 3)).toHaveLength(1);
  });
});

function makeProject(memberCount: number): ProjectState {
  const store = (name: "personal" | "learnsets"): NarcStore => ({
    name,
    sourcePath: name,
    fileId: 0,
    fileCount: memberCount,
    rawFiles: Array.from({ length: memberCount }, () => new Uint8Array()),
    records: new Map(),
    dirty: new Set(),
  });
  return {
    session: {
      romName: "KO move test",
      generation: "gen5",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: { personal: store("personal"), learnsets: store("learnsets") },
    texts: { banks: { moves: ["", "Tackle", "Growl"] } },
    formats: {},
    trpokInfo: [],
    fileSystem: { replacements: {}, additions: {} },
  };
}
