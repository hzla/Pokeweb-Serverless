import { describe, expect, it } from "vitest";
import { writeU32 } from "../nds/binary";
import { parseGeneralPatch } from "../pokeweb/generalPatchModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  addFairyTypeSupport,
  applyModernFairyTypings,
  applyRemoveDustCloudGemRewardsToOverlay,
  applyRemoveDustCloudItemRewardsToOverlay,
} from "../pokeweb/romPatchModel";

describe("ROM patches", () => {
  it("parses bundled general patch sections", () => {
    const data = new Uint8Array(18);
    data[0] = 0x7b;
    data.set([0x74, 0x65, 0x73, 0x74], 1);
    data[5] = 0x7c;
    writeU32(data, 6, 5);
    data[10] = 0x3a;
    data.set([1, 2, 0x7d, 3, 4], 11);
    data[16] = 0x7d;

    const sections = parseGeneralPatch(data.subarray(0, 17));

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("test");
    expect([...sections[0].payload]).toEqual([1, 2, 0x7d, 3, 4]);
  });

  it("turns the cave dust-cloud gem branch into an unconditional skip", () => {
    const overlay = new Uint8Array([
      0x64, 0x28, 0x0b, 0xd2,
      0xa0, 0x42,
      0x0d, 0xd2,
      0x08, 0x48,
      0xff, 0xff,
      0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
    ]);

    const result = applyRemoveDustCloudGemRewardsToOverlay(overlay);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(6);
    expect(result?.overlay[7]).toBe(0xe0);
    expect(overlay[7]).toBe(0xd2);
  });

  it("recognizes an already-patched overlay", () => {
    const overlay = new Uint8Array([
      0x64, 0x28, 0x0b, 0xd2,
      0xa0, 0x42,
      0x0d, 0xe0,
      0x08, 0x48,
      0xff, 0xff,
      0x89, 0x20, 0x80, 0x00, 0x08, 0x18, 0x00, 0x04, 0x00, 0x0c, 0x10, 0xbd, 0xe5, 0x20, 0x10, 0xbd,
    ]);

    const result = applyRemoveDustCloudGemRewardsToOverlay(overlay);

    expect(result?.status).toBe("already-applied");
    expect(result?.overlay).toBe(overlay);
  });

  it("refuses overlays without a unique dust-cloud gem signature", () => {
    expect(applyRemoveDustCloudGemRewardsToOverlay(Uint8Array.of(1, 2, 3))).toBeUndefined();
  });

  it("nops the cave dust-cloud item branch so the encounter path always runs", () => {
    const overlay = new Uint8Array([
      0x07, 0x28, 0x0b, 0xd1,
      0xc8, 0x29, 0x00, 0xd2,
      0x12, 0xe0,
      0xff, 0xff,
      0x04, 0x28, 0x07, 0xd1,
      0x19, 0x20, 0x00, 0x01, 0x81, 0x42,
      0x00, 0xd2,
      0x02, 0xe0,
    ]);

    const result = applyRemoveDustCloudItemRewardsToOverlay(overlay);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(22);
    expect(result?.overlay[23]).toBe(0xbf);
    expect(overlay[23]).toBe(0xd2);
  });

  it("recognizes an already-patched dust-cloud item branch", () => {
    const overlay = new Uint8Array([
      0x07, 0x28, 0x0b, 0xd1,
      0xc8, 0x29, 0x00, 0xd2,
      0x12, 0xe0,
      0xff, 0xff,
      0x04, 0x28, 0x07, 0xd1,
      0x19, 0x20, 0x00, 0x01, 0x81, 0x42,
      0x00, 0xbf,
      0x02, 0xe0,
    ]);

    const result = applyRemoveDustCloudItemRewardsToOverlay(overlay);

    expect(result?.status).toBe("already-applied");
    expect(result?.overlay).toBe(overlay);
  });

  it("updates later-generation Fairy Pokemon and move typings", async () => {
    const project = makeTypingProject();
    project.narcs.personal?.records.set(35, {
      id: 35,
      bytes: project.narcs.personal.rawFiles[35],
      raw: { type_1: 0, type_2: 0 },
      readable: { type_1: "Normal", type_2: "Normal" },
    });

    const result = await applyModernFairyTypings(project);

    expect(result).toEqual({ changed: true, pokemonChanged: 22, movesChanged: 3 });
    expect(project.patches?.applied?.fairyModernTypings).toBe(true);
    expect(project.narcs.personal?.rawFiles[35][6]).toBe(17);
    expect(project.narcs.personal?.rawFiles[35][7]).toBe(17);
    expect(project.narcs.personal?.records.get(35)?.raw).toMatchObject({ type_1: 17, type_2: 17 });
    expect(project.narcs.personal?.records.get(35)?.readable).toMatchObject({ type_1: "Fairy", type_2: "Fairy" });
    expect(project.narcs.personal?.rawFiles[39][6]).toBe(0);
    expect(project.narcs.personal?.rawFiles[39][7]).toBe(17);
    expect(project.narcs.personal?.rawFiles[122][6]).toBe(13);
    expect(project.narcs.personal?.rawFiles[122][7]).toBe(17);
    expect(project.narcs.personal?.rawFiles[176][6]).toBe(17);
    expect(project.narcs.personal?.rawFiles[176][7]).toBe(2);
    expect(project.narcs.personal?.rawFiles[303][6]).toBe(8);
    expect(project.narcs.personal?.rawFiles[303][7]).toBe(17);
    expect(project.narcs.personal?.rawFiles[546][6]).toBe(11);
    expect(project.narcs.personal?.rawFiles[546][7]).toBe(17);
    expect(project.narcs.moves?.rawFiles[186][0]).toBe(17);
    expect(project.narcs.moves?.rawFiles[204][0]).toBe(17);
    expect(project.narcs.moves?.rawFiles[236][0]).toBe(17);
    expect(project.narcs.personal?.dirty.has(35)).toBe(true);
    expect(project.narcs.moves?.dirty.has(186)).toBe(true);
  });

  it("leaves typings alone when the Fairy typing checkbox is unchecked", async () => {
    const project = makeTypingProject();
    project.patches = { dirtyOverlayIds: [], applied: { fairyType: true } };

    const result = await addFairyTypeSupport(project, { updateModernFairyTypings: false });

    expect(result.status).toBe("already-applied");
    expect(project.patches.applied?.fairyModernTypings).toBeUndefined();
    expect(project.narcs.personal?.dirty.size).toBe(0);
    expect(project.narcs.moves?.dirty.size).toBe(0);
    expect(project.narcs.personal?.rawFiles[35][6]).toBe(0);
    expect(project.narcs.personal?.rawFiles[35][7]).toBe(0);
  });

  it("can apply modern Fairy typings after Fairy Type Support is already installed", async () => {
    const project = makeTypingProject();
    project.patches = { dirtyOverlayIds: [], applied: { fairyType: true } };

    const result = await addFairyTypeSupport(project, { updateModernFairyTypings: true });

    expect(result.status).toBe("applied");
    expect(project.patches.applied?.fairyModernTypings).toBe(true);
    expect(project.narcs.personal?.rawFiles[35][6]).toBe(17);
    expect(project.narcs.moves?.rawFiles[204][0]).toBe(17);
  });
});

function makeTypingProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: true,
      fileIds: { personal: 0, moves: 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      personal: makeStore("personal", 0, "a/0/1/6", 600, 8),
      moves: makeStore("moves", 1, "a/0/2/1", 300, 1),
    },
    texts: { banks: {} },
    formats: {},
    trpokInfo: [],
  };
}

function makeStore(name: "personal" | "moves", fileId: number, sourcePath: string, fileCount: number, recordLength: number): NarcStore {
  return {
    name,
    fileId,
    sourcePath,
    fileCount,
    rawFiles: Array.from({ length: fileCount }, () => new Uint8Array(recordLength)),
    records: new Map(),
    dirty: new Set(),
  };
}
