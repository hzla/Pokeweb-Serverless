import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import type { BaseRom, BaseVersion, NarcName } from "../pokeweb/constants";
import { getNarcFormats } from "../pokeweb/formats";
import { buildGen4Map3dScene, gen4ObjectPlacementOffsetForTerrain, gen4PlacementOffsetForTerrain, parseGen4AreaData, resolveGen4AreaDataIdForMapCell } from "../pokeweb/gen4Map3dModel";
import {
  GEN4_MAP_BUILDING_BYTES,
  GEN4_MAP_HEADER_BYTES,
  GEN4_MAP_PERMISSION_BYTES,
  GEN4_MAP_TILE_COUNT,
  extractGen4MapModelBytes,
  getGen4MapPermissionOffset,
  parseGen4MapBuildings,
} from "../pokeweb/gen4MapModel";
import { buildGen4MapPreview } from "../pokeweb/gen4MapPreviewModel";
import { addOverworldEntity, getOverworldScene, moveOverworldEntity, updateMapTile, updateOverworldEntityField } from "../pokeweb/overworldModel";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { decodeRecord, type NarcStore, type ProjectState } from "../pokeweb/projectStore";
import { gen4PermissionTileFill } from "../ui/gen4MapPreviewRenderer";

describe("gen4MapModel", () => {
  it("parses DSPRE Gen 4 map permission grids from the DPPt map section", () => {
    const project = makeProject({ maps: [makeMapBytes({ bgs: false })], baseRom: "Pt", baseVersion: "Pt" });
    const record = decodeRecord(project, "maps", 0);

    expect(record.raw).toMatchObject({
      permissions_length: GEN4_MAP_PERMISSION_BYTES,
      permissions_offset: GEN4_MAP_HEADER_BYTES,
      has_bgs_section: 0,
      width: 32,
      height: 32,
      type_0: 4,
      collision_1: 0x80,
      blocked_1: 1,
      type_1023: 22,
    });
  });

  it("does not treat DPPt permission bytes as an HGSS BGS section", () => {
    const map = makeMapBytes({ bgs: false, tiles: { 0: [0x34, 0x12] } });

    expect(getGen4MapPermissionOffset(map, "Pt")).toEqual({ offset: GEN4_MAP_HEADER_BYTES, bgsLength: 0, truncated: false });

    const project = makeProject({ maps: [map], baseRom: "Pt", baseVersion: "Pt" });
    const record = decodeRecord(project, "maps", 0);
    expect(record.raw).toMatchObject({
      permissions_offset: GEN4_MAP_HEADER_BYTES,
      has_bgs_section: 0,
      type_0: 0x34,
      collision_0: 0x12,
    });
  });

  it("materializes an unchanged DPPt map byte-for-byte", () => {
    const original = makeMapBytes({ bgs: false, footer: true });
    const project = makeProject({ maps: [original], baseRom: "Pt", baseVersion: "Pt" });

    decodeRecord(project, "maps", 0);
    project.narcs.maps?.dirty.add(0);
    materializeProjectEdits(project);

    expect([...project.narcs.maps!.rawFiles[0]]).toEqual([...original]);
  });

  it("materializes Gen 4 type and collision edits in the permission section only", () => {
    const project = makeProject({ maps: [makeMapBytes({ bgs: false, footer: true })], baseRom: "Pt", baseVersion: "Pt" });
    const record = decodeRecord(project, "maps", 0);
    if (!record.raw) throw new Error("missing map raw");

    record.raw.type_2 = 33;
    record.raw.collision_1 = 0x80;
    record.raw.blocked_1 = 0;
    project.narcs.maps?.dirty.add(0);
    materializeProjectEdits(project);

    const out = project.narcs.maps!.rawFiles[0];
    expect(out[GEN4_MAP_HEADER_BYTES + 2 * 2]).toBe(33);
    expect(out[GEN4_MAP_HEADER_BYTES + 1 * 2 + 1]).toBe(0);
    expect([...out.slice(-2)]).toEqual([0xee, 0xff]);
  });

  it("parses HGSS maps after the BGS section", () => {
    const original = makeMapBytes({ bgs: true });
    const project = makeProject({ maps: [original], baseRom: "HGSS", baseVersion: "HG" });
    const record = decodeRecord(project, "maps", 0);

    expect(getGen4MapPermissionOffset(original, "HGSS")).toEqual({ offset: 22, bgsLength: 6, truncated: false });
    expect(record.raw).toMatchObject({
      permissions_offset: 22,
      has_bgs_section: 1,
      bgs_length: 6,
      type_0: 4,
      collision_1: 0x80,
    });
  });

  it("extracts the Gen 4 terrain BMD0 model section after permissions and buildings", () => {
    const modelBytes = bytesFromString("BMD0model");
    const buildingsBytes = makeBuildingBytes({ modelId: 12 });
    const mapBytes = makeMapBytes({ bgs: false, buildingsBytes, modelBytes });

    expect([...extractGen4MapModelBytes(mapBytes, "Pt")!]).toEqual([...modelBytes]);
  });

  it("parses DSPRE Gen 4 building placement records", () => {
    const mapBytes = makeMapBytes({
      bgs: false,
      buildingsBytes: makeBuildingBytes({
        modelId: 42,
        x: -2.5,
        y: 5.25,
        z: 7.125,
        xRotation: 1,
        yRotation: 2,
        zRotation: 3,
        length: 20,
        width: 16.5,
        height: 18,
        unknown1: 0xaabbccdd,
        unknown2: 0x11223344,
      }),
    });

    expect(parseGen4MapBuildings(mapBytes, "Pt")[0]).toMatchObject({
      index: 0,
      modelId: 42,
      x: -2.5,
      y: 5.25,
      z: 7.125,
      xRotation: 1,
      yRotation: 2,
      zRotation: 3,
      length: 20,
      width: 16.5,
      height: 18,
      unknown1: 0xaabbccdd,
      unknown2: 0x11223344,
    });
  });

  it("parses Gen 4 area data texture ids for DPPt and HGSS", () => {
    expect(parseGen4AreaData(Uint8Array.of(2, 0, 5, 0, 7, 0, 9, 0), "Pt")).toMatchObject({
      buildingTileset: 2,
      mapTileset: 5,
      unknown1: 7,
      lightType: 9,
    });
    expect(parseGen4AreaData(Uint8Array.of(3, 0, 6, 0, 8, 0, 1, 4), "HGSS")).toMatchObject({
      buildingTileset: 3,
      mapTileset: 6,
      dynamicTextureType: 8,
      areaType: 1,
      lightType: 4,
    });
  });

  it("resolves Gen 4 map texture area data from zero-based header ids", () => {
    const project = makeProject({ maps: [makeMapBytes({ bgs: false })], baseRom: "Pt", baseVersion: "Pt" });
    project.headers = {
      count: 4,
      rows: {
        3: { index: 2, area_data_id: 99, location_name: "Wrong Header" },
        4: { index: 3, area_data_id: 6, location_name: "Jubilife City" },
      },
    };

    expect(resolveGen4AreaDataIdForMapCell(project, undefined, 3)).toBe(6);
  });

  it("builds a stitched matrix preview from Gen 4 map permission grids", () => {
    const maps = [
      makeMapBytes({ bgs: false, tiles: { 0: [4, 0] } }),
      makeMapBytes({ bgs: false, tiles: { 0: [0x10, 0], 1: [1, 0x80] } }),
    ];
    const matrix = makeMatrixBytes({ width: 2, height: 1, maps: [0, 1], headers: [5, 6], altitudes: [2, 3] });
    const project = makeProject({ maps, matrix, baseRom: "Pt", baseVersion: "Pt" });

    const preview = buildGen4MapPreview(project, 0);
    expect(preview).toMatchObject({ width: 64, height: 32, cellWidth: 32, cellHeight: 32 });
    expect(preview.cells).toHaveLength(2);
    expect(preview.cells[0]).toMatchObject({ mapId: 0, matrixX: 0, x: 0, y: 0, headerId: 5, altitude: 2 });
    expect(preview.cells[1]).toMatchObject({ mapId: 1, matrixX: 1, x: 32, y: 0, headerId: 6, altitude: 3 });
    expect(preview.cells[1].tiles[1]).toMatchObject({ type: 1, collision: 0x80, blocked: true });

    const filtered = buildGen4MapPreview(project, 0, { headerId: 6 });
    expect(filtered).toMatchObject({ width: 32, height: 32 });
    expect(filtered.cells).toHaveLength(1);
    expect(filtered.cells[0]).toMatchObject({ mapId: 1, matrixX: 1, x: 0 });

    const grouped = buildGen4MapPreview(project, 0, { headerId: 6, headerIds: [5, 6] });
    expect(grouped).toMatchObject({ width: 64, height: 32 });
    expect(grouped.cells.map((cell) => cell.mapId)).toEqual([0, 1]);
  });

  it("keeps empty and missing matrix cells visible in the preview", () => {
    const matrix = makeMatrixBytes({ width: 2, height: 1, maps: [0xffff, 7] });
    const project = makeProject({ maps: [makeMapBytes({ bgs: false })], matrix, baseRom: "Pt", baseVersion: "Pt" });

    const preview = buildGen4MapPreview(project, 0);
    expect(preview.cells).toHaveLength(2);
    expect(preview.cells[0]).toMatchObject({ empty: true, missing: false, x: 0 });
    expect(preview.cells[1]).toMatchObject({ empty: false, missing: true, x: 32 });
    expect(preview.warnings).toEqual(expect.arrayContaining(["Matrix 0 cell 0 is empty.", "Matrix 0 cell 1 references missing map 7."]));
  });

  it("feeds Gen 4 stitched permission maps into the existing overworld scene shape", () => {
    const maps = [
      makeMapBytes({ bgs: false, tiles: { 0: [4, 0] } }),
      makeMapBytes({ bgs: false, tiles: { 0: [0x10, 0], 1: [1, 0x80] } }),
    ];
    const matrix = makeMatrixBytes({ width: 2, height: 1, maps: [0, 1], headers: [5, 6], altitudes: [0, 2] });
    const project = makeProject({ maps, matrix, baseRom: "Pt", baseVersion: "Pt" });
    project.headers = {
      count: 1,
      rows: {
        1: { index: 6, location_name: "Route Test", matrix_id: 0, overworlds_id: 0 },
      },
    };

    const scene = getOverworldScene(project, 0);
    expect(scene.maps).toHaveLength(1);
    expect(scene).toMatchObject({ width: 32, height: 32, locationName: "Route Test" });
    expect(scene.maps[0]).toMatchObject({ id: 1, x: 0, y: 0, permissionFormat: "gen4" });
    expect(scene.maps[0].layer2[0]).toBe(0x10);
    expect(scene.maps[0].layer3[1]).toBe(0x80);
  });

  it("uses DSPRE Gen 4 overworld event fields for NPC scene data and add/edit writes", () => {
    const project = makeProject({ maps: [makeMapBytes({ bgs: false })], baseRom: "Pt", baseVersion: "Pt" });
    project.headers = {
      count: 1,
      rows: {
        1: { index: 0, location_name: "Route Test", matrix_id: 0, overworlds_id: 0 },
      },
    };
    project.narcs.overworlds!.rawFiles[0] = makeGen4EventBytesWithOverworld();

    const scene = getOverworldScene(project, 0);
    expect(scene.npcs[0]).toMatchObject({ index: 0, overworldId: 7, spriteId: 12, x: 5, y: 6, direction: 2 });

    const added = addOverworldEntity(project, 0, "npc");
    moveOverworldEntity(project, 0, "npc", added, 33, 34);
    updateOverworldEntityField(project, 0, { kind: "npc", index: added }, "overworld_sprite", 15);

    const raw = decodeRecord(project, "overworlds", 0).raw!;
    expect(raw.overworld_1_overlay_table_entry).toBe(15);
    expect(raw.overworld_1_x_matrix_position).toBe(1);
    expect(raw.overworld_1_x_map_position).toBe(1);
    expect(raw.overworld_1_y_matrix_position).toBe(1);
    expect(raw.overworld_1_y_map_position).toBe(2);

    materializeProjectEdits(project);
    const out = project.narcs.overworlds!.rawFiles[0];
    expect(readU16(out, 4)).toBe(2);
    expect(readU16(out, 42)).toBe(15);
    expect(readU16(out, 64)).toBe(33);
    expect(readU16(out, 66)).toBe(34);
  });

  it("routes overworld tile popup edits to Gen 4 type and collision bytes", () => {
    const project = makeProject({ maps: [makeMapBytes({ bgs: false })], baseRom: "Pt", baseVersion: "Pt" });

    expect(updateMapTile(project, 0, 1, 2, 9)).toBe(9);
    expect(updateMapTile(project, 0, 1, 3, 0x80)).toBe(0x80);

    const raw = decodeRecord(project, "maps", 0).raw;
    expect(raw).toMatchObject({ type_1: 9, collision_1: 0x80, blocked_1: 1 });
    materializeProjectEdits(project);
    const out = project.narcs.maps!.rawFiles[0];
    expect(out[GEN4_MAP_HEADER_BYTES + 1 * 2]).toBe(9);
    expect(out[GEN4_MAP_HEADER_BYTES + 1 * 2 + 1]).toBe(0x80);
  });

  it("builds a Gen 4 map3d scene with a visible permission fallback when terrain BMD0 parsing fails", () => {
    const mapBytes = makeMapBytes({ bgs: false, modelBytes: bytesFromString("BMD0bad!") });
    const project = makeProject({ maps: [mapBytes], baseRom: "Pt", baseVersion: "Pt" });

    const scene = buildGen4Map3dScene(project, 0, { headerId: 0, label: "Synthetic" });

    expect(scene).toMatchObject({
      label: "Synthetic",
      matrixId: 0,
      chunkSpan: 512,
      chunkCount: 1,
      buildingCount: 0,
    });
    expect(scene.chunks[0]?.primitives).toHaveLength(1);
    expect(scene.chunks[0]?.primitives[0]?.colors?.length).toBeGreaterThan(0);
    expect(scene.permissionTileCount).toBe(1024);
    expect(scene.warnings.some((warning) => warning.includes("Map 0"))).toBe(true);
  });

  it("detects top-left encoded Gen 4 terrain origins for placement alignment", () => {
    expect(gen4PlacementOffsetForTerrain({ minX: -256, maxX: 256, minY: 0, maxY: 8, minZ: -256, maxZ: 256 })).toEqual({ x: 0, z: 0 });
    expect(gen4PlacementOffsetForTerrain({ minX: 0, maxX: 512, minY: 0, maxY: 8, minZ: 0, maxZ: 512 })).toEqual({ x: 256, z: 256 });
    expect(gen4ObjectPlacementOffsetForTerrain({ minX: 0, maxX: 512, minY: 0, maxY: 8, minZ: 0, maxZ: 512 })).toEqual({ x: 336, z: 208 });
  });

  it("audits Gen 4 building placements even when terrain uses the fallback mesh", () => {
    const mapBytes = makeMapBytes({
      bgs: false,
      buildingsBytes: makeBuildingBytes({ modelId: 12 }),
      modelBytes: bytesFromString("bad terrain"),
    });
    const project = makeProject({ maps: [mapBytes], baseRom: "Pt", baseVersion: "Pt" });

    const scene = buildGen4Map3dScene(project, 0, { headerId: 0, label: "Synthetic" });

    expect(scene.buildingPlacementCount).toBe(1);
    expect(scene.buildingCount).toBe(0);
    expect(scene.buildingDiagnostics).toContainEqual(
      expect.objectContaining({
        mapId: 0,
        placementIndex: 0,
        modelId: 12,
        status: "missing-model-store",
      }),
    );
  });

  it("builds Gen 4 map3d scenes from same-location matrix cells and event spawnables", () => {
    const maps = [makeMapBytes({ bgs: false }), makeMapBytes({ bgs: false })];
    const matrix = makeMatrixBytes({ width: 2, height: 1, maps: [0, 1], headers: [5, 6], altitudes: [0, 2] });
    const project = makeProject({ maps, matrix, baseRom: "Pt", baseVersion: "Pt" });
    project.headers = {
      count: 2,
      rows: {
        1: { index: 5, location_name: "Jubilife City", location_name_id: 2, matrix_id: 0, overworlds_id: 0 },
        2: { index: 6, location_name: "Jubilife City", location_name_id: 2, matrix_id: 0, overworlds_id: 0 },
      },
    };
    project.narcs.overworlds!.rawFiles[0] = makeGen4EventBytesWithSpawnable();

    const scene = buildGen4Map3dScene(project, 0, { headerId: 5, label: "Jubilife City", locationGroup: true });

    expect(scene.chunkCount).toBe(2);
    expect(scene.chunks.map((chunk) => chunk.sourceChunkId)).toEqual([0, 1]);
    expect(scene.chunks[1]).toMatchObject({ worldY: 16 });
    expect(scene.entityCount).toBe(1);
    expect(scene.entities[0]).toMatchObject({
      kind: "furniture",
      id: 0,
      x: 528,
      y: 24,
      z: 32,
      width: 16,
      depth: 16,
    });
    expect(scene.warnings).toEqual(expect.arrayContaining(["Location group render includes 2 headers from matrix 0.", "Loaded 1 Gen 4 event overlay from 1 event file."]));
  });

  it("exposes stable preview colors for blocked, grass, and water tiles", () => {
    expect(gen4PermissionTileFill({ type: 4, collision: 0, blocked: false })).toBe("#42d66b");
    expect(gen4PermissionTileFill({ type: 0x10, collision: 0, blocked: false })).toBe("#3da5ff");
    expect(gen4PermissionTileFill({ type: 4, collision: 0x80, blocked: true })).toBe("#343946");
  });
});

function makeProject(options: {
  maps: Uint8Array[];
  matrix?: Uint8Array;
  baseRom: BaseRom;
  baseVersion: BaseVersion;
}): ProjectState {
  return {
    session: {
      romName: "gen4-map-test",
      generation: "gen4",
      baseVersion: options.baseVersion,
      baseRom: options.baseRom,
      fairy: false,
      fileIds: { maps: 1, matrix: 2 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "CPUE", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      maps: makeStore("maps", options.maps),
      matrix: makeStore("matrix", [options.matrix ?? makeMatrixBytes({ width: 1, height: 1, maps: [0] })]),
      overworlds: makeStore("overworlds", [makeEmptyEventBytes()]),
    },
    texts: { banks: {} },
    formats: getNarcFormats(options.baseRom),
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function makeMapBytes(options: { bgs: boolean; footer?: boolean; tiles?: Record<number, [number, number]>; buildingsBytes?: Uint8Array; modelBytes?: Uint8Array }): Uint8Array {
  const bgs = options.bgs ? Uint8Array.of(0x34, 0x12, 0x02, 0x00, 0xaa, 0xbb) : new Uint8Array();
  const footer = options.footer ? Uint8Array.of(0xee, 0xff) : new Uint8Array();
  const buildingsBytes = options.buildingsBytes ?? new Uint8Array();
  const modelBytes = options.modelBytes ?? new Uint8Array();
  const out = new Uint8Array(GEN4_MAP_HEADER_BYTES + bgs.length + GEN4_MAP_PERMISSION_BYTES + buildingsBytes.length + modelBytes.length + footer.length);
  writeU32(out, 0x00, GEN4_MAP_PERMISSION_BYTES);
  writeU32(out, 0x04, buildingsBytes.length);
  writeU32(out, 0x08, modelBytes.length);
  writeU32(out, 0x0c, 0);
  out.set(bgs, GEN4_MAP_HEADER_BYTES);

  const permissionsOffset = GEN4_MAP_HEADER_BYTES + bgs.length;
  for (let index = 0; index < GEN4_MAP_TILE_COUNT; index += 1) {
      const [type, collision] = options.tiles?.[index] ?? defaultTile(index);
      out[permissionsOffset + index * 2] = type;
      out[permissionsOffset + index * 2 + 1] = collision;
  }
  out.set(buildingsBytes, permissionsOffset + GEN4_MAP_PERMISSION_BYTES);
  out.set(modelBytes, permissionsOffset + GEN4_MAP_PERMISSION_BYTES + buildingsBytes.length);
  out.set(footer, permissionsOffset + GEN4_MAP_PERMISSION_BYTES + buildingsBytes.length + modelBytes.length);
  return out;
}

function makeBuildingBytes(values: Partial<Record<keyof ReturnType<typeof parseGen4MapBuildings>[number], number>> = {}): Uint8Array {
  const out = new Uint8Array(GEN4_MAP_BUILDING_BYTES);
  writeU32(out, 0, values.modelId ?? 0);
  writeFx32(out, 0x04, values.x ?? 0);
  writeFx32(out, 0x08, values.y ?? 0);
  writeFx32(out, 0x0c, values.z ?? 0);
  writeFx32(out, 0x10, values.xRotation ?? 0);
  writeFx32(out, 0x14, values.yRotation ?? 0);
  writeFx32(out, 0x18, values.zRotation ?? 0);
  writeFx32(out, 0x1c, values.length ?? 16);
  writeFx32(out, 0x20, values.width ?? 16);
  writeFx32(out, 0x24, values.height ?? 16);
  writeU32(out, 0x28, values.unknown1 ?? 0);
  writeU32(out, 0x2c, values.unknown2 ?? 0);
  return out;
}

function writeFx32(out: Uint8Array, offset: number, value: number): void {
  writeU32(out, offset, Math.round(value * 4096) >>> 0);
}

function defaultTile(index: number): [number, number] {
  if (index === 0) return [4, 0];
  if (index === 1) return [7, 0x80];
  if (index === GEN4_MAP_TILE_COUNT - 1) return [22, 0];
  return [0, 0];
}

function makeMatrixBytes(options: { width: number; height: number; maps: number[]; headers?: number[]; altitudes?: number[] }): Uint8Array {
  const count = options.width * options.height;
  const hasHeaders = Boolean(options.headers);
  const hasAltitudes = Boolean(options.altitudes);
  const out = new Uint8Array(5 + (hasHeaders ? count * 2 : 0) + (hasAltitudes ? count : 0) + count * 2);
  out[0] = options.width;
  out[1] = options.height;
  out[2] = hasHeaders ? 1 : 0;
  out[3] = hasAltitudes ? 1 : 0;
  out[4] = 0;
  let offset = 5;
  if (hasHeaders) {
    for (let index = 0; index < count; index += 1) {
      writeU16(out, offset, options.headers?.[index] ?? 0);
      offset += 2;
    }
  }
  if (hasAltitudes) {
    for (let index = 0; index < count; index += 1) out[offset++] = options.altitudes?.[index] ?? 0;
  }
  for (let index = 0; index < count; index += 1) {
    writeU16(out, offset, options.maps[index] ?? 0xffff);
    offset += 2;
  }
  return out;
}

function makeEmptyEventBytes(): Uint8Array {
  return new Uint8Array(16);
}

function makeGen4EventBytesWithOverworld(): Uint8Array {
  const out = new Uint8Array(4 + 4 + 0x20 + 4 + 4);
  writeU32(out, 0, 0);
  writeU32(out, 4, 1);
  const offset = 8;
  [7, 12, 3, 1, 55, 200, 2, 3, 0, 0, 2, 4, 5, 6].forEach((value, index) => writeU16(out, offset + index * 2, value));
  writeU32(out, offset + 28, 8192);
  writeU32(out, offset + 32, 0);
  writeU32(out, offset + 36, 0);
  return out;
}

function makeGen4EventBytesWithSpawnable(): Uint8Array {
  const out = new Uint8Array(4 + 20 + 4 + 4 + 4);
  writeU32(out, 0, 1);
  const offset = 4;
  writeU16(out, offset, 123);
  writeU16(out, offset + 2, 1);
  writeU16(out, offset + 4, 33);
  writeU16(out, offset + 8, 2);
  writeU32(out, offset + 10, 0);
  writeU16(out, offset + 16, 2);
  writeU32(out, offset + 20, 0);
  writeU32(out, offset + 24, 0);
  writeU32(out, offset + 28, 0);
  return out;
}

function bytesFromString(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
