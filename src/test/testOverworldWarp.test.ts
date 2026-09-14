import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { getNarcFormats } from "../pokeweb/formats";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { rawSaveBytesFromDesmumeDsv, toDesmumeDsv } from "../pokeweb/testBattle";
import { patchOverworldTestWarpEvent, patchOverworldTestWarpSave, resolveOverworldTestWarpDestination } from "../pokeweb/testOverworldWarp";

const destination = { zoneId: 98, gridX: 205, gridZ: 316 };

describe("BW2 overworld test warp", () => {
  it("inserts the exact CONNECT_DATA record after existing warps and preserves triggers and scripts", () => {
    const bytes = new Uint8Array(8 + 20 + 36 + 20 + 22 + 9).fill(0xaa);
    bytes.set([1, 1, 1, 1], 4);
    writeU32(bytes, 0, bytes.length - 4 - 9);
    const original = bytes.slice();
    const out = patchOverworldTestWarpEvent(bytes, { zoneId: 427, gridX: 53, gridY: 1, gridZ: 730 }, destination);
    const offset = 84;
    expect(Array.from(out.subarray(offset, offset + 20))).toEqual([
      98, 0, 0, 1, 0, 5, 0, 0, // target zone, special exit, any direction, warp, grid position
      0x58, 3, 16, 0, 0xb8, 0x2d, // centered world coordinates: 856, 16, 11704
      1, 0, 1, 0, 0, 0,
    ]);
    expect(out[6]).toBe(2);
    expect(readU32(out, 0)).toBe(readU32(bytes, 0) + 20);
    expect(out.slice(8, offset)).toEqual(bytes.slice(8, offset));
    expect(out.slice(offset + 20)).toEqual(bytes.slice(offset));
    expect(bytes).toEqual(original);
  });

  it.each(["test.sav", "White2Upgrade.dsv", "Black2Upgrade.dsv"])("patches both destination copies and valid CRCs in %s without moving the saved player", (name) => {
    const bytes = rawSaveBytesFromDesmumeDsv(new Uint8Array(readFileSync(new URL(`../assets/testbattle/${name}`, import.meta.url))));
    const original = bytes.slice();
    const out = patchOverworldTestWarpSave(bytes, destination);
    for (const half of [0, 0x26000]) {
      const loc = half + 0x19538;
      expect(readU32(out, loc)).toBe(1);
      expect(readU16(out, loc + 4)).toBe(98);
      expect(readU16(out, loc + 6)).toBe(0xffff);
      expect(readU16(out, loc + 8)).toBe(2);
      expect(readU32(out, loc + 12)).toBe(0);
      expect(readU32(out, loc + 16)).toBe(0xcd8000);
      expect(readU32(out, loc + 20)).toBe(0);
      expect(readU32(out, loc + 24)).toBe(0x13c8000);
      const checksum = crc(out.subarray(half + 0x19500, half + 0x195a8));
      expect(readU16(out, half + 0x195aa)).toBe(checksum);
      expect(readU16(out, half + 0x25f38)).toBe(checksum);
      expect(readU16(out, half + 0x25fa2)).toBe(crc(out.subarray(half + 0x25f00, half + 0x25f94)));
      // Restore only the intended changes, then compare the entire save.
      out.set(bytes.subarray(loc, loc + 28), loc);
      for (const offset of [0x195aa, 0x25f38, 0x25fa2]) out.set(bytes.subarray(half + offset, half + offset + 2), half + offset);
    }
    expect(out).toEqual(original);
    expect(bytes).toEqual(original);
    const patched = patchOverworldTestWarpSave(bytes, destination);
    expect(rawSaveBytesFromDesmumeDsv(toDesmumeDsv(patched))).toEqual(patched);
  });

  it("translates selected scene tiles into matrix coordinates and uses the zero-based zone ID", () => {
    const project = makeProject();
    expect(resolveOverworldTestWarpDestination(project, { overworldId: 0, mapId: 0, index: 131, x: 3, y: 4 }))
      .toEqual({ zoneId: 5, gridX: 35, gridZ: 36 });
    expect(project.narcs.overworlds?.dirty.size).toBe(0);
  });

  it("rejects BW1, missing tiles, stale selection indexes, invalid coordinates, and truncated binary data", () => {
    const selection = { overworldId: 0, mapId: 0, index: 131, x: 3, y: 4 };
    const project = makeProject();
    expect(() => resolveOverworldTestWarpDestination(project, { ...selection, x: 32 })).toThrow("valid map tile");
    expect(() => resolveOverworldTestWarpDestination(project, { ...selection, index: 0 })).toThrow("valid map tile");
    project.session.baseRom = "BW";
    expect(() => resolveOverworldTestWarpDestination(project, selection)).toThrow("only available");
    expect(() => patchOverworldTestWarpSave(new Uint8Array(100), destination)).toThrow("truncated");
    expect(() => patchOverworldTestWarpSave(new Uint8Array(0x80000), { ...destination, gridX: NaN })).toThrow("coordinate range");
    expect(() => patchOverworldTestWarpEvent(new Uint8Array(7), { zoneId: 427, gridX: 1, gridY: 0, gridZ: 1 }, destination)).toThrow("truncated");
  });
});

function makeProject(): ProjectState {
  const map = new Uint8Array(24 + 32 * 32 * 8);
  writeU32(map, 8, 20);
  writeU16(map, 20, 32);
  writeU16(map, 22, 32);
  const matrix = new Uint8Array(8 + 4 * 8);
  writeU32(matrix, 0, 1);
  writeU16(matrix, 4, 2);
  writeU16(matrix, 6, 2);
  for (let i = 0; i < 4; i += 1) writeU32(matrix, 24 + i * 4, i === 3 ? 5 : 99);
  return {
    session: { baseRom: "BW2", baseVersion: "W2", romName: "test", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(), overlays: {}, texts: { banks: {} }, formats: getNarcFormats("BW2"), trpokInfo: [],
    headers: { count: 1, rows: { 1: { index: 5, matrix_id: 0, overworlds_id: 0, location_name: "Offset map" } } },
    narcs: {
      maps: createNarcStore("maps", "maps", 0, archive(map)),
      matrix: createNarcStore("matrix", "matrix", 1, archive(matrix)),
      overworlds: createNarcStore("overworlds", "overworlds", 2, archive(Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 0))),
    },
  };
}

function archive(bytes: Uint8Array): NARC {
  const narc = new NARC();
  narc.files = [bytes];
  return narc;
}

function crc(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc;
}
