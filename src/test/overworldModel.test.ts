import { describe, expect, it } from "vitest";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { parseHeaders } from "../pokeweb/headerModel";
import {
  addOverworldNpc,
  deleteOverworldNpc,
  getOverworldScene,
  moveOverworldNpc,
  OVERWORLD_GROUP_FORMATS,
  OVERWORLD_HEADER_FORMAT,
  updateMapTile,
} from "../pokeweb/overworldModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

describe("overworldModel", () => {
  it("derives a scene from headers, matrix, maps, and overworlds lazily", () => {
    const project = makeProject();
    project.headers = parseHeaders(project);

    expect(project.narcs.maps?.records.size).toBe(0);
    const scene = getOverworldScene(project, 0);

    expect(scene.locationName).toBe("Black City");
    expect(scene.matrixId).toBe(0);
    expect(scene.maps).toHaveLength(1);
    expect(scene.maps[0].layer2).toEqual([0, 1, 4, 63]);
    expect(scene.npcs[0]).toMatchObject({ index: 0, overworldId: 0, x: 1, y: 2, z: 0 });
    expect(project.narcs.maps?.records.size).toBe(1);
  });

  it("patches dirty map tile layers without rewriting untouched map bytes", () => {
    const project = makeProject();
    const original = project.narcs.maps?.rawFiles[0].slice();

    updateMapTile(project, 0, 2, 2, 114);
    updateMapTile(project, 0, 2, 3, 7);
    materializeProjectEdits(project);

    const next = project.narcs.maps?.rawFiles[0];
    expect(project.narcs.maps?.dirty.has(0)).toBe(true);
    expect(readU16(next!, 0x14 + 4 + 2 * 8 + 4)).toBe(114);
    expect(readU16(next!, 0x14 + 4 + 2 * 8 + 6)).toBe(7);
    expect(next?.slice(0, 0x14)).toEqual(original?.slice(0, 0x14));
  });

  it("adds, moves, deletes, and serializes NPC records while preserving footer bytes", () => {
    const project = makeProject();

    const addedIndex = addOverworldNpc(project, 0);
    moveOverworldNpc(project, 0, addedIndex, 5, 6, 1);
    deleteOverworldNpc(project, 0, 0);
    materializeProjectEdits(project);

    const data = project.narcs.overworlds?.rawFiles[0];
    expect(data).toBeDefined();
    expect(data?.[5]).toBe(1);
    expect(readU16(data!, 8)).toBe(1);
    expect(readU16(data!, 36)).toBe(5);
    expect(readU16(data!, 38)).toBe(6);
    expect([...data!.slice(-4)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });
});

function makeProject(): ProjectState {
  const formats = getNarcFormats("BW2");
  const headerFormat = formats.headers;
  if (!headerFormat) throw new Error("Missing header format");

  const headers = packRows(headerFormat, [{ matrix_id: 0, map_id: 0, location_name_id: 0 }]);
  const maps = makeMapBytes(2, 2, [0, 1, 4, 63], [0, 2, 3, 4]);
  const matrix = makeMatrixBytes(1, 1, [0], [0]);
  const overworlds = makeOverworldBytes();

  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { headers: 0, maps: 1, matrix: 2, overworlds: 3 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 1 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      headers: makeStore("headers", headers),
      maps: makeStore("maps", maps),
      matrix: makeStore("matrix", matrix),
      overworlds: makeStore("overworlds", overworlds),
    },
    texts: { banks: { locations: ["Black City"] } },
    formats,
    trpokInfo: [],
  };
}

function makeStore(name: NarcStore["name"], data: Uint8Array): NarcStore {
  return {
    name,
    fileId: 0,
    sourcePath: name,
    fileCount: 1,
    rawFiles: [data],
    records: new Map(),
    dirty: new Set(),
  };
}

function makeMapBytes(width: number, height: number, layer2: number[], layer3: number[]): Uint8Array {
  const perOffset = 0x14;
  const out = new Uint8Array(perOffset + 4 + width * height * 8);
  writeU32(out, 8, perOffset);
  writeInt(out, perOffset, 2, width);
  writeInt(out, perOffset + 2, 2, height);
  for (let tile = 0; tile < width * height; tile += 1) {
    const offset = perOffset + 4 + tile * 8;
    writeInt(out, offset + 4, 2, layer2[tile] ?? 0);
    writeInt(out, offset + 6, 2, layer3[tile] ?? 0);
  }
  return out;
}

function makeMatrixBytes(width: number, height: number, maps: number[], headers: number[]): Uint8Array {
  const out = new Uint8Array(8 + width * height * 8);
  writeInt(out, 4, 2, width);
  writeInt(out, 6, 2, height);
  let offset = 8;
  for (const map of maps) {
    writeU32(out, offset, map);
    offset += 4;
  }
  for (const header of headers) {
    writeU32(out, offset, header);
    offset += 4;
  }
  return out;
}

function makeOverworldBytes(): Uint8Array {
  const footer = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd);
  const out = new Uint8Array(8 + 36 + footer.length);
  let offset = 0;
  const raw: Record<string, number> = {
    file_length: out.length,
    furniture_count: 0,
    npc_count: 1,
    warp_count: 0,
    trigger_count: 0,
    npc_0_overworld_id: 0,
    npc_0_overworld_sprite: 1,
    npc_0_x_cord: 1,
    npc_0_y_cord: 2,
    npc_0_z_cord: 0,
  };
  for (const [size, field] of OVERWORLD_HEADER_FORMAT) {
    writeInt(out, offset, size, raw[field] ?? 0);
    offset += size;
  }
  for (const [size, field] of OVERWORLD_GROUP_FORMATS.npc) {
    writeInt(out, offset, size, raw[`npc_0_${field}`] ?? 0);
    offset += size;
  }
  out.set(footer, offset);
  return out;
}

function packRows(format: FieldSpec[], rows: Array<Record<string, number>>): Uint8Array {
  const rowLength = format.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(rowLength * rows.length);
  rows.forEach((row, rowIndex) => {
    let offset = rowIndex * rowLength;
    for (const [size, field] of format) {
      writeInt(out, offset, size, row[field] ?? 0);
      offset += size;
    }
  });
  return out;
}

function writeInt(out: Uint8Array, offset: number, size: number, value: number): void {
  for (let i = 0; i < size; i += 1) out[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  writeInt(out, offset, 4, value);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
