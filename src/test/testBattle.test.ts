import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNarcFormats } from "../pokeweb/formats";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";
import {
  getTestBattleConfig,
  isTestBattleTrainerFlagSet,
  patchTestBattleSaveTrainerFlag,
  rawSaveBytesFromDesmumeDsv,
  resolveTestBattleOverworldIdForSaveZone,
  testBattleOverworldYFromSaveGridY,
} from "../pokeweb/testBattle";

const whiteSave = new Uint8Array(readFileSync(new URL("../assets/testbattle/white.dsv", import.meta.url)));
const white2Save = new Uint8Array(readFileSync(new URL("../assets/testbattle/test.sav", import.meta.url)));

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
