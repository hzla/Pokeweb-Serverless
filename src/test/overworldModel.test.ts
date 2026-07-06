import { describe, expect, it } from "vitest";
import { getNarcFormats, type FieldSpec } from "../pokeweb/formats";
import { parseHeaders } from "../pokeweb/headerModel";
import {
  addOverworldEntity,
  addOverworldNpc,
  deleteOverworldEntity,
  deleteOverworldNpc,
  getOverworldScene,
  moveOverworldEntity,
  moveOverworldNpc,
  OVERWORLD_GROUP_FORMATS,
  OVERWORLD_HEADER_FORMAT,
  updateMapPermissionTiles,
  updateMapTile,
  updateOverworldEntityField,
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
    expect(scene.headerRowId).toBe(1);
    expect(scene.header.index).toBe(0);
    expect(scene.matrixId).toBe(0);
    expect(scene.maps).toHaveLength(1);
    expect(scene.maps[0].layer2).toEqual([0, 1, 4, 63]);
    expect(scene.npcs[0]).toMatchObject({ index: 0, overworldId: 0, x: 1, y: 2, z: 0 });
    expect(project.narcs.maps?.records.size).toBe(1);
  });

  it("normalizes Gen 5 event coordinates against positive matrix scene offsets", () => {
    const project = makeProject(
      packOverworld({
        npc_count: 1,
        npc_0_overworld_id: 0,
        npc_0_overworld_sprite: 1,
        npc_0_x_cord: 35,
        npc_0_y_cord: 36,
      }),
    );
    project.headers = {
      count: 1,
      rows: {
        1: {
          index: 5,
          matrix_id: 0,
          overworlds_id: 0,
          parent_map_id: 5,
          location_name: "Offset Route",
          fly_x: 40,
          fly_z: 40,
        },
      },
    };
    project.narcs.maps = makeStore("maps", [makeMapBytes(32, 32, [], []), makeMapBytes(32, 32, [], []), makeMapBytes(32, 32, [], []), makeMapBytes(32, 32, [], [])]);
    project.narcs.matrix = makeStore("matrix", makeMatrixBytes(2, 2, [0, 1, 2, 3], [99, 99, 99, 5]));

    const scene = getOverworldScene(project, 0);

    expect(scene.translateX).toBe(32);
    expect(scene.translateY).toBe(32);
    expect(scene.maps).toHaveLength(1);
    expect(scene.maps[0]).toMatchObject({ id: 3, x: 0, y: 0 });
    expect(scene.npcs[0]).toMatchObject({ x: 3, y: 4 });

    moveOverworldNpc(project, 0, 0, 5, 6);
    materializeProjectEdits(project);

    const data = project.narcs.overworlds?.rawFiles[0];
    expect(data).toBeDefined();
    expect(readU16(data!, 36)).toBe(37);
    expect(readU16(data!, 38)).toBe(38);
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

  it("batch paints Gen 5 permission tiles across multiple maps", () => {
    const project = makeProject();
    const firstMap = makeMapBytes(2, 2, [0, 1, 4, 63], [0, 2, 3, 4]);
    const secondMap = makeMapBytes(2, 1, [10, 11], [0, 0]);
    project.narcs.maps = makeStore("maps", [firstMap, secondMap]);

    const changed = updateMapPermissionTiles(project, [
      { mapId: 0, tileIndex: 1, tileClass: 114, flags: 7 },
      { mapId: 1, tileIndex: 0, tileClass: 4, flags: 0x20 },
    ]);
    materializeProjectEdits(project);

    expect(changed).toBe(2);
    expect(project.narcs.maps.dirty.has(0)).toBe(true);
    expect(project.narcs.maps.dirty.has(1)).toBe(true);
    expect(readU16(project.narcs.maps.rawFiles[0], 0x14 + 4 + 1 * 8 + 4)).toBe(114);
    expect(readU16(project.narcs.maps.rawFiles[0], 0x14 + 4 + 1 * 8 + 6)).toBe(7);
    expect(readU16(project.narcs.maps.rawFiles[1], 0x14 + 4 + 4)).toBe(4);
    expect(readU16(project.narcs.maps.rawFiles[1], 0x14 + 4 + 6)).toBe(0x20);
    expect(project.actionChangelog?.entries.at(-1)?.text).toBe("2 permission tiles painted across 2 maps.");
  });

  it("does not dirty maps or rewrite bytes for no-op permission paint batches", () => {
    const project = makeProject();
    const original = project.narcs.maps?.rawFiles[0].slice();

    const changed = updateMapPermissionTiles(project, [{ mapId: 0, tileIndex: 0, tileClass: 0, flags: 0 }]);
    materializeProjectEdits(project);

    expect(changed).toBe(0);
    expect(project.narcs.maps?.dirty.size).toBe(0);
    expect(project.narcs.maps?.rawFiles[0]).toEqual(original);
    expect(project.actionChangelog?.entries.some((entry) => entry.domain === "maps") ?? false).toBe(false);
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

  it("parses furniture, warps, and triggers with CTRMap-style semantic fields", () => {
    const project = makeProject(makeEntityOverworldBytes());
    const scene = getOverworldScene(project, 0);

    expect(scene.furniture[0]).toMatchObject({ kind: "furniture", index: 0, script: 30, condition: 2, interactibility: 1, isRail: false, x: 3, y: 4, altitude: 16 });
    expect(scene.warps[0]).toMatchObject({ kind: "warp", index: 0, targetZone: 20, targetWarpId: 1, contactDirection: 2, transitionType: 3, isRail: false, x: 7, y: 8, altitude: 24, width: 2, height: 3, unknown: 9 });
    expect(scene.triggers[0]).toMatchObject({ kind: "trigger", index: 0, script: 77, variable: 11, value: 10, type: 6, isRail: false, x: 9, y: 10, altitude: 12, width: 4, height: 5, unknown: 13 });
  });

  it("adds, moves, deletes, and serializes furniture, warp, and trigger records", () => {
    const project = makeProject();

    const furniture = addOverworldEntity(project, 0, "furniture");
    const warp = addOverworldEntity(project, 0, "warp");
    const trigger = addOverworldEntity(project, 0, "trigger");
    moveOverworldEntity(project, 0, "furniture", furniture, 3, 4);
    moveOverworldEntity(project, 0, "warp", warp, 5, 6);
    moveOverworldEntity(project, 0, "trigger", trigger, 7, 8);
    deleteOverworldEntity(project, 0, "warp", warp);
    materializeProjectEdits(project);

    const data = project.narcs.overworlds?.rawFiles[0];
    expect(data).toBeDefined();
    expect(data?.[4]).toBe(1);
    expect(data?.[5]).toBe(1);
    expect(data?.[6]).toBe(0);
    expect(data?.[7]).toBe(1);
    expect(readU16(data!, 8 + 8)).toBe(3);
    expect(readU16(data!, 8 + 12)).toBe(4);
    expect(readU16(data!, 8 + 20 + 36 + 10)).toBe(7);
    expect(readU16(data!, 8 + 20 + 36 + 12)).toBe(8);
    expect([...data!.slice(-4)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it("preserves rail-positioned fields during unrelated semantic edits", () => {
    const project = makeProject(makeRailOverworldBytes());

    updateOverworldEntityField(project, 0, { kind: "warp", index: 0 }, "targetZone", 123);
    updateOverworldEntityField(project, 0, { kind: "trigger", index: 0 }, "script", 456);
    materializeProjectEdits(project);

    const data = project.narcs.overworlds?.rawFiles[0];
    expect(data).toBeDefined();
    const warpOffset = 8;
    expect(readU16(data!, warpOffset + 6)).toBe(1);
    expect(readU16(data!, warpOffset + 8)).toBe(4);
    expect(readU16(data!, warpOffset + 10)).toBe(5);
    expect(readU16(data!, warpOffset + 12)).toBe(6);
    const triggerOffset = 8 + 20;
    expect(readU16(data!, triggerOffset + 8)).toBe(1);
    expect(readU16(data!, triggerOffset + 10)).toBe(9);
    expect(readU16(data!, triggerOffset + 12)).toBe(10);
    expect(readU16(data!, triggerOffset + 14)).toBe(11);
  });
});

function makeProject(overworlds = makeOverworldBytes()): ProjectState {
  const formats = getNarcFormats("BW2");
  const headerFormat = formats.headers;
  if (!headerFormat) throw new Error("Missing header format");

  const headers = packRows(headerFormat, [{ matrix_id: 0, map_id: 0, location_name_id: 0 }]);
  const maps = makeMapBytes(2, 2, [0, 1, 4, 63], [0, 2, 3, 4]);
  const matrix = makeMatrixBytes(1, 1, [0], [0]);
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

function makeStore(name: NarcStore["name"], data: Uint8Array | Uint8Array[]): NarcStore {
  const rawFiles = Array.isArray(data) ? data : [data];
  return {
    name,
    fileId: 0,
    sourcePath: name,
    fileCount: rawFiles.length,
    rawFiles,
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

function makeEntityOverworldBytes(): Uint8Array {
  return packOverworld({
    furniture_count: 1,
    npc_count: 1,
    warp_count: 1,
    trigger_count: 1,
    furniture_0_script_id: 30,
    furniture_0_unknown_1: 2,
    furniture_0_unknown_2: 1,
    furniture_0_unknown_3: 0,
    furniture_0_x_cord: 3,
    furniture_0_y_cord: 4,
    furniture_0_z_cord: 16,
    npc_0_overworld_id: 0,
    npc_0_overworld_sprite: 1,
    npc_0_x_cord: 5,
    npc_0_y_cord: 6,
    warp_0_map_id: 20,
    warp_0_use_warp_cords: 1,
    warp_0_contact_direction: 2,
    warp_0_transition_type: 3,
    warp_0_exit_x: pack16(0, 7 * 16 + 8),
    warp_0_exit_y: pack16(24, 8 * 16 + 8),
    warp_0_x_extension: 2,
    warp_0_y_extension: 3,
    warp_0_directionality: 9,
    trigger_0_entity_id: 77,
    trigger_0_to_trigger_value: 10,
    trigger_0_to_check_value: 11,
    trigger_0_unknown_1: 6,
    trigger_0_unknown_2: 0,
    trigger_0_x_cord: 9,
    trigger_0_y_cord: 10,
    trigger_0_z_cord: 4,
    trigger_0_unknown_3: 5,
    trigger_0_unknown_4: 12,
    trigger_0_unknown_5: 13,
  });
}

function makeRailOverworldBytes(): Uint8Array {
  return packOverworld({
    furniture_count: 0,
    npc_count: 0,
    warp_count: 1,
    trigger_count: 1,
    warp_0_map_id: 20,
    warp_0_exit_x: pack16(1, 4),
    warp_0_exit_y: pack16(5, 6),
    warp_0_x_extension: 2,
    warp_0_y_extension: 3,
    trigger_0_entity_id: 77,
    trigger_0_unknown_2: 1,
    trigger_0_x_cord: 9,
    trigger_0_y_cord: 10,
    trigger_0_z_cord: 11,
    trigger_0_unknown_3: 12,
    trigger_0_unknown_4: 13,
  });
}

function packOverworld(raw: Record<string, number>): Uint8Array {
  const footer = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd);
  const length =
    8 +
    Number(raw.furniture_count ?? 0) * groupLength("furniture") +
    Number(raw.npc_count ?? 0) * groupLength("npc") +
    Number(raw.warp_count ?? 0) * groupLength("warp") +
    Number(raw.trigger_count ?? 0) * groupLength("trigger") +
    footer.length;
  const out = new Uint8Array(length);
  let offset = 0;
  raw.file_length = length;
  for (const [size, field] of OVERWORLD_HEADER_FORMAT) {
    writeInt(out, offset, size, raw[field] ?? 0);
    offset += size;
  }
  for (const group of ["furniture", "npc", "warp", "trigger"] as const) {
    for (let index = 0; index < Number(raw[`${group}_count`] ?? 0); index += 1) {
      for (const [size, field] of OVERWORLD_GROUP_FORMATS[group]) {
        writeInt(out, offset, size, raw[`${group}_${index}_${field}`] ?? 0);
        offset += size;
      }
    }
  }
  out.set(footer, offset);
  return out;
}

function groupLength(group: keyof typeof OVERWORLD_GROUP_FORMATS): number {
  return OVERWORLD_GROUP_FORMATS[group].reduce((sum, [size]) => sum + size, 0);
}

function pack16(low: number, high: number): number {
  return (low & 0xffff) + (high & 0xffff) * 0x10000;
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
