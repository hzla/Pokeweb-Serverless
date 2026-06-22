import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import type { BaseRom, BaseVersion } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import {
  defaultGen4OverworldTableEntry,
  gen4SpecialOverworldIconName,
  gen4OverworldFrameIndexForDirection,
  parseDpptOverworldTable,
  parseHgssOverworldTable,
  resolveGen4OverworldSpriteFileId,
} from "../pokeweb/gen4OverworldSpriteModel";
import type { ProjectState } from "../pokeweb/projectStore";

describe("gen4OverworldSpriteModel", () => {
  it("parses DSPRE DPPt overworld tables as 32-bit entry/sprite pairs", () => {
    const bytes = new Uint8Array(0x24);
    writeU32(bytes, 4, 10);
    writeU32(bytes, 8, 123);
    writeU32(bytes, 12, 11);
    writeU32(bytes, 16, 124);
    writeU32(bytes, 20, 0xffff);

    const table = parseDpptOverworldTable(bytes, 4);

    expect(table.get(10)).toMatchObject({ entryId: 10, spriteId: 123, properties: 0 });
    expect(table.get(11)).toMatchObject({ entryId: 11, spriteId: 124 });
    expect(table.get(91)).toMatchObject({ spriteId: 0x3d3d, properties: 0x3d3d, is3d: true });
  });

  it("parses DSPRE HGSS overworld tables as 16-bit entry/sprite/property triples", () => {
    const bytes = new Uint8Array(0x20);
    writeU16(bytes, 2, 22);
    writeU16(bytes, 4, 222);
    writeU16(bytes, 6, 0x3456);
    writeU16(bytes, 8, 23);
    writeU16(bytes, 10, 223);
    writeU16(bytes, 12, 0x4567);
    writeU16(bytes, 14, 0xffff);

    const table = parseHgssOverworldTable(bytes, 2);

    expect(table.get(22)).toMatchObject({ entryId: 22, spriteId: 222, properties: 0x3456 });
    expect(table.get(23)).toMatchObject({ entryId: 23, spriteId: 223, properties: 0x4567 });
    expect(table.get(116)).toMatchObject({ spriteId: 0x3d3d, properties: 0x3d3d, is3d: true });
  });

  it("resolves event overlay table entries to matching OWSprites file ids", () => {
    const overlay5 = new Uint8Array(0x2bc60);
    writeU32(overlay5, 0x2bc34, 12);
    writeU32(overlay5, 0x2bc38, 77);
    writeU32(overlay5, 0x2bc3c, 0xffff);
    const project = makeProject({ baseRom: "Pt", baseVersion: "Pt", idCode: "CPUE", overlay5 });

    expect(resolveGen4OverworldSpriteFileId(project, 12)).toBe(77);
    expect(resolveGen4OverworldSpriteFileId(project, 91)).toBeUndefined();
    expect(resolveGen4OverworldSpriteFileId(project, 999)).toBeUndefined();
    expect(defaultGen4OverworldTableEntry()).toBe(1);
  });

  it("maps DSPRE's special 3D overworld entries to event preview icons", () => {
    expect(gen4SpecialOverworldIconName(91)).toBe("brown_sign");
    expect(gen4SpecialOverworldIconName(94)).toBe("route_sign");
    expect(gen4SpecialOverworldIconName(102)).toBe("overworld");
    expect(gen4SpecialOverworldIconName(999)).toBeUndefined();
  });

  it("uses DSPRE's Gen 4 overworld frame choices for direction previews", () => {
    expect([0, 1, 2, 3].map((direction) => gen4OverworldFrameIndexForDirection(4, direction))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((direction) => gen4OverworldFrameIndexForDirection(8, direction))).toEqual([0, 2, 4, 6]);
    expect([0, 1, 2, 3].map((direction) => gen4OverworldFrameIndexForDirection(16, direction))).toEqual([0, 11, 2, 4]);
    expect([0, 1, 2, 3].map((direction) => gen4OverworldFrameIndexForDirection(32, direction))).toEqual([0, 27, 2, 4]);
  });
});

function makeProject(options: {
  baseRom: BaseRom;
  baseVersion: BaseVersion;
  idCode: string;
  overlay5?: Uint8Array;
}): ProjectState {
  return {
    session: {
      romName: "gen4-overworld-sprite-test",
      generation: "gen4",
      baseVersion: options.baseVersion,
      baseRom: options.baseRom,
      fairy: false,
      fileIds: {},
      blacklist: [],
    },
    romInfo: { title: "test", idCode: options.idCode, fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: options.overlay5 ? { 5: options.overlay5 } : {},
    narcs: {},
    texts: { banks: {} },
    formats: getNarcFormats(options.baseRom),
    trpokInfo: [],
  };
}
