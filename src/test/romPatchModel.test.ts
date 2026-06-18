import { describe, expect, it } from "vitest";
import { readU16, writeU32 } from "../nds/binary";
import { parseGeneralPatch } from "../pokeweb/generalPatchModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  addFairyTypeSupport,
  applyForgettableHmsToArm9,
  applyModernFairyTypings,
  applyRemoveDustCloudGemRewardsToOverlay,
  applyRemoveDustCloudItemRewardsToOverlay,
  detectSpecifyTrainerNaturesPatch,
  makeHmsForgettable,
  specifyTrainerNatures,
} from "../pokeweb/romPatchModel";
import { applyTrainerNaturePatchToArm9, detectTrainerNaturePatchState } from "../pokeweb/trainerNaturePatch";

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

  it("makes the Black / White HM protection check return false immediately", () => {
    const arm9 = new Uint8Array([0xaa, 0xbb, ...HM_FORGET_WHITE_PROTECTION_CHECK, 0xcc]);

    const result = applyForgettableHmsToArm9(arm9);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(2);
    expect([...result!.arm9.slice(2, 6)]).toEqual([0x00, 0x20, 0x70, 0x47]);
    expect([...result!.arm9.slice(6, 2 + HM_FORGET_WHITE_PROTECTION_CHECK.length)]).toEqual([...HM_FORGET_WHITE_PROTECTION_CHECK.slice(4)]);
    expect([...arm9.slice(2, 6)]).toEqual([...HM_FORGET_WHITE_PROTECTION_CHECK.slice(0, 4)]);
  });

  it("matches the Black HM protection check variant", () => {
    const arm9 = new Uint8Array([0xaa, 0xbb, ...HM_FORGET_BLACK_PROTECTION_CHECK, 0xcc]);

    const result = applyForgettableHmsToArm9(arm9);

    expect(result?.status).toBe("applied");
    expect(result?.offset).toBe(2);
    expect([...result!.arm9.slice(2, 6)]).toEqual([0x00, 0x20, 0x70, 0x47]);
    expect([...result!.arm9.slice(6, 2 + HM_FORGET_BLACK_PROTECTION_CHECK.length)]).toEqual([...HM_FORGET_BLACK_PROTECTION_CHECK.slice(4)]);
  });

  it("recognizes the safer HM early-return patch", () => {
    const arm9 = new Uint8Array(HM_FORGET_WHITE_PROTECTION_CHECK);
    arm9.set([0x00, 0x20, 0x70, 0x47], 0);

    const result = applyForgettableHmsToArm9(arm9);

    expect(result?.status).toBe("already-applied");
    expect(result?.arm9).toBe(arm9);
  });

  it("recognizes the safer HM early-return patch on the Black variant", () => {
    const arm9 = new Uint8Array(HM_FORGET_BLACK_PROTECTION_CHECK);
    arm9.set([0x00, 0x20, 0x70, 0x47], 0);

    const result = applyForgettableHmsToArm9(arm9);

    expect(result?.status).toBe("already-applied");
    expect(result?.arm9).toBe(arm9);
  });

  it("recognizes the legacy HM guide patch as already applied", () => {
    const arm9 = new Uint8Array([0xaa, ...HM_FORGET_GUIDE_PATCH, 0xbb]);

    const result = applyForgettableHmsToArm9(arm9);

    expect(result?.status).toBe("already-applied");
    expect(result?.offset).toBe(1);
  });

  it("marks the project ARM9 dirty when applying forgettable HMs", async () => {
    const project = makeTypingProject();
    project.session.baseVersion = "W";
    project.session.baseRom = "BW";
    project.arm9 = new Uint8Array(HM_FORGET_WHITE_PROTECTION_CHECK);

    const result = await makeHmsForgettable(project);

    expect(result.status).toBe("applied");
    expect(project.arm9Dirty).toBe(true);
    expect(project.patches?.applied?.forgettableHms).toBe(true);
    expect([...project.arm9.slice(0, 4)]).toEqual([0x00, 0x20, 0x70, 0x47]);
  });

  it("does not apply the forgettable HM patch to Black 2 / White 2 projects", async () => {
    const project = makeTypingProject();
    project.arm9 = new Uint8Array(HM_FORGET_WHITE_PROTECTION_CHECK);

    await expect(makeHmsForgettable(project)).rejects.toThrow("Black / White only");
  });

  it("installs the White 2 trainer nature helper without touching the old DSi code cave", () => {
    const arm9 = makeTrainerNatureArm9("W2");
    const dsiCodeBefore = [...arm9.slice(DSI_CODE_CAVE_OFFSET, DSI_CODE_CAVE_OFFSET + 32)];

    const result = applyTrainerNaturePatchToArm9(arm9, "W2");

    expect(result?.status).toBe("applied");
    expect(result!.arm9.length).toBeGreaterThan(arm9.length);
    expect(detectTrainerNaturePatchState(result!.arm9, "W2")).toBe("patched");
    expect([...result!.arm9.slice(DSI_CODE_CAVE_OFFSET, DSI_CODE_CAVE_OFFSET + 32)]).toEqual(dsiCodeBefore);
    for (const site of TRAINER_NATURE_SITES.W2) {
      const offset = site.address - ARM9_RAM_BASE;
      expect([...result!.arm9.slice(offset, offset + site.patchPrefix.length)]).toEqual([...site.patchPrefix]);
      expect(decodeThumbBlTarget(result!.arm9, offset + site.patchPrefix.length, site.address + site.patchPrefix.length)).toBe(result!.hookAddress);
    }
    expect([...arm9.slice(DSI_CODE_CAVE_OFFSET, DSI_CODE_CAVE_OFFSET + 32)]).toEqual(dsiCodeBefore);
  });

  it("installs the Black 2 trainer nature helper at the shifted hook sites", () => {
    const arm9 = makeTrainerNatureArm9("B2");

    const result = applyTrainerNaturePatchToArm9(arm9, "B2");

    expect(result?.status).toBe("applied");
    expect(detectTrainerNaturePatchState(result!.arm9, "B2")).toBe("patched");
    for (const site of TRAINER_NATURE_SITES.B2) {
      const offset = site.address - ARM9_RAM_BASE;
      expect([...result!.arm9.slice(offset, offset + site.patchPrefix.length)]).toEqual([...site.patchPrefix]);
      expect(decodeThumbBlTarget(result!.arm9, offset + site.patchPrefix.length, site.address + site.patchPrefix.length)).toBe(result!.hookAddress);
    }
  });

  it("recognizes an already-installed trainer nature helper", () => {
    const first = applyTrainerNaturePatchToArm9(makeTrainerNatureArm9("W2"), "W2")!;

    const second = applyTrainerNaturePatchToArm9(first.arm9, "W2");

    expect(second?.status).toBe("already-applied");
    expect(second?.arm9).toBe(first.arm9);
    expect(second?.hookAddress).toBe(first.hookAddress);
  });

  it("refuses to install trainer natures when the trainer setup signatures are unknown", () => {
    const arm9 = new Uint8Array(0x60000);

    expect(applyTrainerNaturePatchToArm9(arm9, "W2")).toBeUndefined();
    expect(detectTrainerNaturePatchState(arm9, "W2")).toBe("unknown");
  });

  it("marks the project ARM9 dirty when enabling trainer natures", async () => {
    const project = makeTypingProject();
    project.arm9 = makeTrainerNatureArm9("W2");

    const result = await specifyTrainerNatures(project);

    expect(result.status).toBe("applied");
    expect(project.arm9Dirty).toBe(true);
    expect(project.patches?.applied?.specifyTrainerNatures).toBe(true);
    expect(detectSpecifyTrainerNaturesPatch(project)).toBe("patched");
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

const HM_FORGET_PROTECTION_CHECK_PREFIX = [
  0x08, 0x4a, 0x00, 0x23, 0x59, 0x00, 0x51, 0x18, 0xb8, 0x31, 0x09, 0x88, 0x88, 0x42, 0x01, 0xd1,
  0x01, 0x20, 0x70, 0x47, 0x59, 0x1c, 0x09, 0x06, 0x0b, 0x0e, 0x06, 0x2b, 0xf2, 0xd3, 0x00, 0x20,
  0x70, 0x47, 0xc0, 0x46,
] as const;

const HM_FORGET_WHITE_PROTECTION_CHECK = [...HM_FORGET_PROTECTION_CHECK_PREFIX, 0xb8, 0xea, 0x09, 0x02] as const;
const HM_FORGET_BLACK_PROTECTION_CHECK = [...HM_FORGET_PROTECTION_CHECK_PREFIX, 0xa0, 0xea, 0x09, 0x02] as const;

const HM_FORGET_GUIDE_PATCH = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x70, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
] as const;

const ARM9_RAM_BASE = 0x02004000;
const DSI_CODE_CAVE_OFFSET = 0x0205a99c - ARM9_RAM_BASE;

const TRAINER_NATURE_ORIGINAL = {
  site1: [0x0d, 0x9a, 0x0d, 0x9b, 0xd2, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0xe6, 0xf9],
  site2: [
    0x09, 0x98, 0x01, 0x01, 0x1a, 0x98, 0x43, 0x18, 0xda, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c,
    0x00, 0xf0, 0x67, 0xf9,
  ],
  site3: [0x0c, 0x9a, 0x0c, 0x9b, 0xd2, 0x88, 0x5b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0xd9, 0xf8],
  site4: [0xfa, 0x88, 0x7b, 0x78, 0x04, 0x98, 0x21, 0x1c, 0x00, 0xf0, 0x50, 0xf8],
} as const;

const TRAINER_NATURE_PATCH_PREFIX = {
  site1: [0x0d, 0x9a, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46, 0xc0, 0x46],
  site2: [0x09, 0x9a, 0x12, 0x01, 0x1a, 0x98, 0x82, 0x18, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46],
  site3: [0x0c, 0x9a, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46, 0xc0, 0x46, 0xc0, 0x46],
  site4: [0x3a, 0x1c, 0x04, 0x98, 0x21, 0x1c, 0xc0, 0x46],
} as const;

const TRAINER_NATURE_SITES = {
  W2: [
    { address: 0x02030a50, original: TRAINER_NATURE_ORIGINAL.site1, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site1 },
    { address: 0x02030b4a, original: TRAINER_NATURE_ORIGINAL.site2, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site2 },
    { address: 0x02030c6a, original: TRAINER_NATURE_ORIGINAL.site3, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site3 },
    { address: 0x02030d80, original: TRAINER_NATURE_ORIGINAL.site4, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site4 },
  ],
  B2: [
    { address: 0x02030a24, original: TRAINER_NATURE_ORIGINAL.site1, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site1 },
    { address: 0x02030b1e, original: TRAINER_NATURE_ORIGINAL.site2, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site2 },
    { address: 0x02030c3e, original: TRAINER_NATURE_ORIGINAL.site3, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site3 },
    { address: 0x02030d54, original: TRAINER_NATURE_ORIGINAL.site4, patchPrefix: TRAINER_NATURE_PATCH_PREFIX.site4 },
  ],
} as const;

function makeTrainerNatureArm9(version: "B2" | "W2"): Uint8Array {
  const arm9 = new Uint8Array(0x60000);
  arm9.fill(0xee);
  for (let index = 0; index < 32; index += 1) arm9[DSI_CODE_CAVE_OFFSET + index] = index;
  for (const site of TRAINER_NATURE_SITES[version]) arm9.set(site.original, site.address - ARM9_RAM_BASE);
  return arm9;
}

function decodeThumbBlTarget(data: Uint8Array, offset: number, fromAddress: number): number | undefined {
  const high = readU16(data, offset);
  const low = readU16(data, offset + 2);
  if ((high & 0xf800) !== 0xf000 || (low & 0xf800) !== 0xf800) return undefined;

  let delta = ((high & 0x7ff) << 12) | ((low & 0x7ff) << 1);
  if ((delta & 0x400000) !== 0) delta |= ~0x7fffff;
  return (fromAddress + 4 + delta) >>> 0;
}

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
