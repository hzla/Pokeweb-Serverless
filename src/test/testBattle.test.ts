import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNarcFormats } from "../pokeweb/formats";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  getTestBattleConfig,
  getTestBattleConfigForProject,
  isTestBattleSaveAllBadgesSet,
  isTestBattleTrainerFlagSet,
  patchTestBattleSaveBadges,
  patchTestBattleSaveMmdl,
  patchTestBattleSaveTrainerFlag,
  patchTestBattleSaveTrainerFlags,
  patchTestBattleTrainerTextProxy,
  rawSaveBytesFromDesmumeDsv,
  resolveTestBattleMoveAnimationTarget,
  resolveTestBattleOverworldIdForSaveZone,
  testBattleScriptIdForTrainer,
  testBattleOverworldYFromSaveGridY,
} from "../pokeweb/testBattle";
import { decryptPk5Party } from "../pokeweb/testBattleTeam";
import { decodeGen5TextBank, encodeGen5TextBank } from "../pokeweb/text";

const whiteSave = new Uint8Array(readFileSync(new URL("../assets/testbattle/white.dsv", import.meta.url)));
const white2Save = new Uint8Array(readFileSync(new URL("../assets/testbattle/test.sav", import.meta.url)));
const white2UpgradeSave = new Uint8Array(readFileSync(new URL("../assets/testbattle/White2Upgrade.dsv", import.meta.url)));

describe("testBattle", () => {
  it("selects the BW test battle save and NARC paths", () => {
    const config = getTestBattleConfig("BW");

    expect(config.saveUrl.pathname).toMatch(/white\.dsv$/u);
    expect(config.fallbackOverworldId).toBe(66);
    expect(config.saveLayout).toMatchObject({
      saveHalfOffset: 0x24000,
      checksumBlockOffset: 0x23f00,
      checksumBlockLength: 0x8c,
      checksumBlockChecksumOffset: 0x23f9a,
      eventworkBlockOffset: 0x20100,
      eventworkBlockLength: 0x3ec,
      eventworkChecksumOffset: 0x204ee,
      miscBlockOffset: 0x21200,
      miscBlockLength: 0xec,
      miscChecksumOffset: 0x212ee,
    });
    expect(config.paths).toMatchObject({
      headers: "a/0/1/2",
      trdata: "a/0/9/2",
      trpok: "a/0/9/3",
      overworlds: "a/1/2/5",
      move_animations: "a/0/6/6",
      battle_animations: "a/0/6/7",
    });
  });

  it("keeps BW2 on the existing White 2 save and NARC paths", () => {
    const config = getTestBattleConfig("BW2");

    expect(config.saveKind).toBe("bw2");
    expect(config.saveUrl.pathname).toMatch(/test\.sav$/u);
    expect(config.fallbackOverworldId).toBeUndefined();
    expect(config.saveLayout).toMatchObject({
      saveHalfOffset: 0x26000,
      checksumBlockOffset: 0x25f00,
      checksumBlockLength: 0x94,
      checksumBlockChecksumOffset: 0x25fa2,
      eventworkBlockOffset: 0x1ff00,
      eventworkBlockLength: 0x4e0,
      eventworkChecksumOffset: 0x203e2,
      miscBlockOffset: 0x21100,
      miscBlockLength: 0xf0,
      miscChecksumOffset: 0x211f2,
    });
    expect(config.paths).toMatchObject({
      headers: "a/0/1/2",
      trdata: "a/0/9/1",
      trpok: "a/0/9/2",
      overworlds: "a/1/2/6",
      move_animations: "a/0/6/5",
      battle_animations: "a/0/6/6",
    });
  });

  it("maps trainer test battle NPC scripts to the selected trainer id", () => {
    expect(testBattleScriptIdForTrainer(2)).toBe(3002);
    expect(testBattleScriptIdForTrainer(87)).toBe(3087);
  });

  it("selects the White2Upgrade save when a White2Upgrade DLL is loaded", () => {
    const config = getTestBattleConfigForProject(makeBw2Project(["patches/White2Upgrade.dll"]));

    expect(config.saveKind).toBe("white2-upgrade");
    expect(config.saveUrl.pathname).toMatch(/White2Upgrade\.dsv$/u);
    expect(config.fallbackOverworldId).toBeUndefined();
    expect(config.saveLayout).toMatchObject({
      saveHalfOffset: 0x26000,
      checksumBlockOffset: 0x25f00,
      checksumBlockLength: 0x94,
      checksumBlockChecksumOffset: 0x25fa2,
      eventworkBlockOffset: 0x1ff00,
      eventworkBlockLength: 0x4e0,
      eventworkChecksumOffset: 0x203e2,
      miscBlockOffset: 0x21100,
      miscBlockLength: 0xf0,
      miscChecksumOffset: 0x211f2,
    });
    expect(config.paths).toMatchObject({
      headers: "a/0/1/2",
      trdata: "a/0/9/1",
      trpok: "a/0/9/2",
      overworlds: "a/1/2/6",
      move_animations: "a/0/6/5",
      battle_animations: "a/0/6/6",
    });
  });

  it("keeps vanilla BW2 saves for non-White2Upgrade BW2 projects", () => {
    const config = getTestBattleConfigForProject(makeBw2Project(["patches/MainMenuSkipW2.dll"]));

    expect(config.saveKind).toBe("bw2");
    expect(config.saveUrl.pathname).toMatch(/test\.sav$/u);
  });

  it("uses White2Upgrade expanded move animation slots for move test battles", () => {
    const project = makeBw2Project(["patches/White2Upgrade.dll"]);
    project.narcs.move_animations = makeNarcStore("move_animations", 700);

    expect(resolveTestBattleMoveAnimationTarget(project, 560)).toEqual({
      storeName: "move_animations",
      index: 560,
    });
  });

  it("keeps vanilla BW2 battle animation slots for high move test battles", () => {
    const project = makeBw2Project([]);
    project.narcs.battle_animations = makeNarcStore("battle_animations", 128);

    expect(resolveTestBattleMoveAnimationTarget(project, 673)).toEqual({
      storeName: "battle_animations",
      index: 112,
    });
  });

  it("strips DeSmuME footer bytes from the bundled BW save", () => {
    const raw = rawSaveBytesFromDesmumeDsv(whiteSave);

    expect(raw.length).toBe(0x80000);
    expect(readLe32(raw, 0x19580)).toBe(62);
    expect(readLe16(raw, 0x19586)).toBe(430);
    expect(readLe16(raw, 0x1958a)).toBe(1);
    expect(readLe16(raw, 0x1958e)).toBe(467);
  });

  it("resolves BW test battle save zone 62 to overworld 66 from headers", () => {
    const config = getTestBattleConfig("BW");
    const project = makeProjectWithHeader(62, 66);

    expect(resolveTestBattleOverworldIdForSaveZone(undefined, project, config, 62)).toBe(66);
  });

  it("falls back to BW overworld 66 when headers are unavailable", () => {
    const config = getTestBattleConfig("BW");
    const project = makeProjectWithHeader(undefined, undefined);

    expect(resolveTestBattleOverworldIdForSaveZone(undefined, project, config, 62)).toBe(66);
  });

  it("converts BW save grid height into overworld NPC fx32 height", () => {
    const raw = rawSaveBytesFromDesmumeDsv(whiteSave);
    const gridY = readLe16(raw, 0x1958a);

    expect(gridY).toBe(1);
    expect(testBattleOverworldYFromSaveGridY(gridY)).toBe(0x10000);
  });

  it("clears the BW defeated trainer flag in both save halves", () => {
    const config = getTestBattleConfig("BW");
    const raw = rawSaveBytesFromDesmumeDsv(whiteSave);

    expect(isTestBattleTrainerFlagSet(raw, config)).toBe(true);
    expect(isTestBattleTrainerFlagSet(raw, config, config.saveLayout.saveHalfOffset)).toBe(true);

    const patched = patchTestBattleSaveTrainerFlag(raw, config);

    expect(isTestBattleTrainerFlagSet(patched, config)).toBe(false);
    expect(isTestBattleTrainerFlagSet(patched, config, config.saveLayout.saveHalfOffset)).toBe(false);
    expect(readLe16(patched, 0x204ee)).toBe(crc16Ccitt(patched.subarray(0x20100, 0x20100 + 0x3ec)));
    expect(readLe16(patched, 0x23f5a)).toBe(readLe16(patched, 0x204ee));
    expect(readLe16(patched, 0x23f9a)).toBe(crc16Ccitt(patched.subarray(0x23f00, 0x23f00 + 0x8c)));
    expect(readLe16(patched, 0x444ee)).toBe(crc16Ccitt(patched.subarray(0x44100, 0x44100 + 0x3ec)));
    expect(readLe16(patched, 0x47f5a)).toBe(readLe16(patched, 0x444ee));
    expect(readLe16(patched, 0x47f9a)).toBe(crc16Ccitt(patched.subarray(0x47f00, 0x47f00 + 0x8c)));
  });

  it("keeps the BW2 defeated trainer flag clear and refreshes the BW2 checksum table", () => {
    const config = getTestBattleConfig("BW2");
    const raw = rawSaveBytesFromDesmumeDsv(white2Save);

    expect(isTestBattleTrainerFlagSet(raw, config)).toBe(false);
    expect(isTestBattleTrainerFlagSet(raw, config, config.saveLayout.saveHalfOffset)).toBe(false);

    const patched = patchTestBattleSaveTrainerFlag(raw, config);

    expect(isTestBattleTrainerFlagSet(patched, config)).toBe(false);
    expect(isTestBattleTrainerFlagSet(patched, config, config.saveLayout.saveHalfOffset)).toBe(false);
    expect(readLe16(patched, 0x203e2)).toBe(crc16Ccitt(patched.subarray(0x1ff00, 0x1ff00 + 0x4e0)));
    expect(readLe16(patched, 0x25f5a)).toBe(readLe16(patched, 0x203e2));
    expect(readLe16(patched, 0x25fa2)).toBe(crc16Ccitt(patched.subarray(0x25f00, 0x25f00 + 0x94)));
    expect(readLe16(patched, 0x463e2)).toBe(crc16Ccitt(patched.subarray(0x45f00, 0x45f00 + 0x4e0)));
    expect(readLe16(patched, 0x4bf5a)).toBe(readLe16(patched, 0x463e2));
    expect(readLe16(patched, 0x4bfa2)).toBe(crc16Ccitt(patched.subarray(0x4bf00, 0x4bf00 + 0x94)));
  });

  it("clears the selected BW2 defeated trainer flag in both save halves", () => {
    const config = getTestBattleConfig("BW2");
    const raw = rawSaveBytesFromDesmumeDsv(white2Save);
    const trainerId = 87;
    const dirty = raw.slice();

    setTrainerFlagForTest(dirty, config, trainerId, 0);
    setTrainerFlagForTest(dirty, config, trainerId, config.saveLayout.saveHalfOffset);
    expect(isTestBattleTrainerFlagSet(dirty, config, 0, trainerId)).toBe(true);
    expect(isTestBattleTrainerFlagSet(dirty, config, config.saveLayout.saveHalfOffset, trainerId)).toBe(true);

    const patched = patchTestBattleSaveTrainerFlag(dirty, config, trainerId);

    expect(isTestBattleTrainerFlagSet(patched, config, 0, trainerId)).toBe(false);
    expect(isTestBattleTrainerFlagSet(patched, config, config.saveLayout.saveHalfOffset, trainerId)).toBe(false);
    expect(readLe16(patched, 0x203e2)).toBe(crc16Ccitt(patched.subarray(0x1ff00, 0x1ff00 + 0x4e0)));
    expect(readLe16(patched, 0x25f5a)).toBe(readLe16(patched, 0x203e2));
    expect(readLe16(patched, 0x25fa2)).toBe(crc16Ccitt(patched.subarray(0x25f00, 0x25f00 + 0x94)));
    expect(readLe16(patched, 0x463e2)).toBe(crc16Ccitt(patched.subarray(0x45f00, 0x45f00 + 0x4e0)));
    expect(readLe16(patched, 0x4bf5a)).toBe(readLe16(patched, 0x463e2));
    expect(readLe16(patched, 0x4bfa2)).toBe(crc16Ccitt(patched.subarray(0x4bf00, 0x4bf00 + 0x94)));
  });

  it("clears the selected and proxy BW2 defeated trainer flags together", () => {
    const config = getTestBattleConfig("BW2");
    const raw = rawSaveBytesFromDesmumeDsv(white2Save);
    const trainerId = 87;
    const dirty = raw.slice();

    for (const halfOffset of [0, config.saveLayout.saveHalfOffset]) {
      setTrainerFlagForTest(dirty, config, 2, halfOffset);
      setTrainerFlagForTest(dirty, config, trainerId, halfOffset);
    }

    const patched = patchTestBattleSaveTrainerFlags(dirty, config, [2, trainerId]);

    for (const halfOffset of [0, config.saveLayout.saveHalfOffset]) {
      expect(isTestBattleTrainerFlagSet(patched, config, halfOffset, 2)).toBe(false);
      expect(isTestBattleTrainerFlagSet(patched, config, halfOffset, trainerId)).toBe(false);
    }
    expect(readLe16(patched, 0x203e2)).toBe(crc16Ccitt(patched.subarray(0x1ff00, 0x1ff00 + 0x4e0)));
    expect(readLe16(patched, 0x25f5a)).toBe(readLe16(patched, 0x203e2));
    expect(readLe16(patched, 0x25fa2)).toBe(crc16Ccitt(patched.subarray(0x25f00, 0x25f00 + 0x94)));
  });

  it("copies selected trainer text into trainer 2 and inserts missing proxy text rows", () => {
    const patch = patchTestBattleTrainerTextProxy(
      packTrainerTextRows([
        [1, 0],
        [1, 16],
        [2, 0],
        [2, 1],
        [4, 0],
      ]),
      packTrainerTextOffsets([0, 0, 8, 16, 16]),
      encodeGen5TextBank([
        ["0_0", "Source pre-battle", 0],
        ["0_1", "Source item after-loss", 0],
        ["0_2", "Old proxy pre-battle", 0],
        ["0_3", "Old proxy after-loss", 0],
        ["0_4", "Other trainer", 0],
      ]),
      1,
      2,
    );

    expect(patch.copiedTypes).toEqual([0]);
    expect(patch.insertedTypes).toEqual([16]);
    expect(patch.blankedTypes).toEqual([1]);
    expect(unpackTrainerTextRows(patch.lineTableBytes)).toEqual([
      [1, 0],
      [1, 16],
      [2, 0],
      [2, 1],
      [2, 16],
      [4, 0],
    ]);
    expect(unpackTrainerTextOffsets(patch.offsetBytes)).toEqual([0, 0, 8, 20, 20]);
    expect(decodeGen5TextBank(patch.textBankBytes).map((entry) => entry[1])).toEqual([
      "Source pre-battle",
      "Source item after-loss",
      "Source pre-battle",
      "",
      "Source item after-loss",
      "Other trainer",
    ]);
  });

  it("loads and patches the White2Upgrade save with the BW2 checksum layout", () => {
    const config = getTestBattleConfig("BW2", { white2Upgrade: true });
    const raw = rawSaveBytesFromDesmumeDsv(white2UpgradeSave);

    expect(raw.length).toBe(0x80000);
    expect(readLe32(raw, 0x19580)).toBe(427);
    expect(readLe16(raw, 0x19586)).toBe(53);
    expect(readLe16(raw, 0x1958a)).toBe(1);
    expect(readLe16(raw, 0x1958e)).toBe(728);
    expect(isTestBattleTrainerFlagSet(raw, config)).toBe(false);
    expect(isTestBattleTrainerFlagSet(raw, config, config.saveLayout.saveHalfOffset)).toBe(false);

    const patched = patchTestBattleSaveTrainerFlag(raw, config);

    expect(isTestBattleTrainerFlagSet(patched, config)).toBe(false);
    expect(isTestBattleTrainerFlagSet(patched, config, config.saveLayout.saveHalfOffset)).toBe(false);
    expect(readLe16(patched, 0x203e2)).toBe(crc16Ccitt(patched.subarray(0x1ff00, 0x1ff00 + 0x4e0)));
    expect(readLe16(patched, 0x25f5a)).toBe(readLe16(patched, 0x203e2));
    expect(readLe16(patched, 0x25fa2)).toBe(crc16Ccitt(patched.subarray(0x25f00, 0x25f00 + 0x94)));
    expect(readLe16(patched, 0x463e2)).toBe(crc16Ccitt(patched.subarray(0x45f00, 0x45f00 + 0x4e0)));
    expect(readLe16(patched, 0x4bf5a)).toBe(readLe16(patched, 0x463e2));
    expect(readLe16(patched, 0x4bfa2)).toBe(crc16Ccitt(patched.subarray(0x4bf00, 0x4bf00 + 0x94)));
  });

  it("rewrites a reusable White2Upgrade MMDL save slot to the selected trainer script", () => {
    const config = getTestBattleConfig("BW2", { white2Upgrade: true });
    const raw = rawSaveBytesFromDesmumeDsv(white2UpgradeSave);
    const npc = makeTestBattleNpc(13, testBattleScriptIdForTrainer(87));

    expect(readLe16(raw, 0x1e200 + 24)).not.toBe(testBattleScriptIdForTrainer(87));

    const patched = patchTestBattleSaveMmdl(
      raw,
      config,
      { rawSaveBytes: raw, zoneId: 427, gridX: 53, gridY: 1, gridZ: 728 },
      npc,
    );

    for (const halfOffset of [0, config.saveLayout.saveHalfOffset]) {
      const slotOffset = halfOffset + 0x1e200;
      expect(readLe32(patched, slotOffset)).toBe(3);
      expect(patched[slotOffset + 8]).toBe(13);
      expect(readLe16(patched, slotOffset + 16)).toBe(427);
      expect(readLe16(patched, slotOffset + 20)).toBe(1);
      expect(readLe16(patched, slotOffset + 24)).toBe(3087);
      expect(readLe16(patched, slotOffset + 38)).toBe(53);
      expect(readLe16(patched, slotOffset + 40)).toBe(1);
      expect(readLe16(patched, slotOffset + 42)).toBe(729);
      expect(readLe16(patched, halfOffset + 0x1f602)).toBe(crc16Ccitt(patched.subarray(halfOffset + 0x1e200, halfOffset + 0x1e200 + 0x1400)));
      expect(readLe16(patched, halfOffset + config.saveLayout.checksumBlockOffset + 41 * 2)).toBe(readLe16(patched, halfOffset + 0x1f602));
      expect(readLe16(patched, halfOffset + config.saveLayout.checksumBlockChecksumOffset!)).toBe(
        crc16Ccitt(patched.subarray(halfOffset + config.saveLayout.checksumBlockOffset, halfOffset + config.saveLayout.checksumBlockOffset + config.saveLayout.checksumBlockLength)),
      );
    }
  });

  it("sets all badges in the White2Upgrade test battle save and refreshes misc checksums", () => {
    const config = getTestBattleConfig("BW2", { white2Upgrade: true });
    const raw = rawSaveBytesFromDesmumeDsv(white2UpgradeSave);

    expect(isTestBattleSaveAllBadgesSet(raw, config)).toBe(false);
    expect(isTestBattleSaveAllBadgesSet(raw, config, config.saveLayout.saveHalfOffset)).toBe(false);

    const patched = patchTestBattleSaveBadges(raw, config);

    expect(isTestBattleSaveAllBadgesSet(patched, config)).toBe(true);
    expect(isTestBattleSaveAllBadgesSet(patched, config, config.saveLayout.saveHalfOffset)).toBe(true);
    expect(readLe16(patched, 0x211f2)).toBe(crc16Ccitt(patched.subarray(0x21100, 0x21100 + 0xf0)));
    expect(readLe16(patched, 0x25f68)).toBe(readLe16(patched, 0x211f2));
    expect(readLe16(patched, 0x25fa2)).toBe(crc16Ccitt(patched.subarray(0x25f00, 0x25f00 + 0x94)));
    expect(readLe16(patched, 0x471f2)).toBe(crc16Ccitt(patched.subarray(0x47100, 0x47100 + 0xf0)));
    expect(readLe16(patched, 0x4bf68)).toBe(readLe16(patched, 0x471f2));
    expect(readLe16(patched, 0x4bfa2)).toBe(crc16Ccitt(patched.subarray(0x4bf00, 0x4bf00 + 0x94)));
  });

  it("bundles the White2Upgrade save with Urshifu in party slot 1", () => {
    const raw = rawSaveBytesFromDesmumeDsv(white2UpgradeSave);

    for (const half of [0, 0x26000]) {
      const party = half + 0x18e00;
      expect(raw[party]).toBe(6);
      expect(raw[party + 4]).toBe(6);
      const first = decryptPk5Party(raw.subarray(party + 8, party + 8 + 220));
      expect(readLe16(first, 0x08)).toBe(892);
      expect(readGen5String(first, 0x48, 22)).toBe("Urshifu");
    }
  });
});

function makeProjectWithHeader(zoneId: number | undefined, overworldId: number | undefined): ProjectState {
  const formats = getNarcFormats("BW");
  const headers = zoneId === undefined || overworldId === undefined ? undefined : makeHeaderStore(formats.headers!, zoneId, overworldId);
  return {
    session: {
      romName: "test",
      baseVersion: "W",
      baseRom: "BW",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: headers ? { headers } : {},
    texts: { banks: {} },
    formats,
    trpokInfo: [],
  };
}

function makeBw2Project(modulePaths: string[]): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {},
    texts: { banks: {} },
    formats: getNarcFormats("BW2"),
    trpokInfo: [],
    codeInjection: {
      modules: modulePaths.map((path) => ({
        path,
        target: path.startsWith("lib/") ? "lib" : "patches",
        fileName: path.split("/").pop() ?? path,
      })),
    },
  };
}

function makeNarcStore(name: NarcStore["name"], count: number): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: count,
    rawFiles: Array.from({ length: count }, () => new Uint8Array([0x00])),
    records: new Map(),
    dirty: new Set(),
  };
}

function setTrainerFlagForTest(saveBytes: Uint8Array, config: ReturnType<typeof getTestBattleConfig>, trainerId: number, halfOffset: number): void {
  const flag = 1420 + trainerId;
  const offset = halfOffset + config.saveLayout.eventworkBlockOffset + 318 * 2 + Math.floor(flag / 8);
  saveBytes[offset] |= 1 << (flag % 8);
}

function makeTestBattleNpc(uid: number, scriptId: number): Uint8Array {
  const npc = new Uint8Array(36);
  writeLe16(npc, 0, uid);
  writeLe16(npc, 2, 20);
  writeLe16(npc, 4, 0);
  writeLe16(npc, 6, 1);
  writeLe16(npc, 8, 0);
  writeLe16(npc, 10, scriptId);
  writeLe16(npc, 14, 10);
  writeLe16(npc, 28, 53);
  writeLe16(npc, 30, 729);
  return npc;
}

function packTrainerTextRows(rows: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(rows.length * 4);
  rows.forEach(([trainerId, typeId], index) => {
    writeLe16(out, index * 4, trainerId);
    writeLe16(out, index * 4 + 2, typeId);
  });
  return out;
}

function unpackTrainerTextRows(bytes: Uint8Array): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
    rows.push([readLe16(bytes, offset), readLe16(bytes, offset + 2)]);
  }
  return rows;
}

function packTrainerTextOffsets(offsets: number[]): Uint8Array {
  const out = new Uint8Array(offsets.length * 2);
  offsets.forEach((offset, index) => writeLe16(out, index * 2, offset));
  return out;
}

function unpackTrainerTextOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 2 <= bytes.length; offset += 2) offsets.push(readLe16(bytes, offset));
  return offsets;
}

function makeHeaderStore(format: NonNullable<ReturnType<typeof getNarcFormats>["headers"]>, zoneId: number, overworldId: number): NarcStore {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const bytes = new Uint8Array((zoneId + 1) * rowLength);
  const mapIdOffset = fieldOffset(format, "map_id");
  if (mapIdOffset === undefined) throw new Error("header format missing map_id");
  writeLe16(bytes, zoneId * rowLength + mapIdOffset, overworldId);
  return {
    name: "headers",
    fileId: 1,
    sourcePath: "test",
    fileCount: 1,
    rawFiles: [bytes],
    records: new Map(),
    dirty: new Set(),
  };
}

function fieldOffset(format: NonNullable<ReturnType<typeof getNarcFormats>["headers"]>, field: string): number | undefined {
  let offset = 0;
  for (const [size, name] of format) {
    if (name === field) return offset;
    offset += size;
  }
  return undefined;
}

function readLe16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeLe16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function readGen5String(bytes: Uint8Array, offset: number, byteLength: number): string {
  const chars: string[] = [];
  for (let cursor = offset; cursor + 1 < offset + byteLength; cursor += 2) {
    const value = readLe16(bytes, cursor);
    if (value === 0 || value === 0xffff) break;
    chars.push(String.fromCharCode(value));
  }
  return chars.join("");
}

function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}
