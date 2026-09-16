import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { materializeProjectEdits } from "../pokeweb/projectMaterialize";
import { hydrateNarcRawFiles } from "../pokeweb/persistence";
import { createNarcStore, type ProjectState } from "../pokeweb/projectStore";
import { addMap3dBuilding, deleteMap3dBuilding, extractGameFreakContainer, packGameFreakContainer, parseChunkBuildings, updateMap3dBuilding, type Map3dBuildingField, type Map3dSceneData } from "../pokeweb/map3dModel";

function fixture() {
  const placements = new Uint8Array(4 + 2 * 16);
  writeU32(placements, 0, 2);
  for (const offset of [4, 20]) {
    writeU32(placements, offset, 16 * 4096);
    writeU32(placements, offset + 4, -8 * 4096 >>> 0);
    writeU32(placements, offset + 8, 32 * 4096);
    placements[offset + 15] = 1;
  }
  const permissions = new Uint8Array(12);
  writeU16(permissions, 0, 1);
  writeU16(permissions, 2, 1);
  const bytes = packGameFreakContainer("WB", [Uint8Array.of(9, 8, 7), permissions, placements, Uint8Array.of(0xaa, 0xbb)]);
  const narc = new NARC();
  narc.files = [bytes];
  const store = createNarcStore("maps", "a/0/0/8", 0, narc);
  const project = {
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    narcs: { maps: store }, overlays: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], arm9: new Uint8Array(),
  } as unknown as ProjectState;
  const models = [1, 258].map((uid) => ({ uid, primitives: [{
    material: { name: `model${uid}`, diffuse: [1, 1, 1] as [number, number, number], alpha: 1 },
    positions: new Float32Array([0, 0, 0, 16, 0, 0, 0, 16, 0]), indices: new Uint16Array([0, 1, 2]),
  }] }));
  const building = {
    uid: 1, placementIndex: 0, chunkId: 0, sourceChunkId: 99,
    chunkOrigin: { x: 256, y: 0, z: 768, matrixX: 0, matrixY: 1 },
    worldX: 272, worldY: -8, worldZ: 736, rotationY: 0, primitives: models[0].primitives,
  };
  const data = { buildings: [building, { ...building, placementIndex: 1 }, {
    ...building, chunkOrigin: { x: 768, y: 0, z: 1280, matrixX: 1, matrixY: 2 }, worldX: 784, worldZ: 1248,
  }], buildingModels: models, chunks: [
    { chunkId: 0, sourceChunkId: 99, matrixX: 0, matrixY: 1, worldX: 256, worldZ: 768, primitives: [] },
    { chunkId: 0, sourceChunkId: 99, matrixX: 1, matrixY: 2, worldX: 768, worldZ: 1280, primitives: [] },
  ] } as unknown as Map3dSceneData;
  const parsed = () => parseChunkBuildings(extractGameFreakContainer(store.rawFiles[0]).files[2], [], 0);
  return { project, data, store, bytes, parsed };
}

describe("BW/BW2 building placement edits", () => {
  const newBuilding = { chunkIndex: 1, uid: 258, worldX: 800, worldY: 16, worldZ: 1296, rotationY: 90 };

  it("adds a native record and previews every instance of its chunk at the correct origin", () => {
    const { project, data, store, bytes, parsed } = fixture();
    // Retain a placement whose model failed to load: append by native count, not UI count.
    data.buildings = data.buildings.filter((building) => building.placementIndex === 0);
    const originalFiles = extractGameFreakContainer(bytes).files;
    const selected = addMap3dBuilding(project, data, newBuilding);
    expect(parsed()).toHaveLength(3);
    expect(parsed()[2]).toEqual({ x: 32, y: 16, z: -16, rotationY: 90, modelUid: 258 });
    expect(data.buildings[selected]).toMatchObject({ placementIndex: 2, worldX: 800, worldY: 16, worldZ: 1296, uid: 258 });
    expect(data.buildings[selected - 1]).toMatchObject({ placementIndex: 2, worldX: 288, worldZ: 784 });
    const files = extractGameFreakContainer(store.rawFiles[0]).files;
    expect(files[2].slice(4, 36)).toEqual(originalFiles[2].slice(4));
    for (const i of [0, 1, 3]) expect(files[i]).toEqual(originalFiles[i]);
    expect(store.rawFiles[0].length).toBe(bytes.length + 16);
    expect(data.buildingCount).toBe(4);
  });

  it("deletes all appearances and renumbers later records so subsequent edits hit the right placement", () => {
    const { project, data, store, bytes, parsed } = fixture();
    addMap3dBuilding(project, data, newBuilding);
    deleteMap3dBuilding(project, data, 0);
    expect(parsed()).toHaveLength(2);
    expect(data.buildings.map((b) => b.placementIndex)).toEqual([0, 1, 1]);
    expect(data.buildings.map((b) => b.uid)).toEqual([1, 258, 258]);
    updateMap3dBuilding(project, data, 0, "worldY", 99);
    expect(parsed()[0].y).toBe(99);
    expect(parsed()[1].y).toBe(16);
    const files = extractGameFreakContainer(store.rawFiles[0]).files;
    expect(files[3]).toEqual(extractGameFreakContainer(bytes).files[3]);
    expect(store.rawFiles[0].length).toBe(bytes.length);
  });

  it("can delete the last placement and add to the resulting empty table", () => {
    const { project, data, parsed } = fixture();
    deleteMap3dBuilding(project, data, 0);
    deleteMap3dBuilding(project, data, 0);
    expect(data.buildings).toEqual([]);
    expect(parsed()).toEqual([]);
    const index = addMap3dBuilding(project, data, newBuilding);
    expect(parsed()).toHaveLength(1);
    expect(data.buildings[index].placementIndex).toBe(0);
  });

  it.each([{ uid: 7 }, { worldX: Infinity }, { worldY: 524288 }, { rotationY: 361 }, { chunkIndex: -1 }])("rejects invalid additions atomically: %j", (changes) => {
    const { project, data, store, bytes } = fixture();
    const before = structuredClone(data);
    expect(() => addMap3dBuilding(project, data, { ...newBuilding, ...changes })).toThrow();
    expect(data).toEqual(before);
    expect(store.rawFiles[0]).toBe(bytes);
    expect(store.dirty.size).toBe(0);
  });

  it("preserves pending collision edits and unknown trailing bytes while resizing the table", () => {
    const { project, data, store, bytes } = fixture();
    const withTrailer = new Uint8Array(bytes.length + 3);
    withTrailer.set(bytes); withTrailer.set([7, 8, 9], bytes.length);
    store.rawFiles[0] = withTrailer;
    store.records.set(0, { id: 0, bytes: withTrailer, raw: { per_offset: readU32(bytes, 8), width: 1, height: 1, layer_2_0: 123 } });
    addMap3dBuilding(project, data, newBuilding);
    deleteMap3dBuilding(project, data, 0);
    materializeProjectEdits(project);
    const files = extractGameFreakContainer(store.rawFiles[0]).files;
    expect(files[1][8]).toBe(123);
    expect([...store.rawFiles[0].slice(-3)]).toEqual([7, 8, 9]);
    expect(files[3]).toEqual(Uint8Array.of(0xaa, 0xbb));
  });

  it("writes signed fixed-point coordinates, reverses stored Z and updates reused chunk instances only", () => {
    const { project, data, store, bytes, parsed } = fixture();
    expect(updateMap3dBuilding(project, data, 0, "worldX", 200.1)).toEqual([0, 2]);
    updateMap3dBuilding(project, data, 0, "worldY", -24.5);
    updateMap3dBuilding(project, data, 0, "worldZ", 800);
    expect(parsed()[0]).toMatchObject({ x: Math.round(-55.9 * 4096) / 4096, y: -24.5, z: -32 });
    expect(data.buildings[0]).toMatchObject({ worldX: 200.10009765625, worldY: -24.5, worldZ: 800 });
    expect(data.buildings[2]).toMatchObject({ worldX: 712.10009765625, worldY: -24.5, worldZ: 1312 });
    expect(data.buildings[1]).toMatchObject({ worldX: 272, worldY: -8, worldZ: 736 });
    expect(parsed()[1]).toEqual({ x: 16, y: -8, z: 32, rotationY: 0, modelUid: 1 });
    const start = readU32(bytes, 12) + 4;
    expect(store.rawFiles[0].slice(0, start)).toEqual(bytes.slice(0, start));
    expect(store.rawFiles[0].slice(start + 12)).toEqual(bytes.slice(start + 12));
    expect(store.dirty).toEqual(new Set([0]));
    expect(store.revision).toBe(3);
  });

  it("supports chunk-relative coordinates and native rotation precision, including 360 degrees", () => {
    const { project, data, parsed } = fixture();
    updateMap3dBuilding(project, data, 0, "localX", -10);
    updateMap3dBuilding(project, data, 0, "localY", 12);
    updateMap3dBuilding(project, data, 0, "localZ", 8);
    updateMap3dBuilding(project, data, 0, "rotationY", 45.123);
    expect(parsed()[0]).toMatchObject({ x: -10, y: 12, z: -8, rotationY: Math.round(45.123 * 65536 / 360) * 360 / 65536 });
    expect(data.buildings[0]).toMatchObject({ worldX: 246, worldY: 12, worldZ: 776, rotationY: parsed()[0].rotationY });
    updateMap3dBuilding(project, data, 0, "rotationY", 360);
    expect(parsed()[0].rotationY).toBe(0);
  });

  it("writes model UIDs big-endian and replaces geometry without changing other placements", () => {
    const { project, data, store, bytes, parsed } = fixture();
    updateMap3dBuilding(project, data, 0, "uid", 258);
    const offset = readU32(bytes, 12) + 4 + 14;
    expect([...store.rawFiles[0].slice(offset, offset + 2)]).toEqual([1, 2]);
    expect(store.rawFiles[0].slice(0, offset)).toEqual(bytes.slice(0, offset));
    expect(store.rawFiles[0].slice(offset + 2)).toEqual(bytes.slice(offset + 2));
    expect(parsed()[0].modelUid).toBe(258);
    expect(data.buildings[2].primitives).toBe(data.buildingModels![1].primitives);
    expect(data.buildings[1].primitives).toBe(data.buildingModels![0].primitives);
  });

  it.each<[Map3dBuildingField, number]>([
    ["worldX", NaN], ["worldY", Infinity], ["localX", -524289], ["localZ", 524289],
    ["localY", 524288], ["rotationY", -1], ["rotationY", 361], ["uid", 7], ["uid", 1.5],
  ])("rejects invalid %s=%s atomically", (field, value) => {
    const { project, data, store, bytes } = fixture();
    const before = structuredClone(data);
    expect(() => updateMap3dBuilding(project, data, 0, field, value)).toThrow();
    expect(data).toEqual(before);
    expect(store.rawFiles[0]).toBe(bytes);
    expect(store.dirty.size).toBe(0);
  });

  it("does not dirty unchanged values and refuses missing or truncated placement records", () => {
    const { project, data, store, bytes } = fixture();
    expect(updateMap3dBuilding(project, data, 0, "worldX", 272)).toEqual([]);
    expect(store.dirty.size).toBe(0);
    data.buildings[0].placementIndex = 2;
    expect(() => updateMap3dBuilding(project, data, 0, "worldX", 32)).toThrow(/missing/);
    data.buildings[0].placementIndex = 0;
    const corrupted = bytes.slice();
    writeU32(corrupted, readU32(bytes, 12), 3);
    store.rawFiles[0] = corrupted;
    expect(() => updateMap3dBuilding(project, data, 0, "worldX", 32)).toThrow(/truncated/);
    expect(store.rawFiles[0]).toBe(corrupted);
    expect(store.dirty.size).toBe(0);
  });

  it("retains placement edits alongside 2D permissions through materialization and snapshot hydration", () => {
    const { project, data, store, bytes } = fixture();
    const perOffset = readU32(bytes, 8);
    store.records.set(0, { id: 0, bytes, raw: { per_offset: perOffset, width: 1, height: 1, layer_2_0: 123, layer_3_0: 456 } });
    updateMap3dBuilding(project, data, 0, "worldY", 80);
    materializeProjectEdits(project);
    const snapshot = structuredClone(project);
    snapshot.narcs.maps!.records = new Map();
    snapshot.narcs.maps!.rawFiles = hydrateNarcRawFiles(snapshot.narcs.maps!.rawFiles, snapshot.narcs.maps!.dirty, 1, [bytes]);
    const files = extractGameFreakContainer(snapshot.narcs.maps!.rawFiles[0]).files;
    expect(parseChunkBuildings(files[2], [], 0)[0].y).toBe(80);
    expect([...files[1].slice(8, 12)]).toEqual([123, 0, 200, 1]);
    expect(files[0]).toEqual(Uint8Array.of(9, 8, 7));
    expect(files[3]).toEqual(Uint8Array.of(0xaa, 0xbb));
  });
});
