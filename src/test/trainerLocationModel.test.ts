import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { Folder } from "../nds/fnt";
import type { NintendoDSRom } from "../nds/rom";
import type { ProjectState } from "../pokeweb/projectStore";
import { hydrateTrainerLocationTables, indirectTrainerContext, parseIndirectTrainerScripts, parseRoyalUnovaTrainerPool } from "../pokeweb/trainerLocationModel";
import { parseDungeonBossPools, parseFieldScriptRuntime, parseFunfestTrainerPool } from "../pokeweb/gen5TrainerRuntime";

const emptyContext = { stadium: [], royalUnova: [], partnerHelper: false };

describe("indirect trainer locations", () => {
  it("resolves stadium trainers by group and stage rather than NPC or group alone", () => {
    const context = { ...emptyContext, stadium: [
      { group: 0, stage: 1, trainerId: 1 },
      { group: 0, stage: 2, trainerId: 49 },
      { group: 1, stage: 3, trainerId: 3 },
      { group: 9, stage: 1, trainerId: 2 },
    ] };
    expect(parseIndirectTrainerScripts(script(0x1e3, 0, 0, 1, 0x1e0, 1, 5, 6, 3), context)).toEqual([1, 3]);
    expect(parseIndirectTrainerScripts(script(0x1e3, 9, 5, 1), context)).toEqual([2]);
    expect(parseIndirectTrainerScripts(script(0x1e3, 0, 0, 0x8000), context)).toEqual([]);
  });

  it("resolves random stadium and Ferris Wheel trainers from their ROM pools", () => {
    const context = { ...emptyContext,
      stadium: [
        { index: 79, group: 1, stage: 4, trainerId: 79 },
        { index: 80, group: 2, stage: 4, trainerId: 88 },
        { index: 131, group: 3, stage: 4, trainerId: 132 },
      ],
      field: { globals: [], zoneOverlays: {}, wheel: [10, 47, 803], wheelScriptFileIds: [] },
    };
    expect(parseIndirectTrainerScripts(script(0x1e4, 1, 2, 3, 0x8000, 0x8001, 0x8002), context)).toEqual([88, 132]);
    expect(parseIndirectTrainerScripts(script(0x220, 0, 0x8000), context)).toEqual([10, 47, 803]);
  });

  it("resolves Bianca's partner macro only with the verified helper and complete argument setup", () => {
    const setup = [0x2a, 0x8000, 13, 0x2a, 0x8001, 7, 0x2a, 0x8002, 1,
      0x2a, 0x8003, 4, 0x2a, 0x8004, 10538, 0x1c, 10535];
    const context = { ...emptyContext, partnerHelper: true };
    expect(parseIndirectTrainerScripts(script(...setup), context)).toEqual([4]);
    expect(parseIndirectTrainerScripts(script(...setup), emptyContext)).toEqual([]);
    expect(parseIndirectTrainerScripts(script(...setup.slice(3)), context)).toEqual([]);
    expect(parseIndirectTrainerScripts(script(0x2a, 0x8003, 4, 0x1c, 10535), context)).toEqual([]);
    expect(parseIndirectTrainerScripts(script(0x250, 13, 7, 1, 4, 10538), emptyContext)).toEqual([4]);
    expect(parseIndirectTrainerScripts(script(0x250, 13, 7, 1, 0x8003, 10538), emptyContext)).toEqual([]);
  });

  it("finds edited Royal Unova trainer IDs while rejecting incomplete or unrelated tables", () => {
    const pool = boatTable();
    writeU32(pool, 16 + 4, 777); // An edited Henry must resolve from the current ROM.
    expect(parseRoyalUnovaTrainerPool(pool)).toEqual([19, 777, 31, 16, 33, 34, 35, 37, 36, 141]);
    expect(parseRoyalUnovaTrainerPool(pool.slice(0, 159))).toEqual([]);
    writeU32(pool, 9 * 16 + 12, 999);
    expect(parseRoyalUnovaTrainerPool(pool)).toEqual([]);
  });

  it("uses the ship pool only for trainer-ID requests, not sprite or text requests", () => {
    const context = { ...emptyContext, royalUnova: [31, 32, 33, 34, 35, 36, 37] };
    expect(parseIndirectTrainerScripts(script(0x1a1, 0x4000, 6, 0, 0x8027), context)).toEqual(context.royalUnova);
    expect(parseIndirectTrainerScripts(script(0x1a1, 0x4000, 4, 0, 0x8027), context)).toEqual([]);
    expect(parseIndirectTrainerScripts(script(0x02, 0x1a1, 0x4000, 6, 0, 0x8027), context)).toEqual([]);
  });

  it("reads dynamic trainer pools from runtime data instead of fixed trainer IDs", () => {
    const field = new Uint8Array(64);
    [15, 55, 23, 52, 53, 64, 303, 296].forEach((value, index) => writeU16(field, index * 2, value));
    [10, 47, 803, 805, 136, 138, 804, 806].forEach((value, index) => writeU16(field, 16 + index * 2, value));
    expect(parseFieldScriptRuntime(field, 0, [], 0).wheel).toEqual([10, 47, 803, 805, 136, 138, 804, 806]);

    const dungeon = new Uint8Array(176);
    const whiteSprites = [35, 34, 37, 36, 33, 30, 31, 32, 33, 304, 32];
    const blackSprites = [34, 35, 36, 37, 32, 31, 30, 33, 32, 304, 33];
    whiteSprites.forEach((sprite, index) => {
      writeU32(dungeon, index * 8, 183 + index * 2);
      writeU32(dungeon, index * 8 + 4, sprite);
    });
    blackSprites.forEach((sprite, index) => {
      writeU32(dungeon, 88 + index * 8, 184 + index * 2);
      writeU32(dungeon, 88 + index * 8 + 4, sprite);
    });
    expect(parseDungeonBossPools(dungeon)).toEqual({
      white: whiteSprites.map((_, index) => 183 + index * 2),
      black: blackSprites.map((_, index) => 184 + index * 2),
    });

    const funfest = new Uint8Array(84);
    const trainers = Array.from({ length: 18 }, (_, index) => 700 + index);
    const gifts = [158, 40, 14, 15, 63, 15, 29, 15, 92, 10, 50, 5, 504, 20, 42, 20, 54, 20, 591, 20, 51, 15, 50, 5];
    trainers.forEach((value, index) => writeU16(funfest, index * 2, value));
    gifts.forEach((value, index) => writeU16(funfest, 36 + index * 2, value));
    expect(parseFunfestTrainerPool(funfest)).toEqual(trainers);
  });

  it("hydrates old projects and reads filesystem replacements after original ROM bytes are released", () => {
    const archive = new NARC();
    archive.files = [new Uint8Array(8)];
    writeU16(archive.files[0]!, 2, 1);
    writeU16(archive.files[0]!, 6, 1);
    const files = [archive.save(), boatTable()];
    const project = { session: { baseRom: "BW2" }, narcs: {}, overlays: {} } as unknown as ProjectState;
    const rom = { files, filenames: { idOf: () => 0 } as unknown as Folder,
      loadArm9Overlays: () => new Map([[89, { fileId: 1, compressed: false }]]) } as unknown as NintendoDSRom;
    hydrateTrainerLocationTables(project, rom);
    expect(indirectTrainerContext(project).stadium[0]?.trainerId).toBe(1);
    expect(indirectTrainerContext(project).royalUnova).toContain(31);
    writeU16(archive.files[0]!, 6, 777);
    project.fileSystem = { replacements: { 0: archive.save() } } as ProjectState["fileSystem"];
    expect(indirectTrainerContext(project).stadium[0]?.trainerId).toBe(777);
  });
});

function script(...words: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + words.length * 2);
  writeU32(bytes, 0, 2);
  writeU16(bytes, 4, 0xfd13);
  [...words, 0x02].forEach((word, i) => writeU16(bytes, 6 + i * 2, word));
  return bytes;
}

function boatTable(): Uint8Array {
  const rows = [[52, 19, 15, 16], [30, 32, 19, 20], [31, 31, 23, 24], [11, 16, 27, 28],
    [15, 33, 32, 33], [13, 34, 36, 37], [17, 35, 40, 41], [44, 37, 45, 46], [45, 36, 50, 51], [65, 141, 55, 56]];
  const bytes = new Uint8Array(160);
  rows.flat().forEach((word, i) => writeU32(bytes, i * 4, word));
  return bytes;
}
