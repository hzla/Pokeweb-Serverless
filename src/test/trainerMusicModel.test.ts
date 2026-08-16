import { existsSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { decompressCode } from "../nds/codeCompression";
import { NintendoDSRom } from "../nds/rom";
import type { Gen5Version } from "../pokeweb/constants";
import type { NitroSdat } from "../pokeweb/nitroSound";
import type { ProjectState } from "../pokeweb/projectStore";
import { filterTrainerBattleMusicAssignments, filterTrainerMusicAssignments } from "../ui/trainerMusicEditor";
import {
  assignTrainerBattleTheme,
  createTrainerBattleMusicModel,
  locateTrainerBattleMusicTable,
  type TrainerBattleMusicOverlay,
} from "../pokeweb/trainerBattleMusicModel";
import {
  BW_TRAINER_EYE_SOURCE_MAPPING,
  BW2_TRAINER_MUSIC_METADATA_SIGNATURE,
  assignTrainerEyeTheme,
  buildTrainerMusicNativeZip,
  createTrainerMusicModel,
  locateTrainerMusicTable,
} from "../pokeweb/trainerMusicModel";

describe("trainerMusicModel", () => {
  it("locates Black/White sparse tables after sequence reassignment and models fallback classes", () => {
    const project = makeProject("W", 0x800);
    writeBwTable(project.arm9, 0x100);
    writeU16(project.arm9, 0x100 + 2, 1240);

    const location = locateTrainerMusicTable(project);
    const model = createTrainerMusicModel(project, makeSdat(false));

    expect(location).toEqual({ format: "bw-sparse", offset: 0x100, source: "signature-scan" });
    expect(model.themes).toHaveLength(14);
    expect(model.assignments).toHaveLength(105);
    expect(model.assignments[0]).toMatchObject({ editable: false, fallback: true, effectiveSequenceId: 1114 });
    expect(model.assignments[2]).toMatchObject({ editable: true, fallback: false, currentSequenceId: 1240 });
  });

  it("rejects missing and ambiguous sparse table signatures", () => {
    expect(() => locateTrainerMusicTable(makeProject("B", 0x800))).toThrow(/could not locate/iu);
    const project = makeProject("B", 0x1000);
    writeBwTable(project.arm9, 0x100);
    writeBwTable(project.arm9, 0x600);
    expect(() => locateTrainerMusicTable(project)).toThrow(/multiple possible/iu);

    const canonicalAndDuplicate = makeProject("W", 0xa3800);
    writeBwTable(canonicalAndDuplicate.arm9, 0xa35c8);
    writeBwTable(canonicalAndDuplicate.arm9, 0x100);
    expect(() => locateTrainerMusicTable(canonicalAndDuplicate)).toThrow(/multiple possible/iu);
  });

  it("locates Black 2/White 2 records and exposes every class as editable", () => {
    const project = makeProject("B2", 0x1000);
    writeBw2Table(project, 0x200);
    const model = createTrainerMusicModel(project, makeSdat(true));

    expect(model.tableLocation).toEqual({ format: "bw2-records", offset: 0x200, source: "signature-scan" });
    expect(model.themes).toHaveLength(16);
    expect(model.assignments).toHaveLength(236);
    expect(model.assignments.every((assignment) => assignment.editable)).toBe(true);
  });

  it("filters classes by name, class id, and effective theme", () => {
    const project = makeProject("W", 0x800);
    project.texts.banks.tr_classes![2] = "Youngster";
    writeBwTable(project.arm9, 0x100);
    const model = createTrainerMusicModel(project, makeSdat(false));

    expect(filterTrainerMusicAssignments(model, "youngster").map((entry) => entry.trainerClassId)).toEqual([2]);
    expect(filterTrainerMusicAssignments(model, "class 2").some((entry) => entry.trainerClassId === 2)).toBe(true);
    expect(filterTrainerMusicAssignments(model, "eye 03").length).toBeGreaterThan(0);
  });

  it("writes only the assignment field, marks ARM9 dirty, and records a changelog entry", () => {
    const project = makeProject("W", 0x800);
    writeBwTable(project.arm9, 0x100);
    const model = createTrainerMusicModel(project, makeSdat(false));
    const assignment = model.assignments[2];
    const before = project.arm9.slice();

    assignTrainerEyeTheme(project, model, assignment, 1116);

    const changedOffsets = Array.from(project.arm9.keys()).filter((offset) => project.arm9[offset] !== before[offset]);
    expect(changedOffsets).toEqual([assignment.writeOffset]);
    expect(readU16(project.arm9, assignment.writeOffset!)).toBe(1116);
    expect(project.arm9Dirty).toBe(true);
    expect(project.actionChangelog?.entries[0]).toMatchObject({ domain: "trainer_music", label: "Approach theme" });
    expect(() => assignTrainerEyeTheme(project, model, model.assignments[0], 1115)).toThrow(/falls back/iu);
    expect(() => assignTrainerEyeTheme(project, model, assignment, 999)).toThrow(/not an assignable/iu);
  });

  it("exports a selected sequence, bank, wave archive, and versioned metadata", () => {
    const project = makeProject("W2", 0x1000);
    writeBw2Table(project, 0x200);
    const model = createTrainerMusicModel(project, makeSdat(true));
    const files = unzipSync(buildTrainerMusicNativeZip(model, 1114));
    const names = Object.keys(files);
    const metadata = JSON.parse(new TextDecoder().decode(files["metadata.json"]));

    expect(names.some((name) => name.endsWith(".sseq"))).toBe(true);
    expect(names.some((name) => name.endsWith(".sbnk"))).toBe(true);
    expect(names.some((name) => name.endsWith(".swar"))).toBe(true);
    expect(metadata).toMatchObject({ format: "pokeweb-trainer-music", formatVersion: 1, gameVersion: "W2" });
    expect(metadata.track.sequenceId).toBe(1114);
    expect(metadata.waveArchives).toHaveLength(1);
  });

  it("locates relocated Black/White battle groups after reassignment and writes overlay assignments safely", () => {
    const project = makeProject("W", 0x800);
    const overlay = makeBattleOverlay("W", 0x700, 0x200);
    writeU16(overlay.data, 0x200, 999);
    const location = locateTrainerBattleMusicTable(project, overlay);
    const model = createTrainerBattleMusicModel(project, makeSdat(false), overlay);

    expect(location).toMatchObject({ overlayId: 21, tableOffset: 0x200, groupCount: 11, source: "signature-scan" });
    expect(model.themes).toHaveLength(22);
    expect(model.assignments).toHaveLength(12);
    expect(model.assignments[0]).toMatchObject({ name: "Rival", currentSequenceId: 999, editable: true });
    expect(model.assignments.at(-1)).toMatchObject({ key: "normal-fallback", currentSequenceId: 1130, editable: true, fallback: true });
    expect(filterTrainerBattleMusicAssignments(model, "support partner").map((assignment) => assignment.key)).toEqual(["support"]);

    const assignment = model.assignments[0];
    const before = overlay.data.slice();
    assignTrainerBattleTheme(project, model, assignment, 1132);

    const changedOffsets = Array.from(overlay.data.keys()).filter((offset) => overlay.data[offset] !== before[offset]);
    expect(changedOffsets).toEqual([assignment.writeOffset, assignment.writeOffset! + 1]);
    expect(project.overlays[21]).toBe(overlay.data);
    expect(project.patches?.dirtyOverlayIds).toContain(21);
    expect(project.arm9Dirty).not.toBe(true);
    expect(project.actionChangelog?.entries[0]).toMatchObject({ domain: "trainer_music", label: "Battle theme" });
  });

  it("models all Black 2/White 2 battle groups and rejects ambiguous or missing layouts", () => {
    const project = makeProject("B2", 0x800);
    const overlay = makeBattleOverlay("B2", 0x800, 0x180);
    const model = createTrainerBattleMusicModel(project, makeSdat(true), overlay);

    expect(model.location).toMatchObject({ overlayId: 36, tableOffset: 0x180, groupCount: 14, source: "signature-scan" });
    expect(model.themes).toHaveLength(41);
    expect(model.assignments).toHaveLength(15);
    expect(model.assignments.every((assignment) => assignment.editable)).toBe(true);

    const missing = makeBattleOverlay("B2", 0x800, 0x180);
    missing.data.fill(0, 0x180, 0x180 + 28 + 29);
    expect(() => locateTrainerBattleMusicTable(project, missing)).toThrow(/could not locate/iu);

    const ambiguous = makeBattleOverlay("B2", 0xc00, 0x180);
    writeBattleLayout(ambiguous, "B2", 0x700, 0x100);
    expect(() => locateTrainerBattleMusicTable(project, ambiguous)).toThrow(/multiple possible/iu);
  });

  it("recognizes canonical tables in available clean Gen 5 ROM fixtures", () => {
    const fixtures: Array<[string, Gen5Version, number]> = [
      ["white.nds", "W", 0xa35c8],
      ["cleanblack.nds", "B", 0xa35a8],
      ["cleanblack2.nds", "B2", 0x8e394],
      ["cleanwhite2.nds", "W2", 0x8e3c0],
    ];
    for (const [fileName, version, expectedOffset] of fixtures) {
      const romUrl = new URL(`../../../${fileName}`, import.meta.url);
      if (!existsSync(romUrl)) continue;
      const rom = new NintendoDSRom(new Uint8Array(readFileSync(romUrl)));
      const project = makeProject(version, 0);
      project.arm9 = decompressCode(rom.arm9);
      let location;
      try {
        location = locateTrainerMusicTable(project);
      } catch (error) {
        throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
      expect(location).toEqual({
        format: version === "B" || version === "W" ? "bw-sparse" : "bw2-records",
        offset: expectedOffset,
        source: "canonical",
      });

      const battleOverlayId = version === "B" || version === "W" ? 21 : 36;
      const battleOverlay = rom.loadArm9Overlays([battleOverlayId]).get(battleOverlayId);
      expect(battleOverlay, `${fileName}: battle overlay ${battleOverlayId}`).toBeDefined();
      const battleLocation = locateTrainerBattleMusicTable(project, {
        overlayId: battleOverlayId,
        ramAddress: battleOverlay!.ramAddress,
        data: battleOverlay!.data,
      });
      expect(battleLocation.source).toBe("canonical");
      expect(battleLocation.tableOffset).toBe(
        version === "B" ? 0x538e0 : version === "W" ? 0x538d8 : version === "B2" ? 0x532e4 : 0x532d8,
      );
    }
  });
});

function makeProject(version: Gen5Version, arm9Length: number): ProjectState {
  const baseRom = version === "B" || version === "W" ? "BW" : "BW2";
  return {
    session: {
      romName: "test",
      generation: "gen5",
      baseVersion: version,
      baseRom,
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(arm9Length),
    overlays: {},
    narcs: {},
    texts: { banks: { tr_classes: Array.from({ length: baseRom === "BW" ? 105 : 236 }, (_unused, id) => `Class ${id}`) } },
    formats: {},
    trpokInfo: [],
  };
}

function writeBwTable(arm9: Uint8Array, offset: number): void {
  BW_TRAINER_EYE_SOURCE_MAPPING.forEach(([trainerClassId, sequenceId], index) => {
    writeU16(arm9, offset + index * 4, trainerClassId);
    writeU16(arm9, offset + index * 4 + 2, sequenceId);
  });
  const terminator = offset + BW_TRAINER_EYE_SOURCE_MAPPING.length * 4;
  writeU16(arm9, terminator, 105);
  writeU16(arm9, terminator + 2, 0);
}

function writeBw2Table(project: ProjectState, offset: number): void {
  for (let trainerClassId = 0; trainerClassId < 236; trainerClassId += 1) {
    const recordOffset = offset + trainerClassId * 4;
    project.arm9[recordOffset] = BW2_TRAINER_MUSIC_METADATA_SIGNATURE[trainerClassId];
    project.arm9[recordOffset + 1] = trainerClassId % 2;
    writeU16(project.arm9, recordOffset + 2, 1114 + (trainerClassId % 14));
  }
}

const BW_BATTLE_EFFECT_SIGNATURE = [
  0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x1b, 0x05, 0x1c, 0x1c, 0x1d, 0x1e, 0x1e, 0x05,
];
const BW2_BATTLE_EFFECT_SIGNATURE = [
  0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x05,
  0x0a, 0x05, 0x18, 0x19, 0x1a, 0x1a, 0x1a, 0x1a, 0x17, 0x1b, 0x1e, 0x1f, 0x05,
  0x05, 0x09, 0x09,
];
const BATTLE_LITERAL_CODE_SIGNATURE = [
  0x00, 0x2e, 0x00, 0xd1, 0x07, 0x21, 0x04, 0x48,
  0x20, 0x80, 0x29, 0x60, 0x03, 0xb0, 0xf0, 0xbd,
];

function makeBattleOverlay(version: Gen5Version, length: number, tableOffset: number): TrainerBattleMusicOverlay {
  const overlayId = version === "B" || version === "W" ? 21 : 36;
  const overlay: TrainerBattleMusicOverlay = { overlayId, ramAddress: 0x02180000, data: new Uint8Array(length) };
  writeBattleLayout(overlay, version, tableOffset, 0x80);
  return overlay;
}

function writeBattleLayout(
  overlay: TrainerBattleMusicOverlay,
  version: Gen5Version,
  tableOffset: number,
  literalOffset: number,
): void {
  const bw = version === "B" || version === "W";
  const defaults = bw
    ? [1133, 1133, 1132, 1135, 1136, 1137, 1137, 1138, 1139, 1134, 1145]
    : [1132, 1135, 1145, 1262, 1130, 1258, 1137, 1257, 1260, 1259, 1267, 1261, 1258, 1133];
  const effectSignature = bw ? BW_BATTLE_EFFECT_SIGNATURE : BW2_BATTLE_EFFECT_SIGNATURE;
  defaults.forEach((sequenceId, index) => writeU16(overlay.data, tableOffset + index * 2, sequenceId));
  const effectOffset = tableOffset + defaults.length * 2;
  overlay.data.set(effectSignature, effectOffset);
  overlay.data.set(BATTLE_LITERAL_CODE_SIGNATURE, literalOffset - BATTLE_LITERAL_CODE_SIGNATURE.length);
  writeU32(overlay.data, literalOffset, overlay.ramAddress + tableOffset);
  writeU32(overlay.data, literalOffset + 4, overlay.ramAddress + effectOffset);
  writeU32(overlay.data, literalOffset + 8, 1130);
}

function makeSdat(bw2: boolean): NitroSdat {
  const sequenceInfos: NitroSdat["sequenceInfos"] = [];
  const sequenceSymbols: string[] = [];
  const eyeIds = [...Array.from({ length: 14 }, (_unused, index) => 1114 + index), ...(bw2 ? [1243, 1244] : [])];
  const battleIds = bw2
    ? [...Array.from({ length: 18 }, (_unused, index) => 1128 + index), 1161, 1162, 1163, 1164, ...Array.from({ length: 18 }, (_unused, index) => 1245 + index), 1267]
    : [...Array.from({ length: 18 }, (_unused, index) => 1128 + index), 1163, 1164, 1165, 1168];
  const ids = [...eyeIds, ...battleIds];
  ids.forEach((id, index) => {
    const eyeIndex = eyeIds.indexOf(id);
    const symbol = id === 1243
      ? "SEQ_BGM_EYE_DANCER"
      : id === 1244
        ? "SEQ_BGM_EYE_CLOWN"
        : eyeIndex >= 0
          ? `SEQ_BGM_EYE_${String(eyeIndex + 1).padStart(2, "0")}`
          : `SEQ_BGM_VS_TEST_${id}`;
    sequenceInfos[id] = { id, fileId: 0, bankId: 0, volume: 127, channelPriority: 0, playerPriority: 0, playerNum: 0, symbol };
    sequenceSymbols[id] = symbol;
  });
  const rawFiles = [Uint8Array.of(0x53, 0x53, 0x45, 0x51), Uint8Array.of(0x53, 0x42, 0x4e, 0x4b), Uint8Array.of(0x53, 0x57, 0x41, 0x52)];
  return {
    sourcePath: "sound_data.sdat",
    bytes: Uint8Array.of(),
    sequenceInfos,
    bankInfos: [{ id: 0, fileId: 1, swarIds: [0, 0xffff, 0xffff, 0xffff], symbol: "BANK_EYE" }],
    waveArchiveInfos: [{ id: 0, fileId: 2, symbol: "WAVE_EYE" }],
    files: rawFiles.map((data, id) => ({ id, dataOffset: id * 4, dataLength: data.length, data })),
    sequenceSymbols,
    bankSymbols: ["BANK_EYE"],
    waveArchiveSymbols: ["WAVE_EYE"],
  };
}
