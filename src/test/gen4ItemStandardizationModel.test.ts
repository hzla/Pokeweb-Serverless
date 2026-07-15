import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom, materializeProjectEdits } from "../pokeweb/exportRom";
import { getNarcFormats } from "../pokeweb/formats";
import {
  PLATINUM_ITEM_OVERLAY_ID,
  PLATINUM_ITEM_OVERLAY_OFFSET,
  PLATINUM_ITEM_SCRIPT_BASE,
  PLATINUM_ITEM_SCRIPT_FILE_ID,
  applyPlatinumItemStandardization,
  buildStandardizedPlatinumItemScripts,
  detectPlatinumItemStandardization,
  inspectPlatinumItemScripts,
  remapPlatinumItemScriptReference,
} from "../pokeweb/gen4ItemStandardizationModel";
import { materializeGen4EventFile, parseGen4EventFile } from "../pokeweb/gen4EventModel";
import { loadProjectFromRomBytes } from "../pokeweb/loader";
import type { BaseVersion, NarcName } from "../pokeweb/constants";
import type { NarcStore, ProjectState, RawRecord } from "../pokeweb/projectStore";

describe("Platinum item standardization", () => {
  it("parses legacy wrappers and rebuilds canonical item scripts around the preserved shared routine", () => {
    const sharedRoutine = Uint8Array.of(0x02, 0x00, 0xaa, 0xbb, 0xcc, 0xdd);
    const source = makeLegacyItemScripts([3, 1, 4], sharedRoutine);

    const legacy = inspectPlatinumItemScripts(source, 6);
    const rebuilt = buildStandardizedPlatinumItemScripts(source, 6, legacy);
    const canonical = inspectPlatinumItemScripts(rebuilt, 6);

    expect(legacy.state).toBe("unpatched");
    expect(legacy.itemIds).toEqual([3, 1, 4]);
    expect(canonical.state).toBe("patched");
    expect(canonical.itemIds).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...rebuilt.slice(canonical.sharedRoutineStart)]).toEqual([...sharedRoutine]);
    expect(canonical.scriptStarts.slice(1, -1).map((start, index) => start - canonical.scriptStarts[index])).toEqual([18, 18, 18, 18, 18]);
    canonical.scriptStarts.slice(0, -1).forEach((start) => {
      const jumpTarget = start + 18 + (readU32(rebuilt, start + 14) | 0);
      expect(jumpTarget).toBe(canonical.sharedRoutineStart);
    });
  });

  it("maps vanilla overlay script 7321 to Griseous Orb script 7112", () => {
    const legacyItemIds = Array.from({ length: 322 }, (_value, index) => index);
    legacyItemIds[321] = 112;

    expect(remapPlatinumItemScriptReference(7321, legacyItemIds)).toBe(7112);
  });

  it("updates type-3 and item-range events, scripts, overlay 9, dirty state, and one changelog entry", async () => {
    const sourceScripts = makeLegacyItemScripts([5, 2, 4], Uint8Array.of(0x02, 0x00, 0x77, 0x88));
    const event0 = makeEventFile([
      { type: 3, scriptNumber: 7000 },
      { type: 0, scriptNumber: 7001 },
    ]);
    const event1 = makeEventFile([{ type: 0, scriptNumber: 50 }]);
    const overlay = makeOverlay(7002);
    const project = makeProject({ sourceScripts, events: [event0, event1], overlay, itemCount: 6 });

    const result = await applyPlatinumItemStandardization(project);

    expect(result.status).toBe("applied");
    expect(result.patchId).toBe("itemStandardization");
    expect(detectPlatinumItemStandardization(project)).toBe("patched");
    expect(project.narcs.scripts?.dirty).toEqual(new Set([PLATINUM_ITEM_SCRIPT_FILE_ID]));
    expect(project.narcs.overworlds?.dirty).toEqual(new Set([0]));
    expect(project.patches?.dirtyOverlayIds).toEqual([PLATINUM_ITEM_OVERLAY_ID]);
    expect(project.patches?.applied?.itemStandardization).toBe(true);
    expect(readU16(project.overlays[PLATINUM_ITEM_OVERLAY_ID]!, PLATINUM_ITEM_OVERLAY_OFFSET)).toBe(7004);
    expect(project.actionChangelog?.entries).toHaveLength(1);

    materializeProjectEdits(project);
    const rewritten = parseGen4EventFile(project.narcs.overworlds!.rawFiles[0]);
    expect(rewritten.overworld_0_script_number).toBe(7005);
    expect(rewritten.overworld_1_script_number).toBe(7002);
    expect([...project.narcs.overworlds!.rawFiles[1]]).toEqual([...event1]);
  });

  it("is idempotent after the first application", async () => {
    const project = makeProject({
      sourceScripts: makeLegacyItemScripts([2, 1], Uint8Array.of(0x02, 0x00)),
      events: [makeEventFile([{ type: 3, scriptNumber: 7000 }])],
      overlay: makeOverlay(7001),
      itemCount: 4,
    });

    await applyPlatinumItemStandardization(project);
    const scriptsAfterFirstApply = project.narcs.scripts!.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID];
    const changelogCount = project.actionChangelog?.entries.length;
    const dirtyEvents = [...project.narcs.overworlds!.dirty];
    const second = await applyPlatinumItemStandardization(project);

    expect(second.status).toBe("already-applied");
    expect(project.narcs.scripts!.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID]).toBe(scriptsAfterFirstApply);
    expect(project.actionChangelog?.entries.length).toBe(changelogCount);
    expect([...project.narcs.overworlds!.dirty]).toEqual(dirtyEvents);
    expect(project.patches?.dirtyOverlayIds).toEqual([PLATINUM_ITEM_OVERLAY_ID]);
  });

  it("does not dirty an event file when its mapped item reference is unchanged", async () => {
    const project = makeProject({
      sourceScripts: makeLegacyItemScripts([0, 2], Uint8Array.of(0x02, 0x00)),
      events: [makeEventFile([{ type: 3, scriptNumber: 7000 }])],
      overlay: makeOverlay(7001),
      itemCount: 4,
    });

    await applyPlatinumItemStandardization(project);

    expect(project.narcs.overworlds?.dirty.size).toBe(0);
  });

  it("rejects unmappable event references transactionally", async () => {
    const sourceScripts = makeLegacyItemScripts([2, 1], Uint8Array.of(0x02, 0x00));
    const event = makeEventFile([{ type: 3, scriptNumber: 7999 }]);
    const overlay = makeOverlay(7001);
    const project = makeProject({ sourceScripts, events: [event], overlay, itemCount: 4 });

    await expect(applyPlatinumItemStandardization(project)).rejects.toThrow(/does not map/u);

    expect(project.narcs.scripts?.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID]).toBe(sourceScripts);
    expect(project.narcs.scripts?.dirty.size).toBe(0);
    expect(project.narcs.overworlds?.dirty.size).toBe(0);
    expect(project.overlays[PLATINUM_ITEM_OVERLAY_ID]).toBe(overlay);
    expect(project.patches).toBeUndefined();
    expect(project.actionChangelog).toBeUndefined();
  });

  it("rejects a short overlay transactionally", async () => {
    const sourceScripts = makeLegacyItemScripts([2, 1], Uint8Array.of(0x02, 0x00));
    const event = makeEventFile([{ type: 3, scriptNumber: 7000 }]);
    const overlay = new Uint8Array(16);
    const project = makeProject({ sourceScripts, events: [event], overlay, itemCount: 4 });

    await expect(applyPlatinumItemStandardization(project)).rejects.toThrow(/too short/u);

    expect(project.narcs.scripts?.rawFiles[PLATINUM_ITEM_SCRIPT_FILE_ID]).toBe(sourceScripts);
    expect(project.narcs.scripts?.dirty.size).toBe(0);
    expect(project.narcs.overworlds?.dirty.size).toBe(0);
    expect(project.overlays[PLATINUM_ITEM_OVERLAY_ID]).toBe(overlay);
  });

  it("reports malformed item scripts as unknown and refuses to rebuild them", async () => {
    const malformed = makeLegacyItemScripts([2, 1], Uint8Array.of(0x02, 0x00));
    writeU16(malformed, pointerTarget(malformed, 0), 0xffff);
    const project = makeProject({ sourceScripts: malformed, events: [], overlay: makeOverlay(7001), itemCount: 4 });

    expect(detectPlatinumItemStandardization(project)).toBe("unknown");
    await expect(applyPlatinumItemStandardization(project)).rejects.toThrow(/does not set variable 0x8008/u);
    expect(project.narcs.scripts?.dirty.size).toBe(0);
  });

  it("does not trust a persisted applied flag when the script bytes are malformed", () => {
    const malformed = makeLegacyItemScripts([2, 1], Uint8Array.of(0x02, 0x00));
    writeU16(malformed, pointerTarget(malformed, 0), 0xffff);
    const project = makeProject({ sourceScripts: malformed, events: [], overlay: makeOverlay(7001), itemCount: 4 });
    project.patches = { dirtyOverlayIds: [], applied: { itemStandardization: true } };

    expect(detectPlatinumItemStandardization(project)).toBe("unknown");
  });

  it("rejects legacy item IDs outside the canonical Platinum item bank", () => {
    const source = makeLegacyItemScripts([2, 9], Uint8Array.of(0x02, 0x00));

    expect(() => inspectPlatinumItemScripts(source, 4)).toThrow(/outside text bank 392/u);
  });

  it.each(["D", "P", "HG", "SS", "B", "W", "B2", "W2"] as BaseVersion[])("is unsupported for %s", async (baseVersion) => {
    const project = makeProject({
      sourceScripts: makeLegacyItemScripts([1], Uint8Array.of(0x02, 0x00)),
      events: [],
      overlay: makeOverlay(7000),
      itemCount: 2,
      baseVersion,
    });

    expect(detectPlatinumItemStandardization(project)).toBe("unsupported");
    await expect(applyPlatinumItemStandardization(project)).rejects.toThrow(/Platinum only/u);
  });

  it("exports the rebuilt script NARC, affected event NARC, and overlay 9 without changing unrelated files", async () => {
    const sourceScripts = makeLegacyItemScripts([3, 1], Uint8Array.of(0x02, 0x00, 0xab, 0xcd));
    const sourceEvent = makeEventFile([{ type: 3, scriptNumber: 7000 }]);
    const sourceOverlay = makeOverlay(7001);
    const untouched = Uint8Array.of(9, 8, 7, 6);
    const scriptsNarc = makeNarc(PLATINUM_ITEM_SCRIPT_FILE_ID + 1, PLATINUM_ITEM_SCRIPT_FILE_ID, sourceScripts);
    const eventsNarc = makeNarc(1, 0, sourceEvent);
    const romBytes = makeRomWithOverlay([scriptsNarc.save(), eventsNarc.save(), sourceOverlay, untouched], 2, sourceOverlay.length);
    const project = makeProject({
      sourceScripts,
      events: [sourceEvent],
      overlay: sourceOverlay,
      itemCount: 5,
      originalRomBytes: romBytes,
      scriptFileId: 0,
      eventFileId: 1,
    });

    await applyPlatinumItemStandardization(project);
    const exported = await exportModifiedRom(project);
    const rom = new NintendoDSRom(exported);
    const exportedScripts = new NARC(rom.files[0]);
    const exportedEvents = new NARC(rom.files[1]);

    expect(inspectPlatinumItemScripts(exportedScripts.files[PLATINUM_ITEM_SCRIPT_FILE_ID], 5).state).toBe("patched");
    expect(parseGen4EventFile(exportedEvents.files[0]).overworld_0_script_number).toBe(7003);
    expect(readU16(rom.loadArm9Overlays([PLATINUM_ITEM_OVERLAY_ID]).get(PLATINUM_ITEM_OVERLAY_ID)!.data, PLATINUM_ITEM_OVERLAY_OFFSET)).toBe(7001);
    expect([...rom.files[3]]).toEqual([...untouched]);
  });
});

const realPlatinumPath = process.env.POKEWEB_PLATINUM_ROM;

it.runIf(Boolean(realPlatinumPath && existsSync(realPlatinumPath)))(
  "standardizes and reloads a real Platinum ROM",
  async () => {
    const source = new Uint8Array(readFileSync(realPlatinumPath!));
    const project = await loadProjectFromRomBytes(source, "cleanplat.nds");

    expect(project.session.baseVersion).toBe("Pt");
    expect(project.texts.banks.items).toHaveLength(468);
    expect(detectPlatinumItemStandardization(project)).toBe("unpatched");

    const result = await applyPlatinumItemStandardization(project);
    expect(result.status).toBe("applied");
    expect(readU16(project.overlays[PLATINUM_ITEM_OVERLAY_ID]!, PLATINUM_ITEM_OVERLAY_OFFSET)).toBe(7112);

    const exported = await exportModifiedRom(project);
    const reloaded = await loadProjectFromRomBytes(exported, "cleanplat-standardized.nds");
    expect(detectPlatinumItemStandardization(reloaded)).toBe("patched");
    expect(readU16(new NintendoDSRom(exported).loadArm9Overlays([PLATINUM_ITEM_OVERLAY_ID]).get(PLATINUM_ITEM_OVERLAY_ID)!.data, PLATINUM_ITEM_OVERLAY_OFFSET)).toBe(7112);
  },
  120_000,
);

function makeProject(options: {
  sourceScripts: Uint8Array;
  events: Uint8Array[];
  overlay: Uint8Array;
  itemCount: number;
  baseVersion?: BaseVersion;
  originalRomBytes?: Uint8Array;
  scriptFileId?: number;
  eventFileId?: number;
}): ProjectState {
  const baseVersion = options.baseVersion ?? "Pt";
  const gen4 = baseVersion === "D" || baseVersion === "P" || baseVersion === "Pt" || baseVersion === "HG" || baseVersion === "SS";
  const baseRom = baseVersion === "D" || baseVersion === "P" ? "DP" : baseVersion === "Pt" ? "Pt" : baseVersion === "HG" || baseVersion === "SS" ? "HGSS" : baseVersion === "B" || baseVersion === "W" ? "BW" : "BW2";
  const scriptFiles: Uint8Array[] = Array.from({ length: PLATINUM_ITEM_SCRIPT_FILE_ID + 1 }, () => new Uint8Array());
  scriptFiles[PLATINUM_ITEM_SCRIPT_FILE_ID] = options.sourceScripts;
  return {
    originalRomBytes: options.originalRomBytes,
    session: {
      romName: "item-standardization-test",
      generation: gen4 ? "gen4" : "gen5",
      baseVersion,
      baseRom,
      fairy: false,
      fileIds: { scripts: options.scriptFileId ?? 0, overworlds: options.eventFileId ?? 1 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: baseVersion === "Pt" ? "CPUE" : "TEST", fileName: "test.nds", size: options.originalRomBytes?.length ?? 0 },
    arm9: new Uint8Array(),
    overlays: { [PLATINUM_ITEM_OVERLAY_ID]: options.overlay },
    narcs: {
      scripts: makeStore("scripts", scriptFiles, options.scriptFileId ?? 0),
      overworlds: makeStore("overworlds", options.events, options.eventFileId ?? 1),
    },
    texts: { banks: { items: Array.from({ length: options.itemCount }, (_value, index) => `Item ${index}`) } },
    formats: getNarcFormats(baseRom),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[], fileId: number): NarcStore {
  return {
    name,
    fileId,
    sourcePath: name,
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeLegacyItemScripts(itemIds: number[], sharedRoutine: Uint8Array): Uint8Array {
  const wrapperLength = 20;
  const scriptCount = itemIds.length + 1;
  const headerLength = scriptCount * 4 + 2;
  const sharedRoutineStart = headerLength + itemIds.length * wrapperLength;
  const out = new Uint8Array(sharedRoutineStart + sharedRoutine.length);

  for (let index = 0; index < scriptCount; index += 1) {
    const target = index === itemIds.length ? sharedRoutineStart : headerLength + index * wrapperLength;
    writeU32(out, index * 4, target - (index * 4 + 4));
  }
  writeU16(out, scriptCount * 4, 0xfd13);
  itemIds.forEach((itemId, index) => {
    const start = headerLength + index * wrapperLength;
    writeU16(out, start, 0x0028);
    writeU16(out, start + 2, 0x8008);
    writeU16(out, start + 4, itemId);
    writeU16(out, start + 6, 0x0028);
    writeU16(out, start + 8, 0x8009);
    writeU16(out, start + 10, 1);
    writeU16(out, start + 12, 0x0016);
    writeU32(out, start + 14, sharedRoutineStart - (start + 18));
    writeU16(out, start + 18, 0x0002);
  });
  out.set(sharedRoutine, sharedRoutineStart);
  return out;
}

function pointerTarget(source: Uint8Array, index: number): number {
  return index * 4 + 4 + (readU32(source, index * 4) | 0);
}

function makeEventFile(overworlds: Array<{ type: number; scriptNumber: number }>): Uint8Array {
  const raw: RawRecord = {
    spawnable_count: 0,
    overworld_count: overworlds.length,
    warp_count: 0,
    trigger_count: 0,
    footer_length: 0,
  };
  overworlds.forEach((overworld, index) => {
    raw[`overworld_${index}_type`] = overworld.type;
    raw[`overworld_${index}_script_number`] = overworld.scriptNumber;
  });
  return materializeGen4EventFile(raw, new Uint8Array());
}

function makeOverlay(scriptNumber: number): Uint8Array {
  const overlay = new Uint8Array(PLATINUM_ITEM_OVERLAY_OFFSET + 8);
  writeU16(overlay, PLATINUM_ITEM_OVERLAY_OFFSET, scriptNumber);
  return overlay;
}

function makeNarc(fileCount: number, populatedIndex: number, bytes: Uint8Array): NARC {
  const narc = new NARC();
  narc.files = Array.from({ length: fileCount }, () => new Uint8Array());
  narc.files[populatedIndex] = bytes;
  return narc;
}

function makeRomWithOverlay(files: Uint8Array[], overlayFileId: number, overlayLength: number): Uint8Array {
  const fnt = saveFnt(new Folder({ files: files.map((_file, index) => `file_${index}`), firstId: 0 }));
  const out = new Uint8Array(0x6000 + files.reduce((sum, file) => sum + 0x200 + file.length, 0));
  out.set([0x50, 0x4f, 0x4b, 0x45, 0x4d, 0x4f, 0x4e, 0x20, 0x50, 0x4c], 0);
  out.set([0x43, 0x50, 0x55, 0x45], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x28, 0x02000000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x54, 32);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  writeU32(out, 0x4a00, PLATINUM_ITEM_OVERLAY_ID);
  writeU32(out, 0x4a04, 0x02249960);
  writeU32(out, 0x4a08, overlayLength);
  writeU32(out, 0x4a18, overlayFileId);
  writeU32(out, 0x4a1c, 0);
  out.set(fnt, 0x5000);
  let cursor = 0x5400;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x5200 + index * 8, cursor);
    out.set(file, cursor);
    cursor += file.length;
    writeU32(out, 0x5200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function align(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
